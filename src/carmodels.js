import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// ARAÇ TİPLERİ VE MODELLERİ (+x ileri; boyutlar metre)
// Her aracın gövdesi dört BÖLGEYE ayrılır: ön, arka, sol, sağ. Her bölgenin kendi gövde panelleri, demir iskelet
// parçaları, canı ve durumu vardır (sağlam → çatlak → parçalanmış). Hasar yalnız çarpılan bölgeyi parçalar;
// diğer bölgeler en fazla çatlar. Parçalanmış bölgenin demiri yalnızca özel silahlarla kırılır (bkz. cars.js).
// ─────────────────────────────────────────────────────────────────────────────
// mass: göreli kütle (çarpışmada momentum). zhp: bölge panel canı. wr: tekerlek yarıçapı.
// seatX/seatY: sürücünün kabindeki yeri.
export const TYPES = {
  sport:     { len: 4.4, wid: 1.85, h: 1.05, speed: [17, 23], mass: 1.0, zhp: 11, wr: 0.32, seatX: -0.1, seatY: 0.98 },
  mini:      { len: 2.7, wid: 1.45, h: 1.35, speed: [8, 11],  mass: 0.8, zhp: 8,  wr: 0.32, seatX: -0.1, seatY: 1.28 },
  sedan:     { len: 4.3, wid: 1.8,  h: 1.35, speed: [12, 16], mass: 1.2, zhp: 10, wr: 0.32, seatX: -0.1, seatY: 1.28 },
  suv:       { len: 4.7, wid: 1.95, h: 1.85, speed: [11, 15], mass: 1.7, zhp: 14, wr: 0.42, seatX: 0.1,  seatY: 1.5 },
  pickup:    { len: 5.2, wid: 1.95, h: 1.85, speed: [10, 14], mass: 1.8, zhp: 14, wr: 0.42, seatX: 0.9,  seatY: 1.4 },
  van:       { len: 5.0, wid: 2.0,  h: 2.1,  speed: [9, 13],  mass: 2.1, zhp: 16, wr: 0.38, seatX: 1.5,  seatY: 1.7 },
  truck:     { len: 7.2, wid: 2.4,  h: 3.4,  speed: [7, 10],  mass: 4.2, zhp: 24, wr: 0.55, seatX: 2.5,  seatY: 2.1 },
  police:    { len: 4.4, wid: 1.85, h: 1.65, speed: [15, 20], mass: 1.3, zhp: 11, wr: 0.34, seatX: -0.2, seatY: 1.28 },
  ambulance: { len: 5.4, wid: 2.05, h: 2.45, speed: [12, 16], mass: 2.4, zhp: 17, wr: 0.42, seatX: 1.8,  seatY: 1.75 }
};

// Trafikte görülme olasılığı (toplam 1)
export const SPAWN_WEIGHTS = [
  ['sport', 0.14], ['mini', 0.14], ['sedan', 0.16], ['suv', 0.13], ['pickup', 0.11],
  ['van', 0.09], ['truck', 0.07], ['police', 0.08], ['ambulance', 0.08]
];

export const ZONE_NAMES = ['front', 'rear', 'left', 'right'];

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
export const glassMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, transparent: true, opacity: 0.55 });
const darkMat = lam(0x0f172a), lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 }), tailMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
const skins = [0xe0ac86, 0xc68642, 0x8d5524, 0xf1c27d, 0xffdbac], shirts = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Yerel noktanın (x ileri, z yan) hangi bölgeye düştüğü: uçlara yakınsa ön/arka, değilse yan (z işareti)
export function zoneOfLocal(T, x, z) {
  const nx = x / (T.len / 2), nz = z / (T.wid / 2);
  if (Math.abs(nx) >= 0.5 && Math.abs(nx) >= Math.abs(nz) * 0.7) return nx > 0 ? 'front' : 'rear';
  return nz >= 0 ? 'left' : 'right';
}

