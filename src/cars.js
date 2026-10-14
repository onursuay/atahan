import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './config.js';
const BRIDGE_Y = 0.5; // köprü tabliyesi artık zeminle aynı hizada (üst yüz 0.5 m)

// ─────────────────────────────────────────────────────────────────────────────
// NPC ARABALAR: yol ağında (caddeler, sokaklar, otoyol, köprü) sağ şeritte giderler. Kavşaklarda düz devam eder
// ya da sağa/sola yuvarlak bir yayla dönerler; yolun ucunda U dönüşü yaparlar. Üç tür: spor, mini ve sedan.
// İçlerinde sürücü görünür. Minigunla vurulunca durup dumanlanır; patlamayla/roketle vurulursa yanan enkaz olur.
// ─────────────────────────────────────────────────────────────────────────────
const CAR_COUNT = 24;
const U = 0.75;                      // eski birim -> metre
const TURN_R = 4.2;                  // dönüş yarıçapı (m)
const COLORS = [0xdc2626, 0xf59e0b, 0xfacc15, 0x2563eb, 0x16a34a, 0xf3f4f6, 0x111827, 0x9333ea, 0xf97316, 0x06b6d4, 0xe11d48, 0x84cc16];
const PASTELS = [0xfda4af, 0x93c5fd, 0xfde68a, 0x86efac, 0xc4b5fd, 0xfdba74, 0x67e8f9];

const TYPES = {
  sport: { len: 4.4, wid: 1.85, h: 1.05, speed: [17, 23], hp: 28 },
  mini:  { len: 2.7, wid: 1.45, h: 1.35, speed: [8, 11],  hp: 18 },
  sedan: { len: 4.3, wid: 1.8,  h: 1.35, speed: [12, 16], hp: 24 }
};

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1e293b, transparent: true, opacity: 0.55 });
const darkMat = lam(0x0f172a), lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 }), tailMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
const skins = [0xe0ac86, 0xc68642, 0x8d5524, 0xf1c27d, 0xffdbac], shirts = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

// Araç modeli (+x ileri). Boyutlar metre.
function buildCar(kind, color) {
  const T = TYPES[kind], g = new THREE.Group();
  g.rotation.order = 'YZX';   // önce yönelim (y), sonra aracın kendi ekseninde eğim (z: rampada burun kalkar)
  const body = lam(color);
  const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
  if (kind === 'sport') {
    add(box(T.len, 0.5, T.wid), body, 0, 0.5, 0);                      // alçak gövde
    add(box(1.6, 0.4, T.wid - 0.35), body, 1.0, 0.82, 0);              // ön kaput eğimi
    add(box(1.7, 0.5, T.wid - 0.3), glassMat, -0.2, 0.95, 0);          // kabin camı
    add(box(1.0, 0.1, T.wid - 0.5), body, -0.2, 1.22, 0);              // tavan
    add(box(0.3, 0.38, T.wid), body, -2.1, 1.0, 0);                    // spoyler
    add(box(0.12, 0.3, 0.12), darkMat, -2.0, 0.78, 0.55); add(box(0.12, 0.3, 0.12), darkMat, -2.0, 0.78, -0.55);
  } else if (kind === 'mini') {
    add(box(T.len, 0.7, T.wid), body, 0, 0.62, 0);                     // kısa, yüksek gövde
    add(box(1.7, 0.7, T.wid - 0.15), glassMat, -0.1, 1.28, 0);         // geniş cam kabin
    add(box(1.55, 0.1, T.wid - 0.25), body, -0.1, 1.68, 0);
  } else {
    add(box(T.len, 0.65, T.wid), body, 0, 0.62, 0);
    add(box(2.2, 0.6, T.wid - 0.2), glassMat, -0.2, 1.22, 0);
    add(box(1.9, 0.1, T.wid - 0.3), body, -0.2, 1.56, 0);
  }
  const wy = 0.32, wx = T.len * 0.31, wz = T.wid / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.62, 0.64, 0.28), darkMat, sx * wx, wy, sz * wz);
  add(box(0.08, 0.2, 0.4), lightMat, T.len / 2, 0.62, 0.55); add(box(0.08, 0.2, 0.4), lightMat, T.len / 2, 0.62, -0.55);
  add(box(0.08, 0.2, 0.4), tailMat, -T.len / 2, 0.62, 0.55); add(box(0.08, 0.2, 0.4), tailMat, -T.len / 2, 0.62, -0.55);
  // Sürücü (ve bazen yolcu): kabin camının arkasında görünür
  const person = (z) => {
    const y = kind === 'sport' ? 0.98 : 1.28;
    add(box(0.3, 0.3, 0.3), lam(pick(skins)), -0.1, y + 0.18, z).userData.person = true;
    add(box(0.34, 0.34, 0.26), lam(pick(shirts)), -0.1, y - 0.08, z).userData.person = true;
  };
  person(0.35);
  if (Math.random() < 0.4) person(-0.35);
  // Demir iskelet (şasi + güvenlik kafesi): paneller uçsa da kalır, çok daha zor kırılır
  const steel = lam(0x3b4350);
  const frame = add(box(T.len * 0.92, 0.16, T.wid * 0.74), steel, 0, 0.4, 0); frame.userData.iron = true;
  const cy = kind === 'sport' ? 0.95 : 1.2;
  for (const px of [-0.9, 0.55]) for (const pz of [-1, 1]) add(box(0.07, 0.62, 0.07), steel, px, cy, pz * (T.wid / 2 - 0.2)).userData.iron = true;
  g.userData.panels = g.children.filter(m => m.material === body || m.material === glassMat);
  return g;
}

