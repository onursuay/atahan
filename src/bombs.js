import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// İKİ BOMBA TÜRÜ
//  • Süreli bomba  : yerleştirilince 3 sn geri sayar; bip sesi giderek sıklaşır; süre dolunca kendiliğinden patlar.
//  • Uzaktan bomba : yerleştirilince bekler; ekrandaki PATLAT butonuna (ya da F tuşuna) basılınca patlar.
const FUSE_SECONDS = 3;
const BLAST_RADIUS = 4.2;
const BLAST_FORCE = 340;
const PLACE_REACH = 6;
const MAX_REMOTE = 6;

export class BombManager {
  constructor(scene, camera, voxelWorld, particleSystem, onShake, onRemoteChange) {
    this.scene = scene;
    this.camera = camera;
    this.voxelWorld = voxelWorld;
    this.particleSystem = particleSystem;
    this.onShake = onShake;
    this.onRemoteChange = onRemoteChange;
    this.bombs = [];

    this.bodyGeo = new THREE.BoxGeometry(0.36, 0.26, 0.36);
    this.lampGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
    this.bodyMats = {
      timed: new THREE.MeshLambertMaterial({ color: 0x3a3f47 }),
      remote: new THREE.MeshLambertMaterial({ color: 0x2f4a3a })
    };
  }

  get remoteCount() { return this.bombs.filter(b => b.type === 'remote').length; }

  // Bakılan yerde, 6 m içindeki ilk yüzeye bombayı yerleştirir.
  place(type) {
    if (type === 'remote' && this.remoteCount >= MAX_REMOTE) return false;
    const cam = this.camera;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const t = this.voxelWorld.terrain;

    let prev = cam.position.clone(), pos = null;
    for (let d = 0.4; d <= PLACE_REACH; d += VOXEL_SIZE * 0.5) {
      const p = cam.position.clone().addScaledVector(dir, d);
      const key = `${Math.round(p.x / VOXEL_SIZE)},${Math.round((p.y - VOXEL_SIZE / 2) / VOXEL_SIZE)},${Math.round(p.z / VOXEL_SIZE)}`;
      const v = this.voxelWorld.voxels.get(key);
      const gy = t.topYAt(p.x, p.z);
      if ((v && v.active) || (p.y <= gy && t.topIntactAt(p.x, p.z))) { pos = prev.clone(); break; }
      prev = p;
    }
    if (!pos) { // boşluğa bakıyor: önüne, yere bırak
      const p = cam.position.clone().addScaledVector(dir, 2.2);
      p.y = t.heightAt(p.x, p.z);
      if (!isFinite(p.y)) return false; // deniz
      pos = p;
    } else {
      // Bomba yüzeyin hemen üstünde dursun
      const gy = t.topYAt(pos.x, pos.z);
      if (pos.y < gy + 0.13 && t.topIntactAt(pos.x, pos.z)) pos.y = gy + 0.13;
    }

    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMats[type]);
    const lampMat = new THREE.MeshBasicMaterial({ color: type === 'timed' ? 0xff2222 : 0x33ff66 });
    const lamp = new THREE.Mesh(this.lampGeo, lampMat);
    lamp.position.y = 0.17;
    group.add(body, lamp);
    group.position.copy(pos);
    this.scene.add(group);

    const light = new THREE.PointLight(type === 'timed' ? 0xff3030 : 0x33ff66, 0, 5);
    light.position.copy(pos).y += 0.3;
    this.scene.add(light);

    this.bombs.push({ type, group, lampMat, light, pos, t: 0, beepTimer: 0, blink: 0 });
    sound.playBlockHit();
    if (type === 'remote') this.onRemoteChange && this.onRemoteChange(this.remoteCount);
    return true;
  }

  update(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;

      if (b.type === 'timed') {
        const k = Math.min(1, b.t / FUSE_SECONDS);           // 0 -> 1
        const interval = 0.55 - 0.47 * k * k;                // 0.55 sn -> ~0.08 sn: giderek sıklaşır
        b.beepTimer -= dt;
        if (b.beepTimer <= 0) {
          b.beepTimer = interval;
          sound.playBeep(0.8 + k * 1.4);                     // ses de yükselir
          b.blink = 0.07;
        }
        if (b.t >= FUSE_SECONDS) this._explode(b, i);
      } else {
        // Uzaktan bomba: yavaş, sakin yeşil yanıp sönme
        b.beepTimer -= dt;
        if (b.beepTimer <= 0) { b.beepTimer = 1.0; b.blink = 0.12; }
      }

      if (b.blink > 0) b.blink -= dt;
      const on = b.blink > 0;
      b.lampMat.color.setHex(on ? 0xffffff : (b.type === 'timed' ? 0x771111 : 0x115522));
      b.light.intensity = on ? 2.2 : 0;
    }
  }

  // Yerleştirilmiş tüm uzaktan bombaları patlat
  detonateRemote() {
    let n = 0;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      if (this.bombs[i].type === 'remote') { this._explode(this.bombs[i], i); n++; }
    }
    return n;
  }

  _explode(b, index) {
    this.scene.remove(b.group);
    this.scene.remove(b.light);
    this.bombs.splice(index, 1);
    const p = b.pos.clone(); p.y += 0.15;
    this.particleSystem.createExplosion(p, BLAST_RADIUS * 2, 0xff7a1a);
    sound.playExplosion(1.6);
    this.voxelWorld.explode(p, BLAST_RADIUS, BLAST_FORCE);
    if (this.onShake) this.onShake(0.6);
    if (b.type === 'remote') this.onRemoteChange && this.onRemoteChange(this.remoteCount);
  }

  clear() {
    this.bombs.forEach(b => { this.scene.remove(b.group); this.scene.remove(b.light); });
    this.bombs = [];
    this.onRemoteChange && this.onRemoteChange(0);
  }
}
