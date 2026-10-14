import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { ROADS, intersections, paintSegments, onRoadFast } from './cityplan.js';

// ─────────────────────────────────────────────────────────────────────────────
// TRAFİK IŞIKLARI VE YOL TABELALARI
//  • Her kavşakta (iki caddenin kesiştiği yer) köşelere, YOLUN KENARINA (asfaltın dışına, kaldırıma) ışık direkleri konur.
//    Direk ve kutu küptür (kırılabilir); kırmızı/sarı/yeşil camlar ince yüzeylerdir ve duruma göre yanar.
//  • Işıklar 30 sn'lik döngüyle çalışır: kuzey-güney 12 sn yeşil + 2 sn sarı, 1 sn hepsi kırmızı, doğu-batı 12 sn yeşil + 2 sn sarı, 1 sn kırmızı.
//    Trafikteki araçlar kırmızıda ve (duramayacak kadar yakın değillerse) sarıda durma çizgisinde bekler (bkz. cars.js).
//  • Tabelalar (dur, park, yön, dikkat) yol kenarında küp direk + küp levha olarak durur; gece levhalar ışıklı malzemelerle parlar.
// ─────────────────────────────────────────────────────────────────────────────
const CYCLE = 30;
const S = 0.5;
const K = 3;                       // eski birim → ince ızgara
const { IRON, BLACK, BRICK, WHITE, GOLD, LAMP_BLUE, LAMP_GREEN } = PALETTE;

export function signalState(sig, ns, t) {
  const u = (t + sig.off) % CYCLE, a = ns ? u : (u + 15) % CYCLE;
  return a < 12 ? 'green' : a < 14 ? 'yellow' : 'red';
}

const COL = { red: new THREE.Color(0xff2a2a), yellow: new THREE.Color(0xffcc22), green: new THREE.Color(0x2cff6a), off: new THREE.Color(0x1b1d22) };

