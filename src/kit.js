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

  // Yazılı tabela: kanvas dokulu düzlem. neon: true ise arka plansız ışıklı oyun neon tabelası
  sign(text, o, x, y, z, rotY = 0) {
    const isNeon = !!o.neon;
    const neonColor = o.color ?? o.bg ?? o.fg ?? 0x38bdf8;
    const key = isNeon ? `${text}|neon|${neonColor}|${o.w}|${o.h}` : `${text}|${o.bg}|${o.fg}|${o.w}|${o.h}`;
    let mat = this.signCache.get(key);
    if (!mat) {
      let map = null;
      try {
        const c = document.createElement('canvas');
        if (isNeon) {
          c.width = 1024; c.height = Math.max(128, Math.round(1024 * o.h / o.w));
          const g = c.getContext('2d');
          g.clearRect(0, 0, c.width, c.height); // Arka plan yok (tamamen şeffaf)
          const neonHex = '#' + (neonColor).toString(16).padStart(6, '0');
          const fontSize = Math.round(c.height * 0.52);
          g.font = `900 italic ${fontSize}px 'Arial Black', 'Impact', sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          const cx = c.width / 2, cy = c.height / 2;

          // 1. Dış geniş neon parlama halesi (glow)
          g.shadowColor = neonHex; g.shadowBlur = 36;
          g.strokeStyle = neonHex; g.lineWidth = 14;
          g.strokeText(text, cx, cy);

          // 2. Orta yoğun neon çizgisi
          g.shadowBlur = 18; g.lineWidth = 7;
          g.strokeText(text, cx, cy);

          // 3. İç akkor beyaz çekirdek (parlayan ampul teli efekti)
          g.shadowColor = '#ffffff'; g.shadowBlur = 6;
          g.fillStyle = '#ffffff';
          g.fillText(text, cx, cy);

          // Neon ince çerçeve çizgisi (ışıklı neon tüp konturu)
          g.shadowColor = neonHex; g.shadowBlur = 18;
          g.strokeStyle = neonHex; g.lineWidth = 4;
          g.strokeRect(16, 8, c.width - 32, c.height - 16);

          map = new THREE.CanvasTexture(c);
          map.colorSpace = THREE.SRGBColorSpace;
          mat = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: false });
        } else {
          c.width = 512; c.height = Math.max(64, Math.round(512 * o.h / o.w));
          const g = c.getContext('2d');
          g.fillStyle = '#' + o.bg.toString(16).padStart(6, '0'); g.fillRect(0, 0, c.width, c.height);
          g.strokeStyle = '#' + (o.border ?? o.fg).toString(16).padStart(6, '0'); g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
          g.fillStyle = '#' + o.fg.toString(16).padStart(6, '0'); g.font = `bold ${Math.round(c.height * 0.52)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(text, c.width / 2, c.height / 2 + 3, c.width - 40);
          map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
          mat = map ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshBasicMaterial({ color: o.bg });
        }
      } catch (e) { mat = new THREE.MeshBasicMaterial({ color: neonColor }); }
      this.signCache.set(key, mat);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
    m.position.set(x, y, z); m.rotation.y = rotY;
    this.world.scene.add(m);
    this.world.decor.push(m);
    if (!isNeon) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), new THREE.MeshBasicMaterial({ color: 0x1b1d22 }));
      back.position.copy(m.position); back.rotation.y = rotY + Math.PI; back.translateZ(0.01);
      this.world.scene.add(back);
      this.world.decor.push(back);
    }
    return m;
  }
}