export class CarManager {
  constructor(scene, voxelWorld, particleSystem, onScore, onHitPlayer) {
    this.scene = scene; this.vw = voxelWorld; this.ps = particleSystem;
    this.onScore = onScore; this.onHitPlayer = onHitPlayer;
    this.cars = []; this.nodes = new Map(); this.edges = []; this.respawn = [];
    this.player = new THREE.Vector3(); this.hitCooldown = 0;
    this.driven = null;
  }

  // ── Yol ağı ──
  build() {
    this.clear();
    // [x0,z0,x1,z1, şerit sayısı, şerit ofseti (m)] metre
    // Yollar kıyıdan 9 m önce biter: çıkmaz uçta U dönüşü denize taşmasın
    const R = [
      [-140*U, 0, 160, 0, 1, 2.0, 'noMerge'],                                  // ana cadde: batı ada + köprü + doğu ada (üst geçitten geçer)
      [-140*U, 66*U, -13, 66*U, 1, 2.06], [-140*U, -66*U, -13, -66*U, 1, 2.06],
      [-140*U, 134*U, -13, 134*U, 1, 2.06], [-140*U, -134*U, -13, -134*U, 1, 2.06],
      [-127*U, -112, -127*U, 112, 1, 1.7], [-87*U, -112, -87*U, 112, 1, 1.7],
      [-47*U, -112, -47*U, 112, 1, 1.7], [-27*U, -112, -27*U, 112, 1, 1.7],
      [82*U, 44*U, 176*U, 44*U, 1, 2.06], [82*U, -44*U, 176*U, -44*U, 1, 2.06],
      [82*U, 88*U, 100*U, 88*U, 1, 2.06], [82*U, -88*U, 100*U, -88*U, 1, 2.06], // hastane/AVM'nin içinden geçmez
      [82*U, 134*U, 176*U, 134*U, 1, 2.06], [82*U, -134*U, 176*U, -134*U, 1, 2.06],
      [125*U, -112, 125*U, 112, 3, 1.75],                                      // otoyol: her yönde 3 şerit
      [199*U, -45, 199*U, 45, 1, 1.0]
    ];
    this.roads = R.map((r, i) => ({ id: i, a: [r[0], r[1]], b: [r[2], r[3]], lanes: r[4], off: r[5], noMerge: r[6] === 'noMerge' }));

    const key = (x, z) => `${Math.round(x * 4)},${Math.round(z * 4)}`;
    const node = (x, z) => { const k = key(x, z); if (!this.nodes.has(k)) this.nodes.set(k, { x, z, out: [] }); return this.nodes.get(k); };

    this.roads.forEach(r => {
      const hz = r.a[1] === r.b[1];                        // yatay (x boyunca) mı
      const pts = [r.a, r.b];
      this.roads.forEach(o => {
        if (o === r) return;
        const oh = o.a[1] === o.b[1];
        if (oh === hz) return;
        const x = hz ? o.a[0] : r.a[0], z = hz ? r.a[1] : o.a[1];
        const inR = hz ? (x >= Math.min(r.a[0], r.b[0]) - 0.01 && x <= Math.max(r.a[0], r.b[0]) + 0.01) : (z >= Math.min(r.a[1], r.b[1]) - 0.01 && z <= Math.max(r.a[1], r.b[1]) + 0.01);
        const inO = oh ? (x >= Math.min(o.a[0], o.b[0]) - 0.01 && x <= Math.max(o.a[0], o.b[0]) + 0.01) : (z >= Math.min(o.a[1], o.b[1]) - 0.01 && z <= Math.max(o.a[1], o.b[1]) + 0.01);
        if (inR && inO) pts.push([x, z]);
      });
      pts.sort((p, q) => hz ? p[0] - q[0] : p[1] - q[1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const A = node(pts[i][0], pts[i][1]), B = node(pts[i + 1][0], pts[i + 1][1]);
        const len = Math.hypot(B.x - A.x, B.z - A.z);
        if (len < 0.5) continue;
        const d = [(B.x - A.x) / len, (B.z - A.z) / len];
        const e1 = { from: A, to: B, len, d, road: r }, e2 = { from: B, to: A, len, d: [-d[0], -d[1]], road: r };
        A.out.push(e1); B.out.push(e2); this.edges.push(e1, e2);
      }
    });
    while (this.cars.length < CAR_COUNT) if (!this._spawn()) break;
  }

  _lanePoint(e, s, lane) {
    const right = [-e.d[1], e.d[0]];
    const off = e.road.off + lane * 3.5;
    return new THREE.Vector3(e.from.x + e.d[0] * s + right[0] * off, 0, e.from.z + e.d[1] * s + right[1] * off);
  }

  _spawn() {
    for (let tries = 0; tries < 60; tries++) {
      const e = this.edges[Math.floor(Math.random() * this.edges.length)];
      if (e.len < 14) continue;
      const lane = Math.floor(Math.random() * e.road.lanes), s = rnd(6, e.len - 6);
      if (this.cars.some(c => c.edge === e && c.lane === lane && Math.abs(c.s - s) < 10)) continue;
      const pos = this._lanePoint(e, s, lane);
      if (this.player.distanceTo(new THREE.Vector3(pos.x, this.player.y, pos.z)) < 8) continue;
      const r = Math.random(), kind = r < 0.35 ? 'sport' : r < 0.7 ? 'mini' : 'sedan';
      const color = kind === 'mini' ? pick(PASTELS) : pick(COLORS);
      const g = buildCar(kind, color);
      this.scene.add(g);
      const T = TYPES[kind];
      const car = { g, kind, T, edge: e, s, lane, speed: 0, target: rnd(T.speed[0], T.speed[1]), state: 'drive', hp: T.hp, turn: null, next: null, smoke: 0, life: 0, pos: pos.clone(), fwd: new THREE.Vector3(e.d[0], 0, e.d[1]) };
      this._chooseNext(car);
      this.cars.push(car);
      return true;
    }
    return false;
  }

  // Kavşakta ne yapılacak: düz, sağ, sol (ya da çıkmaz uçta U dönüşü)
  _chooseNext(car) {
    const e = car.edge, n = e.to;
    const opts = n.out.filter(o => !(o.to === e.from && n.out.length > 1));
    let straight = null, left = [], right = [];
    opts.forEach(o => {
      const dot = o.d[0] * e.d[0] + o.d[1] * e.d[1];
      const cross = e.d[0] * o.d[1] - e.d[1] * o.d[0];
      if (dot > 0.9) straight = o;
      else if (Math.abs(dot) < 0.2) {
        if (o.road.lanes === 1 && (e.road.lanes === 1 || cross > 0)) (cross > 0 ? right : left).push(o);   // otoyoldan yalnız sağa (çıkış)
        else if (o.road.lanes > 1 && e.road.lanes === 1 && cross > 0 && !e.road.noMerge) right.push(o);    // yan yoldan sağa dönüp otoyola katılma
      }
    });
    let pick2 = null;
    if (e.road.lanes > 1) {
      // Otoyolda: dıştaki şeritteki araç ara sıra sağdan çıkış yapar, diğerleri düz gider
      const exits = car.lane === e.road.lanes - 1 ? right.filter(o => o.road.lanes === 1) : [];
      pick2 = (exits.length && Math.random() < 0.3) ? exits[0] : straight;
    } else {
      const bag = [];
      if (straight) bag.push(straight, straight, straight);
      left.forEach(o => bag.push(o)); right.forEach(o => bag.push(o));
      pick2 = bag.length ? bag[Math.floor(Math.random() * bag.length)] : null;
    }
    if (!pick2) pick2 = n.out.length === 1 ? n.out[0] : (straight || opts[0] || n.out[0]); // çıkmaz: U dönüşü
    car.next = pick2;
    // Otoyola katılan araç dış şeride girer; otoyoldan çıkan tek şeride iner
    car.nextLane = pick2.road.lanes > e.road.lanes ? pick2.road.lanes - 1 : Math.min(car.lane, pick2.road.lanes - 1);
  }

  _beginTurn(car) {
    const e = car.edge, nx = car.next, n = e.to;
    const P0 = this._lanePoint(e, e.len - TURN_R, car.lane);
    const P2 = this._lanePoint(nx, Math.min(TURN_R, nx.len * 0.45), car.nextLane);
    const rc = [-e.d[1], e.d[0]], rn = [-nx.d[1], nx.d[0]];
    const oc = e.road.off + car.lane * 3.5, on = nx.road.off + car.nextLane * 3.5;
    let P1;
    if (nx.to === e.from) P1 = new THREE.Vector3(n.x + e.d[0] * TURN_R * 1.7, 0, n.z + e.d[1] * TURN_R * 1.7); // U dönüşü
    else P1 = new THREE.Vector3(n.x + rc[0] * oc + rn[0] * on, 0, n.z + rc[1] * oc + rn[1] * on);                // iki şerit çizgisinin kesişimi
    const arc = (P0.distanceTo(P1) + P1.distanceTo(P2)) * 0.95;
    car.turn = { P0, P1, P2, t: 0, arc };
  }

  // ── Vurulma ──
  _inside(car, p) {
    const dx = p.x - car.pos.x, dz = p.z - car.pos.z;
    const lx = dx * car.fwd.x + dz * car.fwd.z, lz = -dx * car.fwd.z + dz * car.fwd.x;
    const y = p.y - car.pos.y;
    return Math.abs(lx) < car.T.len / 2 + 0.2 && Math.abs(lz) < car.T.wid / 2 + 0.2 && y > -0.1 && y < car.T.h + 0.3;
  }

  segmentHit(a, b) {
    const seg = b.clone().sub(a), len = seg.length();
    if (len === 0) return null;
    const step = 0.4;
    for (const car of this.cars) {
      if (car.state === 'wreck') continue;
      if (car.pos.distanceTo(a) > len + 4) continue;
      for (let d = 0; d <= len; d += step) {
        const p = a.clone().addScaledVector(seg, d / len);
        if (this._inside(car, p)) return { car, point: p };
      }
    }
    return null;
  }

  rayHit(origin, dir, maxDist) { return this.segmentHit(origin, origin.clone().addScaledVector(dir, maxDist)); }

  bulletHit(car) { this._damage(car, 1); }

  // Hasar: her 2 puanda bir gövde paneli kopar; demir iskelet ancak çok ağır hasarda (hp'nin 3 katı) gider
  _damage(car, amt) {
    if (car.state === 'wreck') return;
    car.dmg = (car.dmg || 0) + amt;
    car.hp -= amt;
    car.smoke = 0;
    car.detached = car.detached || 0;
    while (car.detached < Math.floor(car.dmg / 2)) { car.detached++; this._detach(car); }
    if (car.dmg >= car.T.hp * 3) { this._wreck(car); return; }
    if (car.hp <= 0 && (car.state === 'drive')) this._disable(car);
  }

  _detach(car) {
    const panels = car.g.userData.panels.filter(m => m.visible);
    if (!panels.length) return;
    const m = panels[Math.floor(Math.random() * panels.length)];
    m.visible = false;
    const wp = car.g.localToWorld(m.position.clone());
    const col = m.material.color ? m.material.color.getHex() : 0x888888;
    const vw = this.vw;
    for (let i = 0; i < 3 && vw.dynamicDebris.length < vw.maxDynamicDebris; i++) {
      vw.spawnLooseVoxel(wp.x + (Math.random() - 0.5) * 0.5, wp.y + Math.random() * 0.4, wp.z + (Math.random() - 0.5) * 0.5,
        { color: col }, car.pos, 0.6, 3, 70);
    }
    if (this.ps.createSpark) this.ps.createSpark(wp);
  }

  _disable(car) {
    car.state = 'stopped'; car.life = 0; car.speed = 0;
    sound.playBlockHit();
    if (this.onScore) this.onScore(150, '+150 ARABA DURDURULDU!');
  }

  _wreck(car) {
    if (car.state === 'wreck') return;
    const was = car.state;
    car.state = 'wreck'; car.life = 0; car.speed = 0;
    car.g.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material !== glassMat) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.25); } });
    car.tilt = (Math.random() - 0.5) * 0.4;
    car.g.rotation.z = (car.pitch || 0) + car.tilt;
    this.ps.createExplosion(car.pos.clone().setY(car.pos.y + 0.8), 6, 0xff6a00);
    sound.playExplosion(1.0);
    if (this.onScore) this.onScore(was === 'drive' ? 250 : 100, '+ARABA PATLADI!');
  }

  hitSphere(center, radius) {
    this.cars.forEach(c => {
      if (c.state === 'wreck') return;
      const d = c.pos.distanceTo(center);
      if (d <= radius * 0.6 + 1.8) this._wreck(c);            // yakın patlama: iskelet bile dayanamaz
      else if (d <= radius + 2.5) this._damage(c, 8);          // uzak patlama: paneller kopar, araç durur
    });
  }

  // ── Güncelleme ──
  update(dt, playerPos) {
    if (!this.driven) this.player.copy(playerPos);
    this._collide(dt);
    this.hitCooldown -= dt;
    for (let i = this.respawn.length - 1; i >= 0; i--) { this.respawn[i] -= dt; if (this.respawn[i] <= 0) { this.respawn.splice(i, 1); this._spawn(); } }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car === this.driven) continue;
      if (car.state === 'drive') this._drive(car, dt);
      else if (car.state === 'parked') { car.life += dt; if (car.life > 150) { this.scene.remove(car.g); this.cars.splice(i, 1); this.respawn.push(3); continue; } }
      else {
        car.life += dt;
        car.smoke -= dt;
        if (car.smoke <= 0) {
          car.smoke = car.state === 'wreck' ? 0.05 : 0.14;
          this.ps.createThrusterTrail(car.pos.clone().setY(car.pos.y + 1.0));
          if (car.state === 'wreck') this.ps.createThrusterTrail(car.pos.clone().setY(car.pos.y + 0.6));
        }
        if (car.life > (car.state === 'wreck' ? 10 : 25)) { this.scene.remove(car.g); this.cars.splice(i, 1); this.respawn.push(3); continue; }
      }
      // Oyuncuya çarpma: savurur ve hasar verir
      if (car.state === 'drive' && car.speed > 3 && this.hitCooldown <= 0) {
        const dx = this.player.x - car.pos.x, dz = this.player.z - car.pos.z;
        if (Math.hypot(dx, dz) < car.T.len / 2 + 0.7 && Math.abs(this.player.y - car.pos.y) < 2.2 && this._inside(car, new THREE.Vector3(this.player.x, car.pos.y + 0.5, this.player.z))) {
          this.hitCooldown = 1.0;
          const d = Math.hypot(dx, dz) || 1;
          if (this.onHitPlayer) this.onHitPlayer(dx / d, dz / d, car.speed);
        }
      }
    }
  }

  // Aracın önündeki dar koridorda (≈13 m) insan var mı?
  _personAhead(car) {
    const test = (x, y, z) => {
      const dx = x - car.pos.x, dz = z - car.pos.z;
      const ahead = dx * car.fwd.x + dz * car.fwd.z, side = Math.abs(-dx * car.fwd.z + dz * car.fwd.x);
      return ahead > 0.5 && ahead < 8 + car.speed * 0.9 && side < car.T.wid / 2 + 1.1 && Math.abs(y - car.pos.y) < 2.5;
    };
    if (!this.driven && test(this.player.x, this.player.y, this.player.z)) return true;
    if (this.driven && car !== this.driven && test(this.driven.pos.x, this.driven.pos.y, this.driven.pos.z)) return true;
    const npcs = this.vw.npcs && this.vw.npcs.npcs;
    if (npcs) for (const n of npcs) if (test(n.x, n.y, n.z)) return true;
    return false;
  }

  // Yol yüzeyi yüksekliği: köprü tabliyesi 0.5, üst geçit tabliyesi 5.0, diğer yerlerde arazi
  _roadY(x, z) {
    if (Math.abs(z) < 4.5 && x > -9.2 && x < 58.7) return BRIDGE_Y;
    if (Math.abs(z) < 4.9 && x > 106 * U - 0.5 && x < 145 * U) return 5.0;   // tabliye (voxel); ramp ucu zaten 5.0
    return this.vw.terrain.heightAt(x, z);   // rampalarda basamaksız (sürekli) yükseklik
  }

  // Aracın oturduğu yüzey: ön ve arka aks noktalarındaki yüksekliğin ortalaması + eğim açısı
  _surface(car) {
    const L = car.T.len * 0.32, f = car.fwd, p = car.pos;
    const hF = this._roadY(p.x + f.x * L, p.z + f.z * L), hR = this._roadY(p.x - f.x * L, p.z - f.z * L);
    if (hF === -Infinity || hR === -Infinity) return { y: this._roadY(p.x, p.z), pitch: 0 };
    return { y: (hF + hR) / 2, pitch: Math.atan2(hF - hR, 2 * L) };
  }

  // Yüksekliği ve eğimi yüzeye oturtur; modeli yönelim + eğimle döndürür
  _place(car, dt, yaw) {
    const s = this._surface(car);
    if (s.y > -Infinity) car.pos.y = Math.abs(s.y - car.pos.y) > 3 ? s.y : car.pos.y + (s.y - car.pos.y) * Math.min(1, dt * 30);
    car.pitch = (car.pitch || 0) + (s.pitch - (car.pitch || 0)) * Math.min(1, dt * 12);
    car.g.position.copy(car.pos);
    car.g.rotation.y = yaw;
    car.g.rotation.z = car.pitch + (car.tilt || 0);
  }

  // Önündeki yolda başka araç varsa (araya girene de) durur; uzun bekleyen araç bir süre kontrolü bırakır
  _carAhead(car) {
    for (const o of this.cars) {
      if (o === car || o.state === 'wreck' && false) continue;
      const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
      const ahead = dx * car.fwd.x + dz * car.fwd.z, side = Math.abs(-dx * car.fwd.z + dz * car.fwd.x);
      if (ahead > 0.3 && ahead < (car.T.len / 2 + o.T.len / 2 + 2.5 + car.speed * 0.7) && side < (car.T.wid + o.T.wid) / 2 + 0.5 && Math.abs(o.pos.y - car.pos.y) < 1.5) return true;
    }
    return false;
  }

  _drive(car, dt) {
    if (car.crash > 0) { car.crash -= dt; car.speed *= Math.exp(-6 * dt); return; }   // kazadan sonra bir süre bekler
    // Önünde aynı şeritte araç varsa yavaşla ya da dur
    let limit = car.target;
    for (const o of this.cars) {
      if (o === car || o.edge !== car.edge || o.lane !== car.lane) continue;
      const gap = o.s - car.s;
      if (gap > 0 && gap < 11) limit = Math.min(limit, o.state === 'drive' ? Math.max(0, o.speed * (gap / 11)) : 0);
    }
    // Önüne biri çıkarsa (oyuncu ya da yaya) araba durur
    if (this._personAhead(car)) limit = 0;
    // Yoluna biri girerse (kesilirse) dur; 3 sn'den uzun beklediysek 2 sn önceliği bırakma (kilitlenme olmasın)
    if (car.ignoreT > 0) car.ignoreT -= dt;
    else if (this._carAhead(car)) {
      limit = 0; car.waitT = (car.waitT || 0) + dt;
      if (car.waitT > 3) { car.waitT = 0; car.ignoreT = 2; }
    } else car.waitT = 0;
    const turning = !!car.turn;
    const cap = turning ? Math.min(limit, 8) : limit;
    car.speed += (cap - car.speed) * Math.min(1, dt * (cap < car.speed ? 3.5 : 1.4));

    if (turning) {
      const t = car.turn;
      t.t = Math.min(1, t.t + (car.speed * dt) / t.arc);
      const u = t.t, a = 1 - u;
      const p = new THREE.Vector3(a * a * t.P0.x + 2 * a * u * t.P1.x + u * u * t.P2.x, 0, a * a * t.P0.z + 2 * a * u * t.P1.z + u * u * t.P2.z);
      const tx = 2 * a * (t.P1.x - t.P0.x) + 2 * u * (t.P2.x - t.P1.x), tz = 2 * a * (t.P1.z - t.P0.z) + 2 * u * (t.P2.z - t.P1.z);
      car.fwd.set(tx, 0, tz).normalize();
      car.pos.x = p.x; car.pos.z = p.z;
      if (u >= 1) {
        car.edge = car.next; car.lane = car.nextLane; car.s = Math.min(TURN_R, car.edge.len * 0.45);
        car.turn = null; this._chooseNext(car);
      }
    } else {
      car.s += car.speed * dt;
      const e = car.edge, p = this._lanePoint(e, car.s, car.lane);
      car.pos.x = p.x; car.pos.z = p.z; car.fwd.set(e.d[0], 0, e.d[1]);
      if (car.s >= e.len - TURN_R) this._beginTurn(car);
    }

    // Yükseklik ve eğim: yol yüzeyi (köprüde tabliye, rampada eğim)
    this._place(car, dt, -Math.atan2(car.fwd.z, car.fwd.x));
  }

  // ── ARAÇ-ARAÇ ÇARPIŞMASI ──
  _collide(dt) {
    const L = this.cars;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      a.collT = Math.max(0, (a.collT || 0) - dt);
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if ((a.collT > 0 && b.collT > 0) || (a.state === 'wreck' && b.state === 'wreck')) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz > 30) continue;
        const lx = dx * a.fwd.x + dz * a.fwd.z, lz = -dx * a.fwd.z + dz * a.fwd.x;
        if (Math.abs(lx) > (a.T.len + b.T.len) * 0.43 || Math.abs(lz) > (a.T.wid + b.T.wid) * 0.46) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const va = a === this.driven ? a.speed : (a.state === 'drive' ? a.speed : 0);
        const vb = b === this.driven ? b.speed : (b.state === 'drive' ? b.speed : 0);
        const rx = a.fwd.x * va - b.fwd.x * vb, rz = a.fwd.z * va - b.fwd.z * vb;
        const rel = Math.hypot(rx, rz);
        if (rel < 1.5) continue;
        a.collT = b.collT = 0.9;
        [a, b].forEach(c => {
          if (c.state === 'wreck') return;
          this._damage(c, rel * 0.45);
          if (c === this.driven) { c.speed = -c.speed * 0.3; if (this.onCrash) this.onCrash(rel * 0.7); }
          else if (c.state === 'drive') { c.crash = 1.6; c.speed *= 0.2; }
        });
        const mid = new THREE.Vector3((a.pos.x + b.pos.x) / 2, Math.max(a.pos.y, b.pos.y) + 0.7, (a.pos.z + b.pos.z) / 2);
        if (this.ps.createSpark) { this.ps.createSpark(mid); this.ps.createSpark(mid); }
        sound.playBlockHit();
      }
    }
  }

  // ── ARABAYA BİNME / SÜRME ──
  nearestEnterable(pos, maxDist = 4.5) {
    let best = null, bd = maxDist;
    for (const c of this.cars) {
      if (c.state !== 'drive' && c.state !== 'parked') continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < bd && Math.abs(c.pos.y - pos.y) < 3) { bd = d; best = c; }
    }
    return best;
  }

  enter(car) {
    this.driven = car;
    car.state = 'driven'; car.turn = null; car.speed = Math.max(0, Math.min(car.speed, 6));
    car.heading = Math.atan2(car.fwd.z, car.fwd.x);
    car.g.traverse(o => { if (o.userData.person) o.visible = false; });   // sürücü inerken kaybolur
    sound.playBlockHit();
  }

  // Oyuncuyu arabanın soluna indirir; araba park halinde kalır
  exit() {
    const car = this.driven;
    if (!car) return null;
    this.driven = null;
    car.state = 'parked'; car.life = 0; car.speed = 0; car.edge = null; car.turn = null;
    const left = new THREE.Vector3(car.fwd.z, 0, -car.fwd.x);
    return car.pos.clone().addScaledVector(left, car.T.wid / 2 + 1.0).setY(car.pos.y);
  }

  // WASD ile sürüş: W/S gaz ve fren-geri, A/D direksiyon, Boşluk el freni
  updateDriven(dt, input) {
    const car = this.driven;
    if (!car) return;
    const T = car.T, maxSpeed = T.speed[1] * 1.4, acc = T.speed[1] * 0.75;
    if (input.forward) car.speed += acc * dt * (1 - Math.max(0, car.speed) / (maxSpeed * 1.05));
    else if (input.backward) car.speed -= (car.speed > 0 ? 24 : 8) * dt;
    else car.speed *= Math.exp(-0.45 * dt);
    if (input.jump) car.speed *= Math.exp(-4 * dt);
    car.speed = Math.max(-7, Math.min(maxSpeed, car.speed));

    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sa = 0.62 / (1 + Math.abs(car.speed) / 11);
    car.heading += steer * car.speed * Math.tan(sa) / (T.len * 0.62) * dt;
    car.fwd.set(Math.cos(car.heading), 0, Math.sin(car.heading));

    // Çarpışma: ön/arka köşeler binaya, kara dışına ya da dik yamaca çarparsa durur
    const dir = Math.sign(car.speed) || 1, half = T.len / 2 + 0.25;
    const nx = car.pos.x + car.fwd.x * car.speed * dt, nz = car.pos.z + car.fwd.z * car.speed * dt;
    const px = nx + car.fwd.x * half * dir, pz = nz + car.fwd.z * half * dir;
    const side = [-car.fwd.z, car.fwd.x];
    let blocked = false, hitVox = null;
    for (const so of [-1, 0, 1]) {
      const qx = px + side[0] * so * (T.wid / 2 - 0.1), qz = pz + side[1] * so * (T.wid / 2 - 0.1);
      // Engel taraması zemine göre: rampada/tabliye başında ön köşe zeminin 0.4 ve 1.0 m üstünden bakar
      const hp = this._roadY(qx, qz);
      const base = hp === -Infinity ? car.pos.y : Math.max(car.pos.y - 0.9, Math.min(car.pos.y + 0.9, hp));
      for (const hy of [0.4, 1.0]) {
        const y = base + hy;
        const v = this.vw.voxels.get(`${Math.round(qx / VOXEL_SIZE)},${Math.round((y - VOXEL_SIZE / 2) / VOXEL_SIZE)},${Math.round(qz / VOXEL_SIZE)}`);
        if (v && v.active) { blocked = true; hitVox = { x: qx, y, z: qz }; }
      }
      // Zemin: kara dışı ya da kısa mesafede ani yükselme (set/duvar) engeldir; eğim (rampa) engel değildir
      const h = this._roadY(qx, qz), hb = this._roadY(qx - car.fwd.x * dir * 0.6, qz - car.fwd.z * dir * 0.6);
      if (h === -Infinity || (hb > -Infinity && h - hb > 0.65)) blocked = true;
    }
    if (blocked) {
      const impact = Math.abs(car.speed);
      if (hitVox && impact > 9) {                         // hızlı çarpışma duvarı/yapıyı kırar
        this.vw.sweepCut(new THREE.Vector3(hitVox.x, hitVox.y, hitVox.z), 1.1);
        this.vw.sweepCut(new THREE.Vector3(hitVox.x + car.fwd.x * dir * 0.8, hitVox.y, hitVox.z + car.fwd.z * dir * 0.8), 1.0);
        sound.playExplosion(0.5);
        if (this.onCrash) this.onCrash(impact);
      }
      car.speed = -car.speed * 0.25;
    } else {
      car.pos.x = nx; car.pos.z = nz;
    }

    // Yaya ezme
    if (Math.abs(car.speed) > 4 && this.vw.npcs) this.vw.npcs.hitSphere(car.pos.clone().addScaledVector(car.fwd, half * dir), 1.1);

    this._place(car, dt, -car.heading);
    this.player.copy(car.pos);
  }

  clear() {
    this.driven = null;
    this.cars.forEach(c => this.scene.remove(c.g));
    this.cars = []; this.nodes = new Map(); this.edges = []; this.respawn = [];
  }
}
