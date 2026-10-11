import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  getStoneTexture,
  getCobblestoneTexture,
  getWoodPlankTexture,
  getBrickTexture,
  getTNTSideTexture,
  getTNTTopTexture,
  getDiamondTexture,
  getGoldTexture
} from './textures.js';

// Minecraft Tarzı 1x1x1 Voxel Yapı ve Seviye Yöneticisi
export class LevelManager {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.blocks = [];
    this.currentLevelIndex = 0;

    // Minecraft Dokuları
    const stoneTex = getStoneTexture();
    const cobbleTex = getCobblestoneTexture();
    const woodTex = getWoodPlankTexture();
    const brickTex = getBrickTexture();
    const diamondTex = getDiamondTexture();
    const goldTex = getGoldTexture();
    const tntSideTex = getTNTSideTexture();
    const tntTopTex = getTNTTopTexture();

    // Minecraft Malzemeleri
    this.materials = {
      stone: new THREE.MeshLambertMaterial({ map: stoneTex }),
      cobble: new THREE.MeshLambertMaterial({ map: cobbleTex }),
      wood: new THREE.MeshLambertMaterial({ map: woodTex }),
      brick: new THREE.MeshLambertMaterial({ map: brickTex }),
      diamond: new THREE.MeshLambertMaterial({ map: diamondTex }),
      gold: new THREE.MeshLambertMaterial({ map: goldTex }),
      tnt: [
        new THREE.MeshLambertMaterial({ map: tntSideTex }),
        new THREE.MeshLambertMaterial({ map: tntSideTex }),
        new THREE.MeshLambertMaterial({ map: tntTopTex }),
        new THREE.MeshLambertMaterial({ map: tntTopTex }),
        new THREE.MeshLambertMaterial({ map: tntSideTex }),
        new THREE.MeshLambertMaterial({ map: tntSideTex })
      ]
    };

