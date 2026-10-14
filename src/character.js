import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';
import { GROUND_Y, BEDROCK_Y } from './terrain.js';
import {
  getCharacterFaceTexture,
  getCharacterShirtTexture,
  getCharacterPantsTexture,
  getStoneTexture,
  getTNTSideTexture
} from './textures.js';

// Tamamen Minecraft Tarzı Kübik Karakter (Steve / Voxel Demolitionist)
// Fizik kutusunun yarı yüksekliği 1.0; bacak modelinin tabanı mesh orijininin 0.475 altında.
// Mesh'i bu farkla yukarı kaydırınca ayak tabanı tam fizik kutusunun tabanına (zemine) oturur.
const BODY_HALF_HEIGHT = 1.0;
const LEG_BOTTOM_Y = -0.475;
const FOOT_OFFSET_Y = BODY_HALF_HEIGHT + LEG_BOTTOM_Y;

// ── Voxel çarpışma ve su ayarları ──
const HALF_W = 0.4;          // karakter yarı genişliği (x, z)
const BODY_H = 2.0;          // çarpışma kutusu yüksekliği
const EPS = 1e-4;
const GRAVITY = 25;
const MAX_FALL = 40;
const WATER_LEVEL = -0.15;   // main.js içindeki deniz yüzeyi (waterMesh.position.y) ile aynı olmalı
const WATER_BOUND = 560;     // deniz düzleminin (1200x1200) kenarından biraz içeride görünmez sınır
const WATER_ENTER_DEPTH = 0.25;   // ayak tabanı yüzeyin en az bu kadar altındaysa yüzme moduna geçilir
const FLOAT_DEPTH = 1.2;     // yüzerken ayak tabanının yüzeyin altında kalacağı derinlik (su göğüs hizasında)
const FLOAT_DEPTH_UP = 0.45; // Space basılıyken daha yüksekte yüzer
const JET_ACC = 46;          // jetpack itki ivmesi (yerçekimi 25'i aşar)
const JET_MAX_UP = 9;        // en yüksek yükselme hızı (m/s)
const JET_SECONDS = 7;       // dolu yakıtla havada kalma süresi
const JET_DRAG = 0.11;       // itki bırakılınca hava direnci (hızın karesiyle): düşüş ~15 m/s'de dengelenir
const STEP_UP_MAX = 0.5;     // otomatik çıkılabilen en yüksek basamak (m)
const WATER_SPEED_MUL = 0.55;
const WATER_HOP_SPEED = 11;  // kıyıya çıkarken zıplama hızı

export class Character {
  constructor(scene, physicsWorld, particleSystem, voxelWorld = null) {
    this.scene = scene;
    this.voxelWorld = voxelWorld;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;

    this.mesh = new THREE.Group();
    this.body = null;

    // Hareket Parametreleri
    this.moveSpeed = 15;
    this.jumpForce = 12;
    this.isGrounded = false;
    this.inWater = false;
    this.waterHopTimer = 0;
    this.rippleTimer = 0;
    this.blockedHoriz = false;
    this.lastBlocked = false;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.fuel = 1;          // jetpack yakıtı (0..1)
    this.jetting = false;
    this.usedJet = false;   // itki kullanıldı: bırakınca hava direnci uygulanır
    this.airTime = 0;
    this.jetTick = 0;   // patlama savrulması (yatay, zamanla söner)     // kendi hızımız (gövde kinematik, Cannon hareket ettirmez)
    this.spawn = { x: 0, y: 3, z: 26 };
    this.walkCycle = 0;
    this.stepTimer = 0;

    // Uzuv Grupları
    this.head = null;
    this.torso = null;
    this.leftArm = null;
    this.rightArm = null;
    this.leftLeg = null;
    this.rightLeg = null;
    this.cannonMuzzle = null;
    this.hammer = null;

    // Çekiç Durumu
    this.isSwingingHammer = false;
    this.hammerSwingTimer = 0;

    // MOD SİSTEMİ: 'normal' veya 'cyborg'
    this.currentMode = 'normal';

    // Silah görsel grupları (setMode'da görünürlük değiştirilir)
    this.pistolGroup = null;      // Tuş 1: Tabanca (sağ el)
    this.laserGroup = null;       // Tuş 2: Cyborg lazer emiteri (sağ el)
    this.hammerGroup = null;      // Çekiç (sol el, her zaman görünür)

    // Cyborg kafası / gözleri (renk değişimi için referans)
    this._headMats = null;
    this._bodyMat = null;
    this._eyeMatLeft = null;
    this._eyeMatRight = null;

    // Lazer ışını görseliyle ilgili geçici mesh
    this.laserBeamMesh = null;
    this.laserBeamTimer = 0;

    this.initPhysics();
    this.initVoxelMesh();
  }

