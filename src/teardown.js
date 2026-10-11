import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';

export const VOXEL_SIZE = 0.35; // Teardown tarzı minik küp boyutu

// Teardown Tarzı Mikro-Voxel Renk Paleti
export const PALETTE = {
  CONCRETE: { id: 0, color: 0x94a3b8, name: 'Beton', canBreakWithHammer: true },
  BRICK:    { id: 1, color: 0xb91c1c, name: 'Tuğla', canBreakWithHammer: true },
  WOOD:     { id: 2, color: 0x854d0e, name: 'Tahta', canBreakWithHammer: true, isWood: true },
  IRON:     { id: 3, color: 0x64748b, name: 'Demir', canBreakWithHammer: false, isIron: true },
  GLASS:    { id: 4, color: 0x38bdf8, name: 'Cam', canBreakWithHammer: true },
  ROOF:     { id: 5, color: 0x7c2d12, name: 'Çatı', canBreakWithHammer: true },
  TNT:      { id: 6, color: 0xef4444, name: 'TNT', isTNT: true, canBreakWithHammer: true },
  GOLD:     { id: 7, color: 0xfacc15, name: 'Altın', canBreakWithHammer: true }
};
PALETTE.STEEL = PALETTE.IRON; // Geriye dönük uyumluluk (Çelik = Demir)

// Maddelere Göre Çekiç Dayanıklılığı
export const MATERIAL_HARDNESS = {
  [PALETTE.WOOD.id]: 0.5,     // 1. Madde: Tahta - çekiçle kolayca kırılır
  [PALETTE.GLASS.id]: 0.3,    // Cam
  [PALETTE.BRICK.id]: 1.2,    // Tuğla
  [PALETTE.CONCRETE.id]: 1.6, // Beton
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
    this.instancedMeshes = {};
    this.instanceMatrices = {};
    this.instanceCountByType = {};
    this.maxInstancesPerType = 12000;

    // Dinamik Fırlayan Fizik Parçacık Küpleri (Teardown döküntüleri)
    this.dynamicDebris = [];
    this.maxDynamicDebris = 350; // Performansı korumak için sınır

    this.cubeGeo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    this.cubeShape = new CANNON.Box(new CANNON.Vec3(VOXEL_SIZE / 2, VOXEL_SIZE / 2, VOXEL_SIZE / 2));

    this.initInstancedMeshes();
  }

  initInstancedMeshes() {
    Object.values(PALETTE).forEach(matDef => {
      const mat = new THREE.MeshLambertMaterial({
        color: matDef.color,
        transparent: matDef.id === PALETTE.GLASS.id,
        opacity: matDef.id === PALETTE.GLASS.id ? 0.7 : 1.0
      });

      const instancedMesh = new THREE.InstancedMesh(this.cubeGeo, mat, this.maxInstancesPerType);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instancedMesh.count = 0;

      this.scene.add(instancedMesh);
      this.instancedMeshes[matDef.id] = instancedMesh;
      this.instanceCountByType[matDef.id] = 0;
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
  fillBox(minX, minY, minZ, maxX, maxY, maxZ, matType) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.setVoxel(x, y, z, matType);
        }
      }
    }
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

  // Seviye oluşturulduğunda GPU InstancedMesh'leri hazırlar
  buildMeshBuffers() {
    // Sayaçları sıfırla
    Object.keys(this.instanceCountByType).forEach(k => {
      this.instanceCountByType[k] = 0;
    });

    const dummy = new THREE.Object3D();

    for (const [key, v] of this.voxels.entries()) {
      const typeId = v.type.id;
      const mesh = this.instancedMeshes[typeId];
      const count = this.instanceCountByType[typeId];

      if (count < this.maxInstancesPerType) {
        dummy.position.set(v.x, v.y, v.z);
        dummy.updateMatrix();

        mesh.setMatrixAt(count, dummy.matrix);
        v.instanceIdx = count;
        this.instanceCountByType[typeId]++;
      }
    }

    // Her InstancedMesh'in count değerini güncelle ve GPU'ya yükle
    Object.entries(this.instancedMeshes).forEach(([typeId, mesh]) => {
      mesh.count = this.instanceCountByType[typeId];
      mesh.instanceMatrix.needsUpdate = true;
    });

    this.totalInitialVoxels = this.voxels.size;
    this.destroyedVoxels = 0;
  }

  // TEARDOWN PATLAMA & OYUK AÇMA MOTORU (Hole Carving & Destruction)
  explode(blastPos, blastRadius, force) {
    const r2 = blastRadius * blastRadius;
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0); // Görünmez yapmak için boyutu sıfırla
    dummy.updateMatrix();

    let removedCount = 0;
    const tntChainPositions = [];

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
            v.active = false;
            removedCount++;

            // InstancedMesh'ten kaldır (Görünmez yap)
            if (v.instanceIdx !== -1) {
              const mesh = this.instancedMeshes[v.type.id];
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

    this.destroyedVoxels += removedCount;

    // Skor ve ses
    if (removedCount > 0 && this.onScoreGain) {
      const score = removedCount * 12;
      this.onScoreGain(score, `+${score} VOXEL PARÇALANDI!`);
    }

    // Zincirleme TNT patlamalarını tetikle
    if (tntChainPositions.length > 0) {
      tntChainPositions.forEach((pos, idx) => {
        setTimeout(() => {
          sound.playTNTExplosion();
          this.particleSystem.createExplosion(pos, 8, 0xef4444);
          this.explode(pos, 5.0, 320);
        }, 100 + idx * 60 + Math.random() * 80);
      });
    }

    return removedCount;
  }

  // TEARDOWN ÇEKİÇ VURUŞU (Maddesine göre az hasar veren darbe)
  hammerHit(hitPoint, hammerPower = 1.0) {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();

    // Çekiç vuruşu dar bir alana vurur (~0.65m)
    const hitRadius = VOXEL_SIZE * 1.9;
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
    const maxBreak = Math.max(1, Math.round((5 * hammerPower) / hardness));

    for (let i = 0; i < Math.min(candidates.length, maxBreak); i++) {
      const v = candidates[i].v;
      v.active = false;
      removedCount++;

      if (v.instanceIdx !== -1) {
        const mesh = this.instancedMeshes[v.type.id];
        mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }

      // Minik döküntü fırlat
      if (this.dynamicDebris.length < this.maxDynamicDebris) {
        this.spawnLooseVoxel(v.x, v.y, v.z, v.type, hitPoint, Math.sqrt(candidates[i].distSq), hitRadius, 25);
      }
    }

    this.destroyedVoxels += removedCount;

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
      const score = removedCount * 10;
      this.onScoreGain(score, `+${score} ÇEKİÇ (${hitMaterial.name})`);
    }

    return { success: true, removedCount, material: hitMaterial };
  }

  // Uçuşan ve Seken Minik Fizik Küpü Oluştur (Teardown parçacığı)
  spawnLooseVoxel(x, y, z, matType, blastCenter, dist, blastRadius, blastForce) {
    // Görsel Küp
    const mat = new THREE.MeshLambertMaterial({ color: matType.color });
    const mesh = new THREE.Mesh(this.cubeGeo, mat);
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
    for (let i = this.dynamicDebris.length - 1; i >= 0; i--) {
      const d = this.dynamicDebris[i];
      d.life -= dt;

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

    // InstancedMesh'leri sıfırla
    Object.values(this.instancedMeshes).forEach(mesh => {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
    });

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
