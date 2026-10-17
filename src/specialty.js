import { Kit, P } from './kit.js';

// ─────────────────────────────────────────────────────────────────────────────
// ÖZEL BİNALAR: bankalar (farklı renklerde), fast-food restoranlar (kırmızı-sarı vb.), silindir şirket kuleleri.
//  • Şirket kulelerinde her katta masalarında OTURAN çalışanlar (NPC) çalışır; kulede 7/24 yukarıdan aşağıya gezen bir PATRON vardır.
//  • Çalışanlar ve patron da diğer NPC'ler gibi 2x boydadır ve vurulabilir (kurşunla kafa/gövde, patlamayla dağılma); bir süre sonra aynı yerde yeniden belirirler.
//  • Hepsi voxel koordinatlarında kurulur; sürgülü cam kapıları vardır; içleri döşelidir.
// Kullanım: buildSpecialty(lm) levels.js'ten, bölge binaları kurulduktan sonra çağrılır.
// ─────────────────────────────────────────────────────────────────────────────
const bX = (u) => Math.round(1.5 * (u - 0.5)), bZ = bX;      // eski birim hücre sınırı → voxel indeksi

// Özel parseller (eski birim): { cols: [x1,x2], band: [z1,z2], sign: +1 güney / -1 kuzey } — procedural bina bu parsellere konmaz
export const SPECIAL_LOTS = [
  { id: 'bank-mavi', x: [-161, -137], z: [168, 191], kind: 'bank', theme: 'mavi' },
  { id: 'kule-nova', x: [-161, -137], z: [209, 231], kind: 'kule', theme: 'nova' },
  { id: 'kule-apex', x: [-119, -97], z: [209, 231], kind: 'kule', theme: 'apex' },
  { id: 'kule-vortex', x: [-79, -57], z: [209, 231], kind: 'kule', theme: 'vortex' },
  { id: 'burger', x: [-161, -137], z: [235, 257], kind: 'restoran', theme: 'burger' },
  { id: 'bank-turuncu', x: [-119, -97], z: [235, 257], kind: 'bank', theme: 'turuncu' },
  { id: 'pizza', x: [-79, -57], z: [235, 257], kind: 'restoran', theme: 'pizza' },
  { id: 'bank-yesil', x: [-161, -137], z: [-191, -168], kind: 'bank', theme: 'yesil' },
  { id: 'kule-atlas', x: [-161, -137], z: [-231, -209], kind: 'kule', theme: 'atlas' },
  { id: 'kule-zenith', x: [-119, -97], z: [-231, -209], kind: 'kule', theme: 'zenith' },
  { id: 'kule-cyber', x: [-79, -57], z: [-231, -209], kind: 'kule', theme: 'cyber' },
  { id: 'tavuk', x: [-161, -137], z: [-257, -235], kind: 'restoran', theme: 'tavuk' },
  { id: 'kebap', x: [-119, -97], z: [-257, -235], kind: 'restoran', theme: 'kebap' },
  { id: 'kahve', x: [-79, -57], z: [-257, -235], kind: 'restoran', theme: 'kahve' }
];
export const isSpecialLot = (x1, x2, z1, z2) => SPECIAL_LOTS.some(l => l.x[0] === x1 && l.x[1] === x2 && Math.min(l.z[0], l.z[1]) === Math.min(z1, z2));

// Bir parselin kapısı hangi yöne baksın: en yakın doğu-batı cadde (z = ±66, ±134, ±200, ±266)
function frontOf(l) {
  const zlo = l.z[0], zhi = l.z[1], roads = [-266, -200, -134, -66, 66, 134, 200, 266];
  let best = null;
  for (const r of roads) { const d1 = Math.abs(zlo - r), d2 = Math.abs(zhi - r); const d = Math.min(d1, d2); if (!best || d < best.d) best = { d, front: d1 < d2 ? 'z1' : 'z2' }; }
  return best.front;
}

export function buildSpecialty(lm) {
  const world = lm.world, kit = new Kit(world);
  world.workers = world.workers || []; world.bosses = world.bosses || [];
  for (const l of SPECIAL_LOTS) {
    const box = { X0: bX(l.x[0]), X1: bX(l.x[1] + 1) - 1, Z0: bZ(Math.min(...l.z)), Z1: bZ(Math.max(...l.z) + 1) - 1 };
    const fr = frontOf(l);
    const f = makeFrame(kit, world, box, fr);
    lm.b.footprints.push({ minX: l.x[0], maxX: l.x[1], minZ: Math.min(...l.z), maxZ: Math.max(...l.z) });   // lamba/ağaç/tabela bu parsele girmesin
    if (l.kind === 'bank') bank(f, l.theme);
    else if (l.kind === 'restoran') restaurant(f, l.theme);
    else tower(f, l.theme);
  }
}

