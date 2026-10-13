import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y } from './terrain.js';

// Elde taşınan silahlar: ekranın sağ altında görünen silah modelleri (birinci şahıs),
// minigun (basılı tutunca otomatik ateş) ve ışın kılıcı (savurma ile yıkım).
// Silah modelleri ayrı bir sahnede çizilir: duvara yaklaşınca içine girmez.

const MINIGUN_RATE = 18;       // saniyedeki mermi
const MINIGUN_SPINUP = 0.35;   // namlular bu sürede tam hıza çıkar
const MINIGUN_RANGE = 90;
const SABER_SWING_TIME = 0.42;
const SABER_REACH = 3.2;       // metre: kılıç etkisi
const SABER_RADIUS = 0.42;

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

  _buildMinigun() {
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
    this.barrels = new THREE.Group();
    this.barrels.position.z = -0.52;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.78), steel);
      b.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0);
      this.barrels.add(b);
    }
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.07), dark);
    shroud.position.z = -0.28;
    const muzzleRing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), dark);
    muzzleRing.position.z = -0.9;

    this.minigunFlash = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd45a })
    );
    this.minigunFlash.position.z = -0.97;
    this.minigunFlash.visible = false;

    g.add(body, handle, ammo, belt, this.barrels, shroud, muzzleRing, this.minigunFlash);
    g.position.set(0.28, -0.3, -0.7);
    this.minigunModel = g;
    this.root.add(g);
  }

  _buildSaber() {
    // Pivot: elin bulunduğu nokta; savurma bu noktanın etrafında döner
    this.saberPivot = new THREE.Group();
    this.saberPivot.position.set(0.34, -0.36, -0.5);

    const saber = new THREE.Group();
    saber.rotation.x = -1.1; // bıçak ileri ve yukarı bakar

    const metal = new THREE.MeshLambertMaterial({ color: 0x9ca3af });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), metal);
    hilt.position.y = 0.0;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.12, 0.058), dark);
    grip.position.y = -0.05;
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.075), metal);
    emitter.position.y = 0.17;

    this.bladeCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 1.15, 0.03),
      new THREE.MeshBasicMaterial({ color: 0xe8fbff })
    );
    this.bladeCore.position.y = 0.2 + 0.575;
    this.bladeHalo = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 1.2, 0.085),
      new THREE.MeshBasicMaterial({
        color: 0x3aa8ff, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.bladeHalo.position.y = 0.2 + 0.6;
    this.bladeHalo2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 1.24, 0.15),
      new THREE.MeshBasicMaterial({
        color: 0x1d7bff, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    this.bladeHalo2.position.y = 0.2 + 0.62;

    saber.add(hilt, grip, emitter, this.bladeCore, this.bladeHalo, this.bladeHalo2);
    this.saberPivot.add(saber);
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
    this.rocketModel.visible = i === 0;
    this.minigunModel.visible = i === 1;
    this.saberModel.visible = i === 2;
    this.bombModel.visible = i === 3 || i === 4;
    if (i === 2) sound.playSaberOn();
    if (i !== 2) this.saberLight.intensity = 0;
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

  update(dt, ctx) {
    const cam = this.camera;
    this.viewCam.aspect = cam.aspect;
    this.viewCam.updateProjectionMatrix();

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

    // Minigun: basılı tutunca namlular dönmeye başlar, hızlanınca ateş eder
    const targetSpin = this.current === 1 && this.fireHeld ? 1 : 0;
    this.spin += (targetSpin - this.spin) * Math.min(1, dt / (targetSpin ? MINIGUN_SPINUP : 0.6));
    this.barrelAngle += this.spin * 30 * dt;
    this.barrels.rotation.z = this.barrelAngle;
    this.minigunModel.position.set(0.28 + swayX, -0.3 - swayY - drop, -0.7 + this.kick * 0.05);
    this.minigunModel.rotation.z = (Math.random() - 0.5) * 0.01 * this.spin;
    this.minigunFlash.visible = this.flashTimer > 0;
    if (this.current === 1 && this.fireHeld && this.spin > 0.85) {
      this.shotTimer -= dt;
      let guard = 0;
      while (this.shotTimer <= 0 && guard++ < 4) {
        this.shotTimer += 1 / MINIGUN_RATE;
        this._fireMinigunBullet(ctx);
      }
    } else {
      this.shotTimer = Math.min(this.shotTimer, 0);
    }

    // Işın kılıcı: hafif parlama + savurma animasyonu
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.02);
    this.bladeHalo.material.opacity = 0.42 * pulse;
    this.bladeHalo2.material.opacity = 0.16 * pulse;
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
    const sCur = swingU <= 0 ? 0
      : swingU < 0.2 ? lerp(0, -1.15, swingU / 0.2)
      : swingU < 0.8 ? lerp(-1.15, 1, (swingU - 0.2) / 0.6)
      : lerp(1, 0, (swingU - 0.8) / 0.2);
    const dx = this.swingDir.x, dy = this.swingDir.y;
    const ox = dx * sCur, oy = dy * sCur;
    const arc = Math.sin(swingU * Math.PI);
    this.saberPivot.position.set(
      0.2 + swayX + ox * 0.42,
      -0.36 - swayY - drop + oy * 0.28 - arc * 0.05,
      -0.5 - arc * 0.14
    );
    this.saberPivot.rotation.z = swingU > 0 ? 0.42 - ox * 1.05 : -0.18;
    this.saberPivot.rotation.x = swingU > 0 ? -oy * 0.85 : 0;
    this.saberPivot.rotation.y = swingU > 0 ? ox * 0.25 : 0;

    // Kılıç ışığı dünyayı mavi aydınlatır
    if (this.current === 2 && this.visible) {
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      this.saberLight.position.copy(cam.position).addScaledVector(fwd, 1.4);
      this.saberLight.intensity = 1.4 * pulse + (this.swingT >= 0 ? 0.8 : 0);
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
  _fireMinigunBullet(ctx) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    // Hafif saçılma
    const spread = 0.012;
    const dir = fwd.clone();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2)
       .addScaledVector(up, (Math.random() - 0.5) * spread * 2).normalize();

    const origin = cam.position.clone();
    const muzzle = this._handWorld({ x: 0.26, y: -0.27, z: -1.0 });

    // Işın voxel ızgarasında adım adım ilerler
    const step = VOXEL_SIZE * 0.5;
    const p = origin.clone();
    let hit = null, hitType = null;
    for (let d = 0.3; d < MINIGUN_RANGE; d += step) {
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

    // Mermi önce bir NPC'ye mi çarptı?
    if (this.npcs) {
      const hitDist = hit ? origin.distanceTo(hit) : MINIGUN_RANGE;
      const nh = this.npcs.rayHit(origin, dir, hitDist);
      if (nh) {
        this._spawnTracer(muzzle, nh.point);
        this.npcs.killNpc(nh.npc, origin);
        this.flashTimer = 0.04;
        this.kick = Math.min(1, this.kick + 0.35);
        this.flashLight.position.copy(muzzle);
        if (this._soundSkip = !this._soundSkip) sound.playGunShot();
        return;
      }
    }

    const end = hit || origin.clone().addScaledVector(dir, MINIGUN_RANGE);
    this._spawnTracer(muzzle, end);

    if (hit) {
      if (hitType === 'voxel') {
        this.voxelWorld.gunHit(hit, 0.45, 0.45);
      } else if (Math.random() < 0.5) {
        this.voxelWorld.breakGround(hit, 0.45, 40);
      }
      if (this.particleSystem.createSpark) this.particleSystem.createSpark(hit);
    }

    this.flashTimer = 0.04;
    this.kick = Math.min(1, this.kick + 0.35);
    this.flashLight.position.copy(muzzle);
    if (this._soundSkip = !this._soundSkip) sound.playGunShot();
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

  // ───────────────────────── Çizim ─────────────────────────
  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.viewScene, this.viewCam);
  }
}
