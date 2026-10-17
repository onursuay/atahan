import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// YAPISAL ÇÖKME
//  1) Voxel kaldırılınca komşuları "tohum" olarak sıraya alınır; zemine bağlı olmayan küp toplulukları düşen parça olur.
//  2) Düşen parça: önce gıcırdar ve kenarlarından döküntü saçar (büyükse), sonra düşer. Zemine ilk değen noktalar
//     ağırlık merkezini taşıyamıyorsa (yokuş, kısmi destek) parça o kenar etrafında DEVRİLİR; dönerek yere çarpınca,
//     eğik çarptığı için, hıza göre iyice parçalanır. Düz oturan parçada yalnız temas eden alt kısım hasar alır.
//  3) Zemine bağlı ama kalan tabanı ağırlık merkezini taşımayan yapı (alt kısmı yıkılmış bina) da yavaşça devrilir.
//  4) Suya düşen parça yavaşça batar ve yok olur.
// ─────────────────────────────────────────────────────────────────────────────
const S = VOXEL_SIZE;
const MAX_COMPONENT = 120000;  // dev şirket binaları da tamamen analiz edilsin
const BUDGET_MS = 7;           // kare başına bağlantı kontrolü süresi
const MAX_CHUNKS = 12;
const GRAVITY = 22;
const TIP_G = 11.5;            // devrilme ivmesi: bina pes ettiğinde güçlüce devrilsin
const WATER_Y = -0.15;         // deniz yüzeyi (main.js waterMesh.position.y ile aynı)
const SINK_SPEED = 0.7;        // suda batma hızı (m/sn)
const STAB_CAP = 150000;       // devrilme kontrolünde gezilecek en çok küp (şirket kuleleri dahil)
const TIP_RELEASE = 0.95;      // menteşe parçası bu açıya (rad) gelince kopar
const key = (x, y, z) => `${x},${y},${z}`;
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]; // önce aşağı
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Dışbükey zarf (monotone chain): [[x,z], ...] → saat yönünün tersi köşe listesi
function hull2(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
// Noktanın zarfa en yakın noktası ve içeride olup olmadığı: { inside, qx, qz, dist }
function nearestOnHull(h, px, pz) {
  if (h.length === 0) return null;
  if (h.length === 1) return { inside: false, qx: h[0][0], qz: h[0][1], dist: Math.hypot(px - h[0][0], pz - h[0][1]) };
  let inside = h.length >= 3, best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], len2 = ex * ex + ez * ez || 1e-9;
    if (h.length >= 3 && ex * (pz - a[1]) - ez * (px - a[0]) < 0) inside = false;
    const t = clamp(((px - a[0]) * ex + (pz - a[1]) * ez) / len2, 0, 1);
    const qx = a[0] + ex * t, qz = a[1] + ez * t, d = Math.hypot(px - qx, pz - qz);
    if (!best || d < best.dist) best = { qx, qz, dist: d };
  }
  return { inside, qx: best.qx, qz: best.qz, dist: inside ? 0 : best.dist };
}

export class CollapseSystem {
  constructor(voxelWorld) {
    this.vw = voxelWorld;
    this.seeds = new Set();
    this.ok = new Set(); // zemine bağlı bulunan küpler (tohum kuyruğu bitene kadar saklanır)
    this.chunks = [];
    this.onShake = null;
    this.time = 0;
    this.dirty = new Map();   // bölge → { n, baseN, t, ix, iy, iz }: devrilme kontrolü için hasar sayacı
    this.cool = new Map();
    this.stab = null;         // sürmekte olan devrilme kontrolü
    this.recentBreaks = [];   // son kırılan ALT küpler: { x, y, z, t } — alt kısmın çok parçalanan tarafını bulmak için
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
  }

  // Kaldırılan voxelin komşularını kontrol sırasına ekle
  queue(v) {
    if (this.seeds.size < 600000) for (const [dx, dy, dz] of DIRS) this.seeds.add(key(v.ix + dx, v.iy + dy, v.iz + dz));
    // ÖNEMLİ: Binanın üst kısımlarına ateş edildiğinde devrilme kontrolü tetiklenmesin!
    // Yalnızca binanın ALT kısmı (zemine yakın katmanlar, şirket binalarının alt katları dahil y <= 9.0 m) kırıldığında devrilme hesabı yapılır.
    const hGround = this.vw.terrain.heightAt(v.x, v.z);
    const relY = hGround > -Infinity ? (v.y - hGround) : v.y;
    if (relY <= 9.0) {
      const bk = `${v.ix >> 4},${v.iz >> 4}`;
      let d = this.dirty.get(bk);
      if (!d) { d = { n: 0, baseN: 0, t: 0, ix: v.ix, iy: v.iy, iz: v.iz }; this.dirty.set(bk, d); }
      d.n++; d.baseN++; d.t = this.time; d.ix = v.ix; d.iy = v.iy; d.iz = v.iz;
      this.recentBreaks.push({ x: v.x, y: v.y, z: v.z, t: this.time });
      if (this.recentBreaks.length > 50000) this.recentBreaks.splice(0, 15000);
    }
    if (this.vw.bridge) this.vw.bridge.onVoxelRemoved(v);
  }

  // Voxel zemine (arazi üst/alt katmanı) oturuyor mu?
  _grounded(v) {
    if (v.groundCell !== undefined) return true;
    const t = this.vw.terrain;
    if (v.y - S / 2 <= -1.0) return true; // deniz tabanına inen kazık/ayak
    const h = t.heightAt(v.x, v.z);
    return h > -Infinity && v.y - S / 2 <= h + 1e-3;
  }

