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
