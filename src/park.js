import { Kit, P } from './kit.js';

// ─────────────────────────────────────────────────────────────────────────────
// MERKEZ PARK: villanın güneyindeki kocaman çimenlik alanda New York'taki Central Park'tan esinli büyük bir park (168 × 172 m).
//  • Çevresi demir çitli, dört kapılı; kapılarda direkler ve "MERKEZ PARK" tabelası.
//  • Ortada büyük çeşmeli taş meydan; ana patikalar (kuzey-güney, doğu-batı, çapraz) + meydan çevresi halka patika + göl çevresi patika.
//  • Buz pisti (beyaz bantlı, ışıldaklı), çocuk oyun parkı (salıncak, kaydırak, tırmanma kafesi, tahterevalli, kum havuzu, atlı karınca),
//    çitli köpek parkı (engel parkuru, tünel, su kabı), gölet ve iskele, banklar, piknik masaları, çiçek tarhları, yüzlerce ağaç, sokak lambaları.
//  • Yaşam: pistte patenle kayan çocuklar ve yetişkinler, oyun parkında oynayan/salıncakta sallanan çocuklar, banklarda oturanlar,
//    köpeğini tasmayla gezdirenler ve köpek parkında serbest koşan köpekler.
// ─────────────────────────────────────────────────────────────────────────────
export const PARK = { x0: 200, x1: 368, z0: 14, z1: 186, cx: 284, cz: 100 };
const ICE = { name: 'Buz', color: 0xc9edf9 }, LAKE = { name: 'Göl', color: 0x2b6cb0 };
const V = (m) => Math.round(m / 0.5);                                   // metre → voxel indeksi
const PATHS = [                                                          // [ax, az, bx, bz, genişlik]
  [200, 100, 368, 100, 4], [284, 14, 284, 186, 4],
  [214, 28, 272, 86, 3], [354, 28, 296, 86, 3], [214, 172, 272, 114, 3], [354, 172, 296, 114, 3],
  [284, 56, 268, 56, 3], [284, 56, 318, 56, 3], [284, 146, 265, 146, 3]
];
const FEAT = {
  plaza: { cx: 284, cz: 100, r: 17 },
  rink: { cx: 246, cz: 56, w: 40, d: 24 },
  play: { cx: 340, cz: 56, w: 40, d: 30 },
  dogp: { cx: 244, cz: 146, w: 38, d: 30 },
  lake: { cx: 332, cz: 150, rx: 26, rz: 16 }
};
const segDist = (x, z, [ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - t * dx, z - az - t * dz); };
const inRect = (x, z, f, m = 0) => Math.abs(x - f.cx) <= f.w / 2 + m && Math.abs(z - f.cz) <= f.d / 2 + m;
const inLake = (x, z, m = 0) => ((x - FEAT.lake.cx) / (FEAT.lake.rx + m)) ** 2 + ((z - FEAT.lake.cz) / (FEAT.lake.rz + m)) ** 2 <= 1;

