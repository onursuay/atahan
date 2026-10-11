import { PALETTE } from './teardown.js';

// Büyük Şehir, Sahil, Uzun Köprü ve Zengin Ada (Sinema, Villalar, Dar Sokaklar & Binaların İçi)
export class LevelManager {
  constructor(voxelWorld) {
    this.world = voxelWorld;
    this.currentLevelIndex = 0;

    this.levelConfigs = [
      {
        id: 0,
        title: 'BÜYÜK ŞEHİR, SAHİL & ZENGİN ADA',
        desc: 'Sahili keşfet, binaların içine gir, uzun köprüden zengin adaya geç ve sinemayı/villaları yık!',
        targetPercent: 60,
        builder: this.buildFullCityWorld.bind(this)
      }
    ];
  }

  // ANA DÜNYA: Şehir + Sahil + Uzun Köprü + Zengin Ada
  buildFullCityWorld() {
    const w = this.world;

    // ==========================================
    // 1. ZEMİN, SAHİL VE YOLLAR
    // ==========================================

    // A. BÜYÜK ŞEHİR ZEMİNİ (X: -74'ten -12'ye, Z: -36'dan 36'ya)
    w.fillBox(-74, 0, -36, -12, 0, 36, PALETTE.CONCRETE);

    // Şehir Sahili (Batı ve Kuzey/Güney kenarları)
    // Batı Sahili (Geniş kumsal sahil şeridi)
    w.fillBox(-82, 0, -38, -75, 0, 38, PALETTE.SAND);
    // Sahil Ahşap Gezinti Yolu (Boardwalk)
    w.fillBox(-75, 0, -36, -73, 0, 36, PALETTE.WOOD);
    // Sahil İskeleleri (Denize uzanan 2 ahşap iskele)
    w.fillBox(-90, 0, -18, -82, 0, -14, PALETTE.WOOD);
    w.fillBox(-90, 0, 14, -82, 0, 18, PALETTE.WOOD);

    // Şehir Ana Caddesi (Asfalt)
    w.fillBox(-72, 0, -3, -12, 0, 3, PALETTE.ASPHALT);
    // Şehir Ara Caddeleri
    w.fillBox(-45, 0, -34, -39, 0, 34, PALETTE.ASPHALT);
    w.fillBox(-24, 0, -34, -18, 0, 34, PALETTE.ASPHALT);

    // B. UZUN KÖPRÜ (Şehri Zengin Adaya Bağlar: X: -12'den 24'e)
    // Köprü Tabliyesi (Yükseklik Y=1'de deniz üstünde)
    w.fillBox(-12, 1, -3, 24, 1, 3, PALETTE.ASPHALT);
    // Köprü Ahşap / Beton Korkulukları
    w.fillBox(-12, 2, -3, 24, 2, -3, PALETTE.WOOD);
    w.fillBox(-12, 2, 3, 24, 2, 3, PALETTE.WOOD);
    // Köprü Ağır Taşıyıcı Demir Ayakları (Denizin içine inen devasa demir kolonlar)
    const bridgePillars = [-6, 3, 12, 20];
    bridgePillars.forEach(px => {
      w.fillBox(px - 1, -2, -3, px + 1, 0, -3, PALETTE.IRON);
      w.fillBox(px - 1, -2, 3, px + 1, 0, 3, PALETTE.IRON);
      // Köprü üstü demir aydınlatma direkleri
      w.fillBox(px, 3, -3, px, 5, -3, PALETTE.IRON);
      w.fillBox(px, 3, 3, px, 5, 3, PALETTE.IRON);
    });

    // C. ZENGİN ADA ZEMİNİ (X: 24'ten 68'e, Z: -32'den 32'ye)
    w.fillBox(24, 0, -32, 68, 0, 32, PALETTE.CONCRETE);
    // Zengin Ada Sahili (Adanın etrafındaki kumsal)
    w.fillBox(22, 0, -34, 24, 0, 34, PALETTE.SAND);
    w.fillBox(68, 0, -34, 72, 0, 34, PALETTE.SAND);
    w.fillBox(24, 0, -35, 68, 0, -33, PALETTE.SAND);
    w.fillBox(24, 0, 33, 68, 0, 35, PALETTE.SAND);

    // Zengin Ada Dar Sokakları (Dar taş/asfalt sokaklar)
    w.fillBox(24, 0, -1, 64, 0, 1, PALETTE.ASPHALT); // Köprüden gelen dar ana sokak
    w.fillBox(44, 0, -30, 46, 0, 30, PALETTE.ASPHALT); // Enine dar sokak
    w.fillBox(56, 0, -28, 57, 0, 28, PALETTE.CONCRETE); // Villalar arası dar yürüyüş yolu

    // ==========================================
    // 2. BÜYÜK ŞEHİR BİNALARI (İÇ MEKÂNLARIYLA BİRLİKTE)
    // ==========================================

    // BİNA 1: ŞEHİR APARTMANI (3 Katlı, Odaları, Merdiven Boşluğu ve Mobilyaları Olan Bina)
    this.buildCityApartment(-48, 1, 6, -30, 18, 24);

    // BİNA 2: ŞEHİR BANKASI & İŞ MERKEZİ (Ağır Demir Kasalı, Vezneli, 2 Katlı)
    this.buildCityBank(-48, 1, -24, -30, 14, -6);

    // BİNA 3: SAHİL RESTORANI & KAFE (Verandalı, Camlı, Ahşap Masalı)
    this.buildBeachCafe(-68, 1, -12, -54, 8, 12);

    // BİNA 4: ŞEHİR DEPOSU VE TNT MERKEZİ
    this.buildCityWarehouse(-22, 1, 8, -14, 10, 24);

    // ==========================================
    // 3. ZENGİN ADA: SİNEMA, VİLLALAR VE DAR SOKAKLAR
    // ==========================================

    // BİNA 5: BÜYÜK SİNEMA (Cinema / Movie Theater - İçinde Perdesi, Koltukları ve Gişesi Var!)
    this.buildGrandCinema(28, 1, -28, 42, 14, -4);

    // BİNA 6: 1. LÜKS VİLLA (Modern Sahil Villası - Havuzlu, Balkonlu, İç Salonlu)
    this.buildLuxuryVilla(28, 1, 6, 42, 12, 26);

    // BİNA 7: 2. LÜKS VİLLA (Tepedeki Malikane - Şömineli, Teraslı, Demir Garaj Kapılı)
    this.buildLuxuryMansion(48, 1, -14, 64, 15, 14);

    // BİNA 8: LÜKS SANAT GALERİSİ & BUTİK (Dar sokak üzerinde)
    this.buildLuxuryBoutique(48, 1, 16, 62, 8, 28);
  }