// Tipe özel gövde parçaları. add(geo, material, x, y, z) bölgeye atanacak panel ekler.
const BODY = {
  sport(add, T, body) {
    add(box(T.len, 0.5, T.wid), body, 0, 0.5, 0);                      // alçak gövde
    add(box(1.6, 0.4, T.wid - 0.35), body, 1.0, 0.82, 0);              // ön kaput eğimi
    add(box(1.7, 0.5, T.wid - 0.3), glassMat, -0.2, 0.95, 0);          // kabin camı
    add(box(1.0, 0.1, T.wid - 0.5), body, -0.2, 1.22, 0);              // tavan
    add(box(0.3, 0.38, T.wid), body, -2.1, 1.0, 0);                    // spoyler
    add(box(0.12, 0.3, 0.12), darkMat, -2.0, 0.78, 0.55); add(box(0.12, 0.3, 0.12), darkMat, -2.0, 0.78, -0.55);
  },
  mini(add, T, body) {
    add(box(T.len, 0.7, T.wid), body, 0, 0.62, 0);                     // kısa, yüksek gövde
    add(box(1.7, 0.7, T.wid - 0.15), glassMat, -0.1, 1.28, 0);         // geniş cam kabin
    add(box(1.55, 0.1, T.wid - 0.25), body, -0.1, 1.68, 0);
  },
  sedan(add, T, body) {
    add(box(T.len, 0.65, T.wid), body, 0, 0.62, 0);
    add(box(2.2, 0.6, T.wid - 0.2), glassMat, -0.2, 1.22, 0);
    add(box(1.9, 0.1, T.wid - 0.3), body, -0.2, 1.56, 0);
  },
  suv(add, T, body) {
    add(box(T.len, 0.85, T.wid), body, 0, 0.85, 0);                    // yüksek, geniş gövde
    add(box(T.len * 0.58, 0.66, T.wid - 0.12), glassMat, -0.3, 1.5, 0);
    add(box(T.len * 0.54, 0.1, T.wid - 0.2), body, -0.3, 1.88, 0);     // tavan
    add(box(T.len * 0.46, 0.07, 0.07), darkMat, -0.3, 1.97, 0.55); add(box(T.len * 0.46, 0.07, 0.07), darkMat, -0.3, 1.97, -0.55); // tavan rayları
    add(box(0.28, 0.32, T.wid), darkMat, T.len / 2 - 0.05, 0.55, 0);   // ön tampon
    add(box(0.28, 0.32, T.wid), darkMat, -T.len / 2 + 0.05, 0.55, 0);  // arka tampon
  },
  pickup(add, T, body) {
    add(box(T.len, 0.5, T.wid), body, 0, 0.72, 0);                     // şasi gövdesi
    add(box(2.0, 0.85, T.wid), body, 1.0, 1.2, 0);                     // kabin
    add(box(1.6, 0.5, T.wid - 0.14), glassMat, 1.0, 1.5, 0);
    add(box(1.7, 0.1, T.wid - 0.25), body, 1.0, 1.95, 0);              // kabin tavanı
    for (const sz of [-1, 1]) add(box(2.5, 0.42, 0.1), body, -1.35, 1.1, sz * (T.wid / 2 - 0.05));   // kasa yan duvarları
    add(box(0.1, 0.48, T.wid), body, -T.len / 2 + 0.05, 1.08, 0);      // kasa arka kapağı
    add(box(2.5, 0.05, T.wid - 0.2), darkMat, -1.35, 0.97, 0);         // kasa tabanı
    add(box(0.28, 0.3, T.wid), darkMat, T.len / 2 - 0.05, 0.6, 0);
  },
  van(add, T, body) {
    add(box(T.len, 1.55, T.wid), body, 0, 1.25, 0);                    // yüksek kutu gövde
    add(box(0.12, 0.7, T.wid - 0.2), glassMat, T.len / 2 - 0.02, 1.72, 0);   // ön cam
    add(box(1.4, 0.5, T.wid + 0.02), glassMat, 1.2, 1.75, 0);          // sürücü/yolcu yan camları
    add(box(0.28, 0.3, T.wid), darkMat, T.len / 2 - 0.05, 0.6, 0);
    add(box(0.28, 0.3, T.wid), darkMat, -T.len / 2 + 0.05, 0.6, 0);
  },
  truck(add, T, body) {
    const cargo = lam(0xe5e7eb);
    add(box(1.9, 1.95, T.wid), body, 2.5, 1.6, 0);                     // kabin
    add(box(0.1, 0.85, T.wid - 0.2), glassMat, 3.52, 2.05, 0);         // ön cam
    add(box(1.0, 0.55, T.wid + 0.02), glassMat, 2.7, 2.05, 0);         // yan camlar
    for (const sz of [-1, 1]) add(box(4.8, 2.45, T.wid / 2 - 0.02), cargo, -1.15, 2.1, sz * T.wid / 4);   // yük kasası (iki yarı: sol/sağ ayrı kopar)
    add(box(0.3, 0.35, T.wid), darkMat, T.len / 2 - 0.05, 0.6, 0);
    add(box(0.3, 0.35, T.wid), darkMat, -T.len / 2 + 0.05, 0.6, 0);
  },
  police(add, T, body, color, extra) {
    const black = lam(0x111827), white = lam(0xf3f4f6);
    add(box(T.len, 0.65, T.wid), black, 0, 0.62, 0);
    add(box(1.9, 0.5, T.wid + 0.02), white, -0.1, 0.62, 0);            // beyaz kapılar
    add(box(2.1, 0.58, T.wid - 0.2), glassMat, -0.2, 1.2, 0);
    add(box(1.8, 0.1, T.wid - 0.3), black, -0.2, 1.52, 0);
    add(box(0.5, 0.1, T.wid * 0.6), darkMat, -0.2, 1.62, 0);           // çakar tabanı
    extra.lights = [
      add(box(0.4, 0.13, 0.55), new THREE.MeshBasicMaterial({ color: 0xff2222 }), -0.2, 1.72, -0.4),
      add(box(0.4, 0.13, 0.55), new THREE.MeshBasicMaterial({ color: 0x2255ff }), -0.2, 1.72, 0.4)
    ];
  },
  ambulance(add, T, body, color, extra) {
    const white = lam(0xf5f5f5), red = lam(0xdc2626);
    add(box(T.len, 1.7, T.wid), white, 0, 1.38, 0);
    add(box(0.12, 0.72, T.wid - 0.2), glassMat, T.len / 2 - 0.02, 1.85, 0);
    add(box(1.3, 0.5, T.wid + 0.02), glassMat, 1.9, 1.85, 0);
    add(box(T.len - 0.3, 0.22, T.wid + 0.03), red, 0, 1.0, 0);          // kırmızı şerit
    add(box(0.75, 0.2, T.wid + 0.04), red, -0.6, 1.7, 0);               // kırmızı haç
    add(box(0.2, 0.75, T.wid + 0.04), red, -0.6, 1.7, 0);
    add(box(0.28, 0.3, T.wid), darkMat, T.len / 2 - 0.05, 0.62, 0);
    extra.lights = [
      add(box(0.4, 0.13, 0.6), new THREE.MeshBasicMaterial({ color: 0xff2222 }), 1.6, 2.3, -0.45),
      add(box(0.4, 0.13, 0.6), new THREE.MeshBasicMaterial({ color: 0x2255ff }), 1.6, 2.3, 0.45)
    ];
  }
};