// Seviye kurulumunda çağrılır (LevelManager nesnesiyle): direkleri, tabelaları ve world.signals listesini oluşturur
export function buildTraffic(lm) {
  const world = lm.world, b = lm.b;
  world.signals = [];
  const vput = (ix, iy, iz, mat) => { world.voxels.delete(`${ix},${iy},${iz}`); world.setVoxel(ix, iy, iz, mat); };
  const free = (x, z, m = 1) => !b.blocked(x, z, m) && !onRoadFast(x, z, 0) && !lm._nearDoor(x, z, 2.5);   // x,z eski birim

  // ── Kavşaklar: dört köşede yol dışı direk; her direk bir yaklaşımı gösterir ──
  const heads = [];            // { ix, iz, dir: [dx, dz], sig, ns, keys }
  const U = 0.75;
  intersections().forEach((it, idx) => {
    const hwNS = (it.ns.w - 1) / 2 + 2.2, hwEW = (it.ew.w - 1) / 2 + 2.2;      // direk, asfaltın 1.7 birim dışında
    const sig = { x: it.x, z: it.z, off: (idx * 7) % CYCLE, heads: [] };
    const corners = [
      { sx: 1, sz: -1, dir: [0, -1], ns: true, has: it.from.n },     // doğu-kuzey köşe: kuzeyden gelen (güneye giden) trafiğe bakar
      { sx: -1, sz: 1, dir: [0, 1], ns: true, has: it.from.s },      // batı-güney köşe: güneyden gelene bakar
      { sx: -1, sz: -1, dir: [-1, 0], ns: false, has: it.from.w },   // batı-kuzey köşe: batıdan gelene bakar
      { sx: 1, sz: 1, dir: [1, 0], ns: false, has: it.from.e }       // doğu-güney köşe: doğudan gelene bakar
    ];
    let placed = 0;
    for (const c of corners) {
      if (!c.has) continue;
      const px = it.x + c.sx * hwNS, pz = it.z + c.sz * hwEW;
      if (!free(px, pz, 0.5)) continue;
      const ix = Math.round(px * U / S), iz = Math.round(pz * U / S);
      for (let iy = 1; iy <= 6; iy++) vput(ix, iy, iz, IRON);                  // direk (3 m)
      for (let iy = 7; iy <= 9; iy++) vput(ix, iy, iz, BLACK);                 // ışık kutusu (1.5 m)
      vput(ix, 10, iz, IRON);
      const h = { ix, iz, dir: c.dir, ns: c.ns, sig, key: `${ix},8,${iz}` };
      sig.heads.push(h); heads.push(h); placed++;
    }
    if (placed) world.signals.push(sig);
  });

  // Işık camları: tüm kafaların 3 camı tek bir InstancedMesh (renkler her 0.25 sn güncellenir)
  const lens = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), Math.max(1, heads.length * 3));
  lens.frustumCulled = false; lens.count = heads.length * 3;
  const d = new THREE.Object3D();
  heads.forEach((h, i) => {
    for (let k = 0; k < 3; k++) {                  // üstten alta: kırmızı, sarı, yeşil
      d.position.set(h.ix * S + h.dir[0] * 0.26, (9 - k) * S + S / 2, h.iz * S + h.dir[1] * 0.26);
      d.rotation.set(0, Math.atan2(h.dir[0], h.dir[1]), 0);
      d.updateMatrix(); lens.setMatrixAt(i * 3 + k, d.matrix); lens.setColorAt(i * 3 + k, COL.off);
    }
  });
  world.scene.add(lens);
  world.decor.push(lens);
  world.trafficLens = { mesh: lens, heads };

  // ── Tabelalar: yol kenarında direk + 3x3 levha ──
  const PATTERNS = {
    dur: [BRICK, BRICK, BRICK, BRICK, WHITE, BRICK, BRICK, BRICK, BRICK],
    park: [LAMP_BLUE, LAMP_BLUE, LAMP_BLUE, LAMP_BLUE, WHITE, LAMP_BLUE, LAMP_BLUE, WHITE, LAMP_BLUE],
    yon: [LAMP_GREEN, LAMP_GREEN, LAMP_GREEN, WHITE, WHITE, WHITE, LAMP_GREEN, LAMP_GREEN, LAMP_GREEN],
    dikkat: [GOLD, GOLD, GOLD, GOLD, BLACK, GOLD, GOLD, GOLD, GOLD]
  };
  const kinds = Object.keys(PATTERNS);
  let n = 0, signs = 0;
  for (const r of ROADS) {
    if (!r.graph || r.lanes !== 1 || r.name === 'site') continue;
    for (const sg of paintSegments(r)) {
      const a0 = r.ns ? sg.z0 : sg.x0, a1 = r.ns ? sg.z1 : sg.x1, half = (r.w - 1) / 2 + 2.8;
      for (let a = a0 + 14 + (n % 7) * 3; a < a1 - 14; a += 38) {
        n++;
        const side = n % 2 ? 1 : -1;
        const px = r.ns ? r.x0 + side * half : a, pz = r.ns ? a : r.z0 + side * half;
        if (!free(px, pz, 1)) continue;
        // kavşağa 12 birimden yakın olmasın (ışık direkleri ile karışmasın)
        if (intersections().some(it => Math.hypot(it.x - px, it.z - pz) < 12)) continue;
        const ix = Math.round(px * U / S), iz = Math.round(pz * U / S), pat = PATTERNS[kinds[n % kinds.length]];
        for (let iy = 1; iy <= 7; iy++) vput(ix, iy, iz, IRON);
        // levha: yol eksenine dik (sürücüye bakar): ns yolda x boyunca, ew yolda z boyunca 3 geniş
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
          const mat = pat[(2 - row) * 3 + col];
          const ox = r.ns ? col - 1 : 0, oz = r.ns ? 0 : col - 1;
          vput(ix + ox, 8 + row, iz + oz, mat);
        }
        signs++;
      }
    }
  }
  world.signCount = signs;
}

// Çalışma zamanı: ışıkların renklerini günceller; kırık direklerin camlarını gizler
export class TrafficLights {
  constructor(world) {
    this.world = world; this.t = 0; this.acc = 0; this.checkT = 0;
    this.update(0);
  }
  update(dt) {
    this.t += dt; this.acc -= dt; this.checkT -= dt;
    const tl = this.world.trafficLens;
    if (!tl || this.acc > 0) return;
    this.acc = 0.25;
    const m = tl.mesh;
    tl.heads.forEach((h, i) => {
      const st = signalState(h.sig, h.ns, this.t);
      m.setColorAt(i * 3 + 0, st === 'red' ? COL.red : COL.off);
      m.setColorAt(i * 3 + 1, st === 'yellow' ? COL.yellow : COL.off);
      m.setColorAt(i * 3 + 2, st === 'green' ? COL.green : COL.off);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (this.checkT <= 0) {            // kutu kırıldıysa camlar kaybolur
      this.checkT = 1;
      const d = new THREE.Object3D(); d.scale.set(0, 0, 0); d.updateMatrix();
      tl.heads.forEach((h, i) => {
        if (h.dead) return;
        const v = this.world.voxels.get(h.key);
        if (!v || !v.active) { h.dead = true; for (let k = 0; k < 3; k++) m.setMatrixAt(i * 3 + k, d.matrix); m.instanceMatrix.needsUpdate = true; }
      });
    }
  }
  // Araç için: bu kenardan (yaklaşan yön) bu kavşakta ışık durumu
  stateFor(sig, edge) { return signalState(sig, Math.abs(edge.d[1]) > Math.abs(edge.d[0]), this.t); }
}
