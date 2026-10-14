import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// ASMA KÖPRÜ SİSTEMİ
//  • Ana kablolar kırmızı küplerdir (yıkılabilir). Tabliyeyi tutan dikey İPLER ince silindirdir (voxel en az 0.5 m olurdu).
//  • İp bir mermi/kılıç/patlamayla vurulunca gerçek ip gibi kopar: iki parça zincir (Verlet) olarak sarkar ve savrulur.
//  • İp koptuğunda tabliye hafifçe sallanır (yalnız görsel: tabliye küpleri sönümlü titreşimle oynar).
//  • Tabliye kolon kolon desteklenir (kule, kıyı, sağlam ip). Desteksiz kalan tabliye (ipler koptu ya da tabliye kırıldı)
//    kopma çizgisinden menteşelenip sarkar, kopar, suya düşer, yavaşça batar ve yok olur (çökme sistemi).
// ─────────────────────────────────────────────────────────────────────────────
const S = 0.5;                 // voxel boyutu
const HOLD = 12;               // desteğe en çok bu kadar kolon (6 m) uzaktaki tabliye asılı kalır
const CHAIN_N = 6;             // kopan ip parçasının segment sayısı
const ROPE_R = 0.022;          // ip yarıçapı (m)
const HIT_R = 0.2;             // ipe isabet toleransı (m)
const GRAV = 14;
const key = (x, y, z) => `${x},${y},${z}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Bridge {
  // spec: ince ızgara (0.25 m) cinsinden { X0, X1, T1, T2, ZD, ZL, DECK_TOP, yAt }
  constructor(world, spec) {
    this.world = world;
    this.spec = spec;
    this.ropes = [];
    this.chains = [];
    this.groups = [];         // sallanan tabliye küp grupları: { mesh, list }
    this.deckCols = new Map();
    this.sway = { a1: 0, v1: 0, a2: 0, v2: 0, r: 0, vr: 0, active: false };
    this.dirty = false; this.dirtyT = 0; this.time = 0;
    const F = 0.25;
    this.xs = spec.X0 * F; this.xe = spec.X1 * F;
    this.towerCols = [Math.floor((spec.T1 + 1) / 2), Math.floor((spec.T2 + 1) / 2)];
    this.dummy = new THREE.Object3D();
    this._buildRopes();
  }

  _buildRopes() {
    const sp = this.spec, g = new THREE.Group();
    this.ropeMat = new THREE.MeshLambertMaterial({ color: 0x3b4350 });
    this.ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    const armGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let x = sp.X0 + 10; x < sp.X1 - 9; x += 10) {
      if (Math.abs(x - sp.T1) < 4 || Math.abs(x - sp.T2) < 4) continue;
      const yf = Math.round(sp.yAt(x));
      const ix = Math.floor((x + 1) / 2), cableIy = Math.floor(yf / 2);
      for (const sz of [-sp.ZL, sp.ZL]) {
        const iz = Math.floor((sz + 1) / 2);
        const rope = { ix, x: ix * S, z: iz * S, yTop: cableIy * S, yBot: 1.0, alive: true, topKey: key(ix, cableIy, iz) };
        const m = new THREE.Mesh(this.ropeGeo, this.ropeMat);
        m.castShadow = true; g.add(m); rope.mesh = m;
        const armLen = Math.abs(rope.z) - 3.75;                      // tabliye korkuluğundan ipe yatay çubuk
        const arm = new THREE.Mesh(armGeo, this.ropeMat);
        arm.scale.set(0.035, 0.035, armLen); arm.position.set(rope.x, rope.yBot, Math.sign(rope.z) * (3.75 + armLen / 2));
        g.add(arm); rope.arm = arm; rope.armY = rope.yBot;
        this._poseRope(rope, 0);
        this.ropes.push(rope);
      }
    }
    this.group = g;
    this.world.scene.add(g);
    this.world.decor.push(g);
  }

  _poseRope(r, dy) {
    const h = r.yTop - (r.yBot + dy);
    r.mesh.scale.set(ROPE_R, h, ROPE_R);
    r.mesh.position.set(r.x, r.yBot + dy + h / 2, r.z);
    r.arm.position.y = r.armY + dy;
  }

  // Seviye kurulduktan sonra: tabliye küplerini ayrı gruplara al (sallanabilsinler) ve kolon sayaçlarını çıkar
  attach() {
    const w = this.world, sp = this.spec;
    const ix0 = Math.floor((sp.X0 + 1) / 2), ix1 = Math.floor((sp.X1 + 1) / 2);
    const byType = new Map();
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = -7; iz <= 7; iz++) for (let iy = -2; iy <= 14; iy++) {
        const v = w.voxels.get(key(ix, iy, iz));
        if (!v || !v.active || v.groundCell !== undefined) continue;
        v.deck = true;
        let col = this.deckCols.get(ix);
        if (!col) { col = { road: 0, init: 0 }; this.deckCols.set(ix, col); }
        if (v.type === PALETTE.ASPHALT || v.type === PALETTE.GOLD) { col.road++; col.init++; }
        if (!byType.has(v.type.id)) byType.set(v.type.id, []);
        byType.get(v.type.id).push(v);
      }
    }
    for (const [typeId, list] of byType) {
      const mesh = new THREE.InstancedMesh(w.cubeGeo, w.materials[typeId], list.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((v, i) => {
        w._hideVoxel(v);                              // eski (bölge) örneğini gizle
        this.dummy.position.set(v.x, v.y, v.z); this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        v.mesh = mesh; v.instanceIdx = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      w.scene.add(mesh);
      this.groups.push({ mesh, list });
    }
  }

  dispose() {
    this.groups.forEach(g => { this.world.scene.remove(g.mesh); g.mesh.dispose(); });
    this.chains.forEach(c => c.meshes.forEach(m => this.world.scene.remove(m)));
    this.groups = []; this.chains = []; this.ropes = [];
  }

  // Çökme sistemi her kaldırılan voxeli bildirir
  onVoxelRemoved(v) {
    if (!v.deck) return;
    const col = this.deckCols.get(v.ix);
    if (col && (v.type === PALETTE.ASPHALT || v.type === PALETTE.GOLD)) col.road--;
    this._markDirty();
  }
  _markDirty() { this.dirty = true; this.dirtyT = this.time; }

  // ── İp vurma ──
  // Işının en yakın sağlam ipe isabeti: { rope, point, dist } ya da null
  rayHit(origin, dir, maxDist) {
    let best = null;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const r of this.ropes) {
      if (!r.alive) continue;
      // Hızlı eleme: ip yatayda ışına ne kadar yakın?
      a.set(r.x, r.yBot, r.z); b.set(r.x, r.yTop, r.z);
      const hit = this._rayVsSegment(origin, dir, a, b);
      if (hit && hit.dist <= HIT_R && hit.t > 0 && hit.t <= maxDist && (!best || hit.t < best.dist)) best = { rope: r, point: hit.point, dist: hit.t };
    }
    return best;
  }

  // Işın (o + s·d, s ≥ 0, d birim) ile AB doğru parçası arasındaki en kısa mesafe: { t: ışın uzaklığı, dist, point (ip üstünde) }
  _rayVsSegment(o, d, a, b) {
    const u = b.clone().sub(a), r = o.clone().sub(a);
    const e = u.dot(u), bb = d.dot(u), c = d.dot(r), f = u.dot(r);
    const den = e - bb * bb;                                 // d birim: a = 1
    let s = den > 1e-9 ? (bb * f - c * e) / den : 0;
    let t = e > 0 ? (bb * s + f) / e : 0;
    t = clamp(t, 0, 1);
    s = Math.max(0, bb * t - c);
    const pr = o.clone().addScaledVector(d, s), ps = a.clone().addScaledVector(u, t);
    return { t: s, dist: pr.distanceTo(ps), point: ps };
  }

  // Küre içindeki ipler kopar (patlama, kılıç, çarpma). Koparılan sayıyı döndürür.
  hitSphere(center, radius, push = null) {
    let n = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), u = new THREE.Vector3();
    for (const r of this.ropes) {
      if (!r.alive) continue;
      if (Math.abs(r.x - center.x) > radius + 0.3 || Math.abs(r.z - center.z) > radius + 0.3) continue;
      a.set(r.x, r.yBot, r.z); b.set(r.x, r.yTop, r.z); u.subVectors(b, a);
      const t = clamp(u.dot(new THREE.Vector3().subVectors(center, a)) / u.lengthSq(), 0, 1);
      const p = a.clone().addScaledVector(u, t);
      if (p.distanceTo(center) <= radius + 0.05) { this.cutRope(r, p, push); n++; }
    }
    return n;
  }

  // İpi verilen noktadan kopar: iki zincir parçası (üst: kablodan, alt: tabliyeden sarkar)
  cutRope(r, point, push = null, silent = false) {
    if (!r.alive) return;
    r.alive = false; r.mesh.visible = false;
    const t = clamp((point.y - r.yBot) / (r.yTop - r.yBot), 0.12, 0.88);
    const cutY = r.yBot + t * (r.yTop - r.yBot);
    const kick = push ? push.clone().normalize() : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this._makeChain(new THREE.Vector3(r.x, r.yTop, r.z), new THREE.Vector3(r.x, cutY, r.z), kick, 2.2);       // üst parça: kablodan sarkar
    this._makeChain(new THREE.Vector3(r.x, r.yBot, r.z), new THREE.Vector3(r.x, cutY, r.z), kick, 1.2, r);    // alt parça: tabliye çubuğundan sarkar
    if (!silent) {
      sound.playRopeSnap && sound.playRopeSnap();
      if (this.world.onScoreGain) this.world.onScoreGain(30, '+30 İP KOPTU');
      this._kick(r.z > 0 ? 1 : -1);
      this._markDirty();
    }
  }

  _makeChain(pin, free, kick, speed, lowerOf = null) {
    const nodes = [];
    for (let i = 0; i <= CHAIN_N; i++) {
      const p = pin.clone().lerp(free, i / CHAIN_N);
      nodes.push({ p, q: p.clone() });
    }
    const len = pin.distanceTo(free) / CHAIN_N;
    // Kopma anındaki geri çarpma: serbest uç savrulur
    const tip = nodes[CHAIN_N];
    tip.q.copy(tip.p).addScaledVector(kick, -speed * 0.016);
    tip.q.y += (lowerOf ? 0.02 : -0.01);
    const meshes = [];
    for (let i = 0; i < CHAIN_N; i++) { const m = new THREE.Mesh(this.ropeGeo, this.ropeMat); this.world.scene.add(m); meshes.push(m); }
    this.chains.push({ nodes, len, meshes, t: 0, lowerOf });
  }

  _stepChains(dt) {
    const g = GRAV * dt * dt, up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), mid = new THREE.Vector3();
    for (const c of this.chains) {
      const n = c.nodes;
      for (let i = 1; i <= CHAIN_N; i++) {                 // 0: sabitlenmiş uç
        const k = n[i], vx = (k.p.x - k.q.x) * 0.992, vy = (k.p.y - k.q.y) * 0.992, vz = (k.p.z - k.q.z) * 0.992;
        k.q.copy(k.p); k.p.x += vx; k.p.y += vy - g; k.p.z += vz;
      }
      for (let it = 0; it < 8; it++) {
        for (let i = 0; i < CHAIN_N; i++) {
          const a = n[i], b = n[i + 1];
          v.subVectors(b.p, a.p); const d = v.length() || 1e-6, diff = (d - c.len) / d;
          if (i === 0) b.p.addScaledVector(v, -diff); else { a.p.addScaledVector(v, diff * 0.5); b.p.addScaledVector(v, -diff * 0.5); }
        }
      }
      for (let i = 0; i < CHAIN_N; i++) {
        const a = n[i].p, b = n[i + 1].p, m = c.meshes[i];
        v.subVectors(b, a); const len = v.length();
        mid.addVectors(a, b).multiplyScalar(0.5);
        m.position.copy(mid); m.scale.set(ROPE_R, len, ROPE_R);
        m.quaternion.setFromUnitVectors(up, v.divideScalar(len || 1));
      }
      c.t += dt;
    }
  }

  // ── Sallanma ──
  _kick(side) {
    const s = this.sway, amp1 = 0.14, amp2 = 0.07, ar = 0.07 * side;
    const w1 = 2 * Math.PI * 0.55, w2 = 2 * Math.PI * 1.1, wr = 2 * Math.PI * 0.9;
    const sgn = Math.random() < 0.5 ? -1 : 1;
    s.v1 = clamp(s.v1 + sgn * amp1 * w1, -0.3 * w1, 0.3 * w1);
    s.v2 = clamp(s.v2 + sgn * amp2 * w2, -0.15 * w2, 0.15 * w2);
    s.vr = clamp(s.vr + ar * wr, -0.14 * wr, 0.14 * wr);
    s.active = true;
    if (this.time - (this.creakT ?? -9) > 1.2) { this.creakT = this.time; sound.playBridgeCreak && sound.playBridgeCreak(); }
  }

  _stepSway(dt) {
    const s = this.sway;
    const w1 = 2 * Math.PI * 0.55, w2 = 2 * Math.PI * 1.1, wr = 2 * Math.PI * 0.9, z = 0.28;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / sub;
    for (let i = 0; i < sub; i++) {
      s.v1 += (-w1 * w1 * s.a1 - 2 * z * w1 * s.v1) * h; s.a1 += s.v1 * h;
      s.v2 += (-w2 * w2 * s.a2 - 2 * z * w2 * s.v2) * h; s.a2 += s.v2 * h;
      s.vr += (-wr * wr * s.r - 2 * z * wr * s.vr) * h; s.r += s.vr * h;
    }
    const still = Math.abs(s.a1) + Math.abs(s.a2) + Math.abs(s.r) < 0.004 && Math.abs(s.v1) + Math.abs(s.v2) + Math.abs(s.vr) < 0.02;
    if (still) { s.a1 = s.a2 = s.r = s.v1 = s.v2 = s.vr = 0; s.active = false; }
    const span = this.xe - this.xs;
    const dy = (x, zz) => { const u = clamp((x - this.xs) / span, 0, 1); return s.a1 * Math.sin(Math.PI * u) + s.a2 * Math.sin(2 * Math.PI * u) + s.r * (zz / 3.5) * Math.sin(Math.PI * u); };
    const d = this.dummy;
    for (const g of this.groups) {
      for (const v of g.list) {
        if (!v.active || v.mesh !== g.mesh) continue;
        d.position.set(v.x, v.y + (s.active ? dy(v.x, v.z) : 0), v.z); d.updateMatrix();
        g.mesh.setMatrixAt(v.instanceIdx, d.matrix);
      }
      g.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.ropes) if (r.alive) this._poseRope(r, s.active ? dy(r.x, Math.sign(r.z) * 3.75) : 0);
  }

  // ── Destek değerlendirmesi: asılı kalamayan tabliye menteşelenip kopar ──
  _evaluate() {
    const w = this.world, vox = w.voxels;
    // Üst ucu (ana kablo küpü) yok olan ip de kopar
    for (const r of this.ropes) if (r.alive) { const t = vox.get(r.topKey); if (!t || !t.active) this.cutRope(r, new THREE.Vector3(r.x, r.yTop - 0.3, r.z), null, true); }
    const ixs = Array.from(this.deckCols.keys()).sort((a, b) => a - b);
    if (!ixs.length) return;
    const lo = ixs[0], hi = ixs[ixs.length - 1], N = hi - lo + 1;
    const intact = new Array(N), dist = new Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) { const c = this.deckCols.get(lo + i); intact[i] = !!c && c.road >= Math.max(6, 0.2 * c.init); }
    // Bağlı olduğu tabliye kolonu kırılmış ip de boşa sarkar: kopar
    for (const r of this.ropes) if (r.alive && !intact[r.ix - lo]) this.cutRope(r, new THREE.Vector3(r.x, (r.yTop + r.yBot) / 2, r.z), null, true);
    const anchor = (i) => { if (i >= 0 && i < N && intact[i]) dist[i] = 0; };
    anchor(0); anchor(1); anchor(N - 1); anchor(N - 2);                                  // kıyı ayakları
    for (const tc of this.towerCols) {                                                   // kule: bacak sağlamsa
      const ok = [-9, 9].some(iz => { const v = vox.get(key(tc, 2, iz)); return v && v.active; });
      if (ok) for (let d = -2; d <= 2; d++) anchor(tc - lo + d);
    }
    for (const r of this.ropes) if (r.alive) for (let d = -1; d <= 1; d++) anchor(r.ix - lo + d);   // sağlam ip
    for (let i = 1; i < N; i++) if (intact[i] && intact[i - 1]) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    for (let i = N - 2; i >= 0; i--) if (intact[i] && intact[i + 1]) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    const held = (i) => i >= 0 && i < N && intact[i] && dist[i] <= HOLD;
    let spawned = 0;
    for (let i = 0; i < N && spawned < 2;) {
      if (!intact[i] || held(i)) { i++; continue; }
      let j = i; while (j + 1 < N && intact[j + 1] && !held(j + 1)) j++;
      this._dropRun(lo + i, lo + j, held(i - 1), held(j + 1));
      spawned++;
      i = j + 1;
    }
  }

  _dropRun(c0, c1, leftHeld, rightHeld) {
    const list = [];
    for (const g of this.groups) for (const v of g.list) if (v.active && v.mesh === g.mesh && v.ix >= c0 && v.ix <= c1) list.push(v);
    if (!list.length) return;
    for (const r of this.ropes) if (r.alive && r.ix >= c0 && r.ix <= c1) this.cutRope(r, new THREE.Vector3(r.x, (r.yTop + r.yBot) / 2, r.z), null, true);
    const opts = { creak: 0 };
    if (leftHeld && !rightHeld) opts.hinge = { dx: 1, dz: 0, px: (c0 - 0.5) * S, py: 0, pz: 0 };       // sol uçtan menteşeli, sağa doğru sarkar
    else if (rightHeld && !leftHeld) opts.hinge = { dx: -1, dz: 0, px: (c1 + 0.5) * S, py: 0, pz: 0 };
    else opts.creak = 0.4;
    for (let c = c0; c <= c1; c++) { const col = this.deckCols.get(c); if (col) col.road = 0; }
    this.world.collapse.spawnChunk(list, opts);
    sound.playBridgeCreak && sound.playBridgeCreak();
  }

  update(dt) {
    this.time += dt;
    if (this.chains.length) this._stepChains(dt);
    if (this.sway.active) this._stepSway(dt);
    if (this.dirty && this.time - this.dirtyT > 0.25) { this.dirty = false; this._evaluate(); }
  }
}
