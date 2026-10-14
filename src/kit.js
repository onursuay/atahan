import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { PROP_HALF } from './props.js';

// ─────────────────────────────────────────────────────────────────────────────
// İÇ MEKAN ALET ÇANTASI: voxel koordinatlarıyla (0.5 m) kutu koy/sil, tutulabilir eşya yerleştir, yazılı tabela (kanvas dokulu düzlem) as.
// mall.js (AVM dükkânları, restoranlar) ve specialty.js (banka, restoran, şirket binası) kullanır.
// ─────────────────────────────────────────────────────────────────────────────
const S = 0.5;
export const P = PALETTE;

export class Kit {
  constructor(world) { this.world = world; this.signCache = new Map(); }

  // Voxel indeks kutusu (dahil); varsa üstüne yazar
  put(x0, y0, z0, x1, y1, z1, mat) {
    const w = this.world, lo = Math.min, hi = Math.max;
    for (let x = lo(x0, x1); x <= hi(x0, x1); x++) for (let y = lo(y0, y1); y <= hi(y0, y1); y++) for (let z = lo(z0, z1); z <= hi(z0, z1); z++) {
      w.voxels.delete(`${x},${y},${z}`); w.setVoxel(x, y, z, mat);
    }
  }
  clr(x0, y0, z0, x1, y1, z1) {
    const w = this.world, lo = Math.min, hi = Math.max;
    for (let x = lo(x0, x1); x <= hi(x0, x1); x++) for (let y = lo(y0, y1); y <= hi(y0, y1); y++) for (let z = lo(z0, z1); z <= hi(z0, z1); z++) w.voxels.delete(`${x},${y},${z}`);
  }

  // Tutulabilir eşya: x, z metre merkez; bottomY metre = altı. opts: { yaw, color, hung }
  prop(kind, x, bottomY, z, opts = {}) {
    this.world.propSpawns.push({ kind, x, y: bottomY + (opts.hung ? 0 : PROP_HALF[kind]), z, ...opts });
  }

  // Yazılı tabela: kanvas dokulu düzlem (voxel yazı yerine). rotY: 0 = +z'ye bakar, π/2 = +x'e bakar...
  sign(text, o, x, y, z, rotY = 0) {
    const key = `${text}|${o.bg}|${o.fg}|${o.w}|${o.h}`;
    let mat = this.signCache.get(key);
    if (!mat) {
      let map = null;
      try {
        const c = document.createElement('canvas'); c.width = 512; c.height = Math.max(64, Math.round(512 * o.h / o.w));
        const g = c.getContext('2d');
        g.fillStyle = '#' + o.bg.toString(16).padStart(6, '0'); g.fillRect(0, 0, c.width, c.height);
        g.strokeStyle = '#' + (o.border ?? o.fg).toString(16).padStart(6, '0'); g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
        g.fillStyle = '#' + o.fg.toString(16).padStart(6, '0'); g.font = `bold ${Math.round(c.height * 0.52)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, c.width / 2, c.height / 2 + 3, c.width - 40);
        map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
      } catch (e) { map = null; }
      mat = map ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshBasicMaterial({ color: o.bg });
      this.signCache.set(key, mat);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
    m.position.set(x, y, z); m.rotation.y = rotY;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), new THREE.MeshBasicMaterial({ color: 0x1b1d22 })); back.position.copy(m.position); back.rotation.y = rotY + Math.PI; back.translateZ(0.01); back.position.add(new THREE.Vector3(0, 0, 0));
    this.world.scene.add(m, back);
    this.world.decor.push(m, back);
    return m;
  }
}
