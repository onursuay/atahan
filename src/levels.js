import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { ROADS, ROUNDABOUT, ROUNDABOUTS, paintSegments, onRoadFast, roadRects } from './cityplan.js';
import { buildVilla, paintVillaRoad, villaHeight, villaRoadProfile } from './villa.js';
import { Bridge } from './bridge.js';
import { buildTraffic } from './traffic.js';
import { furnishMall as furnishMallShops } from './mall.js';
import { buildSpecialty, isSpecialLot } from './specialty.js';
import { buildCentralPark } from './park.js';

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
    this.world.residents = [];
    this.world.parkedCars = [];
    this.world.propSpawns = [];  // tutulabilir eşyalar: { kind, x, y, z, yaw, color, hung } (main.js props.js'e aktarır)
    this.world.workers = []; this.world.bosses = []; this.world.guards = []; this.world.dogs = [];
    this.world.lamps = [];       // sokak lambası kafaları (gece ışık havuzları ve gerçek ışık için): { x, y, z, gy }
    const ISL = 166; // zengin bölgenin x kayması (eski birim): doğu yolu (x=186) için 12 birim doğuya alındı

    // ==========================================
    // 1. ZEMİN, SAHİL, YOLLAR (kaplama yüzeyi) — yollar cityplan.js'ten gelir
    // ==========================================
    w.fillBox(78, 0, -165, 247, 0, 165, PALETTE.GRASS);         // doğu ada çimi (zengin bölgenin kuzeyi/güneyi)
    w.fillBox(248, 0, -260, 500, 0, 260, PALETTE.GRASS);        // zengin meydanının doğusu: villa tepesi
    this._setHills();
    w.fillBox(-184, 0, -285, -12, 0, 285, PALETTE.CONCRETE);    // batı ada: kuzey/güney 120, batıya 30 birim genişledi
    w.fillBox(-192, 0, -285, -185, 0, 285, PALETTE.SAND);       // batı kumsalı
    w.fillBox(-185, 0, -283, -183, 0, 283, PALETTE.WOOD);       // gezinti yolu
    w.fillBox(-200, 0, -18, -192, 0, -14, PALETTE.WOOD);        // iskeleler
    w.fillBox(-200, 0, 14, -192, 0, 18, PALETTE.WOOD);
    w.fillBox(78, 0, -165, 110, 0, 165, PALETTE.CONCRETE);      // doğu ada: şehir blokları (köprüden sonra)
    w.fillBox(141, 0, -165, 190, 0, 165, PALETTE.CONCRETE);
    w.fillBox(190, 0, -70, 248, 0, 70, PALETTE.CONCRETE);       // zengin bölge meydanı (yayalar; araç yolu yok)

    // Dış çevre arazileri aşağıda bağımsız 3D çevre modelleri olarak eklenir (terrain dokusunu kilitlemez)

    // Yollar: asfalt cityplan.js tanımından boyanır (trafik ağı da aynı tanımdan kurulur)
    for (const r of ROADS) for (const sg of paintSegments(r)) w.fillBox(sg.x0, 0, sg.z0, sg.x1, 0, sg.z1, PALETTE.ASPHALT);
    ROUNDABOUTS.forEach(g => this.buildRoundaboutGround(g));
    paintVillaRoad(this.world.terrain, PALETTE.ASPHALT);        // tepeye çıkan kavisli yol + ön avlu

    // Otoyol orta bariyeri (kavşaklarda boşluk) ve çift kollu aydınlatma (otoyol z=±134 caddelerinde biter)
    [[-126, -96], [-80, -52], [-36, -8], [8, 36], [52, 80], [96, 126]].forEach(([a, b]) => w.fillBox(125, 1, a, 125, 2, b, PALETTE.CONCRETE));
    for (let z = -130; z <= 130; z += 15) if ([0, 44, -44, 88, -88, 134, -134].every(g => Math.abs(z - g) > 10)) this.lamp(125, z, 1, 0, true, true);

    // ==========================================
    // 2. ASMA KÖPRÜ (iki adayı bağlar)
    // ==========================================
    this.buildSuspensionBridge();

    // ==========================================
    // 3. BATI ADA: ŞEHİR (eski merkez + batıya genişleme)
    // ==========================================
    const CC = { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD }, BR = { wall: PALETTE.BRICK, floor: PALETTE.WOOD };
    buildSpecialty(this);                                        // bankalar, fast-food restoranlar, silindir şirket kuleleri (çalışanlar + patron)
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
    this.buildHome(-150, 1, 8, -134, 6, 40);                       // oyuncunun evi: koltukta oturup televizyon izlediği başlangıç noktası
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

    this.buildTower(-70, 1, 76, -54, 20, 124, { ...BR, side: 'x2', interior: 'hotel' });        // eski küçük parkın yerine otel (park artık villanın yanındaki büyük Merkez Park)
    this.buildNewDistricts();
    ROUNDABOUTS.forEach(g => this.buildRoundaboutCenter(g));
    buildTraffic(this);                                          // trafik ışıkları ve yol tabelaları: yolun kenarında
    buildVilla(this.world);                                      // doğudaki tepede çok zengin bir adamın villası
    buildCentralPark(this);                                      // villanın güneyindeki kocaman alanda Merkez Park
    this.buildSite(-81, -124, -53, -74);

    // ==========================================
    // 4. DOĞU ADA: ŞEHİR BLOKLARI (köprüden sonra) — hastane, itfaiye, polis, okul, AVM, apartmanlar
    // ==========================================
    this.buildHospital(148, 1, 50, 180, 14, 118);                                   // çok büyük beyaz hastane (kırmızı artılı)
    this.buildMall(143, 1, -127, 180, 34, -50);                                     // devasa AVM (38x78, 4 kat, kat yüksekliği 6 m)
    this.buildFireStation(90, 1, 52, 108, 14, 82);                                  // itfaiye istasyonu
    this.buildTower(90, 1, 96, 106, 12, 120, { ...CC, side: 'z1', sign: true, interior: 'police' });     // polis merkezi
    this.buildTower(90, 1, 8, 108, 12, 38, { ...BR, side: 'z1', interior: 'school' });                   // okul
    this.buildTower(90, 1, -38, 108, 26, -8, { ...CC, side: 'z2' });                 // iş merkezi
    this.buildTower(90, 1, -82, 108, 20, -50, { ...BR, side: 'z1', interior: 'hotel' });  // otel
    this.buildTower(90, 1, -122, 106, 24, -96, { ...CC, side: 'z2' });               // apartmanlar
    this.buildTower(144, 1, 8, 176, 28, 38, { ...CC, side: 'z1' });                  // apartman bloğu
    this.buildTower(144, 1, -38, 176, 22, -8, { ...BR, side: 'z2' });                // ofis kulesi
    this.buildTower(194, 1, 78, 214, 14, 100, { ...BR, side: 'x1' });
    this.buildTower(218, 1, 78, 236, 16, 104, { ...CC, side: 'x1' });
    [[142, 164, 'z1'], [-164, -142, 'z2']].forEach(([za, zb, door]) => {
      this.buildTower(90, 1, za, 108, 14, zb, { ...BR, side: door });
      this.buildTower(144, 1, za, 176, 16, zb, { ...CC, side: door });
    });
    this.buildOverpass();
    this.buildTower(194, 1, -104, 214, 14, -78, { ...CC, side: 'x1' });
    this.buildTower(218, 1, -108, 236, 18, -80, { ...BR, side: 'x1' });

    // ==========================================
    // 5. SOKAK DONATIMI: lambalar, çöp kutuları, ağaçlar
    // ==========================================
    // Donatı (lamba, çöp kutusu, ağaç) yolun üstüne konmaz: lamp/trashBin/tree yol dikdörtgenlerini kendileri denetler
    for (const zc of [0, 66, -66, 134, -134, 200, -200, 266, -266]) {
      for (let x = -166; x <= -30; x += 14) {
        this.lamp(x, zc + 6.5, 0, -1); this.trashBin(x + 3, zc + 7);
        this.lamp(x + 7, zc - 6.5, 0, 1); this.trashBin(x + 10, zc - 7);
      }
      for (let x = -164; x <= -32; x += 26) { this.tree(x, zc + 6.5, 6); this.tree(x + 13, zc - 6.5, 6); }
    }
    for (let x = 90; x <= 172; x += 16) [44, -44, 88, -88, 134, -134].forEach(zz => { if (Math.abs(x - 125) > 20 && !(Math.abs(zz) === 88 && x > 106)) { this.lamp(x, zz + 6.5, 0, -1); this.lamp(x + 8, zz - 6.5, 0, 1); } });

    // ==========================================
    // 5. ZENGİN BÖLGE (doğu adanın doğusu)
    // ==========================================
    this.buildGrandCinema(28 + ISL, 1, -28, 42 + ISL, 18, -4);
    this.buildLuxuryVilla(28 + ISL, 1, 6, 42 + ISL, 18, 26);
    this.buildLuxuryMansion(48 + ISL, 1, -14, 64 + ISL, 18, 14);
    this.buildLuxuryBoutique(48 + ISL, 1, 16, 62 + ISL, 14, 28);
    this.buildTower(48 + ISL, 1, -30, 57 + ISL, 14, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(62 + ISL, 1, -30, 69 + ISL, 26, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });   // komşu kuleyle 5 birim boşluk (kapıdan girilsin)
    for (let z = -60; z <= 60; z += 20) { this.tree(239, z, 7); this.lamp(207, z + 4, 0, 0); }
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
    // Ana kablolar: kırmızı küpler (yıkılabilir; basamaklı, pürüzlü eğri)
    for (let x = X0; x <= X1; x++) {
      const y = Math.round(yAt(x));
      for (const sz of [-ZL, ZL]) w.raw(x, y, sz - 1, x, y + 1, sz, PALETTE.BRICK);
    }
    // Tabliyeyi tutan dikey ipler: ince silindir, vurulunca gerçek ip gibi kopar; köprü sallanır, desteksiz tabliye suya düşer (src/bridge.js)
    this.world.bridge = new Bridge(this.world, { X0, X1, T1, T2, ZD, ZL, DECK_TOP, yAt });
    for (let x = X0 + 24; x < X1 - 20; x += 30) { this.lampSub(x, ZD - 2, DECK_TOP + 1, 0, -1); this.lampSub(x + 15, -ZD + 2, DECK_TOP + 1, 0, 1); }
  }

  // ── GÖBEK (yuvarlak kavşak): halka asfaltı + orta ada zemini ──
  buildRoundaboutGround(g) {
    const w = this.b;
    const rows = (r, mat) => { for (let dz = -r; dz <= r; dz++) { const half = Math.floor(Math.sqrt(r * r - dz * dz)); w.fillBox(g.cx - half, 0, g.cz + dz, g.cx + half, 0, g.cz + dz, mat); } };
    rows(g.rOuter, PALETTE.ASPHALT);                 // halka yolu (dış yarıçap 22)
    rows(g.rIsland + 1, PALETTE.CONCRETE);           // ada bordürü
    rows(g.rIsland, PALETTE.GRASS);                  // ortadaki ada: çim
  }

  // Göbeğin ortası: çeşme, anıt, ağaçlar; halkanın dışında lambalar
  buildRoundaboutCenter(g) {
    const w = this.b;
    this.fountain(g.cx, g.cz);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      this.tree(Math.round(g.cx + 9 * Math.cos(a)), Math.round(g.cz + 9 * Math.sin(a)), 7 + (i % 3));
    }
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 + Math.PI / 12;
      this.lamp(Math.round(g.cx + (g.rOuter + 1.5) * Math.cos(a)), Math.round(g.cz + (g.rOuter + 1.5) * Math.sin(a)), 0, 0);
    }
    // Anıt: basamaklı kaide + beyaz dikmetaş + altın tepe
    const cx = Math.round(K * g.cx), cz = Math.round(K * g.cz), B = GROUND_ROW_SUB + 12;
    w.raw(cx - 3, B, cz - 3, cx + 3, B + 1, cz + 3, PALETTE.CONCRETE);
    w.raw(cx - 2, B + 2, cz - 2, cx + 2, B + 3, cz + 2, PALETTE.CONCRETE);
    w.raw(cx - 1, B + 4, cz - 1, cx + 1, B + 30, cz + 1, PALETTE.WHITE);
    w.raw(cx, B + 31, cz, cx, B + 34, cz, PALETTE.GOLD);
    w.raw(cx - 1, B + 24, cz - 1, cx + 1, B + 25, cz + 1, PALETTE.LAMP);
  }

  // ── ŞEHİR GENİŞLEMESİ: kuzey ve güney mahalleleri ──
  // Sütunlar (x) ve bantlar (z) caddelerin arasında kalan bloklardır; her blokta tek parça bina, yoldan 4 birim içeride.
  // Göbeğin yakınına bina konmaz (halkanın 28 birim çevresi meydan olarak boş kalır).
  buildNewDistricts() {
    let seed = 20241014;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const CC = { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD }, BR = { wall: PALETTE.BRICK, floor: PALETTE.WOOD };
    const cols = [[-161, -137], [-119, -97], [-79, -57], [-41, -33], [-21, -15]];
    const lots = [[168, 191], [209, 231], [235, 257]];                 // z bantları (kuzey için işaret çevrilir)
    const existing = [[142, 164, [0, 1, 3, 4]]];                       // z 142..164'te A, B, D, E sütunları zaten dolu; yalnız C boş
    const near = (x1, x2, z1, z2) => ROUNDABOUTS.some(g => { const dx = Math.max(x1 - g.cx, 0, g.cx - x2), dz = Math.max(Math.min(z1, z2) - g.cz, 0, g.cz - Math.max(z1, z2)); return Math.hypot(dx, dz) < g.rOuter + 8; });
    const place = (ci, za, zb, sign) => {
      const [x1, x2] = cols[ci];
      const zlo = sign > 0 ? za : -zb, zhi = sign > 0 ? zb : -za;
      if (near(x1, x2, zlo, zhi) || isSpecialLot(x1, x2, zlo, zhi)) return;
      const h = 12 + Math.floor(rnd() * 20);
      const style = rnd() < 0.5 ? CC : BR;
      this.buildTower(x1, 1, zlo, x2, h, zhi, { ...style, side: sign > 0 ? 'z1' : 'z2' });
    };
    for (const sign of [1, -1]) {
      place(2, 142, 164, sign);                                        // C sütunu, mevcut sıranın boşluğu
      for (const [za, zb] of lots) for (let ci = 0; ci < cols.length; ci++) place(ci, za, zb, sign);
    }
  }

  // ── Sokak donatımı ──
  // Kapı önü (2.5 m): lamba, çöp kutusu, ağaç konmaz; kapıdan girilebilsin
  _nearDoor(x, z, r = 2.5) {
    const mx = x * 0.75, mz = z * 0.75;
    return this.world.doors.doors.some(d => { const cx = (d.kind === 'hinged' ? d.hx : d.sx) + d.ax * d.width / 2, cz = (d.kind === 'hinged' ? d.hz : d.sz) + d.az * d.width / 2; return Math.hypot(cx - mx, cz - mz) < r + d.width / 2; });
  }

  lamp(x, z, dx = 0, dz = 0, both = false, onRoadOk = false) {
    if (this.b.blocked(x, z, 0) || (!onRoadOk && onRoadFast(x, z, 0)) || this._nearDoor(x, z)) return;   // lamba bina içine ya da yolun üstüne konmaz
    this.lampSub(Math.round(K * x), Math.round(K * z), GROUND_ROW_SUB, dx, dz, both);
  }

  // Detaylı sokak lambası: kaide, süslü pervaz, direk, halka, yola uzanan kol, lamba muhafazası ve ışık camı
  lampSub(sx, sz, base, dx = 0, dz = 0, both = false) {
    const w = this.b;
    const F = 0.25, head = (hx, hz, hy) => this.world.lamps.push({ x: hx * F, y: hy * F, z: hz * F, gy: base * F });
    if (dx !== 0 || dz !== 0) { head(sx + dx * 7, sz + dz * 7, base + 19); if (both) head(sx - dx * 7, sz - dz * 7, base + 19); } else head(sx, sz, base + 22);
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
    if (this.b.blocked(x, z, 0) || onRoadFast(x, z, 0) || this._nearDoor(x, z)) return;   // çöp kutusu yolun üstüne konmaz
    const w = this.b, sx = Math.round(K * x), sz = Math.round(K * z);
    w.raw(sx, GROUND_ROW_SUB, sz, sx + 1, GROUND_ROW_SUB + 3, sz + 1, PALETTE.IRON);
    w.raw(sx, GROUND_ROW_SUB + 4, sz, sx + 1, GROUND_ROW_SUB + 4, sz + 1, PALETTE.WOOD);
  }

  tree(x, z, h) {
    if (this.b.blocked(x, z, 1) || onRoadFast(x, z, 2) || this._nearDoor(x, z, 3)) return;   // ağaç taçı yola taşmasın (2 birim pay)
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
    const gx = cx + 3, gz = z2 - 10;
    [[0, 0], [5, 0], [0, 5], [5, 5]].forEach(([a, b]) => w.fillBox(gx + a, 1, gz + b, gx + a, 5, gz + b, PALETTE.WOOD));
    w.fillBox(gx - 1, 6, gz - 1, gx + 6, 6, gz + 6, PALETTE.ROOF);
    w.fillBox(gx + 1, 1, gz + 2, gx + 4, 1, gz + 2, PALETTE.WOOD);

    // Çocuk parkı (güneybatı)
    const sx = x1 + 2, sz = z2 - 12;
    w.fillBox(sx, 1, sz, sx + 6, 1, sz + 6, PALETTE.SAND);
    const fx = sx + 8;
    w.fillBox(fx, 1, sz, fx, 5, sz, PALETTE.IRON); w.fillBox(fx + 6, 1, sz, fx + 6, 5, sz, PALETTE.IRON);
    w.fillBox(fx, 5, sz, fx + 6, 5, sz, PALETTE.IRON);
    w.fillBox(fx + 2, 2, sz, fx + 2, 4, sz, PALETTE.IRON); w.fillBox(fx + 4, 2, sz, fx + 4, 4, sz, PALETTE.IRON);
    w.fillBox(fx + 2, 2, sz, fx + 4, 2, sz, PALETTE.WOOD);
    const kx = fx + 8;   // kaydırak parkın içinde kalır (sokağa taşmaz)
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
    const cx = Math.round((x1 + x2) / 2);              // iç yol (asfaltı cityplan'da): iki kapı da açık, yol iki caddeyi birleştirir
    const fy0 = 1, fy1 = 3;
    w.fillBox(x1, fy0, z1, cx - 5, fy1, z1, PALETTE.IRON); w.fillBox(cx + 5, fy0, z1, x2, fy1, z1, PALETTE.IRON);   // kuzey çit (kapı açık)
    w.fillBox(x1, fy0, z1, x1, fy1, z2, PALETTE.IRON);
    w.fillBox(x2, fy0, z1, x2, fy1, z2, PALETTE.IRON);
    w.fillBox(x1, fy0, z2, cx - 5, fy1, z2, PALETTE.IRON);
    w.fillBox(cx + 5, fy0, z2, x2, fy1, z2, PALETTE.IRON);
    this.buildTower(cx + 5, 1, z2 - 8, cx + 9, 8, z2 - 3, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1' });   // güvenlik kulübesi
    [[z1 + 4, z1 + 18], [z1 + 22, z1 + 36]].forEach(([a, b]) => {
      this.buildTower(x1 + 2, 1, a, cx - 5, 10, b, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x2', interior: 'apt' });
      this.buildTower(cx + 5, 1, a, x2 - 2, 10, b, { wall: PALETTE.BRICK, floor: PALETTE.WOOD, side: 'x1', interior: 'apt' });
    });
    for (let z = z1 + 6; z < z2 - 4; z += 14) { this.lamp(cx - 4, z, 1, 0); this.lamp(cx + 4, z + 7, -1, 0); }
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
    const bays = [];
    for (let b = x1 + 3; b + 5 <= x2 - 1; b += 9) bays.push(b);   // genişliğe göre garaj kapısı sayısı (18 birimde 2, 28 birimde 3)
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
    for (let x = x1 + 6; x < x2 - 3; x += 9) for (let z = z1 + 6; z < z2 - 3; z += 9) {
      if (Math.abs(x - Math.round((x1 + x2) / 2)) <= 10 && Math.abs(z - zc) <= 9) continue;      // orta meydan ve merdiven şeritlerinde sütun yok
      w.fillBox(x, y1, z, x, y2 - 2, z, PALETTE.IRON);
    }
    for (let z = z1 + 3; z < z2 - 6; z += 8) {
      w.fillBox(x2 - 3, y1 + 1, z, x2 - 3, y1 + 4, z + 5, PALETTE.GLASS);    // arka duvar mağazaları
      w.fillBox(x2 - 3, y1 + 5, z, x2 - 3, y1 + 6, z + 5, [PALETTE.GOLD, PALETTE.BRICK, PALETTE.ROOF][Math.abs(z >> 3) % 3]);
    }
    // Katlar: zemin kat hariç her kat TAM döşemelidir (ortada atrium boşluğu yok); katlar arası geçiş merdivenleri mall.js'te açılır
    for (let k = 1; y1 + MALL_FLOOR * k < y2 - 2; k++) w.fillBox(x1 + 2, y1 + MALL_FLOOR * k, z1 + 2, x2 - 2, y1 + MALL_FLOOR * k, z2 - 2, PALETTE.CONCRETE);
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
      [212, 118, 11, 4.5], [222, -118, 11, 4.5], [238, 110, 8, 3.5]
    ];
    const paved = [[78, 190, -170, 170], [106, 145, -170, 170], [190, 248, -74, 74]];
    const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const edgeDist = (x, z) => Math.min(x - 78, 247 - x, 165 - z, z + 165);
    // ── ÜST GEÇİT RAMPALARI: basamaksız, doğrusal eğim ──
    // Batı rampa 78..106 (21 m, köprü ucundan başlar); doğu rampa 145..180 (26 m; sinema/villa x≥182'de başlar). Üst geçit tabliyesi 4.5 m kaydırma + 0.5 zemin = 5.0 m.
    // Uçlarda parabolik yumuşatma (e): rampa zemine ve tabliyeye pürüzsüzce bağlanır, tümsek yapmaz.
    const lin = (t) => { const e = 0.1, sl = 1 / (1 - e); t = Math.max(0, Math.min(1, t)); return t < e ? sl * t * t / (2 * e) : t > 1 - e ? 1 - sl * (1 - t) * (1 - t) / (2 * e) : sl * (t - e / 2); };
    this.world.terrain.rampProfile = (xm, zm) => {
      if (xm >= 160) return villaRoadProfile(xm, zm);   // villa yolu (zengin meydanından doğuya)
      const x = xm / U;
      if (x >= 78 && x < 106) return 4.5 * lin((x - 78) / 28);
      if (x >= 106 && x <= 145) return 4.5;
      if (x > 145 && x < 180) return 4.5 * (1 - lin((x - 145) / 35));
      return 0;
    };
    this.world.terrain.rampArea = (xm, zm) => { if (xm >= 160) return xm < 320 && zm > -95 && zm < 12; const x = xm / U; return Math.abs(zm / U) <= 6.6 && ((x >= 78 && x < 106) || (x >= 145 && x < 180)); };   // x≥160 m: yalnız villa yolu asfaltı vardır
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
      return Math.max(h * smooth(d / 10) * smooth(edgeDist(x, z) / 24), villaHeight(xm, zm));
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
    if (W < 6 || D < 8) return;
    // Tür verilmediyse yüksekliğe göre: alçak = dükkân, orta = müstakil ev, yüksek = ofis, çok yüksek = apartman
    if (!kind) { const hRows = y2 - y1; kind = hRows >= 20 ? 'apt' : hRows >= 12 ? 'office' : hRows >= 8 ? 'house' : 'shop'; }
    const bases = [GROUND_ROW_SUB];
    if (y1 + 6 < y2 - 2) bases.push(GROUND_ROW_SUB + 19);           // 1. kat döşemesinin üstü
    if (y1 + 12 < y2 - 2) bases.push(GROUND_ROW_SUB + 37);          // 2. kat döşemesinin üstü
    const xa = x1 + 2, xb = x2 - 5, za = z1 + 4, zb = z2 - 2;       // kullanılabilir alan (kapıdan ve merdivenden uzak)
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
      const aw = xb - xa;                                                    // kullanılabilir genişlik (≥1)
      const mn = (v) => Math.min(v, xb);                                     // eşyayı genişliğe sığdır
      // DÜKKÂN: tezgâh + kasa, arka duvarda raflar, ortada vitrinler
      if (kind === 'shop') {
        F(b, xa, za + 3, mn(xa + 5), za + 3, 4, PALETTE.WOOD); F(b, xa, za + 3, mn(xa + 5), za + 3, 1, PALETTE.WHITE, 4);   // tezgâh
        F(b, xa + 1, za + 3, xa + 1, za + 3, 2, PALETTE.IRON, 5);                                                          // kasa
        for (let z = zb - 8; z < zb; z += 3) F(b, xa, z, xb, z, 8, PALETTE.IRON);                                          // raflar
        for (let z = zb - 8; z < zb; z += 3) for (let x = xa; x <= xb; x += 2) F(b, x, z, x, z, 1, [PALETTE.GOLD, PALETTE.BRICK, PALETTE.ROOF][(x + z + 3000) % 3], 3 + ((x + z) % 3) * 2);
        return;
      }
      // Mutfak (arka duvar): tezgâh + evye + ocak + buzdolabı; yer varsa yemek masası ve sandalyeler
      const zk = zb - 1, kl = Math.min(aw, 10);
      if (kind !== 'hotel' && kl >= 4) {
        F(b, xa, zk, xa + Math.min(5, kl - 1), zb, 4, PALETTE.WOOD);                   // tezgâh
        F(b, xa, zk, xa + Math.min(5, kl - 1), zb, 1, PALETTE.WHITE, 4);               // tezgâh üstü
        F(b, xa + 1, zk, xa + 2, zb, 1, PALETTE.GLASS, 5);                              // evye
        if (kl >= 7) { F(b, xa + 6, zk, xa + 7, zb, 4, PALETTE.IRON); F(b, xa + 6, zk, xa + 7, zb, 1, PALETTE.ROOF, 4); }   // ocak + gözler
        if (kl >= 9) F(b, xa + 8, zk, xa + 9, zb, 9, PALETTE.WHITE);                    // buzdolabı
        if (aw >= 4) {
          F(b, xa + 1, zb - 6, mn(xa + 3), zb - 4, 3, PALETTE.WOOD);                    // yemek masası
          F(b, xa, zb - 5, xa, zb - 5, 2, PALETTE.ROOF); F(b, mn(xa + 4), zb - 5, mn(xa + 4), zb - 5, 2, PALETTE.ROOF);   // sandalyeler
        }
      }
      // Otel: resepsiyon (zemin) ya da oda: iki yatak, dolap, TV
      const bz = za + 1;
      if (kind === 'hotel') {
        if (fi === 0) { F(b, xa, za + 2, mn(xa + 6), za + 3, 4, PALETTE.WOOD); F(b, xa, za + 2, mn(xa + 6), za + 3, 1, PALETTE.GOLD, 4); F(b, xa + 1, za + 2, xa + 1, za + 2, 2, PALETTE.IRON, 5); }
        for (let k = 0; k < 2 && xa + k * 6 + 2 <= xb; k++) {
          const bx = xa + k * 6;
          F(b, bx, bz + 4, bx + 2, bz + 7, 2, PALETTE.WOOD);
          F(b, bx, bz + 4, bx + 2, bz + 4, 1, PALETTE.WHITE, 2);
          F(b, bx, bz + 5, bx + 2, bz + 7, 1, k ? PALETTE.GOLD : PALETTE.BRICK, 2);
          F(b, bx + 3, bz + 4, bx + 3, bz + 4, 2, PALETTE.WOOD);
        }
        F(b, xa, zb - 1, mn(xa + 3), zb, 8, PALETTE.ROOF);                              // dolap
        if (aw >= 7) { F(b, xa + 5, zb, mn(xa + 8), zb, 3, PALETTE.IRON); F(b, xa + 5, zb, mn(xa + 8), zb, 1, PALETTE.GLASS, 3); }   // TV
        return;
      }
      // Yatak odası (ön): yatak, yastık, battaniye, komodin, gardırop
      F(b, xa, bz, mn(xa + 2), bz + 3, 2, PALETTE.WOOD);                      // yatak
      F(b, xa, bz, mn(xa + 2), bz, 1, PALETTE.WHITE, 2);                       // yastık
      F(b, xa, bz + 1, mn(xa + 2), bz + 3, 1, PALETTE.BRICK, 2);               // battaniye
      if (aw >= 4) F(b, xa + 3, bz, xa + 3, bz, 2, PALETTE.WOOD);              // komodin
      if (aw >= 6) F(b, xa + 5, bz, mn(xa + 6), bz + 1, 8, PALETTE.ROOF);      // gardırop
      // Salon (orta): kanepe, sehpa, televizyon + sehpası
      const lz = Math.round((za + zb) / 2) - 1;
      if (aw >= 3) {
        F(b, xa, lz, mn(xa + 3), lz + 1, 2, PALETTE.BRICK);                    // kanepe
        F(b, xa, lz + 1, mn(xa + 3), lz + 1, 3, PALETTE.BRICK);                // sırtlık
        F(b, xa + 1, lz - 3, mn(xa + 2), lz - 2, 2, PALETTE.WOOD);             // sehpa
        F(b, xa, lz - 7, mn(xa + 3), lz - 7, 2, PALETTE.IRON);                 // TV sehpası
        F(b, xa + 1, lz - 7, mn(xa + 2), lz - 7, 2, PALETTE.GLASS, 2);         // ekran
      }
      // Banyo: küvet ve klozet (zemin kat)
      if (aw >= 6 && fi === 0) {
        F(b, xb - 3, za, xb, za + 1, 2, PALETTE.WHITE);
        F(b, xb - 1, za + 4, xb - 1, za + 4, 3, PALETTE.WHITE);
      }
    });
  }

  // ── AVM İÇİ: mağaza sıraları (iki kat), orta koridor, yemek alanı, ağaçlı atrium ve iki yürüyen merdiven ──
  furnishMall(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    const xc = Math.round((x1 + x2) / 2), zc = Math.round((z1 + z2) / 2);
    furnishMallShops(this, x1, y1, z1, x2, y2, z2, MALL_FLOOR);   // dükkânlar, yemek katı, koridor masaları (src/mall.js)

    // Atrium: ağaçlı beton saksılar (giriş katındaki kahverengi masa/sandalye/tezgâhlar kaldırıldı)
    [[xc, zc - 8], [xc, zc + 8]].forEach(([x, z]) => { w.fillBox(x - 1, y1, z - 1, x + 1, y1, z + 1, PALETTE.CONCRETE); this.tree(x, z, 7); });

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

  // OYUNCUNUN EVİ (başlangıç): tek katlı, batıya (kumsal tarafı) açılan kapılı müstakil ev.
  // Doğu duvarında televizyon, karşısında koltuk ve sehpa; oyuncu koltukta oturarak başlar (açılış jeneriği src/main.js).
  buildHome(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    w.fillBox(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, PALETTE.WOOD);          // iç zemin: ahşap parke
    const cz = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, cz - 1, x1, y1 + 4, cz + 1);                          // giriş (batı yüzü): gerçek kapı
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
    this.addCeilingLights(x1, y1, z1, x2, y2, z2, 1);

    // Mobilya doğrudan voxel (0.5 m) indeksleriyle: voxel i x/z'de [0.5 i - 0.25, 0.5 i + 0.25], y satırı j [0.5 j, 0.5 j + 0.5] aralığındadır.
    const vw = this.world;
    const vput = (ix0, iy0, iz0, ix1, iy1, iz1, mat) => {
      for (let x = ix0; x <= ix1; x++) for (let y = iy0; y <= iy1; y++) for (let z = iz0; z <= iz1; z++) { vw.voxels.delete(`${x},${y},${z}`); vw.setVoxel(x, y, z, mat); }
    };
    const wv = Math.floor(K * x1 / 2), ev = Math.floor((K * x2 + 2) / 2), zv = Math.floor(K * cz / 2);   // batı duvarı, doğu duvarı, kapı hizası
    const zr0 = zv + 5, zr1 = zv + 10;                                       // koltuk genişliği (voxel z)
    // Koltuk (doğuya, TV'ye bakar): sırtlık batıda, oturma yeri ve iki kol
    vput(wv + 3, 1, zr0 + 1, wv + 3, 2, zr1 - 1, PALETTE.BRICK);             // sırtlık
    vput(wv + 4, 1, zr0 + 1, wv + 5, 1, zr1 - 1, PALETTE.BRICK);             // oturma yeri
    vput(wv + 3, 1, zr0, wv + 5, 1, zr0, PALETTE.BRICK); vput(wv + 3, 2, zr0, wv + 3, 2, zr0, PALETTE.BRICK);   // kol (kuzey)
    vput(wv + 3, 1, zr1, wv + 5, 1, zr1, PALETTE.BRICK); vput(wv + 3, 2, zr1, wv + 3, 2, zr1, PALETTE.BRICK);   // kol (güney)
    // Sehpa
    vput(wv + 9, 1, zr0 + 2, wv + 10, 1, zr1 - 2, PALETTE.WOOD);
    // TV ünitesi (doğu duvarının önünde)
    vput(ev - 1, 1, zr0 - 1, ev - 1, 1, zr1 + 1, PALETTE.IRON);

    // Metre cinsinden konumlar
    const seatX = 0.5 * (wv + 4 + wv + 5) / 2;
    const seatZ = 0.5 * (zr0 + 1 + zr1 - 1) / 2;
    const seatTopY = 1.0;                                                    // zemin 0.5 + 1 voxel
    const standTopY = 1.0;
    const tvX = 0.5 * (ev - 1) + 0.05;
    const tvW = 4.0, tvH = 2.2, tvY = standTopY + tvH / 2 + 0.05;

    const grp = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, tvH + 0.14, tvW + 0.14), new THREE.MeshLambertMaterial({ color: 0x0b0d12 }));
    frame.position.set(tvX, tvY, seatZ);
    grp.add(frame);
    let tvMat;
    try {
      const c = document.createElement('canvas'); c.width = 512; c.height = 288;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 512, 288);
      gr.addColorStop(0, '#1e3a8a'); gr.addColorStop(0.5, '#7c3aed'); gr.addColorStop(1, '#f97316');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 288);
      g.fillStyle = 'rgba(255,255,255,0.16)'; for (let i = 0; i < 9; i++) g.fillRect(0, 150 + i * 14, 512, 3);
      g.fillStyle = '#fde68a'; g.beginPath(); g.arc(256, 150, 46, 0, Math.PI * 2); g.fill();
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      tvMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    } catch (e) { tvMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed }); }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), tvMat);
    screen.position.set(tvX - 0.07, tvY, seatZ);
    screen.rotation.y = -Math.PI / 2;                                        // -x'e (koltuğa) bakar
    grp.add(screen);
    const light = new THREE.PointLight(0x8b7cf6, 14, 12, 2);                 // TV'nin odaya yaydığı ışık (main.js hafifçe titretir)
    light.position.set(tvX - 1.0, tvY, seatZ);
    grp.add(light);
    this.world.scene.add(grp);
    this.world.decor.push(grp);
    this.world.homeTV = { light };

    // Başlangıç noktası: koltuğun üstü
    const spawn = this.levelConfigs[0].spawn;
    spawn.x = seatX; spawn.z = seatZ; spawn.y = seatTopY + 1.05;
    this.world.homeSeat = { x: seatX, y: seatTopY, z: seatZ, tvX, tvY };
    // Yanımızda koltuğun üstünde küçük bir kumanda (tutulabilir eşya olarak da odada durur)
    this.world.propSpawns.push({ kind: 'remote', x: seatX + 0.12, y: seatTopY + 0.03, z: seatZ + 0.55, yaw: -Math.PI / 2 + 0.25 });
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
    if (this.world.bridge) this.world.bridge.attach();     // köprü tabliyesi sallanabilsin diye ayrı küp grupları
    return cfg;
  }
}