  // -------------------------------------------------------------
  // İÇ MEKÂNLARIYLA BİRLİKTE BİNA MİMARİLERİ:
  // -------------------------------------------------------------

  // BİNA 1: ŞEHİR APARTMANI (İçi tamamen gezilebilir, odalı, kapılı)
  buildCityApartment(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Dış Tuğla Duvarlar
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.WOOD);

    // Ön Cephe Giriş Kapısı (Yürüyerek doğrudan içeri girilebilir!)
    const doorX = Math.round((x1 + x2) / 2);
    for (let x = doorX - 1; x <= doorX + 1; x++) {
      for (let y = y1; y <= y1 + 3; y++) {
        // Kapı boşluğu (içeri girilebilir)
        const key = `${x},${y},${z1}`;
        w.voxels.delete(key);
      }
    }
    // Kapı Yanı Tahta Kapı Kanadı (Kırılabilir)
    w.fillBox(doorX - 1, y1, z1, doorX - 1, y1 + 3, z1, PALETTE.WOOD);

    // Pencereler (Cam)
    for (let y = y1 + 2; y <= y2 - 2; y += 4) {
      w.fillBox(x1 + 2, y, z1, x1 + 4, y + 1, z1, PALETTE.GLASS);
      w.fillBox(x2 - 4, y, z1, x2 - 2, y + 1, z1, PALETTE.GLASS);
      w.fillBox(x1 + 2, y, z2, x1 + 4, y + 1, z2, PALETTE.GLASS);
      w.fillBox(x2 - 4, y, z2, x2 - 2, y + 1, z2, PALETTE.GLASS);
    }

