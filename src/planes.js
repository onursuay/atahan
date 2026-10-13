import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// Gökyüzünde ara sıra geçen yolcu uçakları (Boeing 737 görünümlü). Roket veya minigunla vurulursa kontrolünü
// kaybedip düşer; yere çarpınca büyük patlama ve geniş çukur oluşturur.
const ALTITUDE = [95, 135];
const SPEED = 38;                 // m/s
const FUSE_HALF = 11;             // gövde yarı uzunluğu (isabet hesabı)
const HIT_RADIUS = 2.4;
const BULLET_HP = 70;             // minigun mermisiyle bu kadar isabet gerekir
const FIRST_DELAY = [8, 14];
const NEXT_DELAY = [28, 55];
const SPAWN_RANGE = 230;

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

function buildModel() {
  const g = new THREE.Group();
  const white = mat(0xf3f4f6), blue = mat(0x1d4ed8), dark = mat(0x1f2937), grey = mat(0x9ca3af);
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true; g.add(mesh); return mesh;
  };
  // Gövde (+x ileri): ana gövde, burun, kuyruk konisi
  add(box(20, 2.7, 2.7), white, 0, 0, 0);
  add(box(3, 2.2, 2.2), white, 11.5, -0.1, 0);
  add(box(2, 1.6, 1.6), dark, 13.2, -0.1, 0);                 // burun / radar kubbesi
  add(box(5, 2.0, 2.0), white, -12, 0.35, 0);                 // arka gövde
  add(box(20.4, 0.28, 2.74), blue, 0, -0.55, 0);              // mavi şerit
  add(box(14, 0.45, 2.78), dark, 1, 0.55, 0);                 // yolcu pencereleri
  add(box(2.2, 0.7, 2.3), dark, 11.0, 0.7, 0);                // kokpit camı
  // Kanatlar (geriye yatık)
  add(box(7, 0.35, 15), white, -0.5, -0.6, 8.5, 0, 0.5, 0);
  add(box(7, 0.35, 15), white, -0.5, -0.6, -8.5, 0, -0.5, 0);
  add(box(1.3, 1.5, 1.3), grey, 1.5, -1.7, 5.2);              // motorlar
  add(box(1.3, 1.5, 1.3), grey, 1.5, -1.7, -5.2);
  // Kuyruk
  add(box(5, 5.2, 0.4), blue, -12.5, 3.6, 0, 0, 0, -0.35);
  add(box(3.2, 0.3, 8), white, -12.8, 1.2, 0, 0, 0.3, 0);
  return g;
}

export class PlaneManager {
  constructor(scene, voxelWorld, particleSystem, onScore, onShake) {
    this.scene = scene;
    this.vw = voxelWorld;
    this.particleSystem = particleSystem;
    this.onScore = onScore;
    this.onShake = onShake;
    this.planes = [];
    this.timer = FIRST_DELAY[0] + Math.random() * (FIRST_DELAY[1] - FIRST_DELAY[0]);
  }

  _spawn() {
    const g = buildModel();
    const alt = ALTITUDE[0] + Math.random() * (ALTITUDE[1] - ALTITUDE[0]);
    // Haritayı kesen rastgele bir doğru boyunca uçar
    const ang = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const pos = dir.clone().multiplyScalar(-SPAWN_RANGE).addScaledVector(perp, (Math.random() - 0.5) * 120);
    pos.y = alt;
    g.position.copy(pos);
    g.rotation.y = -Math.atan2(dir.z, dir.x);
    this.scene.add(g);
    this.planes.push({ g, pos, dir, vy: 0, state: 'fly', hp: BULLET_HP, roll: 0, smoke: 0, age: 0 });
  }