// ── Yerel çerçeve: u = cephe boyunca, d = cepheden içeri; satırlar r = zemin üstü (1 = ilk satır) ──
function makeFrame(kit, world, box, front) {
  const alongX = front === 'z1' || front === 'z2';
  const W = alongX ? box.X1 - box.X0 + 1 : box.Z1 - box.Z0 + 1, D = alongX ? box.Z1 - box.Z0 + 1 : box.X1 - box.X0 + 1;
  const map = (u, d) => front === 'z1' ? [box.X0 + u, box.Z0 + d] : front === 'z2' ? [box.X0 + u, box.Z1 - d] : front === 'x1' ? [box.X0 + d, box.Z0 + u] : [box.X1 - d, box.Z0 + u];
  const out = { z1: [0, -1], z2: [0, 1], x1: [-1, 0], x2: [1, 0] }[front], rot = { z1: Math.PI, z2: 0, x1: -Math.PI / 2, x2: Math.PI / 2 }[front];
  const f = {
    kit, world, W, D, front, out, rot, box, map,
    b(u0, u1, d0, d1, r0, r1, mat) { const a = map(u0, d0), c = map(u1, d1); kit.put(Math.min(a[0], c[0]), r0, Math.min(a[1], c[1]), Math.max(a[0], c[0]), r1, Math.max(a[1], c[1]), mat); },
    clr(u0, u1, d0, d1, r0, r1) { const a = map(u0, d0), c = map(u1, d1); kit.clr(Math.min(a[0], c[0]), r0, Math.min(a[1], c[1]), Math.max(a[0], c[0]), r1, Math.max(a[1], c[1])); },
    wx: (u, d) => 0.5 * map(u, d)[0], wz: (u, d) => 0.5 * map(u, d)[1], Y: (r) => 0.5 * r,
    // Cepheye dik (d = 0 duvarında) sürgülü cam kapı: u0..u1 aralığı, satırlar r0..r1
    door(u0, u1, r0, r1, d = 0) {
      f.clr(u0, u1, d, d, r0, r1);
      const a = map(u0, d), c = map(u1, d), n = u1 - u0 + 1, h = (r1 - r0 + 1) * 0.5 - 0.05, width = n * 0.5 - 0.08, y = 0.5 * r0;
      if (alongX) world.doors.addSliding({ sx: 0.5 * Math.min(a[0], c[0]) - 0.25 + 0.04, sz: 0.5 * a[1], ax: 1, az: 0, width, height: h, y });
      else world.doors.addSliding({ sx: 0.5 * a[0], sz: 0.5 * Math.min(a[1], c[1]) - 0.25 + 0.04, ax: 0, az: 1, width, height: h, y });
    },
    // Dışa bakan yazılı tabela (cephenin önüne, wall d = -0.3)
    sign(text, o, u, r) { kit.sign(text, o, f.wx(u, 0) + out[0] * 0.3, 0.5 * r, f.wz(u, 0) + out[1] * 0.3, rot); },
    prop(kind, u, d, r, o) { kit.prop(kind, f.wx(u, d), 0.5 * r, f.wz(u, d), o); },
    worker(u, d, r, yaw, pose = 'sit', style = 'office') { world.workers.push({ x: f.wx(u, d), y: 0.5 * r, z: f.wz(u, d), yaw: yaw + 0, pose, style }); },
    // Yerel (du, dd) yönünün dünya yaw açısı (nesne o yöne baksın)
    dirYaw(du, dd) { const a = map(0, 0), b = map(du, dd); return Math.atan2(b[0] - a[0], b[1] - a[1]); },
    yawIn() { return Math.atan2(-out[0], -out[1]); },
    yawOut() { return Math.atan2(out[0], out[1]); }
  };
  return f;
}