// Araç modeli. Dönen grubun userData.zones: bölge başına { parts, iron, cracks, hp, max, ironHp, ironMax, state, ironBroken }
export function buildCar(kind, color) {
  const T = TYPES[kind], g = new THREE.Group();
  g.rotation.order = 'YZX';   // önce yönelim (y), sonra aracın kendi ekseninde eğim (z: rampada burun kalkar)
  const body = lam(color);
  const panels = [];          // bölgeye atanacak paneller
  const add = (geo, m, x, y, z, keep = false) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh);
    if (!keep) panels.push(mesh);
    return mesh;
  };
  const extra = {};
  BODY[kind](add, T, body, color, extra);

  // Yan etekler: her aracın sol ve sağ bölgesinde kopabilecek en az bir panel olsun
  for (const sz of [-1, 1]) add(box(T.len * 0.45, 0.28, 0.06), body, 0, 0.42, sz * (T.wid / 2 - 0.03));

  // Tekerlekler (bölgeye bağlı değil, her zaman kalır)
  const wx = T.len * 0.31, wz = T.wid / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(T.wr * 2, T.wr * 2, 0.28), darkMat, sx * wx, T.wr, sz * wz, true);

  // Farlar ve stoplar bölgenin parçasıdır
  add(box(0.08, 0.2, 0.4), lightMat, T.len / 2, 0.62, 0.55); add(box(0.08, 0.2, 0.4), lightMat, T.len / 2, 0.62, -0.55);
  add(box(0.08, 0.2, 0.4), tailMat, -T.len / 2, 0.62, 0.55); add(box(0.08, 0.2, 0.4), tailMat, -T.len / 2, 0.62, -0.55);

  // Sürücü (ve bazen yolcu): kabin camının arkasında görünür
  const person = (z) => {
    add(box(0.3, 0.3, 0.3), lam(pick(skins)), T.seatX, T.seatY + 0.18, z, true).userData.person = true;
    add(box(0.34, 0.34, 0.26), lam(pick(shirts)), T.seatX, T.seatY - 0.08, z, true).userData.person = true;
  };
  person(0.35);
  if (Math.random() < 0.4) person(-0.35);

  // Bölgeler
  const zones = {};
  for (const n of ZONE_NAMES) zones[n] = { name: n, parts: [], iron: [], cracks: [], hp: T.zhp, max: T.zhp, ironHp: T.zhp * 1.5, ironMax: T.zhp * 1.5, state: 'ok', ironBroken: false };
  let alt = 0;
  for (const m of panels) {
    const centered = Math.abs(m.position.z) < 0.08 && Math.abs(m.position.x) < T.len * 0.25;
    const name = centered ? (alt++ % 2 ? 'left' : 'right') : zoneOfLocal(T, m.position.x, m.position.z);
    zones[name].parts.push(m);
    m.userData.zone = name;
  }

  // Demir iskelet (şasi + güvenlik kafesi): bölge başına parçalar; paneller uçunca görünür, yalnız özel silahlar kırar
  const steel = lam(0x3b4350);
  const iron = (w, h, d, x, y, z) => {
    const m = add(box(w, h, d), steel, x, y, z, true);
    m.userData.iron = true;
    zones[zoneOfLocal(T, x, z)].iron.push(m);
  };
  iron(0.14, 0.34, T.wid * 0.76, T.len * 0.4, 0.45, 0);          // ön kiriş
  iron(0.14, 0.34, T.wid * 0.76, -T.len * 0.4, 0.45, 0);         // arka kiriş
  for (const sz of [-1, 1]) iron(T.len * 0.8, 0.14, 0.1, 0, 0.42, sz * T.wid * 0.37);   // yan raylar
  const cy = T.seatY - 0.03;
  for (const px of [T.seatX - 0.7, T.seatX + 0.5]) for (const pz of [-1, 1]) iron(0.07, 0.62, 0.07, px, cy, pz * (T.wid / 2 - 0.2));  // kafes direkleri

  g.userData.zones = zones;
  g.userData.lights = extra.lights || null;
  return g;
}

// Bölgenin dış yüzeyine çatlak çizgileri ekler (görünmez başlar; çatlayınca gösterilir)
export function addCracks(g, T, name) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  const out = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 6; i++) {
    const len = rnd(0.25, 0.6), a = rnd(0, Math.PI), y = rnd(0.45, Math.min(1.3, T.h * 0.7));
    let mesh;
    if (name === 'front' || name === 'rear') {
      mesh = new THREE.Mesh(box(0.03, len, 0.03), mat);
      mesh.position.set((name === 'front' ? 1 : -1) * (T.len / 2 + 0.03), y, rnd(-T.wid * 0.38, T.wid * 0.38));
      mesh.rotation.x = a;
    } else {
      mesh = new THREE.Mesh(box(len, 0.03, 0.03), mat);
      mesh.position.set(rnd(-T.len * 0.3, T.len * 0.3), y, (name === 'left' ? 1 : -1) * (T.wid / 2 + 0.03));
      mesh.rotation.z = a;
    }
    g.add(mesh); out.push(mesh);
  }
  return out;
}
