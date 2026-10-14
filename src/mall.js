import { Kit, P } from './kit.js';

// ─────────────────────────────────────────────────────────────────────────────
// AVM İÇ MEKANI: 4 katın hepsinde dükkânlar; en üst kat YEMEK KATI (dönerci, lahmacun, pizza, hamburger, kebap, tavuk, dondurma, kahve,
// baklava, kumpir, sushi, çiğ köfte). Giriş katındaki kahverengi masa-sandalyeler ve tezgâhlar kaldırıldı.
// Her dükkân kendi bölmesinde ~7 m × 6 m: vitrin, kapı boşluğu, renkli tabela (yazılı), içinde tezgâh/raf/ekipman ve ürünler.
// Askıdaki kıyafetler, sandalyeler, tepsiler, kutular tutulabilir eşyadır (sağ tık).
// Koordinatlar: AVM yerleşimi eski birimle (0.75 m) verilir; iç mekan voxel (0.5 m) cinsinden çizilir.
// ─────────────────────────────────────────────────────────────────────────────
const COL = [P.BRICK, P.GOLD, P.LAMP_BLUE, P.LAMP_GREEN, P.LAMP_PINK, P.LAMP_ORANGE, P.LAMP_PURPLE, P.WHITE, P.BLACK, P.GRASS];
const FLOOR_ROWS = [1, 14, 26, 38];          // kat yüzeyi (ilk yürünebilir voxel satırı); AVM kat yüksekliği 6 m
const CEIL = [12, 24, 36, 50];                // her katın en üst boş satırı

// Dükkân türleri: ad, tabela renkleri, içerik fonksiyonu adı
const SHOPS = {
  tisort: ['TİŞÖRT & MODA', 0x7c3aed, 0xffffff], jean: ['JEAN DÜNYASI', 0x1d4ed8, 0xffffff], elektronik: ['TEKNO MARKET', 0x0f172a, 0x38bdf8], ayakkabi: ['AYAKKABI', 0xdc2626, 0xffffff],
  market: ['MİNİ MARKET', 0x16a34a, 0xffffff], oyuncak: ['OYUNCAK', 0xf59e0b, 0x111827], kitap: ['KİTABEVİ', 0x78350f, 0xfef3c7], mucevher: ['KUYUMCU', 0x111827, 0xfacc15],
  spor: ['SPOR', 0xea580c, 0xffffff], kozmetik: ['GÜZELLİK', 0xdb2777, 0xffffff], eczane: ['ECZANE', 0x15803d, 0xffffff], mobilya: ['MOBİLYA', 0x92400e, 0xffffff],
  doner: ['DÖNER EVİ', 0xb91c1c, 0xfde68a], lahmacun: ['LAHMACUN', 0x9a3412, 0xffffff], pizza: ['PİZZA', 0xdc2626, 0xffffff], burger: ['BURGER', 0xdc2626, 0xfacc15],
  kebap: ['ŞİŞ KEBAP', 0x7c2d12, 0xfef3c7], tavuk: ['KIZARMIŞ TAVUK', 0xfacc15, 0xb91c1c], dondurma: ['DONDURMA', 0xf472b6, 0xffffff], kahve: ['KAHVE', 0x3f2a1d, 0xfef3c7],
  donut: ['DONAT', 0xec4899, 0xffffff], baklava: ['BAKLAVA & TATLI', 0xca8a04, 0x3f1d0b], kumpir: ['KUMPİR', 0xd97706, 0xffffff], sushi: ['SUSHI', 0x111827, 0xf87171], cigkofte: ['ÇİĞ KÖFTE', 0x15803d, 0xfef08a]
};
// Kat başına dükkân sırası (12 yuva): her yarıda [büyük dükkân, büyük dükkân, küçük kafe] × (batı, doğu). Yemek katında büyük dükkânlar da yemekçidir.
const PLAN = [
  ['tisort', 'elektronik', 'ayakkabi', 'market', 'kahve', 'donut', 'oyuncak', 'kitap', 'kozmetik', 'mucevher', 'donut', 'dondurma'],
  ['jean', 'tisort', 'spor', 'mobilya', 'donut', 'kahve', 'elektronik', 'oyuncak', 'mucevher', 'kozmetik', 'kahve', 'dondurma'],
  ['eczane', 'tisort', 'ayakkabi', 'jean', 'dondurma', 'donut', 'spor', 'market', 'kitap', 'elektronik', 'kahve', 'kahve'],
  ['doner', 'lahmacun', 'pizza', 'burger', 'kahve', 'donut', 'kebap', 'tavuk', 'sushi', 'baklava', 'dondurma', 'kahve']
];
const FOOD = new Set(['doner', 'lahmacun', 'pizza', 'burger', 'kebap', 'tavuk', 'dondurma', 'kahve', 'baklava', 'kumpir', 'sushi', 'cigkofte', 'donut']);
const KITCHEN_HAT = new Set(['doner', 'lahmacun', 'pizza', 'burger', 'kebap', 'tavuk', 'baklava', 'kumpir', 'sushi', 'cigkofte']);
// Dükkânın tezgâhlarına/raflarına serpiştirilen tutulabilir ürünler (sağ tık eli): [tür, adet]
const PRODUCTS = {
  tisort: [['bag', 3], ['shirt', 3], ['gift', 2]], jean: [['bag', 3], ['pants', 3], ['shoe', 3]], elektronik: [['phone', 9], ['laptop', 4], ['gift', 2]],
  ayakkabi: [['shoe', 16], ['box', 3]], market: [['can', 18], ['bottle', 8], ['box', 4], ['bag', 3]], oyuncak: [['teddy', 4], ['toycar', 7], ['ball', 4], ['gift', 3]],
  kitap: [['book', 12]], mucevher: [['gift', 7]], spor: [['dumbbell', 9], ['ball', 6], ['shoe', 4], ['bottle', 3]], kozmetik: [['bottle', 9], ['gift', 4]],
  eczane: [['bottle', 8], ['gift', 5]], mobilya: [['cushion', 3], ['plant', 3], ['book', 2]],
  doner: [['wrap', 7], ['tray', 2], ['can', 4]], lahmacun: [['lahmacun', 8], ['can', 3]], pizza: [['pizzaslice', 10], ['pizzabox', 3], ['can', 3]],
  burger: [['burger', 9], ['can', 5], ['tray', 2]], kebap: [['wrap', 7], ['tray', 2], ['can', 3]], tavuk: [['bucket', 5], ['can', 4]],
  dondurma: [['icecream', 8]], kahve: [['coffee', 10], ['donut', 4]], baklava: [['sweet', 9]], kumpir: [['tray', 3], ['can', 3]],
  sushi: [['sushi', 8]], cigkofte: [['wrap', 7]], donut: [['donut', 18], ['coffee', 5]]
};

