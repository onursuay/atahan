import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE, PALETTE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// CEPHANELİK: tabanca benzeri olmayan 6 yeni silah (kimlikler 10-15). Hepsi dünyayı kendine özgü biçimde yıkar.
//   10  KARA DELİK TOPU   tıkla: yavaş karanlık küre; çarpınca 3.6 sn kütleçekim kuyusu (yapı parçalarını, döküntüyü, insanı emer), sonda çöker
//   11  YILDIRIM BOBİNİ   basılı tut: zincirleme yıldırım; demiri tercih eder (iletken), 4 sıçrama, her şeyi (demir dahil) eritir
//   12  ERİTİCİ           tıkla: yapışan akkor çamur; 6.5 sn büyüyerek yapıyı eritir, lav damlatır
//   13  YER SARSICI       tıkla: yerden genişleyen şok dalgası (30 m); zeminin üst katını çatlatır, binaların diplerini ezer (devrilme/çökme tetikler)
//   14  YIKIM TOPU        tıkla: ağır demir gülle; hızına göre içinden geçerek yıkar, zıplar, 3 sekmeden sonra durur
//   15  TESTERE DİSKİ     tıkla: bumerang disk; yatay (kat keser) ya da dikey (dilim keser) — Z ile değişir; gidip kesip geri gelir
// Hasar hep mevcut yıkım sistemini kullanır: voxel kesme, zemin kırma, araç/kapı/insan/uçak/köprü ipi.
// ─────────────────────────────────────────────────────────────────────────────
export const ARSENAL_IDS = [10, 11, 12, 13, 14, 15, 17, 18, 19];
const S = VOXEL_SIZE;
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
const rnd = (a, b) => a + Math.random() * (b - a);

const B = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const glow = (c, op = 1, add = false) => new THREE.MeshBasicMaterial({ color: c, transparent: op < 1 || add, opacity: op, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !add });

const HINTS = {
  10: 'KARA DELİK TOPU: sol tık = karanlık küre fırlat (çarpınca her şeyi emer, sonunda çöker)',
  11: 'YILDIRIM BOBİNİ: sol tık basılı tut = zincirleme yıldırım (demiri sever)',
  12: 'ERİTİCİ: sol tık = yapışan akkor çamur (yapıyı eritir, lav damlatır)',
  13: 'YER SARSICI: sol tık = yerden genişleyen şok dalgası (zemini çatlatır, binaların dibini ezer)',
  14: 'YIKIM TOPU: sol tık = ağır demir gülle (içinden geçerek yıkar, zıplar)',
  15: 'TESTERE DİSKİ: sol tık = bumerang disk fırlat   Z = yatay / dikey kesim',
  17: 'PLAZMA LAZERİ: sol tık basılı tut = kesintisiz gök plazması (binaları buharlaştırıp keser)',
  18: 'MİNİ NUKE: sol tık = taktik nükleer roket fırlat (devasa patlama ve krater)',
  19: 'CRYO TOPU: sol tık = buz küresi fırlat (yapıyı dondurup tuzla buz eder)'
};

