import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
import { Terrain, GROUND_Y, BEDROCK_Y } from './terrain.js';
import { CollapseSystem } from './collapse.js';

import { VOXEL_SIZE, FINE } from './config.js';
export { VOXEL_SIZE };

// Her küpün yüzüne 2x2 ince ızgara (tuğla/tahta/beton derzi): küpler yarı boyutlu küplerden örülmüş gibi görünür
function makeCubeTexture(def) {
  const N = 16, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const base = def.color;
  const shade = (f) => `rgb(${Math.min(255, Math.round(((base >> 16) & 255) * f))},${Math.min(255, Math.round(((base >> 8) & 255) * f))},${Math.min(255, Math.round((base & 255) * f))})`;
  const h = N / 2;
  const isBrick = def.id === 1, isWood = def.id === 2, isGlass = def.id === 4;
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      g.fillStyle = shade(0.92 + Math.random() * 0.14);
      g.fillRect(qx * h, qy * h, h, h);
    }
  }
  g.fillStyle = shade(isGlass ? 1.25 : 0.72); // derz çizgileri: yarım küpleri ayırır
  g.fillRect(h - 1, 0, 1, N); g.fillRect(0, h - 1, N, 1);
  g.fillRect(0, 0, N, 1); g.fillRect(0, 0, 1, N);
  if (isBrick) { g.fillStyle = shade(0.6); g.fillRect(h / 2, 0, 1, h - 1); g.fillRect(h + h / 2, h, 1, h); }
  if (isWood) { g.fillStyle = shade(0.8); g.fillRect(0, h / 2, N, 1); g.fillRect(0, h + h / 2, N, 1); }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Eski 0.5 m'lik küp için ayarlanmış sayılar (kırılan küp adedi, puan) yeni boyuta oranlanır
const VOLUME_RATIO = Math.pow(0.5 / VOXEL_SIZE, 3); // 0.5 m küpte 1; küçüldükçe daha çok küp gerekir
const CHUNK_SIZE = 16; // metre: dünya bu boyutlu bölgelere ayrılır, kamera dışındakiler çizilmez

// Teardown Tarzı Mikro-Voxel Renk Paleti
export const PALETTE = {
  CONCRETE: { id: 0, color: 0x94a3b8, name: 'Beton', canBreakWithHammer: true },
  BRICK:    { id: 1, color: 0xb91c1c, name: 'Tuğla', canBreakWithHammer: true },
  WOOD:     { id: 2, color: 0x854d0e, name: 'Tahta', canBreakWithHammer: true, isWood: true },
  IRON:     { id: 3, color: 0x475569, name: 'Demir', canBreakWithHammer: false, isIron: true },
  GLASS:    { id: 4, color: 0x38bdf8, name: 'Cam', canBreakWithHammer: true },
  ROOF:     { id: 5, color: 0x7c2d12, name: 'Çatı', canBreakWithHammer: true },
  TNT:      { id: 6, color: 0xef4444, name: 'TNT', isTNT: true, canBreakWithHammer: true },
  GOLD:     { id: 7, color: 0xfacc15, name: 'Altın', canBreakWithHammer: true },
  SAND:     { id: 8, color: 0xfde047, name: 'Kum (Sahil)', canBreakWithHammer: true },
  ASPHALT:  { id: 9, color: 0x1e293b, name: 'Asfalt (Yol)', canBreakWithHammer: true },
  WHITE:    { id: 11, color: 0xf2f2ef, name: 'Beyaz Duvar', canBreakWithHammer: true },
  GRASS:    { id: 10, color: 0x4f8f3a, name: 'Çim (Tepe)', canBreakWithHammer: true, isGrass: true }
};
PALETTE.STEEL = PALETTE.IRON; // Geriye dönük uyumluluk (Çelik = Demir)

// Maddelere Göre Çekiç Dayanıklılığı
export const MATERIAL_HARDNESS = {
  [PALETTE.WOOD.id]: 0.5,     // 1. Madde: Tahta - çekiçle kolayca kırılır
  [PALETTE.GLASS.id]: 0.3,    // Cam
  [PALETTE.SAND.id]: 0.4,     // Kum
  [10]: 0.4,                  // Çim
  [11]: 1.3,                  // Beyaz duvar
  [PALETTE.BRICK.id]: 1.2,    // Tuğla
  [PALETTE.CONCRETE.id]: 1.6, // Beton
  [PALETTE.ASPHALT.id]: 1.8,  // Asfalt
  [PALETTE.IRON.id]: Infinity,// 2. Madde: Demir - çekiçle kesinlikle kırılamaz
  [PALETTE.ROOF.id]: 0.9,     // Çatı
  [PALETTE.TNT.id]: 0.5,      // TNT
  [PALETTE.GOLD.id]: 1.0      // Altın
};

