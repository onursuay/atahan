import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { ROADS, intersections, paintSegments, onRoadFast } from './cityplan.js';

// ─────────────────────────────────────────────────────────────────────────────
// TRAFİK IŞIKLARI VE YOL TABELALARI
//  • Her kavşakta köşelere ışık direkleri konur.
//  • Yol kenarlarında ise gerçekçi, yuvarlak/sekizgen formda, yüksek çözünürlüklü
//    detaylı grafiklere sahip yol ve trafik tabelaları (DUR, PARK, 50 HIZ SINIRI,
//    YAYA GEÇİDİ, TEHLİKE/DİKKAT, YÖN OKU) yer alır.
//  • Direkler yıkıldığında tabelalar fizik kurallarıyla yere düşer ve yuvarlanır.
// ─────────────────────────────────────────────────────────────────────────────
const CYCLE = 30;
const S = 0.5;
const K = 3;
const { IRON, BLACK } = PALETTE;

export function signalState(sig, ns, t) {
  const u = (t + sig.off) % CYCLE, a = ns ? u : (u + 15) % CYCLE;
  return a < 12 ? 'green' : a < 14 ? 'yellow' : 'red';
}

const COL = {
  red: new THREE.Color(0xff2a2a),
  yellow: new THREE.Color(0xffcc22),
  green: new THREE.Color(0x2cff6a),
  off: new THREE.Color(0x1b1d22)
};

// ─────────────────────────────────────────────────────────────────────────────
// GERÇEKÇİ TRAFİK TABELASI DOKULARI (512x512 Canvas)
// ─────────────────────────────────────────────────────────────────────────────
function createStopSignCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Kırmızı Sekizgen
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4 + Math.PI / 8;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Beyaz Çift Kenarlık
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4 + Math.PI / 8;
    const x = cx + (r - 18) * Math.cos(ang);
    const y = cy + (r - 18) * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  // "DUR" Kalın Trafik Tipografisi
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 135px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DUR', cx, cy + 8);

  return c;
}

function createParkingSignCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Avrupa / Türkiye Trafik Mavisi Daire
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Beyaz Dış Çerçeve
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.stroke();

  // Beyaz 'P' Sembolü
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 240px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', cx - 12, cy + 12);

  return c;
}

function createSpeedLimit50Canvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Beyaz Daire Zemin
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Kalın Kırmızı Halka
  ctx.lineWidth = 46;
  ctx.strokeStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 26, 0, Math.PI * 2);
  ctx.stroke();

  // '50' Hız Sınırı Rakamı
  ctx.fillStyle = '#0f172a';
  ctx.font = '900 175px "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('50', cx, cy + 12);

  return c;
}

function createPedestrianCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Mavi Daire Zemin
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Beyaz Dış Çerçeve
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.stroke();

  // Beyaz İç Üçgen
  const triR = 195;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - triR + 25);
  ctx.lineTo(cx + triR * 0.9, cy + triR * 0.65);
  ctx.lineTo(cx - triR * 0.9, cy + triR * 0.65);
  ctx.closePath();
  ctx.fill();

  // Yaya Silüeti ve Yaya Geçidi Çizgileri
  ctx.fillStyle = '#0f172a';
  for (let i = -3; i <= 3; i++) {
    ctx.fillRect(cx + i * 28 - 9, cy + 74, 18, 40);
  }

  // Yaya Kafası
  ctx.beginPath();
  ctx.arc(cx - 20, cy - 50, 19, 0, Math.PI * 2);
  ctx.fill();

  // Yaya Gövde ve Bacak Çizgileri
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0f172a';

  ctx.beginPath();
  ctx.moveTo(cx - 20, cy - 30);
  ctx.lineTo(cx - 10, cy + 15);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + 15);
  ctx.lineTo(cx + 25, cy + 70);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + 15);
  ctx.lineTo(cx - 38, cy + 70);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 25, cy - 10);
  ctx.lineTo(cx + 15, cy + 10);
  ctx.stroke();

  return c;
}

function createWarningCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Sarı/Amber Daire
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Beyaz Çerçeve
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.stroke();

  // Beyaz Üçgen Zemin
  const triR = 180;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - triR + 15);
  ctx.lineTo(cx + triR * 0.9, cy + triR * 0.65);
  ctx.lineTo(cx - triR * 0.9, cy + triR * 0.65);
  ctx.closePath();
  ctx.fill();

  // Kırmızı Üçgen Kenar
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#dc2626';
  ctx.stroke();

  // Ünlem Sembolü "!"
  ctx.fillStyle = '#0f172a';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(cx - 11, cy - 55, 22, 65, 8);
    ctx.fill();
  } else {
    ctx.fillRect(cx - 11, cy - 55, 22, 65);
  }

  ctx.beginPath();
  ctx.arc(cx, cy + 38, 12, 0, Math.PI * 2);
  ctx.fill();

  return c;
}

function createArrowCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const cx = 256, cy = 256, r = 244;

  // Mavi Daire
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Beyaz Çerçeve
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.stroke();

  // Beyaz Yön Oku
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 140);
  ctx.lineTo(cx + 90, cy - 35);
  ctx.lineTo(cx + 42, cy - 35);
  ctx.lineTo(cx + 42, cy + 125);
  ctx.lineTo(cx - 42, cy + 125);
  ctx.lineTo(cx - 42, cy - 35);
  ctx.lineTo(cx - 90, cy - 35);
  ctx.closePath();
  ctx.fill();

  return c;
}

let SIGN_TEXTURES = null;
function getSignTextures() {
  if (SIGN_TEXTURES) return SIGN_TEXTURES;
  SIGN_TEXTURES = {
    dur: new THREE.CanvasTexture(createStopSignCanvas()),
    park: new THREE.CanvasTexture(createParkingSignCanvas()),
    hiz50: new THREE.CanvasTexture(createSpeedLimit50Canvas()),
    yaya: new THREE.CanvasTexture(createPedestrianCanvas()),
    dikkat: new THREE.CanvasTexture(createWarningCanvas()),
    yon: new THREE.CanvasTexture(createArrowCanvas())
  };
  for (const k in SIGN_TEXTURES) {
    SIGN_TEXTURES[k].colorSpace = THREE.SRGBColorSpace;
    SIGN_TEXTURES[k].anisotropy = 4;
  }
  return SIGN_TEXTURES;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEVİYE KURULUMU: TRAFİK IŞIKLARI & GERÇEKÇİ TABELALAR
// ─────────────────────────────────────────────────────────────────────────────
export function buildTraffic(lm) {
  const world = lm.world, b = lm.b;
  world.signals = [];
  world.signObjects = [];

  const vput = (ix, iy, iz, mat) => { world.voxels.delete(`${ix},${iy},${iz}`); world.setVoxel(ix, iy, iz, mat); };
  const free = (x, z, m = 1) => !b.blocked(x, z, m) && !onRoadFast(x, z, 0) && !lm._nearDoor(x, z, 2.5);

  // ── Kavşaklar: dört köşede yol dışı ışık direkleri ──
  const heads = [];
  const U = 0.75;
  intersections().forEach((it, idx) => {
    const hwNS = (it.ns.w - 1) / 2 + 2.2, hwEW = (it.ew.w - 1) / 2 + 2.2;
    const sig = { x: it.x, z: it.z, off: (idx * 7) % CYCLE, heads: [] };
    const corners = [
      { sx: 1, sz: -1, dir: [0, -1], ns: true, has: it.from.n },
      { sx: -1, sz: 1, dir: [0, 1], ns: true, has: it.from.s },
      { sx: -1, sz: -1, dir: [-1, 0], ns: false, has: it.from.w },
      { sx: 1, sz: 1, dir: [1, 0], ns: false, has: it.from.e }
    ];
    let placed = 0;
    for (const c of corners) {
      if (!c.has) continue;
      const px = it.x + c.sx * hwNS, pz = it.z + c.sz * hwEW;
      if (!free(px, pz, 0.5)) continue;
      const ix = Math.round(px * U / S), iz = Math.round(pz * U / S);
      for (let iy = 1; iy <= 6; iy++) vput(ix, iy, iz, IRON);
      for (let iy = 7; iy <= 9; iy++) vput(ix, iy, iz, BLACK);
      vput(ix, 10, iz, IRON);
      const h = { ix, iz, dir: c.dir, ns: c.ns, sig, key: `${ix},8,${iz}` };
      sig.heads.push(h); heads.push(h); placed++;
    }
    if (placed) world.signals.push(sig);
  });

  // Işık camları (InstancedMesh)
  const lens = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), Math.max(1, heads.length * 3));
  lens.frustumCulled = false; lens.count = heads.length * 3;
  const d = new THREE.Object3D();
  heads.forEach((h, i) => {
    for (let k = 0; k < 3; k++) {
      d.position.set(h.ix * S + h.dir[0] * 0.26, (9 - k) * S + S / 2, h.iz * S + h.dir[1] * 0.26);
      d.rotation.set(0, Math.atan2(h.dir[0], h.dir[1]), 0);
      d.updateMatrix(); lens.setMatrixAt(i * 3 + k, d.matrix); lens.setColorAt(i * 3 + k, COL.off);
    }
  });
  world.scene.add(lens);
  world.decor.push(lens);
  world.trafficLens = { mesh: lens, heads };

  // ── Gerçekçi Yol Tabelaları (Kompakt, Yuvarlak/Sekizgen, Detaylı Simgeler) ──
  const texMap = getSignTextures();
  const signKinds = ['dur', 'park', 'hiz50', 'yaya', 'dikkat', 'yon'];

  // Paylaşımlı Arka Panel ve Metal Kenarlık Materyalleri
  const sharedRimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.6 });
  const sharedBackMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.5 });
  const sharedBracketMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7, metalness: 0.6 });

  // Tabelanın Ön Yüzey Materyalleri
  const frontMaterials = {};
  for (const k of signKinds) {
    frontMaterials[k] = new THREE.MeshStandardMaterial({
      map: texMap[k],
      roughness: 0.25,
      metalness: 0.15
    });
  }

  // Geometriler (Sekizgen DUR için 8 dilim, Yuvarlak diğer tabelalar için 32 dilim)
  const octGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.024, 8);
  octGeo.rotateX(Math.PI / 2);
  const circGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.024, 32);
  circGeo.rotateX(Math.PI / 2);

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
        if (intersections().some(it => Math.hypot(it.x - px, it.z - pz) < 12)) continue;

        const ix = Math.round(px * U / S), iz = Math.round(pz * U / S);
        const kind = signKinds[n % signKinds.length];

        // 1. Sağlam Metal Direk (6 voxel = 3.0 m yükseklik)
        for (let iy = 1; iy <= 6; iy++) vput(ix, iy, iz, IRON);

        // 2. Gerçekçi Kompakt Tabela Grubu
        const signGroup = new THREE.Group();
        const geo = (kind === 'dur') ? octGeo : circGeo;
        const signMesh = new THREE.Mesh(geo, [sharedRimMat, frontMaterials[kind], sharedBackMat]);
        signMesh.castShadow = true;
        signGroup.add(signMesh);

        // Arka Metal Montaj Kelepçesi ve Cıvatalar
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.08), sharedBracketMat);
        bracket.position.set(0, 0, -0.04);
        signGroup.add(bracket);

        // Konumlandırma: Direğin üst ucu (y = 3.3m), caddedeki sürücüye doğru bakar
        const yaw = r.ns ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        signGroup.position.set(ix * S, 3.3, iz * S);
        signGroup.rotation.y = yaw;

        world.scene.add(signGroup);
        world.decor.push(signGroup);

        // Yıkım takibi için nesneyi kaydet
        world.signObjects.push({
          group: signGroup,
          poleKey: `${ix},5,${iz}`,
          dead: false,
          falling: false,
          vel: new THREE.Vector3(0, 0, 0),
          rotVel: new THREE.Vector3(0, 0, 0)
        });

        signs++;
      }
    }
  }
  world.signCount = signs;
}