export class Arsenal {
  constructor(hw) {
    this.hw = hw;
    this.cd = {};                    // silah başına bekleme
    this.orbs = []; this.wells = []; this.globs = []; this.melts = []; this.quakes = []; this.balls = []; this.saw = null;
    this.bolts = []; this.segPool = [];
    this.teslaT = 0; this.sawMode = 'flat';
    this.lights = [];
    this.onHint = null; this.onShake = null;
    this.models = {};
    this._build();
    this.group = new THREE.Group();   // dünyada görünen nesneler (mermiler, halka, yıldırım)
    hw.mainScene.add(this.group);
    this.zapLight = new THREE.PointLight(0x9bdcff, 0, 14); hw.mainScene.add(this.zapLight);
    this.meltLight = new THREE.PointLight(0xff7a1a, 0, 10); hw.mainScene.add(this.meltLight);
    this.wellLight = new THREE.PointLight(0x7c3aed, 0, 16); hw.mainScene.add(this.wellLight);
    this.plasmaLight = new THREE.PointLight(0x00f0ff, 0, 16); hw.mainScene.add(this.plasmaLight);
    this.plasmaBeamMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8), glow(0x00ffff, 0.85, true));
    this.plasmaBeamMesh.visible = false; hw.mainScene.add(this.plasmaBeamMesh);
    this.nukes = []; this.cryos = [];
    this.zapT = 0;
  }

  get vw() { return this.hw.voxelWorld; }

  // ───────────────────────── Elde görünen modeller ─────────────────────────
  _build() {
    const iron = lam(0x4b5563), dark = lam(0x1f2937), black = lam(0x0b0f14), brass = lam(0xb45309), copper = lam(0xd97706);
    const mk = (parts, pos) => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); g.position.set(...pos); g.visible = false; this.hw.root.add(g); return g; };

    // 10 Kara delik topu: koyu gövde, mor halkalar, ucunda dönen karanlık küre
    this.orbModel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), lam(0x050308));
    this.orbHalo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), glow(0x8b5cf6, 0.4, true));
    this.orbModel.position.set(0, 0.02, -0.82); this.orbHalo.position.copy(this.orbModel.position);
    this.ringMats = [glow(0x8b5cf6), glow(0xa78bfa), glow(0xc4b5fd)];
    this.models[10] = mk([
      B(0.13, 0.15, 0.55, lam(0x1b1030), 0, 0, -0.18), B(0.07, 0.17, 0.09, dark, 0, -0.15, 0.0),
      B(0.2, 0.2, 0.035, this.ringMats[0], 0, 0.01, -0.5), B(0.17, 0.17, 0.035, this.ringMats[1], 0, 0.01, -0.58), B(0.14, 0.14, 0.035, this.ringMats[2], 0, 0.01, -0.66),
      this.orbModel, this.orbHalo
    ], [0.27, -0.24, -0.5]);

    // 11 Yıldırım bobini: bakır sargı, iki elektrot, cam göbekte mavi arklar
    const coils = []; for (let i = 0; i < 6; i++) coils.push(B(0.17, 0.17, 0.045, i % 2 ? copper : brass, 0, 0.0, -0.1 - i * 0.07));
    this.teslaTipA = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), glow(0xbfefff));
    this.teslaTipB = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), glow(0xbfefff));
    this.teslaTipA.position.set(-0.07, 0.07, -0.62); this.teslaTipB.position.set(0.07, 0.07, -0.62);
    this.teslaArc = B(0.015, 0.015, 0.14, glow(0xe0f7ff), 0, 0.07, -0.62);
    this.models[11] = mk([
      B(0.1, 0.12, 0.28, dark, 0, -0.02, 0.1), B(0.065, 0.2, 0.09, black, 0, -0.16, 0.12),
      ...coils, B(0.015, 0.015, 0.2, iron, -0.07, 0.07, -0.52), B(0.015, 0.015, 0.2, iron, 0.07, 0.07, -0.52),
      this.teslaTipA, this.teslaTipB, this.teslaArc
    ], [0.26, -0.24, -0.46]);

    // 12 Eritici: turuncu tank, uyarı bantları, akkor ağızlık
    this.meltTip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), glow(0xff7a1a));
    this.meltTip.position.set(0, 0.0, -0.72);
    this.models[12] = mk([
      B(0.12, 0.13, 0.42, iron, 0, 0.0, -0.3), B(0.075, 0.075, 0.2, black, 0, 0.0, -0.62),
      B(0.2, 0.2, 0.34, lam(0xdc6b0f), 0, 0.05, 0.12), B(0.205, 0.205, 0.04, black, 0, 0.05, 0.02), B(0.205, 0.205, 0.04, black, 0, 0.05, 0.2),
      B(0.065, 0.18, 0.09, dark, 0, -0.14, -0.1), this.meltTip
    ], [0.26, -0.25, -0.48]);

    // 13 Yer sarsıcı: iri piston + yassı vurucu plaka, parlayan çatlaklar
    this.quakePlate = B(0.36, 0.07, 0.34, iron, 0, -0.12, -0.52);
    this.models[13] = mk([
      B(0.2, 0.26, 0.42, dark, 0, 0.02, -0.1), B(0.09, 0.3, 0.09, iron, 0, -0.04, -0.36), this.quakePlate,
      B(0.02, 0.2, 0.43, glow(0xff9a3d), 0.09, 0.02, -0.1), B(0.02, 0.2, 0.43, glow(0xff9a3d), -0.09, 0.02, -0.1),
      B(0.07, 0.2, 0.09, black, 0, -0.2, 0.1)
    ], [0.26, -0.22, -0.5]);

    // 14 Yıkım topu: kısa kalın havan; ağızda demir gülle
    this.mortarBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), lam(0x303842));
    this.mortarBall.position.set(0, 0.0, -0.58);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 8), iron); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0, -0.32);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 8), dark); band.rotation.x = Math.PI / 2; band.position.set(0, 0, -0.5);
    this.models[14] = mk([tube, band, this.mortarBall, B(0.08, 0.2, 0.1, black, 0, -0.17, -0.05), B(0.07, 0.08, 0.2, dark, 0, 0.14, -0.1)], [0.27, -0.25, -0.5]);

    // 15 Testere diski: sapa bağlı büyük dişli disk (fırlatılınca modelden gizlenir)
    this.sawDiscHand = this._makeDisc(0.17);
    this.sawDiscHand.rotation.z = Math.PI / 2;
    const stem = B(0.045, 0.34, 0.045, iron, 0, -0.1, -0.2);
    this.models[15] = mk([stem, B(0.07, 0.07, 0.07, dark, 0, -0.27, -0.2), this.sawDiscHand], [0.24, -0.16, -0.5]);
    this.sawDiscHand.position.set(0.02, 0.08, -0.22);

    // 17 Plazma Lazeri: siber gövde + parıldayan mavi çekirdek + odak halkaları
    this.plasmaTip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), glow(0x00f0ff));
    this.plasmaTip.position.set(0, 0, -0.72);
    const pRings = [
      B(0.16, 0.16, 0.035, glow(0x00e5ff), 0, 0.01, -0.45),
      B(0.14, 0.14, 0.035, glow(0x38bdf8), 0, 0.01, -0.55),
      B(0.12, 0.12, 0.035, glow(0xa855f7), 0, 0.01, -0.65)
    ];
    this.models[17] = mk([B(0.11, 0.14, 0.52, dark, 0, 0, -0.2), B(0.065, 0.18, 0.09, black, 0, -0.15, 0.0), ...pRings, this.plasmaTip], [0.27, -0.24, -0.5]);

    // 18 Mini Nuke: zeytin yeşili roket tüpü + nükleer uyarı bantları + sivri savaş başlığı
    const nukeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.65, 8), lam(0x3f4b3b));
    nukeTube.rotation.x = Math.PI / 2; nukeTube.position.set(0, 0, -0.3);
    this.nukeHead = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 8), lam(0xca8a04));
    this.nukeHead.rotation.x = -Math.PI / 2; this.nukeHead.position.set(0, 0, -0.72);
    const hazardRing = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.08, 8), lam(0xeab308));
    hazardRing.rotation.x = Math.PI / 2; hazardRing.position.set(0, 0, -0.48);
    this.models[18] = mk([nukeTube, hazardRing, this.nukeHead, B(0.08, 0.2, 0.1, black, 0, -0.18, -0.05)], [0.28, -0.23, -0.5]);

    // 19 Cryo Topu: buzlu gümüş gövde + parıldayan mavi buz kristali
    const cryoBody = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 8), lam(0x94a3b8));
    cryoBody.rotation.x = Math.PI / 2; cryoBody.position.set(0, 0, -0.32);
    this.cryoShard = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), glow(0x67e8f9));
    this.cryoShard.position.set(0, 0, -0.65);
    this.models[19] = mk([cryoBody, this.cryoShard, B(0.07, 0.18, 0.09, dark, 0, -0.16, -0.08), B(0.15, 0.15, 0.04, glow(0x38bdf8), 0, 0, -0.45)], [0.26, -0.23, -0.5]);
  }

  _makeDisc(r) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 14), lam(0x9ca3af));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.06, 8), lam(0x1f2937));
    g.add(body, hub);
    const tm = lam(0xe5e7eb);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const t = B(r * 0.22, 0.05, r * 0.16, tm, Math.cos(a) * r * 1.02, 0, Math.sin(a) * r * 1.02); t.rotation.y = -a; g.add(t); }
    return g;
  }

  applyVisibility(i) { for (const id of ARSENAL_IDS) this.models[id].visible = id === i; if (i === 15 && this.saw) this.sawDiscHand.visible = false; else this.sawDiscHand.visible = true; }
  onSwitch(i) {
    if (i !== 11) this.teslaT = 0;
    if (HINTS[i] && this.onHint) this.onHint(HINTS[i]);
  }
  toggleSawMode() {
    this.sawMode = this.sawMode === 'flat' ? 'wheel' : 'flat';
    if (this.onHint) this.onHint(this.sawMode === 'flat' ? 'TESTERE: YATAY disk (kat keser)' : 'TESTERE: DİKEY disk (dilim keser)');
  }

  reset() {
    [...this.orbs, ...this.globs, ...this.balls, ...this.nukes, ...this.cryos].forEach(o => this.group.remove(o.mesh));
    this.wells.forEach(w => this.group.remove(w.mesh)); this.melts.forEach(m => this.group.remove(m.mesh)); this.quakes.forEach(q => this.group.remove(q.mesh));
    if (this.saw) this.group.remove(this.saw.mesh);
    this.bolts.forEach(b => b.segs.forEach(s => { s.visible = false; }));
    this.orbs = []; this.wells = []; this.globs = []; this.melts = []; this.quakes = []; this.balls = []; this.saw = null; this.bolts = [];
    this.nukes = []; this.cryos = [];
    if (this.plasmaBeamMesh) this.plasmaBeamMesh.visible = false;
    this.zapLight.intensity = 0; this.meltLight.intensity = 0; this.wellLight.intensity = 0; this.plasmaLight.intensity = 0;
    sound.stopWell && sound.stopWell(); sound.updateSaw && sound.updateSaw(false);
  }

  // ───────────────────────── Ortak: ışın izleme ─────────────────────────
  // Işının ilk çarptığı şey: { dist, point, type: voxel|ground|car|npc|plane|door|rope|water|none, obj }
  trace(origin, dir, maxDist) {
    const hw = this.hw, vw = this.vw, ter = vw.terrain;
    let best = { dist: maxDist, point: origin.clone().addScaledVector(dir, maxDist), type: 'none' };
    const p = new THREE.Vector3();
    for (let d = 0.3; d < maxDist; d += 0.25) {
      p.copy(origin).addScaledVector(dir, d);
      const v = vw.voxels.get(`${Math.round(p.x / S)},${Math.round((p.y - S / 2) / S)},${Math.round(p.z / S)}`);
      if (v && v.active) { best = { dist: d, point: p.clone(), type: 'voxel', obj: v }; break; }
      const gy = ter.topYAt(p.x, p.z);
      if (p.y <= gy && ter.topIntactAt(p.x, p.z)) { best = { dist: d, point: new THREE.Vector3(p.x, gy, p.z), type: 'ground' }; break; }
      if (p.y < -0.4) { best = { dist: d, point: new THREE.Vector3(p.x, -0.15, p.z), type: 'water' }; break; }
    }
    const lim = () => best.dist;
    const consider = (h, type, objKey) => { if (!h) return; const dd = origin.distanceTo(h.point); if (dd < best.dist) best = { dist: dd, point: h.point.clone(), type, obj: h[objKey] }; };
    if (vw.doors) consider(vw.doors.rayHit(origin, dir, lim()), 'door', 'door');
    if (hw.cars) consider(hw.cars.rayHit(origin, dir, lim()), 'car', 'car');
    if (hw.planes) consider(hw.planes.rayHit(origin, dir, lim()), 'plane', 'plane');
    if (hw.npcs) consider(hw.npcs.rayHit(origin, dir, lim()), 'npc', 'npc');
    if (vw.bridge) consider(vw.bridge.rayHit(origin, dir, lim()), 'rope', 'rope');
    return best;
  }

  _muzzle(off = { x: 0.26, y: -0.22, z: -1.0 }) { return this.hw._handWorld(off); }
  _fwd() { const f = new THREE.Vector3(); this.hw.camera.getWorldDirection(f); return f; }
  _score(n, label, k = 14 / 8) { if (n > 0 && this.hw.onScore) { const pts = Math.max(1, Math.round(n * k)); this.hw.onScore(pts, `+${pts} ${label}`); } }
  _shake(s) { if (this.onShake) this.onShake(s); }

  // ───────────────────────── Ateş ─────────────────────────
  fire(id) {
    const now = performance.now() / 1000;
    if ((this.cd[id] || 0) > now) return false;
    switch (id) {
      case 10: this.cd[id] = now + 4.2; this._fireOrb(); break;
      case 11: this.hw.fireHeld = true; break;                    // basılı tutulunca update ateşler
      case 12: if (this.globs.length + this.melts.length >= 6) return false; this.cd[id] = now + 1.0; this._fireGlob(); break;
      case 13: this.cd[id] = now + 3.4; this._fireQuake(); break;
      case 14: this.cd[id] = now + 1.7; this._fireBall(); break;
      case 15: if (this.saw) return false; this._throwSaw(); break;
      case 17: this.hw.fireHeld = true; break;
      case 18: this.cd[id] = now + 2.5; this._fireNuke(); break;
      case 19: this.cd[id] = now + 1.2; this._fireCryo(); break;
    }
    return true;
  }

  // ── 10 KARA DELİK TOPU ──
  _fireOrb() {
    const hw = this.hw, m = this._muzzle({ x: 0.26, y: -0.22, z: -0.95 }), dir = this._fwd();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lam(0x050308)), new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), glow(0x8b5cf6, 0.32, true)));
    g.position.copy(m); this.group.add(g);
    this.orbs.push({ mesh: g, pos: m.clone(), vel: dir.clone().multiplyScalar(26), life: 3.2 });
    sound.playGravityLaunch && sound.playGravityLaunch();
    hw.kick = 1; this._shake(0.1);
  }

  _openWell(pos) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), lam(0x020104));
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), glow(0x7c3aed, 0.28, true));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 28), glow(0xc4b5fd, 0.75, true));
    ring.rotation.x = Math.PI / 2;
    g.add(core, halo, ring); g.position.copy(pos); this.group.add(g);
    this.wells.push({ mesh: g, core, halo, ring, pos: pos.clone(), t: 0, dur: 3.6, R: 11, cutT: 0, hitT: 0, shed: 0 });
    sound.playBlockHit();
  }

  _updateWell(w, dt) {
    const vw = this.vw, hw = this.hw;
    w.t += dt; const p = w.t / w.dur;
    const s = lerp(0.5, 1.5, Math.min(1, p * 2)) * (1 + 0.06 * Math.sin(w.t * 14));
    w.core.scale.setScalar(s * 0.9); w.halo.scale.setScalar(s * 1.7 + Math.sin(w.t * 9) * 0.1);
    w.ring.scale.setScalar(s * 2.2); w.ring.rotation.z += dt * 5;
    sound.updateWell && sound.updateWell(true, p);
    this.wellLight.position.copy(w.pos); this.wellLight.intensity = 3 * (0.6 + 0.4 * Math.sin(w.t * 11));
    const R = w.R;
    // Yapıdan küp sök: rastgele noktalarda kes, parçalar merkeze doğru fırlar
    const K = 14;
    for (let i = 0; i < K; i++) {
      const u = new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize();
      const r = rnd(1.8, R);
      const pt = w.pos.clone().addScaledVector(u, r);
      const push = w.pos.clone().sub(pt).normalize().multiplyScalar(16 + 22 * p);
      const n = vw.sweepCut(pt, 0.6 + 0.35 * p, push);
      w.shed += n;
    }
    // Zemin üst katını yer yer kopar
    w.cutT -= dt;
    if (w.cutT <= 0) {
      w.cutT = 0.12;
      const a = Math.random() * Math.PI * 2, r = rnd(1.5, R * 0.9);
      const gx = w.pos.x + Math.cos(a) * r, gz = w.pos.z + Math.sin(a) * r;
      if (vw.terrain.isLand(gx, gz)) vw.breakGround(new THREE.Vector3(gx, vw.terrain.topYAt(gx, gz), gz), 0.9, 70);
    }
    // Döküntü: gövdeler merkeze çekilir
    for (const d of vw.dynamicDebris) {
      const b = d.body, dx = w.pos.x - b.position.x, dy = w.pos.y - b.position.y, dz = w.pos.z - b.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > R * 1.25 || dist < 0.05) continue;
      const a = (120 / (1 + dist * 0.35)) * (0.5 + p) * dt;
      b.velocity.x += dx / dist * a; b.velocity.y += dy / dist * a; b.velocity.z += dz / dist * a;
      b.velocity.scale(1 - 0.5 * dt, b.velocity);
      if (dist < 0.9) d.life = Math.min(d.life, 0.15);
    }
    // İnsanlar emilir
    if (hw.npcs) for (const n of [...hw.npcs.npcs]) {
      const dx = w.pos.x - n.x, dz = w.pos.z - n.z, dist = Math.hypot(dx, dz, w.pos.y - n.y);
      if (dist < R) { const sp = 9 * dt; n.x += dx / (dist || 1) * sp; n.z += dz / (dist || 1) * sp; n.vy = Math.max(n.vy, 3.5); if (dist < 1.8) hw.npcs.killNpc(n, w.pos); }
    }
    w.hitT -= dt;
    if (w.hitT <= 0) {
      w.hitT = 0.4;
      if (hw.cars) hw.cars.hitSphere(w.pos, 3.5);
      vw.doors.hitSphere(w.pos, R * 0.55, 6);
      if (vw.bridge) vw.bridge.hitSphere(w.pos, R * 0.6);
      if (hw.planes) hw.planes.hitSphere(w.pos, R * 0.5);
    }
    if (w.t >= w.dur) {
      this.group.remove(w.mesh);
      const idx = this.wells.indexOf(w); if (idx >= 0) this.wells.splice(idx, 1);
      vw.explode(w.pos, 4.4, 280);
      hw.particleSystem.createExplosion(w.pos, 7, 0x7c3aed);
      sound.playImplosion && sound.playImplosion();
      this._shake(0.7);
      this._score(w.shed, 'KARA DELİK!');
      if (!this.wells.length) { sound.stopWell && sound.stopWell(); this.wellLight.intensity = 0; }
    }
  }

  // ── 11 YILDIRIM BOBİNİ ──
  _lightning() {
    const hw = this.hw, vw = this.vw;
    const origin = hw.camera.position.clone(), fwd = this._fwd();
    const right = new THREE.Vector3().crossVectors(fwd, hw.camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const dir = fwd.clone().addScaledVector(right, rnd(-0.035, 0.035)).addScaledVector(up, rnd(-0.035, 0.035)).normalize();
    const tr = this.trace(origin, dir, 70);
    let from = this._muzzle({ x: 0.26, y: -0.2, z: -0.95 });
    let end = tr.point;
    if (tr.type === 'none') end = origin.clone().addScaledVector(dir, 26).add(new THREE.Vector3(rnd(-3, 3), rnd(-2, 3), rnd(-3, 3)));   // boşa atılan ark havada dağılır
    this._bolt(from, end, 1);
    const hit = new Set();
    const zap = (pt, kind, obj) => {
      this.zapLight.position.copy(pt); this.zapLight.intensity = 2.4; this.zapT = 0.07;
      if (kind === 'car') hw.cars.bulletHit(obj, { dmg: 2, point: pt, iron: true });
      else if (kind === 'npc') hw.npcs.killNpc(obj, pt);
      else if (kind === 'plane') hw.planes.bulletHit(obj);
      else if (kind === 'door') vw.doors.damage(obj, 3);
      else if (kind === 'rope') vw.bridge.cutRope(obj, pt, null);
      else if (kind === 'ground') { if (Math.random() < 0.6) vw.breakGround(pt, 0.5, 40); }
      let n = vw.sweepCut(pt, 0.55, null);                 // yıldırım demiri de eritir
      if (kind === 'voxel' || kind === 'ground') for (let d = 0.6; d <= 1.8; d += 0.6) n += vw.sweepCut(pt.clone().addScaledVector(dir, d), 0.5, null);   // ark içeri doğru oyar
      this.cutTotal = (this.cutTotal || 0) + n;
      if (hw.particleSystem.createSpark) hw.particleSystem.createSpark(pt);
    };
    if (tr.type !== 'none' && tr.type !== 'water') zap(tr.point, tr.type, tr.obj);
    else if (tr.type === 'water' && hw.particleSystem.createSplash) hw.particleSystem.createSplash(tr.point, 0.7);
    // Zincirleme: en yakın iletken (demir küp, araç, insan) hedefe sıçra
    let cur = tr.point.clone();
    for (let hop = 0; hop < 4 && tr.type !== 'none' && tr.type !== 'water'; hop++) {
      let t = this._nextConductor(cur, hit);
      if (!t && hop === 0) t = this._branchPoint(cur);       // iletken yoksa ark yakındaki yüzeye dallanır
      if (!t) break;
      this._bolt(cur, t.point, 0.7 - hop * 0.1);
      zap(t.point, t.kind, t.obj);
      cur = t.point;
    }
    sound.playZap && sound.playZap();
  }

  // Yakında iletken yoksa: 3 m çevredeki herhangi bir küpe kısa dal
  _branchPoint(from) {
    const vw = this.vw;
    for (let i = 0; i < 24; i++) {
      const ix = Math.round((from.x + rnd(-3, 3)) / S), iy = Math.round((from.y + rnd(-2, 2) - S / 2) / S), iz = Math.round((from.z + rnd(-3, 3)) / S);
      const v = vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active) return { point: new THREE.Vector3(v.x, v.y, v.z), kind: 'voxel', obj: v, key: v };
    }
    return null;
  }

  _nextConductor(from, hit) {
    const hw = this.hw, vw = this.vw;
    let best = null, bd = 8;
    const consider = (pt, kind, obj, key) => { if (hit.has(key)) return; const d = pt.distanceTo(from); if (d > 0.4 && d < bd) { bd = d; best = { point: pt, kind, obj, key }; } };
    if (hw.npcs) for (const n of hw.npcs.npcs) consider(new THREE.Vector3(n.x, n.y + 0.9, n.z), 'npc', n, n);
    if (hw.cars) for (const c of hw.cars.cars) if (c.state !== 'wreck') consider(c.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 'car', c, c);
    // Demir küp: yakın çevrede en yakın (rastgele örneklenmiş, ucuz)
    const r = 5;
    for (let i = 0; i < 60; i++) {
      const ix = Math.round((from.x + rnd(-r, r)) / S), iy = Math.round((from.y + rnd(-r * 0.6, r * 0.6) - S / 2) / S), iz = Math.round((from.z + rnd(-r, r)) / S);
      const v = vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active && v.type.isIron) consider(new THREE.Vector3(v.x, v.y, v.z), 'voxel', v, v);
    }
    if (best) hit.add(best.key);
    return best;
  }

  // Zikzaklı ışık yayı: havuzdaki kutu parçalarıyla çizilir (0.09 sn)
  _bolt(a, b, power) {
    const n = Math.max(4, Math.min(16, Math.ceil(a.distanceTo(b) / 2.2)));
    const pts = [a.clone()];
    const d = b.clone().sub(a), len = d.length(), dn = d.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dn, new THREE.Vector3(0, 1, 0)).normalize(), up2 = new THREE.Vector3().crossVectors(side, dn).normalize();
    for (let i = 1; i < n; i++) {
      const p = a.clone().addScaledVector(dn, len * i / n);
      const j = Math.min(0.9, len / n * 0.35);
      p.addScaledVector(side, rnd(-j, j)).addScaledVector(up2, rnd(-j, j));
      pts.push(p);
    }
    pts.push(b.clone());
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push(this._seg(pts[i], pts[i + 1], 0.06 * power + 0.025, 0xeaf9ff, 1));
      segs.push(this._seg(pts[i], pts[i + 1], 0.2 * power + 0.06, 0x4cc2ff, 0.35, true));
    }
    this.bolts.push({ segs, life: 0.09 });
  }

  _seg(a, b, w, color, op, add = false) {
    let m = this.segPool.pop();
    if (!m) { m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), glow(color, op, add)); m.frustumCulled = false; }
    m.material.color.setHex(color); m.material.opacity = op; m.material.transparent = op < 1 || add;
    m.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending; m.material.depthWrite = !add;
    const d = b.clone().sub(a), len = d.length();
    m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(w, w, len); m.lookAt(b); m.visible = true;
    this.group.add(m);
    return m;
  }

  // ── 12 ERİTİCİ ──
  _fireGlob() {
    const m = this._muzzle({ x: 0.26, y: -0.2, z: -0.95 }), dir = this._fwd();
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), glow(0xff8a2a));
    g.position.copy(m); this.group.add(g);
    this.globs.push({ mesh: g, pos: m.clone(), vel: dir.clone().multiplyScalar(46), life: 3 });
    sound.playMeltFire && sound.playMeltFire();
    this.hw.kick = 0.6;
  }

  _startMelt(pos, normalGuess) {
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), glow(0xff7a1a, 0.9));
    g.position.copy(pos); this.group.add(g);
    this.melts.push({ mesh: g, pos: pos.clone(), t: 0, dur: 6.5, cutT: 0, dripT: 0, sizT: 0, removed: 0 });
    sound.playMeltHit && sound.playMeltHit();
  }

  _updateMelt(m, dt) {
    const vw = this.vw, hw = this.hw;
    m.t += dt;
    const r = Math.min(2.8, 0.55 + 0.42 * m.t), c = m.pos.clone(); c.y -= 0.28 * m.t;     // akkor kütle aşağı süzülür
    m.mesh.position.copy(c); m.mesh.scale.setScalar(r * 0.5 * (0.9 + 0.2 * Math.random()));
    m.mesh.material.color.setHex(Math.random() < 0.5 ? 0xff7a1a : 0xffc04d);
    this.meltLight.position.copy(c); this.meltLight.intensity = 2.2;
    m.cutT -= dt;
    if (m.cutT <= 0) {
      m.cutT = 0.1;
      m.removed += vw.sweepCut(c, r, null);
      if (hw.cars) hw.cars.bladeHit(c, r);
      if (hw.npcs) hw.npcs.hitSphere(c, r + 0.4);
      vw.doors.hitSphere(c, r, 3);
      if (vw.bridge) vw.bridge.hitSphere(c, r);
      if (vw.terrain.isLand(c.x, c.z) && c.y < vw.terrain.topYAt(c.x, c.z) + r) vw.breakGround(new THREE.Vector3(c.x, vw.terrain.topYAt(c.x, c.z), c.z), Math.min(r, 1.4), 40);
    }
    m.dripT -= dt;
    if (m.dripT <= 0 && vw.dynamicDebris.length < vw.maxDynamicDebris) {
      m.dripT = 0.15;
      const o = new THREE.Vector3(rnd(-r, r) * 0.7, rnd(-0.2, 0.3), rnd(-r, r) * 0.7);
      vw.spawnLooseVoxel(c.x + o.x, c.y + o.y, c.z + o.z, PALETTE.LAMP_ORANGE, { x: c.x, y: c.y + 1, z: c.z }, 1, 3, 4, new THREE.Vector3(0, -5, 0), 0.7);   // lav damlası
    }
    m.sizT -= dt;
    if (m.sizT <= 0) { m.sizT = 0.55; sound.playSizzle && sound.playSizzle(); if (hw.particleSystem.createSpark) hw.particleSystem.createSpark(c); }
    if (m.t >= m.dur) {
      this.group.remove(m.mesh);
      const i = this.melts.indexOf(m); if (i >= 0) this.melts.splice(i, 1);
      this._score(m.removed, 'ERİTİCİ!');
      if (!this.melts.length) this.meltLight.intensity = 0;
    }
  }

  // ── 13 YER SARSICI ──
  _fireQuake() {
    const hw = this.hw, vw = this.vw, origin = hw.camera.position.clone(), dir = this._fwd();
    const tr = this.trace(origin, dir, 60);
    let cx, cz;
    if (tr.type === 'none' || tr.type === 'water') { const p = origin.clone().addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 8); cx = p.x; cz = p.z; }
    else { cx = tr.point.x; cz = tr.point.z; }
    const gy = vw.terrain.isLand(cx, cz) ? vw.terrain.topYAt(cx, cz) : Math.max(0.5, tr.point.y);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 56), glow(0xffa24d, 0.8, true));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(cx, gy + 0.15, cz); mesh.material.side = THREE.DoubleSide;
    this.group.add(mesh);
    this.quakes.push({ mesh, cx, cz, gy, r: 0.5, Rmax: 30, speed: 24, removed: 0 });
    sound.playQuake && sound.playQuake();
    hw.kick = 1; this._shake(0.9);
    if (hw.particleSystem.createExplosion) hw.particleSystem.createExplosion(new THREE.Vector3(cx, gy + 0.3, cz), 4, 0x9c8a6a);
  }

  _updateQuake(q, dt) {
    const vw = this.vw, hw = this.hw;
    const r0 = q.r; q.r += q.speed * dt; const r = q.r;
    q.mesh.scale.setScalar(r); q.mesh.material.opacity = 0.8 * (1 - r / q.Rmax);
    const N = Math.min(240, Math.ceil(2 * Math.PI * r / 1.0));
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (r0 * 0.37), px = q.cx + Math.cos(a) * r, pz = q.cz + Math.sin(a) * r;
      if (!vw.terrain.isLand(px, pz)) continue;
      const gy = vw.terrain.topYAt(px, pz);
      const pt = new THREE.Vector3(px, gy + 0.9, pz);
      const strong = 1 - r / q.Rmax;
      // Binaların dibini ez: iki yükseklikte kes (dalga zayıfladıkça daha az)
      q.removed += vw.sweepCut(pt, 0.55 + 0.25 * strong, new THREE.Vector3(Math.cos(a) * 3, 6 * strong + 2, Math.sin(a) * 3));
      if (i % 2 === 0) { pt.y = gy + 2.1; q.removed += vw.sweepCut(pt, 0.5, new THREE.Vector3(0, 4, 0)); }
      if (i % 4 === 0) {
        vw.breakGround(new THREE.Vector3(px, gy, pz), 0.85, 60);
        if (hw.npcs) hw.npcs.hitSphere(new THREE.Vector3(px, gy + 0.8, pz), 1.3);
        vw.doors.hitSphere(pt, 1.2, 5);
        if (i % 8 === 0 && hw.cars) hw.cars.hitSphere(new THREE.Vector3(px, gy + 0.7, pz), 2.2);
        if (i % 12 === 0 && hw.particleSystem.createDust) hw.particleSystem.createDust(new THREE.Vector3(px, gy + 0.3, pz));
      }
    }
    if (q.r >= q.Rmax) {
      this.group.remove(q.mesh);
      const i = this.quakes.indexOf(q); if (i >= 0) this.quakes.splice(i, 1);
      this._score(q.removed, 'DEPREM!');
    }
  }

  // ── 14 YIKIM TOPU ──
  _fireBall() {
    const m = this._muzzle({ x: 0.26, y: -0.2, z: -0.9 }), dir = this._fwd();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshLambertMaterial({ color: 0x2b323b, flatShading: true })),
          new THREE.Mesh(new THREE.TorusGeometry(1.17, 0.08, 5, 14), lam(0xb45309)));
    g.position.copy(m); this.group.add(g);
    this.balls.push({ mesh: g, pos: m.clone(), vel: dir.clone().multiplyScalar(36).add(new THREE.Vector3(0, 2, 0)), bounces: 0, removed: 0, slowT: 0, burstT: 0, life: 12, spin: new THREE.Vector3(rnd(-6, 6), rnd(-4, 4), rnd(-6, 6)) });
    sound.playWreckLaunch && sound.playWreckLaunch();
    this.hw.kick = 1; this._shake(0.35);
  }

  _updateBall(b, dt) {
    const hw = this.hw, vw = this.vw, ter = vw.terrain;
    b.life -= dt;
    b.vel.y -= 16 * dt;
    const speed0 = b.vel.length();
    const steps = Math.max(1, Math.ceil(speed0 * dt / 0.4)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      b.pos.addScaledVector(b.vel, h);
      const stats = { cost: 0 };
      const n = vw.sweepCut(b.pos, 1.75, b.vel.clone().multiplyScalar(0.55), stats);   // 3.5 m'lik tünel: oda kesitini siler
      b.removed += n;
      b.burstT -= h;
      if (n >= 5 && b.vel.length() > 12 && b.burstT <= 0) { b.burstT = 0.2; b.removed += vw.explode(b.pos, 2.7, 80 + b.vel.length() * 3); this._shake(0.25); }   // duvarı çatlatan çarpma dalgası
      if (n > 0) { const sp = b.vel.length(); const k = clamp(stats.cost * 0.0035, 0, 0.22); b.vel.multiplyScalar(1 - k); if (sp > 6 && Math.random() < 0.3) sound.playWreckHit && sound.playWreckHit(clamp(sp / 30, 0.2, 1)); }
      const sp = b.vel.length();
      if (hw.cars) { hw.cars.bladeHit(b.pos, 1.3); if (sp > 10) hw.cars.hitSphere(b.pos, 1.6); }
      if (hw.npcs) hw.npcs.hitSphere(b.pos, 1.4);
      vw.doors.hitSphere(b.pos, 1.5, 8);
      if (vw.bridge) vw.bridge.hitSphere(b.pos, 1.3);
      if (hw.planes) hw.planes.hitSphere(b.pos, 1.8);
      // yer: sekme
      if (ter.isLand(b.pos.x, b.pos.z)) {
        const gy = ter.topYAt(b.pos.x, b.pos.z);
        if (b.pos.y - 1.15 < gy) {
          b.pos.y = gy + 1.15;
          if (b.vel.y < 0) {
            const imp = -b.vel.y;
            b.vel.y = imp * 0.45; b.vel.x *= 0.85; b.vel.z *= 0.85; b.bounces++;
            if (imp > 5) { vw.breakGround(new THREE.Vector3(b.pos.x, gy, b.pos.z), 1.2, 70); if (hw.particleSystem.createExplosion) hw.particleSystem.createExplosion(new THREE.Vector3(b.pos.x, gy + 0.3, b.pos.z), 2.5, 0x9c8a6a); this._shake(clamp(imp / 40, 0.05, 0.35)); }
            sound.playWreckHit && sound.playWreckHit(clamp(imp / 20, 0.25, 1));
          }
        }
      } else if (b.pos.y < -0.2) {
        if (hw.particleSystem.createSplash) hw.particleSystem.createSplash(new THREE.Vector3(b.pos.x, -0.15, b.pos.z), 2.5);
        sound.playSplash && sound.playSplash(); b.life = 0; break;
      }
    }
    b.mesh.position.copy(b.pos); b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt;
    const sp = b.vel.length();
    if (sp < 3) b.slowT += dt; else b.slowT = 0;
    if (b.bounces >= 3 && sp < 8 || b.slowT > 1.0 || b.life <= 0) {
      this.group.remove(b.mesh);
      const i = this.balls.indexOf(b); if (i >= 0) this.balls.splice(i, 1);
      if (hw.particleSystem.createExplosion) hw.particleSystem.createExplosion(b.pos, 3, 0x9c8a6a);
      this._score(b.removed, 'YIKIM TOPU!');
    }
  }

  // ── 15 TESTERE DİSKİ ──
  _throwSaw() {
    const hw = this.hw, dir = this._fwd(), cam = hw.camera;
    const flat = this.sawMode === 'flat';
    const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
    const g = new THREE.Group(); const disc = this._makeDisc(2.2); g.add(disc);
    if (!flat) g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), right);         // dikey: diskin yüzü yana bakar (dilim keser)
    const pos = cam.position.clone().addScaledVector(dir, 1.2); pos.y -= 0.2;
    g.position.copy(pos); this.group.add(g);
    this.saw = { mesh: g, disc, pos, dir: dir.clone(), flat, speed: 36, out: 0, phase: 'out', t: 0, removed: 0, ax: flat ? right : new THREE.Vector3(0, 1, 0) };
    this.sawDiscHand.visible = false;
    sound.playSawThrow && sound.playSawThrow();
    hw.kick = 0.8;
  }

  _updateSaw(dt) {
    const s = this.saw, hw = this.hw, vw = this.vw;
    s.t += dt;
    s.disc.rotation.y += dt * 38;
    if (s.phase === 'back') {
      const target = hw.camera.position.clone(); target.y -= 0.3;
      const to = target.sub(s.pos), dist = to.length();
      s.dir.copy(to.divideScalar(dist || 1));
      s.speed = Math.min(36, s.speed + 40 * dt);
      if (dist < 2.0) { this._catchSaw(); return; }
    }
    const step = s.speed * dt, n = Math.max(1, Math.ceil(step / 0.45)), h = step / n;
    let cost = 0;
    for (let i = 0; i < n; i++) {
      s.pos.addScaledVector(s.dir, h);
      if (s.phase === 'out') s.out += h;
      for (let k = -4; k <= 4; k++) {
        const pt = s.pos.clone().addScaledVector(s.ax, k * 0.55);
        const stats = { cost: 0 };
        s.removed += vw.sweepCut(pt, 0.85, s.dir.clone().multiplyScalar(7), stats);
        cost += stats.cost;
        if (hw.cars) hw.cars.bladeHit(pt, 0.45);
        if (hw.npcs && (k % 2 === 0)) hw.npcs.hitSphere(pt, 0.7);
        if (k % 2 === 0) vw.doors.hitSphere(pt, 0.5, 5);
      }
      if (vw.bridge) vw.bridge.hitSphere(s.pos, 2.0);
      if (hw.planes) hw.planes.hitSphere(s.pos, 2.2);
      // zemine değerse yatay disk yer yer kırar
      if (s.flat && vw.terrain.isLand(s.pos.x, s.pos.z) && s.pos.y < vw.terrain.topYAt(s.pos.x, s.pos.z) + 0.6 && Math.random() < 0.2) vw.breakGround(new THREE.Vector3(s.pos.x, vw.terrain.topYAt(s.pos.x, s.pos.z), s.pos.z), 0.7, 40);
    }
    // kesmek diski yavaşlatır (demir daha çok), boşlukta tekrar hızlanır
    if (cost > 0) s.speed = Math.max(7, s.speed * (1 - Math.min(0.25, cost * 0.004))); else s.speed = Math.min(36, s.speed + 18 * dt);
    s.mesh.position.copy(s.pos);
    if (hw.particleSystem.createSpark && cost > 2 && Math.random() < 0.3) hw.particleSystem.createSpark(s.pos);
    sound.updateSaw && sound.updateSaw(true, clamp(s.speed / 36, 0.2, 1));
    if (s.phase === 'out' && (s.out > 52 || s.speed < 8.5 || s.t > 3.2)) { s.phase = 'back'; s.speed = Math.max(s.speed, 16); }
    if (s.t > 9) this._catchSaw();
  }

  _catchSaw() {
    const s = this.saw;
    this.group.remove(s.mesh);
    this._score(s.removed, 'TESTERE!');
    this.saw = null;
    if (this.hw.current === 15) this.sawDiscHand.visible = true;
    sound.updateSaw && sound.updateSaw(false);
    sound.playBlockHit && sound.playBlockHit();
  }

  // ───────────────────────── Güncelleme ─────────────────────────
  update(dt, ctx, pose) {
    const hw = this.hw, cur = hw.current;
    const { swayX, swayY, drop } = pose;
    // Elde görünen model
    const mdl = this.models[cur];
    if (mdl) {
      mdl.position.set(0.26 + swayX, -0.24 - swayY - drop, -0.5 + hw.kick * 0.12);
      mdl.rotation.x = hw.kick * 0.1;
      const t = performance.now() / 1000;
      if (cur === 10) { this.orbModel.rotation.y = t * 3; this.orbHalo.scale.setScalar(1 + 0.2 * Math.sin(t * 9)); this.ringMats.forEach((m, i) => { m.opacity = 1; m.color.setHex([0x8b5cf6, 0xa78bfa, 0xc4b5fd][(Math.floor(t * 9) + i) % 3]); }); }
      if (cur === 11) { const on = hw.fireHeld; this.teslaArc.visible = on || Math.random() < 0.1; this.teslaArc.rotation.z = Math.random() * 3; this.teslaTipA.scale.setScalar(on ? 1 + Math.random() : 1); this.teslaTipB.scale.setScalar(on ? 1 + Math.random() : 1); }
      if (cur === 12) this.meltTip.scale.setScalar(1 + 0.25 * Math.sin(t * 12));
      if (cur === 13) this.quakePlate.position.y = -0.12 - hw.kick * 0.06;
      if (cur === 15 && !this.saw) this.sawDiscHand.rotation.y += dt * 6;
    }
    // Yıldırım: basılı tutunca
    if (cur === 11 && hw.fireHeld) {
      this.teslaT -= dt;
      if (this.teslaT <= 0) { this.teslaT = 0.085; this._lightning(); hw.kick = Math.min(1, hw.kick + 0.2); }
    }
    // Bolt ömrü
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.life -= dt;
      if (b.life <= 0) { b.segs.forEach(sg => { sg.visible = false; this.group.remove(sg); this.segPool.push(sg); }); this.bolts.splice(i, 1); }
    }
    if (this.zapT > 0) { this.zapT -= dt; if (this.zapT <= 0) this.zapLight.intensity = 0; }

    // Mermiler ve etkiler
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.life -= dt;
      const step = o.vel.length() * dt, dir = o.vel.clone().normalize();
      const tr = this.trace(o.pos, dir, step + 0.45);
      if (tr.type !== 'none' && tr.type !== 'water') { this.group.remove(o.mesh); this.orbs.splice(i, 1); this._openWell(tr.point.clone().addScaledVector(dir, -0.6)); continue; }
      o.pos.addScaledVector(o.vel, dt); o.vel.y -= 2 * dt; o.mesh.position.copy(o.pos); o.mesh.rotation.y += dt * 6;
      if (o.life <= 0 || o.pos.y < -0.3) { this.group.remove(o.mesh); this.orbs.splice(i, 1); this._openWell(o.pos.clone()); }
    }
    for (let i = this.wells.length - 1; i >= 0; i--) this._updateWell(this.wells[i], dt);
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i]; g.life -= dt;
      const step = g.vel.length() * dt, dir = g.vel.clone().normalize();
      const tr = this.trace(g.pos, dir, step + 0.2);
      if (tr.type !== 'none') {
        this.group.remove(g.mesh); this.globs.splice(i, 1);
        if (tr.type === 'water') { if (hw.particleSystem.createSplash) hw.particleSystem.createSplash(tr.point, 1); sound.playSplash && sound.playSplash(); continue; }
        if (tr.type === 'npc') hw.npcs.killNpc(tr.obj, g.pos);
        this._startMelt(tr.point.clone().addScaledVector(dir, 0.25));
        continue;
      }
      g.pos.addScaledVector(g.vel, dt); g.vel.y -= 9 * dt; g.mesh.position.copy(g.pos);
      if (g.life <= 0) { this.group.remove(g.mesh); this.globs.splice(i, 1); }
    }
    for (let i = this.melts.length - 1; i >= 0; i--) this._updateMelt(this.melts[i], dt);
    for (let i = this.quakes.length - 1; i >= 0; i--) this._updateQuake(this.quakes[i], dt);
    for (let i = this.balls.length - 1; i >= 0; i--) this._updateBall(this.balls[i], dt);
    if (this.saw) this._updateSaw(dt);
    else if (this.sawDiscHand.visible === false && cur === 15) this.sawDiscHand.visible = true;
    // ── 17 PLAZMA LAZERİ ──
    if (cur === 17 && hw.fireHeld) {
      this._firePlasmaBeam(dt);
    } else if (this.plasmaBeamMesh && this.plasmaBeamMesh.visible) {
      this.plasmaBeamMesh.visible = false;
      this.plasmaLight.intensity = 0;
    }

    for (let i = this.nukes.length - 1; i >= 0; i--) this._updateNuke(this.nukes[i], dt);
    for (let i = this.cryos.length - 1; i >= 0; i--) this._updateCryo(this.cryos[i], dt);
    if (!this.melts.length && this.meltLight.intensity > 0) this.meltLight.intensity = 0;
  }

  // ── 17 PLAZMA LAZERİ METODLARI ──
  _firePlasmaBeam(dt) {
    const hw = this.hw, vw = this.vw, m = this._muzzle({ x: 0.27, y: -0.22, z: -0.9 }), dir = this._fwd();
    const maxD = 100;
    const tr = this.trace(m, dir, maxD);
    const hitP = tr.point || m.clone().addScaledVector(dir, maxD);
    const dist = m.distanceTo(hitP);

    if (this.plasmaBeamMesh) {
      this.plasmaBeamMesh.visible = true;
      const mid = m.clone().add(hitP).multiplyScalar(0.5);
      this.plasmaBeamMesh.position.copy(mid);
      this.plasmaBeamMesh.scale.set(1 + Math.sin(performance.now() * 0.03) * 0.3, dist, 1 + Math.sin(performance.now() * 0.03) * 0.3);
      this.plasmaBeamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    }
    this.plasmaLight.position.copy(hitP);
    this.plasmaLight.intensity = 4.0;

    const n = vw.sweepCut(hitP, 1.3, dir.clone().multiplyScalar(4));
    if (n > 0) this._score(n, 'PLAZMA YIKIMI');
    if (hw.particleSystem.createSpark) hw.particleSystem.createSpark(hitP);
    if (hw.cars) hw.cars.bladeHit(hitP, 1.6);
    if (hw.npcs && tr.type === 'npc') hw.npcs.killNpc(tr.obj, hitP);
    if (vw.doors) vw.doors.hitSphere(hitP, 1.6, 6);
    this._shake(0.04);
    if (Math.random() < 0.2) sound.playLaserShot && sound.playLaserShot();
  }

  // ── 18 MİNİ NUKE METODLARI ──
  _fireNuke() {
    const hw = this.hw, m = this._muzzle({ x: 0.28, y: -0.22, z: -0.95 }), dir = this._fwd();
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.1, 8), lam(0x3f4b3b));
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.38, 8), lam(0xca8a04));
    nose.rotation.x = -Math.PI / 2; nose.position.z = -0.65;
    const fins = B(0.65, 0.65, 0.05, lam(0xeab308), 0, 0, 0.45);
    g.add(body, nose, fins);
    g.position.copy(m); this.group.add(g);
    this.nukes.push({ mesh: g, pos: m.clone(), vel: dir.clone().multiplyScalar(42), life: 6.0 });
    sound.playShoot();
    hw.kick = 1.4; this._shake(0.3);
  }

  _updateNuke(n, dt) {
    const hw = this.hw, vw = this.vw;
    n.life -= dt;
    const step = n.vel.length() * dt, dir = n.vel.clone().normalize();
    const tr = this.trace(n.pos, dir, step + 0.4);
    if (tr.type !== 'none' || n.life <= 0) {
      const hit = tr.point || n.pos;
      this.group.remove(n.mesh);
      const idx = this.nukes.indexOf(n); if (idx >= 0) this.nukes.splice(idx, 1);
      const removed = vw.explode(hit, 10.5, 600);
      vw.breakGround(hit, 7.5, 350);
      if (hw.particleSystem.createExplosion) hw.particleSystem.createExplosion(hit, 12, 0xfacc15);
      if (hw.cars) hw.cars.hitSphere(hit, 12);
      if (hw.npcs) for (const npc of [...hw.npcs.npcs]) if (hit.distanceTo(new THREE.Vector3(npc.x, npc.y, npc.z)) < 16) hw.npcs.killNpc(npc, hit);
      if (vw.doors) vw.doors.hitSphere(hit, 12, 50);
      sound.playTNTExplosion && sound.playTNTExplosion();
      this._shake(1.2);
      this._score(removed, 'NÜKLEER PATLAMA!');
      return;
    }
    n.pos.addScaledVector(n.vel, dt);
    n.mesh.position.copy(n.pos);
    n.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  }

  // ── 19 CRYO TOPU METODLARI ──
  _fireCryo() {
    const hw = this.hw, m = this._muzzle({ x: 0.26, y: -0.22, z: -0.9 }), dir = this._fwd();
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), glow(0x67e8f9, 0.9, true));
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.48), glow(0xbae6fd, 0.6, true));
    g.add(core, shard);
    g.position.copy(m); this.group.add(g);
    this.cryos.push({ mesh: g, core, shard, pos: m.clone(), vel: dir.clone().multiplyScalar(38), life: 5.0 });
    sound.playShoot();
    hw.kick = 0.9; this._shake(0.15);
  }

  _updateCryo(c, dt) {
    const hw = this.hw, vw = this.vw;
    c.life -= dt;
    const step = c.vel.length() * dt, dir = c.vel.clone().normalize();
    const tr = this.trace(c.pos, dir, step + 0.3);
    if (tr.type !== 'none' || c.life <= 0) {
      const hit = tr.point || c.pos;
      this.group.remove(c.mesh);
      const idx = this.cryos.indexOf(c); if (idx >= 0) this.cryos.splice(idx, 1);
      const removed = vw.explode(hit, 5.5, 200);
      vw.breakGround(hit, 4.0, 150);
      if (hw.particleSystem.createExplosion) hw.particleSystem.createExplosion(hit, 5, 0x38bdf8);
      if (hw.cars) hw.cars.hitSphere(hit, 6);
      if (hw.npcs) for (const npc of [...hw.npcs.npcs]) if (hit.distanceTo(new THREE.Vector3(npc.x, npc.y, npc.z)) < 7) hw.npcs.killNpc(npc, hit);
      sound.playBlockHit && sound.playBlockHit();
      this._shake(0.35);
      this._score(removed, 'CRYO BUZLANMA!');
      return;
    }
    c.pos.addScaledVector(c.vel, dt);
    c.vel.y -= 4 * dt;
    c.mesh.position.copy(c.pos);
    c.shard.rotation.x += dt * 8; c.shard.rotation.y += dt * 6;
  }
}
