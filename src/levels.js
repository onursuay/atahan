import { PALETTE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// ÖLÇEK KATMANI
// Seviye, eski "1 birim = 0.5 m" ızgarasında tarif edilir. Küpler 0.25 m olduğundan ve binalar
// 1.5 kat büyütüldüğünden (1 birim = 0.75 m = 3 küçük küp) her çağrı burada çevrilir.
// Duvarlar ve döşemeler tek küp (0.25 m) kalınlığındadır; bu hem gerçekçidir hem de
// küp sayısını makul tutar.
// ─────────────────────────────────────────────────────────────────────────────
const K = 3;          // 1 eski birim = 3 küçük küp (0.75 m)
const UNIT_M = 0.75;  // 1 eski birimin metre karşılığı
const WALL_T = 1;     // duvar/döşeme kalınlığı (küp)
const MAX_FLOORS = 3;  // iç döşemesi yapılan en üst kat
const GROUND_ROW_SUB = 2; // y=0.5 m: zemin üstü, 1. satırın alt sınırı (küp indeksi)

const GROUND_MATS = new Set([PALETTE.CONCRETE, PALETTE.SAND, PALETTE.ASPHALT, PALETTE.WOOD, PALETTE.GRASS]);

class ScaledBuilder {
  constructor(world) {
    this.world = world;
    this.shell = null; // son kurulan bina kabuğu (eski birim cinsinden)
  }

  beginBuilding() { this.shell = null; }

  // Eski birim aralığı -> küçük küp aralığı
  _x0(i) { return K * i - 1; }
  _x1(i) { return K * i + 1; }
  _y0(r) { return GROUND_ROW_SUB + K * (r - 1); }
  _y1(r) { return GROUND_ROW_SUB + K * (r - 1) + (K - 1); }

  // Metre cinsinden kenarlar (zemin boyama için)
  _m0(i) { return UNIT_M * (i - 0.5); }
  _m1(i) { return UNIT_M * (i + 0.5); }

  fillBox(minX, minY, minZ, maxX, maxY, maxZ, mat) {
    // Zemin satırı (y=0) yol/kum/ahşap: voxel değil, kaplama yüzeyi
    if (minY === 0 && maxY === 0 && GROUND_MATS.has(mat)) {
      this.world.terrain.addRect(this._m0(minX), this._m0(minZ), this._m1(maxX), this._m1(maxZ), mat);
      return;
    }

    let x = [this._x0(minX), this._x1(maxX)];
    let y = [this._y0(minY), this._y1(maxY)];
    let z = [this._z0(minZ), this._z1(maxZ)];

    // Tek birim kalınlığındaki geniş yüzeyler (duvar, döşeme, cam) ince levha olur
    const ext = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
    const ones = ext.filter(v => v === 1).length;
    if (ones === 1 && ext.every(v => v === 1 || v >= 2)) {
      const axis = ext.indexOf(1);
      if (axis === 0) x = this._thin(minX, 'x', x);
      else if (axis === 1) y = [y[0], y[0] + WALL_T - 1];
      else z = this._thin(minZ, 'z', z);
    }

    if (mat === PALETTE.GLASS) this.world.replaceBox(x[0], y[0], z[0], x[1], y[1], z[1], mat);
    else this.world.fillBox(x[0], y[0], z[0], x[1], y[1], z[1], mat);
  }

  _z0(i) { return K * i - 1; }
  _z1(i) { return K * i + 1; }

  // İnce levhanın konumu: bina kabuğunun kenarındaysa kabukla aynı yüzde, değilse ortada
  _thin(c, axis, full) {
    const s = this.shell;
    const lo = axis === 'x' ? s && s.minX : s && s.minZ;
    const hi = axis === 'x' ? s && s.maxX : s && s.maxZ;
    if (s && c === lo) return [full[0], full[0] + WALL_T - 1];
    if (s && c === hi) return [full[1] - WALL_T + 1, full[1]];
    const mid = K * c - Math.floor(WALL_T / 2);
    return [mid, mid + WALL_T - 1];
  }

  fillHollowBox(minX, minY, minZ, maxX, maxY, maxZ, wallMat, floorMat) {
    if (!this.shell) this.shell = { minX, maxX, minY, maxY, minZ, maxZ };

    const X0 = this._x0(minX), X1 = this._x1(maxX);
    const Y0 = this._y0(minY), Y1 = this._y1(maxY);
    const Z0 = this._z0(minZ), Z1 = this._z1(maxZ);
    const w = this.world;
    const T = WALL_T;

    w.fillBox(X0, Y0, Z0, X1, Y0 + T - 1, Z1, floorMat || wallMat); // zemin
    w.fillBox(X0, Y1 - T + 1, Z0, X1, Y1, Z1, wallMat);              // tavan / çatı
    const yA = Y0 + T, yB = Y1 - T;
    w.fillBox(X0, yA, Z0, X1, yB, Z0 + T - 1, wallMat);              // duvarlar
    w.fillBox(X0, yA, Z1 - T + 1, X1, yB, Z1, wallMat);
    w.fillBox(X0, yA, Z0, X0 + T - 1, yB, Z1, wallMat);
    w.fillBox(X1 - T + 1, yA, Z0, X1, yB, Z1, wallMat);
  }

  // Kapı / delik aç (eski birim koordinatlarıyla)
  clearBox(minX, minY, minZ, maxX, maxY, maxZ) {
    this.world.removeBox(this._x0(minX), this._y0(minY), this._z0(minZ),
      this._x1(maxX), this._y1(maxY), this._z1(maxZ));
  }

  // Doğrudan küçük küp koordinatlarıyla
  raw(x0, y0, z0, x1, y1, z1, mat) { this.world.fillBox(x0, y0, z0, x1, y1, z1, mat); }
  rawClear(x0, y0, z0, x1, y1, z1) { this.world.removeBox(x0, y0, z0, x1, y1, z1); }
  rawReplace(x0, y0, z0, x1, y1, z1, mat) { this.world.replaceBox(x0, y0, z0, x1, y1, z1, mat); }
}

export class LevelManager {
  constructor(voxelWorld) {
    this.world = voxelWorld;
    this.currentLevelIndex = 0;

    this.levelConfigs = [
      {
        id: 0,
        title: 'BÜYÜK ŞEHİR, SAHİL & ZENGİN ADA',
        desc: 'Geniş caddelerde dolaş, tepelere çık, binaların içine gir, köprüden adaya geç ve sinemayı/villaları yık!',
        targetPercent: 35,
        // Batı kumsalı (eski birim x=-78 -> -58.5 m)
        spawn: { x: -58.5, y: 2.5, z: 0 },
        builder: this.buildFullCityWorld.bind(this)
      }
    ];
  }

  // ANA DÜNYA: İKİ ADA. Batıda şehir adası, doğuda tepelik ada (otoyol + zengin bölge), aralarında asma köprü.
  buildFullCityWorld() {
    const w = new ScaledBuilder(this.world);
    this.b = w;
    this.world.fountains = [];
    const ISL = 154; // zengin bölgenin x kayması (eski birim)

    // ==========================================
    // 1. ZEMİN, SAHİL, YOLLAR (kaplama yüzeyi)
    // ==========================================
    w.fillBox(78, 0, -130, 235, 0, 130, PALETTE.GRASS);         // doğu ada: çimli (tepeler ortada yükselir)
    this._setHills();
    w.fillBox(-74, 0, -130, -12, 0, 130, PALETTE.CONCRETE);     // batı ada: şehir zemini
    w.fillBox(-82, 0, -130, -75, 0, 130, PALETTE.SAND);         // batı kumsalı
    w.fillBox(-75, 0, -128, -73, 0, 128, PALETTE.WOOD);         // gezinti yolu
    w.fillBox(-90, 0, -18, -82, 0, -14, PALETTE.WOOD);          // iskeleler
    w.fillBox(-90, 0, 14, -82, 0, 18, PALETTE.WOOD);
    w.fillBox(178, 0, -70, 224, 0, 70, PALETTE.CONCRETE);       // zengin bölge zemini

    // Yollar iki yönlüdür: her yönde bir şerit, 6.75 m ve üstü
    w.fillBox(-72, 0, -5, -12, 0, 5, PALETTE.ASPHALT);          // ana cadde (şehir adası)
    w.fillBox(78, 0, -5, 224, 0, 5, PALETTE.ASPHALT);           // ana cadde (doğu ada)
    w.fillBox(-72, 0, 61, -12, 0, 71, PALETTE.ASPHALT);
    w.fillBox(-72, 0, -71, -12, 0, -61, PALETTE.ASPHALT);
    w.fillBox(-51, 0, -128, -43, 0, 128, PALETTE.ASPHALT);
    w.fillBox(-31, 0, -128, -23, 0, 128, PALETTE.ASPHALT);
    w.fillBox(110, 0, -130, 141, 0, 130, PALETTE.ASPHALT);      // OTOYOL: her yönde 3 şerit (23 m)
    w.fillBox(197, 0, -66, 201, 0, 66, PALETTE.ASPHALT);        // zengin bölge ara sokağı

    // Otoyol orta bariyeri (kavşakta boşluk) ve çift kollu aydınlatma
    w.fillBox(125, 1, -130, 125, 2, -7, PALETTE.CONCRETE);
    w.fillBox(125, 1, 7, 125, 2, 130, PALETTE.CONCRETE);
    for (let z = -120; z <= 120; z += 15) if (Math.abs(z) > 10) this.lamp(125, z, 1, 0, true);

    // ==========================================
    // 2. ASMA KÖPRÜ (iki adayı bağlar)
    // ==========================================
    this.buildSuspensionBridge();

    // ==========================================
    // 3. ŞEHİR BİNALARI
    // ==========================================
    this.buildCityApartment(-72, 1, 8, -54, 32, 26);
    this.buildCityBank(-72, 1, -26, -54, 20, -8);
    this.buildBeachCafe(-70, 1, 28, -56, 9, 52);
    this.buildTower(-70, 1, -50, -58, 34, -36, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x2' });
    this.buildCityWarehouse(-41, 1, 10, -33, 14, 26);
    this.buildTower(-42, 1, -30, -32, 26, -8, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-42, 1, 32, -32, 14, 50, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-42, 1, -52, -32, 26, -34, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, 8, -14, 30, 30, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, -30, -14, 20, -8, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, 34, -14, 12, 52, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, -52, -14, 12, -34, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    // Kuzey ticaret bölgesi: market ve çarşı
    this.buildMarket(-42, 1, 74, -32, 10, 94);
    this.buildBazaar(-22, 1, 74, -14, 9, 102);
    this.buildTower(-42, 1, 98, -32, 22, 122, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, 106, -14, 14, 126, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    // Güney mahalleleri
    this.buildTower(-22, 1, -96, -14, 18, -76, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(-22, 1, -124, -14, 14, -102, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });

    this.buildPark(-72, 72, -52, 128);
    this.buildSite(-72, -124, -33, -74);

    // ==========================================
    // 4. SOKAK DONATIMI: lambalar, çöp kutuları, ağaçlar
    // ==========================================
    for (let x = -70; x <= -14; x += 14) {
      this.lamp(x, 6.5, 0, -1); this.lamp(x + 7, -6.5, 0, 1);
      this.trashBin(x + 3, 7); this.trashBin(x + 10, -7);
    }
    for (let x = -68; x <= -16; x += 26) { this.tree(x, 6.5, 6); this.tree(x + 13, -6.5, 6); }

    // ==========================================
    // 5. ZENGİN BÖLGE (doğu adanın doğusu)
    // ==========================================
    this.buildGrandCinema(28 + ISL, 1, -28, 42 + ISL, 18, -4);
    this.buildLuxuryVilla(28 + ISL, 1, 6, 42 + ISL, 18, 26);
    this.buildLuxuryMansion(48 + ISL, 1, -14, 64 + ISL, 18, 14);
    this.buildLuxuryBoutique(48 + ISL, 1, 16, 62 + ISL, 14, 28);
    this.buildTower(48 + ISL, 1, -30, 57 + ISL, 14, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(59 + ISL, 1, -30, 66 + ISL, 26, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    for (let z = -60; z <= 60; z += 20) { this.tree(227, z, 7); this.lamp(195, z + 4, 0, 0); }
  }

  // ── KIRMIZI ASMA KÖPRÜ: iki basamaklı kule, ana kablolar ve dikey askılar ──
  buildSuspensionBridge() {
    const w = this.b;
    const X0 = -K * 12, X1 = K * 78;                 // tabliye uçları (küçük küp)
    const T1 = K * 8, T2 = K * 58;                   // iki kulenin x konumu
    const ZD = 16, ZL = 21, DECK_TOP = 2;

    // Tabliye (asfalt) + kesik sarı orta şerit + kırmızı korkuluklar
    w.raw(X0, 1, -ZD, X1, DECK_TOP, ZD, PALETTE.ASPHALT);
    for (let x = X0 + 6; x < X1 - 6; x += 14) w.rawReplace(x, DECK_TOP, -1, x + 6, DECK_TOP, 0, PALETTE.GOLD);
    w.raw(X0, 3, -ZD, X1, 6, -ZD, PALETTE.BRICK);
    w.raw(X0, 3, ZD, X1, 6, ZD, PALETTE.BRICK);

    // Kuleler: aşağıdan yukarı daralan 3 basamak (kırmızı çelik), iki bacak + yatay kirişler
    for (const tx of [T1, T2]) {
      for (const sz of [-ZL, ZL]) {
        w.raw(tx - 3, -8, sz - 3, tx + 3, 70, sz + 3, PALETTE.BRICK);
        w.raw(tx - 2, 71, sz - 2, tx + 2, 118, sz + 2, PALETTE.BRICK);
        w.raw(tx - 1, 119, sz - 1, tx + 1, 165, sz + 1, PALETTE.BRICK);
        w.raw(tx - 3, 70, sz - 3, tx + 3, 70, sz + 3, PALETTE.IRON);
        w.raw(tx - 2, 118, sz - 2, tx + 2, 118, sz + 2, PALETTE.IRON);
      }
      for (const by of [72, 112, 150, 164]) w.raw(tx - 1, by, -ZL + 4, tx + 1, by + 2, ZL - 4, PALETTE.BRICK);
    }

    // Ana kablolar
    const yAt = (x) => {
      if (x <= T1) { const t = (x - X0) / (T1 - X0); return (DECK_TOP + 6) + (165 - (DECK_TOP + 6)) * t - 40 * t * (1 - t); }
      if (x >= T2) { const t = (x - T2) / (X1 - T2); return 165 + (DECK_TOP + 6 - 165) * t - 40 * t * (1 - t); }
      const t = (x - T1) / (T2 - T1); return 165 - 600 * t * (1 - t);
    };
    for (let x = X0; x <= X1; x++) {
      const y = Math.round(yAt(x));
      for (const sz of [-ZL, ZL]) w.raw(x, y, sz - 1, x, y + 1, sz, PALETTE.BRICK);
    }
    // Dikey askılar (kablodan tabliyeye) ve tabliyeye bağlayan konsollar
    for (let x = X0 + 10; x < X1 - 9; x += 10) {
      if (Math.abs(x - T1) < 4 || Math.abs(x - T2) < 4) continue;
      const y = Math.round(yAt(x));
      for (const sz of [-ZL, ZL]) {
        w.raw(x, DECK_TOP + 1, sz, x, y - 1, sz, PALETTE.IRON);
        w.raw(x, DECK_TOP + 1, Math.min(sz, Math.sign(sz) * ZD), x, DECK_TOP + 1, Math.max(sz, Math.sign(sz) * ZD), PALETTE.IRON);
      }
    }
    for (let x = X0 + 24; x < X1 - 20; x += 30) { this.lampSub(x, ZD - 2, DECK_TOP + 1, 0, -1); this.lampSub(x + 15, -ZD + 2, DECK_TOP + 1, 0, 1); }
  }

  // ── Sokak donatımı ──
  lamp(x, z, dx = 0, dz = 0, both = false) {
    this.lampSub(Math.round(K * x), Math.round(K * z), GROUND_ROW_SUB, dx, dz, both);
  }

  // Detaylı sokak lambası: kaide, süslü pervaz, direk, halka, yola uzanan kol, lamba muhafazası ve ışık camı
  lampSub(sx, sz, base, dx = 0, dz = 0, both = false) {
    const w = this.b;
    w.raw(sx - 1, base, sz - 1, sx + 1, base + 1, sz + 1, PALETTE.CONCRETE);
    w.raw(sx - 1, base + 2, sz - 1, sx + 1, base + 2, sz + 1, PALETTE.IRON);
    w.raw(sx, base + 3, sz, sx, base + 19, sz, PALETTE.IRON);
    w.raw(sx - 1, base + 12, sz, sx + 1, base + 12, sz, PALETTE.GOLD);
    w.raw(sx, base + 12, sz - 1, sx, base + 12, sz + 1, PALETTE.GOLD);
    const arm = (ddx, ddz) => {
      const ex = sx + ddx * 7, ez = sz + ddz * 7, y = base + 19;
      w.raw(Math.min(sx, ex), y, Math.min(sz, ez), Math.max(sx, ex), y, Math.max(sz, ez), PALETTE.IRON);
      w.raw(ex - 1, y, ez - 1, ex + 1, y, ez + 1, PALETTE.GOLD);
      w.raw(ex - 1, y - 1, ez - 1, ex + 1, y - 1, ez + 1, PALETTE.GLASS);
    };
    if (dx !== 0 || dz !== 0) { arm(dx, dz); if (both) arm(-dx, -dz); }
    else {
      w.raw(sx - 1, base + 20, sz - 1, sx + 1, base + 21, sz + 1, PALETTE.GLASS);
      w.raw(sx - 1, base + 22, sz - 1, sx + 1, base + 22, sz + 1, PALETTE.GOLD);
    }
  }

  trashBin(x, z) {
    const w = this.b, sx = Math.round(K * x), sz = Math.round(K * z);
    w.raw(sx, GROUND_ROW_SUB, sz, sx + 1, GROUND_ROW_SUB + 3, sz + 1, PALETTE.IRON);
    w.raw(sx, GROUND_ROW_SUB + 4, sz, sx + 1, GROUND_ROW_SUB + 4, sz + 1, PALETTE.WOOD);
  }

  tree(x, z, h) {
    const w = this.b;
    w.fillBox(x, 1, z, x, h - 2, z, PALETTE.WOOD);
    w.fillBox(x - 1, h - 3, z - 1, x + 1, h - 1, z + 1, PALETTE.GRASS);
  }

  // Çeşme: taş havuz, orta sütun ve üst kase. Suyun akışı oyun döngüsünde parçacıklarla gösterilir.
  fountain(x, z) {
    const w = this.b, cx = Math.round(K * x), cz = Math.round(K * z), r = 11, B = GROUND_ROW_SUB;
    w.raw(cx - r, B, cz - r, cx + r, B + 2, cz + r, PALETTE.CONCRETE);
    w.rawClear(cx - r + 1, B + 1, cz - r + 1, cx + r - 1, B + 2, cz + r - 1);
    w.raw(cx - r + 1, B, cz - r + 1, cx + r - 1, B, cz + r - 1, PALETTE.GLASS);
    w.raw(cx - 1, B + 1, cz - 1, cx + 1, B + 9, cz + 1, PALETTE.CONCRETE);
    w.raw(cx - 4, B + 10, cz - 4, cx + 4, B + 10, cz + 4, PALETTE.CONCRETE);
    for (const [ax, az, bx, bz] of [[-4,-4,4,-4],[-4,4,4,4],[-4,-4,-4,4],[4,-4,4,4]]) w.raw(cx + ax, B + 11, cz + az, cx + bx, B + 11, cz + bz, PALETTE.CONCRETE);
    this.world.fountains.push({ x: cx * 0.25, z: cz * 0.25, y: (B + 11) * 0.25 + 0.2 });
  }

  // Büyük park: patikalar, çeşmeli meydan, gölet, çardak, çocuk parkı, çiçek tarhları, çitler, ağaçlar, banklar
  buildPark(x1, z1, x2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillBox(x1, 0, z1, x2, 0, z2, PALETTE.GRASS);
    const cx = Math.round((x1 + x2) / 2), cz = Math.round((z1 + z2) / 2);
    w.fillBox(cx - 1, 0, z1, cx, 0, z2, PALETTE.CONCRETE);
    w.fillBox(x1, 0, cz - 1, x2, 0, cz, PALETTE.CONCRETE);
    w.fillBox(cx - 7, 0, cz - 7, cx + 6, 0, cz + 6, PALETTE.CONCRETE);
    this.fountain(cx, cz);

    // Gölet (kuzey ucu) ve taş kenarı
    const px = cx - 6, pz = z1 + 8;
    w.fillBox(px - 5, 1, pz - 4, px + 5, 1, pz + 4, PALETTE.CONCRETE);
    w.rawClear(K * (px - 4) - 1, GROUND_ROW_SUB, K * (pz - 3) - 1, K * (px + 4) + 1, GROUND_ROW_SUB + 2, K * (pz + 3) + 1);
    w.raw(K * (px - 4) - 1, GROUND_ROW_SUB, K * (pz - 3) - 1, K * (px + 4) + 1, GROUND_ROW_SUB, K * (pz + 3) + 1, PALETTE.GLASS);

    // Çardak (kuzeydoğu)
    const gx = cx + 6, gz = z2 - 10;
    [[0, 0], [5, 0], [0, 5], [5, 5]].forEach(([a, b]) => w.fillBox(gx + a, 1, gz + b, gx + a, 5, gz + b, PALETTE.WOOD));
    w.fillBox(gx - 1, 6, gz - 1, gx + 6, 6, gz + 6, PALETTE.ROOF);
    w.fillBox(gx + 1, 1, gz + 2, gx + 4, 1, gz + 2, PALETTE.WOOD);

    // Çocuk parkı (güneybatı)
    const sx = x1 + 3, sz = z2 - 12;
    w.fillBox(sx, 1, sz, sx + 6, 1, sz + 6, PALETTE.SAND);
    const fx = sx + 9;
    w.fillBox(fx, 1, sz, fx, 5, sz, PALETTE.IRON); w.fillBox(fx + 6, 1, sz, fx + 6, 5, sz, PALETTE.IRON);
    w.fillBox(fx, 5, sz, fx + 6, 5, sz, PALETTE.IRON);
    w.fillBox(fx + 2, 2, sz, fx + 2, 4, sz, PALETTE.IRON); w.fillBox(fx + 4, 2, sz, fx + 4, 4, sz, PALETTE.IRON);
    w.fillBox(fx + 2, 2, sz, fx + 4, 2, sz, PALETTE.WOOD);
    const kx = fx + 9;
    w.fillBox(kx, 1, sz, kx + 2, 5, sz + 2, PALETTE.WOOD);
    for (let i = 0; i < 6; i++) { const yy = 4 - Math.min(3, Math.floor(i / 1.5)); w.fillBox(kx, yy, sz + 3 + i, kx + 1, yy, sz + 3 + i, PALETTE.ROOF); }

    // Çiçek tarhları ve çalı çitler
    [[x1 + 2, cz + 9], [x2 - 4, cz + 9], [x1 + 2, cz - 12], [x2 - 4, cz - 12]].forEach(([a, b]) => {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w.fillBox(a + i, 1, b + j, a + i, 1, b + j, (i + j) % 2 ? PALETTE.GOLD : PALETTE.BRICK);
    });
    w.fillBox(x1, 1, z1, x2, 2, z1, PALETTE.GRASS); w.fillBox(x1, 1, z2, x2, 2, z2, PALETTE.GRASS);
    w.fillBox(x1, 1, z1, x1, 2, z2, PALETTE.GRASS);

    // Ağaçlar, banklar, çöp kutuları, lambalar
    for (let i = 0; i < 26; i++) {
      const tx = x1 + 2 + ((i * 7) % (x2 - x1 - 3)), tz = z1 + 14 + ((i * 11) % (z2 - z1 - 18));
      if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3) continue;
      this.tree(tx, tz, 7 + (i % 3));
    }
    [[cx - 3, cz - 8], [cx + 2, cz - 8], [cx - 3, cz + 8], [cx + 2, cz + 8], [cx - 3, z1 + 20], [cx + 2, z2 - 20]]
      .forEach(([a, b]) => w.fillBox(a, 1, b, a + 1, 1, b, PALETTE.WOOD));
    [[cx - 4, cz - 9], [cx + 4, cz + 9], [cx - 4, z1 + 3], [cx + 3, z2 - 3]].forEach(([a, b]) => this.trashBin(a, b));
    for (let z = z1 + 8; z < z2 - 4; z += 14) { this.lamp(cx - 2, z, 0, 0); this.lamp(cx + 1, z + 7, 0, 0); }
  }

  // Çitli, kapılı konut sitesi
  buildSite(x1, z1, x2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillBox(x1, 0, z1, x2, 0, z2, PALETTE.CONCRETE);
    const cx = Math.round((x1 + x2) / 2);
    w.fillBox(cx - 3, 0, z1, cx + 3, 0, z2, PALETTE.ASPHALT);
    const fy0 = 1, fy1 = 3;
    w.fillBox(x1, fy0, z1, x2, fy1, z1, PALETTE.IRON);
    w.fillBox(x1, fy0, z1, x1, fy1, z2, PALETTE.IRON);
    w.fillBox(x2, fy0, z1, x2, fy1, z2, PALETTE.IRON);
    w.fillBox(x1, fy0, z2, cx - 5, fy1, z2, PALETTE.IRON);
    w.fillBox(cx + 5, fy0, z2, x2, fy1, z2, PALETTE.IRON);
    this.buildTower(cx + 7, 1, z2 - 8, cx + 12, 8, z2 - 3, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    [[z1 + 4, z1 + 18], [z1 + 22, z1 + 36]].forEach(([a, b]) => {
      this.buildTower(x1 + 4, 1, a, cx - 7, 10, b, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x2' });
      this.buildTower(cx + 7, 1, a, x2 - 4, 10, b, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });
    });
    for (let z = z1 + 6; z < z2 - 4; z += 14) { this.lamp(cx - 5, z, 1, 0); this.lamp(cx + 5, z + 7, -1, 0); }
  }

  // MARKET: cam cepheli süpermarket; raflı reyonlar, kasalar ve dondurucu dolabı
  buildMarket(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 2, x1, y1 + 4, zc + 2);
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 3, zc - 4, PALETTE.GLASS);
    w.fillBox(x1, y1 + 1, zc + 4, x1, y2 - 3, z2 - 2, PALETTE.GLASS);
    w.fillBox(x1, y1 + 6, zc - 4, x1, y1 + 7, zc + 4, PALETTE.GOLD);
    const goods = [PALETTE.GOLD, PALETTE.BRICK, PALETTE.ROOF, PALETTE.GLASS];
    for (let ax = x1 + 4; ax <= x2 - 5; ax += 3) {
      w.fillBox(ax, y1, z1 + 2, ax, y1 + 3, z2 - 6, PALETTE.WOOD);
      for (let z = z1 + 3; z <= z2 - 7; z += 2) {
        w.fillBox(ax + 1, y1 + 1, z, ax + 1, y1 + 1, z, goods[(z + ax) & 3]);
        w.fillBox(ax + 1, y1 + 3, z, ax + 1, y1 + 3, z, goods[(z + ax + 1) & 3]);
      }
    }
    for (let z = z1 + 3; z <= z2 - 4; z += 5) {
      if (Math.abs(z - zc) < 4) continue;
      w.fillBox(x1 + 2, y1, z, x1 + 3, y1 + 1, z + 1, PALETTE.WOOD);
      w.fillBox(x1 + 2, y1 + 2, z, x1 + 2, y1 + 2, z, PALETTE.IRON);
    }
    w.fillBox(x2 - 2, y1, z1 + 2, x2 - 1, y1 + 3, z2 - 6, PALETTE.IRON);
    w.fillBox(x2 - 3, y1 + 1, z1 + 2, x2 - 3, y1 + 3, z2 - 6, PALETTE.GLASS);
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
  }

  // ÇARŞI: iki yanında tezgâhlı, tenteli dükkânlar olan kapalı çarşı; iki ucu açık
  buildBazaar(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillBox(x1, y1, z1, x1, y2, z2, PALETTE.BRICK);
    w.fillBox(x2, y1, z1, x2, y2, z2, PALETTE.BRICK);
    w.fillBox(x1, y2, z1, x2, y2, z2, PALETTE.ROOF);
    const awn = [PALETTE.GOLD, PALETTE.BRICK, PALETTE.GLASS, PALETTE.ROOF];
    for (let z = z1 + 2, i = 0; z <= z2 - 4; z += 5, i++) {
      for (const side of [0, 1]) {
        const bx = side ? x2 - 3 : x1 + 1;
        w.fillBox(bx, y1, z, bx + 1, y1 + 1, z + 3, PALETTE.WOOD);
        w.fillBox(bx + (side ? -1 : 1), y1 + 4, z, bx + (side ? 1 : 3), y1 + 4, z + 3, awn[(i + side) & 3]);
        w.fillBox(bx, y1 + 2, z + 1, bx, y1 + 2, z + 2, awn[(i + side + 1) & 3]);
        w.fillBox(bx, y1 + 5, z + 1, bx, y1 + 7, z + 1, PALETTE.IRON);
      }
    }
    for (let z = z1 + 1; z <= z2 - 1; z += 5) w.fillBox(x1 + 3, y2 - 2, z, x2 - 3, y2 - 2, z, PALETTE.GOLD);
  }

  // Tepeler: doğu adanın ortasında, otoyolun iki yanında; kıyıya yaklaştıkça sıfıra iner (alçak ve yumuşak)
  _setHills() {
    const U = 0.75;
    const hills = [
      [94, 95, 9, 4.2], [96, 50, 9, 3.8], [92, -45, 9, 4.5], [95, -98, 9, 4],
      [158, 100, 11, 5], [160, 46, 11, 4.5], [156, -48, 11, 4.2], [158, -102, 11, 5]
    ];
    const paved = [[106, 145, -134, 134], [78, 228, -9, 9], [174, 228, -74, 74]];
    const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const edgeDist = (x, z) => Math.min(x - 78, 235 - x, 130 - z, z + 130);
    this.world.terrain.heightFn = (xm, zm) => {
      const x = xm / U, z = zm / U;
      let h = 0;
      for (const [cx, cz, sg, A] of hills) h += A * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * sg * sg));
      let d = Infinity;
      for (const [x0, x1, z0, z1] of paved) {
        const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
        d = Math.min(d, Math.hypot(dx, dz));
      }
      return h * smooth(d / 10) * smooth(edgeDist(x, z) / 24);
    };
  }

  // Her 6 satırda (4.5 m) bir kat döşemesi
  addFloors(x1, y1, z1, x2, y2, z2, mat, fromFloor = 1) {
    const w = this.b;
    // En çok 3 kat döşemesi: üst katlara çıkılmadığı için küp sayısı makul tutulur
    for (let k = fromFloor; k <= MAX_FLOORS && y1 + 6 * k < y2 - 2; k++) {
      w.fillBox(x1 + 1, y1 + 6 * k, z1 + 1, x2 - 1, y1 + 6 * k, z2 - 1, mat);
    }
  }

  // Yüzeye sığan yatay şerit pencereler: her katta
  addWindowBands(x1, y1, z1, x2, y2, z2, doorSide) {
    const w = this.b;
    for (let k = 0; y1 + 6 * k + 3 < y2 - 1; k++) {
      const r0 = y1 + 6 * k + 2;
      for (let x = x1 + 2; x + 1 <= x2 - 2; x += 4) {
        if (!(k === 0 && doorSide === 'z1' && Math.abs(x - Math.round((x1 + x2) / 2)) <= 2)) {
          w.fillBox(x, r0, z1, x + 1, r0 + 1, z1, PALETTE.GLASS);
        }
        if (!(k === 0 && doorSide === 'z2' && Math.abs(x - Math.round((x1 + x2) / 2)) <= 2)) {
          w.fillBox(x, r0, z2, x + 1, r0 + 1, z2, PALETTE.GLASS);
        }
      }
      for (let z = z1 + 2; z + 1 <= z2 - 2; z += 4) {
        if (!(k === 0 && doorSide === 'x1' && Math.abs(z - Math.round((z1 + z2) / 2)) <= 2)) {
          w.fillBox(x1, r0, z, x1, r0 + 1, z + 1, PALETTE.GLASS);
        }
        if (!(k === 0 && doorSide === 'x2' && Math.abs(z - Math.round((z1 + z2) / 2)) <= 2)) {
          w.fillBox(x2, r0, z, x2, r0 + 1, z + 1, PALETTE.GLASS);
        }
      }
    }
  }

  // Genel bina: çok katlı, şerit pencereli, kapılı ve çatısında tank olan kule/ofis/dükkân
  buildTower(x1, y1, z1, x2, y2, z2, o) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, o.wall, o.floor);

    const side = o.side;
    const cx = Math.round((x1 + x2) / 2), cz = Math.round((z1 + z2) / 2);
    if (side === 'x1') w.clearBox(x1, y1, cz - 1, x1, y1 + 4, cz + 1);
    if (side === 'x2') w.clearBox(x2, y1, cz - 1, x2, y1 + 4, cz + 1);
    if (side === 'z1') w.clearBox(cx - 1, y1, z1, cx + 1, y1 + 4, z1);
    if (side === 'z2') w.clearBox(cx - 1, y1, z2, cx + 1, y1 + 4, z2);

    this.addWindowBands(x1, y1, z1, x2, y2, z2, side);
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);

    // Zemin kat: resepsiyon/tezgâh (kapıdan uzakta)
    w.fillBox(x1 + 2, y1, z1 + 2, x1 + 4, y1 + 1, z1 + 4, PALETTE.WOOD);
    // Çatı tankı
    w.fillBox(cx - 1, y2 + 1, cz - 1, cx, y2 + 2, cz, PALETTE.IRON);
  }

  // -------------------------------------------------------------
  // ÖZEL BİNALAR (İÇ MEKÂNLARIYLA):
  // -------------------------------------------------------------

  // BİNA 1: ŞEHİR APARTMANI (çok katlı, merdivenli)
  buildCityApartment(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.WOOD);

    // Giriş kapısı (kuzey/güney yüzünde, caddeye bakan z1 tarafı)
    const doorX = Math.round((x1 + x2) / 2);
    w.clearBox(doorX - 1, y1, z1, doorX + 1, y1 + 4, z1);
    w.fillBox(doorX - 1, y1, z1, doorX - 1, y1 + 3, z1, PALETTE.WOOD); // Tahta kapı kanadı

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'z1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);

    // Zemin kat: resepsiyon bankosu ve güvenlik kasası (demir)
    w.fillBox(x1 + 3, y1, z1 + 4, x1 + 7, y1 + 1, z1 + 5, PALETTE.WOOD);
    w.fillBox(x1 + 2, y1, z1 + 2, x1 + 3, y1 + 2, z1 + 3, PALETTE.IRON);

    // İÇ MERDİVEN: zemin -> 1. kat -> 2. kat (her kat 4.5 m = 18 basamak, 0.25 m yükseklik)
    const xw0 = K * (x2 - 4) - 1, xw1 = K * (x2 - 2) + 1;
    const zs = K * z1 - 1 + 4;
    const baseRow = GROUND_ROW_SUB + WALL_T; // zemin kat boş alanının ilk satırı
    const f1 = GROUND_ROW_SUB + 18;          // 1. kat döşeme satırı
    const f2 = GROUND_ROW_SUB + 36;          // 2. kat döşeme satırı
    // Önce döşeme boşlukları (merdiven üstündeki baş boşluğu), sonra basamaklar
    w.rawClear(xw0, f1, zs, xw1, f1, zs + 17);
    w.rawClear(xw0, f2, zs + 18, xw1, f2, zs + 35);
    for (let j = 0; j < 18; j++) w.raw(xw0, baseRow, zs + j, xw1, baseRow + j, zs + j, PALETTE.WOOD);
    for (let j = 0; j < 18; j++) w.raw(xw0, f1 + 1, zs + 18 + j, xw1, f1 + 1 + j, zs + 18 + j, PALETTE.WOOD);

    // 2. kat odaları: ahşap bölme + yatak ve masa
    const midZ = Math.round((z1 + z2) / 2);
    w.fillBox(x1 + 1, y1 + 7, midZ, x2 - 6, y1 + 11, midZ, PALETTE.WOOD);
    w.fillBox(x1 + 2, y1 + 7, z1 + 2, x1 + 4, y1 + 7, z1 + 5, PALETTE.WOOD);
    w.fillBox(x1 + 2, y1 + 7, z2 - 4, x1 + 5, y1 + 7, z2 - 2, PALETTE.WOOD);

    // Çatı katına TNT sandıkları
    const topFloor = y1 + 6 * Math.floor((y2 - 3 - y1) / 6);
    w.fillBox(doorX - 1, topFloor + 1, midZ, doorX + 1, topFloor + 2, midZ + 2, PALETTE.TNT);
  }

  // BİNA 2: ŞEHİR BANKASI (içinde ağır demir kasa)
  buildCityBank(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);

    // Giriş kapısı (caddeye bakan z2 tarafı) ve demir sütunlar
    const doorX = Math.round((x1 + x2) / 2);
    w.clearBox(doorX - 2, y1, z2, doorX + 2, y1 + 4, z2);
    w.fillBox(doorX - 3, y1, z2, doorX - 3, y1 + 5, z2, PALETTE.IRON);
    w.fillBox(doorX + 3, y1, z2, doorX + 3, y1 + 5, z2, PALETTE.IRON);

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'z2');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
    w.fillBox(doorX - 4, y1 + 6, z2, doorX + 4, y1 + 7, z2, PALETTE.GOLD);   // BANKA tabelası
    w.fillBox(x2 + 1, y1, z2 - 6, x2 + 1, y1 + 2, z2 - 5, PALETTE.IRON);     // dış ATM

    // Vezne bankoları
    w.fillBox(x1 + 3, y1, z2 - 5, x2 - 3, y1 + 1, z2 - 4, PALETTE.WOOD);

    // Demir kasa odası: demir duvarlar, çekiçle kırılamaz
    w.fillHollowBox(x1 + 2, y1, z1 + 2, x1 + 8, y1 + 5, z1 + 8, PALETTE.IRON, PALETTE.IRON);
    w.clearBox(x1 + 5, y1, z1 + 8, x1 + 6, y1 + 3, z1 + 8);
    w.fillBox(x1 + 3, y1, z1 + 3, x1 + 5, y1 + 1, z1 + 5, PALETTE.GOLD);
    w.fillBox(x1 + 6, y1, z1 + 3, x1 + 7, y1 + 2, z1 + 4, PALETTE.TNT);
  }

  // BİNA 3: SAHİL KAFESİ
  buildBeachCafe(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WOOD, PALETTE.WOOD);

    // Sahile bakan geniş cam cephe
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 1, z2 - 2, PALETTE.GLASS);

    // Kapı (doğu yüzü, caddeye bakar)
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x2, y1, zc - 1, x2, y1 + 4, zc + 1);

    // Masalar ve sandalyeler
    for (let z = z1 + 3; z <= z2 - 3; z += 4) {
      w.fillBox(x1 + 3, y1, z, x1 + 5, y1 + 1, z + 2, PALETTE.WOOD);
      w.fillBox(x1 + 7, y1, z, x1 + 9, y1 + 1, z + 2, PALETTE.WOOD);
    }
    // Bar tezgâhı (kapının önünde geçiş boşluğu bırakılır)
    w.fillBox(x2 - 4, y1, z1 + 2, x2 - 2, y1 + 1, zc - 4, PALETTE.WOOD);
    w.fillBox(x2 - 4, y1, zc + 4, x2 - 2, y1 + 1, z2 - 2, PALETTE.WOOD);
  }

  // BİNA 4: ŞEHİR DEPOSU
  buildCityWarehouse(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);

    // Geniş depo kapısı (batı yüzü, caddeye bakar)
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 2, x1, y1 + 5, zc + 2);

    // TNT paletleri ve ahşap sandıklar
    w.fillBox(x1 + 2, y1, z1 + 2, x2 - 2, y1 + 2, z1 + 5, PALETTE.TNT);
    w.fillBox(x1 + 2, y1, z2 - 5, x2 - 2, y1 + 2, z2 - 2, PALETTE.WOOD);
  }

  // BİNA 5: ZENGİN ADA SİNEMASI
  buildGrandCinema(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.ASPHALT);

    // Ana giriş (z2 tarafı, dar sokağa bakar)
    const doorX = Math.round((x1 + x2) / 2);
    w.clearBox(doorX - 2, y1, z2, doorX + 2, y1 + 4, z2);
    // Giriş üstü altın tabela
    w.fillBox(x1 + 1, y1 + 5, z2, x2 - 1, y1 + 6, z2 + 1, PALETTE.GOLD);
    // Bilet gişesi
    w.fillBox(doorX - 3, y1, z2 - 4, doorX - 1, y1 + 2, z2 - 3, PALETTE.WOOD);

    // Dev perde ve altın çerçevesi (ön duvar)
    w.fillBox(x1 + 2, y1 + 2, z1 + 1, x2 - 2, y1 + 8, z1 + 1, PALETTE.CONCRETE);
    w.fillBox(x1 + 1, y1 + 1, z1 + 1, x2 - 1, y1 + 9, z1 + 1, PALETTE.GOLD);

    // Basamaklı koltuk sıraları
    let rowStep = 0;
    for (let z = z1 + 5; z <= z2 - 8; z += 3) {
      w.fillBox(x1 + 2, y1, z, x2 - 2, y1 + rowStep, z + 1, PALETTE.CONCRETE);
      w.fillBox(x1 + 3, y1 + rowStep + 1, z, x2 - 3, y1 + rowStep + 1, z, PALETTE.ROOF);
      rowStep++;
    }

    // Projeksiyon makinesi
    w.fillBox(doorX - 1, y1 + 6, z2 - 2, doorX + 1, y1 + 8, z2 - 1, PALETTE.IRON);
  }

  // BİNA 6: 1. LÜKS VİLLA
  buildLuxuryVilla(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);

    // Giriş kapısı (x1 tarafı)
    w.clearBox(x1, y1, z1 + 2, x1, y1 + 4, z1 + 4);
    w.fillBox(x1, y1, z1 + 2, x1, y1 + 3, z1 + 2, PALETTE.WOOD);

    // Salon: koltuk takımı, cam sehpa, mutfak tezgâhı
    w.fillBox(x1 + 2, y1, z1 + 6, x1 + 5, y1 + 1, z1 + 10, PALETTE.WOOD);
    w.fillBox(x1 + 3, y1, z1 + 8, x1 + 4, y1 + 1, z1 + 8, PALETTE.GLASS);
    w.fillBox(x2 - 4, y1, z1 + 2, x2 - 2, y1 + 1, z1 + 8, PALETTE.WOOD);

    // Yüzme havuzu
    w.fillBox(x1 + 2, y1, z2 - 6, x2 - 2, y1, z2 - 2, PALETTE.GLASS);

    // Üst kat, cam korkuluklu balkon ve demir dikmeler
    const floorY = y1 + 5;
    w.fillBox(x1 + 1, floorY, z1 + 1, x2 - 1, floorY, z2 - 5, PALETTE.WOOD);
    w.fillBox(x1 + 1, floorY + 1, z2 - 5, x2 - 1, floorY + 1, z2 - 5, PALETTE.GLASS);
    w.fillBox(x1 + 1, y1, z2 - 5, x1 + 1, floorY + 2, z2 - 5, PALETTE.IRON);
    w.fillBox(x2 - 1, y1, z2 - 5, x2 - 1, floorY + 2, z2 - 5, PALETTE.IRON);
    w.fillBox(x1 + 3, floorY + 1, z1 + 3, x1 + 6, floorY + 1, z1 + 6, PALETTE.WOOD);

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
  }

  // BİNA 7: 2. LÜKS VİLLA (malikane)
  buildLuxuryMansion(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.WOOD);

    // Malikane girişi (caddeye bakan x1 tarafı) ve bahçe demir kapısı
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 1, x1, y1 + 4, zc + 1);
    w.fillBox(x1, y1, z1 - 1, x1 + 4, y1 + 3, z1 - 1, PALETTE.IRON);

    // Şömine
    w.fillBox(x2 - 3, y1, zc - 1, x2 - 1, y1 + 4, zc + 2, PALETTE.BRICK);
    w.fillBox(x2 - 2, y1, zc, x2 - 2, y1 + 1, zc + 1, PALETTE.IRON);

    // Yemek masası
    w.fillBox(x1 + 3, y1, zc - 4, x1 + 7, y1 + 1, zc + 2, PALETTE.WOOD);

    // Ara kat + çatı terası altın heykel
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
    w.fillBox(Math.round((x1 + x2) / 2) - 1, y2 + 1, zc - 1, Math.round((x1 + x2) / 2) + 1, y2 + 3, zc + 1, PALETTE.GOLD);

    // Gizli TNT sandığı
    w.fillBox(x1 + 2, y1, z2 - 3, x1 + 4, y1 + 1, z2 - 2, PALETTE.TNT);

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
  }

  // BİNA 8: SANAT GALERİSİ & BUTİK
  buildLuxuryBoutique(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);

    // Cam vitrin (z1 yüzü) ve kapı (x1 yüzü)
    w.fillBox(x1 + 2, y1 + 1, z1, x2 - 2, y2 - 6, z1, PALETTE.GLASS);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc, x1, y1 + 4, zc + 1);

    // Altın kaideler
    w.fillBox(x1 + 3, y1, z1 + 4, x1 + 4, y1 + 2, z1 + 5, PALETTE.GOLD);
    w.fillBox(x2 - 4, y1, z1 + 4, x2 - 3, y1 + 2, z1 + 5, PALETTE.GOLD);
    w.fillBox(Math.round((x1 + x2) / 2), y1, z2 - 4, Math.round((x1 + x2) / 2) + 1, y1 + 2, z2 - 3, PALETTE.GOLD);

    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
  }

  loadLevel(index) {
    this.world.clear();
    this.currentLevelIndex = 0;

    const cfg = this.levelConfigs[0];
    cfg.builder();
    this.world.buildMeshBuffers();
    return cfg;
  }
}
