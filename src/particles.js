import * as THREE from 'three';

// Minecraft Tarzı Tamamen Kübik / Voxel Parçacık Sistemi
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  // Kübik Patlama (Minecraft explosion style)
  createExplosion(position, radius = 5, color = 0xff6600) {
    const sparkCount = 30;
    const smokeCount = 18;

    // 1. Ateş Küpleri (Parlak Sarı/Turuncu/Kırmızı Minecraft Pikselleri)
    const cubeGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const fireColors = [0xffea00, 0xff7700, 0xef4444, 0xffffff];

    for (let i = 0; i < sparkCount; i++) {
      const c = fireColors[Math.floor(Math.random() * fireColors.length)];
      const mat = new THREE.MeshBasicMaterial({ color: c });
      const mesh = new THREE.Mesh(cubeGeo, mat);
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
    const smokeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const smokeColors = [0x555555, 0x777777, 0x333333, 0x999999];

    for (let i = 0; i < smokeCount; i++) {
      const c = smokeColors[Math.floor(Math.random() * smokeColors.length)];
      const smokeMat = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.85
      });

      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
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
    const blastGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const blastMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    const blastCube = new THREE.Mesh(blastGeo, blastMat);
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
    if (Math.random() > 0.4) return;
    const dustGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0x866043 });
    const mesh = new THREE.Mesh(dustGeo, dustMat);
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

  // Suya giriş / yüzme sırasında sıçrayan mavi-beyaz su küpleri
  createSplash(position, strength = 1) {
    const count = Math.ceil(7 * strength);
    for (let i = 0; i < count; i++) {
      const size = 0.12 + Math.random() * 0.12;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xe0f2fe : 0x7dd3fc })
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
    const trailGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const trailMat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.5 ? 0xff4400 : 0xffdd00,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(trailGeo, trailMat);
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
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
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
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });
    this.particles = [];
  }
}
