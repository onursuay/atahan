import * as THREE from 'three';
import { PALETTE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// ZENGİN ADAMIN VİLLASI (doğu adanın doğusu)
//  • Tepe: üstü dümdüz bir plato (12 m), kenarları yumuşak eğimle iner (sivri tepe yok).
//  • Çıkış yolu: zengin meydanından doğuya düz gider, sola yumuşak bir kavis yapar ve platoya ulaşır (~7° eğim, uçları yumuşatılmış).
//    Yol trafik ağında DEĞİL: araçlar buraya gelmez.
//  • Villa: beyaz + kahverengi (ahşap) + siyah + cam. Zemin kat beyaz kutu, üst kat siyah ve doğuya doğru konsol (kantilever) çıkar.
//    İçeride "Stark" ekran duvarları, mutfak adası, bar, yatak odası, laboratuvar; dışarıda parlayan havuz, balkon ve renkli ışıklar.
//  • Konumlar metre cinsindendir (dünya koordinatı); voxel indeksi = metre / 0.5.
// ─────────────────────────────────────────────────────────────────────────────
export const H = 12;                                   // plato yüksekliği (m)
export const PLATEAU = { x0: 236, x1: 296, z0: -116, z1: -48 };
const SKIRT = 37;                                      // plato kenarından zemine inen eğim genişliği (m)
const ROAD_HALF = 3;                                   // yol yarı genişliği (m)
const VERGE = 1.5;                                     // yol kenarı düz çim şeridi
const APRON = { x0: 248, x1: 276, z0: -70, z1: -50 };  // platodaki araç önü asfalt alan

// Yol ekseni: (186,0) → doğuya düz 36 m → sola R=34 m yay, 80° → plato kenarını geçip ön avluya
const X0 = 186, SEG1 = 36, R = 34, CX = X0 + SEG1, CZ = -R, TH = 80 * Math.PI / 180;
const ARC = R * TH;
const A = [CX + R * Math.sin(TH), CZ + R * Math.cos(TH)];
const HD = [Math.cos(TH), -Math.sin(TH)];
const SEG3 = 36.5;
const S_EDGE = SEG1 + ARC + (PLATEAU.z1 - A[1]) / HD[1];   // yolun plato kenarına eriştiği yol uzunluğu (burada yükseklik H olur)

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// Uçlarda parabolik yumuşatma: rampa zemine ve platoya pürüzsüz bağlanır
const ease = (t) => { const e = 0.1, sl = 1 / (1 - e); t = Math.max(0, Math.min(1, t)); return t < e ? sl * t * t / (2 * e) : t > 1 - e ? 1 - sl * (1 - t) * (1 - t) / (2 * e) : sl * (t - e / 2); };
const roadH = (s) => H * ease(s / S_EDGE);

// (x,z) noktasına en yakın yol ekseni noktası: { d: mesafe, s: yol boyunca uzunluk }
export function pathInfo(x, z) {
  let best = null;
  const cons = (qx, qz, s) => { const d = Math.hypot(x - qx, z - qz); if (!best || d < best.d) best = { d, s }; };
  const t1 = Math.max(0, Math.min(SEG1, x - X0));
  cons(X0 + t1, 0, t1);
  const th = Math.max(0, Math.min(TH, Math.atan2(x - CX, z - CZ)));
  cons(CX + R * Math.sin(th), CZ + R * Math.cos(th), SEG1 + R * th);
  const t3 = Math.max(0, Math.min(SEG3, (x - A[0]) * HD[0] + (z - A[1]) * HD[1]));
  cons(A[0] + HD[0] * t3, A[1] + HD[1] * t3, SEG1 + ARC + t3);
  return best;
}

// Yol yüzeyinin zemin üstü yüksekliği (m) — yol hücrelerinin köşe yüksekliği
export function villaRoadProfile(x, z) {
  if (x < X0 - 8 || x > 310 || z > 8 || z < -90) return 0;
  return roadH(pathInfo(x, z).s);
}

// Çim zemin yüksekliği (m): plato + yumuşak etek; yol çevresinde yol seviyesine bağlanır (yarma/dolgu 45°)
export function villaHeight(x, z) {
  const inSkirt = x > PLATEAU.x0 - SKIRT && x < PLATEAU.x1 + SKIRT && z > PLATEAU.z0 - SKIRT && z < PLATEAU.z1 + SKIRT;
  const nearRoad = x > X0 - 8 && x < 310 && z < 8 && z > -90;
  if (!inSkirt && !nearRoad) return 0;
  const dx = Math.max(PLATEAU.x0 - x, 0, x - PLATEAU.x1), dz = Math.max(PLATEAU.z0 - z, 0, z - PLATEAU.z1);
  const d = Math.hypot(dx, dz);
  let h = d >= SKIRT ? 0 : H * smooth(1 - d / SKIRT);
  if (nearRoad) {
    const p = pathInfo(x, z);
    if (p.d < 60) { const rh = roadH(p.s), t = Math.max(0, p.d - ROAD_HALF - VERGE); h = Math.max(rh - t, Math.min(rh + t, h)); }
  }
  return h;
}

export const inApron = (x, z) => x >= APRON.x0 && x <= APRON.x1 && z >= APRON.z0 && z <= APRON.z1;

// Yol + ön avlu asfaltını 0.5 m hücrelerle boya (kenarlar hücre ızgarasına oturur)
export function paintVillaRoad(terrain, asphalt) {
  for (let j = Math.round(-76 / 0.5); j <= Math.round(8 / 0.5); j++) {
    const zc = j * 0.5;
    let start = null;
    const flush = (endI) => { if (start !== null) { terrain.addRect(start * 0.5 - 0.25, zc - 0.25, (endI - 1) * 0.5 + 0.25, zc + 0.25, asphalt); start = null; } };
    for (let i = Math.round(184 / 0.5); i <= Math.round(300 / 0.5); i++) {
      const xc = i * 0.5;
      const on = pathInfo(xc, zc).d <= ROAD_HALF || inApron(xc, zc);
      if (on && start === null) start = i;
      else if (!on) flush(i);
    }
    flush(Math.round(300 / 0.5) + 1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ekran dokuları (Stark tarzı HUD) — tarayıcı yoksa düz renge düşer
function hudTexture(kind) {
  try {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 288;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 288);
    if (kind === 'tv') { grad.addColorStop(0, '#1e3a8a'); grad.addColorStop(0.5, '#7c3aed'); grad.addColorStop(1, '#f97316'); }
    else { grad.addColorStop(0, '#03131f'); grad.addColorStop(1, '#062e44'); }
    g.fillStyle = grad; g.fillRect(0, 0, 512, 288);
    if (kind === 'tv') {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 9; i++) g.fillRect(0, 150 + i * 14, 512, 3);
      g.fillStyle = '#fde68a'; g.beginPath(); g.arc(256, 150, 46, 0, Math.PI * 2); g.fill();
    } else {
      g.strokeStyle = 'rgba(56,189,248,0.25)'; g.lineWidth = 1;
      for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 288); g.stroke(); }
      for (let y = 0; y <= 288; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
      g.strokeStyle = '#38bdf8'; g.lineWidth = 4;
      if (kind === 'reactor') {
        for (const r of [110, 80, 48]) { g.beginPath(); g.arc(256, 144, r, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = '#e0f2fe'; g.beginPath(); g.arc(256, 144, 22, 0, Math.PI * 2); g.fill();
      } else if (kind === 'chart') {
        g.fillStyle = '#22d3ee'; for (let i = 0; i < 14; i++) { const h = 40 + ((i * 53) % 150); g.fillRect(24 + i * 34, 260 - h, 22, h); }
        g.strokeStyle = '#f472b6'; g.beginPath(); g.moveTo(10, 220); for (let i = 1; i < 14; i++) g.lineTo(10 + i * 36, 220 - ((i * 71) % 130)); g.stroke();
      } else {
        g.strokeStyle = '#4ade80'; g.beginPath(); g.arc(256, 144, 100, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#4ade80'; for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(256 + Math.cos(i * 1.7) * (20 + i * 5), 144 + Math.sin(i * 1.7) * (20 + i * 5), 4, 0, Math.PI * 2); g.fill(); }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildVilla(world) {
  const { WHITE, WOOD, BLACK, GLASS, CONCRETE, GRASS, IRON, GOLD, BRICK, LAMP, LAMP_BLUE, LAMP_PINK, LAMP_GREEN, LAMP_PURPLE, LAMP_ORANGE } = PALETTE;
  const OXV = 484, OZV = -228, YB = 25;           // yerel (0,0,0): x=242 m, z=-114 m, taban satırı y=12.5 m (plato yüzeyi)
  const vx = (u) => OXV + u, vz = (w) => OZV + w;
  const X = (u) => 0.5 * (OXV + u), Z = (w) => 0.5 * (OZV + w), Yb = (r) => 0.5 * (YB + r);   // voxel merkezi / alt yüz (m)
  const lo = Math.min, hi = Math.max;

  const put = (u0, r0, w0, u1, r1, w1, mat) => {
    for (let u = lo(u0, u1); u <= hi(u0, u1); u++) for (let r = lo(r0, r1); r <= hi(r0, r1); r++) for (let w = lo(w0, w1); w <= hi(w0, w1); w++) {
      world.voxels.delete(`${vx(u)},${YB + r},${vz(w)}`);
      world.setVoxel(vx(u), YB + r, vz(w), mat);
    }
  };
  const clr = (u0, r0, w0, u1, r1, w1) => {
    for (let u = lo(u0, u1); u <= hi(u0, u1); u++) for (let r = lo(r0, r1); r <= hi(r0, r1); r++) for (let w = lo(w0, w1); w <= hi(w0, w1); w++) world.voxels.delete(`${vx(u)},${YB + r},${vz(w)}`);
  };
  // Cam cephe (x ekseni boyunca, sabit w) ve (z ekseni boyunca, sabit u): siyah çıtalı
  const glassW = (u0, u1, w, r0, r1) => { put(u0, r0, w, u1, r1, w, GLASS); for (let u = u0; u <= u1; u += 7) put(u, r0, w, u, r1, w, BLACK); put(u1, r0, w, u1, r1, w, BLACK); put(u0, r1, w, u1, r1, w, BLACK); };
  const glassU = (u, w0, w1, r0, r1) => { put(u, r0, w0, u, r1, w1, GLASS); for (let w = w0; w <= w1; w += 7) put(u, r0, w, u, r1, w, BLACK); put(u, r0, w1, u, r1, w1, BLACK); put(u, r1, w0, u, r1, w1, BLACK); };
  const ring = (u0, w0, u1, w1, r0, r1, mat) => { put(u0, r0, w0, u1, r1, w0, mat); put(u0, r0, w1, u1, r1, w1, mat); put(u0, r0, w0, u0, r1, w1, mat); put(u1, r0, w0, u1, r1, w1, mat); };

  // Kapılar: openings kendi voxel aralığında açılır, gerçek kapı nesnesi eklenir
  const doors = world.doors;
  const hinged = (axis, a0, a1, t, r0, r1) => {      // axis 'u': açıklık u boyunca (duvar w=t); 'w': w boyunca (duvar u=t)
    const dn = a1 - a0 + 1, y = Yb(r0), height = (r1 - r0 + 1) * 0.5 - 0.05, width = dn * 0.5 - 0.08;
    if (axis === 'u') { clr(a0, r0, t, a1, r1, t); doors.addHinged({ hx: X(a0) - 0.25 + 0.04, hz: Z(t), ax: 1, az: 0, width, height, y }); }
    else { clr(t, r0, a0, t, r1, a1); doors.addHinged({ hx: X(t), hz: Z(a0) - 0.25 + 0.04, ax: 0, az: 1, width, height, y }); }
  };
  const sliding = (axis, a0, a1, t, r0, r1) => {
    const dn = a1 - a0 + 1, y = Yb(r0), height = (r1 - r0 + 1) * 0.5 - 0.05, width = dn * 0.5 - 0.08;
    if (axis === 'u') { clr(a0, r0, t, a1, r1, t); doors.addSliding({ sx: X(a0) - 0.25 + 0.04, sz: Z(t), ax: 1, az: 0, width, height, y }); }
    else { clr(t, r0, a0, t, r1, a1); doors.addSliding({ sx: X(t), sz: Z(a0) - 0.25 + 0.04, ax: 0, az: 1, width, height, y }); }
  };

  // ── 1. PODYUM, HAVUZ, TERAS ──
  put(4, 0, 0, 100, 0, 76, CONCRETE);                       // villa + havuz terası (plato yüzeyinin 0.5 m üstü)
  put(36, 0, 77, 44, 0, 88, CONCRETE);                      // giriş yürüyüş yolu (ön avlu asfaltına bağlanır)
  put(5, 0, 33, 74, 0, 74, WOOD);                           // zemin kat iç döşemesi: ahşap
  put(8, 0, 46, 16, 0, 62, WHITE);                           // salon halısı

  // Havuz: parlayan mavi zemin + beyaz kenar
  put(23, 0, 7, 69, 0, 21, LAMP_BLUE);
  ring(22, 6, 70, 22, 1, 1, WHITE);
  // Havuz başı: şezlonglar (beyaz), şemsiyeler (siyah direk + beyaz tepe), alçak masalar
  for (const u of [26, 34, 50, 58]) { put(u, 1, 25, u + 4, 1, 26, WHITE); put(u, 2, 25, u, 3, 26, WHITE); put(u + 5, 1, 25, u + 5, 1, 25, BLACK); }
  put(42, 1, 28, 42, 6, 28, IRON); put(39, 7, 25, 45, 7, 31, WHITE);
  // Bahçe aydınlatması ve çit
  for (let u = 10; u <= 98; u += 8) { put(u, 1, 31, u, 2, 31, BLACK); put(u, 3, 31, u, 3, 31, [LAMP_BLUE, LAMP_PINK, LAMP_PURPLE][(u >> 3) % 3]); }
  put(8, 0, -2, 100, 2, -2, GRASS);                          // kuzey çit (yaşıl)
  put(100, 0, -2, 100, 2, 31, GRASS);

  // ── 2. ZEMİN KAT KABUĞU (beyaz kutu, cam cephe, ahşap kaplama) ──
  put(4, 1, 32, 75, 7, 32, WHITE); glassW(10, 50, 32, 1, 7); put(51, 1, 32, 75, 7, 32, WOOD);    // kuzey: havuza bakan cam
  put(4, 1, 75, 75, 7, 75, WHITE); glassW(23, 58, 75, 1, 7); put(59, 1, 75, 75, 7, 75, WOOD);    // güney (ön): cam + ahşap
  put(4, 1, 32, 4, 7, 75, WHITE);                                                                // batı: ekran duvarı
  glassU(75, 33, 74, 1, 7);                                                                      // doğu: cam, konsol altına bakar
  for (const [u, w] of [[4, 32], [75, 32], [4, 75], [75, 75]]) put(u, 1, w, u, 7, w, BLACK);      // siyah köşe kolonları
  put(4, 8, 32, 75, 8, 75, WHITE);                                                               // tavan / üst kat döşemesi
  // Konsol (kantilever): üst kat doğuya 10 m taşar; altında oturma alanı
  put(76, 8, 36, 95, 8, 71, WHITE);
  for (const w of [36, 49, 59, 71]) put(95, 1, w, 95, 7, w, BLACK);
  // Güney balkon (üst kat önünde): zemin katın çatısı + 2 m konsol, cam korkuluk
  put(40, 8, 72, 90, 8, 76, WHITE);
  put(40, 9, 76, 90, 10, 76, GLASS); put(40, 9, 72, 40, 10, 76, GLASS); put(90, 9, 72, 90, 10, 76, GLASS);
  // Batı çatı terası: korkuluk, şezlong, bitki, masa
  put(4, 9, 32, 4, 10, 75, GLASS); put(4, 9, 32, 27, 10, 32, GLASS); put(4, 9, 75, 27, 10, 75, GLASS);
  put(8, 9, 40, 12, 9, 41, WHITE); put(8, 10, 40, 8, 11, 41, WHITE); put(8, 9, 56, 12, 9, 57, WHITE); put(8, 10, 56, 8, 11, 57, WHITE);
  put(18, 9, 48, 20, 9, 52, WOOD); put(18, 10, 48, 20, 10, 52, BLACK);
  put(6, 9, 66, 9, 11, 69, GRASS); put(6, 9, 34, 9, 11, 36, GRASS);

  // ── 3. ÜST KAT (siyah kutu, cam cephe), çatı, LED şerit ──
  put(28, 9, 36, 28, 15, 71, BLACK);                                                             // batı duvarı
  put(28, 9, 36, 95, 15, 36, BLACK); put(30, 10, 36, 38, 14, 36, GLASS); put(88, 10, 36, 94, 14, 36, GLASS);   // kuzey (ekran duvarı) + küçük pencereler
  put(28, 9, 71, 95, 15, 71, BLACK); glassW(29, 80, 71, 9, 15); put(85, 9, 71, 94, 15, 71, WOOD);              // güney: cam + ahşap
  glassU(95, 37, 70, 9, 15);                                                                     // doğu: panoramik cam
  for (const [u, w] of [[28, 36], [95, 36], [28, 71], [95, 71]]) put(u, 9, w, u, 15, w, BLACK);
  put(29, 8, 37, 94, 8, 70, WOOD);                                                               // üst kat iç döşemesi: ahşap (merdiven deliği sonradan açılır)
  put(27, 16, 35, 96, 16, 72, WHITE);                                                            // çatı (1 voxel taşkın)
  ring(27, 35, 96, 72, 17, 17, BLACK);
  for (let u = 28; u <= 95; u += 2) { put(u, 17, 72, u, 17, 72, LAMP_BLUE); }                    // çatı kenarı LED şerit (güney)
  for (let w = 36; w <= 71; w += 2) { put(96, 17, w, 96, 17, w, LAMP_PURPLE); }                  // doğu kenarı LED
  // Konsol altı renkli LED şeritleri
  const leds = [LAMP_PINK, LAMP_BLUE, LAMP_PURPLE, LAMP_ORANGE, LAMP_PINK];
  [40, 46, 52, 58, 64].forEach((w, i) => put(78, 7, w, 94, 7, w, leds[i]));

  // ── 4. İÇ MEKAN: ZEMİN KAT ──
  // Merdiven: u 29..31, w 40..47 (8 basamak, üst katın döşemesine çıkar); neon pembe orta şerit
  clr(29, 8, 41, 31, 8, 46);
  for (let k = 1; k <= 8; k++) { put(29, 1, 39 + k, 31, k, 39 + k, WOOD); put(30, k, 39 + k, 30, k, 39 + k, LAMP_PINK); }
  put(32, 9, 40, 32, 10, 46, GLASS); put(29, 9, 40, 31, 10, 40, GLASS);                          // delik korkuluğu (üst kat)
  // Salon: ekran duvarı altı alçak dolap, kanepe, sehpa, bitkiler
  put(5, 1, 40, 6, 2, 68, BLACK); put(5, 3, 40, 5, 3, 68, LAMP_BLUE);
  put(17, 1, 46, 19, 1, 60, BLACK); put(17, 2, 46, 19, 2, 60, WHITE); put(20, 1, 46, 20, 4, 60, BLACK);   // kanepe (koltuk, minder, sırt)
  put(17, 1, 46, 20, 2, 46, BLACK); put(17, 1, 60, 20, 2, 60, BLACK);
  put(11, 1, 51, 13, 1, 57, GLASS); for (const [u, w] of [[11, 51], [13, 51], [11, 57], [13, 57]]) put(u, 1, w, u, 1, w, BLACK);   // cam sehpa
  put(7, 1, 34, 9, 1, 36, WOOD); put(7, 2, 34, 9, 4, 36, GRASS); put(7, 1, 72, 9, 1, 74, WOOD); put(7, 2, 72, 9, 4, 74, GRASS);
  // Bar (kuzey duvar, kapının doğusu): tezgâh, raflar, renkli şişeler
  put(33, 1, 35, 40, 1, 36, BLACK); put(33, 2, 35, 40, 2, 36, WOOD);
  put(33, 3, 33, 40, 3, 33, WOOD); put(33, 5, 33, 40, 5, 33, WOOD);
  for (let u = 33; u <= 40; u++) { put(u, 4, 33, u, 4, 33, [LAMP_PINK, LAMP_ORANGE, LAMP_GREEN, LAMP_PURPLE][u % 4]); put(u, 6, 33, u, 6, 33, [LAMP_ORANGE, LAMP_PINK, LAMP_BLUE][u % 3]); }
  for (const u of [34, 36, 38]) put(u, 1, 38, u, 1, 38, BLACK);                                   // tabureler
  // Mutfak (kuzey duvar boyunca): alt dolap + tezgâh, üst dolap, ocak, davlumbaz, evye, buzdolabı
  put(44, 1, 34, 70, 1, 35, WOOD); put(44, 2, 34, 70, 2, 35, BLACK);
  put(44, 5, 34, 60, 6, 34, WOOD); put(54, 5, 34, 57, 7, 35, BLACK);
  put(50, 2, 34, 51, 2, 35, IRON); put(50, 2, 34, 50, 2, 34, LAMP_ORANGE); put(51, 2, 35, 51, 2, 35, LAMP_ORANGE);
  put(62, 2, 34, 64, 2, 35, IRON);
  put(71, 1, 34, 73, 5, 35, WHITE); put(71, 3, 36, 73, 3, 36, IRON);
  // Ada: tezgâh, ışıklı yan yüz, tabureler
  put(48, 1, 42, 62, 1, 44, WHITE); put(48, 2, 42, 62, 2, 44, BLACK); put(48, 1, 44, 62, 1, 44, LAMP_BLUE);
  for (const u of [49, 52, 55, 58, 61]) put(u, 1, 46, u, 1, 46, BLACK);
  // Yemek masası ve sandalyeler, avize
  put(55, 2, 57, 66, 2, 61, WOOD); for (const [u, w] of [[55, 57], [66, 57], [55, 61], [66, 61]]) put(u, 1, w, u, 1, w, BLACK);
  for (const u of [57, 60, 63]) { put(u, 1, 55, u, 2, 55, BLACK); put(u, 1, 63, u, 2, 63, BLACK); }
  put(60, 6, 59, 61, 7, 59, GOLD); put(59, 5, 58, 62, 5, 60, LAMP);
  // Giriş: bank, bitki
  put(34, 1, 70, 38, 1, 71, WOOD); put(46, 1, 72, 48, 1, 74, WOOD); put(46, 2, 72, 48, 4, 74, GRASS);
  // Konsol altı açık salon: duvar önü bank, ateş çukuru, tabureler
  put(77, 1, 40, 78, 1, 48, WHITE); put(76, 1, 40, 76, 3, 48, WHITE); put(77, 1, 62, 78, 1, 70, WHITE); put(76, 1, 62, 76, 3, 70, WHITE);
  ring(86, 50, 90, 54, 1, 1, BLACK); put(87, 1, 51, 89, 1, 53, LAMP_ORANGE);
  for (const [u, w] of [[84, 52], [92, 52], [88, 48], [88, 56]]) put(u, 1, w, u, 1, w, WHITE);
  // Tavan ışıkları: alçak sıra spot + renkli kuşak
  for (let u = 10; u <= 74; u += 8) for (let w = 38; w <= 72; w += 8) put(u, 7, w, u, 7, w, LAMP);
  put(5, 7, 34, 5, 7, 42, LAMP_PURPLE); put(5, 7, 66, 5, 7, 74, LAMP_PURPLE);                    // ekran duvarı kuşağı (ekranların yanında)

  // ── 5. İÇ MEKAN: ÜST KAT ──
  // Yatak odası: yatak, başlık, komodinler, gardırop
  put(33, 9, 51, 33, 12, 57, BLACK);                                                             // başlık
  put(34, 9, 51, 41, 9, 57, WOOD); put(34, 10, 51, 41, 10, 57, WHITE); put(34, 11, 51, 35, 11, 57, WHITE); put(37, 11, 51, 41, 11, 57, BLACK);
  for (const w of [49, 59]) { put(33, 9, w, 34, 10, w, WOOD); put(33, 11, w, 33, 11, w, LAMP); }
  put(33, 9, 37, 50, 14, 38, WOOD); for (let u = 36; u <= 50; u += 6) put(u, 9, 38, u, 14, 38, BLACK);
  // Banyo: cam bölme, küvet, lavabo
  put(40, 9, 61, 55, 14, 61, GLASS); put(40, 9, 62, 40, 14, 70, GLASS); put(55, 9, 62, 55, 14, 70, GLASS);
  clr(40, 9, 64, 40, 14, 66);                                                                    // batı kapı boşluğu (yatak odasından)
  put(42, 9, 68, 48, 10, 70, WHITE); put(43, 10, 69, 47, 10, 69, LAMP_BLUE);
  put(51, 9, 69, 53, 10, 70, WOOD); put(51, 12, 70, 53, 13, 70, GLASS);
  // Laboratuvar: uzun siyah tezgâh + sandalye, holo masa, kuzey duvarda ekranlar
  put(54, 9, 37, 90, 9, 38, BLACK); put(54, 10, 37, 90, 10, 38, IRON);
  for (const u of [58, 67, 76, 85]) { put(u, 9, 41, u + 1, 9, 42, BLACK); put(u, 10, 41, u, 11, 41, BLACK); }
  put(70, 9, 50, 72, 9, 52, IRON); put(68, 10, 48, 74, 10, 54, BLACK);                         // holo masa: gövde + disk
  put(70, 11, 50, 72, 14, 52, GLASS); put(71, 12, 51, 71, 13, 51, LAMP_BLUE);                  // cam hologram sütunu, mavi çekirdek
  // Zırh (kırmızı-altın) vitrinde
  put(80, 9, 62, 84, 9, 66, LAMP_BLUE); ring(80, 62, 84, 66, 10, 15, GLASS);
  put(81, 10, 64, 81, 11, 64, BRICK); put(83, 10, 64, 83, 11, 64, BRICK);                       // bacaklar
  put(81, 12, 63, 83, 13, 65, BRICK); put(81, 12, 64, 83, 12, 64, GOLD);                       // gövde + altın kemer
  put(82, 13, 65, 82, 13, 65, LAMP_BLUE); put(82, 14, 64, 82, 14, 64, GOLD); put(82, 14, 65, 82, 14, 65, LAMP_BLUE);   // göğüs reaktörü, kask, yüz ışığı
  // Konsol üstü salon: panoramik cama bakan koltuklar, cam sehpa
  for (const w of [44, 59]) { put(92, 9, w, 93, 9, w + 5, BLACK); put(92, 10, w, 93, 10, w + 5, WHITE); put(91, 9, w, 91, 11, w + 5, BLACK); }   // cama (doğuya) bakan koltuklar
  put(86, 9, 52, 88, 9, 57, GLASS); put(86, 9, 52, 86, 9, 52, BLACK); put(88, 9, 57, 88, 9, 57, BLACK);
  // Tavan: renkli spot ışıklar, duvar boyunca LED kuşak
  const cols = [LAMP, LAMP_BLUE, LAMP_PINK, LAMP_PURPLE, LAMP_ORANGE, LAMP_GREEN];
  let ci = 0;
  for (let u = 33; u <= 93; u += 8) for (let w = 41; w <= 69; w += 8) put(u, 15, w, u, 15, w, cols[(ci++) % cols.length]);
  put(29, 15, 70, 94, 15, 70, LAMP_PURPLE);

  // ── 6. KAPILAR ──
  hinged('u', 39, 41, 75, 1, 5);                // giriş (ön, güney)
  sliding('u', 22, 29, 32, 1, 6);               // havuz terasına cam sürgülü
  sliding('w', 54, 61, 75, 1, 6);               // konsol altı salona
  sliding('u', 56, 63, 71, 9, 14);              // üst kattan balkona
  hinged('w', 62, 64, 28, 9, 13);               // üst kattan batı çatı terasına

  // ── 7. STARK EKRANLARI + IŞIKLAR (voxel olmayan nesneler) ──
  const g = new THREE.Group();
  const bezel = new THREE.MeshLambertMaterial({ color: 0x0b0d12 });
  const screen = (x, y, z, w, h, rotY, kind) => {
    const tex = hudTexture(kind);
    const mat = tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.06), bezel);
    const grp = new THREE.Group(); grp.add(frame); m.position.z = 0.04; grp.add(m);
    grp.position.set(x, y, z); grp.rotation.y = rotY; g.add(grp);
  };
  // Salon: batı duvarında büyük TV + iki yan ekran (duvarın iç yüzü x≈244.25, +x'e bakar)
  screen(244.32, Yb(1) + 2.5, Z(54), 4.8, 2.0, Math.PI / 2, 'tv');
  screen(244.32, Yb(1) + 2.5, Z(54) - 4.2, 2.4, 1.6, Math.PI / 2, 'reactor');
  screen(244.32, Yb(1) + 2.5, Z(54) + 4.2, 2.4, 1.6, Math.PI / 2, 'chart');
  // Laboratuvar: kuzey duvarında dört ekran (iç yüz z≈-95.75, +z'ye bakar)
  [['reactor', 58], ['chart', 67], ['map', 76], ['reactor', 85]].forEach(([k, u]) => screen(X(u), Yb(9) + 2.3, Z(36) + 0.28, 3.6, 2.0, 0, k));
  // Renkli noktasal ışıklar: havuz, salon, laboratuvar, konsol altı
  const pl = (color, intensity, dist, x, y, z) => { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); g.add(l); };
  pl(0x22d3ee, 40, 22, X(46), Yb(1) + 1.2, Z(14));
  pl(0xffd9a0, 28, 16, X(24), Yb(6), Z(54));
  pl(0x38bdf8, 30, 16, X(72), Yb(13), Z(52));
  pl(0xf472b6, 30, 18, X(86), Yb(6), Z(54));
  world.scene.add(g);
  world.decor.push(g);

  // ── 8. SAKİN: tek bir çok zengin adam ──
  world.residents = world.residents || [];
  world.residents.push({
    kind: 'rich', x: X(14), z: Z(54), y: Yb(1),
    bounds: { minX: 244.6, maxX: 291, minZ: -113, maxZ: -77.2 }
  });

  // ── 9. YOL KENARI AYDINLATMASI VE AĞAÇLAR ──
  const col = (x, z, hgt, mat) => { const ix = Math.round(x / 0.5), iz = Math.round(z / 0.5), hq = Math.max(0, Math.round(villaHeight(x, z) / 0.5)); for (let k = 0; k < hgt; k++) { world.voxels.delete(`${ix},${hq + k},${iz}`); world.setVoxel(ix, hq + k, iz, mat); } return [ix, hq, iz]; };
  for (let s = 8, i = 0; s < S_EDGE; s += 13, i++) {          // yol boyunca sıralı sokak lambaları (iki tarafa dönüşümlü)
    let qx, qz, nx, nz;
    if (s <= SEG1) { qx = X0 + s; qz = 0; nx = 0; nz = 1; }
    else if (s <= SEG1 + ARC) { const th = (s - SEG1) / R; qx = CX + R * Math.sin(th); qz = CZ + R * Math.cos(th); nx = -Math.sin(th); nz = -Math.cos(th); }
    else { const t = s - SEG1 - ARC; qx = A[0] + HD[0] * t; qz = A[1] + HD[1] * t; nx = -HD[1]; nz = HD[0]; }
    const side = i % 2 ? 1 : -1, off = ROAD_HALF + 1.0;
    const x = qx + nx * off * side, z = qz + nz * off * side;
    const [ix, hq, iz] = col(x, z, 7, IRON);
    world.voxels.delete(`${ix},${hq + 7},${iz}`); world.setVoxel(ix, hq + 7, iz, LAMP);
  }
  // Plato çevresi ağaçları (gövde + yaprak topu)
  const trees = [[238, -108], [238, -90], [238, -70], [238, -52], [294, -110], [294, -90], [294, -70], [294, -56], [290, -52], [282, -56]];
  for (const [x, z] of trees) {
    const [ix, hq, iz] = col(x, z, 9, WOOD);
    for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) + dy > 5) continue;
      world.voxels.delete(`${ix + dx},${hq + 7 + dy},${iz + dz}`); world.setVoxel(ix + dx, hq + 7 + dy, iz + dz, GRASS);
    }
  }
}