  // Gövde ekseni boyunca en yakın nokta
  _axisPoint(p, q) {
    const a = p.pos.clone().addScaledVector(p.dir, -FUSE_HALF), b = p.pos.clone().addScaledVector(p.dir, FUSE_HALF);
    const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq()));
    return a.addScaledVector(ab, t);
  }

  // Patlama yakınındaki uçak vurulur
  hitSphere(center, radius) {
    this.planes.forEach(p => {
      if (p.state !== 'fly') return;
      if (this._axisPoint(p, center).distanceTo(center) <= radius + HIT_RADIUS) this._startCrash(p);
    });
  }

  // Mermi yolu (a -> b) uçağa değiyor mu? Değiyorsa uçak üzerindeki nokta
  segmentHit(a, b, radius = HIT_RADIUS) {
    const seg = b.clone().sub(a), len = seg.length();
    if (len === 0) return null;
    seg.divideScalar(len);
    for (const p of this.planes) {
      if (p.state !== 'fly') continue;
      const q = this._axisPoint(p, a.clone().addScaledVector(seg, Math.max(0, Math.min(len, p.pos.clone().sub(a).dot(seg)))));
      const along = Math.max(0, Math.min(len, q.clone().sub(a).dot(seg)));
      const closest = a.clone().addScaledVector(seg, along);
      if (closest.distanceTo(q) <= radius) return { plane: p, point: closest };
    }
    return null;
  }

  // Minigun ışını
  rayHit(origin, dir, maxDist) {
    return this.segmentHit(origin, origin.clone().addScaledVector(dir, maxDist), 2.0);
  }

  bulletHit(p) {
    p.hp -= 1;
    if (p.hp <= 0 && p.state === 'fly') this._startCrash(p);
  }

  _startCrash(p) {
    p.state = 'crash';
    p.vy = 0;
    sound.playExplosion(1.2);
    this.particleSystem.createExplosion(p.pos.clone(), 7, 0xff7a1a);
    if (this.onScore) this.onScore(500, '+500 UÇAK DÜŞTÜ!');
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = NEXT_DELAY[0] + Math.random() * (NEXT_DELAY[1] - NEXT_DELAY[0]);
      if (this.planes.length < 2) this._spawn();
    }

    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.age += dt;
      if (p.state === 'fly') {
        p.pos.addScaledVector(p.dir, SPEED * dt);
        if (p.pos.length() > SPAWN_RANGE + 80 && p.age > 5) { this.scene.remove(p.g); this.planes.splice(i, 1); continue; }
      } else {
        // Kontrolsüz düşüş: burun aşağı, dönerek, dumanlı
        p.vy = Math.min(60, p.vy + 22 * dt);
        p.pos.addScaledVector(p.dir, SPEED * 0.85 * dt);
        p.pos.y -= p.vy * dt;
        p.roll += dt * 2.4;
        p.g.rotation.z = Math.min(1.0, p.vy / 45);
        p.g.rotation.x = p.roll;
        p.smoke -= dt;
        if (p.smoke <= 0) {
          p.smoke = 0.04;
          this.particleSystem.createThrusterTrail(p.pos.clone().addScaledVector(p.dir, -9));
          this.particleSystem.createThrusterTrail(p.pos.clone());
        }
        if (this._impact(p)) { this.planes.splice(i, 1); continue; }
      }
      p.g.position.copy(p.pos);
    }
  }

  // Düşen uçağın burun/orta/kuyruk noktaları zemine ya da bir yapıya değdi mi?
  _impact(p) {
    const t = this.vw.terrain;
    for (const off of [FUSE_HALF, 0, -FUSE_HALF]) {
      const q = p.pos.clone().addScaledVector(p.dir, off);
      q.y -= 1.2;
      const h = t.heightAt(q.x, q.z);
      const key = `${Math.round(q.x / VOXEL_SIZE)},${Math.round((q.y - VOXEL_SIZE / 2) / VOXEL_SIZE)},${Math.round(q.z / VOXEL_SIZE)}`;
      const v = this.vw.voxels.get(key);
      const onLand = h > -Infinity && q.y <= h + 0.3;
      if ((v && v.active) || onLand) { this._explodeAt(p, q); return true; }
      if (q.y < -0.4 && h === -Infinity) { // denize düştü
        this.particleSystem.createSplash && this.particleSystem.createSplash(new THREE.Vector3(q.x, -0.15, q.z), 3);
        sound.playSplash && sound.playSplash();
        this.scene.remove(p.g);
        return true;
      }
    }
    return false;
  }

  _explodeAt(p, q) {
    const vw = this.vw;
    this.scene.remove(p.g);
    this.particleSystem.createExplosion(q, 26, 0xff6a00);
    sound.playExplosion(2.6);
    // Geniş yıkım: gövde boyunca üç patlama (burun, orta, kuyruk) ve büyük çukur
    const pts = [0, -6, -12].map(o => q.clone().addScaledVector(p.dir, o));
    vw.explode(pts[0], 11, 800);
    pts.slice(1).forEach((pt, i) => setTimeout(() => {
      this.particleSystem.createExplosion(pt, 14, 0xffa032);
      vw.explode(pt, 8, 600);
    }, 140 * (i + 1)));
    // Uçak parçaları saçılır
    const colors = [0xf3f4f6, 0x1d4ed8, 0x9ca3af, 0x1f2937];
    for (let i = 0; i < 40 && vw.dynamicDebris.length < vw.maxDynamicDebris; i++) {
      vw.spawnLooseVoxel(q.x + (Math.random() - 0.5) * 8, q.y + 0.6 + Math.random() * 2, q.z + (Math.random() - 0.5) * 8,
        { color: colors[i % 4] }, q, 1, 8, 140);
    }
    if (this.onShake) this.onShake(1.0);
  }

  clear() {
    this.planes.forEach(p => this.scene.remove(p.g));
    this.planes = [];
  }
}
