import { PALETTE } from './teardown.js';

// Teardown Tarzı Minik Karelerden Oluşan Mimari Seviyeler
export class LevelManager {
  constructor(voxelWorld) {
    this.world = voxelWorld;
    this.currentLevelIndex = 0;

    this.levelConfigs = [
      {
        id: 0,
        title: 'BÖLÜM 1: TEARDOWN VİLLASI',
        desc: 'Tuğla duvarlarda delik aç, kolonları patlat ve çatıyı çökert!',
        targetPercent: 65,
        builder: this.buildSuburbanHouse.bind(this)
      },
      {
        id: 1,
        title: 'BÖLÜM 2: SANAYİ DEPOSU',
        desc: 'Çelik taşıyıcı kolonları vur, asma katları yerle bir et!',
        targetPercent: 70,
        builder: this.buildIndustrialDepot.bind(this)
      },
      {
        id: 2,
        title: 'BÖLÜM 3: TNT RAFİNERİSİ',
        desc: 'Depolardaki kırmızı TNT küplerini hedef al, zincirleme patlama yarat!',
        targetPercent: 75,
        builder: this.buildTNTRefinery.bind(this)
      },
      {
        id: 3,
        title: 'BÖLÜM 4: VOXEL İŞ MERKEZİ',
        desc: 'Geniş cam cepheleri ve ana taşıyıcı kolonları patlat!',
        targetPercent: 70,
        builder: this.buildHighRise.bind(this)
      },
      {
        id: 4,
        title: 'BÖLÜM 5: BÜYÜK KALE & SAAT KULESİ',
        desc: 'Kule ayaklarını yok et, saat kulesinin devrilişini izle!',
        targetPercent: 75,
        builder: this.buildCitadelAndTower.bind(this)
      }
    ];
  }

  // 1. Bölüm: Teardown Villası (Giriş kat, üst kat, camlar, ahşap kolonlar, kiremit çatı)
  buildSuburbanHouse() {
    const w = this.world;

    // Temel Beton Zemin (Genişlik: 24, Derinlik: 20 voxel)
    w.fillBox(-12, 0, -10, 12, 0, 10, PALETTE.CONCRETE);

    // 1. Kat Tuğla Dış Duvarlar (Yükseklik: 1'den 10'a)
    w.fillHollowBox(-12, 1, -10, 12, 10, 10, PALETTE.BRICK, PALETTE.WOOD);

    // 1. Kat Pencereler (Cam Voxel)
    // Ön cephe pencereleri
    w.fillBox(-8, 3, 10, -4, 7, 10, PALETTE.GLASS);
    w.fillBox(4, 3, 10, 8, 7, 10, PALETTE.GLASS);
    // Yan pencereler
    w.fillBox(-12, 3, -4, -12, 7, 0, PALETTE.GLASS);
    w.fillBox(12, 3, -4, 12, 7, 0, PALETTE.GLASS);

    // Ön Kapı Açıklığı
    for (let x = -2; x <= 2; x++) {
      for (let y = 1; y <= 6; y++) {
        w.setVoxel(x, y, 10, PALETTE.WOOD);
      }
    }

    // 1. Kat İçinde TNT Deposu (Merkezde)
    w.fillBox(-2, 1, -3, 2, 4, 1, PALETTE.TNT);

    // Ara Kat Tabanı (2. Kat Zemini)
    w.fillBox(-12, 11, -10, 12, 11, 10, PALETTE.WOOD);

    // 2. Kat Duvarları (Ahşap & Tuğla)
    w.fillHollowBox(-11, 12, -9, 11, 19, 9, PALETTE.WOOD, PALETTE.WOOD);
    // 2. Kat Ön Cam
    w.fillBox(-6, 14, 9, 6, 17, 9, PALETTE.GLASS);

    // Kiremit Çatı (Piramit / Eğimli Çatı Katmanları)
    let shrink = 0;
    for (let y = 20; y <= 26; y++) {
      w.fillBox(-12 + shrink, y, -10 + shrink, 12 - shrink, y, 10 - shrink, PALETTE.ROOF);
      shrink += 2;
    }

    // Baca (Çelik/Tuğla)
    w.fillBox(6, 22, -4, 9, 29, -1, PALETTE.BRICK);
  }

