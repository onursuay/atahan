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
const MAX_COMPONENT = 65000;   // şirket binaları dahil yapısal bağlantı sınırı
const BUDGET_MS = 4.5;         // kare başına bağlantı kontrolü bütçesi (akıcı FPS için)
const MAX_CHUNKS = 8;
const GRAVITY = 19.6;
const TIP_G = 9.2;             // Teardown tarzı doğal devrilme ivmesi
const WATER_Y = -0.15;         // deniz yüzeyi (main.js waterMesh.position.y ile aynı)
const SINK_SPEED = 0.7;        // suda batma hızı (m/sn)
const STAB_CAP = 75000;        // devrilme kontrolünde gezilecek en çok küp
const TIP_RELEASE = 0.95;      // menteşe parçası bu açıya (rad) gelince kopar
const key = (x, y, z) => `${x},${y},${z}`;
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]; // önce aşağı
// Dönerek oturan parçada yuvarlama boşluklarını doldurmak için en yakın komşu ofsetleri
const SETTLE_OFFSETS = [
  [0, 0, 0],
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1]
];
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
    this.recentBreaks = [];   // son kırılan ALT küpler: { x, y, z, t }
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
  }

  // Kaldırılan voxelin komşularını kontrol sırasına ekle
  queue(v) {
    if (this.seeds.size < 250000) for (const [dx, dy, dz] of DIRS) this.seeds.add(key(v.ix + dx, v.iy + dy, v.iz + dz));
    // Teardown tarzı: Yalnızca binanın alt taşıyıcı kısmı (y <= 6.5 m) kırıldığında ağırlık merkezi / devrilme kontrolü yapılır
    const hGround = this.vw.terrain.heightAt(v.x, v.z);
    const relY = hGround > -Infinity ? (v.y - hGround) : v.y;
    if (relY <= 6.5) {
      const bk = `${v.ix >> 4},${v.iz >> 4}`;
      let d = this.dirty.get(bk);
      if (!d) { d = { n: 0, baseN: 0, t: 0, ix: v.ix, iy: v.iy, iz: v.iz }; this.dirty.set(bk, d); }
      d.n++; d.baseN++; d.t = this.time; d.ix = v.ix; d.iy = v.iy; d.iz = v.iz;
      this.recentBreaks.push({ x: v.x, y: v.y, z: v.z, t: this.time });
      if (this.recentBreaks.length > 25000) this.recentBreaks.splice(0, 10000);
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
    if (this.recentBreaks.length && this.time - this.recentBreaks[0].t > 18) {
      let cut = 0;
      while (cut < this.recentBreaks.length && this.time - this.recentBreaks[cut].t > 18) cut++;
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
      if (this.chunks.length >= MAX_CHUNKS) break;
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
    const asymDir = this._computeAsymmetricCutDir(list);
    this.spawnChunk(list, {
      asymDir,
      creak: list.length >= 300 ? 0.14 + 0.25 * Math.min(1, list.length / 8000) : 0
    });
  }

  // Binanın alt kısmının bir yarısı çok fazla parçalanıp diğer yarısı az parçalandıysa, çok parçalanan yönü döndürür
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
    const baseCutH = minY + Math.max(2.2, Math.min(5.5, spanY * 0.35));

    let lowSx = 0, lowSz = 0, lowW = 0;
    for (const v of list) {
      if (v.y <= baseCutH) {
        const w = (baseCutH - v.y + S) / (baseCutH - minY + S);
        lowSx += (v.x - cx) * w;
        lowSz += (v.z - cz) * w;
        lowW += w;
      }
    }

    let dmgVecX = 0, dmgVecZ = 0, dmgCount = 0;
    const pad = 1.5;
    for (let i = this.recentBreaks.length - 1; i >= 0; i--) {
      const b = this.recentBreaks[i];
      if (b.x >= minX - pad && b.x <= maxX + pad && b.z >= minZ - pad && b.z <= maxZ + pad && b.y <= baseCutH + 2.0) {
        dmgVecX += (b.x - cx);
        dmgVecZ += (b.z - cz);
        dmgCount++;
      }
    }

    let dirX = 0, dirZ = 0;
    if (lowW > 0) {
      dirX -= (lowSx / lowW) * 1.6;
      dirZ -= (lowSz / lowW) * 1.6;
    }
    if (dmgCount >= 10) {
      dirX += (dmgVecX / dmgCount) * 1.1;
      dirZ += (dmgVecZ / dmgCount) * 1.1;
    }

    const dl = Math.hypot(dirX, dirZ);
    if (dl < 0.35) return null;
    return { dx: dirX / dl, dz: dirZ / dl, strength: clamp(dl / 2.2, 0.2, 1.0) };
  }

  // ── TEARDOWN TARZI DEVRİLME KONTROLÜ: Kalan taban kolonlarının zarfı ağırlık merkezini taşımıyorsa bina o yöne devrilir ──
  _stabilityTick() {
    if (this.stab) { this._stabilityStep(); return; }
    if (this.chunks.length >= MAX_CHUNKS) return;
    for (const [bk, d] of this.dirty) {
      if (this.time - d.t < 0.45) continue;
      this.dirty.delete(bk);
      if (d.baseN < 18) continue;                     // küçük delikler binayı devirmez
      const cd = this.cool.get(bk);
      if (cd !== undefined && this.time - cd < 1.2) continue;
      this.cool.set(bk, this.time);
      const seed = this._findSeed(d);
      if (!seed) continue;
      const visited = new Map(); visited.set(key(seed.ix, seed.iy, seed.iz), seed);
      this.stab = {
        stack: [seed], visited,
        sx: 0, sy: 0, sz: 0,
        cols: new Map(),       // zemine değen kolonlar
        upperCols: new Map(),  // binanın üst gövde izdüşümü
        lowCounts: new Map(),  // alt taşıyıcı banttaki (0.3..3.2m) sağlam küp sayısı
        seedX: seed.x, seedZ: seed.z
      };
      break;
    }
  }

  _findSeed(d) {
    const vox = this.vw.voxels;
    for (let dy = 1; dy <= 12; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const v = vox.get(key(d.ix + dx, d.iy + dy, d.iz + dz));
          if (v && v.active && v.groundCell === undefined) return v;
        }
      }
    }
    for (let r = 1; r <= 7; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
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
      if (relY >= 0.3 && relY <= 3.2) {
        st.lowCounts.set(ck, (st.lowCounts.get(ck) || 0) + 1);
      }
      if (relY > 2.8) {
        if (!st.upperCols.has(ck)) st.upperCols.set(ck, [v.x, v.z]);
      }

      for (const [dx, dy, dz] of DIRS) {
        if (Math.abs((v.ix + dx) * S - st.seedX) > 20 || Math.abs((v.iz + dz) * S - st.seedZ) > 20) continue;
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
    if (n < 60 || this.chunks.length >= MAX_CHUNKS) return;

    const cx = st.sx / n, cz = st.sz / n;

    // Yalnızca üstündeki alt taşıyıcı bantta da kesintisiz küp olan zemin kolonları yük taşıyabilir
    const activeSupportCols = [];
    for (const [ck, col] of st.cols.entries()) {
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

    // Teardown Fiziği:
    // 1) Eğer taban kolonlarının %82'sinden fazlası kesildiyse kalan cılız kolonlar ağırlığı taşıyamaz, bina aşağı çöker
    if (supportRatio < 0.18) {
      this.spawnChunk(list, {
        asymDir,
        creak: 0.12
      });
      return;
    }

    // 2) Kalan taban destek zarfı (convex hull) binanın ağırlık merkezini (cx, cz) taşıyor mu?
    const h = hull2(pts);
    const r = nearestOnHull(h, cx, cz);
    const comOutsideHull = !r || (!r.inside && r.dist > 0.22);
    const baseCriticallyUndercut = supportRatio < 0.42 && (!r || !r.inside || r.dist < 0.35);

    if (!comOutsideHull && !baseCriticallyUndercut) return;

    // Ağırlık merkezinin desteksiz kaldığı (kesilen) tarafa doğru devrilme yönü ve menteşe kenarı
    let dx = 0, dz = 0;
    if (r && !r.inside) {
      dx = cx - r.qx; dz = cz - r.qz;
    } else if (asymDir) {
      dx = asymDir.dx; dz = asymDir.dz;
    } else {
      dx = cx - supCx; dz = cz - supCz;
    }
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-4) {
      dx = 1; dz = 0;
    } else {
      dx /= dl; dz /= dl;
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of list) {
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
    const halfSpan = ((maxX - minX) * Math.abs(dx) + (maxZ - minZ) * Math.abs(dz)) * 0.32;
    const px = r && !r.inside ? r.qx : (cx + dx * halfSpan);
    const pz = r && !r.inside ? r.qz : (cz + dz * halfSpan);

    const chunk = this.spawnChunk(list, {
      tip: { dx, dz, px, py: isFinite(minBy) ? minBy : 0, pz },
      creak: 0
    });
    if (chunk) {
      // Teardown'daki gibi önce ağır ağır gıcırdayarak eğilmeye başlar, açı açıldıkça hızlanır
      chunk.omega = 0.025;
      sound.playBridgeCreak && sound.playBridgeCreak();
    }
  }

  // ── Düşen / devrilen / tutulan / fırlatılan rijit voxel gövdesi (Teardown Chunk) ──
  spawnChunk(list, opts = {}) {
    const vw = this.vw;
    const byType = new Map();
    list.forEach(v => {
      vw.voxels.delete(key(v.ix, v.iy, v.iz));
      vw._hideVoxel(v);
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

    let cols = Array.from(colMap.values());
    const stride = Math.ceil(cols.length / 1200);
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
      angVel: new THREE.Vector3(),
      wasThrown: false,
      attachedNpcs: [],
      attachedProps: []
    };

    // Ahtapot tarafından kaldırılan bina: içindeki insanları oturduğu yerden ayağa kaldır, AFK bırak ve binayla birlikte taşı!
    if (opts.held) {
      const heldBuildingIds = new Set();
      if (vw.officeBuildings) {
        for (const b of vw.officeBuildings) {
          if (b.maxX >= minX - 1.5 && b.minX <= maxX + 1.5 && b.maxZ >= minZ - 1.5 && b.minZ <= maxZ + 1.5) {
            b.heldByOctopus = true;
            b.evacuated = true;
            heldBuildingIds.add(b.id);
          }
        }
      }
      if (vw.npcs && vw.npcs.npcs) {
        for (const npc of vw.npcs.npcs) {
          const inBox = npc.x >= minX - 1.5 && npc.x <= maxX + 1.5 &&
                        npc.z >= minZ - 1.5 && npc.z <= maxZ + 1.5 &&
                        npc.y >= minY - 1.5 && npc.y <= maxY + 3.0;
          const inBld = npc.buildingId && heldBuildingIds.has(npc.buildingId);
          if (inBox || inBld) {
            // Oturduğu yerden ayağa kalksın ve AFK kalsın
            npc.sit = false;
            npc.drop = 0;
            npc.frozen = null;
            npc.lie = false;
            npc.eat = false;
            npc.watchTV = false;
            npc.cook = false;
            npc.evacPhase = null;
            npc.evacMode = null;
            npc.route = null;
            npc.afkInBuilding = true;
            npc.heldChunk = c;
            npc.chunkLocalPos = new THREE.Vector3(npc.x, npc.y, npc.z);
            npc.chunkBaseYaw = npc.heading || 0;
            if (npc.lLeg) npc.lLeg.rotation.set(0, 0, 0);
            if (npc.rLeg) npc.rLeg.rotation.set(0, 0, 0);
            if (npc.lArm) npc.lArm.rotation.set(0, 0, 0);
            if (npc.rArm) npc.rArm.rotation.set(0, 0, 0);
            if (npc.head) npc.head.rotation.set(0, 0, 0);
            if (npc.briefcase) npc.briefcase.visible = false;
            c.attachedNpcs.push(npc);
          }
        }
      }
      if (vw.props && vw.props.props) {
        for (const p of vw.props.props) {
          if (p.broken || p.held) continue;
          if (p.pos.x >= minX - 1.0 && p.pos.x <= maxX + 1.0 &&
              p.pos.z >= minZ - 1.0 && p.pos.z <= maxZ + 1.0 &&
              p.pos.y >= minY - 1.0 && p.pos.y <= maxY + 2.5) {
            p.sleep = true;
            c.attachedProps.push({
              prop: p,
              localPos: p.pos.clone(),
              baseYaw: p.yaw
            });
          }
        }
      }
    }

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

  // Ahtapot tarafından tutulan binayı (c.phase === 'held') verilen hızla ileri fırlatır veya bırakır
  throwChunk(c, velocity, angVel) {
    if (!c || c.settled) return;
    c.phase = 'thrown';
    c.t = 0;
    c.vel.copy(velocity);
    if (angVel) c.angVel.copy(angVel);
    else c.angVel.set(0, 0, 0);
  }

  _support(ix, iz, iy, x, z) {
    const vox = this.vw.voxels;
    let top = this.vw.terrain.heightAt(x, z);
    const floor = Math.max(-8, top);
    for (let k = iy - 1; k * S + S > floor && k > -17; k--) {
      const v = vox.get(key(ix, k, iz));
      if (v && v.active) { top = Math.max(top, (k + 1) * S); break; }
    }
    return top;
  }

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
      const a = Math.sin(c.t * 23) * 0.01 * (1 - c.t / c.creak);
      q.setFromAxisAngle(this._ax.set(0.7, 0, 0.7).normalize(), a);
      const m0 = c.com, v = this._v.set(-m0.x, -m0.y, -m0.z).applyQuaternion(q);
      c.meshes.forEach(m => { m.quaternion.copy(q); m.position.set(v.x + m0.x, v.y + m0.y, v.z + m0.z); });
    } else {
      c.meshes.forEach(m => { m.quaternion.identity(); m.position.set(0, c.oy0 + c.oy1, 0); });
    }

    // Binanın içindeki bağlı çalışanları (NPC) ve eşyaları (prop) binayla birlikte hareket ettir ve döndür
    if (c.attachedNpcs && c.attachedNpcs.length > 0) {
      const yawQ = new THREE.Quaternion();
      const upAxis = new THREE.Vector3(0, 1, 0);
      for (const npc of c.attachedNpcs) {
        if (!this.vw.npcs || !this.vw.npcs.npcs.includes(npc)) continue;
        this._place(c, npc.chunkLocalPos.x, npc.chunkLocalPos.y, npc.chunkLocalPos.z, this._v);
        npc.x = this._v.x;
        npc.y = this._v.y;
        npc.z = this._v.z;
        npc.group.position.set(npc.x, npc.y, npc.z);
        yawQ.setFromAxisAngle(upAxis, npc.chunkBaseYaw || 0);
        if (c.phase === 'held' || c.phase === 'thrown') {
          npc.group.quaternion.copy(c.holdQuat).multiply(yawQ);
        } else {
          npc.group.quaternion.copy(yawQ);
        }
      }
    }
    if (c.attachedProps && c.attachedProps.length > 0 && this.vw.props) {
      for (const ap of c.attachedProps) {
        const p = ap.prop;
        if (!p || p.broken || p.held) continue;
        this._place(c, ap.localPos.x, ap.localPos.y, ap.localPos.z, p.pos);
        this.vw.props._upload(p);
      }
    }
  }

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

  _beginTip(c, tip, theta0, omega0) {
    c.phase = 'tip';
    c.d = [tip.dx, tip.dz];
    c.oy0 += c.oy1; c.oy1 = 0;
    c.P = { x: tip.px, y: tip.py, z: tip.pz };
    c.theta = theta0; c.omega = omega0;
    const e = c.ext;
    const sExt = Math.abs(e.maxX - e.minX) * Math.abs(tip.dx) + Math.abs(e.maxZ - e.minZ) * Math.abs(tip.dz);
    c.Lp = sExt + S; c.Hc = e.maxY - e.minY + S;

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

  _checkHit(x, y, z) {
    const t = this.vw.terrain;
    const h = t.heightAt(x, z);
    if (h > -Infinity && y <= h + 0.05) return 'ground';
    const v = this.vw.voxels.get(key(Math.round(x / S), Math.floor((y - 0.02) / S), Math.round(z / S)));
    if (v && v.active) return v.groundCell !== undefined ? 'ground' : 'voxel';
    return null;
  }

  // Teardown Tarzı Çarpışma Hasarı:
  // Yalnızca çarpışma noktasının (pt) yakın çevresindeki küpler çarpışma HIZINA (speed) bağlı olarak kırılır!
  // Ne düşen bina ne de çarptığı bina komple yıkılmaz; hız düştüğünde bina çarptığı yere yaslanıp durur.
  _smashBuildingAt(c, pt, speed) {
    const vw = this.vw;
    const minSpeed = 3.2;
    if (speed < minSpeed) return false;

    // Hıza göre bu çarpışmada kırılabilecek en fazla küp sınırı (performansı korur, binayı komple yok etmez)
    const maxCrush = clamp(Math.floor((speed - 2.0) * 32), 45, 380);
    if (c.crushed >= maxCrush) return false;

    // Kırılma yarıçapı tamamen çarpma hızına bağlıdır (düşük hızda sadece 0.5m iz, yüksek hızda 1.85m göçük)
    const r = clamp(0.45 + (speed - minSpeed) * 0.12, 0.45, 1.85);
    const r2 = r * r;
    const minIx = Math.floor((pt.x - r) / S), maxIx = Math.ceil((pt.x + r) / S);
    const minIy = Math.floor((pt.y - r) / S), maxIy = Math.ceil((pt.y + r) / S);
    const minIz = Math.floor((pt.z - r) / S), maxIz = Math.ceil((pt.z + r) / S);

    let broken = 0;
    const pushDir = c.d
      ? { x: c.d[0] * speed * 0.5, y: -speed * 0.25, z: c.d[1] * speed * 0.5 }
      : { x: c.vel.x * 0.45, y: c.vel.y * 0.3, z: c.vel.z * 0.45 };

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          const v = vw.voxels.get(key(ix, iy, iz));
          if (!v || !v.active || v.groundCell !== undefined) continue;
          const dx = v.x - pt.x, dy = v.y - pt.y, dz = v.z - pt.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          vw._kill(v);
          vw._hideVoxel(v);
          broken++;
          if (broken <= 10 && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.25) {
            vw.spawnLooseVoxel(v.x, v.y, v.z, v.type, pt, 0.3, r, 12 + speed * 1.2, pushDir);
          }
        }
      }
    }

    if (broken > 0) {
      c.crushed += broken;
      if (vw.particleSystem.createDust && Math.random() < 0.4) {
        vw.particleSystem.createDust(pt.clone());
      }
      if (Math.random() < 0.25) sound.playBlockHit();
      // Çarpışma enerjisi emilir: bina çarptıkça yavaşlar ve durur
      const slow = clamp(1 - broken * 0.012, 0.55, 0.92);
      c.omega *= slow;
      c.vy *= slow;
      return c.crushed < maxCrush && (c.omega > 0.18 || c.vy > 3.5);
    }
    return false;
  }

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
      if (c.shedT <= 0 && c.cols.length) { c.shedT = 0.12; this._shed(c, 2); }
      this._pose(c);
      if (c.t >= c.creak) { c.phase = 'fall'; c.vy = 0.2; this._pose(c); }
      return false;
    }
    if (c.phase === 'sink') return this._stepSink(c, dt);
    if (c.phase === 'tip') return this._stepTip(c, dt);
    return this._stepFall(c, dt);
  }

  // Fırlatılan binanın havada uçup çarptığı noktada hıza göre lokal hasar alması ve oturması
  _stepThrown(c, dt) {
    c.vel.y = Math.max(-36, c.vel.y - GRAVITY * 0.85 * dt);
    c.holdOffset.addScaledVector(c.vel, dt);

    const wLen = c.angVel.length();
    if (wLen > 1e-4) {
      const dq = this._q.setFromAxisAngle(this._ax.copy(c.angVel).divideScalar(wLen), wLen * dt);
      c.holdQuat.premultiply(dq).normalize();
    }

    const speed = c.vel.length();
    const p = new THREE.Vector3();
    const stride = Math.max(1, Math.floor(c.list.length / 160));

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
        if (this._smashBuildingAt(c, p, speed)) {
          c.vel.multiplyScalar(0.68);
          continue;
        }
        this._pose(c);
        this._settle(c, c.vel.length(), 0.35, p.clone());
        return true;
      }
      if (hit === 'ground' && c.t > 0.12) {
        this._pose(c);
        this._settle(c, speed, 0.35, p.clone());
        return true;
      }
    }

    this._pose(c);
    return false;
  }

  _shed(c, k) {
    const vw = this.vw;
    for (let i = 0; i < k; i++) {
      const b = c.cols[Math.floor(Math.random() * c.cols.length)];
      const v = b.v;
      if (!v.active) continue;
      v.active = false; vw._hideVoxel(v); vw.destroyedVoxels++;
      if (vw.dynamicDebris.length < vw.maxDynamicDebris) {
        const p = this._place(c, v.x, v.y, v.z, new THREE.Vector3());
        vw.spawnLooseVoxel(p.x, p.y, p.z, v.type, { x: c.com.x, y: p.y - 0.8, z: c.com.z }, 1, 3, 10);
      }
    }
    if (vw.particleSystem.createDust && c.cols.length) {
      const b = c.cols[Math.floor(Math.random() * c.cols.length)];
      vw.particleSystem.createDust(new THREE.Vector3(b.x, b.by + c.oy0 + c.oy1, b.z));
    }
  }

  // Düşen binanın yere çarptığında SADECE temas eden en alt katmanını hıza göre ezmesi
  _crushBottomLayer(c) {
    const vw = this.vw;
    let minIy = Infinity;
    for (const u of c.list) {
      if (u.active && u.iy < minIy) minIy = u.iy;
    }
    if (minIy === Infinity) return 0;

    let broken = 0, debris = 0;
    // Hıza göre alt katmandaki küplerin ne kadarının kırılacağı (düşük hızda kısmi, yüksek hızda tam katman)
    const breakProb = clamp((c.vy - 3.5) / 10, 0.35, 1.0);
    for (const u of c.list) {
      if (!u.active) continue;
      if (u.iy <= minIy && Math.random() <= breakProb) {
        u.active = false;
        vw._hideVoxel(u);
        broken++;
        if (debris < 18 && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.35) {
          debris++;
          const wx = u.x, wy = u.y + c.oy0 + c.oy1, wz = u.z;
          vw.spawnLooseVoxel(wx, wy, wz, u.type, { x: c.com.x, y: wy, z: c.com.z }, 0.5, 2.5, 12 + c.vy);
        }
      }
    }
    vw.destroyedVoxels += broken;

    c.lowBy += S;
    for (const b of c.cols) {
      if (b.by <= minIy * S + 1e-3) b.by = (minIy + 1) * S;
    }
    if (vw.particleSystem.createDust && c.cols.length) {
      const b = c.cols[Math.floor(Math.random() * c.cols.length)];
      vw.particleSystem.createDust(new THREE.Vector3(b.x, b.sup + 0.2, b.z));
    }
    sound.playBlockHit();
    if (this.onShake) this.onShake(Math.min(0.28, 0.04 + c.vy / 90));
    return broken;
  }

  _stepFall(c, dt) {
    c.vy = Math.min(32, c.vy + GRAVITY * 0.65 * dt);
    const drop = c.vy * dt;
    if (c.theta === 0) {
      let minGap = Infinity;
      for (const b of c.cols) { const g = b.by + c.oy0 + c.oy1 - b.sup; if (g < minGap) minGap = g; }
      if (minGap < Infinity && minGap - drop <= 0) {
        c.oy1 -= Math.max(0, minGap);
        this._pose(c);
        return this._contact(c);
      }
      if (minGap === Infinity && c.lowBy + c.oy0 + c.oy1 - drop <= WATER_Y) { this._enterWater(c); return false; }
      c.oy1 -= drop;
    } else {
      const steps = Math.max(1, Math.ceil(drop / 0.25)), per = drop / steps, p = new THREE.Vector3();
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
            this._pose(c); this._settle(c, vImpact, c.theta, p.clone()); return true;
          }
        }
      }
    }
    this._pose(c);
    return false;
  }

  // Düz düşen parça zemine/alt yapıya değdiğinde (Teardown tarzı):
  // Yalnızca düşüş hızı (c.vy) yüksekse temas eden en alt katman hıza göre ezilir ve bina frenler.
  // Durduğunda ağırlık merkezi temas yüzeyinin içindeyse olduğu gibi sağlam oturur; dışındaysa o kenardan devrilir.
  _contact(c) {
    const impact = c.vy;
    const maxCrushLayers = clamp(Math.floor((impact - 3.5) / 3.5), 0, 4);
    if (c.vy > 4.2 && c.crushLayers < maxCrushLayers) {
      const broken = this._crushBottomLayer(c);
      c.crushLayers++;
      c.vy = Math.max(0, c.vy * 0.52 - 1.8);
      if (broken > 0 && c.vy > 4.2 && c.crushLayers < maxCrushLayers) {
        return false;
      }
    }

    const lowGap = Math.min(...c.cols.map(b => b.by + c.oy0 + c.oy1 - b.sup));
    const pts = [];
    let py = Infinity;
    for (const b of c.cols) {
      if (b.by + c.oy0 + c.oy1 - b.sup > lowGap + 0.1) continue;
      pts.push([b.x - S / 2, b.z - S / 2], [b.x + S / 2, b.z - S / 2], [b.x - S / 2, b.z + S / 2], [b.x + S / 2, b.z + S / 2]);
      py = Math.min(py, b.by + c.oy0 + c.oy1);
    }

    // Kalan temas alanı ağırlık merkezini taşımıyorsa veya alt kısım tek taraflı kesilmişse o yöne devrilir
    const h = hull2(pts), r = nearestOnHull(h, c.com.x, c.com.z);
    if (r && (!r.inside && r.dist >= 0.35)) {
      let dx = c.com.x - r.qx, dz = c.com.z - r.qz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      this._beginTip(c, { dx, dz, px: r.qx, py, pz: r.qz }, 0.005, 0.03);
      return false;
    }
    if (c.asymDir && c.asymDir.strength >= 0.45) {
      const { dx, dz } = c.asymDir;
      const halfSpan = ((c.ext.maxX - c.ext.minX) * Math.abs(dx) + (c.ext.maxZ - c.ext.minZ) * Math.abs(dz)) * 0.35;
      const px = c.com.x + dx * halfSpan, pz = c.com.z + dz * halfSpan;
      this._beginTip(c, { dx, dz, px, py: isFinite(py) ? py : c.lowBy + c.oy0 + c.oy1, pz }, 0.005, 0.03);
      return false;
    }

    // Düz oturdu: üst gövde hiç kırılmadan olduğu gibi yerine yerleşir
    this._settle(c, impact, 0, null);
    return true;
  }

  _stepTip(c, dt) {
    const P = c.P, dx = c.d[0], dz = c.d[1];
    const rs = (c.com.x - P.x) * dx + (c.com.z - P.z) * dz, ry = Math.max(1.5, c.com.y + c.oy0 - P.y);
    const sub = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / sub;
    const p = new THREE.Vector3();
    for (let i = 0; i < sub; i++) {
      const cs = Math.cos(c.theta), sn = Math.sin(c.theta);
      const sCom = Math.max(0.35, rs * cs + ry * sn);
      const k2 = (c.Lp * c.Lp + c.Hc * c.Hc) / 12;
      c.omega += (TIP_G * sCom / (k2 + rs * rs + ry * ry)) * h;
      c.omega *= 1 - 0.05 * h;
      c.theta += c.omega * h;

      for (const f of c.front) {
        if (f.s < 0.35) continue;
        this._place(c, f.x, f.y, f.z, p);
        if (p.y <= WATER_Y && !this.vw.terrain.isLand(p.x, p.z)) {
          if (c.hinge) continue;
          this._pose(c); this._enterWater(c); return false;
        }
        const hit = this._checkHit(p.x, p.y, p.z);
        if (hit === 'voxel') {
          const vLocal = Math.abs(c.omega) * Math.hypot(f.s, f.h);
          if (this._smashBuildingAt(c, p, vLocal)) continue;
          this._pose(c);
          this._settle(c, vLocal, c.theta, p.clone());
          return true;
        }
        if (hit === 'ground') {
          if (c.theta < 0.35 && f.h < 2.8 && f.s < 2.8) continue;
          const vLocal = Math.abs(c.omega) * Math.hypot(f.s, f.h);
          this._pose(c);
          this._settle(c, vLocal, c.theta, p.clone());
          return true;
        }
      }
      if (c.theta >= (c.hinge ? TIP_RELEASE : 1.45)) {
        if (c.hinge) { c.phase = 'fall'; c.vy = Math.max(1.5, c.omega * 2); c.hinge = false; this._pose(c); return false; }
        const vLocal = Math.abs(c.omega) * Math.hypot(rs, ry);
        this._pose(c);
        this._settle(c, vLocal, c.theta, new THREE.Vector3(c.com.x + dx * rs, P.y, c.com.z + dz * rs));
        return true;
      }
    }
    c.shedT -= dt;
    if (c.shedT <= 0 && c.cols.length) { c.shedT = 0.18; this._shed(c, 1); }
    this._pose(c);
    return false;
  }

  _enterWater(c) {
    c.phase = 'sink'; c.entered = true; c.vy = Math.min(c.vy, 2.5);
    const vw = this.vw;
    if (vw.particleSystem.createSplash) vw.particleSystem.createSplash(new THREE.Vector3(c.com.x, WATER_Y, c.com.z), Math.min(6, 1.5 + c.n / 700));
    sound.playSplash && sound.playSplash();
    if (c.attachedNpcs && c.attachedNpcs.length > 0 && vw.npcs) {
      for (const npc of c.attachedNpcs) {
        npc.heldChunk = null;
        if (vw.npcs.npcs.includes(npc)) vw.npcs._kill(npc, new THREE.Vector3(npc.x, npc.y, npc.z));
      }
      c.attachedNpcs.length = 0;
    }
  }

  _stepSink(c, dt) {
    c.vy += (SINK_SPEED - c.vy) * Math.min(1, dt * 4);
    c.oy1 -= c.vy * dt;
    c.sinkT += dt;
    this._pose(c);
    const e = c.ext, p = new THREE.Vector3();
    let top = -Infinity;
    for (const x of [e.minX, e.maxX]) for (const y of [e.minY, e.maxY]) for (const z of [e.minZ, e.maxZ]) top = Math.max(top, this._place(c, x, y + S, z, p).y);
    if (top < WATER_Y - 1.5 || c.com.y + c.oy0 + c.oy1 < WATER_Y - 2.2 || c.sinkT > 14) { this._dispose(c); return true; }
    return false;
  }

  _dispose(c) {
    c.meshes.forEach(m => { this.vw.scene.remove(m); m.dispose(); });
    c.list.forEach(v => { v.active = false; });
  }

  // ── TEARDOWN TARZI YERE / ENGELE OTURMA VE LOKAL HIZA BAĞLI KIRILMA ──
  //  • Bina ASLA komple yıkılmaz veya rastgele dağılmaz!
  //  • Yalnızca çarptığı temas bölgesi (contact çevresi veya yere çarpan alt yüzey) çarpma hızına (v) göre kırılır.
  //  • Binanın geri kalan tüm gövdesi sağlam kalır ve zincirleme çökme (lag) tetiklemez.
  _settle(c, v, theta, contact) {
    const vw = this.vw, p = new THREE.Vector3();
    const speed = Math.max(0, v);

    // Hıza bağlı lokal hasar parametreleri (düşük hızda 0 hasar, yüksek hızda yalnız temas noktasında kırılma)
    const contactRadius = contact ? clamp((speed - 2.2) * 0.28, 0, 3.0) : 0;
    const contactProbMax = clamp((speed - 2.2) / 13.0, 0, 0.85);
    const groundCrushH = clamp((speed - 3.0) * 0.11, 0, 1.1);
    const groundProbMax = clamp((speed - 3.0) / 14.0, 0, 0.80);

    const dummy = new THREE.Object3D();
    const placedByChunk = new Set(); // bu parçanın kendi küplerinin yerleştiği ızgara hücreleri
    let broken = 0, debris = 0;
    const maxDebris = clamp(Math.floor(speed * 4), 10, 48);

    const wipe = (u, x, y, z) => {
      u.active = false; vw._hideVoxel(u); broken++;
      if (debris < maxDebris && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.45) {
        debris++;
        vw.spawnLooseVoxel(x, y, z, u.type, contact || { x: c.com.x, y: Math.max(0.5, y - 0.5), z: c.com.z }, 0.4, 2.5, 10 + speed);
      }
    };

    const isRotated = theta !== 0 || c.phase === 'thrown';

    for (const u of c.list) {
      if (!u.active) continue;
      this._place(c, u.x, u.y, u.z, p);

      const th = vw.terrain.heightAt(p.x, p.z);
      const relGroundY = th > -Infinity ? (p.y - th) : p.y;

      // 1) Yalnızca temas bölgesinde ve hıza bağlı kırılma hesabı (diğer bölgelerde pd = 0!)
      let pd = 0;
      if (contact && contactRadius > 0) {
        const dc = Math.hypot(p.x - contact.x, p.y - contact.y, p.z - contact.z);
        if (dc < contactRadius) {
          pd = Math.max(pd, contactProbMax * (1 - dc / contactRadius));
        }
      }
      if (groundCrushH > 0 && relGroundY >= -0.2 && relGroundY < groundCrushH) {
        pd = Math.max(pd, groundProbMax * (1 - Math.max(0, relGroundY) / groundCrushH));
      }

      if (pd > 0 && Math.random() < pd) {
        wipe(u, p.x, p.y, p.z);
        continue;
      }

      // Yeraltına gömülen alt kenar küpleri kırılır
      if ((th > -Infinity && p.y < th - 0.15) || p.y < -8) {
        wipe(u, p.x, p.y, p.z);
        continue;
      }

      // 2) Izgara konumunu bul (dönmüş parçada yuvarlama çakışması olursa en yakın boş komşu hücreye yerleştir)
      const baseIx = Math.round(p.x / S);
      const baseIz = Math.round(p.z / S);
      const baseIy = !isRotated ? Math.ceil((u.iy * S + c.oy0 + c.oy1) / S - 1e-6) : Math.floor(p.y / S);

      let chosenIx = baseIx, chosenIy = baseIy, chosenIz = baseIz;
      let chosenKey = key(baseIx, baseIy, baseIz);
      let canPlace = false;

      if (!placedByChunk.has(chosenKey)) {
        const ex = vw.voxels.get(chosenKey);
        if (!ex || !ex.active) {
          canPlace = true;
        } else if (ex.groundCell === undefined && speed >= 3.5 && c.crushed < 240) {
          // Çarpılan diğer binanın temas yüzeyindeki küpü hıza bağlı ez
          vw._kill(ex); vw._hideVoxel(ex); c.crushed++;
          wipe(u, p.x, p.y, p.z);
          continue;
        }
      }

      // Eğer hedef hücre bu binanın kendi komşu küpü tarafından az önce doldurulduysa (dönme yuvarlaması),
      // küpü silmek yerine hemen yanındaki boş yuvarlama hücresine koy (böylece duvarda delik açılmaz ve bina yok olmaz!)
      if (!canPlace && isRotated) {
        for (let oi = 1; oi < SETTLE_OFFSETS.length; oi++) {
          const [ox, oy, oz] = SETTLE_OFFSETS[oi];
          const tx = baseIx + ox, ty = baseIy + oy, tz = baseIz + oz;
          if (th > -Infinity && ty * S < th - 0.05) continue;
          const tk = key(tx, ty, tz);
          if (placedByChunk.has(tk)) continue;
          const ex2 = vw.voxels.get(tk);
          if (!ex2 || !ex2.active) {
            chosenIx = tx; chosenIy = ty; chosenIz = tz;
            chosenKey = tk;
            canPlace = true;
            break;
          }
        }
      }

      if (!canPlace) {
        // Tamamen iç içe geçmiş fazla örnek varsa döküntü saçmadan sessizce gizle
        u.active = false;
        vw._hideVoxel(u);
        continue;
      }

      placedByChunk.add(chosenKey);
      u.ix = chosenIx; u.iy = chosenIy; u.iz = chosenIz;
      u.x = chosenIx * S; u.y = chosenIy * S + S / 2; u.z = chosenIz * S;
      vw.voxels.set(chosenKey, u);
      this.ok.add(chosenKey); // oturan bina sabit kabul edilir, tekrar düşme kuyruğuna girip kasma yapmaz!
      dummy.position.set(u.x, u.y, u.z); dummy.updateMatrix();
      u.mesh.setMatrixAt(u.instanceIdx, dummy.matrix);
    }

    c.meshes.forEach(m => { m.quaternion.identity(); m.position.set(0, 0, 0); m.instanceMatrix.needsUpdate = true; });
    vw.destroyedVoxels += broken;

    // Binanın içindeki çalışanlar (attachedNpcs): bina atıldığında veya hızla çarptığında bina içinde hasar görürler!
    if (c.attachedNpcs && c.attachedNpcs.length > 0 && vw.npcs) {
      const damageEmployees = c.wasThrown || speed >= 2.0;
      for (const npc of c.attachedNpcs) {
        npc.heldChunk = null;
        if (!vw.npcs.npcs.includes(npc)) continue;
        if (damageEmployees) {
          vw.npcs._kill(npc, contact || new THREE.Vector3(npc.x, npc.y, npc.z));
        } else {
          npc.group.rotation.set(0, npc.chunkBaseYaw || 0, 0);
        }
      }
      c.attachedNpcs.length = 0;
    }
    if (c.attachedProps && c.attachedProps.length > 0 && vw.props) {
      const breakProps = c.wasThrown || speed >= 3.0;
      for (const ap of c.attachedProps) {
        const pr = ap.prop;
        if (!pr || pr.broken) continue;
        if (breakProps) {
          vw.props.breakProp(pr, contact || pr.pos);
        } else {
          pr.sleep = false;
        }
      }
      c.attachedProps.length = 0;
    }

    // Çarpma hızına orantılı toz, ses ve sarsıntı
    if (speed >= 2.0) {
      const at = contact || new THREE.Vector3(c.com.x, c.lowBy + c.oy0 + c.oy1, c.com.z);
      vw.particleSystem.createExplosion(at, clamp(0.8 + speed * 0.25, 0.8, 5.5), 0x9c9484);
      if (vw.particleSystem.createDust) {
        vw.particleSystem.createDust(at.clone());
      }
      sound.playExplosion(clamp(0.35 + speed / 28, 0.35, 1.4));
      if (this.onShake) this.onShake(clamp(0.05 + speed / 75, 0.05, 0.45));
    }
    if (broken > 0 && vw.onScoreGain) {
      const score = Math.max(10, Math.round(broken * 5));
      vw.onScoreGain(score, `+${score} HASAR!`);
    }
    c.settled = true;
  }

  clear() {
    this.seeds.clear();
    this.ok.clear();
    this.dirty.clear(); this.cool.clear(); this.stab = null;
    this.recentBreaks = [];
    this.chunks.forEach(c => this._dispose(c));
    this.chunks = [];
    this.time = 0;
  }
}
