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
export const PLATEAU = { x0: 371, x1: 449, z0: -148, z1: -48 };
const SKIRT = 37;                                      // plato kenarından zemine inen eğim genişliği (m)
const ROAD_HALF = 3;                                   // yol yarı genişliği (m)
const VERGE = 1.5;                                     // yol kenarı düz çim şeridi
const APRON = { x0: 383, x1: 411, z0: -70, z1: -50 };  // platodaki araç önü asfalt alan
// Villa çevre duvarı (voxel merkezleri, m): içinde yalnız villa sahibi ve güvenlikler bulunur; güney duvarında araç kapısı vardır
export const VILLA_WALL = { x0: 375, x1: 447.5, z0: -146, z1: -49.5, gateX0: 390.75, gateW: 8.5 };
export const insideVillaWalls = (x, z, m = 0) => x > VILLA_WALL.x0 - m && x < VILLA_WALL.x1 + m && z > VILLA_WALL.z0 - m && z < VILLA_WALL.z1 + m;

// Yol ekseni: (321,0) → doğuya düz 36 m → sola R=34 m yay, 80° → plato kenarını geçip ön avluya
const X0 = 321, SEG1 = 36, R = 34, CX = X0 + SEG1, CZ = -R, TH = 80 * Math.PI / 180;
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
  if (x < X0 - 8 || x > 445 || z > 8 || z < -90) return 0;
  return roadH(pathInfo(x, z).s);
}

