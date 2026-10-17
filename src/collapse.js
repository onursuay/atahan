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
const MAX_COMPONENT = 60000;   // bundan büyük topluluk "zemine bağlı" sayılır
const BUDGET_MS = 6;           // kare başına bağlantı kontrolü süresi
const MAX_CHUNKS = 10;
const GRAVITY = 22;
const TIP_G = 9;               // devrilme: ağır yapı yavaş döner
const WATER_Y = -0.15;         // deniz yüzeyi (main.js waterMesh.position.y ile aynı)
const SINK_SPEED = 0.7;        // suda batma hızı (m/sn)
const STAB_CAP = 90000;        // devrilme kontrolünde gezilecek en çok küp
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
    this.dirty = new Map();   // bölge → { n, t, ix, iy, iz }: devrilme kontrolü için hasar sayacı
    this.cool = new Map();
    this.stab = null;         // sürmekte olan devrilme kontrolü
    this.recentBreaks = [];   // son kırılan küpler: { x, y, z, t } — kesilen binanın çok parçalanan tarafını bulmak için
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._ax = new THREE.Vector3();
  }

  // Kaldırılan voxelin komşularını kontrol sırasına ekle
  queue(v) {
    if (this.seeds.size < 600000) for (const [dx, dy, dz] of DIRS) this.seeds.add(key(v.ix + dx, v.iy + dy, v.iz + dz));
    const bk = `${v.ix >> 4},${v.iz >> 4}`;
    let d = this.dirty.get(bk);
    if (!d) { d = { n: 0, t: 0, ix: v.ix, iy: v.iy, iz: v.iz, sx: 0, sz: 0, baseN: 0 }; this.dirty.set(bk, d); }
    d.n++; d.t = this.time; d.ix = v.ix; d.iy = v.iy; d.iz = v.iz;
    if (v.y <= 6.0) { d.sx += v.x; d.sz += v.z; d.baseN++; }
    this.recentBreaks.push({ x: v.x, y: v.y, z: v.z, t: this.time });
    if (this.recentBreaks.length > 50000) this.recentBreaks.splice(0, 15000);
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
    const tip = this._computeAsymmetricCutTip(list);
    this.spawnChunk(list, {
      tip,
      creak: tip ? 0 : (list.length >= 150 ? 0.25 + 0.6 * Math.min(1, list.length / 6000) : 0)
    });
  }

  // Komple yerden kesilen yapıda alt kısmın hangi yarısı daha fazla parçalandıysa o tarafa devrilme hesabı
  _computeAsymmetricCutTip(list) {
    if (list.length < 40) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let sx = 0, sz = 0;
    for (const v of list) {
      sx += v.x; sz += v.z;
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
    const spanX = maxX - minX, spanZ = maxZ - minZ, spanY = maxY - minY;
    if (spanX < 1.5 && spanZ < 1.5) return null;

    const cx = sx / list.length, cz = sz / list.length;
    const baseCutH = minY + Math.max(2.5, Math.min(6.0, spanY * 0.45));

    // 1) Alt kısımda kalan sağlam küplerin dağılımı (az küp kalan taraf = çok parçalanan taraf)
    let lowSx = 0, lowSz = 0, lowW = 0;
    for (const v of list) {
      if (v.y <= baseCutH) {
        const w = (baseCutH - v.y + S) / (baseCutH - minY + S); // en alt katmanlara daha çok ağırlık
        lowSx += (v.x - cx) * w;
        lowSz += (v.z - cz) * w;
        lowW += w;
      }
    }

    // 2) Son kırılan küplerin (hasar geçmişi) dağılımı (çok küp kırılan taraf = çok parçalanan taraf)
    let dmgVecX = 0, dmgVecZ = 0, dmgCount = 0;
    const pad = 1.5;
    for (let i = this.recentBreaks.length - 1; i >= 0; i--) {
      const b = this.recentBreaks[i];
      if (b.x >= minX - pad && b.x <= maxX + pad && b.z >= minZ - pad && b.z <= maxZ + pad && b.y <= baseCutH + 1.0) {
        dmgVecX += (b.x - cx);
        dmgVecZ += (b.z - cz);
        dmgCount++;
      }
    }

    // Çok parçalanan yönü birleştir: kırılan küplerin yoğun olduğu taraf + alt küplerin eksildiği taraf
    let dirX = 0, dirZ = 0;
    if (lowW > 0) {
      // Kalan sağlam alt küplerin tersi yönü (fazla parçalanan boşluk tarafı)
      dirX -= (lowSx / lowW) * 2.2;
      dirZ -= (lowSz / lowW) * 2.2;
    }
    if (dmgCount > 0) {
      dirX += (dmgVecX / dmgCount) * 1.5;
      dirZ += (dmgVecZ / dmgCount) * 1.5;
    }

    const dl = Math.hypot(dirX, dirZ);
    if (dl < 0.08) return null; // tamamen simetrik kesilmişse düz düşsün
    const dx = dirX / dl, dz = dirZ / dl;

    // Az parçalanan (daha sağlam kalan) alt kenarı dayanak/pivot noktası olarak seç
    let bestProj = Infinity, px = cx, pz = cz, py = minY;
    for (const v of list) {
      if (v.y > minY + 2.5) continue;
      const proj = (v.x - cx) * dx + (v.z - cz) * dz; // negatif = az parçalanan arka/destek tarafı, pozitif = çok parçalanan ön taraf
      if (proj < bestProj) {
        bestProj = proj;
        px = v.x; pz = v.z; py = v.y - S / 2;
      }
    }
    // Pivot noktasını merkeze biraz yaklaştır ki devrilirken hem dönsün hem yere doğru çakılsın
    px = cx + (px - cx) * 0.55;
    pz = cz + (pz - cz) * 0.55;
    const supY = this._support(Math.round(px / S), Math.round(pz / S), Math.round(py / S), px, pz);
    if (supY > -Infinity && supY <= py + 0.5) py = Math.max(supY, py - 1.5);

    return { dx, dz, px, py, pz, cutFall: true };
  }

  // ── DEVRİLME KONTROLÜ: zemine bağlı yapının ağırlık merkezi kalan tabanın üstünde mi? ──
  _stabilityTick() {
    if (this.stab) { this._stabilityStep(); return; }
    if (this.chunks.length >= MAX_CHUNKS) return;
    for (const [bk, d] of this.dirty) {
      if (this.time - d.t < 0.45) continue;           // hasar sürerken kısa bekle
      this.dirty.delete(bk);
      if (d.n < 8) continue;                          // çok küçük hasar devirmez
      const cd = this.cool.get(bk);
      if (cd !== undefined && this.time - cd < 1.2) continue;
      this.cool.set(bk, this.time);
      const seed = this._findSeed(d);
      if (!seed) continue;
      const visited = new Map(); visited.set(key(seed.ix, seed.iy, seed.iz), seed);
      this.stab = { stack: [seed], visited, sx: 0, sy: 0, sz: 0, cols: new Map(), rim: false, abort: false, dirtyInfo: d };
      break;
    }
  }

  _findSeed(d) {
    const vox = this.vw.voxels;
    for (let r = 1; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;   // yalnız yeni kabuk
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
      if (this._grounded(v)) st.cols.set(`${v.ix},${v.iz}`, [v.x, v.z, v.y - S / 2]);
      for (const [dx, dy, dz] of DIRS) {
        const k = key(v.ix + dx, v.iy + dy, v.iz + dz);
        if (st.visited.has(k)) continue;
        const n = vox.get(k);
        if (!n || !n.active) continue;
        if (n.groundCell !== undefined) { st.cols.set(`${n.ix},${n.iz}`, [n.x, n.z, n.y - S / 2]); continue; }   // arazi kenarı: zemin sayılır, içinden geçilmez
        st.visited.set(k, n);
        st.stack.push(n);
      }
      if (st.visited.size > STAB_CAP) { this.stab = null; return; }   // çok büyük: devrilmez
      if (performance.now() - t0 > BUDGET_MS) return;
    }
    this.stab = null;
    const list = Array.from(st.visited.values()), n = list.length;
    if (n < 40 || this.chunks.length >= MAX_CHUNKS) return;
    const cx = st.sx / n, cy = st.sy / n, cz = st.sz / n;
    const pts = [];
    let supSx = 0, supSz = 0, supN = 0;
    for (const [x, z] of st.cols.values()) {
      pts.push([x - S / 2, z - S / 2], [x + S / 2, z - S / 2], [x - S / 2, z + S / 2], [x + S / 2, z + S / 2]);
      supSx += x; supSz += z; supN++;
    }
    if (pts.length === 0) return;                      // tabansız: normal bağlantı kontrolü ele alır
    const h = hull2(pts);
    const r = nearestOnHull(h, cx, cz);

    // Kalan taban küplerinin merkezi ile binanın ağırlık merkezi arasındaki kayma (asimetrik alt yıkım kontrolü)
    const supCx = supSx / supN, supCz = supSz / supN;
    const shiftX = cx - supCx, shiftZ = cz - supCz;
    const shiftDist = Math.hypot(shiftX, shiftZ);

    // Eğer zarf dışındaysa VEYA alt kısmın bir yarısı çok parçalanıp destek merkezi belirgin kaydıysa devrilir
    const outsideHull = r && (!r.inside && r.dist >= 0.25);
    const heavyAsymDamage = shiftDist >= 0.85 && supN < Math.max(18, n * 0.045);
    if (!outsideHull && !heavyAsymDamage) return;

    let dx, dz, px, pz;
    if (outsideHull) {
      dx = cx - r.qx; dz = cz - r.qz;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      px = r.qx; pz = r.qz;
    } else {
      dx = shiftX / (shiftDist || 1); dz = shiftZ / (shiftDist || 1);
      px = supCx; pz = supCz;
    }
    let minBy = Infinity; for (const c of st.cols.values()) minBy = Math.min(minBy, c[2]);
    this.spawnChunk(list, { tip: { dx, dz, px, py: minBy, pz }, creak: 0 });
  }

  // ── Düşen / devrilen parça ──
  // list: voxel nesneleri (dünyadan çıkarılır). opts: { creak, tip: {dx,dz,px,py,pz}, hinge: {dx,dz,px,py,pz} }
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
      phase: 'fall', t: 0, vy: 0, oy0: 0, oy1: 0, theta: 0, omega: 0,
      d: null, P: null, front: null, shedT: 0, hinge: !!opts.hinge, sinkT: 0, entered: false,
      creak: opts.creak || 0, bornT: this.time, cutFall: !!(opts.tip && opts.tip.cutFall),
      crushed: 0
    };
    if (c.creak > 0) c.phase = 'creak';
    if (opts.tip) this._beginTip(c, opts.tip, 0.015, opts.tip.cutFall ? 0.14 : 0);
    else if (opts.hinge) this._beginTip(c, opts.hinge, 0.002, 0);
    this.chunks.push(c);
    sound.playBlockHit();
    this._pose(c);
    return c;
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
    if (c.d && c.theta !== 0) {
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
    if (c.d && c.theta !== 0) {
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

  // Devrilen/düşen bina belli bir hıza ulaştığında önündeki başka binaya çarparsa onu yıkar/parçalar (çok aşırı yıkmaması için momentum sınırı var)
  _smashBuildingAt(c, pt, speed) {
    const vw = this.vw;
    // Belli bir hız eşiği (ör. 3.2 m/sn altı yavaş temaslarda diğer binayı yıkamaz)
    const minSpeed = 3.2;
    if (speed < minSpeed) return false;
    // Çok yıkmasın: bina büyüklüğüyle orantılı makul bir kırma bütçesi
    const maxCrush = Math.min(2200, Math.max(180, Math.floor(c.n * 0.42)));
    if (c.crushed >= maxCrush) return false;

    const r = clamp(1.0 + (speed - minSpeed) * 0.22, 1.0, 2.6);
    const r2 = r * r;
    const minIx = Math.floor((pt.x - r) / S), maxIx = Math.ceil((pt.x + r) / S);
    const minIy = Math.floor((pt.y - r) / S), maxIy = Math.ceil((pt.y + r) / S);
    const minIz = Math.floor((pt.z - r) / S), maxIz = Math.ceil((pt.z + r) / S);

    let broken = 0;
    const pushDir = c.d ? { x: c.d[0] * speed * 0.6, y: -speed * 0.3, z: c.d[1] * speed * 0.6 } : null;

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
          if (vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.25) {
            vw.spawnLooseVoxel(v.x, v.y, v.z, v.type, pt, 0.4, r, 18 + speed * 2, pushDir);
          }
        }
      }
    }

    if (broken > 0) {
      c.crushed += broken;
      // Çarpılan binanın kendi küplerinden de bir kısmı ezilir
      this._shed(c, Math.min(8, Math.ceil(broken * 0.12)));
      if (vw.particleSystem.createDust && Math.random() < 0.45) {
        vw.particleSystem.createDust(pt.clone());
      }
      if (Math.random() < 0.25) sound.playBlockHit();
      // Çarpışma darbesiyle düşen binanın hızı bir miktar azalır (momentum aktarımı)
      const slow = clamp(1 - (broken / maxCrush) * 0.35, 0.72, 0.98);
      c.omega *= slow;
      c.vy *= slow;
      return c.crushed < maxCrush;
    }
    return false;
  }

  // true dönerse parça artık yok (yerine oturdu, battı ya da dağıldı)
  _stepChunk(c, dt) {
    c.t += dt;
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

  _stepFall(c, dt) {
    c.vy = Math.min(40, c.vy + GRAVITY * dt);
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

  // Düz düşen parça zemine değdi: destek ağırlık merkezini taşıyor mu, yoksa devrilecek mi?
  _contact(c) {
    const impact = c.vy;
    const lowGap = Math.min(...c.cols.map(b => b.by + c.oy0 + c.oy1 - b.sup));
    const pts = [];
    let py = Infinity;
    for (const b of c.cols) {
      if (b.by + c.oy0 + c.oy1 - b.sup > lowGap + 0.06) continue;
      pts.push([b.x - S / 2, b.z - S / 2], [b.x + S / 2, b.z - S / 2], [b.x - S / 2, b.z + S / 2], [b.x + S / 2, b.z + S / 2]);
      py = Math.min(py, b.by + c.oy0 + c.oy1);
    }
    const h = hull2(pts), r = nearestOnHull(h, c.com.x, c.com.z);
    if (!r || r.inside || r.dist < 0.25) {
      // Eğer komple yerden kesilmiş ama asimetrik bir darbe almışsa çarpma anında da çok parçalanan tarafa devrilebilir
      const asym = this._computeAsymmetricCutTip(c.list);
      if (asym) {
        this._beginTip(c, { dx: asym.dx, dz: asym.dz, px: asym.px, py, pz: asym.pz }, 0.02, clamp(0.18 + impact * 0.06, 0.15, 0.9));
        return false;
      }
      this._settle(c, impact, 0, null);
      return true;
    }
    let dx = c.com.x - r.qx, dz = c.com.z - r.qz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    this._beginTip(c, { dx, dz, px: r.qx, py, pz: r.qz }, 0.008, clamp(0.16 * impact / Math.max(0.8, r.dist), 0.1, 0.95));
    return false;
  }

  _stepTip(c, dt) {
    // Devrilme dinamiği: ağırlık merkezi pivotun ilerisindeyse yerçekimi momenti açıyı büyütür (üstel başlar: yavaş başlayıp hızlanır)
    const P = c.P, dx = c.d[0], dz = c.d[1];
    const rs = (c.com.x - P.x) * dx + (c.com.z - P.z) * dz, ry = c.com.y + c.oy0 - P.y;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / sub;
    const p = new THREE.Vector3();
    for (let i = 0; i < sub; i++) {
      const cs = Math.cos(c.theta), sn = Math.sin(c.theta);
      // Çok parçalanan tarafa devrilirken başlangıçta da güçlü bir tork olsun ki takılmadan devrilsin
      const sCom = Math.max(0.8, rs * cs + ry * sn);
      const k2 = (c.Lp * c.Lp + c.Hc * c.Hc) / 12;
      const tipG = c.cutFall ? TIP_G * 1.45 : TIP_G;
      c.omega += (tipG * sCom / (k2 + rs * rs + ry * ry)) * h;
      c.omega *= 1 - 0.03 * h;
      c.theta += c.omega * h;
      // Komple altından kesilmiş bina devrilirken aynı zamanda yerçekimiyle aşağı da çöker
      if (c.cutFall) {
        c.vy = Math.min(18, c.vy + GRAVITY * 0.32 * h);
        c.oy1 -= c.vy * h;
      }
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
          const v = Math.hypot(c.vy, Math.abs(c.omega) * Math.hypot(f.s, f.h));
          // Önünde başka bina varsa ve belli bir hıza ulaştıysa o binayı da yıkıp içinden geçer
          if (this._smashBuildingAt(c, p, v)) continue;
          this._pose(c);
          this._settle(c, Math.max(v, 2), c.theta, p.clone());
          return true;
        }
        if (hit === 'ground') {
          // Yere henüz çok küçük açıda değdiyse (kesilen taban köşesi) biraz ezilip devrilmeye devam etsin, hemen durmasın
          if (c.theta < 0.38 && f.h < 3.0) {
            c.oy1 += 0.04;
            continue;
          }
          const v = Math.hypot(c.vy, Math.abs(c.omega) * Math.hypot(f.s, f.h));
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
    if (c.shedT <= 0 && c.cols.length) { c.shedT = 0.12; this._shed(c, 1 + Math.floor(Math.min(4, c.n / 3000))); }
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

  // Yere oturma: hıza ve eğikliğe göre hasar, sonra küpler yeni konumlarına (ızgaraya) işlenir.
  //  • düz iniş: yalnız temas eden alt katmanlar hasar alır (ancak yüksek hızla yere çakılırsa komple parçalanır)
  //  • eğik/devrilerek çarpma: bina komple yere çakılır ve şiddetli şekilde parçalanır; çarptığı yerdeki diğer yapıları da hızına göre yıkar
  _settle(c, v, theta, contact) {
    const vw = this.vw, p = new THREE.Vector3();
    // Kolon tabanları (hasar derinliği için)
    const bottomIy = new Map();
    for (const u of c.list) { if (!u.active) continue; const k = `${u.ix},${u.iz}`, b = bottomIy.get(k); if (b === undefined || u.iy < b) bottomIy.set(k, u.iy); }
    const pb = clamp((v - 2.0) / 10, 0, 0.96);
    const lam = 1.6 + v / 3.5;
    // Devrilerek yere çakılan bina komple parçalansın (tiltDmg yüksek)
    const isCrash = theta > 0.15 || c.cutFall || v > 7.5;
    const tiltDmg = isCrash ? clamp(0.62 + 0.35 * Math.sin(Math.min(Math.max(theta, 0.5), 1.4)) * clamp(v / 7, 0.5, 1.3), 0.65, 0.96) : 0;
    const dummy = new THREE.Object3D();
    let broken = 0, debris = 0;
    const maxDebris = isCrash ? 180 : 90;
    const wipe = (u, x, y, z) => {
      u.active = false; vw._hideVoxel(u); broken++;
      if (debris < maxDebris && vw.dynamicDebris.length < vw.maxDynamicDebris && Math.random() < 0.65) {
        debris++;
        vw.spawnLooseVoxel(x, y, z, u.type, { x: c.com.x, y: Math.max(0.5, y - 1), z: c.com.z }, 0.5, 4, 28 + v * 1.5);
      }
    };
    for (const u of c.list) {
      if (!u.active) continue;
      this._place(c, u.x, u.y, u.z, p);
      const L = u.iy - bottomIy.get(`${u.ix},${u.iz}`);
      let pLocal = pb * Math.exp(-L / lam);
      if (contact) { const dc = Math.hypot(p.x - contact.x, p.z - contact.z); pLocal = Math.min(0.98, pLocal + tiltDmg * 0.55 * Math.exp(-dc / (3 + v * 0.6))); }
      const pd = 1 - (1 - pLocal) * (1 - tiltDmg);
      if (Math.random() < pd) { wipe(u, p.x, p.y, p.z); continue; }
      // Yeni ızgara konumu
      const nix = Math.round(p.x / S), niz = Math.round(p.z / S);
      const niy = theta === 0 ? Math.ceil((u.iy * S + c.oy0 + c.oy1) / S - 1e-6) : Math.floor(p.y / S);
      const nk = key(nix, niy, niz);
      const th = vw.terrain.heightAt(nix * S, niz * S);
      const ex = vw.voxels.get(nk);
      if (ex && ex.active) {
        // Yere çakılırken önünde/altında başka bir binanın küpü varsa ve hızı yeterliyse onu da kırar
        if (v >= 3.2 && ex.groundCell === undefined && c.crushed < Math.min(2200, Math.max(180, Math.floor(c.n * 0.42)))) {
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
      // Sağlam kalan parçalar havada asılı kalmasın diye tekrar tohum kuyruğuna eklenir (zincirleme yıkım)
      if (isCrash) this.seeds.add(nk);
    }
    c.meshes.forEach(m => { m.quaternion.identity(); m.position.set(0, 0, 0); m.instanceMatrix.needsUpdate = true; });
    vw.destroyedVoxels += broken;

    // Toz, ses ve sarsıntı (büyüklük ve hıza göre)
    const at = contact || new THREE.Vector3(c.com.x, c.lowBy + c.oy0 + c.oy1, c.com.z);
    vw.particleSystem.createExplosion(at, Math.min(11, 2.5 + c.n / 3000 + v / 6), 0x9c9484);
    if (isCrash && vw.particleSystem.createDust) {
      for (let i = 0; i < 4; i++) {
        vw.particleSystem.createDust(new THREE.Vector3(
          at.x + (Math.random() - 0.5) * 6,
          at.y + Math.random() * 2,
          at.z + (Math.random() - 0.5) * 6
        ));
      }
    }
    sound.playExplosion(Math.min(2.2, 0.6 + c.n / 7000 + v / 35));
    if (this.onShake) this.onShake(Math.min(0.85, 0.1 + c.n / 12000 + v / 75));
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