  // 2. Bölüm: Sanayi Deposu (Geniş çelik hangar, taşıyıcı ayaklar, variller)
  buildIndustrialDepot() {
    const w = this.world;

    // Beton Taban
    w.fillBox(-16, 0, -12, 16, 0, 12, PALETTE.CONCRETE);

    // 6 Adet Kalın Çelik Taşıyıcı Kolon (Vurulunca tavan çöker)
    const columns = [
      [-14, -10], [0, -10], [14, -10],
      [-14, 10],  [0, 10],  [14, 10]
    ];
    columns.forEach(([cx, cz]) => {
      w.fillBox(cx - 1, 1, cz - 1, cx + 1, 16, cz + 1, PALETTE.STEEL);
    });

    // Yan Duvarlar (Dalgalı sac / Çelik)
    w.fillBox(-16, 1, -12, 16, 16, -11, PALETTE.CONCRETE);
    w.fillBox(-16, 1, 11, 16, 16, 12, PALETTE.CONCRETE);
    w.fillBox(-16, 1, -12, -15, 16, 12, PALETTE.CONCRETE);

    // İçerideki Depo Rafı ve TNT Varilleri
    w.fillBox(-8, 1, -4, 8, 2, -2, PALETTE.WOOD);
    w.fillBox(-6, 3, -4, 6, 6, -2, PALETTE.TNT); // Raf üstü TNT

    // Ağır Çatı Kirişleri
    for (let x = -16; x <= 16; x += 3) {
      w.fillBox(x, 16, -12, x, 17, 12, PALETTE.STEEL);
    }
    // Çatı Kaplaması
    w.fillBox(-16, 18, -12, 16, 18, 12, PALETTE.ROOF);
  }

  // 3. Bölüm: TNT Rafinerisi (Büyük patlayıcı tanklar ve birbirine bağlı köprüler)
  buildTNTRefinery() {
    const w = this.world;

    // Beton Platform
    w.fillBox(-18, 0, -14, 18, 0, 14, PALETTE.CONCRETE);

    // 3 Büyük Silindirik TNT Reaktörü
    const reactors = [-10, 0, 10];
    reactors.forEach(rx => {
      // Beton kaide
      w.fillBox(rx - 4, 1, -4, rx + 4, 3, 4, PALETTE.CONCRETE);
      // TNT İç Çekirdek
      w.fillBox(rx - 3, 4, -3, rx + 3, 14, 3, PALETTE.TNT);
      // Dış Çelik Koruma Kafesi (Aralıklı pencereli)
      w.fillHollowBox(rx - 4, 4, -4, rx + 4, 15, 4, PALETTE.STEEL);
    });

    // Reaktörleri birbirine bağlayan boru hattı ve köprüler
    w.fillBox(-14, 10, -1, 14, 12, 1, PALETTE.STEEL);
    w.fillBox(-14, 13, -2, 14, 13, 2, PALETTE.WOOD);

    // Tepe Gözlem Kulesi
    w.fillBox(-2, 15, -2, 2, 24, 2, PALETTE.CONCRETE);
    w.fillBox(-4, 24, -4, 4, 26, 4, PALETTE.GLASS);
    w.fillBox(0, 27, 0, 0, 31, 0, PALETTE.GOLD); // Paratoner
  }