export class VoxelWorld {
  constructor(scene, physicsWorld, particleSystem, onScoreGain) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;
    this.onScoreGain = onScoreGain;

    // Voxel haritası: key = `${ix},${iy},${iz}` -> { id, type, x, y, z, instanceIdx }
    this.voxels = new Map();
    this.totalInitialVoxels = 0;
    this.destroyedVoxels = 0;

    // Her malzeme tipi için InstancedMesh (Binlerce minik küpü tek bir GPU çağrısıyla 60 FPS çizer)
    this.materials = {};
    this.chunkMeshes = [];
    this.rimMeshes = {};     // çukur kenarı küpleri için (zemin malzemesi başına dinamik)
    this.terrain = new Terrain(scene, physicsWorld);
    this.collapse = new CollapseSystem(this);

    // Dinamik Fırlayan Fizik Parçacık Küpleri (Teardown döküntüleri)
    this.dynamicDebris = [];
    this.maxDynamicDebris = 500; // Performansı korumak için sınır

    this.cubeGeo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    this.cubeShape = new CANNON.Box(new CANNON.Vec3(VOXEL_SIZE / 4, VOXEL_SIZE / 4, VOXEL_SIZE / 4));
    this.debrisGeo = new THREE.BoxGeometry(VOXEL_SIZE / 2, VOXEL_SIZE / 2, VOXEL_SIZE / 2); // döküntü: yarım boy küpler

