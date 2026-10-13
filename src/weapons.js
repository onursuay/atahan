import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// Teardown Silah ve Patlama Sistemi
export class WeaponSystem {
  constructor(scene, physicsWorld, particleSystem, voxelWorld, onScoreGain) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;
    this.voxelWorld = voxelWorld;
    this.onScoreGain = onScoreGain;

    this.activeProjectiles = [];

    // Silah Tanımları
    this.currentWeapon = 0;
    this.weapons = [
      { id: 0, name: 'Delici Roket', ammo: Infinity, speed: 48, radius: 2.2, force: 220, color: 0xff4400, desc: 'Duvarda delik açar' },
      { id: 1, name: 'Teardown TNT', ammo: 10, speed: 28, radius: 3.8, force: 320, color: 0xef4444, bounce: true, desc: 'Geniş oyuk patlaması' },
      { id: 2, name: 'Kırıcı Balyoz / Nükleer', ammo: 3, speed: 24, radius: 6.5, force: 600, color: 0x00ffff, desc: 'Tüm katı çökertir' }
    ];

    this.cooldown = 0;
    this.cubeGeo = new THREE.BoxGeometry(VOXEL_SIZE * 1.2, VOXEL_SIZE * 1.2, VOXEL_SIZE * 1.2);
  }

  setWeapon(index) {
    if (index >= 0 && index < this.weapons.length) {
      this.currentWeapon = index;
    }
  }

  shoot(startPos, targetDir) {
    if (this.cooldown > 0) return false;

    const w = this.weapons[this.currentWeapon];
    if (w.ammo <= 0) return false;

    if (w.ammo !== Infinity) {
      w.ammo--;
    }

    this.cooldown = 0.22;
    sound.playShoot();

    // Kübik Mermi Görseli
    const mat = new THREE.MeshBasicMaterial({ color: w.color });
    const mesh = new THREE.Mesh(this.cubeGeo, mat);
    mesh.position.copy(startPos);
    this.scene.add(mesh);

    // Mermi Fiziği
    const r = VOXEL_SIZE * 0.7;
    const shape = new CANNON.Sphere(r);
    const body = new CANNON.Body({
      mass: 4,
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
      exploded: false
    };

    body.addEventListener('collide', () => {
      if (projectile.exploded) return;
      if (!w.bounce) {
        this.explode(projectile);
      } else {
        sound.playBlockHit();
      }
    });

    this.activeProjectiles.push(projectile);
    return true;
  }

  // Teardown Patlama Mantığı
  explode(proj) {
    if (proj.exploded) return;
    proj.exploded = true;

    const blastPos = proj.mesh.position.clone();
    const w = proj.weaponInfo;

    // Görsel kübik parçacık patlaması
    this.particleSystem.createExplosion(blastPos, w.radius * 2, w.color);
    if (w.id === 2) {
      sound.playExplosion(2.2);
    } else {
      sound.playExplosion(1.0);
    }

    // TEARDOWN OYUK AÇMA VE MİKRO-VOXEL PARÇALAMA
    this.voxelWorld.explode(blastPos, w.radius, w.force);

    this.removeProjectile(proj);
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      p.life -= dt;

      this.particleSystem.createThrusterTrail(p.mesh.position);
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);

      // Minik voxel çarpışma kontrolü: önceki konumdan şimdikine kadar adım adım tara
      // (hızlı mermi 0.25 m'lik ince duvarı tek karede atlayabilir)
      if (!p.exploded) {
        const to = p.body.position;
        const from = p.prevPos || to;
        const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
        const steps = Math.max(1, Math.ceil(dist / (VOXEL_SIZE * 0.8)));
        let hit = false;
        for (let i = 1; i <= steps && !hit; i++) {
          const t = i / steps;
          const x = from.x + (to.x - from.x) * t;
          const y = from.y + (to.y - from.y) * t;
          const z = from.z + (to.z - from.z) * t;
          const key = `${Math.round(x / VOXEL_SIZE)},${Math.round((y - VOXEL_SIZE / 2) / VOXEL_SIZE)},${Math.round(z / VOXEL_SIZE)}`;
          const v = this.voxelWorld.voxels.get(key);
          if (v && v.active) {
            p.mesh.position.set(x, y, z);
            this.explode(p);
            hit = true;
          }
        }
        if (hit) continue;
        p.prevPos = { x: to.x, y: to.y, z: to.z };
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
