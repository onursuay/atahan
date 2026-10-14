import * as THREE from 'three';
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
const MAX_FLOORS = 2;
const MALL_FLOOR = 8;  // AVM'de kat yüksekliği (satır): 6 m; diğer binalarda 6 satır = 4.5 m  // iç döşemesi yapılan en üst kat
const GROUND_ROW_SUB = 2; // y=0.5 m: zemin üstü, 1. satırın alt sınırı (küp indeksi)

const GROUND_MATS = new Set([PALETTE.CONCRETE, PALETTE.SAND, PALETTE.ASPHALT, PALETTE.WOOD, PALETTE.GRASS]);

class ScaledBuilder {
  constructor(world) {
    this.world = world;
    this.shell = null; // son kurulan bina kabuğu (eski birim cinsinden)
    this.footprints = []; // tüm binaların ayak izi: yol lambası/ağaç gibi donatı bina içine konmasın
  }

  blocked(x, z, m = 1) { return this.footprints.some(r => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m); }

  beginBuilding() { this.shell = null; }

  // Eski birim aralığı -> küçük küp aralığı
  _x0(i) { return K * i - 1; }
  _x1(i) { return K * i + 1; }
  _y0(r) { return GROUND_ROW_SUB + K * (r - 1); }
  _y1(r) { return GROUND_ROW_SUB + K * (r - 1) + (K - 1); }

  // Metre cinsinden kenarlar (zemin boyama için)
  _m0(i) { return UNIT_M * (i - 0.5); }
  _m1(i) { return UNIT_M * (i + 0.5); }

  fillBox(minX, minY, minZ, maxX, maxY, maxZ, mat, onlyExisting = false) {
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

    if (mat === PALETTE.GLASS && onlyExisting) this.world.retypeBox(x[0], y[0], z[0], x[1], y[1], z[1], mat);
    else if (mat === PALETTE.GLASS) this.world.replaceBox(x[0], y[0], z[0], x[1], y[1], z[1], mat);
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
    if (!this.shell) { this.shell = { minX, maxX, minY, maxY, minZ, maxZ }; this.footprints.push({ minX, maxX, minZ, maxZ }); }

    const X0 = this._x0(minX), X1 = this._x1(maxX);
    const Y0 = this._y0(minY), Y1 = this._y1(maxY);
    const Z0 = this._z0(minZ), Z1 = this._z1(maxZ);
    const w = this.world;
    const T = WALL_T;

    if (minY !== 1) w.fillBox(X0, Y0, Z0, X1, Y0 + T - 1, Z1, floorMat || wallMat); // zemin kat döşemesi yok: altındaki zemin tabandır
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
    this._doorway(minX, minY, minZ, maxX, maxY, maxZ);
  }

