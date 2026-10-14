import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';

// ─────────────────────────────────────────────────────────────────────────────
// NPC İNSANLAR: normal insanın İKİ KATI boyunda (3.1 m) voxel devler. Rastgele dolaşırlar; deniz, çukur kenarı veya duvara
// gelince sağa/sola dönüp yürümeye devam ederler. Patlama, kılıç, çekiç gibi şeylerle komple küplere dağılırlar.
// Mermiyle (kurşunla) vurulunca komple dağılmazlar: KAFAYA isabet kafayı parçalar (ten küpleri + kırmızı kan küpleri),
// gövdeye isabet yaralar; ceset yere yığılır ve bir süre kalır. Bir süre sonra başka yerde yenisi doğar.
// ─────────────────────────────────────────────────────────────────────────────
const NPC_COUNT = 80;
const SCALE = 2;                 // normal insanın iki katı
const HALF_W = 0.22 * SCALE;
const HEIGHT = 3.0;              // çarpışma yüksekliği (model 3.1 m): 3.5 m'lik iç mekan tavanlarına ve 3.0 m'deki tavan lambalarına sığar
const SPEED = 2.4;
const GRAVITY = 25;
const STEP_UP_MAX = 0.5;
const EPS = 1e-4;
const RESPAWN_SECONDS = 6;
const HIT_RADIUS = 0.45 * SCALE; // mermi/kılıç isabet yarıçapı (gövde etrafı)
const HEAD_FROM = 0.74;          // boyun bu oranından yukarısı kafa sayılır
const BLOOD = [0xb91c1c, 0x991b1b, 0xdc2626, 0x7f1d1d];

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
    this.residentQueue = [];   // öldürülen sakinler (villanın zengin adamı): [{ t, spec }]
    this.corpses = [];         // kurşunla vurulup yere yığılan cesetler: { group, t, dir }
    this.playerPos = new THREE.Vector3();
  }

  reset() {
    this.npcs.forEach(n => this.scene.remove(n.group));
    this.corpses.forEach(c => this.scene.remove(c.group)); this.corpses = [];
    this.npcs = [];
    this.respawnQueue = [];
    this.residentQueue = [];
    for (let i = 0; i < NPC_COUNT; i++) this._spawn();
    for (const r of this.voxelWorld.residents || []) this._spawnResident(r);
  }

  // ── Çarpışma: karakterle aynı kurallar (iki katmanlı zemin + voxeller) ──
  _solid(x, feet, z, h = HEIGHT) {
    const t = this.voxelWorld.terrain;
    if (t.solidAt(x, feet, z, HALF_W)) return true;
    if (this.voxelWorld.doors && this.voxelWorld.doors.blocks(x, feet, z, HALF_W, h)) return true;

    const S = VOXEL_SIZE, vox = this.voxelWorld.voxels;
    const ix0 = Math.floor((x - HALF_W + EPS) / S + 0.5), ix1 = Math.floor((x + HALF_W - EPS) / S + 0.5);
    const iz0 = Math.floor((z - HALF_W + EPS) / S + 0.5), iz1 = Math.floor((z + HALF_W - EPS) / S + 0.5);
    const iy0 = Math.floor((feet + EPS) / S), iy1 = Math.floor((feet + h - EPS) / S);
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

  _makeBody(rich = false) {
    const g = new THREE.Group();
    // Zengin adam: siyah takım, beyaz gömlek, gümüş saç, koyu gözlük, altın saat
    const shirt = rich ? 0x0b0d12 : pick(SHIRTS), pants = rich ? 0x0b0d12 : pick(PANTS), skin = rich ? 0xf1c27d : pick(SKINS), hair = rich ? 0xd4d4d8 : pick(HAIRS);

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
    if (rich) {
      const shirtFront = new THREE.Mesh(boxGeo(0.14, 0.4, 0.02), mat(0xffffff)); shirtFront.position.set(0, 0.98, 0.115);
      const tie = new THREE.Mesh(boxGeo(0.05, 0.3, 0.02), mat(0xb91c1c)); tie.position.set(0, 0.95, 0.126);
      const shades = new THREE.Mesh(boxGeo(0.3, 0.07, 0.02), mat(0x050505)); shades.position.set(0, 1.4, 0.175);
      const watch = new THREE.Mesh(boxGeo(0.16, 0.05, 0.16), mat(0xfacc15)); watch.position.set(0, -0.42, 0); rArm.add(watch);
      g.add(shirtFront, tie, shades);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { g, lArm, rArm, lLeg, rLeg, head, hairM, colors: [shirt, pants, skin, hair] };
  }

  // Villanın tek sakini: sınırlı bölgede (villa + teras) dolaşır; vurulursa bir dakika sonra yeniden doğar
  _spawnResident(spec) {
    const body = this._makeBody(true);
    body.g.scale.setScalar(SCALE);
    // Eşyaların içinde doğmasın: istenen noktaya en yakın boş yeri ara (0.5 m adımlı halkalar, 4 m'ye kadar)
    let sx = spec.x, sz = spec.z;
    search: for (let r = 0; r <= 4; r += 0.5) for (let a = 0; a < (r === 0 ? 1 : 16); a++) {
      const x = spec.x + Math.cos(a * Math.PI / 8) * r, z = spec.z + Math.sin(a * Math.PI / 8) * r;
      if (this._solid(x, spec.y, z) || this._solid(x + 0.5, spec.y, z) || this._solid(x - 0.5, spec.y, z) || this._solid(x, spec.y, z + 0.5) || this._solid(x, spec.y, z - 0.5)) continue;
      if (spec.bounds && (x < spec.bounds.minX || x > spec.bounds.maxX || z < spec.bounds.minZ || z > spec.bounds.maxZ)) continue;
      sx = x; sz = z; break search;
    }
    body.g.position.set(sx, spec.y, sz);
    this.scene.add(body.g);
    this.npcs.push({
      ...body, group: body.g, x: sx, y: spec.y, z: sz, vy: 0,
      heading: Math.random() * Math.PI * 2, turnTimer: 2 + Math.random() * 3, pause: 1, cycle: 0, grounded: true,
      resident: spec, bounds: spec.bounds, value: 1000
    });
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
      if (this._solid(x + 1.2, gy0, z) || this._solid(x - 1.2, gy0, z) ||
          this._solid(x, gy0, z + 1.2) || this._solid(x, gy0, z - 1.2)) continue;

      const gy = t.topYAt(x, z);
      const body = this._makeBody();
      body.g.scale.setScalar(SCALE);
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

    for (let i = this.residentQueue.length - 1; i >= 0; i--) {
      this.residentQueue[i].t -= dt;
      if (this.residentQueue[i].t <= 0) { const q = this.residentQueue.splice(i, 1)[0]; this._spawnResident(q.spec); }
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) { this.respawnQueue.splice(i, 1); this._spawn(); }
    }

    for (const n of this.npcs) this._step(n, dt);
    this._updateCorpses(dt);
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
      const ax = n.x + Math.sin(n.heading) * 0.7 * SCALE, az = n.z + Math.cos(n.heading) * 0.7 * SCALE;
      const outside = n.bounds && (ax < n.bounds.minX || ax > n.bounds.maxX || az < n.bounds.minZ || az > n.bounds.maxZ);
      const blocked = outside || !this._walkableAhead(ax, az) || this._solid(ax, n.y + 0.5, az, HEIGHT - 0.6);   // 0.5 m'ye kadar basamak sayılmaz; tavana değen baş engel sayılmaz
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
    // Yokuş aşağı yürürken zemine yapış (en fazla 0.3 m aşağıda zemin varsa oraya in)
    if (moving && n.grounded && n.vy <= 0 && this._solid(n.x, n.y - 0.3, n.z)) {
      let lo = n.y - 0.3, hi = n.y;
      for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (this._solid(n.x, mid, n.z)) lo = mid; else hi = mid; }
      n.y = hi;
    }
    n.vy = Math.max(-30, n.vy - GRAVITY * dt);
    let ny = n.y + n.vy * dt;
    n.grounded = false;
    if (this._solid(n.x, ny, n.z)) {
      if (n.vy < 0) {
        // Temas noktasına tam otur (yokuşta asılı kalma / sekme olmasın)
        let lo = ny, hi = n.y;
        for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (this._solid(n.x, mid, n.z)) lo = mid; else hi = mid; }
        ny = hi; n.grounded = true;
      } else ny = n.y;
      n.vy = 0;
    }
    n.y = ny;
    // Denize/boşluğa düştüyse yeniden doğur
    if (n.y < -3) { this._remove(n); if (n.resident) this.residentQueue.push({ t: 5, spec: n.resident }); else this.respawnQueue.push(1); return; }

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
    for (const h of [0.04, 0.08, 0.14, 0.22, 0.32, 0.42, STEP_UP_MAX]) {
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
      if (horiz <= 0.32 * SCALE && vert <= HEIGHT / 2 && lateral <= 1.0 * SCALE) {
        if (!best || along < best.dist) best = { dist: along, point: closest, npc: n, head: closest.y >= n.y + HEIGHT * HEAD_FROM };
      }
    }
    return best;
  }

  // from: kaynak noktası. opt.bullet: kurşun isabeti (komple dağılmaz); opt.head: kafaya mı; opt.point: isabet noktası
  killNpc(n, from, opt = null) { if (opt && opt.bullet) this._shoot(n, from, opt); else this._kill(n, from); }

  // Kurşun isabeti: kafaya ise kafa parçalanır (ten + kan küpleri), değilse gövde yaralanır; ceset yere yığılır
  _shoot(n, from, opt) {
    if (!this.npcs.includes(n)) return;
    const vw = this.voxelWorld, head = !!opt.head;
    const at = opt.point || new THREE.Vector3(n.x, n.y + HEIGHT * 0.5, n.z);
    const cube = (x, y, z, color, push, sc = 1.3) => { if (vw.dynamicDebris.length < vw.maxDynamicDebris) vw.spawnLooseVoxel(x, y, z, { color }, from || at, 0.5, 2, 70, push, sc); };
    if (head) {
      const hp = new THREE.Vector3(n.x, n.y + HEIGHT * 0.86, n.z);
      for (let i = 0; i < 8; i++) cube(hp.x + (Math.random() - 0.5) * 0.5, hp.y + (Math.random() - 0.5) * 0.5, hp.z + (Math.random() - 0.5) * 0.5, n.colors[2], null, 1.5);   // kafa parçaları (ten)
      for (let i = 0; i < 3; i++) cube(hp.x, hp.y + 0.1, hp.z, n.colors[3], null, 1.3);                                                                                   // saç
      for (let i = 0; i < 16; i++) cube(hp.x + (Math.random() - 0.5) * 0.4, hp.y + (Math.random() - 0.5) * 0.5, hp.z + (Math.random() - 0.5) * 0.4, BLOOD[i % BLOOD.length], null, 0.9);   // kan (kırmızı küpler)
      n.head.visible = false; n.hairM.visible = false;
      // boyun kütüğünde kırmızı kan: kafanın yerine kırmızı bir küp
      const stump = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), mat(BLOOD[0])); stump.position.set(0, 1.2, 0); n.group.add(stump);
      if (this.onScore) this.onScore(250, '+250 KAFA ATIŞI!');
    } else {
      for (let i = 0; i < 6; i++) cube(at.x + (Math.random() - 0.5) * 0.3, at.y + (Math.random() - 0.5) * 0.3, at.z + (Math.random() - 0.5) * 0.3, BLOOD[i % BLOOD.length], null, 0.8);
      if (this.onScore) this.onScore(100, '+100 NPC VURULDU!');
    }
    if (this.particleSystem.createSpark) this.particleSystem.createSpark(at);
    sound.playBlockHit();
    this._corpse(n, from);
  }

  // Ceset: duran NPC yere yığılır (0.55 sn), 9 sn kalır, sonra kalkar; yenisi doğar
  _corpse(n, from) {
    const i = this.npcs.indexOf(n);
    if (i >= 0) this.npcs.splice(i, 1);
    const dx = from ? n.x - from.x : Math.sin(n.heading), dz = from ? n.z - from.z : Math.cos(n.heading);
    const l = Math.hypot(dx, dz) || 1;
    this.corpses.push({ group: n.group, t: 0, dx: dx / l, dz: dz / l, y: n.y });
    if (n.resident) this.residentQueue.push({ t: 60, spec: n.resident });
    else this.respawnQueue.push(RESPAWN_SECONDS);
  }

  _updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]; c.t += dt;
      const u = Math.min(1, c.t / 0.55), fall = u * u * (3 - 2 * u);
      // vurulduğu yönün tersine (arkaya) devrilir: ağırlık merkezi yer seviyesine iner
      c.group.rotation.set(0, c.group.rotation.y, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(c.dz, 0, -c.dx), fall * Math.PI / 2 * 0.98);   // kurşunun geldiği yönün tersine devrilir
      c.group.quaternion.premultiply(q);
      c.group.position.y = c.y + fall * 0.25;
      if (c.t > 9) { this.scene.remove(c.group); this.corpses.splice(i, 1); }
    }
  }

  _remove(n) {
    this.scene.remove(n.group);
    const i = this.npcs.indexOf(n);
    if (i >= 0) this.npcs.splice(i, 1);
  }

  _kill(n, from) {
    if (!this.npcs.includes(n)) return;
    const pos = new THREE.Vector3(n.x, n.y + 0.8 * SCALE, n.z);
    // Parçalara dağıl: giysi ve ten renginde küçük küpler fırlar (komple parçalanma: patlama, kılıç, çekiç)
    const vw = this.voxelWorld;
    const parts = 16;
    for (let i = 0; i < parts; i++) {
      if (vw.dynamicDebris.length >= vw.maxDynamicDebris) break;
      const type = { color: n.colors[i % n.colors.length] };
      vw.spawnLooseVoxel(
        pos.x + (Math.random() - 0.5) * 0.6, n.y + 0.5 + Math.random() * 2.2, pos.z + (Math.random() - 0.5) * 0.6,
        i % 4 === 3 ? { color: BLOOD[i % BLOOD.length] } : type, from || pos, 0.5, 2, 90, null, 1.4
      );
    }
    if (this.particleSystem.createSpark) this.particleSystem.createSpark(pos);
    sound.playBlockHit();
    this._remove(n);
    if (n.resident) this.residentQueue.push({ t: 60, spec: n.resident });
    else this.respawnQueue.push(RESPAWN_SECONDS);
    if (this.onScore) this.onScore(n.value || 100, n.resident ? '+1000 ZENGİN ADAM VURULDU!' : '+100 NPC VURULDU!');
  }
}