    this.initInstancedMeshes();
  }

  initInstancedMeshes() {
    const createdIds = new Set();
    Object.values(PALETTE).forEach(matDef => {
      if (!matDef || createdIds.has(matDef.id)) return;
      createdIds.add(matDef.id);

      this.materials[matDef.id] = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: makeCubeTexture(matDef),
        transparent: matDef.id === PALETTE.GLASS.id,
        opacity: matDef.id === PALETTE.GLASS.id ? 0.7 : 1.0
      });
    });
  }

  // Minik Küp Ekleme
  setVoxel(ix, iy, iz, matType) {
    const key = `${ix},${iy},${iz}`;
    if (this.voxels.has(key)) return;

    const wx = ix * VOXEL_SIZE;
    const wy = iy * VOXEL_SIZE + VOXEL_SIZE / 2;
    const wz = iz * VOXEL_SIZE;

    this.voxels.set(key, {
      ix, iy, iz,
      x: wx, y: wy, z: wz,
      type: matType,
      active: true,
      instanceIdx: -1
    });
  }

  // Voxel Kütlesi İnşa Etme (Kutu şeklinde minik kareler yığını)
  fillBox(a0, b0, c0, a1, b1, c1, matType) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = this._q(a0, b0, c0, a1, b1, c1);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setVoxel(x, y, z, matType);
        }
      }
    }
  }

  // Seviye koordinatları 0.25 m'lik ince ızgaradadır; küp daha büyükse en yakın küp ızgarasına yuvarlanır.
  _q(minX, minY, minZ, maxX, maxY, maxZ) {
    const f = VOXEL_SIZE / FINE;
    if (f === 1) return [minX, minY, minZ, maxX, maxY, maxZ];
    const cx = (a) => Math.floor((a + f / 2) / f), cy = (a) => Math.floor(a / f);
    return [cx(minX), cy(minY), cx(minZ), cx(maxX), cy(maxY), cx(maxZ)];
  }

  // İnce ızgara koordinatındaki bir noktanın küp indeksi
  toVoxel(fx, fy, fz) { const q = this._q(fx, fy, fz, fx, fy, fz); return [q[0], q[1], q[2]]; }

  // Aralıktaki voxelleri kaldır (kapı, pencere boşluğu, merdiven deliği)
  removeBox(a0, b0, c0, a1, b1, c1) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = this._q(a0, b0, c0, a1, b1, c1);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.voxels.delete(`${x},${y},${z}`);
        }
      }
    }
  }

  // Yalnız MEVCUT voxellerin türünü değiştirir; boşluklara (kapı, garaj girişi) hiçbir şey eklemez.
  // Pencereler için: duvarın olduğu yere cam koyar, kapı boşluğuna cam yerleştirmez.
  retypeBox(a0, b0, c0, a1, b1, c1, matType) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = this._q(a0, b0, c0, a1, b1, c1);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      const v = this.voxels.get(`${x},${y},${z}`);
      if (v) v.type = matType;
    }
  }

  // Varsa üstüne yazar (cam pencere gibi duvarın yerini alan parçalar için)
  replaceBox(minX, minY, minZ, maxX, maxY, maxZ, matType) {
    this.removeBox(minX, minY, minZ, maxX, maxY, maxZ);
    this.fillBox(minX, minY, minZ, maxX, maxY, maxZ, matType);
  }

  // İçi boş duvar / oda inşa etme
  fillHollowBox(minX, minY, minZ, maxX, maxY, maxZ, wallMat, floorMat) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const isEdge = x === minX || x === maxX || z === minZ || z === maxZ;
          const isFloor = y === minY;
          const isCeil = y === maxY;

          if (isFloor) {
            this.setVoxel(x, y, z, floorMat || wallMat);
          } else if (isCeil || isEdge) {
            this.setVoxel(x, y, z, wallMat);
          }
        }
      }
    }
  }

  // Seviye oluşturulduğunda GPU InstancedMesh'leri hazırlar.
  // Voxeller 16 m'lik bölgelere ve malzemeye göre gruplanır: kamera dışındaki bölgeler çizilmez.
  buildMeshBuffers() {
    this._disposeChunkMeshes();

    const groups = new Map(); // `${typeId}|${cx}|${cz}` -> voxel listesi
    for (const v of this.voxels.values()) {
      const cx = Math.floor(v.x / CHUNK_SIZE);
      const cz = Math.floor(v.z / CHUNK_SIZE);
      const gk = `${v.type.id}|${cx}|${cz}`;
      let list = groups.get(gk);
      if (!list) { list = []; groups.set(gk, list); }
      list.push(v);
    }

    const dummy = new THREE.Object3D();
    for (const [gk, list] of groups.entries()) {
      const typeId = Number(gk.split('|')[0]);
      const mesh = new THREE.InstancedMesh(this.cubeGeo, this.materials[typeId], list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        dummy.position.set(v.x, v.y, v.z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        v.instanceIdx = i;
        v.mesh = mesh;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.chunkMeshes.push(mesh);
    }

    this.terrain.build();
    this._createRimMeshes();

    this.totalInitialVoxels = this.voxels.size;
    this.destroyedVoxels = 0;
  }

  _disposeChunkMeshes() {
    this.chunkMeshes.forEach(m => {
      this.scene.remove(m);
      m.dispose();
    });
    this.chunkMeshes = [];
    Object.values(this.rimMeshes).forEach(m => { this.scene.remove(m); m.dispose(); });
    this.rimMeshes = {};
  }

  // ── ZEMİN ÜST KATMANI KIRILMASI ──────────────────────────────────────────────

  // Çukur kenarındaki sağlam hücreler 2 sıra küp olarak çizilir (çukurun yan duvarı + kırık kenar görünümü)
  _createRimMeshes() {
    const cap = 40000;
    [PALETTE.CONCRETE, PALETTE.SAND, PALETTE.ASPHALT, PALETTE.WOOD, PALETTE.GRASS].forEach(m => {
      const mesh = new THREE.InstancedMesh(this.cubeGeo, this.materials[m.id], cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
      this.rimMeshes[m.id] = mesh;
    });
  }

  _addRimVoxel(ix, iy, iz, type, cellIdx) {
    const mesh = this.rimMeshes[type.id];
    const key = `${ix},${iy},${iz}`;
    if (!mesh || mesh.count >= mesh.instanceMatrix.count || this.voxels.has(key)) return;
    const dummy = new THREE.Object3D();
    const v = {
      ix, iy, iz,
      x: ix * VOXEL_SIZE, y: iy * VOXEL_SIZE + VOXEL_SIZE / 2, z: iz * VOXEL_SIZE,
      type, active: true,
      instanceIdx: mesh.count, mesh,
      groundCell: cellIdx
    };
    dummy.position.set(v.x, v.y, v.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
    this.voxels.set(key, v);
  }

  // Kırılan hücrelerin sağlam komşularını voxel olarak da çiz (kırık kenar + çukur duvarı)
  _materializeRim(brokenIdx) {
    const t = this.terrain;
    const b = t.bounds;
    brokenIdx.forEach(idx => {
      const c = idx % b.cols, r = Math.floor(idx / b.cols);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= b.cols || nr >= b.rows) return;
        const n = nr * b.cols + nc;
        if (t.top[n] !== 1 || t.rim[n] === 1) return;
        t.rim[n] = 1;
        const cc = t.cellCenter(n);
        const ix = Math.round(cc.x / VOXEL_SIZE), iz = Math.round(cc.z / VOXEL_SIZE);
        const type = t.matList[t.matIdx[n]];
        const rows = Math.round((GROUND_Y - BEDROCK_Y) / VOXEL_SIZE);
        const iy0 = Math.round(t.bedYIdx(n) / VOXEL_SIZE);
        for (let k = 0; k < rows; k++) this._addRimVoxel(ix, iy0 + k, iz, type, n);
      });
    });
  }

  _hideVoxel(v) {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    if (v.mesh && v.instanceIdx !== -1) {
      v.mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
      v.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Her voxel kaldırması buradan geçer. Çukur kenarı küpü yok olursa altındaki zemin hücresi de kırılır.
  _kill(v) {
    if (!v.active) return;
    v.active = false;
    if (v.groundCell === undefined) {
      this.destroyedVoxels++;
      this.collapse.queue(v); // bağlantısı kopan parçalar düşer
      return;
    }
    // Kenar küpünün diğer sırası ve altındaki üst katman hücresi birlikte gider
    const t = this.terrain;
    const idx = v.groundCell;
    const rows = Math.round((GROUND_Y - BEDROCK_Y) / VOXEL_SIZE);
    const iy0 = Math.round(t.bedYIdx(idx) / VOXEL_SIZE);
    for (let k = 0; k < rows; k++) {
      const sib = this.voxels.get(`${v.ix},${iy0 + k},${v.iz}`);
      if (sib && sib.active && sib !== v) {
        sib.active = false;
        this._hideVoxel(sib);
        if (this.dynamicDebris.length < this.maxDynamicDebris && Math.random() > 0.5) {
          this.spawnLooseVoxel(sib.x, sib.y, sib.z, sib.type, { x: sib.x, y: sib.y - 1, z: sib.z }, 0.5, 1, 40);
        }
      }
    }
    if (t.breakCell(idx)) this._materializeRim([idx]);
  }

  // Üst katmanı kır: hücreleri dokudan sil, parçaları fırlat, çukur kenarlarını çiz.
  // Alt katmana (taban kayası) dokunmaz.
  breakGround(center, radius, force = 200) {
    const broken = this.terrain.breakInSphere(center, radius);
    if (broken.length === 0) return 0;

    this._materializeRim(broken.map(h => h.idx));

    // Kırık parçalar: bir kısmı fırlayan küp olur (alan küçük küplerle dolu, hepsini fiziğe sokma)
    broken.forEach(h => {
      if (this.dynamicDebris.length >= this.maxDynamicDebris) return;
      if (Math.random() > 0.3) return;
      const dist = Math.hypot(h.x - center.x, h.z - center.z);
      this.spawnLooseVoxel(h.x, this.terrain.topYAt(h.x, h.z) + 0.05, h.z, h.mat, center, dist, radius, force);
    });
    return broken.length;
  }

  // TEARDOWN PATLAMA & OYUK AÇMA MOTORU (Hole Carving & Destruction)
  explode(blastPos, blastRadius, force) {
    const r2 = blastRadius * blastRadius;
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0); // Görünmez yapmak için boyutu sıfırla
    dummy.updateMatrix();

    let removedCount = 0;
    const tntChainPositions = [];

    // Suya yakın patlama: su sütunu; yakındaki oyuncu itilir
    if (blastPos.y < 2 && !this.terrain.isLand(blastPos.x, blastPos.z) && this.particleSystem.createSplash) {
      this.particleSystem.createSplash(new THREE.Vector3(blastPos.x, -0.15, blastPos.z), Math.min(5, blastRadius / 1.2));
      sound.playSplash && sound.playSplash();
    }
    if (this.onBlast) this.onBlast(blastPos, blastRadius, force);

    // Patlama yakınındaki NPC'ler vurulur
    if (this.npcs) this.npcs.hitSphere(blastPos, blastRadius);
    if (this.planes) this.planes.hitSphere(blastPos, blastRadius);
    if (this.cars) this.cars.hitSphere(blastPos, blastRadius);

    // Zemin üst katmanını kır (taban kayası etkilenmez)
    const groundBroken = this.breakGround(blastPos, blastRadius, force);

    // Patlama yarıçapındaki ızgara koordinat sınırları
    const minIx = Math.floor((blastPos.x - blastRadius) / VOXEL_SIZE);
    const maxIx = Math.ceil((blastPos.x + blastRadius) / VOXEL_SIZE);
    const minIy = Math.floor((blastPos.y - blastRadius) / VOXEL_SIZE);
    const maxIy = Math.ceil((blastPos.y + blastRadius) / VOXEL_SIZE);
    const minIz = Math.floor((blastPos.z - blastRadius) / VOXEL_SIZE);
    const maxIz = Math.ceil((blastPos.z + blastRadius) / VOXEL_SIZE);

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const key = `${ix},${iy},${iz}`;
          const v = this.voxels.get(key);
          if (!v || !v.active) continue;

          const dx = v.x - blastPos.x;
          const dy = v.y - blastPos.y;
          const dz = v.z - blastPos.z;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq <= r2) {
            this._kill(v);
            removedCount++;

            // InstancedMesh'ten kaldır (Görünmez yap)
            if (v.instanceIdx !== -1) {
              const mesh = v.mesh;
              mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
              mesh.instanceMatrix.needsUpdate = true;
            }

            // TNT ise zincirleme patlama kuyruğuna ekle
            if (v.type.isTNT) {
              tntChainPositions.push(new THREE.Vector3(v.x, v.y, v.z));
            }

            // Teardown Tarzı Uçuşan Minik Fizik Küpleri (Debris Spawning)
            // Çeperdeki minik küpleri loose physics parçalarına çevir
            const dist = Math.sqrt(distSq);
            if (Math.random() > 0.65 && this.dynamicDebris.length < this.maxDynamicDebris) {
              this.spawnLooseVoxel(v.x, v.y, v.z, v.type, blastPos, dist, blastRadius, force);
            }
          }
        }
      }
    }


    // Skor ve ses
    removedCount += groundBroken;
    if (removedCount > 0 && this.onScoreGain) {
      const score = Math.max(1, Math.round(removedCount * 12 / VOLUME_RATIO));
      this.onScoreGain(score, `+${score} VOXEL PARÇALANDI!`);
    }

    // Zincirleme TNT patlamalarını tetikle (1,5 m'lik kümelere göre tek patlama)
    const tntClusters = this._clusterPositions(tntChainPositions);
    if (tntClusters.length > 0) {
      tntClusters.forEach((pos, idx) => {
        setTimeout(() => {
          sound.playTNTExplosion();
          this.particleSystem.createExplosion(pos, 8, 0xef4444);
          this.explode(pos, 5.0, 320);
        }, 100 + idx * 60 + Math.random() * 80);
      });
    }

    return removedCount;
  }

  // Yakın pozisyonları tek noktaya indirger (yüzlerce küçük TNT küpü = tek patlama)
  _clusterPositions(list, cell = 1.5) {
    const seen = new Map();
    list.forEach(p => {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
      if (!seen.has(key)) seen.set(key, p);
    });
    return Array.from(seen.values());
  }

  // Çekiç yere vurdu: küçük bir alanda üst katman kırılır (alt katman kırılmaz)
  hammerGround(point) {
    const n = this.breakGround(point, 0.7, 60);
    if (n > 0) {
      sound.playHammerHit();
      if (this.onScoreGain) this.onScoreGain(Math.max(1, Math.round(n * 10 / VOLUME_RATIO)), '+ZEMİN KIRILDI');
    }
    return n;
  }

  // TEARDOWN ÇEKİÇ VURUŞU (Maddesine göre az hasar veren darbe)
  hammerHit(hitPoint, hammerPower = 1.0) {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();

    // Çekiç vuruşu dar bir alana vurur (~0.65m)
    const hitRadius = 0.95; // metre (eski küp boyutuna göre ayarlı)
    const r2 = hitRadius * hitRadius;

    let removedCount = 0;
    const candidates = [];

    const minIx = Math.floor((hitPoint.x - hitRadius) / VOXEL_SIZE);
    const maxIx = Math.ceil((hitPoint.x + hitRadius) / VOXEL_SIZE);
    const minIy = Math.floor((hitPoint.y - hitRadius) / VOXEL_SIZE);
    const maxIy = Math.ceil((hitPoint.y + hitRadius) / VOXEL_SIZE);
    const minIz = Math.floor((hitPoint.z - hitRadius) / VOXEL_SIZE);
    const maxIz = Math.ceil((hitPoint.z + hitRadius) / VOXEL_SIZE);

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const key = `${ix},${iy},${iz}`;
          const v = this.voxels.get(key);
          if (!v || !v.active) continue;

          const dx = v.x - hitPoint.x;
          const dy = v.y - hitPoint.y;
          const dz = v.z - hitPoint.z;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq <= r2) {
            candidates.push({ v, distSq });
          }
        }
      }
    }

    if (candidates.length === 0) return null;

    // En yakından başlayarak sırala
    candidates.sort((a, b) => a.distSq - b.distSq);

    const hitMaterial = candidates[0].v.type;

    // 2. MADDE: DEMİR - Çekiçle kırılamaz, biri kırmaya çalışırsa sadece demir sesi çıksın!
    if (hitMaterial.isIron || hitMaterial.canBreakWithHammer === false) {
      sound.playIronHit();
      return { success: false, broken: false, material: hitMaterial, reason: 'iron' };
    }

    const hardness = MATERIAL_HARDNESS[hitMaterial.id] || 1.0;

    // 1. MADDE: TAHTA (ve diğer kırılabilirler) - Çekiçle kırılabilir
    const maxBreak = Math.max(1, Math.round((5 * hammerPower * VOLUME_RATIO) / hardness));

    for (let i = 0; i < Math.min(candidates.length, maxBreak); i++) {
      const v = candidates[i].v;
      this._kill(v);
      removedCount++;

      if (v.instanceIdx !== -1) {
        const mesh = v.mesh;
        mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }

      // Minik döküntü fırlat
      if (this.dynamicDebris.length < this.maxDynamicDebris) {
        this.spawnLooseVoxel(v.x, v.y, v.z, v.type, hitPoint, Math.sqrt(candidates[i].distSq), hitRadius, 25);
      }
    }


    // Tahta kırılınca ahşap kırılma sesi, diğerlerinde standart darbe sesi
    if (hitMaterial.isWood) {
      sound.playWoodHit();
    } else {
      sound.playHammerHit();
    }

    // TNT var ise patlat
    if (hitMaterial.isTNT) {
      setTimeout(() => {
        sound.playTNTExplosion();
        this.particleSystem.createExplosion(hitPoint, 8, 0xef4444);
        this.explode(hitPoint, 5.0, 320);
      }, 80);
    }

    if (removedCount > 0 && this.onScoreGain) {
      const score = Math.max(1, Math.round(removedCount * 10 / VOLUME_RATIO));
      this.onScoreGain(score, `+${score} ÇEKİÇ (${hitMaterial.name})`);
    }

    return { success: true, removedCount, material: hitMaterial };
  }

  // TABANCA VURUŞU (1 tuşu) — Tahtayı rahatça kırar, demiri biraz kırar
  gunHit(hitPoint, gunPower = 1.0, radius = 1.25) {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();

    const hitRadius = radius; // metre
    const r2 = hitRadius * hitRadius;

    const candidates = [];
    const minIx = Math.floor((hitPoint.x - hitRadius) / VOXEL_SIZE);
    const maxIx = Math.ceil((hitPoint.x + hitRadius) / VOXEL_SIZE);
    const minIy = Math.floor((hitPoint.y - hitRadius) / VOXEL_SIZE);
    const maxIy = Math.ceil((hitPoint.y + hitRadius) / VOXEL_SIZE);
    const minIz = Math.floor((hitPoint.z - hitRadius) / VOXEL_SIZE);
    const maxIz = Math.ceil((hitPoint.z + hitRadius) / VOXEL_SIZE);

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const key = `${ix},${iy},${iz}`;
          const v = this.voxels.get(key);
          if (!v || !v.active) continue;
          const dx = v.x - hitPoint.x;
          const dy = v.y - hitPoint.y;
          const dz = v.z - hitPoint.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq <= r2) candidates.push({ v, distSq });
        }
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distSq - b.distSq);

    const hitMaterial = candidates[0].v.type;
    let removedCount = 0;

    if (hitMaterial.isIron) {
      // Demir: tabanca biraz hasar verir — sadece 1-2 voxel kırar
      const ironBreak = Math.max(1, Math.round(gunPower * 1.5 * VOLUME_RATIO));
      for (let i = 0; i < Math.min(candidates.length, ironBreak); i++) {
        const v = candidates[i].v;
        this._kill(v);
        removedCount++;
        if (v.instanceIdx !== -1) {
          const mesh = v.mesh;
          mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
          mesh.instanceMatrix.needsUpdate = true;
        }
        if (this.dynamicDebris.length < this.maxDynamicDebris) {
          this.spawnLooseVoxel(v.x, v.y, v.z, v.type, hitPoint, Math.sqrt(candidates[i].distSq), hitRadius, 20);
        }
      }
      sound.playIronHit();
    } else {
      // Tahta ve diğerleri: tabanca rahatça kırar
      const hardness = MATERIAL_HARDNESS[hitMaterial.id] || 1.0;
      const maxBreak = Math.max(2, Math.round((12 * gunPower * VOLUME_RATIO) / hardness));
      for (let i = 0; i < Math.min(candidates.length, maxBreak); i++) {
        const v = candidates[i].v;
        this._kill(v);
        removedCount++;
        if (v.instanceIdx !== -1) {
          const mesh = v.mesh;
          mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
          mesh.instanceMatrix.needsUpdate = true;
        }
        if (this.dynamicDebris.length < this.maxDynamicDebris) {
          this.spawnLooseVoxel(v.x, v.y, v.z, v.type, hitPoint, Math.sqrt(candidates[i].distSq), hitRadius, 35);
        }
      }
      if (hitMaterial.isWood) sound.playWoodHit();
      else sound.playHammerHit();

      if (hitMaterial.isTNT) {
        setTimeout(() => {
          sound.playTNTExplosion();
          this.particleSystem.createExplosion(hitPoint, 8, 0xef4444);
          this.explode(hitPoint, 5.0, 320);
        }, 80);
      }
    }

    if (removedCount > 0 && this.onScoreGain) {
      const score = Math.max(1, Math.round(removedCount * 15 / VOLUME_RATIO));
      this.onScoreGain(score, `+${score} KURŞUN (${hitMaterial.name})`);
    }
    return { success: true, removedCount, material: hitMaterial };
  }

  // IŞIN KILICI: noktadaki yarıçap içinde her malzemeyi (demir dahil) keser
  // push (isteğe bağlı): kopan küplere verilecek hız vektörü (ör. dönen bıçağın o noktadaki hareketi)
  sweepCut(point, radius, push = null) {
    const r2 = radius * radius;
    let removed = 0;
    let tnt = null;
    const minIx = Math.floor((point.x - radius) / VOXEL_SIZE), maxIx = Math.ceil((point.x + radius) / VOXEL_SIZE);
    const minIy = Math.floor((point.y - radius) / VOXEL_SIZE), maxIy = Math.ceil((point.y + radius) / VOXEL_SIZE);
    const minIz = Math.floor((point.z - radius) / VOXEL_SIZE), maxIz = Math.ceil((point.z + radius) / VOXEL_SIZE);
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const v = this.voxels.get(`${ix},${iy},${iz}`);
          if (!v || !v.active) continue;
          const dx = v.x - point.x, dy = v.y - point.y, dz = v.z - point.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          this._kill(v);
          this._hideVoxel(v);
          removed++;
          if (v.type.isTNT && !tnt) tnt = new THREE.Vector3(v.x, v.y, v.z);
          if (this.dynamicDebris.length < this.maxDynamicDebris && Math.random() > (push ? 0.5 : 0.8)) {
            this.spawnLooseVoxel(v.x, v.y, v.z, v.type, point, 0.3, radius, 22, push);
          }
        }
      }
    }
    if (tnt) {
      setTimeout(() => {
        sound.playTNTExplosion();
        this.particleSystem.createExplosion(tnt, 8, 0xef4444);
        this.explode(tnt, 5.0, 320);
      }, 90);
    }
    return removed;
  }

  // CYBORG LAZER KESİM (R tuşu) — Ray-march ile hem demiri hem tahtayı rahatça keser
  laserCut(startPos, direction, maxRange = 22) {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();

    let removedCount = 0;
    const step = VOXEL_SIZE * 0.6;
    const hitRadius = 0.7; // metre
    const r2 = hitRadius * hitRadius;

    for (let dist = 0.5; dist <= maxRange; dist += step) {
      const pos = startPos.clone().addScaledVector(direction, dist);

      const minIx = Math.floor((pos.x - hitRadius) / VOXEL_SIZE);
      const maxIx = Math.ceil((pos.x + hitRadius) / VOXEL_SIZE);
      const minIy = Math.floor((pos.y - hitRadius) / VOXEL_SIZE);
      const maxIy = Math.ceil((pos.y + hitRadius) / VOXEL_SIZE);
      const minIz = Math.floor((pos.z - hitRadius) / VOXEL_SIZE);
      const maxIz = Math.ceil((pos.z + hitRadius) / VOXEL_SIZE);

      for (let ix = minIx; ix <= maxIx; ix++) {
        for (let iy = minIy; iy <= maxIy; iy++) {
          for (let iz = minIz; iz <= maxIz; iz++) {
            const key = `${ix},${iy},${iz}`;
            const v = this.voxels.get(key);
            if (!v || !v.active) continue;
            const dx = v.x - pos.x;
            const dy = v.y - pos.y;
            const dz = v.z - pos.z;
            if (dx * dx + dy * dy + dz * dz > r2) continue;

            this._kill(v);
            removedCount++;
            if (v.instanceIdx !== -1) {
              const mesh = v.mesh;
              mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
              mesh.instanceMatrix.needsUpdate = true;
            }
            if (this.dynamicDebris.length < this.maxDynamicDebris) {
              this.spawnLooseVoxel(v.x, v.y, v.z, v.type, pos, 0.1, hitRadius, 18);
            }
          }
        }
      }
    }

    if (removedCount > 0 && this.onScoreGain) {
      const score = Math.max(1, Math.round(removedCount * 20 / VOLUME_RATIO));
      this.onScoreGain(score, `+${score} LAZER KESİM!`);
    }
    return removedCount;
  }


  spawnLooseVoxel(x, y, z, matType, blastCenter, dist, blastRadius, blastForce, push = null) {
    // Görsel Küp
    const mat = new THREE.MeshLambertMaterial({ color: matType.color });
    const mesh = new THREE.Mesh(this.debrisGeo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    // Fizik Gövdesi
    const body = new CANNON.Body({
      mass: 1.2,
      shape: this.cubeShape,
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.15,
      angularDamping: 0.2
    });

    // Patlama merkezinden dışarı doğru fırlama vektörü
    const dir = new THREE.Vector3(x - blastCenter.x, y - blastCenter.y + 0.8, z - blastCenter.z).normalize();
    const impulse = (blastForce / 12) * Math.max(0.2, 1 - dist / blastRadius);
    body.velocity.set(
      dir.x * impulse + (Math.random() - 0.5) * 4,
      dir.y * impulse + Math.random() * 5,
      dir.z * impulse + (Math.random() - 0.5) * 4
    );
    if (push) body.velocity.set(body.velocity.x + push.x * 0.7, body.velocity.y + push.y * 0.7, body.velocity.z + push.z * 0.7);
    body.angularVelocity.set(
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 15
    );

    this.physicsWorld.addBody(body);

    const debrisObj = {
      mesh,
      body,
      life: 8.0 + Math.random() * 4.0 // 8-12 saniye sonra temizlenir
    };

    this.dynamicDebris.push(debrisObj);
  }

  // Yıkım Yüzdesi
  getDestructionPercentage() {
    if (this.totalInitialVoxels === 0) return 0;
    return Math.min(100, Math.round((this.destroyedVoxels / this.totalInitialVoxels) * 100));
  }

  // Döngü Güncellemesi
  update(dt) {
    this.terrain.flush();
    this.collapse.update(dt);
    for (let i = this.dynamicDebris.length - 1; i >= 0; i--) {
      const d = this.dynamicDebris[i];
      d.life -= dt;

      // Sağlam üst katmanın üstünde dur (fizik yalnız taban kayasını bilir; çukurlara serbestçe düşer)
      const b = d.body;
      const ty = this.terrain.topYAt(b.position.x, b.position.z);
      if (this.terrain.topIntactAt(b.position.x, b.position.z) &&
          b.position.y - VOXEL_SIZE / 2 < ty && b.position.y > ty - 0.5) {
        b.position.y = ty + VOXEL_SIZE / 2;
        if (b.velocity.y < 0) b.velocity.y *= -0.25;
        b.velocity.x *= 0.85;
        b.velocity.z *= 0.85;
      }

      // Su fiziği: suya düşen parça sıçratır, yavaşlar ve yüzeyde bobinler (batmaz)
      if (b.position.y < -0.15 && this.terrain.heightAt(b.position.x, b.position.z) === -Infinity) {
        if (!d.inWater) {
          d.inWater = true;
          if (this.particleSystem.createSplash) this.particleSystem.createSplash(new THREE.Vector3(b.position.x, -0.15, b.position.z), 0.5);
        }
        b.velocity.scale(Math.pow(0.04, dt), b.velocity);
        b.velocity.y += (-0.15 - b.position.y + 0.1) * 60 * dt;
        b.angularVelocity.scale(Math.pow(0.1, dt), b.angularVelocity);
      }

      // Pozisyon ve rotasyonu Cannon fiziğiyle eşitle
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);

      // Yerin altına düştüyse veya süresi bittiyse sil
      if (d.life <= 0 || d.body.position.y < -5) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        this.physicsWorld.removeBody(d.body);
        this.dynamicDebris.splice(i, 1);
      }
    }
  }

  // Tüm Dünyayı Temizle
  clear() {
    this.voxels.clear();
    this._disposeChunkMeshes();
    this.terrain.clear();
    this.collapse.clear();

    // Uçuşan döküntüleri sil
    this.dynamicDebris.forEach(d => {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      this.physicsWorld.removeBody(d.body);
    });
    this.dynamicDebris = [];
    this.totalInitialVoxels = 0;
    this.destroyedVoxels = 0;
  }
}