  // 4. Bölüm: Voxel İş Merkezi (5 Katlı Modern Gökdelen)
  buildHighRise() {
    const w = this.world;

    const floors = 5;
    const floorHeight = 6;

    for (let f = 0; f < floors; f++) {
      const baseY = f * floorHeight;

      // Kat Tabanı (Beton)
      w.fillBox(-10, baseY, -10, 10, baseY + 1, 10, PALETTE.CONCRETE);

      // 4 Taşıyıcı Köşe Kolon (Çelik)
      w.fillBox(-10, baseY + 1, -10, -8, baseY + floorHeight, -8, PALETTE.STEEL);
      w.fillBox(8, baseY + 1, -10, 10, baseY + floorHeight, -8, PALETTE.STEEL);
      w.fillBox(-10, baseY + 1, 8, -8, baseY + floorHeight, 10, PALETTE.STEEL);
      w.fillBox(8, baseY + 1, 8, 10, baseY + floorHeight, 10, PALETTE.STEEL);

      // Cam Cepheler (Her katta boydan boya cam)
      w.fillBox(-7, baseY + 2, -10, 7, baseY + floorHeight - 1, -10, PALETTE.GLASS);
      w.fillBox(-7, baseY + 2, 10, 7, baseY + floorHeight - 1, 10, PALETTE.GLASS);
      w.fillBox(-10, baseY + 2, -7, -10, baseY + floorHeight - 1, 7, PALETTE.GLASS);
      w.fillBox(10, baseY + 2, -7, 10, baseY + floorHeight - 1, 7, PALETTE.GLASS);

      // 2. ve 4. Katta Sunucu Odası / TNT
      if (f === 1 || f === 3) {
        w.fillBox(-2, baseY + 2, -2, 2, baseY + 4, 2, PALETTE.TNT);
      }
    }

    // Çatı Helikopter Pisti / Teras
    const roofY = floors * floorHeight;
    w.fillBox(-11, roofY, -11, 11, roofY + 1, 11, PALETTE.CONCRETE);
    w.fillBox(-3, roofY + 2, -3, 3, roofY + 2, 3, PALETTE.GOLD); // H Harfi yerine altın blok
  }

  // 5. Bölüm: Büyük Kale ve Saat Kulesi (Surlar, mazgallar, devasa saat kulesi)
  buildCitadelAndTower() {
    const w = this.world;

    // Sur Tabanı
    w.fillBox(-16, 0, -16, 16, 0, 16, PALETTE.CONCRETE);

    // 4 Köşe Savunma Kulesi
    const towers = [
      [-14, -14], [14, -14],
      [-14, 14],  [14, 14]
    ];
    towers.forEach(([tx, tz]) => {
      w.fillHollowBox(tx - 3, 1, tz - 3, tx + 3, 14, tz + 3, PALETTE.BRICK, PALETTE.WOOD);
      // Tepe mazgallar
      w.fillBox(tx - 4, 15, tz - 4, tx + 4, 16, tz + 4, PALETTE.BRICK);
      // Kule dibinde patlayıcı mahzen
      w.fillBox(tx - 1, 1, tz - 1, tx + 1, 3, tz + 1, PALETTE.TNT);
    });

    // Bağlantı Surları (Geniş taş surlar)
    w.fillBox(-11, 1, -15, 11, 10, -13, PALETTE.BRICK);
    w.fillBox(-11, 1, 13, 11, 10, 15, PALETTE.BRICK);
    w.fillBox(-15, 1, -11, -13, 10, 11, PALETTE.BRICK);
    w.fillBox(13, 1, -11, 15, 10, 11, PALETTE.BRICK);

    // MERKEZ SAAT KULESİ (Devasa 32 Katmanlı Voxel Kulesi)
    w.fillHollowBox(-4, 1, -4, 4, 28, 4, PALETTE.BRICK, PALETTE.WOOD);
    // Saat Katı (Cam ve Altın kadranlar)
    w.fillBox(-3, 24, 4, 3, 26, 4, PALETTE.GOLD);
    w.fillBox(-3, 24, -4, 3, 26, -4, PALETTE.GOLD);

    // Saat Kulesi Temel Taşıyıcı TNT Havuzu
    w.fillBox(-2, 1, -2, 2, 3, 2, PALETTE.TNT);

    // Kule Çatısı (Sivri külah çatı)
    let shrink = 0;
    for (let y = 29; y <= 35; y++) {
      w.fillBox(-4 + shrink, y, -4 + shrink, 4 - shrink, y, 4 - shrink, PALETTE.ROOF);
      shrink += 1;
    }
  }

  loadLevel(index) {
    this.world.clear();
    if (index >= 0 && index < this.levelConfigs.length) {
      this.currentLevelIndex = index;
    } else {
      this.currentLevelIndex = 0;
    }

    const cfg = this.levelConfigs[this.currentLevelIndex];
    cfg.builder();
    this.world.buildMeshBuffers(); // Binlerce minik küpü GPU'ya tek seferde yazar
    return cfg;
  }
}