// ═══════════════════════════════════ BANKA ═══════════════════════════════════
const BANKS = {
  mavi: { name: 'MAVİ BANK', wall: P.BLUE, trim: P.NAVY, sign: [0x1d4ed8, 0xffffff], accent: P.LAMP_BLUE },
  turuncu: { name: 'TURUNCU BANK', wall: P.ORANGE, trim: P.WHITE, sign: [0xea580c, 0xffffff], accent: P.LAMP_ORANGE },
  yesil: { name: 'YEŞİL KREDİ', wall: P.DGREEN, trim: P.WHITE, sign: [0x15803d, 0xffffff], accent: P.LAMP_GREEN }
};
function bank(f, theme) {
  const T = BANKS[theme], W0 = f.W, u0 = 3, u1 = f.W - 4, d0 = 4, d1 = f.D - 4, H = 14, Wd = u1 - u0 + 1;
  const mid = Math.floor((u0 + u1) / 2);
  f.b(0, f.W - 1, 0, f.D - 1, 1, 1, P.CONCRETE);                       // meydan zemini
  // Gövde
  f.b(u0, u1, d0, d1, 1, H, T.wall);                                      // dolu blok, sonra içi oyulur
  f.clr(u0 + 1, u1 - 1, d0 + 1, d1 - 1, 1, H - 1);
  f.b(u0, u1, d0, d1, H + 1, H + 1, P.WHITE);                           // çatı döşemesi
  f.b(u0, u1, d0, d1, H + 2, H + 2, T.trim);                            // korkuluk halkası (üstü açık)
  f.clr(u0 + 1, u1 - 1, d0 + 1, d1 - 1, H + 2, H + 2);
  // Cephe: beyaz sütunlar arası cam; portik (öne çıkan sundurma)
  f.clr(u0 + 1, u1 - 1, d0, d0, 1, H - 1);
  f.b(u0 + 1, u1 - 1, d0, d0, 1, 9, P.GLASS);
  for (let u = u0 + 1; u <= u1 - 1; u += 6) f.b(u, u + 1, d0 - 3, d0 - 2, 1, H, P.WHITE);   // 2x2 sütunlar
  f.b(u0, u1, d0 - 4, d0, H, H, P.WHITE); f.b(u0, u1, d0 - 4, d0 - 4, H - 1, H, T.trim); f.b(u0, u1, d0 - 4, d0, H + 1, H + 1, P.GOLD);   // portik tavanı ve altın saçak
  f.b(u0 - 1, u1 + 1, d0 - 6, d0 - 5, 1, 1, P.WHITE); f.b(u0 - 2, u1 + 2, d0 - 8, d0 - 7, 1, 1, P.CONCRETE);                               // basamaklar
  f.door(mid - 2, mid + 1, 1, 7, d0);                                                                                                    // sürgülü cam giriş
  f.b(mid - 3, mid + 2, d0 - 1, d0 - 1, 10, 13, T.trim); f.b(u0, u1, d0, d0, 10, 13, T.wall);                                              // giriş üstü bant
  // Tabela ve madeni para amblemi
  f.sign(T.name, { bg: T.sign[0], fg: T.sign[1], w: 8.5, h: 1.5 }, mid, 11.4);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (a * a + b * b <= 5) f.b(mid + a, mid + a, d0 - 1, d0 - 1, H + 5 + b, H + 5 + b, P.GOLD);   // altın sikke
  f.b(mid, mid, d0 - 1, d0 - 1, H + 4, H + 4, P.GOLD);
  f.b(u0 - 2, u0 - 2, d0 - 3, d0 - 3, 1, 3, P.BLACK); f.b(u0 - 2, u0 - 2, d0 - 2, d0 - 2, 2, 3, P.LAMP_GREEN);                              // ATM: siyah kutu + yeşil ekran
  // İç: halı, gişeler, kasa dairesi, ATM, bekleme
  f.b(mid - 2, mid + 1, d0 + 1, d1 - 8, 1, 1, P.ROOF);                                                                                      // kırmızı halı
  const gy = d1 - 9;
  f.b(u0 + 2, u1 - 2, gy, gy, 1, 2, P.BLACK); f.b(u0 + 2, u1 - 2, gy, gy, 3, 3, P.WHITE);                                                    // gişe tezgâhı
  for (let u = u0 + 4; u < u1 - 3; u += 5) { f.b(u, u + 2, gy, gy, 4, 6, P.GLASS); f.b(u + 1, u + 1, gy + 1, gy + 1, 4, 4, P.LAMP_GREEN); f.b(u, u, gy + 1, gy + 1, 4, 5, P.IRON); }   // cam bölme + bilgisayar
  f.b(u0 + 2, u1 - 2, gy - 1, gy - 1, 4, 4, T.accent);                                                                                      // LED şerit
  f.b(mid - 3, mid + 2, d1 - 1, d1, 2, 7, P.IRON); f.b(mid - 1, mid, d1 - 2, d1 - 2, 4, 5, P.GOLD); f.b(mid - 2, mid + 1, d1 - 2, d1 - 2, 3, 3, P.GOLD);   // kasa kapısı (demir) + altın çark
  for (let k = 0; k < 4; k++) { f.b(u0 + 3 + k * 2, u0 + 3 + k * 2, d1, d1, 2, 3, P.IRON); }
  for (let i = 0; i < 2; i++) { const u = u0 + 6 + i * 12; f.b(u, u + 3, d0 + 6, d0 + 6, 1, 1, P.WHITE); f.prop('chair', u + 1, d0 + 7.4, 2, { yaw: f.yawIn(), color: 0x1d4ed8 }); f.prop('chair', u + 3, d0 + 7.4, 2, { yaw: f.yawIn(), color: 0x1d4ed8 }); }   // bekleme sırası
  f.prop('plant', u0 + 2, d0 + 3, 2); f.prop('plant', u1 - 2, d0 + 3, 2);
  for (let u = u0 + 3; u < u1 - 2; u += 6) for (let d = d0 + 5; d < d1 - 3; d += 7) f.b(u, u, d, d, H, H, P.LAMP);                           // tavan lambaları
  // Çalışanlar: gişelerin arkasında iki memur ayakta; bir yönetici
  f.worker(u0 + 6, gy + 3, 2, f.yawOut(), 'stand', 'bank'); f.worker(u0 + 18, gy + 3, 2, f.yawOut(), 'stand', 'bank');
}

