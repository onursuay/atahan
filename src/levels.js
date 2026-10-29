import * as THREE from 'three';
import { PALETTE, VOXEL_SIZE } from './teardown.js';
import { Kit, P } from './kit.js';
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
        title: 'DEVASA 25X ŞEHİR, SAHİL & ZENGİN ADA',
        desc: 'Evindeki salonda televizyon izleyerek başla, garajındaki sedan arabayla yola çık, 25 kat büyüyen şehirleri ve kesintisiz yol ağını keşfet!',
        targetPercent: 35,
        spawn: { x: -110.25, y: 7.05, z: 19.75 },   // Şehirdeki evimizin 2. katındaki televizyon odasında koltuğun üstü
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
    this.world.carOwners = [];
    this.world.marketCats = [];
    this.world.marketShoppers = [];
    this.world.bakkalKids = [];
    this.world.propSpawns = [];  // tutulabilir eşyalar: { kind, x, y, z, yaw, color, hung } (main.js props.js'e aktarır)
    this.world.shelves = [];     // mutfak dolabı, fırın ve buzdolabı içindeki ince raflar
    this.world.officeBuildings = []; // şirket binaları (hasar alınca çalışanların kaçması için)
    this.world.workers = []; this.world.bosses = []; this.world.guards = []; this.world.dogs = [];
    this.world.doctors = []; this.world.schoolChildren = [];
    this.world.lamps = [];       // sokak lambası kafaları (gece ışık havuzları ve gerçek ışık için): { x, y, z, gy }
    const ISL = 346; // zengin bölgenin x kayması (eski birim): köprü 3x uzadığı için +180 birim doğuya alındı (166 + 180)

    // ==========================================
    // 1. ZEMİN, SAHİL, YOLLAR (kaplama yüzeyi) — DEVASA METROPOL HARİTASI
    // ==========================================
    // Doğu Ada & Zengin Bölgesi: Zengin abimizin villası için tepe çimi
    w.fillBox(240, 0, -400, 427, 0, 400, PALETTE.GRASS);
    w.fillBox(428, 0, -300, 720, 0, 300, PALETTE.GRASS); // MUST BE GRASS for heightFn to build the mountain!
    this._setHills();

    // Batı Ada: KOCAMAN ARKAYA GENİŞLETİLMİŞ KARE METROPOL ŞEHRİ (x: -770..20, z: -800..800)
    w.fillBox(-770, 0, -800, 20, 0, 800, PALETTE.CONCRETE);
    this.buildOrganicBeach();                                    // Organik dalgalı, cetvelle çizilmemiş devasa sahil kumsalı ve iskeleler

    w.fillBox(258, 0, -380, 290, 0, 380, PALETTE.CONCRETE);     // doğu ada: şehir blokları (köprüden sonra)
    w.fillBox(321, 0, -380, 370, 0, 380, PALETTE.CONCRETE);
    w.fillBox(370, 0, -70, 428, 0, 70, PALETTE.CONCRETE);       // zengin bölge meydanı (yayalar; araç yolu yok)

    // Dış çevre arazileri aşağıda bağımsız 3D çevre modelleri olarak eklenir (terrain dokusunu kilitlemez)

    // Yollar: asfalt cityplan.js tanımından boyanır (trafik ağı da aynı tanımdan kurulur)
    for (const r of ROADS) for (const sg of paintSegments(r)) w.fillBox(sg.x0, 0, sg.z0, sg.x1, 0, sg.z1, PALETTE.ASPHALT);
    ROUNDABOUTS.forEach(g => this.buildRoundaboutGround(g));
    paintVillaRoad(this.world.terrain, PALETTE.ASPHALT);        // tepeye çıkan kavisli yol + ön avlu

    // Otoyol orta bariyeri (kavşaklarda boşluk) ve çift kollu aydınlatma (otoyol z=±134 caddelerinde biter)
    [[-126, -96], [-80, -52], [-36, -8], [8, 36], [52, 80], [96, 126]].forEach(([a, b]) => w.fillBox(305, 1, a, 305, 2, b, PALETTE.CONCRETE));
    for (let z = -130; z <= 130; z += 15) if ([0, 44, -44, 88, -88, 134, -134].every(g => Math.abs(z - g) > 10)) this.lamp(305, z, 1, 0, true, true);

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
    this.buildOutdoorTeknoMarket(-42, 1, 32, -32, 12, 52);           // AVM dışı bağımsız TEKNO MARKET (bilgisayar, telefon, konsol, kasa, havalandırma)
    this.buildTower(-42, 1, -52, -32, 26, -34, { ...BR, side: 'x1' });
    this.buildTower(-22, 1, 8, -14, 30, 30, { ...CC, side: 'x1' });
    this.buildTower(-22, 1, -30, -14, 20, -8, { ...BR, side: 'x1' });
    this.buildOutdoorFashionStore(-22, 1, 34, -14, 12, 52);          // AVM dışı bağımsız MODA & GİYİM mağazası
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
    this.buildTower(-150, 1, -40, -134, 10, -8, { ...CC, side: 'x2' });
    this.buildTower(-150, 1, 74, -134, 12, 110, { ...CC, side: 'x2' });
    this.buildTower(-150, 1, -110, -134, 12, -74, { ...BR, side: 'x2' });
    this.buildTower(-81, 1, 10, -74, 20, 36, { ...CC, side: 'z1' });
    this.buildTower(-81, 1, -36, -74, 18, -10, { ...BR, side: 'z2' });

    // Genişletilen Batı Şehir Blokları & Kuleleri (bulvar x=-170 ile çakışmayacak şekilde x: -202..-182 bloğuna alındı)
    this.buildTower(-202, 1, 8, -182, 16, 40, { ...BR, side: 'x2' });
    this.buildTower(-202, 1, -40, -182, 14, -8, { ...CC, side: 'x2' });
    this.buildTower(-202, 1, 74, -182, 14, 110, { ...BR, side: 'x2' });
    this.buildTower(-202, 1, -110, -182, 14, -74, { ...CC, side: 'x2' });
    this.buildBakkal(-76, 1, -38, -60, 8, -18);                                    // MAHALLE BAKKALI: Yolun dışına alındı (s6 yolundan tamamen arındırıldı)

    // ── ŞEHİRDEKİ EVİMİZ, GARAJIMIZ & SEDAN ARABA (Müstakil & Şirket binasından arındırılmış!) ──
    this.buildHome(-150, 1, 8, -134, 13, 40);                       // Oyuncunun iki katlı evi: üst kat TV odasında başlar, alt katta mutfak
    this.buildGarage(-150, 1, 44, -134, 8, 59);                     // Yanındaki garaj: cadde66'dan tamamen arındırıldı

    // Uzatılan kuzey/güney mahalleleri (yeni caddeler z=±134 boyunca)
    [[1, 142, 164, 'z1'], [-1, -164, -142, 'z2']].forEach(([sg, za, zb, door]) => {
      this.buildTower(-150, 1, za, -134, 10, zb, { ...BR, side: 'x2' });
      this.buildTower(-120, 1, za, -96, 16, zb, { ...CC, side: door });
      this.buildTower(-42, 1, za, -32, 14, zb, { ...BR, side: door });
      this.buildTower(-22, 1, za, -14, 12, zb, { ...CC, side: door });
    });

    this.buildTower(-70, 1, 76, -54, 20, 124, { ...BR, side: 'x2', interior: 'hotel' });        // eski küçük parkın yerine otel (park artık villanın yanındaki büyük Merkez Park)
    this.buildNewDistricts();
    this.buildAirport();                                         // KOCAMAN ULUSLARARASI HAVALİMANI: Pist, taksi yolları, apron, AVM kadar terminal, kule, yolcu uçakları!
    ROUNDABOUTS.forEach(g => this.buildRoundaboutCenter(g));
    buildTraffic(this);                                          // trafik ışıkları ve yol tabelaları: yolun kenarında
    buildVilla(this.world);                                      // doğudaki tepede çok zengin bir adamın villası
    buildCentralPark(this);                                      // villanın güneyindeki kocaman alanda Merkez Park
    this.buildSite(-81, -124, -53, -74);

    // ==========================================
    // 4. DOĞU ADA: ŞEHİR BLOKLARI (köprüden sonra) — hastane, itfaiye, polis, okul, AVM, apartmanlar
    // ==========================================
    this.buildGrandHospital(324, 1, 52, 360, 26, 126);                               // devasa 4 katlı tıp merkezi (otoyoldan tamamen arındırıldı)
    this.buildMall(323, 1, -127, 360, 34, -50);                                     // devasa AVM (38x78, 4 kat, kat yüksekliği 6 m)
    this.buildFireStation(270, 1, 52, 288, 14, 82);                                 // itfaiye istasyonu
    this.buildTower(270, 1, 96, 286, 12, 120, { ...CC, side: 'z1', sign: true, interior: 'police' });     // polis merkezi
    this.buildGrandSchoolCampus(274, 1, 146, 356, 18, 258);                         // KOCAMAN OKUL KAMPÜSÜ: duvarlar, futbol sahası, çocuklar ve okul zili!
    this.buildTower(270, 1, -38, 288, 26, -8, { ...CC, side: 'z2' });               // iş merkezi
    this.buildTower(270, 1, -82, 288, 20, -50, { ...BR, side: 'z1', interior: 'hotel' });  // otel
    this.buildTower(270, 1, -122, 286, 24, -96, { ...CC, side: 'z2' });             // apartmanlar
    this.buildTower(324, 1, 8, 356, 28, 38, { ...CC, side: 'z1' });                 // apartman bloğu
    this.buildTower(324, 1, -38, 356, 22, -8, { ...BR, side: 'z2' });               // ofis kulesi
    this.buildTower(374, 1, 78, 394, 14, 100, { ...BR, side: 'x1' });
    this.buildTower(398, 1, 78, 416, 16, 104, { ...CC, side: 'x1' });
    [[-164, -142, 'z2']].forEach(([za, zb, door]) => {
      this.buildTower(270, 1, za, 288, 14, zb, { ...BR, side: door });
      this.buildTower(324, 1, za, 356, 16, zb, { ...CC, side: door });
    });
    this.buildOverpass();
    this.buildTower(374, 1, -104, 394, 14, -78, { ...CC, side: 'x1' });
    this.buildTower(398, 1, -108, 416, 18, -80, { ...BR, side: 'x1' });

    // ── CADDE KENARLARINDA PARK EDİLMİŞ ARABALAR VE SAHİPLERİ ──
    const vw = this.world;
    const p1Idx = vw.parkedCars.length;
    vw.parkedCars.push({ kind: 'sedan', color: 0x2563eb, x: -72 * 0.75, y: 0.5, z: -14 * 0.75, heading: 0 }); // Bakkal önü park aracı
    const p2Idx = vw.parkedCars.length;
    vw.parkedCars.push({ kind: 'suv', color: 0xdc2626, x: -30 * 0.75, y: 0.5, z: 70 * 0.75, heading: Math.PI / 2 }); // Market önü SUV
    const p3Idx = vw.parkedCars.length;
    vw.parkedCars.push({ kind: 'van', color: 0xfacc15, x: 268 * 0.75, y: 0.5, z: 142 * 0.75, heading: 0 }); // Okul önü servis minibüsü
    const p4Idx = vw.parkedCars.length;
    vw.parkedCars.push({ kind: 'merzedes', color: 0x111827, x: 314 * 0.75, y: 0.5, z: 48 * 0.75, heading: Math.PI / 2 }); // Hastane önü lüks sedan

    // Arabalarına doğru yürüyüp binen sahipleri
    vw.carOwners.push({
      spawnPos: { x: -66 * 0.75, y: 0.5, z: -20 * 0.75 },
      carPos: { x: -72 * 0.75, y: 0.5, z: -14 * 0.75 },
      carIndex: p1Idx
    });
    vw.carOwners.push({
      spawnPos: { x: -35 * 0.75, y: 0.5, z: 78 * 0.75 },
      carPos: { x: -30 * 0.75, y: 0.5, z: 70 * 0.75 },
      carIndex: p2Idx
    });

    // ==========================================
    // 5. SOKAK DONATIMI: lambalar, çöp kutuları, ağaçlar
    // ==========================================
    // Donatı (lamba, çöp kutusu, ağaç) yolun üstüne konmaz: lamp/trashBin/tree yol dikdörtgenlerini kendileri denetler
    for (const zc of [-750, -650, -550, -450, -380, -320, -266, -200, -134, -66, 0, 66, 134, 200, 266, 320, 380, 450, 550, 650, 750]) {
      for (let x = -340; x <= -30; x += 22) {
        this.lamp(x, zc + 6.5, 0, -1); this.trashBin(x + 4, zc + 7);
        this.lamp(x + 11, zc - 6.5, 0, 1); this.trashBin(x + 15, zc - 7);
      }
      for (let x = -336; x <= -32; x += 36) { this.tree(x, zc + 6.5, 6); this.tree(x + 18, zc - 6.5, 6); }
    }
    for (let x = 270; x <= 352; x += 16) [-350, -250, -180, -134, -44, 44, 134, 180, 250, 350].forEach(zz => { if (Math.abs(x - 305) > 20 && !(Math.abs(zz) === 88 && x > 286)) { this.lamp(x, zz + 6.5, 0, -1); this.lamp(x + 8, zz - 6.5, 0, 1); } });

    // ==========================================
    // 5. ZENGİN BÖLGE (doğu adanın doğusu)
    // ==========================================
    this.buildGrandCinema(28 + ISL, 1, -28, 42 + ISL, 18, -4);
    this.buildLuxuryVilla(28 + ISL, 1, 6, 42 + ISL, 18, 26);
    this.buildLuxuryMansion(48 + ISL, 1, -14, 64 + ISL, 18, 14);
    this.buildLuxuryBoutique(48 + ISL, 1, 16, 62 + ISL, 14, 28);
    this.buildTower(48 + ISL, 1, -30, 57 + ISL, 14, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });
    this.buildTower(62 + ISL, 1, -30, 69 + ISL, 26, -18, { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD, side: 'x1' });   // komşu kuleyle 5 birim boşluk (kapıdan girilsin)
    for (let z = -60; z <= 60; z += 20) { this.tree(419, z, 7); this.lamp(387, z + 4, 0, 0); }
  }

  // ── ÜST GEÇİT: ana cadde otoyolun üstünden geçer. Rampalar zeminin kendisidir (yükselen yol), tabliye küptür. ──
  buildOverpass() {
    const w = this.b;
    const X0 = K * 286 - 1, X1 = K * 325 + 1, ZD = 19;   // ZD: tabliye yarı genişliği (ince ızgara; 19 = 9.75 m tabliye, asfalt şeritle aynı)
    w.raw(X0, 18, -ZD, X1, 19, ZD, PALETTE.ASPHALT);                                    // tabliye (üst yüz 5.0 m)
    for (let x = X0 + 4; x < X1 - 4; x += 14) w.rawReplace(x, 19, -1, x + 6, 19, 0, PALETTE.GOLD); // orta şerit
    w.raw(X0, 20, -ZD, X1, 23, -ZD, PALETTE.CONCRETE);                                  // korkuluklar
    w.raw(X0, 20, ZD, X1, 23, ZD, PALETTE.CONCRETE);
    [K * 289, K * 305, K * 322].forEach(px => [-17, 17].forEach(pz => w.raw(px - 1, GROUND_ROW_SUB, pz - 1, px + 1, 17, pz + 1, PALETTE.CONCRETE))); // sütunlar
    w.raw(K * 289 - 1, 16, -ZD, K * 322 + 1, 17, ZD, PALETTE.CONCRETE);                 // alt kiriş
  }

  // ── GERÇEKÇİ ÇELİK ASMA KÖPRÜ: Masif beton pilon temelleri, X-bracing çapraz çelik kafes kuleler, tepe flaşörleri, yaya kaldırımları ve taşıyıcı kafes kirişler ──
  buildSuspensionBridge() {
    const w = this.b;
    const DY = -2;                                   // bir blok (0.5 m) aşağı: tabliye artık zeminle aynı hizada
    const X0 = -K * 12, X1 = K * 258;                // tabliye uçları (ince ızgara: 270 eski birim)
    const T1 = K * 54, T2 = K * 192;                 // iki kulenin x konumu
    const ZD = 14, ZL = 18;                          // tabliye yarı genişliği, kule bacaklarının z konumu
    const DECK_TOP = 2 + DY;
    const TOP = 104;                                 // kule tepesi (≈26 m)
    const Y = (v) => v + DY;

    // 1. Kıyı Ankraj Blokları (Kabloların iki yakada yere bağlandığı devasa masif beton bloklar)
    w.raw(X0 - 8, -6, -ZD - 4, X0 + 4, DECK_TOP + 4, ZD + 4, PALETTE.CONCRETE);
    w.raw(X1 - 4, -6, -ZD - 4, X1 + 8, DECK_TOP + 4, ZD + 4, PALETTE.CONCRETE);

    // 2. Tabliye Altı Taşıyıcı Çelik Kafes Kirişler (Stiffening Truss Structure)
    w.raw(X0, Y(-2), -ZD, X1, Y(-1), -ZD + 1, PALETTE.IRON);
    w.raw(X0, Y(-2), ZD - 1, X1, Y(-1), ZD, PALETTE.IRON);
    w.raw(X0, Y(-3), -ZD, X1, Y(-3), ZD, PALETTE.CONCRETE); // alt taban kirişi
    for (let x = X0; x <= X1; x += 6) {
      w.raw(x, Y(-3), -ZD, x, Y(0), -ZD, PALETTE.IRON);
      w.raw(x, Y(-3), ZD, x, Y(0), ZD, PALETTE.IRON);
      w.raw(x, Y(-3), -ZD, x, Y(-3), ZD, PALETTE.IRON); // enine alt kirişler
    }

    // 3. Tabliye Asfaltı ve Gerçekçi Yol Şeritleri
    w.raw(X0, Y(1), -ZD + 2, X1, DECK_TOP, ZD - 2, PALETTE.ASPHALT);
    // Yaya kaldırımları (sağ ve sol kenarlarda yükseltilmiş beton tretuvar)
    w.raw(X0, DECK_TOP + 1, -ZD, X1, DECK_TOP + 1, -ZD + 2, PALETTE.CONCRETE);
    w.raw(X0, DECK_TOP + 1, ZD - 2, X1, DECK_TOP + 1, ZD, PALETTE.CONCRETE);
    // Çelik güvenlik korkulukları
    w.raw(X0, DECK_TOP + 2, -ZD, X1, DECK_TOP + 3, -ZD, PALETTE.IRON);
    w.raw(X0, DECK_TOP + 2, ZD, X1, DECK_TOP + 3, ZD, PALETTE.IRON);
    w.raw(X0, DECK_TOP + 2, -ZD + 2, X1, DECK_TOP + 2, -ZD + 2, PALETTE.IRON); // yol kenarı bariyeri
    w.raw(X0, DECK_TOP + 2, ZD - 2, X1, DECK_TOP + 2, ZD - 2, PALETTE.IRON);

    // Gerçekçi yol çizgileri: Çift sarı orta çizgi ve kesik beyaz şerit çizgileri
    for (let x = X0 + 6; x < X1 - 6; x += 12) {
      w.rawReplace(x, DECK_TOP, -1, x + 7, DECK_TOP, 0, PALETTE.GOLD); // çift sarı orta refüj
      w.rawReplace(x, DECK_TOP, -5, x + 5, DECK_TOP, -5, PALETTE.WHITE); // batı yönü şerit çizgisi
      w.rawReplace(x, DECK_TOP, 5, x + 5, DECK_TOP, 5, PALETTE.WHITE);   // doğu yönü şerit çizgisi
    }

    // 4. Masif Beton Pilon Kaideleri ve X-Bracing Çapraz Çelik Kafes Kuleler
    for (const tx of [T1, T2]) {
      // Su altından yükselen devasa oval/dalgakıran masif beton kaide (caisson)
      w.raw(tx - 6, -14, -ZL - 6, tx + 6, 2, ZL + 6, PALETTE.CONCRETE);
      w.raw(tx - 7, -8, -ZL - 7, tx + 7, -1, ZL + 7, PALETTE.CONCRETE);

      // Kule bacakları: daralan çelik strüktür (koyu kırmızı çelik)
      for (const sz of [-ZL, ZL]) {
        w.raw(tx - 3, 2, sz - 3, tx + 3, 44, sz + 3, PALETTE.BRICK);
        w.raw(tx - 2, 45, sz - 2, tx + 2, 76, sz + 2, PALETTE.BRICK);
        w.raw(tx - 2, 77, sz - 2, tx + 2, TOP, sz + 2, PALETTE.BRICK);
        // Kule içi çelik kuşaklar
        w.raw(tx - 4, 44, sz - 4, tx + 4, 45, sz + 4, PALETTE.IRON);
        w.raw(tx - 3, 76, sz - 3, tx + 3, 77, sz + 3, PALETTE.IRON);
        // Kule tepesi çelik kablo semeri (cable saddle)
        w.raw(tx - 2, TOP, sz - 2, tx + 2, TOP + 2, sz + 2, PALETTE.IRON);
        // Havacılık ikaz flaşör lambası (uçaklar için tepe kırmızı flaşör)
        w.raw(tx, TOP + 3, sz, tx, TOP + 4, sz, PALETTE.LAMP);
      }

      // Kule bacakları arası yatay kirişler ve X-şeklinde çapraz çelik kafesler (X-Bracing)
      for (const by of [44, 76, TOP - 3]) {
        w.raw(tx - 2, by, -ZL + 3, tx + 2, by + 3, ZL - 3, PALETTE.BRICK);
      }
      // Alt ve üst X-kafes kirişler
      for (let step = 0; step < 14; step++) {
        const t = step / 14;
        const zMid1 = -ZL + 3 + (2 * ZL - 6) * t;
        const y1 = 48 + 24 * t, y2 = 72 - 24 * t;
        w.raw(tx - 1, Math.round(y1), Math.round(zMid1), tx + 1, Math.round(y1) + 1, Math.round(zMid1) + 1, PALETTE.IRON);
        w.raw(tx - 1, Math.round(y2), Math.round(zMid1), tx + 1, Math.round(y2) + 1, Math.round(zMid1) + 1, PALETTE.IRON);
      }
      for (let step = 0; step < 12; step++) {
        const t = step / 12;
        const zMid2 = -ZL + 3 + (2 * ZL - 6) * t;
        const y3 = 80 + 18 * t, y4 = 98 - 18 * t;
        w.raw(tx - 1, Math.round(y3), Math.round(zMid2), tx + 1, Math.round(y3) + 1, Math.round(zMid2) + 1, PALETTE.IRON);
        w.raw(tx - 1, Math.round(y4), Math.round(zMid2), tx + 1, Math.round(y4) + 1, Math.round(zMid2) + 1, PALETTE.IRON);
      }
    }

    // 5. Ana Taşıyıcı Kablolar (Doğal katenar asma eğrisi)
    const endY = DECK_TOP + 4;
    const yAt = (x) => {
      if (x <= T1) { const t = (x - X0) / (T1 - X0); return endY + (TOP - endY) * t - 22 * t * (1 - t); }
      if (x >= T2) { const t = (x - T2) / (X1 - T2); return TOP + (endY - TOP) * t - 22 * t * (1 - t); }
      const t = (x - T1) / (T2 - T1); return TOP - 4 * (TOP - endY - 8) * t * (1 - t);
    };
    for (let x = X0; x <= X1; x++) {
      const y = Math.round(yAt(x));
      for (const sz of [-ZL, ZL]) {
        w.raw(x, y, sz - 1, x, y + 1, sz + 1, PALETTE.BRICK); // kalın sağlam ana kablo
      }
    }

    // 6. Dikey Askı Halatları ve Aydınlatma
    this.world.bridge = new Bridge(this.world, { X0, X1, T1, T2, ZD, ZL, DECK_TOP, yAt });
    for (let x = X0 + 20; x < X1 - 18; x += 26) {
      this.lampSub(x, ZD - 2, DECK_TOP + 1, 0, -1);
      this.lampSub(x + 13, -ZD + 2, DECK_TOP + 1, 0, 1);
    }
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

  // ── ŞEHİR GENİŞLEMESİ: kuzey, güney ve arkaya (batıya) uzatılan yeni metropol mahalleleri ──
  // Sütunlar (x) ve bantlar (z) caddelerin arasında kalan bloklardır; hiçbir yol veya bina çakışmaz.
  // Göbeğin ve Havalimanının içine procedural bina konmaz.
  buildNewDistricts() {
    let seed = 20241014;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const CC = { wall: PALETTE.CONCRETE, floor: PALETTE.WOOD }, BR = { wall: PALETTE.BRICK, floor: PALETTE.WOOD };
    const cols = [
      // Arkaya genişletilen yeni batı mahalleleri
      [-736, -714], [-686, -664], [-636, -614], [-516, -464], [-436, -416], [-396, -374],
      // Mevcut şehir blokları
      [-346, -324], [-296, -274], [-246, -224], [-198, -176],
      [-161, -137], [-119, -97], [-79, -57], [-41, -33], [-21, -15]
    ];
    // Caddelerle (z = ±66, ±134, ±200, ±266, ±320, ±380, ±450, ±550, ±650, ±750) asla çakışmayan güvenli parsel aralıkları
    const lots = [
      [142, 164], [170, 188], [212, 234], [238, 254],
      [278, 308], [332, 368], [392, 438], [462, 538], [562, 638], [662, 738]
    ];
    const near = (x1, x2, z1, z2) => ROUNDABOUTS.some(g => { const dx = Math.max(x1 - g.cx, 0, g.cx - x2), dz = Math.max(Math.min(z1, z2) - g.cz, 0, g.cz - Math.max(z1, z2)); return Math.hypot(dx, dz) < g.rOuter + 8; });
    // Havalimanı bölgesi (x: -740..-530, z: -680..-140) bina yapımından tamamen korunur
    const inAirport = (x1, x2, z1, z2) => (Math.min(x1, x2) < -530 && Math.max(x1, x2) > -740 && Math.min(z1, z2) < -140 && Math.max(z1, z2) > -680);
    const place = (ci, za, zb, sign) => {
      const [x1, x2] = cols[ci];
      const zlo = sign > 0 ? za : -zb, zhi = sign > 0 ? zb : -za;
      if (near(x1, x2, zlo, zhi) || inAirport(x1, x2, zlo, zhi) || isSpecialLot(x1, x2, zlo, zhi)) return;
      // Şehir içi açık alanlar, otoparklar ve meydanlar için nefes payı (%18 boşluk)
      if (rnd() < 0.18) return;
      const bType = (ci * 3 + Math.floor(rnd() * 8)) % 8;
      if (bType === 0) {
        this.buildOutdoorTeknoMarket(x1, 1, zlo, x2, 12, zhi);
      } else if (bType === 1) {
        this.buildMarket(x1, 1, zlo, x2, 10, zhi);
      } else if (bType === 2) {
        this.buildCityApartment(x1, 1, zlo, x2, 22, zhi);
      } else if (bType === 3) {
        this.buildOutdoorFashionStore(x1, 1, zlo, x2, 12, zhi);
      } else if (bType === 4) {
        this.buildCityBank(x1, 1, zlo, x2, 16, zhi);
      } else if (bType === 5) {
        const h = 24 + Math.floor(rnd() * 18);
        this.buildTower(x1, 1, zlo, x2, h, zhi, { ...CC, side: sign > 0 ? 'z1' : 'z2', sign: true });
      } else if (bType === 6) {
        this.buildCityWarehouse(x1, 1, zlo, x2, 12, zhi);
      } else {
        const h = 14 + Math.floor(rnd() * 16);
        const style = rnd() < 0.5 ? CC : BR;
        this.buildTower(x1, 1, zlo, x2, h, zhi, { ...style, side: sign > 0 ? 'z1' : 'z2' });
      }
    };
    for (const sign of [1, -1]) {
      place(6, 142, 164, sign);
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

  // ── KOCAMAN ŞEHİR HASTANESİ: 4 katlı tıp merkezi, acil servis, ambulanslar, doktorlar ve hemşireler ──
  buildGrandHospital(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WHITE, PALETTE.CONCRETE);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 4, x1, y1 + 5, zc + 4);
    w.clearBox(x1, y1, z1 + 10, x1, y1 + 5, z1 + 18);

    const sx = K * x1 - 2, sy = w._y0(y1 + 12), sz = K * zc;
    w.rawReplace(sx, sy - 7, sz - 2, sx + 1, sy + 7, sz + 2, PALETTE.BRICK);
    w.rawReplace(sx, sy - 2, sz - 7, sx + 1, sy + 2, sz + 7, PALETTE.BRICK);

    w.fillBox(x1 - 8, y1 + 6, z1 + 6, x1 - 1, y1 + 6, z1 + 28, PALETTE.WHITE);
    for (const pz of [z1 + 7, z1 + 17, z1 + 27]) {
      w.fillBox(x1 - 8, y1, pz, x1 - 8, y1 + 5, pz, PALETTE.IRON);
    }

    [z1 + 9, z1 + 16, z1 + 23].forEach((az) => {
      const ax = x1 - 5;
      w.fillBox(ax - 2, y1, az - 2, ax + 2, y1 + 3, az + 2, PALETTE.WHITE);
      w.fillBox(ax - 2, y1 + 1, az - 2, ax + 2, y1 + 1, az + 2, PALETTE.BRICK);
      w.fillBox(ax - 2, y1 + 2, az + 1, ax + 2, y1 + 3, az + 2, PALETTE.GLASS);
      w.fillBox(ax, y1 + 4, az, ax, y1 + 4, az, PALETTE.LAMP_RED);
    });

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE);
    this.addStairs(x1, y1, z1, x2, y2, z2);

    w.fillBox(x1 + 3, y1, zc - 8, x1 + 6, y1 + 1, zc + 8, PALETTE.WOOD);
    for (let z = zc - 6; z <= zc + 6; z += 3) {
      w.fillBox(x1 + 8, y1, z, x1 + 8, y1 + 3, z + 1, PALETTE.GLASS);
    }

    for (let f = y1; f < y2 - 4; f += 6) {
      for (let z = z1 + 6; z < z2 - 6; z += 9) {
        w.fillBox(x1 + 12, f, z, x2 - 4, f + 4, z, PALETTE.WHITE);
        w.fillBox(x1 + 14, f, z + 2, x1 + 18, f, z + 5, PALETTE.WOOD);
        w.fillBox(x1 + 14, f + 1, z + 2, x1 + 18, f + 1, z + 5, PALETTE.WHITE);
        w.fillBox(x1 + 13, f, z + 2, x1 + 13, f + 3, z + 2, PALETTE.IRON);
      }
    }

    const midZ = Math.round((z1 + z2) / 2);
    w.fillBox(x2 - 14, y2 + 1, midZ - 7, x2 - 2, y2 + 1, midZ + 7, PALETTE.CONCRETE);
    w.fillBox(x2 - 11, y2 + 2, midZ - 4, x2 - 5, y2 + 2, midZ - 4, PALETTE.GOLD);
    w.fillBox(x2 - 11, y2 + 2, midZ + 4, x2 - 5, y2 + 2, midZ + 4, PALETTE.GOLD);
    w.fillBox(x2 - 8, y2 + 2, midZ - 4, x2 - 8, y2 + 2, midZ + 4, PALETTE.GOLD);

    const docs = [
      { x: (x1 + 5) * 0.75, y: 1.0, z: (zc - 2) * 0.75, yaw: 0, style: 'doctor', role: 'Chief Doctor' },
      { x: (x1 + 15) * 0.75, y: 1.0, z: (z1 + 14) * 0.75, yaw: 1.57, style: 'doctor', role: 'ER Doctor' },
      { x: (x1 + 22) * 0.75, y: 7.0, z: (zc + 10) * 0.75, yaw: -1.57, style: 'doctor', role: 'Surgeon' },
      { x: (x1 + 18) * 0.75, y: 13.0, z: (z1 + 20) * 0.75, yaw: 3.14, style: 'doctor', role: 'Physician' },
      { x: (x1 + 16) * 0.75, y: 7.0, z: (zc - 12) * 0.75, yaw: 0, style: 'doctor', role: 'Pediatrician' }
    ];
    const nurses = [
      { x: (x1 + 4) * 0.75, y: 1.0, z: (zc + 3) * 0.75, yaw: 3.14, style: 'nurse', role: 'Reception Nurse' },
      { x: (x1 + 12) * 0.75, y: 1.0, z: (z1 + 16) * 0.75, yaw: -1.57, style: 'nurse', role: 'Triage Nurse' },
      { x: (x1 + 15) * 0.75, y: 7.0, z: (zc + 8) * 0.75, yaw: 0, style: 'nurse', role: 'Ward Nurse' },
      { x: (x1 + 20) * 0.75, y: 7.0, z: (zc - 10) * 0.75, yaw: 1.57, style: 'nurse', role: 'ICU Nurse' },
      { x: (x1 + 16) * 0.75, y: 13.0, z: (z1 + 28) * 0.75, yaw: -1.57, style: 'nurse', role: 'Care Nurse' },
      { x: (x1 + 22) * 0.75, y: 13.0, z: (zc + 15) * 0.75, yaw: 3.14, style: 'nurse', role: 'Night Nurse' }
    ];
    docs.forEach(d => this.world.doctors.push(d));
    nurses.forEach(n => this.world.doctors.push(n));
  }

  // ── KOCAMAN OKUL KAMPÜSÜ: çevre duvarları, kapı, futbol & oyun sahası, saat kulesi ve çocuklar ──
  buildGrandSchoolCampus(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();

    w.fillBox(x1, y1, z1, x2, y1, z1, PALETTE.BRICK);
    w.fillBox(x1, y1 + 1, z1, x2, y1 + 3, z1, PALETTE.IRON);
    w.fillBox(x1, y1, z2, x2, y1, z2, PALETTE.BRICK);
    w.fillBox(x1, y1 + 1, z2, x2, y1 + 3, z2, PALETTE.IRON);
    w.fillBox(x1, y1, z1, x1, y1, z2, PALETTE.BRICK);
    w.fillBox(x1, y1 + 1, z1, x1, y1 + 3, z2, PALETTE.IRON);
    w.fillBox(x2, y1, z1, x2, y1, z2, PALETTE.BRICK);
    w.fillBox(x2, y1 + 1, z1, x2, y1 + 3, z2, PALETTE.IRON);

    for (let x = x1; x <= x2; x += 8) {
      w.fillBox(x, y1, z1, x, y1 + 4, z1, PALETTE.BRICK);
      w.fillBox(x, y1, z2, x, y1 + 4, z2, PALETTE.BRICK);
    }
    for (let z = z1; z <= z2; z += 8) {
      w.fillBox(x1, y1, z, x1, y1 + 4, z, PALETTE.BRICK);
      w.fillBox(x2, y1, z, x2, y1 + 4, z, PALETTE.BRICK);
    }

    const gateZ = z1;
    const gateX0 = x1 + 14, gateX1 = x1 + 22;
    w.clearBox(gateX0, y1, gateZ, gateX1, y1 + 4, gateZ);
    w.fillBox(gateX0 - 1, y1, gateZ - 1, gateX0, y1 + 5, gateZ + 1, PALETTE.BRICK);
    w.fillBox(gateX1, y1, gateZ - 1, gateX1 + 1, y1 + 5, gateZ + 1, PALETTE.BRICK);
    w.fillBox(gateX0 - 1, y1 + 5, gateZ, gateX1 + 1, y1 + 5, gateZ, PALETTE.GOLD);

    const fx0 = x1 + 6, fx1 = x1 + 32, fz0 = z1 + 10, fz1 = z1 + 60;
    w.fillBox(fx0, 0, fz0, fx1, 0, fz1, PALETTE.GRASS);
    const fMidZ = Math.round((fz0 + fz1) / 2);
    w.fillBox(fx0, 0, fMidZ, fx1, 0, fMidZ, PALETTE.WHITE);
    w.fillBox(fx0 + 7, 0, fz0, fx1 - 7, 0, fz0 + 6, PALETTE.WHITE);
    w.fillBox(fx0 + 7, 0, fz1 - 6, fx1 - 7, 0, fz1, PALETTE.WHITE);
    w.fillBox(fx0 + 10, y1, fz0, fx0 + 16, y1 + 2, fz0, PALETTE.IRON);
    w.clearBox(fx0 + 11, y1, fz0, fx0 + 15, y1 + 1, fz0);
    w.fillBox(fx0 + 10, y1, fz1, fx0 + 16, y1 + 2, fz1, PALETTE.IRON);
    w.clearBox(fx0 + 11, y1, fz1, fx0 + 15, y1 + 1, fz1);

    const bx0 = x1 + 38, bx1 = x2 - 4, bz0 = z1 + 10, bz1 = z1 + 45;
    w.fillBox(bx0, 0, bz0, bx1, 0, bz1, PALETTE.BRICK);
    w.fillBox(bx0 + 6, y1, bz0 + 2, bx0 + 6, y1 + 4, bz0 + 2, PALETTE.IRON);
    w.fillBox(bx0 + 5, y1 + 4, bz0 + 3, bx0 + 7, y1 + 5, bz0 + 3, PALETTE.WHITE);
    w.fillBox(bx0 + 6, y1 + 4, bz0 + 4, bx0 + 6, y1 + 4, bz0 + 4, PALETTE.ORANGE);

    const sx0 = x1 + 6, sx1 = x2 - 6, sz0 = z1 + 66, sz1 = z2 - 6;
    w.fillHollowBox(sx0, y1, sz0, sx1, y1 + 18, sz1, PALETTE.BRICK, PALETTE.WOOD);
    this.addFloors(sx0, y1, sz0, sx1, y1 + 18, sz1, PALETTE.WOOD);
    this.addStairs(sx0, y1, sz0, sx1, y1 + 18, sz1);
    this.addWindowBands(sx0, y1, sz0, sx1, y1 + 18, sz1, 'z1');

    const smidX = Math.round((sx0 + sx1) / 2);
    w.clearBox(smidX - 3, y1, sz0, smidX + 3, y1 + 5, sz0);
    w.fillBox(smidX - 4, y1 + 6, sz0 - 2, smidX + 4, y1 + 6, sz0, PALETTE.WHITE);
    w.fillBox(smidX - 5, y1 + 7, sz0 - 1, smidX + 5, y1 + 7, sz0 - 1, PALETTE.GOLD);

    const twX0 = smidX - 3, twX1 = smidX + 3, twZ0 = sz0 + 2, twZ1 = sz0 + 8;
    w.fillHollowBox(twX0, y1 + 18, twZ0, twX1, y1 + 27, twZ1, PALETTE.BRICK, PALETTE.WHITE);
    w.fillBox(smidX - 1, y1 + 22, twZ0 - 1, smidX + 1, y1 + 24, twZ0 - 1, PALETTE.GOLD);
    w.fillBox(twX0 - 1, y1 + 27, twZ0 - 1, twX1 + 1, y1 + 27, twZ1 + 1, PALETTE.IRON);
    w.fillBox(smidX, y1 + 28, Math.round((twZ0 + twZ1) / 2), smidX, y1 + 31, Math.round((twZ0 + twZ1) / 2), PALETTE.GOLD);

    for (let f = y1; f <= y1 + 12; f += 6) {
      w.fillBox(sx0 + 4, f + 2, sz1 - 1, sx0 + 12, f + 4, sz1 - 1, PALETTE.DGREEN);
      w.fillBox(sx1 - 12, f + 2, sz1 - 1, sx1 - 4, f + 4, sz1 - 1, PALETTE.DGREEN);
      for (let rx = sx0 + 4; rx <= sx0 + 12; rx += 3) {
        for (let rz = sz0 + 6; rz <= sz1 - 6; rz += 4) {
          w.fillBox(rx, f, rz, rx + 1, f, rz + 1, PALETTE.WOOD);
          w.fillBox(rx, f + 1, rz, rx + 1, f + 1, rz, PALETTE.WOOD);
        }
      }
    }

    const ballPos = { x: (fx0 + (fx1 - fx0) / 2) * 0.75, y: 0.6, z: fMidZ * 0.75 };
    const kids = [
      // 1. Futbol sahasındaki çocuklar (İki takım)
      { x: (fx0 + 8) * 0.75, y: 0.5, z: (fz0 + 14) * 0.75, activity: 'soccer', ballPos, k: 0.58 },
      { x: (fx0 + 18) * 0.75, y: 0.5, z: (fz0 + 20) * 0.75, activity: 'soccer', k: 0.62 },
      { x: (fx0 + 12) * 0.75, y: 0.5, z: (fz1 - 14) * 0.75, activity: 'soccer', k: 0.56 },
      { x: (fx0 + 20) * 0.75, y: 0.5, z: (fz1 - 20) * 0.75, activity: 'soccer', k: 0.6 },
      { x: (fx0 + 15) * 0.75, y: 0.5, z: (fMidZ - 6) * 0.75, activity: 'soccer', k: 0.58 },
      { x: (fx0 + 10) * 0.75, y: 0.5, z: (fMidZ + 6) * 0.75, activity: 'soccer', k: 0.6 },

      // 2. Bahçede kovalamaca (ebe) oynayan çocuklar
      { x: (bx0 + 4) * 0.75, y: 0.5, z: (bz0 + 8) * 0.75, activity: 'tag', isIt: true, k: 0.6 },
      { x: (bx0 + 10) * 0.75, y: 0.5, z: (bz0 + 14) * 0.75, activity: 'tag', isIt: false, k: 0.58 },
      { x: (bx0 + 16) * 0.75, y: 0.5, z: (bz0 + 22) * 0.75, activity: 'tag', isIt: false, k: 0.62 },
      { x: (bx0 + 22) * 0.75, y: 0.5, z: (bz0 + 16) * 0.75, activity: 'tag', isIt: false, k: 0.57 },
      { x: (bx0 + 28) * 0.75, y: 0.5, z: (bz0 + 26) * 0.75, activity: 'tag', isIt: false, k: 0.6 },

      // 3. İp atlama ve bahçe oyunları
      { x: (x1 + 36) * 0.75, y: 0.5, z: (z1 + 52) * 0.75, activity: 'rope_swing', k: 0.6 },
      { x: (x1 + 42) * 0.75, y: 0.5, z: (z1 + 52) * 0.75, activity: 'rope_swing', k: 0.6 },
      { x: (x1 + 39) * 0.75, y: 0.5, z: (z1 + 52) * 0.75, activity: 'rope_jump', k: 0.56 },

      // 4. Okul içi ve Sınıflar — Zemin Kat (Sıralarında oturan ve tahtaya bakan öğrenciler)
      { x: (sx0 + 5) * 0.75, y: 1.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.58 },
      { x: (sx0 + 8) * 0.75, y: 1.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.6 },
      { x: (sx0 + 11) * 0.75, y: 1.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.57 },
      { x: (sx0 + 5) * 0.75, y: 1.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.56 },
      { x: (sx0 + 8) * 0.75, y: 1.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.6 },
      { x: (sx0 + 11) * 0.75, y: 1.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.59 },
      { x: (sx0 + 5) * 0.75, y: 1.0, z: (sz0 + 16) * 0.75, pose: 'sit', activity: 'study', k: 0.58 },
      { x: (sx0 + 8) * 0.75, y: 1.0, z: (sz0 + 16) * 0.75, pose: 'sit', activity: 'study', k: 0.61 },

      // 5. Okul içi ve Sınıflar — 1. Kat (Üst kat sınıfı)
      { x: (sx0 + 5) * 0.75, y: 7.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.58 },
      { x: (sx0 + 8) * 0.75, y: 7.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.6 },
      { x: (sx0 + 11) * 0.75, y: 7.0, z: (sz0 + 8) * 0.75, pose: 'sit', activity: 'study', k: 0.56 },
      { x: (sx0 + 5) * 0.75, y: 7.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.57 },
      { x: (sx0 + 8) * 0.75, y: 7.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.6 },
      { x: (sx0 + 11) * 0.75, y: 7.0, z: (sz0 + 12) * 0.75, pose: 'sit', activity: 'study', k: 0.58 },
      { x: (sx0 + 5) * 0.75, y: 7.0, z: (sz0 + 16) * 0.75, pose: 'sit', activity: 'study', k: 0.62 },
      { x: (sx0 + 8) * 0.75, y: 7.0, z: (sz0 + 16) * 0.75, pose: 'sit', activity: 'study', k: 0.59 },

      // 6. Koridorlarda ve merdiven önünde sohbet eden çocuklar
      { x: (smidX - 2) * 0.75, y: 1.0, z: (sz0 + 6) * 0.75, activity: 'study', k: 0.6 },
      { x: (smidX + 2) * 0.75, y: 1.0, z: (sz0 + 6) * 0.75, activity: 'study', k: 0.58 },
      { x: (smidX - 2) * 0.75, y: 7.0, z: (sz0 + 6) * 0.75, activity: 'study', k: 0.57 },
      { x: (smidX + 2) * 0.75, y: 7.0, z: (sz0 + 6) * 0.75, activity: 'study', k: 0.61 }
    ];
    kids.forEach(k => this.world.schoolChildren.push(k));
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

  // MARKET: cam cepheli bağımsız SÜPERMARKET; raflı reyonlar, yiyecek/içecekler, kasalar ve dondurucu dolabı
  buildMarket(x1, y1, z1, x2, y2, z2) {
    const w = this.b, vw = this.world;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 2, x1, y1 + 4, zc + 2);
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 3, zc - 4, PALETTE.GLASS);
    w.fillBox(x1, y1 + 1, zc + 4, x1, y2 - 3, z2 - 2, PALETTE.GLASS);

    // Neon Tabela: SÜPERMARKET
    const kit = new Kit(vw);
    kit.sign('SÜPERMARKET', { neon: true, color: 0x16a34a, fg: 0xffffff, w: 6.4, h: 1.2 }, (x1 - 0.25) * 0.75, (y1 + 7) * 0.5, zc * 0.75, Math.PI / 2);

    const goods = [PALETTE.GOLD, PALETTE.BRICK, PALETTE.ROOF, PALETTE.GLASS];
    const snackKinds = ['chips', 'cola', 'iced_tea', 'brownie', 'pasta', 'rice', 'bread', 'water_bottle', 'canned_food'];
    for (let ax = x1 + 4; ax <= x2 - 5; ax += 3) {
      w.fillBox(ax, y1, z1 + 2, ax, y1 + 3, z2 - 6, PALETTE.WOOD);
      for (let z = z1 + 3; z <= z2 - 7; z += 2) {
        w.fillBox(ax + 1, y1 + 1, z, ax + 1, y1 + 1, z, goods[(z + ax) & 3]);
        w.fillBox(ax + 1, y1 + 3, z, ax + 1, y1 + 3, z, goods[(z + ax + 1) & 3]);
        // Tutulabilir market ürünleri: cips, kola, buzlu çay, brownie, makarna, pilav, ekmek
        const k = snackKinds[(z + ax) % snackKinds.length];
        vw.propSpawns.push({ kind: k, x: (ax + 1) * 0.75, y: (y1 + 3.5) * 0.5, z: z * 0.75 });
      }
    }

    // Manav Meyve-Sebze Reyonu (kasalar dolusu taze meyve ve sebze)
    w.fillBox(x1 + 3, y1, z1 + 3, x1 + 5, y1 + 1, z1 + 5, PALETTE.WOOD);
    vw.propSpawns.push({ kind: 'produce_crate', x: (x1 + 4) * 0.75, y: (y1 + 1.6) * 0.5, z: (z1 + 4) * 0.75 });

    // Soğutucu dolap ve kasa
    w.fillBox(x2 - 2, y1, z1 + 2, x2 - 1, y1 + 3, z2 - 6, PALETTE.IRON);
    w.fillBox(x2 - 3, y1 + 1, z1 + 2, x2 - 3, y1 + 3, z2 - 6, PALETTE.GLASS);
    // Kasa tezgâhı ve kasa
    const csX = x1 + 2;
    w.fillBox(csX, y1, zc + 2, csX + 1, y1 + 2, zc + 5, PALETTE.WHITE);
    vw.propSpawns.push({ kind: 'cash_register', x: (csX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (zc + 3.5) * 0.75, yaw: -Math.PI / 2 });
    vw.workers.push({ x: (csX + 0.2) * 0.75, y: 0.5, z: (zc + 3.5) * 0.75, yaw: Math.PI / 2, pose: 'stand', style: 'shop', shirt: 0x16a34a });

    // Market Önü Kedileri (yatan kedi, yürüyen kedi, maskot kedi ve mama kabı)
    vw.marketCats = vw.marketCats || [];
    vw.marketCats.push({ x: (x1 - 1.8) * 0.75, y: 0.5, z: zc * 0.75 });

    // Süpermarket Müşterileri (raflardan ürün alıp kasada ödeyen ve poşetle çıkan yapay zeka)
    vw.marketShoppers = vw.marketShoppers || [];
    vw.marketShoppers.push({
      spawnPos: { x: (x1 - 2.8) * 0.75, y: 0.5, z: zc * 0.75 },
      aislePos1: { x: (x1 + 4.5) * 0.75, y: 0.5, z: (zc - 2) * 0.75 },
      aislePos2: { x: (x1 + 4) * 0.75, y: 0.5, z: (z1 + 4) * 0.75 },
      cashierPos: { x: (csX + 1.4) * 0.75, y: 0.5, z: (zc + 3.5) * 0.75 },
      exitPos: { x: (x1 - 3.8) * 0.75, y: 0.5, z: zc * 0.75 }
    });

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
  }

  // MAHALLE BAKKALI: Taze ekmek bölmesi, bakkal amca, ekmek alan çocuklar
  buildBakkal(x1, y1, z1, x2, y2, z2) {
    const w = this.b, vw = this.world;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    const zc = Math.round((z1 + z2) / 2);
    // Vitrin camı ve giriş kapısı (+x yönüne doğru açılır)
    w.clearBox(x2, y1, zc - 1, x2, y1 + 4, zc + 1);
    w.fillBox(x2, y1 + 1, z1 + 1, x2, y2 - 2, zc - 2, PALETTE.GLASS);
    w.fillBox(x2, y1 + 1, zc + 2, x2, y2 - 2, z2 - 1, PALETTE.GLASS);

    // Bakkal Tabelası
    const kit = new Kit(vw);
    kit.sign('MAHALLE BAKKALI', { neon: true, color: 0xb45309, fg: 0xfef08a, w: 5.6, h: 1.1 }, (x2 + 0.25) * 0.75, (y1 + 5.5) * 0.5, zc * 0.75, -Math.PI / 2);

    // Ekmek Dolabı / Rafları (Ahşap bölmeler ve taze ekmekler)
    w.fillBox(x1 + 1, y1, z1 + 1, x1 + 2, y1 + 3, zc - 1, PALETTE.WOOD);
    for (let z = z1 + 2; z <= zc - 2; z += 2) {
      vw.propSpawns.push({ kind: 'bread', x: (x1 + 1.5) * 0.75, y: (y1 + 3.5) * 0.5, z: z * 0.75 });
      vw.propSpawns.push({ kind: 'bread', x: (x1 + 1.5) * 0.75, y: (y1 + 1.8) * 0.5, z: z * 0.75 });
    }

    // Atıştırmalıklar ve içecekler
    vw.propSpawns.push({ kind: 'cola', x: (x1 + 1.5) * 0.75, y: (y1 + 3.5) * 0.5, z: (zc + 2) * 0.75 });
    vw.propSpawns.push({ kind: 'iced_tea', x: (x1 + 1.5) * 0.75, y: (y1 + 3.5) * 0.5, z: (zc + 4) * 0.75 });
    vw.propSpawns.push({ kind: 'chips', x: (x1 + 3.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (z2 - 2) * 0.75 });

    // Kasa Tezgâhı & Bakkal Amca
    const csX = x2 - 2;
    w.fillBox(csX - 1, y1, zc - 2, csX, y1 + 2, zc - 1, PALETTE.WHITE);
    vw.propSpawns.push({ kind: 'cash_register', x: (csX - 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (zc - 1.5) * 0.75, yaw: Math.PI / 2 });
    vw.workers.push({ x: (csX - 0.8) * 0.75, y: 0.5, z: (zc - 1.5) * 0.75, yaw: -Math.PI / 2, pose: 'stand', style: 'shop', shirt: 0xd97706 });

    // Bakkala gelip ekmek alan çocuk
    vw.bakkalKids = vw.bakkalKids || [];
    vw.bakkalKids.push({
      spawnPos: { x: (x2 + 3.5) * 0.75, y: 0.5, z: zc * 0.75 },
      shelfPos: { x: (x1 + 2.8) * 0.75, y: 0.5, z: (z1 + 2) * 0.75 },
      cashierPos: { x: (csX - 0.4) * 0.75, y: 0.5, z: (zc - 1.5) * 0.75 },
      exitPos: { x: (x2 + 4.5) * 0.75, y: 0.5, z: zc * 0.75 }
    });

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x2');
  }

  // TEKNO MARKET (AVM dışı bağımsız teknoloji mağazası):
  // Cam cephe, parlak neon tabela, tavanda endüstriyel havalandırma kanalları ve menfezler,
  // masaüstü oyun bilgisayarları (desktop_pc), laptoplar, telefonlar (phone), oyun konsolları (game_console) ve POS kasa (cash_register).
  buildOutdoorTeknoMarket(x1, y1, z1, x2, y2, z2) {
    const w = this.b, vw = this.world;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    const zc = Math.round((z1 + z2) / 2);
    // Geniş cam vitrin ve giriş kapısı (batı yüzü)
    w.clearBox(x1, y1, zc - 2, x1, y1 + 5, zc + 2);
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 2, zc - 3, PALETTE.GLASS);
    w.fillBox(x1, y1 + 1, zc + 3, x1, y2 - 2, z2 - 2, PALETTE.GLASS);

    // Dış neon tabela: TEKNO MARKET
    const kit = new Kit(vw);
    kit.sign('TEKNO MARKET', { neon: true, color: 0x0f172a, fg: 0x38bdf8, w: 6.4, h: 1.2 }, (x1 - 0.25) * 0.75, (y1 + 7) * 0.5, zc * 0.75, Math.PI / 2);

    // 1) Tavanda detaylı endüstriyel havalandırma kanalları (gümüş borular, bağlantılar ve menfez ızgaraları)
    for (let ax = x1 + 2; ax <= x2 - 2; ax += 3) {
      w.fillBox(ax, y2 - 2, z1 + 2, ax, y2 - 2, z2 - 2, PALETTE.IRON); // boyuna hava kanalları
      for (let az = z1 + 4; az <= z2 - 4; az += 4) {
        w.fillBox(ax, y2 - 3, az, ax, y2 - 3, az, PALETTE.BLACK); // menfez ızgarası
      }
    }
    w.fillBox(x1 + 2, y2 - 2, zc, x2 - 2, y2 - 2, zc, PALETTE.IRON); // enine ana kanal

    // 2) Bilgisayar Reyonu: Masaüstü oyun bilgisayarları (desktop_pc) ve laptoplar
    const pcX = Math.round(x1 + 3);
    w.fillBox(pcX, y1, z1 + 3, pcX + 1, y1 + 2, zc - 3, PALETTE.IRON);
    w.fillBox(pcX, y1 + 2, z1 + 3, pcX + 1, y1 + 2, zc - 3, PALETTE.GLASS);
    for (let z = z1 + 4; z <= zc - 4; z += 4) {
      vw.propSpawns.push({ kind: 'desktop_pc', x: (pcX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: z * 0.75, yaw: Math.PI / 2 });
      vw.propSpawns.push({ kind: 'laptop', x: (pcX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (z + 2) * 0.75, yaw: Math.PI / 2 });
    }

    // 3) Akıllı Telefon ve Tablet vitrini
    const phX = Math.round(x1 + 6);
    w.fillBox(phX, y1, z1 + 3, phX + 1, y1 + 2, zc - 3, PALETTE.IRON);
    w.fillBox(phX, y1 + 2, z1 + 3, phX + 1, y1 + 2, zc - 3, PALETTE.GLASS);
    for (let z = z1 + 4; z <= zc - 4; z += 2) {
      vw.propSpawns.push({ kind: 'phone', x: (phX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: z * 0.75 });
    }

    // 4) Oyun Konsolları (PlayStation / Xbox) Demo Alanı
    const conX = Math.round(x1 + 6);
    w.fillBox(conX, y1, zc + 3, conX + 1, y1 + 2, z2 - 3, PALETTE.WOOD);
    w.fillBox(conX, y1 + 2, zc + 3, conX + 1, y1 + 2, z2 - 3, PALETTE.CONCRETE);
    for (let z = zc + 4; z <= z2 - 4; z += 4) {
      w.fillBox(conX - 1, y1 + 3, z, conX - 1, y1 + 5, z + 2, PALETTE.LAMP_BLUE); // parlayan TV demo ekranı
      vw.propSpawns.push({ kind: 'game_console', x: (conX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (z + 1) * 0.75, yaw: Math.PI / 2 });
    }

    // 5) Kasa Alanı: Kasa tezgâhı, POS kasaları (cash_register) ve kasiyer
    const csX = x1 + 2;
    w.fillBox(csX, y1, zc + 3, csX + 2, y1 + 2, zc + 6, PALETTE.WHITE);
    vw.propSpawns.push({ kind: 'cash_register', x: (csX + 1) * 0.75, y: (y1 + 2.5) * 0.5, z: (zc + 4.5) * 0.75, yaw: -Math.PI / 2 });
    vw.workers.push({ x: (csX + 0.4) * 0.75, y: 0.5, z: (zc + 4.5) * 0.75, yaw: Math.PI / 2, pose: 'stand', style: 'shop', shirt: 0x0f172a });

    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
  }

  // MODA & GİYİM (AVM dışı bağımsız giyim mağazası):
  // Kıyafet askılıkları, ayakkabılar, çantalar, vitrin ve kasa
  buildOutdoorFashionStore(x1, y1, z1, x2, y2, z2) {
    const w = this.b, vw = this.world;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    const zc = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, zc - 2, x1, y1 + 5, zc + 2);
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 2, zc - 3, PALETTE.GLASS);
    w.fillBox(x1, y1 + 1, zc + 3, x1, y2 - 2, z2 - 2, PALETTE.GLASS);

    const kit = new Kit(vw);
    kit.sign('MODA & GİYİM', { neon: true, color: 0x7c3aed, fg: 0xffffff, w: 6.4, h: 1.2 }, (x1 - 0.25) * 0.75, (y1 + 7) * 0.5, zc * 0.75, Math.PI / 2);

    // Kıyafet askıları ve raflar
    const rkX = Math.round(x1 + 3);
    for (let z = z1 + 4; z <= z2 - 4; z += 5) {
      w.fillBox(rkX, y1, z, rkX, y1 + 4, z + 3, PALETTE.IRON);
      vw.propSpawns.push({ kind: 'shirt', x: (rkX + 0.4) * 0.75, y: (y1 + 3) * 0.5, z: (z + 1.5) * 0.75 });
      vw.propSpawns.push({ kind: 'jacket', x: (rkX + 0.4) * 0.75, y: (y1 + 3) * 0.5, z: (z + 2.5) * 0.75 });
    }
    // Ayakkabı ve çanta reyonu
    const shX = Math.round(x1 + 6);
    w.fillBox(shX, y1, z1 + 3, shX + 1, y1 + 2, z2 - 3, PALETTE.WOOD);
    for (let z = z1 + 4; z <= z2 - 4; z += 3) {
      vw.propSpawns.push({ kind: 'shoe', x: (shX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: z * 0.75 });
      vw.propSpawns.push({ kind: 'bag', x: (shX + 0.5) * 0.75, y: (y1 + 2.5) * 0.5, z: (z + 1.5) * 0.75 });
    }
    // Kasa
    const csX = x1 + 2;
    w.fillBox(csX, y1, zc + 3, csX + 2, y1 + 2, zc + 6, PALETTE.WHITE);
    vw.propSpawns.push({ kind: 'cash_register', x: (csX + 1) * 0.75, y: (y1 + 2.5) * 0.5, z: (zc + 4.5) * 0.75, yaw: -Math.PI / 2 });
    vw.workers.push({ x: (csX + 0.4) * 0.75, y: 0.5, z: (zc + 4.5) * 0.75, yaw: Math.PI / 2, pose: 'stand', style: 'shop', shirt: 0x7c3aed });

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
      [392, 118, 11, 4.5], [402, -118, 11, 4.5], [418, 110, 8, 3.5]
    ];
    const paved = [[258, 370, -170, 170], [286, 325, -170, 170], [370, 428, -74, 74]];
    const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const edgeDist = (x, z) => Math.min(x - 258, 427 - x, 165 - z, z + 165);
    // ── ÜST GEÇİT RAMPALARI: basamaksız, doğrusal eğim ──
    // Batı rampa 258..286 (21 m, köprü ucundan başlar); doğu rampa 325..360 (26 m; sinema/villa x≥362'de başlar). Üst geçit tabliyesi 4.5 m kaydırma + 0.5 zemin = 5.0 m.
    // Uçlarda parabolik yumuşatma (e): rampa zemine ve tabliyeye pürüzsüzce bağlanır, tümsek yapmaz.
    const lin = (t) => { const e = 0.1, sl = 1 / (1 - e); t = Math.max(0, Math.min(1, t)); return t < e ? sl * t * t / (2 * e) : t > 1 - e ? 1 - sl * (1 - t) * (1 - t) / (2 * e) : sl * (t - e / 2); };
    this.world.terrain.rampProfile = (xm, zm) => {
      if (xm >= 295) return villaRoadProfile(xm, zm);   // villa yolu (zengin meydanından doğuya)
      const x = xm / U;
      if (x >= 258 && x < 286) return 4.5 * lin((x - 258) / 28);
      if (x >= 286 && x <= 325) return 4.5;
      if (x > 325 && x < 360) return 4.5 * (1 - lin((x - 325) / 35));
      return 0;
    };
    this.world.terrain.rampArea = (xm, zm) => { if (xm >= 295) return xm < 455 && zm > -95 && zm < 12; const x = xm / U; return Math.abs(zm / U) <= 6.6 && ((x >= 258 && x < 286) || (x >= 325 && x < 360)); };   // x≥295 m: yalnız villa yolu asfaltı vardır
    this.world.terrain.heightFn = (xm, zm, mat) => {
      const x = xm / U, z = zm / U;
      if (!mat || !mat.isGrass) return 0;
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

  furnish(x1, y1, z1, x2, y2, z2, kind, side = 'z1') {
    const W = x2 - x1, D = z2 - z1;
    if (W < 6 || D < 8) return;
    // Tür verilmediyse yüksekliğe göre: alçak = dükkân, orta = müstakil ev, yüksek = ofis, çok yüksek = apartman
    if (!kind) { const hRows = y2 - y1; kind = hRows >= 20 ? 'apt' : hRows >= 12 ? 'office' : hRows >= 8 ? 'house' : 'shop'; }
    const bases = [GROUND_ROW_SUB];
    if (y1 + 6 < y2 - 2) bases.push(GROUND_ROW_SUB + 19);           // 1. kat döşemesinin üstü
    if (y1 + 12 < y2 - 2) bases.push(GROUND_ROW_SUB + 37);          // 2. kat döşemesinin üstü
    const xa = x1 + 2, xb = x2 - 5, za = z1 + 4, zb = z2 - 2;       // kullanılabilir alan (kapıdan ve merdivenden uzak)
    const F = (b, ...a) => this.furn(b, ...a);

    let officeBldId = null, officeDoorPos = null;
    if (kind === 'office') {
      officeBldId = `ofis-${x1}-${z1}`;
      const cxm = 0.75 * Math.round((x1 + x2) / 2), czm = 0.75 * Math.round((z1 + z2) / 2);
      officeDoorPos = side === 'x1' ? { x: 0.75 * x1, y: 0.5, z: czm, outX: -1, outZ: 0, chokeX: 0.75 * (x1 + 1.6), chokeZ: czm }
        : side === 'x2' ? { x: 0.75 * x2, y: 0.5, z: czm, outX: 1, outZ: 0, chokeX: 0.75 * (x2 - 1.6), chokeZ: czm }
        : side === 'z2' ? { x: cxm, y: 0.5, z: 0.75 * z2, outX: 0, outZ: 1, chokeX: cxm, chokeZ: 0.75 * (z2 - 1.6) }
        : { x: cxm, y: 0.5, z: 0.75 * z1, outX: 0, outZ: -1, chokeX: cxm, chokeZ: 0.75 * (z1 + 1.6) };
      this.world.officeBuildings = this.world.officeBuildings || [];
      this.world.officeBuildings.push({
        id: officeBldId,
        minX: 0.75 * x1 - 1.2, maxX: 0.75 * x2 + 1.2,
        minZ: 0.75 * z1 - 1.2, maxZ: 0.75 * z2 + 1.2,
        damage: 0, evacuated: false, doorPos: officeDoorPos
      });
    }

    bases.forEach((b, fi) => {
      const floorY = fi === 0 ? 0.5 : fi === 1 ? 5.5 : 10.0;
      const deskTopY = (Math.floor((b + 2) / 2) + 1) * 0.5;
      if (kind === 'office') {
        const wy = b * 0.25;
        const stX = 0.75 * (x2 - 3);
        const zs0 = (K * z1 - 1 + 9) * 0.25;
        const zs1 = zs0 + 19 * 0.25;
        const zs2 = zs1 + 19 * 0.25;
        for (let z = za + 1; z < zb - 2; z += 5) for (let x = xa; x + 3 <= xb; x += 5) {
          F(b, x, z, x + 2, z + 1, 3, PALETTE.WOOD);                      // masa
          const wx = (x + 1) * 0.75, wz = (z + 2.2) * 0.75;
          // Teknomarket tarzı RGB kasa ve ultra-wide ekranlı masaüstü bilgisayar + modern laptop
          this.world.propSpawns.push({ kind: 'desktop_pc', x: wx, y: deskTopY + 0.24, z: (z + 0.5) * 0.75, yaw: Math.PI });
          if ((x + z) % 2 === 0) {
            this.world.propSpawns.push({ kind: 'laptop', x: wx + 0.45, y: deskTopY + 0.24, z: (z + 0.5) * 0.75, yaw: Math.PI + 0.1 });
          }
          this.world.propSpawns.push({ kind: 'chair', x: wx, y: wy + 0.46, z: wz, yaw: Math.PI, color: 0x1e293b });
          // Merdivenlerden dar çıkış kapısına iniş rotası
          const exitPath = [];
          if (fi === 2) {
            exitPath.push({ x: stX, y: wy, z: zs2, tol: 0.55 });
            exitPath.push({ x: stX, y: (GROUND_ROW_SUB + 19) * 0.25, z: zs1, tol: 0.55 });
          }
          if (fi >= 1) {
            exitPath.push({ x: stX, y: (GROUND_ROW_SUB + 19) * 0.25, z: zs1, tol: 0.55 });
            exitPath.push({ x: stX, y: 0.5, z: zs0, tol: 0.55 });
          }
          exitPath.push({ x: officeDoorPos.chokeX, y: 0.5, z: officeDoorPos.chokeZ, choke: true, tol: 0.45 });
          exitPath.push({ x: officeDoorPos.x, y: 0.5, z: officeDoorPos.z, door: true, tol: 0.45 });
          exitPath.push({ x: officeDoorPos.x + officeDoorPos.outX * 2.5, y: 0.5, z: officeDoorPos.z + officeDoorPos.outZ * 2.5, outside: true, tol: 0.7 });
          this.world.workers.push({
            x: wx, y: wy, z: wz, yaw: Math.PI, pose: 'sit', style: 'office',
            buildingId: officeBldId, doorPos: officeDoorPos, exitPath
          });
        }
        return;
      }
      if (kind === 'school') {      // sınıf: sıralar, öğretmen masası, kara tahta
        for (let z = za + 1; z < zb - 3; z += 4) for (let x = xa; x + 2 <= xb; x += 4) { F(b, x, z, x + 1, z, 3, PALETTE.WOOD); F(b, x, z + 1, x, z + 1, 2, PALETTE.ROOF); }
        F(b, xa, zb, xb, zb, 7, PALETTE.IRON); F(b, xa + 1, zb - 1, xb - 1, zb - 1, 1, PALETTE.WOOD, 0);
        return;
      }
      if (kind === 'police') {      // karakol: masalar + normal bilgisayarlar, dosya dolapları, demir parmaklıklı nezarethane
        for (let x = xa; x + 3 <= xb; x += 5) {
          F(b, x, za + 2, x + 2, za + 3, 3, PALETTE.WOOD);
          this.world.propSpawns.push({ kind: 'desktop_pc', x: (x + 1) * 0.75, y: deskTopY + 0.24, z: (za + 2.5) * 0.75, yaw: Math.PI });
        }
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
          // Yemek masası üstü eşyaları: tabaklar, çatallar, kaşıklar, bıçaklar, bardaklar
          const dtx = (xa + 2.0) * 0.75, dtz = (zb - 5.0) * 0.75, dtBaseY = floorY + 0.85;
          this.world.propSpawns.push({ kind: 'plate', x: dtx, y: dtBaseY, z: dtz });
          this.world.propSpawns.push({ kind: 'fork', x: dtx - 0.20, y: dtBaseY, z: dtz, yaw: 1.57 });
          this.world.propSpawns.push({ kind: 'knife', x: dtx + 0.20, y: dtBaseY, z: dtz, yaw: 1.57 });
          this.world.propSpawns.push({ kind: 'spoon', x: dtx + 0.32, y: dtBaseY, z: dtz, yaw: 1.57 });
          this.world.propSpawns.push({ kind: 'mug', x: dtx, y: dtBaseY + 0.05, z: dtz + 0.24 });
        }
        // Mutfak tezgâhı üstüne çatal, kaşık, bıçak, kupa bardak ve tabak
        const kx = (xa + 3.0) * 0.75, kz = zk * 0.75, kBaseY = floorY + 1.15;
        this.world.propSpawns.push({ kind: 'fork', x: kx - 0.25, y: kBaseY, z: kz, yaw: 1.57 });
        this.world.propSpawns.push({ kind: 'spoon', x: kx - 0.12, y: kBaseY, z: kz, yaw: 1.57 });
        this.world.propSpawns.push({ kind: 'knife', x: kx + 0.02, y: kBaseY, z: kz, yaw: 1.57 });
        this.world.propSpawns.push({ kind: 'plate', x: kx + 0.25, y: kBaseY, z: kz });
        this.world.propSpawns.push({ kind: 'mug', x: kx + 0.45, y: kBaseY + 0.05, z: kz });
        // Evlerde / apartmanlarda mutfak tezgâhının başında yemek hazırlayan aile bireyi
        if (fi <= 1) {
          this.world.workers.push({
            x: (xa + 2.2) * 0.75, y: floorY, z: (zk - 1.15) * 0.75,
            yaw: 0, pose: 'stand', style: null, cook: true
          });
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
      // Yatak odası (ön): Teardown tarzı gerçekçi yatak (baza, şilte, yastıklar, nevresim, ayak ucu şalı, komodin ve abajur)
      F(b, xa, bz, mn(xa + 2), bz + 3, 1, PALETTE.WOOD);                      // ahşap baza
      F(b, xa, bz, mn(xa + 2), bz, 3, PALETTE.WOOD);                          // şık ahşap başlık
      F(b, xa, bz, mn(xa + 2), bz + 3, 1, PALETTE.WHITE, 1);                  // kalın konforlu şilte
      F(b, xa, bz, mn(xa + 2), bz, 1, PALETTE.WHITE, 2);                      // kabarık yastıklar
      F(b, xa, bz + 1, mn(xa + 2), bz + 1, 1, PALETTE.WHITE, 2);              // katlanmış beyaz nevresim kıvrımı
      F(b, xa, bz + 2, mn(xa + 2), bz + 3, 1, PALETTE.BRICK, 2);              // dökümlü yorgan
      F(b, xa, bz + 3, mn(xa + 2), bz + 3, 1, PALETTE.GOLD, 2);               // ayak ucu şalı
      if (aw >= 4) {
        F(b, xa + 3, bz, xa + 3, bz, 2, PALETTE.WOOD);                        // komodin
        F(b, xa + 3, bz, xa + 3, bz, 1, PALETTE.LAMP, 2);                      // başucu lambası
      }
      if (aw >= 6) F(b, xa + 5, bz, mn(xa + 6), bz + 1, 8, PALETTE.ROOF);      // gardırop
      // Salon (orta): kanepe, sehpa, televizyon + sehpası ve televizyon izleyen aile bireyleri
      const lz = Math.round((za + zb) / 2) - 1;
      if (aw >= 3) {
        F(b, xa, lz, mn(xa + 3), lz + 1, 2, PALETTE.BRICK);                    // kanepe
        F(b, xa, lz + 1, mn(xa + 3), lz + 1, 3, PALETTE.BRICK);                // sırtlık
        F(b, xa + 1, lz - 3, mn(xa + 2), lz - 2, 2, PALETTE.WOOD);             // sehpa
        F(b, xa, lz - 7, mn(xa + 3), lz - 7, 2, PALETTE.IRON);                 // TV sehpası
        F(b, xa + 1, lz - 7, mn(xa + 2), lz - 7, 2, PALETTE.LAMP_BLUE, 2);     // parlak TV ekranı
        if (fi <= 1) {
          this.world.propSpawns.push({ kind: 'remote', x: (xa + 1.5) * 0.75, y: floorY + 0.56, z: (lz - 2.5) * 0.75, yaw: Math.PI });
          this.world.propSpawns.push({ kind: 'mug', x: (xa + 1.2) * 0.75, y: floorY + 0.58, z: (lz - 2.5) * 0.75 });
          // Kanepede oturup televizyon izleyen aile üyeleri (anne/baba + çocuk/eş)
          this.world.workers.push({
            x: (xa + 0.85) * 0.75, y: floorY, z: (lz - 0.15) * 0.75,
            yaw: Math.PI, pose: 'sit', style: null, watchTV: true
          });
          if (aw >= 4) {
            this.world.workers.push({
              x: (xa + 2.25) * 0.75, y: floorY, z: (lz - 0.15) * 0.75,
              yaw: Math.PI, pose: 'sit', style: null, watchTV: true, k: (x1 + z1 + fi) % 2 === 0 ? 0.78 : 1.0
            });
          }
        }
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

  // Teardown tarzı mutfak kurulumu: sağ tıkla açılan alt/üst dolaplar, çekmeceler, fırın (içinde kek ve tepsiler), buzdolabı ve kırılabilir mutfak eşyaları
  _buildTeardownKitchen(grp, floorY, wallX, zStart) {
    const vw = this.world, doors = vw.doors;
    const cabMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
    const counterMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x9a6432 });
    const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    const burnerMat = new THREE.MeshLambertMaterial({ color: 0x0f172a });
    const glowRing = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const fridgeMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });

    const box = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
      return m;
    };
    const addShelf = (x0, x1, z0, z1, y) => {
      vw.shelves.push({ x0, x1, z0, z1, y });
    };
    const addProp = (kind, x, baseY, z, opts = {}) => {
      const hy = {
        canned_food: 0.085, water_bottle: 0.18, cat_food: 0.095, flour: 0.15,
        cola: 0.11, cake: 0.09, baking_tray: 0.03, plate: 0.025, spoon: 0.018, fork: 0.018,
        knife: 0.025, mug: 0.07, remote: 0.045
      }[kind] || 0.08;
      vw.propSpawns.push({ kind, x, y: baseY + hy + 0.008, z, ...opts });
    };

    const D = 0.62;                    // tezgâh/dolap derinliği (m)
    const xFront = wallX + D;          // ön kapakların X düzlemi (+X yönüne, odaya bakar)
    const xMid = wallX + D * 0.5;

    // ── 1) ALT DOLAP (2 kapaklı: zStart .. zStart + 1.60) ──
    const c1Z0 = zStart, c1W = 1.60, c1H = 0.86;
    box(D, 0.04, c1W, xMid, floorY + 0.02, c1Z0 + c1W / 2, cabMat);               // alt taban
    box(D, 0.03, c1W - 0.04, xMid, floorY + 0.43, c1Z0 + c1W / 2, woodMat);       // orta raf
    box(D + 0.04, 0.05, c1W + 0.04, xMid, floorY + c1H + 0.025, c1Z0 + c1W / 2, counterMat); // tezgâh üstü
    box(D, c1H, 0.04, xMid, floorY + c1H / 2, c1Z0 + 0.02, cabMat);               // sol dikme
    box(D, c1H, 0.04, xMid, floorY + c1H / 2, c1Z0 + c1W / 2, cabMat);            // orta dikme
    box(D, c1H, 0.04, xMid, floorY + c1H / 2, c1Z0 + c1W - 0.02, cabMat);         // sağ dikme
    addShelf(wallX + 0.04, xFront - 0.02, c1Z0 + 0.02, c1Z0 + c1W - 0.02, floorY + 0.04);
    addShelf(wallX + 0.04, xFront - 0.02, c1Z0 + 0.02, c1Z0 + c1W - 0.02, floorY + 0.445);
    addShelf(wallX + 0.02, xFront + 0.02, c1Z0, c1Z0 + c1W, floorY + c1H + 0.05);
    // Sağ tıkla açılan 2 alt dolap kapağı
    doors.addHinged({ hx: xFront, hz: c1Z0 + 0.03, ax: 0, az: 1, width: 0.75, height: 0.80, y: floorY + 0.04, color: 0xf1f5f9, cabinet: true, minAngle: -2.1, maxAngle: 0.05 });
    doors.addHinged({ hx: xFront, hz: c1Z0 + 0.82, ax: 0, az: 1, width: 0.75, height: 0.80, y: floorY + 0.04, color: 0xf1f5f9, cabinet: true, minAngle: -2.1, maxAngle: 0.05 });
    // Alt dolap içi eşyalar: un, kedi maması, konserveler, tabaklar
    addProp('flour', xMid + 0.04, floorY + 0.04, c1Z0 + 0.28, { yaw: 1.57 });
    addProp('flour', xMid - 0.04, floorY + 0.04, c1Z0 + 0.56, { yaw: 1.4 });
    addProp('cat_food', xMid + 0.05, floorY + 0.04, c1Z0 + 1.05, { yaw: 1.57 });
    addProp('cat_food', xMid + 0.05, floorY + 0.04, c1Z0 + 1.35, { yaw: 1.5 });
    addProp('canned_food', xMid + 0.06, floorY + 0.45, c1Z0 + 0.24, { color: 0xdc2626 });
    addProp('canned_food', xMid + 0.06, floorY + 0.45, c1Z0 + 0.46, { color: 0x16a34a });
    addProp('canned_food', xMid + 0.06, floorY + 0.45, c1Z0 + 0.66, { color: 0xf59e0b });
    addProp('plate', xMid + 0.02, floorY + 0.45, c1Z0 + 1.08);
    addProp('plate', xMid + 0.02, floorY + 0.45, c1Z0 + 1.38);

    // ── 2) ÇEKMECELİ ÜNİTE (3 çekmeceli: içlerinde kaşık ve çatallar!) ──
    const drZ0 = c1Z0 + c1W + 0.02, drW = 0.78;
    box(D + 0.04, 0.05, drW + 0.04, xMid, floorY + c1H + 0.025, drZ0 + drW / 2, counterMat); // tezgâh üstü
    box(D, c1H, 0.04, xMid, floorY + c1H / 2, drZ0 + drW - 0.02, cabMat);
    addShelf(wallX + 0.02, xFront + 0.02, drZ0, drZ0 + drW, floorY + c1H + 0.05);
    for (let k = 0; k < 3; k++) {
      const dy = floorY + 0.05 + k * 0.27;
      doors.addDrawer({
        hx: xFront, hz: drZ0 + 0.03, ax: 0, az: 1, nx: 1, nz: 0,
        width: drW - 0.06, height: 0.24, depth: 0.50, y: dy, color: 0xe2e8f0
      });
      // Her çekmecenin içinde kaşıklar, çatallar ve bıçaklar!
      addProp('spoon', xFront - 0.22, dy + 0.025, drZ0 + 0.18, { yaw: 1.57 });
      addProp('spoon', xFront - 0.34, dy + 0.025, drZ0 + 0.28, { yaw: 1.57 });
      addProp('fork', xFront - 0.22, dy + 0.025, drZ0 + 0.40, { yaw: 1.57 });
      addProp('fork', xFront - 0.34, dy + 0.025, drZ0 + 0.52, { yaw: 1.57 });
      addProp('knife', xFront - 0.28, dy + 0.025, drZ0 + 0.64, { yaw: 1.57 });
    }

    // ── 3) FIRIN & OCAK (sağ tıkla aşağı açılan camlı fırın kapağı, içinde tepsiler ve kek!) ──
    const ovZ0 = drZ0 + drW + 0.02, ovW = 0.88;
    box(D, 0.05, ovW, xMid, floorY + 0.025, ovZ0 + ovW / 2, darkMetal);          // fırın alt tabanı
    box(D, c1H, 0.05, xMid, floorY + c1H / 2, ovZ0 + 0.025, darkMetal);          // fırın sol yan
    box(D, c1H, 0.05, xMid, floorY + c1H / 2, ovZ0 + ovW - 0.025, darkMetal);    // fırın sağ yan
    box(D, 0.06, ovW, xMid, floorY + c1H + 0.02, ovZ0 + ovW / 2, darkMetal);     // ocak üst tablası
    // Ocak gözleri (4 adet)
    for (const [bx, bz] of [[-0.14, 0.24], [0.12, 0.24], [-0.14, 0.64], [0.12, 0.64]]) {
      box(0.18, 0.02, 0.18, xMid + bx, floorY + c1H + 0.06, ovZ0 + bz, burnerMat);
      box(0.12, 0.024, 0.12, xMid + bx, floorY + c1H + 0.062, ovZ0 + bz, glowRing);
    }
    // Fırın iç rafları + iç aydınlatması
    box(D - 0.08, 0.02, ovW - 0.10, xMid, floorY + 0.24, ovZ0 + ovW / 2, counterMat);
    box(D - 0.08, 0.02, ovW - 0.10, xMid, floorY + 0.50, ovZ0 + ovW / 2, counterMat);
    addShelf(wallX + 0.04, xFront - 0.02, ovZ0 + 0.04, ovZ0 + ovW - 0.04, floorY + 0.25);
    addShelf(wallX + 0.04, xFront - 0.02, ovZ0 + 0.04, ovZ0 + ovW - 0.04, floorY + 0.51);
    addShelf(wallX + 0.02, xFront + 0.02, ovZ0, ovZ0 + ovW, floorY + c1H + 0.05);
    // Sağ tıkla aşağı doğru açılan fırın kapağı
    doors.addOvenDoor({
      hx: xFront, hz: ovZ0 + 0.04, ax: 0, az: 1, nx: 1, nz: 0,
      width: ovW - 0.08, height: 0.76, y: floorY + 0.06
    });
    // Fırının içinde tepsiler ve tepsinin üstünde kek!
    addProp('baking_tray', xMid + 0.02, floorY + 0.25, ovZ0 + ovW / 2, { yaw: 1.57 });
    addProp('baking_tray', xMid + 0.02, floorY + 0.51, ovZ0 + ovW / 2 - 0.16, { yaw: 1.57 });
    addProp('cake', xMid + 0.03, floorY + 0.51, ovZ0 + ovW / 2 + 0.14, { yaw: 0.4 });

    // ── 4) BUZDOLABI (Çift kapaklı: üst buzluk + alt soğutucu, sağ tıkla açılır, içinde su, kola, konserve, kedi maması) ──
    const frZ0 = ovZ0 + ovW + 0.06, frW = 0.92, frH = 1.92, frD = 0.68;
    const frFront = wallX + frD, frMid = wallX + frD * 0.5;
    box(frD, 0.05, frW, frMid, floorY + 0.025, frZ0 + frW / 2, fridgeMat);        // alt taban
    box(frD, 0.05, frW, frMid, floorY + frH - 0.025, frZ0 + frW / 2, fridgeMat);  // üst tavan
    box(frD, frH, 0.05, frMid, floorY + frH / 2, frZ0 + 0.025, fridgeMat);        // sol duvar
    box(frD, frH, 0.05, frMid, floorY + frH / 2, frZ0 + frW - 0.025, fridgeMat);  // sağ duvar
    // Buzdolabı iç rafları (3 kat)
    for (const ry of [0.52, 0.98, 1.38]) {
      box(frD - 0.08, 0.025, frW - 0.10, frMid, floorY + ry, frZ0 + frW / 2, cabMat);
      addShelf(wallX + 0.04, frFront - 0.02, frZ0 + 0.04, frZ0 + frW - 0.04, floorY + ry + 0.015);
    }
    addShelf(wallX + 0.04, frFront - 0.02, frZ0 + 0.04, frZ0 + frW - 0.04, floorY + 0.05);
    // Sağ tıkla açılan alt buzdolabı kapağı ve üst dondurucu kapağı
    doors.addHinged({ hx: frFront, hz: frZ0 + 0.04, ax: 0, az: 1, width: frW - 0.08, height: 1.28, y: floorY + 0.06, color: 0xf8fafc, handleColor: 0x94a3b8, cabinet: true, minAngle: -2.15, maxAngle: 0.05 });
    doors.addHinged({ hx: frFront, hz: frZ0 + 0.04, ax: 0, az: 1, width: frW - 0.08, height: 0.50, y: floorY + 1.38, color: 0xf1f5f9, handleColor: 0x94a3b8, cabinet: true, minAngle: -2.15, maxAngle: 0.05 });
    // Buzdolabı içi eşyalar: su şişeleri, kolalar, konserveler, kedi maması
    addProp('water_bottle', frMid + 0.06, floorY + 0.05, frZ0 + 0.26);
    addProp('water_bottle', frMid + 0.06, floorY + 0.05, frZ0 + 0.46);
    addProp('water_bottle', frMid - 0.06, floorY + 0.05, frZ0 + 0.66);
    addProp('cola', frMid + 0.06, floorY + 0.535, frZ0 + 0.25);
    addProp('cola', frMid + 0.06, floorY + 0.535, frZ0 + 0.44);
    addProp('cola', frMid + 0.06, floorY + 0.535, frZ0 + 0.64);
    addProp('canned_food', frMid + 0.05, floorY + 0.995, frZ0 + 0.28, { color: 0x2563eb });
    addProp('canned_food', frMid + 0.05, floorY + 0.995, frZ0 + 0.50, { color: 0xdc2626 });
    addProp('cat_food', frMid + 0.05, floorY + 0.995, frZ0 + 0.70);
    addProp('cola', frMid + 0.05, floorY + 1.395, frZ0 + 0.32);
    addProp('water_bottle', frMid + 0.05, floorY + 1.395, frZ0 + 0.60);

    // ── 5) ÜST MUTFAK DOLAPLARI (Duvara monte, 3 kapaklı, içlerinde konserve, su, kedi maması, un, kola, tabak, kaşık, çatal) ──
    const upY = floorY + 1.44, upH = 0.74, upW = 2.40, upD = 0.44;
    const upFront = wallX + upD, upMid = wallX + upD * 0.5;
    box(upD, 0.035, upW, upMid, upY + 0.018, c1Z0 + upW / 2, cabMat);             // alt raf
    box(upD, 0.03, upW - 0.04, upMid, upY + 0.37, c1Z0 + upW / 2, woodMat);       // orta raf
    box(upD, 0.035, upW, upMid, upY + upH - 0.018, c1Z0 + upW / 2, cabMat);       // üst tavan
    box(upD, upH, 0.035, upMid, upY + upH / 2, c1Z0 + 0.02, cabMat);
    box(upD, upH, 0.035, upMid, upY + upH / 2, c1Z0 + 0.80, cabMat);
    box(upD, upH, 0.035, upMid, upY + upH / 2, c1Z0 + 1.60, cabMat);
    box(upD, upH, 0.035, upMid, upY + upH / 2, c1Z0 + upW - 0.02, cabMat);
    addShelf(wallX + 0.02, upFront - 0.02, c1Z0 + 0.02, c1Z0 + upW - 0.02, upY + 0.035);
    addShelf(wallX + 0.02, upFront - 0.02, c1Z0 + 0.02, c1Z0 + upW - 0.02, upY + 0.385);
    for (let k = 0; k < 3; k++) {
      doors.addHinged({
        hx: upFront, hz: c1Z0 + k * 0.80 + 0.03, ax: 0, az: 1,
        width: 0.74, height: upH - 0.06, y: upY + 0.03, color: 0xe2e8f0, cabinet: true, minAngle: -2.1, maxAngle: 0.05
      });
    }
    // Üst dolapların içi: konserve, su, kedi maması, un, kola, tabak, kaşık, çatal
    addProp('canned_food', upMid + 0.03, upY + 0.035, c1Z0 + 0.24, { color: 0xdc2626 });
    addProp('canned_food', upMid + 0.03, upY + 0.035, c1Z0 + 0.44, { color: 0x16a34a });
    addProp('cat_food', upMid + 0.03, upY + 0.035, c1Z0 + 0.64);
    addProp('flour', upMid + 0.03, upY + 0.385, c1Z0 + 0.32, { yaw: 1.57 });
    addProp('water_bottle', upMid + 0.03, upY + 0.385, c1Z0 + 0.58);
    addProp('plate', upMid + 0.02, upY + 0.035, c1Z0 + 1.05);
    addProp('plate', upMid + 0.02, upY + 0.035, c1Z0 + 1.38);
    addProp('spoon', upMid + 0.05, upY + 0.385, c1Z0 + 1.02, { yaw: 1.57 });
    addProp('fork', upMid + 0.05, upY + 0.385, c1Z0 + 1.18, { yaw: 1.57 });
    addProp('knife', upMid + 0.05, upY + 0.385, c1Z0 + 1.32, { yaw: 1.57 });
    addProp('plate', upMid + 0.02, upY + 0.385, c1Z0 + 1.48);
    addProp('mug', upMid + 0.03, upY + 0.385, c1Z0 + 0.85);
    addProp('cola', upMid + 0.03, upY + 0.035, c1Z0 + 1.84);
    addProp('cola', upMid + 0.03, upY + 0.035, c1Z0 + 2.04);
    addProp('canned_food', upMid + 0.03, upY + 0.035, c1Z0 + 2.24, { color: 0x9333ea });
    addProp('cat_food', upMid + 0.03, upY + 0.385, c1Z0 + 1.92);
    addProp('canned_food', upMid + 0.03, upY + 0.385, c1Z0 + 2.18, { color: 0xf59e0b });

    // ── 6) BÜYÜK ADA MUTFAK TEZGÂHI (Ortada geniş modern ada tezgâhı + bar tabureleri + çatal, kaşık, bıçak, tabak, kupa bardak, kek) ──
    const islX = wallX + 1.85, islZ = c1Z0 + 0.90, islW = 2.20, islD = 0.96, islH = 0.88;
    box(islD, 0.04, islW, islX, floorY + 0.02, islZ + islW / 2, cabMat);
    box(islD - 0.04, islH - 0.06, islW - 0.06, islX, floorY + islH / 2, islZ + islW / 2, woodMat);
    box(islD + 0.08, 0.06, islW + 0.08, islX, floorY + islH + 0.03, islZ + islW / 2, counterMat);
    addShelf(islX - islD * 0.5 - 0.04, islX + islD * 0.5 + 0.04, islZ - 0.04, islZ + islW + 0.04, floorY + islH + 0.06);

    // Ada üstü zengin donatım: tabaklar, çatallar, kaşıklar, bıçaklar, kupa bardaklar, kek ve içecekler
    addProp('plate', islX - 0.12, floorY + islH + 0.06, islZ + 0.50);
    addProp('fork', islX - 0.28, floorY + islH + 0.06, islZ + 0.50, { yaw: 1.57 });
    addProp('knife', islX + 0.04, floorY + islH + 0.06, islZ + 0.50, { yaw: 1.57 });
    addProp('spoon', islX + 0.16, floorY + islH + 0.06, islZ + 0.50, { yaw: 1.57 });
    addProp('mug', islX - 0.12, floorY + islH + 0.06, islZ + 0.80);

    addProp('plate', islX - 0.12, floorY + islH + 0.06, islZ + 1.50);
    addProp('fork', islX - 0.28, floorY + islH + 0.06, islZ + 1.50, { yaw: 1.57 });
    addProp('knife', islX + 0.04, floorY + islH + 0.06, islZ + 1.50, { yaw: 1.57 });
    addProp('spoon', islX + 0.16, floorY + islH + 0.06, islZ + 1.50, { yaw: 1.57 });
    addProp('mug', islX - 0.12, floorY + islH + 0.06, islZ + 1.80);

    addProp('cake', islX + 0.20, floorY + islH + 0.06, islZ + 1.10, { yaw: 0.5 });
    addProp('water_bottle', islX + 0.22, floorY + islH + 0.06, islZ + 1.35);

    // Ada bar tabureleri (ahşap/modern sandalyeler)
    vw.propSpawns.push({ kind: 'chair', x: islX + islD * 0.5 + 0.45, y: floorY + 0.46, z: islZ + 0.65, yaw: -Math.PI / 2 });
    vw.propSpawns.push({ kind: 'chair', x: islX + islD * 0.5 + 0.45, y: floorY + 0.46, z: islZ + 1.65, yaw: -Math.PI / 2 });
  }

  // Tavandan sarkan Teardown tarzı sarı ampul (kablo + duy + parlayan ampul + sıcak nokta ışığı)
  _addHangingBulb(grp, x, ceilY, z) {
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.72, 0.035), new THREE.MeshLambertMaterial({ color: 0x1e293b }));
    cord.position.set(x, ceilY - 0.36, z);
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.10, 0.11), new THREE.MeshLambertMaterial({ color: 0xb45309 }));
    socket.position.set(x, ceilY - 0.74, z);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), new THREE.MeshBasicMaterial({ color: 0xffe57f }));
    bulb.position.set(x, ceilY - 0.90, z);
    const pt = new THREE.PointLight(0xffd27d, 9, 13, 1.8);
    pt.position.set(x, ceilY - 1.05, z);
    grp.add(cord, socket, bulb, pt);
  }

  // OYUNCUNUN EVİ (başlangıç): İki katlı Teardown tarzı müstakil ev!
  // Üst katta salon (koltuk + haber kanallı TV), yatak, tavandan sarkan ampul ve yan mutfak;
  // merdivenle inilen alt katta ise geniş Teardown mutfağı (sağ tıkla açılan dolaplar, çekmeceler, fırın, buzdolabı ve kırılabilir eşyalar).
  buildHome(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);
    w.fillBox(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, PALETTE.WOOD);          // iç zemin: ahşap parke
    const cz = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, cz - 1, x1, y1 + 4, cz + 1);                          // giriş (batı yüzü): caddeye bakan gerçek kapı
    this.addWindowBands(x1, y1, z1, x2, y2, z2, 'x1');
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);                    // 2. kat döşemesi (y = 5.0..5.5 m)
    this.addStairs(x1, y1, z1, x2, y2, z2);                                  // üst kata çıkan/inen ahşap merdiven

    // Mobilya doğrudan voxel (0.5 m) indeksleriyle: voxel i x/z'de [0.5 i - 0.25, 0.5 i + 0.25], y satırı j [0.5 j, 0.5 j + 0.5] aralığındadır.
    const vw = this.world;
    const vput = (ix0, iy0, iz0, ix1, iy1, iz1, mat) => {
      for (let x = ix0; x <= ix1; x++) for (let y = iy0; y <= iy1; y++) for (let z = iz0; z <= iz1; z++) { vw.voxels.delete(`${x},${y},${z}`); vw.setVoxel(x, y, z, mat); }
    };
    const wv = Math.floor(K * x1 / 2), ev = Math.floor((K * x2 + 2) / 2), zv = Math.floor(K * cz / 2);   // batı duvarı, doğu duvarı, kapı hizası
    const zv1 = Math.floor(K * z1 / 2), zv2 = Math.floor((K * z2 + 2) / 2);
    const zr0 = zv + 1, zr1 = zv + 6;                                        // koltuk genişliği (voxel z: merdivenin güneyinde, yanda mutfağa yer bırakır)
    const upIy = 11;                                                         // 2. katın ilk voxel satırı (zemin üst yüzü 5.5 m)

    // ── ÜST KAT (2. KAT): TELEVİZYON ODASI (KOLTUK + TV + KUMANDA) & YATAK ──
    // Koltuk altı döşemesi garanti sağlam zemin (alt kata düşmeyi kesinlikle engeller)
    vput(wv + 2, upIy - 1, zr0 - 1, wv + 8, upIy - 1, zr1 + 1, PALETTE.WOOD);
    // Koltuk (doğuya, TV'ye bakar): sırtlık batıda, oturma yeri ve iki kol
    vput(wv + 3, upIy, zr0 + 1, wv + 3, upIy + 1, zr1 - 1, PALETTE.BRICK);             // sırtlık
    vput(wv + 4, upIy, zr0 + 1, wv + 5, upIy, zr1 - 1, PALETTE.BRICK);                 // oturma yeri
    vput(wv + 3, upIy, zr0, wv + 5, upIy, zr0, PALETTE.BRICK); vput(wv + 3, upIy + 1, zr0, wv + 3, upIy + 1, zr0, PALETTE.BRICK);   // kol (kuzey)
    vput(wv + 3, upIy, zr1, wv + 5, upIy, zr1, PALETTE.BRICK); vput(wv + 3, upIy + 1, zr1, wv + 3, upIy + 1, zr1, PALETTE.BRICK);   // kol (güney)
    // Sehpa
    vput(wv + 9, upIy, zr0 + 2, wv + 10, upIy, zr1 - 2, PALETTE.WOOD);
    // TV ünitesi (doğu duvarının önünde)
    vput(ev - 1, upIy, zr0 - 1, ev - 1, upIy, zr1 + 1, PALETTE.IRON);

    // Üst kat Teardown Tarzı Gerçekçi Yatak (Detaylı ahşap baza, kalın konforlu şilte, açılı çift yastık, katlanmış nevresim, ayak ucu şalı ve komodin)
    const bz0 = zv1 + 3, bz1 = zv1 + 9;
    // Baza ayakları ve masif ahşap baza çerçevesi
    vput(wv + 2, upIy, bz0, wv + 2, upIy + 3, bz1, PALETTE.WOOD);                      // yüksek şık ahşap başlık
    vput(wv + 2, upIy + 1, bz0 + 1, wv + 2, upIy + 3, bz1 - 1, PALETTE.CONCRETE);      // başlık içi döşeme paneli
    vput(wv + 3, upIy, bz0, wv + 9, upIy, bz1, PALETTE.WOOD);                          // yatak alt baza
    // Kalın ortopedik konforlu beyaz şilte (yatak)
    vput(wv + 3, upIy + 1, bz0, wv + 9, upIy + 1, bz1, PALETTE.WHITE);
    // 2 adet yumuşak, kabarık, açılı yastık
    vput(wv + 3, upIy + 2, bz0 + 1, wv + 4, upIy + 2, bz0 + 3, PALETTE.WHITE);
    vput(wv + 3, upIy + 2, bz1 - 3, wv + 4, upIy + 2, bz1 - 1, PALETTE.WHITE);
    // Katlanmış nevresim: Beyaz çarşaf kıvrımı ve kırmızı sıcak yorgan
    vput(wv + 5, upIy + 2, bz0, wv + 5, upIy + 2, bz1, PALETTE.WHITE);                 // nevresim katlama sınırı
    vput(wv + 6, upIy + 2, bz0, wv + 9, upIy + 2, bz1, PALETTE.BRICK);                 // dökümlü kırmızı yorgan
    vput(wv + 8, upIy + 2, bz0, wv + 9, upIy + 2, bz1, PALETTE.GOLD);                  // ayak ucu lüks altın yatak şalı
    // Şık çekmeceli komodin ve başucu lambası
    vput(wv + 2, upIy, bz1 + 1, wv + 3, upIy + 1, bz1 + 3, PALETTE.WOOD);              // komodin gövdesi
    vput(wv + 3, upIy + 1, bz1 + 2, wv + 3, upIy + 1, bz1 + 2, PALETTE.IRON);          // çekmece pirinç kulpu
    vput(wv + 2, upIy + 2, bz1 + 2, wv + 2, upIy + 2, bz1 + 2, PALETTE.GOLD);          // lamba pirinç ayağı
    vput(wv + 2, upIy + 3, bz1 + 2, wv + 2, upIy + 3, bz1 + 2, PALETTE.LAMP);          // başucu abajuru

    // ── ALT KAT (ZEMİN KAT): MUTFAK + YEMEK MASASI + TUVALET / BANYO ──
    // Alt kat yemek masası (merdiven ile tuvalet arasında)
    vput(ev - 9, 1, zv + 2, ev - 6, 2, zv + 7, PALETTE.WOOD);

    // Alt kat Tuvalet / Banyo Odası (güneydoğu köşede: bölme duvarları, beyaz fayans zemin ve menteşeli kapı)
    vput(ev - 7, 0, zv2 - 10, ev - 1, 0, zv2 - 1, PALETTE.WHITE);                      // beyaz banyo fayansı
    vput(ev - 8, 1, zv2 - 11, ev - 1, 9, zv2 - 11, PALETTE.WHITE);                     // tuvalet kuzey duvarı
    vput(ev - 8, 1, zv2 - 11, ev - 8, 9, zv2 - 8, PALETTE.WHITE);                      // tuvalet batı duvarı (kuzey kanat)
    vput(ev - 8, 1, zv2 - 4, ev - 8, 9, zv2 - 1, PALETTE.WHITE);                       // tuvalet batı duvarı (güney kanat)
    vput(ev - 8, 6, zv2 - 7, ev - 8, 9, zv2 - 5, PALETTE.WHITE);                       // kapı üstü duvar
    vw.doors.addHinged({
      hx: 0.5 * (ev - 8), hz: 0.5 * (zv2 - 7) - 0.21, ax: 0, az: 1,
      width: 1.42, height: 2.45, y: 0.5, color: 0xf8fafc
    });

    // Metre cinsinden konumlar (2. kat televizyon odasındaki koltuk ve TV)
    const seatX = 0.5 * (wv + 4 + wv + 5) / 2;
    const seatZ = 0.5 * (zr0 + 1 + zr1 - 1) / 2;
    const seatTopY = 6.0;                                                    // 2. kat döşemesi 5.5 + 1 voxel (0.5 m)
    const standTopY = 6.0;
    const tvX = 0.5 * (ev - 1) + 0.05;
    const tvW = 4.0, tvH = 2.2, tvY = standTopY + tvH / 2 + 0.05;

    const grp = new THREE.Group();

    // Tavandan sarkan ampuller (üst kat televizyon odası, alt kat mutfak ve alt kat tuvalet)
    const midX = 0.5 * (wv + ev) / 2;
    this._addHangingBulb(grp, midX, 9.5, seatZ);
    this._addHangingBulb(grp, midX, 5.0, seatZ);
    this._addHangingBulb(grp, 0.5 * (ev - 4.5), 5.0, 0.5 * (zv2 - 6));       // tuvalet ampulü

    // Alt kat Tuvalet donanımı: detaylı Klozet (oturma yeri, kapak, rezervuar, sifon), Tuvalet Kağıdı, Lavabo, Musluk ve Ayna
    {
      const bmesh = (w, h, d, x, y, z, col) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
        m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      };
      const tx = 0.5 * (ev - 1) - 0.52, tz = 0.5 * (zv2 - 3);
      // Klozet kaidesi, çanağı, iç suyu, oturma halkası, açık kapağı ve rezervuarı
      bmesh(0.46, 0.38, 0.44, tx - 0.10, 0.5 + 0.19, tz, 0xf8fafc);          // klozet alt gövde
      bmesh(0.52, 0.08, 0.48, tx - 0.12, 0.5 + 0.41, tz, 0xffffff);          // klozet oturma halkası
      bmesh(0.32, 0.02, 0.30, tx - 0.14, 0.5 + 0.36, tz, 0x38bdf8);          // klozet içi su
      bmesh(0.05, 0.46, 0.44, tx + 0.12, 0.5 + 0.66, tz, 0xffffff);          // dik duran klozet kapağı
      bmesh(0.24, 0.48, 0.48, tx + 0.25, 0.5 + 0.64, tz, 0xf1f5f9);          // su rezervuarı
      bmesh(0.26, 0.04, 0.50, tx + 0.25, 0.5 + 0.90, tz, 0xffffff);          // rezervuar üst kapağı
      bmesh(0.06, 0.03, 0.10, tx + 0.25, 0.5 + 0.93, tz, 0x94a3b8);          // gümüş sifon düğmesi
      // Tuvalet kağıdı askısı ve rulosu (güney duvarında)
      bmesh(0.14, 0.04, 0.08, tx - 0.10, 0.5 + 0.68, 0.5 * (zv2 - 1) - 0.30, 0x64748b);
      bmesh(0.14, 0.14, 0.14, tx - 0.10, 0.5 + 0.62, 0.5 * (zv2 - 1) - 0.36, 0xffffff);
      // Lavabo dolabı, seramik evye, musluk ve duvar aynası
      const sx = 0.5 * (ev - 1) - 0.48, sz = 0.5 * (zv2 - 8.5);
      bmesh(0.48, 0.78, 0.72, sx, 0.5 + 0.39, sz, 0x475569);                 // lavabo alt dolabı
      bmesh(0.52, 0.10, 0.76, sx, 0.5 + 0.83, sz, 0xffffff);                 // seramik lavabo tablası
      bmesh(0.34, 0.03, 0.52, sx - 0.03, 0.5 + 0.885, sz, 0xe2e8f0);         // lavabo iç çukuru
      bmesh(0.05, 0.18, 0.05, sx + 0.16, 0.5 + 0.96, sz, 0x94a3b8);          // musluk dikmesi
      bmesh(0.14, 0.04, 0.05, sx + 0.10, 0.5 + 1.03, sz, 0x94a3b8);          // musluk ucu
      bmesh(0.04, 0.88, 0.68, sx + 0.22, 0.5 + 1.56, sz, 0xbae6fd);          // ayna
    }

    // Mutfak tamamen alt katta (batı duvarı boyunca tek, genişletilmiş ve modern ada mutfak)
    const wallWestX = 0.5 * wv + 0.25;
    this._buildTeardownKitchen(grp, 0.5, wallWestX, 0.5 * (zv1 + 6));        // alt kat tek büyük mutfağımız

    // Bizim evin içinde adam olmasın: çalışan NPC kaldırıldı!

    // Alt kat yemek masası üstü: tabak, çatal, kaşık, bıçak, kupa bardak ve kola
    const dtX = 0.5 * (ev - 7.5), dtZ = 0.5 * (zv + 4.5), dtY = 1.05;
    vw.propSpawns.push({ kind: 'plate', x: dtX - 0.35, y: dtY, z: dtZ - 0.4 });
    vw.propSpawns.push({ kind: 'fork', x: dtX - 0.55, y: dtY, z: dtZ - 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'knife', x: dtX - 0.15, y: dtY, z: dtZ - 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'spoon', x: dtX - 0.02, y: dtY, z: dtZ - 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'mug', x: dtX - 0.35, y: dtY + 0.05, z: dtZ - 0.7 });

    vw.propSpawns.push({ kind: 'plate', x: dtX - 0.35, y: dtY, z: dtZ + 0.4 });
    vw.propSpawns.push({ kind: 'fork', x: dtX - 0.55, y: dtY, z: dtZ + 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'knife', x: dtX - 0.15, y: dtY, z: dtZ + 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'spoon', x: dtX - 0.02, y: dtY, z: dtZ + 0.4, yaw: 1.57 });
    vw.propSpawns.push({ kind: 'cola', x: dtX - 0.35, y: dtY + 0.05, z: dtZ + 0.7 });

    // Üst kat televizyon odası sehpa üstü: kupa bardak (kumanda jenerikte oyuncunun elindedir)
    const ctX = 0.5 * (wv + 9.5), ctZ = 0.5 * (zr0 + zr1) / 2, ctY = 6.05;
    vw.propSpawns.push({ kind: 'mug', x: ctX + 0.25, y: ctY + 0.05, z: ctZ + 0.2 });

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, tvH + 0.14, tvW + 0.14), new THREE.MeshLambertMaterial({ color: 0x0b0d12 }));
    frame.position.set(tvX, tvY, seatZ);
    grp.add(frame);
    let tvMat, tvCanvas = null, tvCtx = null, tvTex = null;
    try {
      tvCanvas = document.createElement('canvas'); tvCanvas.width = 512; tvCanvas.height = 288;
      tvCtx = tvCanvas.getContext('2d');
      tvTex = new THREE.CanvasTexture(tvCanvas); tvTex.colorSpace = THREE.SRGBColorSpace;
      tvMat = new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false });
    } catch (e) { tvMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed }); }

    // TV Haber Kanalı: Kadın spiker canlı yayında konuşuyor (ağız, kafa, göz kırpma ve alt yazı bant animasyonu)
    const drawNewsChannel = (t) => {
      if (!tvCtx || !tvTex) return;
      const g = tvCtx;
      // 1) Stüdyo arka planı
      const bg = g.createLinearGradient(0, 0, 512, 240);
      bg.addColorStop(0, '#0f172a'); bg.addColorStop(0.55, '#1e3a8a'); bg.addColorStop(1, '#1d4ed8');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 288);
      // Stüdyo dünya haritası / ızgara çizgileri
      g.strokeStyle = 'rgba(147, 197, 253, 0.15)'; g.lineWidth = 1;
      for (let x = 32; x < 512; x += 36) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 220); g.stroke(); }
      for (let y = 24; y < 220; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }

      // Sağ üstte stüdyo bilgi ekranı ("SON DURUM")
      g.fillStyle = 'rgba(15, 23, 42, 0.82)';
      g.fillRect(348, 22, 144, 92);
      g.strokeStyle = '#38bdf8'; g.lineWidth = 2; g.strokeRect(348, 22, 144, 92);
      g.fillStyle = '#ef4444'; g.fillRect(356, 30, 128, 20);
      g.fillStyle = '#ffffff'; g.font = 'bold 12px sans-serif'; g.fillText('ŞEHİR GÜNDEMİ', 368, 44);
      // Küçük bina grafiği
      g.fillStyle = '#60a5fa'; g.fillRect(368, 66, 22, 38); g.fillRect(396, 56, 26, 48); g.fillRect(428, 72, 20, 32);

      // Sol üst "CANLI YAYIN" rozeti
      g.fillStyle = '#dc2626'; g.fillRect(18, 16, 98, 24);
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      g.fillStyle = `rgba(255,255,255,${0.45 + 0.55 * pulse})`;
      g.beginPath(); g.arc(30, 28, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = 'bold 12px sans-serif'; g.fillText('CANLI YAYIN', 40, 32);

      // 2) Kadın Haber Spikeri (ortada, hafif kafa ve ağız hareketiyle konuşur)
      const nodY = Math.sin(t * 4.2) * 1.8;
      const swayX = Math.sin(t * 2.1) * 2.2;
      const cx = 228 + swayX, cy = 112 + nodY;

      // Uzun saçlar (arka kısım)
      g.fillStyle = '#3b1d11';
      g.beginPath(); g.ellipse(cx, cy + 12, 42, 54, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(cx - 40, cy + 8, 80, 56);

      // Omuzlar ve kırmızı spiker ceketi + beyaz gömlek yakası
      g.fillStyle = '#b91c1c';
      g.beginPath(); g.moveTo(cx - 68, 225); g.quadraticCurveTo(cx - 58, cy + 48, cx - 22, cy + 46);
      g.lineTo(cx + 22, cy + 46); g.quadraticCurveTo(cx + 58, cy + 48, cx + 68, 225); g.closePath(); g.fill();
      g.fillStyle = '#f8fafc';
      g.beginPath(); g.moveTo(cx - 16, cy + 46); g.lineTo(cx, cy + 82); g.lineTo(cx + 16, cy + 46); g.closePath(); g.fill();

      // Boyun ve yüz
      g.fillStyle = '#f5cba7';
      g.fillRect(cx - 11, cy + 28, 22, 24);
      g.beginPath(); g.ellipse(cx, cy, 29, 35, 0, 0, Math.PI * 2); g.fill();

      // Saç perçemi / ön kesim
      g.fillStyle = '#4a2515';
      g.beginPath();
      g.arc(cx, cy - 8, 31, Math.PI * 0.92, Math.PI * 2.08);
      g.quadraticCurveTo(cx + 10, cy - 22, cx - 8, cy - 16);
      g.quadraticCurveTo(cx - 26, cy - 14, cx - 30, cy - 2);
      g.fill();

      // Küpeler
      g.fillStyle = '#facc15';
      g.beginPath(); g.arc(cx - 29, cy + 8, 3, 0, Math.PI * 2); g.arc(cx + 29, cy + 8, 3, 0, Math.PI * 2); g.fill();

      // Kaşlar ve Gözler (ara sıra göz kırpar)
      const blink = Math.sin(t * 1.7) > 0.96 ? 0.15 : 1.0;
      const browLift = Math.sin(t * 5.5) * 1.4;
      g.strokeStyle = '#3b1d11'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx - 18, cy - 10 - browLift); g.quadraticCurveTo(cx - 11, cy - 14 - browLift, cx - 5, cy - 10 - browLift); g.stroke();
      g.beginPath(); g.moveTo(cx + 5, cy - 10 - browLift); g.quadraticCurveTo(cx + 11, cy - 14 - browLift, cx + 18, cy - 10 - browLift); g.stroke();

      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(cx - 11, cy - 3, 6.5, 4.2 * blink, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(cx + 11, cy - 3, 6.5, 4.2 * blink, 0, 0, Math.PI * 2); g.fill();
      if (blink > 0.3) {
        g.fillStyle = '#1e293b';
        g.beginPath(); g.arc(cx - 11, cy - 3, 2.8, 0, Math.PI * 2); g.arc(cx + 11, cy - 3, 2.8, 0, Math.PI * 2); g.fill();
      }

      // Burun
      g.strokeStyle = '#d9a47c'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx, cy - 2); g.lineTo(cx - 2, cy + 9); g.lineTo(cx + 2, cy + 9); g.stroke();

      // Konuşan Ağız (hecelere göre açılıp kapanır!)
      const talk = Math.max(0.08, Math.abs(Math.sin(t * 13.5) * Math.cos(t * 4.8)));
      const mouthH = 1.8 + talk * 7.5;
      const mouthW = 9.5 + Math.sin(t * 9.0) * 2.2;
      g.fillStyle = '#be123c';
      g.beginPath(); g.ellipse(cx, cy + 19, mouthW, mouthH + 1.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#450a0a';
      g.beginPath(); g.ellipse(cx, cy + 19, mouthW * 0.78, mouthH * 0.75, 0, 0, Math.PI * 2); g.fill();
      if (mouthH > 3.5) {
        g.fillStyle = '#ffffff';
        g.fillRect(cx - mouthW * 0.55, cy + 19 - mouthH * 0.65, mouthW * 1.1, 2.2);
      }

      // Spikerin konuşma balonu / altyazı vurgusu
      const phrases = [
        '"Şirket binalarında güvenlik uyarısı!"',
        '"Sayın izleyiciler, son dakika gelişmesi!"',
        '"Şehir merkezinde hareketli saatler!"'
      ];
      const phrase = phrases[Math.floor(t / 3.5) % phrases.length];
      g.fillStyle = 'rgba(255, 255, 255, 0.92)';
      g.fillRect(16, 154, 152, 34);
      g.fillStyle = '#0f172a'; g.font = 'bold 10px sans-serif';
      g.fillText(phrase, 22, 175);

      // 3) Haber masası ve mikrofon
      g.fillStyle = '#cbd5e1'; g.fillRect(70, 212, 372, 18);
      g.fillStyle = '#1e293b'; g.fillRect(195, 198, 66, 15);
      // Masa üstü kağıtlar ve spikerin eli
      g.fillStyle = '#f8fafc'; g.fillRect(210, 208, 36, 6);

      // 4) Alt SON DAKİKA Haber Bandı (kayan yazı)
      g.fillStyle = '#dc2626'; g.fillRect(0, 228, 512, 28);
      g.fillStyle = '#facc15'; g.fillRect(0, 228, 128, 28);
      g.fillStyle = '#0f172a'; g.font = 'bold 14px sans-serif'; g.fillText('SON DAKİKA', 16, 247);
      g.fillStyle = '#ffffff'; g.font = 'bold 13px sans-serif';
      g.fillText('KADIN SPİKER BİLDİRİYOR: ŞEHİRDE BÜYÜK HAREKETLİLİK • BİNALAR ALARMDA', 138, 247);

      g.fillStyle = '#090d16'; g.fillRect(0, 256, 512, 32);
      const ticker = 'HABER MERKEZİ: Şirket çalışanları mesai bitiminde çantalarıyla evlerine dönüyor — Hasar alan binalar acil tahliye ediliyor — ';
      const scrollX = 512 - ((t * 65) % 920);
      g.fillStyle = '#fde047'; g.font = '12px sans-serif';
      g.fillText(ticker + ticker, scrollX, 276);

      tvTex.needsUpdate = true;
    };
    drawNewsChannel(0);

    const screen = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), tvMat);
    const screenX = tvX - 0.07;
    screen.position.set(screenX, tvY, seatZ);
    screen.rotation.y = -Math.PI / 2;                                        // -x'e (koltuğa) bakar
    grp.add(screen);
    const light = new THREE.PointLight(0x8b7cf6, 14, 12, 2);                 // TV'nin odaya yaydığı ışık (main.js hafifçe titretir)
    light.position.set(tvX - 1.0, tvY, seatZ);
    grp.add(light);
    this.world.scene.add(grp);
    this.world.decor.push(grp);

    const homeTV = {
      light,
      broken: false,
      animT: 0,
      accum: 0,
      screenX, tvY, seatZ, tvW, tvH,
      update(dt) {
        if (this.broken) return;
        this.animT += dt;
        this.accum += dt;
        if (this.accum >= 0.05) {
          this.accum = 0;
          drawNewsChannel(this.animT);
        }
      },
      // Vurulan dünya koordinatında (wy, wz) ekranı karartır ve tam o noktaya örümcek ağı kırık izi çizer
      hitAt(wy, wz) {
        if (!tvCtx || !tvTex) return;
        if (!this.broken) {
          this.broken = true;
          this.light.intensity = 0;
          tvCtx.fillStyle = '#07080c';
          tvCtx.fillRect(0, 0, 512, 288);
        }
        // screen.rotation.y = -PI/2 olduğu için sol kenar seatZ - tvW/2 (u=0), sağ kenar seatZ + tvW/2 (u=1)
        const u = Math.max(0.03, Math.min(0.97, (wz - (seatZ - tvW / 2)) / tvW));
        const v = Math.max(0.03, Math.min(0.97, 1 - (wy - (tvY - tvH / 2)) / tvH));
        const cx = u * 512, cy = v * 288;

        // Kırık merkezindeki beyaz/gri ezilme noktası
        const radG = tvCtx.createRadialGradient(cx, cy, 1, cx, cy, 24);
        radG.addColorStop(0, 'rgba(245, 250, 255, 0.95)');
        radG.addColorStop(0.3, 'rgba(180, 200, 220, 0.55)');
        radG.addColorStop(1, 'rgba(15, 20, 30, 0)');
        tvCtx.fillStyle = radG;
        tvCtx.beginPath(); tvCtx.arc(cx, cy, 24, 0, Math.PI * 2); tvCtx.fill();

        // Merkezden dışa yayılan kırık çatlak kolları
        const rays = 14 + Math.floor(Math.random() * 6);
        const angles = [];
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
          angles.push(a);
          const len = 45 + Math.random() * 140;
          let px = cx, py = cy, curA = a;
          tvCtx.strokeStyle = i % 2 === 0 ? 'rgba(226, 236, 248, 0.85)' : 'rgba(148, 168, 192, 0.65)';
          tvCtx.lineWidth = i % 3 === 0 ? 2.0 : 1.2;
          tvCtx.beginPath();
          tvCtx.moveTo(px, py);
          const segs = 5 + Math.floor(Math.random() * 4);
          for (let s = 1; s <= segs; s++) {
            curA += (Math.random() - 0.5) * 0.22;
            const step = (len / segs) * (0.8 + Math.random() * 0.4);
            px += Math.cos(curA) * step;
            py += Math.sin(curA) * step;
            tvCtx.lineTo(px, py);
          }
          tvCtx.stroke();
        }

        // Halkasal örümcek ağı çatlakları
        for (const ringR of [12, 26, 46, 72]) {
          tvCtx.strokeStyle = 'rgba(190, 208, 230, 0.5)';
          tvCtx.lineWidth = 1.1;
          tvCtx.beginPath();
          for (let i = 0; i <= angles.length; i++) {
            const a = angles[i % angles.length];
            const rr = ringR * (0.82 + Math.random() * 0.36);
            const rx = cx + Math.cos(a) * rr, ry = cy + Math.sin(a) * rr;
            if (i === 0) tvCtx.moveTo(rx, ry);
            else if (Math.random() < 0.85) tvCtx.lineTo(rx, ry);
            else tvCtx.moveTo(rx, ry);
          }
          tvCtx.stroke();
        }

        // Merkezde kurşun/darbe deliği
        tvCtx.fillStyle = '#020305';
        tvCtx.beginPath(); tvCtx.arc(cx, cy, 4.5, 0, Math.PI * 2); tvCtx.fill();
        tvCtx.strokeStyle = 'rgba(255,255,255,0.9)';
        tvCtx.lineWidth = 1.5;
        tvCtx.stroke();

        tvTex.needsUpdate = true;
      },
      // Mermi ışını TV ekranına çarptı mı?
      rayHit(origin, dir, maxDist) {
        if (Math.abs(dir.x) < 1e-6) return null;
        const t = (screenX - origin.x) / dir.x;
        if (t < 0.1 || t > maxDist) return null;
        const py = origin.y + dir.y * t;
        const pz = origin.z + dir.z * t;
        if (Math.abs(py - tvY) <= tvH / 2 + 0.08 && Math.abs(pz - seatZ) <= tvW / 2 + 0.08) {
          return { dist: t, point: new THREE.Vector3(screenX, py, pz) };
        }
        return null;
      },
      // Patlama / çekiç / kılıç küresi TV ekranına değdi mi?
      hitSphere(center, radius) {
        if (Math.abs(center.x - screenX) > radius + 0.25) return false;
        const cy = Math.max(tvY - tvH / 2, Math.min(tvY + tvH / 2, center.y));
        const cz = Math.max(seatZ - tvW / 2, Math.min(seatZ + tvW / 2, center.z));
        const d2 = (center.x - screenX) ** 2 + (center.y - cy) ** 2 + (center.z - cz) ** 2;
        if (d2 <= radius * radius) {
          this.hitAt(cy, cz);
          return true;
        }
        return false;
      }
    };
    this.world.homeTV = homeTV;

    // Başlangıç noktası: 2. kattaki televizyon odasında koltuğun üstü
    const spawn = this.levelConfigs[0].spawn;
    spawn.x = seatX; spawn.z = seatZ; spawn.y = seatTopY + 1.05;
    this.world.homeSeat = { x: seatX, y: seatTopY, z: seatZ, tvX, tvY };
  }

  // Çöl yolunun sonundaki hafif kırılmış, çatlamış yol çıkmazı
  buildBrokenRoadEnd(x0, x1, z0, z1) {
    const w = this.world;
    const F = 0.75;
    for (let x = x0; x <= x1; x++) {
      const rx = Math.floor(K * x);
      const frac = (x - x0) / (x1 - x0);
      for (let z = z0; z <= z1; z++) {
        const rz = Math.floor(K * z);
        if (frac < 0.35 && Math.random() < 0.55) continue;
        if (frac < 0.7 && Math.random() < 0.25) continue;

        if (Math.random() < 0.28) {
          w.setVoxel(rx, 1, rz, PALETTE.ASPHALT);
          if (Math.random() < 0.35) w.setVoxel(rx, 2, rz, PALETTE.CONCRETE);
        }
      }
    }

    // Yol sonu uyarı bariyerleri
    const endX = Math.floor(K * (x0 + 4));
    for (const pz of [-8, -2, 3, 9]) {
      const vz = Math.floor(pz * F / 0.5);
      w.setVoxel(endX, 1, vz, PALETTE.IRON);
      w.setVoxel(endX, 2, vz, PALETTE.RED);
      w.setVoxel(endX, 3, vz, PALETTE.WHITE);
      w.setVoxel(endX, 4, vz, PALETTE.RED);
    }
  }

  // Evimizin yanında garaj ve içinde normal araba (sedan) - şehir caddesine bakar
  buildGarage(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    // Garaj ana kabuğu (beton)
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);
    w.fillBox(x1 + 1, 0, z1 + 1, x2 - 1, 0, z2 - 1, PALETTE.CONCRETE); // Garaj içi sağlam beton zemin

    // Ön garaj kapısı açıklığı (batı duvarı, x = x1): caddeye doğru bakan geniş araç girişi
    w.clearBox(x1, y1, z1 + 2, x1, y1 + 5, z2 - 2);

    // Garajdan caddeye bağlanan giriş yolu (asfalt)
    w.fillBox(-170, 0, z1 + 2, x1, 0, z2 - 2, PALETTE.ASPHALT);

    // Garaj tavanı ve çatı kenar pervazı
    w.fillBox(x1, y2, z1, x2, y2, z2, PALETTE.CONCRETE);
    w.fillBox(x1 - 1, y2, z1 - 1, x2 + 1, y2, z1 - 1, PALETTE.ROOF);
    w.fillBox(x1 - 1, y2, z2 + 1, x2 + 1, y2, z2 + 1, PALETTE.ROOF);

    // Tavan aydınlatması
    const grp = new THREE.Group();
    const midX = (x1 + x2) * 0.75 / 2;
    const midZ = (z1 + z2) * 0.75 / 2;
    this._addHangingBulb(grp, midX, (y2 - 1) * 0.5, midZ);
    this.world.scene.add(grp);
    this.world.decor.push(grp);

    // Garaj içi arka tezgahı ve tamir takımları (arka doğu duvarı x = x2)
    w.fillBox(x2 - 2, y1, z1 + 1, x2 - 1, y1 + 1, z2 - 1, PALETTE.WOOD);
    this.world.propSpawns.push({ kind: 'canned_food', x: (x2 - 1.5) * 0.75, y: 1.5, z: (z1 + 2) * 0.75 });
    this.world.propSpawns.push({ kind: 'water_bottle', x: (x2 - 1.5) * 0.75, y: 1.5, z: (z1 + 4) * 0.75 });
    this.world.propSpawns.push({ kind: 'mug', x: (x2 - 1.5) * 0.75, y: 1.5, z: (z2 - 2) * 0.75 });

    // Garajda normal bir araba (spor araba falan olmasın: sedan!)
    // Arabamız batıya, şehir caddesine doğru bakar
    this.world.parkedCars.push({
      kind: 'sedan',
      color: 0x2563eb, // Şık mavi normal sedan
      x: midX,
      y: 0.8,
      z: midZ,
      heading: Math.PI // Batıya (caddeye doğru) bakar
    });
  }

  // Çöldeki yeşil ve mor kaktüsler (çekiçle tek vuruşta rahatça kırılır)
  buildDesertCacti() {
    const w = this.world;
    let seed = 4289123;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    // Genişletilmiş devasa çöl alanı: x: -1750..-240, z: -800..800 (eski birim)
    const cactusCount = 220;
    for (let i = 0; i < cactusCount; i++) {
      const cx = -1750 + Math.floor(rnd() * 1500);
      const cz = -800 + Math.floor(rnd() * 1600);

      // Yola ya da ev/garaj bölgesine çok yakın olmasın
      if (Math.abs(cz) < 16) continue;
      if (cx >= -1035 && cx <= -970 && cz <= 0 && cz >= -55) continue;

      // Kaktüs tipi: Bazıları mor olsun! (%72 yeşil, %28 mor)
      const mat = rnd() < 0.28 ? PALETTE.CACTUS_PURPLE : PALETTE.CACTUS_GREEN;

      const vx = Math.floor(cx * 0.75 / VOXEL_SIZE);
      const vz = Math.floor(cz * 0.75 / VOXEL_SIZE);
      const h = 4 + Math.floor(rnd() * 5); // 4-8 blok yükseklik (2 - 4 metre)

      // Ana gövde
      for (let y = 1; y <= h; y++) {
        w.setVoxel(vx, y, vz, mat);
      }

      // Sol kol
      if (h >= 5) {
        const armY1 = 2 + Math.floor(rnd() * 2);
        w.setVoxel(vx + 1, armY1, vz, mat);
        w.setVoxel(vx + 2, armY1, vz, mat);
        const armH1 = armY1 + 2 + Math.floor(rnd() * 2);
        for (let y = armY1; y <= armH1; y++) {
          w.setVoxel(vx + 2, y, vz, mat);
        }
      }

      // Sağ kol
      if (h >= 6 && rnd() > 0.3) {
        const armY2 = 3 + Math.floor(rnd() * 2);
        w.setVoxel(vx - 1, armY2, vz, mat);
        w.setVoxel(vx - 2, armY2, vz, mat);
        const armH2 = armY2 + 2 + Math.floor(rnd() * 2);
        for (let y = armY2; y <= armH2; y++) {
          w.setVoxel(vx - 2, y, vz, mat);
        }
      }
    }
  }

  // DUBAI TARZI UPUZUN GÖKDELENLER (Burj Khalifa, Dubai Marina ve Emirates Towers esintili)
  buildDubaiSkyscraper(x1, y1, z1, x2, h, z2, style = 0) {
    const w = this.b;
    w.beginBuilding();
    const cx = Math.round((x1 + x2) / 2), cz = Math.round((z1 + z2) / 2);
    const wallCol = style % 2 === 0 ? PALETTE.WHITE : PALETTE.CONCRETE;
    const neonCol = [PALETTE.LAMP_BLUE, PALETTE.LAMP_PURPLE, PALETTE.GOLD, PALETTE.LAMP_GREEN][style % 4];

    // 1) Ana Gökdelen Gövdesi (Hollow)
    w.fillHollowBox(x1, y1, z1, x2, h, z2, wallCol, PALETTE.WOOD);
    this.addFloors(x1, y1, z1, x2, h, z2, PALETTE.WOOD);

    // Zemin kat lüks cam giriş
    w.clearBox(cx - 2, y1, z2, cx + 2, y1 + 5, z2);
    w.fillBox(cx - 3, y1 + 6, z2, cx + 3, y1 + 6, z2 + 2, PALETTE.GOLD); // altın giriş kanopisi

    // 2) Cam Şeritleri ve Dikey Dubai Neon Hatları
    for (let f = y1 + 6; f < h - 4; f += 6) {
      w.fillBox(x1 + 1, f, z1, x2 - 1, f + 2, z1, PALETTE.GLASS);
      w.fillBox(x1 + 1, f, z2, x2 - 1, f + 2, z2, PALETTE.GLASS);
      w.fillBox(x1, f, z1 + 1, x1, f + 2, z2 - 1, PALETTE.GLASS);
      w.fillBox(x2, f, z1 + 1, x2, f + 2, z2 - 1, PALETTE.GLASS);
    }
    // Dikey neon köşe hatları (uzaktan ve gece parlar)
    w.fillBox(x1, y1 + 6, z2, x1, h, z2, neonCol);
    w.fillBox(x2, y1 + 6, z2, x2, h, z2, neonCol);
    w.fillBox(x1, y1 + 6, z1, x1, h, z1, neonCol);
    w.fillBox(x2, y1 + 6, z1, x2, h, z1, neonCol);

    // 3) Kademeli Kule Tepesi ve Göğe Uzanan İğne Spire
    const t1 = Math.max(x2 - x1 - 4, 4), t1z = Math.max(z2 - z1 - 4, 4);
    if (t1 >= 4 && t1z >= 4) {
      const h1 = h + 10;
      w.fillHollowBox(cx - Math.floor(t1 / 2), h, cz - Math.floor(t1z / 2), cx + Math.floor(t1 / 2), h1, cz + Math.floor(t1z / 2), PALETTE.WHITE, PALETTE.CONCRETE);
      w.fillBox(cx - Math.floor(t1 / 2), h1, cz - Math.floor(t1z / 2), cx + Math.floor(t1 / 2), h1, cz + Math.floor(t1z / 2), neonCol);

      // Üst Kademe (İğne Kule)
      const h2 = h1 + 12;
      w.fillHollowBox(cx - 2, h1, cz - 2, cx + 2, h2, cz + 2, PALETTE.GLASS, PALETTE.CONCRETE);
      // Göğe uzanan lüks sivri anten ve ışık tacı
      w.fillBox(cx, h2, cz, cx, h2 + 10, cz, PALETTE.IRON);
      w.fillBox(cx, h2 + 11, cz, cx, h2 + 12, cz, neonCol);
    }
  }

  // 25 KAT BÜYÜK DUBAİ MEGA ŞEHRİ
  buildDubaiMegaCity() {
    let seed = 558812;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

    // Şehir kuzey-güney blokları: yollarla çakışmayan ada parselleri
    const xCols = [
      [-202, -178], [-162, -135], [-119, -95], [-79, -55], [-39, -32]
    ];
    const zBands = [
      [-540, -480], [-440, -380], [-340, -280],
      [280, 340], [380, 440], [480, 540]
    ];

    for (let ci = 0; ci < xCols.length; ci++) {
      const [x1, x2] = xCols[ci];
      for (let bi = 0; bi < zBands.length; bi++) {
        const [z1, z2] = zBands[bi];
        // Çölün ön cephesinde en uzun kuleler (h = 50..85 kat = 40..80 metre + 25m spire = 105m!)
        const isFrontLine = ci === 0;
        const h = isFrontLine ? 48 + Math.floor(rnd() * 38) : 34 + Math.floor(rnd() * 32);
        const style = (ci * 3 + bi) % 4;
        this.buildDubaiSkyscraper(x1, 1, z1, x2, h, z2, style);
      }
    }
  }

  // ZENGİN ŞEHRİ LÜKS VİLLA 2: Kuzey Cam Sahil Malikanesi (Sonsuzluk havuzlu, cam teraslı)
  buildVilla2(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WHITE, PALETTE.WOOD);
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
    const cz = Math.round((z1 + z2) / 2);
    w.clearBox(x1, y1, cz - 2, x1, y1 + 5, cz + 2); // Dev çift cam giriş
    w.fillBox(x1 - 4, y1 + 5, cz - 3, x1, y1 + 5, cz + 3, PALETTE.GOLD); // Altın giriş kanopisi
    // Sonsuzluk cam havuzu
    w.fillHollowBox(x2, y1, z1 + 4, x2 + 14, y1 + 3, z2 - 4, PALETTE.GLASS, PALETTE.GLASS);
    w.fillBox(x2 + 1, y1 + 1, z1 + 5, x2 + 13, y1 + 2, z2 - 5, PALETTE.LAMP_BLUE);
    // Geniş panoramik cam cepheler
    for (let f = y1 + 4; f < y2 - 2; f += 4) {
      w.fillBox(x1 + 1, f, z1, x2 - 1, f + 2, z1, PALETTE.GLASS);
      w.fillBox(x1 + 1, f, z2, x2 - 1, f + 2, z2, PALETTE.GLASS);
      w.fillBox(x2, f, z1 + 1, x2, f + 2, z2 - 1, PALETTE.GLASS);
    }
  }

  // ZENGİN ŞEHRİ LÜKS VİLLA 3: Güney Göl Kıyısı Malikânesi
  buildVilla3(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.WOOD);
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
    const cx = Math.round((x1 + x2) / 2);
    w.clearBox(cx - 2, y1, z1, cx + 2, y1 + 4, z1);
    // Bahçe havuzu ve teras
    w.fillBox(x1 - 10, 0, z1, x1, 0, z2, PALETTE.CONCRETE);
    w.fillHollowBox(x1 - 9, y1, z1 + 3, x1 - 1, y1 + 2, z2 - 3, PALETTE.WHITE, PALETTE.CONCRETE);
    w.fillBox(x1 - 8, y1 + 1, z1 + 4, x1 - 2, y1 + 1, z2 - 4, PALETTE.LAMP_BLUE);
  }

  // ZENGİN ŞEHRİ LÜKS VİLLA 4: Doğu Dağları Zirve Sarayı (Altın kubbeli dağ köşkü)
  buildVilla4(x1, y1, z1, x2, y2, z2) {
    const w = this.b;
    w.beginBuilding();
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WHITE, PALETTE.CONCRETE);
    this.addFloors(x1, y1, z1, x2, y2, z2, PALETTE.WOOD);
    const cx = Math.round((x1 + x2) / 2), cz = Math.round((z1 + z2) / 2);
    // Görkemli mermer giriş
    w.clearBox(cx - 3, y1, z1, cx + 3, y1 + 6, z1);
    w.fillBox(cx - 4, y1, z1 - 2, cx - 3, y1 + 6, z1, PALETTE.GOLD); // Altın sütun
    w.fillBox(cx + 3, y1, z1 - 2, cx + 4, y1 + 6, z1, PALETTE.GOLD); // Altın sütun
    // Çatı altın seyir kubbesi
    w.fillHollowBox(cx - 5, y2, cz - 5, cx + 5, y2 + 6, cz + 5, PALETTE.GOLD, PALETTE.GLASS);
    w.fillBox(cx, y2 + 7, cz, cx, y2 + 11, cz, PALETTE.LAMP_PURPLE); // Parıldayan zirve feneri
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

    // ── BİNA DIŞ VE ÇATI DETAYLARI ──
    // 1) Çatı kenar korkuluk/parapet çıtası
    w.fillBox(x1, y2, z1, x2, y2, z1, PALETTE.CONCRETE);
    w.fillBox(x1, y2, z2, x2, y2, z2, PALETTE.CONCRETE);
    w.fillBox(x1, y2, z1, x1, y2, z2, PALETTE.CONCRETE);
    w.fillBox(x2, y2, z1, x2, y2, z2, PALETTE.CONCRETE);

    // 2) Çatı üstü asansör makine dairesi, havalandırma (HVAC) ve telsiz/iletişim anteni
    if (x2 - x1 >= 7 && z2 - z1 >= 7) {
      w.fillBox(cx - 2, y2 + 1, cz - 2, cx + 2, y2 + 3, cz + 2, o.wall);
      w.fillBox(cx - 2, y2 + 3, cz - 2, cx + 2, y2 + 3, cz + 2, PALETTE.CONCRETE);
      // Havalandırma chiller ünitesi ve fan ızgarası
      w.fillBox(cx + 2, y2 + 1, cz - 1, cx + 3, y2 + 2, cz + 1, PALETTE.IRON);
      w.fillBox(cx + 2, y2 + 2, cz, cx + 3, y2 + 2, cz, PALETTE.BLACK);
      // Çatı iletişim anteni ve kırmızı uç lambası
      w.fillBox(cx - 2, y2 + 1, cz - 2, cx - 2, y2 + 6, cz - 2, PALETTE.IRON);
      w.fillBox(cx - 2, y2 + 7, cz - 2, cx - 2, y2 + 7, cz - 2, PALETTE.LAMP_ORANGE);
    }

    // 3) Giriş kapısı üstü koruyucu sundurma/saçak (canopy) ve demir dikmeler
    if (side === 'x1') {
      w.fillBox(x1 - 2, y1 + 5, cz - 2, x1, y1 + 5, cz + 2, PALETTE.CONCRETE);
      w.fillBox(x1 - 2, y1 + 1, cz - 2, x1 - 2, y1 + 4, cz - 2, PALETTE.IRON);
      w.fillBox(x1 - 2, y1 + 1, cz + 2, x1 - 2, y1 + 4, cz + 2, PALETTE.IRON);
    } else if (side === 'x2') {
      w.fillBox(x2, y1 + 5, cz - 2, x2 + 2, y1 + 5, cz + 2, PALETTE.CONCRETE);
      w.fillBox(x2 + 2, y1 + 1, cz - 2, x2 + 2, y1 + 4, cz - 2, PALETTE.IRON);
      w.fillBox(x2 + 2, y1 + 1, cz + 2, x2 + 2, y1 + 4, cz + 2, PALETTE.IRON);
    } else if (side === 'z1') {
      w.fillBox(cx - 2, y1 + 5, z1 - 2, cx + 2, y1 + 5, z1, PALETTE.CONCRETE);
      w.fillBox(cx - 2, y1 + 1, z1 - 2, cx - 2, y1 + 4, z1 - 2, PALETTE.IRON);
      w.fillBox(cx + 2, y1 + 1, z1 - 2, cx + 2, y1 + 4, z1 - 2, PALETTE.IRON);
    } else if (side === 'z2') {
      w.fillBox(cx - 2, y1 + 5, z2, cx + 2, y1 + 5, z2 + 2, PALETTE.CONCRETE);
      w.fillBox(cx - 2, y1 + 1, z2 + 2, cx - 2, y1 + 4, z2 + 2, PALETTE.IRON);
      w.fillBox(cx + 2, y1 + 1, z2 + 2, cx + 2, y1 + 4, z2 + 2, PALETTE.IRON);
    }

    // 4) Dış cephede klima dış üniteleri (AC split units)
    for (let f = y1 + 5; f < y2 - 4; f += 6) {
      if (side !== 'x2') w.fillBox(x2 + 1, f, cz + 2, x2 + 1, f + 1, cz + 3, PALETTE.IRON);
      if (side !== 'x1') w.fillBox(x1 - 1, f, cz - 3, x1 - 1, f + 1, cz - 2, PALETTE.IRON);
    }

    this.addStairs(x1, y1, z1, x2, y2, z2);
    this.furnish(x1, y1, z1, x2, y2, z2, o.interior || (y2 - y1 >= 20 ? 'apt' : (y2 - y1 >= 12 ? 'office' : null)), side);
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

    // Salon: koltuk takımı, cam sehpa, mutfak tezgâhı ve aile
    w.fillBox(x1 + 2, y1, z1 + 6, x1 + 5, y1 + 1, z1 + 10, PALETTE.WOOD);
    w.fillBox(x1 + 3, y1, z1 + 8, x1 + 4, y1 + 1, z1 + 8, PALETTE.GLASS);
    w.fillBox(x2 - 4, y1, z1 + 2, x2 - 2, y1 + 1, z1 + 8, PALETTE.WOOD);
    this.world.workers.push({ x: (x2 - 5.2) * 0.75, y: 0.5, z: (z1 + 5) * 0.75, yaw: Math.PI / 2, pose: 'stand', style: null, cook: true });
    this.world.workers.push({ x: (x1 + 3.5) * 0.75, y: 0.5, z: (z1 + 7) * 0.75, yaw: Math.PI / 2, pose: 'sit', style: null, watchTV: true });
    this.world.workers.push({ x: (x1 + 3.5) * 0.75, y: 0.5, z: (z1 + 9) * 0.75, yaw: Math.PI / 2, pose: 'sit', style: null, watchTV: true, k: 0.8 });

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

  // ─────────────────────────────────────────────────────────────────────────────
  // ORGANİK DALGALI SAHİL HATTI (Cetvelle çizilmemiş, doğal dalgalı kıvrımlı devasa plaj)
  // Şezlonglar, şemsiyeler, ahşap gezinti yolu, iskeleler, kumdan kaleler ve voleybol sahası
  // ─────────────────────────────────────────────────────────────────────────────
  buildOrganicBeach() {
    const w = this.b;
    // Doğal sahil kıvrım formülü: Cetvelle çizilmiş düz çizgiyi yok eden sinüzoidal harmonikler
    const coastWave = (z) => 28 * Math.sin(z * 0.014) + 16 * Math.cos(z * 0.032) + 8 * Math.sin(z * 0.065);

    // Her 4 birimlik Z diliminde dalgalı organik kumsal ve ahşap yürüyüş yolu
    for (let z = -800; z <= 800; z += 4) {
      const wave = coastWave(z);
      const beachX0 = Math.round(-845 + wave);
      const beachX1 = -770;
      // Geniş altın sarısı kumsal
      w.fillBox(beachX0, 0, z, beachX1, 0, z + 3, PALETTE.SAND);
      // Sahil boyunca uzanan ahşap gezinti yolu (broadwalk)
      w.fillBox(-780, 0, z, -770, 0, z + 3, PALETTE.WOOD);
    }

    // Denize uzanan 3 adet dev ahşap iskele ve T-platformları
    [-450, 0, 480].forEach(pz => {
      const pierWave = coastWave(pz);
      const pStart = Math.round(-845 + pierWave);
      w.fillBox(pStart - 40, 0, pz - 3, -770, 0, pz + 3, PALETTE.WOOD);
      // İskele ucu geniş T platformu
      w.fillBox(pStart - 52, 0, pz - 16, pStart - 40, 0, pz + 16, PALETTE.WOOD);
      // İskele korkulukları ve aydınlatması
      w.fillBox(pStart - 52, 1, pz - 16, pStart - 40, 1, pz - 16, PALETTE.IRON);
      w.fillBox(pStart - 52, 1, pz + 16, pStart - 40, 1, pz + 16, PALETTE.IRON);
      this.lampSub(Math.round(K * (pStart - 46)), Math.round(K * pz), GROUND_ROW_SUB + 1, 0, 0);
    });

    // Cankurtaran Kuleleri (Lifeguard Towers): Ahşap ayaklı, kırmızı çatılı plaj kuleleri
    [-320, 140, 360].forEach(lz => {
      const lx = Math.round(-805 + coastWave(lz) * 0.5);
      // 4 ayak
      [[lx, lz], [lx + 4, lz], [lx, lz + 4], [lx + 4, lz + 4]].forEach(([px, pz]) => w.fillBox(px, 1, pz, px, 6, pz, PALETTE.WOOD));
      w.fillBox(lx - 1, 6, lz - 1, lx + 5, 6, lz + 5, PALETTE.WOOD);           // gözetleme platformu
      w.fillBox(lx, 7, lz, lx + 4, 10, lz + 4, PALETTE.WHITE);                  // beyaz kulübe
      w.fillBox(lx + 1, 7, lz - 1, lx + 3, 9, lz - 1, PALETTE.GLASS);           // gözetleme camı
      w.fillBox(lx - 1, 11, lz - 1, lx + 5, 11, lz + 5, PALETTE.BRICK);         // kırmızı cankurtaran çatısı
      w.fillBox(lx + 2, 12, lz + 2, lx + 2, 14, lz + 2, PALETTE.IRON);          // bayrak direği
      w.fillBox(lx + 2, 13, lz + 3, lx + 2, 14, lz + 4, PALETTE.BRICK);         // kırmızı bayrak
    });

    // Plaj Voleybol Sahası: Kum saha, file direkleri ve voleybol filesi
    const vx0 = -800, vz0 = -60;
    w.fillBox(vx0 - 8, 1, vz0, vx0 - 8, 5, vz0, PALETTE.IRON);                  // sol direk
    w.fillBox(vx0 + 8, 1, vz0, vx0 + 8, 5, vz0, PALETTE.IRON);                  // sağ direk
    w.fillBox(vx0 - 7, 3, vz0, vx0 + 7, 4, vz0, PALETTE.WHITE);                 // voleybol filesi
    w.fillBox(vx0 - 8, 0, vz0 - 12, vx0 + 8, 0, vz0 + 12, PALETTE.GOLD);        // voleybol saha çizgisi

    // Renkli Plaj Şemsiyeleri ve Şezlong Grupları
    const umbrellaColors = [PALETTE.BRICK, PALETTE.BLUE, PALETTE.GOLD, PALETTE.LAMP_ORANGE, PALETTE.WHITE];
    for (let z = -650; z <= 650; z += 35) {
      if (Math.abs(z) < 80) continue; // voleybol ve iskele alanını açık bırak
      const ux = Math.round(-796 + coastWave(z) * 0.4);
      const col = umbrellaColors[Math.abs(Math.round(z / 35)) % umbrellaColors.length];
      // Şemsiye direği ve renkli kubbesi
      w.fillBox(ux, 1, z, ux, 4, z, PALETTE.IRON);
      w.fillBox(ux - 2, 5, z - 2, ux + 2, 5, z + 2, col);
      w.fillBox(ux - 1, 6, z - 1, ux + 1, 6, z + 1, col);
      // İki yanında ahşap/beyaz şezlonglar
      w.fillBox(ux - 3, 1, z - 1, ux - 1, 1, z + 1, PALETTE.WHITE);
      w.fillBox(ux + 1, 1, z - 1, ux + 3, 1, z + 1, PALETTE.WHITE);
    }

    // Çocuklar için Kumdan Kaleler (Sandcastles)
    [-200, 80, 260].forEach(cz => {
      const cx = Math.round(-815 + coastWave(cz) * 0.6);
      w.fillBox(cx - 2, 1, cz - 2, cx + 2, 1, cz + 2, PALETTE.SAND);            // kale kaidesi
      w.fillBox(cx - 2, 2, cz - 2, cx - 1, 3, cz - 1, PALETTE.SAND);            // köşe kule 1
      w.fillBox(cx + 1, 2, cz - 2, cx + 2, 3, cz - 1, PALETTE.SAND);            // köşe kule 2
      w.fillBox(cx - 2, 2, cz + 1, cx - 1, 3, cz + 2, PALETTE.SAND);            // köşe kule 3
      w.fillBox(cx + 1, 2, cz + 1, cx + 2, 3, cz + 2, PALETTE.SAND);            // köşe kule 4
      w.fillBox(cx, 2, cz, cx, 4, cz, PALETTE.SAND);                            // ana merkez kule
      w.fillBox(cx, 4, cz + 1, cx, 4, cz + 1, PALETTE.BRICK);                   // küçük kırmızı flama
      // Yanında kırmızı çocuk kovası
      w.fillBox(cx + 4, 1, cz, cx + 4, 1, cz, PALETTE.BRICK);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // KOCAMAN ULUSLARARASI HAVALİMANI (AVM Büyüklüğünde Terminal, Runway, ATC Tower, Jetler)
  // Konum: x: -740 .. -540, z: -680 .. -150
  // ─────────────────────────────────────────────────────────────────────────────
  buildAirport() {
    const w = this.b;
    w.beginBuilding();

    // 1. UÇAK PİSTİ (RUNWAY 09/27) — 40 birim genişlik, 480 birim uzunluk (360 metre!)
    const rX0 = -730, rX1 = -685, rZ0 = -660, rZ1 = -180;
    w.fillBox(rX0, 0, rZ0, rX1, 0, rZ1, PALETTE.ASPHALT);
    // Pist Eşik Çizgileri (Runway Threshold Piano Keys)
    for (let x = rX0 + 3; x <= rX1 - 3; x += 5) {
      w.fillBox(x, 0, rZ0 + 5, x + 2, 0, rZ0 + 20, PALETTE.WHITE); // kuzey eşiği
      w.fillBox(x, 0, rZ1 - 20, x + 2, 0, rZ1 - 5, PALETTE.WHITE); // güney eşiği
    }
    // Pist Merkez Kesik Şeritleri (Runway Centerline)
    const midRX = Math.round((rX0 + rX1) / 2);
    for (let z = rZ0 + 35; z <= rZ1 - 35; z += 24) {
      w.fillBox(midRX - 1, 0, z, midRX + 1, 0, z + 14, PALETTE.WHITE);
    }
    // Touchdown Zone Çift Beyaz Çizgileri
    [-600, -560, -280, -240].forEach(tz => {
      w.fillBox(rX0 + 6, 0, tz, rX0 + 12, 0, tz + 8, PALETTE.WHITE);
      w.fillBox(rX1 - 12, 0, tz, rX1 - 6, 0, tz + 8, PALETTE.WHITE);
    });
    // Pist Kenar ve Eşik Işıkları (Yeşil yaklaşma, kırmızı pist sonu ışıkları)
    for (let x = rX0; x <= rX1; x += 4) {
      w.fillBox(x, 1, rZ0, x, 1, rZ0, PALETTE.LAMP_GREEN);
      w.fillBox(x, 1, rZ1, x, 1, rZ1, PALETTE.LAMP);
    }
    for (let z = rZ0; z <= rZ1; z += 30) {
      w.fillBox(rX0, 1, z, rX0, 1, z, PALETTE.WHITE);
      w.fillBox(rX1, 1, z, rX1, 1, z, PALETTE.WHITE);
    }

    // 2. PARALEL TAKSİ YOLU (TAXIWAY) & APRON
    w.fillBox(-675, 0, -620, -655, 0, -200, PALETTE.ASPHALT);                   // taksi yolu
    // Pisti taksi yoluna bağlayan bağlantı kolları (High-speed exits)
    [-580, -420, -260].forEach(ez => {
      w.fillBox(-685, 0, ez, -675, 0, ez + 14, PALETTE.ASPHALT);
    });
    // Taksi yolu sarı merkez çizgisi
    for (let z = -615; z <= -205; z += 12) {
      w.fillBox(-666, 0, z, -665, 0, z + 8, PALETTE.GOLD);
    }
    // Uçak Bekleme Apronu (Geniş beton apron alanı)
    w.fillBox(-655, 0, -500, -590, 0, -260, PALETTE.CONCRETE);
    // Uçak park kılavuz çizgileri
    [-450, -380, -310].forEach(pz => {
      w.fillBox(-645, 0, pz, -605, 0, pz, PALETTE.GOLD);
      w.fillBox(-608, 0, pz - 6, -608, 0, pz + 6, PALETTE.GOLD);
    });

    // 3. MODERN DEVASA TERMİNAL BİNASI (AVM KADAR BÜYÜK!)
    // 50 x 180 birim (37.5 m genişlik, 135 m uzunluk, 3 katlı, yükseklik 24 m)
    const tX0 = -590, tX1 = -540, tZ0 = -490, tZ1 = -290;
    w.fillHollowBox(tX0, 1, tZ0, tX1, 24, tZ1, PALETTE.WHITE, PALETTE.CONCRETE);
    this.addFloors(tX0, 1, tZ0, tX1, 24, tZ1, PALETTE.CONCRETE);
    this.addStairs(tX0, 1, tZ0, tX1, 24, tZ1);

    // Panoramik aprona bakan cam cephe (batı yüzü)
    w.fillBox(tX0, 2, tZ0 + 6, tX0, 22, tZ1 - 6, PALETTE.GLASS);
    // Çelik cephe kolonları
    for (let z = tZ0 + 6; z <= tZ1 - 6; z += 16) {
      w.fillBox(tX0 - 1, 1, z - 1, tX0, 23, z + 1, PALETTE.IRON);
    }
    // Doğu cephesi ana yolcu girişleri (Otomatik sürgülü cam kapılar)
    [-440, -390, -340].forEach(gz => {
      w.clearBox(tX1, 1, gz - 4, tX1, 5, gz + 4);
      w.fillBox(tX1, 6, gz - 5, tX1 + 3, 6, gz + 5, PALETTE.WHITE);             // giriş sundurması
      this.world.doors.addSliding({
        sx: tX1 * 0.75, sz: (gz - 3) * 0.75,
        ax: 0, az: 1, width: 4.5, height: 3.2, y: 0.5
      });
    });

    // Terminal İçi:
    // Zemin Kat (Arrivals): Bagaj alım bantları (Luggage Carousels)
    [-450, -390, -330].forEach(bz => {
      w.fillBox(tX1 - 18, 1, bz - 6, tX1 - 6, 1, bz + 6, PALETTE.IRON);         // dönen bagaj bandı
      w.clearBox(tX1 - 15, 1, bz - 3, tX1 - 9, 1, bz + 3);                      // iç boşluk
      w.fillBox(tX1 - 15, 1, bz - 3, tX1 - 9, 2, bz + 3, PALETTE.WHITE);        // merkez süsü
    });
    // 1. Kat (Departures): Check-in Kontuarları ve Güvenlik X-Ray Kapıları
    for (let z = tZ0 + 20; z <= tZ1 - 20; z += 18) {
      w.fillBox(tX1 - 20, 8, z - 4, tX1 - 16, 9, z + 4, PALETTE.WHITE);         // check-in masası
      w.fillBox(tX1 - 20, 10, z - 2, tX1 - 20, 11, z + 2, PALETTE.IRON);        // bilet monitörleri
      // Güvenlik metal detektör kapısı
      w.fillBox(tX1 - 32, 8, z - 2, tX1 - 32, 11, z - 2, PALETTE.IRON);
      w.fillBox(tX1 - 32, 8, z + 2, tX1 - 32, 11, z + 2, PALETTE.IRON);
      w.fillBox(tX1 - 32, 11, z - 2, tX1 - 32, 11, z + 2, PALETTE.IRON);
    }
    // 2. Kat (Gates & Duty Free): Bekleme koltuk sıraları ve Duty-Free
    for (let z = tZ0 + 16; z <= tZ1 - 16; z += 14) {
      w.fillBox(tX0 + 8, 16, z - 4, tX0 + 12, 16, z + 4, PALETTE.WOOD);         // yolcu bekleme koltukları
      w.fillBox(tX0 + 8, 17, z - 4, tX0 + 8, 17, z + 4, PALETTE.WOOD);          // koltuk arkalığı
    }

    // 4. TELESKOPİK YOLCU KÖRÜKLERİ (JET BRIDGES)
    // 2. kattan apron üzerine uzanıp uçağa bağlanan körük tünelleri
    [-420, -350].forEach(jz => {
      // Çıkış kapısı
      w.clearBox(tX0, 16, jz - 2, tX0, 19, jz + 2);
      // Teleskopik körük tüneli
      w.fillBox(tX0 - 24, 15, jz - 3, tX0, 19, jz + 3, PALETTE.IRON);
      w.clearBox(tX0 - 23, 16, jz - 2, tX0 - 1, 18, jz + 2);
      // Körük cam pencereleri
      w.fillBox(tX0 - 20, 16, jz - 3, tX0 - 6, 17, jz - 3, PALETTE.GLASS);
      w.fillBox(tX0 - 20, 16, jz + 3, tX0 - 6, 17, jz + 3, PALETTE.GLASS);
      // Körük taşıyıcı tekerlekli pilon ayağı
      w.fillBox(tX0 - 20, 1, jz - 1, tX0 - 18, 15, jz + 1, PALETTE.IRON);
    });

    // Terminal Çatısında Dev Neon Işıklı HAVALİMANI Tabelası
    const midTZ = Math.round((tZ0 + tZ1) / 2);
    w.fillBox(tX1 - 2, 25, midTZ - 35, tX1 - 2, 29, midTZ + 35, PALETTE.IRON);
    w.fillBox(tX1 - 1, 26, midTZ - 30, tX1 - 1, 28, midTZ + 30, PALETTE.LAMP_BLUE); // parlayan mavi neon tabela

    // 5. HAVA TRAFİK KONTROL KULESİ (ATC TOWER) — 36 Metre Yüksekliğinde
    const cX0 = -618, cX1 = -608, cZ0 = -242, cZ1 = -232;
    w.fillHollowBox(cX0, 1, cZ0, cX1, 38, cZ1, PALETTE.CONCRETE, PALETTE.IRON);
    // Üstte 360 derece panoramik yeşil camlı kontrol kabini
    w.fillBox(cX0 - 3, 38, cZ0 - 3, cX1 + 3, 38, cZ1 + 3, PALETTE.CONCRETE);
    w.fillBox(cX0 - 3, 39, cZ0 - 3, cX1 + 3, 44, cZ1 + 3, PALETTE.GLASS);
    w.fillBox(cX0 - 3, 45, cZ0 - 3, cX1 + 3, 45, cZ1 + 3, PALETTE.IRON);       // kule tavanı
    // Tepede dönen radar anteni ve kırmızı uçak ikaz lambası
    const atcMidX = Math.round((cX0 + cX1) / 2), atcMidZ = Math.round((cZ0 + cZ1) / 2);
    w.fillBox(atcMidX, 46, atcMidZ, atcMidX, 50, atcMidZ, PALETTE.IRON);
    w.fillBox(atcMidX - 2, 48, atcMidZ, atcMidX + 2, 48, atcMidZ, PALETTE.IRON);
    w.fillBox(atcMidX, 51, atcMidZ, atcMidX, 52, atcMidZ, PALETTE.LAMP);         // tepede kırmızı ikaz flaşörü

    // 6. APRONDAKİ YOLCU UÇAKLARI (AIRLINER & BUSINESS JET)
    // Körük 1'de bekleyen büyük yolcu uçağı (Boeing 737 tipi)
    const px = tX0 - 36, pz = -420;
    // Gövde
    w.fillBox(px - 14, 4, pz - 3, px + 22, 9, pz + 3, PALETTE.WHITE);
    w.fillBox(px + 23, 4, pz - 2, px + 27, 8, pz + 2, PALETTE.WHITE);            // burun konisi
    w.fillBox(px + 28, 5, pz - 1, px + 29, 7, pz + 1, PALETTE.IRON);             // burun radarı
    w.fillBox(px + 23, 7, pz - 2, px + 25, 8, pz + 2, PALETTE.GLASS);            // kokpit camı
    // Yolcu pencereleri ve mavi havayolu şeridi
    w.fillBox(px - 12, 6, pz - 3, px + 20, 6, pz + 3, PALETTE.BLUE);
    w.fillBox(px - 12, 7, pz - 3, px + 18, 7, pz - 3, PALETTE.GLASS);
    w.fillBox(px - 12, 7, pz + 3, px + 18, 7, pz + 3, PALETTE.GLASS);
    // Kanatlar
    w.fillBox(px - 4, 4, pz - 26, px + 6, 5, pz - 4, PALETTE.WHITE);
    w.fillBox(px - 4, 4, pz + 4, px + 6, 5, pz + 26, PALETTE.WHITE);
    // Jet motorları
    w.fillBox(px, 2, pz - 14, px + 6, 5, pz - 11, PALETTE.IRON);
    w.fillBox(px, 2, pz + 11, px + 6, 5, pz + 14, PALETTE.IRON);
    // Kuyruk dikmesi
    w.fillBox(px - 14, 9, pz, px - 8, 17, pz, PALETTE.BLUE);
    w.fillBox(px - 14, 9, pz - 8, px - 10, 10, pz + 8, PALETTE.WHITE);           // yatay dengeleyici

    // Körük 2'de bekleyen ikinci yolcu uçağı
    const p2x = tX0 - 36, p2z = -350;
    w.fillBox(p2x - 14, 4, p2z - 3, p2x + 22, 9, p2z + 3, PALETTE.WHITE);
    w.fillBox(p2x + 23, 4, p2z - 2, p2x + 27, 8, p2z + 2, PALETTE.WHITE);
    w.fillBox(p2x + 28, 5, p2z - 1, p2x + 29, 7, p2z + 1, PALETTE.IRON);
    w.fillBox(p2x + 23, 7, p2z - 2, p2x + 25, 8, p2z + 2, PALETTE.GLASS);
    w.fillBox(p2x - 12, 6, p2z - 3, p2x + 20, 6, p2z + 3, PALETTE.BRICK);        // kırmızı havayolu şeridi
    w.fillBox(p2x - 4, 4, p2z - 26, p2x + 6, 5, p2z - 4, PALETTE.WHITE);
    w.fillBox(p2x - 4, 4, p2z + 4, p2x + 6, 5, p2z + 26, PALETTE.WHITE);
    w.fillBox(p2x, 2, p2z - 14, p2x + 6, 5, p2z - 11, PALETTE.IRON);
    w.fillBox(p2x, 2, p2z + 11, p2x + 6, 5, p2z + 14, PALETTE.IRON);
    w.fillBox(p2x - 14, 9, p2z, p2x - 8, 17, p2z, PALETTE.BRICK);
    w.fillBox(p2x - 14, 9, p2z - 8, p2x - 10, 10, p2z + 8, PALETTE.WHITE);

    // Apronda park etmiş lüks Özel Jet (Business Jet)
    const jx = -635, jz = -280;
    w.fillBox(jx - 8, 2, jz - 2, jx + 10, 5, jz + 2, PALETTE.WHITE);
    w.fillBox(jx + 11, 2, jz - 1, jx + 13, 4, jz + 1, PALETTE.WHITE);
    w.fillBox(jx + 11, 4, jz - 1, jx + 12, 4, jz + 1, PALETTE.GLASS);            // kokpit
    w.fillBox(jx - 2, 2, jz - 12, jx + 3, 3, jz + 12, PALETTE.WHITE);            // kanatlar
    w.fillBox(jx - 2, 3, jz - 12, jx - 2, 5, jz - 12, PALETTE.GOLD);             // winglet altın
    w.fillBox(jx - 2, 3, jz + 12, jx - 2, 5, jz + 12, PALETTE.GOLD);
    w.fillBox(jx - 8, 5, jz, jx - 5, 9, jz, PALETTE.GOLD);                       // altın şık kuyruk

    // 7. UÇAK BAKIM HANGARI (Büyük çelik tonozlu hangar)
    const hX0 = -660, hX1 = -625, hZ0 = -195, hZ1 = -155;
    w.fillHollowBox(hX0, 1, hZ0, hX1, 16, hZ1, PALETTE.IRON, PALETTE.CONCRETE);
    w.clearBox(hX0 + 4, 1, hZ1, hX1 - 4, 14, hZ1);                               // dev hangar kapısı (açık)
    w.fillBox(hX0 + 10, 1, hZ0 + 10, hX0 + 14, 4, hZ0 + 14, PALETTE.WOOD);       // alet tezgahları
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
