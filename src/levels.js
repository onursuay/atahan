import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Seviyeler ve Yıkılabilir Bina Mimarisi
export class LevelManager {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.blocks = [];
    this.currentLevelIndex = 0;

    // Ortak Blok Malzemeleri
    this.materials = {
      wood: new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.1 }),
      brick: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 }),
      tnt: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, emissive: 0x991b1b, emissiveIntensity: 0.4 })
    };

    // Bölüm Tanımları
    this.levelConfigs = [
      {
        id: 0,
        title: 'BÖLÜM 1: EĞİTİM KULESİ',
        desc: 'Temel kolonları patlat ve kulenin devrilmesini izle!',
        targetPercent: 70,
        builder: this.buildTutorialTower.bind(this)
      },
      {
        id: 1,
        title: 'BÖLÜM 2: İKİZ KULELER & KÖPRÜ',
        desc: 'Kulelerin ayaklarını vur, asma köprüyü çökert!',
        targetPercent: 75,
        builder: this.buildTwinTowers.bind(this)
      },
      {
        id: 2,
        title: 'BÖLÜM 3: TNT FABRİKASI',
        desc: 'Kırmızı TNT varillerini vur ve zincirleme patlama başlat!',
        targetPercent: 80,
        builder: this.buildTNTDepot.bind(this)
      },
      {
        id: 3,
        title: 'BÖLÜM 4: DEV GÖKDELEN',
        desc: 'Taşıyıcı kolonları hedef al, tüm katları aşağı indir!',
        targetPercent: 75,
        builder: this.buildSkyscraper.bind(this)
      },
      {
        id: 4,
        title: 'BÖLÜM 5: MEGA ŞATO VE SURLAR',
        desc: 'Muhafız kulelerini ve ana kaleyi yerle bir et!',
        targetPercent: 80,
        builder: this.buildMegaFortress.bind(this)
      }
    ];
  }

  // Tekil Blok Ekleme Yardımcısı
  createBlock(x, y, z, width, height, depth, matType = 'stone', isTNT = false) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = isTNT ? this.materials.tnt : (this.materials[matType] || this.materials.stone);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2));
    const mass = isTNT ? 8 : (width * height * depth * 3.5);

    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.15,
      angularDamping: 0.2
    });

    body.isDestructible = true;
    body.isTNT = isTNT;
    body.isDetonated = false;
    body.mesh = mesh;
    body.initY = y;
    body.initPos = new CANNON.Vec3(x, y, z);

    this.physicsWorld.addBody(body);

    this.blocks.push({ mesh, body, initPos: new THREE.Vector3(x, y, z), isTNT });
    return body;
  }

  // Bölüm 1: Klasik Eğitim Kulesi
  buildTutorialTower() {
    const layers = 10;
    const blockWidth = 1.2;
    const blockHeight = 0.9;
    const blockDepth = 1.2;

    for (let layer = 0; layer < layers; layer++) {
      const y = layer * blockHeight + blockHeight / 2;
      const count = 3;
      const offset = (count * blockWidth) / 2 - blockWidth / 2;

      for (let ix = 0; ix < count; ix++) {
        for (let iz = 0; iz < count; iz++) {
          const x = ix * (blockWidth + 0.05) - offset;
          const z = iz * (blockDepth + 0.05) - offset;
          const isTNT = layer === 2 && ix === 1 && iz === 1;
          const mat = layer % 2 === 0 ? 'stone' : 'wood';
          this.createBlock(x, y, z, blockWidth, blockHeight, blockDepth, mat, isTNT);
        }
      }
    }

    // Tepeye Altın Taç Blok
    this.createBlock(0, layers * blockHeight + 0.8, 0, 2.5, 1.2, 2.5, 'gold');
  }

  // Bölüm 2: İkiz Kuleler ve Asma Köprü
  buildTwinTowers() {
    const towerHeight = 12;
    const towerDist = 7;

    const buildTower = (centerX) => {
      for (let layer = 0; layer < towerHeight; layer++) {
        const y = layer * 0.9 + 0.45;
        for (let ix = -1; ix <= 1; ix++) {
          for (let iz = -1; iz <= 1; iz++) {
            if (ix === 0 && iz === 0 && layer > 1 && layer < towerHeight - 1) continue; // İçi boş
            const isTNT = layer === 1 && ix === 0 && iz === 1;
            this.createBlock(centerX + ix * 1.1, y, iz * 1.1, 1.0, 0.85, 1.0, 'brick', isTNT);
          }
        }
      }
    };

    // Sol ve Sağ Kule
    buildTower(-towerDist);
    buildTower(towerDist);

    // İki Kule Arasındaki Asma Köprü
    const bridgeY = 7.5;
    for (let x = -towerDist + 1.2; x <= towerDist - 1.2; x += 1.4) {
      this.createBlock(x, bridgeY, 0, 1.3, 0.4, 2.4, 'wood');
    }
  }

  // Bölüm 3: TNT Deposu ve Fabrika
  buildTNTDepot() {
    // Geniş dış duvarlar ve kolonlar
    const width = 8;
    const depth = 8;

    for (let layer = 0; layer < 6; layer++) {
      const y = layer * 1.0 + 0.5;
      for (let x = -width / 2; x <= width / 2; x += 1.6) {
        for (let z = -depth / 2; z <= depth / 2; z += 1.6) {
          const isCorner = Math.abs(x) >= width / 2 - 0.5 && Math.abs(z) >= depth / 2 - 0.5;
          const isCenter = Math.abs(x) < 2 && Math.abs(z) < 2;

          if (isCenter) {
            // Ortada bol bol TNT varili
            if (layer < 4) {
              this.createBlock(x, y, z, 0.9, 0.9, 0.9, 'tnt', true);
            }
          } else if (isCorner || layer === 0 || layer === 5) {
            this.createBlock(x, y, z, 1.4, 0.95, 1.4, 'concrete');
          }
        }
      }
    }
  }

  // Bölüm 4: Modern Gökdelen Monolit
  buildSkyscraper() {
    const floors = 14;
    for (let f = 0; f < floors; f++) {
      const y = f * 1.1 + 0.55;
      // 4 Taşıyıcı Köşe Kolon
      this.createBlock(-2, y, -2, 0.9, 1.0, 0.9, 'stone');
      this.createBlock(2, y, -2, 0.9, 1.0, 0.9, 'stone');
      this.createBlock(-2, y, 2, 0.9, 1.0, 0.9, 'stone');
      this.createBlock(2, y, 2, 0.9, 1.0, 0.9, 'stone');

      // Ara kat taban plakası
      this.createBlock(0, y + 0.45, 0, 5.0, 0.25, 5.0, 'concrete');

      // Bazı katlarda TNT
      if (f === 2 || f === 6) {
        this.createBlock(0, y, 0, 1.0, 0.9, 1.0, 'tnt', true);
      }
    }

    // Tepe Anten
    this.createBlock(0, floors * 1.1 + 1.5, 0, 0.4, 3.0, 0.4, 'gold');
  }

  // Bölüm 5: Mega Kale ve Surlar
  buildMegaFortress() {
    // 4 Köşe Kulesi
    const corners = [
      { x: -5, z: -5 },
      { x: 5, z: -5 },
      { x: -5, z: 5 },
      { x: 5, z: 5 }
    ];

    corners.forEach(c => {
      for (let l = 0; l < 8; l++) {
        const isTNT = l === 1;
        this.createBlock(c.x, l * 0.9 + 0.45, c.z, 1.8, 0.85, 1.8, 'brick', isTNT);
      }
    });

    // Bağlantı Duvarları
    for (let x = -3.5; x <= 3.5; x += 1.4) {
      for (let l = 0; l < 4; l++) {
        this.createBlock(x, l * 0.9 + 0.45, -5, 1.3, 0.85, 0.8, 'stone');
        this.createBlock(x, l * 0.9 + 0.45, 5, 1.3, 0.85, 0.8, 'stone');
      }
    }

    // Merkez Şato Kulesi
    for (let l = 0; l < 11; l++) {
      const y = l * 0.9 + 0.45;
      const isTNT = l === 3;
      this.createBlock(0, y, 0, 2.6, 0.85, 2.6, isTNT ? 'tnt' : 'stone', isTNT);
    }
  }

  // Bölümü Yükle
  loadLevel(index) {
    this.clearLevel();
    if (index >= 0 && index < this.levelConfigs.length) {
      this.currentLevelIndex = index;
    } else {
      this.currentLevelIndex = 0;
    }

    const cfg = this.levelConfigs[this.currentLevelIndex];
    cfg.builder();
    return cfg;
  }

  // Yıkım Oranını Hesapla (Başlangıç konumundan sapan veya yere düşen blokların yüzdesi)
  getDestructionPercentage() {
    if (this.blocks.length === 0) return 0;

    let destroyedCount = 0;
    for (let b of this.blocks) {
      const currentPos = b.body.position;
      const initY = b.initPos.y;

      // Blok orijinal yüksekliğinin yarısının altına indiyse veya yana 2 metreden fazla savrulduysa yıkılmıştır
      const fallen = currentPos.y < Math.max(0.6, initY * 0.4);
      const displaced = currentPos.distanceTo(b.body.initPos) > 2.5;

      if (fallen || displaced) {
        destroyedCount++;
      }
    }

    return Math.min(100, Math.round((destroyedCount / this.blocks.length) * 100));
  }

  // Mevcut Seviyeyi Temizle
  clearLevel() {
    for (let b of this.blocks) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      this.physicsWorld.removeBody(b.body);
    }
    this.blocks = [];
  }

  // Blokların görsel koordinatlarını Cannon-es fizik koordinatlarıyla eşitle
  update() {
    for (let b of this.blocks) {
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
    }
  }
}
