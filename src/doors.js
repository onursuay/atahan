import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// KAPILAR
//  • Menteşeli kapı (bina girişleri): açısı ve açısal hızı vardır; sürtünmeyle durur, bırakılınca eylemsizlikle biraz
//    daha gider. Oyuncu SAĞ TIK'ı basılı tutup fareyi SÜRÜKLEYEREK açar/kapatır (tek tıklama bir şey yapmaz).
//  • Sürgülü otomatik kapı (AVM): iki kanat; biri (oyuncu, yaya ya da araç) yaklaşınca yanlara kayar, uzaklaşınca kapanır.
//  • Kapalı (ya da aralık) kapı oyuncuyu ve yayaları engeller; mermi, roket/patlama, çekiç, ışın kılıcı ve hızlı araç
//    kapıyı kırar: parçalar orta boy döküntü olarak savrulur.
// Kapılar voxel değildir; ayrı nesnelerdir ve çarpışma testleri döndürülmüş dikdörtgenle yapılır.
// ─────────────────────────────────────────────────────────────────────────────
const THICK = 0.14;               // kapı kalınlığı (m)
const ANGLE_LIMIT = 1.75;         // menteşeli kapı en çok ±100° açılır
const DRAG_GAIN = 0.012;          // fare pikseli → metre
const DOOR_HP = 14;               // tabanca 3 mermi ≈ 5 atışta kırar; patlama bir vuruşta
const REACH = 3.8;                // sağ tıkla kapıyı tutma menzili (m)

