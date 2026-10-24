import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';
import { insideVillaWalls } from './villa.js';
import { DogManager, CatManager } from './animals.js';

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
    this.cats = new CatManager(scene);   // market önündeki kediler ve mama kapları
    this.day = () => 1;        // gündüz miktarı 0..1 (main.js gece-gündüz döngüsüne bağlar); villa sahibi geceleri uyur
    this.schoolChildren = [];
    this.schoolBellTimer = 0;
    this.schoolRecess = true;
    this.soccerBall = null;
    this.ropeAngle = 0;
    this.bakkalKids = [];
    this.marketShoppers = [];
    this.carOwners = [];
  }

  reset() {
    this.npcs.forEach(n => this.scene.remove(n.group));
    this.corpses.forEach(c => this.scene.remove(c.group)); this.corpses = [];
    this.npcs = [];
    this.respawnQueue = [];
    this.residentQueue = [];
    this._nightCommuteActive = false;
    this.dogs.clear();
    this.cats.clear();
    if (this.soccerBall) { this.scene.remove(this.soccerBall); this.soccerBall = null; }
    this.schoolChildren = [];
    this.schoolBellTimer = 0;
    this.schoolRecess = true;
    this.bakkalKids = [];
    this.marketShoppers = [];
    this.carOwners = [];
    for (const d of this.voxelWorld.dogs || []) this.dogs.addFree(d.x, d.y, d.z, d.bounds);   // köpek parkındaki serbest köpekler
    for (const m of this.voxelWorld.marketCats || []) this.cats.addMarketCats(m.x, m.y, m.z); // market kedileri
    for (let i = 0; i < NPC_COUNT; i++) this._spawn();
    for (const r of this.voxelWorld.residents || []) this._spawnResident(r);
    for (const w of this.voxelWorld.workers || []) this._spawnWorker(w);     // şirket kuleleri, banka, restoran çalışanları
    for (const d of this.voxelWorld.doctors || []) this._spawnWorker(d);     // hastanedeki doktorlar ve hemşireler
    for (const s of this.voxelWorld.schoolChildren || []) this._spawnChild(s); // okul çocukları
    for (const b of this.voxelWorld.bosses || []) this._spawnBoss(b);       // kulelerin patronları
    for (const g of this.voxelWorld.guards || []) { if (g.route) this._spawnBoss(g); else this._spawnWorker(g); }   // villa güvenlikleri: nöbetçiler ve devriyeler
    for (const bk of this.voxelWorld.bakkalKids || []) this._spawnBakkalKid(bk);
    for (const ms of this.voxelWorld.marketShoppers || []) this._spawnMarketShopper(ms);
    for (const co of this.voxelWorld.carOwners || []) this._spawnCarOwner(co);
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
    const shirt = rich ? 0x0b0d12 : o.shirt != null ? o.shirt : style === 'maid' ? 0x1f2937 : style === 'guard' ? 0x1e3a8a : style === 'doctor' ? 0xf8fafc : style === 'nurse' ? 0x38bdf8 : style === 'child' ? pick([0xfacc15, 0xef4444, 0x3b82f6, 0xec4899, 0x10b981]) : style === 'office' ? pick(OFFICE) : style === 'bank' ? 0x1d4ed8 : style === 'chef' ? 0xffffff : pick(SHIRTS);
    const pants = rich ? 0x0b0d12 : style === 'maid' ? 0x1f2937 : style === 'guard' ? 0x0f172a : style === 'doctor' ? 0x0f766e : style === 'nurse' ? 0x0284c7 : style === 'child' ? pick([0x1e3a8a, 0x1e293b, 0x334155]) : style ? pick(DARK) : pick(PANTS);
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
    if (style === 'doctor') {
      const steth = new THREE.Mesh(boxGeo(0.24, 0.28, 0.03), mat(0x1e293b)); steth.position.set(0, 0.95, 0.125); g.add(steth);
      const chestPiece = new THREE.Mesh(boxGeo(0.06, 0.06, 0.02), mat(0x94a3b8)); chestPiece.position.set(0.04, 0.82, 0.135); g.add(chestPiece);
    } else if (style === 'nurse') {
      const ncap = new THREE.Mesh(boxGeo(0.28, 0.09, 0.22), mat(0xffffff)); ncap.position.set(0, 1.62, 0.06); g.add(ncap);
      const ncross = new THREE.Mesh(boxGeo(0.08, 0.08, 0.02), mat(0xef4444)); ncross.position.set(0, 1.62, 0.18); g.add(ncross);
    } else if (style === 'child') {
      const backpack = new THREE.Mesh(boxGeo(0.3, 0.38, 0.16), mat(pick([0xdc2626, 0x2563eb, 0x7c3aed, 0x059669, 0xf59e0b])));
      backpack.position.set(0, 0.95, -0.18); g.add(backpack);
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
    let shears = null, shearsBladeL = null, shearsBladeR = null;
    if (style === 'maid') {                                      // hizmetçi: koyu elbise, beyaz önlük, beyaz bone
      const apron = new THREE.Mesh(boxGeo(0.34, 0.46, 0.02), mat(0xffffff)); apron.position.set(0, 0.92, 0.12); g.add(apron);
      const cap = new THREE.Mesh(boxGeo(0.38, 0.08, 0.38), mat(0xffffff)); cap.position.y = 1.62; g.add(cap);
      // Bahçe/çalı budama makası (kontrol yapan hizmetçi çalıları keserken eline alır)
      shears = new THREE.Group();
      const pivot = new THREE.Mesh(boxGeo(0.055, 0.03, 0.055), mat(0x1f2937));
      shearsBladeL = new THREE.Group();
      const handleL = new THREE.Mesh(boxGeo(0.036, 0.032, 0.22), mat(0xdc2626)); handleL.position.set(-0.04, 0, -0.11);
      const bladeLM = new THREE.Mesh(boxGeo(0.045, 0.014, 0.34), mat(0xe2e8f0)); bladeLM.position.set(-0.015, 0.005, 0.17);
      shearsBladeL.add(handleL, bladeLM);
      shearsBladeR = new THREE.Group();
      const handleR = new THREE.Mesh(boxGeo(0.036, 0.032, 0.22), mat(0xdc2626)); handleR.position.set(0.04, 0, -0.11);
      const bladeRM = new THREE.Mesh(boxGeo(0.045, 0.014, 0.34), mat(0xcbd5e1)); bladeRM.position.set(0.015, -0.005, 0.17);
      shearsBladeR.add(handleR, bladeRM);
      shears.add(pivot, shearsBladeL, shearsBladeR);
      shears.position.set(-0.08, -0.46, 0.14);
      shears.rotation.x = Math.PI / 2 - 0.2;
      shears.visible = false;
      rArm.add(shears);
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
    return { g, lArm, rArm, lLeg, rLeg, head, hairM, briefcase, shears, shearsBladeL, shearsBladeR, colors: [shirt, pants, skin, hair] };
  }

  // Çalışan (masasında oturan ya da tezgâhta ayakta duran): bina hasar alınca veya gece olunca sandalyesinden kalkıp binayı boşaltır
  // spec: { x, y, z, yaw, pose: 'sit' | 'stand', style, buildingId, doorPos, exitPath }
  _spawnWorker(spec) {
    const k = spec.k || 1, body = this._makeBody(false, spec.style || 'office', spec);
    body.g.scale.setScalar(SCALE * k);
    const sit = spec.pose === 'sit', drop = sit ? Math.max(0, 0.62 * SCALE * k - 0.5) : 0;
    if (sit) { body.lLeg.rotation.x = -Math.PI / 2; body.rLeg.rotation.x = -Math.PI / 2; body.lArm.rotation.x = spec.watchTV ? -0.75 : -1.2; body.rArm.rotation.x = spec.watchTV ? -0.85 : -1.2; }   // bacaklar ileri, kollar klavyede/koltukta
    body.g.position.set(spec.x, spec.y - drop, spec.z); body.g.rotation.y = spec.yaw;
    this.scene.add(body.g);
    this.npcs.push({
      ...body, group: body.g, x: spec.x, y: spec.y, z: spec.z, vy: 0, heading: spec.yaw, turnTimer: 0, pause: 0, cycle: Math.random() * 6, grounded: true,
      worker: true, sit, drop, k, eat: !!spec.eat, cook: !!spec.cook, watchTV: !!spec.watchTV, cycleOff: Math.random() * 6,
      buildingId: spec.buildingId || null,
      doorPos: spec.doorPos || null,
      exitPath: spec.exitPath ? spec.exitPath.map(p => ({ ...p })) : null,
      homeDesk: { x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw, sit, drop },
      evacPhase: null, evacMode: null,
      respawn: () => this._spawnWorker(spec), value: 100
    });
  }

  // Okul Çocukları: boyları küçültülmüş (k=0.58), sırt çantalı ve renkli kıyafetli.
  // Zille beraber bahçeye çıkıp futbol, kovalamaca (ebe) ve ip atlama oynarlar.
  _spawnChild(spec) {
    const k = spec.k || 0.58;
    const body = this._makeBody(false, 'child', spec);
    body.g.scale.setScalar(SCALE * k);
    const sit = spec.pose === 'sit', drop = sit ? Math.max(0, 0.62 * SCALE * k - 0.4) : 0;
    if (sit) {
      body.lLeg.rotation.x = -Math.PI / 2; body.rLeg.rotation.x = -Math.PI / 2;
      body.lArm.rotation.x = -1.1; body.rArm.rotation.x = -1.1;
    }
    body.g.position.set(spec.x, spec.y - drop, spec.z); body.g.rotation.y = spec.yaw || 0;
    this.scene.add(body.g);

    // Futbol sahası için top oluştur (ilk çocukla birlikte)
    if (!this.soccerBall && spec.ballPos) {
      const bGeo = new THREE.SphereGeometry(0.35, 12, 12);
      const bMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      this.soccerBall = new THREE.Mesh(bGeo, bMat);
      this.soccerBall.castShadow = true;
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(GEO.torso, mat(0x111827));
        p.scale.set(0.2, 0.2, 0.1);
        const th = (i * Math.PI) / 3;
        p.position.set(0.33 * Math.cos(th), 0.15 * (i % 2 === 0 ? 1 : -1), 0.33 * Math.sin(th));
        p.lookAt(0, 0, 0);
        this.soccerBall.add(p);
      }
      this.scene.add(this.soccerBall);
      this.soccerBall.position.set(spec.ballPos.x, spec.ballPos.y, spec.ballPos.z);
      this.soccerBall.vx = 0; this.soccerBall.vz = 0;
    }

    const rec = {
      ...body, group: body.g, x: spec.x, y: spec.y, z: spec.z, vy: 0,
      heading: spec.yaw || 0, turnTimer: 2 + Math.random() * 3, pause: 0, cycle: Math.random() * 6, grounded: true,
      child: true, childActivity: spec.activity || 'soccer', k, sit, drop,
      deskPos: { x: spec.x, y: spec.y, z: spec.z, yaw: spec.yaw || 0, sit, drop },
      yardPos: spec.yardPos || { x: spec.x, y: spec.y, z: spec.z },
      bounds: spec.bounds || null,
      isIt: !!spec.isIt, tagCooldown: 0,
      baseY: spec.y,
      respawn: () => this._spawnChild(spec), value: 50
    };
    this.npcs.push(rec);
    this.schoolChildren.push(rec);
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
      if (n.afkInBuilding || n.heldChunk) continue;
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

  // Okul zili, teneffüs, futbol, kovalamaca (ebe) ve ip atlama oyun döngüsü
  _updateSchool(dt) {
    if (!this.schoolChildren || this.schoolChildren.length === 0) return;
    this.schoolBellTimer += dt;
    // Her 3 dakikada bir (180 saniye) okul zili çalar (teneffüs <-> ders geçişi)
    if (this.schoolBellTimer >= 180) {
      this.schoolBellTimer = 0;
      this.schoolRecess = !this.schoolRecess;
      sound.playSchoolBell();
      const popup = document.createElement('div');
      popup.className = 'score-popup';
      popup.innerText = this.schoolRecess ? '🔔 OKUL ZİLİ ÇALDI! (TENEFFÜS BAŞLADI)' : '🔔 DERS ZİLİ ÇALDI! (SINIFLARA DÖNÜŞ)';
      popup.style.left = `${window.innerWidth / 2 - 140}px`;
      popup.style.top = '100px';
      popup.style.color = '#fde047';
      popup.style.fontSize = '21px';
      popup.style.textShadow = '0 2px 8px rgba(0,0,0,0.85)';
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), 3500);
    }

    this.ropeAngle = (this.ropeAngle + dt * 6) % (Math.PI * 2);

    // Futbol topu fizik simülasyonu
    if (this.soccerBall) {
      const b = this.soccerBall;
      b.position.x += b.vx * dt;
      b.position.z += b.vz * dt;
      b.vx *= Math.pow(0.88, dt * 60);
      b.vz *= Math.pow(0.88, dt * 60);
      // Saha sınırları (futbol sahası x: 268..294, z: 156..206)
      if (b.position.x < 268) { b.position.x = 268; b.vx = -b.vx * 0.75; }
      if (b.position.x > 294) { b.position.x = 294; b.vx = -b.vx * 0.75; }
      if (b.position.z < 156) { b.position.z = 156; b.vz = -b.vz * 0.75; }
      if (b.position.z > 206) { b.position.z = 206; b.vz = -b.vz * 0.75; }
      b.rotation.x += b.vz * dt * 2.5;
      b.rotation.z -= b.vx * dt * 2.5;
    }

    for (const c of this.schoolChildren) {
      if (c.dead) continue;
      // Ders saati: sınıfa dön ve masana otur
      if (!this.schoolRecess && c.deskPos) {
        c.sit = c.deskPos.sit; c.drop = c.deskPos.drop;
        c.x = c.deskPos.x; c.y = c.deskPos.y; c.z = c.deskPos.z;
        c.heading = c.deskPos.yaw;
        if (c.sit) {
          c.lLeg.rotation.x = -Math.PI / 2; c.rLeg.rotation.x = -Math.PI / 2;
          c.lArm.rotation.x = -1.1; c.rArm.rotation.x = -1.1;
        }
        c.group.position.set(c.x, c.y - c.drop, c.z);
        c.group.rotation.set(0, c.heading, 0);
        continue;
      }

      // Teneffüs saati: bahçede canlı oyunlar!
      c.sit = false; c.drop = 0;
      if (c.childActivity === 'soccer' && this.soccerBall) {
        const b = this.soccerBall;
        const dx = b.position.x - c.x, dz = b.position.z - c.z;
        const dist = Math.hypot(dx, dz);
        c.heading = Math.atan2(dx, dz);
        c.group.rotation.y = c.heading;
        if (dist > 0.85) {
          const spd = 2.85;
          c.x += Math.sin(c.heading) * spd * dt;
          c.z += Math.cos(c.heading) * spd * dt;
          c.cycle += dt * 9;
          c.lLeg.rotation.x = Math.sin(c.cycle) * 0.65;
          c.rLeg.rotation.x = -Math.sin(c.cycle) * 0.65;
          c.lArm.rotation.x = -Math.sin(c.cycle) * 0.6;
          c.rArm.rotation.x = Math.sin(c.cycle) * 0.6;
        } else {
          c.rLeg.rotation.x = -1.35; // Şut animasyonu
          const kickDir = c.z < 181 ? 1 : -1;
          b.vx = (Math.random() - 0.5) * 6;
          b.vz = kickDir * (6 + Math.random() * 6);
        }
        c.group.position.set(c.x, c.y, c.z);
      } else if (c.childActivity === 'tag') {
        c.tagCooldown = Math.max(0, (c.tagCooldown || 0) - dt);
        if (c.isIt) {
          const targets = this.schoolChildren.filter(o => o !== c && o.childActivity === 'tag');
          let best = null, bd = Infinity;
          for (const t of targets) {
            const d = Math.hypot(t.x - c.x, t.z - c.z);
            if (d < bd) { bd = d; best = t; }
          }
          if (best) {
            c.heading = Math.atan2(best.x - c.x, best.z - c.z);
            c.group.rotation.y = c.heading;
            const spd = 3.3;
            c.x += Math.sin(c.heading) * spd * dt;
            c.z += Math.cos(c.heading) * spd * dt;
            c.cycle += dt * 11;
            c.lLeg.rotation.x = Math.sin(c.cycle) * 0.7;
            c.rLeg.rotation.x = -Math.sin(c.cycle) * 0.7;
            c.lArm.rotation.x = -0.9; c.rArm.rotation.x = -0.9;
            if (bd < 0.85 && c.tagCooldown <= 0) {
              c.isIt = false; best.isIt = true;
              c.tagCooldown = 2.0; best.tagCooldown = 1.5;
            }
          }
        } else {
          const it = this.schoolChildren.find(o => o.childActivity === 'tag' && o.isIt);
          if (it) {
            const dx = c.x - it.x, dz = c.z - it.z;
            c.heading = Math.atan2(dx, dz);
            c.group.rotation.y = c.heading;
            const spd = 2.9;
            c.x += Math.sin(c.heading) * spd * dt;
            c.z += Math.cos(c.heading) * spd * dt;
            c.cycle += dt * 10;
            c.lLeg.rotation.x = Math.sin(c.cycle) * 0.65;
            c.rLeg.rotation.x = -Math.sin(c.cycle) * 0.65;
            c.lArm.rotation.x = -Math.sin(c.cycle) * 0.6;
            c.rArm.rotation.x = Math.sin(c.cycle) * 0.6;
          }
        }
        c.x = Math.max(298, Math.min(322, c.x));
        c.z = Math.max(156, Math.min(202, c.z));
        c.group.position.set(c.x, c.y, c.z);
      } else if (c.childActivity === 'rope_jump') {
        const jumpH = Math.max(0, Math.sin(this.ropeAngle)) * 0.52;
        c.group.position.set(c.x, c.baseY + jumpH, c.z);
        c.lLeg.rotation.x = jumpH > 0.1 ? -0.45 : 0;
        c.rLeg.rotation.x = jumpH > 0.1 ? -0.45 : 0;
        c.lArm.rotation.x = -0.5 + jumpH * 0.5;
        c.rArm.rotation.x = -0.5 + jumpH * 0.5;
      } else if (c.childActivity === 'rope_swing') {
        c.lArm.rotation.x = Math.sin(this.ropeAngle) * 0.8;
        c.rArm.rotation.x = Math.sin(this.ropeAngle) * 0.8;
        c.group.position.set(c.x, c.y, c.z);
      }
    }
  }

  // ── Güncelleme ──
  update(dt, playerPos) {
    this.playerPos.copy(playerPos);
    this._updateSchool(dt);

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
    this.cats.update(dt, playerPos);
    this._updateBakkalKids(dt);
    this._updateMarketShoppers(dt);
    this._updateCarOwners(dt);
  }

  // ── MAHALLE BAKKALI: Ekmek alan, parasını ödeyip çıkan çocuklar ──
  _spawnBakkalKid(spec) {
    const body = this._makeBody(false, 'child', { shirt: pick([0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b]) });
    body.g.scale.setScalar(SCALE * 0.58);
    body.g.position.set(spec.spawnPos.x, spec.spawnPos.y, spec.spawnPos.z);
    this.scene.add(body.g);

    // Eline verilecek taze somun ekmek modeli (raftan alınca görünür)
    const bread = new THREE.Mesh(boxGeo(0.2, 0.14, 0.35), mat(0xd97706));
    bread.position.set(0.02, -0.42, 0.12);
    bread.visible = false;
    body.rArm.add(bread);

    this.bakkalKids.push({
      ...body, group: body.g, bread, spec,
      x: spec.spawnPos.x, y: spec.spawnPos.y, z: spec.spawnPos.z,
      phase: 'walk_to_shelf', timer: 0, cycle: 0
    });
  }

  _updateBakkalKids(dt) {
    for (const kid of this.bakkalKids) {
      kid.cycle += dt * 8;
      const walk = () => {
        kid.lLeg.rotation.x = Math.sin(kid.cycle) * 0.55;
        kid.rLeg.rotation.x = -Math.sin(kid.cycle) * 0.55;
        kid.lArm.rotation.x = -Math.sin(kid.cycle) * 0.45;
        if (!kid.bread.visible) kid.rArm.rotation.x = Math.sin(kid.cycle) * 0.45;
      };

      if (kid.phase === 'walk_to_shelf') {
        const target = kid.spec.shelfPos;
        const dx = target.x - kid.x, dz = target.z - kid.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          kid.phase = 'take_bread';
          kid.timer = 1.2;
          kid.rArm.rotation.x = -1.2;
        } else {
          kid.heading = Math.atan2(dx, dz);
          kid.group.rotation.y = kid.heading;
          kid.x += (dx / d) * dt * 1.5;
          kid.z += (dz / d) * dt * 1.5;
          walk();
        }
      } else if (kid.phase === 'take_bread') {
        kid.timer -= dt;
        kid.bread.visible = true;
        kid.rArm.rotation.x = -0.8;
        if (kid.timer <= 0) {
          kid.phase = 'walk_to_cashier';
        }
      } else if (kid.phase === 'walk_to_cashier') {
        const target = kid.spec.cashierPos;
        const dx = target.x - kid.x, dz = target.z - kid.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          kid.phase = 'pay';
          kid.timer = 1.3;
          sound.playCashRegister();
        } else {
          kid.heading = Math.atan2(dx, dz);
          kid.group.rotation.y = kid.heading;
          kid.x += (dx / d) * dt * 1.4;
          kid.z += (dz / d) * dt * 1.4;
          walk();
        }
      } else if (kid.phase === 'pay') {
        kid.timer -= dt;
        kid.rArm.rotation.x = -0.6;
        if (kid.timer <= 0) {
          kid.phase = 'walk_to_exit';
        }
      } else if (kid.phase === 'walk_to_exit') {
        const target = kid.spec.exitPos;
        const dx = target.x - kid.x, dz = target.z - kid.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          kid.phase = 'cooldown';
          kid.timer = 15 + Math.random() * 10;
          kid.group.visible = false;
        } else {
          kid.heading = Math.atan2(dx, dz);
          kid.group.rotation.y = kid.heading;
          kid.x += (dx / d) * dt * 1.5;
          kid.z += (dz / d) * dt * 1.5;
          walk();
        }
      } else if (kid.phase === 'cooldown') {
        kid.timer -= dt;
        if (kid.timer <= 0) {
          kid.x = kid.spec.spawnPos.x;
          kid.z = kid.spec.spawnPos.z;
          kid.bread.visible = false;
          kid.group.visible = true;
          kid.phase = 'walk_to_shelf';
        }
      }
      kid.group.position.set(kid.x, kid.y, kid.z);
    }
  }

  // ── SÜPERMARKET: Raflardan ürün seçen, kasada ödeyip kapıdan poşetle çıkan müşteriler ──
  _spawnMarketShopper(spec) {
    const body = this._makeBody(false, null, { shirt: pick(SHIRTS) });
    body.g.scale.setScalar(SCALE);
    body.g.position.set(spec.spawnPos.x, spec.spawnPos.y, spec.spawnPos.z);
    this.scene.add(body.g);

    // Elde tutulan market ürünü (cips / kutu içecek)
    const item = new THREE.Mesh(boxGeo(0.16, 0.22, 0.1), mat(0xef4444));
    item.position.set(0.02, -0.44, 0.1);
    item.visible = false;
    body.rArm.add(item);

    // Kasadan geçince verilen market poşeti
    const bag = new THREE.Mesh(boxGeo(0.24, 0.3, 0.12), mat(pick(BAG_COLORS)));
    bag.position.set(0.02, -0.6, 0.1);
    bag.visible = false;
    body.rArm.add(bag);

    this.marketShoppers.push({
      ...body, group: body.g, item, bag, spec,
      x: spec.spawnPos.x, y: spec.spawnPos.y, z: spec.spawnPos.z,
      phase: 'browse_aisle1', timer: 0, cycle: 0
    });
  }

  _updateMarketShoppers(dt) {
    for (const sh of this.marketShoppers) {
      sh.cycle += dt * 7;
      const walk = () => {
        sh.lLeg.rotation.x = Math.sin(sh.cycle) * 0.55;
        sh.rLeg.rotation.x = -Math.sin(sh.cycle) * 0.55;
        sh.lArm.rotation.x = -Math.sin(sh.cycle) * 0.45;
        if (!sh.bag.visible) sh.rArm.rotation.x = Math.sin(sh.cycle) * 0.45;
      };

      if (sh.phase === 'browse_aisle1') {
        const target = sh.spec.aislePos1;
        const dx = target.x - sh.x, dz = target.z - sh.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          sh.phase = 'pick_item1';
          sh.timer = 1.5;
          sh.rArm.rotation.x = -1.1;
        } else {
          sh.heading = Math.atan2(dx, dz);
          sh.group.rotation.y = sh.heading;
          sh.x += (dx / d) * dt * 1.6;
          sh.z += (dz / d) * dt * 1.6;
          walk();
        }
      } else if (sh.phase === 'pick_item1') {
        sh.timer -= dt;
        sh.item.visible = true;
        if (sh.timer <= 0) sh.phase = 'browse_aisle2';
      } else if (sh.phase === 'browse_aisle2') {
        const target = sh.spec.aislePos2;
        const dx = target.x - sh.x, dz = target.z - sh.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          sh.phase = 'pick_item2';
          sh.timer = 1.3;
          sh.lArm.rotation.x = -0.9;
        } else {
          sh.heading = Math.atan2(dx, dz);
          sh.group.rotation.y = sh.heading;
          sh.x += (dx / d) * dt * 1.5;
          sh.z += (dz / d) * dt * 1.5;
          walk();
        }
      } else if (sh.phase === 'pick_item2') {
        sh.timer -= dt;
        if (sh.timer <= 0) sh.phase = 'walk_to_cashier';
      } else if (sh.phase === 'walk_to_cashier') {
        const target = sh.spec.cashierPos;
        const dx = target.x - sh.x, dz = target.z - sh.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          sh.phase = 'checkout';
          sh.timer = 1.4;
          sound.playCashRegister();
        } else {
          sh.heading = Math.atan2(dx, dz);
          sh.group.rotation.y = sh.heading;
          sh.x += (dx / d) * dt * 1.6;
          sh.z += (dz / d) * dt * 1.6;
          walk();
        }
      } else if (sh.phase === 'checkout') {
        sh.timer -= dt;
        sh.item.visible = false;
        sh.bag.visible = true;
        if (sh.timer <= 0) sh.phase = 'walk_to_exit';
      } else if (sh.phase === 'walk_to_exit') {
        const target = sh.spec.exitPos;
        const dx = target.x - sh.x, dz = target.z - sh.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          sh.phase = 'cooldown';
          sh.timer = 18 + Math.random() * 8;
          sh.group.visible = false;
        } else {
          sh.heading = Math.atan2(dx, dz);
          sh.group.rotation.y = sh.heading;
          sh.x += (dx / d) * dt * 1.7;
          sh.z += (dz / d) * dt * 1.7;
          walk();
        }
      } else if (sh.phase === 'cooldown') {
        sh.timer -= dt;
        if (sh.timer <= 0) {
          sh.x = sh.spec.spawnPos.x;
          sh.z = sh.spec.spawnPos.z;
          sh.item.visible = false;
          sh.bag.visible = false;
          sh.group.visible = true;
          sh.phase = 'browse_aisle1';
        }
      }
      sh.group.position.set(sh.x, sh.y, sh.z);
    }
  }

  // ── PARK HALİNDEKİ ARABALARA BİNEN SAHİPLERİ ──
  _spawnCarOwner(spec) {
    const body = this._makeBody(false, null, { shirt: pick(SHIRTS) });
    body.g.scale.setScalar(SCALE);
    body.g.position.set(spec.spawnPos.x, spec.spawnPos.y, spec.spawnPos.z);
    this.scene.add(body.g);

    this.carOwners.push({
      ...body, group: body.g, spec,
      x: spec.spawnPos.x, y: spec.spawnPos.y, z: spec.spawnPos.z,
      heading: 0, cycle: 0, done: false
    });
  }

  _updateCarOwners(dt) {
    for (let i = this.carOwners.length - 1; i >= 0; i--) {
      const o = this.carOwners[i];
      if (o.done) continue;
      o.cycle += dt * 7;
      const target = o.spec.carPos;
      const dx = target.x - o.x, dz = target.z - o.z;
      const d = Math.hypot(dx, dz);

      if (d < 1.4) {
        o.done = true;
        this.scene.remove(o.group);
        if (this.voxelWorld.cars && o.spec.carIndex != null) {
          const car = this.voxelWorld.cars.cars[o.spec.carIndex];
          if (car && car.state === 'parked') {
            sound.playMetroChime();
            this.voxelWorld.cars.startDriving(car);
          }
        }
        this.carOwners.splice(i, 1);
      } else {
        o.heading = Math.atan2(dx, dz);
        o.group.rotation.y = o.heading;
        o.x += (dx / d) * dt * 1.8;
        o.z += (dz / d) * dt * 1.8;
        o.lLeg.rotation.x = Math.sin(o.cycle) * 0.55;
        o.rLeg.rotation.x = -Math.sin(o.cycle) * 0.55;
        o.lArm.rotation.x = -Math.sin(o.cycle) * 0.45;
        o.rArm.rotation.x = Math.sin(o.cycle) * 0.45;
        o.group.position.set(o.x, o.y, o.z);
      }
    }
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
    // Ahtapot koluyla kaldırılan binanın içindeki insanlar: oturduğu yerden kalkmış ve binanın içinde ayakta AFK bekler
    if (n.heldChunk && !n.heldChunk.settled) {
      n.lLeg.rotation.set(0, 0, 0); n.rLeg.rotation.set(0, 0, 0);
      n.lArm.rotation.set(0, 0, 0); n.rArm.rotation.set(0, 0, 0);
      if (n.head) n.head.rotation.set(0, 0, 0);
      return;
    }
    if (n.afkInBuilding) {
      n.lLeg.rotation.set(0, 0, 0); n.rLeg.rotation.set(0, 0, 0);
      n.lArm.rotation.set(0, 0, 0); n.rArm.rotation.set(0, 0, 0);
      if (n.head) n.head.rotation.set(0, 0, 0);
      n.group.position.set(n.x, n.y, n.z);
      return;
    }
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
    // Ahtapot koluyla fırlatılan veya bırakılan insan: sadece fare kaydırılıp atıldıysa döne döne uçar, normal bırakıldıysa dönmez
    if (n.thrownVel) {
      n.thrownVel.y -= GRAVITY * dt;
      n.x += n.thrownVel.x * dt;
      n.y += n.thrownVel.y * dt;
      n.z += n.thrownVel.z * dt;
      n.cycle += dt * 16;
      n.group.position.set(n.x, n.y, n.z);
      if (n.thrownSpin) {
        n.group.rotation.set(n.cycle, n.heading, n.cycle * 0.7);
      } else {
        n.lLeg.rotation.set(0, 0, 0); n.rLeg.rotation.set(0, 0, 0);
        n.lArm.rotation.set(0, 0, 0); n.rArm.rotation.set(0, 0, 0);
        n.group.rotation.set(0, n.heading, 0);
      }
      const gy = this.voxelWorld.terrain.topYAt(n.x, n.z);
      if (this._solid(n.x, n.y, n.z) || (gy > -Infinity && n.y <= gy + 0.1) || n.y < -2) {
        if (n.thrownSpin || n.thrownVel.length() > 14) {
          const hitPos = new THREE.Vector3(n.x, n.y + 1.0, n.z);
          this.voxelWorld.sweepCut(hitPos, 0.9, n.thrownVel);
          n.thrownVel = null;
          n.thrownSpin = false;
          this._kill(n, hitPos);
        } else {
          // Normal bırakıldıysa dönmeden ve ölmeden yere iner
          if (gy > -Infinity && n.y < gy) n.y = gy;
          n.group.position.set(n.x, n.y, n.z);
          n.group.rotation.set(0, n.heading, 0);
          n.thrownVel = null;
          n.thrownSpin = false;
        }
      }
      return;
    }
    if (n.script) n.script.update(n, dt, this);                        // villa sahibinin günlük rutini (yemek, merdiven, uyku)
    if (n.frozen) { this._posePose(n, dt); return; }                   // oturan/yatan: fizik ve yürüme yok
    if (n.skate) { this._stepSkate(n, dt); return; }                   // buz pistinde patenle kayar
    if (n.worker) {                                                    // çalışan: tahliyedeyse merdivenden inip kaçar, değilse yerinde çalışır
      if (n.evacPhase) { this._stepEvac(n, dt); return; }
      n.cycle += dt * (n.sit ? (n.watchTV ? 2.2 : 7) : 1.5);
      if (n.cook) { n.lArm.rotation.x = -0.9 + Math.sin(n.cycle * 1.1) * 0.45; n.rArm.rotation.x = -0.9 - Math.sin(n.cycle * 1.1 + 1.6) * 0.45; n.group.rotation.y = n.heading + Math.sin(n.cycle * 0.8) * 0.15; }   // mutfak tezgâhında kesip karıştırır
      else if (n.eat) { n.lArm.rotation.x = -1.1; n.rArm.rotation.x = -1.3 - 1.1 * Math.max(0, Math.sin(n.cycle * 0.3 + n.cycleOff)); }   // yemek yer: sağ elini ağzına götürür
      else if (n.watchTV) {
        n.lArm.rotation.x = -0.75 + Math.sin(n.cycle * 0.5 + n.cycleOff) * 0.06;
        n.rArm.rotation.x = -0.85 - Math.max(0, Math.sin(n.cycle * 0.4 + n.cycleOff)) * 0.25;
        n.head.rotation.y = Math.sin(n.cycle * 0.35 + n.cycleOff) * 0.14;
        n.head.rotation.x = -0.05 + Math.sin(n.cycle * 0.6) * 0.04;
      }
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
    const moving = n.pause <= 0 && !n.trimming && !n.inspecting;

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
    if (n.trimming) {
      // Hizmetçi eline makas alıp çalıları kesiyor!
      if (n.shears) n.shears.visible = true;
      n.cycle += dt * 11;
      const snip = Math.abs(Math.sin(n.cycle * 1.5)) * 0.48;
      if (n.shearsBladeL) { n.shearsBladeL.rotation.y = snip; n.shearsBladeR.rotation.y = -snip; }
      n.lArm.rotation.x = -1.2 + Math.sin(n.cycle * 0.8) * 0.16;
      n.rArm.rotation.x = -1.35 - Math.sin(n.cycle * 0.8) * 0.22;
      n.head.rotation.set(0.18, Math.sin(n.cycle * 0.5) * 0.16, 0);
      n.leafT = (n.leafT || 0) + dt;
      if (n.leafT > 0.28) {
        n.leafT = 0;
        const vw = this.voxelWorld;
        if (vw.dynamicDebris.length < vw.maxDynamicDebris) {
          const lx = n.x + Math.sin(n.heading) * 1.15 + (Math.random() - 0.5) * 0.5;
          const lz = n.z + Math.cos(n.heading) * 1.15 + (Math.random() - 0.5) * 0.5;
          vw.spawnLooseVoxel(lx, n.y + 1.1 + Math.random() * 0.3, lz, { color: Math.random() < 0.5 ? 0x4f8f3a : 0x22c55e }, new THREE.Vector3(n.x, n.y + 1.0, n.z), 0.18, 0.9, 18, null, 0.55);
        }
      }
    } else if (n.inspecting) {
      // Hizmetçi çalıları kontrol ediyor (sağa sola eğilip bakıyor)
      if (n.shears) n.shears.visible = false;
      n.cycle += dt * 3.8;
      n.lArm.rotation.x = -0.32; n.rArm.rotation.x = -0.32;
      n.head.rotation.set(0.14, Math.sin(n.cycle) * 0.36, 0);
    } else {
      if (n.shears) n.shears.visible = false;
      n.head.rotation.set(0, 0, 0);
      n.lArm.rotation.x = -sw * 0.8; n.rArm.rotation.x = sw * 0.8;
    }
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
