import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// AHTAPOT SİLAHI VE DÖNÜŞÜM SİSTEMİ (Silah Kimliği: 16 — T Tuşu / Son Silah)
//  - Silah seçildiğinde ekrana dev bir ahtapot atlar, ekran kararır ve "vıcık vıcık"
//    seslerle yavaşça eriyerek kaybolur.
//  - Ekranın kenarları mor bir hale (vignette) alır.
//  - Birinci şahısta çekiç veya silah görünmez; yalnızca iki yanda ahtapot kolları
//    ve yüzgeçler görünür, çok hafif yukarı-aşağı salınır.
//  - Ekranın sol alt çaprazında ahtapot kontrolleri gösterilir.
//  - Sol tık: Ahtapot kolunu kanca gibi ileri fırlatır; binaya değerse etrafını
//    döne döne sarar ve durur.
//  - Sağ tık: Sarılan binayı güçlüce kendine doğru çeker, alt/sarılan kısmı kırar
//    ve binayı oyuncuya doğru devirir; ardından kol geri döner.
//  - Q tuşu: Her basışta jetpack gibi dev bir sıçrama yapar ve geri yere iner (zıpla-in).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TENTACLE_RANGE = 62;     // kolun uzanabileceği en fazla mesafe (m)
const EXTEND_SPEED = 88;           // kol fırlatma hızı (m/sn)
const RETRACT_SPEED = 75;          // kol geri çekilme hızı (m/sn)
const WRAP_DURATION = 0.82;        // binayı sarma süresi (sn)
const WRAP_TURNS = 2.25;           // binanın etrafında kaç tur saracağı
const WORLD_SEGS = 44;             // dünyadaki uzayan koldaki boğum sayısı

export class OctopusSystem {
  constructor(handWeapons) {
    this.hw = handWeapons;
    this.mainScene = handWeapons.mainScene;
    this.camera = handWeapons.camera;
    this.vw = handWeapons.voxelWorld;
    this.ps = handWeapons.particleSystem;

    this.active = false;
    this.animTime = 0;

    // Kanca / Sarma Durumu: 'idle' | 'extending' | 'wrapping' | 'wrapped' | 'pulling' | 'retracting'
    this.state = 'idle';
    this.stateT = 0;
    this.launchOrigin = new THREE.Vector3();
    this.launchDir = new THREE.Vector3();
    this.currentDist = 0;
    this.targetDist = 0;
    this.hitPoint = null;
    this.wrapBox = null;       // { minX, maxX, minZ, maxZ, baseY, topY, cx, cz }
    this.wrapLocalPts = [];    // binanın etrafındaki sarmal noktalar
    this.pullStartPts = [];

    this._buildUI();
    this._buildFirstPersonArms();
    this._buildWorldTentacle();
  }

  // ───────────────────────── Ekran Arayüzü (Jumpscare, Mor Kenar, Sol Alt Çapraz Kontroller) ─────────────────────────
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

