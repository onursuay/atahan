import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// METROPOL BELEDİYESİ TOPLU TAŞIMA SİSTEMİ (HAT 101: SAHİL - MEYDAN - DOĞU ADA)
//  • Modern cam saçaklı, totemli, oturma banklı otobüs durakları.
//  • Duraklarda dinamik yolcu kalabalığı (boş, 1-2 kişi veya kalabalık).
//  • Kaptan Rıza Şoförlü, çift havalı kapılı, sinyalli, körüklü/solo belediye otobüsü.
//  • Otonom sürüş yapay zekası: duraklara yaklaşırken sağ sinyal verir, hafifçe
//    kaldırıma yanaşır, havalı frenle durur, kapıları açar, yolcu indirip bindirir.
//  • Oyuncu yolcu olarak binebilir; otobüsü şoför sürer, duraklarda inilebilir.
// ─────────────────────────────────────────────────────────────────────────────

const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const matCache = new Map();
const MAT = (color, opt = {}) => {
  const key = `${color}_${opt.roughness ?? 0.5}_${opt.metalness ?? 0.1}_${opt.transparent ?? false}_${opt.opacity ?? 1}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: opt.roughness ?? 0.5,
      metalness: opt.metalness ?? 0.1,
      transparent: opt.transparent ?? false,
      opacity: opt.opacity ?? 1,
      side: opt.double ? THREE.DoubleSide : THREE.FrontSide
    }));
  }
  return matCache.get(key);
};

// Durak tanımları (Doğu-Batı hattı cadde-0 boyunca)
export const BUS_STOPS = [
  // ── DOĞU YÖNÜ DURAKLARI (Kaldırım: z = +4.8, gidiş şeridi: z = +2.1, cebe yanaşma: z = +3.6) ──
  {
    id: 'stop-east-1',
    name: 'Plaj & Sahil Kordon Durağı',
    x: -480, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Halk Plajı, İskele ve Kordon Gezinti Yolu'
  },
  {
    id: 'stop-east-2',
    name: 'Havalimanı Terminal Durağı',
    x: -360, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Havalimanı İç & Dış Hatlar Girişi'
  },
  {
    id: 'stop-east-3',
    name: 'Çocuk Parkı & Şehir Parkı Durağı',
    x: -220, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Büyük Şehir Parkı & Oyun Alanları'
  },
  {
    id: 'stop-east-4',
    name: 'Şehir Meydanı & Metro Durağı',
    x: -70, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Metro Aktarma, AVM ve Finans Kuleleri'
  },
  {
    id: 'stop-east-5',
    name: 'Boğaz Köprüsü Giriş Durağı',
    x: -15, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Asma Köprü Girişi & Seyir Terası'
  },
  {
    id: 'stop-east-6',
    name: 'Doğu Ada & Merkez Park Durağı',
    x: 240, z: 4.8, roadZ: 2.1, curbZ: 3.6, dir: 1,
    desc: 'Merkez Park, Hastane ve Üniversite Kampüsü'
  },

  // ── BATI YÖNÜ DÖNÜŞ DURAKLARI (Kaldırım: z = -4.8, dönüş şeridi: z = -2.1, cebe yanaşma: z = -3.6) ──
  {
    id: 'stop-west-1',
    name: 'Doğu Ada Köprübaşı Durağı',
    x: 240, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Doğu Ada Konutları & Villalar'
  },
  {
    id: 'stop-west-2',
    name: 'Boğaz Köprüsü Batı Çıkış Durağı',
    x: -15, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Tarihi İskele & Sahil Bağlantısı'
  },
  {
    id: 'stop-west-3',
    name: 'Şehir Meydanı Kuzey Durağı',
    x: -70, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Belediye Binası & İş Merkezleri'
  },
  {
    id: 'stop-west-4',
    name: 'Spor Kompleksi & Park Durağı',
    x: -220, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Futbol & Basketbol Sahaları'
  },
  {
    id: 'stop-west-5',
    name: 'Havalimanı Kuzey Kapısı Durağı',
    x: -360, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Havalimanı Kargo & Teknik Tesisler'
  },
  {
    id: 'stop-west-6',
    name: 'Kordon Son Durak',
    x: -480, z: -4.8, roadZ: -2.1, curbZ: -3.6, dir: -1,
    desc: 'Batı Sahil Marina & Deniz Feneri'
  }
];

export class BusManager {
  constructor(scene, voxelWorld, character) {
    this.scene = scene;
    this.voxelWorld = voxelWorld;
    this.character = character;
    this.stops = [];
    this.buses = [];
    this.passengerState = {
      inBus: false,
      bus: null,
      stopRequest: false
    };

    this.promptEl = null;
    this.hudEl = null;
    this._createUI();

    this.initStops();
    this.initBuses();
  }

  // ── UI Katmanı: Otobüs Bilgi Paneli & [E] İpucu ──
  _createUI() {
    // 1. Yaklaşınca beliren biniş ipucu
    this.promptEl = document.createElement('div');
    this.promptEl.id = 'bus-prompt';
    this.promptEl.style.cssText = `
      position: fixed;
      bottom: 85px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      border: 2px solid #0284c7;
      border-radius: 12px;
      color: #ffffff;
      padding: 10px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(2, 132, 199, 0.4);
      display: none;
      z-index: 9999;
      pointer-events: none;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    `;
    document.body.appendChild(this.promptEl);

    // 2. Otobüs yolcu seyahat paneli (Üst orta)
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'bus-hud';
    this.hudEl.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.94));
      border: 2px solid #0284c7;
      border-radius: 14px;
      color: #f8fafc;
      padding: 12px 28px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7), 0 0 20px rgba(14, 165, 233, 0.35);
      display: none;
      z-index: 9999;
      text-align: center;
      min-width: 380px;
      pointer-events: none;
    `;
    document.body.appendChild(this.hudEl);
  }

  // ── Otobüs Duraklarını İnşa Et ──
  initStops() {
    BUS_STOPS.forEach((spec, idx) => {
      const stopGroup = new THREE.Group();
      stopGroup.position.set(spec.x, 0.5, spec.z);
      // Batı yönü durakları güneye baksın, Doğu yönü durakları kuzeye baksın
      if (spec.dir < 0) {
        stopGroup.rotation.y = Math.PI;
      }

      // 1. Zemin Tabanı / Kaldırım Genişlemesi (Tactile Platform)
      const platform = new THREE.Mesh(BOX(7.2, 0.18, 2.4), MAT(0x334155, { roughness: 0.8 }));
      platform.position.set(0, -0.09, 0);
      stopGroup.add(platform);

      // Sarı kabartmalı görme engelli kılavuz şeridi (yol kenarı)
      const tactile = new THREE.Mesh(BOX(7.0, 0.04, 0.3), MAT(0xfacc15, { roughness: 0.4 }));
      tactile.position.set(0, 0.02, spec.dir > 0 ? -1.0 : 1.0);
      stopGroup.add(tactile);

      // 2. Modern Cam Durak Saçağı (Canopy Shelter)
      // Çelik direkler
      const pillarMat = MAT(0x1e293b, { metalness: 0.8, roughness: 0.3 });
      const p1 = new THREE.Mesh(BOX(0.12, 2.7, 0.12), pillarMat); p1.position.set(-2.6, 1.35, 0.9);
      const p2 = new THREE.Mesh(BOX(0.12, 2.7, 0.12), pillarMat); p2.position.set(2.6, 1.35, 0.9);
      const p3 = new THREE.Mesh(BOX(0.12, 2.7, 0.12), pillarMat); p3.position.set(-2.6, 1.35, -0.9);
      const p4 = new THREE.Mesh(BOX(0.12, 2.7, 0.12), pillarMat); p4.position.set(2.6, 1.35, -0.9);
      stopGroup.add(p1, p2, p3, p4);

      // Üst çatı saçağı
      const roofFrame = new THREE.Mesh(BOX(5.8, 0.12, 2.4), MAT(0x0f172a, { metalness: 0.6 }));
      roofFrame.position.set(0, 2.75, 0);
      const roofGlass = new THREE.Mesh(BOX(5.6, 0.05, 2.2), MAT(0x38bdf8, { transparent: true, opacity: 0.45, roughness: 0.1 }));
      roofGlass.position.set(0, 2.82, 0);
      stopGroup.add(roofFrame, roofGlass);

      // Arka koruyucu lamine cam panel
      const backGlass = new THREE.Mesh(BOX(5.1, 2.3, 0.06), MAT(0xbae6fd, { transparent: true, opacity: 0.38, roughness: 0.1 }));
      backGlass.position.set(0, 1.35, 0.9);
      stopGroup.add(backGlass);

      // Şehir ve durak harita panosu (Arka camın ortasında)
      const mapAd = new THREE.Mesh(BOX(1.8, 1.4, 0.08), MAT(0x0284c7));
      mapAd.position.set(0, 1.4, 0.88);
      stopGroup.add(mapAd);

      // 3. Durak İçi Ahşap Oturma Bankı
      const benchWood = MAT(0x92400e, { roughness: 0.7 });
      const benchLegMat = MAT(0x1e293b, { metalness: 0.7 });
      const bSeat = new THREE.Mesh(BOX(3.2, 0.08, 0.5), benchWood); bSeat.position.set(0, 0.5, 0.6);
      const bBack = new THREE.Mesh(BOX(3.2, 0.4, 0.06), benchWood); bBack.position.set(0, 0.85, 0.82);
      const bLeg1 = new THREE.Mesh(BOX(0.08, 0.5, 0.45), benchLegLegMat || benchLegMat); bLeg1.position.set(-1.3, 0.25, 0.6);
      const bLeg2 = new THREE.Mesh(BOX(0.08, 0.5, 0.45), benchLegMat); bLeg2.position.set(1.3, 0.25, 0.6);
      stopGroup.add(bSeat, bBack, bLeg1, bLeg2);

      // 4. Akıllı Durak Totemi & LED Gösterge Direği
      const totemPole = new THREE.Mesh(BOX(0.24, 3.8, 0.24), MAT(0x1e293b, { metalness: 0.7 }));
      totemPole.position.set(3.4, 1.9, -0.6);
      // Başlık tabelası "DURAK"
      const totemHead = new THREE.Mesh(BOX(0.85, 0.85, 0.3), MAT(0x0284c7));
      totemHead.position.set(3.4, 3.4, -0.6);
      // Dijital LED Pano (Hat numarası ve varış süresi)
      const ledSign = new THREE.Mesh(BOX(1.4, 0.45, 0.2), MAT(0x0f172a));
      ledSign.position.set(3.4, 2.65, -0.6);
      const ledAmber = new THREE.Mesh(BOX(1.3, 0.35, 0.02), MAT(0xf59e0b, { roughness: 0.2 }));
      ledAmber.position.set(3.4, 2.65, -0.49);
      stopGroup.add(totemPole, totemHead, ledSign, ledAmber);

      // 5. Durak içi tavan aydınlatma lambası
      const lamp = new THREE.PointLight(0xfef08a, 0.9, 8);
      lamp.position.set(0, 2.6, 0);
      stopGroup.add(lamp);

      this.scene.add(stopGroup);

      // 6. Dinamik Yolcu Kalabalığı (Kullanıcı isteği: bazen kalabalık, bazen 1-2 kişi, bazen boş)
      // Rastgele kalabalık belirle:
      // idx % 4 === 0 -> Kalabalık (4-5 kişi)
      // idx % 4 === 1 -> 1-2 kişi
      // idx % 4 === 2 -> 0 kişi (boş)
      // idx % 4 === 3 -> 3 kişi
      let crowdCount = 0;
      if (idx % 3 === 0) crowdCount = 4 + Math.floor(Math.random() * 2);
      else if (idx % 3 === 1) crowdCount = 1 + Math.floor(Math.random() * 2);
      else crowdCount = Math.random() < 0.35 ? 1 : 0; // bazen tamamen boş

      const passengers = [];
      for (let p = 0; p < crowdCount; p++) {
        const passMesh = this._createWaitingPassenger(p);
        stopGroup.add(passMesh);
        passengers.push(passMesh);
      }

      this.stops.push({
        ...spec,
        group: stopGroup,
        passengers,
        crowdCount
      });
    });
  }

  // Durakta bekleyen sevimli voxel insan modeli
  _createWaitingPassenger(slot) {
    const g = new THREE.Group();
    const isFemale = slot % 2 === 1;
    const isSitting = slot === 0 || (slot === 1 && Math.random() < 0.5);

    const skins = [0xe0ac86, 0xc68642, 0xf1c27d, 0xffdbac];
    const shirts = [0xdc2626, 0x2563eb, 0x16a34a, 0x9333ea, 0xf59e0b, 0x0891b2, 0xe11d48];
    const pants = [0x1e293b, 0x334155, 0x475569, 0x1e3a8a];

    const skin = skins[Math.floor(Math.random() * skins.length)];
    const shirt = shirts[Math.floor(Math.random() * shirts.length)];
    const pant = pants[Math.floor(Math.random() * pants.length)];

    const head = new THREE.Mesh(BOX(0.3, 0.3, 0.3), MAT(skin)); head.position.y = 1.35;
    const hair = new THREE.Mesh(BOX(0.32, 0.12, 0.32), MAT(0x2b1b0e)); hair.position.y = 1.52;
    const torso = new THREE.Mesh(BOX(0.36, 0.5, 0.22), MAT(shirt)); torso.position.y = 0.95;

    const lArm = new THREE.Mesh(BOX(0.12, 0.45, 0.12), MAT(shirt)); lArm.position.set(-0.25, 0.92, 0);
    const rArm = new THREE.Mesh(BOX(0.12, 0.45, 0.12), MAT(shirt)); rArm.position.set(0.25, 0.92, 0);

    const lLeg = new THREE.Mesh(BOX(0.15, 0.5, 0.15), MAT(pant));
    const rLeg = new THREE.Mesh(BOX(0.15, 0.5, 0.15), MAT(pant));

    if (isSitting) {
      // Bankta oturan yolcu pozisyonu
      lLeg.position.set(-0.09, 0.45, 0.2); lLeg.rotation.x = -Math.PI / 2;
      rLeg.position.set(0.09, 0.45, 0.2); rLeg.rotation.x = -Math.PI / 2;
      g.add(head, hair, torso, lArm, rArm, lLeg, rLeg);
      g.position.set(-0.8 + slot * 0.85, 0.05, 0.6);
    } else {
      // Ayakta otobüs bekleyen yolcu
      lLeg.position.set(-0.09, 0.3, 0);
      rLeg.position.set(0.09, 0.3, 0);
      // Elinde telefonla bekleyen yolcu
      if (Math.random() < 0.6) {
        rArm.position.set(0.2, 1.05, 0.18);
        rArm.rotation.x = -0.9;
        const phone = new THREE.Mesh(BOX(0.07, 0.12, 0.02), MAT(0x0f172a));
        phone.position.set(0.22, 1.05, 0.28);
        g.add(phone);
      }
      g.add(head, hair, torso, lArm, rArm, lLeg, rLeg);
      // Durak platformu üzerinde ayakta bekleme yerleri
      g.position.set(-1.8 + slot * 0.9, 0.1, -0.15 + (slot % 2) * 0.45);
      g.rotation.y = (Math.random() - 0.5) * 0.6;
    }

    g.scale.setScalar(1.2);
    return g;
  }

  // ── Otobüs Filosunu Başlat (Metropol 101 Ekspres) ──
  initBuses() {
    // Hat 101 için 2 adet karşılıklı çalışan otobüs
    // Otobüs 1: Doğu yönü gidiş rotası üzerinde
    this.buses.push(this._buildCityBus({
      id: 'bus-1',
      x: -460,
      z: 2.1,
      heading: 0, // Doğuya (+x) hareket eder
      dir: 1,
      targetStopIndex: 1
    }));

    // Otobüs 2: Batı yönü dönüş rotası üzerinde
    this.buses.push(this._buildCityBus({
      id: 'bus-2',
      x: 180,
      z: -2.1,
      heading: Math.PI, // Batıya (-x) hareket eder
      dir: -1,
      targetStopIndex: 7
    }));
  }

  // ── 3D Belediye Otobüsü ve Kaptan Şoför Modeli ──
  _buildCityBus(spec) {
    const busGroup = new THREE.Group();
    busGroup.position.set(spec.x, 0.85, spec.z);
    busGroup.rotation.y = spec.heading;

    // Otobüs boyutları: Uzunluk: 11.2m, Genişlik: 2.65m, Yükseklik: 3.3m
    const L = 11.2, W = 2.65, H = 3.25;

    // Malzemeler
    const matTurquoise = MAT(0x0284c7, { metalness: 0.35, roughness: 0.4 }); // Turkuaz alt gövde
    const matWhite = MAT(0xf8fafc, { metalness: 0.2, roughness: 0.3 });      // Beyaz tavan ve üst gövde
    const matDark = MAT(0x1e293b, { metalness: 0.6, roughness: 0.5 });       // Alt etek ve tamponlar
    const matGlass = MAT(0x38bdf8, { transparent: true, opacity: 0.45, roughness: 0.05 }); // Panoramik camlar
    const matWheel = MAT(0x111827, { roughness: 0.85 });                     // Lastik
    const matHubcap = MAT(0xe2e8f0, { metalness: 0.9, roughness: 0.2 });      // Jant kapağı

    // 1. Ana Şasi ve Alt Gövde
    const chassis = new THREE.Mesh(BOX(L, 0.4, W), matDark);
    chassis.position.y = 0.2;
    busGroup.add(chassis);

    // Yan paneller (Turkuaz alt kuşak)
    const lowerBody = new THREE.Mesh(BOX(L, 1.1, W), matTurquoise);
    lowerBody.position.y = 0.9;
    busGroup.add(lowerBody);

    // Üst beyaz kuşak ve tavan
    const roof = new THREE.Mesh(BOX(L, 0.35, W), matWhite);
    roof.position.y = 2.9;
    busGroup.add(roof);

    // Tavan klima ünitesi
    const acUnit = new THREE.Mesh(BOX(3.2, 0.28, 1.4), matWhite);
    acUnit.position.set(0, 3.18, 0);
    busGroup.add(acUnit);

    // 2. Panoramik Yan Camlar
    const sideGlassLeft = new THREE.Mesh(BOX(L - 0.4, 1.1, 0.08), matGlass);
    sideGlassLeft.position.set(0, 2.05, -W / 2 + 0.04);
    const sideGlassRight = new THREE.Mesh(BOX(L - 0.4, 1.1, 0.08), matGlass);
    sideGlassRight.position.set(0, 2.05, W / 2 - 0.04);
    busGroup.add(sideGlassLeft, sideGlassRight);

    // Ön Panoramik Ön Cam (Rüzgarlık)
    const frontWindshield = new THREE.Mesh(BOX(0.08, 1.4, W - 0.2), matGlass);
    frontWindshield.position.set(L / 2 - 0.04, 2.05, 0);
    busGroup.add(frontWindshield);

    // Arka Cam
    const rearWindow = new THREE.Mesh(BOX(0.08, 1.1, W - 0.3), matGlass);
    rearWindow.position.set(-L / 2 + 0.04, 2.1, 0);
    busGroup.add(rearWindow);

    // 3. Ön Dijital LED Hat Tabelası (101 METROPOL EKSPRES)
    const signBox = new THREE.Mesh(BOX(0.2, 0.45, 1.8), MAT(0x090d16));
    signBox.position.set(L / 2 - 0.08, 2.85, 0);
    const signLED = new THREE.Mesh(BOX(0.02, 0.38, 1.7), MAT(0xf59e0b, { roughness: 0.1 }));
    signLED.position.set(L / 2 + 0.02, 2.85, 0);
    busGroup.add(signBox, signLED);

    // 4. Havalı Çift Kanatlı Yolcu Kapıları (Sağ tarafta, durak tarafı)
    // Ön kapı (Şoför yanı yolcu biniş)
    const frontDoorL = new THREE.Mesh(BOX(0.65, 2.1, 0.06), matGlass);
    frontDoorL.position.set(L / 2 - 1.2, 1.4, W / 2);
    const frontDoorR = new THREE.Mesh(BOX(0.65, 2.1, 0.06), matGlass);
    frontDoorR.position.set(L / 2 - 1.85, 1.4, W / 2);
    // Orta kapı (İniş kapısı)
    const midDoorL = new THREE.Mesh(BOX(0.7, 2.1, 0.06), matGlass);
    midDoorL.position.set(-0.2, 1.4, W / 2);
    const midDoorR = new THREE.Mesh(BOX(0.7, 2.1, 0.06), matGlass);
    midDoorR.position.set(-0.9, 1.4, W / 2);
    busGroup.add(frontDoorL, frontDoorR, midDoorL, midDoorR);

    // 5. 6 Tekerlek (Ön tekler, arka çiftler)
    const wheels = [];
    const wheelPositions = [
      [L / 2 - 1.8, 0, W / 2 + 0.05],
      [L / 2 - 1.8, 0, -W / 2 - 0.05],
      [-L / 2 + 2.4, 0, W / 2 + 0.05],
      [-L / 2 + 2.4, 0, -W / 2 - 0.05],
      [-L / 2 + 3.6, 0, W / 2 + 0.05],
      [-L / 2 + 3.6, 0, -W / 2 - 0.05]
    ];
    wheelPositions.forEach(([wx, wy, wz]) => {
      const wG = new THREE.Group();
      wG.position.set(wx, wy, wz);
      const tire = new THREE.Mesh(BOX(0.85, 0.85, 0.28), matWheel);
      const hub = new THREE.Mesh(BOX(0.45, 0.45, 0.32), matHubcap);
      wG.add(tire, hub);
      busGroup.add(wG);
      wheels.push(wG);
    });

    // 6. Farlar, Stop Lambaları ve Sinyaller
    const headL = new THREE.Mesh(BOX(0.1, 0.25, 0.4), MAT(0xffffff, { roughness: 0.1 }));
    headL.position.set(L / 2 + 0.05, 0.75, 0.8);
    const headR = new THREE.Mesh(BOX(0.1, 0.25, 0.4), MAT(0xffffff, { roughness: 0.1 }));
    headR.position.set(L / 2 + 0.05, 0.75, -0.8);
    // Arka stop ve fren lambaları
    const tailL = new THREE.Mesh(BOX(0.1, 0.35, 0.25), MAT(0xdc2626, { roughness: 0.2 }));
    tailL.position.set(-L / 2 - 0.05, 0.85, 0.9);
    const tailR = new THREE.Mesh(BOX(0.1, 0.35, 0.25), MAT(0xdc2626, { roughness: 0.2 }));
    tailR.position.set(-L / 2 - 0.05, 0.85, -0.9);
    // Sinyal lambaları (Amber)
    const turnFrontR = new THREE.Mesh(BOX(0.08, 0.15, 0.15), MAT(0xf59e0b, { roughness: 0.2 }));
    turnFrontR.position.set(L / 2 + 0.04, 0.95, W / 2 - 0.05);
    const turnRearR = new THREE.Mesh(BOX(0.08, 0.15, 0.15), MAT(0xf59e0b, { roughness: 0.2 }));
    turnRearR.position.set(-L / 2 - 0.04, 0.95, W / 2 - 0.05);
    const turnFrontL = new THREE.Mesh(BOX(0.08, 0.15, 0.15), MAT(0xf59e0b, { roughness: 0.2 }));
    turnFrontL.position.set(L / 2 + 0.04, 0.95, -W / 2 + 0.05);
    const turnRearL = new THREE.Mesh(BOX(0.08, 0.15, 0.15), MAT(0xf59e0b, { roughness: 0.2 }));
    turnRearL.position.set(-L / 2 - 0.04, 0.95, -W / 2 + 0.05);

    busGroup.add(headL, headR, tailL, tailR, turnFrontR, turnRearR, turnFrontL, turnRearL);

    // 7. Şoför Kabini & KAPTAN RIZA (AI Şoför NPC)
    const driverGroup = new THREE.Group();
    driverGroup.position.set(L / 2 - 1.4, 0.9, -0.65); // Sol ön sürücü koltuğu

    // Şoför koltuğu & Direksiyon
    const dSeat = new THREE.Mesh(BOX(0.6, 0.6, 0.6), MAT(0x1e293b));
    const steerCol = new THREE.Mesh(BOX(0.08, 0.45, 0.08), MAT(0x475569));
    steerCol.position.set(0.35, 0.45, 0); steerCol.rotation.z = -0.35;
    const steerWheel = new THREE.Mesh(BOX(0.06, 0.38, 0.38), MAT(0x0f172a));
    steerWheel.position.set(0.48, 0.62, 0); steerWheel.rotation.z = -0.35;
    driverGroup.add(dSeat, steerCol, steerWheel);

    // Kaptan Rıza Modeli
    const skin = MAT(0xe0ac86);
    const uniform = MAT(0x1e3a8a); // Mavi şoför üniforması
    const capGold = MAT(0xfacc15); // Kasket brövesi

    const dHead = new THREE.Mesh(BOX(0.28, 0.28, 0.28), skin); dHead.position.set(0, 0.95, 0);
    const dCap = new THREE.Mesh(BOX(0.32, 0.12, 0.32), uniform); dCap.position.set(0, 1.1, 0);
    const dCapBrim = new THREE.Mesh(BOX(0.14, 0.03, 0.28), MAT(0x0f172a)); dCapBrim.position.set(0.18, 1.05, 0);
    const dTorso = new THREE.Mesh(BOX(0.38, 0.52, 0.45), uniform); dTorso.position.set(0, 0.58, 0);
    // Direksiyon tutan kollar
    const dArmL = new THREE.Mesh(BOX(0.36, 0.12, 0.12), uniform); dArmL.position.set(0.22, 0.6, -0.18);
    const dArmR = new THREE.Mesh(BOX(0.36, 0.12, 0.12), uniform); dArmR.position.set(0.22, 0.6, 0.18);

    driverGroup.add(dHead, dCap, dCapBrim, dTorso, dArmL, dArmR);
    busGroup.add(driverGroup);

    // 8. İç Yolcu Koltukları ve Yolcular
    for (let s = 0; s < 4; s++) {
      const pSeat = new THREE.Mesh(BOX(0.65, 0.45, 0.55), MAT(0x2563eb));
      pSeat.position.set(-L / 2 + 2.5 + s * 1.6, 0.65, -0.7);
      busGroup.add(pSeat);
    }
    // Sarı tutunma boruları
    const grabRail = new THREE.Mesh(BOX(L - 2, 0.05, 0.05), MAT(0xfacc15));
    grabRail.position.set(0, 2.5, 0);
    busGroup.add(grabRail);

    // İç tavan LED aydınlatması
    const busLight = new THREE.PointLight(0xffedd5, 0.8, 10);
    busLight.position.set(0, 2.6, 0);
    busGroup.add(busLight);

    this.scene.add(busGroup);

    return {
      id: spec.id,
      group: busGroup,
      x: spec.x,
      z: spec.z,
      heading: spec.heading,
      dir: spec.dir,
      speed: 10.5,       // Normal seyir hızı (~38 km/h)
      targetSpeed: 10.5,
      state: 'CRUISING', // CRUISING, APPROACHING, STOPPED, DEPARTING
      targetStopIndex: spec.targetStopIndex,
      stopTimer: 0,
      doorsOpen: false,
      doorProgress: 0,
      wheels,
      driverHead: dHead,
      steerWheel,
      frontDoors: [frontDoorL, frontDoorR],
      midDoors: [midDoorL, midDoorR],
      turnR: [turnFrontR, turnRearR],
      turnL: [turnFrontL, turnRearL],
      brakeLight: [tailL, tailR],
      turnBlinkPhase: 0,
      turnSignalActive: null // 'R' | 'L' | null
    };
  }

  // ── Her Kare Güncelleme (Otobüs AI & Oyuncu Kontrolü) ──
  update(dt, character, inputState) {
    const playerPos = character.mesh.position;

    // Otobüsleri güncelle
    for (const bus of this.buses) {
      this._updateBusAI(bus, dt);
    }

    // Oyuncu otobüste mi yoksa dışarıda mı?
    if (this.passengerState.inBus) {
      this._updatePassengerRiding(dt, character);
    } else {
      this._checkNearbyBusPrompt(playerPos);
    }
  }

  // ── Otonom Otobüs Sürüş AI & Durak Yanaşma Protokolü ──
  _updateBusAI(bus, dt) {
    const targetStop = this.stops[bus.targetStopIndex];
    if (!targetStop) return;

    // Hedef durağa olan yatay mesafe
    const dx = targetStop.x - bus.x;
    const distToStop = Math.abs(dx);
    const isApproachingDirection = (bus.dir > 0 && dx > 0) || (bus.dir < 0 && dx < 0);

    // Sinyal lambası yanıp sönme fazı
    bus.turnBlinkPhase += dt * 7;
    const blinkOn = Math.sin(bus.turnBlinkPhase) > 0;
    bus.turnR.forEach(m => m.material.color.setHex(bus.turnSignalActive === 'R' && blinkOn ? 0xf59e0b : 0x451a03));
    bus.turnL.forEach(m => m.material.color.setHex(bus.turnSignalActive === 'L' && blinkOn ? 0xf59e0b : 0x451a03));

    // Tekerleklerin dönme animasyonu
    const wheelRot = (bus.speed / 0.425) * dt * bus.dir;
    bus.wheels.forEach(w => {
      w.rotation.z += wheelRot;
    });

    // Şoför kafa hareketi (ara sıra aynalara ve kavşağa bakar)
    bus.driverHead.rotation.y = Math.sin(Date.now() * 0.0015) * 0.25;

    // Durum Makinesi
    switch (bus.state) {
      case 'CRUISING': {
        bus.targetSpeed = 11.0;
        bus.turnSignalActive = null;
        // Normal sürüş şeridine doğru hizalanma
        const targetZ = targetStop.roadZ;
        bus.z += (targetZ - bus.z) * Math.min(1, dt * 1.5);

        // Durağa 38 metre kala yaklaşma ve yavaşlama moduna geç
        if (isApproachingDirection && distToStop < 38) {
          bus.state = 'APPROACHING';
          bus.turnSignalActive = 'R'; // Sağ sinyal (durak tarafına yanaşma)
        }
        break;
      }

      case 'APPROACHING': {
        // Durak cebine / kaldırıma doğru hafifçe yanaşma ("hafif kenara çekecek")
        const targetCurbZ = targetStop.curbZ;
        bus.z += (targetCurbZ - bus.z) * Math.min(1, dt * 2.2);

        // Frenleme: durağa yaklaştıkça hızı orantılı düşür
        const brakeFactor = Math.max(0.1, distToStop / 36);
        bus.targetSpeed = 11.0 * brakeFactor;
        bus.brakeLight.forEach(l => l.material.color.setHex(0xff1111));

        // Tam durağın önüne geldiğinde dur
        if (distToStop < 1.2 || (bus.dir > 0 && bus.x >= targetStop.x) || (bus.dir < 0 && bus.x <= targetStop.x)) {
          bus.x = targetStop.x;
          bus.speed = 0;
          bus.targetSpeed = 0;
          bus.state = 'STOPPED';
          bus.stopTimer = 8.0; // 8 saniye durakta bekle
          bus.turnSignalActive = null;

          // Havalı fren sesi (tıslama)
          sound.playBusBrake();
          // Kapı açılma sesi ve uyarı zili
          setTimeout(() => {
            sound.playBusDoor();
            sound.playBusChime();
          }, 350);

          // Duraktaki yolcu iniş-biniş simülasyonu
          this._simulatePassengerExchange(bus, targetStop);
        }
        break;
      }

      case 'STOPPED': {
        bus.speed = 0;
        bus.targetSpeed = 0;
        bus.stopTimer -= dt;

        // Kapıların açılma animasyonu (dışa kayarak açılır)
        bus.doorProgress = Math.min(1, bus.doorProgress + dt * 2.5);
        this._animateDoors(bus, bus.doorProgress);

        // Süre dolunca kalkışa hazırlan
        if (bus.stopTimer <= 0) {
          bus.state = 'DEPARTING';
          bus.turnSignalActive = 'L'; // Sol sinyal (trafiğe çıkış)
          sound.playBusChime();
          sound.playBusDoor();
        }
        break;
      }

      case 'DEPARTING': {
        // Kapıların kapanma animasyonu
        bus.doorProgress = Math.max(0, bus.doorProgress - dt * 2.5);
        this._animateDoors(bus, bus.doorProgress);

        if (bus.doorProgress <= 0.05) {
          // Kapılar kapandı, hızlanmaya başla ve ana şeride geri dön
          bus.targetSpeed = 11.0;
          const targetRoadZ = targetStop.roadZ;
          bus.z += (targetRoadZ - bus.z) * Math.min(1, dt * 1.8);

          // Ana şeride oturunca sinyali kapat ve sonraki durağa geç
          if (Math.abs(bus.z - targetRoadZ) < 0.25) {
            bus.turnSignalActive = null;
            bus.state = 'CRUISING';
            // Sonraki durak indeksi
            this._advanceToNextStop(bus);
          }
        }
        break;
      }
    }

    // Yumuşak ivmelenme ve yavaşlama
    bus.speed += (bus.targetSpeed - bus.speed) * Math.min(1, dt * 2.0);
    bus.x += bus.speed * dt * bus.dir;

    // Otobüs 3D model pozisyonunu güncelle
    bus.group.position.set(bus.x, 0.85, bus.z);
    bus.group.rotation.y = bus.dir > 0 ? 0 : Math.PI;

    // Fren lambası normale dönsün
    if (bus.state !== 'APPROACHING') {
      bus.brakeLight.forEach(l => l.material.color.setHex(0x7f1d1d));
    }
  }

  // Kapıların kayarak açılma/kapanma animasyonu
  _animateDoors(bus, progress) {
    // Ön kapı kanatları
    bus.frontDoors[0].position.z = (2.65 / 2) + progress * 0.15;
    bus.frontDoors[0].position.x = (11.2 / 2 - 1.2) + progress * 0.45;
    bus.frontDoors[1].position.z = (2.65 / 2) + progress * 0.15;
    bus.frontDoors[1].position.x = (11.2 / 2 - 1.85) - progress * 0.45;

    // Orta kapı kanatları
    bus.midDoors[0].position.z = (2.65 / 2) + progress * 0.15;
    bus.midDoors[0].position.x = (-0.2) + progress * 0.45;
    bus.midDoors[1].position.z = (2.65 / 2) + progress * 0.15;
    bus.midDoors[1].position.x = (-0.9) - progress * 0.45;
  }

  // Durakta yolcu iniş-binişi
  _simulatePassengerExchange(bus, stop) {
    // Kullanıcı isteği: "O duraklarda beklediğinde bazen birileri insin"
    if (Math.random() < 0.65) {
      // Bir yolcu iniyor (orta kapıdan kaldırıma adım atar)
      const alightedPerson = this._createWaitingPassenger(2);
      alightedPerson.position.set(bus.x - 0.5, 0.2, stop.z - 0.5);
      this.scene.add(alightedPerson);
      // Kaldırımda yürüyerek uzaklaşsın
      setTimeout(() => {
        this.scene.remove(alightedPerson);
      }, 7000);
    }

    // Durakta bekleyen yolcular varsa bazıları biner
    if (stop.passengers && stop.passengers.length > 0) {
      const boardingCount = Math.min(stop.passengers.length, 1 + Math.floor(Math.random() * 2));
      for (let i = 0; i < boardingCount; i++) {
        const p = stop.passengers.pop();
        if (p) stop.group.remove(p);
      }
    }
  }

  // Bir sonraki durak hedefine geçiş (ve rotanın sonunda dönüş döngüsü)
  _advanceToNextStop(bus) {
    if (bus.dir > 0) {
      // Doğu yönü durakları (0 .. 5)
      bus.targetStopIndex++;
      if (bus.targetStopIndex >= 6) {
        // Doğu ucuna ulaştı, dönüş yapıp Batı yönüne geçer
        bus.dir = -1;
        bus.targetStopIndex = 6;
      }
    } else {
      // Batı yönü durakları (6 .. 11)
      bus.targetStopIndex++;
      if (bus.targetStopIndex >= this.stops.length) {
        // Batı ucuna ulaştı, dönüş yapıp Doğu yönüne geçer
        bus.dir = 1;
        bus.targetStopIndex = 0;
      }
    }
  }

  // ── Oyuncunun Otobüse Yaklaşınca Göreceği İpucu ──
  _checkNearbyBusPrompt(playerPos) {
    let nearestBus = null;
    let minDist = 4.5;

    for (const bus of this.buses) {
      const d = Math.hypot(playerPos.x - bus.x, playerPos.z - bus.z);
      if (d < minDist) {
        minDist = d;
        nearestBus = bus;
      }
    }

    if (nearestBus) {
      const isStopped = nearestBus.state === 'STOPPED';
      const promptText = isStopped
        ? `[E] 101 Metropol Otobüsüne Bin (Kapılar Açık)`
        : `🚏 101 Metropol Otobüsü Yaklaşıyor • Durakta Duracak`;

      this.promptEl.innerHTML = promptText;
      this.promptEl.style.display = 'block';

      // Eğer oyuncu durakta açık kapıların hemen yanına geldiyse otomatik veya E ile binebilir
      if (isStopped && minDist < 2.2) {
        this.promptEl.innerHTML = `<span style="color:#38bdf8;">[E]</span> <b>Otobüse Adım At ve Bin</b>`;
      }
    } else {
      this.promptEl.style.display = 'none';
    }
  }

  // ── Oyuncunun Otobüse Binmesi (Yolcu Modu) ──
  enterBus(bus = null) {
    if (this.passengerState.inBus) return;

    // Eğer parametre verilmediyse en yakın duran otobüse bin
    if (!bus) {
      const pPos = this.character.mesh.position;
      bus = this.buses.find(b => Math.hypot(pPos.x - b.x, pPos.z - b.z) < 5.0);
    }
    if (!bus) return;

    this.passengerState.inBus = true;
    this.passengerState.bus = bus;
    this.passengerState.stopRequest = false;

    // Oyuncu modelini otobüsün içine yerleştir
    this.character.mesh.visible = true;
    this.character.vel.set(0, 0, 0);

    // Otobüs biniş zili sesi
    sound.playBusChime();

    // UI Güncelle
    this.promptEl.style.display = 'none';
    this.hudEl.style.display = 'block';
    this._updateHUD();
  }

  // ── Oyuncunun Otobüsten İnmesi ──
  exitBus() {
    if (!this.passengerState.inBus || !this.passengerState.bus) return;
    const bus = this.passengerState.bus;

    // Otobüs durakta mı?
    if (bus.state === 'STOPPED') {
      // Kaldırıma doğru güvenli iniş
      const exitZ = bus.z + (bus.dir > 0 ? 2.2 : -2.2);
      this.character.resetPosition(bus.x, 1.2, exitZ);
      this.passengerState.inBus = false;
      this.passengerState.bus = null;
      this.hudEl.style.display = 'none';
      sound.playBusDoor();
    } else {
      // Otobüs seyir halinde! Stop talep zili çal ("Duracak lambası")
      if (!this.passengerState.stopRequest) {
        this.passengerState.stopRequest = true;
        sound.playBusChime();
        this._updateHUD();
      }
    }
  }

  // ── Otobüste Seyahat Eden Oyuncuyu Taşıma ve Kamera Takibi ──
  _updatePassengerRiding(dt, character) {
    const bus = this.passengerState.bus;
    if (!bus) return;

    // Oyuncunun otobüs içindeki oturma / manzara pozisyonu (cam kenarı koltuğu)
    const cabinOffsetX = 0.5 * bus.dir;
    const cabinOffsetZ = -0.55 * bus.dir;
    const px = bus.x + cabinOffsetX;
    const py = 1.6; // Pencere seyir yüksekliği
    const pz = bus.z + cabinOffsetZ;

    character.body.position.set(px, py, pz);
    character.mesh.position.set(px, py - 0.5, pz);
    character.vel.set(0, 0, 0);

    // HUD'ı güncelle
    this._updateHUD();

    // Durakta kapılar açıldığında bildirim
    if (bus.state === 'STOPPED') {
      this.promptEl.innerHTML = `<span style="color:#4ade80;">[E]</span> <b>Bu Durakta İn</b>`;
      this.promptEl.style.display = 'block';
    } else {
      this.promptEl.style.display = 'none';
    }
  }

  _updateHUD() {
    const bus = this.passengerState.bus;
    if (!bus) return;
    const targetStop = this.stops[bus.targetStopIndex];
    const stopName = targetStop ? targetStop.name : 'Son Durak';
    const isStopped = bus.state === 'STOPPED';
    const speedKmh = Math.round(bus.speed * 3.6);

    this.hudEl.innerHTML = `
      <div style="font-size: 13px; font-weight: 800; color: #38bdf8; letter-spacing: 1px; margin-bottom: 4px;">
        🚏 METROPOL TOPLU TAŞIMA • HAT 101
      </div>
      <div style="font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 6px;">
        Sonraki Durak: <span style="color: #facc15;">${stopName}</span>
      </div>
      <div style="display: flex; justify-content: center; gap: 16px; font-size: 13px; color: #94a3b8;">
        <span>🧑‍✈️ Şoför: <b>Rıza Kaptan</b></span>
        <span>⚡ Hız: <b>${speedKmh} km/h</b></span>
        <span>${this.passengerState.stopRequest ? '🔴 <b style="color:#ef4444;">DURACAK</b>' : '🟢 Seyir Halinde'}</span>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: ${isStopped ? '#4ade80' : '#cbd5e1'}; font-weight: 600;">
        ${isStopped ? '✅ Kapılar Açık — İnmek İçin [E] Tuşuna Basın' : 'ℹ️ İnmek istediğiniz durağa yaklaşırken [E] ile talep zili çalın'}
      </div>
    `;
  }

  // Oyuncu yakındaki bir otobüse binmek istediğinde
  handleUseKey() {
    if (this.passengerState.inBus) {
      this.exitBus();
      return true;
    }

    const pPos = this.character.mesh.position;
    const nearestBus = this.buses.find(b => Math.hypot(pPos.x - b.x, pPos.z - b.z) < 4.2);
    if (nearestBus) {
      this.enterBus(nearestBus);
      return true;
    }
    return false;
  }
}
