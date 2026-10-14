import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';

// ─────────────────────────────────────────────────────────────────────────────
// NPC İNSANLAR: karakterden küçük voxel insanlar. Rastgele dolaşırlar; deniz, çukur kenarı veya duvara
// gelince sağa/sola dönüp yürümeye devam ederler. Roket/patlama, minigun, ışın kılıcı ve çekiçle
// vurulabilirler (küplere dağılırlar, gore yok). Bir süre sonra başka yerde yenisi doğar.
// ─────────────────────────────────────────────────────────────────────────────
const NPC_COUNT = 80;
const HALF_W = 0.22;
const HEIGHT = 1.55;
const SPEED = 2.0;
const GRAVITY = 25;
const STEP_UP_MAX = 0.5;
const EPS = 1e-4;
const RESPAWN_SECONDS = 6;
const HIT_RADIUS = 0.45; // mermi/kılıç isabet yarıçapı (gövde etrafı)

const SHIRTS = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0891b2, 0xe11d48, 0x65a30d, 0xf97316, 0x475569];
const PANTS = [0x1e293b, 0x334155, 0x44403c, 0x1d4ed8, 0x3f3f46];
const SKINS = [0xe0ac86, 0xc68642, 0x8d5524, 0xf1c27d, 0xffdbac];
const HAIRS = [0x2b1b0e, 0x4a2f13, 0x111111, 0xb08d57, 0x7c2d12];

