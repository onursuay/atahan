import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';
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

export class Character {
  constructor(scene, physicsWorld, particleSystem) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;

    this.mesh = new THREE.Group();
    this.body = null;

    // Hareket Parametreleri
    this.moveSpeed = 15;
    this.jumpForce = 12;
    this.isGrounded = false;
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
    const shape = new CANNON.Box(new CANNON.Vec3(0.4, 1.0, 0.4));
    this.body = new CANNON.Body({
      mass: 75,
      shape: shape,
      position: new CANNON.Vec3(0, 2, 28),
      fixedRotation: true,
      linearDamping: 0.85
    });

    this.physicsWorld.addBody(this.body);

    this.body.addEventListener('collide', (e) => {
      if (e.contact.bi.position.y < this.body.position.y || e.contact.bj.position.y < this.body.position.y) {
        this.isGrounded = true;
      }
    });
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
      this._leftEye.visible  = true;
      this._rightEye.visible = true;

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

      this.body.velocity.x = worldX * this.moveSpeed;
      this.body.velocity.z = worldZ * this.moveSpeed;

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
      if (this.stepTimer > 0.3) {
        this.stepTimer = 0;
        sound.playStep();
        this.particleSystem.createDust(this.mesh.position);
      }
    } else {
      this.body.velocity.x *= 0.8;
      this.body.velocity.z *= 0.8;

      this.leftLeg.rotation.x  = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, 10 * dt);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, 10 * dt);
      if (!this.isSwingingHammer) {
        this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, 10 * dt);
      }
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.4, 10 * dt);
    }

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

    // Zıplama
    if (inputState.jump && this.isGrounded) {
      this.body.velocity.y = this.jumpForce;
      this.isGrounded = false;
      sound.playJump();
    }

    // Haritadan aşağı düşme
    if (this.body.position.y < -10) {
      this.resetPosition(0, 3, 26);
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

  resetPosition(x = 0, y = 3, z = 26) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.mesh.position.copy(this.body.position);
    this.mesh.position.y -= FOOT_OFFSET_Y;
    this.mesh.rotation.y = Math.PI;
  }
}
