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
  addHinged({ hx, hz, ax, az, width, height, y, color = null, insetColor = null, handleColor = null, minAngle = -ANGLE_LIMIT, maxAngle = ANGLE_LIMIT, thick = null, cabinet = false }) {
    const root = new THREE.Group();
    const th = thick || (cabinet ? 0.055 : THICK);
    const pMat = color ? new THREE.MeshLambertMaterial({ color }) : this.woodMat;
    const iMat = insetColor ? new THREE.MeshLambertMaterial({ color: insetColor }) : (color ? new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.86) }) : this.insetMat);
    const hMat = handleColor ? new THREE.MeshLambertMaterial({ color: handleColor }) : (cabinet ? this.frameMat : this.darkMat);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, th), pMat);
    panel.position.set(width / 2, height / 2, 0);
    panel.castShadow = true;
    const hw = cabinet ? Math.min(0.05, width * 0.12) : 0.14;
    const hh = cabinet ? Math.min(0.18, height * 0.28) : 0.06;
    const hd = cabinet ? th + 0.06 : 0.22;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), hMat);
    const hOff = cabinet ? Math.min(0.11, width * 0.2) : Math.min(0.25, width * 0.25);
    handle.position.set( Math.max(0.06, width - hOff), height * (cabinet ? 0.5 : 0.45), 0);
    root.add(panel, handle);
    // kapı üzerine kasnak çizgileri (panel görünümü)
    if (!cabinet) {
      for (const f of [0.25, 0.75]) {
        const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, height * 0.32, th + 0.03), iMat);
        inset.position.set(width / 2, height * f, 0);
        root.add(inset);
      }
    } else {
      const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, height * 0.76, th + 0.016), iMat);
      inset.position.set(width / 2, height * 0.5, 0);
      root.add(inset);
    }
    root.position.set(hx, y, hz);
    this.group.add(root);
    const d = { kind: 'hinged', cabinet, root, hx, hz, ax, az, width, height, y, thick: th, minAngle, maxAngle, color: color || 0x8a5a2b, angle: 0, vel: 0, hp: cabinet ? 8 : DOOR_HP, broken: false };
    this._pose(d);
    this.doors.push(d);
    return d;
  }

  // Fırın kapağı: alt kenarından menteşeli, sağ tıkla aşağı doğru (0 -> 90°) açılır; ortası cam pencerelidir
  addOvenDoor({ hx, hz, ax, az, nx, nz, width, height, y }) {
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    const outZ = (-az) * nx + ax * nz >= 0 ? 1 : -1;
    const th = 0.06;
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1e293b });
    const handleMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
    const borderW = 0.09, borderH = 0.10;
    // Dört çerçeve kenarı + ortada şeffaf fırın camı (içindeki kek ve tepsiler görünsün)
    const bot = new THREE.Mesh(new THREE.BoxGeometry(width, borderH, th), bodyMat);
    bot.position.set(width / 2, borderH / 2, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(width, borderH, th), bodyMat);
    top.position.set(width / 2, height - borderH / 2, 0);
    const left = new THREE.Mesh(new THREE.BoxGeometry(borderW, height - 2 * borderH, th), bodyMat);
    left.position.set(borderW / 2, height / 2, 0);
    const right = new THREE.Mesh(new THREE.BoxGeometry(borderW, height - 2 * borderH, th), bodyMat);
    right.position.set(width - borderW / 2, height / 2, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(width - 2 * borderW, height - 2 * borderH, 0.025), this.glassMat);
    win.position.set(width / 2, height / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.035, 0.045), handleMat);
    handle.position.set(width / 2, height - borderH * 0.45, outZ * (th / 2 + 0.03));
    pivot.add(bot, top, left, right, win, handle);
    root.add(pivot);
    root.position.set(hx, y, hz);
    root.rotation.y = -Math.atan2(az, ax);
    this.group.add(root);
    const d = { kind: 'oven', root, pivot, hx, hz, sx: hx, sz: hz, ax, az, nx, nz, outZ, width, height, y, thick: th, angle: 0, vel: 0, maxAngle: 1.52, hp: 12, broken: false };
    this._pose(d);
    this.doors.push(d);
    return d;
  }

  // Çekmece: sağ tıkla ileri-geri kayarak açılır, içindeki kaşık/çatal vb. eşyaları da beraberinde taşır
  addDrawer({ hx, hz, ax, az, nx, nz, width, height, depth = 0.48, y, color = 0xf1f5f9 }) {
    const root = new THREE.Group();
    const outZ = (-az) * nx + ax * nz >= 0 ? 1 : -1;
    const frontMat = new THREE.MeshLambertMaterial({ color });
    const boxMat = new THREE.MeshLambertMaterial({ color: 0xd6b98a });
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x64748b });
    const th = 0.045;
    // Ön kapak + kulp
    const front = new THREE.Mesh(new THREE.BoxGeometry(width, height, th), frontMat);
    front.position.set(width / 2, height / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.22, width * 0.38), 0.03, 0.04), handleMat);
    handle.position.set(width / 2, height * 0.55, outZ * (th / 2 + 0.02));
    // Çekmece iç kutusu (taban + yanlar + arka)
    const bot = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.025, depth), boxMat);
    bot.position.set(width / 2, 0.015, -outZ * (depth / 2));
    const sH = height * 0.72;
    const sL = new THREE.Mesh(new THREE.BoxGeometry(0.025, sH, depth), boxMat);
    sL.position.set(0.025, sH / 2, -outZ * (depth / 2));
    const sR = new THREE.Mesh(new THREE.BoxGeometry(0.025, sH, depth), boxMat);
    sR.position.set(width - 0.025, sH / 2, -outZ * (depth / 2));
    const back = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, sH, 0.025), boxMat);
    back.position.set(width / 2, sH / 2, -outZ * (depth - 0.015));
    root.add(front, handle, bot, sL, sR, back);
    root.position.set(hx, y, hz);
    root.rotation.y = -Math.atan2(az, ax);
    this.group.add(root);
    const d = { kind: 'drawer', root, hx, hz, sx: hx, sz: hz, ax, az, nx, nz, width, height, depth, y, thick: th, open: 0, maxOpen: depth * 0.78, vel: 0, color, hp: 9, broken: false };
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
      return [[d.hx, d.hz, dx, dz, d.width, d.thick || THICK]];
    }
    if (d.kind === 'oven') {
      const reachOut = Math.sin(d.angle) * d.height * 0.5;
      return [[d.hx + d.nx * reachOut, d.hz + d.nz * reachOut, d.ax, d.az, d.width, Math.max(0.08, Math.sin(d.angle) * d.height)]];
    }
    if (d.kind === 'drawer') {
      return [[d.hx + d.nx * d.open, d.hz + d.nz * d.open, d.ax, d.az, d.width, 0.07]];
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
    } else if (d.kind === 'oven') {
      d.pivot.rotation.x = d.outZ * d.angle;
    } else if (d.kind === 'drawer') {
      d.root.position.set(d.hx + d.nx * d.open, d.y, d.hz + d.nz * d.open);
    } else {
      const half = d.width / 2, shift = d.open * half;
      d.a.position.set(half / 2 - shift, 0, 0.15);
      d.b.position.set(half + half / 2 + shift, 0, 0.15);
    }
  }

  // Çekmece hareket ettiğinde içindeki eşyaları da birlikte kaydırır
  _moveDrawerProps(d, deltaOpen) {
    if (Math.abs(deltaOpen) < 1e-5 || !this.vw.props) return;
    const prevOpen = d.open - deltaOpen;
    for (const p of this.vw.props.props) {
      if (p.broken || p.held) continue;
      if (p.pos.y < d.y - 0.05 || p.pos.y > d.y + d.height + 0.18) continue;
      // Çekmece yerel koordinatlarında (u: genişlik boyunca, v: derinlik boyunca)
      const relX = p.pos.x - (d.hx + d.nx * prevOpen);
      const relZ = p.pos.z - (d.hz + d.nz * prevOpen);
      const u = relX * d.ax + relZ * d.az;
      const v = -(relX * d.nx + relZ * d.nz);
      if (u >= -0.04 && u <= d.width + 0.04 && v >= -0.05 && v <= d.depth + 0.05) {
        p.pos.x += d.nx * deltaOpen;
        p.pos.z += d.nz * deltaOpen;
        this.vw.props._upload(p);
      }
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
    const cx = d.kind === 'sliding' ? d.sx : d.hx, cz = d.kind === 'sliding' ? d.sz : d.hz;
    return Math.hypot(x - cx, z - cz) <= d.width + pad + 0.8;
  }

  // ── Çarpışma ──
  // Dairesel gövde (x,z,halfW), ayak yüksekliği feetY, boy bodyH kapıya giriyor mu?
  // closedGates: yayalar için araç kapıları açıkken de kapalı sayılır
  blocks(x, feetY, z, halfW, bodyH, closedGates = false) {
    for (const d of this.doors) {
      if (d.broken || d.kind === 'drawer' || !this._near(d, x, z, halfW)) continue;
      const topY = d.kind === 'oven' ? d.y + d.height * Math.cos(d.angle) : d.y + d.height;
      if (feetY + bodyH < d.y || feetY > topY) continue;
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
    for (let t = 0.16; t <= maxDist; t += 0.06) {
      p.copy(origin).addScaledVector(dir, t);
      for (const d of near) {
        if (d.kind === 'oven') {
          // Fırın kapağı eğimine göre 3B düzlem testi
          const rx = p.x - d.hx, ry = p.y - d.y, rz = p.z - d.hz;
          const u = rx * d.ax + rz * d.az;
          if (u < -0.03 || u > d.width + 0.03) continue;
          const out = rx * d.nx + rz * d.nz;
          const c = Math.cos(d.angle), s = Math.sin(d.angle);
          const along = ry * c + out * s;
          const perp = Math.abs(-ry * s + out * c);
          if (along >= -0.03 && along <= d.height + 0.03 && perp <= 0.065) {
            return { door: d, point: p.clone(), dist: t };
          }
          continue;
        }
        if (d.kind === 'drawer') {
          if (p.y < d.y - 0.02 || p.y > d.y + d.height + 0.02) continue;
          const rx = p.x - (d.hx + d.nx * d.open), rz = p.z - (d.hz + d.nz * d.open);
          const u = rx * d.ax + rz * d.az;
          const out = rx * d.nx + rz * d.nz;
          // Ön kapak veya yan kenarlar
          if (u >= -0.02 && u <= d.width + 0.02 && Math.abs(out) <= 0.055) {
            return { door: d, point: p.clone(), dist: t };
          }
          continue;
        }
        if (p.y < d.y || p.y > d.y + d.height) continue;
        for (const r of this._rects(d)) if (this._rectDist(r, p.x, p.z) < r[5] / 2 + 0.045) return { door: d, point: p.clone(), dist: t };
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
      const cx = (d.kind === 'sliding' ? d.sx : d.hx) + d.ax * d.width / 2;
      const cz = (d.kind === 'sliding' ? d.sz : d.hz) + d.az * d.width / 2;
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
    const color = d.color || (d.kind === 'hinged' ? 0x8a5a2b : d.gate ? 0x1f2328 : 0x7dd3fc);
    const center = new THREE.Vector3();
    rects.forEach(r => center.add(new THREE.Vector3(r[0] + r[2] * r[4] / 2, d.y + d.height / 2, r[1] + r[3] * r[4] / 2)));
    center.multiplyScalar(1 / rects.length);
    const n = d.cabinet || d.kind === 'drawer' ? 4 : d.kind === 'hinged' ? 7 : 12;
    for (let i = 0; i < n && vw.dynamicDebris.length < vw.maxDynamicDebris; i++) {
      const r = rects[i % rects.length], t = Math.random();
      vw.spawnLooseVoxel(r[0] + r[2] * r[4] * t, d.y + 0.1 + Math.random() * Math.max(0.2, d.height - 0.2), r[1] + r[3] * r[4] * t,
        { color }, center, 0.5, 3, 60, null, d.kind === 'hinged' ? 1.5 : 1.3);
    }
    if (d.kind === 'hinged' || d.kind === 'drawer') sound.playWoodHit(); else sound.playBlockHit();
  }

  // Nişangâhın hedeflediği, tutulabilir (menteşeli, fırın, çekmece) kapak; yoksa null.
  pick(camera) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const hit = this.rayHit(camera.position, dir, REACH);
    return hit && (hit.door.kind === 'hinged' || hit.door.kind === 'oven' || hit.door.kind === 'drawer') ? hit : null;
  }

  aim(camera) {
    const hit = this.pick(camera);
    return hit ? hit.door : null;
  }

  // ── Sağ tıkla sürükleme ──
  // Kameranın baktığı menteşeli kapıyı / dolap kapağını / fırın kapağını / çekmeceyi tutar.
  beginDrag(camera) {
    const hit = this.pick(camera);
    if (!hit) return false;
    const d = hit.door;
    if (d.kind === 'oven' || d.kind === 'drawer') {
      this.drag = { door: d, s: 0.45, lastT: performance.now(), awaySign: 1 };
      d.vel = 0;
      sound.playDoorGrab();
      return true;
    }
    const s = Math.max(0.22, Math.hypot(hit.point.x - d.hx, hit.point.z - d.hz));   // tutulan noktanın menteşeye uzaklığı
    // Oyuncunun kapının hangi yüzünde olduğu: pozitif açı serbest ucu +dik yöne taşır; oyuncudan UZAĞA iten işaret
    const px = -d.az, pz = d.ax;
    const side = ((camera.position.x - d.hx) * px + (camera.position.z - d.hz) * pz) >= 0 ? 1 : -1;
    this.drag = { door: d, s, lastT: performance.now(), awaySign: -side };
    d.vel = 0;
    sound.playDoorGrab();
    return true;
  }

  // Fare hareketi kapıyı/çekmeceyi/fırın kapağını hareket ettirir
  dragMove(dx, dy, camera) {
    const dr = this.drag;
    if (!dr) return;
    const d = dr.door;
    const now = performance.now(), dt = Math.min(0.05, Math.max(1 / 240, (now - dr.lastT) / 1000)); dr.lastT = now;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const rx = -fwd.z, rz = fwd.x;                                       // kameranın sağı (yatay düzlemde)
    const mvx = rx * dx * DRAG_GAIN - fwd.x * dy * DRAG_GAIN, mvz = rz * dx * DRAG_GAIN - fwd.z * dy * DRAG_GAIN;

    if (d.kind === 'oven') {
      // Fırın kapağı: fareyi aşağı çekmek veya dışa çekmek kapağı aşağı yatırır (açar), yukarı itmek kapatır
      const pullOut = mvx * d.nx + mvz * d.nz + dy * DRAG_GAIN * 1.1;
      const before = d.angle;
      d.angle = Math.max(0, Math.min(d.maxAngle, d.angle + pullOut / Math.max(0.25, d.height * 0.65)));
      d.vel += ((d.angle - before) / dt - d.vel) * 0.5;
      this._pose(d);
      return;
    }

    if (d.kind === 'drawer') {
      // Çekmece: fareyi kendine doğru çekmek (dy > 0 veya dış normal yönü) çekmeceyi dışarı kaydırır
      const pullOut = (mvx * d.nx + mvz * d.nz) * 0.85 + dy * DRAG_GAIN * 0.65;
      const before = d.open;
      d.open = Math.max(0, Math.min(d.maxOpen, d.open + pullOut));
      this._moveDrawerProps(d, d.open - before);
      this._pose(d);
      return;
    }

    const c = Math.cos(d.angle), s = Math.sin(d.angle);
    const dirx = d.ax * c + (-d.az) * s, dirz = d.az * c + d.ax * s;      // kapının o anki yönü
    const tx = -dirz, tz = dirx;                                         // teğet (açı artınca ucun gittiği yön)
    const dTheta = ((mvx * tx + mvz * tz) + dr.awaySign * dx * DRAG_GAIN * 0.8) / dr.s;
    const before = d.angle;
    const lo = d.minAngle ?? -ANGLE_LIMIT, hi = d.maxAngle ?? ANGLE_LIMIT;
    d.angle = Math.max(lo, Math.min(hi, d.angle + dTheta));
    d.vel += ((d.angle - before) / dt - d.vel) * 0.5;                    // bırakınca eylemsizlik için hız
    this._pose(d);
  }

  endDrag() { this.drag = null; }

  // ── Güncelleme ──
  // actors: [{x,y,z}] — otomatik kapıları açan oyuncu, yayalar ve araçlar
  update(dt, actors) {
    for (const d of this.doors) {
      if (d.broken) continue;
      if (d.kind === 'hinged' || d.kind === 'oven') {
        if (this.drag && this.drag.door === d) continue;                 // tutulurken fare belirler
        if (Math.abs(d.vel) > 0.01) {
          const prev = d.angle;
          d.vel *= Math.exp(-3.2 * dt);                                  // sürtünme: kapı durur
          d.angle += d.vel * dt;
          const lo = d.kind === 'oven' ? 0 : (d.minAngle ?? -ANGLE_LIMIT);
          const hi = d.maxAngle ?? ANGLE_LIMIT;
          if (d.angle < lo || d.angle > hi) {
            d.angle = Math.max(lo, Math.min(hi, d.angle));
            if (Math.abs(d.vel) > 1.2) sound.playDoorHit(Math.min(1, Math.abs(d.vel) / 4));
            d.vel *= -0.25;
          } else if (prev * d.angle <= 0 && prev !== 0 && Math.abs(d.vel) > 1.2) {
            sound.playDoorHit(Math.min(1, Math.abs(d.vel) / 4));         // kapanma anında çarpar
          }
          if (Math.abs(d.vel) < 0.03) d.vel = 0;
          this._pose(d);
        }
      } else if (d.kind === 'sliding') {
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