export function buildCentralPark(lm) {
  const world = lm.world, kit = new Kit(world), T = world.terrain, Pk = PARK;
  world.dogs = world.dogs || []; world.residents = world.residents || []; world.workers = world.workers || [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rr = (a, b) => a + rnd() * (b - a);

  // ── 1. Zemin boyama (asfalta dokunmaz) ──
  T.addPainter((api) => {
    const grass = (x, z) => { const m = api.matAt(x, z); return !!(m && !m.name.startsWith('Asfalt') && m !== P.WOOD); };   // park zemini: çim, kum, beton üstüne boyanır; yollara dokunulmaz
    const put = (x, z, mat) => { if (grass(x, z)) api.set(x, z, mat); };
    const stamp = (ax, az, bx, bz, hw, mat) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.2);
      for (let i = 0; i <= n; i++) { const px = ax + (bx - ax) * i / n, pz = az + (bz - az) * i / n; for (let dx = -hw; dx <= hw; dx += 0.25) for (let dz = -hw; dz <= hw; dz += 0.25) if (dx * dx + dz * dz <= hw * hw) put(px + dx, pz + dz, mat); }
    };
    const disc = (cx, cz, rx, rz, mat) => { for (let x = cx - rx; x <= cx + rx; x += 0.25) for (let z = cz - rz; z <= cz + rz; z += 0.25) if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1) put(x, z, mat); };
    const rect = (f, m, mat) => { for (let x = f.cx - f.w / 2 - m; x <= f.cx + f.w / 2 + m; x += 0.25) for (let z = f.cz - f.d / 2 - m; z <= f.cz + f.d / 2 + m; z += 0.25) put(x, z, mat); };
    for (const s of PATHS) stamp(s[0], s[1], s[2], s[3], s[4] / 2, P.SAND);
    for (let a = 0; a < 6.283; a += 0.02) { const px = Pk.cx + Math.cos(a) * 30, pz = Pk.cz + Math.sin(a) * 30; stamp(px, pz, px + Math.cos(a + 1.5708) * 0.6, pz + Math.sin(a + 1.5708) * 0.6, 1.5, P.SAND); }   // meydan çevresi halka patika
    for (let a = 0; a < 6.283; a += 0.03) { const L = FEAT.lake; stamp(L.cx + Math.cos(a) * (L.rx + 4), L.cz + Math.sin(a) * (L.rz + 4), L.cx + Math.cos(a + 0.03) * (L.rx + 4), L.cz + Math.sin(a + 0.03) * (L.rz + 4), 1.6, P.SAND); }   // göl çevresi patika
    disc(FEAT.plaza.cx, FEAT.plaza.cz, FEAT.plaza.r, FEAT.plaza.r, P.CONCRETE);                                      // çeşme meydanı
    rect(FEAT.rink, 1, P.CONCRETE); rect(FEAT.rink, 0, ICE);                                                         // buz pisti (etrafı beton)
    rect(FEAT.play, 0, P.SAND);                                                                                      // oyun parkı kumu
    disc(FEAT.lake.cx, FEAT.lake.cz, FEAT.lake.rx + 1.2, FEAT.lake.rz + 1.2, P.SAND); disc(FEAT.lake.cx, FEAT.lake.cz, FEAT.lake.rx, FEAT.lake.rz, LAKE);   // göl + kumsal kenar
  });

  // ── 2. Çit ve kapılar ──
  const fx0 = V(Pk.x0), fx1 = V(Pk.x1), fz0 = V(Pk.z0), fz1 = V(Pk.z1), gcx = V(Pk.cx), gcz = V(Pk.cz);
  const gate = (x, z, along) => along === 'x' ? Math.abs(x - gcx) <= 8 : Math.abs(z - gcz) <= 8;   // kapı açıklığı: 8 voxel (4 m) yarı genişlik
  const fenceRun = (a0, a1, fixed, alongX, gateOn) => {
    for (let a = a0; a <= a1; a++) {
      const x = alongX ? a : fixed, z = alongX ? fixed : a;
      if (gateOn && gate(x, z, alongX ? 'x' : 'z')) continue;
      if ((a - a0) % 4 === 0) kit.put(x, 1, z, x, 5, z, P.IRON);
      kit.put(x, 2, z, x, 2, z, P.IRON); kit.put(x, 4, z, x, 4, z, P.IRON);
      if ((a - a0) % 2 === 0) kit.put(x, 3, z, x, 3, z, P.IRON);
    }
  };
  fenceRun(fx0, fx1, fz0, true, true); fenceRun(fx0, fx1, fz1, true, true); fenceRun(fz0, fz1, fx0, false, true); fenceRun(fz0, fz1, fx1, false, true);
  const pillar = (x, z) => { kit.put(x, 1, z, x + 1, 9, z + 1, P.WHITE); kit.put(x, 10, z, x + 1, 10, z + 1, P.GOLD); kit.put(x, 11, z, x, 11, z, P.LAMP); };
  for (const sg of [-1, 1]) { pillar(gcx + sg * 9 - (sg < 0 ? 1 : 0), fz0); pillar(gcx + sg * 9 - (sg < 0 ? 1 : 0), fz1); pillar(fx0, gcz + sg * 9 - (sg < 0 ? 1 : 0)); pillar(fx1, gcz + sg * 9 - (sg < 0 ? 1 : 0)); }
  kit.put(gcx - 9, 8, fz0, gcx + 9, 9, fz0, P.WHITE); kit.put(gcx - 9, 8, fz1, gcx + 9, 9, fz1, P.WHITE);          // kapı üstü kirişleri
  kit.sign('MERKEZ PARK', { bg: 0x14532d, fg: 0xfef9c3, w: 7, h: 1.1 }, 0.5 * gcx, 0.5 * 8.5 + 0.7, 0.5 * fz0 - 0.3, Math.PI);
  kit.sign('MERKEZ PARK', { bg: 0x14532d, fg: 0xfef9c3, w: 7, h: 1.1 }, 0.5 * gcx, 0.5 * 8.5 + 0.7, 0.5 * fz1 + 0.3, 0);

  // ── 3. Çeşme meydanı: çeşme + çevresinde banklar ve çiçek tarhları ──
  {                                                                // büyük dış havuz: taş duvarlı, camdan su yüzeyli; ortadaki çeşme ve çevresinde 6 fıskiye
    const pcx = V(Pk.cx), pcz = V(Pk.cz), R = 12;
    for (let a = -R - 1; a <= R + 1; a++) for (let b = -R - 1; b <= R + 1; b++) {
      const d = Math.hypot(a, b);
      if (d <= R - 0.5) kit.put(pcx + a, 1, pcz + b, pcx + a, 1, pcz + b, P.GLASS);
      else if (d <= R + 0.8) kit.put(pcx + a, 1, pcz + b, pcx + a, 3, pcz + b, P.CONCRETE);
    }
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, jx = pcx + Math.round(Math.cos(a) * 8), jz = pcz + Math.round(Math.sin(a) * 8);
      kit.put(jx, 2, jz, jx, 3, jz, P.CONCRETE);
      world.fountains.push({ x: 0.5 * jx, z: 0.5 * jz, y: 0.5 * 4 + 0.2, keys: [`${jx},2,${jz}`, `${jx},3,${jz}`] });
    }
  }
  lm.fountain(FEAT.plaza.cx / 0.75, FEAT.plaza.cz / 0.75);
  const bench = (x, z, alongX = true, sitter = false) => {          // x,z voxel; bank 4 voxel uzun
    if (alongX) { kit.put(x - 2, 2, z, x + 1, 2, z, P.WOOD); kit.put(x - 2, 3, z + 1, x + 1, 3, z + 1, P.WOOD); kit.put(x - 2, 1, z, x - 2, 1, z, P.IRON); kit.put(x + 1, 1, z, x + 1, 1, z, P.IRON); }
    else { kit.put(x, 2, z - 2, x, 2, z + 1, P.WOOD); kit.put(x + 1, 3, z - 2, x + 1, 3, z + 1, P.WOOD); kit.put(x, 1, z - 2, x, 1, z - 2, P.IRON); kit.put(x, 1, z + 1, x, 1, z + 1, P.IRON); }
    if (sitter) world.workers.push({ x: 0.5 * (alongX ? x - 0.5 : x), y: 1.0, z: 0.5 * (alongX ? z : z - 0.5), yaw: alongX ? 0 : -Math.PI / 2, pose: 'sit', style: 'diner', k: Math.random() < 0.2 ? 0.65 : 1 });
  };
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.39, x = V(Pk.cx + Math.cos(a) * 14), z = V(Pk.cz + Math.sin(a) * 14); bench(x, z, Math.abs(Math.cos(a)) < 0.7, i % 3 === 0); }
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, cx = V(Pk.cx + Math.cos(a) * 21), cz = V(Pk.cz + Math.sin(a) * 21); const c = [P.LAMP_PINK, P.GOLD, P.LAMP_ORANGE, P.BRICK][i % 4]; kit.put(cx - 1, 1, cz - 1, cx + 1, 1, cz + 1, c); kit.put(cx, 2, cz, cx, 2, cz, P.GRASS); }   // çiçek tarhları

  // ── 4. Buz pisti: beyaz bant + cam üst, kapı boşlukları, ışıldaklar, banklar ──
  {
    const f = FEAT.rink, x0 = V(f.cx - f.w / 2 - 1), x1 = V(f.cx + f.w / 2 + 1), z0 = V(f.cz - f.d / 2 - 1), z1 = V(f.cz + f.d / 2 + 1), mx = V(f.cx), mz = V(f.cz);
    const run = (a0, a1, fx, alongX) => { for (let a = a0; a <= a1; a++) { const x = alongX ? a : fx, z = alongX ? fx : a; if (alongX ? Math.abs(a - mx) <= 3 && fx === z1 : false) continue; if (!alongX && Math.abs(a - mz) <= 3 && fx === x1) continue; kit.put(x, 1, z, x, 2, z, P.WHITE); kit.put(x, 3, z, x, 3, z, P.GLASS); } };
    run(x0, x1, z0, true); run(x0, x1, z1, true); run(z0, z1, x0, false); run(z0, z1, x1, false);
    for (const [x, z] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]]) { kit.put(x, 1, z, x, 14, z, P.IRON); kit.put(x - 1, 15, z - 1, x + 1, 15, z + 1, P.LAMP); }   // ışıldak direkleri
    bench(mx - 10, z1 + 3); bench(mx + 10, z1 + 3); bench(x0 - 3, mz, false); 
    const sk = (x, z, k, kid) => world.residents.push({ kind: 'skater', x, z, y: 0.5, k, bounds: { minX: f.cx - f.w / 2 + 0.8, maxX: f.cx + f.w / 2 - 0.8, minZ: f.cz - f.d / 2 + 0.8, maxZ: f.cz + f.d / 2 - 0.8 } });
    for (let i = 0; i < 12; i++) sk(f.cx + rr(-17, 17), f.cz + rr(-9, 9), i % 3 === 0 ? 0.65 : 1);
  }

  // ── 5. Oyun parkı ──
  {
    const f = FEAT.play, gx = V(f.cx), gz = V(f.cz);
    const x0 = V(f.cx - f.w / 2 - 1), x1 = V(f.cx + f.w / 2 + 1), z0 = V(f.cz - f.d / 2 - 1), z1 = V(f.cz + f.d / 2 + 1);
    for (let a = x0; a <= x1; a++) for (const z of [z0, z1]) { if (Math.abs(a - gx) <= 3 && z === z0) continue; kit.put(a, 1, z, a, 2, z, (a % 2) ? P.LAMP_ORANGE : P.LAMP_BLUE); }
    for (let a = z0; a <= z1; a++) for (const x of [x0, x1]) { if (Math.abs(a - gz) <= 3 && x === x0) continue; kit.put(x, 1, a, x, 2, a, (a % 2) ? P.LAMP_PINK : P.LAMP_GREEN); }
    const swingSet = (cx, cz, seats) => {
      kit.put(cx - 7, 1, cz - 1, cx - 7, 9, cz - 1, P.IRON); kit.put(cx - 7, 1, cz + 1, cx - 7, 9, cz + 1, P.IRON); kit.put(cx + 7, 1, cz - 1, cx + 7, 9, cz - 1, P.IRON); kit.put(cx + 7, 1, cz + 1, cx + 7, 9, cz + 1, P.IRON);
      kit.put(cx - 7, 9, cz, cx + 7, 9, cz, P.IRON);
      for (const sx of seats) { kit.put(sx - 1, 4, cz, sx - 1, 8, cz, P.BLACK); kit.put(sx + 1, 4, cz, sx + 1, 8, cz, P.BLACK); kit.put(sx - 1, 3, cz, sx + 1, 3, cz, P.WOOD); }
    };
    swingSet(gx - 10, gz - 8, [gx - 14, gx - 10, gx - 6]); swingSet(gx - 10, gz + 8, [gx - 14, gx - 10, gx - 6]);
    for (const sx of [gx - 14, gx - 10, gx - 6]) if (rnd() < 0.8) world.workers.push({ x: 0.5 * sx, y: 1.5 - 0.5, z: 0.5 * (gz - 8), yaw: 0, pose: 'sit', style: 'diner', k: 0.65 });
    // kaydırak: kule + merdiven + eğik kaydırma yüzeyi
    const sx = gx + 8, sz = gz - 8;
    kit.put(sx, 1, sz, sx + 2, 8, sz + 2, P.WOOD); kit.put(sx - 1, 9, sz - 1, sx + 3, 9, sz + 3, P.ROOF);
    for (let i = 0; i < 8; i++) { const yy = Math.max(1, 7 - i); kit.put(sx, yy, sz + 3 + i, sx + 1, yy, sz + 3 + i, P.LAMP_ORANGE); if (i < 7) kit.put(sx, 1, sz + 3 + i, sx, yy - 1, sz + 3 + i, P.WHITE); }
    for (let i = 1; i <= 6; i++) kit.put(sx, i, sz - i, sx + 2, i, sz - i, P.IRON);                 // merdiven
    // tırmanma kafesi
    const jx = gx + 8, jz = gz + 8;
    for (const [a, b] of [[0, 0], [6, 0], [0, 6], [6, 6]]) kit.put(jx + a, 1, jz + b, jx + a, 7, jz + b, P.IRON);
    for (const y of [3, 5, 7]) { kit.put(jx, y, jz, jx + 6, y, jz, P.IRON); kit.put(jx, y, jz + 6, jx + 6, y, jz + 6, P.IRON); kit.put(jx, y, jz, jx, y, jz + 6, P.IRON); kit.put(jx + 6, y, jz, jx + 6, y, jz + 6, P.IRON); }
    kit.put(jx + 2, 7, jz + 2, jx + 4, 7, jz + 4, P.LAMP_GREEN);
    // tahterevalli ×2
    for (const [tx, tz] of [[gx - 2, gz + 2], [gx + 0, gz - 4]]) { kit.put(tx, 1, tz, tx, 2, tz + 1, P.IRON); for (let i = -4; i <= 4; i++) kit.put(tx + i, 2 + Math.round(i * 0.25) + 1, tz, tx + i, 2 + Math.round(i * 0.25) + 1, tz, P.LAMP_PINK); }
    // kum havuzu
    const bx = gx + 14, bz = gz + 2;
    for (let i = -4; i <= 4; i++) { kit.put(bx + i, 1, bz - 4, bx + i, 1, bz - 4, P.WOOD); kit.put(bx + i, 1, bz + 4, bx + i, 1, bz + 4, P.WOOD); kit.put(bx - 4, 1, bz + i, bx - 4, 1, bz + i, P.WOOD); kit.put(bx + 4, 1, bz + i, bx + 4, 1, bz + i, P.WOOD); }
    // atlı karınca
    const mx = gx - 2, mz = gz - 14;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (a * a + b * b <= 10) kit.put(mx + a, 1, mz + b, mx + a, 1, mz + b, (a + b) % 2 ? P.LAMP_ORANGE : P.LAMP_PURPLE);
    kit.put(mx, 2, mz, mx, 5, mz, P.IRON);
    for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) kit.put(mx + a, 2, mz + b, mx + a, 3, mz + b, P.GOLD);
    // yaylı bineklier
    [[gx + 18, gz - 6, P.LAMP_PINK], [gx + 18, gz - 3, P.LAMP_GREEN], [gx + 18, gz, P.LAMP_BLUE]].forEach(([x, z, c]) => { kit.put(x, 1, z, x, 1, z, P.IRON); kit.put(x, 2, z, x + 1, 3, z + 1, c); });
    bench(gx, z1 + 3); bench(gx + 12, z1 + 3); bench(x1 + 3, gz - 8, false, true); bench(x1 + 3, gz + 8, false, true);
    for (let i = 0; i < 10; i++) world.residents.push({ kind: 'kid', x: f.cx + rr(-16, 16), z: f.cz + rr(-11, 11), y: 0.5, k: 0.65, bounds: { minX: f.cx - f.w / 2 + 1, maxX: f.cx + f.w / 2 - 1, minZ: f.cz - f.d / 2 + 1, maxZ: f.cz + f.d / 2 - 1 } });
  }

  // ── 6. Köpek parkı: çit, engeller, su kabı, serbest köpekler ──
  {
    const f = FEAT.dogp, x0 = V(f.cx - f.w / 2), x1 = V(f.cx + f.w / 2), z0 = V(f.cz - f.d / 2), z1 = V(f.cz + f.d / 2), mx = V(f.cx), mz = V(f.cz);
    for (let a = x0; a <= x1; a++) for (const z of [z0, z1]) { kit.put(a, 2, z, a, 2, z, P.IRON); kit.put(a, 4, z, a, 4, z, P.IRON); if ((a - x0) % 4 === 0) kit.put(a, 1, z, a, 5, z, P.IRON); }
    for (let a = z0; a <= z1; a++) for (const x of [x0, x1]) { if (x === x1 && Math.abs(a - mz) <= 3) continue; kit.put(x, 2, a, x, 2, a, P.IRON); kit.put(x, 4, a, x, 4, a, P.IRON); if ((a - z0) % 4 === 0) kit.put(x, 1, a, x, 5, a, P.IRON); }
    kit.put(x1 - 1, 7, mz - 4, x1 + 1, 8, mz - 4, P.WHITE); kit.put(x1 - 1, 7, mz + 4, x1 + 1, 8, mz + 4, P.WHITE);   // kapı direkleri (üstü)
    kit.sign('KÖPEK PARKI', { bg: 0xea580c, fg: 0xffffff, w: 4.2, h: 0.8 }, 0.5 * (x1 + 1) + 0.3, 3.4, 0.5 * mz, Math.PI / 2);
    for (const [hx, hz] of [[mx - 6, mz - 6], [mx + 2, mz - 7], [mx - 8, mz + 5]]) { kit.put(hx, 1, hz, hx, 3, hz, P.WHITE); kit.put(hx + 5, 1, hz, hx + 5, 3, hz, P.WHITE); kit.put(hx, 3, hz, hx + 5, 3, hz, P.LAMP_ORANGE); }   // atlama engelleri
    for (let i = 0; i < 9; i++) { const h = i < 4 ? i + 1 : 9 - i; kit.put(mx + 4 + i, 1, mz + 4, mx + 4 + i, h, mz + 6, P.WOOD); }   // A-çerçeve rampa
    kit.put(mx - 12, 1, mz + 1, mx - 6, 4, mz + 3, P.BLACK); kit.clr(mx - 12, 1, mz + 2, mx - 6, 3, mz + 2);                                   // tünel
    kit.put(mx + 9, 1, mz - 4, mx + 10, 1, mz - 3, P.IRON); kit.put(mx + 9, 2, mz - 4, mx + 10, 2, mz - 3, P.LAMP_BLUE);                         // su kabı
    bench(mx - 3, z0 + 3); bench(mx + 6, z1 - 3);
    for (let i = 0; i < 5; i++) world.dogs.push({ x: f.cx + rr(-14, 14), z: f.cz + rr(-10, 10), y: 0.5, bounds: { minX: f.cx - f.w / 2, maxX: f.cx + f.w / 2, minZ: f.cz - f.d / 2, maxZ: f.cz + f.d / 2 } });
    for (let i = 0; i < 3; i++) world.residents.push({ kind: 'walker', dog: true, x: f.cx + rr(-14, 14), z: f.cz + rr(-10, 10), y: 0.5, bounds: { minX: f.cx - f.w / 2 + 1, maxX: f.cx + f.w / 2 - 1, minZ: f.cz - f.d / 2 + 1, maxZ: f.cz + f.d / 2 - 1 } });
  }

  // ── 7. Gölet: iskele ve çevresinde banklar ──
  {
    const L = FEAT.lake, px = V(L.cx - L.rx - 1), pz = V(L.cz);
    for (let i = 0; i < 14; i++) kit.put(px + i, 1, pz - 1, px + i, 1, pz + 1, P.WOOD);
    for (let i = 0; i < 14; i += 4) { kit.put(px + i, 2, pz - 1, px + i, 3, pz - 1, P.IRON); kit.put(px + i, 2, pz + 1, px + i, 3, pz + 1, P.IRON); }
    bench(V(L.cx), V(L.cz - L.rz - 7)); bench(V(L.cx + 8), V(L.cz + L.rz + 7)); bench(V(L.cx - L.rx - 7), V(L.cz + 6), false, true);
  }

  // ── 8. Yol kenarı banklar, piknik masaları, lambalar ──
  for (let i = 0; i < 9; i++) { const t = (i + 0.5) / 9; bench(V(Pk.x0 + 6 + t * 70), V(100) + 4, true, i % 3 === 1); bench(V(Pk.x1 - 6 - t * 70), V(100) - 5, true, i % 3 === 0); }
  for (const [px, pz] of [[286, 40], [300, 36], [270, 160], [296, 164], [318, 100]]) {
    const x = V(px), z = V(pz);
    kit.put(x - 2, 2, z, x + 2, 2, z + 1, P.WOOD); kit.put(x - 2, 1, z, x - 2, 1, z, P.IRON); kit.put(x + 2, 1, z, x + 2, 1, z, P.IRON); kit.put(x - 2, 1, z + 1, x - 2, 1, z + 1, P.IRON); kit.put(x + 2, 1, z + 1, x + 2, 1, z + 1, P.IRON);
    kit.put(x - 2, 1, z - 2, x + 2, 1, z - 2, P.WOOD); kit.put(x - 2, 1, z + 3, x + 2, 1, z + 3, P.WOOD);
    kit.prop('tray', 0.5 * x, 0.5 * 3, 0.5 * z + 0.25, { yaw: rnd() * 3 }); kit.prop('burger', 0.5 * x + 0.8, 0.5 * 3, 0.5 * z + 0.2, { yaw: rnd() * 6 });
  }
  for (let t = 22; t <= 164; t += 26) { lm.lamp(284 / 0.75 + 3, (Pk.z0 + t) / 0.75, 0, 0, false, true); lm.lamp(284 / 0.75 - 3, (Pk.z0 + t + 13) / 0.75, 0, 0, false, true); }
  for (let t = 18; t <= 150; t += 26) { lm.lamp((Pk.x0 + t) / 0.75, 100 / 0.75 + 3, 0, 0, false, true); lm.lamp((Pk.x0 + t + 13) / 0.75, 100 / 0.75 - 3, 0, 0, false, true); }
  for (let a = 0; a < 6.283; a += 0.5236) lm.lamp((Pk.cx + Math.cos(a) * 25) / 0.75, (Pk.cz + Math.sin(a) * 25) / 0.75, 0, 0, false, true);

  // ── 9. Ağaçlar: patikalardan, göl, pist, oyun parkı ve köpek parkından uzakta; kenarlarda sık, ortada seyrek ──
  const okTree = (x, z) => {
    if (x < Pk.x0 + 3 || x > Pk.x1 - 3 || z < Pk.z0 + 3 || z > Pk.z1 - 3) return false;
    if (Math.hypot(x - FEAT.plaza.cx, z - FEAT.plaza.cz) < FEAT.plaza.r + 14) return false;
    if (inLake(x, z, 7) || inRect(x, z, FEAT.rink, 4) || inRect(x, z, FEAT.play, 4) || inRect(x, z, FEAT.dogp, 3)) return false;
    for (const s of PATHS) if (segDist(x, z, s) < s[4] / 2 + 2.5) return false;
    const rp = Math.hypot(x - Pk.cx, z - Pk.cz); if (rp > 27 && rp < 34) return false;
    return true;
  };
  const tree = (x, z) => {
    const ix = V(x), iz = V(z), h = 6 + Math.floor(rnd() * 5), cr = 3 + (rnd() < 0.3 ? 1 : 0), mat = rnd() < 0.7 ? P.GRASS : P.DGREEN;
    kit.put(ix, 1, iz, ix, h, iz, P.WOOD);
    for (let a = -cr; a <= cr; a++) for (let b = -cr; b <= cr; b++) for (let c = -2; c <= 2; c++) if (a * a + b * b + c * c * 2 <= cr * cr + 1) kit.put(ix + a, h + 1 + c, iz + b, ix + a, h + 1 + c, iz + b, mat);
  };
  let placed = 0;
  for (let tries = 0; tries < 1500 && placed < 190; tries++) { const x = rr(Pk.x0 + 3, Pk.x1 - 3), z = rr(Pk.z0 + 3, Pk.z1 - 3); if (okTree(x, z)) { tree(x, z); placed++; } }
  for (let x = Pk.x0 + 5; x < Pk.x1 - 4; x += 7 + rnd() * 3) for (const z of [Pk.z0 + 3, Pk.z1 - 3]) if (Math.abs(x - Pk.cx) > 8) tree(x, z + rr(-0.5, 0.5));     // kuzey/güney çit boyunca ağaç sırası
  for (let z = Pk.z0 + 6; z < Pk.z1 - 4; z += 7 + rnd() * 3) for (const x of [Pk.x0 + 3, Pk.x1 - 3]) if (Math.abs(z - Pk.cz) > 8) tree(x + rr(-0.5, 0.5), z);

  // ── 10. Gezenler: köpeğini tasmayla gezdirenler (park boyunca) ──
  for (let i = 0; i < 9; i++) {
    let x, z; do { x = rr(Pk.x0 + 6, Pk.x1 - 6); z = rr(Pk.z0 + 6, Pk.z1 - 6); } while (inRect(x, z, FEAT.rink, 2) || inRect(x, z, FEAT.play, 2) || inRect(x, z, FEAT.dogp, 2) || inLake(x, z, 3));
    world.residents.push({ kind: 'walker', dog: i < 6, x, z, y: 0.5, bounds: { minX: Pk.x0 + 3, maxX: Pk.x1 - 3, minZ: Pk.z0 + 3, maxZ: Pk.z1 - 3 }, bag: i % 4 === 3 ? 0xf3f4f6 : undefined });
  }
}