    // Zemin Kat İç Mobilyaları: Resepsiyon Bankosu ve Sandalye (Tahta)
    w.fillBox(x1 + 3, y1, z1 + 4, x1 + 7, y1 + 1, z1 + 5, PALETTE.WOOD);
    // Güvenlik Demir Kasası (Demir - Çekiçle kırılamaz!)
    w.fillBox(x1 + 2, y1, z1 + 2, x1 + 3, y1 + 2, z1 + 3, PALETTE.IRON);

    // 1. Ara Kat Tabanı (2. Kat)
    const midY1 = y1 + 6;
    w.fillBox(x1 + 1, midY1, z1 + 1, x2 - 1, midY1, z2 - 1, PALETTE.WOOD);
    // İç Merdiven Boşluğu (Üst kata çıkış)
    for (let x = x2 - 4; x <= x2 - 2; x++) {
      for (let z = z1 + 2; z <= z1 + 5; z++) {
        w.voxels.delete(`${x},${midY1},${z}`);
      }
    }
    // Merdiven Basamakları (Tahta)
    for (let step = 0; step < 5; step++) {
      w.fillBox(x2 - 4, y1 + step, z1 + 2 + step, x2 - 2, y1 + step, z1 + 2 + step, PALETTE.WOOD);
    }

    // 2. Kat İç Odalar: Ahşap Bölme Duvarlar
    w.fillBox(x1 + 1, midY1 + 1, Math.round((z1 + z2) / 2), x2 - 6, midY1 + 5, Math.round((z1 + z2) / 2), PALETTE.WOOD);
    // Yatak ve Masa Mobilyaları
    w.fillBox(x1 + 2, midY1 + 1, z1 + 2, x1 + 4, midY1 + 1, z1 + 5, PALETTE.WOOD);
    w.fillBox(x1 + 2, midY1 + 1, z2 - 4, x1 + 5, midY1 + 1, z2 - 2, PALETTE.WOOD);