export class DoorSystem {
  constructor(scene, voxelWorld) {
    this.scene = scene; this.vw = voxelWorld;
    this.doors = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.drag = null;             // { door, s, lastT } — sağ tıkla tutulan kapı
    this.woodMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    this.darkMat = new THREE.MeshLambertMaterial({ color: 0x2b2118 });
    this.insetMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });   // kapı panelleri: kapıdan biraz koyu ahşap
    this.glassMat = new THREE.MeshLambertMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.45 });
    this.frameMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    this.ironMat = new THREE.MeshLambertMaterial({ color: 0x1f2328 });
    this.goldMat = new THREE.MeshLambertMaterial({ color: 0xd4a017 });
  }

  clear() {
    this.doors.forEach(d => { this.group.remove(d.root); });
    this.doors = [];
    this.drag = null;
  }

  // ── Kapı ekleme ──
  // Menteşeli kapı: (hx,hz) menteşe noktası; (ax,az) kapının kapalıyken uzandığı birim yön; width/height/y metre.
  addHinged({ hx, hz, ax, az, width, height, y }) {
    const root = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, THICK), this.woodMat);
    panel.position.set(width / 2, height / 2, 0);
    panel.castShadow = true;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.22), this.darkMat);
    handle.position.set(width - 0.25, height * 0.45, 0);
    const handle2 = handle.clone(); handle2.position.z = 0;
    root.add(panel, handle);
    // kapı üzerine kasnak çizgileri (panel görünümü)
    for (const f of [0.25, 0.75]) {
      const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, height * 0.32, THICK + 0.03), this.insetMat);
      inset.position.set(width / 2, height * f, 0);
      root.add(inset);
    }
    root.position.set(hx, y, hz);
    this.group.add(root);
    const d = { kind: 'hinged', root, hx, hz, ax, az, width, height, y, angle: 0, vel: 0, hp: DOOR_HP, broken: false };
    this._pose(d);
    this.doors.push(d);
    return d;
  }

  // Sürgülü otomatik kapı: (sx,sz) kapı açıklığının başlangıcı; (ax,az) açıklık boyunca birim yön; iki kanat yarım genişlikte
  // gate: true → demir araç kapısı (kanatlar çubuklu); yalnız oyuncu ve araçlarla açılır, yayalar için hep kapalıdır
  addSliding({ sx, sz, ax, az, width, height, y, gate = false }) {
    const root = new THREE.Group();
    const half = width / 2 - 0.05;
    const mkGate = (cx) => {
      const g = new THREE.Group();
      const bar = (w, h, d, x, yy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.ironMat); m.position.set(x, yy, 0); m.castShadow = true; g.add(m); return m; };
      bar(half, 0.14, 0.1, 0, height - 0.12); bar(half, 0.14, 0.1, 0, 0.2); bar(half, 0.1, 0.1, 0, height * 0.5);
      bar(0.14, height - 0.1, 0.1, cx > 0 ? -half / 2 + 0.07 : half / 2 - 0.07, height / 2); bar(0.14, height - 0.1, 0.1, cx > 0 ? half / 2 - 0.07 : -half / 2 + 0.07, height / 2);
      const n = Math.max(3, Math.round(half / 0.32));
      for (let i = 1; i < n; i++) {
        const x = -half / 2 + (half * i) / n;
        bar(0.06, height - 0.3, 0.06, x, height / 2);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.09), this.goldMat); tip.position.set(x, height - 0.02, 0); g.add(tip);
      }
      return g;
    };
    const mk = (cx) => {
      if (gate) return mkGate(cx);
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.BoxGeometry(half, height - 0.1, 0.06), this.glassMat);
      glass.position.set(0, height / 2, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(half + 0.06, 0.12, 0.1), this.frameMat);
      frame.position.set(0, height - 0.05, 0);
      const stile = new THREE.Mesh(new THREE.BoxGeometry(0.1, height, 0.1), this.frameMat);
      stile.position.set(cx > 0 ? -half / 2 : half / 2, height / 2, 0);
      g.add(glass, frame, stile);
      return g;
    };
    const a = mk(-1), b = mk(1);
    root.add(a, b);
    root.position.set(sx, y, sz);
    root.rotation.y = -Math.atan2(az, ax);
    this.group.add(root);
    const d = { kind: 'sliding', gate, root, a, b, sx, sz, ax, az, width, height, y, open: 0, target: 0, hold: 0, hp: DOOR_HP * (gate ? 6 : 1.5), broken: false, wasMoving: false };
    this._pose(d);
    this.doors.push(d);
    return d;
  }

  // Kapı kanatlarının dünyadaki dikdörtgenleri: [başlangıç x, z, yön x, z, uzunluk, kalınlık]
  _rects(d, closed = false) {
    if (d.kind === 'hinged') {
      const c = Math.cos(d.angle), s = Math.sin(d.angle);
      const dx = d.ax * c + (-d.az) * s, dz = d.az * c + d.ax * s;
      return [[d.hx, d.hz, dx, dz, d.width, THICK]];
    }
    const half = d.width / 2, shift = (closed ? 0 : d.open) * half;
    const px = -d.az, pz = d.ax;                     // açıklığın dik yönü (kanatlar çerçevenin 0.2 m içinde kayar)
    const off = 0.15;
    return [
      [d.sx + d.ax * (-shift) + px * off, d.sz + d.az * (-shift) + pz * off, d.ax, d.az, half, 0.08],
      [d.sx + d.ax * (half + shift) + px * off, d.sz + d.az * (half + shift) + pz * off, d.ax, d.az, half, 0.08]
    ];
  }

  _pose(d) {
    if (d.kind === 'hinged') {
      const c = Math.cos(d.angle), s = Math.sin(d.angle);
      const dx = d.ax * c + (-d.az) * s, dz = d.az * c + d.ax * s;
      d.root.rotation.y = -Math.atan2(dz, dx);
    } else {
      const half = d.width / 2, shift = d.open * half;
      d.a.position.set(half / 2 - shift, 0, 0.15);
      d.b.position.set(half + half / 2 + shift, 0, 0.15);
    }
  }

  // Noktanın (x,z) bir dikdörtgene uzaklığı (yatay düzlemde)
  _rectDist(r, x, z) {
    const px = x - r[0], pz = z - r[1];
    const s = px * r[2] + pz * r[3];
    const n = px * (-r[3]) + pz * r[2];
    const ds = Math.max(-s, 0, s - r[4]), dn = Math.max(Math.abs(n) - r[5] / 2, 0);
    return Math.hypot(ds, dn);
  }

  _near(d, x, z, pad) {
    const cx = d.kind === 'hinged' ? d.hx : d.sx, cz = d.kind === 'hinged' ? d.hz : d.sz;
    return Math.hypot(x - cx, z - cz) <= d.width + pad + 0.5;
  }

  // ── Çarpışma ──
  // Dairesel gövde (x,z,halfW), ayak yüksekliği feetY, boy bodyH kapıya giriyor mu?
  // closedGates: yayalar için araç kapıları açıkken de kapalı sayılır
  blocks(x, feetY, z, halfW, bodyH, closedGates = false) {
    for (const d of this.doors) {
      if (d.broken || !this._near(d, x, z, halfW)) continue;
      if (feetY + bodyH < d.y || feetY > d.y + d.height) continue;
      for (const r of this._rects(d, closedGates && d.gate)) if (this._rectDist(r, x, z) < halfW) return true;
    }
    return false;
  }

  // Nokta bir kapının içinde mi? (araç köşe taraması). Kapıyı döndürür.
  doorAt(x, y, z, pad = 0.1) {
    for (const d of this.doors) {
      if (d.broken || !this._near(d, x, z, pad)) continue;
      if (y < d.y || y > d.y + d.height) continue;
      for (const r of this._rects(d)) if (this._rectDist(r, x, z) < pad + r[5] / 2) return d;
    }
    return null;
  }

  // Işın / parça: ilk vurulan kapıyı ve noktayı döndürür
  rayHit(origin, dir, maxDist) {
    const near = this.doors.filter(d => !d.broken && this._near(d, origin.x + dir.x * maxDist / 2, origin.z + dir.z * maxDist / 2, maxDist / 2));
    if (!near.length) return null;
    const p = new THREE.Vector3();
    for (let t = 0.2; t <= maxDist; t += 0.15) {
      p.copy(origin).addScaledVector(dir, t);
      for (const d of near) {
        if (p.y < d.y || p.y > d.y + d.height) continue;
        for (const r of this._rects(d)) if (this._rectDist(r, p.x, p.z) < r[5] / 2 + 0.06) return { door: d, point: p.clone(), dist: t };
      }
    }
    return null;
  }

  segmentHit(a, b) {
    const seg = b.clone().sub(a), len = seg.length();
    if (len === 0) return null;
    return this.rayHit(a, seg.multiplyScalar(1 / len), len);
  }

  // ── Hasar ──
  damage(d, amt) {
    if (d.broken) return;
    d.hp -= amt;
    if (d.hp <= 0) this.breakDoor(d);
    else if (d.kind === 'hinged') d.vel += (Math.random() - 0.5) * 0.8;   // vurulan kapı titrer
  }

  hitSphere(pt, r, amt) {
    for (const d of this.doors) {
      if (d.broken || !this._near(d, pt.x, pt.z, r)) continue;
      if (pt.y < d.y - r || pt.y > d.y + d.height + r) continue;
      for (const rc of this._rects(d)) if (this._rectDist(rc, pt.x, pt.z) < r) { this.damage(d, amt); break; }
    }
  }

  // Patlama: yakındaki kapılar kırılır
  explode(center, radius) {
    for (const d of this.doors) {
      if (d.broken) continue;
      const cx = d.kind === 'hinged' ? d.hx + d.ax * d.width / 2 : d.sx + d.ax * d.width / 2;
      const cz = d.kind === 'hinged' ? d.hz + d.az * d.width / 2 : d.sz + d.az * d.width / 2;
      const dist = Math.hypot(cx - center.x, d.y + d.height / 2 - center.y, cz - center.z);
      const reach = radius + d.width / 2 + 1;
      if (dist < reach) this.damage(d, 45 * (1 - dist / reach) + 8);
    }
  }

  breakDoor(d) {
    if (d.broken) return;
    d.broken = true;
    if (this.drag && this.drag.door === d) this.drag = null;
    d.root.visible = false;
    const vw = this.vw;
    const rects = this._rects(d);
    const color = d.kind === 'hinged' ? 0x8a5a2b : d.gate ? 0x1f2328 : 0x7dd3fc;
    const center = new THREE.Vector3();
    rects.forEach(r => center.add(new THREE.Vector3(r[0] + r[2] * r[4] / 2, d.y + d.height / 2, r[1] + r[3] * r[4] / 2)));
    center.multiplyScalar(1 / rects.length);
    const n = d.kind === 'hinged' ? 7 : 12;
    for (let i = 0; i < n && vw.dynamicDebris.length < vw.maxDynamicDebris; i++) {
      const r = rects[i % rects.length], t = Math.random();
      vw.spawnLooseVoxel(r[0] + r[2] * r[4] * t, d.y + 0.3 + Math.random() * (d.height - 0.6), r[1] + r[3] * r[4] * t,
        { color }, center, 0.5, 3, 60, null, d.kind === 'hinged' ? 1.8 : 1.4);
    }
    if (d.kind === 'hinged') sound.playWoodHit(); else sound.playBlockHit();
  }

  // Nişangâhın hedeflediği, tutulabilir (menteşeli) kapı; yoksa null. Nişangâh bununla ele dönüşür.
  aim(camera) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const hit = this.rayHit(camera.position, dir, REACH);
    return hit && hit.door.kind === 'hinged' ? hit.door : null;
  }

  // ── Sağ tıkla sürükleme ──
  // Kameranın baktığı menteşeli kapıyı (menzil içinde) tutar. Bulunursa true.
  beginDrag(camera) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const hit = this.rayHit(camera.position, dir, REACH);
    if (!hit || hit.door.kind !== 'hinged') return false;
    const d = hit.door;
    const s = Math.max(0.35, Math.hypot(hit.point.x - d.hx, hit.point.z - d.hz));   // tutulan noktanın menteşeye uzaklığı
    // Oyuncunun kapının hangi yüzünde olduğu: pozitif açı serbest ucu +dik yöne taşır; oyuncudan UZAĞA iten işaret
    const px = -d.az, pz = d.ax;
    const side = ((camera.position.x - d.hx) * px + (camera.position.z - d.hz) * pz) >= 0 ? 1 : -1;
    this.drag = { door: d, s, lastT: performance.now(), awaySign: -side };
    d.vel = 0;
    sound.playDoorGrab();
    return true;
  }

  // Fare hareketi kapıyı döndürür: sağa-sola sürükleme kameranın sağına, yukarı sürükleme ileriye (itme) karşılık gelir
  dragMove(dx, dy, camera) {
    const dr = this.drag;
    if (!dr) return;
    const d = dr.door;
    const now = performance.now(), dt = Math.min(0.05, Math.max(1 / 240, (now - dr.lastT) / 1000)); dr.lastT = now;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const rx = -fwd.z, rz = fwd.x;                                       // kameranın sağı (yatay düzlemde)
    const mvx = rx * dx * DRAG_GAIN - fwd.x * dy * DRAG_GAIN, mvz = rz * dx * DRAG_GAIN - fwd.z * dy * DRAG_GAIN;
    const c = Math.cos(d.angle), s = Math.sin(d.angle);
    const dirx = d.ax * c + (-d.az) * s, dirz = d.az * c + d.ax * s;      // kapının o anki yönü
    const tx = -dirz, tz = dirx;                                         // teğet (açı artınca ucun gittiği yön)
    // 1) Gerçek hareket: tutulan noktanın teğeti boyunca sürükleme (yukarı = it, aşağı = çek, açık kapıda yana sürükleme).
    // 2) Düz bakılan kapıda yatay sürükleme teğete dik kalır; bu yüzden yatay sürükleme ayrıca itme/çekme sayılır
    //    (sağa = oyuncudan uzağa it, sola = kendine çek); işaret tutma anında sabitlendiği için kapı açıkken de tutarlıdır.
    const dTheta = ((mvx * tx + mvz * tz) + dr.awaySign * dx * DRAG_GAIN * 0.8) / dr.s;
    const before = d.angle;
    d.angle = Math.max(-ANGLE_LIMIT, Math.min(ANGLE_LIMIT, d.angle + dTheta));
    d.vel += ((d.angle - before) / dt - d.vel) * 0.5;                    // bırakınca eylemsizlik için hız
    this._pose(d);
  }

  endDrag() { this.drag = null; }

  // ── Güncelleme ──
  // actors: [{x,y,z}] — otomatik kapıları açan oyuncu, yayalar ve araçlar
  update(dt, actors) {
    for (const d of this.doors) {
      if (d.broken) continue;
      if (d.kind === 'hinged') {
        if (this.drag && this.drag.door === d) continue;                 // tutulurken fare belirler
        if (Math.abs(d.vel) > 0.01) {
          const prev = d.angle;
          d.vel *= Math.exp(-2.6 * dt);                                  // sürtünme: kapı durur
          d.angle += d.vel * dt;
          if (Math.abs(d.angle) > ANGLE_LIMIT) {                         // sonuna çarptı: hafif geri seker
            d.angle = Math.sign(d.angle) * ANGLE_LIMIT;
            if (Math.abs(d.vel) > 1.2) sound.playDoorHit(Math.min(1, Math.abs(d.vel) / 4));
            d.vel *= -0.25;
          } else if (prev * d.angle <= 0 && prev !== 0 && Math.abs(d.vel) > 1.2) {
            sound.playDoorHit(Math.min(1, Math.abs(d.vel) / 4));         // kapanma anında çarpar
          }
          if (Math.abs(d.vel) < 0.03) d.vel = 0;
          this._pose(d);
        }
      } else {
        const cx = d.sx + d.ax * d.width / 2, cz = d.sz + d.az * d.width / 2;
        let near = false;
        const reach = d.width * 0.5 + (d.gate ? 9 : 3.2);                // araç kapısı uzaktan açılır (araç hızlı gelir)
        for (const a of actors) if (!(d.gate && a.npc) && Math.abs(a.y - d.y) < 3.5 && Math.hypot(a.x - cx, a.z - cz) < reach) { near = true; break; }
        d.hold = near ? (d.gate ? 2.5 : 1.4) : Math.max(0, d.hold - dt);                  // yaklaşan yoksa 1.4 sn sonra kapanır
        d.target = d.hold > 0 ? 1 : 0;
        const prev = d.open;
        d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.3);
        const moving = d.open !== prev;
        if (moving && !d.wasMoving) sound.playDoorSlide();
        d.wasMoving = moving;
        if (moving) this._pose(d);
      }
    }
  }
}