const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const GEO = {
  head: boxGeo(0.34, 0.34, 0.34), hair: boxGeo(0.36, 0.12, 0.36),
  torso: boxGeo(0.4, 0.55, 0.22), arm: boxGeo(0.14, 0.5, 0.14), leg: boxGeo(0.17, 0.55, 0.17)
};
const matCache = new Map();
const mat = (color) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class NPCManager {
  constructor(scene, voxelWorld, particleSystem, onScore) {
    this.scene = scene;
    this.voxelWorld = voxelWorld;
    this.particleSystem = particleSystem;
    this.onScore = onScore;
    this.npcs = [];
    this.respawnQueue = [];
    this.playerPos = new THREE.Vector3();
  }

  reset() {
    this.npcs.forEach(n => this.scene.remove(n.group));
    this.npcs = [];
    this.respawnQueue = [];
    for (let i = 0; i < NPC_COUNT; i++) this._spawn();
  }

  // ── Çarpışma: karakterle aynı kurallar (iki katmanlı zemin + voxeller) ──
  _solid(x, feet, z) {
    const t = this.voxelWorld.terrain;
    if (t.solidAt(x, feet, z, HALF_W)) return true;
    if (this.voxelWorld.doors && this.voxelWorld.doors.blocks(x, feet, z, HALF_W, HEIGHT)) return true;

    const S = VOXEL_SIZE, vox = this.voxelWorld.voxels;
    const ix0 = Math.floor((x - HALF_W + EPS) / S + 0.5), ix1 = Math.floor((x + HALF_W - EPS) / S + 0.5);
    const iz0 = Math.floor((z - HALF_W + EPS) / S + 0.5), iz1 = Math.floor((z + HALF_W - EPS) / S + 0.5);
    const iy0 = Math.floor((feet + EPS) / S), iy1 = Math.floor((feet + HEIGHT - EPS) / S);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const v = vox.get(`${ix},${iy},${iz}`);
          if (v && v.active) return true;
        }
      }
    }
    return false;
  }

  // Önünde yürünebilir kara var mı? (deniz/kara dışı = hayır)
  _walkableAhead(x, z) {
    return this.voxelWorld.terrain.heightAt(x, z) > -Infinity;
  }

  _makeBody() {
    const g = new THREE.Group();
    const shirt = pick(SHIRTS), pants = pick(PANTS), skin = pick(SKINS), hair = pick(HAIRS);

    const head = new THREE.Mesh(GEO.head, mat(skin)); head.position.y = 1.38;
    const hairM = new THREE.Mesh(GEO.hair, mat(hair)); hairM.position.y = 1.58;
    const torso = new THREE.Mesh(GEO.torso, mat(shirt)); torso.position.y = 0.95;
    const mkArm = (x) => {
      const p = new THREE.Group(); p.position.set(x, 1.2, 0);
      const m = new THREE.Mesh(GEO.arm, mat(shirt)); m.position.y = -0.22; p.add(m); return p;
    };
    const mkLeg = (x) => {
      const p = new THREE.Group(); p.position.set(x, 0.62, 0);
      const m = new THREE.Mesh(GEO.leg, mat(pants)); m.position.y = -0.28; p.add(m); return p;
    };
    const lArm = mkArm(-0.27), rArm = mkArm(0.27), lLeg = mkLeg(-0.1), rLeg = mkLeg(0.1);
    g.add(head, hairM, torso, lArm, rArm, lLeg, rLeg);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { g, lArm, rArm, lLeg, rLeg, colors: [shirt, pants, skin, hair] };
  }

  _spawn() {
    const t = this.voxelWorld.terrain;
    if (!t.bounds) return;
    const b = t.bounds;
    for (let tries = 0; tries < 200; tries++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!t.topIntactAt(x, z)) continue;
      const gy0 = t.topYAt(x, z);
      if (this.playerPos.distanceTo(new THREE.Vector3(x, gy0, z)) < 12) continue;
      if (this._solid(x, gy0, z)) continue;
      // Çevresi açık mı (bina içinde ya da duvarın dibinde doğmasın)
      if (this._solid(x + 0.6, gy0, z) || this._solid(x - 0.6, gy0, z) ||
          this._solid(x, gy0, z + 0.6) || this._solid(x, gy0, z - 0.6)) continue;

      const gy = t.topYAt(x, z);
      const body = this._makeBody();
      body.g.position.set(x, gy, z);
      this.scene.add(body.g);
      this.npcs.push({
        ...body, group: body.g, x, y: gy, z, vy: 0,
        heading: Math.random() * Math.PI * 2,
        turnTimer: 2 + Math.random() * 5, pause: 0, cycle: Math.random() * 6, grounded: true
      });
      return;
    }
  }

  // ── Güncelleme ──
  update(dt, playerPos) {
    this.playerPos.copy(playerPos);

    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) { this.respawnQueue.splice(i, 1); this._spawn(); }
    }

    for (const n of this.npcs) this._step(n, dt);
  }

  _step(n, dt) {
    // Rastgele durma ve yön değiştirme
    if (n.pause > 0) {
      n.pause -= dt;
    } else {
      n.turnTimer -= dt;
      if (n.turnTimer <= 0) {
        n.turnTimer = 3 + Math.random() * 6;
        if (Math.random() < 0.35) n.pause = 0.8 + Math.random() * 1.6;
        else n.heading += (Math.random() - 0.5) * 1.4;
      }
    }
    const moving = n.pause <= 0;

    if (moving) {
      const dx = Math.sin(n.heading) * SPEED * dt, dz = Math.cos(n.heading) * SPEED * dt;
      // Önüne bak: deniz, kara dışı veya duvar varsa sağa ya da sola dön
      const ax = n.x + Math.sin(n.heading) * 0.7, az = n.z + Math.cos(n.heading) * 0.7;
      const blocked = !this._walkableAhead(ax, az) || this._solid(ax, n.y + 0.5, az);
      if (blocked) {
        const side = Math.random() < 0.5 ? 1 : -1;
        n.heading += side * (1.0 + Math.random() * 1.2);
        n.turnTimer = 2 + Math.random() * 3;
      } else {
        this._tryMove(n, dx, 0);
        this._tryMove(n, 0, dz);
      }
      n.cycle += dt * 8;
    }

    // Yerçekimi / dikey çözümleme
    n.vy = Math.max(-30, n.vy - GRAVITY * dt);
    let ny = n.y + n.vy * dt;
    if (this._solid(n.x, ny, n.z)) {
      if (n.vy < 0) {
        ny = (Math.floor((ny + EPS) / VOXEL_SIZE) + 1) * VOXEL_SIZE;
        if (this._solid(n.x, ny, n.z)) ny = n.y;
      } else ny = n.y;
      n.vy = 0;
    }
    n.y = ny;
    // Denize/boşluğa düştüyse yeniden doğur
    if (n.y < -3) { this._remove(n); this.respawnQueue.push(1); return; }

    // Görünüm
    const sw = moving ? Math.sin(n.cycle) * 0.7 : 0;
    n.lLeg.rotation.x = sw; n.rLeg.rotation.x = -sw;
    n.lArm.rotation.x = -sw * 0.8; n.rArm.rotation.x = sw * 0.8;
    n.group.position.set(n.x, n.y, n.z);
    n.group.rotation.y = n.heading;
  }

  _tryMove(n, dx, dz) {
    if (dx === 0 && dz === 0) return;
    const nx = n.x + dx, nz = n.z + dz;
    if (!this._solid(nx, n.y, nz)) { n.x = nx; n.z = nz; return; }
    // Bir basamağa (en fazla 0.5 m) çık
    for (let h = VOXEL_SIZE; h <= STEP_UP_MAX + EPS; h += VOXEL_SIZE) {
      if (!this._solid(n.x, n.y + h, n.z) && !this._solid(nx, n.y + h, nz)) {
        n.x = nx; n.z = nz; n.y += h; return;
      }
    }
    n.heading += (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random());
  }

  // ── Vurma ──
  // Küre içindeki NPC'leri öldürür (patlama, kılıç, çekiç). Öldürülen sayısını döndürür.
  hitSphere(center, radius) {
    let killed = 0;
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      const cy = n.y + HEIGHT / 2;
      const d = Math.hypot(n.x - center.x, cy - center.y, n.z - center.z);
      if (d <= radius + HIT_RADIUS) { this._kill(n, center); killed++; }
    }
    return killed;
  }

  // Işın (minigun mermisi) en yakın NPC'ye çarpar mı? { dist, point, npc } ya da null
  rayHit(origin, dir, maxDist) {
    let best = null;
    for (const n of this.npcs) {
      const c = new THREE.Vector3(n.x, n.y + HEIGHT / 2, n.z);
      const to = c.clone().sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > maxDist) continue;
      const closest = origin.clone().addScaledVector(dir, along);
      const lateral = closest.distanceTo(c);
      // Gövde yüksekliğine göre uzun bir kapsül gibi: yatay mesafe + dikey tolerans
      const vert = Math.abs(closest.y - c.y);
      const horiz = Math.hypot(closest.x - c.x, closest.z - c.z);
      if (horiz <= 0.32 && vert <= HEIGHT / 2 && lateral <= 1.0) {
        if (!best || along < best.dist) best = { dist: along, point: closest, npc: n };
      }
    }
    return best;
  }

  killNpc(n, from) { this._kill(n, from); }

  _remove(n) {
    this.scene.remove(n.group);
    const i = this.npcs.indexOf(n);
    if (i >= 0) this.npcs.splice(i, 1);
  }

  _kill(n, from) {
    if (!this.npcs.includes(n)) return;
    const pos = new THREE.Vector3(n.x, n.y + 0.8, n.z);
    // Parçalara dağıl: giysi ve ten renginde küçük küpler fırlar
    const vw = this.voxelWorld;
    const parts = 9;
    for (let i = 0; i < parts; i++) {
      if (vw.dynamicDebris.length >= vw.maxDynamicDebris) break;
      const type = { color: n.colors[i % n.colors.length] };
      vw.spawnLooseVoxel(
        pos.x + (Math.random() - 0.5) * 0.3, n.y + 0.3 + Math.random() * 1.1, pos.z + (Math.random() - 0.5) * 0.3,
        type, from || pos, 0.5, 2, 90
      );
    }
    if (this.particleSystem.createSpark) this.particleSystem.createSpark(pos);
    sound.playBlockHit();
    this._remove(n);
    this.respawnQueue.push(RESPAWN_SECONDS);
    if (this.onScore) this.onScore(100, '+100 NPC VURULDU!');
  }
}
