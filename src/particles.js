import * as THREE from 'three';

// Paylaşılan Geometriler: Her karede yüzlerce yeni BoxGeometry oluşturulup GC takılmasına yol açmasını engeller (0 Lag)
const geoSpark = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const geoFountain = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const geoDust = new THREE.BoxGeometry(0.18, 0.18, 0.18);
const geoSplash = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const geoTrail = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const geoExplosionFire = new THREE.BoxGeometry(0.35, 0.35, 0.35);
const geoExplosionSmoke = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const geoExplosionBlast = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const geoShard = new THREE.BoxGeometry(0.07, 0.07, 0.07);
const geoDustPuff = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const geoLeaf = new THREE.BoxGeometry(0.12, 0.02, 0.12); // Teardown tarzı minik yassı yaprak pikseli
const geoMicroDust = new THREE.BoxGeometry(0.08, 0.08, 0.08);
const geoDemolitionDust = new THREE.BoxGeometry(0.45, 0.45, 0.45);
const geoShockwaveDust = new THREE.BoxGeometry(0.65, 0.25, 0.65);

const leafColors = [
  0x22c55e, // taze yeşil
  0x16a34a, // canlı orman yeşili
  0x15803d, // zümrüt koyu yeşil
  0x84cc16, // açık fıstık yeşili
  0xd97706, // tatlı kehribar / altın sarısı
  0xb45309  // sıcak kızıl / sonbahar yaprağı
];
const leafMats = leafColors.map(c => {
  const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 });
  m.userData = { shared: true };
  return m;
});

const matDust = new THREE.MeshBasicMaterial({ color: 0x866043 });
const matSpark1 = new THREE.MeshBasicMaterial({ color: 0xffe08a });
const matSpark2 = new THREE.MeshBasicMaterial({ color: 0xffffff });
const matFountain1 = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.85 });
const matFountain2 = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.85 });
const matSplash1 = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
const matSplash2 = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });

// Minecraft Tarzı Tamamen Kübik / Voxel Parçacık Sistemi
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.maxParticles = 220; // FPS'in her zaman 60 kalması için emniyet sınırı
  }

  // Kübik Patlama (Minecraft explosion style)
  createExplosion(position, radius = 5, color = 0xff6600) {
    if (this.particles.length > this.maxParticles) return;
    const sparkCount = 20;
    const smokeCount = 12;

    // 1. Ateş Küpleri (Parlak Sarı/Turuncu/Kırmızı Minecraft Pikselleri)
    const fireColors = [0xffea00, 0xff7700, 0xef4444, 0xffffff];

    for (let i = 0; i < sparkCount; i++) {
      const c = fireColors[Math.floor(Math.random() * fireColors.length)];
      const mat = new THREE.MeshBasicMaterial({ color: c });
      const mesh = new THREE.Mesh(geoExplosionFire, mat);
      mesh.position.copy(position);

      const angle = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 7 + Math.random() * 15 * (radius / 5);

      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(angle) * speed,
        Math.cos(phi) * speed + 4,
        Math.sin(phi) * Math.sin(angle) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: -22,
        rotSpeed: (Math.random() - 0.5) * 12,
        life: 0.8 + Math.random() * 0.4,
        maxLife: 1.2,
        scaleSpeed: -0.5
      });
    }

    // 2. Duman Küpleri (Minecraft gri duman pikselleri)
    const smokeColors = [0x555555, 0x777777, 0x333333, 0x999999];

    for (let i = 0; i < smokeCount; i++) {
      const c = smokeColors[Math.floor(Math.random() * smokeColors.length)];
      const smokeMat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.85
      });

      const mesh = new THREE.Mesh(geoExplosionSmoke, smokeMat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 1.5,
        position.y + (Math.random() - 0.5) * 1.5,
        position.z + (Math.random() - 0.5) * 1.5
      );

      const speed = 2 + Math.random() * 4;
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        speed * 1.2 + 2,
        (Math.random() - 0.5) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: 0.5,
        rotSpeed: (Math.random() - 0.5) * 4,
        life: 1.0 + Math.random() * 0.6,
        maxLife: 1.6,
        growSpeed: 1.4,
        fade: true
      });
    }

    // 3. Merkezde Ani Genişleyen Büyük Voxel Patlama Küpü
    const blastMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    const blastCube = new THREE.Mesh(geoExplosionBlast, blastMat);
    blastCube.position.copy(position);
    this.scene.add(blastCube);

    this.particles.push({
      mesh: blastCube,
      velocity: new THREE.Vector3(0, 0, 0),
      gravity: 0,
      life: 0.2,
      maxLife: 0.2,
      growSpeed: radius * 5,
      fade: true
    });
  }

  // ── GERÇEKÇİ KURŞUN & DARBE TOZU (Yere Kaba Kutu Düşürmez, Yumuşak Harç & Kireç Tozu) ──
  createBulletImpactDust(position, normal = null, matType = null) {
    if (this.particles.length > this.maxParticles) return;

    const baseColor = matType?.color || 0xcccccc;
    const isIron = matType?.isIron || matType?.id === 3;
    const isWood = matType?.isWood || matType?.id === 2;
    const isGlass = matType?.id === 4;
    const isBrick = matType?.id === 1;

    const n = normal ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

    if (isIron) {
      // Demir: Keskin kıvılcım sıçramaları (kutu düşmez)
      for (let i = 0; i < 7; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.4 ? 0xffdf7a : 0xffffff });
        const mesh = new THREE.Mesh(geoSpark, mat);
        mesh.position.copy(position);
        this.scene.add(mesh);
        this.particles.push({
          mesh,
          velocity: new THREE.Vector3(
            n.x * 5 + (Math.random() - 0.5) * 4,
            Math.max(1.0, n.y * 5 + (Math.random() - 0.5) * 4),
            n.z * 5 + (Math.random() - 0.5) * 4
          ),
          gravity: -18,
          rotSpeed: (Math.random() - 0.5) * 20,
          life: 0.18 + Math.random() * 0.15,
          maxLife: 0.35,
          scaleSpeed: -0.6
        });
      }
      return;
    }

    // Beton, Tuğla, Ahşap ve Alçı: Yumuşak genişleyen toz pufu ve harç dumanı
    const dustCount = isGlass ? 3 : 6;
    let dustColor = 0xcfd8dc; // standart açık beton/harç tozu
    if (isBrick) dustColor = 0xc87d65;      // tuğla kırmızısı kiremit tozu
    else if (isWood) dustColor = 0x9e7855;  // ahşap talaş tozu
    else if (isGlass) dustColor = 0xd8f3dc; // cam parıltısı

    for (let i = 0; i < dustCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: dustColor,
        transparent: true,
        opacity: 0.75
      });
      const mesh = new THREE.Mesh(geoMicroDust, mat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.12,
        position.y + (Math.random() - 0.5) * 0.12,
        position.z + (Math.random() - 0.5) * 0.12
      );
      this.scene.add(mesh);

      // Yüzey normali yönünde hafifçe dışarı fırlayıp havada genişleyen mikro toz
      const sp = 1.0 + Math.random() * 2.2;
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          n.x * sp + (Math.random() - 0.5) * 1.4,
          n.y * sp + 0.4 + Math.random() * 0.8,
          n.z * sp + (Math.random() - 0.5) * 1.4
        ),
        gravity: -0.9,
        rotSpeed: (Math.random() - 0.5) * 6,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
        growSpeed: 2.8,
        fade: true
      });
    }
  }

  // ── GERÇEKÇİ BİNA YIKILMA VE ÇÖKME ENKAZ TOZU (Demolition Dust Shockwave) ──
  createDemolitionDust(position, radius = 2.5, intensity = 1.0) {
    if (this.particles.length > this.maxParticles) return;

    const count = Math.min(18, Math.round(10 * intensity));
    const dustColors = [0xd6d3d1, 0xe7e5e4, 0xa8a29e, 0xc4b5a5];

    // 1. Zeminde Yatay Açılan Dairesel Şok Dalgası Toz Halkası
    const ringCount = Math.min(12, Math.round(8 * intensity));
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const sp = (2.5 + Math.random() * 3.5) * (radius / 2.5);
      const c = dustColors[Math.floor(Math.random() * dustColors.length)];
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.70 });
      const mesh = new THREE.Mesh(geoShockwaveDust, mat);
      mesh.position.set(
        position.x + Math.cos(angle) * 0.5,
        position.y + 0.15,
        position.z + Math.sin(angle) * 0.5
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(angle) * sp, 0.3 + Math.random() * 0.5, Math.sin(angle) * sp),
        gravity: -0.3,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1.0,
        growSpeed: 3.2,
        fade: true
      });
    }

    // 2. Yukarı Doğru Kabaran Yoğun Harç ve Enkaz Tozu Sütunları
    for (let i = 0; i < count; i++) {
      const c = dustColors[Math.floor(Math.random() * dustColors.length)];
      const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.65 });
      const mesh = new THREE.Mesh(geoDemolitionDust, mat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * radius * 0.7,
        position.y + (Math.random() - 0.5) * 0.8,
        position.z + (Math.random() - 0.5) * radius * 0.7
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 2.0,
          1.8 + Math.random() * 3.2,
          (Math.random() - 0.5) * 2.0
        ),
        gravity: -0.4,
        rotSpeed: (Math.random() - 0.5) * 3,
        life: 0.8 + Math.random() * 0.5,
        maxLife: 1.3,
        growSpeed: 2.2,
        fade: true
      });
    }
  }

  // Karakter yürürken ayaklarından çıkan minik toprak küpleri
  createDust(position) {
    if (this.particles.length > this.maxParticles || Math.random() > 0.4) return;
    const mesh = new THREE.Mesh(geoDust, matDust);
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.4,
      (position.y || 0) + 0.1,
      position.z + (Math.random() - 0.5) * 0.4
    );

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.2, (Math.random() - 0.5) * 0.8),
      gravity: -6,
      life: 0.35,
      maxLife: 0.35,
      scaleSpeed: -0.4
    });
  }

  // Çeşmeden akan su: yukarı fışkırıp kavis çizerek havuza düşer
  createFountainJet(pos) {
    if (this.particles.length > this.maxParticles) return;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.3;
      const mesh = new THREE.Mesh(
        geoFountain,
        Math.random() > 0.5 ? matFountain1 : matFountain2
      );
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(a) * sp, 4.2 + Math.random() * 1.6, Math.sin(a) * sp),
        gravity: -9.5, life: 0.95, maxLife: 0.95
      });
    }
  }

  // Mermi çarpma kıvılcımı
  createSpark(position) {
    if (this.particles.length > this.maxParticles) return;
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        geoSpark,
        Math.random() > 0.5 ? matSpark1 : matSpark2
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4),
        gravity: -12,
        life: 0.25,
        maxLife: 0.25,
        scaleSpeed: -2
      });
    }
  }

  // Teardown Gerçekçi Voksel Kırılma ve Darbe Efekti:
  // Çekiç veya mermi değdiğinde malzemeye özel hızlı kıymıklar, toz bulutu ve moloz saçılması!
  createVoxelImpact(position, normal = null, matType = null, count = 8) {
    if (this.particles.length > this.maxParticles) return;

    const baseColor = matType?.color || 0xb08a68;
    const isIron = matType?.isIron || matType?.id === 3;
    const isWood = matType?.isWood || matType?.id === 2;
    const isGlass = matType?.id === 4;

    // 1. Malzemeye Özel Hızlı Kıymık / Parçacık Saçılması
    const shardCount = Math.min(count, 10);
    const n = normal ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < shardCount; i++) {
      // Renk tonu varyasyonu (biraz daha açık/koyu)
      const colorJitter = isIron ? (Math.random() > 0.3 ? 0xffdf7a : 0xffffff) : baseColor;
      const shardMat = new THREE.MeshBasicMaterial({ color: colorJitter });
      const mesh = new THREE.Mesh(geoShard, shardMat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.15,
        position.y + (Math.random() - 0.5) * 0.15,
        position.z + (Math.random() - 0.5) * 0.15
      );

      // Çarpma yönünden dışarıya doğru konik saçılma
      const speed = isIron ? (4 + Math.random() * 7) : (3 + Math.random() * 5);
      const spreadX = (Math.random() - 0.5) * 2.2;
      const spreadY = (Math.random() - 0.5) * 2.2;
      const spreadZ = (Math.random() - 0.5) * 2.2;
      const vel = new THREE.Vector3(
        n.x * speed + spreadX,
        Math.max(1.5, n.y * speed + spreadY + 2.0),
        n.z * speed + spreadZ
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: vel,
        gravity: -16,
        rotSpeed: (Math.random() - 0.5) * 25,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
        scaleSpeed: -0.7
      });
    }

    // 2. Teardown Voksel Toz Bulutu (Darbe noktasında puf gibi açılan gerçekçi toz)
    if (!isIron) {
      const dustCount = Math.min(4, Math.ceil(count / 2));
      const dustColor = isWood ? 0x9c7a52 : isGlass ? 0xd0f0ff : baseColor;
      for (let i = 0; i < dustCount; i++) {
        const dustMat = new THREE.MeshBasicMaterial({
          color: dustColor,
          transparent: true,
          opacity: 0.70
        });
        const mesh = new THREE.Mesh(geoDustPuff, dustMat);
        mesh.position.set(
          position.x + (Math.random() - 0.5) * 0.2,
          position.y + (Math.random() - 0.5) * 0.2,
          position.z + (Math.random() - 0.5) * 0.2
        );

        this.scene.add(mesh);
        this.particles.push({
          mesh,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            0.6 + Math.random() * 1.2,
            (Math.random() - 0.5) * 1.5
          ),
          gravity: -0.8,
          rotSpeed: (Math.random() - 0.5) * 4,
          life: 0.45 + Math.random() * 0.3,
          maxLife: 0.75,
          growSpeed: 1.8,
          fade: true
        });
      }
    }
  }

  // Suya giriş / yüzme sırasında sıçrayan mavi-beyaz su küpleri
  createSplash(position, strength = 1) {
    if (this.particles.length > this.maxParticles) return;
    const count = Math.min(6, Math.ceil(5 * strength));
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        geoSplash,
        Math.random() > 0.5 ? matSplash1 : matSplash2
      );
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.9,
        position.y + 0.05,
        position.z + (Math.random() - 0.5) * 0.9
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2.5, 2.5 + Math.random() * 3 * strength, (Math.random() - 0.5) * 2.5),
        gravity: -14,
        life: 0.55,
        maxLife: 0.55,
        scaleSpeed: -0.3
      });
    }
  }

  // Mermi arkası kübik duman/itici izi
  createThrusterTrail(position) {
    if (this.particles.length > this.maxParticles) return;
    const trailMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? 0xff4400 : 0xffdd00,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(geoTrail, trailMat);
    mesh.position.copy(position);

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4),
      gravity: 0,
      life: 0.2,
      maxLife: 0.2,
      scaleSpeed: -0.7,
      fade: true
    });
  }

  // Ağaçlardan yavaşça süzülüp dökülen organik yaprak partikülleri
  createFallingLeaf(x, y, z) {
    if (this.particles.length > this.maxParticles) return;
    const mat = leafMats[Math.floor(Math.random() * leafMats.length)];
    const mesh = new THREE.Mesh(geoLeaf, mat);
    mesh.position.set(
      x + (Math.random() - 0.5) * 2.6,
      y + (Math.random() - 0.5) * 0.6,
      z + (Math.random() - 0.5) * 2.6
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.65 - Math.random() * 0.45, (Math.random() - 0.5) * 0.3),
      gravity: -0.25,
      life: 5.5 + Math.random() * 2.0,
      maxLife: 7.0,
      rotSpeed: 0.6 + Math.random() * 1.2,
      isLeaf: true,
      swaySpeed: 1.8 + Math.random() * 1.4,
      swayAmp: 0.4 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      fade: true
    });
  }

  update(dt) {
    this.time = (this.time || 0) + dt;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        if (p.mesh.material && !p.mesh.material.userData?.shared) {
          p.mesh.material.dispose();
        }
        this.particles.splice(i, 1);
        continue;
      }

      // Hız ve yerçekimi
      p.velocity.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      // Yaprak rüzgar salınımı (hafif süzülme ve havada dans)
      if (p.isLeaf) {
        p.mesh.position.x += Math.sin(this.time * p.swaySpeed + p.phase) * p.swayAmp * dt;
        p.mesh.position.z += Math.cos(this.time * p.swaySpeed * 0.8 + p.phase) * (p.swayAmp * 0.6) * dt;
        if (p.mesh.position.y <= 0.25) {
          p.velocity.set(0, 0, 0);
          p.gravity = 0;
          p.life -= dt * 1.6; // Yere inince yavaşça kaybolsun
        }
      }

      // Küp dönüşü (Voxel tumble)
      if (p.rotSpeed) {
        p.mesh.rotation.x += p.rotSpeed * dt;
        p.mesh.rotation.y += p.rotSpeed * dt;
      }

      // Büyüme veya küçülme
      if (p.growSpeed) {
        const factor = 1 + p.growSpeed * dt;
        p.mesh.scale.multiplyScalar(factor);
      }
      if (p.scaleSpeed) {
        p.mesh.scale.addScalar(p.scaleSpeed * dt);
        if (p.mesh.scale.x <= 0.01) {
          p.life = 0;
        }
      }

      // Solma
      if (p.fade && p.mesh.material) {
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      }
    }
  }

  clear() {
    this.particles.forEach(p => {
      this.scene.remove(p.mesh);
      if (p.mesh.material && !p.mesh.material.userData?.shared) {
        p.mesh.material.dispose();
      }
    });
    this.particles = [];
  }
}
