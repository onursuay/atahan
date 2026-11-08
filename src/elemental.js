import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENTAL SİLAH VE ROBOT SİSTEMİ (Silah Kimliği: 20 — Y Tuşu / Normal Silah)
//  - Elementler: Ateş (Fire), Elektrik (Electric), Hava (Air).
//  - Fare tekerleği kaydırıldığında elementler anında değişir.
//  - ATEŞ ELEMENTİ:
//      • Sol Tık (Normal): Ateş topu fırlatır; çarptığı yeri patlatır, blokları yakar.
//        O ateş blokların üstünde alevler halinde yanar ve zamanla yavaşça sönüp kaybolur.
//      • Sağ Tık (Basılı Tutunca): Elinden ejderha nefesi gibi devasa konik alev püskürtür.
//      • Space Tıklama (Bas-Çek): Süpersonik Uçuş Modu açılır/kapanır!
//        W, A, S, D ile 135 m/s süpersonik hızla şehri 5 saniyede turlar!
//      • Y Tuşu (Ateş Elementindeyken): Ateşten bir kılıç (Alev Kılıcı) çıkarır.
//        Sol tıkla savurarak hem yakarak hem de parçalayarak binaları ve nesneleri yıkar.
// ─────────────────────────────────────────────────────────────────────────────

const FLIGHT_SPEED = 185; // m/s — 600m metropol haritasını ~3.5 saniyede baştan başa geçer!

// Performans optimizasyonu: Her karede BoxGeometry ve Material üretilmesini engelleyen paylaşımlı havuz
const SHARED_GEO_020 = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const SHARED_GEO_018 = new THREE.BoxGeometry(0.18, 0.18, 0.18);
const SHARED_GEO_024 = new THREE.BoxGeometry(0.24, 0.24, 0.24);

const SHARED_FIRE_MATS = [
  new THREE.MeshBasicMaterial({ color: 0xffea00 }),
  new THREE.MeshBasicMaterial({ color: 0xff7700 }),
  new THREE.MeshBasicMaterial({ color: 0xef4444 }),
  new THREE.MeshBasicMaterial({ color: 0xff1100 }),
  new THREE.MeshBasicMaterial({ color: 0xff3b00 })
];

