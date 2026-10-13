import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Zemin yüksekliği (metre). Binaların taban katı bu yüksekliğin üstünde başlar.
export const GROUND_Y = 0.5;

const CELL = 0.25;      // Kara maskesi hücre boyutu (voxel boyutuyla aynı)
const PX_PER_M = 24;    // Zemin dokusunun çözünürlüğü
const SLAB_DEPTH = 2.0; // Zemin kaidesinin kalınlığı (denizden bakınca görünen yan yüzey)

// Zemin: yollar, kaldırımlar, kumsal ve iskeleler tek bir kaplamalı yüzeydir (voxel DEĞİL).
// Yüz binlerce küçük küp yerine tek bir doku + görünmez kara maskesi kullanılır.
export class Terrain {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.rects = [];      // { x0, z0, x1, z1, mat }
    this.objects = [];    // sahneye eklenenler
    this.bodies = [];     // fizik gövdeleri
    this.mask = null;
    this.bounds = null;
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
    this.mask = null;
    this.bounds = null;
  }

  // Bu noktanın altında kara var mı?
  isLand(x, z) {
    if (!this.mask) return false;
    const b = this.bounds;
    const cx = Math.floor((x - b.minX) / CELL);
    const cz = Math.floor((z - b.minZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= b.cols || cz >= b.rows) return false;
    return this.mask[cz * b.cols + cx] === 1;
  }

  // Kutu (x ± halfW, z ± halfW) kara hücresine değiyor mu?
  overlapsLand(x, z, halfW) {
    if (!this.mask) return false;
    const b = this.bounds;
    const c0 = Math.floor((x - halfW - b.minX) / CELL);
    const c1 = Math.floor((x + halfW - 1e-4 - b.minX) / CELL);
    const r0 = Math.floor((z - halfW - b.minZ) / CELL);
    const r1 = Math.floor((z + halfW - 1e-4 - b.minZ) / CELL);
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= b.rows) continue;
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= b.cols) continue;
        if (this.mask[r * b.cols + c] === 1) return true;
      }
    }
    return false;
  }

  build() {
    if (this.rects.length === 0) return;

    // Sınırlar
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    this.rects.forEach(r => {
      minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
      minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
    });
    minX = Math.floor(minX) - 1; minZ = Math.floor(minZ) - 1;
    maxX = Math.ceil(maxX) + 1;  maxZ = Math.ceil(maxZ) + 1;
    const cols = Math.ceil((maxX - minX) / CELL);
    const rows = Math.ceil((maxZ - minZ) / CELL);
    this.bounds = { minX, minZ, maxX, maxZ, cols, rows };

    // Kara maskesi
    this.mask = new Uint8Array(cols * rows);
    this.rects.forEach(r => {
      const c0 = Math.round((r.x0 - minX) / CELL), c1 = Math.round((r.x1 - minX) / CELL);
      const r0 = Math.round((r.z0 - minZ) / CELL), r1 = Math.round((r.z1 - minZ) / CELL);
      for (let rz = r0; rz < r1; rz++) {
        for (let cx = c0; cx < c1; cx++) this.mask[rz * cols + cx] = 1;
      }
    });

    // Zemin dokusu: her 0.25 m'lik hücre hafif farklı tonda (kare/voxel görünümü)
    const W = Math.ceil((maxX - minX) * PX_PER_M);
    const H = Math.ceil((maxZ - minZ) * PX_PER_M);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const cellPx = CELL * PX_PER_M;
    const toPx = (x, z) => [(x - minX) * PX_PER_M, (z - minZ) * PX_PER_M];

    const shade = (hex, f) => {
      const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
      const gg = Math.min(255, Math.round(((hex >> 8) & 255) * f));
      const b = Math.min(255, Math.round((hex & 255) * f));
      return `rgb(${r},${gg},${b})`;
    };

    this.rects.forEach(r => {
      const color = r.mat.color;
      const c0 = Math.round((r.x0 - minX) / CELL), c1 = Math.round((r.x1 - minX) / CELL);
      const r0 = Math.round((r.z0 - minZ) / CELL), r1 = Math.round((r.z1 - minZ) / CELL);
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
          const [px0, pz0] = toPx(r.x0, r.z0);
          const [px1, pz1] = toPx(r.x1, r.z1);
          g.fillStyle = '#cbd5e1'; // kaldırım şeridi
          const edge = CELL * PX_PER_M;
          if (alongX) {
            g.fillRect(px0, pz0, px1 - px0, edge);
            g.fillRect(px0, pz1 - edge, px1 - px0, edge);
          } else {
            g.fillRect(px0, pz0, edge, pz1 - pz0);
            g.fillRect(px1 - edge, pz0, edge, pz1 - pz0);
          }
          g.fillStyle = '#facc15'; // orta şerit
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

    // Doku yüzeyi (kara dışı saydam)
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;

    const planeW = maxX - minX, planeH = maxZ - minZ;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((minX + maxX) / 2, GROUND_Y + 0.004, (minZ + maxZ) / 2);
    plane.receiveShadow = true;
    this.scene.add(plane);
    this.objects.push(plane);

    // Kaideler (yan yüzeyler) ve fizik gövdeleri: her bölge için bir kutu
    this.rects.forEach(r => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, SLAB_DEPTH, d),
        new THREE.MeshLambertMaterial({ color: r.mat.color })
      );
      slab.position.set(cx, GROUND_Y - SLAB_DEPTH / 2, cz);
      slab.receiveShadow = true;
      this.scene.add(slab);
      this.objects.push(slab);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(w / 2, SLAB_DEPTH / 2, d / 2)),
        position: new CANNON.Vec3(cx, GROUND_Y - SLAB_DEPTH / 2, cz)
      });
      this.physicsWorld.addBody(body);
      this.bodies.push(body);
    });
  }
}
