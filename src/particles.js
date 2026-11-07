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

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        // Paylaşılan geometri dispose edilmez, yalnızca özel malzeme varsa temizlenir
        if (p.mesh.material && !p.mesh.material.userData?.shared) {
          p.mesh.material.dispose();
        }
        this.particles.splice(i, 1);
        continue;
      }

      // Hız ve yerçekimi
      p.velocity.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

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
