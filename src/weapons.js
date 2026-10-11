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

      // Minik voxel çarpışma kontrolü (Voxel haritasına çarptı mı?)
      if (!p.exploded) {
        const checkPos = p.mesh.position;
        const ix = Math.round(checkPos.x / VOXEL_SIZE);
        const iy = Math.round((checkPos.y - VOXEL_SIZE / 2) / VOXEL_SIZE);
        const iz = Math.round(checkPos.z / VOXEL_SIZE);
        const key = `${ix},${iy},${iz}`;

        const v = this.voxelWorld.voxels.get(key);
        if (v && v.active) {
          this.explode(p);
          continue;
        }
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
