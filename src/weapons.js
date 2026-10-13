import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';

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
      { id: 0, type: 'rocket', name: 'Delici Roket', ammo: Infinity, speed: 48, radius: 2.2, force: 220, color: 0xff4400, desc: 'Duvarda delik açar' },
      { id: 1, type: 'minigun', name: 'Minigun', ammo: Infinity, desc: 'Basılı tut: seri ateş' },
      { id: 2, type: 'saber', name: 'Işın Kılıcı', ammo: Infinity, desc: 'Savur: her şeyi keser' },
      { id: 3, type: 'timed', name: 'Süreli Bomba', ammo: Infinity, desc: '3 sn sonra patlar' },
      { id: 4, type: 'remote', name: 'Uzaktan Bomba', ammo: Infinity, desc: 'Butonla patlar' },
      { id: 5, type: 'pistol', name: 'Tabanca', ammo: Infinity, desc: 'Tek atış' },
      { id: 6, type: 'shotgun', name: 'Pompalı', ammo: Infinity, desc: 'Saçma' },
      { id: 7, type: 'ak47', name: 'AK-47', ammo: Infinity, desc: 'Otomatik' },
      { id: 8, type: 'sniper', name: 'Sniper', ammo: Infinity, desc: 'X: nişan al' }
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
    if (w.type !== 'rocket') return false; // minigun ve kılıç HandWeapons tarafından yönetilir
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

        // Roket bir arabaya çarptı mı?
        if (this.voxelWorld.cars) {
          const ch = this.voxelWorld.cars.segmentHit(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z));
          if (ch) { p.mesh.position.copy(ch.point); this.explode(p); continue; }
        }

        // Roket havadaki uçağa çarptı mı?
        if (this.voxelWorld.planes) {
          const ph = this.voxelWorld.planes.segmentHit(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), 3.2);
          if (ph) { p.mesh.position.copy(ph.point); this.explode(p); continue; }
        }

        // Suya düştü: sıçratır ve yok olur
        if (to.y < -0.1 && this.voxelWorld.terrain.heightAt(to.x, to.z) === -Infinity) {
          this.particleSystem.createSplash(new THREE.Vector3(to.x, -0.15, to.z), 2.2);
          sound.playSplash && sound.playSplash();
          this.removeProjectile(p);
          continue;
        }

        // Sağlam zemin üst katmanına çarptı mı? (fizik yalnız alttaki taban kayasını bilir)
        const ter = this.voxelWorld.terrain;
        const ty = ter.topYAt(to.x, to.z);
        if (to.y < ty + 0.1 && to.y > ty - 0.5 && ter.topIntactAt(to.x, to.z)) {
          if (p.weaponInfo.bounce) {
            if (p.body.velocity.y < 0) {
              p.body.position.y = ty + 0.15;
              p.body.velocity.y *= -0.4;
              p.body.velocity.x *= 0.8;
              p.body.velocity.z *= 0.8;
              sound.playBlockHit();
            }
          } else {
            p.mesh.position.set(to.x, ty + 0.05, to.z);
            this.explode(p);
            continue;
          }
        }
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