    // 1x1x1 Standart Minecraft Küp Geometrisi
    this.cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this.cubeShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));

    // Bölüm Listesi
    this.levelConfigs = [
      {
        id: 0,
        title: 'BÖLÜM 1: MİNECRAFT KULESİ',
        desc: 'Taş ve ahşap blokları devir, tepedeki altın bloğu indir!',
        targetPercent: 70,
        builder: this.buildVoxelTower.bind(this)
      },
      {
        id: 1,
        title: 'BÖLÜM 2: İKİZ KALE & KÖPRÜ',
        desc: 'Kırık taş kuleleri patlat, ahşap asma köprüyü çökert!',
        targetPercent: 75,
        builder: this.buildVoxelTwinTowers.bind(this)
      },
      {
        id: 2,
        title: 'BÖLÜM 3: TNT CEPHANELİĞİ',
        desc: 'Kırmızı TNT küplerini vur ve efsanevi zincirleme patlama başlat!',
        targetPercent: 80,
        builder: this.buildVoxelTNTArsenal.bind(this)
      },
      {
        id: 3,
        title: 'BÖLÜM 4: VOXEL GÖKDELEN',
        desc: 'Tuğla ve elmas bloklardan oluşan devasa yapıyı yık!',
        targetPercent: 75,
        builder: this.buildVoxelSkyscraper.bind(this)
      },
      {
        id: 4,
        title: 'BÖLÜM 5: BÜYÜK KRALİYET KALESİ',
        desc: 'Surlar, kuleler ve merkez şatoyu tamamen yerle bir et!',
        targetPercent: 80,
        builder: this.buildVoxelFortress.bind(this)
      }
    ];
  }

  // 1x1x1 Minecraft Küpü Ekle
  createBlock(x, y, z, matType = 'stone', isTNT = false) {
    const mat = isTNT ? this.materials.tnt : (this.materials[matType] || this.materials.stone);
    const mesh = new THREE.Mesh(this.cubeGeo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const mass = isTNT ? 7 : 12;
    const body = new CANNON.Body({
      mass: mass,
      shape: this.cubeShape,
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.15,
      angularDamping: 0.2
    });

    body.isDestructible = true;
    body.isTNT = isTNT;
    body.isDetonated = false;
    body.mesh = mesh;
    body.initPos = new CANNON.Vec3(x, y, z);

    this.physicsWorld.addBody(body);
    this.blocks.push({ mesh, body, initPos: new THREE.Vector3(x, y, z), isTNT });
    return body;
  }

  // Bölüm 1: Minecraft Klasik Kule (10 katlı 1x1 küpler)
  buildVoxelTower() {
    const height = 9;
    const size = 3;
    const offset = 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const posX = (x - offset);
          const posY = y + 0.5;
          const posZ = (z - offset);

          // Bazı katlar tahta, bazıları taş, ortada TNT
          const isTNT = y === 2 && x === 1 && z === 1;
          const matType = y % 2 === 0 ? 'stone' : 'wood';
          this.createBlock(posX, posY, posZ, matType, isTNT);
        }
      }
    }

    // Tepeye Altın Taç Blok
    this.createBlock(0, height + 0.5, 0, 'gold');
  }

  // Bölüm 2: İkiz Kırık Taş Kuleler ve Asma Ahşap Köprü
  buildVoxelTwinTowers() {
    const height = 10;
    const towerOffset = 4;

    const buildTower = (centerX) => {
      for (let y = 0; y < height; y++) {
        for (let x = -1; x <= 1; x++) {
          for (let z = -1; z <= 1; z++) {
            // İçi boş kule (Minecraft sur mantığı)
            if (x === 0 && z === 0 && y > 0 && y < height - 1) continue;
            const isTNT = y === 1 && x === 0 && z === 1;
            this.createBlock(centerX + x, y + 0.5, z, 'cobble', isTNT);
          }
        }
      }
    };

    buildTower(-towerOffset);
    buildTower(towerOffset);

    // Kuleler Arasındaki Ahşap Köprü
    const bridgeY = 6.5;
    for (let x = -towerOffset + 1; x <= towerOffset - 1; x++) {
      for (let z = -1; z <= 1; z++) {
        this.createBlock(x, bridgeY, z, 'wood');
      }
    }
  }

  // Bölüm 3: TNT Cephaneliği (Kırmızı Minecraft TNT küpleri dolu)
  buildVoxelTNTArsenal() {
    const size = 6;
    const half = size / 2;

    for (let y = 0; y < 5; y++) {
      for (let x = -half; x < half; x++) {
        for (let z = -half; z < half; z++) {
          const isEdge = x === -half || x === half - 1 || z === -half || z === half - 1;
          const isCenter = Math.abs(x) <= 1 && Math.abs(z) <= 1;

          if (isCenter && y < 3) {
            // Bol bol patlamaya hazır TNT blokları
            this.createBlock(x + 0.5, y + 0.5, z + 0.5, 'tnt', true);
          } else if (isEdge || y === 4) {
            this.createBlock(x + 0.5, y + 0.5, z + 0.5, 'brick');
          }
        }
      }
    }
  }

  // Bölüm 4: Voxel Gökdelen (12 katlı elmas & tuğla kule)
  buildVoxelSkyscraper() {
    const floors = 11;
    for (let y = 0; y < floors; y++) {
      // 4 Köşe Kolon
      this.createBlock(-1.5, y + 0.5, -1.5, 'stone');
      this.createBlock(1.5, y + 0.5, -1.5, 'stone');
      this.createBlock(-1.5, y + 0.5, 1.5, 'stone');
      this.createBlock(1.5, y + 0.5, 1.5, 'stone');

      // Taban Blokları
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const isTNT = (y === 2 || y === 6) && x === 0 && z === 0;
          const mat = y === floors - 1 ? 'diamond' : 'brick';
          this.createBlock(x, y + 0.5, z, mat, isTNT);
        }
      }
    }
  }

  // Bölüm 5: Büyük Kraliyet Kalesi
  buildVoxelFortress() {
    // 4 Köşe Kulesi
    const corners = [
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: -4, z: 4 },
      { x: 4, z: 4 }
    ];

    corners.forEach(c => {
      for (let y = 0; y < 7; y++) {
        const isTNT = y === 1;
        this.createBlock(c.x, y + 0.5, c.z, 'cobble', isTNT);
        this.createBlock(c.x + 1, y + 0.5, c.z, 'cobble');
        this.createBlock(c.x, y + 0.5, c.z + 1, 'cobble');
        this.createBlock(c.x + 1, y + 0.5, c.z + 1, 'cobble');
      }
    });

    // Bağlantı Duvarları
    for (let x = -2; x <= 2; x++) {
      for (let y = 0; y < 3; y++) {
        this.createBlock(x, y + 0.5, -4, 'stone');
        this.createBlock(x, y + 0.5, 4, 'stone');
      }
    }

    // Merkez Kale ve TNT Deposu
    for (let y = 0; y < 9; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const isTNT = y === 2 && x === 0 && z === 0;
          this.createBlock(x, y + 0.5, z, y === 8 ? 'diamond' : 'brick', isTNT);
        }
      }
    }
  }

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

  getDestructionPercentage() {
    if (this.blocks.length === 0) return 0;

    let destroyedCount = 0;
    for (let b of this.blocks) {
      const currentPos = b.body.position;
      const initPos = b.initPos;

      const fallen = currentPos.y < Math.max(0.4, initPos.y * 0.4);
      const displaced = currentPos.distanceTo(b.body.initPos) > 1.8;

      if (fallen || displaced) {
        destroyedCount++;
      }
    }

    return Math.min(100, Math.round((destroyedCount / this.blocks.length) * 100));
  }

  clearLevel() {
    for (let b of this.blocks) {
      this.scene.remove(b.mesh);
      this.physicsWorld.removeBody(b.body);
    }
    this.blocks = [];
  }

  update() {
    for (let b of this.blocks) {
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
    }
  }
}