  // Zeminden başlayan, tek eksende ince (duvar düzleminde), en az 3 satır yüksekliğindeki her açıklık GERÇEK kapı olur:
  // geniş (≥6 birim = 4.5 m) açıklıklar sürgülü otomatik kapı (AVM, hastane, itfaiye garajı), diğerleri menteşeli kapı.
  _doorway(minX, minY, minZ, maxX, maxY, maxZ) {
    const w = this.world, doors = w.doors;
    if (!doors || minY !== 1 || maxY - minY < 3) return;
    let alongX;
    if (minZ === maxZ && maxX > minX) alongX = true; else if (minX === maxX && maxZ > minZ) alongX = false; else return;
    // Açıklığın voxel aralığı (removeBox ile aynı dönüşüm: x/z yuvarlama, y kat)
    const qh = (a) => Math.floor((a + 1) / 2), qv = (a) => Math.floor(a / 2);
    const X0 = qh(this._x0(minX)), X1 = qh(this._x1(maxX)), Z0 = qh(this._z0(minZ)), Z1 = qh(this._z1(maxZ));
    const Y0 = qv(this._y0(minY)), Y1 = qv(this._y1(maxY));
    const A0 = alongX ? X0 : Z0, A1 = alongX ? X1 : Z1, T0 = alongX ? Z0 : X0, T1 = alongX ? Z1 : X1;   // A: açıklık boyunca, T: duvar kalınlığı
    const cnt = A1 - A0 + 1, hv = Y1 - Y0 + 1;
    if (cnt < 2 || hv < 3) return;
    // Büyük açıklıklar (AVM, hastane, garaj) iki kanatlı sürgülü otomatik kapı: 4 m x 3 m. Diğerleri normal menteşeli kapı: 1-1.5 m x 2.5 m.
    const big = maxX - minX >= 6 || maxZ - minZ >= 6 || maxY - minY >= 6;
    const dn = big ? Math.min(cnt, 8) : Math.min(cnt, cnt % 2 === 0 ? 2 : 3);
    const dh = Math.min(hv, big ? 6 : 5);
    const S0 = A0 + Math.floor((cnt - dn) / 2);
    // Açıklığın kapıdan artan kısmı komşu duvarın malzemesiyle doldurulur (kapı bir duvar deliğine değil, duvara oturur)
    const key = (a, y, t) => alongX ? `${a},${y},${t}` : `${t},${y},${a}`;
    const probe = (a) => { for (let t = T0; t <= T1; t++) { const v = w.voxels.get(key(a, Y0 + 1, t)); if (v) return v.type; } return null; };
    const type = probe(A0 - 1) || probe(A1 + 1) || PALETTE.CONCRETE;
    for (let a = A0; a <= A1; a++) for (let y = Y0; y <= Y1; y++) {
      if (a >= S0 && a < S0 + dn && y < Y0 + dh) continue;
      for (let t = T0; t <= T1; t++) { if (alongX) w.setVoxel(a, y, t, type); else w.setVoxel(t, y, a, type); }
    }
    // Gerçek kapı nesnesi (metre): voxel i'nin merkezi i*0.5; y satırı [iy*0.5, (iy+1)*0.5]
    const aStart = S0 * 0.5 - 0.25, tMid = ((T0 + T1) / 2) * 0.5, inset = 0.04;
    const width = dn * 0.5 - 2 * inset, height = dh * 0.5 - 0.05, y = Y0 * 0.5;
    const spec = alongX ? { x: aStart + inset, z: tMid, ax: 1, az: 0 } : { x: tMid, z: aStart + inset, ax: 0, az: 1 };
    if (big) doors.addSliding({ sx: spec.x, sz: spec.z, ax: spec.ax, az: spec.az, width, height, y });
    else doors.addHinged({ hx: spec.x, hz: spec.z, ax: spec.ax, az: spec.az, width, height, y });
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
        spawn: { x: -118.5, y: 2.5, z: 0 },
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
    w.fillBox(78, 0, -165, 235, 0, 165, PALETTE.GRASS);         // doğu ada çimi (zengin bölgenin kuzeyi/güneyi)
    this._setHills();
    w.fillBox(-154, 0, -165, -12, 0, 165, PALETTE.CONCRETE);    // batı ada: genişletilmiş şehir zemini
    w.fillBox(-162, 0, -165, -155, 0, 165, PALETTE.SAND);       // batı kumsalı
    w.fillBox(-155, 0, -163, -153, 0, 163, PALETTE.WOOD);       // gezinti yolu
    w.fillBox(-170, 0, -18, -162, 0, -14, PALETTE.WOOD);        // iskeleler
    w.fillBox(-170, 0, 14, -162, 0, 18, PALETTE.WOOD);
    w.fillBox(78, 0, -165, 110, 0, 165, PALETTE.CONCRETE);      // doğu ada: şehir blokları (köprüden sonra)
    w.fillBox(141, 0, -165, 178, 0, 165, PALETTE.CONCRETE);
    w.fillBox(178, 0, -70, 224, 0, 70, PALETTE.CONCRETE);       // zengin bölge zemini

    // Yollar iki yönlüdür: her yönde bir şerit, 6.75 m ve üstü
    w.fillBox(-152, 0, -5, -12, 0, 5, PALETTE.ASPHALT);         // ana cadde (batı ada)
    w.fillBox(78, 0, -5, 224, 0, 5, PALETTE.ASPHALT);           // ana cadde (doğu ada)
    w.fillBox(78, 0, -6, 180, 0, 6, PALETTE.ASPHALT);           // üst geçit + rampalar: daha geniş (9.75 m; eskiden 8.25)
    w.fillBox(-152, 0, 61, -12, 0, 71, PALETTE.ASPHALT);
    w.fillBox(-152, 0, -71, -12, 0, -61, PALETTE.ASPHALT);
    [-131, -91, -51, -31].forEach(x => w.fillBox(x, 0, -163, x + 8, 0, 163, PALETTE.ASPHALT));  // kuzey-güney sokaklar
    [44, -44].forEach(zz => w.fillBox(78, 0, zz - 5, 178, 0, zz + 5, PALETTE.ASPHALT));      // doğu ada caddeleri
    [88, -88].forEach(zz => w.fillBox(78, 0, zz - 5, 110, 0, zz + 5, PALETTE.ASPHALT));       // hastane/AVM'nin içinden geçmez
    [134, -134].forEach(zz => { w.fillBox(-152, 0, zz - 5, -12, 0, zz + 5, PALETTE.ASPHALT); w.fillBox(78, 0, zz - 5, 178, 0, zz + 5, PALETTE.ASPHALT); }); // yeni kuzey/güney caddeleri
    w.fillBox(110, 0, -165, 141, 0, 165, PALETTE.ASPHALT);      // OTOYOL: her yönde 3 şerit (23 m)
    w.fillBox(197, 0, -66, 201, 0, 66, PALETTE.ASPHALT);        // zengin bölge ara sokağı

    // Otoyol orta bariyeri (kavşaklarda boşluk) ve çift kollu aydınlatma
    [[-165, -142], [-126, -96], [-80, -52], [-36, -8], [8, 36], [52, 80], [96, 126], [142, 165]].forEach(([a, b]) => w.fillBox(125, 1, a, 125, 2, b, PALETTE.CONCRETE));
    for (let z = -160; z <= 160; z += 15) if ([0, 44, -44, 88, -88, 134, -134].every(g => Math.abs(z - g) > 10)) this.lamp(125, z, 1, 0, true);

    // ==========================================
    // 2. ASMA KÖPRÜ (iki adayı bağlar)
    // ==========================================
    this.buildSuspensionBridge();

    // ==========================================
    // 3. BATI ADA: ŞEHİR (eski merkez + batıya genişleme)
    // ==========================================
    const CC = { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD }, BR = { wall: PALETTE.BRICK, floor: PALETTE.WOOD };
    this.buildCityApartment(-72, 1, 8, -54, 32, 26);
    this.buildCityBank(-72, 1, -26, -54, 20, -8);
    this.buildBeachCafe(-70, 1, 28, -56, 9, 52);
    this.buildTower(-70, 1, -50, -58, 34, -36, { ...CC, side: 'x2', interior: 'hotel' });
    this.buildCityWarehouse(-41, 1, 10, -33, 14, 26);
    this.buildTower(-42, 1, -30, -32, 26, -8, { ...BR, side: 'x1' });
    this.buildTower(-42, 1, 32, -32, 14, 50, { ...CC, side: 'x1' });
    this.buildTower(-42, 1, -52, -32, 26, -34, { ...BR, side: 'x1' });
    this.buildTower(-22, 1, 8, -14, 30, 30, { ...CC, side: 'x1' });
    this.buildTower(-22, 1, -30, -14, 20, -8, { ...BR, side: 'x1' });
    this.buildTower(-22, 1, 34, -14, 12, 52, { ...CC, side: 'x1' });
    this.buildTower(-22, 1, -52, -14, 12, -34, { ...BR, side: 'x1' });
    this.buildMarket(-42, 1, 74, -32, 10, 94);
    this.buildBazaar(-22, 1, 74, -14, 9, 102);
    this.buildTower(-42, 1, 98, -32, 22, 122, { ...BR, side: 'x1' });
    this.buildTower(-22, 1, 106, -14, 14, 126, { ...BR, side: 'x1' });
    this.buildTower(-22, 1, -96, -14, 18, -76, { ...CC, side: 'x1' });
    this.buildTower(-22, 1, -124, -14, 14, -102, { ...BR, side: 'x1' });
    // Batı genişlemesi (x -154..-80): yeni mahalleler
    this.buildTower(-120, 1, 8, -96, 26, 40, { ...CC, side: 'z1' });
    this.buildTower(-120, 1, -40, -96, 22, -8, { ...BR, side: 'z2' });
    this.buildTower(-120, 1, 74, -96, 12, 100, { ...BR, side: 'z1' });
    this.buildTower(-120, 1, -100, -96, 14, -74, { ...CC, side: 'z2' });
    this.buildTower(-120, 1, 104, -96, 18, 126, { ...CC, side: 'z1' });
    this.buildTower(-120, 1, -126, -96, 16, -104, { ...BR, side: 'z2' });
    this.buildTower(-150, 1, 8, -134, 10, 40, { ...BR, side: 'x2' });
    this.buildTower(-150, 1, -40, -134, 10, -8, { ...CC, side: 'x2' });
    this.buildTower(-150, 1, 74, -134, 12, 110, { ...CC, side: 'x2' });
    this.buildTower(-150, 1, -110, -134, 12, -74, { ...BR, side: 'x2' });
    this.buildTower(-81, 1, 10, -74, 20, 36, { ...CC, side: 'z1' });
    this.buildTower(-81, 1, -36, -74, 18, -10, { ...BR, side: 'z2' });

    // Uzatılan kuzey/güney mahalleleri (yeni caddeler z=±134 boyunca)
    [[1, 142, 164, 'z1'], [-1, -164, -142, 'z2']].forEach(([sg, za, zb, door]) => {
      this.buildTower(-150, 1, za, -134, 10, zb, { ...BR, side: 'x2' });
      this.buildTower(-120, 1, za, -96, 16, zb, { ...CC, side: door });
      this.buildTower(-42, 1, za, -32, 14, zb, { ...BR, side: door });
      this.buildTower(-22, 1, za, -14, 12, zb, { ...CC, side: door });
    });

    this.buildPark(-72, 72, -52, 128);
    this.buildSite(-72, -124, -33, -74);

    // ==========================================
    // 4. DOĞU ADA: ŞEHİR BLOKLARI (köprüden sonra) — hastane, itfaiye, polis, okul, AVM, apartmanlar
    // ==========================================
    this.buildHospital(144, 1, 50, 176, 14, 118);                                   // çok büyük beyaz hastane (kırmızı artılı)
    this.buildMall(143, 1, -127, 180, 34, -50);                                     // devasa AVM (38x78, 4 kat, kat yüksekliği 6 m)
    this.buildFireStation(80, 1, 52, 108, 14, 82);                                  // itfaiye istasyonu
    this.buildTower(82, 1, 96, 106, 12, 120, { ...CC, side: 'z1', sign: true, interior: 'police' });     // polis merkezi
    this.buildTower(80, 1, 8, 108, 12, 38, { ...BR, side: 'z1', interior: 'school' });                   // okul
    this.buildTower(80, 1, -38, 108, 26, -8, { ...CC, side: 'z2' });                 // iş merkezi
    this.buildTower(80, 1, -82, 108, 20, -50, { ...BR, side: 'z1', interior: 'hotel' });  // otel
    this.buildTower(82, 1, -122, 106, 24, -96, { ...CC, side: 'z2' });               // apartmanlar
    this.buildTower(144, 1, 8, 176, 28, 38, { ...CC, side: 'z1' });                  // apartman bloğu
    this.buildTower(144, 1, -38, 176, 22, -8, { ...BR, side: 'z2' });                // ofis kulesi
    this.buildTower(182, 1, 78, 202, 14, 100, { ...BR, side: 'x1' });
    this.buildTower(206, 1, 78, 224, 16, 104, { ...CC, side: 'x1' });
    [[142, 164, 'z1'], [-164, -142, 'z2']].forEach(([za, zb, door]) => {
      this.buildTower(80, 1, za, 108, 14, zb, { ...BR, side: door });
      this.buildTower(144, 1, za, 176, 16, zb, { ...CC, side: door });
    });
    this.buildOverpass();
    this.buildTower(182, 1, -104, 202, 14, -78, { ...CC, side: 'x1' });
    this.buildTower(206, 1, -108, 224, 18, -80, { ...BR, side: 'x1' });

    // ==========================================
    // 5. SOKAK DONATIMI: lambalar, çöp kutuları, ağaçlar
    // ==========================================
    // Kuzey-güney sokaklarının üstüne (x aralığı) donatı konmaz
    const onStreet = (x) => [-131, -91, -51, -31].some(sx => x >= sx - 2 && x <= sx + 10);
    for (let x = -150; x <= -14; x += 14) {
      if (!onStreet(x)) { this.lamp(x, 6.5, 0, -1); this.trashBin(x + 3, 7); }
      if (!onStreet(x + 7)) this.lamp(x + 7, -6.5, 0, 1);
      if (!onStreet(x + 10)) this.trashBin(x + 10, -7);
    }
    for (let x = -148; x <= -16; x += 26) {
      if (!onStreet(x)) this.tree(x, 6.5, 6);
      if (!onStreet(x + 13)) this.tree(x + 13, -6.5, 6);
    }
    for (let x = 84; x <= 172; x += 16) [44, -44, 88, -88, 134, -134].forEach(zz => { if (Math.abs(x - 125) > 20 && !(Math.abs(zz) === 88 && x > 106)) { this.lamp(x, zz + 6.5, 0, -1); this.lamp(x + 8, zz - 6.5, 0, 1); } });

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

  // ── ÜST GEÇİT: ana cadde otoyolun üstünden geçer. Rampalar zeminin kendisidir (yükselen yol), tabliye küptür. ──
  buildOverpass() {
    const w = this.b;
    const X0 = K * 106 - 1, X1 = K * 145 + 1, ZD = 19;   // ZD: tabliye yarı genişliği (ince ızgara; 19 = 9.75 m tabliye, asfalt şeritle aynı)
    w.raw(X0, 18, -ZD, X1, 19, ZD, PALETTE.ASPHALT);                                    // tabliye (üst yüz 5.0 m)
    for (let x = X0 + 4; x < X1 - 4; x += 14) w.rawReplace(x, 19, -1, x + 6, 19, 0, PALETTE.GOLD); // orta şerit
    w.raw(X0, 20, -ZD, X1, 23, -ZD, PALETTE.CONCRETE);                                  // korkuluklar
    w.raw(X0, 20, ZD, X1, 23, ZD, PALETTE.CONCRETE);
    [K * 109, K * 125, K * 142].forEach(px => [-17, 17].forEach(pz => w.raw(px - 1, GROUND_ROW_SUB, pz - 1, px + 1, 17, pz + 1, PALETTE.CONCRETE))); // sütunlar
    w.raw(K * 109 - 1, 16, -ZD, K * 142 + 1, 17, ZD, PALETTE.CONCRETE);                 // alt kiriş
  }

  // ── KIRMIZI ASMA KÖPRÜ: iki basamaklı kule, ana kablolar ve dikey askılar (küçültülmüş ve alçaltılmış) ──
  buildSuspensionBridge() {
    const w = this.b;
    const DY = -2;                                   // bir blok (0.5 m) aşağı: tabliye artık zeminle aynı hizada
    const X0 = -K * 12, X1 = K * 78;                 // tabliye uçları (ince ızgara)
    const T1 = K * 10, T2 = K * 56;                  // iki kulenin x konumu (köprü kısaldı, kuleler yaklaştı)
    const ZD = 14, ZL = 18;                          // tabliye yarı genişliği, kule bacaklarının z konumu
    const DECK_TOP = 2 + DY;
    const TOP = 100;                                 // kule tepesi (≈25 m; eskiden ≈41 m)
    const Y = (v) => v + DY;

    // Tabliye (asfalt) + kesik sarı orta şerit + kırmızı korkuluklar
    w.raw(X0, Y(1), -ZD, X1, DECK_TOP, ZD, PALETTE.ASPHALT);
    for (let x = X0 + 6; x < X1 - 6; x += 14) w.rawReplace(x, DECK_TOP, -1, x + 6, DECK_TOP, 0, PALETTE.GOLD);
    w.raw(X0, DECK_TOP + 1, -ZD, X1, DECK_TOP + 3, -ZD, PALETTE.BRICK);
    w.raw(X0, DECK_TOP + 1, ZD, X1, DECK_TOP + 3, ZD, PALETTE.BRICK);

    // Kuleler: aşağıdan yukarı daralan 3 basamak (kırmızı çelik), iki bacak + yatay kirişler
    for (const tx of [T1, T2]) {
      for (const sz of [-ZL, ZL]) {
        w.raw(tx - 3, -8, sz - 3, tx + 3, 44, sz + 3, PALETTE.BRICK);
        w.raw(tx - 2, 45, sz - 2, tx + 2, 74, sz + 2, PALETTE.BRICK);
        w.raw(tx - 1, 75, sz - 1, tx + 1, TOP, sz + 1, PALETTE.BRICK);
        w.raw(tx - 3, 44, sz - 3, tx + 3, 44, sz + 3, PALETTE.IRON);
        w.raw(tx - 2, 74, sz - 2, tx + 2, 74, sz + 2, PALETTE.IRON);
      }
      for (const by of [46, 70, 92, TOP - 1]) w.raw(tx - 1, by, -ZL + 4, tx + 1, by + 2, ZL - 4, PALETTE.BRICK);
    }

    // Ana kablolar
    const endY = DECK_TOP + 5;
    const yAt = (x) => {
      if (x <= T1) { const t = (x - X0) / (T1 - X0); return endY + (TOP - endY) * t - 24 * t * (1 - t); }
      if (x >= T2) { const t = (x - T2) / (X1 - T2); return TOP + (endY - TOP) * t - 24 * t * (1 - t); }
      const t = (x - T1) / (T2 - T1); return TOP - 4 * (TOP - endY - 8) * t * (1 - t);
    };
    this._bridgeCables(X0, X1, ZL, ZD, DECK_TOP, T1, T2, yAt);   // kablo ve askılar: ince tüpler (voxel olsalardı en az 0.5 m kalın olurdu)
    for (let x = X0 + 24; x < X1 - 20; x += 30) { this.lampSub(x, ZD - 2, DECK_TOP + 1, 0, -1); this.lampSub(x + 15, -ZD + 2, DECK_TOP + 1, 0, 1); }
  }

  // Köprünün ana kabloları (iki yanda sarkan eğri tüp) ve dikey askıları (ince silindir + tabliyeye yatay konsol). Yalnız görsel.
  _bridgeCables(X0, X1, ZL, ZD, DECK_TOP, T1, T2, yAt) {
    const F = 0.25;   // 1 küçük küp = 0.25 m
    const cableMat = new THREE.MeshLambertMaterial({ color: 0xb91c1c }), hangMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const g = new THREE.Group();
    for (const sz of [-ZL, ZL]) {
      const pts = [];
      for (let x = X0; x <= X1; x += 2) pts.push(new THREE.Vector3(x * F, (Math.round(yAt(x)) + 1) * F, sz * F));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.13, 6, false), cableMat));
    }
    for (let x = X0 + 10; x < X1 - 9; x += 10) {
      if (Math.abs(x - T1) < 4 || Math.abs(x - T2) < 4) continue;
      const yTop = (Math.round(yAt(x)) + 1) * F, yBot = (DECK_TOP + 1) * F, h = yTop - yBot;
      for (const sz of [-ZL, ZL]) {
        const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 5), hangMat);
        hang.position.set(x * F, yBot + h / 2, sz * F); g.add(hang);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, (ZL - ZD) * F), hangMat);   // askıdan tabliye kenarına konsol
        arm.position.set(x * F, yBot, Math.sign(sz) * (ZD + (ZL - ZD) / 2) * F); g.add(arm);
      }
    }
    this.world.scene.add(g);
    this.world.decor.push(g);
  }

  // ── Sokak donatımı ──
  lamp(x, z, dx = 0, dz = 0, both = false) {
    if (this.b.blocked(x, z, 0)) return;
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
      w.raw(ex - 1, y, ez - 1, ex + 1, y, ez + 1, PALETTE.LAMP);
      w.raw(ex - 1, y - 1, ez - 1, ex + 1, y - 1, ez + 1, PALETTE.GLASS);
    };
    if (dx !== 0 || dz !== 0) { arm(dx, dz); if (both) arm(-dx, -dz); }
    else {
      w.raw(sx - 1, base + 20, sz - 1, sx + 1, base + 21, sz + 1, PALETTE.GLASS);
      w.raw(sx - 1, base + 22, sz - 1, sx + 1, base + 22, sz + 1, PALETTE.LAMP);
    }
  }

  trashBin(x, z) {
    if (this.b.blocked(x, z, 0)) return;
    const w = this.b, sx = Math.round(K * x), sz = Math.round(K * z);
    w.raw(sx, GROUND_ROW_SUB, sz, sx + 1, GROUND_ROW_SUB + 3, sz + 1, PALETTE.IRON);
    w.raw(sx, GROUND_ROW_SUB + 4, sz, sx + 1, GROUND_ROW_SUB + 4, sz + 1, PALETTE.WOOD);
  }

  tree(x, z, h) {
    if (this.b.blocked(x, z, 1)) return;
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
    this.world.fountains.push({ x: cx * 0.25, z: cz * 0.25, y: (B + 11) * 0.25 + 0.2, keys: [this.world.toVoxel(cx, B + 5, cz).join(','), this.world.toVoxel(cx, B + 10, cz).join(',')] });
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
      this.buildTower(x1 + 4, 1, a, cx - 7, 10, b, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x2', interior: 'apt' });
      this.buildTower(cx + 7, 1, a, x2 - 4, 10, b, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1', interior: 'apt' });
    });
    for (let z = z1 + 6; z < z2 - 4; z += 14) { this.lamp(cx - 5, z, 1, 0); this.lamp(cx + 5, z + 7, -1, 0); }
  }

  // HASTANE: çok büyük, beyaz; girişte küçük kırmızı artı (can sembolü), ambulans sundurması, koridorlar ve yataklar
  buildHospital(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WHITE, PALETTE.CONCRETE);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 3, x1, y1 + 5, zc + 3);                         // geniş ana giriş (batı yüzü)
    w.fillBox(x1, y1 + 6, zc - 4, x1, y1 + 6, zc + 4, PALETTE.WHITE);
    // Kırmızı artı: giriş üstündeki duvara oturur (dış yüze çıkıntılı)
    const sx = K * x1 - 2, sy = w._y0(y1 + 9) + 1, sz = K * zc;
    w.rawReplace(sx, sy - 4, sz - 1, sx + 1, sy + 4, sz + 1, PALETTE.BRICK);   // dikey kol
    w.rawReplace(sx, sy - 1, sz - 4, sx + 1, sy + 1, sz + 4, PALETTE.BRICK);   // yatay kol
    // Ambulans sundurması: giriş önünde direkli çatı
    w.fillBox(x1 - 4, y1 + 6, zc - 6, x1 - 1, y1 + 6, zc + 6, PALETTE.WHITE);
    [[x1 - 4, zc - 6], [x1 - 4, zc + 6]].forEach(([a, b]) => w.fillBox(a, y1, b, a, y1 + 5, b, PALETTE.IRON));
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE);
    this.addStairs(x1, y1, z1, x2, y2, z2);
    this.furnishHospital(x1, y1, z1, x2, y2, z2);
    // Resepsiyon, bekleme koltukları, koridor duvarları ve hasta yatakları
    w.fillBox(x1 + 3, y1, zc - 6, x1 + 6, y1 + 1, zc + 6, PALETTE.WOOD);
    for (let z = z1 + 5; z < z2 - 3; z += 8) {
      w.fillBox(x1 + 12, y1, z, x2 - 4, y1 + 5, z, PALETTE.WHITE);          // oda ayıran duvarlar
      w.fillBox(x1 + 14, y1, z + 2, x1 + 16, y1, z + 5, PALETTE.WOOD);       // yatak çerçevesi
      w.fillBox(x1 + 14, y1 + 1, z + 2, x1 + 16, y1 + 1, z + 5, PALETTE.GLASS);
    }
    // Çatıda helikopter pisti
    w.fillBox(x2 - 12, y2 + 1, zc - 5, x2 - 3, y2 + 1, zc + 5, PALETTE.CONCRETE);
    w.fillBox(x2 - 8, y2 + 2, zc - 2, x2 - 7, y2 + 2, zc + 2, PALETTE.GOLD);
  }

  // İTFAİYE İSTASYONU: kırmızı tuğla, üç geniş garaj kapısı, içinde kırmızı itfaiye araçları, hortum kulesi
  buildFireStation(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.CONCRETE);
    const bays = [x1 + 4, x1 + 13, x1 + 22];
    bays.forEach(b => { w.clearBox(b, y1, z1, b + 5, y1 + 6, z1); });       // üç garaj kapısı (cadde tarafı z1)
    w.fillBox(x1 + 1, y1 + 8, z1, x2 - 1, y1 + 9, z1, PALETTE.WHITE);        // beyaz şerit
    w.fillBox(x1 + 8, y1 + 10, z1, x2 - 8, y1 + 11, z1, PALETTE.GOLD);       // İTFAİYE tabelası
    // İçeride kırmızı itfaiye araçları
    bays.forEach(b => {
      w.fillBox(b, y1, z1 + 4, b + 4, y1 + 2, z1 + 14, PALETTE.BRICK);
      w.fillBox(b + 1, y1 + 3, z1 + 5, b + 3, y1 + 3, z1 + 8, PALETTE.GLASS);
      w.fillBox(b, y1 + 3, z1 + 10, b + 4, y1 + 3, z1 + 14, PALETTE.WHITE);
    });
    // Hortum kulesi (sağ köşe)
    w.fillHollowBox(x2 - 6, y1, z2 - 8, x2 - 1, y1 + 22, z2 - 2, PALETTE.BRICK, PALETTE.CONCRETE);
    w.fillBox(x2 - 5, y1 + 19, z2 - 7, x2 - 2, y1 + 20, z2 - 3, PALETTE.GLASS);
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'z1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD, 1);
    this.addStairs(x1, y1, z1, x2, y2, z2);
    this.furnishFire(x1, y1, z1, x2, y2, z2);
  }

  // AVM: kocaman alışveriş merkezi; cam cephe, merkezi atrium, mağaza vitrinleri, camlı çatı ve sütunlar
  buildMall(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 5, x1, y1 + 6, zc + 5);                          // geniş giriş (batı yüzü)
    w.fillBox(x1, y1 + 1, z1 + 3, x1, y2 - 4, zc - 7, PALETTE.GLASS);        // cam cephe
    w.fillBox(x1, y1 + 1, zc + 7, x1, y2 - 4, z2 - 3, PALETTE.GLASS);
    w.fillBox(x1, y1 + 8, zc - 8, x1, y1 + 10, zc + 8, PALETTE.GOLD);        // AVM tabelası
    // Sütunlar (kafes düzeninde), mağaza vitrinleri duvarlar boyunca
    for (let x = x1 + 6; x < x2 - 3; x += 9) for (let z = z1 + 6; z < z2 - 3; z += 9) w.fillBox(x, y1, z, x, y2 - 2, z, PALETTE.IRON);
    for (let z = z1 + 3; z < z2 - 6; z += 8) {
      w.fillBox(x2 - 3, y1 + 1, z, x2 - 3, y1 + 4, z + 5, PALETTE.GLASS);    // arka duvar mağazaları
      w.fillBox(x2 - 3, y1 + 5, z, x2 - 3, y1 + 6, z + 5, [PALETTE.GOLD, PALETTE.BRICK, PALETTE.ROOF][Math.abs(z >> 3) % 3]);
      w.fillBox(x1 + 4, y1, z, x1 + 6, y1 + 1, z + 3, PALETTE.WOOD); // tezgâhlar
    }
    // Kat: merkezde atrium boşluğu kalacak şekilde çevre balkon
    const fy = y1 + MALL_FLOOR;
    w.fillBox(x1 + 2, fy, z1 + 2, x2 - 2, fy, zc - 9, PALETTE.CONCRETE);
    w.fillBox(x1 + 2, fy, zc + 9, x2 - 2, fy, z2 - 2, PALETTE.CONCRETE);
    w.fillBox(x1 + 2, fy + 1, zc - 9, x2 - 2, fy + 1, zc - 9, PALETTE.GLASS); // balkon korkulukları
    w.fillBox(x1 + 2, fy + 1, zc + 9, x2 - 2, fy + 1, zc + 9, PALETTE.GLASS);
    for (let k = 2; y1 + MALL_FLOOR * k < y2 - 2; k++) {   // AVM büyüdü: üst katlar da aynı balkon düzeniyle (atrium boşluğu aynı)
      const fk = y1 + MALL_FLOOR * k;
      w.fillBox(x1 + 2, fk, z1 + 2, x2 - 2, fk, zc - 9, PALETTE.CONCRETE);
      w.fillBox(x1 + 2, fk, zc + 9, x2 - 2, fk, z2 - 2, PALETTE.CONCRETE);
      w.fillBox(x1 + 2, fk + 1, zc - 9, x2 - 2, fk + 1, zc - 9, PALETTE.GLASS);
      w.fillBox(x1 + 2, fk + 1, zc + 9, x2 - 2, fk + 1, zc + 9, PALETTE.GLASS);
    }
    this.addMallLights(x1, y1, z1, x2, y2, z2);
    this.furnishMall(x1, y1, z1, x2, y2, z2);
    // Çatıda geniş cam ışıklık
    w.fillBox(x1 + 8, y2, zc - 6, x2 - 8, y2, zc + 6, PALETTE.GLASS);
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
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
    const hills = [ // [merkez x, merkez z (eski birim), yayılma, yükseklik (m)]: yalnız zengin bölgenin kuzey/güneyi
      [200, 108, 11, 4.5], [210, -108, 11, 4.5], [226, 100, 8, 3.5]
    ];
    const paved = [[78, 178, -170, 170], [106, 145, -170, 170], [78, 228, -9, 9], [174, 228, -74, 74]];
    const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const edgeDist = (x, z) => Math.min(x - 78, 235 - x, 165 - z, z + 165);
    // ── ÜST GEÇİT RAMPALARI: basamaksız, doğrusal eğim ──
    // Batı rampa 78..106 (21 m, köprü ucundan başlar); doğu rampa 145..180 (26 m; sinema/villa x≥182'de başlar). Üst geçit tabliyesi 4.5 m kaydırma + 0.5 zemin = 5.0 m.
    // Uçlarda parabolik yumuşatma (e): rampa zemine ve tabliyeye pürüzsüzce bağlanır, tümsek yapmaz.
    const lin = (t) => { const e = 0.1, sl = 1 / (1 - e); t = Math.max(0, Math.min(1, t)); return t < e ? sl * t * t / (2 * e) : t > 1 - e ? 1 - sl * (1 - t) * (1 - t) / (2 * e) : sl * (t - e / 2); };
    this.world.terrain.rampProfile = (xm) => {
      const x = xm / U;
      if (x >= 78 && x < 106) return 4.5 * lin((x - 78) / 28);
      if (x >= 106 && x <= 145) return 4.5;
      if (x > 145 && x < 180) return 4.5 * (1 - lin((x - 145) / 35));
      return 0;
    };
    this.world.terrain.rampArea = (xm, zm) => { const x = xm / U; return Math.abs(zm / U) <= 6.6 && ((x >= 78 && x < 106) || (x >= 145 && x < 180)); };
    this.world.terrain.heightFn = (xm, zm, mat) => {
      const x = xm / U, z = zm / U;
      if (!mat.isGrass) return 0;
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

  // Kat döşemeleri arasında iç merdiven: zeminden 1. kata, oradan 2. kata (her kat 4.75 m = 19 basamak).
  // Merdiven boşluğu duvar kenarında durur; döşemede üstündeki baş boşluğu açılır.
  addStairs(x1, y1, z1, x2, y2, z2, floorRows = 6) {
    const w = this.b;
    const fr = K * floorRows, sl = fr + 1;      // kat yüksekliği (küçük küp) ve kat başına basamak sayısı
    let n = 0;
    while (n < MAX_FLOORS && y1 + floorRows * (n + 1) < y2 - 2) n++;
    const depthFine = K * (z2 - z1) + 3;
    n = Math.min(n, Math.floor((depthFine - 14) / sl));
    if (n < 1) return;
    const xw0 = K * (x2 - 4) - 1, xw1 = K * (x2 - 2) + 1;
    let zs = K * z1 - 1 + 9;   // duvardan 2.25 m içeride başlar: önünde durup basamağa çıkacak boşluk kalır
    for (let f = 0; f < n; f++) {
      const slab = GROUND_ROW_SUB + fr * (f + 1);                 // üst katın döşeme satırı
      const start = f === 0 ? GROUND_ROW_SUB : GROUND_ROW_SUB + fr * f + 1; // alt katın yürüme satırı
      w.rawClear(xw0, slab, zs, xw1, slab, zs + sl);              // üstteki baş boşluğu
      for (let j = 0; j < sl; j++) w.raw(xw0, start, zs + j, xw1, start + j, zs + j, PALETTE.WOOD);
      zs += sl;
    }
  }

  // Bina içi mobilya (ince ızgara koordinatlarıyla, küçük kutular): mutfak, yatak odası, salon, banyo / otel odası / ofis.
  // xu, zu: eski birim; h: yükseklik (küçük küp = 0.25 m); off: tabandan yükseklik
  furn(base, xu0, zu0, xu1, zu1, h, mat, off = 0) {
    this.b.raw(Math.round(K * xu0) - 1, base + off, Math.round(K * zu0) - 1, Math.round(K * xu1) + 1, base + off + h - 1, Math.round(K * zu1) + 1, mat);
  }

  furnish(x1, y1, z1, x2, y2, z2, kind) {
    const W = x2 - x1, D = z2 - z1;
    if (!kind || W < 9 || D < 9) return;
    const bases = [GROUND_ROW_SUB];
    if (y1 + 6 < y2 - 2) bases.push(GROUND_ROW_SUB + 19);           // 1. kat döşemesinin üstü
    const xa = x1 + 3, xb = x2 - 6, za = z1 + 4, zb = z2 - 2;       // kullanılabilir alan (kapıdan ve merdivenden uzak)
    const F = (b, ...a) => this.furn(b, ...a);
    bases.forEach((b, fi) => {
      if (kind === 'office') {
        for (let z = za + 1; z < zb - 2; z += 5) for (let x = xa; x + 3 <= xb; x += 5) {
          F(b, x, z, x + 2, z + 1, 3, PALETTE.WOOD);                      // masa
          F(b, x + 1, z, x + 1, z, 2, PALETTE.IRON, 3);                   // monitör
          F(b, x + 1, z + 2, x + 1, z + 2, 2, PALETTE.IRON);              // sandalye
        }
        return;
      }
      if (kind === 'school') {      // sınıf: sıralar, öğretmen masası, kara tahta
        for (let z = za + 1; z < zb - 3; z += 4) for (let x = xa; x + 2 <= xb; x += 4) { F(b, x, z, x + 1, z, 3, PALETTE.WOOD); F(b, x, z + 1, x, z + 1, 2, PALETTE.ROOF); }
        F(b, xa, zb, xb, zb, 7, PALETTE.IRON); F(b, xa + 1, zb - 1, xb - 1, zb - 1, 1, PALETTE.WOOD, 0);
        return;
      }
      if (kind === 'police') {      // karakol: masalar, dosya dolapları, demir parmaklıklı nezarethane
        for (let x = xa; x + 3 <= xb; x += 5) { F(b, x, za + 2, x + 2, za + 3, 3, PALETTE.WOOD); F(b, x + 1, za + 2, x + 1, za + 2, 2, PALETTE.IRON, 3); }
        for (let z = zb - 8; z <= zb - 1; z += 2) F(b, xb - 2, z, xb - 2, z, 14, PALETTE.IRON);   // parmaklıklar
        F(b, xb - 2, zb - 8, xb, zb - 8, 14, PALETTE.IRON); F(b, xb - 1, zb - 6, xb - 1, zb - 4, 2, PALETTE.WOOD);
        return;
      }
      // Mutfak: arka duvar boyunca tezgâh, ocak, buzdolabı; ortada yemek masası ve sandalyeler
      if (xb - xa >= 10 && (kind !== 'hotel')) {
        F(b, xa, zb - 1, xa + 6, zb, 4, PALETTE.WOOD);                     // tezgâh
        F(b, xa, zb - 1, xa + 6, zb, 1, PALETTE.WHITE, 4);                 // tezgâh üstü
        F(b, xa + 2, zb - 1, xa + 3, zb, 1, PALETTE.GLASS, 5);             // evye
        F(b, xa + 7, zb - 1, xa + 8, zb, 4, PALETTE.IRON);                 // ocak
        F(b, xa + 7, zb - 1, xa + 8, zb, 1, PALETTE.ROOF, 4);              // ocak gözleri
        F(b, xa + 9, zb - 1, xa + 10, zb, 9, PALETTE.WHITE);               // buzdolabı
        F(b, xa + 1, zb - 6, xa + 4, zb - 4, 3, PALETTE.WOOD);             // yemek masası
        F(b, xa, zb - 5, xa, zb - 5, 2, PALETTE.ROOF); F(b, xa + 5, zb - 5, xa + 5, zb - 5, 2, PALETTE.ROOF); // sandalyeler
      }
      // Yatak odası: yatak, yastık, battaniye, dolap ve komodin
      const bz = za + 1;
      if (kind === 'hotel') {
        for (let k = 0; k < 2; k++) {
          const bx = xa + k * 6;
          F(b, bx, bz, bx + 2, bz + 3, 2, PALETTE.WOOD);
          F(b, bx, bz, bx + 2, bz, 1, PALETTE.WHITE, 2);
          F(b, bx, bz + 1, bx + 2, bz + 3, 1, k ? PALETTE.GOLD : PALETTE.BRICK, 2);
          F(b, bx + 3, bz, bx + 3, bz, 2, PALETTE.WOOD);
        }
        F(b, xa, zb - 1, xa + 3, zb, 8, PALETTE.ROOF);                     // dolap
        F(b, xa + 5, zb, xa + 8, zb, 3, PALETTE.IRON); F(b, xa + 5, zb, xa + 8, zb, 1, PALETTE.GLASS, 3); // TV
        return;
      }
      F(b, xa, bz, xa + 2, bz + 3, 2, PALETTE.WOOD);                      // yatak
      F(b, xa, bz, xa + 2, bz, 1, PALETTE.WHITE, 2);                       // yastık
      F(b, xa, bz + 1, xa + 2, bz + 3, 1, PALETTE.BRICK, 2);               // battaniye
      F(b, xa + 3, bz, xa + 3, bz, 2, PALETTE.WOOD);                       // komodin
      F(b, xa + 5, bz, xa + 6, bz + 1, 8, PALETTE.ROOF);                   // gardırop
      // Salon: koltuk takımı, sehpa, televizyon
      const lz = Math.round((za + zb) / 2) - 1;
      if (xb - xa >= 8) {
        F(b, xa, lz, xa + 3, lz + 1, 2, PALETTE.BRICK);                    // kanepe
        F(b, xa, lz + 1, xa + 3, lz + 1, 3, PALETTE.BRICK);                // sırtlık
        F(b, xa + 1, lz - 3, xa + 2, lz - 2, 2, PALETTE.WOOD);             // sehpa
        F(b, xa, lz - 7, xa + 3, lz - 7, 2, PALETTE.IRON);                 // TV sehpası
        F(b, xa + 1, lz - 7, xa + 2, lz - 7, 2, PALETTE.GLASS, 2);         // ekran
      }
      // Banyo: küvet ve klozet
      if (xb - xa >= 10 && fi === 0) {
        F(b, xb - 4, za, xb, za + 1, 2, PALETTE.WHITE);
        F(b, xb - 1, za + 4, xb - 1, za + 4, 3, PALETTE.WHITE);
      }
    });
  }

  // ── AVM İÇİ: mağaza sıraları (iki kat), orta koridor, yemek alanı, ağaçlı atrium ve iki yürüyen merdiven ──
  furnishMall(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    const xc = Math.round((x1 + x2) / 2), zc = Math.round((z1 + z2) / 2);
    const palette = [PALETTE.BRICK, PALETTE.GOLD, PALETTE.GLASS, PALETTE.ROOF, PALETTE.WHITE];
    // Mağazalar: orta koridorun iki yanında; kuzey ve güney yarılarda, alt ve üst katta
    const floors = [{ y: y1, base: GROUND_ROW_SUB }, { y: y1 + MALL_FLOOR + 1, base: GROUND_ROW_SUB + K * MALL_FLOOR + 1 }];
    const halves = [[z1 + 3, zc - 10], [zc + 10, z2 - 3]];
    let n = 0;
    floors.forEach(F => halves.forEach(([za, zb]) => {
      for (let zs = za; zs + 8 <= zb + 1; zs += 9) {
        [['w', x1 + 3, xc - 4, xc - 4], ['e', xc + 4, x2 - 3, xc + 4]].forEach(([side, xa, xb, xf]) => {
          const kind = (n++) % 4, col = palette[n % palette.length];
          const y = F.y, ze = zs + 8;
          // Mağaza bölme duvarları ve arka duvar (ince, beyaz)
          w.fillBox(xa, y, zs, xb, y + 4, zs, PALETTE.WHITE);
          w.fillBox(xa, y, ze, xb, y + 4, ze, PALETTE.WHITE);
          w.fillBox(side === 'w' ? xa : xb, y, zs, side === 'w' ? xa : xb, y + 4, ze, PALETTE.WHITE);
          // Koridora bakan cam vitrin + kapı boşluğu + renkli tabela
          w.fillBox(xf, y, zs, xf, y + 3, ze, PALETTE.GLASS);
          w.clearBox(xf, y, zs + 3, xf, y + 3, zs + 5);
          w.fillBox(xf, y + 4, zs, xf, y + 4, ze, col);
          const bx = side === 'w' ? xa + 1 : xb - 1, ix = side === 'w' ? 1 : -1;
          if (kind === 0) {            // giyim: askılıklar ve tezgâh
            for (let z = zs + 2; z < ze - 1; z += 2) { this.furn(F.base, bx, z, bx + ix * 3, z, 8, PALETTE.IRON); this.furn(F.base, bx, z, bx + ix * 3, z, 1, palette[((z % 4) + 4) % 4], 8); }
            this.furn(F.base, bx + ix * 5, zs + 1, bx + ix * 6, zs + 2, 4, PALETTE.WOOD);
          } else if (kind === 1) {     // elektronik: raflar ve ekranlar
            for (let z = zs + 2; z < ze - 1; z += 3) { this.furn(F.base, bx, z, bx + ix * 2, z, 6, PALETTE.IRON); this.furn(F.base, bx, z, bx + ix, z, 2, PALETTE.GLASS, 6); }
          } else if (kind === 2) {     // restoran: masalar, sandalyeler, tezgâh
            for (let z = zs + 2; z < ze - 1; z += 3) { this.furn(F.base, bx + ix * 2, z, bx + ix * 3, z + 1, 3, PALETTE.WOOD); this.furn(F.base, bx + ix * 4, z, bx + ix * 4, z, 2, PALETTE.ROOF); }
            this.furn(F.base, bx, zs + 1, bx, ze - 1, 4, PALETTE.WOOD);
          } else {                     // oyuncak: renkli kutular
            for (let z = zs + 2; z < ze - 1; z += 2) for (let x = 0; x < 3; x++) this.furn(F.base, bx + ix * x * 2, z, bx + ix * x * 2, z, 2 + Math.abs(x + z) % 3, palette[Math.abs(x + z) % 5]);
          }
        });
      }
    }));

    // Atrium: yemek alanı (masalar + sandalyeler), ağaçlı saksılar
    for (let z = zc - 6; z <= zc + 6; z += 4) for (let x = x1 + 6; x <= x2 - 8; x += 6) {
      this.furn(GROUND_ROW_SUB, x, z, x + 1, z + 1, 3, PALETTE.WOOD);
      this.furn(GROUND_ROW_SUB, x - 1, z, x - 1, z, 2, PALETTE.ROOF); this.furn(GROUND_ROW_SUB, x + 2, z, x + 2, z, 2, PALETTE.ROOF);
    }
    [[xc, zc - 8], [xc, zc + 8]].forEach(([x, z]) => { w.fillBox(x - 1, y1, z - 1, x + 1, y1, z + 1, PALETTE.WOOD); this.tree(x, z, 7); });

    // İki yürüyen merdiven (cam korkuluklu): atriumdan balkona çıkar. Kuzey yarıya -z, güney yarıya +z yönünde.
    const up = (zStart, dir, xl, xr) => {
      for (let j = 0; j < 19; j++) {
        const z = Math.round(K * zStart) + dir * j;
        w.raw(Math.round(K * xl) - 1, GROUND_ROW_SUB, z, Math.round(K * xr) + 1, GROUND_ROW_SUB + j, z, PALETTE.IRON);
      }
      [xl - 0.4, xr + 0.4].forEach(x => w.raw(Math.round(K * x), GROUND_ROW_SUB + 1, Math.round(K * zStart), Math.round(K * x), GROUND_ROW_SUB + 20, Math.round(K * zStart) + dir * 18, PALETTE.GLASS));
    };
    up(zc + 2, 1, xc - 7, xc - 5);
    up(zc - 2, -1, xc + 5, xc + 7);
    // Atrium çevresindeki balkon boşlukları yürüyen merdivenin üstüne denk gelen kısımlarda açık kalır
  }

  // ── HASTANE İÇİ: bekleme salonu, eczane, ameliyathane, ambulans ──
  furnishHospital(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    const zc = Math.round((z1 + z2) / 2), B = GROUND_ROW_SUB;
    // Bekleme koltukları (girişin iki yanında sıralar)
    for (let r = 0; r < 3; r++) for (const sg of [-1, 1]) {
      this.furn(B, x1 + 7 + r * 3, zc + sg * 9, x1 + 7 + r * 3, zc + sg * 15, 2, PALETTE.BRICK);
      this.furn(B, x1 + 8 + r * 3, zc + sg * 9, x1 + 8 + r * 3, zc + sg * 15, 4, PALETTE.BRICK);
    }
    // Eczane tezgâhı ve ilaç rafları
    this.furn(B, x2 - 12, zc - 6, x2 - 12, zc + 6, 4, PALETTE.WOOD);
    for (let z = zc - 5; z <= zc + 5; z += 2) this.furn(B, x2 - 4, z, x2 - 4, z, 8, PALETTE.GLASS);
    // Ameliyathane (kuzeydoğu köşe): ameliyat masası, lamba, aletler
    const ox = x2 - 10, oz = z1 + 6;
    this.furn(B, ox, oz, ox + 2, oz + 4, 3, PALETTE.WHITE);
    this.furn(B, ox + 1, oz + 1, ox + 1, oz + 2, 1, PALETTE.GLASS, 14);
    this.furn(B, ox + 1, oz + 2, ox + 1, oz + 2, 14, PALETTE.IRON);
    this.furn(B, ox + 4, oz, ox + 4, oz + 2, 4, PALETTE.IRON);
    // Hasta odalarına perde ve serum askısı
    for (let z = z1 + 5; z < z2 - 3; z += 8) {
      this.furn(B, x1 + 17, z + 1, x1 + 17, z + 5, 7, PALETTE.GLASS);
      this.furn(B, x1 + 13, z + 2, x1 + 13, z + 2, 9, PALETTE.IRON);
    }
    // Ambulans: giriş sundurmasının altında (beyaz gövde, kırmızı şerit ve artı)
    const ax = x1 - 3, az = zc + 8;
    w.raw(Math.round(K * ax) - 3, B, Math.round(K * az) - 5, Math.round(K * ax) + 3, B + 5, Math.round(K * az) + 5, PALETTE.WHITE);
    w.rawReplace(Math.round(K * ax) - 3, B + 2, Math.round(K * az) - 5, Math.round(K * ax) + 3, B + 2, Math.round(K * az) + 5, PALETTE.BRICK);
    w.raw(Math.round(K * ax) - 2, B + 6, Math.round(K * az) - 2, Math.round(K * ax) + 2, B + 6, Math.round(K * az) + 2, PALETTE.GLASS);
  }

  // ── İTFAİYE İÇİ: soyunma dolapları, ranza yatakları, mutfak masası ──
  furnishFire(x1, y1, z1, x2, y2, z2) {
    const B = GROUND_ROW_SUB;
    for (let x = x1 + 3; x < x2 - 8; x += 2) this.furn(B, x, z2 - 1, x, z2 - 1, 8, PALETTE.IRON);     // dolaplar
    for (let k = 0; k < 3; k++) { const bx = x1 + 3 + k * 6; this.furn(B, bx, z2 - 8, bx + 2, z2 - 5, 2, PALETTE.WOOD); this.furn(B, bx, z2 - 8, bx + 2, z2 - 5, 1, PALETTE.BRICK, 5); this.furn(B, bx, z2 - 8, bx + 2, z2 - 5, 2, PALETTE.WOOD, 8); }
    this.furn(B, x2 - 14, z1 + 6, x2 - 10, z1 + 8, 3, PALETTE.WOOD);                                   // yemek masası
  }

  // Her 6 satırda (4.5 m) bir kat döşemesi
  addFloors(x1, y1, z1, x2, y2, z2, mat, fromFloor = 1) {
    const w = this.b;
    // En çok 3 kat döşemesi: üst katlara çıkılmadığı için küp sayısı makul tutulur
    for (let k = fromFloor; k <= MAX_FLOORS && y1 + 6 * k < y2 - 2; k++) {
      w.fillBox(x1 + 1, y1 + 6 * k, z1 + 1, x2 - 1, y1 + 6 * k, z2 - 1, mat);
    }
    this.addCeilingLights(x1, y1, z1, x2, y2, z2, fromFloor);
  }

  // Bina içi aydınlatma: her katın tavanına (üst kat döşemesinin hemen altına) 0.75 m'lik parlayan LAMBA plakaları.
  // Tavan lambaları 7 birim (5.25 m) aralıkla, duvar ve merdiven boşluğundan uzak dizilir.
  addCeilingLights(x1, y1, z1, x2, y2, z2, fromFloor = 1) {
    const w = this.b;
    const put = (x, z, yc) => { const sx = Math.round(K * x), sz = Math.round(K * z); w.raw(sx - 1, yc, sz - 1, sx + 1, yc, sz + 1, PALETTE.LAMP); };
    const levels = [];
    for (let k = fromFloor; k <= MAX_FLOORS && y1 + 6 * k < y2 - 2; k++) levels.push(w._y0(y1 + 6 * k) - 1);   // üst kat döşemesinin altı
    levels.push(w._y1(y2) - 1);                                                                                  // çatının altı
    for (const yc of levels) for (let x = x1 + 4; x <= x2 - 4; x += 7) for (let z = z1 + 4; z <= z2 - 4; z += 7) put(x, z, yc);
  }

  // AVM aydınlatması: her kat ve çatı; atrium boşluğunun üstüne balkon lambası konmaz
  addMallLights(x1, y1, z1, x2, y2, z2) {
    const w = this.b, zc = Math.round((z1 + z2) / 2);
    const put = (x, z, yc) => { const sx = Math.round(K * x), sz = Math.round(K * z); w.raw(sx - 1, yc, sz - 1, sx + 1, yc, sz + 1, PALETTE.LAMP); };
    for (let k = 1; y1 + MALL_FLOOR * k < y2 - 2; k++) {
      const r = y1 + MALL_FLOOR * k;
      const yc = w._y0(r) - 1;
      for (let x = x1 + 4; x <= x2 - 4; x += 6) for (let z = z1 + 4; z <= z2 - 4; z += 6) if (Math.abs(z - zc) >= 10) put(x, z, yc);
    }
    const yr = w._y1(y2) - 1;           // çatı: camlı ışıklığın (atrium üstü) altı hariç her yer
    for (let x = x1 + 4; x <= x2 - 4; x += 6) for (let z = z1 + 4; z <= z2 - 4; z += 6) {
      if (Math.abs(z - zc) < 8 && x >= x1 + 7 && x <= x2 - 7) continue;
      put(x, z, yr);
    }
  }

  // Yüzeye sığan yatay şerit pencereler: her katta
  addWindowBands(x1, y1, z1, x2, y2, z2, doorSide) {
    const w = this.b;
    for (let k = 0; y1 + 6 * k + 3 < y2 - 1; k++) {
      const r0 = y1 + 6 * k + 2;
      for (let x = x1 + 2; x + 1 <= x2 - 2; x += 4) {
        if (!(k === 0 && doorSide === 'z1' && Math.abs(x - Math.round((x1 + x2) / 2)) <= 2)) {
          w.fillBox(x, r0, z1, x + 1, r0 + 1, z1, PALETTE.GLASS, true);
        }
        if (!(k === 0 && doorSide === 'z2' && Math.abs(x - Math.round((x1 + x2) / 2)) <= 2)) {
          w.fillBox(x, r0, z2, x + 1, r0 + 1, z2, PALETTE.GLASS, true);
        }
      }
      for (let z = z1 + 2; z + 1 <= z2 - 2; z += 4) {
        if (!(k === 0 && doorSide === 'x1' && Math.abs(z - Math.round((z1 + z2) / 2)) <= 2)) {
          w.fillBox(x1, r0, z, x1, r0 + 1, z + 1, PALETTE.GLASS, true);
        }
        if (!(k === 0 && doorSide === 'x2' && Math.abs(z - Math.round((z1 + z2) / 2)) <= 2)) {
          w.fillBox(x2, r0, z, x2, r0 + 1, z + 1, PALETTE.GLASS, true);
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
    if (o.sign) { // kapı üstü tabela
      if (side === 'z1') w.fillBox(cx - 3, y1 + 6, z1, cx + 3, y1 + 7, z1, PALETTE.GOLD);
      if (side === 'z2') w.fillBox(cx - 3, y1 + 6, z2, cx + 3, y1 + 7, z2, PALETTE.GOLD);
    }

    this.addStairs(x1, y1, z1, x2, y2, z2);
    this.furnish(x1, y1, z1, x2, y2, z2, o.interior || (y2 - y1 >= 20 ? 'apt' : (y2 - y1 >= 12 ? 'office' : null)));
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
    // (sabit tahta kapı kanadı kaldırıldı: giriş artık gerçek, açılıp kapanan kapıdır)

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'z1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);

    // Zemin kat: resepsiyon bankosu ve güvenlik kasası (demir)
    w.fillBox(x1 + 3, y1, z1 + 4, x1 + 7, y1 + 1, z1 + 5, PALETTE.WOOD);
    w.fillBox(x1 + 2, y1, z1 + 2, x1 + 3, y1 + 2, z1 + 3, PALETTE.IRON);

    // İç merdiven: zeminden 1. kata ve oradan 2. kata
    this.addStairs(x1, y1, z1, x2, y2, z2);
    this.furnish(x1, y1, z1, x2, y2, z2, 'apt');

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

    this.addStairs(x1, y1, z1, x2, y2, z2);
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