// ─────────────────────────────────────────────────────────────────────────────
// ÇALIŞMA ZAMANI: TRAFİK IŞIKLARI & YIKILAN TABELALARIN DÜŞÜŞ FİZİĞİ
// ─────────────────────────────────────────────────────────────────────────────
export class TrafficLights {
  constructor(world) {
    this.world = world;
    this.t = 0;
    this.acc = 0;
    this.checkT = 0;
    this.update(0);
  }

  update(dt) {
    this.t += dt;
    this.acc -= dt;
    this.checkT -= dt;

    // Trafik Işıkları Renk Güncellemesi
    const tl = this.world.trafficLens;
    if (tl && this.acc <= 0) {
      this.acc = 0.25;
      const m = tl.mesh;
      tl.heads.forEach((h, i) => {
        const st = signalState(h.sig, h.ns, this.t);
        m.setColorAt(i * 3 + 0, st === 'red' ? COL.red : COL.off);
        m.setColorAt(i * 3 + 1, st === 'yellow' ? COL.yellow : COL.off);
        m.setColorAt(i * 3 + 2, st === 'green' ? COL.green : COL.off);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;

      // Kırılan ışık kutularının camlarını gizle
      if (this.checkT <= 0) {
        this.checkT = 1;
        const d = new THREE.Object3D();
        d.scale.set(0, 0, 0);
        d.updateMatrix();
        tl.heads.forEach((h, i) => {
          if (h.dead) return;
          const v = this.world.voxels.get(h.key);
          if (!v || !v.active) {
            h.dead = true;
            for (let k = 0; k < 3; k++) m.setMatrixAt(i * 3 + k, d.matrix);
            m.instanceMatrix.needsUpdate = true;
          }
        });
      }
    }

    // Yıkılan Tabelaların Gerçekçi Düşüş Fiziği
    if (this.world.signObjects && dt > 0) {
      for (const s of this.world.signObjects) {
        if (s.dead) continue;
        if (!s.falling) {
          const v = this.world.voxels.get(s.poleKey);
          if (!v || !v.active) {
            s.falling = true;
            s.vel.set((Math.random() - 0.5) * 3, 2.0, (Math.random() - 0.5) * 3);
            s.rotVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
          }
        } else {
          s.vel.y -= 20 * dt;
          s.group.position.addScaledVector(s.vel, dt);
          s.group.rotation.x += s.rotVel.x * dt;
          s.group.rotation.y += s.rotVel.y * dt;
          s.group.rotation.z += s.rotVel.z * dt;

          if (s.group.position.y <= 0.25) {
            s.group.position.y = 0.25;
            s.vel.set(0, 0, 0);
            s.rotVel.set(0, 0, 0);
            s.dead = true; // Yere indi ve sabitlendi
          }
        }
      }
    }
  }

  stateFor(sig, edge) {
    return signalState(sig, Math.abs(edge.d[1]) > Math.abs(edge.d[0]), this.t);
  }
}