// Çim zemin yüksekliği (m): plato + yumuşak etek; yol çevresinde yol seviyesine bağlanır (yarma/dolgu 45°)
export function villaHeight(x, z) {
  const inSkirt = x > PLATEAU.x0 - SKIRT && x < PLATEAU.x1 + SKIRT && z > PLATEAU.z0 - SKIRT && z < PLATEAU.z1 + SKIRT;
  const nearRoad = x > X0 - 8 && x < 445 && z < 8 && z > -90;
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
    for (let i = Math.round(319 / 0.5); i <= Math.round(435 / 0.5); i++) {
      const xc = i * 0.5;
      const on = pathInfo(xc, zc).d <= ROAD_HALF || inApron(xc, zc);
      if (on && start === null) start = i;
      else if (!on) flush(i);
    }
    flush(Math.round(435 / 0.5) + 1);
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
  const OXV = 754, OZV = -278, YB = 25;           // yerel (0,0,0): x=377 m, z=-139 m, taban satırı y=12.5 m (plato yüzeyi)
  // Villa ilk tasarımın yatayda 1.25 katıdır: tasarım koordinatları (u, w) hücre sınırlarından büyütülür, satırlar (yükseklik) aynıdır.
  // Bir tasarım hücresi 1 ya da 2 voxel olur; komşu parçalar aynı sınır tablosunu kullandığı için dikiş/boşluk kalmaz.
  const SC = 1.25;
  const bnd = (a) => Math.round(a * SC);
  const rng = (a0, a1) => { const l = Math.min(a0, a1), h = Math.max(a0, a1); return [bnd(l), Math.max(bnd(l), bnd(h + 1) - 1)]; };
  const vx = (u) => OXV + u, vz = (w) => OZV + w;
  const Yb = (r) => 0.5 * (YB + r);                                                      // satır r'nin alt yüzü (m)
  const Xs = (u) => 0.5 * (OXV + bnd(u)) - 0.25, Zs = (w) => 0.5 * (OZV + bnd(w)) - 0.25;   // hücrenin başlangıç kenarı (m)
  const Xc = (u) => 0.5 * (OXV + (bnd(u) + bnd(u + 1) - 1) / 2), Zc = (w) => 0.5 * (OZV + (bnd(w) + bnd(w + 1) - 1) / 2);   // hücre ortası
  const Xe = (u) => 0.5 * (OXV + bnd(u + 1) - 1) + 0.25, Ze = (w) => 0.5 * (OZV + bnd(w + 1) - 1) + 0.25;                    // hücrenin bitiş yüzü
  const lo = Math.min, hi = Math.max;

  const put = (u0, r0, w0, u1, r1, w1, mat) => {
    const [ua, ub] = rng(u0, u1), [wa, wb] = rng(w0, w1);
    for (let u = ua; u <= ub; u++) for (let r = lo(r0, r1); r <= hi(r0, r1); r++) for (let w = wa; w <= wb; w++) {
      world.voxels.delete(`${vx(u)},${YB + r},${vz(w)}`);
      world.setVoxel(vx(u), YB + r, vz(w), mat);
    }
  };
  const clr = (u0, r0, w0, u1, r1, w1) => {
    const [ua, ub] = rng(u0, u1), [wa, wb] = rng(w0, w1);
    for (let u = ua; u <= ub; u++) for (let r = lo(r0, r1); r <= hi(r0, r1); r++) for (let w = wa; w <= wb; w++) world.voxels.delete(`${vx(u)},${YB + r},${vz(w)}`);
  };
  // Cam cephe (x ekseni boyunca, sabit w) ve (z ekseni boyunca, sabit u): siyah çıtalı
  const glassW = (u0, u1, w, r0, r1) => { put(u0, r0, w, u1, r1, w, GLASS); for (let u = u0; u <= u1; u += 7) put(u, r0, w, u, r1, w, BLACK); put(u1, r0, w, u1, r1, w, BLACK); put(u0, r1, w, u1, r1, w, BLACK); };
  const glassU = (u, w0, w1, r0, r1) => { put(u, r0, w0, u, r1, w1, GLASS); for (let w = w0; w <= w1; w += 7) put(u, r0, w, u, r1, w, BLACK); put(u, r0, w1, u, r1, w1, BLACK); put(u, r1, w0, u, r1, w1, BLACK); };
  const ring = (u0, w0, u1, w1, r0, r1, mat) => { put(u0, r0, w0, u1, r1, w0, mat); put(u0, r0, w1, u1, r1, w1, mat); put(u0, r0, w0, u0, r1, w1, mat); put(u1, r0, w0, u1, r1, w1, mat); };

  // Kapılar: openings kendi voxel aralığında açılır, gerçek kapı nesnesi eklenir
  const doors = world.doors;
  const hinged = (axis, a0, a1, t, r0, r1) => {      // axis 'u': açıklık u boyunca (duvar w=t); 'w': w boyunca (duvar u=t)
    const dn = bnd(a1 + 1) - bnd(a0), y = Yb(r0), height = (r1 - r0 + 1) * 0.5 - 0.05, width = dn * 0.5 - 0.08;
    if (axis === 'u') { clr(a0, r0, t, a1, r1, t); doors.addHinged({ hx: Xs(a0) + 0.04, hz: Zc(t), ax: 1, az: 0, width, height, y }); }
    else { clr(t, r0, a0, t, r1, a1); doors.addHinged({ hx: Xc(t), hz: Zs(a0) + 0.04, ax: 0, az: 1, width, height, y }); }
  };
  const sliding = (axis, a0, a1, t, r0, r1) => {
    const dn = bnd(a1 + 1) - bnd(a0), y = Yb(r0), height = (r1 - r0 + 1) * 0.5 - 0.05, width = dn * 0.5 - 0.08;
    if (axis === 'u') { clr(a0, r0, t, a1, r1, t); doors.addSliding({ sx: Xs(a0) + 0.04, sz: Zc(t), ax: 1, az: 0, width, height, y }); }
    else { clr(t, r0, a0, t, r1, a1); doors.addSliding({ sx: Xc(t), sz: Zs(a0) + 0.04, ax: 0, az: 1, width, height, y }); }
  };

  // ── 1. PODYUM, HAVUZ, TERAS ──
  put(4, 0, 0, 100, 0, 76, CONCRETE);                       // villa + havuz terası (plato yüzeyinin 0.5 m üstü)
  put(36, 0, 77, 44, 0, 108, CONCRETE);                     // giriş yürüyüş yolu (ön avlu asfaltına uzanır)
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
  // Yatak odası: Teardown tarzı ultra lüks King-Size yatak, lüks deri/altın başlık, komodinler, gardırop
  put(32, 9, 50, 33, 13, 58, BLACK);                                                             // lüks siyah deri başlık çerçevesi
  put(33, 10, 51, 33, 12, 57, GOLD);                                                             // altın dikişli başlık paneli
  put(34, 9, 51, 42, 9, 57, WOOD);                                                               // masif ahşap baza
  put(34, 10, 51, 42, 10, 57, WHITE);                                                            // kalın konforlu yaylı şilte
  // 4 adet kabarık açılı yastık
  put(34, 11, 51, 36, 11, 53, WHITE); put(34, 11, 55, 36, 11, 57, WHITE);
  put(35, 11, 52, 36, 12, 53, WHITE); put(35, 11, 55, 36, 12, 56, WHITE);
  // Katlanmış lüks nevresim ve ayak ucu altın şalı
  put(37, 11, 51, 42, 11, 57, BLACK);                                                            // saten koyu yorgan
  put(36, 11, 51, 36, 11, 57, WHITE);                                                            // katlanmış beyaz çarşaf kenarı
  put(41, 11, 51, 42, 11, 57, GOLD);                                                             // ayak ucu lüks altın yatak şalı
  // Komodinler ve şık başucu abajurları
  for (const w of [48, 60]) {
    put(33, 9, w, 35, 10, w + 1, WOOD);
    put(34, 11, w, 34, 11, w, GOLD);
    put(34, 12, w, 34, 12, w, LAMP);
  }
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
  hinged('u', 39, 41, 75, 1, 7);                // giriş (ön, güney): 3.5 m yüksek (devler geçsin)
  sliding('u', 22, 29, 32, 1, 7);               // havuz terasına cam sürgülü
  sliding('w', 54, 61, 75, 1, 7);               // konsol altı salona
  sliding('u', 56, 63, 71, 9, 15);              // üst kattan balkona
  hinged('w', 62, 64, 28, 9, 15);               // üst kattan batı çatı terasına

  // ── 7. STARK EKRANLARI + IŞIKLAR + RENKLİ SANAT TABLOLARI (Zengin abinin koleksiyonu) ──
  const g = new THREE.Group();
  const bezel = new THREE.MeshLambertMaterial({ color: 0x0b0d12 });
  const goldFrame = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.25 });
  const darkFrame = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.4 });

  // Renkli Sanat Tabloları Üreticisi (Kullanıcının isteği: zengin abimizin evinde renkli renkli tablolar)
  function createPaintingTexture(theme) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 384;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    if (theme === 'sunset') {
      const grad = ctx.createLinearGradient(0, 0, 0, 384);
      grad.addColorStop(0, '#f97316'); grad.addColorStop(0.35, '#ec4899'); grad.addColorStop(0.65, '#8b5cf6'); grad.addColorStop(1, '#0284c7');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 384);
      // Güneş ve deniz dalgaları
      ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(256, 170, 55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 8; i++) ctx.fillRect(160 - i * 15, 230 + i * 16, 190 + i * 30, 4);
    } else if (theme === 'abstract') {
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 512, 384);
      const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        const cx = 50 + (i * 28) % 412, cy = 40 + (i * 35) % 300, r = 25 + (i * 12) % 60;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.globalAlpha = 0.75; ctx.fill();
      }
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(40, 60); ctx.lineTo(470, 320); ctx.moveTo(90, 330); ctx.lineTo(430, 70); ctx.stroke();
    } else if (theme === 'mondrian') {
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, 512, 384);
      ctx.fillStyle = '#dc2626'; ctx.fillRect(0, 0, 220, 180);
      ctx.fillStyle = '#2563eb'; ctx.fillRect(360, 240, 152, 144);
      ctx.fillStyle = '#facc15'; ctx.fillRect(390, 0, 122, 110);
      ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 310, 140, 74);
      ctx.strokeStyle = '#09090b'; ctx.lineWidth = 14;
      ctx.strokeRect(0, 0, 512, 384);
      ctx.beginPath();
      ctx.moveTo(220, 0); ctx.lineTo(220, 384);
      ctx.moveTo(0, 180); ctx.lineTo(512, 180);
      ctx.moveTo(360, 180); ctx.lineTo(360, 384);
      ctx.moveTo(390, 0); ctx.lineTo(390, 180);
      ctx.stroke();
    } else if (theme === 'starry') {
      const grad = ctx.createLinearGradient(0, 0, 0, 384);
      grad.addColorStop(0, '#0c1a30'); grad.addColorStop(0.5, '#1e3a8a'); grad.addColorStop(1, '#064e3b');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 512, 384);
      ctx.fillStyle = '#fde047';
      for (let i = 0; i < 12; i++) {
        const x = 50 + (i * 41) % 430, y = 40 + (i * 27) % 190;
        ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.4)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, 28, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#4c1d95'; ctx.fillRect(0, 0, 512, 384);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = `hsl(${i * 40}, 85%, 60%)`;
        ctx.fillRect(40 + i * 48, 60, 38, 260);
      }
    }
    return new THREE.CanvasTexture(cv);
  }

  const addPainting = (x, y, z, w, h, rotY, theme = 'abstract', isGold = true) => {
    const tex = createPaintingTexture(theme);
    const pMat = new THREE.MeshBasicMaterial({ map: tex });
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pMat);
    const frMat = isGold ? goldFrame : darkFrame;
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.08), frMat);
    const grp = new THREE.Group();
    grp.add(fr);
    canvas.position.z = 0.045;
    grp.add(canvas);
    // Üstüne küçük şık altın aplik aydınlatma
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, w * 0.7, 8), goldFrame);
    lamp.rotation.z = Math.PI / 2; lamp.position.set(0, h / 2 + 0.16, 0.14);
    grp.add(lamp);
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;
    g.add(grp);
  };

  // Zengin abinin villasına yerleştirilen tablolar
  // 1. Konsol üstü ana salon duvarı (Mondrian & Soyut Renkler)
  addPainting(oX(62), 6.5, oZ(40), 2.8, 1.9, 0, 'mondrian', true);
  addPainting(oX(74), 6.5, oZ(40), 2.6, 1.8, 0, 'abstract', true);
  // 2. Yatak odası duvarı (Romantik Gün Batımı & Yıldızlı Gece)
  addPainting(oX(33) + 0.35, 6.2, oZ(44), 2.2, 1.6, Math.PI / 2, 'sunset', true);
  addPainting(oX(44), 6.4, oZ(51) - 0.25, 2.4, 1.7, 0, 'starry', false);
  // 3. Giriş ve koridor duvarları (Canlı Renkler & Fütüristik Sanat)
  addPainting(oX(40), 2.2, oZ(71), 2.6, 1.8, Math.PI, 'abstract', true);
  addPainting(oX(68), 2.2, oZ(71), 2.4, 1.7, Math.PI, 'rainbow', true);
  addPainting(oX(48), 2.2, oZ(40), 2.8, 1.9, 0, 'sunset', false);

  const screen = (x, y, z, w, h, rotY, kind) => {
    const tex = hudTexture(kind);
    const mat = tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.06), bezel);
    const grp = new THREE.Group(); grp.add(frame); m.position.z = 0.04; grp.add(m);
    grp.position.set(x, y, z); grp.rotation.y = rotY; g.add(grp);
  };
  // Salon: batı duvarında büyük TV + iki yan ekran (duvarın iç yüzü x≈244.25, +x'e bakar)
  screen(Xe(4) + 0.07, Yb(1) + 2.5, Zc(54), 6.0, 2.0, Math.PI / 2, 'tv');
  screen(Xe(4) + 0.07, Yb(1) + 2.5, Zc(54) - 5.3, 3.0, 1.6, Math.PI / 2, 'reactor');
  screen(Xe(4) + 0.07, Yb(1) + 2.5, Zc(54) + 5.3, 3.0, 1.6, Math.PI / 2, 'chart');
  // Laboratuvar: kuzey duvarında dört ekran (iç yüz z≈-95.75, +z'ye bakar)
  [['reactor', 58], ['chart', 67], ['map', 76], ['reactor', 85]].forEach(([k, u]) => screen(Xc(u), Yb(9) + 2.3, Ze(36) + 0.03, 4.4, 2.0, 0, k));
  // Renkli noktasal ışıklar: havuz, salon, laboratuvar, konsol altı
  const pl = (color, intensity, dist, x, y, z) => { const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); g.add(l); };
  pl(0x22d3ee, 40, 26, Xc(46), Yb(1) + 1.2, Zc(14));
  pl(0xffd9a0, 28, 20, Xc(24), Yb(6), Zc(54));
  pl(0x38bdf8, 30, 20, Xc(72), Yb(13), Zc(52));
  pl(0xf472b6, 30, 22, Xc(86), Yb(6), Zc(54));
  world.scene.add(g);
  world.decor.push(g);

  // ── 8. SAKİN: tek bir çok zengin adam ──
  world.residents = world.residents || [];
  // Günlük rutin (betik): salonda/terasta dolaşır; arada yemek masasına oturup yemek yer (hizmetçi mutfakta hazırlar); merdivenle üst kata çıkıp iner;
  // geceleri çoğunlukla yatak odasına gidip uyur. Yollar villanın içindeki boş şeritlerden geçer (merdiven ayağı, salon-mutfak arası).
  const Yg = Yb(1), Yu = Yb(9);
  const pt = (xz, y, tol) => ({ x: xz[0], z: xz[1], y, ...(tol ? { tol } : {}) });
  const GH = [Xc(26), Zc(52)], SW = [Xc(26), Zc(38)], SFOOT = [Xc(30), Zc(37)], STOP = [Xc(30), Zc(49.5)], UH = [Xc(30), Zc(54)], UH2 = [Xc(30), Zc(59)];
  const TAPP = [Xc(60), Zc(52)], CHAIR = [Xc(60), Zc(55)], BEDSIDE = [Xc(37), Zc(59)], BEDHEAD = [Xc(36), Zc(54)];
  const meal = new THREE.Group();                                  // masadaki yemek (yalnız sahip yerken görünür)
  { const mk = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.set(x, y, z); meal.add(m); };
    mk(0.5, 0.03, 0.5, 0, 0.015, 0, 0xffffff); mk(0.26, 0.06, 0.18, -0.04, 0.06, 0.02, 0x7c2d12); mk(0.12, 0.04, 0.12, 0.12, 0.05, -0.08, 0x4ca64c); mk(0.07, 0.16, 0.07, 0.3, 0.08, 0.1, 0xbfdbfe); mk(0.06, 0.12, 0.06, -0.3, 0.06, -0.1, 0xdc2626);
    meal.position.set(Xc(60), Yb(3), Zc(58.5)); meal.visible = false; world.scene.add(meal); world.decor.push(meal); }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ownerScript = () => {
    let st = 'wander', t = rnd(12, 30), now = 0, lastEat = -999, lastSleep = -999, after = null, A = null;
    const upper = (n) => n.y > 0.5 * (Yg + Yu);
    const walk = (n, pts, then) => { A.walkPath(n, pts); st = 'walk'; after = then; };
    const toGround = (n) => upper(n) ? [pt(UH, Yu), pt(STOP, Yu), pt(SFOOT, Yg, 0.3), pt(SW, Yg), pt(GH, Yg)] : [pt(GH, Yg)];
    const toUpper = (n) => upper(n) ? [pt(UH, Yu)] : [pt(GH, Yg), pt(SW, Yg), pt(SFOOT, Yg, 0.3), pt(STOP, Yu), pt(UH, Yu)];
    return {
      update(n, dt, api) {
        now += dt; A = api;
        if (st === 'wander') {
          t -= dt; if (t > 0) return;
          const night = api.day() < 0.3, r = Math.random();
          if (night && now - lastSleep > 200 && r < 0.75) { walk(n, [...toUpper(n), pt(UH2, Yu), pt(BEDSIDE, Yu)], () => { api.lie(n, Xc(38.5), Yb(12), Zc(54), Math.PI / 2); st = 'sleep'; t = rnd(120, 200); lastSleep = now; }); return; }
          if (r < 0.4 && now - lastEat > 70) { walk(n, [...toGround(n), pt(TAPP, Yg)], () => { api.sit(n, CHAIR[0], Yg, CHAIR[1], 0, true); meal.visible = true; st = 'eat'; t = rnd(22, 32); lastEat = now; }); return; }
          if (r < 0.7) { walk(n, upper(n) ? toGround(n) : toUpper(n), () => { st = 'wander'; t = rnd(20, 45); }); return; }
          t = rnd(12, 30);
        } else if (st === 'walk') {
          if (!n.route) { const f = after; after = null; if (f) f(); else st = 'wander'; }
        } else if (st === 'eat') {
          t -= dt; if (t > 0) return;
          meal.visible = false; api.stand(n, TAPP[0], Yg, TAPP[1]); st = 'wander'; t = rnd(15, 35);
        } else if (st === 'sleep') {
          t -= dt; if (t > 0 && !(api.day() > 0.6 && t < 100)) return;
          api.stand(n, BEDSIDE[0], Yu, BEDSIDE[1]); st = 'wander'; t = rnd(10, 25);   // yataktan kalkar
        }
      }
    };
  };
  world.residents.push({
    kind: 'rich', x: Xc(14), z: Zc(54), y: Yb(1), script: ownerScript,
    bounds: { minX: Xe(4) + 0.5, maxX: Xs(100) - 0.5, minZ: Zs(0) + 0.6, maxZ: Zs(75) - 0.5 }   // villa + havuz terası + konsol altı salon
  });
  // Hizmetçi 1: mutfakta tezgâhın başında sürekli yemek hazırlar (kolları kesme/karıştırma hareketiyle)
  world.workers = world.workers || [];
  world.workers.push({ x: Xc(56), y: Yb(1), z: Zc(38.5), yaw: Math.PI, pose: 'stand', style: 'maid', cook: true });

  // ── 8a-2. DUVARIN İÇİNDE U ŞEKLİNDE ÇALILAR VE ÇALILARI KONTROL EDİP MAKASLA KESEN 2. HİZMETÇİ ──
  {
    const hput = (xa, za, xb, zb, ra, rb, mat) => {
      for (let x = lo(xa, xb); x <= hi(xa, xb); x++) for (let z = lo(za, zb); z <= hi(za, zb); z++) for (let r = ra; r <= rb; r++) {
        world.voxels.delete(`${x},${YB + r},${z}`);
        world.setVoxel(x, YB + r, z, mat);
      }
    };
    // 1) Dış duvarın hemen içinde evi U şeklinde saran çalı kuşağı (batı kolu + kuzey tabanı + doğu kolu)
    hput(752, -289, 753, -108, 0, 1, GRASS);   // batı çalı kolu
    hput(752, -290, 892, -289, 0, 1, GRASS);   // kuzey çalı tabanı
    hput(891, -289, 892, -108, 0, 1, GRASS);   // doğu çalı kolu

    // 2) Ön bahçede (duvarın içinde, villanın önünde) belirgin U şeklinde budanmış bahçe çalıları
    hput(826, -174, 828, -116, 0, 1, GRASS);   // U sol (batı) kol: x = 413..414, z = -87..-58
    hput(826, -118, 874, -116, 0, 1, GRASS);   // U alt (güney) taban: x = 413..437, z = -59..-58
    hput(872, -174, 874, -116, 0, 1, GRASS);   // U sağ (doğu) kol: x = 436..437, z = -87..-58
    // Çalı üstü dekoratif budama topları
    for (const [bx, bz] of [[827, -173], [827, -154], [827, -135], [827, -117], [850, -117], [873, -117], [873, -135], [873, -154], [873, -173]]) {
      hput(bx, bz, bx, bz, 2, 2, GRASS);
    }

    // Hizmetçi 2: U şeklindeki çalıların etrafında dolaşır, durup çalıları kontrol eder, eline makas alıp biraz keser ve yürümeye devam eder
    const bushStops = [
      { x: 411.4, y: 12.5, z: -82.0, bushYaw: Math.PI / 2 },
      { x: 411.4, y: 12.5, z: -69.0, bushYaw: Math.PI / 2 },
      { x: 419.0, y: 12.5, z: -56.4, bushYaw: Math.PI },
      { x: 430.0, y: 12.5, z: -56.4, bushYaw: Math.PI },
      { x: 438.6, y: 12.5, z: -67.0, bushYaw: -Math.PI / 2 },
      { x: 438.6, y: 12.5, z: -81.0, bushYaw: -Math.PI / 2 },
      { x: 425.0, y: 12.5, z: -60.6, bushYaw: 0 },
      { x: 415.6, y: 12.5, z: -74.0, bushYaw: -Math.PI / 2 }
    ];
    const gardenerMaidScript = () => {
      let idx = 0, st = 'walk', timer = 0, initialized = false;
      return {
        update(n, dt, api) {
          if (!initialized) {
            initialized = true;
            api.walkPath(n, [{ x: bushStops[0].x, y: bushStops[0].y, z: bushStops[0].z, tol: 0.55 }]);
          }
          if (st === 'walk') {
            n.inspecting = false;
            n.trimming = false;
            if (!n.route) {
              const cur = bushStops[idx];
              n.heading = cur.bushYaw;
              st = 'inspect';
              n.inspecting = true;
              timer = 1.6 + Math.random() * 1.0;
            }
          } else if (st === 'inspect') {
            const cur = bushStops[idx];
            n.heading = cur.bushYaw;
            timer -= dt;
            if (timer <= 0) {
              // Kontrol ettikten sonra eline makas alıp çalıları biraz keser
              n.inspecting = false;
              st = 'trim';
              n.trimming = true;
              timer = 2.8 + Math.random() * 1.6;
            }
          } else if (st === 'trim') {
            const cur = bushStops[idx];
            n.heading = cur.bushYaw;
            timer -= dt;
            if (timer <= 0) {
              // Kesmeyi bitirir, makası indirir ve sıradaki çalıyı kontrol etmek için yürümeye devam eder
              n.trimming = false;
              n.inspecting = false;
              idx = (idx + 1) % bushStops.length;
              const nxt = bushStops[idx];
              api.walkPath(n, [{ x: nxt.x, y: nxt.y, z: nxt.z, tol: 0.55 }]);
              st = 'walk';
            }
          }
        }
      };
    };
    world.residents.push({
      kind: 'gardener_maid', style: 'maid',
      x: bushStops[0].x, y: 12.5, z: bushStops[0].z,
      script: gardenerMaidScript,
      bounds: { minX: 376.5, maxX: 445.5, minZ: -144.0, maxZ: -51.5 }
    });
  }

  // Malikanenin spor arabası: normal bir spor araç, kırmızı, ortasında beyaz şerit. Ön avluda park etmiştir (binilebilir, trafikte gezmez).
  world.parkedCars = world.parkedCars || [];
  world.parkedCars.push({ kind: 'sport', color: 0xdc2626, livery: { color: 0xffffff, color2: 0xffffff, style: 'center' }, x: 405, z: -61, y: 12.5, heading: -Math.PI / 2 });

  // ── 8b. GÜVENLİKLER (lacivert üniforma, kasket, sarı kol bandı): kapıda, ön girişte ve iki yanda devriyede. Sahipten ayrı tipte. ──
  world.guards = world.guards || [];
  const G = (x, z, yaw) => world.guards.push({ x, y: 12.5, z, yaw, pose: 'stand', style: 'guard' });
  G(388.6, -52.4, 0); G(401.4, -52.4, 0);                          // kapının iki yanı (dışa bakar)
  G(397, -85, Math.PI);                                              // ön girişin önü (kuzeye, villaya bakar)
  const patrol = (x, z0, z1) => world.guards.push({ route: [{ x, y: 12.5, z: z0 }, { x, y: 12.5, z: 0.5 * (z0 + z1) }, { x, y: 12.5, z: z1 }], style: 'guard' });
  patrol(377.2, -60, -134);                                          // batı şeridi
  patrol(443, -60, -134);                                            // doğu şeridi

  // ── 8c. ÇEVRE DUVARI + ARAÇ KAPISI ──
  // 4 m beyaz duvar (0.5 m kalın), siyah başlık; güney duvarında 8.5 m'lik otomatik demir kapı (araç yaklaşınca kayar). Kapı direkleri lambalıdır.
  {
    const W = VILLA_WALL, ix0 = Math.round(W.x0 / 0.5), ix1 = Math.round(W.x1 / 0.5), iz0 = Math.round(W.z0 / 0.5), iz1 = Math.round(W.z1 / 0.5);
    const g0 = Math.round(W.gateX0 / 0.5 + 0.5), g1 = g0 + Math.round(W.gateW / 0.5) - 1;
    const wv = (xa, za, xb, zb, ra, rb, mat) => { for (let x = lo(xa, xb); x <= hi(xa, xb); x++) for (let z = lo(za, zb); z <= hi(za, zb); z++) for (let r = ra; r <= rb; r++) { world.voxels.delete(`${x},${YB + r},${z}`); world.setVoxel(x, YB + r, z, mat); } };
    for (const [xa, za, xb, zb] of [[ix0, iz0, ix1, iz0], [ix0, iz1, ix1, iz1], [ix0, iz0, ix0, iz1], [ix1, iz0, ix1, iz1]]) { wv(xa, za, xb, zb, 0, 6, WHITE); wv(xa, za, xb, zb, 7, 7, BLACK); }
    for (let x = ix0 + 20; x < ix1; x += 20) if (x < g0 - 4 || x > g1 + 4) wv(x, iz1 - 1, x, iz1, 0, 8, BLACK);           // payandalar (iç yüz)
    for (let x = g0; x <= g1; x++) for (let r = 0; r <= 6; r++) world.voxels.delete(`${x},${YB + r},${iz1}`);                // kapı açıklığı (alt 7 satır; üstte siyah başlık kalır)
    for (const px of [g0 - 2, g1 + 1]) { wv(px, iz1 - 1, px + 1, iz1, 0, 9, BLACK); wv(px, iz1 - 1, px + 1, iz1, 10, 10, WHITE); wv(px, iz1 - 1, px, iz1 - 1, 11, 11, LAMP); }
    doors.addSliding({ sx: 0.5 * g0 - 0.25 + 0.04, sz: 0.5 * iz1 - 0.15, ax: 1, az: 0, width: 0.5 * (g1 - g0 + 1) - 0.08, height: 3.4, y: Yb(0), gate: true });
  }

  // ── 8d. ZENGİN VİLLASI BAHÇESİNDE ÇEVRE DUVARI İÇİNDE İNSAN BOYUNDA DETAYLI KUŞ ÇALILIKLARI (BIRD TOPIARY) ──
  // İnsan boyu (~1.8m - 2m), detaylı budanmış kuş heykeli: kaide, gövde, göğüs, kanatlar, yükselen kuyruk tüyleri, boyun, baş, ibik ve gaga.
  const buildBirdTopiary = (cx, cz, yaw = 0) => {
    const cxV = Math.round(cx / 0.5), czV = Math.round(cz / 0.5);
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const putV = (u, v, r, mat = GRASS) => {
      const rx = Math.round(u * cosY - v * sinY);
      const rz = Math.round(u * sinY + v * cosY);
      const vx = cxV + rx, vy = YB + r, vz = czV + rz;
      world.voxels.delete(`${vx},${vy},${vz}`);
      world.setVoxel(vx, vy, vz, mat);
    };

    // 1) Kaide / Budanmış çalı tabanı (r = 0..1)
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
      putV(u, v, 0);
    }
    putV(0, 0, 1); putV(1, 0, 1); putV(-1, 0, 1); putV(0, 1, 1); putV(0, -1, 1);

    // 2) Gövde, kabarık kuş göğsü ve kanatlar (r = 1..2, insan gövdesi seviyesi)
    putV(1, 0, 1); putV(2, 0, 1); // öne doğru çıkan dolgun göğüs
    putV(-2, 0, 1); // kuyruk başlangıcı
    for (let u = -1; u <= 1; u++) {
      putV(u, 0, 2);
      putV(u, 1, 2);  // sağ kanat
      putV(u, -1, 2); // sol kanat
    }
    putV(2, 0, 2); // yüksek göğüs kavisi
    putV(-1, 2, 2); // açılan sağ kanat ucu
    putV(-1, -2, 2); // açılan sol kanat ucu

    // 3) Yükselen zarif kuyruk tüyleri (r = 2..3)
    putV(-2, 0, 2); putV(-3, 0, 2);
    putV(-2, 1, 2); putV(-2, -1, 2);
    putV(-3, 0, 3); putV(-4, 0, 3); // yukarı ve arkaya uzanan kuyruk
    putV(-3, 1, 3); putV(-3, -1, 3);

    // 4) Kuşun boynu, başı, ibiği ve sivri gagası (r = 3..5, insan boyu zirvesi ~1.8m - 2.0m)
    putV(2, 0, 3); // dik boyun
    putV(2, 0, 4); // kuş başı
    putV(2, 0, 5); // başındaki süslü çalı ibiği (taç)
    putV(3, 0, 4, WOOD); // ileri uzanan sivri gaga!
    putV(0, 1, 3); putV(0, -1, 3); // kanat üst kıvrımları
  };

  // Duvarların içinde, ancak evin dışında kalan bahçe sınırları boyunca yerleştirilen kuş çalılıkları:
  const birdSpots = [
    // Giriş kapısı ve güney avlusu (araç yolunun iki yanı)
    { x: 386.0, z: -55.0, yaw: -Math.PI / 2 },
    { x: 405.0, z: -55.0, yaw: Math.PI / 2 },
    // Batı çevre duvarı boyunca (bahçe çimi üstünde, duvara yakın)
    { x: 377.5, z: -75.0, yaw: 0 },
    { x: 377.5, z: -100.0, yaw: 0 },
    { x: 377.5, z: -125.0, yaw: 0 },
    { x: 377.5, z: -140.0, yaw: 0.3 },
    // Doğu çevre duvarı boyunca (havuz ve terasın doğu çimleri)
    { x: 444.5, z: -75.0, yaw: Math.PI },
    { x: 444.5, z: -100.0, yaw: Math.PI },
    { x: 444.5, z: -125.0, yaw: Math.PI },
    { x: 444.5, z: -140.0, yaw: Math.PI - 0.3 },
    // Kuzey çevre duvarı boyunca
    { x: 400.0, z: -143.5, yaw: Math.PI / 2 },
    { x: 424.0, z: -143.5, yaw: Math.PI / 2 }
  ];
  birdSpots.forEach(s => buildBirdTopiary(s.x, s.z, s.yaw));

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
  const trees = [[373, -144], [373, -122], [373, -100], [373, -80], [373, -62], [373, -52], [446, -144], [446, -122], [446, -100], [446, -80], [446, -62], [446, -52], [427, -54], [437, -56]];
  for (const [x, z] of trees) {
    const [ix, hq, iz] = col(x, z, 9, WOOD);
    for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) + dy > 5) continue;
      world.voxels.delete(`${ix + dx},${hq + 7 + dy},${iz + dz}`); world.setVoxel(ix + dx, hq + 7 + dy, iz + dz, GRASS);
    }
  }
}
