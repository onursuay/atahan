import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';

// Silah ve Mermi Yöneticisi
export class WeaponSystem {
  constructor(scene, physicsWorld, particleSystem, onScoreGain) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;
    this.onScoreGain = onScoreGain;

    this.activeProjectiles = [];

    // Silah Tipleri ve Cephane
    this.currentWeapon = 0;
    this.weapons = [
      { id: 0, name: 'Roket', ammo: Infinity, speed: 45, radius: 7.5, force: 180, color: 0xff4400 },
      { id: 1, name: 'Bomba', ammo: 10, speed: 28, radius: 10.0, force: 260, color: 0xffaa00, bounce: true },
      { id: 2, name: 'Nükleer', ammo: 3, speed: 22, radius: 18.0, force: 550, color: 0x00ffff }
    ];

    this.cooldown = 0;
  }

  setWeapon(index) {
    if (index >= 0 && index < this.weapons.length) {
      this.currentWeapon = index;
    }
  }

  // Ateş Etme Fonksiyonu
  shoot(startPos, targetDir) {
    if (this.cooldown > 0) return false;

    const w = this.weapons[this.currentWeapon];
    if (w.ammo <= 0) return false;

    if (w.ammo !== Infinity) {
      w.ammo--;
    }

    this.cooldown = 0.25; // Seri ateş kısıtı
    sound.playShoot();

    // Mermi Görseli
    const projGeo = new THREE.SphereGeometry(w.id === 2 ? 0.6 : 0.3, 12, 12);
    const projMat = new THREE.MeshStandardMaterial({
      color: w.color,
      emissive: w.color,
      emissiveIntensity: 0.8
    });
    const mesh = new THREE.Mesh(projGeo, projMat);
    mesh.position.copy(startPos);
    this.scene.add(mesh);

    // Mermi Fiziği
    const shape = new CANNON.Sphere(w.id === 2 ? 0.6 : 0.3);
    const body = new CANNON.Body({
      mass: 5,
      shape: shape,
      position: new CANNON.Vec3(startPos.x, startPos.y, startPos.z),
      linearDamping: 0.05
    });

    // Fırlatma Hızı
    const vel = targetDir.clone().multiplyScalar(w.speed);
    body.velocity.set(vel.x, vel.y, vel.z);

    this.physicsWorld.addBody(body);

    const projectile = {
      mesh,
      body,
      weaponInfo: w,
      life: w.bounce ? 2.5 : 5.0,
      exploded: false
    };

    // Çarpışma Dinleyicisi
    body.addEventListener('collide', (e) => {
      if (projectile.exploded) return;
      if (!w.bounce) {
        // Roket ve Nükleer doğrudan çarptığı anda patlar
        this.explode(projectile);
      } else {
        // Bomba ise zemine çarpınca sekme sesi çıkarır, süresi bitince veya doğrudan hedefe vurursa patlar
        sound.playBlockHit();
        if (e.body && e.body.isDestructible) {
          this.explode(projectile);
        }
      }
    });

    this.activeProjectiles.push(projectile);
    return true;
  }

  // Patlama Mantığı ve Darbe Dalgası (Blast Wave)
  explode(proj) {
    if (proj.exploded) return;
    proj.exploded = true;

    const blastPos = proj.mesh.position.clone();
    const w = proj.weaponInfo;

    // Görsel efekt ve ses
    this.particleSystem.createExplosion(blastPos, w.radius, w.color);
    if (w.id === 2) {
      sound.playExplosion(2.2);
    } else {
      sound.playExplosion(1.0);
    }

    // Fizik darbe dalgası: Etraftaki blokları fırlat
    this.applyBlastImpulse(blastPos, w.radius, w.force);

    // Mermiyi dünyadan kaldır
    this.removeProjectile(proj);
  }

  // Etraftaki tüm fizik gövdelerine itme kuvveti uygula
  applyBlastImpulse(blastPos, radius, maxForce) {
    const cannonBlastPos = new CANNON.Vec3(blastPos.x, blastPos.y, blastPos.z);
    let hitBlocks = 0;

    for (let body of this.physicsWorld.bodies) {
      if (!body.isDestructible && !body.isTNT) continue;

      const dist = body.position.distanceTo(cannonBlastPos);
      if (dist < radius) {
        hitBlocks++;

        // Patlama yön vektörü
        const dir = body.position.vsub(cannonBlastPos);
        dir.y += 0.5; // Blokları havaya doğru fırlatmak için hafif yukarı açı
        dir.normalize();

        // Mesafeye göre azalan kuvvet
        const factor = Math.max(0, 1 - dist / radius);
        const force = maxForce * factor * factor;

        // İtme kuvveti
        body.applyImpulse(dir.scale(force), body.position);

        // TNT Varili ise zincirleme patlat
        if (body.isTNT && !body.isDetonated) {
          body.isDetonated = true;
          setTimeout(() => {
            if (body && body.mesh) {
              const tntPos = body.mesh.position.clone();
              sound.playTNTExplosion();
              this.particleSystem.createExplosion(tntPos, 12, 0xff0000);
              this.applyBlastImpulse(tntPos, 14, 380);
              if (this.onScoreGain) this.onScoreGain(250, 'ZİNCİRLEME TNT PATLAMASI!');
            }
          }, 120 + Math.random() * 150);
        }
      }
    }

    if (hitBlocks > 0 && this.onScoreGain) {
      const score = hitBlocks * 30;
      this.onScoreGain(score, `+${score} TAM İSABET!`);
    }
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      p.life -= dt;

      // İtici alev dumanı izi
      this.particleSystem.createThrusterTrail(p.mesh.position);

      // Fiziği görselle eşitle
      p.mesh.position.copy(p.body.position);

      if (p.life <= 0 && !p.exploded) {
        this.explode(p);
      }
    }
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    this.physicsWorld.removeBody(p.body);

    const idx = this.activeProjectiles.indexOf(p);
    if (idx !== -1) {
      this.activeProjectiles.splice(idx, 1);
    }
  }

  clear() {
    for (let p of this.activeProjectiles) {
      this.scene.remove(p.mesh);
      this.physicsWorld.removeBody(p.body);
    }
    this.activeProjectiles = [];
  }
}