    // 2. Ara Kat Tabanı (3. Kat)
    const midY2 = y1 + 12;
    w.fillBox(x1 + 1, midY2, z1 + 1, x2 - 1, midY2, z2 - 1, PALETTE.WOOD);
    // Çatıya TNT Sandıkları
    w.fillBox(doorX - 1, midY2 + 1, Math.round((z1 + z2) / 2), doorX + 1, midY2 + 2, Math.round((z1 + z2) / 2) + 2, PALETTE.TNT);
  }

  // BİNA 2: ŞEHİR BANKASI (İçinde ağır demir kasa odası var!)
  buildCityBank(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Beton & Çelik Ana Yapı
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);

    // Banka Giriş Kapısı
    const doorX = Math.round((x1 + x2) / 2);
    for (let x = doorX - 2; x <= doorX + 2; x++) {
      for (let y = y1; y <= y1 + 4; y++) {
        w.voxels.delete(`${x},${y},${z2}`);
      }
    }
    // Giriş Sütunları (Demir - Çekiçle kırılamaz!)
    w.fillBox(doorX - 3, y1, z2, doorX - 3, y1 + 5, z2, PALETTE.IRON);
    w.fillBox(doorX + 3, y1, z2, doorX + 3, y1 + 5, z2, PALETTE.IRON);

    // Banka Vezne Bankoları (Tahta - Çekiçle kırılabilir!)
    w.fillBox(x1 + 3, y1, z2 - 5, x2 - 3, y1 + 1, z2 - 4, PALETTE.WOOD);

    // İÇERİDEKİ DEV AĞIR DEMİR KASA ODASI (BANK VAULT)
    // Duvarları tamamen DEMİR! (Çekiçle kırılamaz, sadece demir sesi çıkar)
    w.fillHollowBox(x1 + 2, y1, z1 + 2, x1 + 8, y1 + 5, z1 + 8, PALETTE.IRON, PALETTE.IRON);
    // Kasa Odası Kapı Açıklığı
    for (let y = y1; y <= y1 + 3; y++) {
      w.voxels.delete(`${x1 + 5},${y},${z1 + 8}`);
      w.voxels.delete(`${x1 + 6},${y},${z1 + 8}`);
    }
    // Kasa İçi Altın Külçeleri ve TNT
    w.fillBox(x1 + 3, y1, z1 + 3, x1 + 5, y1 + 1, z1 + 5, PALETTE.GOLD);
    w.fillBox(x1 + 6, y1, z1 + 3, x1 + 7, y1 + 2, z1 + 4, PALETTE.TNT);

    // 2. Kat Ofis Zemini
    w.fillBox(x1 + 1, y1 + 6, z1 + 1, x2 - 1, y1 + 6, z2 - 1, PALETTE.WOOD);
  }

  // BİNA 3: SAHİL KAFESİ & VERANDASI
  buildBeachCafe(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Ahşap Zemin ve Dış Cephe
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.WOOD, PALETTE.WOOD);

    // Sahile Bakan Geniş Cam Cephe
    w.fillBox(x1, y1 + 1, z1 + 2, x1, y2 - 1, z2 - 2, PALETTE.GLASS);

    // Kafe Kapısı
    for (let z = -1; z <= 1; z++) {
      for (let y = y1; y <= y1 + 3; y++) {
        w.voxels.delete(`${x2},${y},${z}`);
      }
    }

    // İç Mobilyalar: Ahşap Masalar ve Sandalyeler (Tahta)
    for (let z = z1 + 3; z <= z2 - 3; z += 4) {
      w.fillBox(x1 + 3, y1, z, x1 + 5, y1 + 1, z + 2, PALETTE.WOOD);
      w.fillBox(x1 + 7, y1, z, x1 + 9, y1 + 1, z + 2, PALETTE.WOOD);
    }
    // Bar Tezgâhı (Tahta)
    w.fillBox(x2 - 4, y1, z1 + 2, x2 - 2, y1 + 1, z2 - 2, PALETTE.WOOD);
  }

  // BİNA 4: ŞEHİR DEPOSU
  buildCityWarehouse(x1, y1, z1, x2, y2, z2) {
    const w = this.world;
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.CONCRETE);

    // Geniş Depo Kapısı
    for (let z = Math.round((z1 + z2) / 2) - 2; z <= Math.round((z1 + z2) / 2) + 2; z++) {
      for (let y = y1; y <= y1 + 5; y++) {
        w.voxels.delete(`${x1},${y},${z}`);
      }
    }
    // Depo İçinde TNT Paletleri ve Ahşap Sandıklar
    w.fillBox(x1 + 2, y1, z1 + 2, x2 - 2, y1 + 2, z1 + 5, PALETTE.TNT);
    w.fillBox(x1 + 2, y1, z2 - 5, x2 - 2, y1 + 2, z2 - 2, PALETTE.WOOD);
  }

  // BİNA 5: ZENGİN ADA SİNEMASI (Dev Perdesi, Sıralı Koltukları ve Gişesi Olan Sinema Salonu)
  buildGrandCinema(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Sinema Dış Duvarları (Tuğla & Kırmızı Çatı)
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.ASPHALT);

    // Sinema Ana Giriş Kapısı (Ön Cephe - Z2 tarafında dar sokağa bakar)
    const doorX = Math.round((x1 + x2) / 2);
    for (let x = doorX - 2; x <= doorX + 2; x++) {
      for (let y = y1; y <= y1 + 4; y++) {
        w.voxels.delete(`${x},${y},${z2}`);
      }
    }
    // Giriş Üstü Altın "SİNEMA" Yazı Panosu / Saçak (Altın)
    w.fillBox(x1 + 1, y1 + 5, z2, x2 - 1, y1 + 6, z2 + 1, PALETTE.GOLD);

    // Giriş Lobisi Bilet Gişesi (Tahta - Çekiçle kırılabilir)
    w.fillBox(doorX - 3, y1, z2 - 4, doorX - 1, y1 + 2, z2 - 3, PALETTE.WOOD);

    // İÇ MEKÂN: BÜYÜK SİNEMA SALONU (Auditorium)
    // 1. DEV SİNEMA PROJEKSİYON PERDESİ (Ön Duvar Z1'de)
    // Beyaz / Parlak Perde
    w.fillBox(x1 + 2, y1 + 2, z1 + 1, x2 - 2, y1 + 8, z1 + 1, PALETTE.CONCRETE);
    // Perde Altın Çerçevesi
    w.fillBox(x1 + 1, y1 + 1, z1 + 1, x2 - 1, y1 + 9, z1 + 1, PALETTE.GOLD);

    // 2. SIRALI SİNEMA KOLTUKLARI (Basamaklı Yükselen Seyirci Koltuk Sıraları)
    let rowStep = 0;
    for (let z = z1 + 5; z <= z2 - 8; z += 3) {
      // Yükselen Basamak
      w.fillBox(x1 + 2, y1, z, x2 - 2, y1 + rowStep, z + 1, PALETTE.CONCRETE);
      // Koltuk Sırası (Tahta & Kırmızı Kumaş)
      w.fillBox(x1 + 3, y1 + rowStep + 1, z, x2 - 3, y1 + rowStep + 1, z, PALETTE.ROOF);
      rowStep++;
    }

    // 3. Projeksiyon Odası ve Demir Projeksiyon Makinesi (Demir)
    w.fillBox(doorX - 1, y1 + 6, z2 - 2, doorX + 1, y1 + 8, z2 - 1, PALETTE.IRON);
  }

  // BİNA 6: 1. LÜKS VİLLA (Modern Sahil Villası - Havuzlu, Balkonlu, İç Salonlu)
  buildLuxuryVilla(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Villa Zemin ve Duvarları (Beyaz Beton & Cam)
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);

    // Giriş Kapısı (Dar sokağa bakan ahşap villa kapısı)
    for (let z = z1 + 2; z <= z1 + 4; z++) {
      for (let y = y1; y <= y1 + 3; y++) {
        w.voxels.delete(`${x1},${y},${z}`);
      }
    }
    // Tahta Kapı Kanadı
    w.fillBox(x1, y1, z1 + 2, x1, y1 + 3, z1 + 2, PALETTE.WOOD);

    // 1. Kat İç Mekânı: Geniş Lüks Salon
    // Lüks Ahşap Koltuk Takımı & Sehpa
    w.fillBox(x1 + 2, y1, z1 + 6, x1 + 5, y1 + 1, z1 + 10, PALETTE.WOOD);
    w.fillBox(x1 + 3, y1, z1 + 8, x1 + 4, y1 + 1, z1 + 8, PALETTE.GLASS); // Cam sehpa
    // Açık Mutfak Tezgâhı
    w.fillBox(x2 - 4, y1, z1 + 2, x2 - 2, y1 + 1, z1 + 8, PALETTE.WOOD);

    // Bahçedeki Özel Turkuaz Yüzme Havuzu
    w.fillBox(x1 + 2, y1, z2 - 6, x2 - 2, y1, z2 - 2, PALETTE.GLASS);

    // 2. Kat Tabanı ve Üst Kat Yatak Odası
    const floorY = y1 + 5;
    w.fillBox(x1 + 1, floorY, z1 + 1, x2 - 1, floorY, z2 - 5, PALETTE.WOOD);
    // Üst Kat Cam Korkuluklu Balkon
    w.fillBox(x1 + 1, floorY + 1, z2 - 5, x2 - 1, floorY + 1, z2 - 5, PALETTE.GLASS);
    // Demir Balkon Taşıyıcı Dikmeleri (Demir)
    w.fillBox(x1 + 1, y1, z2 - 5, x1 + 1, floorY + 2, z2 - 5, PALETTE.IRON);
    w.fillBox(x2 - 1, y1, z2 - 5, x2 - 1, floorY + 2, z2 - 5, PALETTE.IRON);

    // Üst Kat Yatak Mobilyası (Tahta)
    w.fillBox(x1 + 3, floorY + 1, z1 + 3, x1 + 6, floorY + 1, z1 + 6, PALETTE.WOOD);
  }

  // BİNA 7: 2. LÜKS VİLLA (Tepedeki Malikane - Şömineli, Teraslı, Demir Bahçe Kapılı)
  buildLuxuryMansion(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    // Tuğla & Kiremit Çatılı Malikane
    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.BRICK, PALETTE.WOOD);

    // Malikane Bahçe Girişi ve Demir Kapı (Demir - Çekiçle kırılamaz!)
    w.fillBox(x1, y1, z1 - 1, x1 + 4, y1 + 3, z1 - 1, PALETTE.IRON);

    // İç Mekân: Malikane Salonu
    // Şömine (Tuğla & Demir Izgara)
    w.fillBox(x2 - 3, y1, 0, x2 - 1, y1 + 4, 3, PALETTE.BRICK);
    w.fillBox(x2 - 2, y1, 1, x2 - 2, y1 + 1, 2, PALETTE.IRON);

    // Büyük Ahşap Yemek Masası ve Sandalyeler (Tahta)
    w.fillBox(x1 + 3, y1, -4, x1 + 7, y1 + 1, 2, PALETTE.WOOD);

    // Ara Kat
    const floorY = y1 + 6;
    w.fillBox(x1 + 1, floorY, z1 + 1, x2 - 1, floorY, z2 - 1, PALETTE.WOOD);

    // Malikane Çatı Terası ve Altın Heykel / Süsleme (Altın)
    w.fillBox(Math.round((x1 + x2) / 2) - 1, y2, -1, Math.round((x1 + x2) / 2) + 1, y2 + 2, 1, PALETTE.GOLD);

    // Bodrum Katında Gizli TNT Sandığı
    w.fillBox(x1 + 2, y1, z2 - 3, x1 + 4, y1 + 1, z2 - 2, PALETTE.TNT);
  }

  // BİNA 8: LÜKS SANAT GALERİSİ & BUTİK
  buildLuxuryBoutique(x1, y1, z1, x2, y2, z2) {
    const w = this.world;

    w.fillHollowBox(x1, y1, z1, x2, y2, z2, PALETTE.CONCRETE, PALETTE.WOOD);

    // Butik Cam Vitrini
    w.fillBox(x1 + 2, y1 + 1, z1, x2 - 2, y2 - 2, z1, PALETTE.GLASS);

    // Kapı
    for (let y = y1; y <= y1 + 3; y++) {
      w.voxels.delete(`${x1},${y},${Math.round((z1 + z2) / 2)}`);
      w.voxels.delete(`${x1},${y},${Math.round((z1 + z2) / 2) + 1}`);
    }

    // İçerideki Altın Kaideler ve Sanat Eserleri (Altın & Cam)
    w.fillBox(x1 + 3, y1, z1 + 4, x1 + 4, y1 + 2, z1 + 5, PALETTE.GOLD);
    w.fillBox(x2 - 4, y1, z1 + 4, x2 - 3, y1 + 2, z1 + 5, PALETTE.GOLD);
    w.fillBox(Math.round((x1 + x2) / 2), y1, z2 - 4, Math.round((x1 + x2) / 2) + 1, y1 + 2, z2 - 3, PALETTE.GOLD);
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