// ═══════════════════════════════ FAST-FOOD RESTORAN ═══════════════════════════════
const FOOD = {
  burger: { name: 'BURGER BEY', wall: P.RED, trim: P.YELLOW, sign: [0xdc2626, 0xfacc15], arches: true, chair: [0xdc2626, 0xfacc15], menu: P.YELLOW },
  pizza: { name: 'PİZZA PAŞA', wall: P.WHITE, trim: P.RED, sign: [0x15803d, 0xffffff], arches: false, chair: [0xdc2626, 0x15803d], menu: P.RED },
  tavuk: { name: 'KIZARMIŞ TAVUK', wall: P.YELLOW, trim: P.RED, sign: [0xfacc15, 0xdc2626], arches: false, chair: [0xdc2626, 0xf3f4f6], menu: P.RED },
  kebap: { name: 'KEBAPÇI ADEM', wall: P.BRICK, trim: P.GOLD, sign: [0x7c2d12, 0xfef3c7], arches: false, chair: [0x111827, 0x7c2d12], menu: P.GOLD },
  kahve: { name: 'KAHVE EVİ', wall: P.DGREEN, trim: P.WHITE, sign: [0x14532d, 0xfef3c7], arches: false, chair: [0x3f2a1d, 0xf3f4f6], menu: P.WHITE }
};
function restaurant(f, theme) {
  const T = FOOD[theme], u0 = 3, u1 = f.W - 4, d0 = 4, d1 = Math.min(f.D - 4, d0 + 22), H = 8, mid = Math.floor((u0 + u1) / 2);
  f.b(0, f.W - 1, 0, f.D - 1, 1, 1, P.CONCRETE);
  f.b(u0, u1, d0, d1, 1, H, T.wall); f.clr(u0 + 1, u1 - 1, d0 + 1, d1 - 1, 1, H);
  f.b(u0, u1, d0, d1, H + 1, H + 1, T.trim); f.b(u0 - 1, u1 + 1, d0 - 2, d1 + 1, H + 2, H + 2, T.trim);   // çatı + saçak
  // Geniş cam cephe, sarı/kırmızı bant, sürgülü kapı
  f.clr(u0 + 1, u1 - 1, d0, d0, 1, H - 2);
  f.b(u0 + 1, u1 - 1, d0, d0, 1, H - 2, P.GLASS); for (let u = u0 + 4; u < u1 - 2; u += 6) f.b(u, u, d0, d0, 1, H - 2, P.BLACK);
  f.b(u0, u1, d0, d0, H - 1, H, T.trim);
  f.door(mid - 2, mid + 1, 1, 6, d0);
  f.sign(T.name, { bg: T.sign[0], fg: T.sign[1], w: Math.min(8, (u1 - u0) * 0.5 - 0.5), h: 1.3 }, mid, H + 0.9);
  // Burger: altın kemerler ("M") çatı üstünde: iki kemer yan yana (her biri iki ayak + üst köprü)
  if (T.arches) for (const cu of [mid - 3, mid + 3]) {
    for (let r = 0; r <= 5; r++) { f.b(cu - 2, cu - 2, d0 - 1, d0 - 1, H + 3 + r, H + 3 + r, P.YELLOW); f.b(cu + 2, cu + 2, d0 - 1, d0 - 1, H + 3 + r, H + 3 + r, P.YELLOW); }
    f.b(cu - 1, cu + 1, d0 - 1, d0 - 1, H + 9, H + 9, P.YELLOW); f.b(cu - 2, cu - 2, d0 - 1, d0 - 1, H + 9, H + 9, P.YELLOW); f.b(cu + 2, cu + 2, d0 - 1, d0 - 1, H + 9, H + 9, P.YELLOW);
  }
  // İç: kasa tezgâhı (3 kasa), mutfak, menü panoları
  const cd = d1 - 7;
  f.b(u0 + 2, u1 - 2, cd, cd, 1, 2, T.trim); f.b(u0 + 2, u1 - 2, cd, cd, 3, 3, P.WHITE);
  for (let u = u0 + 5; u <= u1 - 5; u += 6) { f.b(u, u, cd, cd, 4, 4, P.IRON); f.b(u, u, cd, cd, 5, 5, P.LAMP_GREEN); }
  f.b(u0 + 1, u1 - 1, d1 - 1, d1 - 1, 3, 7, P.BLACK); for (let u = u0 + 3; u < u1 - 2; u += 3) { f.b(u, u + 1, d1 - 1, d1 - 1, 5, 5, T.menu); f.b(u, u, d1 - 1, d1 - 1, 4, 4, P.WHITE); f.b(u + 1, u + 1, d1 - 1, d1 - 1, 6, 6, P.LAMP_ORANGE); }   // menü panosu
  f.b(u0 + 2, u1 - 2, d1 - 3, d1 - 2, 1, 2, P.IRON); f.b(u0 + 3, u0 + 6, d1 - 3, d1 - 3, 3, 3, P.LAMP_ORANGE); f.b(u1 - 7, u1 - 3, d1 - 3, d1 - 3, 3, 3, P.WHITE);   // mutfak ekipmanı: ızgara + tezgâh
  f.b(u0 + 2, u0 + 3, d1 - 5, d1 - 4, 1, 4, P.WHITE); f.b(u0 + 2, u0 + 3, d1 - 5, d1 - 5, 3, 3, P.LAMP_BLUE);                                 // buzdolabı
  for (let u = u0 + 5; u <= u1 - 5; u += 6) f.prop('tray', u, cd + 0.5, 4, { yaw: 0.3 });
  // Yemek alanı: 6 masa, 4'er sandalye (tutulabilir), çöp kutusu, oyun köşesi
  const tables = [[u0 + 5, d0 + 4], [mid, d0 + 4], [u1 - 5, d0 + 4], [u0 + 5, d0 + 11], [mid, d0 + 11], [u1 - 5, d0 + 11]];
  tables.forEach(([u, d], i) => {
    f.b(u, u, d, d, 1, 2, P.IRON); f.b(u - 1, u + 1, d - 1, d + 1, 3, 3, i % 2 ? T.trim : P.WHITE);
    [[-2, 0], [2, 0], [0, -2], [0, 2]].forEach(([du, dd], k) => f.prop('chair', u + du * 0.62, d + dd * 0.62, 1, { yaw: f.dirYaw(-du, -dd), color: T.chair[(i + k) % 2] }));
    f.prop('tray', u, d, 4, { yaw: i });
  });
  f.b(u1 - 2, u1 - 1, d0 + 1, d0 + 2, 1, 3, P.BLACK); f.b(u1 - 2, u1 - 1, d0 + 1, d0 + 1, 3, 3, P.GRASS);                                       // çöp kutusu
  for (let u = u0 + 2; u <= u0 + 6; u++) for (let d = d1 - 11; d <= d1 - 9; d++) f.b(u, u, d, d, 1, 1, [P.RED, P.YELLOW, P.BLUE, P.DGREEN][(u + d) % 4]);   // top havuzu (oyun köşesi)
  for (let u = u0 + 3; u < u1 - 2; u += 6) for (let d = d0 + 3; d < d1 - 2; d += 7) f.b(u, u, d, d, H, H, P.LAMP);                           // tavan lambaları
  // Çalışanlar: kasanın arkasında iki, mutfakta bir
  f.worker(u0 + 6, cd + 2, 1.5, f.yawOut(), 'stand', 'chef'); f.worker(u1 - 6, cd + 2, 1.5, f.yawOut(), 'stand', 'chef'); f.worker(mid, d1 - 3, 1.5, f.yawOut(), 'stand', 'chef');
}

