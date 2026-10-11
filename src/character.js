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

    // Uzuv Grupları (Minecraft Animasyonu İçin)
    this.head = null;
    this.torso = null;
    this.leftArm = null;
    this.rightArm = null;
    this.leftLeg = null;
    this.rightLeg = null;
    this.cannonMuzzle = null;

    this.initPhysics();
    this.initVoxelMesh();
  }

  initPhysics() {
    // Kübik karakter fizik gövdesi (0.8 genişlik, 2.0 yükseklik)
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
    // Minecraft Dokuları
    const faceTex = getCharacterFaceTexture();
    const shirtTex = getCharacterShirtTexture();
    const pantsTex = getCharacterPantsTexture();
    const stoneTex = getStoneTexture();
    const tntTex = getTNTSideTexture();

    // Malzemeler
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xb98561 });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x4a2f13 });
    const shirtMat = new THREE.MeshLambertMaterial({ map: shirtTex });
    const pantsMat = new THREE.MeshLambertMaterial({ map: pantsTex });
    const faceMat = new THREE.MeshLambertMaterial({ map: faceTex });

    // 1. Kafa (0.8 x 0.8 x 0.8 Tam Bir Minecraft Küpü)
    const headGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    // Yüz öne gelsin (BoxGeometry yüz indeksleri: sağ, sol, üst, alt, ön, arka)
    const headMats = [
      hairMat, // Sağ
      hairMat, // Sol
      hairMat, // Üst
      skinMat, // Alt
      faceMat, // Ön (Yüz)
      hairMat  // Arka
    ];
    this.head = new THREE.Mesh(headGeo, headMats);
    this.head.position.y = 1.8;
    this.head.castShadow = true;
    this.mesh.add(this.head);

    // 2. Gövde (0.8 x 1.0 x 0.4 Dikdörtgen Prizma)
    const torsoGeo = new THREE.BoxGeometry(0.8, 1.0, 0.4);
    this.torso = new THREE.Mesh(torsoGeo, shirtMat);
    this.torso.position.y = 0.9;
    this.torso.castShadow = true;
    this.mesh.add(this.torso);

    // 3. Sol Kol (0.4 x 1.0 x 0.4)
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.6, 1.3, 0); // Omuz eklemi

    const armGeo = new THREE.BoxGeometry(0.38, 1.0, 0.38);
    const leftArmMesh = new THREE.Mesh(armGeo, shirtMat);
    leftArmMesh.position.y = -0.45;
    leftArmMesh.castShadow = true;
    this.leftArm.add(leftArmMesh);
    this.mesh.add(this.leftArm);

    // 4. Sağ Kol & Voxel Roketatar (Elinde Kübik Roketatar Taşır)
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.6, 1.3, 0); // Omuz eklemi

    const rightArmMesh = new THREE.Mesh(armGeo, shirtMat);
    rightArmMesh.position.y = -0.45;
    rightArmMesh.castShadow = true;
    this.rightArm.add(rightArmMesh);

    // Elindeki Kübik TNT / Roket Fırlatıcı (Minecraft tarzı bloklu silah)
    const bazookaGroup = new THREE.Group();
    bazookaGroup.position.set(0, -0.65, 0.35);

    // Silahın namlusu (Uzun prizma)
    const barrelGeo = new THREE.BoxGeometry(0.3, 0.3, 1.2);
    const barrelMat = new THREE.MeshLambertMaterial({ map: stoneTex });
    const barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
    barrelMesh.castShadow = true;
    bazookaGroup.add(barrelMesh);

    // Silahın arkasındaki mini TNT bloğu
    const miniTntGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    const miniTntMat = new THREE.MeshLambertMaterial({ map: tntTex });
    const miniTnt = new THREE.Mesh(miniTntGeo, miniTntMat);
    miniTnt.position.z = -0.4;
    bazookaGroup.add(miniTnt);

    // Namlu ucu referansı (Merminin çıkış noktası)
    this.cannonMuzzle = new THREE.Group();
    this.cannonMuzzle.position.set(0, 0, 0.7);
    bazookaGroup.add(this.cannonMuzzle);

    this.rightArm.add(bazookaGroup);
    this.mesh.add(this.rightArm);

    // 5. Sol Bacak (0.4 x 1.0 x 0.4)
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.2, 0.45, 0); // Kalça eklemi

    const legGeo = new THREE.BoxGeometry(0.38, 0.95, 0.38);
    const leftLegMesh = new THREE.Mesh(legGeo, pantsMat);
    leftLegMesh.position.y = -0.45;
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);
    this.mesh.add(this.leftLeg);

    // 6. Sağ Bacak (0.4 x 1.0 x 0.4)
    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.2, 0.45, 0); // Kalça eklemi

    const rightLegMesh = new THREE.Mesh(legGeo, pantsMat);
    rightLegMesh.position.y = -0.45;
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);
    this.mesh.add(this.rightLeg);

    this.scene.add(this.mesh);
  }

  // W, A, S, D ve Zıplama Güncellemesi
  update(dt, inputState, cameraEulerY) {
    if (!this.body) return;

    let moveX = 0;
    let moveZ = 0;

    // W tuşu: Tam İleri Yürü
    if (inputState.forward) moveZ -= 1;
    // S tuşu: Geri Yürü
    if (inputState.backward) moveZ += 1;
    // A tuşu: Sola Yürü
    if (inputState.left) moveX -= 1;
    // D tuşu: Sağa Yürü
    if (inputState.right) moveX += 1;

    const isMoving = moveX !== 0 || moveZ !== 0;

    if (isMoving) {
      // Vektör Normalizasyonu
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;

      // Kameranın Y açısına göre yönlendirme
      const cos = Math.cos(cameraEulerY);
      const sin = Math.sin(cameraEulerY);

      const worldX = moveX * cos + moveZ * sin;
      const worldZ = -moveX * sin + moveZ * cos;

      // Hız ataması
      this.body.velocity.x = worldX * this.moveSpeed;
      this.body.velocity.z = worldZ * this.moveSpeed;

      // Karakter baktığı yöne yumuşakça dönsün
      const targetAngle = Math.atan2(worldX, worldZ);
      this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, targetAngle, 14 * dt);

      // Klasik Minecraft Yürüyüş Animasyonu:
      // Sol bacak öne giderken sağ kol öne, sağ bacak arkaya giderken sol kol arkaya sallanır!
      this.walkCycle += dt * 14;
      const swing = Math.sin(this.walkCycle) * 0.75;

      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.9;
      // Sağ kol silah tuttuğu için hafif öne dönük sallanır
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.3 + swing * 0.3, 10 * dt);

      // Adım Sesi ve Kübik Toz
      this.stepTimer += dt;
      if (this.stepTimer > 0.3) {
        this.stepTimer = 0;
        sound.playStep();
        this.particleSystem.createDust(this.mesh.position);
      }
    } else {
      // Dururken hız azaltma
      this.body.velocity.x *= 0.8;
      this.body.velocity.z *= 0.8;

      // Minecraft dinlenme duruşuna dön
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, 10 * dt);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, 10 * dt);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, 10 * dt);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.4, 10 * dt); // Silahı hazır tutsun
    }

    // Zıplama (Boşluk / Space tuşu)
    if (inputState.jump && this.isGrounded) {
      this.body.velocity.y = this.jumpForce;
      this.isGrounded = false;
      sound.playJump();
    }

    // Haritadan aşağı düşme kontrolü
    if (this.body.position.y < -10) {
      this.resetPosition(0, 3, 26);
    }

    // Görseli fizik koordinatlarına eşitle
    this.mesh.position.copy(this.body.position);
    this.mesh.position.y -= 1.0;
  }

  // Merminin çıkacağı namlu ağzı dünya koordinatı
  getMuzzleWorldPosition() {
    const pos = new THREE.Vector3();
    this.cannonMuzzle.getWorldPosition(pos);
    return pos;
  }

  resetPosition(x = 0, y = 3, z = 26) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.mesh.position.copy(this.body.position);
    this.mesh.rotation.y = Math.PI; // Karşıya (yapıya) baksın
  }
}