export function furnishMall(lm, x1, y1, z1, x2, y2, z2, MALL_FLOOR) {
  const kit = new Kit(lm.world), world = lm.world, vox = world.voxels;
  world.workers = world.workers || []; world.residents = world.residents || [];
  const bX = (u) => Math.round(1.5 * (u - 0.5)), bZ = bX;        // eski birim hücre sınırı → voxel indeksi
  const xc = Math.round((x1 + x2) / 2), zc = Math.round((z1 + z2) / 2);
  const cxV = bX(xc), czV = bZ(zc);
  const floors = []; for (let k = 0; y1 + MALL_FLOOR * k < y2 - 2; k++) floors.push(k);
  const halves = [[z1 + 3, zc - 8], [zc + 8, z2 - 3]];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

  floors.forEach(k => {
    let n = 0;
    halves.forEach(([za, zb]) => {
      const sizes = [11, 11, zb - za + 1 - 22];                  // iki büyük dükkân (7.5 m) + bir küçük kafe (3-4 m)
      let zs = za;
      sizes.forEach((pitch, si) => {
        ['w', 'e'].forEach(side => buildSlot(k, side, zs, pitch, si < 2, PLAN[Math.min(k, 3)][n++], si === 2));
        zs += pitch;
      });
    });
  });
  corridorFurniture();
  plazaAndStairs();

  // ── Dükkân bölmesi ──
  function buildSlot(k, side, zs, pitch, hasNext, type, cafe) {
    const xa = side === 'w' ? x1 + 3 : xc + 4, xb = side === 'w' ? xc - 4 : x2 - 3, xf = side === 'w' ? xb : xa;
    const Xi0 = side === 'w' ? bX(xa + 1) : bX(xf + 1), Xi1 = side === 'w' ? bX(xf) - 1 : bX(xb) - 1;
    const Zi0 = bZ(zs + 1), Zi1 = hasNext ? bZ(zs + pitch) - 1 : bZ(zs + pitch - 1) - 1;
    const D = Xi1 - Xi0 + 1, W = Zi1 - Zi0 + 1, F = FLOOR_ROWS[Math.min(k, 3)];
    const ix = (d) => side === 'w' ? Xi0 + d : Xi1 - d;
    const info = SHOPS[type];
    const s = {
      D, W, F, side, kit, type,
      b(d0, d1, v0, v1, r0, r1, m) { const a = ix(d0), c = ix(d1); kit.put(Math.min(a, c), F + r0, Zi0 + v0, Math.max(a, c), F + r1, Zi0 + v1, m); },
      wx: (d) => 0.5 * (side === 'w' ? Xi0 + d : Xi1 - d), wz: (v) => 0.5 * (Zi0 + v), Y: (r) => 0.5 * (F + r),
      prop(kindName, d, v, r, o) { kit.prop(kindName, s.wx(d), s.Y(r), s.wz(v), o); },
      hang(kindName, d, v, r, o = {}) { kit.prop(kindName, s.wx(d), s.Y(r) - 0.3, s.wz(v), { hung: true, yaw: 0, ...o }); }
    };
    // Kabuk: arka duvar, yan bölme(ler), vitrin
    const backX0 = side === 'w' ? bX(xa) : Xi1 + 1, backX1 = side === 'w' ? Xi0 - 1 : bX(xb + 1) - 1;
    const frontX0 = side === 'w' ? Xi1 + 1 : bX(xf), frontX1 = side === 'w' ? bX(xf + 1) - 1 : Xi0 - 1;
    const wallTop = F + 8;
    kit.put(backX0, F, Zi0, backX1, wallTop, Zi1, P.WHITE);                                         // arka duvar
    kit.put(Math.min(backX0, frontX1), F, bZ(zs), Math.max(backX1, frontX1), wallTop, Zi0 - 1, P.WHITE);   // yan bölme (güney ucu)
    if (!hasNext) kit.put(Math.min(backX0, frontX1), F, Zi1 + 1, Math.max(backX1, frontX1), wallTop, bZ(zs + pitch) - 1, P.WHITE);
    kit.put(frontX0, F, Zi0, frontX1, F + 6, Zi1, P.GLASS);                                          // cam vitrin
    for (let v = 0; v < W; v += 4) kit.put(frontX0, F, Zi0 + v, frontX1, F + 6, Zi0 + v, P.BLACK);   // çıtalar
    kit.put(frontX0, F + 6, Zi0, frontX1, F + 6, Zi1, P.BLACK);
    kit.clr(frontX0, F, Zi0 + Math.floor(W / 2) - 2, frontX1, F + 5, Zi0 + Math.floor(W / 2) + 1);   // kapı boşluğu (2 m)
    kit.put(frontX0, F + 7, Zi0, frontX1, F + 8, Zi1, P.WHITE);                                      // tabela bandı (üzerine yazılı levha asılır)
    // Tabela (yazılı levha): koridora bakar
    const sx = side === 'w' ? 0.5 * frontX1 + 0.27 : 0.5 * frontX0 - 0.27;
    kit.sign(info[0], { bg: info[1], fg: info[2], w: Math.min(6.4, W * 0.5 - 0.4), h: 0.9 }, sx, 0.5 * (F + 7) + 0.5, 0.25 * (Zi0 + Zi1), side === 'w' ? Math.PI / 2 : -Math.PI / 2);
    // Aydınlatma: arka duvar üstünde ışık şeridi ve iki sarkan lamba
    kit.put(backX0, wallTop, Zi0, backX1, wallTop, Zi1, P.LAMP);
    [[5, 3], [5, W - 4], [10, 3], [10, W - 4]].forEach(([d, v]) => { if (v > 0 && v < W) s.b(d, d, v, v, 8, 8, P.LAMP); });
    SHOP[type](s);
    sprinkle(s, PRODUCTS[type] || []);
    staff(s, info, type, cafe);
  }

  // Tezgâh/raf üstlerine tutulabilir ürünler: yeterince boş, üstü açık yüzeyleri bulup serpiştirir
  function sprinkle(s, list) {
    const spots = [];
    for (let d = 0; d < s.D - 2; d++) for (let v = 1; v < s.W - 1; v++) {
      const ixv = Math.round(s.wx(d) / 0.5), izv = Math.round(s.wz(v) / 0.5);
      for (let r = 6; r >= 0; r--) {
        const here = vox.get(`${ixv},${s.F + r},${izv}`);
        if (!here) continue;
        if (here.type === P.LAMP || here.type === P.LAMP_BLUE || here.type === P.LAMP_GREEN || here.type === P.LAMP_PINK || here.type === P.LAMP_PURPLE || here.type === P.LAMP_ORANGE) break;
        if (!vox.has(`${ixv},${s.F + r + 1},${izv}`) && !vox.has(`${ixv},${s.F + r + 2},${izv}`)) spots.push({ d, v, r });
        break;
      }
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    let at = 0;
    for (const [kind, count] of list) for (let c = 0; c < count && at < spots.length; c++, at++) {
      const sp = spots[at];
      kit.prop(kind, s.wx(sp.d) + rnd(-0.06, 0.06), 0.5 * (s.F + sp.r + 1), s.wz(sp.v) + rnd(-0.06, 0.06), { yaw: Math.random() * Math.PI * 2 });
    }
  }

  // Dükkân çalışanı: dükkânın renginde tişört, bazılarında şapka; tezgâh başında hareketsiz bekler
  function staff(s, info, type, cafe) {
    const food = FOOD.has(type);
    const pref = cafe ? [Math.min(4, s.D - 4), s.W / 2] : food ? [5, s.W / 2] : [4, s.W - 4];
    const free = (d, v) => {
      const x = s.wx(d), z = s.wz(v), hw = 0.38;
      for (let ixv = Math.floor((x - hw) / 0.5 + 0.5); ixv <= Math.floor((x + hw) / 0.5 + 0.5); ixv++)
        for (let izv = Math.floor((z - hw) / 0.5 + 0.5); izv <= Math.floor((z + hw) / 0.5 + 0.5); izv++)
          for (let r = 0; r <= 4; r++) if (vox.has(`${ixv},${s.F + r},${izv}`)) return false;
      return true;
    };
    const cands = [];
    for (let d = 1; d <= s.D - 4; d++) for (let v = 1; v <= s.W - 2; v++) cands.push([d, v, Math.hypot(d - pref[0], (v - pref[1]) * 1.5)]);
    cands.sort((a, b) => a[2] - b[2]);
    const c = cands.find(([d, v]) => free(d, v));
    if (!c) return;
    const hat = cafe ? 'cap' : Math.random() < 0.55 ? (KITCHEN_HAT.has(type) ? 'chef' : 'cap') : null;
    world.workers.push({ x: s.wx(c[0]), y: 0.5 * s.F, z: s.wz(c[1]), yaw: s.side === 'w' ? Math.PI / 2 : -Math.PI / 2, pose: 'stand', style: 'shop', shirt: info[1], hat, hatColor: info[1] });
  }

  // ── Masa + sandalyeler + oturan yiyiciler (çocuklar dahil) ──
  function diningTable(ix, iz, F, full) {
    const cx = 0.5 * ix, cz = 0.5 * iz, topY = 0.5 * (F + 3);
    kit.put(ix, F, iz, ix, F + 1, iz, P.IRON); kit.put(ix - 1, F + 2, iz - 1, ix + 1, F + 2, iz + 1, P.WHITE);
    [[-1.1, 0], [1.1, 0], [0, -1.1], [0, 1.1]].forEach(([dx, dz], i) => {
      const yaw = Math.atan2(-dx, -dz);                                       // masaya bakar
      kit.prop('chair', cx + dx, 0.5 * F, cz + dz, { yaw: yaw + Math.PI, color: i % 2 ? 0x111827 : 0xf3f4f6 });
      if (Math.random() < (full ? 0.85 : 0.5)) {
        const kid = Math.random() < 0.3;
        world.workers.push({ x: cx + dx, y: 0.5 * F, z: cz + dz, yaw, pose: 'sit', style: 'diner', eat: true, k: kid ? 0.65 : 1 });
        kit.prop(pickOne(['burger', 'burger', 'pizzaslice', 'tray', 'coffee', 'donut']), cx + dx * 0.4, topY, cz + dz * 0.4, { yaw: Math.random() * 6 });   // önündeki yemek
      }
    });
  }

  // ── Ortak koridor: yemek katında masalar ve sandalyeler; diğer katlarda bankolar. Giriş katının kahverengi masaları YOK. ──
  function corridorFurniture() {
    const top = floors.length - 1, F = FLOOR_ROWS[Math.min(top, 3)];
    halves.forEach(([za, zb]) => {
      for (let z = za + 3; z <= zb - 3; z += 6) diningTable(bX(xc - 3), bZ(z), F, true);   // yemek katı: koridorun batı kenarında masalar
    });
    // doğu kenarda dinlenme bankı (beyaz) ve saksı (her katta)
    floors.forEach(k => {
      const Fk = FLOOR_ROWS[Math.min(k, 3)];
      halves.forEach(([za, zb]) => { const ix = bX(xc + 3), iz = bZ(Math.round((za + zb) / 2)); kit.put(ix, Fk, iz - 2, ix + 1, Fk, iz + 2, P.WHITE); kit.prop('plant', 0.5 * ix, 0.5 * (Fk + 1), 0.5 * (iz + 3)); });
    });
  }

  // ── Orta meydan (eski atriumun yeri, artık her katta düz zemin) + katlar arası merdivenler + gezen müşteriler ──
  function plazaAndStairs() {
    const xMin = bX(x1 + 3), xMax = bX(x2 - 3), zMin = bZ(z1 + 3), zMax = bZ(z2 - 3);
    // Katlar arası iki merdiven (karşılıklı yönlü): her geçişte döşemede delik açılır
    for (let k = 0; k < floors.length - 1; k++) {
      const F0 = FLOOR_ROWS[Math.min(k, 3)], F1 = FLOOR_ROWS[Math.min(k + 1, 3)], R = F1 - F0;
      // Çift katlarda orta şeritler (batıda +z, doğuda −z), tek katlarda dış şeritler (ters yön): üst üste binmezler, çıkış ucu bir sonrakinin başlangıcına yakındır
      (k % 2 === 0 ? [[-6, -1, 1], [1, 6, -1]] : [[-12, -7, -1], [7, 12, 1]]).forEach(([xa, xb, dir]) => {
        const zStart = dir > 0 ? czV - Math.floor(R / 2) : czV + Math.floor(R / 2);
        kit.clr(cxV + xa, F1 - 1, Math.min(zStart, zStart + dir * (R - 1)), cxV + xb, F1 - 1, Math.max(zStart, zStart + dir * (R - 1)));   // döşeme deliği
        for (let j = 1; j <= R; j++) {
          const z = zStart + dir * (j - 1);
          kit.put(cxV + xa + 1, F0, z, cxV + xb - 1, F0 + j - 1, z, P.WHITE);                              // basamak sütunu
          kit.put(cxV + xa + 1, F0 + j - 1, z, cxV + xb - 1, F0 + j - 1, z, j % 2 ? P.LAMP_BLUE : P.IRON);   // basamak yüzü (şeritli)
          [cxV + xa, cxV + xb].forEach(rx => kit.put(rx, F0 + j, z, rx, F0 + j + 1, z, P.GLASS));            // cam korkuluk
        }
      });
    }
    // Her katta masalar (yemek katında 8, diğerlerinde 4) ve oturan müşteriler
    floors.forEach(k => {
      const F = FLOOR_ROWS[Math.min(k, 3)], food = k === floors.length - 1;
      const spots = food ? [[-18, -8], [-18, 0], [-18, 8], [18, -8], [18, 0], [18, 8], [0, -9], [0, 9]] : [[-18, -8], [-18, 8], [18, -8], [18, 8]];
      spots.forEach(([dx, dz]) => diningTable(cxV + dx, czV + dz, F, food));
      // gezen müşteriler (elinde alışveriş poşetiyle), arada çocuklar
      const walkers = food ? 7 : 5;
      for (let i = 0; i < walkers; i++) {
        const kid = Math.random() < 0.25;
        world.residents.push({ kind: 'shopper', x: 0.5 * (cxV + Math.round(rnd(-22, 22))), z: 0.5 * (czV + Math.round(rnd(-9, 9))), y: 0.5 * F, k: kid ? 0.65 : 1,
          bag: kid ? undefined : pickOne([0xdc2626, 0x2563eb, 0xf59e0b, 0x16a34a, 0xe879f9, 0xf3f4f6, 0xfacc15, 0x0891b2]),
          bounds: { minX: 0.5 * xMin + 1, maxX: 0.5 * xMax - 1, minZ: 0.5 * zMin + 1, maxZ: 0.5 * zMax - 1 } });
      }
    });
  }
}

// ═════════════════════════════════ DÜKKÂN İÇERİKLERİ ═════════════════════════════════
const rack = (s, v, d0, d1, r = 4, color = 0xffffff, kinds = ['shirt']) => {         // askı dolabı: iki direk + ray + asılı kıyafetler
  s.b(d0, d0, v, v, 0, r, P.IRON); s.b(d1, d1, v, v, 0, r, P.IRON); s.b(d0, d1, v, v, r, r, P.IRON);
  s.b(d0 - 0, d1, v, v, 0, 0, P.IRON);
  let i = 0; for (let d = d0 + 0.7; d < d1 - 0.3; d += 1.15) s.hang(kinds[i++ % kinds.length], d, v + 0.25, r - 0.35 + 0.35, { color: color === 0xffffff ? undefined : color });
};
const shelfWall = (s, d, v0, v1, rows = [1, 3, 5], pal = COL) => {                      // arka/yan duvar rafı: plank + renkli ürünler
  rows.forEach((r, ri) => { s.b(d, d + 1, v0, v1, r, r, P.IRON); for (let v = v0; v <= v1; v++) s.b(d, d, v, v, r + 1, r + 1, pal[(v * 3 + ri * 5 + d) % pal.length]); });
};
const counter = (s, d0, d1, v0, v1, top = P.WHITE, base = P.BLACK, h = 1) => { s.b(d0, d1, v0, v1, 0, h - 1, base); s.b(d0, d1, v0, v1, h, h, top); };
const register = (s, d, v) => { s.b(d, d, v, v, 2, 2, P.IRON); s.b(d, d, v, v, 3, 3, P.LAMP_GREEN); };
const mannequin = (s, d, v, color) => { s.b(d, d, v, v, 0, 0, P.WHITE); s.b(d, d, v, v, 1, 2, color); s.b(d, d, v, v, 3, 3, P.WHITE); };
const menu = (s, v0, v1, color = P.BLACK) => { s.b(0, 0, v0, v1, 3, 6, color); for (let v = v0 + 1; v < v1; v += 2) for (let r = 4; r <= 5; r++) s.b(0, 0, v, v, r, r, COL[(v + r) % 6]); };   // arka duvarda menü panosu (renkli satırlar)
const kitchenBack = (s) => { s.b(0, 2, 0, s.W - 1, 0, 1, P.IRON); s.b(0, 2, 0, s.W - 1, 2, 2, P.WHITE); };                            // arka mutfak tezgâhı

const SHOP = {
  // ── Tişört dükkânı (Teardown tarzı): duvar rafları, iki askı dolabı (asılı kıyafetler tutulabilir), manken, kasa ──
  tisort(s) {
    shelfWall(s, 0, 1, s.W - 2);
    rack(s, 3, 3, 11, 4, undefined, ['shirt', 'shirt', 'jacket']); rack(s, 8, 3, 11, 4, undefined, ['shirt', 'pants', 'shirt']);
    s.b(2, 2, 0, 0, 0, 5, P.LAMP_PURPLE);                                                  // deneme kabini perdesi
    mannequin(s, 13, 1, P.LAMP_PINK); mannequin(s, 13, s.W - 2, P.LAMP_BLUE);
    counter(s, 1, 3, s.W - 5, s.W - 2, P.WHITE, P.BLACK, 1); register(s, 2, s.W - 4); s.b(2, 2, s.W - 2, s.W - 2, 2, 3, P.GOLD);   // kasa + poşetler
    s.b(6, 8, 5, 6, 0, 0, P.LAMP_PINK);                                                    // yer halısı
    s.prop('shirt', 5, 6, 0.3, { yaw: 0.6 });
  },
  jean(s) {
    shelfWall(s, 0, 1, s.W - 2, [1, 3, 5], [P.LAMP_BLUE, P.LAMP_BLUE, P.BLACK, P.IRON]);
    rack(s, 3, 3, 11, 4, 0x1d4ed8, ['pants']); rack(s, 8, 3, 11, 4, 0x111827, ['pants', 'jacket']);
    mannequin(s, 13, 2, P.LAMP_BLUE); mannequin(s, 13, s.W - 3, P.BLACK);
    counter(s, 1, 3, s.W - 5, s.W - 2); register(s, 2, s.W - 4);
  },
  elektronik(s) {
    for (let v = 1; v <= s.W - 3; v += 3) for (let r = 2; r <= 5; r += 2) { s.b(0, 0, v, v + 1, r, r + 1, P.BLACK); s.b(0, 0, v, v + 1, r + 1, r + 1, [P.LAMP_BLUE, P.LAMP_PURPLE, P.LAMP_PINK][(v + r) % 3]); }   // TV duvarı
    for (let v = 2; v <= s.W - 4; v += 4) { counter(s, 5, 6, v, v + 2, P.GLASS, P.BLACK, 1); s.b(5, 5, v, v + 1, 2, 2, P.BLACK); s.b(5, 5, v, v + 1, 3, 3, P.LAMP_BLUE); }   // laptop tezgâhları
    counter(s, 10, 11, 2, s.W - 3, P.GLASS, P.BLACK, 1); for (let v = 3; v < s.W - 3; v += 2) s.b(10, 10, v, v, 2, 2, COL[v % 6]);   // telefon vitrini
    counter(s, 1, 3, s.W - 4, s.W - 2); register(s, 2, s.W - 3);
  },
  ayakkabi(s) {
    [1, 3, 5].forEach((r, ri) => { s.b(0, 1, 1, s.W - 2, r, r, P.IRON); for (let v = 1; v <= s.W - 3; v += 2) s.b(0, 1, v, v, r + 1, r + 1, [P.BRICK, P.WHITE, P.BLACK, P.GOLD, P.LAMP_BLUE][(v + ri) % 5]); });   // ayakkabı çiftleri
    s.b(6, 7, 3, s.W - 4, 0, 0, P.WHITE); s.b(6, 7, 3, s.W - 4, 1, 1, P.LAMP_PURPLE);      // deneme bankı
    s.prop('box', 5, 4, 0, { yaw: 0.2 }); s.prop('box', 5, 7, 0, { yaw: 1.2 }); s.prop('box', 5, 6, 0.5, { yaw: 0.7 });
    counter(s, 1, 3, s.W - 4, s.W - 2); register(s, 2, s.W - 3);
  },
  market(s) {
    for (let v = 2; v <= s.W - 4; v += 3) { s.b(2, 11, v, v, 0, 3, P.IRON); for (let d = 2; d <= 11; d++) s.b(d, d, v, v, 4 - (d % 2), 4 - (d % 2), COL[(d + v) % COL.length]); s.b(2, 11, v, v, 3, 3, P.WHITE); }   // reyonlar
    s.b(0, 0, 1, 5, 0, 4, P.WHITE); s.b(0, 0, 1, 5, 2, 3, P.GLASS); s.b(0, 0, 2, 4, 1, 1, P.LAMP_BLUE);   // soğutucu dolap
    counter(s, 13, 14, 2, s.W - 3, P.BLACK, P.IRON, 1); s.b(13, 13, 2, s.W - 3, 2, 2, P.LAMP_GREEN); s.prop('box', 12, 3, 0, {}); s.prop('box', 12, 7, 0, {});
  },
  oyuncak(s) {
    for (let v = 1; v <= s.W - 3; v += 2) for (let r = 0; r < 3; r++) s.b(0, 1, v, v, r * 2, r * 2 + 1, COL[(v + r * 3) % COL.length]);        // renkli oyuncak yığınları
    s.b(5, 9, 3, 6, 0, 3, P.LAMP_BLUE); s.b(6, 8, 4, 5, 4, 6, P.LAMP_PINK); s.b(7, 7, 4, 5, 7, 7, P.GOLD);   // oyuncak kale
    for (const [d, v] of [[4, 8], [6, 9], [9, 8], [11, 3], [12, 6]]) s.prop('teddy', d, v, 0, { yaw: Math.random() * 6 });
    s.prop('box', 3, 3, 0, {});
    counter(s, 1, 3, s.W - 4, s.W - 2); register(s, 2, s.W - 3);
  },
  kitap(s) {
    for (let v = 1; v <= s.W - 3; v += 3) { s.b(0, 1, v, v + 1, 0, 6, P.IRON); for (let r = 0; r <= 6; r++) for (let vv = v; vv <= v + 1; vv++) s.b(0, 0, vv, vv, r, r, COL[(vv * 2 + r) % 8]); }   // kitaplık (renkli sırtlar)
    s.b(6, 9, 4, 7, 0, 0, P.IRON); s.b(6, 9, 4, 7, 1, 1, P.WHITE);                       // okuma masası
    s.prop('book', 7, 5, 1.0, { yaw: 0.4 }); s.prop('book', 8, 6, 1.0, { yaw: 1.4 }); s.prop('book', 7.5, 6.5, 1.15, { yaw: 0.2 });
    counter(s, 12, 13, 2, 5); register(s, 12, 3);
  },
  mucevher(s) {
    s.b(0, 0, 0, s.W - 1, 0, 6, P.GLASS); for (let v = 1; v < s.W - 1; v += 2) s.b(0, 0, v, v, 2, 3, [P.GOLD, P.LAMP_BLUE, P.LAMP_PINK, P.GOLD][v % 4]);   // aynalı duvar + mücevherler
    for (const v of [2, 6]) { s.b(5, 8, v, v + 2, 0, 0, P.BLACK); s.b(5, 8, v, v + 2, 1, 1, P.GLASS); s.b(6, 7, v + 1, v + 1, 1, 1, P.GOLD); s.b(6, 6, v, v, 1, 1, P.LAMP_PINK); s.b(7, 7, v + 2, v + 2, 1, 1, P.LAMP_BLUE); }
    counter(s, 11, 12, 1, s.W - 2, P.GLASS, P.BLACK, 1); for (let v = 2; v < s.W - 2; v += 2) s.b(11, 11, v, v, 1, 1, [P.GOLD, P.LAMP_BLUE][v % 2]);
    s.b(3, 3, s.W - 3, s.W - 3, 0, 1, P.ROOF);
  },
  spor(s) {
    for (let v = 1; v <= s.W - 3; v += 2) { s.b(0, 0, v, v, 4, 6, P.IRON); s.b(0, 0, v, v, 2, 3, COL[(v * 2) % 8]); }   // forma duvarı
    rack(s, 3, 3, 10, 4, undefined, ['shirt', 'shirt', 'jacket']);
    s.b(7, 11, 7, 8, 0, 0, P.BLACK); s.b(8, 10, 7, 8, 1, 1, P.LAMP_GREEN); s.b(11, 11, 7, 8, 1, 3, P.IRON);   // koşu bandı
    for (const [d, v] of [[5, 9], [6, 10], [4, 10]]) s.b(d, d, v, v, 0, 0, COL[(d + v) % 6]);                 // toplar
    s.b(12, 12, 1, 5, 0, 1, P.IRON); for (let v = 1; v <= 5; v += 2) s.b(12, 12, v, v, 2, 2, P.BLACK);       // halter rafı
  },
  kozmetik(s) {
    for (let r of [1, 3, 5]) { s.b(0, 1, 1, s.W - 2, r, r, P.WHITE); for (let v = 1; v <= s.W - 2; v++) s.b(0, 0, v, v, r + 1, r + 1, [P.LAMP_PINK, P.LAMP_PURPLE, P.WHITE, P.LAMP_PINK][v % 4]); }
    s.b(0, 0, 3, s.W - 4, 3, 4, P.GLASS); counter(s, 6, 8, 3, s.W - 4, P.LAMP_PINK, P.WHITE, 1);
    for (const [d, v] of [[6.5, 4], [7, 6], [6.5, 8]]) s.prop('bottle', d, v, 2, { color: 0xf472b6 });
    counter(s, 12, 13, 2, 6); register(s, 12, 4);
  },
  eczane(s) {
    s.b(0, 1, 1, s.W - 2, 0, 6, P.WHITE); for (let v = 1; v <= s.W - 2; v++) for (let r = 1; r <= 6; r += 2) s.b(0, 0, v, v, r, r, [P.LAMP_GREEN, P.WHITE, P.LAMP_BLUE][(v + r) % 3]);
    counter(s, 4, 5, 1, s.W - 2, P.WHITE, P.LAMP_GREEN, 1); s.b(5, 5, 4, 7, 2, 2, P.LAMP_BLUE);
    s.b(9, 9, 2, 2, 0, 5, P.LAMP_GREEN); s.b(9, 9, 1, 3, 3, 3, P.LAMP_GREEN);              // yeşil haç ayağı
  },
  mobilya(s) {
    s.b(1, 5, 1, 6, 0, 0, P.BRICK); s.b(1, 5, 1, 6, 1, 1, P.WHITE); s.b(1, 1, 1, 6, 2, 3, P.ROOF);   // yatak
    s.b(6, 9, 7, 11, 0, 1, P.GOLD); s.b(6, 6, 7, 11, 2, 3, P.GOLD);                          // kanepe
    s.b(11, 13, 2, 5, 0, 1, P.WOOD); s.b(11, 11, 2, 2, 0, 0, P.IRON);                         // masa
    s.prop('chair', 12.5, 1.5, 0, {}); s.prop('chair', 12.5, 6, 0, {}); s.prop('cushion', 7.5, 9, 2, { color: 0xdc2626 });
  },
  // ── Yemek katı ──
  doner(s) {
    kitchenBack(s); menu(s, 2, s.W - 3, P.BLACK);
    s.b(2, 3, s.W / 2 - 1, s.W / 2 - 1, 1, 7, P.IRON);                                      // döner şişi
    for (let r = 2; r <= 6; r++) s.b(2, 3, Math.floor(s.W / 2) - 2, Math.floor(s.W / 2), r, r, r % 2 ? P.ROOF : P.BRICK);   // döner eti katmanları
    s.b(0, 0, Math.floor(s.W / 2) - 3, Math.floor(s.W / 2) + 1, 2, 5, P.LAMP_ORANGE);       // ısıtıcı
    counter(s, 7, 8, 1, s.W - 2, P.WHITE, P.BRICK, 1); for (let v = 2; v < s.W - 2; v += 3) s.b(7, 7, v, v, 2, 2, [P.WHITE, P.GOLD, P.GRASS][v % 3]);   // dürüm, lavaş, ayran
    s.prop('tray', 7.5, 4, 2, {}); s.prop('tray', 7.5, 8, 2, {});
  },
  lahmacun(s) {
    s.b(0, 4, 1, 5, 0, 3, P.CONCRETE); s.b(1, 3, 2, 4, 4, 5, P.CONCRETE); s.b(0, 0, 2, 4, 1, 2, P.LAMP_ORANGE);   // taş fırın + ateş
    s.b(2, 2, 6, 6, 0, 5, P.WOOD);                                                           // kürek
    counter(s, 6, 7, 1, s.W - 2, P.WHITE, P.ROOF, 1); for (let v = 2; v < s.W - 2; v += 2) { s.b(6, 6, v, v, 2, 3, v % 4 ? P.BRICK : P.ROOF); s.b(6, 6, v, v, 4, 4, P.GRASS); }   // lahmacun yığınları + maydanoz
    s.b(4, 4, s.W - 3, s.W - 3, 0, 1, P.GOLD); s.b(4, 4, s.W - 5, s.W - 5, 0, 1, P.WHITE); menu(s, 7, s.W - 2);
    s.prop('box', 3, s.W - 4, 0, {});
  },
  pizza(s) {
    s.b(0, 3, 1, 5, 0, 2, P.BRICK); s.b(1, 2, 2, 4, 3, 4, P.BRICK); s.b(0, 0, 2, 4, 1, 1, P.LAMP_ORANGE);   // pizza fırını
    counter(s, 6, 7, 1, s.W - 2, P.WHITE, P.BLACK, 1);
    for (let v = 2; v < s.W - 3; v += 3) { s.b(6, 7, v, v + 1, 2, 2, P.GOLD); s.b(6, 6, v, v, 2, 2, P.BRICK); s.b(7, 7, v + 1, v + 1, 2, 2, P.GRASS); }   // dilimlenmiş pizzalar
    for (let v = 2; v <= 6; v += 2) s.prop('pizzabox', 3, v + 3, 0, { yaw: v * 0.3 });
    s.b(4, 4, s.W - 3, s.W - 3, 0, 2, P.WHITE); s.b(4, 4, s.W - 4, s.W - 4, 0, 1, P.WHITE); menu(s, 7, s.W - 2);   // un çuvalları
  },
  burger(s) {
    kitchenBack(s); s.b(2, 4, 1, 4, 3, 3, P.IRON); s.b(2, 4, 1, 4, 4, 4, P.LAMP_ORANGE);       // ızgara + ateş
    s.b(0, 0, 1, s.W - 2, 3, 7, P.BRICK); for (let v = 2; v < s.W - 2; v += 2) s.b(0, 0, v, v, 5, 5, P.GOLD); s.b(0, 0, 3, 6, 6, 6, P.GOLD); s.b(0, 0, 3, 4, 7, 7, P.GOLD);   // kırmızı-sarı menü panosu
    counter(s, 7, 8, 1, s.W - 2, P.WHITE, P.BRICK, 1);
    for (let v = 2; v < s.W - 3; v += 3) { s.b(7, 7, v, v, 2, 2, P.GOLD); s.b(7, 7, v, v, 3, 3, P.BRICK); s.b(7, 7, v, v, 4, 4, P.GRASS); s.b(7, 7, v, v, 5, 5, P.GOLD); }   // hamburgerler
    s.b(5, 6, s.W - 3, s.W - 2, 0, 2, P.WHITE); s.b(5, 5, s.W - 3, s.W - 2, 3, 3, P.LAMP_BLUE);   // içecek makinesi
    s.prop('tray', 7.5, 4, 2, {}); s.prop('tray', 7.5, 7, 2, {}); s.prop('tray', 7.5, 10, 2, {});
  },
  kebap(s) {
    kitchenBack(s); menu(s, 2, s.W - 3);
    s.b(3, 4, 2, s.W - 3, 2, 2, P.IRON); s.b(3, 4, 2, s.W - 3, 1, 1, P.LAMP_ORANGE);        // mangal
    for (let v = 3; v < s.W - 3; v += 2) s.b(3, 4, v, v, 3, 3, v % 4 ? P.BRICK : P.ROOF);   // şişler
    counter(s, 7, 8, 1, s.W - 2, P.WHITE, P.WOOD, 1); for (let v = 2; v < s.W - 2; v += 3) s.b(7, 7, v, v, 2, 2, [P.WHITE, P.GRASS, P.BRICK][v % 3]);
  },
  tavuk(s) {
    kitchenBack(s); s.b(2, 3, 2, 5, 0, 1, P.IRON); s.b(2, 3, 2, 5, 2, 2, P.LAMP_ORANGE);    // fritöz
    s.b(0, 0, 1, s.W - 2, 3, 7, P.BRICK); for (let v = 2; v < s.W - 2; v += 2) s.b(0, 0, v, v, 5, 5, P.WHITE);   // kırmızı-beyaz panolar
    counter(s, 7, 8, 1, s.W - 2, P.WHITE, P.BRICK, 1);
    for (let v = 2; v < s.W - 3; v += 3) { s.b(7, 7, v, v + 1, 2, 3, P.WHITE); s.b(7, 7, v, v + 1, 4, 4, P.BRICK); s.b(7, 7, v, v, 5, 5, P.GOLD); s.b(7, 7, v + 1, v + 1, 5, 5, P.ROOF); }   // kovalar + tavuk parçaları
    s.prop('tray', 7.5, 5, 2, {});
  },
  dondurma(s) {
    s.b(3, 8, 1, s.W - 2, 0, 1, P.WHITE); s.b(3, 8, 1, s.W - 2, 2, 2, P.GLASS);                // buzdolabı vitrini
    for (let v = 2; v < s.W - 2; v += 2) for (let d = 4; d <= 7; d += 3) s.b(d, d, v, v, 1, 1, [P.LAMP_PINK, P.WHITE, P.ROOF, P.LAMP_GREEN, P.LAMP_PURPLE, P.GOLD][(v + d) % 6]);   // dondurma kâseleri
    s.b(0, 0, 1, s.W - 2, 2, 6, P.LAMP_PINK); for (let v = 2; v < s.W - 2; v += 3) s.b(0, 0, v, v + 1, 4, 5, P.WHITE);   // pembe pano
    counter(s, 10, 11, 1, s.W - 2, P.WHITE, P.LAMP_PINK, 1); for (let v = 2; v < s.W - 2; v += 2) { s.b(10, 10, v, v, 2, 2, P.GOLD); s.b(10, 10, v, v, 3, 3, [P.LAMP_PINK, P.WHITE, P.ROOF][v % 3]); }   // külahlar
  },
  kahve(s) {
    kitchenBack(s); s.b(1, 2, 2, 5, 3, 4, P.BLACK); s.b(1, 1, 3, 4, 4, 4, P.IRON); s.b(1, 1, 3, 3, 3, 3, P.LAMP_GREEN);   // espresso makinesi
    s.b(0, 0, 1, s.W - 2, 5, 7, P.ROOF); for (let v = 2; v < s.W - 2; v += 3) s.b(0, 0, v, v + 1, 6, 6, P.GOLD);
    counter(s, 6, 7, 1, s.W - 2, P.WHITE, P.ROOF, 1);
    for (let v = 2; v < s.W - 2; v += 2) s.b(6, 6, v, v, 2, 2, [P.WHITE, P.BRICK, P.GOLD][v % 3]);   // fincanlar ve pastalar
    [3, 6, 9].filter(v => v < s.W - 2).forEach(v => { s.b(9, 9, v, v, 0, 1, P.IRON); s.b(9, 9, v, v, 2, 2, P.ROOF); s.prop('chair', 10.5, v, 0, { color: 0x3f2a1d }); });   // bar taburesi + sandalye
  },
  donut(s) {                                                                             // donat dükkânı: pembe pano, raflarda donatlar, vitrinli tezgâh
    kitchenBack(s);
    s.b(0, 0, 1, s.W - 2, 3, 7, P.LAMP_PINK); for (let v = 2; v < s.W - 2; v += 3) { s.b(0, 0, v, v + 1, 4, 5, P.WHITE); s.b(0, 0, v + 1, v + 1, 4, 4, P.ROOF); }   // pembe pano + donat çizimleri
    [1, 3].forEach(r => s.b(1, 2, 1, s.W - 2, r + 2, r + 2, P.WHITE));                    // arka raflar (donat dizilir)
    counter(s, 6, 7, 1, s.W - 2, P.GLASS, P.LAMP_PINK, 1); s.b(6, 6, 1, s.W - 2, 3, 3, P.GLASS);   // cam vitrinli tezgâh
    register(s, 7, 1);
  },
  baklava(s) {
    kitchenBack(s); menu(s, 2, s.W - 3, P.ROOF);
    counter(s, 6, 8, 1, s.W - 2, P.GLASS, P.ROOF, 1);
    for (let v = 2; v < s.W - 2; v += 2) { s.b(6, 7, v, v, 1, 1, P.GOLD); s.b(6, 7, v, v, 2, 2, v % 4 ? P.GOLD : P.ROOF); }   // baklava tepsileri (altın/koyu)
    s.b(3, 3, 2, 3, 0, 3, P.IRON); s.b(3, 3, 2, 3, 4, 4, P.LAMP_ORANGE);                      // semaver/ocak
    s.b(3, 4, s.W - 4, s.W - 3, 0, 1, P.GOLD);                                                // bakır tepsi
  },
  kumpir(s) {
    kitchenBack(s); menu(s, 2, s.W - 3, P.ROOF);
    for (let v = 2; v < s.W - 3; v += 3) { s.b(6, 6, v, v + 1, 1, 2, P.GOLD); }              // kocaman patatesler
    counter(s, 6, 7, 1, s.W - 2, P.WHITE, P.BRICK, 1);
    [P.BRICK, P.GOLD, P.GRASS, P.LAMP_ORANGE, P.WHITE, P.LAMP_PURPLE].forEach((c, i) => s.b(8, 8, 2 + i * 2, 2 + i * 2, 1, 1, c));   // renkli malzeme kaseleri
    s.prop('tray', 7.5, 6, 2, {});
  },
  sushi(s) {
    kitchenBack(s); s.b(0, 0, 1, s.W - 2, 3, 6, P.BLACK); for (let v = 2; v < s.W - 2; v += 3) s.b(0, 0, v, v, 4, 4, P.BRICK);
    s.b(6, 7, 1, s.W - 2, 0, 1, P.BLACK); s.b(6, 7, 1, s.W - 2, 2, 2, P.IRON);                // dönen bant
    for (let v = 2; v < s.W - 2; v += 2) s.b(6, 6, v, v, 3, 3, [P.WHITE, P.LAMP_PINK, P.BRICK, P.GRASS][v % 4]);   // suşi tabakları
    [3, 6, 9].forEach(v => s.b(9, 9, v, v, 0, 1, P.BLACK));
  },
  cigkofte(s) {
    kitchenBack(s); menu(s, 2, s.W - 3, P.GRASS);
    s.b(3, 5, 2, 5, 0, 1, P.IRON); s.b(3, 5, 2, 5, 2, 2, P.BRICK);                            // yoğurma teknesi
    counter(s, 7, 8, 1, s.W - 2, P.WHITE, P.GRASS, 1); for (let v = 2; v < s.W - 2; v += 3) { s.b(7, 7, v, v, 2, 2, P.WHITE); s.b(7, 7, v, v, 3, 3, P.GRASS); }
  }
};
