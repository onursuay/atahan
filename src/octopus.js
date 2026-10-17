import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// AHTAPOT SİLAHI VE DÖNÜŞÜM SİSTEMİ (Silah Kimliği: 16 — T Tuşu / Son Silah)
//  - Silah seçildiğinde ekrana oyundaki kare/voxel tarzında 3B/kare bir ahtapot atlar,
//    ekran kararır ve "vıcık vıcık" seslerle yavaşça eriyerek kaybolur.
//  - Ekranın kenarları mor bir hale (vignette) alır.
//  - Birinci şahısta çekiç veya silah görünmez; yalnızca iki yanda ahtapot kolları
//    ve yüzgeçler görünür, çok hafif yukarı-aşağı salınır.
//  - Sol tık: Kalın, vantuzlu, şekilli dokunaç kolunu ileri fırlatır:
//      • İnsana (NPC) değerse insanı sarıp tutar; fareyi hareket ettirince insanı
//        havaya kaldırıp sallar, tekrar sol tıkla fırlatır!
//      • Binaya değerse kalın dokunaç koluyla binayı 3 TAM TUR sarar ve durur.
//        Fareyi kaydırınca binayı yerinden söküp havaya kaldırır, sallar ve tekrar
//        sol tıka basınca binayı ileri fırlatır! Sağ tıka basılırsa binayı kendine
//        doğru çekip altını kırarak yıkar.
//  - E tuşu: Ahtapot topaç gibi hızla dönerek etrafındaki eşyaları, duvarları,
//    kapıları ve araçları kırıp savurur.
//  - Q tuşu: Her basışta jetpack gibi dev bir sıçrama yapar ve geri yere iner (zıpla-in).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TENTACLE_RANGE = 65;     // kolun uzanabileceği en fazla mesafe (m)
const EXTEND_SPEED = 92;           // kol fırlatma hızı (m/sn)
const WRAP_DURATION = 0.72;        // binayı sarma süresi (sn)
const WRAP_TURNS = 1.65;           // binanın etrafında kaç tur döneceği
const WORLD_SEGS = 48;             // uzayan ince kolun boğum sayısı
const SPIN_DURATION = 1.15;        // E tuşu topaç dönüşü süresi (sn)
const SPIN_TURNS = 3;              // E tuşu topaç dönüşünde tam tur sayısı
const SPIN_RADIUS = 4.8;           // topaç dönüşünün etrafı kırma yarıçapı (m)

export class OctopusSystem {
  constructor(handWeapons) {
    this.hw = handWeapons;
    this.mainScene = handWeapons.mainScene;
    this.camera = handWeapons.camera;
    this.vw = handWeapons.voxelWorld;
    this.ps = handWeapons.particleSystem;

    this.active = false;
    this.animTime = 0;

    // Kanca / Sarma / Tutma Durumu:
    // 'idle' | 'extending' | 'wrapping' | 'wrapped' | 'holding_building' | 'holding_npc' | 'pulling' | 'retracting'
    this.state = 'idle';
    this.stateT = 0;
    this.launchOrigin = new THREE.Vector3();
    this.launchDir = new THREE.Vector3();
    this.currentDist = 0;
    this.targetDist = 0;
    this.hitPoint = null;
    this.wrapBox = null;          // { minX, maxX, minZ, maxZ, baseY, cx, cz }
    this.wrapLocalPts = [];       // binanın etrafındaki 3 turluk sarmal noktalar
    this.pullStartPts = [];

    // İnsan (NPC) veya Bina Tutma & Sallama durumu
    this.grabbedNpc = null;
    this.heldChunk = null;
    this.holdDist = 12;
    this.buildingHoldDist = 18;
    this.buildingBaseCom = new THREE.Vector3();
    this.buildingAnchorOffset = new THREE.Vector3();
    this.mouseSlideDist = 0;
    this.mouseVelX = 0;
    this.mouseVelY = 0;
    this.lastAimDir = new THREE.Vector3();
    this.aimSwingVel = new THREE.Vector3();

    // R tuşu: Çift kol kanca (kendini hedefe çekme) durumu
    this.grappleTarget = new THREE.Vector3();
    this.grappleLeftTarget = new THREE.Vector3();
    this.grappleRightTarget = new THREE.Vector3();
    this.leftPullStartPts = [];
    this.grappleBlockedTime = 0;

    // E tuşu: Topaç gibi dönme durumu
    this.spinT = -1;
    this.spinLastCutT = 0;

    this._buildUI();
    this._buildFirstPersonArms();
    this._buildVoxelJumpScare3D();
    this._buildWorldTentacle();
    this._buildSpinTentacles();
  }

