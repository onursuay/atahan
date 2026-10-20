import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// ARAÇ TİPLERİ VE MODELLERİ (+x ileri; boyutlar metre)
// Her aracın gövdesi dört BÖLGEYE ayrılır: ön, arka, sol, sağ. Her bölgenin kendi gövde panelleri, demir iskelet
// parçaları, canı ve durumu vardır (sağlam → parçalanmış). Hasar yalnız çarpılan bölgeyi parçalar;
// diğer bölgeler etkilenmez. Parçalanmış bölgenin demiri yalnızca özel silahlarla kırılır (bkz. cars.js).
// ─────────────────────────────────────────────────────────────────────────────
// mass: göreli kütle (çarpışmada momentum). zhp: bölge panel canı. wr: tekerlek yarıçapı.
// seatX/seatY: sürücünün kabindeki yeri.
export const TYPES = {
  sport:     { len: 4.5, wid: 1.9,  h: 1.05, speed: [25, 33], mass: 1.15, zhp: 12, wr: 0.33, seatX: -0.1, seatY: 0.96 },
  bvm:       { len: 4.65, wid: 1.88, h: 1.28, speed: [23, 31], mass: 1.35, zhp: 13, wr: 0.35, seatX: -0.15, seatY: 1.05 },
  merzedes:  { len: 4.90, wid: 1.92, h: 1.32, speed: [21, 28], mass: 1.55, zhp: 15, wr: 0.36, seatX: -0.18, seatY: 1.10 },
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
  ['bvm', 0.13], ['merzedes', 0.13], ['sport', 0.11], ['mini', 0.10], ['sedan', 0.12],
  ['suv', 0.11], ['pickup', 0.08], ['van', 0.07], ['truck', 0.05], ['police', 0.05], ['ambulance', 0.05]
];

export const ZONE_NAMES = ['front', 'rear', 'left', 'right'];

