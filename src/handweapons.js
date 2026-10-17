import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y } from './terrain.js';
import { Arsenal } from './arsenal.js';

// Elde taşınan silahlar: ekranın sağ altında görünen silah modelleri (birinci şahıs),
// minigun (basılı tutunca otomatik ateş) ve ışın kılıcı (savurma ile yıkım).
// Silah modelleri ayrı bir sahnede çizilir: duvara yaklaşınca içine girmez.

const MINIGUN_RATE = 18;       // saniyedeki mermi
const MINIGUN_SPINUP = 0.35;   // namlular bu sürede tam hıza çıkar
const MINIGUN_RANGE = 90;

// Hitscan silah özellikleri: saçılma, voxel gücü/yarıçapı, araç/uçak hasarı, menzil
const GUNS = {
  minigun: { kind: 'minigun', iron: true, spread: 0.012, power: 0.45, radius: 0.45, carDmg: 1, planeDmg: 1, range: 90, sound: 'every' },
  pistol:  { kind: 'pistol', spread: 0.004, power: 0.9,  radius: 0.4,  carDmg: 3, planeDmg: 3, range: 120, sound: 'every', kick: 0.6 },
  shotgun: { kind: 'shotgun', iron: true, spread: 0.07,  power: 0.5,  radius: 0.35, carDmg: 2, planeDmg: 1, range: 40, pellets: 9, sound: 'every', kick: 1.0 },
  ak47:    { kind: 'ak47', spread: 0.016, power: 0.6,  radius: 0.45, carDmg: 2, planeDmg: 2, range: 140, sound: 'every', kick: 0.45 },
  sniper:  { kind: 'sniper', iron: true, spread: 0.0,   power: 3.0,  radius: 0.7,  carDmg: 14, planeDmg: 25, range: 260, sound: 'every', kick: 1.0 }
};
// Şarjör kapasitesi ve şarjör değiştirme süresi (sn). Minigun ve diğer silahlar sınırsızdır.
const MAG_SIZE = { pistol: 12, shotgun: 6, ak47: 30, sniper: 5 };
const RELOAD_TIME = { pistol: 1.4, shotgun: 2.4, ak47: 1.9, sniper: 2.2 };
const WEAPON_KIND = { 1: 'minigun', 5: 'pistol', 6: 'shotgun', 7: 'ak47', 8: 'sniper' };
const SABER_SWING_TIME = 0.42;
const SABER_REACH = 3.2;       // metre: kılıç etkisi
const SABER_RADIUS = 0.42;

// Çift bıçaklı kılıç: tutacak ortada, iki ucundan birer bıçak çıkar.
// Görsel model elde küçük çizilir; çarpışma için bıçaklar tutacak merkezinden SABER_BLADE_SCALE kat büyütülür
// (eski tek bıçağın 3.2 m erişimiyle uyumlu).
const SABER_HILT_HALF = 0.19;     // tutacak merkezinden yayıcıya uzaklık (model birimi)
const SABER_BLADE_LEN = 1.0;      // bir bıçağın görsel uzunluğu
const SABER_BLADE_SCALE = 2.6;    // bıçağın dünyadaki hasar uzunluğu = görsel × bu
const SABER_HOLD = { x: 0.26, y: -0.18, z: -1.05 };   // tutacak merkezinin ekrandaki yeri
const SPIN_TIME = 2.5;            // tek tıkla başlayan dönüşün süresi (sn)
// Dönüş üç eksende BİRLEŞİK yapılır (sağ-sol, yukarı-aşağı ve ileri-geri tekerlek): her eksende tam tur sayısı bu aralıklardan seçilir.
// Tur sayıları tam sayı olduğundan dönüş bitince kılıç tam yerine oturur.
const SPIN_TURNS_Y = [4, 5, 6];   // sağ-sol (dikey eksen)
const SPIN_TURNS_X = [2, 3, 4];   // yukarı-aşağı (yatay eksen)
const SPIN_TURNS_Z = [1, 2, 3];   // öne doğru tekerlek (derinlik ekseni)
const SPIN_MIN_SPEED = 3;         // m/sn: bu hızın altındaki bıçak ucu hasar vermez
const SPIN_SAFE_DIST = 1.2;       // kameraya bu kadar yakın noktalar kesilmez (oyuncu/tutacak)
const SPIN_CUT_RADIUS = 0.38;
const SPIN_CUT_BUDGET = 600;      // kare başına en çok kesilecek küp
const SPIN_SAMPLES = 9;           // bıçak başına örnek nokta

const lerp = THREE.MathUtils.lerp;