export class ElementalSystem {
  constructor(handWeapons) {
    this.hw = handWeapons;
    this.mainScene = handWeapons.mainScene;
    this.camera = handWeapons.camera;
    this.vw = handWeapons.voxelWorld;
    this.ps = handWeapons.particleSystem;

    this.active = false;
    this.animTime = 0;
    this.thrusterTick = 0;

    // Element Yönetimi
    this.elements = ['fire', 'electric', 'air'];
    this.currentElementIndex = 0; // 0: fire (ateş)

    // Uçuş ve Kılıç Durumları
    this.flightActive = false;
    this.fireSwordActive = false;
    this.isSwingingSword = false;
    this.swordSwingProgress = 0;

    // Ateş Topu ve Mermiler
    this.fireballs = [];
    this.fireballCooldown = 0;

    // Aktif Yanan Alevler (Burning Clusters - zamanla sönmeye başlar)
    this.burningClusters = [];
    this.seismicShockwaves = [];

    // Ejderha Nefesi (Flamethrower) Durumu
    this.dragonBreathActive = false;
    this.breathTick = 0;

    // Görsel Efektler ve Işıklar
    this.group = new THREE.Group();
    this.mainScene.add(this.group);

    this.fireLight = new THREE.PointLight(0xff6600, 0, 18);
    this.mainScene.add(this.fireLight);

    // Kılıç savurma hilal görseli
    const slashGeo = new THREE.RingGeometry(1.6, 2.3, 16, 1, 0, Math.PI * 0.9);
    const slashMat = new THREE.MeshBasicMaterial({
      color: 0xff7700,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    this.slashMesh = new THREE.Mesh(slashGeo, slashMat);
    this.slashMesh.visible = false;
    this.group.add(this.slashMesh);

    // Birinci şahıs Cyber-Elemental Gauntlet (Eldiven Robotu)
    this._buildGauntletModel();
  }

  get currentElement() {
    return this.elements[this.currentElementIndex];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BİRİNCİ ŞAHIS ELEMAN GAUNTLET & ALEV KILICI MODELİ
  // ─────────────────────────────────────────────────────────────────────────
  _buildGauntletModel() {
    const hw = this.hw;
    this.gauntletRoot = new THREE.Group();
    this.gauntletRoot.position.set(0.32, -0.26, -0.65);
    this.gauntletRoot.visible = false;
    hw.root.add(this.gauntletRoot);

    const lam = (c, r = 0.5) => new THREE.MeshLambertMaterial({ color: c, roughness: r });
    const glow = (c, op = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: op < 1, opacity: op });

    // 1. Zırhlı Kol Gövdesi (Titanium & Altın Isı Blokları)
    const armGeo = new THREE.BoxGeometry(0.24, 0.22, 0.48);
    const armMesh = new THREE.Mesh(armGeo, lam(0x1e293b, 0.4));
    armMesh.position.set(0, 0, 0);
    this.gauntletRoot.add(armMesh);

    const plateGeo = new THREE.BoxGeometry(0.26, 0.08, 0.44);
    const plateMesh = new THREE.Mesh(plateGeo, lam(0x0f172a, 0.3));
    plateMesh.position.set(0, 0.08, 0);
    this.gauntletRoot.add(plateMesh);

    // Isı Tahliye Izgaraları (Gold/Brass)
    const ventGeo = new THREE.BoxGeometry(0.28, 0.03, 0.12);
    const vent1 = new THREE.Mesh(ventGeo, lam(0xd97706, 0.2));
    vent1.position.set(0, 0.06, -0.1);
    const vent2 = new THREE.Mesh(ventGeo, lam(0xd97706, 0.2));
    vent2.position.set(0, 0.06, 0.1);
    this.gauntletRoot.add(vent1, vent2);

    // 2. Elementel Reaktör Çekirdeği (Merkezde parlayan magma küresi)
    const coreGeo = new THREE.IcosahedronGeometry(0.07, 2);
    this.coreMat = glow(0xff4400, 1.0);
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.coreMesh.position.set(0, 0.12, -0.02);
    this.gauntletRoot.add(this.coreMesh);

    const haloGeo = new THREE.IcosahedronGeometry(0.095, 2);
    this.haloMat = glow(0xffaa00, 0.4);
    this.haloMesh = new THREE.Mesh(haloGeo, this.haloMat);
    this.haloMesh.position.copy(this.coreMesh.position);
    this.gauntletRoot.add(this.haloMesh);

    // 3. Parmaklar & Avuç İçi Ejderha Nefesi / Ateş Topu Memesi (Nozzle)
    const palmNozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 8), lam(0x334155));
    palmNozzle.rotation.x = Math.PI / 2;
    palmNozzle.position.set(0, -0.02, -0.27);
    this.gauntletRoot.add(palmNozzle);

    this.nozzleGlow = new THREE.Mesh(new THREE.CircleGeometry(0.04, 8), glow(0xff3300));
    this.nozzleGlow.position.set(0, -0.02, -0.315);
    this.gauntletRoot.add(this.nozzleGlow);

    // 4. ALEV KILICI (Fire Sword / Alev Bıçağı)
    this.swordGroup = new THREE.Group();
    this.swordGroup.position.set(0.02, 0.14, -0.15);
    this.swordGroup.visible = false;
    this.gauntletRoot.add(this.swordGroup);

    // Kılıç Kabzası ve Koruma Halkası
    const hiltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.22, 8), lam(0x0f172a));
    hiltMesh.rotation.x = Math.PI / 2;
    this.swordGroup.add(hiltMesh);

    const guardMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.05), lam(0xd97706));
    guardMesh.position.set(0, 0, -0.12);
    this.swordGroup.add(guardMesh);

    // Parlayan Magma Alev Bıçağı Çekirdeği
    const bladeCoreGeo = new THREE.BoxGeometry(0.035, 0.07, 1.25);
    this.bladeCoreMat = glow(0xfff5cc, 1.0);
    this.bladeCore = new THREE.Mesh(bladeCoreGeo, this.bladeCoreMat);
    this.bladeCore.position.set(0, 0, -0.76);
    this.swordGroup.add(this.bladeCore);

    // Dış Yanan Ateş Zarfı (Halo / Licking Flames)
    const bladeHaloGeo = new THREE.BoxGeometry(0.075, 0.14, 1.35);
    this.bladeHaloMat = glow(0xff4400, 0.65);
    this.bladeHalo = new THREE.Mesh(bladeHaloGeo, this.bladeHaloMat);
    this.bladeHalo.position.set(0, 0, -0.76);
    this.swordGroup.add(this.bladeHalo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SİLAH SEÇİMİ & ELEMENT DEĞİŞTİRME
  // ─────────────────────────────────────────────────────────────────────────
  onSwitch(weaponId, character) {
    const isThis = weaponId === 20;
    this.active = isThis;
    if (this.gauntletRoot) this.gauntletRoot.visible = isThis;

    if (!isThis) {
      // Başka silaha geçildiğinde uçuşu ve ejderha nefesini kapat
      if (this.flightActive && character) {
        this.toggleFlight(character);
      }
      this.dragonBreathActive = false;
      this.fireLight.intensity = 0;
      return;
    }

    sound.playUiBeep && sound.playUiBeep();
    this._updateElementVisuals();
    this._showHUDElementNotification();
  }

  // Fare Tekerleğiyle Element Değiştirme
  cycleElement(direction) {
    if (!this.active) return;
    this.currentElementIndex = (this.currentElementIndex + direction + this.elements.length) % this.elements.length;
    sound.playBeep && sound.playBeep(1.2 + this.currentElementIndex * 0.2);

    // Kılıç sadece ateşte aktiftir; başka elemente geçilirse kapatılır
    if (this.currentElement !== 'fire' && this.fireSwordActive) {
      this.fireSwordActive = false;
      if (this.swordGroup) this.swordGroup.visible = false;
    }

    this._updateElementVisuals();
    this._showHUDElementNotification();
  }

  _updateElementVisuals() {
    const el = this.currentElement;
    if (el === 'fire') {
      this.coreMat.color.setHex(0xff3300);
      this.haloMat.color.setHex(0xffaa00);
      this.nozzleGlow.material.color.setHex(0xff3300);
      this.fireLight.color.setHex(0xff6600);
    } else if (el === 'electric') {
      this.coreMat.color.setHex(0x00f0ff);
      this.haloMat.color.setHex(0x60a5fa);
      this.nozzleGlow.material.color.setHex(0x00f0ff);
      this.fireLight.color.setHex(0x00f0ff);
    } else if (el === 'air') {
      this.coreMat.color.setHex(0xa7f3d0);
      this.haloMat.color.setHex(0xffffff);
      this.nozzleGlow.material.color.setHex(0xa7f3d0);
      this.fireLight.color.setHex(0xa7f3d0);
    }
  }

  _showHUDElementNotification() {
    const el = this.currentElement;
    let title = '';
    let sub = '';
    if (el === 'fire') {
      title = '🔥 ATEŞ ELEMENTİ AKTİF';
      sub = 'Sol Tık: Ateş Topu | Sağ Tık: Ejderha Nefesi | Space: Uçuş | Y: Alev Kılıcı';
    } else if (el === 'electric') {
      title = '⚡ ELEKTRİK ELEMENTİ (ÇOK YAKINDA)';
      sub = 'Tekerlekle Ateş elementine dönebilirsiniz.';
    } else if (el === 'air') {
      title = '💨 HAVA ELEMENTİ (ÇOK YAKINDA)';
      sub = 'Tekerlekle Ateş elementine dönebilirsiniz.';
    }

    const hintEl = document.getElementById('weapon-hint');
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#f97316;font-weight:900;">${title}</span> &nbsp;|&nbsp; <span style="color:#e2e8f0;font-size:12px;">${sub}</span>`;
      hintEl.classList.add('show');
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => { hintEl.classList.remove('show'); }, 4200);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ALEV KILICI (Fire Sword Mode - Y Tuşu)
  // ─────────────────────────────────────────────────────────────────────────
  toggleFireSword() {
    if (!this.active) return;
    if (this.currentElement !== 'fire') {
      this.currentElementIndex = 0;
      this._updateElementVisuals();
    }

    this.fireSwordActive = !this.fireSwordActive;
    if (this.swordGroup) this.swordGroup.visible = this.fireSwordActive;

    if (this.fireSwordActive) {
      sound.playFireSwordIgnite();
      this._showBanner('⚔️ ALEV KILICI AÇILDI', 'Sol tıkla savur: Binaları, arabaları ve nesneleri hem yakarak hem parçalayarak yık!');
    } else {
      sound.playSaberOn && sound.playSaberOn();
      this._showBanner('🔥 ALEV KILICI KAPATILDI', 'Ateş Topu ve Ejderha Nefesi moduna dönüldü.');
    }
  }

  // Kılıç Savurma (Sol Tık)
  slashFireSword(onShake) {
    if (this.isSwingingSword) return;
    this.isSwingingSword = true;
    this.swordSwingProgress = 0;
    sound.playFireSwordSlash();
    if (onShake) onShake(0.35);

    // Oyuncunun önündeki nesneleri hem yakarak hem parçalayarak yıkar
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const origin = cam.position.clone().addScaledVector(fwd, 1.2);

    // Kılıç etki alanı: 4.5m menzildeki hedefler
    const reach = 4.5;
    const hitPt = origin.clone().addScaledVector(fwd, reach * 0.7);

    // 1. Voxel yıkımı ve patlaması
    const vw = this.vw;
    if (vw) {
      vw.explode(hitPt, 2.8, 140);
      vw.sweepCut(hitPt, 3.4, null);
      if (vw.doors) vw.doors.hitSphere(hitPt, 3.4, 4);
      if (vw.bridge) vw.bridge.hitSphere(hitPt, 3.4);
    }

    // 2. Arabalar ve NPC'ler
    const hw = this.hw;
    if (hw) {
      if (hw.cars) hw.cars.bladeHit(hitPt, 3.8);
      if (hw.npcs) hw.npcs.hitSphere(hitPt, 4.0);
    }

    // 3. Çarpan yerde yangın başlat
    this._igniteArea(hitPt, 3);

    // 4. Savurma hilali (Ateş yayı)
    if (this.slashMesh) {
      this.slashMesh.position.copy(origin).addScaledVector(fwd, 1.6);
      this.slashMesh.quaternion.copy(cam.quaternion);
      this.slashMesh.rotation.z = -Math.PI / 4;
      this.slashMesh.visible = true;
      this.slashMesh.material.opacity = 0.9;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ATEŞ TOPU (Sol Tık - Fireball)
  // ─────────────────────────────────────────────────────────────────────────
  shootFireball(onShake) {
    if (this.fireballCooldown > 0) return;
    this.fireballCooldown = 0.38;

    sound.playFireball();
    if (onShake) onShake(0.2);

    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const start = cam.position.clone().addScaledVector(fwd, 1.1);

    // Ateş Topu Görsel Modeli
    const fbGroup = new THREE.Group();

    // Akkor Çekirdek
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.38, 2),
      new THREE.MeshBasicMaterial({ color: 0xfff5cc })
    );
    // Dış Alev Halesi
    const halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.58, 2),
      new THREE.MeshBasicMaterial({ color: 0xff3b00, transparent: true, opacity: 0.85 })
    );
    fbGroup.add(core, halo);

    // Işık
    const light = new THREE.PointLight(0xff6600, 3.5, 14);
    fbGroup.add(light);

    fbGroup.position.copy(start);
    this.group.add(fbGroup);

    this.fireballs.push({
      mesh: fbGroup,
      pos: start.clone(),
      vel: fwd.clone().multiplyScalar(58.0), // 58 m/s mermi hızı
      life: 3.5
    });

    // Tepme
    if (this.hw) this.hw.kick = 0.8;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EJDERHA NEFESİ (Sağ Tık Basılı Tutunca - Flamethrower)
  // ─────────────────────────────────────────────────────────────────────────
  setDragonBreath(active) {
    this.dragonBreathActive = active;
    if (!active) {
      this.breathTick = 0;
    }
  }

  _updateDragonBreath(dt, onShake) {
    if (!this.dragonBreathActive || this.currentElement !== 'fire') return;

    sound.playFlameBreath(dt);

    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const origin = cam.position.clone().addScaledVector(fwd, 0.9);

    // El hizasında ışık parlama
    this.fireLight.position.copy(origin);
    this.fireLight.intensity = 3.0 + Math.random() * 1.5;

    // Alev pikselleri ve duman parçacıkları yay
    const count = 3;
    const fireColors = [0xffea00, 0xff7700, 0xef4444, 0xff1100];
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.18;
      const spreadY = (Math.random() - 0.5) * 0.18;
      const dir = fwd.clone().add(new THREE.Vector3(spread, spreadY, spread)).normalize();

      const speed = 28 + Math.random() * 18;
      const vel = dir.multiplyScalar(speed);
      const mat = SHARED_FIRE_MATS[Math.floor(Math.random() * SHARED_FIRE_MATS.length)];
      const pMesh = new THREE.Mesh(SHARED_GEO_024, mat);
      pMesh.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2));
      this.group.add(pMesh);

      this.ps.particles.push({
        mesh: pMesh,
        velocity: vel,
        gravity: 2.0, // Alev hafifçe yukarı yükselir
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
        scaleSpeed: 0.8
      });
    }

    // Periyodik Voxel Eritme / Yakma (Her 0.08 saniyede bir)
    this.breathTick += dt;
    if (this.breathTick >= 0.08) {
      this.breathTick = 0;

      // Işın takibi (Menzil: 22 metre)
      const range = 22;
      const step = 1.2;
      let hit = null;

      for (let d = 1.5; d <= range; d += step) {
        const testPt = origin.clone().addScaledVector(fwd, d);
        if (this.vw && this.vw.getVoxel) {
          const ix = Math.floor(testPt.x / VOXEL_SIZE);
          const iy = Math.floor(testPt.y / VOXEL_SIZE);
          const iz = Math.floor(testPt.z / VOXEL_SIZE);
          const mat = this.vw.getVoxel(ix, iy, iz);
          if (mat !== undefined && mat !== null && mat !== 0) {
            hit = testPt;
            break;
          }
        }
      }

      if (hit) {
        // Çarptığı yüzeyde oyuk aç ve yak
        if (this.vw) {
          this.vw.sweepCut(hit, 1.8, null);
          if (this.vw.doors) this.vw.doors.hitSphere(hit, 1.8, 2);
          if (this.vw.bridge) this.vw.bridge.hitSphere(hit, 1.8);
        }
        if (this.hw && this.hw.cars) this.hw.cars.bladeHit(hit, 2.2);
        if (this.hw && this.hw.npcs) this.hw.npcs.hitSphere(hit, 2.5);

        // Yangın başlat
        if (Math.random() < 0.45) {
          this._igniteArea(hit, 1);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // YANGIN BAŞLATMA & ZAMANLA SÖNEN ALEV KÜMELERİ
  // (o ateş zamanla sönmeye başlasın)
  // ─────────────────────────────────────────────────────────────────────────
  _igniteArea(center, count = 2) {
    sound.playFireIgnite();

    for (let i = 0; i < count; i++) {
      if (this.burningClusters.length >= 24) {
        // En eski alevi kaldır
        const old = this.burningClusters.shift();
        if (old.group) this.mainScene.remove(old.group);
      }

      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        Math.random() * 0.8,
        (Math.random() - 0.5) * 2.2
      );
      const bPos = center.clone().add(offset);

      const bGroup = new THREE.Group();
      bGroup.position.copy(bPos);

      // 4-6 Adet Kübik Canlı Alev Bloğu
      const flameMeshes = [];
      const fCount = 5;
      const fireColors = [0xffea00, 0xff7700, 0xef4444, 0xff2200];

      for (let f = 0; f < fCount; f++) {
        const s = 0.28 + Math.random() * 0.24;
        const fMesh = new THREE.Mesh(
          new THREE.BoxGeometry(s, s * 1.5, s),
          new THREE.MeshBasicMaterial({ color: fireColors[f % fireColors.length] })
        );
        fMesh.position.set(
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.4 + 0.2,
          (Math.random() - 0.5) * 0.6
        );
        bGroup.add(fMesh);
        flameMeshes.push({
          mesh: fMesh,
          baseY: fMesh.position.y,
          speed: 8 + Math.random() * 6,
          offset: Math.random() * Math.PI * 2
        });
      }

      const bLight = new THREE.PointLight(0xff6600, 2.5, 9);
      bLight.position.set(0, 0.4, 0);
      bGroup.add(bLight);

      this.mainScene.add(bGroup);

      this.burningClusters.push({
        group: bGroup,
        light: bLight,
        flames: flameMeshes,
        pos: bPos.clone(),
        t: 0,
        duration: 5.5 + Math.random() * 3.0, // 5.5 - 8.5 saniye yanar ve zamanla söner
        cutTimer: 0
      });
    }
  }

  _updateBurningClusters(dt) {
    for (let i = this.burningClusters.length - 1; i >= 0; i--) {
      const bc = this.burningClusters[i];
      bc.t += dt;

      // Alevlerin yukarı-aşağı titremesi
      bc.flames.forEach(f => {
        const wave = Math.sin(bc.t * f.speed + f.offset);
        f.mesh.position.y = f.baseY + wave * 0.12;
        f.mesh.scale.y = 1.0 + wave * 0.25;
      });

      // Zamanla sönme evresi (Son 2 saniyede küçülür ve solar)
      const timeLeft = bc.duration - bc.t;
      if (timeLeft <= 2.0) {
        const fade = Math.max(0, timeLeft / 2.0);
        bc.group.scale.setScalar(fade);
        bc.light.intensity = 2.5 * fade;
      }

      // Yanarken etrafındaki voxel ve nesneleri eritir
      bc.cutTimer -= dt;
      if (bc.cutTimer <= 0) {
        bc.cutTimer = 0.45;
        if (this.vw) this.vw.sweepCut(bc.pos, 1.4, null);
        if (this.hw && this.hw.cars) this.hw.cars.bladeHit(bc.pos, 1.8);
        if (this.hw && this.hw.npcs) this.hw.npcs.hitSphere(bc.pos, 2.0);
      }

      // Süresi bitince tamamen söndür ve kaldır
      if (bc.t >= bc.duration) {
        this.mainScene.remove(bc.group);
        this.burningClusters.splice(i, 1);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SÜPERSONİK UÇUŞ MODU (Space Tıklama)
  // (Space'e basılı tutmasın, sadece tıkladığında uçmaya başlasın. Bir daha basarsa uçmayı bıraksın.)
  // ─────────────────────────────────────────────────────────────────────────
  toggleFlight(character) {
    if (!this.active && !this.flightActive) return;
    if (this.currentElement !== 'fire' && !this.flightActive) return;

    this.flightActive = !this.flightActive;
    if (character) {
      character.elementalFlight = this.flightActive;
      character.vel.set(0, 0, 0);
      character.knock.set(0, 0, 0);
    }

    if (this.flightActive) {
      sound.playFlightWhoosh();
      this._showBanner('🚀 SÜPERSONİK ATEŞ UÇUŞU AKTİF!', 'W, A, S, D ile süpersonik hızda uçun! İnmek ve eski yürümeye dönmek için Space\'e tekrar basın.');
    } else {
      if (sound.playJump) sound.playJump();
      this._showBanner('🛬 UÇUŞ MODU KAPATILDI', 'Yere iniş yapıldı, eski yürüme kontrollerine dönüldü.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SİSMİK DEPREM ŞOK DALGASI (Yukarıdan Yere Çarpınca)
  // ─────────────────────────────────────────────────────────────────────────
  spawnSeismicShockwave(slamPos) {
    const ringGeo = new THREE.RingGeometry(0.8, 2.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(slamPos.x, slamPos.y + 0.15, slamPos.z);
    ringMesh.rotation.x = -Math.PI / 2;
    this.mainScene.add(ringMesh);

    const light = new THREE.PointLight(0xff4400, 6, 28);
    light.position.set(slamPos.x, slamPos.y + 2, slamPos.z);
    this.mainScene.add(light);

    this.seismicShockwaves.push({
      mesh: ringMesh,
      light,
      radius: 1.0,
      t: 0,
      duration: 0.85
    });

    // Çarpma etrafında 4 yangın kümesi başlat
    this._igniteArea(slamPos, 4);
  }

  _showBanner(title, desc) {
    const hintEl = document.getElementById('weapon-hint');
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#facc15;font-weight:900;">${title}</span> &nbsp;|&nbsp; <span style="color:#e2e8f0;font-size:12px;">${desc}</span>`;
      hintEl.classList.add('show');
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => { hintEl.classList.remove('show'); }, 3800);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HER KARE GÜNCELLEMESİ (Update Loop)
  // ─────────────────────────────────────────────────────────────────────────
  update(dt, ctx) {
    this.animTime += dt;
    if (this.fireballCooldown > 0) this.fireballCooldown -= dt;

    // Reaktör çekirdeği nabız gibi atar
    if (this.coreMesh) {
      const pulse = 1.0 + Math.sin(this.animTime * 12.0) * 0.15;
      this.coreMesh.scale.setScalar(pulse);
      if (this.haloMesh) this.haloMesh.scale.setScalar(pulse * 1.15);
    }

    // Alev kılıcı titreme ve alev dalgalanması
    if (this.fireSwordActive && this.bladeHalo) {
      const wave = 0.9 + Math.sin(this.animTime * 24.0) * 0.2;
      this.bladeHalo.scale.set(wave, wave * 1.1, 1.0);
    }

    // Kılıç savurma animasyonu
    if (this.isSwingingSword) {
      this.swordSwingProgress += dt * 4.8;
      const p = this.swordSwingProgress;
      if (this.gauntletRoot) {
        this.gauntletRoot.rotation.z = Math.sin(p * Math.PI) * 1.4;
        this.gauntletRoot.rotation.x = -Math.sin(p * Math.PI) * 0.9;
        this.gauntletRoot.position.x = 0.32 - Math.sin(p * Math.PI) * 0.4;
      }
      if (this.slashMesh && this.slashMesh.visible) {
        this.slashMesh.material.opacity = Math.max(0, 1.0 - p);
      }
      if (p >= 1.0) {
        this.isSwingingSword = false;
        if (this.slashMesh) this.slashMesh.visible = false;
        if (this.gauntletRoot) {
          this.gauntletRoot.rotation.set(0, 0, 0);
          this.gauntletRoot.position.set(0.32, -0.26, -0.65);
        }
      }
    }

    // Ejderha nefesi güncellemesi
    this._updateDragonBreath(dt, ctx ? ctx.onShake : null);

    // Ateş topları güncellemesi
    this._updateFireballs(dt, ctx ? ctx.onShake : null);

    // Yanan alanlar güncellemesi (zamanla sönen yangınlar)
    this._updateBurningClusters(dt);

    // Sismik deprem şok dalgaları animasyonu (Yukarıdan yere çarpınca yayılan alev dalgası)
    for (let i = this.seismicShockwaves.length - 1; i >= 0; i--) {
      const sw = this.seismicShockwaves[i];
      sw.t += dt;
      const progress = sw.t / sw.duration;
      sw.radius = THREE.MathUtils.lerp(1.0, 24.0, Math.pow(progress, 0.6));
      sw.mesh.scale.set(sw.radius, sw.radius, 1.0);
      sw.mesh.material.opacity = Math.max(0, 1.0 - progress);
      sw.light.intensity = Math.max(0, 6.0 * (1.0 - progress));

      if (sw.t >= sw.duration) {
        this.mainScene.remove(sw.mesh);
        this.mainScene.remove(sw.light);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.seismicShockwaves.splice(i, 1);
      }
    }

    // Uçuş modu esnasında ayaklardan / sırttan fışkıran alev jetleri
    if (this.flightActive && this.hw && this.hw.character) {
      this._emitFlightThrusterParticles(dt);
    }
  }

  _updateFireballs(dt, onShake) {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const fb = this.fireballs[i];
      fb.life -= dt;

      // Yerçekimi etkisi (hafif kavis)
      fb.vel.y -= 4.0 * dt;
      const nextPos = fb.pos.clone().addScaledVector(fb.vel, dt);

      // Uçuş sırasında arkasında alev küpü pikselleri bırak (performans için paylaşımlı havuz)
      if (Math.random() < 0.6) {
        const mat = SHARED_FIRE_MATS[Math.floor(Math.random() * SHARED_FIRE_MATS.length)];
        const pMesh = new THREE.Mesh(SHARED_GEO_018, mat);
        pMesh.position.copy(fb.pos);
        this.group.add(pMesh);
        this.ps.particles.push({
          mesh: pMesh,
          velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2),
          gravity: 0,
          rotSpeed: 4,
          life: 0.28,
          maxLife: 0.28,
          scaleSpeed: -0.6
        });
      }

      // Çarpışma kontrolü (Voxel / Dünya / Zemin)
      let hit = false;
      const hitPt = nextPos.clone();

      if (this.vw && this.vw.getVoxel) {
        const ix = Math.floor(nextPos.x / VOXEL_SIZE);
        const iy = Math.floor(nextPos.y / VOXEL_SIZE);
        const iz = Math.floor(nextPos.z / VOXEL_SIZE);
        const mat = this.vw.getVoxel(ix, iy, iz);
        if (mat !== undefined && mat !== null && mat !== 0) {
          hit = true;
        }
      }

      if (nextPos.y <= 0.2) {
        hit = true;
      }

      if (hit || fb.life <= 0) {
        // Patlama & Voxel Yıkımı
        sound.playExplosion(1.3);
        if (this.ps) this.ps.createExplosion(hitPt, 5, 0xff5500);
        if (onShake) onShake(0.4);

        if (this.vw) {
          this.vw.explode(hitPt, 4.2, 240);
          if (this.vw.doors) this.vw.doors.hitSphere(hitPt, 4.2, 5);
          if (this.vw.bridge) this.vw.bridge.hitSphere(hitPt, 4.2);
        }

        if (this.hw) {
          if (this.hw.cars) this.hw.cars.bladeHit(hitPt, 4.8);
          if (this.hw.npcs) this.hw.npcs.hitSphere(hitPt, 5.2);
        }

        // Çarptığı yerde alevler başlat (o ateş zamanla sönmeye başlasın)
        this._igniteArea(hitPt, 3);

        this.group.remove(fb.mesh);
        this.fireballs.splice(i, 1);
        continue;
      }

      fb.pos.copy(nextPos);
      fb.mesh.position.copy(fb.pos);
    }
  }

  _emitFlightThrusterParticles(dt) {
    this.thrusterTick = (this.thrusterTick || 0) + dt;
    if (this.thrusterTick < 0.035) return; // 28 Hz yeterlidir; her karede yüzlerce nesne üretilmesini önler
    this.thrusterTick = 0;

    const char = this.hw.character;
    if (!char || !char.mesh) return;

    const p = char.mesh.position.clone();
    p.y += 0.2; // Ayak hizası

    for (let i = 0; i < 2; i++) {
      const mat = SHARED_FIRE_MATS[Math.floor(Math.random() * SHARED_FIRE_MATS.length)];
      const m = new THREE.Mesh(SHARED_GEO_020, mat);
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4));
      this.group.add(m);

      this.ps.particles.push({
        mesh: m,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3, -16 - Math.random() * 8, (Math.random() - 0.5) * 3),
        gravity: 0,
        rotSpeed: 8,
        life: 0.22,
        maxLife: 0.22,
        scaleSpeed: -0.7
      });
    }
  }
}