// Far huzmesi: gece (daynight.js opaklığı ayarlar) aracın önünde sıcak, yumuşak bir ışık konisi. Tüm arabalar tek malzemeyi paylaşır.
export const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const beamGeo = (() => { const g = new THREE.ConeGeometry(2.1, 9, 10, 1, true); g.rotateZ(Math.PI / 2); g.translate(4.5, 0, 0); return g; })();

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
    const chrome = lam(0x94a3b8), engineRed = lam(0xdc2626), carbon = lam(0x1e293b);
    // Ana alçak gövde ve kaslı çamurluk omuzları
    add(box(T.len - 0.12, 0.44, T.wid - 0.08), body, 0, 0.48, 0);
    for (const sz of [-1, 1]) {
      add(box(1.25, 0.46, 0.12), body, 1.32, 0.52, sz * (T.wid / 2 - 0.03));   // ön kaslı çamurluklar
      add(box(1.45, 0.50, 0.14), body, -1.25, 0.55, sz * (T.wid / 2 - 0.02));  // arka geniş çamurluklar
      add(box(1.9, 0.10, 0.12), carbon, 0.05, 0.25, sz * (T.wid / 2 - 0.01));  // karbon yan marşpiyel (side skirt)
      add(box(0.45, 0.24, 0.08), darkMat, -0.55, 0.56, sz * (T.wid / 2 - 0.02)); // yan motor hava girişleri
      // Aerodinamik yan aynalar
      add(box(0.08, 0.06, 0.14), carbon, 0.55, 0.82, sz * (T.wid / 2 - 0.02));
      add(box(0.18, 0.09, 0.12), body, 0.52, 0.86, sz * (T.wid / 2 + 0.05));
    }
    // Ön splitter (lip), ızgara ve aerodinamik kaput
    add(box(0.32, 0.07, T.wid + 0.04), carbon, T.len / 2 - 0.06, 0.24, 0);     // ön karbon splitter
    add(box(0.16, 0.22, T.wid * 0.52), darkMat, T.len / 2 - 0.03, 0.40, 0);    // orta ön ızgara
    for (const sz of [-1, 1]) {
      add(box(0.16, 0.18, 0.34), darkMat, T.len / 2 - 0.03, 0.40, sz * 0.68);  // yan ön hava kanalları
      add(box(0.10, 0.06, 0.38), lightMat, T.len / 2 - 0.01, 0.66, sz * 0.66); // agresif LED gündüz farları
    }
    add(box(1.45, 0.22, T.wid - 0.28), body, 1.25, 0.68, 0);                   // alçak eğimli ön kaput
    add(box(0.55, 0.05, 0.68), darkMat, 1.35, 0.78, 0);                        // kaput hava tahliye kanalı
    // Aerodinamik cam kabin ve tavan
    add(box(1.75, 0.46, T.wid - 0.32), glassMat, -0.05, 0.92, 0);              // kabin camı
    add(box(1.05, 0.09, T.wid - 0.46), body, -0.15, 1.18, 0);                  // tavan
    add(box(0.38, 0.12, 0.22), carbon, -0.35, 1.25, 0);                        // tavan üstü hava girişi (roof scoop)
    // Arka motor kapağı, panjurlar (louvers) ve iç motor bloğu detayı
    add(box(1.15, 0.24, T.wid - 0.26), body, -1.35, 0.74, 0);                  // arka motor güvertesi
    add(box(0.70, 0.08, 0.56), engineRed, -1.25, 0.84, 0);                     // görünür V10/V12 motor üst kapağı
    for (let i = 0; i < 4; i++) {
      add(box(0.10, 0.04, 0.78), carbon, -0.98 - i * 0.18, 0.88 - i * 0.015, 0); // arka motor panjurları
    }
    // Çok parçalı GT arka kanat (spoyler) ve dikmeleri
    for (const sz of [-1, 1]) {
      add(box(0.18, 0.32, 0.06), carbon, -2.02, 0.88, sz * 0.56);              // spoyler dikmeleri
      add(box(0.42, 0.24, 0.04), body, -2.10, 1.04, sz * (T.wid / 2 - 0.02));  // spoyler yan plakaları (endplates)
    }
    add(box(0.34, 0.07, T.wid - 0.04), carbon, -2.10, 1.06, 0);                // ana spoyler kanadı
    add(box(0.14, 0.06, T.wid - 0.10), body, -2.20, 1.11, 0);                  // üst Gurney flap
    // Arka difüzör, dörtlü egzoz ve boydan boya LED stop barı
    add(box(0.24, 0.18, T.wid - 0.12), carbon, -T.len / 2 + 0.08, 0.28, 0);    // arka difüzör
    for (const zf of [-0.55, -0.18, 0.18, 0.55]) {
      add(box(0.22, 0.16, 0.04), darkMat, -T.len / 2 + 0.04, 0.26, zf);        // difüzör bıçakları
    }
    for (const sz of [-1, 1]) {
      add(box(0.16, 0.09, 0.09), chrome, -T.len / 2 + 0.02, 0.38, sz * 0.42);  // iç egzoz boruları
      add(box(0.16, 0.09, 0.09), chrome, -T.len / 2 + 0.02, 0.38, sz * 0.56);  // dış egzoz boruları
    }
    add(box(0.06, 0.07, T.wid - 0.24), tailMat, -T.len / 2 + 0.01, 0.68, 0);   // kesintisiz arka LED stop şeridi
  },
  bvm(add, T, body, color) {
    const chrome = lam(0x94a3b8), carbon = lam(0x1e293b), dark = darkMat;
    const bvmBlue = lam(0x1d4ed8), bvmWhite = lam(0xf8fafc);
    // Ana gövde ve agresif spor sedan hatları
    add(box(T.len - 0.15, 0.52, T.wid - 0.08), body, 0, 0.56, 0);
    // Ön kaput (çift güç kubbesi çizgisiyle)
    add(box(1.55, 0.22, T.wid - 0.18), body, 1.28, 0.72, 0);
    add(box(1.20, 0.05, 0.28), carbon, 1.30, 0.84, 0);
    // Ön M-Tampon ve İkonik İkili Böbrek Izgara (BVM Twin Kidney Grille)
    add(box(0.24, 0.22, T.wid - 0.04), carbon, T.len / 2 - 0.04, 0.38, 0);
    add(box(0.12, 0.22, 0.34), dark, T.len / 2 - 0.02, 0.62, 0.22); // sağ böbrek ızgara
    add(box(0.12, 0.22, 0.34), dark, T.len / 2 - 0.02, 0.62, -0.22); // sol böbrek ızgara
    add(box(0.08, 0.18, 0.04), chrome, T.len / 2 - 0.01, 0.62, 0.22);
    add(box(0.08, 0.18, 0.04), chrome, T.len / 2 - 0.01, 0.62, -0.22);
    // BVM Yuvarlak Logo (Mavi-Beyaz çeyrekli amblem)
    add(box(0.06, 0.06, 0.10), bvmBlue, T.len / 2 - 0.12, 0.84, 0);
    add(box(0.062, 0.03, 0.05), bvmWhite, T.len / 2 - 0.12, 0.85, 0.02);
    // "Angel Eyes" çift halkalı agresif LED farlar
    for (const sz of [-1, 1]) {
      add(box(0.12, 0.12, 0.38), lightMat, T.len / 2 - 0.03, 0.64, sz * 0.64);
      add(box(0.14, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }), T.len / 2 - 0.01, 0.64, sz * 0.56);
      add(box(0.14, 0.08, 0.14), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }), T.len / 2 - 0.01, 0.64, sz * 0.72);
    }
    // Kabin, camlar, Hofmeister Kink ve tavan
    add(box(2.25, 0.54, T.wid - 0.22), glassMat, -0.15, 1.08, 0);
    add(box(1.85, 0.08, T.wid - 0.34), body, -0.18, 1.36, 0);
    add(box(0.24, 0.10, 0.08), carbon, -0.85, 1.42, 0); // köpekbalığı yüzgeci anten (shark fin)
    // Yan aynalar ve kapı kolları
    for (const sz of [-1, 1]) {
      add(box(0.14, 0.08, 0.16), carbon, 0.65, 0.96, sz * (T.wid / 2 + 0.06));
      add(box(0.16, 0.04, 0.03), chrome, 0.22, 0.72, sz * (T.wid / 2 + 0.01));
      add(box(0.16, 0.04, 0.03), chrome, -0.48, 0.72, sz * (T.wid / 2 + 0.01));
    }
    // Arka bagaj kapağı, M dudak spoyler ve BVM logosu
    add(box(1.05, 0.28, T.wid - 0.18), body, -1.55, 0.74, 0);
    add(box(0.14, 0.06, T.wid - 0.26), carbon, -T.len / 2 + 0.06, 0.90, 0);
    add(box(0.06, 0.06, 0.10), bvmBlue, -T.len / 2 + 0.08, 0.78, 0);
    for (const sz of [-1, 1]) {
      add(box(0.08, 0.12, 0.38), tailMat, -T.len / 2 + 0.02, 0.72, sz * 0.62);
    }
    // Arka difüzör ve Dörtlü Egzoz Çıkışları (M Quad Exhausts)
    add(box(0.22, 0.20, T.wid - 0.20), carbon, -T.len / 2 + 0.06, 0.34, 0);
    for (const sz of [-1, 1]) {
      add(box(0.18, 0.08, 0.08), chrome, -T.len / 2 + 0.01, 0.36, sz * 0.44);
      add(box(0.18, 0.08, 0.08), chrome, -T.len / 2 + 0.01, 0.36, sz * 0.58);
    }
  },
  merzedes(add, T, body, color) {
    const chrome = lam(0xe2e8f0), carbon = darkMat;
    // Uzun, zarif, prestijli VIP lüks sedan gövdesi
    add(box(T.len - 0.12, 0.56, T.wid - 0.06), body, 0, 0.58, 0);
    // Ön kaput (uzun, asil eğimli)
    add(box(1.75, 0.22, T.wid - 0.16), body, 1.38, 0.74, 0);
    // İkonik Merzedes Yatay Krom Izgarası (Grand Prestige Louver Grille)
    add(box(0.14, 0.30, 0.72), chrome, T.len / 2 - 0.02, 0.62, 0);
    for (let r = 0; r < 4; r++) {
      add(box(0.16, 0.02, 0.68), chrome, T.len / 2 - 0.01, 0.52 + r * 0.06, 0);
    }
    add(box(0.16, 0.26, 0.03), chrome, T.len / 2 - 0.01, 0.62, 0);
    // DİK DURAN MERZEDES ÜÇ KOLLU YILDIZ AMBLEMİ (Hood Ornament)
    add(box(0.04, 0.08, 0.04), chrome, T.len / 2 - 0.08, 0.88, 0);
    add(box(0.03, 0.14, 0.14), chrome, T.len / 2 - 0.08, 0.98, 0);
    // Multi-Beam LED Farlar ve Kaş DRL Gündüz Şeridi
    for (const sz of [-1, 1]) {
      add(box(0.12, 0.14, 0.42), lightMat, T.len / 2 - 0.04, 0.66, sz * 0.68);
      add(box(0.14, 0.03, 0.40), new THREE.MeshBasicMaterial({ color: 0xffffff }), T.len / 2 - 0.02, 0.74, sz * 0.68);
    }
    // Kabin, panoramik cam tavan ve krom çerçeveler
    add(box(2.40, 0.56, T.wid - 0.20), glassMat, -0.15, 1.12, 0);
    add(box(2.00, 0.08, T.wid - 0.30), body, -0.18, 1.41, 0);
    add(box(1.20, 0.03, T.wid - 0.45), glassMat, -0.18, 1.44, 0);
    // Krom kapı kolları, yan çıtalar ve dikiz aynaları
    for (const sz of [-1, 1]) {
      add(box(0.14, 0.08, 0.16), body, 0.72, 0.98, sz * (T.wid / 2 + 0.06));
      add(box(0.02, 0.03, 0.14), chrome, 0.72, 0.98, sz * (T.wid / 2 + 0.07));
      add(box(0.18, 0.04, 0.03), chrome, 0.32, 0.74, sz * (T.wid / 2 + 0.015));
      add(box(0.18, 0.04, 0.03), chrome, -0.42, 0.74, sz * (T.wid / 2 + 0.015));
      add(box(T.len * 0.65, 0.03, 0.02), chrome, -0.05, 0.44, sz * (T.wid / 2 + 0.015));
    }
    // Arka bagaj, krom bagaj çıtası ve arka yıldız
    add(box(1.15, 0.30, T.wid - 0.16), body, -1.62, 0.76, 0);
    add(box(0.06, 0.04, 0.65), chrome, -T.len / 2 + 0.06, 0.86, 0);
    add(box(0.04, 0.09, 0.09), chrome, -T.len / 2 + 0.07, 0.78, 0);
    for (const sz of [-1, 1]) {
      add(box(0.08, 0.14, 0.42), tailMat, -T.len / 2 + 0.02, 0.74, sz * 0.64);
    }
    // Tampona gömülü Geniş Trapezoid Krom Egzoz Çıkışları
    add(box(0.24, 0.20, T.wid - 0.16), carbon, -T.len / 2 + 0.06, 0.34, 0);
    for (const sz of [-1, 1]) {
      add(box(0.16, 0.08, 0.22), chrome, -T.len / 2 + 0.02, 0.36, sz * 0.55);
      add(box(0.18, 0.05, 0.16), darkMat, -T.len / 2 + 0.01, 0.36, sz * 0.55);
    }
  },
  mini(add, T, body) {
    const chrome = lam(0xcbd5e1), roofWhite = lam(0xf8fafc);
    add(box(T.len, 0.7, T.wid), body, 0, 0.62, 0);                     // kısa, yüksek gövde
    add(box(1.7, 0.7, T.wid - 0.15), glassMat, -0.1, 1.28, 0);         // geniş cam kabin
    add(box(1.55, 0.1, T.wid - 0.25), roofWhite, -0.1, 1.68, 0);       // kontrast beyaz tavan
    // Yuvarlak krom çerçeveli sevimli farlar ve alt ızgara
    for (const sz of [-1, 1]) {
      add(box(0.12, 0.16, 0.16), chrome, T.len / 2 - 0.02, 0.68, sz * 0.48);
      add(box(0.14, 0.12, 0.12), lightMat, T.len / 2 - 0.01, 0.68, sz * 0.48);
      add(box(0.10, 0.08, 0.14), roofWhite, 0.45, 1.12, sz * (T.wid / 2 + 0.04)); // yuvarlak beyaz aynalar
      add(box(0.14, 0.04, 0.02), chrome, 0.05, 0.74, sz * (T.wid / 2 + 0.01)); // krom kapı kolu
    }
    add(box(0.12, 0.20, 0.64), darkMat, T.len / 2 - 0.02, 0.42, 0); // ön ızgara
    add(box(0.14, 0.06, 0.12), chrome, -T.len / 2 + 0.02, 0.34, 0); // ortadan çift krom egzoz
  },
  sedan(add, T, body) {
    const chrome = lam(0x94a3b8);
    add(box(T.len, 0.65, T.wid), body, 0, 0.62, 0);
    // Ön kaput eğimi ve tampon
    add(box(1.35, 0.14, T.wid - 0.12), body, 1.25, 0.76, 0);
    add(box(0.14, 0.22, 0.65), darkMat, T.len / 2 - 0.02, 0.54, 0); // ön ızgara
    add(box(0.16, 0.03, 0.60), chrome, T.len / 2 - 0.01, 0.58, 0);  // ızgara krom şeridi
    // Cam kabin ve tavan
    add(box(2.2, 0.6, T.wid - 0.2), glassMat, -0.2, 1.22, 0);
    add(box(1.9, 0.1, T.wid - 0.3), body, -0.2, 1.56, 0);
    // Aynalar, kapı kolları ve egzoz
    for (const sz of [-1, 1]) {
      add(box(0.12, 0.08, 0.14), body, 0.55, 1.05, sz * (T.wid / 2 + 0.05)); // ayna
      add(box(0.14, 0.03, 0.02), chrome, 0.15, 0.72, sz * (T.wid / 2 + 0.01)); // ön kapı kolu
      add(box(0.14, 0.03, 0.02), chrome, -0.45, 0.72, sz * (T.wid / 2 + 0.01)); // arka kapı kolu
      add(box(0.15, 0.07, 0.07), chrome, -T.len / 2 + 0.02, 0.35, sz * 0.45); // egzoz ucu
    }
    add(box(1.05, 0.18, T.wid - 0.12), body, -1.45, 0.76, 0); // bagaj kapağı
  },
  suv(add, T, body) {
    const chrome = lam(0x94a3b8);
    add(box(T.len, 0.85, T.wid), body, 0, 0.85, 0);                    // yüksek, geniş gövde
    add(box(T.len * 0.58, 0.66, T.wid - 0.12), glassMat, -0.3, 1.5, 0);
    add(box(T.len * 0.54, 0.1, T.wid - 0.2), body, -0.3, 1.88, 0);     // tavan
    add(box(T.len * 0.46, 0.07, 0.07), darkMat, -0.3, 1.97, 0.55); add(box(T.len * 0.46, 0.07, 0.07), darkMat, -0.3, 1.97, -0.55); // tavan rayları
    add(box(0.28, 0.32, T.wid), darkMat, T.len / 2 - 0.05, 0.55, 0);   // ön tampon
    add(box(0.28, 0.32, T.wid), darkMat, -T.len / 2 + 0.05, 0.55, 0);  // arka tampon
    add(box(0.18, 0.08, 0.70), chrome, T.len / 2 - 0.02, 0.38, 0);     // gümüş karter muhafaza (skid plate)
    add(box(0.18, 0.08, 0.70), chrome, -T.len / 2 + 0.02, 0.38, 0);
    // Sis farları, aynalar, kapı kolları
    for (const sz of [-1, 1]) {
      add(box(0.12, 0.10, 0.16), body, 0.75, 1.30, sz * (T.wid / 2 + 0.06)); // SUV aynaları
      add(box(0.16, 0.04, 0.03), chrome, 0.25, 0.95, sz * (T.wid / 2 + 0.01));
      add(box(0.16, 0.04, 0.03), chrome, -0.45, 0.95, sz * (T.wid / 2 + 0.01));
      add(box(0.10, 0.08, 0.14), lightMat, T.len / 2 - 0.01, 0.48, sz * 0.65); // sis farı
      add(box(0.16, 0.08, 0.12), chrome, -T.len / 2 + 0.02, 0.40, sz * 0.52); // çift egzoz
    }
  },
  pickup(add, T, body) {
    const chrome = lam(0xcbd5e1);
    add(box(T.len, 0.5, T.wid), body, 0, 0.72, 0);                     // şasi gövdesi
    add(box(2.0, 0.85, T.wid), body, 1.0, 1.2, 0);                     // kabin
    add(box(1.6, 0.5, T.wid - 0.14), glassMat, 1.0, 1.5, 0);
    add(box(1.7, 0.1, T.wid - 0.25), body, 1.0, 1.95, 0);              // kabin tavanı
    for (const sz of [-1, 1]) {
      add(box(2.5, 0.42, 0.1), body, -1.35, 1.1, sz * (T.wid / 2 - 0.05));   // kasa yan duvarları
      add(box(1.8, 0.06, 0.08), chrome, 0.85, 0.46, sz * (T.wid / 2 + 0.04)); // krom yan basamaklar
      add(box(0.12, 0.10, 0.16), darkMat, 1.45, 1.35, sz * (T.wid / 2 + 0.06)); // aynalar
      add(box(2.2, 0.04, 0.04), chrome, -1.35, 1.34, sz * (T.wid / 2 - 0.04)); // kasa üstü koruma rayları
    }
    add(box(0.1, 0.48, T.wid), body, -T.len / 2 + 0.05, 1.08, 0);      // kasa arka kapağı
    add(box(2.5, 0.05, T.wid - 0.2), darkMat, -1.35, 0.97, 0);         // kasa tabanı
    add(box(0.28, 0.3, T.wid), chrome, T.len / 2 - 0.05, 0.6, 0);      // krom ön tampon
    add(box(0.28, 0.3, T.wid), darkMat, -T.len / 2 + 0.05, 0.6, 0);
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

// Gövde renginden farklı, ona yakışan şerit renkleri (rastgele seçilir): kırmızıya mavi/beyaz, maviye beyaz/sarı vb.
const STRIPES = [0xffffff, 0x111827, 0x2563eb, 0x16a34a, 0xfacc15, 0xdc2626, 0x06b6d4, 0xf97316];
export function randomLivery(kind, color) {
  const sport = kind === 'sport' || kind === 'bvm';
  if (!(sport ? Math.random() < 0.7 : ['mini', 'sedan', 'suv', 'pickup', 'merzedes'].includes(kind) && Math.random() < 0.3)) return null;
  const c = new THREE.Color(color);
  const far = STRIPES.filter(h => { const d = new THREE.Color(h); return Math.abs(d.r - c.r) + Math.abs(d.g - c.g) + Math.abs(d.b - c.b) > 0.9; });
  const main = pick(far.length ? far : STRIPES), second = pick(far.length ? far : STRIPES);
  const style = sport ? pick(['center', 'center', 'double', 'center+side', 'double+side']) : 'side';
  return { color: main, color2: Math.random() < 0.4 ? second : main, style };
}

// Gövde üstüne ince şerit panelleri (bölgeye atanır, panelle birlikte kopar). Yalnız spor araçta merkez şeritler; diğerlerinde yan bant.
function addLivery(add, kind, T, lv) {
  const m1 = lam(lv.color), m2 = lam(lv.color2);
  const isSport = kind === 'sport' || kind === 'bvm';
  const side = lv.style.includes('side') || !isSport;
  if (isSport && lv.style.startsWith('center')) {
    const ws = 0.34;
    [[1.6, 1.035, 1.0], [0.4, 0.76, 2.0], [1.0, 1.285, -0.2], [1.2, 0.76, -1.6]].forEach(([len, y, x]) => add(box(len, 0.02, ws), m1, x, y, 0));
  } else if (isSport && lv.style.startsWith('double')) {
    for (const sz of [-1, 1]) [[1.6, 1.035, 1.0], [0.4, 0.76, 2.0], [1.0, 1.285, -0.2], [1.2, 0.76, -1.6]].forEach(([len, y, x]) => add(box(len, 0.02, 0.13), sz < 0 ? m1 : m2, x, y, sz * 0.14));
  }
  if (side) {
    const y = isSport ? 0.58 : kind === 'merzedes' ? 0.60 : kind === 'suv' ? 0.95 : kind === 'pickup' ? 0.8 : 0.66;
    for (const sz of [-1, 1]) add(box(T.len * 0.9, 0.09, 0.022), m2, 0, y, sz * (T.wid / 2 + 0.012));
  }
}

// Araç modeli. Dönen grubun userData.zones: bölge başına { parts, iron, hp, max, ironHp, ironMax, state, ironBroken }
// livery: null ya da { color, color2, style } (bkz. randomLivery)
export function buildCar(kind, color, livery = null) {
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
  if (livery) addLivery(add, kind, T, livery);

  // Yan etekler: her aracın sol ve sağ bölgesinde kopabilecek en az bir panel olsun
  for (const sz of [-1, 1]) add(box(T.len * 0.45, 0.28, 0.06), body, 0, 0.42, sz * (T.wid / 2 - 0.03));

  // Tekerlekler (bölgeye bağlı değil, her zaman kalır)
  const wx = T.len * 0.31, wz = T.wid / 2;
  const rimMat = lam(0xcbd5e1), caliperMat = lam(0xef4444), chromeMat = lam(0xe2e8f0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hasSportWheels = kind === 'sport' || kind === 'bvm' || kind === 'merzedes';
    add(box(T.wr * 2, T.wr * 2, hasSportWheels ? 0.32 : 0.28), darkMat, sx * wx, T.wr, sz * wz, true);
    if (hasSportWheels) {
      add(box(T.wr * 1.25, T.wr * 1.25, 0.34), rimMat, sx * wx, T.wr, sz * wz, true);
      add(box(T.wr * 0.55, T.wr * 0.85, 0.35), kind === 'merzedes' ? chromeMat : caliperMat, sx * wx - sx * 0.08, T.wr + 0.04, sz * wz, true);
    }
  }

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
  for (const n of ZONE_NAMES) zones[n] = { name: n, parts: [], iron: [], hp: T.zhp, max: T.zhp, ironHp: T.zhp * 1.5, ironMax: T.zhp * 1.5, state: 'ok', ironBroken: false };
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

  const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.set(T.len / 2 - 0.1, 0.62, 0); beam.userData.beam = true; beam.frustumCulled = false; g.add(beam);
  g.userData.zones = zones;
  g.userData.lights = extra.lights || null;
  return g;
}
