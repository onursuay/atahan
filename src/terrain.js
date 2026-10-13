import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VOXEL_SIZE } from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// ZEMİN = İKİ AYRI KATMAN
//  • ÜST KATMAN (GROUND_Y - 0.5 .. GROUND_Y): yol/kumsal/iskele kaplaması. Patlama ve çekiçle
//    kırılır; kırılan hücre doku yüzeyinden silinir, parçaları dağılır, çukur oluşur.
//  • ALT KATMAN / TABAN KAYASI (BEDROCK_Y üstü): hiçbir şeyle kırılamaz, delinemez, yok edilemez.
//    Üst katman kırılınca yükselip boşluğu kapatmaz; çukurun tabanı olarak kalır, oyuncu üstünde yürür.
// Her ikisi de voxel nesnesi değil: 0.25 m'lik hücre maskeleridir (yüz binlerce küp yerine).
// ─────────────────────────────────────────────────────────────────────────────
export const GROUND_Y = 0.5;               // üst katmanın üst yüzü
export const TOP_LAYER_THICKNESS = 0.5;
export const BEDROCK_Y = GROUND_Y - TOP_LAYER_THICKNESS; // alt katmanın üst yüzü (çukur tabanı)

const CELL = VOXEL_SIZE;  // hücre boyutu = voxel boyutu
const PX_PER_M = 16;      // üst katman dokusunun çözünürlüğü
const DEPTH_BELOW = -2.5; // kıyıda görünen yan yüzeylerin alt sınırı