export class HandWeapons {
  constructor(mainScene, camera, voxelWorld, particleSystem, onScore) {
    this.mainScene = mainScene;
    this.camera = camera;
    this.voxelWorld = voxelWorld;
    this.particleSystem = particleSystem;
    this.onScore = onScore;

    this.current = 0;       // 0 roket, 1 minigun, 2 ışın kılıcı
    this.visible = true;    // birinci şahıs kamerada çizilir
    this.fireHeld = false;
    this.spin = 0;          // minigun namlu hızı (0..1)
    this.barrelAngle = 0;
    this.shotTimer = 0;
    this.flashTimer = 0;
    this.kick = 0;          // geri tepme
    this.switchT = 1;       // 0: silah aşağıda, 1: yukarıda
    this.bob = 0;

    this.swingT = -1;       // -1: boşta, 0..1: savuruyor
    this.swingDir = { x: 1, y: 0 }; // savurma yönü (ekranda: x sağ+, y yukarı+)
    this.swingCycle = 0;
    this.mx = 0; this.my = 0;       // son fare hareketi (savurma yönünü belirler)
    this.swingCut = 0;      // bu savuruşta kırılan küp sayısı
    this.swingSoundT = 0;
    this.saberSpin = null;   // sol tıkla başlayan birleşik dönüş: { t, dur, ty, tx, tz }
    this._ay = new THREE.Vector3(0, 1, 0); this._ax = new THREE.Vector3(1, 0, 0); this._az = new THREE.Vector3(0, 0, 1);
    this._qa = new THREE.Quaternion(); this._qb = new THREE.Quaternion(); this._qc = new THREE.Quaternion();
    this.spinQueued = false; // dönüş sürerken gelen tek bir tıklama sırada bekler
    this.spinCut = 0;        // bu dönüşte kırılan küp sayısı
    this.spinLastDir = -1;
    this.spinPrev = null;    // önceki karede bıçak örnek noktaları (dünya)
    this.spinHitT = 0;       // çarpma sesi/kıvılcım aralığı
    this.spinGroundT = 0;    // zemin kırma aralığı
    this.saberMotion = 0;    // 0..1 kılıç hızı (ses perdesi için)
    this.tracers = [];

    // ── Silah modeli sahnesi (ana sahneden ayrı çizilir) ──
    this.viewScene = new THREE.Scene();
    this.viewCam = new THREE.PerspectiveCamera(60, camera.aspect, 0.01, 20);
    this.viewScene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9);
    dl.position.set(0.5, 1, 0.8);
    this.viewScene.add(dl);

    this.root = new THREE.Group();
    this.viewScene.add(this.root);

    this._buildRocket();
    this._buildMinigun();
    this._buildSaber();
    this._buildBomb();
    this._buildGuns();
    this.arsenal = new Arsenal(this);   // 6 yeni silah (kimlik 10-15)
    this.gunCooldown = 0;
    this.scoped = false;
    this.mag = { ...MAG_SIZE };   // her silahın şarjöründeki mermi
    this.reloading = null;        // { kind, t, dur, audio } — şarjör değişiyorsa
    this.onAmmoChange = null;     // HUD güncellemesi için geri çağrı

    // Kılıcın çevreyi aydınlatması (mavi ışık)
    this.saberLight = new THREE.PointLight(0x5ac8ff, 0, 9);
    mainScene.add(this.saberLight);
    // Namlu ateşi ışığı
    this.flashLight = new THREE.PointLight(0xffc04d, 0, 10);
    mainScene.add(this.flashLight);

