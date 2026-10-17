import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';
import { insideVillaWalls } from './villa.js';
import { DogManager } from './animals.js';

// ─────────────────────────────────────────────────────────────────────────────
// NPC İNSANLAR: normal insanın bir buçuk katı boyunda (2.5 m) voxel devler. Rastgele dolaşırlar; deniz, çukur kenarı veya duvara
// gelince sağa/sola dönüp yürümeye devam ederler. Patlama, kılıç, çekiç gibi şeylerle komple küplere dağılırlar.
// Mermiyle (kurşunla) vurulunca komple dağılmazlar: KAFAYA isabet kafayı parçalar (ten küpleri + kırmızı kan küpleri),
// gövdeye isabet yaralar; ceset yere yığılır ve bir süre kalır. Bir süre sonra başka yerde yenisi doğar.
// ─────────────────────────────────────────────────────────────────────────────
const NPC_COUNT = 80;
const SCALE = 1.6;               // normal insandan bir buçuk kat büyük
const HALF_W = 0.22 * SCALE;
const HEIGHT = 2.5;              // çarpışma yüksekliği (model 2.5 m): 3.5 m'lik iç mekan tavanlarına ve 3.0 m'deki tavan lambalarına sığar
const SPEED = 2.4;
const GRAVITY = 25;
const STEP_UP_MAX = 0.5;
const EPS = 1e-4;
const RESPAWN_SECONDS = 6;
const CULL_DIST = 120;           // bu mesafeden uzaktaki NPC'ler görünmez (çizim maliyeti)
const HIT_RADIUS = 0.45 * SCALE; // mermi/kılıç isabet yarıçapı (gövde etrafı)
const HEAD_FROM = 0.74;          // boyun bu oranından yukarısı kafa sayılır
const BAG_COLORS = [0xdc2626, 0x2563eb, 0xf59e0b, 0x16a34a, 0xe879f9, 0xf3f4f6, 0x111827, 0xfacc15, 0x0891b2];
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
    this.dogs = new DogManager(scene);   // tasmalı ve serbest köpekler
    this.day = () => 1;        // gündüz miktarı 0..1 (main.js gece-gündüz döngüsüne bağlar); villa sahibi geceleri uyur
  }

  reset() {
    this.npcs.forEach(n => this.scene.remove(n.group));
    this.corpses.forEach(c => this.scene.remove(c.group)); this.corpses = [];
    this.npcs = [];
    this.respawnQueue = [];
    this.residentQueue = [];
    this._nightCommuteActive = false;
    this.dogs.clear();
    for (const d of this.voxelWorld.dogs || []) this.dogs.addFree(d.x, d.y, d.z, d.bounds);   // köpek parkındaki serbest köpekler
    for (let i = 0; i < NPC_COUNT; i++) this._spawn();
    for (const r of this.voxelWorld.residents || []) this._spawnResident(r);
    for (const w of this.voxelWorld.workers || []) this._spawnWorker(w);     // şirket kuleleri, banka, restoran çalışanları
    for (const b of this.voxelWorld.bosses || []) this._spawnBoss(b);       // kulelerin patronları
    for (const g of this.voxelWorld.guards || []) { if (g.route) this._spawnBoss(g); else this._spawnWorker(g); }   // villa güvenlikleri: nöbetçiler ve devriyeler
  }

  // ── Çarpışma: karakterle aynı kurallar (iki katmanlı zemin + voxeller) ──
  _solid(x, feet, z, h = HEIGHT) {
    const t = this.voxelWorld.terrain;
    if (t.solidAt(x, feet, z, HALF_W)) return true;
    if (this.voxelWorld.doors && this.voxelWorld.doors.blocks(x, feet, z, HALF_W, h, true)) return true;

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

  // o: { shirt (hex), hat: 'cap' | 'chef', hatColor, bag (hex: elde alışveriş poşeti) }
  _makeBody(rich = false, style = null, o = {}) {
    const g = new THREE.Group();
    // Zengin adam / patron: siyah takım, beyaz gömlek, gümüş saç, koyu gözlük, altın saat
    // Çalışan tarzları: office (beyaz/açık mavi gömlek, koyu pantolon), bank (mavi yelek), chef (beyaz önlük + aşçı şapkası)
    const OFFICE = [0xffffff, 0xbfdbfe, 0xe5e7eb, 0xfde68a], DARK = [0x1f2937, 0x374151, 0x111827];
    const shirt = rich ? 0x0b0d12 : o.shirt != null ? o.shirt : style === 'maid' ? 0x1f2937 : style === 'guard' ? 0x1e3a8a : style === 'office' ? pick(OFFICE) : style === 'bank' ? 0x1d4ed8 : style === 'chef' ? 0xffffff : pick(SHIRTS);
    const pants = rich ? 0x0b0d12 : style === 'maid' ? 0x1f2937 : style === 'guard' ? 0x0f172a : style ? pick(DARK) : pick(PANTS);
    const skin = rich ? 0xf1c27d : pick(SKINS), hair = rich ? 0xd4d4d8 : pick(HAIRS);

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
    if (o.hat === 'chef' || style === 'chef') { const hat = new THREE.Mesh(boxGeo(0.34, 0.3, 0.34), mat(0xffffff)); hat.position.y = 1.78; g.add(hat); }
    else if (o.hat === 'cap') {                                  // beyzbol şapkası (dükkânın rengi)
      const hc = o.hatColor ?? shirt;
      const cap = new THREE.Mesh(boxGeo(0.38, 0.11, 0.38), mat(hc)); cap.position.y = 1.65; g.add(cap);
      const brim = new THREE.Mesh(boxGeo(0.3, 0.03, 0.14), mat(hc)); brim.position.set(0, 1.59, 0.25); g.add(brim);
    }
    if (o.skate) for (const leg of [lLeg, rLeg]) {              // paten: bot + bıçak
      const blade = new THREE.Mesh(boxGeo(0.07, 0.05, 0.3), mat(0x9ca3af)); blade.position.set(0, -0.6, 0.03); leg.add(blade);
      const boot = new THREE.Mesh(boxGeo(0.14, 0.1, 0.24), mat(0xf3f4f6)); boot.position.set(0, -0.53, 0.03); leg.add(boot);
    }
    if (o.bag != null) {                                         // alışveriş poşeti: sağ elde sarkar
      const bag = new THREE.Mesh(boxGeo(0.22, 0.28, 0.1), mat(o.bag)); bag.position.set(0.02, -0.62, 0.1); rArm.add(bag);
      const handle = new THREE.Mesh(boxGeo(0.1, 0.05, 0.02), mat(0x2a2a30)); handle.position.set(0.02, -0.46, 0.1); rArm.add(handle);
    }
    if (style === 'maid') {                                      // hizmetçi: koyu elbise, beyaz önlük, beyaz bone
      const apron = new THREE.Mesh(boxGeo(0.34, 0.46, 0.02), mat(0xffffff)); apron.position.set(0, 0.92, 0.12); g.add(apron);
      const cap = new THREE.Mesh(boxGeo(0.38, 0.08, 0.38), mat(0xffffff)); cap.position.y = 1.62; g.add(cap);
    }
    if (style === 'guard') {                                     // güvenlik: lacivert üniforma, siyah kasket + altın rozet, telsiz, sarı kol bandı (zengin adamdan ayırt edilsin)
      const cap = new THREE.Mesh(boxGeo(0.39, 0.12, 0.39), mat(0x0b0d12)); cap.position.y = 1.64; g.add(cap);
      const brim = new THREE.Mesh(boxGeo(0.32, 0.03, 0.12), mat(0x0b0d12)); brim.position.set(0, 1.58, 0.24); g.add(brim);
      const badge = new THREE.Mesh(boxGeo(0.08, 0.08, 0.02), mat(0xfacc15)); badge.position.set(0.14, 1.0, 0.126); g.add(badge);
      const radio = new THREE.Mesh(boxGeo(0.06, 0.12, 0.05), mat(0x111827)); radio.position.set(-0.14, 1.02, 0.13); g.add(radio);
      const band = new THREE.Mesh(boxGeo(0.17, 0.1, 0.17), mat(0xfacc15)); band.position.set(0, -0.12, 0); lArm.add(band);
    }
    let briefcase = null;
    if (style === 'bank' || style === 'office') {
      const tie = new THREE.Mesh(boxGeo(0.05, 0.3, 0.02), mat(style === 'bank' ? 0xfacc15 : 0x1d4ed8));
      tie.position.set(0, 0.95, 0.126); g.add(tie);
      // Kahverengi şirket çantası (gece mesai bitiminde binayı sakince boşaltırken ellerinde taşırlar)
      briefcase = new THREE.Group();
      const bBody = new THREE.Mesh(boxGeo(0.075, 0.24, 0.34), mat(0x6b3e1b));
      const bHandle = new THREE.Mesh(boxGeo(0.035, 0.06, 0.12), mat(0x3e220d));
      bHandle.position.set(0, 0.14, 0);
      const clasp1 = new THREE.Mesh(boxGeo(0.085, 0.035, 0.035), mat(0xfacc15));
      clasp1.position.set(0, 0.09, -0.09);
      const clasp2 = clasp1.clone(); clasp2.position.z = 0.09;
      briefcase.add(bBody, bHandle, clasp1, clasp2);
      briefcase.position.set(0.04, -0.64, 0.02);
      briefcase.visible = false;
      rArm.add(briefcase);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { g, lArm, rArm, lLeg, rLeg, head, hairM, briefcase, colors: [shirt, pants, skin, hair] };
  }

  // Çalışan (masasında oturan ya da tezgâhta ayakta duran): bina hasar alınca veya gece olunca sandalyesinden kalkıp binayı boşaltır
  // spec: { x, y, z, yaw, pose: 'sit' | 'stand', style, buildingId, doorPos, exitPath }
  _spawnWorker(spec) {
    const k = spec.k || 1, body = this._makeBody(false, spec.style || 'office', spec);
    body.g.scale.setScalar(SCALE * k);
    const sit = spec.pose === 'sit', drop = sit ? Math.max(0, 0.62 * SCALE * k - 0.5) : 0;
    if (sit) { body.lLeg.rotation.x = -Math.PI / 2; body.rLeg.rotation.x = -Math.PI / 2; body.lArm.rotation.x = -1.2; body.rArm.rotation.x = -1.2; }   // bacaklar ileri, kollar klavyede
    body.g.position.set(spec.x, spec.y - drop, spec.z); body.g.rotation.y = spec.yaw;
    this.scene.add(body.g);
    this.npcs.push({
      ...body, group: body.g, x: spec.x, y: spec.y, z: spec.z, vy: 0, heading: spec.yaw, turnTimer: 0, pause: 0, cycle: Math.random() * 6, grounded: true,
      worker: true, sit, drop, k, eat: !!spec.eat, cook: !!spec.cook, cycleOff: Math.random() * 6,
      buildingId: spec.buildingId || null,
      doorPos: spec.doorPos || null,
      exitPath: spec.exitPath ? spec.exitPath.map(p => ({ ...p })) : null,
      homeDesk: { x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw, sit, drop },
      evacPhase: null, evacMode: null,
      respawn: () => this._spawnWorker(spec), value: 100
    });
  }

  // Patron: siyah takımlı dev; rotada (yukarıdan aşağıya, sonra tersine) sürekli gezer. spec: { route: [{x,y,z}], name }
  _spawnBoss(spec) {
    const body = spec.style ? this._makeBody(false, spec.style) : this._makeBody(true);      // style: 'guard' → devriye güvenliği; yoksa patron
    body.g.scale.setScalar(SCALE);
    const p0 = spec.route[0];
    body.g.position.set(p0.x, p0.y, p0.z);
    this.scene.add(body.g);
    this.npcs.push({
      ...body, group: body.g, x: p0.x, y: p0.y, z: p0.z, vy: 0, heading: 0, turnTimer: 0, pause: 0, cycle: 0, grounded: true,
      route: spec.route, ri: 0, rdir: 1, stuckT: 0, lastX: p0.x, lastZ: p0.z,
      buildingId: spec.buildingId || null, doorPos: spec.doorPos || null,
      respawn: () => this._spawnBoss(spec), value: spec.style === 'guard' ? 300 : 500, boss: !spec.style, guard: spec.style === 'guard'
    });
  }

  // Şirket binası hasar aldığında (panic=true) veya gece olduğunda (panic=false) yalnız o binadaki çalışanları tahliye eder
  evacuateBuilding(buildingId, panic = true) {
    if (!buildingId) return;
    // Evlerin/apartmanların bulunduğu hedef noktalar (kaçan veya evine dönen çalışanlar buralara yönelir)
    const houseTargets = [
      { x: -106, z: 18 }, { x: -106, z: -18 }, { x: -58, z: 14 },
      { x: -106, z: 64 }, { x: -106, z: -64 }, { x: -28, z: 18 },
      { x: -28, z: -18 }, { x: -80, z: 112 }, { x: -80, z: -112 }
    ];
    for (const n of this.npcs) {
      if (n.buildingId !== buildingId) continue;
      if (n.boss) {
        if (panic && n.doorPos && !n.evacPhase) {
          n.worker = true; n.sit = false; n.drop = 0;
          n.evacMode = 'panic'; n.evacPhase = 'stairs'; n.exitIdx = 0;
          n.evacSpeed = 4.6;
          n.exitPath = [
            { x: n.doorPos.chokeX, y: 0.5, z: n.doorPos.chokeZ, choke: true, tol: 0.5 },
            { x: n.doorPos.x, y: 0.5, z: n.doorPos.z, door: true, tol: 0.5 },
            { x: n.doorPos.x + n.doorPos.outX * 2.5, y: 0.5, z: n.doorPos.z + n.doorPos.outZ * 2.5, outside: true, tol: 0.8 }
          ];
          n.houseTarget = houseTargets[Math.floor(Math.random() * houseTargets.length)];
        }
        continue;
      }
      if (!n.worker) continue;
      // Zaten gece sakin tahliyedeyken bina hasar alırsa aniden panik koşusuna geçer!
      if (n.evacPhase) {
        if (panic && n.evacMode !== 'panic') {
          n.evacMode = 'panic';
          n.evacSpeed = 4.5 + Math.random() * 1.1;
          if (n.briefcase) n.briefcase.visible = false;
        }
        continue;
      }
      n.evacMode = panic ? 'panic' : 'night';
      n.evacSpeed = panic ? (4.5 + Math.random() * 1.1) : (1.55 + Math.random() * 0.25);
      n.standUpT = 0;
      // Sandalyeden kalkma animasyonu süresi (panikte hızlı, gece sakin)
      n.standUpDur = n.sit ? (panic ? (0.42 + Math.random() * 0.25) : (0.85 + Math.random() * 0.6)) : 0.05;
      n.evacPhase = 'stand_up';
      n.exitIdx = 0;
      n.jamT = 0;
      n.houseTarget = houseTargets[Math.floor(Math.random() * houseTargets.length)];
      if (n.briefcase) n.briefcase.visible = !panic;
    }
  }

  // Villanın tek sakini: sınırlı bölgede (villa + teras) dolaşır; vurulursa bir dakika sonra yeniden doğar
  _spawnResident(spec) {
    const k = spec.k || 1, rich = spec.kind === 'rich', body = rich ? this._makeBody(true) : this._makeBody(false, spec.style || null, spec);   // 'rich': villa sahibi; diğerleri: AVM'de gezen müşteriler
    body.g.scale.setScalar(SCALE * k);
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
    const rec = {
      ...body, group: body.g, x: sx, y: spec.y, z: sz, vy: 0,
      heading: Math.random() * Math.PI * 2, turnTimer: 2 + Math.random() * 3, pause: 1, cycle: Math.random() * 6, grounded: true,
      resident: spec, bounds: spec.bounds, value: rich ? 1000 : 100, k, script: spec.script ? spec.script() : null,
      skate: spec.kind === 'skater', skateSpeed: 2.8 + Math.random() * 1.8
    };
    this.npcs.push(rec);
    if (spec.dog) this.dogs.addLeashed(rec, SCALE * k);
  }

  _spawn() {
    const t = this.voxelWorld.terrain;
    if (!t.bounds) return;
    const b = t.bounds;
    for (let tries = 0; tries < 200; tries++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!t.topIntactAt(x, z)) continue;
      if (insideVillaWalls(x, z, 3)) continue;                        // villa duvarının içinde yalnız sahibi ve güvenlikleri bulunur
      const gy0 = t.topYAt(x, z);
      if (this.playerPos.distanceTo(new THREE.Vector3(x, gy0, z)) < 12) continue;
      if (this._solid(x, gy0, z)) continue;
      // Çevresi açık mı (bina içinde ya da duvarın dibinde doğmasın)
      if (this._solid(x + 1.2, gy0, z) || this._solid(x - 1.2, gy0, z) ||
          this._solid(x, gy0, z + 1.2) || this._solid(x, gy0, z - 1.2)) continue;

      const gy = t.topYAt(x, z);
      const body = this._makeBody(false, null, Math.random() < 0.22 ? { bag: pick(BAG_COLORS) } : {});   // her beşinden biri elinde alışveriş poşetiyle (AVM'den çıkmış gibi)
      body.g.scale.setScalar(SCALE);
      body.g.position.set(x, gy, z);
      this.scene.add(body.g);
      const rec = {
        ...body, group: body.g, x, y: gy, z, vy: 0,
        heading: Math.random() * Math.PI * 2,
        turnTimer: 2 + Math.random() * 5, pause: 0, cycle: Math.random() * 6, grounded: true
      };
      this.npcs.push(rec);
      if (Math.random() < 0.07) this.dogs.addLeashed(rec);          // bazı yayalar köpeğini tasmayla gezdirir
      return;
    }
  }

  // ── Güncelleme ──
  update(dt, playerPos) {
    this.playerPos.copy(playerPos);

    // Gece olduğunda şirket binalarındaki çalışanlar ellerinde kahverengi şirket çantasıyla sakin bir şekilde binayı boşaltır;
    // gündüz olduğunda (bina yıkılmadıysa) masalarına geri dönerler.
    if (this.day && this.voxelWorld.officeBuildings) {
      const dayAmt = this.day();
      if (dayAmt < 0.35 && !this._nightCommuteActive) {
        this._nightCommuteActive = true;
        for (const b of this.voxelWorld.officeBuildings) {
          if (!b.evacuated) this.evacuateBuilding(b.id, false);
        }
      } else if (dayAmt > 0.55 && this._nightCommuteActive) {
        this._nightCommuteActive = false;
        const intactIds = new Set(this.voxelWorld.officeBuildings.filter(b => !b.evacuated).map(b => b.id));
        for (const n of this.npcs) {
          if (n.worker && n.evacMode === 'night' && n.homeDesk && intactIds.has(n.buildingId)) {
            n.evacPhase = null; n.evacMode = null;
            n.x = n.homeDesk.x; n.y = n.homeDesk.y; n.z = n.homeDesk.z;
            n.heading = n.homeDesk.yaw; n.sit = n.homeDesk.sit; n.drop = n.homeDesk.drop;
            if (n.briefcase) n.briefcase.visible = false;
            if (n.sit) { n.lLeg.rotation.x = -Math.PI / 2; n.rLeg.rotation.x = -Math.PI / 2; n.lArm.rotation.x = -1.2; n.rArm.rotation.x = -1.2; }
            n.group.position.set(n.x, n.y - n.drop, n.z);
            n.group.rotation.set(0, n.heading, 0);
          }
        }
      }
    }

    for (let i = this.residentQueue.length - 1; i >= 0; i--) {
      this.residentQueue[i].t -= dt;
      if (this.residentQueue[i].t <= 0) { const q = this.residentQueue.splice(i, 1)[0]; if (q.fn) q.fn(); else this._spawnResident(q.spec); }
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) { this.respawnQueue.splice(i, 1); this._spawn(); }
    }

    for (const n of this.npcs) {
      this._step(n, dt);
      const dx = n.x - playerPos.x, dy = n.y - playerPos.y, dz = n.z - playerPos.z;
      n.group.visible = dx * dx + dy * dy + dz * dz < CULL_DIST * CULL_DIST;   // uzaktaki insanlar çizilmez (yüzlerce çalışan/müşteri var)
    }
    this._updateCorpses(dt);
    this.dogs.update(dt, playerPos, new Set(this.npcs));
  }

  // Şirket çalışanının sandalyesinden kalkıp merdivenlerden inmesi, dar çıkış kapısında sıkışması ve dışarı püskürerek evlere kaçması
  _stepEvac(n, dt) {
    // 1) Sandalyeden animasyonlu kalkış
    if (n.evacPhase === 'stand_up') {
      n.standUpT += dt;
      const u = Math.min(1, n.standUpT / Math.max(0.05, n.standUpDur));
      const smooth = u * u * (3 - 2 * u);
      if (n.homeDesk && n.homeDesk.sit) {
        n.lLeg.rotation.x = -Math.PI / 2 * (1 - smooth);
        n.rLeg.rotation.x = -Math.PI / 2 * (1 - smooth);
        n.lArm.rotation.x = -1.2 * (1 - smooth);
        n.rArm.rotation.x = -1.2 * (1 - smooth);
        n.drop = n.homeDesk.drop * (1 - smooth);
        // Kalkarken gövde hafif öne eğilir ve sandalyeden yarım adım geri çekilir
        const lean = Math.sin(u * Math.PI) * 0.28;
        const back = smooth * 0.42;
        n.x = n.homeDesk.x - Math.sin(n.homeDesk.yaw) * back;
        n.z = n.homeDesk.z - Math.cos(n.homeDesk.yaw) * back;
        n.group.position.set(n.x, n.y - n.drop, n.z);
        n.group.rotation.set(lean, n.homeDesk.yaw, 0);
      }
      if (u >= 1) {
        n.sit = false;
        n.drop = 0;
        n.group.rotation.set(0, n.heading, 0);
        n.evacPhase = (n.exitPath && n.exitPath.length > 0) ? 'stairs' : 'burst';
        n.exitIdx = 0;
      }
      return;
    }

    const panic = n.evacMode === 'panic';
    const spd = n.evacSpeed || (panic ? 4.8 : 1.65);

    // 2) Kat koridoru -> Merdivenlerden iniş -> Dar çıkış kapısında sıkışma
    if (n.evacPhase === 'stairs') {
      const path = n.exitPath;
      if (!path || n.exitIdx >= path.length) {
        n.evacPhase = 'burst';
      } else {
        const wp = path[n.exitIdx];
        const dx = wp.x - n.x, dz = wp.z - n.z;
        const dist = Math.hypot(dx, dz);

        // Dar merdiven çıkış kapısında sıkışma (choke / door noktalarında kalabalık birikir ve itişir)
        let speedMul = 1.0;
        if (panic && (wp.choke || wp.door) && n.y < 1.8) {
          let crowd = 0, pushX = 0, pushZ = 0;
          for (const o of this.npcs) {
            if (o === n || o.buildingId !== n.buildingId || o.evacPhase !== 'stairs' || o.y > 1.8) continue;
            const odx = n.x - o.x, odz = n.z - o.z;
            const od2 = odx * odx + odz * odz;
            if (od2 < 1.15 && od2 > 1e-4) {
              crowd++;
              const inv = 1 / Math.sqrt(od2);
              pushX += odx * inv * 0.45;
              pushZ += odz * inv * 0.45;
            }
          }
          if (crowd > 0) {
            n.jamT = (n.jamT || 0) + dt;
            // Kapı dar olduğu için ilk ~1.1 sn orada sıkışıp itişirler, sonra sırayla dışarı fırlarlar
            if (n.jamT < 1.15) {
              speedMul = Math.max(0.18, 1.0 - crowd * 0.24);
              n.x += pushX * dt;
              n.z += pushZ * dt;
            } else {
              speedMul = 1.25;
            }
          }
        }

        const step = spd * speedMul * dt;
        if (dist <= Math.max(wp.tol || 0.48, step * 1.2)) {
          n.x = wp.x; n.z = wp.z; n.y = wp.y;
          n.exitIdx++;
          if (wp.outside || n.exitIdx >= path.length) {
            n.evacPhase = 'burst';
            const outYaw = n.doorPos ? Math.atan2(n.doorPos.outX, n.doorPos.outZ) : n.heading;
            // Kapıdan çıkınca püskürmek gibi yelpaze şeklinde her yöne dağılarak kaçmaya başlarlar!
            n.heading = outYaw + (Math.random() - 0.5) * (panic ? 2.35 : 1.1);
            n.burstT = panic ? (1.6 + Math.random() * 1.4) : 0.8;
          }
        } else {
          const dirX = dx / dist, dirZ = dz / dist;
          n.x += dirX * step;
          n.z += dirZ * step;
          // Merdiven basamaklarında yüksekliği (y) yumuşakça indir
          n.y += (wp.y - n.y) * Math.min(1, ( step / Math.max(0.2, dist) ) * 1.35);
          const wantYaw = Math.atan2(dirX, dirZ);
          n.heading += Math.atan2(Math.sin(wantYaw - n.heading), Math.cos(wantYaw - n.heading)) * Math.min(1, dt * 12);
        }
      }
    }

    // 3) Kapıdan dışarı püskürme ve evlere doğru koşma / yürüme
    if (n.evacPhase === 'burst' || n.evacPhase === 'flee_to_house') {
      if (n.evacPhase === 'burst') {
        n.burstT -= dt;
        if (n.burstT <= 0) n.evacPhase = 'flee_to_house';
      } else if (n.houseTarget) {
        const hdx = n.houseTarget.x - n.x, hdz = n.houseTarget.z - n.z;
        const hdist = Math.hypot(hdx, hdz);
        if (hdist < 4.0) {
          // Eve ulaştı: etraftaki başka bir ev bloğuna yönel
          n.heading += (Math.random() - 0.5) * 2.2;
          n.houseTarget = { x: n.x + Math.sin(n.heading) * 35, z: n.z + Math.cos(n.heading) * 35 };
        } else {
          const wantYaw = Math.atan2(hdx, hdz);
          n.heading += Math.atan2(Math.sin(wantYaw - n.heading), Math.cos(wantYaw - n.heading)) * Math.min(1, dt * 3.5);
        }
      }

      const moveSpd = (n.evacPhase === 'burst' && panic) ? spd * 1.25 : spd;
      const dx = Math.sin(n.heading) * moveSpd * dt, dz = Math.cos(n.heading) * moveSpd * dt;
      const ax = n.x + Math.sin(n.heading) * 0.8 * SCALE, az = n.z + Math.cos(n.heading) * 0.8 * SCALE;
      if (!this._walkableAhead(ax, az) || this._solid(ax, n.y + 0.5, az, HEIGHT - 0.6)) {
        n.heading += (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.9);
      } else {
        this._tryMove(n, dx, 0);
        this._tryMove(n, 0, dz);
      }
      const gy = this.voxelWorld.terrain.topYAt(n.x, n.z);
      if (gy > -Infinity && Math.abs(n.y - gy) < 1.5) n.y = gy;
    }

    // Yürüme / panik koşma kol ve bacak animasyonu
    n.cycle += dt * (panic ? 16 : 8);
    const sw = Math.sin(n.cycle) * (panic ? 1.05 : 0.65);
    n.lLeg.rotation.x = sw;
    n.rLeg.rotation.x = -sw;
    if (panic) {
      // Panikle koşarken kollar hızlı ve telaşlı sallanır
      n.lArm.rotation.x = -0.35 - sw * 1.05;
      n.rArm.rotation.x = -0.35 + sw * 1.05;
    } else {
      // Gece elinde kahverengi şirket çantasıyla sakin yürüyüş
      n.lArm.rotation.x = -sw * 0.7;
      n.rArm.rotation.x = -0.12 + sw * 0.22;
    }
    n.group.position.set(n.x, n.y, n.z);
    n.group.rotation.set(panic ? 0.10 : 0, n.heading, 0);
  }

  _step(n, dt) {
    // Ahtapot koluyla havada tutulan insan: çırpınır, normal yürüme/yerçekimi devre dışıdır
    if (n.grabbed) {
      n.cycle += dt * 18;
      const flail = Math.sin(n.cycle) * 1.15;
      n.lLeg.rotation.x = flail; n.rLeg.rotation.x = -flail;
      n.lArm.rotation.x = -2.2 + flail * 0.5; n.rArm.rotation.x = -2.2 - flail * 0.5;
      n.group.position.set(n.x, n.y, n.z);
      n.group.rotation.set(Math.sin(n.cycle * 0.5) * 0.25, n.heading, Math.cos(n.cycle * 0.5) * 0.2);
      return;
    }
    // Ahtapot koluyla fırlatılan insan: havada takla atarak uçar, yere veya binaya çarpınca parçalanır
    if (n.thrownVel) {
      n.thrownVel.y -= GRAVITY * dt;
      n.x += n.thrownVel.x * dt;
      n.y += n.thrownVel.y * dt;
      n.z += n.thrownVel.z * dt;
      n.cycle += dt * 16;
      n.group.position.set(n.x, n.y, n.z);
      n.group.rotation.set(n.cycle, n.heading, n.cycle * 0.7);
      const gy = this.voxelWorld.terrain.topYAt(n.x, n.z);
      if (this._solid(n.x, n.y, n.z) || (gy > -Infinity && n.y <= gy + 0.1) || n.y < -2) {
        const hitPos = new THREE.Vector3(n.x, n.y + 1.0, n.z);
        this.voxelWorld.sweepCut(hitPos, 0.9, n.thrownVel);
        n.thrownVel = null;
        this._kill(n, hitPos);
      }
      return;
    }
    if (n.script) n.script.update(n, dt, this);                        // villa sahibinin günlük rutini (yemek, merdiven, uyku)
    if (n.frozen) { this._posePose(n, dt); return; }                   // oturan/yatan: fizik ve yürüme yok
    if (n.skate) { this._stepSkate(n, dt); return; }                   // buz pistinde patenle kayar
    if (n.worker) {                                                    // çalışan: tahliyedeyse merdivenden inip kaçar, değilse yerinde çalışır
      if (n.evacPhase) { this._stepEvac(n, dt); return; }
      n.cycle += dt * (n.sit ? 7 : 1.5);
      if (n.cook) { n.lArm.rotation.x = -0.9 + Math.sin(n.cycle * 1.1) * 0.45; n.rArm.rotation.x = -0.9 - Math.sin(n.cycle * 1.1 + 1.6) * 0.45; n.group.rotation.y = n.heading + Math.sin(n.cycle * 0.8) * 0.15; }   // mutfak tezgâhında kesip karıştırır
      else if (n.eat) { n.lArm.rotation.x = -1.1; n.rArm.rotation.x = -1.3 - 1.1 * Math.max(0, Math.sin(n.cycle * 0.3 + n.cycleOff)); }   // yemek yer: sağ elini ağzına götürür
      else if (n.sit) { n.lArm.rotation.x = -1.15 + Math.sin(n.cycle) * 0.12; n.rArm.rotation.x = -1.15 + Math.sin(n.cycle + 2) * 0.12; }
      else { n.lArm.rotation.x = Math.sin(n.cycle) * 0.08; n.rArm.rotation.x = -Math.sin(n.cycle) * 0.08; }
      return;
    }
    if (n.route) this._steerRoute(n, dt);
    else if (n.pause > 0) {
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
      const blocked = !n.route && (outside || !this._walkableAhead(ax, az) || this._solid(ax, n.y + 0.5, az, HEIGHT - 0.6));   // 0.5 m'ye kadar basamak sayılmaz; tavana değen baş engel sayılmaz
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
    if (n.y < -3) { this._remove(n); if (n.respawn) this.residentQueue.push({ t: 5, fn: n.respawn }); else if (n.resident) this.residentQueue.push({ t: 5, spec: n.resident }); else this.respawnQueue.push(1); return; }

    // Görünüm
    const sw = moving ? Math.sin(n.cycle) * 0.7 : 0;
    n.lLeg.rotation.x = sw; n.rLeg.rotation.x = -sw;
    n.lArm.rotation.x = -sw * 0.8; n.rArm.rotation.x = sw * 0.8;
    n.group.position.set(n.x, n.y, n.z);
    n.group.rotation.y = n.heading;
  }

  // Buz pisti: yumuşak yay çizerek kayar, kenara yaklaşınca merkeze döner; bacaklar kayma vuruşu yapar, gövde hafif eğilir
  _stepSkate(n, dt) {
    const b = n.bounds, m = 2.6, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    n.cycle += dt * 2.4;
    n.turnV = Math.max(-1.1, Math.min(1.1, (n.turnV || 0) + (Math.random() - 0.5) * dt * 4));
    if (n.x < b.minX + m || n.x > b.maxX - m || n.z < b.minZ + m || n.z > b.maxZ - m) n.heading += wrap(Math.atan2((b.minX + b.maxX) / 2 - n.x, (b.minZ + b.maxZ) / 2 - n.z) - n.heading) * Math.min(1, dt * 3);
    else n.heading += n.turnV * dt;
    n.x = Math.max(b.minX + 0.5, Math.min(b.maxX - 0.5, n.x + Math.sin(n.heading) * n.skateSpeed * dt));
    n.z = Math.max(b.minZ + 0.5, Math.min(b.maxZ - 0.5, n.z + Math.cos(n.heading) * n.skateSpeed * dt));
    n.lLeg.rotation.x = Math.sin(n.cycle) * 0.55; n.rLeg.rotation.x = -Math.sin(n.cycle) * 0.55;
    n.lArm.rotation.x = -Math.sin(n.cycle) * 0.5; n.rArm.rotation.x = Math.sin(n.cycle) * 0.5;
    n.group.position.set(n.x, n.y, n.z); n.group.rotation.set(0.12, n.heading, Math.sin(n.cycle) * 0.06, 'YXZ');
  }

  // ── Betik yardımcıları (villa sahibi) ──
  // Tek seferlik yol: pts [{x,y,z,tol?}] sırayla yürünür; bitince n.route null olur
  walkPath(n, pts) { n.route = pts; n.ri = 0; n.rdir = 1; n.once = true; n.stuckT = 0; n.lastX = n.x; n.lastZ = n.z; n.pause = 0; }
  // Oturur (sandalyede): yürüme/fizik durur; yemek yiyorsa sağ el ağza gider
  sit(n, x, y, z, yaw, eat = false) {
    n.frozen = 'sit'; n.route = null; n.once = false; n.x = x; n.y = y; n.z = z; n.heading = yaw; n.eatAnim = eat; n.vy = 0;
    const k = n.k || 1, drop = Math.max(0, 0.62 * SCALE * k - 0.5);
    n.group.position.set(x, y - drop, z); n.group.rotation.set(0, yaw, 0);
    n.lLeg.rotation.x = -Math.PI / 2; n.rLeg.rotation.x = -Math.PI / 2; n.lArm.rotation.x = -1.1; n.rArm.rotation.x = -1.2;
  }
  // Yatar (sırtüstü): headYaw = başın bakacağı yön (dünya yaw'ı); (x,z) gövdenin ortası, y yatağın üst yüzeyi
  lie(n, x, y, z, headYaw) {
    n.frozen = 'lie'; n.route = null; n.once = false; n.vy = 0;
    const L = HEIGHT * (n.k || 1), hx = -Math.sin(headYaw), hz = -Math.cos(headYaw);        // yaw'ı headYaw olan, X etrafında −90° dönmüş gövdenin başı (−sin, −cos) yönündedir
    n.x = x; n.z = z; n.y = y; n.lie = true;
    n.group.position.set(x - hx * L * 0.5, y + 0.2, z - hz * L * 0.5);
    n.group.rotation.set(-Math.PI / 2, headYaw, 0, 'YXZ');
    n.lLeg.rotation.x = 0; n.rLeg.rotation.x = 0; n.lArm.rotation.x = 0.1; n.rArm.rotation.x = 0.1;
  }
  stand(n, x, y, z) {
    n.frozen = null; n.lie = false; n.eatAnim = false; n.x = x; n.y = y; n.z = z; n.vy = 0; n.pause = 0;
    n.group.rotation.set(0, n.heading, 0); n.group.position.set(x, y, z);
  }
  _posePose(n, dt) {
    n.cycle += dt;
    if (n.frozen === 'sit' && n.eatAnim) n.rArm.rotation.x = -1.3 - 1.1 * Math.max(0, Math.sin(n.cycle * 1.4));   // çatalı ağza götürür
    if (n.frozen === 'lie') { n.lArm.rotation.x = 0.1 + Math.sin(n.cycle * 0.8) * 0.02; }                          // hafif nefes
  }

  // Patron rotası: sıradaki noktaya yürür; varınca sıradakine (uçlarda yön değişir); 3 sn ilerleyemezse noktayı atlar
  _steerRoute(n, dt) {
    const t = n.route[n.ri];
    const dx = t.x - n.x, dz = t.z - n.z, dist = Math.hypot(dx, dz);
    if (dist < (t.tol || 0.9) && Math.abs(t.y - n.y) < 1.6) {
      n.ri += n.rdir;
      if (n.once && n.ri >= n.route.length) { n.route = null; n.once = false; n.stuckT = 0; return; }       // tek seferlik yol bitti
      if (n.ri >= n.route.length || n.ri < 0) { n.rdir = -n.rdir; n.ri += 2 * n.rdir; }
      n.stuckT = 0; return;
    }
    const want = Math.atan2(dx, dz), err = Math.atan2(Math.sin(want - n.heading), Math.cos(want - n.heading));
    n.heading += err * Math.min(1, dt * 10);
    n.pause = Math.abs(err) > 0.6 ? 1 : 0;       // keskin dönüşte yerinde dön (merdiven şeridinden taşmasın)
    n.stuckT += dt;
    if (n.stuckT > 1) { if (Math.hypot(n.x - n.lastX, n.z - n.lastZ) < 0.3) { if (n.stuckT > 4) { n.ri += n.rdir; if (n.once && n.ri >= n.route.length) { n.route = null; n.once = false; } else if (n.ri >= n.route.length || n.ri < 0) { n.rdir = -n.rdir; n.ri += 2 * n.rdir; } n.stuckT = 0; } } else { n.stuckT = 0; n.lastX = n.x; n.lastZ = n.z; } }
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

  // Işın (minigun mermisi veya ahtapot kolu) en yakın NPC'ye çarpar mı? { dist, point, npc } ya da null
  rayHit(origin, dir, maxDist, extraRadius = 0) {
    let best = null;
    for (const n of this.npcs) {
      if (n.lie) { const cc = new THREE.Vector3(n.x, n.y + 0.5, n.z), tt = cc.clone().sub(origin), al = tt.dot(dir); if (al > 0 && al < maxDist) { const cl = origin.clone().addScaledVector(dir, al); if (cl.distanceTo(cc) < 1.3 + extraRadius && (!best || al < best.dist)) best = { dist: al, point: cl, npc: n, head: false }; } continue; }   // yatan: gövde ortasında küre
      const k = n.k || 1, c = new THREE.Vector3(n.x, n.y - (n.drop || 0) + HEIGHT * k / 2, n.z);
      const to = c.clone().sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > maxDist) continue;
      const closest = origin.clone().addScaledVector(dir, along);
      const lateral = closest.distanceTo(c);
      // Gövde yüksekliğine göre uzun bir kapsül gibi: yatay mesafe + dikey tolerans
      const vert = Math.abs(closest.y - c.y);
      const horiz = Math.hypot(closest.x - c.x, closest.z - c.z);
      if (horiz <= 0.32 * SCALE * k + extraRadius && vert <= HEIGHT * k / 2 + extraRadius * 0.6 && lateral <= 1.0 * SCALE * k + extraRadius) {
        if (!best || along < best.dist) best = { dist: along, point: closest, npc: n, head: closest.y >= n.y - (n.drop || 0) + HEIGHT * k * HEAD_FROM };
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
      const hp = new THREE.Vector3(n.x, n.y - (n.drop || 0) + HEIGHT * (n.k || 1) * 0.86, n.z);
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
    this.corpses.push({ group: n.group, t: 0, dx: dx / l, dz: dz / l, y: n.group.position.y });
    if (n.respawn) this.residentQueue.push({ t: 60, fn: n.respawn });
    else if (n.resident) this.residentQueue.push({ t: 60, spec: n.resident });
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
    if (n.respawn) this.residentQueue.push({ t: 60, fn: n.respawn });
    else if (n.resident) this.residentQueue.push({ t: 60, spec: n.resident });
    else this.respawnQueue.push(RESPAWN_SECONDS);
    if (this.onScore) this.onScore(n.value || 100, n.resident && n.resident.kind === 'rich' ? '+1000 ZENGİN ADAM VURULDU!' : n.boss ? '+500 PATRON VURULDU!' : n.guard ? '+300 GÜVENLİK VURULDU!' : '+100 NPC VURULDU!');
  }
}