      /* Ahtapot ekrana atlama ve kararma katmanı */
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
      }
      #octopus-scare .octo-wrap {
        width: min(78vw, 78vh);
        height: min(78vw, 78vh);
        transform: scale(0.15);
        filter: drop-shadow(0 0 40px rgba(168, 85, 247, 0.95));
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
        line-height: 1.75;
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

    // Mor kenar efekti
    this.vignetteEl = document.createElement('div');
    this.vignetteEl.id = 'octopus-vignette';
    document.body.appendChild(this.vignetteEl);

    // Ekrana atlayan dev ahtapot SVG katmanı
    this.scareEl = document.createElement('div');
    this.scareEl.id = 'octopus-scare';
    this.scareEl.innerHTML = `
      <div class="octo-wrap" id="octopus-scare-art">
        <svg viewBox="0 0 400 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="octoBodyGrad" cx="50%" cy="42%" r="55%">
              <stop offset="0%" stop-color="#c084fc"/>
              <stop offset="55%" stop-color="#7e22ce"/>
              <stop offset="100%" stop-color="#3b0764"/>
            </radialGradient>
          </defs>
          <!-- 8 Kıvrımlı Ahtapot Kolu ve Vantuzlar -->
          <g stroke="#6b21a8" stroke-width="22" stroke-linecap="round" fill="none">
            <path d="M170 210 C 90 150, 35 80, 18 25" />
            <path d="M230 210 C 310 150, 365 80, 382 25" />
            <path d="M155 225 C 65 210, 20 175, 8 135" />
            <path d="M245 225 C 335 210, 380 175, 392 135" />
            <path d="M160 245 C 75 275, 25 310, 14 365" />
            <path d="M240 245 C 325 275, 375 310, 386 365" />
            <path d="M185 255 C 140 320, 115 360, 95 392" />
            <path d="M215 255 C 260 320, 285 360, 305 392" />
          </g>
          <g stroke="#a855f7" stroke-width="12" stroke-linecap="round" fill="none">
            <path d="M170 210 C 90 150, 35 80, 18 25" />
            <path d="M230 210 C 310 150, 365 80, 382 25" />
            <path d="M155 225 C 65 210, 20 175, 8 135" />
            <path d="M245 225 C 335 210, 380 175, 392 135" />
            <path d="M160 245 C 75 275, 25 310, 14 365" />
            <path d="M240 245 C 325 275, 375 310, 386 365" />
            <path d="M185 255 C 140 320, 115 360, 95 392" />
            <path d="M215 255 C 260 320, 285 360, 305 392" />
          </g>
          <!-- Vantuzlar -->
          <g fill="#f5d0fe" stroke="#581c87" stroke-width="2">
            <circle cx="95" cy="135" r="8"/><circle cx="62" cy="95" r="7"/><circle cx="38" cy="58" r="6"/>
            <circle cx="305" cy="135" r="8"/><circle cx="338" cy="95" r="7"/><circle cx="362" cy="58" r="6"/>
            <circle cx="88" cy="205" r="8"/><circle cx="48" cy="182" r="7"/><circle cx="22" cy="155" r="6"/>
            <circle cx="312" cy="205" r="8"/><circle cx="352" cy="182" r="7"/><circle cx="378" cy="155" r="6"/>
            <circle cx="95" cy="278" r="8"/><circle cx="55" cy="312" r="7"/><circle cx="28" cy="345" r="6"/>
            <circle cx="305" cy="278" r="8"/><circle cx="345" cy="312" r="7"/><circle cx="372" cy="345" r="6"/>
            <circle cx="152" cy="312" r="8"/><circle cx="125" cy="352" r="7"/>
            <circle cx="248" cy="312" r="8"/><circle cx="275" cy="352" r="7"/>
          </g>
          <!-- Ahtapot Yan Yüzgeçleri -->
          <ellipse cx="122" cy="145" rx="34" ry="18" transform="rotate(-28 122 145)" fill="#9333ea" stroke="#4c1d95" stroke-width="4"/>
          <ellipse cx="278" cy="145" rx="34" ry="18" transform="rotate(28 278 145)" fill="#9333ea" stroke="#4c1d95" stroke-width="4"/>
          <!-- Ahtapot Baş / Gövde -->
          <ellipse cx="200" cy="165" rx="76" ry="88" fill="url(#octoBodyGrad)" stroke="#3b0764" stroke-width="6"/>
          <!-- Benekler -->
          <circle cx="170" cy="115" r="10" fill="#d8b4fe" opacity="0.45"/>
          <circle cx="228" cy="108" r="12" fill="#d8b4fe" opacity="0.45"/>
          <circle cx="200" cy="90" r="8" fill="#d8b4fe" opacity="0.4"/>
          <!-- Parlayan Gözler -->
          <ellipse cx="168" cy="185" rx="20" ry="24" fill="#fef08a" stroke="#1e1b4b" stroke-width="4"/>
          <ellipse cx="232" cy="185" rx="20" ry="24" fill="#fef08a" stroke="#1e1b4b" stroke-width="4"/>
          <rect x="156" y="181" width="24" height="8" rx="4" fill="#090d16"/>
          <rect x="220" y="181" width="24" height="8" rx="4" fill="#090d16"/>
          <!-- Ağız / Vantuzlu Merkez -->
          <circle cx="200" cy="222" r="14" fill="#2e1065" stroke="#c084fc" stroke-width="3"/>
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
      <div><span class="octo-key">SOL TIK</span> Kol At / Binayı Sar</div>
      <div><span class="octo-key">SAĞ TIK</span> Binayı Çek / Altını Kır</div>
      <div><span class="octo-key">Q</span> Dev Zıplama (Zıpla-İn)</div>
      <div><span class="octo-key">T</span> / <span class="octo-key">TAB</span> Silah Değiştir</div>
      <div class="octo-status" id="octopus-status">DURUM: KOL HAZIR</div>
    `;
    document.body.appendChild(this.hudEl);
    this.statusEl = document.getElementById('octopus-status');
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.innerText = text;
  }

  // Silah 16'ya geçildiğinde ekrana ahtapot atlama + kararma + vıcık vıcık kaybolma animasyonu
  _triggerJumpScare() {
    sound.playOctopusSquish();
    if (this._scareRaf) cancelAnimationFrame(this._scareRaf);
    const start = performance.now();
    const totalDur = 2400; // 2.4 sn

    this.scareEl.style.opacity = '1';
    const step = (now) => {
      if (!this.active) {
        this.scareEl.style.opacity = '0';
        return;
      }
      const elapsed = now - start;
      const u = Math.min(1, elapsed / totalDur);

      if (u < 0.14) {
        // 0..0.33 sn: Ahtapot ekrana hızla atlar ve ekran simsiyah kararır
        const k = u / 0.14;
        const scale = 0.15 + k * 1.18;
        this.scareArtEl.style.transform = `scale(${scale.toFixed(3)}) rotate(${(Math.sin(k * 12) * 6).toFixed(1)}deg)`;
        this.scareEl.style.background = `rgba(4, 0, 10, ${(k * 0.96).toFixed(3)})`;
        this.scareEl.style.opacity = '1';
      } else if (u < 0.36) {
        // 0.33..0.86 sn: Ekran karanlık, ahtapot ekrana yapışmış halde hafif vıcık vıcık titrer
        const w = (u - 0.14) / 0.22;
        const sx = 1.33 + Math.sin(w * Math.PI * 6) * 0.05;
        const sy = 1.33 + Math.cos(w * Math.PI * 6) * 0.05;
        this.scareArtEl.style.transform = `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        this.scareEl.style.background = `rgba(4, 0, 10, 0.96)`;
        this.scareEl.style.opacity = '1';
      } else {
        // 0.86..2.40 sn: Ahtapot vıcık vıcık seslerle aşağı doğru süzülüp eriyerek yok olur, karanlık açılır
        const f = (u - 0.36) / 0.64;
        const ease = 1 - Math.pow(1 - f, 2);
        const wobbleX = Math.sin(f * 20) * 10 * (1 - f);
        const slideY = ease * 180;
        const scaleX = 1.33 - ease * 0.35 + Math.sin(f * 25) * 0.03;
        const scaleY = 1.33 + ease * 0.25;
        this.scareArtEl.style.transform = `translate(${wobbleX.toFixed(1)}px, ${slideY.toFixed(1)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;
        this.scareEl.style.background = `rgba(4, 0, 10, ${(0.96 * (1 - ease)).toFixed(3)})`;
        this.scareEl.style.opacity = String((1 - ease).toFixed(3));
      }

      if (u < 1) {
        this._scareRaf = requestAnimationFrame(step);
      } else {
        this.scareEl.style.opacity = '0';
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
    const tipMat = new THREE.MeshLambertMaterial({ color: 0xa855f7 });       // parlak mor uç/üst
    const finMat = new THREE.MeshLambertMaterial({ color: 0x9333ea });       // yan yüzgeç rengi
    const finInnerMat = new THREE.MeshLambertMaterial({ color: 0xc084fc });  // yüzgeç iç zarı
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });    // açık pembe-mor vantuzlar

    const makeArmAndFin = (side) => {
      // side: -1 sol, +1 sağ
      const g = new THREE.Group();
      const armCurve = new THREE.Group();
      const segs = 11;
      for (let i = 0; i < segs; i++) {
        const u = i / (segs - 1);
        const w = 0.13 * (1 - u * 0.62);
        const h = 0.11 * (1 - u * 0.62);
        const d = 0.115;
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          i > segs - 4 ? tipMat : skinMat
        );
        // Kol hafif içe ve yukarı kıvrılarak ileri uzanır
        const x = -side * (Math.sin(u * Math.PI * 0.75) * 0.055 - u * 0.03);
        const y = Math.sin(u * Math.PI) * 0.045 + (u > 0.65 ? (u - 0.65) * 0.12 : 0);
        const z = -i * 0.082;
        seg.position.set(x, y, z);
        seg.rotation.x = u > 0.6 ? 0.35 * (u - 0.6) : -0.08 * u;
        seg.rotation.y = side * (0.18 - u * 0.32);
        armCurve.add(seg);

        // İç-alt kısımda çift sıra vantuzlar
        if (i >= 1 && i < segs - 1) {
          const sr = w * 0.32;
          for (const row of [-1, 1]) {
            const sucker = new THREE.Mesh(new THREE.BoxGeometry(sr, sr * 0.55, sr), suckerMat);
            sucker.position.set(
              x - side * (w * 0.46),
              y - h * 0.32 + row * sr * 0.65,
              z
            );
            armCurve.add(sucker);
          }
        }
      }

      // Yan Yüzgeç (Yüzgeçler: kolun dış-yan tarafında zarif ahtapot yüzgeci)
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
      // İkinci küçük arka yüzgeç kanadı
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

  // ───────────────────────── Dünya Sahnesinde Fırlatılan ve Binayı Saran Kol ─────────────────────────
  _buildWorldTentacle() {
    this.worldGroup = new THREE.Group();
    this.worldGroup.visible = false;
    this.mainScene.add(this.worldGroup);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0x7e22ce });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0x9333ea });
    const suckerMat = new THREE.MeshLambertMaterial({ color: 0xf5d0fe });

    this.worldSegs = [];
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

      this.worldGroup.add(segGroup);
      this.worldSegs.push({ group: segGroup, body });
    }
  }

  // ───────────────────────── Silah Seçimi / Mod Değişimi ─────────────────────────
  onSwitch(weaponId, character) {
    const want = weaponId === 16;
    const wasActive = this.active;
    this.active = want;
    this.fpGroup.visible = want;

    if ( this.vignetteEl ) this.vignetteEl.classList.toggle('on', want);
    if ( this.hudEl ) this.hudEl.classList.toggle('on', want);

    // Ahtapot modunda birinci şahısta karakterin çekiçli sol kolu ve silahlı sağ kolu kesinlikle görünmez!
    if (character) {
      if (want) {
        character.leftArm.visible = false;
        character.rightArm.visible = false;
      } else {
        character.leftArm.visible = true;
        character.rightArm.visible = true;
      }
    }

    if (want && !wasActive) {
      this._resetTentacle();
      this._triggerJumpScare();
    } else if (!want && wasActive) {
      this._resetTentacle();
      if (this.scareEl) this.scareEl.style.opacity = '0';
    }
  }

  _resetTentacle() {
    this.state = 'idle';
    this.stateT = 0;
    this.currentDist = 0;
    this.hitPoint = null;
    this.wrapBox = null;
    this.wrapLocalPts = [];
    this.worldGroup.visible = false;
    this._setStatus('DURUM: KOL HAZIR [SOL TIK]');
  }

  // ───────────────────────── Q Tuşu: Dev Ahtapot Zıplaması (Zıpla - İn) ─────────────────────────
  superJump(character, camera) {
    if (!this.active || !character) return;
    sound.playOctopusJump();

    // Baktığımız yöne doğru hafif ileri + çok büyük dikey sıçrama (jetpack gibi fırlayıp geri aşağı iner)
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

  // ───────────────────────── Sol Tık: Ahtapot Kolunu Kanca Gibi Fırlat ve Binayı Sar ─────────────────────────
  onLeftClick() {
    if (!this.active) return false;
    // Eğer kol zaten fırlatılmış veya sarılıysa yeni sol tık kolu geri çeker
    if (this.state !== 'idle') {
      if (this.state === 'wrapped' || this.state === 'wrapping') {
        this._startRetract();
      }
      return true;
    }

    sound.playTentacleShoot();
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    this.launchOrigin.copy(this._getHandWorldPos());
    this.launchDir.copy(dir);
    this.currentDist = 0.5;
    this.state = 'extending';
    this.stateT = 0;
    this.hitPoint = null;
    this.wrapBox = null;

    // Işın boyunca bina küpü (voxel) ara
    const step = VOXEL_SIZE * 0.45;
    const p = new THREE.Vector3();
    let hit = null, hitVoxel = null;
    for (let d = 0.8; d <= MAX_TENTACLE_RANGE; d += step) {
      p.copy(cam.position).addScaledVector(dir, d);
      const ix = Math.round(p.x / VOXEL_SIZE);
      const iy = Math.round((p.y - VOXEL_SIZE / 2) / VOXEL_SIZE);
      const iz = Math.round(p.z / VOXEL_SIZE);
      const v = this.vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active && v.groundCell === undefined) {
        hit = p.clone();
        hitVoxel = v;
        break;
      }
      const gy = this.vw.terrain.topYAt(p.x, p.z);
      if (p.y <= gy && this.vw.terrain.topIntactAt(p.x, p.z)) {
        // Zemine çarptı (bina değil): oraya kadar gidip geri dönsün
        this.targetDist = d;
        this.hitPoint = null;
        this.worldGroup.visible = true;
        this._setStatus('KOL FIRLATILDI...');
        return true;
      }
    }

    if (hit && hitVoxel) {
      this.hitPoint = hit;
      this.targetDist = this.launchOrigin.distanceTo(hit);
      this.wrapBox = this._measureBuildingSlice(hitVoxel);
      this.wrapLocalPts = this._buildWrapPoints(this.wrapBox, hit);
    } else {
      this.targetDist = MAX_TENTACLE_RANGE;
    }

    this.worldGroup.visible = true;
    this._setStatus('KOL FIRLATILDI...');
    return true;
  }

  // Çarpılan noktadaki binanın yatay kesitini (minX..maxX, minZ..maxZ) bulur ki kol binanın etrafını sarsın
  _measureBuildingSlice(startVoxel) {
    const S = VOXEL_SIZE;
    const vox = this.vw.voxels;
    const visited = new Set();
    const queue = [startVoxel];
    visited.add(`${startVoxel.ix},${startVoxel.iy},${startVoxel.iz}`);

    let minX = startVoxel.x, maxX = startVoxel.x;
    let minZ = startVoxel.z, maxZ = startVoxel.z;
    let minY = startVoxel.y, maxY = startVoxel.y;

    const maxSpan = 20; // çok geniş bloklarda bile binanın gövdesini sarsın
    while (queue.length > 0 && visited.size < 4500) {
      const v = queue.pop();
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;

      const neighbors = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [0, 1, 0], [0, -1, 0]
      ];
      for (const [dx, dy, dz] of neighbors) {
        const nx = v.ix + dx, ny = v.iy + dy, nz = v.iz + dz;
        if (Math.abs(ny - startVoxel.iy) > 4) continue; // çarpılan katın çevresi
        if (Math.abs(nx * S - startVoxel.x) > maxSpan || Math.abs(nz * S - startVoxel.z) > maxSpan) continue;
        const k = `${nx},${ny},${nz}`;
        if (visited.has(k)) continue;
        const nv = vox.get(k);
        if (!nv || !nv.active || nv.groundCell !== undefined) continue;
        visited.add(k);
        queue.push(nv);
      }
    }

    // En az 1.6m genişlik olsun ki küçük direkleri bile güzelce sarsın
    if (maxX - minX < 1.6) { minX -= 0.8; maxX += 0.8; }
    if (maxZ - minZ < 1.6) { minZ -= 0.8; maxZ += 0.8; }

    return {
      minX, maxX, minZ, maxZ,
      baseY: startVoxel.y,
      cx: (minX + maxX) * 0.5,
      cz: (minZ + maxZ) * 0.5
    };
  }

  // Binanın dış cephesi etrafında 2.25 tur dönen sarmal (coil) noktalar üretir
  _buildWrapPoints(box, hitPos) {
    const pad = 0.38;
    const x0 = box.minX - pad, x1 = box.maxX + pad;
    const z0 = box.minZ - pad, z1 = box.maxZ + pad;
    const cx = box.cx, cz = box.cz;
    const rx = (x1 - x0) * 0.5, rz = (z1 - z0) * 0.5;

    // Başlangıç açısı: kolun binaya değdiği noktadan başlar
    const startAngle = Math.atan2(hitPos.z - cz, hitPos.x - cx);
    const totalSteps = 36;
    const pts = [hitPos.clone()];

    for (let i = 1; i <= totalSteps; i++) {
      const u = i / totalSteps;
      const ang = startAngle + u * Math.PI * 2 * WRAP_TURNS;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // Dikdörtgen bina kesitine yumuşakça oturan sarmal (superellipse / kutu projeksiyonu)
      const scale = 1 / Math.max(Math.abs(ca), Math.abs(sa), 0.72);
      const px = cx + ca * rx * Math.min(1.18, scale * 0.88);
      const pz = cz + sa * rz * Math.min(1.18, scale * 0.88);
      const py = hitPos.y + (u - 0.3) * 1.8; // sararken hafif yukarı-aşağı sarmal yapar
      pts.push(new THREE.Vector3(px, py, pz));
    }
    return pts;
  }

  // ───────────────────────── Sağ Tık: Sarılan Binayı Çek / Altını Kır ─────────────────────────
  onRightClick(onScreenShake) {
    if (!this.active) return false;
    if (this.state === 'idle') return false;

    if (this.state === 'wrapped' || this.state === 'wrapping') {
      this._executeBuildingPull(onScreenShake);
      return true;
    }

    // Uzamaktaysa geri çek
    this._startRetract();
    return true;
  }

  _startRetract() {
    this.state = 'retracting';
    this.stateT = 0;
    this.pullStartPts = this._currentTentaclePoints();
    this._setStatus('KOL GERİ ÇEKİLİYOR...');
  }

  // Binayı komple kendine doğru çeker ve sarılan/alt kısmı parçalayarak binayı oyuncuya doğru yıkar!
  _executeBuildingPull(onScreenShake) {
    sound.playTentaclePull();
    sound.playExplosion(1.15);
    if (onScreenShake) onScreenShake(0.45);

    const box = this.wrapBox;
    const playerPos = this.camera.position.clone();
    if (box) {
      const toPlayer = new THREE.Vector3(playerPos.x - box.cx, 0, playerPos.z - box.cz);
      if (toPlayer.lengthSq() < 1e-4) toPlayer.set(0, 0, 1);
      toPlayer.normalize();

      // Fırlayan parçaların hızı: doğrudan oyuncuya doğru çekilir!
      const pullVel = new THREE.Vector3(toPlayer.x * 22, 4.5, toPlayer.z * 22);

      // 1) Sarılan sarmal noktalar boyunca ve binanın oyuncuya bakan alt/orta cephesini kopar ("alt tarafı çeken kısmını kırsın")
      let cutCount = 0;
      for (const pt of this.wrapLocalPts) {
        cutCount += this.vw.sweepCut(pt, 1.35, pullVel);
      }

      // Binanın oyuncuya bakan yarısını (özellikle alt/çekilen katmanları) boydan boya kesip kopar
      const groundH = Math.max(0, this.vw.terrain.heightAt(box.cx, box.cz));
      const cutBaseY = Math.max(groundH + VOXEL_SIZE * 0.5, Math.min(box.baseY - 1.5, groundH + 3.0));
      const cutTopY = Math.max(box.baseY + 1.5, cutBaseY + 3.0);

      for (let x = box.minX - 0.5; x <= box.maxX + 0.5; x += 1.1) {
        for (let z = box.minZ - 0.5; z <= box.maxZ + 0.5; z += 1.1) {
          // Oyuncuya bakan yarıya ağırlık ver
          const dot = (x - box.cx) * toPlayer.x + (z - box.cz) * toPlayer.z;
          if (dot >= -1.2) {
            for (let y = cutBaseY; y <= cutTopY; y += 1.1) {
              cutCount += this.vw.sweepCut(new THREE.Vector3(x, y, z), 1.25, pullVel);
            }
          }
        }
      }

      // 2) Binanın geri kalan gövdesini doğrudan oyuncuya doğru çekip devir ("bildiğin binayı komple çeksin")
      this._tipBuildingTowardPlayer(box, toPlayer);

      if (this.ps && this.ps.createExplosion) {
        this.ps.createExplosion(new THREE.Vector3(box.cx, box.baseY, box.cz), 3.2, 0xa855f7);
      }
      if (this.hw.onScore && cutCount > 0) {
        const pts = Math.max(250, Math.round(cutCount * 3));
        this.hw.onScore(pts, `+${pts} AHTAPOT YIKIMI!`);
      }
    }

    this.state = 'pulling';
    this.stateT = 0;
    this.pullStartPts = this._currentTentaclePoints();
    this._setStatus('BİNA ÇEKİLDİ!');
  }

  // Sarılan binanın kalan gövdesini bulup doğrudan oyuncuya doğru devrilen/çekilen parçaya dönüştürür
  _tipBuildingTowardPlayer(box, toPlayer) {
    if (!this.vw.collapse) return;
    const S = VOXEL_SIZE;
    const vox = this.vw.voxels;

    // Binanın sarılan bölgesinin üstünde/içinde sağlam bir tohum küp bul
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
      // Bu binaya ait bağlı küpleri topla (en fazla 45.000 küp — dev şirket binaları dahil)
      const visited = new Map();
      const stack = [seed];
      visited.set(`${seed.ix},${seed.iy},${seed.iz}`, seed);
      const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      let minBy = Infinity;

      while (stack.length > 0 && visited.size < 45000) {
        const v = stack.pop();
        if (v.y - S / 2 < minBy) minBy = v.y - S / 2;
        for (const [dx, dy, dz] of DIRS) {
          const nx = v.ix + dx, ny = v.iy + dy, nz = v.iz + dz;
          // Yalnızca bu binanın taban izi çevresindeki küpleri al (yan binalara taşmasın)
          if (nx * S < box.minX - 6 || nx * S > box.maxX + 6 || nz * S < box.minZ - 6 || nz * S > box.maxZ + 6) continue;
          const k = `${nx},${ny},${nz}`;
          if (visited.has(k)) continue;
          const nv = vox.get(k);
          if (!nv || !nv.active || nv.groundCell !== undefined) continue;
          visited.add(k, nv);
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
          // Ahtapot koluyla hızla çekildiği için başlangıç devrilme hızı ver
          chunk.omega = 0.52;
        }
        return;
      }
    }

    // Eğer bina zaten düşmekte olan bir Collapse parça (chunk) ise onu da oyuncuya doğru devir
    for (const c of this.vw.collapse.chunks) {
      if (Math.hypot(c.com.x - box.cx, c.com.z - box.cz) < 18) {
        this.vw.collapse._beginTip(c, {
          dx: toPlayer.x,
          dz: toPlayer.z,
          px: c.com.x + toPlayer.x * 2,
          py: c.lowBy,
          pz: c.com.z + toPlayer.z * 2
        }, 0.08, 0.55);
      }
    }
  }

  _getHandWorldPos() {
    // Sağ ahtapot kolunun dünya uzayındaki başlangıç noktası
    return this.hw._handWorld({ x: 0.36, y: -0.24, z: -0.55 });
  }

  // O anki duruma göre dünya uzayındaki ahtapot kolunun omurga noktalarını üretir
  _currentTentaclePoints() {
    const start = this._getHandWorldPos();
    const pts = [];

    if (this.state === 'extending') {
      const end = start.clone().addScaledVector(this.launchDir, this.currentDist);
      for (let i = 0; i <= WORLD_SEGS; i++) {
        const u = i / WORLD_SEGS;
        const p = new THREE.Vector3().lerpVectors(start, end, u);
        // Fırlatılırken hafif dalgalı kırbaç hareketi
        const wave = Math.sin(u * Math.PI * 3 - this.stateT * 28) * 0.22 * Math.sin(u * Math.PI);
        p.y += wave;
        pts.push(p);
      }
      return pts;
    }

    if (this.state === 'wrapping' || this.state === 'wrapped') {
      const wrapU = this.state === 'wrapped' ? 1.0 : Math.min(1, this.stateT / WRAP_DURATION);
      const hit = this.wrapLocalPts[0] || this.hitPoint;
      const straightSegs = 14;
      const coilSegs = WORLD_SEGS - straightSegs;

      // 1) Oyuncunun elinden binaya kadar gerili hat
      for (let i = 0; i <= straightSegs; i++) {
        const u = i / straightSegs;
        const p = new THREE.Vector3().lerpVectors(start, hit, u);
        if (this.state === 'wrapping') {
          p.y += Math.sin(u * Math.PI) * Math.sin(this.stateT * 18) * 0.12;
        }
        pts.push(p);
      }

      // 2) Binanın etrafını döne döne saran kısım
      const maxIdx = Math.max(1, (this.wrapLocalPts.length - 1) * wrapU);
      for (let i = 1; i <= coilSegs; i++) {
        const cu = (i / coilSegs) * maxIdx;
        const idx0 = Math.floor(cu);
        const idx1 = Math.min(this.wrapLocalPts.length - 1, idx0 + 1);
        const frac = cu - idx0;
        const p = new THREE.Vector3().lerpVectors(this.wrapLocalPts[idx0], this.wrapLocalPts[idx1], frac);
        pts.push(p);
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

    // 1) Birinci şahıs ahtapot kolları ve yüzgeçlerin ÇOK HAFİF yukarı-aşağı animasyonu
    // ("çok minik bir şekilde yukarı aşağı böyle sanki animasyon varmış gibi yukarı aşağı gitsin. Hafif böyle yukarı aşağı kalsın. Çok hafif.")
    const gentleY = Math.sin(t * 2.1) * 0.0085;
    const gentleY2 = Math.sin(t * 2.1 + 0.9) * 0.0085;
    const finWave = Math.sin(t * 2.6) * 0.025;

    this.leftArmFP.group.position.set(-0.36, -0.26 + gentleY, -0.36);
    this.leftArmFP.finPivot.rotation.z = 0.22 + finWave;

    // Sağ kol: eğer kanca olarak dışarı fırlatıldıysa ileri doğru uzanmış durur
    const rightOut = this.state !== 'idle' ? 0.14 : 0;
    this.rightArmFP.group.position.set(0.36, -0.26 + gentleY2, -0.36 - rightOut);
    this.rightArmFP.finPivot.rotation.z = -0.22 - finWave;

    // 2) Fırlatılan / Binayı Saran Kolun Durum Makinesi
    if (this.state === 'idle') return;

    this.stateT += dt;

    if (this.state === 'extending') {
      this.currentDist += EXTEND_SPEED * dt;
      if (this.currentDist >= this.targetDist) {
        this.currentDist = this.targetDist;
        if (this.hitPoint && this.wrapBox) {
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
        this._setStatus('BİNA SARILDI! [SAĞ TIK: ÇEK VE YIK]');
      }
    } else if (this.state === 'pulling' || this.state === 'retracting') {
      const dur = this.state === 'pulling' ? 0.34 : 0.28;
      if (this.stateT >= dur) {
        this._resetTentacle();
        return;
      }
    }

    // 3) Dünya sahnesindeki kol boğumlarını omurga noktalarına yerleştir
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
  }
}