export class Terrain {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.rects = [];      // { x0, z0, x1, z1, mat }
    this.objects = [];
    this.bodies = [];
    this.land = null;     // 1: bu hücrenin altında taban kayası var
    this.top = null;      // 1: üst katman sağlam, 0: kırık (çukur)
    this.matIdx = null;   // üst katman malzemesi (matList indeksi)
    this.rim = null;      // 1: çukur kenarındaki sağlam hücre voxel olarak da çizildi
    this.matList = [];
    this.bounds = null;
    this.hq = null;       // hücre başına tepe yüksekliği (0.25 m'lik adımlar)
    this.heightFn = null; // (x, z) -> metre: yalnız çim (isGrass) hücrelere uygulanır
    this.dirty = false;   // doku güncellenmeli
  }

  // Metre cinsinden dikdörtgen bölge ekle (sonra eklenen öncekinin üstüne boyanır)
  addRect(x0, z0, x1, z1, mat) {
    this.rects.push({
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      mat
    });
  }

  clear() {
    this.objects.forEach(o => {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.bodies.forEach(b => this.physicsWorld.removeBody(b));
    this.objects = [];
    this.bodies = [];
    this.rects = [];
    this.land = this.top = this.matIdx = this.rim = this.hq = null;
    this.bounds = null;
    this.matList = [];
    this.canvas = null;
    this.tex = null;
  }

  // ── Hücre sorguları ──
  cellIndex(x, z) {
    const b = this.bounds;
    if (!b) return -1;
    const c = Math.floor((x - b.minX) / CELL);
    const r = Math.floor((z - b.minZ) / CELL);
    if (c < 0 || r < 0 || c >= b.cols || r >= b.rows) return -1;
    return r * b.cols + c;
  }

  cellCenter(idx) {
    const b = this.bounds;
    const c = idx % b.cols, r = Math.floor(idx / b.cols);
    return { x: b.minX + (c + 0.5) * CELL, z: b.minZ + (r + 0.5) * CELL };
  }

  isLand(x, z) { const i = this.cellIndex(x, z); return i >= 0 && this.land[i] === 1; }
  topIntactAt(x, z) { const i = this.cellIndex(x, z); return i >= 0 && this.top[i] === 1; }

  // ── Tepeler: hücre başına yükseklik kayması ──
  _h(i) { return this.hq ? this.hq[i] * CELL : 0; }
  topYAt(x, z) { const i = this.cellIndex(x, z); return i < 0 ? GROUND_Y : GROUND_Y + this._h(i); }
  bedYAt(x, z) { const i = this.cellIndex(x, z); return i < 0 ? BEDROCK_Y : BEDROCK_Y + this._h(i); }
  topYIdx(i) { return GROUND_Y + this._h(i); }
  bedYIdx(i) { return BEDROCK_Y + this._h(i); }

  // Kutu (x ± halfW, z ± halfW, ayak yüksekliği feet) zemin katmanlarına giriyor mu?
  // Alt katman (taban kayası) her kara hücresinde katıdır; üst katman yalnız sağlam hücrelerde.
  solidAt(x, feet, z, halfW) {
    if (!this.land) return false;
    const b = this.bounds;
    const c0 = Math.floor((x - halfW - b.minX) / CELL);
    const c1 = Math.floor((x + halfW - 1e-4 - b.minX) / CELL);
    const r0 = Math.floor((z - halfW - b.minZ) / CELL);
    const r1 = Math.floor((z + halfW - 1e-4 - b.minZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= b.rows) continue;
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= b.cols) continue;
        const i = r * b.cols + c;
        if (this.land[i] !== 1) continue;
        const h = this._h(i);
        if (feet < BEDROCK_Y + h - 1e-4) return true;
        if (this.top[i] === 1 && feet < GROUND_Y + h - 1e-4) return true;
      }
    }
    return false;
  }

  // Yürünebilir yüzey yüksekliği: sağlam üst katman -> GROUND_Y, çukur -> BEDROCK_Y, kara yoksa -Infinity
  heightAt(x, z) {
    const i = this.cellIndex(x, z);
    if (i < 0 || this.land[i] !== 1) return -Infinity;
    return this.top[i] === 1 ? GROUND_Y + this._h(i) : BEDROCK_Y + this._h(i);
  }

  _overlaps(mask, x, z, halfW) {
    if (!mask) return false;
    const b = this.bounds;
    const c0 = Math.floor((x - halfW - b.minX) / CELL);
    const c1 = Math.floor((x + halfW - 1e-4 - b.minX) / CELL);
    const r0 = Math.floor((z - halfW - b.minZ) / CELL);
    const r1 = Math.floor((z + halfW - 1e-4 - b.minZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= b.rows) continue;
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= b.cols) continue;
        if (mask[r * b.cols + c] === 1) return true;
      }
    }
    return false;
  }

  // Taban kayası kutunun altında mı (kırılamaz alt katman)
  overlapsLand(x, z, halfW) { return this._overlaps(this.land, x, z, halfW); }
  // Sağlam üst katman kutunun altında mı
  overlapsTop(x, z, halfW) { return this._overlaps(this.top, x, z, halfW); }

  // Yarıçap içindeki sağlam üst katman hücrelerini kırar. Taban kayasına dokunmaz.
  // Kırılan hücrelerin listesini döndürür: { idx, x, z, mat }
  breakInSphere(center, radius, jagged = 0.25) {
    if (!this.top) return [];
    const b = this.bounds;
    const rXZ = radius;
    const c0 = Math.max(0, Math.floor((center.x - rXZ - b.minX) / CELL));
    const c1 = Math.min(b.cols - 1, Math.floor((center.x + rXZ - b.minX) / CELL));
    const r0 = Math.max(0, Math.floor((center.z - rXZ - b.minZ) / CELL));
    const r1 = Math.min(b.rows - 1, Math.floor((center.z + rXZ - b.minZ) / CELL));

    const broken = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * b.cols + c;
        if (this.top[idx] !== 1) continue;
        const x = b.minX + (c + 0.5) * CELL, z = b.minZ + (r + 0.5) * CELL;
        // Üst katmanın bu hücredeki dikey aralığına en yakın nokta
        const yc = Math.min(this.topYIdx(idx), Math.max(this.bedYIdx(idx), center.y));
        const dy = center.y - yc;
        const rr = Math.sqrt(Math.max(0, radius * radius - dy * dy));
        if (rr <= 0) continue;
        // Kenarlar düzensiz: kırık, pürüzlü bir çukur
        const limit = rr * (1 - jagged + Math.random() * jagged * 1.4);
        if (Math.hypot(x - center.x, z - center.z) <= limit) {
          broken.push({ idx, x, z, mat: this.matList[this.matIdx[idx]] });
        }
      }
    }
    broken.forEach(h => this._breakCell(h.idx));
    return broken;
  }

  // Tek hücreyi kır (voxel kenar küpü yok edildiğinde de çağrılır)
  breakCell(idx) {
    if (!this.top || this.top[idx] !== 1) return false;
    this._breakCell(idx);
    return true;
  }

  _breakCell(idx) {
    this.top[idx] = 0;
    // Dokudan sil: altından taban kayası görünür
    const b = this.bounds;
    const c = idx % b.cols, r = Math.floor(idx / b.cols);
    if (this.g) {
      const px = c * CELL * PX_PER_M, pz = r * CELL * PX_PER_M;
      this.g.clearRect(px - 0.5, pz - 0.5, CELL * PX_PER_M + 1, CELL * PX_PER_M + 1);
    }
    this.dirty = true;
  }

  // Bir sonraki karede dokuyu GPU'ya gönder
  flush() {
    if (this.dirty && this.tex) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  build() {
    if (this.rects.length === 0) return;

    // Sınırlar: hücre sınırları voxel ızgarasına oturur (voxel kenarları 0.125 + k*0.25 konumundadır)
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    this.rects.forEach(r => {
      minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
      minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
    });
    minX = Math.floor(minX) - 1 - VOXEL_SIZE / 2; minZ = Math.floor(minZ) - 1 - VOXEL_SIZE / 2;
    maxX = Math.ceil(maxX) + 1;          maxZ = Math.ceil(maxZ) + 1;
    const cols = Math.ceil((maxX - minX) / CELL);
    const rows = Math.ceil((maxZ - minZ) / CELL);
    this.bounds = { minX, minZ, maxX: minX + cols * CELL, maxZ: minZ + rows * CELL, cols, rows };

    this.land = new Uint8Array(cols * rows);
    this.top = new Uint8Array(cols * rows);
    this.rim = new Uint8Array(cols * rows);
    this.matIdx = new Uint8Array(cols * rows);
    this.matList = [];
    const matId = (m) => {
      let i = this.matList.indexOf(m);
      if (i < 0) { this.matList.push(m); i = this.matList.length - 1; }
      return i;
    };

    const cellRange = (r) => ({
      c0: Math.round((r.x0 - minX) / CELL), c1: Math.round((r.x1 - minX) / CELL),
      r0: Math.round((r.z0 - minZ) / CELL), r1: Math.round((r.z1 - minZ) / CELL)
    });

    this.rects.forEach(r => {
      const { c0, c1, r0, r1 } = cellRange(r);
      const mi = matId(r.mat);
      for (let rz = r0; rz < r1; rz++) {
        for (let cx = c0; cx < c1; cx++) {
          const i = rz * cols + cx;
          this.land[i] = 1; this.top[i] = 1; this.matIdx[i] = mi;
        }
      }
    });

    // Tepeler: yalnız çim hücrelerde yükseklik (yollar ve binalar düz zeminde kalır)
    this.hq = new Int16Array(cols * rows);
    if (this.heightFn) {
      for (let i = 0; i < cols * rows; i++) {
        if (this.land[i] !== 1) continue;
        const c = i % cols, r = Math.floor(i / cols);
        const hm = this.heightFn(minX + (c + 0.5) * CELL, minZ + (r + 0.5) * CELL, this.matList[this.matIdx[i]]);
        this.hq[i] = Math.max(0, Math.round(hm / CELL));
      }
    }

    // Eğim sınırı: komşu hücreler arası fark en çok 0.25 m (yürünebilir, basamak çıkılabilir)
    if (this.heightFn) {
      const hq = this.hq, L = this.land;
      const M = this.matIdx; // eğim sınırı yalnız aynı malzemeli komşular arasında (rampa/üst geçit yolu kenardaki zeminden ayrışabilir)
      const isRoad = (i) => this.matList[M[i]].name.startsWith('Asfalt'); // yol rampaları (üst geçit) kendi eğimini taşır
      const lim = (i, j) => { if (L[i] === 1 && L[j] === 1 && M[i] === M[j] && !isRoad(i) && hq[i] > hq[j] + 1) hq[i] = hq[j] + 1; };
      for (let pass = 0; pass < 24; pass++) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (c > 0) lim(i, i - 1);
          if (r > 0) lim(i, i - cols);
        }
        for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
          const i = r * cols + c;
          if (c < cols - 1) lim(i, i + 1);
          if (r < rows - 1) lim(i, i + cols);
        }
      }
    }

    // ── ÜST KATMAN DOKUSU: her 0.25 m'lik hücre hafif farklı tonda ──
    const W = Math.ceil(cols * CELL * PX_PER_M);
    const H = Math.ceil(rows * CELL * PX_PER_M);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    this.canvas = canvas; this.g = g;
    const cellPx = CELL * PX_PER_M;

    const shade = (hex, f) => {
      const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
      const gg = Math.min(255, Math.round(((hex >> 8) & 255) * f));
      const bb = Math.min(255, Math.round((hex & 255) * f));
      return `rgb(${r},${gg},${bb})`;
    };

    this.rects.forEach(r => {
      const color = r.mat.color;
      const { c0, c1, r0, r1 } = cellRange(r);
      for (let rz = r0; rz < r1; rz++) {
        for (let cx = c0; cx < c1; cx++) {
          g.fillStyle = shade(color, 0.93 + Math.random() * 0.14);
          g.fillRect(cx * cellPx, rz * cellPx, Math.ceil(cellPx), Math.ceil(cellPx));
        }
      }

      // Asfalt yollar: kaldırım kenarı + kesik orta şerit
      if (r.mat.name.startsWith('Asfalt')) {
        const w = r.x1 - r.x0, d = r.z1 - r.z0;
        const alongX = w >= d;
        const long = alongX ? w : d, short = alongX ? d : w;
        if (short >= 3 && long >= 12) {
          const px0 = c0 * cellPx, pz0 = r0 * cellPx, px1 = c1 * cellPx, pz1 = r1 * cellPx;
          g.fillStyle = '#cbd5e1';
          const edge = cellPx;
          if (alongX) {
            g.fillRect(px0, pz0, px1 - px0, edge);
            g.fillRect(px0, pz1 - edge, px1 - px0, edge);
          } else {
            g.fillRect(px0, pz0, edge, pz1 - pz0);
            g.fillRect(px1 - edge, pz0, edge, pz1 - pz0);
          }
          g.fillStyle = '#facc15';
          const dash = 1.5 * PX_PER_M;
          if (alongX) {
            const cz = (pz0 + pz1) / 2 - edge / 2;
            for (let x = px0 + dash; x < px1 - dash; x += dash * 2) g.fillRect(x, cz, dash, edge);
          } else {
            const cxp = (px0 + px1) / 2 - edge / 2;
            for (let z = pz0 + dash; z < pz1 - dash; z += dash * 2) g.fillRect(cxp, z, edge, dash);
          }
        }
      }
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.tex = tex;

    this._buildTopMesh(tex);

    this._buildBedrock();
    this._buildSides();

    // Fizik: yalnız taban kayası (kırılamaz). Üst katman üzerindeki çarpışmayı kod yönetir.
    this.rects.forEach(r => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(w / 2, 1.0, d / 2)),
        position: new CANNON.Vec3(cx, BEDROCK_Y - 1.0, cz)
      });
      this.physicsWorld.addBody(body);
      this.bodies.push(body);
    });
  }

  // Üst katman yüzeyi: aynı yükseklikteki ardışık hücreler tek dörtgen (tepelerde basamaklı)
  _buildTopMesh(tex) {
    const b = this.bounds;
    const planeW = b.cols * CELL, planeH = b.rows * CELL;
    const pos = [], uv = [], idx = [];
    let v = 0;
    for (let r = 0; r < b.rows; r++) {
      let c = 0;
      while (c < b.cols) {
        const i0 = r * b.cols + c;
        if (this.land[i0] !== 1) { c++; continue; }
        const hq = this.hq[i0];
        let c2 = c;
        while (c2 < b.cols && this.land[r * b.cols + c2] === 1 && this.hq[r * b.cols + c2] === hq) c2++;
        const x0 = b.minX + c * CELL, x1 = b.minX + c2 * CELL;
        const z0 = b.minZ + r * CELL, z1 = z0 + CELL;
        const y = GROUND_Y + hq * CELL + 0.004;
        pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        const u0 = (x0 - b.minX) / planeW, u1 = (x1 - b.minX) / planeW;
        const t0 = 1 - (z0 - b.minZ) / planeH, t1 = 1 - (z1 - b.minZ) / planeH;
        uv.push(u0, t0, u1, t0, u1, t1, u0, t1);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
        v += 4;
        c = c2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  // Taban kayası yüzeyi: çukur kırılınca görünen koyu, çatlaklı taş (üst katmandan belirgin biçimde farklı)
  _buildBedrock() {
    const b = this.bounds;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const t = tile.getContext('2d');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const f = 0.55 + Math.random() * 0.35;
        const crack = Math.random() < 0.06 ? 0.55 : 1;
        const v = Math.round(78 * f * crack);
        t.fillStyle = `rgb(${v + 6},${v},${v - 6})`;
        t.fillRect(x, y, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(tile);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;

    // Her satırdaki ardışık kara hücreleri tek dörtgende birleştir
    const pos = [], uv = [], idx = [];
    let v = 0;
    const tileM = 8; // doku 8 m'de bir tekrar eder (32 px × 0.25 m)
    for (let r = 0; r < b.rows; r++) {
      let c = 0;
      while (c < b.cols) {
        if (this.land[r * b.cols + c] !== 1) { c++; continue; }
        const hq = this.hq[r * b.cols + c];
        let c2 = c;
        while (c2 < b.cols && this.land[r * b.cols + c2] === 1 && this.hq[r * b.cols + c2] === hq) c2++;
        const x0 = b.minX + c * CELL, x1 = b.minX + c2 * CELL;
        const z0 = b.minZ + r * CELL, z1 = z0 + CELL;
        const by = BEDROCK_Y + hq * CELL;
        pos.push(x0, by, z0, x1, by, z0, x1, by, z1, x0, by, z1);
        uv.push(x0 / tileM, z0 / tileM, x1 / tileM, z0 / tileM, x1 / tileM, z1 / tileM, x0 / tileM, z1 / tileM);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
        v += 4;
        c = c2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }

  // Kıyıdaki yan yüzeyler: üst kısım (üst katman) malzeme renginde, alt kısım taban kayası renginde
  _buildSides() {
    const b = this.bounds;
    const pos = [], col = [], idx = [];
    let v = 0;
    const stone = new THREE.Color(0x3f3a36);
    const quad = (ax, az, bx, bz, y0, y1, color) => {
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      for (let i = 0; i < 4; i++) col.push(color.r, color.g, color.b);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const i = r * b.cols + c;
        if (this.land[i] !== 1) continue;
        const topColor = new THREE.Color(this.matList[this.matIdx[i]].color).multiplyScalar(0.8);
        const top = this.topYIdx(i), bed = this.bedYIdx(i);
        for (const [dc, dr] of dirs) {
          const nc = c + dc, nr = r + dr;
          const inside = nc >= 0 && nr >= 0 && nc < b.cols && nr < b.rows;
          const n = inside ? nr * b.cols + nc : -1;
          const open = !inside || this.land[n] !== 1;
          const x0 = b.minX + c * CELL, z0 = b.minZ + r * CELL;
          let ax, az, bx, bz;
          if (dc === 1)  { ax = x0 + CELL; az = z0;        bx = x0 + CELL; bz = z0 + CELL; }
          if (dc === -1) { ax = x0;        az = z0 + CELL; bx = x0;        bz = z0; }
          if (dr === 1)  { ax = x0 + CELL; az = z0 + CELL; bx = x0;        bz = z0 + CELL; }
          if (dr === -1) { ax = x0;        az = z0;        bx = x0 + CELL; bz = z0; }
          if (open) {
            quad(ax, az, bx, bz, DEPTH_BELOW, bed, stone);
            quad(ax, az, bx, bz, bed, top, topColor);
          } else if (this.topYIdx(n) < top - 1e-6) {
            // Tepe basamağı: komşu hücre daha alçaksa aradaki dik yüzey
            quad(ax, az, bx, bz, this.topYIdx(n), top, topColor);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.objects.push(mesh);
  }
}