// ═══════════════════════════════ SİLİNDİR ŞİRKET KULESİ ═══════════════════════════════
const TOWERS = {
  nova: { name: 'NOVA HOLDİNG', glass: P.GLASS, frame: P.BLACK, top: P.LAMP_BLUE, slab: P.WHITE, sign: [0x0f172a, 0x38bdf8] },
  atlas: { name: 'ATLAS GRUP', glass: P.GLASS, frame: P.WHITE, top: P.LAMP_ORANGE, slab: P.CONCRETE, sign: [0x7c2d12, 0xfde68a] },
  apex: { name: 'APEX CORP', glass: P.GLASS, frame: P.DGREEN, top: P.LAMP_GREEN, slab: P.WHITE, sign: [0x064e3b, 0x34d399] },
  vortex: { name: 'VORTEX TECH', glass: P.GLASS, frame: P.NAVY, top: P.LAMP_PURPLE, slab: P.WHITE, sign: [0x3b0764, 0xd8b4fe] },
  zenith: { name: 'ZENITH PLAZA', glass: P.GLASS, frame: P.GOLD, top: P.GOLD, slab: P.WHITE, sign: [0x78350f, 0xfde047] },
  cyber: { name: 'CYBER HOLDİNG', glass: P.GLASS, frame: P.BLACK, top: P.LAMP_PINK, slab: P.CONCRETE, sign: [0x4c0519, 0xf43f5e] }
};
function tower(f, theme) {
  const T = TOWERS[theme] || TOWERS.nova, world = f.world, kit = f.kit;
  const R = 13, F = 9;                                           // yarıçap (voxel), kat sayısı
  const dc = 6 + R;                                              // kule merkezi cepheden 19 voxel içeride (öndeki 6 voxel: meydan + lobi)
  const u = Math.floor(f.W / 2);
  const [cx, cz] = f.map(u, dc);
  kit.put(f.box.X0, 1, f.box.Z0, f.box.X1, 1, f.box.Z1, P.CONCRETE);          // meydan zemini
  const flr = (k) => 8 * k + 1;                                  // k. katın yürünebilir ilk satırı (k=0: 1)
  const wall = [], disc = [];
  for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) { const d = Math.hypot(dx, dz); if (d >= R - 0.5 && d < R + 0.5) wall.push([dx, dz]); else if (d < R - 0.5) disc.push([dx, dz]); }
  // Kat döşemeleri ve cam cephe (kuşaklı)
  for (let k = 1; k <= F; k++) for (const [dx, dz] of disc) kit.put(cx + dx, 8 * k, cz + dz, cx + dx, 8 * k, cz + dz, k === F ? P.BLACK : T.slab);
  for (const [dx, dz] of disc) kit.clr(cx + dx, 1, cz + dz, cx + dx, 1, cz + dz);                 // zemin kat içi: meydan betonu kulenin içine girmesin (iç zemin = arazi)
  for (const [dx, dz] of wall) {
    const ci = Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * 36), mull = ci % 3 === 0;
    for (let k = 0; k < F; k++) for (let r = 1; r <= 7; r++) kit.put(cx + dx, 8 * k + r, cz + dz, cx + dx, 8 * k + r, cz + dz, mull ? T.frame : T.glass);
    for (let k = 1; k <= F; k++) kit.put(cx + dx, 8 * k, cz + dz, cx + dx, 8 * k, cz + dz, k === F ? T.top : T.frame);   // kat kuşakları (en üstte renkli ışık kuşağı)
    kit.put(cx + dx, 8 * F + 1, cz + dz, cx + dx, 8 * F + 1, cz + dz, P.BLACK);                                           // çatı korkuluğu
  }
  // Giriş: öne çıkan cam lobi (d = 3..dc-R) ve dar merdiven/çıkış kapısı; kule cephesinde geçit
  const lobbyD1 = dc - R + 1;
  f.b(u - 5, u + 5, 3, lobbyD1, 1, 8, P.WHITE); f.clr(u - 4, u + 4, 4, lobbyD1, 1, 7);
  f.b(u - 4, u + 4, 3, 3, 1, 7, T.glass); for (const uu of [u - 4, u, u + 4]) f.b(uu, uu, 3, 3, 1, 7, T.frame);
  f.clr(u - 1, u + 1, lobbyD1, lobbyD1 + 1, 1, 7);                                                                        // lobiden kuleye dar geçit (çıkışta sıkışma noktası)
  f.door(u - 1, u + 1, 1, 7, 3);
  f.sign(T.name, { neon: true, color: T.sign[1], fg: T.sign[1], w: 8.4, h: 1.5 }, u, 9.4);

  const bldId = `kule-${theme}-${cx}-${cz}`;
  const doorPos = { x: f.wx(u, 3), y: 0.5, z: f.wz(u, 3), outX: f.out[0], outZ: f.out[1], chokeX: f.wx(u, lobbyD1), chokeZ: f.wz(u, lobbyD1) };
  world.officeBuildings = world.officeBuildings || [];
  world.officeBuildings.push({
    id: bldId,
    minX: 0.5 * f.box.X0 - 1.5, maxX: 0.5 * f.box.X1 + 1.5,
    minZ: 0.5 * f.box.Z0 - 1.5, maxZ: 0.5 * f.box.Z1 + 1.5,
    damage: 0, evacuated: false, doorPos
  });

  // Giriş katı: resepsiyon, bekleme koltukları, bitkiler
  const rd = dc - 4;
  f.b(u - 3, u + 3, rd, rd, 1, 2, P.BLACK); f.b(u - 3, u + 3, rd, rd, 3, 3, P.WHITE); f.b(u - 1, u - 1, rd - 1, rd - 1, 3, 3, P.IRON); f.b(u - 1, u - 1, rd - 1, rd - 1, 4, 4, P.LAMP_BLUE);
  world.workers.push({
    x: f.wx(u, rd + 2), y: 0.5, z: f.wz(u, rd + 2), yaw: f.yawOut(), pose: 'stand', style: 'office',
    buildingId: bldId, doorPos,
    exitPath: [
      { x: doorPos.chokeX, y: 0.5, z: doorPos.chokeZ, choke: true },
      { x: doorPos.x, y: 0.5, z: doorPos.z, door: true },
      { x: f.wx(u, -2), y: 0.5, z: f.wz(u, -2), outside: true }
    ]
  });
  for (const uu of [u + 7]) { f.b(uu, uu + 2, dc - 6, dc - 6, 1, 1, P.WHITE); f.prop('chair', uu + 1, dc - 7.4, 2, { yaw: f.dirYaw(0, 1), color: 0x111827 }); f.prop('plant', uu + 3, dc - 5, 1); }
  // Merdiven: iki şerit (A: +z yönünde, B: yanında -z yönünde); kat k → k+1. Dünya eksenlerinde sabit (kulenin iç yapısı)
  const laneA = [cx - 9, cx - 7], laneB = [cx - 5, cx - 3], zA0 = cz - 5, zB0 = cz + 2;
  for (let k = 0; k < F - 1; k++) {
    const r = flr(k), even = k % 2 === 0, lane = even ? laneA : laneB;
    for (let j = 1; j <= 7; j++) { const z = even ? zA0 + (j - 1) : zB0 - (j - 1); kit.put(lane[0], r, z, lane[1], r + j - 1, z, P.WHITE); kit.put(lane[0], r + j - 1, z, lane[0], r + j - 1, z, P.IRON); }
    const zs = even ? zA0 - 1 : zB0 - 6, ze = even ? zA0 + 6 : zB0 + 1;                      // üst döşemedeki delik: ilk basamağın bir önünden sonuncuya (dev gövde ilk basamakta tavana çarpmasın)
    kit.clr(lane[0], 8 * (k + 1), Math.min(zs, ze), lane[1], 8 * (k + 1), Math.max(zs, ze));
    kit.put(lane[1] + 1, 8 * (k + 1) + 1, Math.min(zs, ze), lane[1] + 1, 8 * (k + 1) + 2, Math.max(zs, ze), P.GLASS);   // korkuluk
  }
  // Kat k'dan zemin kattaki dar merdiven çıkış kapısına iniş rotası
  const buildStairExitPath = (fromFloor) => {
    const pts = [];
    for (let m = fromFloor; m >= 1; m--) {
      const s = m - 1, even = s % 2 === 0;
      const sx = 0.5 * (even ? cx - 8 : cx - 4);
      const szTop = 0.5 * (even ? zA0 + 7 : zB0 - 7);
      const szBot = 0.5 * (even ? zA0 - 1 : zB0 + 1);
      pts.push({ x: 0.5 * (cx - 1), y: 0.5 * flr(m), z: szTop, tol: 0.65 });
      pts.push({ x: sx, y: 0.5 * flr(m), z: szTop, tol: 0.42 });
      pts.push({ x: sx, y: 0.5 * flr(m - 1), z: szBot, tol: 0.45 });
    }
    // Zemin katta merdiven ağzından dar çıkış kapısına ve dışarıya
    pts.push({ x: 0.5 * (cx - 5), y: 0.5, z: 0.5 * cz, tol: 0.6 });
    pts.push({ x: doorPos.chokeX, y: 0.5, z: doorPos.chokeZ, choke: true, tol: 0.45 });
    pts.push({ x: doorPos.x, y: 0.5, z: doorPos.z, door: true, tol: 0.45 });
    pts.push({ x: f.wx(u, -2), y: 0.5, z: f.wz(u, -2), outside: true, tol: 0.7 });
    return pts;
  };
  // Katlar: masalar + oturan çalışanlar (zemin kat hariç)
  for (let k = 1; k < F; k++) {
    const r = flr(k);
    const floorExit = buildStairExitPath(k);
    for (let i = 0; i < 8; i++) {
      const ang = (i + 0.5) * Math.PI / 4;
      if (Math.cos(ang) < -0.5) continue;                          // merdiven tarafı (batı) boş
      const px = cx + Math.round(Math.cos(ang) * 10), pz = cz + Math.round(Math.sin(ang) * 10);
      kit.put(px - 1, r, pz - 1, px + 1, r, pz + 1, P.BLACK); kit.put(px - 1, r + 1, pz - 1, px + 1, r + 1, pz + 1, P.WHITE);   // masa
      kit.put(px, r + 2, pz, px, r + 2, pz, P.IRON); kit.put(px, r + 3, pz, px, r + 3, pz, P.LAMP_BLUE);                      // monitör
      const wx = 0.5 * (cx + Math.round(Math.cos(ang) * 6.4)), wz = 0.5 * (cz + Math.round(Math.sin(ang) * 6.4)), yaw = Math.atan2(Math.cos(ang), Math.sin(ang));   // çalışan masaya (dışa) bakar
      kit.prop('chair', wx, 0.5 * r, wz, { yaw, color: 0x111827 });
      world.workers.push({
        x: wx, y: 0.5 * r, z: wz, yaw, pose: 'sit', style: 'office',
        buildingId: bldId, doorPos,
        exitPath: floorExit.map(p => ({ ...p }))
      });
    }
    for (let a = 0; a < 8; a++) { const px = cx + Math.round(Math.cos(a * Math.PI / 4) * 5), pz = cz + Math.round(Math.sin(a * Math.PI / 4) * 5); kit.put(px, 8 * k + 7, pz, px, 8 * k + 7, pz, P.LAMP); }
  }
  kit.put(cx, 8 * F + 2, cz, cx, 8 * F + 9, cz, P.IRON); kit.put(cx, 8 * F + 10, cz, cx, 8 * F + 10, cz, T.top);   // çatı anteni
  // PATRON: kulenin tüm katlarında yukarıdan aşağıya (ve tersi) 7/24 gezer. Her katta çekirdek çevresinde kısa tur, sonra merdivenle diğer kata.
  // Yol parçaları merdiven şeritlerinden ve korkuluklardan uzak tutulur (dev gövde 0.9 m genişliğinde); ayaklara hassas (tol) hizalanır.
  const pt = (x, r, z, tol) => ({ x: 0.5 * x, y: 0.5 * r, z: 0.5 * z, ...(tol ? { tol } : {}) });
  const route = [];
  for (let k = 0; k < F; k++) {
    const r = flr(k), evenK = k % 2 === 0;
    if (k > 0) route.push(pt(cx + 1, r, k % 2 === 1 ? cz + 6 : cz - 6));                       // geldiği şeridin ağzından çekirdeğe
    if (k === 0) route.push(pt(cx - 5, r, cz + 2), pt(cx - 5, r, cz - 2), pt(cx - 5, r, cz - 6));         // zemin kat: resepsiyon tezgâhının (merkezden 4 voxel ön) batısında yürür
    else route.push(pt(cx + 2, r, cz + 2), pt(cx + 2, r, cz - 2));                                // çekirdek çevresinde tur
    if (k < F - 1) {
      if (evenK) { if (k > 0) route.push(pt(cx + 1, r, cz - 6)); route.push(pt(cx - 8, r, zA0 - 1, 0.3)); route.push(pt(cx - 8, flr(k + 1), zA0 + 11)); }   // A şeridi: güneyden kuzeye
      else { route.push(pt(cx + 1, r, cz + 3)); route.push(pt(cx - 4, r, zB0 + 1, 0.3)); route.push(pt(cx - 4, flr(k + 1), zB0 - 11)); }      // B şeridi: kuzeyden güneye
    }
  }
  world.bosses.push({ route, name: T.name, buildingId: bldId, doorPos });
}
