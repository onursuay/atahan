import * as THREE from 'three';

// Görsel Patlama ve Efekt Parçacık Yöneticisi
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.shockwaves = [];
  }

  // Patlama oluştur (Ateş, duman, kıvılcım ve şok dalgası)
  createExplosion(position, radius = 5, color = 0xff6600) {
    const sparkCount = 35;
    const smokeCount = 18;

    // 1. Kıvılcımlar (Hızlı saçılan ateş parçaları)
    const sparkGeo = new THREE.SphereGeometry(0.15, 6, 6);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });

    for (let i = 0; i < sparkCount; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.position.copy(position);

      const angle = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 8 + Math.random() * 16 * (radius / 5);

      const velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(angle) * speed,
        Math.cos(phi) * speed + 5,
        Math.sin(phi) * Math.sin(angle) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        gravity: -25,
        life: 0.8 + Math.random() * 0.4,
        maxLife: 1.2,
        scaleSpeed: -0.6
      });
    }

    // 2. Duman Bulutları (Yavaşça yükselen gri/siyah duman)
    const smokeGeo = new THREE.DodecahedronGeometry(0.8, 1);
    for (let i = 0; i < smokeCount; i++) {
      const smokeMat = new THREE.MeshStandardMaterial({
        color: Math.random() > 0.5 ? 0x222222 : 0x444444,
        roughness: 0.9,
        transparent: true,
        opacity: 0.8
      });

      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 2,
        position.y + (Math.random() - 0.5) * 2,
        position.z + (Math.random() - 0.5) * 2
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
        gravity: 1, // Duman hafifçe yukarı süzülür
        life: 1.2 + Math.random() * 0.8,
        maxLife: 2.0,
        growSpeed: 1.5,
        fade: true
      });
    }

    // 3. Parlak Ateş Küresi (Ani genişleyip kaybolan alev)
    const fireballGeo = new THREE.SphereGeometry(1, 16, 16);
    const fireballMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9
    });
    const fireball = new THREE.Mesh(fireballGeo, fireballMat);
    fireball.position.copy(position);
    this.scene.add(fireball);

    this.particles.push({
      mesh: fireball,
      velocity: new THREE.Vector3(0, 0, 0),
      gravity: 0,
      life: 0.25,
      maxLife: 0.25,
      growSpeed: radius * 6,
      fade: true
    });

    // 4. Şok Dalgası Halkası (Yerde yayılan halka)
    const ringGeo = new THREE.RingGeometry(0.2, 0.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(position.x, 0.1, position.z);
    this.scene.add(ring);

    this.shockwaves.push({
      mesh: ring,
      scale: 1,
      maxScale: radius * 3.5,
      opacity: 0.9
    });
  }

  // Karakter yürürken ayaklarından çıkan minik toz bulutları
  createDust(position) {
    if (Math.random() > 0.4) return;
    const dustGeo = new THREE.SphereGeometry(0.12, 4, 4);
    const dustMat = new THREE.MeshBasicMaterial({
      color: 0x888877,
      transparent: true,
      opacity: 0.5
    });
    const mesh = new THREE.Mesh(dustGeo, dustMat);
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.4,
      0.1,
      position.z + (Math.random() - 0.5) * 0.4
    );

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.6, (Math.random() - 0.5) * 0.8),
      gravity: -0.5,
      life: 0.4,
      maxLife: 0.4,
      growSpeed: 0.8,
      fade: true
    });
  }

  // Mermi arkası itici alev izi
  createThrusterTrail(position) {
    const trailGeo = new THREE.SphereGeometry(0.18, 6, 6);
    const trailMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? 0xff4400 : 0xffbb00,
      transparent: true,
      opacity: 0.8
    });
    const mesh = new THREE.Mesh(trailGeo, trailMat);
    mesh.position.copy(position);

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
      gravity: 0,
      life: 0.25,
      maxLife: 0.25,
      scaleSpeed: -0.6,
      fade: true
    });
  }

  update(dt) {
    // Parçacıkları güncelle
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        if (p.mesh.material.dispose) p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      // Hız ve yerçekimi
      p.velocity.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

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

      // Solma (Fade out)
      if (p.fade && p.mesh.material) {
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      }
    }

    // Şok dalgalarını güncelle
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.scale += 28 * dt;
      s.opacity -= 1.8 * dt;

      s.mesh.scale.set(s.scale, s.scale, s.scale);
      s.mesh.material.opacity = Math.max(0, s.opacity);

      if (s.scale >= s.maxScale || s.opacity <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  clear() {
    this.particles.forEach(p => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      if (p.mesh.material.dispose) p.mesh.material.dispose();
    });
    this.shockwaves.forEach(s => {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    });
    this.particles = [];
    this.shockwaves = [];
  }
}