  update(dt) {
    this.time += dt;
    if (this.recentBreaks.length && this.time - this.recentBreaks[0].t > 20) {
      let cut = 0;
      while (cut < this.recentBreaks.length && this.time - this.recentBreaks[cut].t > 20) cut++;
      if (cut > 0) this.recentBreaks.splice(0, cut);
    }
    this._processSeeds();
    this._stabilityTick();
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this._stepChunk(this.chunks[i], dt)) this.chunks.splice(i, 1);
    }
  }

  _processSeeds() {
    if (this.seeds.size === 0) { this.ok.clear(); return; }
    const t0 = performance.now();
    const ok = this.ok;
    for (const k of this.seeds) {
      if (this.chunks.length >= MAX_CHUNKS) break;   // sıra dolu: tohumlar bekler (havada asılı kalmasın)
      this.seeds.delete(k);
      if (ok.has(k)) continue;
      const v = this.vw.voxels.get(k);
      if (!v || !v.active) continue;
      this._checkComponent(v, ok);
      if (performance.now() - t0 > BUDGET_MS) break;
    }
  }

  _checkComponent(start, ok) {
    const vox = this.vw.voxels;
    const visited = new Map();
    const stack = [start];
    visited.set(key(start.ix, start.iy, start.iz), start);
    let grounded = false;

    while (stack.length) {
      const v = stack.pop();
      if (this._grounded(v)) { grounded = true; break; }
      for (let d = DIRS.length - 1; d >= 0; d--) { // sondan başa: "aşağı" en son itilir, ilk çıkar
        const [dx, dy, dz] = DIRS[d];
        const k = key(v.ix + dx, v.iy + dy, v.iz + dz);
        if (visited.has(k)) continue;
        if (ok.has(k)) { grounded = true; break; }
        const n = vox.get(k);
        if (!n || !n.active) continue;
        visited.set(k, n);
        stack.push(n);
      }
      if (grounded || visited.size > MAX_COMPONENT) { grounded = true; break; }
    }

    if (grounded) { for (const k of visited.keys()) ok.add(k); return; }
    const list = Array.from(visited.values());
    // Yerden komple kesilen bina: önce yavaş yavaş hızlanarak DÜZ AŞAĞI düşmeye başlar!
    // Yere çarptığında alt kısmı ezilir ve sonrasında (veya alt kısmın bir yarısı çok parçalandıysa o tarafa) yavaşça devrilir.
    const asymDir = this._computeAsymmetricCutDir(list);
    this.spawnChunk(list, {
      asymDir,
      creak: list.length >= 250 ? 0.18 + 0.35 * Math.min(1, list.length / 8000) : 0
    });
  }

  // Binanın alt kısmının bir yarısı çok fazla parçalanıp diğer yarısı az parçalandıysa, çok parçalanan yönü { dx, dz, strength } döndürür
  _computeAsymmetricCutDir(list) {
    if (list.length < 60) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let sx = 0, sz = 0;
    for (const v of list) {
      sx += v.x; sz += v.z;
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ, spanY = maxY - minY;
    if (spanX < 2.0 && spanZ < 2.0) return null;

    const cx = sx / list.length, cz = sz / list.length;
    const baseCutH = minY + Math.max(2.5, Math.min(6.5, spanY * 0.38));

    // 1) Alt kısımda kalan küplerin ağırlık merkezi: çok parçalanan tarafta küp azaldığı için merkez sağlam tarafa kayar
    let lowSx = 0, lowSz = 0, lowW = 0;
    for (const v of list) {
      if (v.y <= baseCutH) {
        const w = (baseCutH - v.y + S) / (baseCutH - minY + S);
        lowSx += (v.x - cx) * w;
        lowSz += (v.z - cz) * w;
        lowW += w;
      }
    }

    // 2) Son kırılan alt küplerin dağılımı: hangi yarıda daha çok küp kırıldı?
    let dmgVecX = 0, dmgVecZ = 0, dmgCount = 0;
    const pad = 1.8;
    for (let i = this.recentBreaks.length - 1; i >= 0; i--) {
      const b = this.recentBreaks[i];
      if (b.x >= minX - pad && b.x <= maxX + pad && b.z >= minZ - pad && b.z <= maxZ + pad && b.y <= baseCutH + 2.5) {
        dmgVecX += (b.x - cx);
        dmgVecZ += (b.z - cz);
        dmgCount++;
      }
    }

    // Çok parçalanan yön = kalan alt küplerin tersi + kırılan küplerin olduğu taraf
    let dirX = 0, dirZ = 0;
    if (lowW > 0) {
      dirX -= (lowSx / lowW) * 1.8;
      dirZ -= (lowSz / lowW) * 1.8;
    }
    if (dmgCount >= 8) {
      dirX += (dmgVecX / dmgCount) * 1.35;
      dirZ += (dmgVecZ / dmgCount) * 1.35;
    }

    const dl = Math.hypot(dirX, dirZ);
    // Belirgin bir asimetri varsa (bir yarısı çok, diğer yarısı az parçalanmışsa) o yönü kaydet
    if (dl < 0.28) return null;
    return { dx: dirX / dl, dz: dirZ / dl, strength: clamp(dl / 2.0, 0.25, 1.0) };
  }

  // ── DEVRİLME KONTROLÜ: binaların ve şirket binalarının altından büyük bir kısım kırıldığında bina pes edip devrilir ──
  _stabilityTick() {
    if (this.stab) { this._stabilityStep(); return; }
    if (this.chunks.length >= MAX_CHUNKS) return;
    for (const [bk, d] of this.dirty) {
      if (this.time - d.t < 0.38) continue;           // kısa bekleme: alt kısım kırılınca gecikmeden kontrol et
      this.dirty.delete(bk);
      if (d.baseN < 14) continue;                     // tek tük ufak delikler binayı devirmez
      const cd = this.cool.get(bk);
      if (cd !== undefined && this.time - cd < 1.0) continue;
      this.cool.set(bk, this.time);
      const seed = this._findSeed(d);
      if (!seed) continue;
      const visited = new Map(); visited.set(key(seed.ix, seed.iy, seed.iz), seed);
      this.stab = {
        stack: [seed], visited,
        sx: 0, sy: 0, sz: 0,
        cols: new Map(),       // zemine değen kolonlar
        upperCols: new Map(),  // binanın üst gövdesinin izdüşümü (ix,iz → [x,z])
        lowCounts: new Map(),  // alt 0.6..4.2m bandındaki sağlam küp sayısı (ix,iz → count)
        seedX: seed.x, seedZ: seed.z
      };
      break;
    }
  }

  _findSeed(d) {
    const vox = this.vw.voxels;
    // Önce biraz yukarıda (binanın sağlam gövdesinde) tohum ara ki kırılan tabanın üstündeki kuleyi yakalasın
    for (let dy = 1; dy <= 14; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const v = vox.get(key(d.ix + dx, d.iy + dy, d.iz + dz));
          if (v && v.active && v.groundCell === undefined) return v;
        }
      }
    }
    for (let r = 1; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      const v = vox.get(key(d.ix + dx, d.iy + dy, d.iz + dz));
      if (v && v.active && v.groundCell === undefined) return v;
    }
    return null;
  }

  _stabilityStep() {
    const st = this.stab, vox = this.vw.voxels, t0 = performance.now();
    while (st.stack.length) {
      const v = st.stack.pop();
      st.sx += v.x; st.sy += v.y; st.sz += v.z;
      const ck = `${v.ix},${v.iz}`;
      const hGround = this.vw.terrain.heightAt(v.x, v.z);
      const relY = hGround > -Infinity ? (v.y - hGround) : v.y;

      if (this._grounded(v)) {
        st.cols.set(ck, [v.x, v.z, v.y - S / 2]);
      }
      if (relY >= 0.4 && relY <= 4.2) {
        st.lowCounts.set(ck, (st.lowCounts.get(ck) || 0) + 1);
      }
      if (relY > 3.2) {
        if (!st.upperCols.has(ck)) st.upperCols.set(ck, [v.x, v.z]);
      }

      for (const [dx, dy, dz] of DIRS) {
        // Zemin hizasındaki kaldırım/bahçe taşlarından yan binalara yatay yayılmasın (en fazla 22m yarıçap)
        if (Math.abs((v.ix + dx) * S - st.seedX) > 22 || Math.abs((v.iz + dz) * S - st.seedZ) > 22) continue;
        const k = key(v.ix + dx, v.iy + dy, v.iz + dz);
        if (st.visited.has(k)) continue;
        const n = vox.get(k);
        if (!n || !n.active) continue;
        if (n.groundCell !== undefined) { st.cols.set(`${n.ix},${n.iz}`, [n.x, n.z, n.y - S / 2]); continue; }
        st.visited.set(k, n);
        st.stack.push(n);
      }
      if (st.visited.size > STAB_CAP) { this.stab = null; return; }
      if (performance.now() - t0 > BUDGET_MS) return;
    }
    this.stab = null;
    const list = Array.from(st.visited.values()), n = list.length;
    if (n < 55 || this.chunks.length >= MAX_CHUNKS) return;

    const cx = st.sx / n, cy = st.sy / n, cz = st.sz / n;

    // 1) Klasik taban zarfı kontrolü + 2) Şirket binaları ve normal binalar için alt kolon kaybı kontrolü:
    //    Eğer binanın alt katmanında (0.4..4.2m) büyük bir kısım kırıldıysa, zeminde birkaç tekil blok kalsa bile
    //    bina PES EDER ve kırılan tarafa doğru devrilir / çöker!
    const activeSupportCols = [];
    for (const [ck, col] of st.cols.entries()) {
      // Kolonun gerçekten binayı taşıması için hemen üstündeki alt katmanda da küp olmalı
      if ((st.lowCounts.get(ck) || 0) >= 2) activeSupportCols.push(col);
    }
    const effectiveCols = activeSupportCols.length > 0 ? activeSupportCols : Array.from(st.cols.values());
    if (effectiveCols.length === 0) return;

    let minBy = Infinity;
    const pts = [];
    let supSx = 0, supSz = 0;
    for (const [x, z, by] of effectiveCols) {
      if (by < minBy) minBy = by;
      supSx += x; supSz += z;
      pts.push([x - S / 2, z - S / 2], [x + S / 2, z - S / 2], [x - S / 2, z + S / 2], [x + S / 2, z + S / 2]);
    }
    const supCx = supSx / effectiveCols.length, supCz = supSz / effectiveCols.length;

    const totalFootprint = Math.max(st.upperCols.size, st.cols.size, 1);
    const supportRatio = effectiveCols.length / totalFootprint;
    const asymDir = this._computeAsymmetricCutDir(list);

    // Bu binanın tabanında son 20 saniyede kaç küp kırıldı?
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (const v of list) {
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      if (v.y > maxY) maxY = v.y;
    }
    let recentBaseDmg = 0;
    for (let i = this.recentBreaks.length - 1; i >= 0; i--) {
      const b = this.recentBreaks[i];
      if (b.x >= minX - 2 && b.x <= maxX + 2 && b.z >= minZ - 2 && b.z <= maxZ + 2) recentBaseDmg++;
    }

    const h = hull2(pts);
    const r = nearestOnHull(h, cx, cz);
    const hullUnsafe = !r || !r.inside || r.dist < 0.45;
    // Alt kısmından büyük bir parça kırıldıysa (destek oranı düştüyse veya alt kısımda yoğun yıkım varsa + asimetri oluştuysa) PES ETSİN!
    const baseGaveUp = (supportRatio < 0.74 && recentBaseDmg >= 18) ||
                       (recentBaseDmg >= 34 && asymDir !== null) ||
                       (recentBaseDmg >= 55);

    if (!hullUnsafe && !baseGaveUp) return;

    // Eğer alt kısmın neredeyse tamamı (%72'den fazlası) kırıldıysa önce düz aşağı çöküp altını ezsin, sonra devrilsin
    if (supportRatio < 0.28) {
      this.spawnChunk(list, {
        asymDir,
        creak: 0.15
      });
      return;
    }

    // Kırılan tarafa doğru devrilme yönünü belirle
    let dx = 0, dz = 0;
    if (asymDir) {
      dx = asymDir.dx; dz = asymDir.dz;
    } else if (r && !r.inside) {
      dx = cx - r.qx; dz = cz - r.qz;
    } else {
      dx = cx - supCx; dz = cz - supCz;
    }
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-4) {
      dx = 1; dz = 0;
    } else {
      dx /= dl; dz /= dl;
    }

    const halfSpan = ((maxX - minX) * Math.abs(dx) + (maxZ - minZ) * Math.abs(dz)) * 0.35;
    const px = r && !r.inside ? r.qx : (cx + dx * halfSpan);
    const pz = r && !r.inside ? r.qz : (cz + dz * halfSpan);

    const chunk = this.spawnChunk(list, {
      tip: { dx, dz, px, py: isFinite(minBy) ? minBy : 0, pz },
      creak: 0
    });
    if (chunk) {
      // Bina pes ettiği anda belirgin bir başlangıç devrilme hızı alır ve gürültüyle devrilir
      chunk.omega = Math.max(chunk.omega, 0.085);
      sound.playBridgeCreak && sound.playBridgeCreak();
    }
  }

  // ── Düşen / devrilen / tutulan / fırlatılan parça ──
  // list: voxel nesneleri (dünyadan çıkarılır). opts: { creak, tip: {dx,dz,px,py,pz}, hinge: {dx,dz,px,py,pz}, asymDir, held }
  spawnChunk(list, opts = {}) {
    const vw = this.vw;
    const byType = new Map();
    list.forEach(v => {
      vw.voxels.delete(key(v.ix, v.iy, v.iz));
      vw._hideVoxel(v);                       // eski örneği gizle
      if (!byType.has(v.type.id)) byType.set(v.type.id, []);
      byType.get(v.type.id).push(v);
    });

    const dummy = new THREE.Object3D();
    const meshes = [];
    for (const [typeId, vs] of byType.entries()) {
      const mesh = new THREE.InstancedMesh(vw.cubeGeo, vw.materials[typeId], vs.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      vs.forEach((v, i) => {
        dummy.position.set(v.x, v.y, v.z); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        v.mesh = mesh; v.instanceIdx = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      vw.scene.add(mesh);
      meshes.push(mesh);
    }

    const n = list.length;
    let sx = 0, sy = 0, sz = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const colMap = new Map();
    list.forEach(v => {
      sx += v.x; sy += v.y; sz += v.z;
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      const c = `${v.ix},${v.iz}`, b = colMap.get(c);
      if (!b || v.iy < b.v.iy) colMap.set(c, { v });
    });
    // Her kolonun en alt küpü ve altındaki en yakın destek (arazi/başka küp/deniz) — düz düşüşte temas buradan bulunur
    let cols = Array.from(colMap.values());
    const stride = Math.ceil(cols.length / 1600);
    if (stride > 1) cols = cols.filter((_, i) => i % stride === 0);
    let lowBy = Infinity;
    cols = cols.map(({ v }) => {
      const by = v.iy * S;
      if (by < lowBy) lowBy = by;
      return { v, x: v.x, z: v.z, by, sup: this._support(v.ix, v.iz, v.iy, v.x, v.z) };
    });

    const c = {
      list, meshes, n, cols, lowBy,
      com: new THREE.Vector3(sx / n, sy / n, sz / n),
      ext: { minX, maxX, minY, maxY, minZ, maxZ },
      phase: opts.held ? 'held' : 'fall', t: 0, vy: 0, oy0: 0, oy1: 0, theta: 0, omega: 0,
      d: null, P: null, front: null, shedT: 0, hinge: !!opts.hinge, sinkT: 0, entered: false,
      creak: opts.creak || 0, bornT: this.time,
      asymDir: opts.asymDir || null,
      crushed: 0, crushLayers: 0,
      holdOffset: new THREE.Vector3(),
      holdQuat: new THREE.Quaternion(),
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3()
    };
    if (!opts.held) {
      if (c.creak > 0) c.phase = 'creak';
      if (opts.tip) this._beginTip(c, opts.tip, 0.004, 0);
      else if (opts.hinge) this._beginTip(c, opts.hinge, 0.002, 0);
    }
    this.chunks.push(c);
    sound.playBlockHit();
    this._pose(c);
    return c;
  }

  // Ahtapot tarafından tutulan binayı (c.phase === 'held') verilen hızla ileri fırlatır
  throwChunk(c, velocity, angVel) {
    if (!c || c.settled) return;
    c.phase = 'thrown';
    c.t = 0;
    c.vel.copy(velocity);
    if (angVel) c.angVel.copy(angVel);
    else c.angVel.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.6);
  }

  // (ix,iz) kolonunun iy yüzünün altındaki en yakın katı yüzey (üst yüzü, m); yoksa -Infinity (deniz/boşluk)
  _support(ix, iz, iy, x, z) {
    const vox = this.vw.voxels;
    let top = this.vw.terrain.heightAt(x, z);   // üst katman sağlamsa yüzü, kırıksa taban kayası; kara yoksa -Infinity
    const floor = Math.max(-8, top);
    for (let k = iy - 1; k * S + S > floor && k > -17; k--) {
      const v = vox.get(key(ix, k, iz));
      if (v && v.active) { top = Math.max(top, (k + 1) * S); break; }
    }
    return top;
  }

  // Parçanın duruşu: x' = q(x + (0,oy0,0) − P) + P + (0,oy1,0)
  _pose(c) {
    const q = this._q;
    if (c.phase === 'held' || c.phase === 'thrown') {
      const m0 = c.com;
      const v = this._v.set(-m0.x, -m0.y, -m0.z).applyQuaternion(c.holdQuat);
      c.meshes.forEach(m => {
        m.quaternion.copy(c.holdQuat);
        m.position.set(v.x + m0.x + c.holdOffset.x, v.y + m0.y + c.holdOffset.y, v.z + m0.z + c.holdOffset.z);
      });
    } else if (c.d && c.theta !== 0) {
      this._ax.set(c.d[1], 0, -c.d[0]);
      q.setFromAxisAngle(this._ax, c.theta);
      const P = c.P, v = this._v.set(-P.x, c.oy0 - P.y, -P.z).applyQuaternion(q);
      c.meshes.forEach(m => { m.quaternion.copy(q); m.position.set(v.x + P.x, v.y + P.y + c.oy1, v.z + P.z); });
    } else if (c.phase === 'creak') {
      const a = Math.sin(c.t * 23) * 0.012 * (1 - c.t / c.creak);
      q.setFromAxisAngle(this._ax.set(0.7, 0, 0.7).normalize(), a);
      const m0 = c.com, v = this._v.set(-m0.x, -m0.y, -m0.z).applyQuaternion(q);
      c.meshes.forEach(m => { m.quaternion.copy(q); m.position.set(v.x + m0.x, v.y + m0.y, v.z + m0.z); });
    } else {
      c.meshes.forEach(m => { m.quaternion.identity(); m.position.set(0, c.oy0 + c.oy1, 0); });
    }
  }

  // Duruşa göre noktanın dünya konumu (out'a yazar)
  _place(c, x, y, z, out) {
    if (c.phase === 'held' || c.phase === 'thrown') {
      const m0 = c.com;
      out.set(x - m0.x, y - m0.y, z - m0.z).applyQuaternion(c.holdQuat);
      out.x += m0.x + c.holdOffset.x;
      out.y += m0.y + c.holdOffset.y;
      out.z += m0.z + c.holdOffset.z;
    } else if (c.d && c.theta !== 0) {
      this._ax.set(c.d[1], 0, -c.d[0]);
      this._q.setFromAxisAngle(this._ax, c.theta);
      const P = c.P;
      out.set(x - P.x, y + c.oy0 - P.y, z - P.z).applyQuaternion(this._q);
      out.x += P.x; out.y += P.y + c.oy1; out.z += P.z;
    } else out.set(x, y + c.oy0 + c.oy1, z);
    return out;
  }

  // Devrilmeye başla: pivot noktası ve yönü; ağırlık merkezi / dönme eylemsizliği ve çarpışma örnekleri hazırlanır
  _beginTip(c, tip, theta0, omega0) {
    c.phase = 'tip';
    c.d = [tip.dx, tip.dz];
    c.oy0 += c.oy1; c.oy1 = 0;
    c.P = { x: tip.px, y: tip.py, z: tip.pz };
    c.theta = theta0; c.omega = omega0;
    const e = c.ext;
    const sExt = Math.abs(e.maxX - e.minX) * Math.abs(tip.dx) + Math.abs(e.maxZ - e.minZ) * Math.abs(tip.dz);
    c.Lp = sExt + S; c.Hc = e.maxY - e.minY + S;
    // Çarpışma örnekleri: pivota göre (en uzak ileri, en alçak) sınır noktaları — yanal 1 m'lik dilimlerde
    const bins = new Map();
    const P = c.P, dx = tip.dx, dz = tip.dz;
    for (const v of c.list) {
      if (!v.active) continue;
      const s = (v.x - P.x) * dx + (v.z - P.z) * dz, t = -(v.x - P.x) * dz + (v.z - P.z) * dx;
      const tb = Math.round(t), rows = bins.get(tb) || (bins.set(tb, new Map()), bins.get(tb));
      const r = rows.get(v.iy);
      if (!r || s > r.s) rows.set(v.iy, { v, s });
    }
    const front = [];
    for (const rows of bins.values()) {
      let best = -Infinity;
      for (const iy of Array.from(rows.keys()).sort((a, b) => a - b)) {
        const r = rows.get(iy);
        if (r.s > best + 1e-6) { best = r.s; front.push({ x: r.v.x, y: r.v.iy * S, z: r.v.z, s: r.s, h: r.v.iy * S + c.oy0 - P.y }); }
      }
    }
    c.front = front;
  }

  // Noktada zemin mi var yoksa başka bir binanın küpü mü?
  _checkHit(x, y, z) {
    const t = this.vw.terrain;
    const h = t.heightAt(x, z);
    if (h > -Infinity && y <= h + 0.05) return 'ground';
    const v = this.vw.voxels.get(key(Math.round(x / S), Math.floor((y - 0.02) / S), Math.round(z / S)));
    if (v && v.active) return v.groundCell !== undefined ? 'ground' : 'voxel';
    return null;
  }

  // Devrilen veya fırlatılan bina başka bir binaya çarptığında onu güçlüce yıkar ve devrilmesini tetikler!
  _smashBuildingAt(c, pt, speed) {
    const vw = this.vw;
    const minSpeed = 2.8;
    if (speed < minSpeed) return false;
    const maxCrush = Math.min(6000, Math.max(400, Math.floor(c.n * 0.65)));
    if (c.crushed >= maxCrush) return false;

    const r = clamp(1.35 + (speed - minSpeed) * 0.26, 1.35, 3.4);
    const r2 = r * r;
    const minIx = Math.floor((pt.x - r) / S), maxIx = Math.ceil((pt.x + r) / S);
    const minIy = Math.floor((pt.y - r) / S), maxIy = Math.ceil((pt.y + r) / S);
    const minIz = Math.floor((pt.z - r) / S), maxIz = Math.ceil((pt.z + r) / S);

    let broken = 0;
    const pushDir = c.d
      ? { x: c.d[0] * speed * 0.7, y: -speed * 0.3, z: c.d[1] * speed * 0.7 }
      : { x: c.vel.x * 0.6, y: c.vel.y * 0.4, z: c.vel.z * 0.6 };

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const v = vw.voxels.get(key(ix, iy, iz));
          if (!v || !v.active || v.groundCell !== undefined) continue;
          const dx = v.x - pt.x, dy = v.y - pt.y, dz = v.z - pt.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          vw._kill(v);
          vw._hideVoxel(v);
          this.queue(v); // çarptığı binanın da dengesini bozup yıkılmasını tetikle!
          broken++;
          if (vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.28) {
            vw.spawnLooseVoxel(v.x, v.y, v.z, v.type, pt, 0.4, r, 18 + speed * 2, pushDir);
          }
        }
      }
    }

    if (broken > 0) {
      c.crushed += broken;
      this._shed(c, Math.min(7, Math.ceil(broken * 0.1)));
      if (vw.particleSystem.createDust && Math.random() < 0.5) {
        vw.particleSystem.createDust(pt.clone());
      }
      if (Math.random() < 0.3) sound.playBlockHit();
      const slow = clamp(1 - (broken / maxCrush) * 0.25, 0.78, 0.98);
      c.omega *= slow;
      c.vy *= slow;
      return c.crushed < maxCrush;
    }
    return false;
  }

  // true dönerse parça artık yok (yerine oturdu, battı ya da dağıldı)
  _stepChunk(c, dt) {
    c.t += dt;
    if (c.phase === 'held') {
      this._pose(c);
      return false;
    }
    if (c.phase === 'thrown') {
      return this._stepThrown(c, dt);
    }
    if (c.phase === 'creak') {
      c.shedT -= dt;
      if (c.shedT <= 0 && c.cols.length) { c.shedT = 0.09; this._shed(c, 3); }
      this._pose(c);
      if (c.t >= c.creak) { c.phase = 'fall'; c.vy = 0.2; this._pose(c); }
      return false;
    }
    if (c.phase === 'sink') return this._stepSink(c, dt);
    if (c.phase === 'tip') return this._stepTip(c, dt);
    return this._stepFall(c, dt);
  }

  // Ahtapot koluyla sökülüp fırlatılan binanın havada uçup çarptığı binaları yıkması ve yere çakılması
  _stepThrown(c, dt) {
    c.vel.y = Math.max(-42, c.vel.y - GRAVITY * 0.85 * dt);
    c.holdOffset.addScaledVector(c.vel, dt);

    const wLen = c.angVel.length();
    if (wLen > 1e-4) {
      const dq = this._q.setFromAxisAngle(this._ax.copy(c.angVel).divideScalar(wLen), wLen * dt);
      c.holdQuat.premultiply(dq).normalize();
    }

    const speed = c.vel.length();
    const p = new THREE.Vector3();
    const stride = Math.max(1, Math.floor(c.list.length / 180));

    for (let i = 0; i < c.list.length; i += stride) {
      const v = c.list[i];
      if (!v.active) continue;
      this._place(c, v.x, v.y, v.z, p);
      if (p.y <= WATER_Y && !this.vw.terrain.isLand(p.x, p.z)) {
        this._pose(c);
        this._enterWater(c);
        return false;
      }
      const hit = this._checkHit(p.x, p.y, p.z);
      if (hit === 'voxel') {
        if (this._smashBuildingAt(c, p, Math.max(speed, 12))) {
          c.vel.multiplyScalar(0.92);
          continue;
        }
        this._pose(c);
        this._settle(c, Math.max(speed, 14), 0.95, p.clone());
        return true;
      }
      if (hit === 'ground' && c.t > 0.12) {
        this._pose(c);
        this._settle(c, Math.max(speed, 16), 0.95, p.clone());
        return true;
      }
    }

    this._pose(c);
    return false;
  }

  // Parçanın kenarından birkaç küp koparıp döküntü yap
  _shed(c, k) {
    const vw = this.vw;
    for (let i = 0; i < k; i++) {
      const b = c.cols[Math.floor(Math.random() * c.cols.length)];
      const v = b.v;
      if (!v.active) continue;
      v.active = false; vw._hideVoxel(v); vw.destroyedVoxels++;
      if (vw.dynamicDebris.length < vw.maxDynamicDebris) {
        const p = this._place(c, v.x, v.y, v.z, new THREE.Vector3());
        vw.spawnLooseVoxel(p.x, p.y, p.z, v.type, { x: c.com.x, y: p.y - 0.8, z: c.com.z }, 1, 3, 12);
      }
    }
    if (vw.particleSystem.createDust && c.cols.length) {
      const b = c.cols[Math.floor(Math.random() * c.cols.length)];
      vw.particleSystem.createDust(new THREE.Vector3(b.x, b.by + c.oy0 + c.oy1, b.z));
    }
  }

  // Düşen binanın yere çarptığında SADECE en alt katmanını ezmesi (üst gövdeye hiç hasar vermez!)
  _crushBottomLayer(c) {
    const vw = this.vw;
    // Mevcut aktif küplerin en alt y seviyesini bul
    let minIy = Infinity;
    for (const u of c.list) {
      if (u.active && u.iy < minIy) minIy = u.iy;
    }
    if (minIy === Infinity) return 0;

    let broken = 0, debris = 0;
    for (const u of c.list) {
      if (!u.active) continue;
      // Yalnızca yere çarpan en alt 1 katman (minIy) kırılır; üst kısım sağlam kalır
      if (u.iy <= minIy) {
        u.active = false;
        vw._hideVoxel(u);
        broken++;
        if (debris < 28 && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.45) {
          debris++;
          const wx = u.x, wy = u.y + c.oy0 + c.oy1, wz = u.z;
          vw.spawnLooseVoxel(wx, wy, wz, u.type, { x: c.com.x, y: wy, z: c.com.z }, 0.6, 3, 16 + c.vy);
        }
      }
    }
    vw.destroyedVoxels += broken;

    // Alt katman kırıldığı için kolonların alt sınırını (by) 1 katman (S) yukarı güncelle
    c.lowBy += S;
    for (const b of c.cols) {
      if (b.by <= minIy * S + 1e-3) b.by = (minIy + 1) * S;
    }
    if (vw.particleSystem.createDust && c.cols.length) {
      for (let i = 0; i < 2; i++) {
        const b = c.cols[Math.floor(Math.random() * c.cols.length)];
        vw.particleSystem.createDust(new THREE.Vector3(b.x, b.sup + 0.2, b.z));
      }
    }
    sound.playBlockHit();
    if (this.onShake) this.onShake(Math.min(0.35, 0.06 + c.vy / 80));
    return broken;
  }

  _stepFall(c, dt) {
    // Yavaş yavaş hızlanarak aşağı düşer
    c.vy = Math.min(36, c.vy + GRAVITY * 0.65 * dt);
    const drop = c.vy * dt;
    if (c.theta === 0) {
      // Düz düşüş: kolon başına destekle aradaki boşluk
      let minGap = Infinity;
      for (const b of c.cols) { const g = b.by + c.oy0 + c.oy1 - b.sup; if (g < minGap) minGap = g; }
      if (minGap < Infinity && minGap - drop <= 0) {
        c.oy1 -= Math.max(0, minGap);
        this._pose(c);
        return this._contact(c);
      }
      // Hepsi denizin üstünde: alt yüz suya değince batmaya başla
      if (minGap === Infinity && c.lowBy + c.oy0 + c.oy1 - drop <= WATER_Y) { this._enterWater(c); return false; }
      c.oy1 -= drop;
    } else {
      // Eğik düşen parça: örnek noktaları serbest uzayda ara adımlarla ilerler
      const steps = Math.max(1, Math.ceil(drop / 0.2)), per = drop / steps, p = new THREE.Vector3();
      for (let i = 0; i < steps; i++) {
        c.oy1 -= per;
        if (c.omega > 0) c.theta = Math.min(1.5, c.theta + c.omega * (dt / steps));
        for (const f of c.front) {
          this._place(c, f.x, f.y, f.z, p);
          if (p.y <= WATER_Y && !this.vw.terrain.isLand(p.x, p.z)) { this._enterWater(c); this._pose(c); return false; }
          const hit = this._checkHit(p.x, p.y, p.z);
          if (hit === 'voxel') {
            const vImpact = Math.hypot(c.vy, c.omega * Math.hypot(f.s, f.h));
            if (this._smashBuildingAt(c, p, vImpact)) continue;
            this._pose(c); this._settle(c, vImpact, c.theta, p.clone()); return true;
          }
          if (hit === 'ground') {
            const vImpact = Math.hypot(c.vy, c.omega * Math.hypot(f.s, f.h));
            this._pose(c); this._settle(c, Math.max(vImpact, 8), Math.max(c.theta, 0.45), p.clone()); return true;
          }
        }
      }
    }
    this._pose(c);
    return false;
  }

  // Düz düşen bina yere değdiğinde:
  // 1) Hızlı çarparsa binanın tamamı hasar görmez! Sadece yere çarpan ALT TARAFI katman katman yıkılır ve bina yavaşlar.
  // 2) Yavaşladığında alt tarafın yıkılması durur; ardından bina yavaşça bir yöne (alt kısmın bir yarısı çok kırıldıysa o tarafa,
  //    yüksek bir binaysa sağa/sola/ileriye/arkaya) devrilmeye başlar!
  _contact(c) {
    const impact = c.vy;
    const heightSpan = c.ext.maxY - c.ext.minY;

    // Bina belli bir hızın üzerindeyse (yüksekten düştüyse) yere çarptığında alt katmanı ezilir ve hızı azalır (frenler)
    const maxCrushLayers = Math.max(1, Math.min(8, Math.floor((heightSpan / S) * 0.25)));
    if (c.vy > 3.8 && c.crushLayers < maxCrushLayers) {
      const broken = this._crushBottomLayer(c);
      c.crushLayers++;
      // Her katman ezildiğinde düşüş hızı (vy) azalır; yavaşladığında ezilmeyi bırakır
      c.vy = Math.max(1.8, c.vy * 0.62 - 1.1);
      if (broken > 0 && c.vy > 3.8 && c.crushLayers < maxCrushLayers) {
        return false; // bir sonraki alt katman zemine inip yavaşlayana kadar düşmeye devam etsin
      }
    }

    // Şimdi yavaşladı: alt tarafın yıkılması bitti. Destek durumuna ve bina yüksekliğine bakalım:
    const lowGap = Math.min(...c.cols.map(b => b.by + c.oy0 + c.oy1 - b.sup));
    const pts = [];
    let py = Infinity;
    for (const b of c.cols) {
      if (b.by + c.oy0 + c.oy1 - b.sup > lowGap + 0.08) continue;
      pts.push([b.x - S / 2, b.z - S / 2], [b.x + S / 2, b.z - S / 2], [b.x - S / 2, b.z + S / 2], [b.x + S / 2, z_b(b) + S / 2]);
      py = Math.min(py, b.by + c.oy0 + c.oy1);
    }
    function z_b(b) { return b.z; }

    // A) Alt kısmın bir yarısı çok fazla kırılmışsa (asimetrik kesim) VEYA kalan destek ağırlık merkezini taşımıyorsa → çok kırılan tarafa devrilir!
    const h = hull2(pts), r = nearestOnHull(h, c.com.x, c.com.z);
    if (r && (!r.inside && r.dist >= 0.3)) {
      let dx = c.com.x - r.qx, dz = c.com.z - r.qz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      this._beginTip(c, { dx, dz, px: r.qx, py, pz: r.qz }, 0.005, 0.04);
      return false;
    }
    if (c.asymDir) {
      const { dx, dz } = c.asymDir;
      const halfSpan = ((c.ext.maxX - c.ext.minX) * Math.abs(dx) + (c.ext.maxZ - c.ext.minZ) * Math.abs(dz)) * 0.35;
      const px = c.com.x + dx * halfSpan, pz = c.com.z + dz * halfSpan;
      this._beginTip(c, { dx, dz, px, py: isFinite(py) ? py : c.lowBy + c.oy0 + c.oy1, pz }, 0.006, 0.05);
      return false;
    }

    // B) Yüksek bir bina (ör. şirket binası / kule) komple yerden kesilip düştüyse, alt kısmı yıkılıp yavaşladıktan sonra
    //    sağa, sola, ileriye veya arkaya doğru yavaşça devrilmeye başlar!
    if (heightSpan >= 6.0 && c.n >= 120 && (c.crushLayers > 0 || impact >= 4.0)) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [dx, dz] = dirs[Math.floor(Math.random() * dirs.length)];
      const halfSpan = ((c.ext.maxX - c.ext.minX) * Math.abs(dx) + (c.ext.maxZ - c.ext.minZ) * Math.abs(dz)) * 0.38;
      const px = c.com.x + dx * halfSpan, pz = c.com.z + dz * halfSpan;
      this._beginTip(c, { dx, dz, px, py: isFinite(py) ? py : c.lowBy + c.oy0 + c.oy1, pz }, 0.005, 0.03);
      return false;
    }

    // Küçük parça veya alçak düşüş: üst kısım hiç hasar almadan olduğu gibi yerine oturur
    this._settle(c, impact, 0, null);
    return true;
  }

  _stepTip(c, dt) {
    // Devrilme dinamiği: bina yavaşça eğilmeye başlar, açı büyüdükçe yerçekimi momentiyle hızlanıp yere çakılır
    const P = c.P, dx = c.d[0], dz = c.d[1];
    const rs = (c.com.x - P.x) * dx + (c.com.z - P.z) * dz, ry = Math.max(1.5, c.com.y + c.oy0 - P.y);
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / sub;
    const p = new THREE.Vector3();
    for (let i = 0; i < sub; i++) {
      const cs = Math.cos(c.theta), sn = Math.sin(c.theta);
      // Başlangıçta da hafif bir moment olsun ki bina takılmadan yavaşça devrilmeye başlasın, devrildikçe hızlansın
      const sCom = Math.max(0.45, rs * cs + ry * sn);
      const k2 = (c.Lp * c.Lp + c.Hc * c.Hc) / 12;
      c.omega += (TIP_G * sCom / (k2 + rs * rs + ry * ry)) * h;
      c.omega *= 1 - 0.04 * h;
      c.theta += c.omega * h;
      // temas: ileri-alçak sınır noktaları araziye / başka küplere / suya değdi mi
      for (const f of c.front) {
        if (f.s < 0.3) continue;                         // pivot tarafı: yükselir
        this._place(c, f.x, f.y, f.z, p);
        if (p.y <= WATER_Y && !this.vw.terrain.isLand(p.x, p.z)) {
          if (c.hinge) continue;                         // menteşeli parça suya doğru sarkar
          this._pose(c); this._enterWater(c); return false;
        }
        const hit = this._checkHit(p.x, p.y, p.z);
        if (hit === 'voxel') {
          const v = Math.abs(c.omega) * Math.hypot(f.s, f.h);
          // Önünde başka bina varsa ve belli bir hıza ulaştıysa o binayı da yıkıp devrilmeye devam eder
          if (this._smashBuildingAt(c, p, v)) continue;
          this._pose(c);
          this._settle(c, Math.max(v, 2), c.theta, p.clone());
          return true;
        }
        if (hit === 'ground') {
          // Devrilmenin ilk başında taban köşesi yere sürterse hemen durmasın, devrilmeye devam etsin
          if (c.theta < 0.42 && f.h < 3.5) continue;
          const v = Math.abs(c.omega) * Math.hypot(f.s, f.h);
          this._pose(c);
          this._settle(c, Math.max(v, 9.5), Math.max(c.theta, 0.55), p.clone());
          return true;
        }
      }
      if (c.theta >= (c.hinge ? TIP_RELEASE : 1.45)) {
        if (c.hinge) { c.phase = 'fall'; c.vy = Math.max(1.5, c.omega * 2); c.hinge = false; this._pose(c); return false; }
        this._pose(c); this._settle(c, Math.max(9.5, Math.abs(c.omega) * Math.hypot(rs, ry)), c.theta, new THREE.Vector3(c.com.x + dx * rs, P.y, c.com.z + dz * rs)); return true;
      }
    }
    // pivot kenarında ezilme: kırıntı ve toz
    c.shedT -= dt;
    if (c.shedT <= 0 && c.cols.length) { c.shedT = 0.14; this._shed(c, 1 + Math.floor(Math.min(3, c.n / 4000))); }
    this._pose(c);
    return false;
  }

  _enterWater(c) {
    c.phase = 'sink'; c.entered = true; c.vy = Math.min(c.vy, 2.5);
    const vw = this.vw;
    if (vw.particleSystem.createSplash) vw.particleSystem.createSplash(new THREE.Vector3(c.com.x, WATER_Y, c.com.z), Math.min(6, 1.5 + c.n / 700));
    sound.playSplash && sound.playSplash();
  }

  _stepSink(c, dt) {
    c.vy += (SINK_SPEED - c.vy) * Math.min(1, dt * 4);   // hızla girip yavaşça batar
    c.oy1 -= c.vy * dt;
    c.sinkT += dt;
    this._pose(c);
    // en yüksek nokta suyun en az 1.5 m altına inince (ya da 14 sn sonra) yok olur
    const e = c.ext, p = new THREE.Vector3();
    let top = -Infinity;
    for (const x of [e.minX, e.maxX]) for (const y of [e.minY, e.maxY]) for (const z of [e.minZ, e.maxZ]) top = Math.max(top, this._place(c, x, y + S, z, p).y);
    if (top < WATER_Y - 1.5 || c.com.y + c.oy0 + c.oy1 < WATER_Y - 2.2 || c.sinkT > 14) { this._dispose(c); return true; }   // üst yüz 1.5 m ya da ağırlık merkezi 2.2 m derinde
    return false;
  }

  _dispose(c) {
    c.meshes.forEach(m => { this.vw.scene.remove(m); m.dispose(); });
    c.list.forEach(v => { v.active = false; });
  }

  // Yere oturma:
  //  • Düz iniş (theta === 0): Üst gövdeye HİÇ hasar verilmez (yalnızca temas eden en alt 1 katman hafif ezilebilir).
  //  • Yan devrilerek yere çakılma (theta > 0.2): Bina devrilip yere çakıldığı için şiddetli şekilde parçalanır.
  _settle(c, v, theta, contact) {
    const vw = this.vw, p = new THREE.Vector3();
    const bottomIy = new Map();
    for (const u of c.list) { if (!u.active) continue; const k = `${u.ix},${u.iz}`, b = bottomIy.get(k); if (b === undefined || u.iy < b) bottomIy.set(k, u.iy); }

    const isTippedCrash = theta > 0.22;
    const pb = isTippedCrash ? clamp((v - 2.0) / 10, 0, 0.95) : clamp((v - 4.0) / 18, 0, 0.55);
    const lam = isTippedCrash ? (1.6 + v / 3.5) : 0.75; // düz inişte sadece en alt satır (L=0) etkilenir, üst katlara hiç çıkmaz!
    const tiltDmg = isTippedCrash ? clamp(0.62 + 0.35 * Math.sin(Math.min(theta, 1.4)) * clamp(v / 7, 0.5, 1.3), 0.65, 0.95) : 0;

    const dummy = new THREE.Object3D();
    let broken = 0, debris = 0;
    const maxDebris = isTippedCrash ? 180 : 60;
    const wipe = (u, x, y, z) => {
      u.active = false; vw._hideVoxel(u); broken++;
      if (debris < maxDebris && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.6) {
        debris++;
        vw.spawnLooseVoxel(x, y, z, u.type, { x: c.com.x, y: Math.max(0.5, y - 1), z: c.com.z }, 0.5, 4, 24 + v * 1.4);
      }
    };
    for (const u of c.list) {
      if (!u.active) continue;
      this._place(c, u.x, u.y, u.z, p);
      const L = u.iy - bottomIy.get(`${u.ix},${u.iz}`);
      // Düz inişte L >= 1 olan (alt katmanın üstündeki) hiçbir küp rastgele kırılmaz!
      let pLocal = (!isTippedCrash && L >= 1) ? 0 : pb * Math.exp(-L / lam);
      if (isTippedCrash && contact) {
        const dc = Math.hypot(p.x - contact.x, p.z - contact.z);
        pLocal = Math.min(0.98, pLocal + tiltDmg * 0.55 * Math.exp(-dc / (3 + v * 0.6)));
      }
      const pd = 1 - (1 - pLocal) * (1 - tiltDmg);
      if (Math.random() < pd) { wipe(u, p.x, p.y, p.z); continue; }
      // Yeni ızgara konumu
      const nix = Math.round(p.x / S), niz = Math.round(p.z / S);
      const niy = theta === 0 ? Math.ceil((u.iy * S + c.oy0 + c.oy1) / S - 1e-6) : Math.floor(p.y / S);
      const nk = key(nix, niy, niz);
      const th = vw.terrain.heightAt(nix * S, niz * S);
      const ex = vw.voxels.get(nk);
      if (ex && ex.active) {
        if (isTippedCrash && v >= 3.5 && ex.groundCell === undefined && c.crushed < Math.min(2000, Math.max(150, Math.floor(c.n * 0.38)))) {
          vw._kill(ex); vw._hideVoxel(ex); c.crushed++;
        }
        wipe(u, p.x, p.y, p.z);
        continue;
      }
      if ((th > -Infinity && niy * S < th - 0.2) || niy < -16) { wipe(u, p.x, p.y, p.z); continue; }   // araziye gömülü
      u.ix = nix; u.iy = niy; u.iz = niz;
      u.x = nix * S; u.y = niy * S + S / 2; u.z = niz * S;
      vw.voxels.set(nk, u);
      dummy.position.set(u.x, u.y, u.z); dummy.updateMatrix();
      u.mesh.setMatrixAt(u.instanceIdx, dummy.matrix);
      if (isTippedCrash) this.seeds.add(nk);
    }
    c.meshes.forEach(m => { m.quaternion.identity(); m.position.set(0, 0, 0); m.instanceMatrix.needsUpdate = true; });
    vw.destroyedVoxels += broken;

    // Toz, ses ve sarsıntı (büyüklük ve hıza göre)
    const at = contact || new THREE.Vector3(c.com.x, c.lowBy + c.oy0 + c.oy1, c.com.z);
    vw.particleSystem.createExplosion(at, Math.min(11, 2.0 + c.n / 3500 + v / 7), 0x9c9484);
    if (isTippedCrash && vw.particleSystem.createDust) {
      for (let i = 0; i < 4; i++) {
        vw.particleSystem.createDust(new THREE.Vector3(
          at.x + (Math.random() - 0.5) * 6,
          at.y + Math.random() * 2,
          at.z + (Math.random() - 0.5) * 6
        ));
      }
    }
    sound.playExplosion(Math.min(2.2, 0.5 + c.n / 7500 + v / 35));
    if (this.onShake) this.onShake(Math.min(0.85, 0.08 + c.n / 13000 + v / 80));
    if (broken > 0 && vw.onScoreGain) {
      const score = Math.max(10, Math.round(broken * 6));
      vw.onScoreGain(score, `+${score} BİNA YIKILDI!`);
    }
    c.settled = true;
  }

  clear() {
    this.seeds.clear();
    this.dirty.clear(); this.cool.clear(); this.stab = null;
    this.recentBreaks = [];
    this.chunks.forEach(c => this._dispose(c));
    this.chunks = [];
    this.time = 0;
  }
}
