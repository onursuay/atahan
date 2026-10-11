import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
import { getTNTSideTexture, getTNTTopTexture, getStoneTexture, getDiamondTexture } from './textures.js';

// Minecraft Tarzı Kübik Silah ve Mermi Yöneticisi
export class WeaponSystem {
  constructor(scene, physicsWorld, particleSystem, onScoreGain) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;
    this.onScoreGain = onScoreGain;

    this.activeProjectiles = [];

    // Minecraft Dokuları
    this.tntSideTex = getTNTSideTexture();
    this.tntTopTex = getTNTTopTexture();
    this.stoneTex = getStoneTexture();
    this.diamondTex = getDiamondTexture();

    // Silah Tipleri
    this.currentWeapon = 0;
    this.weapons = [
      { id: 0, name: 'Kübik Roket', ammo: Infinity, speed: 45, radius: 8.0, force: 190, color: 0xff4400 },
      { id: 1, name: 'Seken TNT', ammo: 10, speed: 28, radius: 10.5, force: 270, color: 0xffaa00, bounce: true },
      { id: 2, name: 'Mega Blok', ammo: 3, speed: 22, radius: 18.0, force: 580, color: 0x00ffff }
    ];

    this.cooldown = 0;
  }

  setWeapon(index) {
    if (index >= 0 && index < this.weapons.length) {
      this.currentWeapon = index;
    }
  }

  // Kübik Mermi Ateşle
  shoot(startPos, targetDir) {
    if (this.cooldown > 0) return false;

    const w = this.weapons[this.currentWeapon];
    if (w.ammo <= 0) return false;

    if (w.ammo !== Infinity) {
      w.ammo--;
    }

    this.cooldown = 0.25;
    sound.playShoot();

    // Tamamen Kübik Mermi Modeli
    let mesh;
    let size = 0.5;

    if (w.id === 0) {
      // 1. Kübik Roket: Önünde mini TNT olan füze bloğu
      const group = new THREE.Group();
      const bodyGeo = new THREE.BoxGeometry(0.35, 0.35, 0.8);
      const bodyMat = new THREE.MeshLambertMaterial({ map: this.stoneTex });
      const bMesh = new THREE.Mesh(bodyGeo, bodyMat);
      group.add(bMesh);

      const tipGeo = new THREE.BoxGeometry(0.38, 0.38, 0.38);
      const tipMat = new THREE.MeshLambertMaterial({ map: this.tntSideTex });
      const tipMesh = new THREE.Mesh(tipGeo, tipMat);
      tipMesh.position.z = 0.45;
      group.add(tipMesh);

      mesh = group;
      size = 0.4;
    } else if (w.id === 1) {
      // 2. Seken Klasik Minecraft TNT Küpü (1x1x1)
      const tntGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      const tntSideMat = new THREE.MeshLambertMaterial({ map: this.tntSideTex });
      const tntTopMat = new THREE.MeshLambertMaterial({ map: this.tntTopTex });
      const mats = [tntSideMat, tntSideMat, tntTopMat, tntTopMat, tntSideMat, tntSideMat];
      mesh = new THREE.Mesh(tntGeo, mats);
      size = 0.5;
    } else {
      // 3. Mega Blok (Dev Parlayan Elmas / Nükleer Küp)
      const nukeGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
      const nukeMat = new THREE.MeshLambertMaterial({ map: this.diamondTex });
      mesh = new THREE.Mesh(nukeGeo, nukeMat);
      size = 0.8;
    }

    mesh.position.copy(startPos);
    this.scene.add(mesh);

    // Mermi Fiziği (Kübik Cannon-es kutu gövde)
    const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
    const body = new CANNON.Body({
      mass: 6,
      shape: shape,
      position: new CANNON.Vec3(startPos.x, startPos.y, startPos.z),
      linearDamping: 0.05
    });

    const vel = targetDir.clone().multiplyScalar(w.speed);
    body.velocity.set(vel.x, vel.y, vel.z);

    this.physicsWorld.addBody(body);

    const projectile = {
      mesh,
      body,
      weaponInfo: w,
      life: w.bounce ? 2.5 : 5.0,
      exploded: false,
      flashTimer: 0
    };

    body.addEventListener('collide', (e) => {
      if (projectile.exploded) return;
      if (!w.bounce) {
        this.explode(projectile);
      } else {
        sound.playBlockHit();
        if (e.body && e.body.isDestructible) {
          this.explode(projectile);
        }
      }
    });

    this.activeProjectiles.push(projectile);
    return true;
  }

  // Kübik Patlama Mantığı
  explode(proj) {
    if (proj.exploded) return;
    proj.exploded = true;

    const blastPos = proj.mesh.position.clone();
    const w = proj.weaponInfo;

    // Kübik parçacık patlaması ve ses
    this.particleSystem.createExplosion(blastPos, w.radius, w.color);
    if (w.id === 2) {
      sound.playExplosion(2.2);
    } else {
      sound.playExplosion(1.1);
    }

    // Blokları fırlat
    this.applyBlastImpulse(blastPos, w.radius, w.force);

    this.removeProjectile(proj);
  }

  applyBlastImpulse(blastPos, radius, maxForce) {
    const cannonBlastPos = new CANNON.Vec3(blastPos.x, blastPos.y, blastPos.z);
    let hitBlocks = 0;

    for (let body of this.physicsWorld.bodies) {
      if (!body.isDestructible && !body.isTNT) continue;

      const dist = body.position.distanceTo(cannonBlastPos);
      if (dist < radius) {
        hitBlocks++;

        const dir = body.position.vsub(cannonBlastPos);
        dir.y += 0.6; // Blokları Minecraft gibi yukarı savur
        dir.normalize();

        const factor = Math.max(0, 1 - dist / radius);
        const force = maxForce * factor * factor;

        body.applyImpulse(dir.scale(force), body.position);

        // TNT Varili ise zincirleme patlat
        if (body.isTNT && !body.isDetonated) {
          body.isDetonated = true;

          // TNT beyaz yanıp sönme efekti
          if (body.mesh) {
            body.mesh.scale.set(1.15, 1.15, 1.15);
          }

          setTimeout(() => {
            if (body && body.mesh) {
              const tntPos = body.mesh.position.clone();
              sound.playTNTExplosion();
              this.particleSystem.createExplosion(tntPos, 12, 0xff0000);
              this.applyBlastImpulse(tntPos, 14, 400);
              if (this.onScoreGain) this.onScoreGain(300, '💥 ZİNCİRLEME TNT PATLAMASI!');
            }
          }, 140 + Math.random() * 160);
        }
      }
    }

    if (hitBlocks > 0 && this.onScoreGain) {
      const score = hitBlocks * 35;
      this.onScoreGain(score, `+${score} BLOK YIKILDI!`);
    }
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      p.life -= dt;

      this.particleSystem.createThrusterTrail(p.mesh.position);
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);

      // Seken TNT yanıp sönme animasyonu (Minecraft TNT animasyonu)
      if (p.weaponInfo.bounce) {
        p.flashTimer += dt * 8;
        const scale = 1 + Math.sin(p.flashTimer) * 0.1;
        p.mesh.scale.set(scale, scale, scale);
      }

      if (p.life <= 0 && !p.exploded) {
        this.explode(p);
      }
    }
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh);
    if (p.mesh.geometry) p.mesh.geometry.dispose();
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
