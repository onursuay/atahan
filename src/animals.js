import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// KÖPEKLER: voxel (küp) modelli köpekler.
//  • Tasmalı köpek: sahibi bir NPC'dir; sahibin ön-yanında trot yapar, kuyruğunu sallar, tasma sahibin elinden köpeğin tasmasına uzanan ince bir çizgidir.
//    Sahibi vurulursa tasma düşer, köpek serbest kalıp başıboş dolaşır.
//  • Serbest köpek (köpek parkı): sınırlı bölgede rastgele dolaşır, ara sıra koşar, durup etrafı koklar.
// Köpekler yere basar (sahibin ayak yüksekliği ya da bölge yüksekliği); çarpışma denetimi basittir (voxel içine girerse sahibini izlemeye devam eder).
// ─────────────────────────────────────────────────────────────────────────────
const COATS = [[0x8b5a2b, 0x5b3a1a], [0x111111, 0x2b2b2b], [0xf5f5f4, 0xd6d3d1], [0xd4a017, 0xa16207], [0x6b7280, 0x374151], [0xc08457, 0xf5e6d0]];
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export function makeDog(coat = COATS[Math.floor(Math.random() * COATS.length)]) {
  const [main, dark] = coat, g = new THREE.Group();
  const add = (geo, color, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const body = add(box(0.3, 0.3, 0.72), main, 0, 0.46, 0);
  add(box(0.32, 0.12, 0.3), dark, 0, 0.55, 0.12);                          // sırt lekesi
  const head = new THREE.Group(); head.position.set(0, 0.64, 0.42); g.add(head);
  add(box(0.24, 0.24, 0.26), main, 0, 0, 0.04, head);
  add(box(0.14, 0.12, 0.16), dark, 0, -0.05, 0.22, head);                  // burun-ağız
  add(box(0.04, 0.04, 0.03), 0x050505, 0, 0.0, 0.31, head);
  add(box(0.07, 0.14, 0.07), dark, -0.14, 0.06, 0.0, head); add(box(0.07, 0.14, 0.07), dark, 0.14, 0.06, 0.0, head);   // kulaklar
  add(box(0.04, 0.04, 0.02), 0x050505, -0.07, 0.04, 0.17, head); add(box(0.04, 0.04, 0.02), 0x050505, 0.07, 0.04, 0.17, head);   // gözler
  const tail = new THREE.Group(); tail.position.set(0, 0.56, -0.38); g.add(tail); add(box(0.07, 0.07, 0.28), dark, 0, 0.1, -0.1, tail); tail.rotation.x = -0.6;
  const legs = [[-0.11, 0.3], [0.11, 0.3], [-0.11, -0.3], [0.11, -0.3]].map(([x, z]) => { const l = new THREE.Group(); l.position.set(x, 0.32, z); g.add(l); add(box(0.09, 0.32, 0.09), dark, 0, -0.16, 0, l); return l; });
  const collar = add(box(0.26, 0.07, 0.1), 0xdc2626, 0, 0.0, 0.0, head); collar.position.set(0, -0.14, -0.06);
  return { g, body, head, tail, legs, collar };
}

export class DogManager {
  constructor(scene) { this.scene = scene; this.dogs = []; }

  clear() { for (const d of this.dogs) { this.scene.remove(d.m.g); if (d.leash) this.scene.remove(d.leash); } this.dogs = []; }

  // Tasmalı köpek: owner = NPC kaydı (npc.js). Sahibin elinden köpeğe tasma çizilir.
  addLeashed(owner, ownerScale = 1.6) {
    const m = makeDog();
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const leash = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x1f2937 }));
    leash.frustumCulled = false;
    m.g.position.set(owner.x + 0.9, owner.y, owner.z + 0.9);
    this.scene.add(m.g, leash);
    const d = { m, owner, leash, scale: ownerScale, x: owner.x + 0.9, z: owner.z + 0.9, y: owner.y, heading: 0, speed: 0, t: 0, free: false };
    this.dogs.push(d); return d;
  }

  // Serbest köpek (köpek parkı): bounds {minX,maxX,minZ,maxZ}, y zemin
  addFree(x, y, z, bounds) {
    const m = makeDog();
    m.g.position.set(x, y, z); this.scene.add(m.g);
    const d = { m, owner: null, leash: null, x, y, z, bounds, heading: Math.random() * 6.28, speed: 0, t: 0, idle: Math.random() * 2, free: true, run: false, tt: 2 + Math.random() * 3 };
    this.dogs.push(d); return d;
  }

  update(dt, playerPos, aliveNpcs) {
    for (const d of this.dogs) {
      const near = Math.hypot(d.x - playerPos.x, d.z - playerPos.z) < 130;
      d.m.g.visible = near; if (d.leash) d.leash.visible = near;
      if (!near) { if (!d.free && d.owner) { d.x = d.owner.x + 0.9; d.z = d.owner.z + 0.9; d.y = d.owner.y; } continue; }   // uzaktaki tasmalı köpek sahibini izler (çizilmez)
      d.t += dt;
      if (!d.free && (!d.owner || !aliveNpcs.has(d.owner))) {         // sahibi gitti: tasma düşer, serbest kalır
        if (d.leash) { this.scene.remove(d.leash); d.leash = null; }
        d.free = true; d.owner = null; d.bounds = null; d.tt = 3; d.idle = 0;
      }
      let tx, tz, want = 0;
      if (!d.free) {
        const o = d.owner, fx = Math.sin(o.heading), fz = Math.cos(o.heading), rx = fz, rz = -fx;       // sahibin ileri ve sağ yönü
        tx = o.x + fx * 1.5 * d.scale * 0.6 + rx * 0.95; tz = o.z + fz * 1.5 * d.scale * 0.6 + rz * 0.95;
        const dist = Math.hypot(tx - d.x, tz - d.z);
        want = dist > 0.25 ? Math.min(4.2, 1.2 + dist * 3) : 0;
        d.y += (o.y - d.y) * Math.min(1, dt * 12);
        if (dist > 7) { d.x = tx; d.z = tz; }                              // çok geride kaldıysa yanına ışınlan
      } else {
        d.tt -= dt;
        if (d.tt <= 0) { d.tt = 1.5 + Math.random() * 4; const r = Math.random(); d.run = r < 0.3; d.idle = r > 0.7 ? 1 + Math.random() * 2 : 0; d.heading += (Math.random() - 0.5) * 2.6; }
        want = d.idle > 0 ? 0 : d.run ? 3.8 : 1.6; d.idle -= dt;
        tx = d.x + Math.sin(d.heading) * 3; tz = d.z + Math.cos(d.heading) * 3;
        const b = d.bounds;
        if (b) {
          if (d.x < b.minX + 1 || d.x > b.maxX - 1 || d.z < b.minZ + 1 || d.z > b.maxZ - 1) { const a = Math.atan2((b.minX + b.maxX) / 2 - d.x, (b.minZ + b.maxZ) / 2 - d.z); d.heading = a + (Math.random() - 0.5) * 0.6; tx = d.x + Math.sin(d.heading) * 3; tz = d.z + Math.cos(d.heading) * 3; }
        }
      }
      const want2 = Math.atan2(tx - d.x, tz - d.z), err = Math.atan2(Math.sin(want2 - d.heading), Math.cos(want2 - d.heading));
      if (want > 0) d.heading += err * Math.min(1, dt * 8);
      d.speed += (want - d.speed) * Math.min(1, dt * 6);
      d.x += Math.sin(d.heading) * d.speed * dt; d.z += Math.cos(d.heading) * d.speed * dt;
      // görünüm: trot (çapraz bacaklar), kuyruk sallama, hafif zıplama
      const ph = d.t * (6 + d.speed * 2.2), amp = Math.min(0.9, d.speed * 0.28);
      const L = d.m.legs; L[0].rotation.x = Math.sin(ph) * amp; L[3].rotation.x = Math.sin(ph) * amp; L[1].rotation.x = -Math.sin(ph) * amp; L[2].rotation.x = -Math.sin(ph) * amp;
      d.m.tail.rotation.z = Math.sin(d.t * 14) * (0.5 + d.speed * 0.1);
      d.m.head.rotation.x = d.speed < 0.3 ? 0.35 + Math.sin(d.t * 1.7) * 0.15 : 0.05;                    // dururken burnunu yere indirir (koklar)
      d.m.g.position.set(d.x, d.y + Math.abs(Math.sin(ph)) * 0.04 * Math.min(1, d.speed), d.z); d.m.g.rotation.y = d.heading;
      if (d.leash) {                                                       // tasma: sahibin elinden köpeğin tasmasına
        const o = d.owner, a = d.leash.geometry.attributes.position, hx = o.x + Math.cos(o.heading) * 0.35 * d.scale, hz = o.z - Math.sin(o.heading) * 0.35 * d.scale;
        a.setXYZ(0, hx, o.y + 0.7 * d.scale, hz);
        a.setXYZ(1, d.x + Math.sin(d.heading) * 0.42, d.y + 0.52, d.z + Math.cos(d.heading) * 0.42);
        a.needsUpdate = true;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KEDİLER: Market önündeki sevimli kediler (yatan, yürüyen ve maskot kedi).
// ─────────────────────────────────────────────────────────────────────────────
export function makeCat(coat = 0) {
  const colors = [
    [0xf97316, 0xffedd5], // Sarman (Orange tabby)
    [0x18181b, 0xf8fafc], // Siyah-Beyaz (Tuxedo)
    [0x78350f, 0xfde047]  // Alacalı (Calico)
  ][coat % 3];
  const [mainCol, whiteCol] = colors;
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const body = add(box(0.22, 0.2, 0.44), mainCol, 0, 0.24, 0);
  add(box(0.18, 0.08, 0.3), whiteCol, 0, 0.18, 0.04); // göğüs

  const head = new THREE.Group();
  head.position.set(0, 0.36, 0.24);
  g.add(head);
  add(box(0.2, 0.18, 0.18), mainCol, 0, 0, 0, head);
  add(box(0.1, 0.08, 0.08), 0xfca5a5, 0, -0.03, 0.1, head); // pembe burun
  add(box(0.04, 0.04, 0.02), 0x15803d, -0.06, 0.03, 0.09, head); // gözler
  add(box(0.04, 0.04, 0.02), 0x15803d, 0.06, 0.03, 0.09, head);
  // Kulaklar
  add(box(0.05, 0.08, 0.04), mainCol, -0.07, 0.12, -0.02, head);
  add(box(0.05, 0.08, 0.04), mainCol, 0.07, 0.12, -0.02, head);
  add(box(0.03, 0.05, 0.02), 0xfca5a5, -0.07, 0.11, 0.0, head);
  add(box(0.03, 0.05, 0.02), 0xfca5a5, 0.07, 0.11, 0.0, head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.3, -0.22);
  g.add(tail);
  add(box(0.05, 0.05, 0.28), mainCol, 0, 0.08, -0.1, tail);
  tail.rotation.x = 0.5;

  const legs = [[-0.08, 0.16], [0.08, 0.16], [-0.08, -0.16], [0.08, -0.16]].map(([x, z]) => {
    const l = new THREE.Group();
    l.position.set(x, 0.16, z);
    g.add(l);
    add(box(0.06, 0.16, 0.06), mainCol, 0, -0.08, 0, l);
    add(box(0.07, 0.04, 0.07), whiteCol, 0, -0.14, 0.01, l);
    return l;
  });

  return { g, body, head, tail, legs };
}

export class CatManager {
  constructor(scene) {
    this.scene = scene;
    this.cats = [];
    this.bowls = [];
  }

  clear() {
    for (const c of this.cats) this.scene.remove(c.m.g);
    for (const b of this.bowls) this.scene.remove(b);
    this.cats = [];
    this.bowls = [];
  }

  addMarketCats(mx, my, mz) {
    // 1) Yatan Kedi (Sleeping)
    const m1 = makeCat(0);
    m1.body.scale.set(1.1, 0.7, 0.9);
    m1.head.position.set(0.08, 0.16, 0.12);
    m1.head.rotation.set(-0.2, 0.4, 0.2);
    m1.tail.rotation.set(0.2, 0.5, 0);
    m1.legs.forEach(l => l.scale.set(0.8, 0.4, 0.8));
    m1.g.position.set(mx - 1.8, my, mz + 1.2);
    m1.g.rotation.y = 0.8;
    this.scene.add(m1.g);
    this.cats.push({ m: m1, type: 'sleeping', x: mx - 1.8, y: my, z: mz + 1.2, t: 0 });

    // 2) Yürüyen Kedi (Walking)
    const m2 = makeCat(1);
    m2.g.position.set(mx + 1.5, my, mz + 2.5);
    this.scene.add(m2.g);
    this.cats.push({
      m: m2, type: 'walking',
      x: mx + 1.5, y: my, z: mz + 2.5,
      startX: mx + 1.5, startZ: mz + 2.5,
      heading: 0, speed: 0.8, t: 0
    });

    // 3) Maskot Kedi (Friendly Mascot)
    const m3 = makeCat(2);
    const crate = new THREE.Mesh(box(0.5, 0.35, 0.5), mat(0xa16207));
    crate.position.set(mx + 2.2, my + 0.175, mz + 0.8);
    crate.castShadow = true;
    this.scene.add(crate);
    this.bowls.push(crate);

    m3.g.position.set(mx + 2.2, my + 0.35, mz + 0.8);
    m3.g.rotation.y = -Math.PI / 2;
    this.scene.add(m3.g);
    this.cats.push({ m: m3, type: 'mascot', x: mx + 2.2, y: my + 0.35, z: mz + 0.8, t: 0, meowT: 0 });

    // Kedi Maması ve Su Kapları (Kırmızı mama, Mavi su)
    const bowlGeo = new THREE.CylinderGeometry(0.14, 0.11, 0.07, 12);
    const b1 = new THREE.Mesh(bowlGeo, mat(0xef4444));
    b1.position.set(mx - 1.2, my + 0.035, mz + 1.0);
    const kibble = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 10), mat(0x78350f));
    kibble.position.set(mx - 1.2, my + 0.065, mz + 1.0);
    this.scene.add(b1, kibble);
    this.bowls.push(b1, kibble);

    const b2 = new THREE.Mesh(bowlGeo, mat(0x3b82f6));
    b2.position.set(mx - 0.85, my + 0.035, mz + 1.0);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 10), mat(0x38bdf8));
    water.position.set(mx - 0.85, my + 0.065, mz + 1.0);
    this.scene.add(b2, water);
    this.bowls.push(b2, water);
  }

  update(dt, playerPos) {
    for (const cat of this.cats) {
      cat.t += dt;
      if (cat.type === 'sleeping') {
        cat.m.body.scale.y = 0.7 + Math.sin(cat.t * 2.2) * 0.04;
        cat.m.tail.rotation.y = 0.5 + Math.sin(cat.t * 1.8) * 0.2;
      } else if (cat.type === 'walking') {
        const patrolDist = 4.2;
        const offset = Math.sin(cat.t * 0.5) * patrolDist;
        cat.x = cat.startX + offset;
        cat.heading = Math.cos(cat.t * 0.5) > 0 ? Math.PI / 2 : -Math.PI / 2;
        cat.m.g.position.set(cat.x, cat.y, cat.z);
        cat.m.g.rotation.y = cat.heading;
        const ph = cat.t * 6;
        cat.m.legs[0].rotation.x = Math.sin(ph) * 0.45;
        cat.m.legs[3].rotation.x = Math.sin(ph) * 0.45;
        cat.m.legs[1].rotation.x = -Math.sin(ph) * 0.45;
        cat.m.legs[2].rotation.x = -Math.sin(ph) * 0.45;
        cat.m.tail.rotation.z = Math.sin(cat.t * 4) * 0.35;
      } else if (cat.type === 'mascot') {
        cat.m.legs[0].rotation.x = -0.6 + Math.sin(cat.t * 4) * 0.35;
        cat.m.head.rotation.y = Math.sin(cat.t * 1.5) * 0.3;
        cat.m.tail.rotation.x = 0.6 + Math.sin(cat.t * 3) * 0.2;
        cat.meowT += dt;
        if (cat.meowT > 8) {
          cat.meowT = 0;
          if (playerPos && Math.hypot(cat.x - playerPos.x, cat.z - playerPos.z) < 18) {
            sound.playMeow();
          }
        }
      }
    }
  }
}
