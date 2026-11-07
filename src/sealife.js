import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// DENİZ YAŞAMI: Minik Balıklar ve Yengeçler (Hafif & 60 FPS Optimize)
//  • Sığ kıyılarda ve iskele diplerinde yüzen kuyruk sallayan minik balıklar
//  • Sahilin bittiği kayalık kıyılarda yan yan yürüyen kıskaçlı yengeçler
// ─────────────────────────────────────────────────────────────────────────────

export class SeaLife {
  constructor(scene, voxelWorld) {
    this.scene = scene;
    this.vw = voxelWorld;
    this.fishList = [];
    this.crabs = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._initFish();
    this._initCrabs();
  }

  _initFish() {
    const fishColors = [
      { body: 0xf97316, stripe: 0xffffff, fin: 0xea580c }, // Palyaço balığı (Turuncu/Beyaz)
      { body: 0x0284c7, stripe: 0xfacc15, fin: 0x0369a1 }, // Neon Mavi Tang
      { body: 0xeab308, stripe: 0x1f2937, fin: 0xca8a04 }, // Sarı Kelebek Balığı
      { body: 0x10b981, stripe: 0xffffff, fin: 0x059669 }  // Zümrüt Kıyı Balığı
    ];

    const box = (w, h, d, col) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));

    // 16 adet minik balık
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const style = fishColors[i % fishColors.length];

      // Gövde
      const body = box(0.35, 0.2, 0.1, style.body);
      g.add(body);

      // Beyaz/Sarı Gövde Şeridi
      const stripe = box(0.08, 0.22, 0.11, style.stripe);
      stripe.position.x = -0.02;
      g.add(stripe);

      // Sırt Yüzgeci
      const topFin = box(0.14, 0.08, 0.04, style.fin);
      topFin.position.set(0, 0.13, 0);
      g.add(topFin);

      // Sallanan Kuyruk Yüzgeci
      const tail = box(0.12, 0.16, 0.03, style.fin);
      tail.position.set(-0.24, 0, 0);
      g.add(tail);

      // Gözler
      const eyeL = box(0.04, 0.04, 0.02, 0x111827);
      eyeL.position.set(0.12, 0.04, 0.055);
      const eyeR = box(0.04, 0.04, 0.02, 0x111827);
      eyeR.position.set(0.12, 0.04, -0.055);
      g.add(eyeL);
      g.add(eyeR);

      // Konum: Sığ sular (x: -890 .. -820, z: -400 .. 400, y: -0.45 .. -1.2)
      const x = -835 - Math.random() * 55;
      const z = (Math.random() - 0.5) * 750;
      const y = -0.45 - Math.random() * 0.75;
      g.position.set(x, y, z);

      this.group.add(g);
      this.fishList.push({
        group: g,
        tail,
        basePos: new THREE.Vector3(x, y, z),
        pos: new THREE.Vector3(x, y, z),
        dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
        speed: 1.2 + Math.random() * 0.9,
        tailSpeed: 10 + Math.random() * 6,
        swimPhase: Math.random() * Math.PI * 2,
        dartTimer: 0
      });
    }
  }

  _initCrabs() {
    const box = (w, h, d, col) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
    const crabColors = [0xd97706, 0xdc2626, 0xb45309, 0xe11d48];

    // 10 adet yengeç: Sahilin bittiği kayalık kıyılarda (Kuzey z < -650, Güney z > 650)
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const col = crabColors[i % crabColors.length];

      // Gövde (kabuk)
      const body = box(0.32, 0.12, 0.22, col);
      g.add(body);

      // İki göz sapı
      const eye1 = box(0.04, 0.08, 0.04, 0x111827);
      eye1.position.set(0.08, 0.08, 0.1);
      const eye2 = box(0.04, 0.08, 0.04, 0x111827);
      eye2.position.set(-0.08, 0.08, 0.1);
      g.add(eye1);
      g.add(eye2);

      // İki ön kıskaç
      const clawL = box(0.12, 0.08, 0.14, 0xef4444);
      clawL.position.set(0.18, 0.04, 0.16);
      const clawR = box(0.12, 0.08, 0.14, 0xef4444);
      clawR.position.set(-0.18, 0.04, 0.16);
      g.add(clawL);
      g.add(clawR);

      // Kayalık bölge konumları
      const isNorth = i < 5;
      const x = -805 - Math.random() * 45;
      const z = isNorth ? (-680 - Math.random() * 70) : (680 + Math.random() * 70);
      const y = 0.08;
      g.position.set(x, y, z);

      this.group.add(g);
      this.crabs.push({
        group: g,
        clawL,
        clawR,
        basePos: new THREE.Vector3(x, y, z),
        pos: new THREE.Vector3(x, y, z),
        dir: isNorth ? 1 : -1,
        walkPhase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.4
      });
    }
  }

  update(dt, playerPos) {
    // 1. Minik Balıklar: Sığ sularda kıvrılarak yüzer, oyuncu yaklaşınca kaçar
    for (const f of this.fishList) {
      f.swimPhase += dt * f.tailSpeed;
      f.tail.rotation.y = Math.sin(f.swimPhase) * 0.45;

      // Oyuncudan kaçış
      const distToPlayer = playerPos ? f.pos.distanceTo(playerPos) : 999;
      if (distToPlayer < 7.0) {
        f.dartTimer = 1.8;
        const away = f.pos.clone().sub(playerPos).setY(0).normalize();
        f.dir.lerp(away, dt * 5.0).normalize();
      }

      const curSpeed = f.dartTimer > 0 ? f.speed * 2.8 : f.speed;
      if (f.dartTimer > 0) f.dartTimer -= dt;

      // Doğal devriye dönüşü (kıyı şeridinde kalır)
      f.pos.addScaledVector(f.dir, curSpeed * dt);
      if (f.pos.x > -825) f.dir.x = -Math.abs(f.dir.x) - 0.2;
      if (f.pos.x < -895) f.dir.x = Math.abs(f.dir.x) + 0.2;
      if (f.pos.z > 430) f.dir.z = -Math.abs(f.dir.z);
      if (f.pos.z < -430) f.dir.z = Math.abs(f.dir.z);
      f.dir.normalize();

      f.group.position.copy(f.pos);
      f.group.rotation.y = Math.atan2(f.dir.x, f.dir.z);
    }

    // 2. Yengeçler: Kayalarda yan yan yürür, kıskaçlarını oynatır
    for (const c of this.crabs) {
      c.walkPhase += dt * 3.5;
      c.pos.z += c.dir * c.speed * dt;
      if (Math.abs(c.pos.z - c.basePos.z) > 12) c.dir *= -1;

      c.clawL.rotation.x = Math.sin(c.walkPhase) * 0.35;
      c.clawR.rotation.x = -Math.sin(c.walkPhase) * 0.35;
      c.group.position.copy(c.pos);
      c.group.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; // Yan yan yürüyüş
    }
  }

  clear() {
    this.scene.remove(this.group);
    this.fishList = [];
    this.crabs = [];
  }
}
