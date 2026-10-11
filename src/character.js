import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { sound } from './audio.js';

// 3D Yıkım Robotu (Demolition Mech) Karakter Sınıfı
export class Character {
  constructor(scene, physicsWorld, particleSystem) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.particleSystem = particleSystem;

    this.mesh = new THREE.Group();
    this.body = null;

    // Hareket Durumu
    this.moveSpeed = 16;
    this.jumpForce = 12;
    this.isGrounded = false;
    this.walkCycle = 0;
    this.stepTimer = 0;

    // Parça Referansları (Animasyon için)
    this.leftLeg = null;
    this.rightLeg = null;
    this.leftArm = null;
    this.rightArm = null;
    this.torso = null;
    this.cannonMuzzle = null;

    this.initPhysics();
    this.initMesh();
  }

  // Cannon-es Fizik Gövdesi
  initPhysics() {
    const radius = 1.0;
    const height = 1.2;
    
    // Silindir / Küre bileşimi karakter gövdesi
    const shape = new CANNON.Sphere(radius);
    this.body = new CANNON.Body({
      mass: 75,
      shape: shape,
      position: new CANNON.Vec3(0, 3, 28),
      fixedRotation: true, // Karakter devrilmesin, dik dursun
      linearDamping: 0.85
    });

    this.physicsWorld.addBody(this.body);

    // Zemin teması kontrolü
    this.body.addEventListener('collide', (e) => {
      // Aşağı yönlü normal kontrolü
      if (e.contact.bi.position.y < this.body.position.y || e.contact.bj.position.y < this.body.position.y) {
        this.isGrounded = true;
      }
    });
  }

  // 3D Robot Görsel Modeli
  initMesh() {
    // Malzemeler (Şık Turuncu-Gri Endüstriyel Yıkım Teması)
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      metalness: 0.7,
      roughness: 0.3
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.2
    });
    const visorMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      roughness: 0.4
    });

    // Ana Gövde (Torso)
    this.torso = new THREE.Group();

    // Gövde Zırhı
    const bodyGeo = new THREE.BoxGeometry(1.6, 1.4, 1.4);
    const bodyMesh = new THREE.Mesh(bodyGeo, armorMat);
    bodyMesh.castShadow = true;
    bodyMesh.position.y = 1.4;
    this.torso.add(bodyMesh);

    // Ön Koruma Plakası
    const plateGeo = new THREE.BoxGeometry(1.2, 0.8, 0.2);
    const plateMesh = new THREE.Mesh(plateGeo, darkMetalMat);
    plateMesh.position.set(0, 1.4, 0.75);
    this.torso.add(plateMesh);

    // Robot Kafası / Vizör Kubbesi
    const headGeo = new THREE.SphereGeometry(0.55, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, darkMetalMat);
    headMesh.position.set(0, 2.3, 0.1);
    headMesh.castShadow = true;
    this.torso.add(headMesh);

    // Parlayan Neon Vizör (Göz)
    const visorGeo = new THREE.BoxGeometry(0.7, 0.18, 0.2);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 2.35, 0.55);
    this.torso.add(visorMesh);

    // Sırt Roket / İtici Motorları
    const thrusterGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 12);
    const leftThruster = new THREE.Mesh(thrusterGeo, darkMetalMat);
    leftThruster.position.set(-0.5, 1.6, -0.8);
    leftThruster.rotation.x = Math.PI / 8;
    this.torso.add(leftThruster);

    const rightThruster = new THREE.Mesh(thrusterGeo, darkMetalMat);
    rightThruster.position.set(0.5, 1.6, -0.8);
    rightThruster.rotation.x = Math.PI / 8;
    this.torso.add(rightThruster);

    // SAĞ KOL: Omuz Monte Roketatar (Silah)
    this.rightArm = new THREE.Group();
    this.rightArm.position.set(1.1, 1.6, 0);

    const cannonBaseGeo = new THREE.CylinderGeometry(0.35, 0.4, 1.6, 16);
    const cannonBase = new THREE.Mesh(cannonBaseGeo, darkMetalMat);
    cannonBase.rotation.x = Math.PI / 2;
    this.rightArm.add(cannonBase);

    // Roketatar Namlu Ağzı (Ateşin çıkacağı nokta)
    this.cannonMuzzle = new THREE.Group();
    this.cannonMuzzle.position.set(0, 0, 1.0);
    this.rightArm.add(this.cannonMuzzle);

    const barrelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12);
    const barrel = new THREE.Mesh(barrelGeo, armorMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 0.8);
    this.rightArm.add(barrel);

    this.torso.add(this.rightArm);

    // SOL KOL: Hidrolik Yıkım Kıskacı
    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-1.1, 1.6, 0);

    const armUpperGeo = new THREE.BoxGeometry(0.35, 0.9, 0.4);
    const armUpper = new THREE.Mesh(armUpperGeo, darkMetalMat);
    armUpper.position.y = -0.4;
    this.leftArm.add(armUpper);

    const clawGeo = new THREE.ConeGeometry(0.25, 0.6, 4);
    const claw = new THREE.Mesh(clawGeo, hazardMat);
    claw.rotation.x = -Math.PI / 2;
    claw.position.set(0, -0.9, 0.2);
    this.leftArm.add(claw);

    this.torso.add(this.leftArm);

    this.mesh.add(this.torso);

    // BACAKLAR (Sol ve Sağ)
    // Sol Bacak Grubu
    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.55, 0.8, 0);

    const legGeo = new THREE.BoxGeometry(0.35, 1.0, 0.45);
    const leftLegMesh = new THREE.Mesh(legGeo, darkMetalMat);
    leftLegMesh.position.y = -0.5;
    leftLegMesh.castShadow = true;
    this.leftLeg.add(leftLegMesh);

    const footGeo = new THREE.BoxGeometry(0.5, 0.25, 0.8);
    const leftFoot = new THREE.Mesh(footGeo, armorMat);
    leftFoot.position.set(0, -1.0, 0.15);
    this.leftLeg.add(leftFoot);
    this.mesh.add(this.leftLeg);

    // Sağ Bacak Grubu
    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.55, 0.8, 0);

    const rightLegMesh = new THREE.Mesh(legGeo, darkMetalMat);
    rightLegMesh.position.y = -0.5;
    rightLegMesh.castShadow = true;
    this.rightLeg.add(rightLegMesh);

    const rightFoot = new THREE.Mesh(footGeo, armorMat);
    rightFoot.position.set(0, -1.0, 0.15);
    this.rightLeg.add(rightFoot);
    this.mesh.add(this.rightLeg);

    this.scene.add(this.mesh);
  }

  // Hareket Güncelleme (W, A, S, D, Space kontrolleri)
  update(dt, inputState, cameraEulerY) {
    if (!this.body) return;

    // Hareket Yönü Vektörü Hesabı (Kamera Açısına Göre)
    let moveX = 0;
    let moveZ = 0;

    // W tuşu: Tam İleri
    if (inputState.forward) moveZ -= 1;
    // S tuşu: Geri
    if (inputState.backward) moveZ += 1;
    // A tuşu: Sola
    if (inputState.left) moveX -= 1;
    // D tuşu: Sağa
    if (inputState.right) moveX += 1;

    const isMoving = moveX !== 0 || moveZ !== 0;

    if (isMoving) {
      // Vektörü normalize et
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;

      // Kameranın Y rotasyonuna göre dünya koordinatlarına çevir
      const cos = Math.cos(cameraEulerY);
      const sin = Math.sin(cameraEulerY);

      const worldX = moveX * cos + moveZ * sin;
      const worldZ = -moveX * sin + moveZ * cos;

      // Fizik gövdesine hız ata
      this.body.velocity.x = worldX * this.moveSpeed;
      this.body.velocity.z = worldZ * this.moveSpeed;

      // Robotun hareket yönüne doğru yumuşak dönmesi
      const targetAngle = Math.atan2(worldX, worldZ);
      this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, targetAngle, 12 * dt);

      // Yürüme Animasyonu (Bacakların sallanması ve gövdenin yaylanması)
      this.walkCycle += dt * 14;
      this.leftLeg.rotation.x = Math.sin(this.walkCycle) * 0.7;
      this.rightLeg.rotation.x = -Math.sin(this.walkCycle) * 0.7;
      this.leftArm.rotation.x = -Math.sin(this.walkCycle) * 0.4;
      this.torso.position.y = Math.abs(Math.sin(this.walkCycle * 2)) * 0.1;

      // Adım Sesi ve Toz Parçacığı
      this.stepTimer += dt;
      if (this.stepTimer > 0.3) {
        this.stepTimer = 0;
        sound.playStep();
        this.particleSystem.createDust(this.mesh.position);
      }
    } else {
      // Dururken hızı kes
      this.body.velocity.x *= 0.8;
      this.body.velocity.z *= 0.8;

      // Bacakları dinlenme pozisyonuna getir
      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, 10 * dt);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, 10 * dt);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, 10 * dt);
      this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, 0, 10 * dt);
    }

    // Zıplama (Boşluk / Space tuşu)
    if (inputState.jump && this.isGrounded) {
      this.body.velocity.y = this.jumpForce;
      this.isGrounded = false;
      sound.playJump();
      
      // Zıplama esnasında itici motor dumanı
      this.particleSystem.createExplosion(
        new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + 0.5, this.mesh.position.z),
        1.5,
        0xff9900
      );
    }

    // Zemin düşüş sınırı (Haritadan aşağı düşerse tekrar başlat)
    if (this.body.position.y < -10) {
      this.resetPosition(0, 3, 28);
    }

    // Three.js görselini Cannon.js fiziği ile eşitle
    this.mesh.position.copy(this.body.position);
    this.mesh.position.y -= 0.8; // Görsel dengeleme
  }

  // Merminin çıkacağı namlu pozisyonunu dünya koordinatlarında verir
  getMuzzleWorldPosition() {
    const pos = new THREE.Vector3();
    this.cannonMuzzle.getWorldPosition(pos);
    return pos;
  }

  // Karakteri belirli bir koordinata sıfırla
  resetPosition(x = 0, y = 3, z = 28) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.mesh.position.copy(this.body.position);
    this.mesh.rotation.y = Math.PI; // Karşıya (yapıya doğru) baksın
  }
}