  initPhysics() {
    // Gövde KİNEMATİKTİR: zemin/duvar/su hareketini aşağıdaki _stepPhysics voxel ızgarasıyla çözer.
    // Cannon yalnızca döküntü ve mermilerin karaktere çarpmasını bilsin diye kutuyu tutar.
    const shape = new CANNON.Box(new CANNON.Vec3(HALF_W, BODY_H / 2, HALF_W));
    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      shape: shape,
      position: new CANNON.Vec3(0, 2, 28)
    });

    this.physicsWorld.addBody(this.body);
  }

  initVoxelMesh() {
    const faceTex = getCharacterFaceTexture();
    const shirtTex = getCharacterShirtTexture();
    const pantsTex = getCharacterPantsTexture();
    const stoneTex = getStoneTexture();
    const tntTex = getTNTSideTexture();

    // Normal mod malzemeleri
    this._skinMat  = new THREE.MeshLambertMaterial({ color: 0xb98561 });
    this._hairMat  = new THREE.MeshLambertMaterial({ color: 0x4a2f13 });
    this._shirtMat = new THREE.MeshLambertMaterial({ map: shirtTex });
    this._pantsMat = new THREE.MeshLambertMaterial({ map: pantsTex });
    this._faceMat  = new THREE.MeshLambertMaterial({ map: faceTex });

    // Cyborg mod malzemeleri
    this._cyMetalMat  = new THREE.MeshLambertMaterial({ color: 0x334155 }); // koyu metalik gövde
    this._cyArmorMat  = new THREE.MeshLambertMaterial({ color: 0x1e3a5f }); // zırh mavisi
    this._eyeMatLeft  = new THREE.MeshBasicMaterial({ color: 0xef4444 });   // kırmızı göz sol
    this._eyeMatRight = new THREE.MeshBasicMaterial({ color: 0xef4444 });   // kırmızı göz sağ

    // ── KAFA ──
    const headGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    this._headMats = [
      this._hairMat, this._hairMat, this._hairMat,
      this._skinMat, this._faceMat, this._hairMat
    ];
    this.head = new THREE.Mesh(headGeo, this._headMats.slice());
    this.head.position.y = 1.8;
    this.head.castShadow = true;
    this.mesh.add(this.head);

    // Cyborg Gözler (başlangıçta gizli)
    const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.05);
    this._leftEye  = new THREE.Mesh(eyeGeo, this._eyeMatLeft);
    this._rightEye = new THREE.Mesh(eyeGeo, this._eyeMatRight);
    this._leftEye.position.set(-0.18, 1.85, 0.41);
    this._rightEye.position.set(0.18, 1.85, 0.41);
    this._leftEye.visible = false;
    this._rightEye.visible = false;
    this.mesh.add(this._leftEye);
    this.mesh.add(this._rightEye);

    // ── GÖVDE ──
    this._bodyMat = new THREE.MeshLambertMaterial({ map: shirtTex });
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.4), this._bodyMat);
    this.torso.position.y = 0.9;
    this.torso.castShadow = true;
    this.mesh.add(this.torso);

    // ── SOL KOL + ÇEKİÇ ──
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.6, 1.3, 0);

    const armGeo = new THREE.BoxGeometry(0.38, 1.0, 0.38);
    this._leftArmMesh = new THREE.Mesh(armGeo, this._shirtMat);
    this._leftArmMesh.position.y = -0.45;
    this._leftArmMesh.castShadow = true;
    this.leftArm.add(this._leftArmMesh);

    // Çekiç
    this.hammer = new THREE.Group();
    this.hammer.position.set(0, -0.85, 0.2);
    const handleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.2, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x854d0e })
    );
    handleMesh.rotation.x = Math.PI / 4;
    handleMesh.castShadow = true;
    this.hammer.add(handleMesh);
    const hammerHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.65),
      new THREE.MeshLambertMaterial({ color: 0x334155 })
    );
    hammerHead.position.set(0, 0.42, 0.42);
    hammerHead.castShadow = true;
    this.hammer.add(hammerHead);
    this.leftArm.add(this.hammer);
    this.mesh.add(this.leftArm);

    // ── SAĞ KOL ──
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.6, 1.3, 0);
    this._rightArmMesh = new THREE.Mesh(armGeo, this._shirtMat);
    this._rightArmMesh.position.y = -0.45;
    this._rightArmMesh.castShadow = true;
    this.rightArm.add(this._rightArmMesh);

    // ─── TABANCA (Normal Mod - Tuş 1) ───
    this.pistolGroup = new THREE.Group();
    this.pistolGroup.position.set(0, -0.7, 0.35);

    const pistolBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.48),
      new THREE.MeshLambertMaterial({ color: 0x1e293b })
    );
    this.pistolGroup.add(pistolBody);

    const pistolBarrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x0f172a })
    );
    pistolBarrel.position.set(0, 0.1, 0.38);
    this.pistolGroup.add(pistolBarrel);

    // Namlu ucu referansı
    this.cannonMuzzle = new THREE.Group();
    this.cannonMuzzle.position.set(0, 0.1, 0.72);
    this.pistolGroup.add(this.cannonMuzzle);

    this.rightArm.add(this.pistolGroup);

    // ─── CYBORG LAZER EMİTER (Cyborg Mod - Tuş 2 + R) ───
    this.laserGroup = new THREE.Group();
    this.laserGroup.position.set(0, -0.7, 0.35);
    this.laserGroup.visible = false;

    // Mekanik el / lazer kolu
    const laserArmBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x475569 })
    );
    this.laserGroup.add(laserArmBase);

    // Lazer emiteri (parlak kırmızı küçük küp)
    this._laserEmitter = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    this._laserEmitter.position.set(0, 0, 0.38);
    this.laserGroup.add(this._laserEmitter);

    // Lazer namlu ucu
    this.laserMuzzle = new THREE.Group();
    this.laserMuzzle.position.set(0, 0, 0.5);
    this.laserGroup.add(this.laserMuzzle);

    this.rightArm.add(this.laserGroup);
    this.mesh.add(this.rightArm);

    // ── BACAKLAR ──
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.2, 0.45, 0);
    this._leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.95, 0.38), this._pantsMat);
    this._leftLegMesh.position.y = -0.45;
    this._leftLegMesh.castShadow = true;
    this.leftLeg.add(this._leftLegMesh);
    this.mesh.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.2, 0.45, 0);
    this._rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.95, 0.38), this._pantsMat);
    this._rightLegMesh.position.y = -0.45;
    this._rightLegMesh.castShadow = true;
    this.rightLeg.add(this._rightLegMesh);
    this.mesh.add(this.rightLeg);

    this.scene.add(this.mesh);
  }

  // MOD DEĞİŞTİRME — 'normal' veya 'cyborg'
  setMode(mode) {
    this.currentMode = mode;

    if (mode === 'cyborg') {
      // Görünüm: Metalik zırh
      this.head.material = [
        this._cyMetalMat, this._cyMetalMat, this._cyMetalMat,
        this._cyMetalMat, this._cyMetalMat, this._cyMetalMat
      ];
      this._bodyMat.color.setHex(0x1e3a5f);
      this._leftArmMesh.material  = this._cyArmorMat;
      this._rightArmMesh.material = this._cyArmorMat;
      this._leftLegMesh.material  = this._cyMetalMat;
      this._rightLegMesh.material = this._cyMetalMat;

      // Kırmızı gözler görünür
      this._leftEye.visible  = !this.firstPerson;
      this._rightEye.visible = !this.firstPerson;

      // Silah: lazer emiteri
      this.pistolGroup.visible = false;
      this.laserGroup.visible  = true;

    } else {
      // Normal mod görünümü geri yükle
      this.head.material = [
        this._hairMat, this._hairMat, this._hairMat,
        this._skinMat, this._faceMat, this._hairMat
      ];
      this._bodyMat.color.setHex(0xffffff); // shader dokuyu geri getirsin
      this._bodyMat.map = getCharacterShirtTexture();
      this._bodyMat.needsUpdate = true;
      this._leftArmMesh.material  = this._shirtMat;
      this._rightArmMesh.material = this._shirtMat;
      this._leftLegMesh.material  = this._pantsMat;
      this._rightLegMesh.material = this._pantsMat;

      // Gözler gizli
      this._leftEye.visible  = false;
      this._rightEye.visible = false;

      // Silah: tabanca
      this.pistolGroup.visible = true;
      this.laserGroup.visible  = false;
    }
  }

  // Merminin çıkacağı namlu ağzı dünya koordinatı
  getMuzzleWorldPosition() {
    const muzzle = this.currentMode === 'cyborg' ? this.laserMuzzle : this.cannonMuzzle;
    const pos = new THREE.Vector3();
    muzzle.getWorldPosition(pos);
    return pos;
  }

  // E tuşuyla çekici savur
  triggerHammerSwing() {
    if (this.isSwingingHammer) return false;
    this.isSwingingHammer = true;
    this.hammerSwingTimer = 0;
    sound.playHammerSwing();
    return true;
  }

  // W, A, S, D ve Zıplama Güncellemesi
  update(dt, inputState, cameraEulerY) {
    if (!this.body) return;

    let moveX = 0;
    let moveZ = 0;

    if (inputState.forward)  moveZ -= 1;
    if (inputState.backward) moveZ += 1;
    if (inputState.left)     moveX -= 1;
    if (inputState.right)    moveX += 1;

    const isMoving = moveX !== 0 || moveZ !== 0;

    if (isMoving) {
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;

      const cos = Math.cos(cameraEulerY);
      const sin = Math.sin(cameraEulerY);
      const worldX = moveX * cos + moveZ * sin;
      const worldZ = -moveX * sin + moveZ * cos;

      const speedMul = this.inWater ? WATER_SPEED_MUL : 1;
      this.vel.x = worldX * this.moveSpeed * speedMul;
      this.vel.z = worldZ * this.moveSpeed * speedMul;

      const targetAngle = Math.atan2(worldX, worldZ);
      this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, targetAngle, 14 * dt);

      this.walkCycle += dt * 14;
      const swing = Math.sin(this.walkCycle) * 0.75;

      this.leftLeg.rotation.x  = swing;
      this.rightLeg.rotation.x = -swing;

      if (!this.isSwingingHammer) {
        this.leftArm.rotation.x = -swing * 0.9;
      }
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.3 + swing * 0.3, 10 * dt);

      this.stepTimer += dt;
      if (this.stepTimer > 0.3 && !this.inWater && this.isGrounded) {
        this.stepTimer = 0;
        this.particleSystem.createDust(this._feetPosition());
      }
    } else {
      const damp = Math.pow(0.8, dt * 60);
      this.vel.x *= damp;
      this.vel.z *= damp;

      this.leftLeg.rotation.x  = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, 10 * dt);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, 10 * dt);
      if (!this.isSwingingHammer) {
        this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, 10 * dt);
      }
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.4, 10 * dt);
    }

    if (this.inWater) { this._animateSwim(dt, isMoving); sound.updateSwim(isMoving); }
    else sound.stopSwim();

    // Çekiç Savurma Animasyonu
    if (this.isSwingingHammer) {
      this.hammerSwingTimer += dt;
      const progress = Math.min(1.0, this.hammerSwingTimer / 0.22);
      this.leftArm.rotation.x = -Math.sin(progress * Math.PI) * 1.8;
      this.leftArm.rotation.z = Math.sin(progress * Math.PI) * 0.3;

      if (this.hammerSwingTimer >= 0.22) {
        this.isSwingingHammer = false;
        this.leftArm.rotation.z = 0;
      }
    }

    // Lazer ışını görseli zaman aşımı
    if (this.laserBeamMesh) {
      this.laserBeamTimer -= dt;
      if (this.laserBeamTimer <= 0) {
        this.scene.remove(this.laserBeamMesh);
        this.laserBeamMesh.geometry.dispose();
        this.laserBeamMesh.material.dispose();
        this.laserBeamMesh = null;
      }
    }

    this.knock.multiplyScalar(Math.exp(-4 * dt));

    // Jetpack: havadayken Space basılı tutulursa itki; yakıt bitince ya da bırakınca düşüş
    this.airTime = this.isGrounded ? 0 : this.airTime + dt;
    this.jetting = !!inputState.jump && !this.isGrounded && this.airTime > 0.18 &&
      this.fuel > 0 && !this.inWater;
    if (this.isGrounded || this.inWater) { this.usedJet = false; this.fuel = Math.min(1, this.fuel + dt * 0.5); }
    if (this.jetting) {
      this.jetTick -= dt;
      if (this.jetTick <= 0) {
        this.jetTick = 0.03;
        this.particleSystem.createThrusterTrail(this._feetPosition());
        if (Math.random() < 0.25) sound.playJet();
      }
    }

    // Voxel çarpışması, yerçekimi, zıplama ve su fiziği
    this._stepPhysics(dt, inputState);

    // Haritadan aşağı düşme
    if (this.body.position.y < -10) {
      this.resetPosition(this.spawn.x, this.spawn.y, this.spawn.z);
    }

    this.mesh.position.copy(this.body.position);
    this.mesh.position.y -= FOOT_OFFSET_Y;

    // Cyborg göz parlaması animasyonu
    if (this.currentMode === 'cyborg') {
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.006);
      this._eyeMatLeft.color.setRGB(pulse, 0, 0);
      this._eyeMatRight.color.setRGB(pulse, 0, 0);
      this._laserEmitter.material.color.setRGB(pulse, 0, 0);
    }
  }

  // Birinci kişi kamerada yüz ve beden gizlenir; yalnız kollar (ve elindeki silah/çekiç) kadraja girebilir
  setFirstPerson(on) {
    this.firstPerson = on;
    this.head.visible = !on;
    this.torso.visible = !on;
    this.leftLeg.visible = !on;
    this.rightLeg.visible = !on;
    this._leftEye.visible = !on && this.currentMode === 'cyborg';
    this._rightEye.visible = !on && this.currentMode === 'cyborg';
    // Kollar omuz hizasından biraz içeri ve öne alınır: aşağı bakınca ve çekiç savururken kadraja girer
    this.leftArm.position.set(on ? -0.45 : -0.6, 1.3, on ? 0.1 : 0);
    this.rightArm.position.set(on ? 0.45 : 0.6, 1.3, on ? 0.1 : 0);
  }

  // Lazer ışını görsel efekti (kırmızı çizgi)
  showLaserBeam(from, to) {
    if (this.laserBeamMesh) {
      this.scene.remove(this.laserBeamMesh);
      this.laserBeamMesh.geometry.dispose();
      this.laserBeamMesh.material.dispose();
    }

    const dir = to.clone().sub(from);
    const length = dir.length();
    const mid = from.clone().add(to).multiplyScalar(0.5);

    const geo = new THREE.BoxGeometry(0.06, 0.06, length);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(mid);
    beam.lookAt(to);

    this.scene.add(beam);
    this.laserBeamMesh = beam;
    this.laserBeamTimer = 0.12; // 0.12 saniye görünür kal
  }

  // ── VOXEL ÇARPIŞMA YARDIMCILARI ──
  // Voxel ızgarası: x/z'de voxel merkezi ix*S, y'de iy*S ile (iy+1)*S arasıdır.
  _isSolid(ix, iy, iz) {
    if (!this.voxelWorld) return false;
    const v = this.voxelWorld.voxels.get(`${ix},${iy},${iz}`);
    return !!v && v.active;
  }

  _overlaps(x, feetY, z) {
    const S = VOXEL_SIZE;
    // Zemin iki katmandır. Alt katman (taban kayası) her yerde katıdır ve kırılamaz;
    // üst katman yalnız sağlam olduğu hücrelerde katıdır (kırılan yerde çukurun tabanında yürünür).
    if (this.voxelWorld) {
      const t = this.voxelWorld.terrain;
      if (t.solidAt(x, feetY, z, HALF_W)) return true;
      if (this.voxelWorld.doors && this.voxelWorld.doors.blocks(x, feetY, z, HALF_W, BODY_H)) return true;   // kapalı/aralık kapı
    }
    const minIx = Math.floor((x - HALF_W + EPS) / S + 0.5);
    const maxIx = Math.floor((x + HALF_W - EPS) / S + 0.5);
    const minIz = Math.floor((z - HALF_W + EPS) / S + 0.5);
    const maxIz = Math.floor((z + HALF_W - EPS) / S + 0.5);
    const minIy = Math.floor((feetY + EPS) / S);
    const maxIy = Math.floor((feetY + BODY_H - EPS) / S);
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iy = minIy; iy <= maxIy; iy++) {
        for (let iz = minIz; iz <= maxIz; iz++) {
          if (this._isSolid(ix, iy, iz)) return true;
        }
      }
    }
    return false;
  }

  _feetPosition() {
    return new THREE.Vector3(this.body.position.x, this.body.position.y - BODY_H / 2, this.body.position.z);
  }

  // Tek eksende (x veya z) hareket: duvara çarparsa en fazla 0.5 m'lik basamağa çıkmayı dener, olmazsa durur.
  _moveAxis(axis, delta, pos, feet) {
    if (delta === 0) return feet;
    const nx = axis === 'x' ? pos.x + delta : pos.x;
    const nz = axis === 'z' ? pos.z + delta : pos.z;

    if (!this._overlaps(nx, feet, nz)) {
      pos.x = nx; pos.z = nz;
      return feet;
    }

    if (this.isGrounded && !this.inWater) {
      // En fazla 0.5 m'lik basamağa (küp adımlarıyla) otomatik çık
      for (let h = VOXEL_SIZE; h <= STEP_UP_MAX + EPS; h += VOXEL_SIZE) {
        const raised = feet + h;
        if (!this._overlaps(pos.x, raised, pos.z) && !this._overlaps(nx, raised, nz)) {
          pos.x = nx; pos.z = nz;
          return raised;
        }
      }
    }

    // Duvara çarptı: yarıya bölerek temas noktasına kadar yaklaş (yüzeyle arada boşluk kalmasın)
    let lo = 0;
    let hi = delta;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      const mx = axis === 'x' ? pos.x + mid : pos.x;
      const mz = axis === 'z' ? pos.z + mid : pos.z;
      if (this._overlaps(mx, feet, mz)) hi = mid; else lo = mid;
    }
    if (axis === 'x') pos.x += lo; else pos.z += lo;
    this.vel[axis] = 0;
    this.blockedHoriz = true;
    return feet;
  }

  _stepPhysics(dt, inputState) {
    const pos = this.body.position;
    let feet = pos.y - BODY_H / 2;
    const S = VOXEL_SIZE;

    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;

    for (let i = 0; i < n; i++) {
      this.blockedHoriz = false;

      // Su durumu: ayak tabanı yüzeyin yeterince altındaysa ve deniz sınırı içindeyse yüzülür
      const depth = WATER_LEVEL - feet;
      const wasInWater = this.inWater;
      this.inWater = depth > WATER_ENTER_DEPTH &&
        Math.abs(pos.x) < WATER_BOUND && Math.abs(pos.z) < WATER_BOUND;

      if (this.inWater && !wasInWater && this.vel.y < -3) {
        this._splash(1.0);
      }
      if (this.waterHopTimer > 0) this.waterHopTimer -= h;

      // Dikey hız
      if (this.inWater && this.waterHopTimer <= 0) {
        const target = inputState.jump ? FLOAT_DEPTH_UP : FLOAT_DEPTH;
        this.vel.y += ((depth - target) * 18 - this.vel.y * 4) * h;
      } else {
        this.vel.y = Math.max(-MAX_FALL, this.vel.y - GRAVITY * h);
      }

      // Jetpack itkisi ve bırakınca hava direnci
      if (this.jetting) {
        this.vel.y = Math.min(JET_MAX_UP, this.vel.y + JET_ACC * h);
        this.fuel = Math.max(0, this.fuel - h / JET_SECONDS);
        this.usedJet = true;
      } else if (this.usedJet && !this.isGrounded && !this.inWater) {
        const v = this.vel.y;
        this.vel.y -= Math.sign(v) * v * v * JET_DRAG * h;
      }

      // Zıplama (karada) / kıyıya tırmanma (suda duvara dayanıp Space)
      if (inputState.jump) {
        if (this.isGrounded && !this.inWater) {
          this.vel.y = this.jumpForce;
          this.isGrounded = false;
          sound.playJump();
        } else if (this.inWater && this.waterHopTimer <= 0 && this.lastBlocked) {
          this.vel.y = WATER_HOP_SPEED;
          this.waterHopTimer = 0.5;
        }
      }

      // Yatay hareket (eksen eksen) + basamak çıkma
      feet = this._moveAxis('x', (this.vel.x + this.knock.x) * h, pos, feet);
      feet = this._moveAxis('z', (this.vel.z + this.knock.z) * h, pos, feet);
      this.lastBlocked = this.blockedHoriz;

      // Dikey hareket
      this.isGrounded = false;
      const dy = this.vel.y * h;
      let newFeet = feet + dy;
      if (dy !== 0 && this._overlaps(pos.x, newFeet, pos.z)) {
        if (dy < 0) {
          const snapped = (Math.floor((newFeet + EPS) / S) + 1) * S;
          feet = this._overlaps(pos.x, snapped, pos.z) ? feet : snapped;
          this.isGrounded = true;
        } else {
          const snapped = Math.floor((newFeet + BODY_H - EPS) / S) * S - BODY_H;
          feet = this._overlaps(pos.x, snapped, pos.z) ? feet : snapped;
        }
        this.vel.y = 0;
      } else {
        feet = newFeet;
      }
    }

    // Deniz sınırından fazla açılmasın
    pos.x = THREE.MathUtils.clamp(pos.x, -WATER_BOUND, WATER_BOUND);
    pos.z = THREE.MathUtils.clamp(pos.z, -WATER_BOUND, WATER_BOUND);
    pos.y = feet + BODY_H / 2;

    // Kinematik gövdeyi Cannon'un kendi başına kaydırmasını engelle
    this.body.velocity.set(0, 0, 0);
  }

  // Patlama dalgası oyuncuyu iter
  applyKnock(vx, vy, vz) {
    this.knock.x += vx; this.knock.z += vz;
    this.vel.y += vy;
    this.isGrounded = false;
  }

  _splash(strength) {
    if (this.particleSystem.createSplash) {
      this.particleSystem.createSplash(new THREE.Vector3(this.body.position.x, WATER_LEVEL, this.body.position.z), strength);
    }
    if (strength >= 0.5 && sound.playSplash) sound.playSplash();   // kulaç sıçramaları sürekli su sesinin parçası
  }

  // Yüzme animasyonu: kollarla kulaç, bacaklarla çırpma; yerinde dururken hafif kürek
  _animateSwim(dt, isMoving) {
    this.swimCycle = (this.swimCycle || 0) + dt * (isMoving ? 9 : 3);
    const amp = isMoving ? 2.2 : 0.5;
    const c = Math.sin(this.swimCycle);
    if (!this.isSwingingHammer) this.leftArm.rotation.x = -1.0 + c * amp;
    this.rightArm.rotation.x = -1.0 - c * amp;
    const kick = Math.sin(this.swimCycle * 1.6) * (isMoving ? 0.5 : 0.2);
    this.leftLeg.rotation.x = kick;
    this.rightLeg.rotation.x = -kick;

    if (isMoving) {
      this.rippleTimer += dt;
      if (this.rippleTimer > 0.35) {
        this.rippleTimer = 0;
        this._splash(0.35);
      }
    }
  }

  resetPosition(x = 0, y = 3, z = 26) {
    this.spawn = { x, y, z };
    this.vel.set(0, 0, 0);
    this.inWater = false;
    this.waterHopTimer = 0;
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.mesh.position.copy(this.body.position);
    this.mesh.position.y -= FOOT_OFFSET_Y;
    this.mesh.rotation.y = Math.PI;
  }
}