    this.tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });

    this.setWeapon(0);
  }

  // ───────────────────────── Modeller ─────────────────────────
  _buildRocket() {
    const g = new THREE.Group();
    const olive = new THREE.MeshLambertMaterial({ color: 0x4b5a3e });
    const dark = new THREE.MeshLambertMaterial({ color: 0x22272e });
    const red = new THREE.MeshLambertMaterial({ color: 0xdc2626 });

    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.95), olive);
    const ring1 = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.21, 0.07), dark);
    ring1.position.z = -0.45;
    const ring2 = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.21, 0.07), dark);
    ring2.position.z = 0.1;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.16), red);
    nose.position.z = -0.55;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), dark);
    grip.position.set(0, -0.17, 0.05);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.12), dark);
    sight.position.set(0, 0.12, -0.1);
    g.add(tube, ring1, ring2, nose, grip, sight);
    g.position.set(0.3, -0.26, -0.62);
    g.rotation.y = 0.05;
    this.rocketModel = g;
    this.root.add(g);
  }

  // Tek minigun modeli: { g, barrels, flash }
  _makeMinigun() {
    const g = new THREE.Group();
    const steel = new THREE.MeshLambertMaterial({ color: 0x4b5563 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const brass = new THREE.MeshLambertMaterial({ color: 0xb08a2e });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.5), dark);
    body.position.z = 0.05;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.09), steel);
    handle.position.set(0, -0.2, 0.15);
    const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, 0.28), brass);
    ammo.position.set(-0.19, -0.04, 0.1);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.04), brass);
    belt.position.set(-0.09, 0.0, 0.05);

    // Dönen 6 namlu
    const barrels = new THREE.Group();
    barrels.position.z = -0.52;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.78), steel);
      b.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0);
      barrels.add(b);
    }
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.07), dark);
    shroud.position.z = -0.28;
    const muzzleRing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), dark);
    muzzleRing.position.z = -0.9;

    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd45a })
    );
    flash.position.z = -0.97;
    flash.visible = false;

    g.add(body, handle, ammo, belt, barrels, shroud, muzzleRing, flash);
    g.position.set(0.28, -0.3, -0.7);
    this.root.add(g);
    return { g, barrels, flash };
  }

  // Elde görünen modeller: yalnız seçili silah
  _applyVisibility() {
    const i = this.current, h = false;
    this.rocketModel.visible = !h && i === 0;
    this.minigunModel.visible = !h && (i === 1 || i === 9);   // 9: çift minigun
    this.minigunModel2.visible = !h && i === 9;
    this.saberModel.visible = !h && i === 2;
    this.bombModel.visible = !h && (i === 3 || i === 4);
    Object.entries(this.gunModels).forEach(([k, g]) => g.visible = !h && Number(k) === i);
    if (this.arsenal) this.arsenal.applyVisibility(i);
  }

  // Sağ el minigunu (tekli minigun ve çift minigunun sağ eli) + sol el minigunu (yalnız çift minigunda; sağın aynası)
  _buildMinigun() {
    const r = this._makeMinigun();
    this.minigunModel = r.g; this.barrels = r.barrels; this.minigunFlash = r.flash;
    const l = this._makeMinigun();
    l.g.scale.x = -1;                       // ayna: iki silah simetrik durur
    l.g.visible = false;
    this.minigunModel2 = l.g; this.barrels2 = l.barrels; this.minigunFlash2 = l.flash;
  }

  _buildSaber() {
    // Pivot = tutacağın ortası; savurma ve dönüş bu noktanın etrafında olur.
    // saberPivot (konum + savurma) → spinGroup (sol tık dönüşü) → saber (model eğimi + parçalar)
    this.saberPivot = new THREE.Group();
    this.saberPivot.position.set(SABER_HOLD.x, SABER_HOLD.y, SABER_HOLD.z);
    this.spinGroup = new THREE.Group();
    this.saberPivot.add(this.spinGroup);

    const saber = new THREE.Group();
    saber.rotation.x = -0.5;   // hafif öne eğik: iki bıçak da ekranda dengeli görünür
    saber.rotation.z = -0.5;
    this.saberBody = saber;

    const metal = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.05, SABER_HILT_HALF * 2, 0.05), metal);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.06), dark);
    saber.add(hilt, grip);

    // İki yayıcı + iki bıçak (çekirdek + iki ışıma katmanı); +1 ön, -1 arka bıçak
    this.bladeHalos = [];
    for (const sign of [1, -1]) {
      const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.075), metal);
      emitter.position.y = sign * (SABER_HILT_HALF - 0.01);
      const mid = SABER_HILT_HALF + SABER_BLADE_LEN / 2;
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, SABER_BLADE_LEN, 0.03),
        new THREE.MeshBasicMaterial({ color: 0xe8fbff })
      );
      core.position.y = sign * mid;
      const halo = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, SABER_BLADE_LEN + 0.05, 0.085),
        new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      halo.position.y = sign * (mid + 0.01);
      const halo2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, SABER_BLADE_LEN + 0.08, 0.15),
        new THREE.MeshBasicMaterial({ color: 0x1d7bff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      halo2.position.y = sign * (mid + 0.02);
      this.bladeHalos.push([halo, 0.42], [halo2, 0.16]);
      saber.add(emitter, core, halo, halo2);
    }

    this.spinGroup.add(saber);
    this.saberModel = this.saberPivot;
    this.root.add(this.saberPivot);
  }

  _buildBomb() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), new THREE.MeshLambertMaterial({ color: 0x3a3f47 }));
    this.bombLamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.09), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    this.bombLamp.position.y = 0.13;
    const wire = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: 0xd4a017 }));
    wire.position.set(0.08, 0.15, 0);
    g.add(body, this.bombLamp, wire);
    g.position.set(0.3, -0.28, -0.55);
    g.rotation.set(0.25, 0.4, 0);
    this.bombModel = g;
    this.root.add(g);
  }

  _buildGuns() {
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 }), steel = new THREE.MeshLambertMaterial({ color: 0x4b5563 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x7c4a1e }), black = new THREE.MeshLambertMaterial({ color: 0x0b0f14 });
    const B = (w, h, d, m, x, y, z) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); return mesh; };
    const mk = (parts, pos) => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); g.position.set(...pos); g.visible = false; this.root.add(g); return g; };
    this.gunModels = {
      5: mk([B(0.07, 0.1, 0.34, steel, 0, 0.05, -0.1), B(0.065, 0.2, 0.09, dark, 0, -0.1, 0.05), B(0.05, 0.05, 0.05, black, 0, 0.1, -0.25)], [0.26, -0.22, -0.5]),
      6: mk([B(0.07, 0.07, 1.05, steel, 0, 0.05, -0.35), B(0.09, 0.1, 0.18, wood, 0, 0.0, -0.1), B(0.08, 0.14, 0.45, wood, 0, -0.04, 0.3), B(0.06, 0.06, 0.45, dark, 0, -0.04, -0.35)], [0.26, -0.24, -0.55]),
      7: mk([B(0.08, 0.12, 0.55, dark, 0, 0.0, -0.1), B(0.045, 0.045, 0.5, steel, 0, 0.02, -0.55), B(0.07, 0.2, 0.1, black, 0, -0.14, -0.05), B(0.08, 0.13, 0.4, wood, 0, -0.02, 0.35), B(0.06, 0.1, 0.25, wood, 0, 0.0, -0.4)], [0.25, -0.24, -0.5]),
      8: mk([B(0.07, 0.1, 0.7, dark, 0, 0.0, -0.05), B(0.045, 0.045, 0.85, steel, 0, 0.02, -0.75), B(0.06, 0.11, 0.3, wood, 0, -0.04, 0.4), B(0.07, 0.07, 0.34, black, 0, 0.12, -0.1), B(0.09, 0.09, 0.06, steel, 0, 0.12, -0.3), B(0.09, 0.09, 0.06, steel, 0, 0.12, 0.1)], [0.25, -0.24, -0.5])
    };
  }

  setBombModel(i) {
    this.bombModel.visible = i === 3 || i === 4;
    if (i === 3) this.bombLamp.material.color.setHex(0xff2222);
    if (i === 4) this.bombLamp.material.color.setHex(0x33ff66);
  }

  // ───────────────────────── Silah değiştirme ─────────────────────────
  setWeapon(i) {
    if (i !== this.current) this.switchT = 0; // silah aşağıdan yukarı kalkar
    this.current = i;
    this.fireHeld = false;
    this.swingT = -1;
    this._cancelReload();   // silah değişince yarım kalan şarjör değişimi iptal olur
    this._endSpin();
    this._applyVisibility();
    if (this.arsenal) this.arsenal.onSwitch(i);
    if (i !== 8) this.scoped = false;
    if (i === 2) sound.playSaberOn();
    else sound.updateSaberHum(false);
    if (i !== 2) this.saberLight.intensity = 0;
    this._ammoChanged();
  }

  setFirstPerson(on) { this.visible = on; }

  // Roket atıldı: geri tepme
  onRocketFired() { this.kick = 1; }

  // ───────────────────────── Güncelleme ─────────────────────────
  startSwing() {
    if (this.current !== 2 || this.swingT >= 0) return false;
    this.swingT = 0;
    this.swingCut = 0;
    // Yön: son fare hareketine göre (sağa çekersen sağa keser, aşağı çekersen yukarıdan aşağı).
    // Fare durağansa eğik, dikey ve yatay kesikler sırayla değişir.
    const mag = Math.hypot(this.mx, this.my);
    if (mag > 25) {
      this.swingDir = { x: this.mx / mag, y: -this.my / mag };
    } else {
      const combo = [[1, 0.0], [-1, 0.6], [0.55, -1], [-0.6, -1], [0, 1], [1, 0.7], [-1, -0.2]];
      const c = combo[this.swingCycle++ % combo.length];
      const m = Math.hypot(c[0], c[1]);
      this.swingDir = { x: c[0] / m, y: c[1] / m };
    }
    sound.playSaberSwing();
    return true;
  }

  // Sol tık: çift bıçaklı kılıcı BİR tıkla ~2.5 sn boyunca sürekli döndürür: sağ-sol, yukarı-aşağı ve ileri doğru
  // dönüşler birleşik (kılıç her yöne takla atar). Yönler (±) her tıkta rastgele seçilir. Dönüş sürerken gelen
  // tıklamalardan yalnızca biri sıraya alınır; bitince hemen başlar. Fazlası yok sayılır.
  startSpin() {
    if (this.current !== 2 || this.swingT >= 0) return false;
    if (this.saberSpin) { this.spinQueued = true; return true; }
    const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)] * (Math.random() < 0.5 ? -1 : 1);
    this.saberSpin = { t: 0, dur: SPIN_TIME, ty: pickOf(SPIN_TURNS_Y), tx: pickOf(SPIN_TURNS_X), tz: pickOf(SPIN_TURNS_Z) };
    this.spinCut = 0;
    this.spinPrev = null;
    sound.playSaberSpin(SPIN_TIME, Math.abs(this.saberSpin.ty));
    return true;
  }

  _endSpin() {
    this.saberSpin = null;
    this.spinQueued = false;
    this.spinPrev = null;
    if (this.spinGroup) this.spinGroup.quaternion.identity();
  }

  update(dt, ctx) {
    const cam = this.camera;
    this.viewCam.aspect = cam.aspect;
    this.viewCam.updateProjectionMatrix();

    if (this.reloading) {
      this.reloading.t += dt;
      if (this.reloading.t >= this.reloading.dur) {
        this.mag[this.reloading.kind] = MAG_SIZE[this.reloading.kind];
        this.reloading = null;
        this._ammoChanged();
      }
    }

    this.switchT = Math.min(1, this.switchT + dt * 5);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    const md = Math.exp(-6 * dt); this.mx *= md; this.my *= md; // fare hareketi zamanla söner

    // Yürüyüş sallanması (silahın hafifçe oynaması)
    this.bob += ((ctx.moving ? 1 : 0) - this.bob) * (1 - Math.exp(-8 * dt));
    const t = ctx.walkCycle;
    const swayX = Math.sin(t) * 0.012 * this.bob;
    const swayY = Math.abs(Math.sin(t)) * 0.012 * this.bob;
    const drop = (1 - this.switchT) * 0.45; // silah değiştirirken aşağıdan çıkar

    // Roket
    this.rocketModel.position.set(0.3 + swayX, -0.26 - swayY - drop, -0.62 + this.kick * 0.1);
    this.rocketModel.rotation.x = this.kick * 0.1;

    this.bombModel.position.set(0.3 + swayX, -0.28 - swayY - drop, -0.55 + this.kick * 0.12);
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    if (this.gunModels[this.current]) {
      const g = this.gunModels[this.current];
      g.position.set(0.26 + swayX, -0.23 - swayY - drop, -0.52 + this.kick * 0.1);
      g.rotation.x = this.kick * 0.08;
    }
    if (this.current === 7 && this.fireHeld) this.fireGun('ak47');

    // Minigun (1) ve çift minigun (9): basılı tutunca namlular dönmeye başlar, hızlanınca ateş eder.
    // Çift minigunda iki el de aynı hızda, aynı sesle ve aynı hasarla ateş eder (her el kendi mermisini atar).
    const mgOn = this.current === 1 || this.current === 9, dual = this.current === 9;
    const targetSpin = mgOn && this.fireHeld ? 1 : 0;
    this.spin += (targetSpin - this.spin) * Math.min(1, dt / (targetSpin ? MINIGUN_SPINUP : 0.6));
    this.barrelAngle += this.spin * 30 * dt;
    sound.updateMinigun(mgOn ? this.spin : 0);
    this.barrels.rotation.z = this.barrelAngle;
    this.barrels2.rotation.z = this.barrelAngle;
    const mgX = dual ? 0.36 : 0.28;
    this.minigunModel.position.set(mgX + swayX, -0.3 - swayY - drop, -0.7 + this.kick * 0.05);
    this.minigunModel2.position.set(-mgX + swayX, -0.3 - swayY - drop, -0.7 + this.kick * 0.05);
    this.minigunModel.rotation.z = (Math.random() - 0.5) * 0.01 * this.spin;
    this.minigunModel2.rotation.z = (Math.random() - 0.5) * 0.01 * this.spin;
    this.minigunFlash.visible = this.flashTimer > 0;
    this.minigunFlash2.visible = dual && this.flashTimer > 0;
    if (mgOn && this.fireHeld && this.spin > 0.85) {
      this.shotTimer -= dt;
      let guard = 0;
      while (this.shotTimer <= 0 && guard++ < 4) {
        this.shotTimer += 1 / MINIGUN_RATE;
        this._fireMinigunBullet(ctx, GUNS.minigun, { x: dual ? 0.34 : 0.26, y: -0.27, z: -1.0 });
        if (dual) this._fireMinigunBullet(ctx, GUNS.minigun, { x: -0.34, y: -0.27, z: -1.0 });   // sol el
      }
    } else {
      this.shotTimer = Math.min(this.shotTimer, 0);
    }

    // Cephanelik (10-15): model, ateş ve mermi/etki güncellemesi
    this.arsenal.update(dt, ctx, { swayX, swayY, drop });

    // Işın kılıcı: hafif parlama + savurma animasyonu
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.02);
    for (const [halo, base] of this.bladeHalos) halo.material.opacity = base * pulse;
    let swingU = 0;
    if (this.swingT >= 0) {
      this.swingT += dt / SABER_SWING_TIME;
      swingU = Math.min(1, this.swingT);
      this._saberDamage(ctx, swingU);
      if (this.swingT >= 1) {
        this.swingT = -1;
        if (this.swingCut > 0 && this.onScore) {
          const pts = Math.max(1, Math.round(this.swingCut * 14 / 8));
          this.onScore(pts, `+${pts} IŞIN KILICI!`);
        }
      }
    }
    // Savurma: geriye çek, seçilen yönde hızla salla, yerine dön. Yön yatay, dikey ya da çapraz olabilir.
    // Tam tur dönüş (sol tık): yumuşak hızlanıp yavaşlar; dönüş bitince sıradaki tıklama varsa hemen yenisi başlar
    let spinSpeed = 0;
    if (this.saberSpin) {
      const sp = this.saberSpin;
      sp.t += dt;
      const u = Math.min(1, sp.t / sp.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // ease-in-out cubic
      const T2 = Math.PI * 2 * e;
      const qy = this._qa.setFromAxisAngle(this._ay, T2 * sp.ty), qx = this._qb.setFromAxisAngle(this._ax, T2 * sp.tx), qz = this._qc.setFromAxisAngle(this._az, T2 * sp.tz);
      this.spinGroup.quaternion.copy(qy).multiply(qx).multiply(qz);   // üç eksenin birleşimi
      if (u >= 1) {
        if (this.spinCut > 0 && this.onScore) {
          const pts = Math.max(1, Math.round(this.spinCut * 14 / 8));
          this.onScore(pts, `+${pts} IŞIN KILICI!`);
        }
        const again = this.spinQueued;
        this._endSpin();
        if (again) this.startSpin();
      }
    }

    const sCur = swingU <= 0 ? 0
      : swingU < 0.2 ? lerp(0, -1.15, swingU / 0.2)
      : swingU < 0.8 ? lerp(-1.15, 1, (swingU - 0.2) / 0.6)
      : lerp(1, 0, (swingU - 0.8) / 0.2);
    const dx = this.swingDir.x, dy = this.swingDir.y;
    const ox = dx * sCur, oy = dy * sCur;
    const arc = Math.sin(swingU * Math.PI);
    this.saberPivot.position.set(
      SABER_HOLD.x + swayX + ox * 0.42,
      SABER_HOLD.y - swayY - drop + oy * 0.28 - arc * 0.05,
      SABER_HOLD.z - arc * 0.14
    );
    this.saberPivot.rotation.z = swingU > 0 ? 0.42 - ox * 1.05 : -0.18;
    this.saberPivot.rotation.x = swingU > 0 ? -oy * 0.85 : 0;
    this.saberPivot.rotation.y = swingU > 0 ? ox * 0.25 : 0;

    // Dönüş hasarı: bıçakların gerçek konumundan (iki bıçak da)
    this.spinHitT -= dt; this.spinGroundT -= dt;
    if (this.saberSpin) spinSpeed = this._spinDamage(dt);
    else this.spinPrev = null;

    // Kılıç hızı → vızıltının perdesi (yumuşatılmış)
    const motionTarget = Math.min(1, Math.max(spinSpeed / 25, this.swingT >= 0 ? 0.55 : 0));
    this.saberMotion += (motionTarget - this.saberMotion) * Math.min(1, dt * 12);
    sound.updateSaberHum(this.current === 2 && this.visible, this.saberMotion);

    // Kılıç ışığı dünyayı mavi aydınlatır
    if (this.current === 2 && this.visible) {
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      this.saberLight.position.copy(cam.position).addScaledVector(fwd, 1.4);
      this.saberLight.intensity = 1.4 * pulse + (this.swingT >= 0 || this.saberSpin ? 0.8 : 0);
    } else {
      this.saberLight.intensity = 0;
    }
    this.flashLight.intensity = this.flashTimer > 0 ? 2.2 : 0;

    // İz mermileri (tracer)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.mainScene.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }

  // Ekranda çizilen elin dünya konumu (namlu/ışın başlangıcı için)
  _handWorld(offset) {
    const v = new THREE.Vector3(offset.x, offset.y, offset.z);
    v.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    return v;
  }

  // ───────────────────────── Minigun ─────────────────────────
  _fireMinigunBullet(ctx, o = GUNS.minigun, muzzleOff = { x: 0.26, y: -0.27, z: -1.0 }) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    // Hafif saçılma
    const spread = this.scoped && o.spread > 0 ? o.spread * 0.3 : o.spread;
    const dir = fwd.clone();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2)
       .addScaledVector(up, (Math.random() - 0.5) * spread * 2).normalize();

    const origin = cam.position.clone();
    const muzzle = this._handWorld(muzzleOff);

    // Işın voxel ızgarasında adım adım ilerler
    const step = VOXEL_SIZE * 0.5;
    const p = origin.clone();
    let hit = null, hitType = null;
    for (let d = 0.3; d < o.range; d += step) {
      p.copy(origin).addScaledVector(dir, d);
      const key = `${Math.round(p.x / VOXEL_SIZE)},${Math.round((p.y - VOXEL_SIZE / 2) / VOXEL_SIZE)},${Math.round(p.z / VOXEL_SIZE)}`;
      const v = this.voxelWorld.voxels.get(key);
      if (v && v.active) { hit = p.clone(); hitType = 'voxel'; break; }
      const gy = this.voxelWorld.terrain.topYAt(p.x, p.z);
      if (p.y <= gy && this.voxelWorld.terrain.topIntactAt(p.x, p.z)) {
        hit = new THREE.Vector3(p.x, gy, p.z); hitType = 'ground'; break;
      }
      if (p.y < -0.4) break; // denize düştü
    }

    // Köprü ipi? (ince ip vurulunca kopar)
    if (this.voxelWorld.bridge) {
      const bh = this.voxelWorld.bridge.rayHit(origin, dir, hit ? origin.distanceTo(hit) : o.range);
      if (bh) {
        this._spawnTracer(muzzle, bh.point);
        this.voxelWorld.bridge.cutRope(bh.rope, bh.point, dir);
        if (this.particleSystem.createSpark) this.particleSystem.createSpark(bh.point);
        this.flashTimer = 0.04; this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    // Televizyon ekranına mı çarptı? (ateş edilen yerde kırık izi oluşur ve TV ekranı siyah olur)
    if (this.voxelWorld.homeTV) {
      const th = this.voxelWorld.homeTV.rayHit(origin, dir, hit ? origin.distanceTo(hit) : o.range);
      if (th) {
        this._spawnTracer(muzzle, th.point);
        this.voxelWorld.homeTV.hitAt(th.point.y, th.point.z);
        if (this.particleSystem.createSpark) this.particleSystem.createSpark(th.point);
        this.flashTimer = 0.04; this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    // Önce bir kapıya mı çarptı? (kapalı kapı mermiyi durdurur ve hasar alır)
    if (this.voxelWorld.doors) {
      const dh = this.voxelWorld.doors.rayHit(origin, dir, hit ? origin.distanceTo(hit) : o.range);
      if (dh) {
        this._spawnTracer(muzzle, dh.point);
        this.voxelWorld.doors.damage(dh.door, o.carDmg);
        if (this.particleSystem.createSpark) this.particleSystem.createSpark(dh.point);
        this.flashTimer = 0.04; this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    // Önce bir araca mı çarptı? (yol üstündeki arabayı durdurur)
    if (this.cars) {
      const ch = this.cars.rayHit(origin, dir, hit ? origin.distanceTo(hit) : o.range);
      if (ch) {
        this._spawnTracer(muzzle, ch.point);
        this.cars.bulletHit(ch.car, { dmg: o.carDmg, point: ch.point, iron: !!o.iron });   // yalnız pompalı ve sniper demiri kırar
        if (this.particleSystem.createSpark) this.particleSystem.createSpark(ch.point);
        this.flashTimer = 0.04; this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    // Havada uçak mı var?
    if (this.planes) {
      const ph = this.planes.rayHit(origin, dir, o.range);
      if (ph) {
        this._spawnTracer(muzzle, ph.point);
        for (let i = 0; i < o.planeDmg; i++) this.planes.bulletHit(ph.plane);
        if (this.particleSystem.createSpark) this.particleSystem.createSpark(ph.point);
        this.flashTimer = 0.04; this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    // Mermi önce bir NPC'ye mi çarptı?
    if (this.npcs) {
      const hitDist = hit ? origin.distanceTo(hit) : o.range;
      const nh = this.npcs.rayHit(origin, dir, hitDist);
      if (nh) {
        this._spawnTracer(muzzle, nh.point);
        this.npcs.killNpc(nh.npc, origin, { bullet: true, head: nh.head, point: nh.point });   // kurşun: kafa parçalanır, gövde yaralanır
        this.flashTimer = 0.04;
        this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        this._shotSound(o);
        return;
      }
    }

    const end = hit || origin.clone().addScaledVector(dir, o.range);
    this._spawnTracer(muzzle, end);

    if (hit) {
      if (hitType === 'voxel') {
        this.voxelWorld.gunHit(hit, o.power, o.radius);
      } else if (Math.random() < 0.5) {
        this.voxelWorld.breakGround(hit, 0.45, 40);
      }
      if (this.particleSystem.createSpark) this.particleSystem.createSpark(hit);
    }

    this.flashTimer = 0.04;
    this.kick = Math.min(1, this.kick + 0.35);
    this.flashLight.position.copy(muzzle);
    this._shotSound(o);
  }

  _shotSound(o) {
    if (o.sound === 'none') return;
    if (o.sound === 'every' || (this._soundSkip = !this._soundSkip)) sound.playGunShot(o.kind);
  }

  // Tek atış silahlar (tabanca, pompalı, sniper) ve otomatik AK-47 buradan ateşler
  fireGun(kind) {
    const o = GUNS[kind];
    const cd = { pistol: 0.22, shotgun: 0.85, sniper: 1.4, ak47: 0.1 }[kind];
    if (this.gunCooldown > 0 || this.reloading) return false;
    if (this.mag[kind] <= 0) { this.reload(); return false; }
    this.gunCooldown = cd;
    const pellets = o.pellets || 1;
    for (let i = 0; i < pellets; i++) this._fireMinigunBullet(null, i === 0 ? o : { ...o, sound: 'none' });
    this.kick = Math.min(1, (o.kick || 0.5));
    this.flashTimer = 0.05;
    if (kind === 'sniper' && this.scoped === false) { /* kalkandan atış: geniş saçılma */ }
    this.mag[kind]--;
    if (this.mag[kind] <= 0) this.reload();                       // şarjör boşaldı: otomatik değiştir
    else if (kind === 'shotgun') sound.playPump(0.4);             // pompalıda her atıştan sonra sürgü
    this._ammoChanged();
    return true;
  }

  // ───────────────────────── Şarjör ─────────────────────────
  // Elindeki silah şarjörlüyse ve tam dolu değilse şarjörü değiştirmeye başlar (R tuşu / otomatik).
  reload() {
    const kind = WEAPON_KIND[this.current];
    if (!MAG_SIZE[kind] || this.reloading || this.mag[kind] >= MAG_SIZE[kind]) return false;
    const dur = RELOAD_TIME[kind];
    this.reloading = { kind, t: 0, dur, audio: sound.playReload(kind, dur) };
    this.fireHeld = false;
    this._ammoChanged();
    return true;
  }

  _cancelReload() {
    if (!this.reloading) return;
    if (this.reloading.audio) this.reloading.audio.cancel();
    this.reloading = null;
  }

  resetAmmo() {
    this._cancelReload();
    if (this.arsenal) this.arsenal.reset();
    this.mag = { ...MAG_SIZE };
    this._ammoChanged();
  }

  // HUD için: şarjörlü silah elindeyse { mag, size, reloading }, değilse null
  ammoInfo() {
    const kind = WEAPON_KIND[this.current];
    if (!MAG_SIZE[kind]) return null;
    return { mag: this.mag[kind], size: MAG_SIZE[kind], reloading: !!(this.reloading && this.reloading.kind === kind) };
  }

  _ammoChanged() { if (this.onAmmoChange) this.onAmmoChange(this.ammoInfo()); }

  setScoped(on) {
    if (on && this.current !== 8) return false;
    this.scoped = on;
    return true;
  }

  _spawnTracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.z = len;
    mesh.lookAt(to);
    this.mainScene.add(mesh);
    this.tracers.push({ mesh, life: 0.045 });
  }

  // ───────────────────────── Işın kılıcı ─────────────────────────
  // Savurma sırasında bıçağın geçtiği noktalardaki bina küpleri ve zemin kırılır.
  _saberDamage(ctx, u) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();

    // Savurma yayı: seçilen yönde (yatay, dikey veya çapraz), vuruş evresinde -1'den +1'e
    const s = lerp(-1.0, 1.0, Math.min(1, Math.max(0, (u - 0.2) / 0.6)));
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const dir = fwd.clone()
      .addScaledVector(right, this.swingDir.x * s * 1.05)
      .addScaledVector(up, this.swingDir.y * s * 0.85 - 0.12).normalize();

    const base = cam.position.clone().addScaledVector(fwd, 0.3);
    base.y -= 0.25;

    // Yalnız vuruş evresinde kes (geri çekilirken değil)
    if (u < 0.2 || u > 0.85) return;

    let cut = 0, soundPlayed = false;
    for (let d = 0.7; d <= SABER_REACH; d += 0.3) {
      const pt = base.clone().addScaledVector(dir, d);
      const n = this.voxelWorld.sweepCut(pt, SABER_RADIUS);
      cut += n;
      if (this.npcs) this.npcs.hitSphere(pt, SABER_RADIUS + 0.25);
      if (this.cars) this.cars.bladeHit(pt, SABER_RADIUS);       // ışın kılıcı arabayı (demir dahil) keser
      this.voxelWorld.doors.hitSphere(pt, SABER_RADIUS, 4);        // ve kapıları
      const gy = this.voxelWorld.terrain.topYAt(pt.x, pt.z);
      if (pt.y <= gy + 0.3 && this.voxelWorld.terrain.topIntactAt(pt.x, pt.z)) {
        this.voxelWorld.breakGround(new THREE.Vector3(pt.x, gy, pt.z), 0.55, 50);
      }
      if (n > 0 && !soundPlayed && this.swingSoundT <= 0) {
        sound.playSaberHit();
        this.swingSoundT = 0.08;
        soundPlayed = true;
      }
    }
    this.swingSoundT -= 1 / 60;
    this.swingCut += cut;
  }

  // Dönüş hasarı: iki bıçağın modelden alınan GERÇEK konumları her karede örneklenir; önceki kare ile bu kare
  // arasındaki yol ara adımlarla taranır (hızlı dönüşte duvarın içinden "atlamasın). Kopan küpler bıçağın o
  // noktadaki hareket yönünde savrulur. Kameraya yakın noktalar atlanır, kare başına kesim bütçesi vardır.
  // Dönen değer: en hızlı bıçak noktasının hızı (m/sn).
  _spinDamage(dt) {
    const cam = this.camera;
    this.root.updateMatrixWorld(true);
    const centerV = new THREE.Vector3().setFromMatrixPosition(this.saberPivot.matrixWorld);

    // Örnek noktalar: model uzayı → büyütülmüş → dünya
    const cur = [];
    for (const sign of [1, -1]) {
      for (let i = 0; i < SPIN_SAMPLES; i++) {
        const f = (i + 0.5) / SPIN_SAMPLES;
        const v = this.saberBody.localToWorld(new THREE.Vector3(0, sign * (SABER_HILT_HALF + f * SABER_BLADE_LEN), 0));
        v.sub(centerV).multiplyScalar(SABER_BLADE_SCALE).add(centerV);
        cur.push(v.applyQuaternion(cam.quaternion).add(cam.position));
      }
    }
    const prev = this.spinPrev || cur;
    this.spinPrev = cur;
    if (prev === cur) return 0;

    const safe2 = SPIN_SAFE_DIST * SPIN_SAFE_DIST;
    let maxSpeed = 0, maxDist = 0;
    const vel = cur.map((c, i) => {
      const v = c.clone().sub(prev[i]).divideScalar(Math.max(dt, 1e-3));
      const sp = v.length();
      if (sp > maxSpeed) maxSpeed = sp;
      maxDist = Math.max(maxDist, sp * dt);
      if (sp > 28) v.multiplyScalar(28 / sp);   // savrulma hızı sınırlı
      return v;
    });
    if (maxSpeed < SPIN_MIN_SPEED) return maxSpeed;

    const steps = Math.min(16, Math.max(1, Math.ceil(maxDist / 0.35)));
    let budget = SPIN_CUT_BUDGET, cutNow = 0, hitPoint = null;
    const pt = new THREE.Vector3();
    for (let j = 1; j <= steps && budget > 0; j++) {
      for (let i = 0; i < cur.length && budget > 0; i++) {
        if (vel[i].length() < SPIN_MIN_SPEED) continue;
        pt.lerpVectors(prev[i], cur[i], j / steps);
        if (pt.distanceToSquared(cam.position) < safe2) continue;
        const n = this.voxelWorld.sweepCut(pt, SPIN_CUT_RADIUS, vel[i]);
        if (n > 0) { cutNow += n; budget -= n; if (!hitPoint) hitPoint = pt.clone(); }
      }
    }
    // NPC'ler ve zemin yalnız güncel konumda kontrol edilir (zemin seyrek kırılır)
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c.distanceToSquared(cam.position) < safe2 || vel[i].length() < SPIN_MIN_SPEED) continue;
      if (this.npcs) this.npcs.hitSphere(c, SPIN_CUT_RADIUS + 0.3);
      if (this.cars) this.cars.bladeHit(c, SPIN_CUT_RADIUS + 0.3);
      this.voxelWorld.doors.hitSphere(c, SPIN_CUT_RADIUS + 0.3, 4);
      if (this.spinGroundT <= 0) {
        const gy = this.voxelWorld.terrain.topYAt(c.x, c.z);
        if (c.y <= gy + 0.3 && this.voxelWorld.terrain.topIntactAt(c.x, c.z)) {
          this.voxelWorld.breakGround(new THREE.Vector3(c.x, gy, c.z), 0.55, 50);
          this.spinGroundT = 0.12;
        }
      }
    }
    this.spinCut += cutNow;
    if (hitPoint && this.spinHitT <= 0) {
      sound.playSaberHit();
      if (this.particleSystem.createSpark) this.particleSystem.createSpark(hitPoint);
      this.spinHitT = 0.12;
    }
    return maxSpeed;
  }

  // ───────────────────────── Çizim ─────────────────────────
  render(renderer) {
    if (!this.visible || this.scoped) return;
    renderer.clearDepth();
    renderer.render(this.viewScene, this.viewCam);
  }
}