  // ───────────────────────── Ekran Arayüzü (Kare Voxel Jumpscare, Mor Kenar, Sol Alt Çapraz Kontroller) ─────────────────────────
  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      /* Ekran kenarlarında mor ahtapot halesi */
      #octopus-vignette {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 18;
        opacity: 0;
        transition: opacity 0.45s ease;
        background: radial-gradient(ellipse at center,
          rgba(88, 28, 135, 0) 52%,
          rgba(126, 34, 206, 0.25) 78%,
          rgba(88, 28, 135, 0.62) 100%);
        box-shadow: inset 0 0 110px 36px rgba(147, 51, 234, 0.55);
      }
      #octopus-vignette.on { opacity: 1; }

      /* Ahtapot ekrana atlama ve kararma katmanı (100% Kare/Voxel piksel tarzı) */
      #octopus-scare {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 180;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(4, 0, 10, 0);
        opacity: 0;
        image-rendering: pixelated;
      }
      #octopus-scare .octo-wrap {
        width: min(76vw, 76vh);
        height: min(76vw, 76vh);
        transform: scale(0.15);
        image-rendering: pixelated;
        filter: drop-shadow(0 0 28px rgba(168, 85, 247, 0.95));
      }

      /* Sol alt çaprazda ahtapot kontrolleri paneli */
      #octopus-hud {
        position: fixed;
        left: 26px;
        bottom: 205px;
        z-index: 42;
        pointer-events: none;
        background: linear-gradient(135deg, rgba(46, 16, 101, 0.92), rgba(88, 28, 135, 0.88));
        border: 3px solid #c084fc;
        box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.75), 0 0 18px rgba(168, 85, 247, 0.5);
        padding: 10px 14px;
        color: #f3e8ff;
        font-size: 10px;
        line-height: 1.7;
        text-shadow: 1px 1px #000;
        transform: rotate(-3.5deg);
        transform-origin: bottom left;
        display: none;
      }
      #octopus-hud.on { display: block; }
      #octopus-hud .octo-title {
        font-size: 12px;
        font-weight: 700;
        color: #e9d5ff;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
        border-bottom: 2px solid rgba(192, 132, 252, 0.45);
        padding-bottom: 3px;
      }
      #octopus-hud .octo-key {
        display: inline-block;
        background: #3b0764;
        border: 1.5px solid #d8b4fe;
        padding: 0px 5px;
        color: #fde047;
        margin-right: 4px;
      }
      #octopus-hud .octo-status {
        margin-top: 5px;
        padding-top: 4px;
        border-top: 1px dashed rgba(216, 180, 254, 0.4);
        font-size: 10px;
        color: #fde047;
      }
    `;
    document.head.appendChild(style);

    this.vignetteEl = document.createElement('div');
    this.vignetteEl.id = 'octopus-vignette';
    document.body.appendChild(this.vignetteEl);

    // Ekrana atlayan KARE / VOXEL Ahtapot (hiç yuvarlak/elips yok, tamamen oyundaki küpler gibi kare bloklardan oluşur)
    this.scareEl = document.createElement('div');
    this.scareEl.id = 'octopus-scare';
    this.scareEl.innerHTML = `
      <div class="octo-wrap" id="octopus-scare-art">
        <svg viewBox="0 0 32 32" width="100%" height="100%" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
          <!-- Sol ve Sağ Kare Yüzgeçler -->
          <rect x="6" y="7" width="4" height="3" fill="#9333ea"/>
          <rect x="5" y="8" width="2" height="2" fill="#c084fc"/>
          <rect x="22" y="7" width="4" height="3" fill="#9333ea"/>
          <rect x="25" y="8" width="2" height="2" fill="#c084fc"/>

          <!-- Kare Voxel Gövde / Kafa (Küp Bloklar) -->
          <rect x="10" y="4" width="12" height="14" fill="#7e22ce"/>
          <rect x="9" y="6" width="14" height="11" fill="#6b21a8"/>
          <rect x="11" y="5" width="10" height="12" fill="#9333ea"/>
          <!-- Kafa Üstü Kare Voxel Parlamalar / Benekler -->
          <rect x="12" y="6" width="2" height="2" fill="#d8b4fe"/>
          <rect x="18" y="6" width="2" height="2" fill="#d8b4fe"/>
          <rect x="15" y="8" width="2" height="2" fill="#c084fc"/>

          <!-- Kare Voxel Gözler -->
          <rect x="11" y="11" width="4" height="4" fill="#fef08a"/>
          <rect x="17" y="11" width="4" height="4" fill="#fef08a"/>
          <rect x="12" y="12" width="3" height="2" fill="#090d16"/>
          <rect x="17" y="12" width="3" height="2" fill="#090d16"/>
          <rect x="11" y="11" width="1" height="1" fill="#ffffff"/>
          <rect x="20" y="11" width="1" height="1" fill="#ffffff"/>

          <!-- Kare Ağız / Merkez -->
          <rect x="14" y="16" width="4" height="3" fill="#2e1065"/>
          <rect x="15" y="17" width="2" height="1" fill="#f5d0fe"/>

          <!-- 8 Adet Kare Basamaklı Voxel Dokunaç Kolu ve Kare Vantuzlar -->
          <!-- Sol Üst Kol -->
          <rect x="7" y="14" width="3" height="3" fill="#7e22ce"/>
          <rect x="4" y="11" width="3" height="3" fill="#9333ea"/>
          <rect x="2" y="8" width="3" height="3" fill="#7e22ce"/>
          <rect x="1" y="5" width="2" height="3" fill="#a855f7"/>
          <rect x="5" y="13" width="1" height="1" fill="#f5d0fe"/>
          <rect x="3" y="10" width="1" height="1" fill="#f5d0fe"/>

          <!-- Sağ Üst Kol -->
          <rect x="22" y="14" width="3" height="3" fill="#7e22ce"/>
          <rect x="25" y="11" width="3" height="3" fill="#9333ea"/>
          <rect x="27" y="8" width="3" height="3" fill="#7e22ce"/>
          <rect x="29" y="5" width="2" height="3" fill="#a855f7"/>
          <rect x="26" y="13" width="1" height="1" fill="#f5d0fe"/>
          <rect x="28" y="10" width="1" height="1" fill="#f5d0fe"/>

          <!-- Sol Yan Kol -->
          <rect x="6" y="17" width="4" height="3" fill="#6b21a8"/>
          <rect x="3" y="16" width="3" height="3" fill="#9333ea"/>
          <rect x="1" y="14" width="2" height="3" fill="#a855f7"/>
          <rect x="4" y="18" width="1" height="1" fill="#f5d0fe"/>
          <rect x="2" y="16" width="1" height="1" fill="#f5d0fe"/>

          <!-- Sağ Yan Kol -->
          <rect x="22" y="17" width="4" height="3" fill="#6b21a8"/>
          <rect x="26" y="16" width="3" height="3" fill="#9333ea"/>
          <rect x="29" y="14" width="2" height="3" fill="#a855f7"/>
          <rect x="27" y="18" width="1" height="1" fill="#f5d0fe"/>
          <rect x="29" y="16" width="1" height="1" fill="#f5d0fe"/>

          <!-- Sol Alt Çapraz Kol -->
          <rect x="8" y="18" width="3" height="3" fill="#7e22ce"/>
          <rect x="5" y="21" width="3" height="3" fill="#9333ea"/>
          <rect x="3" y="24" width="3" height="3" fill="#7e22ce"/>
          <rect x="1" y="27" width="3" height="3" fill="#a855f7"/>
          <rect x="6" y="20" width="1" height="1" fill="#f5d0fe"/>
          <rect x="4" y="23" width="1" height="1" fill="#f5d0fe"/>
          <rect x="2" y="26" width="1" height="1" fill="#f5d0fe"/>

          <!-- Sağ Alt Çapraz Kol -->
          <rect x="21" y="18" width="3" height="3" fill="#7e22ce"/>
          <rect x="24" y="21" width="3" height="3" fill="#9333ea"/>
          <rect x="26" y="24" width="3" height="3" fill="#7e22ce"/>
          <rect x="28" y="27" width="3" height="3" fill="#a855f7"/>
          <rect x="25" y="20" width="1" height="1" fill="#f5d0fe"/>
          <rect x="27" y="23" width="1" height="1" fill="#f5d0fe"/>
          <rect x="29" y="26" width="1" height="1" fill="#f5d0fe"/>

          <!-- Orta Sol Alt Kol -->
          <rect x="11" y="18" width="3" height="4" fill="#6b21a8"/>
          <rect x="9" y="22" width="3" height="4" fill="#9333ea"/>
          <rect x="8" y="26" width="3" height="4" fill="#7e22ce"/>
          <rect x="7" y="29" width="2" height="2" fill="#a855f7"/>
          <rect x="11" y="21" width="1" height="1" fill="#f5d0fe"/>
          <rect x="10" y="25" width="1" height="1" fill="#f5d0fe"/>

          <!-- Orta Sağ Alt Kol -->
          <rect x="18" y="18" width="3" height="4" fill="#6b21a8"/>
          <rect x="20" y="22" width="3" height="4" fill="#9333ea"/>
          <rect x="21" y="26" width="3" height="4" fill="#7e22ce"/>
          <rect x="23" y="29" width="2" height="2" fill="#a855f7"/>
          <rect x="20" y="21" width="1" height="1" fill="#f5d0fe"/>
          <rect x="21" y="25" width="1" height="1" fill="#f5d0fe"/>
        </svg>
      </div>
    `;
    document.body.appendChild(this.scareEl);
    this.scareArtEl = document.getElementById('octopus-scare-art');

    // Sol alt çapraz kontrol rehberi
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'octopus-hud';
    this.hudEl.innerHTML = `
      <div class="octo-title">🐙 AHTAPOT KONTROLLERİ</div>
      <div><span class="octo-key">SOL TIK</span> Kol At (Bina Sar / İnsan Tut)</div>
      <div><span class="octo-key">FARE KAYDIR</span> Tutulan Binayı Sök / İnsanı Kaldır</div>
      <div><span class="octo-key">SOL TIK (TUTARKEN)</span> Binayı / İnsanı Fırlat!</div>
      <div><span class="octo-key">SAĞ TIK</span> Sarılan Binayı Çek ve Kır</div>
      <div><span class="octo-key">R</span> İki Kolu Kanca Gibi At (Kendini Çek)</div>
      <div><span class="octo-key">E</span> Topaç Dönüşü &nbsp;|&nbsp; <span class="octo-key">Q</span> Dev Zıpla</div>
      <div class="octo-status" id="octopus-status">DURUM: KOL HAZIR</div>
    `;
    document.body.appendChild(this.hudEl);
    this.statusEl = document.getElementById('octopus-status');
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.innerText = text;
  }

  // 3B Kare Voxel Ahtapot Modeli (kameranın tam üstüne atlayan 3B küp ahtapot)
  _buildVoxelJumpScare3D() {
    const g = new THREE.Group();
    g.visible = false;
    const purple = new THREE.MeshLambertMaterial({ color: 0x7e22ce });
    const darkPurple = new THREE.MeshLambertMaterial({ color: 0x4c1d95 });
    const lightPurple = new THREE.MeshLambertMaterial({ color: 0xa855f7 });
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });
    const eyeYellow = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const eyeBlack = new THREE.MeshBasicMaterial({ color: 0x090d16 });

    // Küp Kafa
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.42), purple);
    g.add(head);
    // Küp Yan Yüzgeçler
    const lFin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.18), lightPurple);
    lFin.position.set(-0.32, 0.12, 0);
    const rFin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.18), lightPurple);
    rFin.position.set(0.32, 0.12, 0);
    g.add(lFin, rFin);
    // Küp Gözler
    for (const sx of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.06), eyeYellow);
      eye.position.set(sx, -0.02, 0.21);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), eyeBlack);
      pupil.position.set(sx, -0.02, 0.22);
      g.add(eye, pupil);
    }
    // 8 Kare Küp Dokunaç Kolu
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const arm = new THREE.Group();
      for (let s = 0; s < 5; s++) {
        const w = 0.11 * (1 - s * 0.12);
        const cube = new THREE.Mesh(new THREE.BoxGeometry(w, w, 0.12), s % 2 === 0 ? purple : darkPurple);
        cube.position.set(Math.cos(ang) * (0.16 + s * 0.09), -0.24 - Math.sin(ang) * (0.12 + s * 0.08), 0.1 + s * 0.07);
        const suck = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, w * 0.55, 0.04), suckerMat);
        suck.position.set(cube.position.x, cube.position.y, cube.position.z + 0.06);
        arm.add(cube, suck);
      }
      g.add(arm);
    }
    this.hw.viewScene.add(g);
    this.scare3D = g;
  }

  // Silah 16'ya geçildiğinde ekrana kare/voxel ahtapot atlama + kararma + vıcık vıcık kaybolma animasyonu
  _triggerJumpScare() {
    sound.playOctopusSquish();
    if (this._scareRaf) cancelAnimationFrame(this._scareRaf);
    const start = performance.now();
    const totalDur = 2400; // 2.4 sn

    this.scareEl.style.opacity = '1';
    if (this.scare3D) this.scare3D.visible = true;

    const step = (now) => {
      if (!this.active) {
        this.scareEl.style.opacity = '0';
        if (this.scare3D) this.scare3D.visible = false;
        return;
      }
      const elapsed = now - start;
      const u = Math.min(1, elapsed / totalDur);

      if (u < 0.15) {
        // 0..0.36 sn: Kare voxel ahtapot kameranın üstüne hızla atlar ve ekran simsiyah kararır
        const k = u / 0.15;
        const scale = 0.2 + k * 1.15;
        this.scareArtEl.style.transform = `scale(${scale.toFixed(3)})`;
        this.scareEl.style.background = `rgba(4, 0, 10, ${(k * 0.96).toFixed(3)})`;
        this.scareEl.style.opacity = '1';
        if (this.scare3D) {
          this.scare3D.position.set(0, -0.1 + k * 0.1, -1.8 + k * 1.25);
          this.scare3D.rotation.set(0, 0, Math.sin(k * 10) * 0.12);
        }
      } else if (u < 0.36) {
        // 0.36..0.86 sn: Ekran karanlık, kare ahtapot ekrana yapışmış halde vıcık vıcık sarsılır
        const w = (u - 0.15) / 0.21;
        const sx = 1.35 + Math.round(Math.sin(w * Math.PI * 6)) * 0.04;
        const sy = 1.35 - Math.round(Math.sin(w * Math.PI * 6)) * 0.04;
        this.scareArtEl.style.transform = `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        this.scareEl.style.background = `rgba(4, 0, 10, 0.96)`;
        this.scareEl.style.opacity = '1';
        if (this.scare3D) {
          this.scare3D.position.set(Math.sin(w * 25) * 0.02, 0, -0.55);
        }
      } else {
        // 0.86..2.40 sn: Kare ahtapot vıcık vıcık seslerle kademeli olarak aşağı kayıp yok olur
        const f = (u - 0.36) / 0.64;
        const ease = 1 - Math.pow(1 - f, 2);
        const slideY = Math.round(ease * 18) * 10;
        this.scareArtEl.style.transform = `translate(0px, ${slideY}px) scale(1.35)`;
        this.scareEl.style.background = `rgba(4, 0, 10, ${(0.96 * (1 - ease)).toFixed(3)})`;
        this.scareEl.style.opacity = String((1 - ease).toFixed(3));
        if (this.scare3D) {
          this.scare3D.position.set(0, -ease * 0.9, -0.55);
        }
      }

      if (u < 1) {
        this._scareRaf = requestAnimationFrame(step);
      } else {
        this.scareEl.style.opacity = '0';
        if (this.scare3D) this.scare3D.visible = false;
      }
    };
    this._scareRaf = requestAnimationFrame(step);
  }

  // ───────────────────────── Birinci Şahıs Ahtapot Kolları ve Yüzgeçler ─────────────────────────
  _buildFirstPersonArms() {
    this.fpGroup = new THREE.Group();
    this.fpGroup.visible = false;
    this.hw.root.add(this.fpGroup);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0x7e22ce });      // koyu mor ahtapot derisi
    const ridgeMat = new THREE.MeshLambertMaterial({ color: 0x581c87 });     // sırt boğumu
    const tipMat = new THREE.MeshLambertMaterial({ color: 0xa855f7 });       // parlak mor uç/üst
    const finMat = new THREE.MeshLambertMaterial({ color: 0x9333ea });       // yan yüzgeç rengi
    const finInnerMat = new THREE.MeshLambertMaterial({ color: 0xc084fc });  // yüzgeç iç zarı
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });    // açık pembe-mor vantuzlar

    const makeArmAndFin = (side) => {
      const g = new THREE.Group();
      const armCurve = new THREE.Group();
      const segs = 12;
      for (let i = 0; i < segs; i++) {
        const u = i / (segs - 1);
        const w = 0.14 * (1 - u * 0.58);
        const h = 0.12 * (1 - u * 0.58);
        const d = 0.115;
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          i > segs - 4 ? tipMat : skinMat
        );
        const x = -side * (Math.sin(u * Math.PI * 0.75) * 0.055 - u * 0.03);
        const y = Math.sin(u * Math.PI) * 0.045 + (u > 0.65 ? (u - 0.65) * 0.12 : 0);
        const z = -i * 0.082;
        seg.position.set(x, y, z);
        seg.rotation.x = u > 0.6 ? 0.35 * (u - 0.6) : -0.08 * u;
        seg.rotation.y = side * (0.18 - u * 0.32);
        armCurve.add(seg);

        // Üst kas sırtı
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65, h * 0.35, d * 0.9), ridgeMat);
        ridge.position.set(x, y + h * 0.5, z);
        armCurve.add(ridge);

        // İç-alt kısımda çift sıra kare vantuzlar
        if (i >= 1 && i < segs - 1) {
          const sr = w * 0.34;
          for (const row of [-1, 1]) {
            const sucker = new THREE.Mesh(new THREE.BoxGeometry(sr, sr * 0.6, sr), suckerMat);
            sucker.position.set(
              x - side * (w * 0.48),
              y - h * 0.32 + row * sr * 0.65,
              z
            );
            armCurve.add(sucker);
          }
        }
      }

      // Yan Yüzgeç
      const finPivot = new THREE.Group();
      finPivot.position.set(side * 0.08, 0.03, -0.22);
      const finOuter = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.34), finMat);
      finOuter.position.set(side * 0.07, 0.01, -0.04);
      finOuter.rotation.z = -side * 0.22;
      finOuter.rotation.y = side * 0.28;
      const finInner = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.26), finInnerMat);
      finInner.position.set(side * 0.06, 0.005, -0.04);
      finInner.rotation.z = -side * 0.22;
      finInner.rotation.y = side * 0.28;
      const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.18), finMat);
      finTip.position.set(side * 0.12, 0.02, -0.22);
      finTip.rotation.z = -side * 0.32;
      finTip.rotation.y = side * 0.42;
      finPivot.add(finOuter, finInner, finTip);

      g.add(armCurve, finPivot);
      g.position.set(side * 0.36, -0.26, -0.36);
      g.rotation.y = -side * 0.12;
      return { group: g, armCurve, finPivot };
    };

    this.leftArmFP = makeArmAndFin(-1);
    this.rightArmFP = makeArmAndFin(1);
    this.fpGroup.add(this.leftArmFP.group, this.rightArmFP.group);
  }

  // ───────────────────────── Dünya Sahnesinde Fırlatılan ve Tutan İnce Kollar (Sağ ve Sol) ─────────────────────────
  _buildWorldTentacle() {
    this.worldGroup = new THREE.Group();
    this.worldGroup.visible = false;
    this.mainScene.add(this.worldGroup);

    this.leftWorldGroup = new THREE.Group();
    this.leftWorldGroup.visible = false;
    this.mainScene.add(this.leftWorldGroup);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0x7e22ce });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0x9333ea });
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });

    const createArmSegs = (parentGroup) => {
      const segs = [];
      for (let i = 0; i < WORLD_SEGS; i++) {
        const segGroup = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.28, 1.0),
          i % 2 === 0 ? skinMat : stripeMat
        );
        segGroup.add(body);

        // Her boğumun altında vantuzlar
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.22), suckerMat);
        s1.position.set(-0.08, -0.15, -0.2);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.22), suckerMat);
        s2.position.set(0.08, -0.15, 0.2);
        segGroup.add(s1, s2);

        parentGroup.add(segGroup);
        segs.push({ group: segGroup, body });
      }
      return segs;
    };

    this.worldSegs = createArmSegs(this.worldGroup);
    this.leftWorldSegs = createArmSegs(this.leftWorldGroup);
  }

  // ───────────────────────── E Tuşu: Topaç Dönüşü İçin Etrafa Açılan 4 Dokunaç Kolu ─────────────────────────
  _buildSpinTentacles() {
    this.spinGroup = new THREE.Group();
    this.spinGroup.visible = false;
    this.mainScene.add(this.spinGroup);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0x7e22ce });
    const tipMat = new THREE.MeshLambertMaterial({ color: 0xa855f7 });
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });

    for (let armIdx = 0; armIdx < 4; armIdx++) {
      const arm = new THREE.Group();
      arm.rotation.y = (armIdx / 4) * Math.PI * 2;
      for (let s = 0; s < 10; s++) {
        const u = s / 9;
        const w = 0.52 * (1 - u * 0.55);
        const h = 0.42 * (1 - u * 0.55);
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.55), s > 6 ? tipMat : skinMat);
        box.position.set(Math.sin(u * Math.PI) * 0.35, Math.sin(u * Math.PI * 2) * 0.15, -0.6 - s * 0.42);
        const suck = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.14, 0.28), suckerMat);
        suck.position.set(box.position.x, box.position.y - h * 0.55, box.position.z);
        arm.add(box, suck);
      }
      this.spinGroup.add(arm);
    }
  }

  // ───────────────────────── Silah Seçimi / Mod Değişimi ─────────────────────────
  onSwitch(weaponId, character) {
    const want = weaponId === 16;
    const wasActive = this.active;
    this.active = want;
    this.fpGroup.visible = want;

    if (this.vignetteEl) this.vignetteEl.classList.toggle('on', want);
    if (this.hudEl) this.hudEl.classList.toggle('on', want);

    if (character) {
      character.leftArm.visible = !want;
      character.rightArm.visible = !want;
    }

    if (want && !wasActive) {
      this._resetTentacle();
      this._triggerJumpScare();
    } else if (!want && wasActive) {
      this._resetTentacle();
      if (this.scareEl) this.scareEl.style.opacity = '0';
      if (this.scare3D) this.scare3D.visible = false;
      this.spinT = -1;
      if (this.spinGroup) this.spinGroup.visible = false;
    }
  }

  _resetTentacle() {
    if (this.grabbedNpc) {
      this.grabbedNpc.grabbed = false;
      this.grabbedNpc = null;
    }
    if (this.heldChunk && this.heldChunk.phase === 'held') {
      this.vw.collapse.throwChunk(this.heldChunk, new THREE.Vector3(0, -4, 0));
    }
    this.heldChunk = null;
    this.state = 'idle';
    this.stateT = 0;
    this.currentDist = 0;
    this.hitPoint = null;
    this.wrapBox = null;
    this.wrapLocalPts = [];
    this.leftPullStartPts = [];
    this.mouseSlideDist = 0;
    this.worldGroup.visible = false;
    if (this.leftWorldGroup) this.leftWorldGroup.visible = false;
    this._setStatus('DURUM: KOL HAZIR [SOL TIK / R: KANCA]');
  }

  // ───────────────────────── E Tuşu: Topaç Gibi Dönerek Etrafındaki Eşyaları Kırma ─────────────────────────
  startTopacSpin(character, onYawDelta, onScreenShake) {
    if (!this.active) return false;
    if (this.spinT >= 0) return true;
    this.spinT = 0;
    this.spinLastCutT = 0;
    this.spinGroup.visible = true;
    sound.playOctopusSpin(SPIN_DURATION);
    if (onScreenShake) onScreenShake(0.28);
    this._setStatus('TOPAÇ DÖNÜŞÜ! ETRAFTAKİ HER ŞEY KIRILIYOR!');
    return true;
  }

  _updateTopacSpin(dt, character, onYawDelta, onScreenShake) {
    if (this.spinT < 0) return;
    const prevT = this.spinT;
    this.spinT += dt;
    const u = Math.min(1, this.spinT / SPIN_DURATION);
    const prevU = Math.min(1, prevT / SPIN_DURATION);

    const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const dAngle = (ease(u) - ease(prevU)) * Math.PI * 2 * SPIN_TURNS;
    if (onYawDelta) onYawDelta(dAngle);

    const pPos = character ? character.mesh.position : this.camera.position;
    this.spinGroup.position.set(pPos.x, pPos.y + 1.1, pPos.z);
    this.spinGroup.rotation.y += dt * 28;

    this.spinLastCutT -= dt;
    if (this.spinLastCutT <= 0) {
      this.spinLastCutT = 0.055;
      const center = new THREE.Vector3(pPos.x, pPos.y + 1.1, pPos.z);

      if (this.hw.props) {
        this.hw.props.impulse(center, SPIN_RADIUS, 95);
      }

      if (this.vw.doors) this.vw.doors.hitSphere(center, SPIN_RADIUS, 8);
      if (this.vw.homeTV && center.distanceTo(new THREE.Vector3(this.vw.homeTV.x, this.vw.homeTV.y0, this.vw.homeTV.z0)) < SPIN_RADIUS) {
        this.vw.homeTV.hitAt(this.vw.homeTV.y0, this.vw.homeTV.z0);
      }
      if (this.hw.cars) this.hw.cars.bladeHit(center, SPIN_RADIUS);
      if (this.hw.npcs) this.hw.npcs.hitSphere(center, SPIN_RADIUS);

      for (let a = 0; a < 8; a++) {
        const ang = this.spinGroup.rotation.y + (a / 8) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const tangentVel = new THREE.Vector3(-sa * 22 + ca * 10, 5, ca * 22 + sa * 10);
        for (const r of [1.8, 3.1, 4.3]) {
          const pt = new THREE.Vector3(center.x + ca * r, center.y + (a % 2 === 0 ? 0.1 : -0.4), center.z + sa * r);
          this.vw.sweepCut(pt, 0.95, tangentVel);
        }
      }
      if (onScreenShake) onScreenShake(0.16);
    }

    if (this.spinT >= SPIN_DURATION) {
      this.spinT = -1;
      this.spinGroup.visible = false;
      if (this.state === 'idle') this._setStatus('DURUM: KOL HAZIR [SOL TIK / R: KANCA]');
    }
  }

  // ───────────────────────── Q Tuşu: Dev Ahtapot Zıplaması (Zıpla - İn) ─────────────────────────
  superJump(character, camera) {
    if (!this.active || !character) return;
    sound.playOctopusJump();

    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-4) fwd.normalize();

    character.vel.y = 27.5;
    character.isGrounded = false;
    character.usedJet = false;
    character.applyKnock(fwd.x * 14, 0, fwd.z * 14);

    if (this.ps && this.ps.createExplosion) {
      const feet = character.mesh.position.clone();
      feet.y += 0.2;
      this.ps.createExplosion(feet, 1.4, 0xa855f7);
    }
  }

  // ───────────────────────── R Tuşu: İki Kolu Kanca Gibi Atarak Hedefe Çekme ─────────────────────────
  startDualGrapple(character, onScreenShake) {
    if (!this.active || !character) return false;

    // Eğer zaten kanca ile çekiliyorsa tekrar R'ye basınca kancayı bırak
    if (this.state === 'grapple_shoot' || this.state === 'grapple_pull') {
      this._startRetract();
      return true;
    }

    this._resetTentacle();
    sound.playTentacleShoot();

    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    const MAX_GRAPPLE_RANGE = 88;
    const step = VOXEL_SIZE * 0.45;
    const p = new THREE.Vector3();
    let hit = null;

    for (let d = 1.2; d <= MAX_GRAPPLE_RANGE; d += step) {
      p.copy(cam.position).addScaledVector(dir, d);
      const ix = Math.round(p.x / VOXEL_SIZE);
      const iy = Math.round((p.y - VOXEL_SIZE / 2) / VOXEL_SIZE);
      const iz = Math.round(p.z / VOXEL_SIZE);
      const v = this.vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active) {
        hit = p.clone();
        break;
      }
      const gy = this.vw.terrain.topYAt(p.x, p.z);
      if (p.y <= gy && this.vw.terrain.topIntactAt(p.x, p.z)) {
        hit = new THREE.Vector3(p.x, gy + 0.3, p.z);
        break;
      }
    }

    // Eğer açık havaya veya çok uzağa nişan alındıysa da baktığı yönde 45m ileriye kanca atıp çeksin
    if (!hit) {
      hit = cam.position.clone().addScaledVector(dir, 45);
      const gy = this.vw.terrain.topYAt(hit.x, hit.z);
      if (gy > -Infinity && hit.y < gy + 0.5) hit.y = gy + 0.5;
    }

    this.grappleTarget.copy(hit);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() > 1e-4) right.normalize(); else right.set(1, 0, 0);

    this.grappleLeftTarget.copy(hit).addScaledVector(right, -0.45);
    this.grappleRightTarget.copy(hit).addScaledVector(right, 0.45);

    this.launchOrigin.copy(this._getHandWorldPos());
    this.launchDir.copy(dir);
    this.currentDist = 1.0;
    this.targetDist = Math.max(2.0, cam.position.distanceTo(hit));
    this.state = 'grapple_shoot';
    this.stateT = 0;
    this.grappleBlockedTime = 0;

    this.worldGroup.visible = true;
    this.leftWorldGroup.visible = true;
    if (onScreenShake) onScreenShake(0.12);
    this._setStatus('İKİ KOL KANCA OLARAK FIRLATILDI...');
    return true;
  }

  // ───────────────────────── Fare Hareketi: Binayı Yerinden Söküp Kaldırma & İnsanı Havada Sallama ─────────────────────────
  onMouseMove(movementX, movementY) {
    if (!this.active) return;
    const moveMag = Math.hypot(movementX, movementY);
    this.mouseVelX = movementX;
    this.mouseVelY = movementY;

    // Binayı sarmış durumdayken fare kaydırılırsa binayı yerinden söküp havaya kaldırır!
    if (this.state === 'wrapped') {
      this.mouseSlideDist += moveMag;
      if (this.mouseSlideDist > 22) {
        this._uprootBuildingForHold();
      }
    }
  }

  // ───────────────────────── Sol Tık: Dokunaç At / İnsan Tut / Tutulan Binayı veya İnsanı Fırlat! ─────────────────────────
  onLeftClick(onScreenShake) {
    if (!this.active) return false;

    // 1) Eğer şu an bir İNSANI (NPC) havada tutuyorsak: sol tıkla baktığımız yöne hızla FIRLAT!
    if (this.state === 'holding_npc' && this.grabbedNpc) {
      sound.playOctopusThrow();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const npc = this.grabbedNpc;
      npc.grabbed = false;
      npc.thrownVel = dir.multiplyScalar(38).add(this.aimSwingVel.clone().multiplyScalar(0.6));
      npc.thrownVel.y += 6.5;
      this.grabbedNpc = null;
      if (onScreenShake) onScreenShake(0.22);
      this._startRetract();
      this._setStatus('İNSAN FIRLATILDI!');
      return true;
    }

    // 2) Eğer şu an yerinden söktüğümüz bir BİNAYI havada tutuyorsak: sol tıkla binayı baktığımız yere FIRLAT!
    if (this.state === 'holding_building' && this.heldChunk) {
      sound.playOctopusThrow();
      sound.playExplosion(1.1);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const throwVel = dir.multiplyScalar(34).add(this.aimSwingVel.clone().multiplyScalar(0.5));
      throwVel.y = Math.max(5.5, throwVel.y + 6.0);
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4 - dir.z * 0.8,
        (Math.random() - 0.5) * 1.0,
        (Math.random() - 0.5) * 1.4 + dir.x * 0.8
      );
      this.vw.collapse.throwChunk(this.heldChunk, throwVel, angVel);
      this.heldChunk = null;
      if (onScreenShake) onScreenShake(0.45);
      this._startRetract();
      this._setStatus('BİNA FIRLATILDI!');
      return true;
    }

    // 3) Eğer bina sarılıysa ama henüz sökülmediyse: sol tık binayı hemen yerinden söküp havaya kaldırır (veya zaten uzamaktaysa geri çeker)
    if (this.state === 'wrapped') {
      this._uprootBuildingForHold();
      return true;
    }
    if (this.state !== 'idle') {
      this._startRetract();
      return true;
    }

    // 4) Boştayken Sol Tık: Dokunacı ileri fırlat (önce insan var mı bak, yoksa binayı sar)
    sound.playTentacleShoot();
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.lastAimDir.copy(dir);
    this.aimSwingVel.set(0, 0, 0);

    this.launchOrigin.copy(this._getHandWorldPos());
    this.launchDir.copy(dir);
    this.currentDist = 0.5;
    this.state = 'extending';
    this.stateT = 0;
    this.hitPoint = null;
    this.wrapBox = null;
    this.grabbedNpc = null;
    this.heldChunk = null;
    this.mouseSlideDist = 0;

    // A) Işın boyunca bina küpü (voxel) ara
    const step = VOXEL_SIZE * 0.45;
    const p = new THREE.Vector3();
    let hit = null, hitVoxel = null, voxelDist = MAX_TENTACLE_RANGE;
    for (let d = 0.8; d <= MAX_TENTACLE_RANGE; d += step) {
      p.copy(cam.position).addScaledVector(dir, d);
      const ix = Math.round(p.x / VOXEL_SIZE);
      const iy = Math.round((p.y - VOXEL_SIZE / 2) / VOXEL_SIZE);
      const iz = Math.round(p.z / VOXEL_SIZE);
      const v = this.vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active && v.groundCell === undefined) {
        hit = p.clone();
        hitVoxel = v;
        voxelDist = d;
        break;
      }
      const gy = this.vw.terrain.topYAt(p.x, p.z);
      if (p.y <= gy && this.vw.terrain.topIntactAt(p.x, p.z)) {
        voxelDist = d;
        break;
      }
    }

    // B) Işın üzerinde bir İNSAN (NPC) var mı?
    if (this.hw.npcs) {
      const nh = this.hw.npcs.rayHit(cam.position, dir, voxelDist + 0.5, 1.25);
      if (nh && nh.npc) {
        this.grabbedNpc = nh.npc;
        this.targetDist = nh.dist;
        this.holdDist = THREE.MathUtils.clamp(nh.dist, 4.5, 22);
        this.hitPoint = nh.point.clone();
        this.worldGroup.visible = true;
        this._setStatus('İNSAN YAKALANIYOR...');
        return true;
      }
    }

    if (hit && hitVoxel) {
      this.hitPoint = hit;
      this.targetDist = this.launchOrigin.distanceTo(hit);
      this.wrapBox = this._measureBuildingSlice(hitVoxel);
      this.wrapLocalPts = this._buildWrapPoints(this.wrapBox, hit);
    } else {
      this.targetDist = Math.min(voxelDist, MAX_TENTACLE_RANGE);
    }

    this.worldGroup.visible = true;
    this._setStatus('DOKUNAÇ FIRLATILDI...');
    return true;
  }

  // Çarpılan noktadaki binanın yatay kesitini (minX..maxX, minZ..maxZ) bulur
  _measureBuildingSlice(startVoxel) {
    const S = VOXEL_SIZE;
    const vox = this.vw.voxels;
    const visited = new Set();
    const queue = [startVoxel];
    visited.add(`${startVoxel.ix},${startVoxel.iy},${startVoxel.iz}`);

    let minX = startVoxel.x, maxX = startVoxel.x;
    let minZ = startVoxel.z, maxZ = startVoxel.z;

    const maxSpan = 20;
    while (queue.length > 0 && visited.size < 4500) {
      const v = queue.pop();
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;

      const neighbors = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [0, 1, 0], [0, -1, 0]
      ];
      for (const [dx, dy, dz] of neighbors) {
        const nx = v.ix + dx, ny = v.iy + dy, nz = v.iz + dz;
        if (Math.abs(ny - startVoxel.iy) > 4) continue;
        if (Math.abs(nx * S - startVoxel.x) > maxSpan || Math.abs(nz * S - startVoxel.z) > maxSpan) continue;
        const k = `${nx},${ny},${nz}`;
        if (visited.has(k)) continue;
        const nv = vox.get(k);
        if (!nv || !nv.active || nv.groundCell !== undefined) continue;
        visited.add(k);
        queue.push(nv);
      }
    }

    if (maxX - minX < 1.8) { minX -= 0.9; maxX += 0.9; }
    if (maxZ - minZ < 1.8) { minZ -= 0.9; maxZ += 0.9; }

    return {
      minX, maxX, minZ, maxZ,
      baseY: startVoxel.y,
      cx: (minX + maxX) * 0.5,
      cz: (minZ + maxZ) * 0.5
    };
  }

  // Binanın dış cephesi etrafında dönen ince kol sarmal noktaları üretir
  _buildWrapPoints(box, hitPos) {
    const pad = 0.28;
    const x0 = box.minX - pad, x1 = box.maxX + pad;
    const z0 = box.minZ - pad, z1 = box.maxZ + pad;
    const cx = box.cx, cz = box.cz;
    const rx = (x1 - x0) * 0.5, rz = (z1 - z0) * 0.5;

    const startAngle = Math.atan2(hitPos.z - cz, hitPos.x - cx);
    const totalSteps = 32;
    const pts = [hitPos.clone()];

    for (let i = 1; i <= totalSteps; i++) {
      const u = i / totalSteps;
      const ang = startAngle + u * Math.PI * 2 * WRAP_TURNS;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const scale = 1 / Math.max(Math.abs(ca), Math.abs(sa), 0.72);
      const px = cx + ca * rx * Math.min(1.18, scale * 0.92);
      const pz = cz + sa * rz * Math.min(1.18, scale * 0.92);
      const py = hitPos.y + Math.sin(u * Math.PI) * 0.35 - u * 0.45;
      pts.push(new THREE.Vector3(px, py, pz));
    }
    return pts;
  }

  // ───────────────────────── Binayı Yerinden Söküp Havaya Kaldırma (Fareyi Kaydırınca) ─────────────────────────
  _uprootBuildingForHold() {
    if (!this.wrapBox || !this.vw.collapse) return;
    const box = this.wrapBox;
    const S = VOXEL_SIZE;
    const vox = this.vw.voxels;

    // Binanın sarılan bölgesinde sağlam bir tohum küp bul
    let seed = null;
    const cIx = Math.round(box.cx / S), cIz = Math.round(box.cz / S);
    const startIy = Math.max(1, Math.round(box.baseY / S));
    for (let dy = -4; dy <= 16 && !seed; dy++) {
      for (let dx = -10; dx <= 10 && !seed; dx++) {
        for (let dz = -10; dz <= 10 && !seed; dz++) {
          const v = vox.get(`${cIx + dx},${startIy + dy},${cIz + dz}`);
          if (v && v.active && v.groundCell === undefined) seed = v;
        }
      }
    }
    if (!seed) return;

    // Binanın tüm küplerini (temelden çatıya kadar) topla ve yerinden sök!
    const visited = new Map();
    const stack = [seed];
    visited.set(`${seed.ix},${seed.iy},${seed.iz}`, seed);
    const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const groundY = Math.max(0, this.vw.terrain.heightAt(box.cx, box.cz));

    while (stack.length > 0 && visited.size < 55000) {
      const v = stack.pop();
      for (const [dx, dy, dz] of DIRS) {
        const nx = v.ix + dx, ny = v.iy + dy, nz = v.iz + dz;
        if (nx * S < box.minX - 6 || nx * S > box.maxX + 6 || nz * S < box.minZ - 6 || nz * S > box.maxZ + 6) continue;
        if (ny * S < groundY - 0.2) continue;
        const k = `${nx},${ny},${nz}`;
        if (visited.has(k)) continue;
        const nv = vox.get(k);
        if (!nv || !nv.active || nv.groundCell !== undefined) continue;
        visited.set(k, nv);
        stack.push(nv);
      }
    }

    const list = Array.from(visited.values());
    if (list.length < 15) return;

    sound.playTentaclePull();
    sound.playBridgeCreak && sound.playBridgeCreak();

    const chunk = this.vw.collapse.spawnChunk(list, { held: true });
    if (!chunk) return;

    this.heldChunk = chunk;
    this.state = 'holding_building';
    this.stateT = 0;

    // Binanın sarılan noktasının kamera uzaklığını kaydet ki fareyi oynattıkça o mesafede havaya kalksın
    const anchor = new THREE.Vector3(box.cx, box.baseY, box.cz);
    this.buildingHoldDist = THREE.MathUtils.clamp(this.camera.position.distanceTo(anchor), 10, 38);
    this.buildingBaseCom.copy(chunk.com);
    this.buildingAnchorOffset.copy(anchor).sub(chunk.com);

    if (this.ps && this.ps.createExplosion) {
      this.ps.createExplosion(new THREE.Vector3(box.cx, groundY + 0.5, box.cz), 2.2, 0x9c9484);
    }
    this._setStatus('BİNA YERİNDEN SÖKÜLDÜ! [FARE: SALLA | SOL TIK: FIRLAT]');
  }

  // ───────────────────────── Sağ Tık: Sarılan Binayı Çek / Altını Kır ─────────────────────────
  onRightClick(onScreenShake) {
    if (!this.active) return false;
    if (this.state === 'idle') return false;

    if (this.state === 'holding_npc' && this.grabbedNpc) {
      const npc = this.grabbedNpc;
      npc.grabbed = false;
      npc.thrownVel = new THREE.Vector3(0, -32, 0);
      this.grabbedNpc = null;
      this._startRetract();
      return true;
    }

    if (this.state === 'holding_building' && this.heldChunk) {
      const toPlayer = this.camera.position.clone().sub(this.heldChunk.com).normalize();
      this.vw.collapse.throwChunk(this.heldChunk, toPlayer.multiplyScalar(22).add(new THREE.Vector3(0, -8, 0)));
      this.heldChunk = null;
      sound.playTentaclePull();
      if (onScreenShake) onScreenShake(0.35);
      this._startRetract();
      return true;
    }

    if (this.state === 'wrapped' || this.state === 'wrapping') {
      this._executeBuildingPull(onScreenShake);
      return true;
    }

    this._startRetract();
    return true;
  }

  _startRetract() {
    this.pullStartPts = this._currentTentaclePoints();
    if (this.leftWorldGroup && this.leftWorldGroup.visible) {
      this.leftPullStartPts = this._currentLeftTentaclePoints();
    } else {
      this.leftPullStartPts = [];
    }
    this.state = 'retracting';
    this.stateT = 0;
    this._setStatus('KOL GERİ ÇEKİLİYOR...');
  }

  // Binanın sarılan kısmını kesip Teardown fiziğiyle oyuncuya doğru devirir
  _executeBuildingPull(onScreenShake) {
    sound.playTentaclePull();
    sound.playExplosion(0.95);
    if (onScreenShake) onScreenShake(0.35);

    const box = this.wrapBox;
    const playerPos = this.camera.position.clone();
    if (box) {
      const toPlayer = new THREE.Vector3(playerPos.x - box.cx, 0, playerPos.z - box.cz);
      if (toPlayer.lengthSq() < 1e-4) toPlayer.set(0, 0, 1);
      toPlayer.normalize();

      const pullVel = new THREE.Vector3(toPlayer.x * 16, 3.0, toPlayer.z * 16);

      // Sadece kolun sardığı hattı ve oyuncuya bakan alt kesiti kır (binayı komple patlatmaz!)
      let cutCount = 0;
      for (const pt of this.wrapLocalPts) {
        cutCount += this.vw.sweepCut(pt, 0.95, pullVel);
      }

      const groundH = Math.max(0, this.vw.terrain.heightAt(box.cx, box.cz));
      const cutY = Math.max(groundH + VOXEL_SIZE * 0.5, Math.min(box.baseY, groundH + 2.2));
      for (let x = box.minX; x <= box.maxX; x += 1.4) {
        for (let z = box.minZ; z <= box.maxZ; z += 1.4) {
          const dot = (x - box.cx) * toPlayer.x + (z - box.cz) * toPlayer.z;
          if (dot >= -0.4) {
            cutCount += this.vw.sweepCut(new THREE.Vector3(x, cutY, z), 0.95, pullVel);
          }
        }
      }

      this._tipBuildingTowardPlayer(box, toPlayer);

      if (this.ps && this.ps.createExplosion) {
        this.ps.createExplosion(new THREE.Vector3(box.cx, box.baseY, box.cz), 2.2, 0xa855f7);
      }
      if (this.hw.onScore && cutCount > 0) {
        const pts = Math.max(150, Math.round(cutCount * 3));
        this.hw.onScore(pts, `+${pts} AHTAPOT YIKIMI!`);
      }
    }

    this.state = 'pulling';
    this.stateT = 0;
    this.pullStartPts = this._currentTentaclePoints();
    this._setStatus('BİNA ÇEKİLDİ!');
  }

  _tipBuildingTowardPlayer(box, toPlayer) {
    if (!this.vw.collapse) return;
    const S = VOXEL_SIZE;
    const vox = this.vw.voxels;

    let seed = null;
    const cIx = Math.round(box.cx / S), cIz = Math.round(box.cz / S);
    const startIy = Math.max(1, Math.round(box.baseY / S));
    for (let dy = 0; dy <= 16 && !seed; dy++) {
      for (let dx = -8; dx <= 8 && !seed; dx++) {
        for (let dz = -8; dz <= 8 && !seed; dz++) {
          const v = vox.get(`${cIx + dx},${startIy + dy},${cIz + dz}`);
          if (v && v.active && v.groundCell === undefined) seed = v;
        }
      }
    }

    if (seed) {
      const visited = new Map();
      const stack = [seed];
      visited.set(`${seed.ix},${seed.iy},${seed.iz}`, seed);
      const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      let minBy = Infinity;

      while (stack.length > 0 && visited.size < 55000) {
        const v = stack.pop();
        if (v.y - S / 2 < minBy) minBy = v.y - S / 2;
        for (const [dx, dy, dz] of DIRS) {
          const nx = v.ix + dx, ny = v.iy + dy, nz = v.iz + dz;
          if (nx * S < box.minX - 6 || nx * S > box.maxX + 6 || nz * S < box.minZ - 6 || nz * S > box.maxZ + 6) continue;
          const k = `${nx},${ny},${nz}`;
          if (visited.has(k)) continue;
          const nv = vox.get(k);
          if (!nv || !nv.active || nv.groundCell !== undefined) continue;
          visited.set(k, nv);
          stack.push(nv);
        }
      }

      const list = Array.from(visited.values());
      if (list.length >= 25) {
        const pivotX = box.cx + toPlayer.x * ((box.maxX - box.minX) * 0.45);
        const pivotZ = box.cz + toPlayer.z * ((box.maxZ - box.minZ) * 0.45);
        const chunk = this.vw.collapse.spawnChunk(list, {
          tip: {
            dx: toPlayer.x,
            dz: toPlayer.z,
            px: pivotX,
            py: Number.isFinite(minBy) ? minBy : 0,
            pz: pivotZ
          },
          creak: 0
        });
        if (chunk) {
          chunk.omega = 0.18;
        }
        return;
      }
    }

    for (const c of this.vw.collapse.chunks) {
      if (Math.hypot(c.com.x - box.cx, c.com.z - box.cz) < 18) {
        this.vw.collapse._beginTip(c, {
          dx: toPlayer.x,
          dz: toPlayer.z,
          px: c.com.x + toPlayer.x * 2,
          py: c.lowBy,
          pz: c.com.z + toPlayer.z * 2
        }, 0.04, 0.22);
      }
    }
  }

  _getHandWorldPos() {
    return this.hw._handWorld({ x: 0.36, y: -0.24, z: -0.55 });
  }

  _getLeftHandWorldPos() {
    return this.hw._handWorld({ x: -0.36, y: -0.24, z: -0.55 });
  }

  // R tuşu çift kanca modunda sol kolun omurga noktalarını üretir
  _currentLeftTentaclePoints() {
    const start = this._getLeftHandWorldPos();
    const pts = [];

    if (this.state === 'grapple_shoot') {
      const ratio = Math.min(1, this.currentDist / Math.max(0.1, this.targetDist));
      const end = new THREE.Vector3().lerpVectors(start, this.grappleLeftTarget, ratio);
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, end, u);
        p.y += Math.sin(u * Math.PI * 3 - this.stateT * 32) * 0.18 * Math.sin(u * Math.PI);
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'grapple_pull') {
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, this.grappleLeftTarget, u);
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'retracting' && this.leftPullStartPts.length > 1) {
      const dur = 0.28;
      const u = Math.min(1, this.stateT / dur);
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const idx = Math.min(this.leftPullStartPts.length - 1, Math.round((i / WORLD_SEGS) * (this.leftPullStartPts.length - 1)));
        const p = new THREE.Vector3().lerpVectors(this.leftPullStartPts[idx], start, u);
        pts.push(p);
      }
      return pts;
    }

    return [start, start];
  }

  // O anki duruma göre dünya uzayındaki ince sağ ahtapot kolunun omurga noktalarını üretir
  _currentTentaclePoints() {
    const start = this._getHandWorldPos();
    const pts = [];

    if (this.state === 'grapple_shoot') {
      const ratio = Math.min(1, this.currentDist / Math.max(0.1, this.targetDist));
      const end = new THREE.Vector3().lerpVectors(start, this.grappleRightTarget, ratio);
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, end, u);
        p.y += Math.sin(u * Math.PI * 3 - this.stateT * 32 + 0.8) * 0.18 * Math.sin(u * Math.PI);
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'grapple_pull') {
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, this.grappleRightTarget, u);
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'extending') {
      const end = start.clone().addScaledVector(this.launchDir, this.currentDist);
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, end, u);
        const wave = Math.sin(u * Math.PI * 3 - this.stateT * 28) * 0.22 * Math.sin(u * Math.PI);
        p.y += wave;
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'holding_npc' && this.grabbedNpc) {
      const npc = this.grabbedNpc;
      const center = new THREE.Vector3(npc.x, npc.y + 1.15, npc.z);
      const straightSegs = 36;
      const coilSegs = WORLD_SEGS - straightSegs;

      // Oyuncunun elinden insana uzanan ince kol
      for (let i = 0; i <= straightSegs; i++) {
        const u = i / straightSegs;
        const p = new THREE.Vector3().lerpVectors(start, center, u);
        p.y += Math.sin(u * Math.PI) * 0.18;
        pts.push(p);
      }
      // İnsanın belini saran ince kol ucu
      for (let i = 1; i <= coilSegs; i++) {
        const u = i / coilSegs;
        const ang = u * Math.PI * 2 * 1.2;
        const r = 0.32 * (1 - u * 0.15);
        pts.push(new THREE.Vector3(
          center.x + Math.cos(ang) * r,
          center.y - 0.15 + u * 0.35,
          center.z + Math.sin(ang) * r
        ));
      }
      return pts;
    }

    if (this.state === 'wrapping' || this.state === 'wrapped' || this.state === 'holding_building') {
      const wrapU = this.state === 'wrapping' ? Math.min(1, this.stateT / WRAP_DURATION) : 1.0;
      const offset = (this.state === 'holding_building' && this.heldChunk) ? this.heldChunk.holdOffset : new THREE.Vector3();
      const quat = (this.state === 'holding_building' && this.heldChunk) ? this.heldChunk.holdQuat : null;
      const com = this.buildingBaseCom;

      const transformPt = (pt) => {
        const out = pt.clone();
        if (quat) {
          out.sub(com).applyQuaternion(quat).add(com);
        }
        out.add(offset);
        return out;
      };

      const hit = transformPt(this.wrapLocalPts[0] || this.hitPoint);
      const straightSegs = 14;
      const coilSegs = WORLD_SEGS - straightSegs;

      // 1) Oyuncunun elinden binaya kadar uzanan ince hat
      for (let i = 0; i <= straightSegs; i++) {
        const u = i / straightSegs;
        const p = new THREE.Vector3().lerpVectors(start, hit, u);
        if (this.state === 'wrapping') {
          p.y += Math.sin(u * Math.PI) * Math.sin(this.stateT * 18) * 0.12;
        }
        pts.push(p);
      }

      // 2) Binanın etrafını saran ince kol kısmı
      const maxIdx = Math.max(1, (this.wrapLocalPts.length - 1) * wrapU);
      for (let i = 1; i <= coilSegs; i++) {
        const cu = (i / coilSegs) * maxIdx;
        const idx0 = Math.floor(cu);
        const idx1 = Math.min(this.wrapLocalPts.length - 1, idx0 + 1);
        const frac = cu - idx0;
        const p = new THREE.Vector3().lerpVectors(this.wrapLocalPts[idx0], this.wrapLocalPts[idx1], frac);
        pts.push(transformPt(p));
      }
      return pts;
    }

    if (this.state === 'pulling' || this.state === 'retracting') {
      const dur = this.state === 'pulling' ? 0.34 : 0.28;
      const u = Math.min(1, this.stateT / dur);
      const basePts = this.pullStartPts.length > 1 ? this.pullStartPts : [start, start];
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const idx = Math.min(basePts.length - 1, Math.round((i / WORLD_SEGS) * (basePts.length - 1)));
        const p = new THREE.Vector3().lerpVectors(basePts[idx], start, u);
        pts.push(p);
      }
      return pts;
    }

    return [start, start];
  }

  // ───────────────────────── Her Karede Güncelleme ─────────────────────────
  update(dt, ctx) {
    if (!this.active) return;

    this.animTime += dt;
    const t = this.animTime;

    // Bakış yönü değişim hızı (fırlatma ivmesi için)
    const curAim = new THREE.Vector3();
    this.camera.getWorldDirection(curAim);
    if (dt > 1e-4) {
      const instVel = curAim.clone().sub(this.lastAimDir).divideScalar(dt).multiplyScalar(14);
      this.aimSwingVel.lerp(instVel, Math.min(1, dt * 12));
    }
    this.lastAimDir.copy(curAim);

    // E tuşu topaç dönüşü güncellemesi
    this._updateTopacSpin(dt, ctx && ctx.character, ctx && ctx.onYawDelta, ctx && ctx.onScreenShake);

    // 1) Birinci şahıs ahtapot kolları ve yüzgeçlerin ÇOK HAFİF yukarı-aşağı animasyonu
    const gentleY = Math.sin(t * 2.1) * 0.0085;
    const gentleY2 = Math.sin(t * 2.1 + 0.9) * 0.0085;
    const finWave = Math.sin(t * 2.6) * 0.025;

    const isDualGrapple = this.state === 'grapple_shoot' || this.state === 'grapple_pull' || (this.state === 'retracting' && this.leftPullStartPts.length > 1);
    const leftOut = isDualGrapple ? 0.14 : 0;
    this.leftArmFP.group.position.set(-0.36, -0.26 + gentleY, -0.36 - leftOut);
    this.leftArmFP.finPivot.rotation.z = 0.22 + finWave;

    const rightOut = this.state !== 'idle' ? 0.14 : 0;
    this.rightArmFP.group.position.set(0.36, -0.26 + gentleY2, -0.36 - rightOut);
    this.rightArmFP.finPivot.rotation.z = -0.22 - finWave;

    // 2) Fırlatılan / Saran / Tutan / Kanca Kolunun Durum Makinesi
    if (this.state === 'idle') return;

    this.stateT += dt;

    if (this.state === 'grapple_shoot') {
      this.currentDist += EXTEND_SPEED * 1.45 * dt;
      if (this.currentDist >= this.targetDist) {
        this.currentDist = this.targetDist;
        this.state = 'grapple_pull';
        this.stateT = 0;
        this.grappleBlockedTime = 0;
        sound.playTentacleWrap();
        sound.playTentaclePull();
        this._setStatus('İKİ KOL TUTUNDU! HEDEFE ÇEKİLİYORSUN...');
      }
    } else if (this.state === 'grapple_pull') {
      const character = ctx && ctx.character;
      if (!character) {
        this._startRetract();
      } else {
        const pPos = character.body.position;
        const target = this.grappleTarget;
        const toTarget = new THREE.Vector3(
          target.x - pPos.x,
          (target.y + 0.65) - pPos.y,
          target.z - pPos.z
        );
        const dist = toTarget.length();

        if (character.blockedHoriz) {
          this.grappleBlockedTime += dt;
        } else {
          this.grappleBlockedTime = Math.max(0, this.grappleBlockedTime - dt * 0.5);
        }

        if (dist <= 2.35 || this.stateT >= 1.35 || this.grappleBlockedTime >= 0.24) {
          // Hedefe ulaştı: çatıya veya çıkıntıya rahatça çıkabilmesi için hafif yukarı ivme bırak
          character.vel.y = Math.max(character.vel.y, 6.5);
          character.knock.multiplyScalar(0.2);
          this._startRetract();
          this._setStatus('HEDEFE ULAŞILDI!');
        } else {
          toTarget.divideScalar(dist);
          const PULL_SPEED = 38;
          // Yatay çekiş knock üzerinden verilir ki W/A/S/D basılı değilken sönümlenmesin
          character.knock.set(toTarget.x * PULL_SPEED, 0, toTarget.z * PULL_SPEED);
          character.vel.y = toTarget.y * PULL_SPEED + (character.blockedHoriz ? 13.0 : 3.2);
          character.isGrounded = false;
          character.usedJet = false;
        }
      }
    } else if (this.state === 'extending') {
      this.currentDist += EXTEND_SPEED * dt;
      if (this.currentDist >= this.targetDist) {
        this.currentDist = this.targetDist;
        if (this.grabbedNpc) {
          this.state = 'holding_npc';
          this.stateT = 0;
          this.grabbedNpc.grabbed = true;
          sound.playTentacleWrap();
          this._setStatus('İNSAN TUTULDU! [FARE: HAVAYA KALDIR | SOL TIK: FIRLAT]');
        } else if (this.hitPoint && this.wrapBox) {
          this.state = 'wrapping';
          this.stateT = 0;
          sound.playTentacleWrap();
          this._setStatus('BİNA SARILIYOR...');
        } else {
          this._startRetract();
        }
      }
    } else if (this.state === 'wrapping') {
      if (this.stateT >= WRAP_DURATION) {
        this.state = 'wrapped';
        this.stateT = 0;
        this.mouseSlideDist = 0;
        this._setStatus('BİNA SARILDI! [FARE KAYDIR: YERİNDEN SÖK | SAĞ TIK: ÇEK]');
      }
    } else if (this.state === 'holding_npc') {
      if (!this.grabbedNpc || !this.hw.npcs || !this.hw.npcs.npcs.includes(this.grabbedNpc)) {
        this.grabbedNpc = null;
        this._startRetract();
      } else {
        const target = this.camera.position.clone().addScaledVector(curAim, this.holdDist);
        const gy = this.vw.terrain.topYAt(target.x, target.z);
        if (gy > -Infinity) target.y = Math.max(gy + 0.5, target.y);
        this.grabbedNpc.x += (target.x - this.grabbedNpc.x) * Math.min(1, dt * 14);
        this.grabbedNpc.y += (target.y - this.grabbedNpc.y) * Math.min(1, dt * 14);
        this.grabbedNpc.z += (target.z - this.grabbedNpc.z) * Math.min(1, dt * 14);
      }
    } else if (this.state === 'holding_building') {
      if (!this.heldChunk || this.heldChunk.settled) {
        this.heldChunk = null;
        this._startRetract();
      } else {
        const targetAnchor = this.camera.position.clone().addScaledVector(curAim, this.buildingHoldDist);
        targetAnchor.y = Math.max(this.buildingBaseCom.y + 3.5, targetAnchor.y + 3.0);
        const desiredCom = targetAnchor.sub(this.buildingAnchorOffset);
        const desiredOffset = desiredCom.sub(this.buildingBaseCom);
        desiredOffset.y = Math.max(2.5, desiredOffset.y);

        this.heldChunk.holdOffset.lerp(desiredOffset, Math.min(1, dt * 8));

        const tiltX = THREE.MathUtils.clamp(-this.aimSwingVel.z * 0.018, -0.32, 0.32);
        const tiltZ = THREE.MathUtils.clamp(this.aimSwingVel.x * 0.018, -0.32, 0.32);
        const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
        this.heldChunk.holdQuat.slerp(targetQ, Math.min(1, dt * 8));
        this.vw.collapse._pose(this.heldChunk);
      }
    } else if (this.state === 'pulling' || this.state === 'retracting') {
      const dur = this.state === 'pulling' ? 0.34 : 0.28;
      if (this.stateT >= dur) {
        this._resetTentacle();
        return;
      }
    }

    // 3) Dünya sahnesindeki sağ ince kol boğumlarını omurga noktalarına yerleştir
    const pts = this._currentTentaclePoints();
    for (let i = 0; i < WORLD_SEGS; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1] || p0;
      const seg = this.worldSegs[i];
      seg.group.position.copy(p0).add(p1).multiplyScalar(0.5);
      const len = p0.distanceTo(p1);
      const taper = 1 - (i / WORLD_SEGS) * 0.55;
      seg.group.scale.set(taper, taper, Math.max(0.05, len + 0.08));
      seg.group.lookAt(p1);
    }

    // 4) Eğer R tuşu (çift kol kanca) aktifse sol ince kol boğumlarını da yerleştir
    if (this.leftWorldGroup && this.leftWorldGroup.visible) {
      const lPts = this._currentLeftTentaclePoints();
      for (let i = 0; i < WORLD_SEGS; i++) {
        const p0 = lPts[i];
        const p1 = lPts[i + 1] || p0;
        const seg = this.leftWorldSegs[i];
        seg.group.position.copy(p0).add(p1).multiplyScalar(0.5);
        const len = p0.distanceTo(p1);
        const taper = 1 - (i / WORLD_SEGS) * 0.55;
        seg.group.scale.set(taper, taper, Math.max(0.05, len + 0.08));
        seg.group.lookAt(p1);
      }
    }
  }
}
