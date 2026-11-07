import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// ATAHAN ŞEHİR HİKAYESİ & SİNEMATİK GÖREV YÖNETİCİSİ (STORY ENGINE)
// ─────────────────────────────────────────────────────────────────────────────
// Karakterler:
//  • Milyarder David Sterling: Sinsi, dahi, şehirdeki tüm bankaları ele geçiren iş adamı.
//  • Arthur Pendelton: Bankalar Birliği Başkanı, anlaşmayı imzalayan bankacı.
//  • Kaslı Korumalar: Kırmızı kravatlı, göğüste kolları kavuşmuş, geniş omuzlu güvenlikler.
//  • İsyancı Halk: Ellerinde protesto pankartları olan öfkeli kalabalık.
// ─────────────────────────────────────────────────────────────────────────────

export const STORY_PHASES = {
  NONE: 0,
  CINEMATIC_BANK: 1,      // Sahne 1: Banka Anlaşması (David Sterling & Arthur Pendelton)
  CINEMATIC_PROTEST: 2,   // Sahne 2: Villa Önü İsyanı & Canlı Yayın Haber Aracı
  PHONE_CALL: 3,          // Sahne 3: David Sterling Undertale tarzı telefon araması
  TV_NEWS: 4,             // Sahne 4: Salondaki TV'de haber bülteni
  MISSION_EXIT_HOUSE: 5,  // Görev 1: Evden çık ve caddedeki limuzin durağına in
  WAIT_LIMO: 6,           // Caddedeki altın beyaz limuzini bekleme
  LIMO_RIDE: 7,           // Limuzin içi: Mor neon, karşıda 2 kaslı koruma, köprü yolculuğu
  VILLA_ARRIVAL: 8,       // Villaya varış, David Sterling ile yüzleşme, çanta açılışı
  MISSION_COMBAT: 9,      // Görev 2: Villayı kuşatan isyancıları temizleme
  MISSION_VICTORY: 10     // Görev 3: David Sterling'in tebriği ve yanımıza gelişi
};

const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const matCache = new Map();
const MAT = (color, opt = {}) => {
  const key = `${color}_${opt.roughness ?? 0.5}_${opt.metalness ?? 0.1}_${opt.transparent ?? false}_${opt.opacity ?? 1}_${opt.emissive ?? 0}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: opt.roughness ?? 0.5,
      metalness: opt.metalness ?? 0.1,
      transparent: opt.transparent ?? false,
      opacity: opt.opacity ?? 1,
      emissive: opt.emissive ? color : 0x000000,
      emissiveIntensity: opt.emissive ? 0.6 : 0,
      side: opt.double ? THREE.DoubleSide : THREE.FrontSide
    }));
  }
  return matCache.get(key);
};

export class StoryManager {
  constructor(scene, voxelWorld, character, camera, weaponSystem, handWeapons) {
    this.scene = scene;
    this.voxelWorld = voxelWorld;
    this.character = character;
    this.camera = camera;
    this.weaponSystem = weaponSystem;
    this.handWeapons = handWeapons;

    this.currentPhase = STORY_PHASES.NONE;
    this.phaseTimer = 0;
    this.weaponsLocked = true;
    this.controlsLocked = true;

    // Arayüz elemanları
    this.uiContainer = null;
    this.dialogBox = null;
    this.dialogTextEl = null;
    this.dialogSpeakerEl = null;
    this.dialogPortraitEl = null;
    this.skipButton = null;
    this.missionHud = null;
    this.fadeOverlay = null;

    // Diyalog değişkenleri
    this.activeDialog = null;
    this.dialogIndex = 0;
    this.charIndex = 0;
    this.typeTimer = 0;
    this.isTyping = false;
    this.dialogQueue = [];
    this.onDialogComplete = null;

    // 3D Hikaye Aktörleri ve Nesneleri
    this.cinematicGroup = new THREE.Group();
    this.scene.add(this.cinematicGroup);

    this.limo = null;
    this.limoInterior = null;
    this.limoGuards = [];
    this.protesters = [];
    this.muscleGuards = [];
    this.davidActor = null;
    this.arthurActor = null;
    this.weaponBriefcase = null;
    this.newsVan = null;

    // Limuzin yolculuğu yolu (Waypoints)
    this.limoPath = [
      { x: -95, y: 0.5, z: 2.1 },
      { x: -40, y: 0.5, z: 2.1 },
      { x: -12, y: 0.5, z: 2.1 },   // Köprü batı girişi
      { x: 120, y: 0.5, z: 2.1 },   // Köprü ortası
      { x: 258, y: 0.5, z: 2.1 },   // Köprü doğu çıkışı
      { x: 321, y: 0.5, z: 2.1 },   // Villa yolu başlangıcı
      { x: 350, y: 3.5, z: -15 },   // Villa rampası
      { x: 380, y: 8.5, z: -38 },   // Villa virajı
      { x: 395, y: 12.0, z: -54 }   // Villa kapısı önü
    ];
    this.limoProgress = 0;
    this.limoLookYaw = 0;
    this.limoLookPitch = 0;

    // Merdiven inme / hedef göstergesi
    this.waypointMarker = null;
    this._createWaypointMarker();

    // UI oluştur
    this._initUI();
  }

  // ── Arayüz Başlatma ──
  _initUI() {
    let container = document.getElementById('story-ui-root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'story-ui-root';
      container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,monospace;';
      document.body.appendChild(container);
    }
    this.uiContainer = container;

    // Karartma perdesi (Fade overlay)
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;transition:opacity 0.6s ease;pointer-events:none;';
    container.appendChild(fade);
    this.fadeOverlay = fade;

    // Skip (Geç) Butonu (Sağ üstte zarif buton)
    const skip = document.createElement('button');
    skip.id = 'story-skip-btn';
    skip.innerHTML = '⏭ GEÇ (SKIP)';
    skip.style.cssText = `
      position: absolute; top: 22px; right: 26px;
      padding: 10px 22px; background: rgba(15, 23, 42, 0.88);
      color: #facc15; border: 2px solid #eab308; border-radius: 8px;
      font-size: 14px; font-weight: 800; letter-spacing: 1px;
      cursor: pointer; pointer-events: auto; opacity: 0;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      transition: opacity 0.3s, transform 0.15s, background 0.2s;
    `;
    skip.onmouseenter = () => { skip.style.background = '#eab308'; skip.style.color = '#000'; };
    skip.onmouseleave = () => { skip.style.background = 'rgba(15, 23, 42, 0.88)'; skip.style.color = '#facc15'; };
    skip.onclick = (e) => {
      e.stopPropagation();
      sound.playUiBeep();
      this.skipCurrentCinematic();
    };
    container.appendChild(skip);
    this.skipButton = skip;

    // Fare tıklamasında skip butonunu görünür kıl
    window.addEventListener('mousedown', () => {
      if (this.controlsLocked && this.currentPhase !== STORY_PHASES.NONE && this.currentPhase !== STORY_PHASES.MISSION_COMBAT) {
        this.showSkipButton(true);
      }
    });

    // Görev Bildirim HUD'u (Sağ üst çapraz kutu)
    const hud = document.createElement('div');
    hud.id = 'story-mission-hud';
    hud.style.cssText = `
      position: absolute; top: 78px; right: 26px;
      background: rgba(10, 15, 30, 0.92); border-left: 5px solid #38bdf8;
      border-radius: 6px; padding: 12px 18px; color: #fff;
      box-shadow: 0 6px 24px rgba(0,0,0,0.6); display: none;
      min-width: 260px; max-width: 360px; pointer-events: none;
    `;
    hud.innerHTML = `
      <div style="font-size:11px;font-weight:900;color:#38bdf8;letter-spacing:1.5px;margin-bottom:4px;">AKTİF GÖREV</div>
      <div id="story-mission-title" style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.3;">Evden Çık</div>
      <div id="story-mission-desc" style="font-size:12px;color:#94a3b8;margin-top:4px;">Merdivenlerden aşağı in ve caddedeki limuzin durağına git.</div>
    `;
    container.appendChild(hud);
    this.missionHud = hud;

    // Undertale Tarzı Retro Diyalog Kutusu
    const dbox = document.createElement('div');
    dbox.id = 'story-dialog-box';
    dbox.style.cssText = `
      position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%);
      width: 760px; max-width: 92vw; min-height: 155px;
      background: #000000; border: 4px double #ffffff; border-radius: 8px;
      padding: 16px 22px; display: none; pointer-events: auto;
      box-shadow: 0 10px 40px rgba(0,0,0,0.9), inset 0 0 15px rgba(255,255,255,0.08);
      font-family: 'Courier New', Courier, monospace;
      color: #ffffff; cursor: pointer; user-select: none;
    `;
    dbox.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:20px;">
        <div id="story-speaker-avatar" style="width:110px;height:110px;background:#111;border:2px solid #555;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <!-- SVG Portre -->
        </div>
        <div style="flex:1;">
          <div id="story-speaker-name" style="font-size:18px;font-weight:900;color:#facc15;letter-spacing:1px;margin-bottom:8px;text-transform:uppercase;">DAVID STERLING</div>
          <div id="story-dialog-text" style="font-size:16px;line-height:1.5;color:#f8fafc;min-height:55px;">...</div>
        </div>
      </div>
      <div id="story-dialog-indicator" style="position:absolute;bottom:10px;right:18px;font-size:14px;color:#facc15;animation:blink 0.8s infinite;">▼ Tıkla / [Space]</div>
    `;
    dbox.onclick = () => this.advanceDialog();
    container.appendChild(dbox);

    this.dialogBox = dbox;
    this.dialogTextEl = dbox.querySelector('#story-dialog-text');
    this.dialogSpeakerEl = dbox.querySelector('#story-speaker-name');
    this.dialogPortraitEl = dbox.querySelector('#story-speaker-avatar');

    // Klavye ile diyalog ilerletme
    window.addEventListener('keydown', (e) => {
      if (this.dialogBox.style.display !== 'none' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
        this.advanceDialog();
      }
    });
  }

  showSkipButton(visible) {
    if (!this.skipButton) return;
    this.skipButton.style.opacity = visible ? '1' : '0';
    this.skipButton.style.pointerEvents = visible ? 'auto' : 'none';
  }

  setFade(opacity, duration = 600) {
    if (!this.fadeOverlay) return;
    this.fadeOverlay.style.transition = `opacity ${duration}ms ease`;
    this.fadeOverlay.style.opacity = `${opacity}`;
  }

  setMission(title, desc, show = true) {
    if (!this.missionHud) return;
    if (!show) {
      this.missionHud.style.display = 'none';
      return;
    }
    this.missionHud.querySelector('#story-mission-title').innerText = title;
    this.missionHud.querySelector('#story-mission-desc').innerText = desc;
    this.missionHud.style.display = 'block';
  }

  // 3D Parlayan Hedef İşaretçisi (Aşağı inme hedefi)
  _createWaypointMarker() {
    const group = new THREE.Group();

    // Zemin halkası
    const ringGeo = new THREE.RingGeometry(1.8, 2.4, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    group.add(ringMesh);

    // Dikey silindirik ışık sütunu
    const colGeo = new THREE.CylinderGeometry(1.8, 1.8, 5.0, 24, 1, true);
    const colMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const colMesh = new THREE.Mesh(colGeo, colMat);
    colMesh.position.y = 2.5;
    group.add(colMesh);

    // Aşağı işaret eden 3D Altın Ok
    const arrowCone = new THREE.ConeGeometry(0.8, 1.4, 16);
    arrowCone.rotateX(Math.PI);
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xd97706, emissiveIntensity: 0.6 });
    const arrowMesh = new THREE.Mesh(arrowCone, arrowMat);
    arrowMesh.position.y = 3.6;
    group.add(arrowMesh);
    group.userData.arrow = arrowMesh;

    group.position.set(-95.2, 0.6, 6.2); // Caddedeki limuzin bekleme noktası
    group.visible = false;
    this.scene.add(group);
    this.waypointMarker = group;
  }

  // ── Undertale Portre Çizimi ──
  _getPortraitSVG(speaker) {
    if (speaker === 'david') {
      return `
        <svg viewBox="0 0 100 100" width="100" height="100">
          <!-- David Sterling Portre: Sinsi, bıyıklı/keçi sakallı, altın çerçeve gözlük, siyah takım -->
          <rect width="100" height="100" fill="#0f172a"/>
          <!-- Saç ve Kafa -->
          <path d="M22 42 Q20 18 50 16 Q80 18 78 42 Z" fill="#334155"/>
          <ellipse cx="50" cy="52" rx="26" ry="28" fill="#e0ac86"/>
          <!-- Saç Detay -->
          <path d="M26 30 Q50 20 74 30 L72 38 Q50 26 28 38 Z" fill="#1e293b"/>
          <!-- Kaşlar (Sinsi çatık) -->
          <path d="M30 42 L44 46" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>
          <path d="M70 42 L56 46" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>
          <!-- Gözler (Kısık, sinsi bakış) -->
          <ellipse cx="37" cy="50" rx="5" ry="3" fill="#000"/>
          <ellipse cx="63" cy="50" rx="5" ry="3" fill="#000"/>
          <!-- Altın Çerçeveli Gözlük -->
          <rect x="28" y="44" width="18" height="12" rx="3" fill="none" stroke="#facc15" stroke-width="2.5"/>
          <rect x="54" y="44" width="18" height="12" rx="3" fill="none" stroke="#facc15" stroke-width="2.5"/>
          <line x1="46" y1="50" x2="54" y2="50" stroke="#facc15" stroke-width="2.5"/>
          <!-- Burun -->
          <path d="M50 50 L47 62 L53 62 Z" fill="#c68642"/>
          <!-- Sinsi Gülüş -->
          <path d="M36 68 Q50 78 64 66" fill="none" stroke="#7f1d1d" stroke-width="3.5" stroke-linecap="round"/>
          <!-- Keçi Sakalı -->
          <polygon points="46,74 54,74 50,84" fill="#1e293b"/>
          <!-- Takım Elbise & Kırmızı Kravat -->
          <polygon points="15,100 30,76 70,76 85,100" fill="#0b0f19"/>
          <polygon points="43,76 57,76 50,100" fill="#dc2626"/>
        </svg>
      `;
    } else if (speaker === 'guard') {
      return `
        <svg viewBox="0 0 100 100" width="100" height="100">
          <!-- Kaslı Koruma: Güneş gözlüğü, telsiz kulaklık, geniş çene -->
          <rect width="100" height="100" fill="#020617"/>
          <path d="M20 40 Q20 20 50 20 Q80 20 80 40 Z" fill="#0f172a"/>
          <rect x="24" y="32" width="52" height="48" rx="8" fill="#d4a373"/>
          <!-- Güneş Gözlüğü -->
          <rect x="28" y="42" width="20" height="10" rx="2" fill="#000"/>
          <rect x="52" y="42" width="20" height="10" rx="2" fill="#000"/>
          <line x1="48" y1="46" x2="52" y2="46" stroke="#000" stroke-width="2"/>
          <!-- Çene & Ciddi Ağız -->
          <line x1="40" y1="66" x2="60" y2="66" stroke="#111" stroke-width="3" stroke-linecap="round"/>
          <!-- Geniş Kaslı Omuzlar & Kırmızı Kravat -->
          <rect x="4" y="78" width="92" height="22" fill="#0f172a"/>
          <polygon points="44,78 56,78 50,100" fill="#b91c1c"/>
        </svg>
      `;
    } else if (speaker === 'news') {
      return `
        <svg viewBox="0 0 100 100" width="100" height="100">
          <!-- Kadın Haber Spikeri: Sarı saç, mikrofon, haber stüdyosu arka planı -->
          <rect width="100" height="100" fill="#1e3a8a"/>
          <circle cx="50" cy="46" r="26" fill="#fde047"/>
          <ellipse cx="50" cy="52" rx="20" ry="22" fill="#fbcfe8"/>
          <!-- Gözler -->
          <circle cx="42" cy="48" r="3" fill="#1e293b"/>
          <circle cx="58" cy="48" r="3" fill="#1e293b"/>
          <path d="M42 62 Q50 68 58 62" fill="none" stroke="#be185d" stroke-width="3"/>
          <polygon points="20,100 35,76 65,76 80,100" fill="#be123c"/>
          <!-- Mikrofon -->
          <circle cx="76" cy="80" r="8" fill="#475569"/>
          <rect x="74" y="86" width="4" height="12" fill="#1e293b"/>
        </svg>
      `;
    }
    return '';
  }

  // ── Diyalog Gösterimi (Undertale Daktilo Efekti) ──
  startDialogQueue(queue, onComplete) {
    this.dialogQueue = queue;
    this.onDialogComplete = onComplete;
    this.dialogIndex = -1;
    this.dialogBox.style.display = 'block';
    this.advanceDialog();
  }

  advanceDialog() {
    // Eğer yazı hala yazılıyorsa anında cümleyi tamamla
    if (this.isTyping && this.activeDialog) {
      this.isTyping = false;
      this.dialogTextEl.innerText = this.activeDialog.text;
      return;
    }

    this.dialogIndex++;
    if (this.dialogIndex >= this.dialogQueue.length) {
      this.dialogBox.style.display = 'none';
      if (this.onDialogComplete) this.onDialogComplete();
      return;
    }

    this.activeDialog = this.dialogQueue[this.dialogIndex];
    this.dialogSpeakerEl.innerText = this.activeDialog.name;
    this.dialogSpeakerEl.style.color = this.activeDialog.color || '#facc15';
    this.dialogPortraitEl.innerHTML = this._getPortraitSVG(this.activeDialog.speaker);
    this.dialogTextEl.innerText = '';
    this.charIndex = 0;
    this.isTyping = true;
    this.typeTimer = 0;
  }

  // ── Hikaye Başlatma ──
  startStory() {
    this.weaponsLocked = true;
    this.controlsLocked = true;
    this.setMission('', '', false);
    this.startPhaseBankCinematic();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 1: BANKA ANLAŞMASI (David Sterling & Arthur Pendelton)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseBankCinematic() {
    this.currentPhase = STORY_PHASES.CINEMATIC_BANK;
    this.phaseTimer = 0;
    this.showSkipButton(true);

    // Banka konumu: x = -63, z = -17 (Şehir Merkez Bankası)
    const bankX = -63, bankY = 1.0, bankZ = -17;

    // Sahne 3D Aktörlerini Oluştur
    this._buildBankMeetingScene(bankX, bankY, bankZ);

    // Kamerayı bankanın lüks ofis masasına ayarla
    this.camera.position.set(bankX + 4.8, bankY + 2.5, bankZ + 4.2);
    this.camera.lookAt(bankX, bankY + 1.6, bankZ);

    sound.playCinematicBoom();

    // Diyalog zincirini başlat
    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Banka kasalarının anahtarları ve şehrin tüm vadeli hesapları... Anlaşmamız tamamlandı Arthur.'
      },
      {
        speaker: 'guard', name: 'ARTHUR PENDELTON (BANKALAR BİRLİĞİ)', color: '#38bdf8',
        text: 'Bay Sterling, bu para akıl almaz bir meblağ... Ancak halk bankalardaki birikimlerine el koyduğunuzu öğrenirse kıyamet kopar!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Halkın ne düşündüğü umurumda değil. Bu şehirde para kimdeyse, kanun da kural da onun elindedir!'
      }
    ], () => {
      // Sahne 2'ye geçiş (Karartma ile)
      this.setFade(1, 400);
      setTimeout(() => {
        this.startPhaseProtestCinematic();
      }, 450);
    });
  }

  _buildBankMeetingScene(bx, by, bz) {
    this.cinematicGroup.clear();

    // Lüks maun toplantı masası
    const table = new THREE.Mesh(BOX(3.2, 0.9, 1.8), MAT(0x451a03, { roughness: 0.3 }));
    table.position.set(bx, by + 0.45, bz);
    this.cinematicGroup.add(table);

    // Ağır altın para çantaları ve altın külçeler
    for (let i = -1; i <= 1; i += 0.8) {
      const gold = new THREE.Mesh(BOX(0.6, 0.25, 0.4), MAT(0xfacc15, { metalness: 0.9, roughness: 0.1 }));
      gold.position.set(bx + i * 0.5, by + 0.9 + 0.12, bz);
      this.cinematicGroup.add(gold);
    }

    // David Sterling (Masada oturan)
    const david = this._buildDavidModel();
    david.position.set(bx - 1.2, by, bz);
    david.rotation.y = Math.PI / 2;
    this.cinematicGroup.add(david);
    this.davidActor = david;

    // Arthur Pendelton (Karşıda oturan)
    const arthur = this._buildArthurModel();
    arthur.position.set(bx + 1.2, by, bz);
    arthur.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(arthur);
    this.arthurActor = arthur;

    // 2 Kaslı Koruma (Kapıda ve David'in arkasında)
    const g1 = this._buildMuscleGuardModel();
    g1.position.set(bx - 2.5, by, bz - 1.2);
    g1.rotation.y = Math.PI / 3;
    this.cinematicGroup.add(g1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 2: VİLLA ÖNÜ İSYANI & HABER ARACI
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseProtestCinematic() {
    this.currentPhase = STORY_PHASES.CINEMATIC_PROTEST;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    // Villa kapısı önü: x = 395, y = 12.0, z = -54 (Doğu Ada Tepesi)
    const vx = 395, vy = 12.0, vz = -54;

    this._buildProtestScene(vx, vy, vz);

    // Kamera açısı: İsyancıların arkasından villaya ve haber aracına doğru
    this.camera.position.set(vx + 9.5, vy + 4.5, vz + 14.5);
    this.camera.lookAt(vx, vy + 2.2, vz);

    this.setFade(0, 500);
    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'news', name: 'METROPOL HABER BÜLTENİ', color: '#f43f5e',
        text: 'SON DAKİKA: Milyarder David Sterling’in şehirdeki tüm bankaları gizlice satın aldığı haberi halkı sokağa döktü!'
      },
      {
        speaker: 'news', name: 'CANLI YAYIN MUHABİRİ', color: '#f43f5e',
        text: 'Öfkeli protestocular şu an Sterling Malikanesi’nin kapısına dayandı. Güvenlik barikatı zorlanıyor, halk paralarını geri istiyor!'
      }
    ], () => {
      // Sahne 3: David'in Undertale telefon araması
      this.startPhasePhoneCall();
    });
  }

  _buildProtestScene(vx, vy, vz) {
    // Canlı Yayın Haber Aracı (Metropol News Van)
    const van = new THREE.Group();
    const vanBody = new THREE.Mesh(BOX(5.2, 2.4, 2.2), MAT(0x1e293b));
    vanBody.position.y = 1.2;
    van.add(vanBody);

    // Kırmızı & Mavi TV Logosu ve Çanak Anten
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.1, 0.4, 16), MAT(0xffffff, { metalness: 0.8 }));
    dish.position.set(-0.8, 2.7, 0);
    dish.rotation.z = 0.4;
    van.add(dish);

    const tvBanner = new THREE.Mesh(BOX(3.8, 0.8, 0.05), MAT(0xe11d48, { emissive: true }));
    tvBanner.position.set(0, 1.4, 1.13);
    van.add(tvBanner);

    van.position.set(vx + 7.5, vy, vz + 9.5);
    van.rotation.y = -Math.PI / 4;
    this.cinematicGroup.add(van);
    this.newsVan = van;

    // Protestocular (Ellerinde pankartlar olan kalabalık)
    this.protesters = [];
    const slogans = ['DEFOL STERLING!', 'PARALARIMIZI VER!', 'HIRSIZ STERLING!', 'BANKALARI BIRAK!'];
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI - 0.2;
      const r = 4.5 + Math.random() * 3.5;
      const px = vx + Math.cos(ang) * r;
      const pz = vz + 3.0 + Math.sin(ang) * r;
      const p = this._buildProtesterModel(slogans[i % slogans.length]);
      p.position.set(px, vy, pz);
      p.rotation.y = Math.PI + (Math.random() - 0.5) * 0.6;
      p.userData.baseY = vy;
      p.userData.animOffset = Math.random() * 10;
      this.cinematicGroup.add(p);
      this.protesters.push(p);
    }

    // Villayı koruyan 3 Kaslı Koruma (Kapı önünde kollar kavuşmuş)
    for (let i = -1; i <= 1; i++) {
      const g = this._buildMuscleGuardModel();
      g.position.set(vx + i * 2.8, vy, vz - 1.5);
      g.rotation.y = 0; // İsyancılara bakıyor
      this.cinematicGroup.add(g);
      this.muscleGuards.push(g);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 3: DAVID STERLING'İN TELEFON ARAMASI (Undertale Arayüzü)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhasePhoneCall() {
    this.currentPhase = STORY_PHASES.PHONE_CALL;
    this.phaseTimer = 0;

    // Telefon sesi çal
    sound.playPhoneRing();

    // Undertale diyalog kutusu
    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (TELEFON GÖRÜŞMESİ)', color: '#facc15',
        text: 'Alo... Beni duyabiliyor musun? David Sterling konuşuyor.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Haberleri izlemişsindir. Bu sefil isyancı ayak takımı villamın kapısını kuşattı ve güvenliğimi tehdit ediyor!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Sana reddedemeyeceğin bir teklifim var: Hemen Doğu Ada’daki villama gel.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Kapımdaki bu isyancıları temizle; sana dağlar kadar para vereceğim ve sana teslim edeceğim en gelişmiş askeri silahlar sende kalacak!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Özel limuzinimi evinin önündeki caddeye gönderdim. Sakın gecikme!'
      }
    ], () => {
      // Telefon kapandı, evdeki TV sahnesine geçiş
      this.setFade(1, 500);
      setTimeout(() => {
        this.startPhaseTvNewsMorning();
      }, 550);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 4 & 5: EVDEKİ TV VE OYNANIŞIN BAŞLAMASI (Evden Çık Görevi)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseTvNewsMorning() {
    this.currentPhase = STORY_PHASES.MISSION_EXIT_HOUSE;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    // Karakteri evdeki televizyon odasına yerleştir
    const spawnPos = { x: -110.25, y: 7.05, z: 19.75 };
    if (this.character && this.character.body) {
      this.character.body.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      this.character.vel.set(0, 0, 0);
      this.character.mesh.position.set(spawnPos.x, spawnPos.y - 0.525, spawnPos.z);
    }

    // Kamerayı televizyona doğru çevir (Doğrudan TV'ye bakar vaziyette başla)
    this.camera.position.set(spawnPos.x, spawnPos.y + 0.6, spawnPos.z);
    this.camera.lookAt(spawnPos.x + 3.0, spawnPos.y + 0.6, spawnPos.z);

    // Fade aç
    this.setFade(0, 800);
    this.showSkipButton(false);

    // Kontrolleri aç (Ancak silahlar kilitli!)
    this.controlsLocked = false;
    this.weaponsLocked = true;

    // Görev HUD'u
    this.setMission('EVDEN ÇIK VE AŞAĞI İN', 'Merdivenlerden aşağı in ve caddedeki limuzin durağına ulaş.');

    // Parlayan hedef noktasını görünür yap
    if (this.waypointMarker) {
      this.waypointMarker.visible = true;
    }
  }

  // Kullanıcı Skip (Geç) butonuna basarsa doğrudan oynanışa atla
  skipCurrentCinematic() {
    this.dialogBox.style.display = 'none';
    this.setFade(0, 300);
    this.startPhaseTvNewsMorning();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AŞAMA 6: CADDEDE LİMUZİNİ BEKLEME & LİMUZİNE BİNİŞ
  // ═══════════════════════════════════════════════════════════════════════════
  checkPlayerReachedLimoStop(playerPos) {
    if (this.currentPhase !== STORY_PHASES.MISSION_EXIT_HOUSE) return;

    // Hedef: x = -95.2, z = 6.2 (Caddedeki durak)
    const dist = Math.hypot(playerPos.x - (-95.2), playerPos.z - 6.2);
    if (dist < 4.0) {
      this.currentPhase = STORY_PHASES.WAIT_LIMO;
      this.phaseTimer = 0;
      if (this.waypointMarker) this.waypointMarker.visible = false;

      this.setMission('LİMUZİN BEKLENİYOR...', 'David Sterling’in altın beyaz lüks limuzini yaklaşıyor (Kalan: 5 sn)');
      sound.playUiBeep();
    }
  }

  _spawnLimoApproaching() {
    if (this.limo) this.scene.remove(this.limo);
    const limo = this._buildLuxuryLimoModel();
    limo.position.set(-135, 0.5, 2.1); // Cadde üzerinden bize doğru yaklaşır
    limo.rotation.y = 0; // Doğu yönüne bakıyor
    this.scene.add(limo);
    this.limo = limo;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AŞAMA 7: LİMUZİN İÇİ VIP DENEYİMİ & ASMA KÖPRÜ YOLCULUĞU
  // ═══════════════════════════════════════════════════════════════════════════
  startLimoRide() {
    this.currentPhase = STORY_PHASES.LIMO_RIDE;
    this.phaseTimer = 0;
    this.limoProgress = 0;
    this.controlsLocked = true; // Sürüş otonom, fare ile limuzin içinde bakılabilir

    sound.playLimoDoor();

    this.setMission('LİMUZİN İLE SEYAHAT', 'David Sterling’in korumalarıyla Doğu Ada’daki malikaneye gidiyorsunuz.');

    // Limuzin içi konuşma
    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'guard', name: 'BAŞ KORUMA (LİMUZİN İÇİ)', color: '#dc2626',
          text: 'Arkamıza yaslanalım. Patronumuz David Sterling seninle resmi bir anlaşma yaptı.'
        },
        {
          speaker: 'guard', name: 'BAŞ KORUMA', color: '#dc2626',
          text: 'Kapıdaki o isyancı sürüsünü tek tek temizleyeceksin. Bu anlaşmaya uyarsan dağlar kadar servet ve sana vereceğimiz tüm ağır silahlar tamamen sende kalacak!'
        }
      ]);
    }, 1200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AŞAMA 8: VİLLAYA VARIŞ, DAVID STERLING VE ÇANTA TESLİMİ
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseVillaArrival() {
    this.currentPhase = STORY_PHASES.VILLA_ARRIVAL;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const vx = 395, vy = 12.0, vz = -54;

    // Karakteri limuzinden indir ve villanın ön avlusuna koy
    if (this.character && this.character.body) {
      this.character.body.position.set(vx - 2.0, vy + 1.0, vz - 4.0);
      this.character.mesh.position.set(vx - 2.0, vy, vz - 4.0);
    }

    // Karşılayan David Sterling ve Kaslı Koruma (Çantayı tutan)
    const david = this._buildDavidModel();
    david.position.set(vx + 1.5, vy, vz - 3.8);
    david.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(david);
    this.davidActor = david;

    const guardWithCase = this._buildMuscleGuardModel(true); // Çanta taşıyan koruma
    guardWithCase.position.set(vx + 0.2, vy, vz - 2.5);
    guardWithCase.rotation.y = -Math.PI / 3;
    this.cinematicGroup.add(guardWithCase);

    // Dışarıdaki isyancıları yerleştir (Savaş hedefi)
    this._spawnMissionProtesters(vx, vy, vz);

    // Sinematik Kamera
    this.camera.position.set(vx - 5.0, vy + 2.2, vz - 2.5);
    this.camera.lookAt(vx + 1.5, vy + 1.8, vz - 3.8);

    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Vaktinde geldin. Olayı biliyorsun; kapımdaki bu isyancı ayak takımı servetimi ve canımı tehdit ediyor.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Al bakalım! Özel cephaneliğimin en nadide parçaları bu çantada: Minigun, Lazer, Sniper, Pompalı ve Ağır Tabanca...'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Git ve kapımdaki bütün bu isyancıları temizle! İşini bitirdiğinde gel, ödülünü fazlasıyla alacaksın!'
      }
    ], () => {
      // Silah kilidini aç ve savaşı başlat!
      this.startCombatPhase();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AŞAMA 9: SAVAŞ GÖREVİ (İsyancıları Temizleme)
  // ═══════════════════════════════════════════════════════════════════════════
  startCombatPhase() {
    this.currentPhase = STORY_PHASES.MISSION_COMBAT;
    this.controlsLocked = false;
    this.weaponsLocked = false; // Silahlar açıldı!

    // Minigun ve tüfekleri eline ver
    if (this.weaponSystem) this.weaponSystem.setWeapon(1); // Minigun
    if (this.handWeapons) this.handWeapons.setWeapon(1);

    sound.playCashRegister();
    this.updateCombatMissionHUD();
  }

  _spawnMissionProtesters(vx, vy, vz) {
    this.protesters = [];
    const slogans = ['DEFOL STERLING!', 'PARAMIZI VER!', 'KATİL STERLING!', 'HESAP VERECEKSİN!'];
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 1.5 - 0.4;
      const r = 6.0 + Math.random() * 8.0;
      const px = vx + Math.cos(ang) * r;
      const pz = vz + 2.0 + Math.sin(ang) * r;
      const p = this._buildProtesterModel(slogans[i % slogans.length]);
      p.position.set(px, vy, pz);
      p.userData.isTarget = true;
      p.userData.hp = 100;
      p.userData.baseY = vy;
      this.cinematicGroup.add(p);
      this.protesters.push(p);
    }
  }

  updateCombatMissionHUD() {
    const remaining = this.protesters.filter(p => !p.userData.dead).length;
    if (remaining > 0) {
      this.setMission('VİLLAYI KUŞATAN İSYANCILARI ETKİSİZ HALE GETİR', `Kalan İsyancı Sayısı: ${remaining}`);
    } else {
      this.startVictoryPhase();
    }
  }

  // İsyancılara silah veya yumruk isabet ettiğinde çağrılır
  onHitProtester(protesterMesh) {
    if (!protesterMesh || !protesterMesh.userData || protesterMesh.userData.dead) return;
    protesterMesh.userData.hp = (protesterMesh.userData.hp || 100) - 50;
    if (protesterMesh.userData.hp <= 0) {
      protesterMesh.userData.dead = true;
      sound.playNpcHit();
      // Yere devrilme efekti
      protesterMesh.rotation.x = Math.PI / 2;
      protesterMesh.position.y -= 0.6;
      this.updateCombatMissionHUD();
    }
  }

  // Mermiler ve ışınlar için isabet kontrolü
  checkBulletHit(origin, dir, maxDist = 90) {
    if (this.currentPhase !== STORY_PHASES.MISSION_COMBAT) return null;
    let closest = null, closestDist = maxDist;
    for (const p of this.protesters) {
      if (p.userData.dead) continue;
      const targetPos = p.position.clone().add(new THREE.Vector3(0, 1.3, 0));
      const toP = targetPos.sub(origin);
      const proj = toP.dot(dir);
      if (proj < 0 || proj > closestDist) continue;
      const perp = toP.sub(dir.clone().multiplyScalar(proj)).length();
      if (perp < 0.95) {
        closestDist = proj;
        closest = p;
      }
    }
    if (closest) {
      this.onHitProtester(closest);
      return { point: origin.clone().add(dir.clone().multiplyScalar(closestDist)), protester: closest };
    }
    return null;
  }

  // Çekiç, yumruk, kılıç veya patlama alanları için küresel etki kontrolü
  checkSphereHit(pos, radius = 3.0) {
    if (this.currentPhase !== STORY_PHASES.MISSION_COMBAT) return;
    for (const p of this.protesters) {
      if (p.userData.dead) continue;
      if (p.position.distanceTo(pos) < radius) {
        this.onHitProtester(p);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AŞAMA 10: ZAFER VE DAVID STERLING'İN TEBRİĞİ
  // ═══════════════════════════════════════════════════════════════════════════
  startVictoryPhase() {
    this.currentPhase = STORY_PHASES.MISSION_VICTORY;
    this.controlsLocked = true;

    sound.playLevelWin();
    this.setMission('GÖREV TAMAMLANDI!', 'David Sterling yanınıza geliyor...');

    // David Sterling yanımıza yürür
    const david = this.davidActor;
    if (david && this.character) {
      david.position.set(this.character.mesh.position.x + 2.2, 12.0, this.character.mesh.position.z + 1.5);
      david.lookAt(this.character.mesh.position);
    }

    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Harika bir temizlik! Şehir artık tamamen benim ve senin sayende hiçbir pürüz kalmadı.'
        },
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Söz verdiğim gibi: Silahlar sende kalıyor ve hesabına dağlar kadar para aktarıldı. Şimdi git ve bu şehrin tadını çıkar!'
        }
      ], () => {
        this.controlsLocked = false;
        this.setMission('SERBEST MOD', 'Şehir ve silahlar artık tamamen senin kontrolünde!');
      });
    }, 1500);
  }

  // ── Güncelleme Döngüsü ──
  update(dt, playerPos) {
    this.phaseTimer += dt;

    // Daktilo metin animasyonu
    if (this.isTyping && this.activeDialog) {
      this.typeTimer += dt;
      if (this.typeTimer >= 0.032) {
        this.typeTimer = 0;
        this.charIndex++;
        const fullText = this.activeDialog.text;
        this.dialogTextEl.innerText = fullText.slice(0, this.charIndex);
        sound.playDialogBeep(this.activeDialog.speaker === 'david' ? 160 : 220);

        if (this.charIndex >= fullText.length) {
          this.isTyping = false;
        }
      }
    }

    // Hedef işaretçisi animasyonu (aşağı inme oku yukarı aşağı salınır)
    if (this.waypointMarker && this.waypointMarker.visible) {
      const arrow = this.waypointMarker.userData.arrow;
      if (arrow) {
        arrow.position.y = 3.6 + Math.sin(this.phaseTimer * 4.5) * 0.4;
        arrow.rotation.y += dt * 2.2;
      }
      this.checkPlayerReachedLimoStop(playerPos);
    }

    // Limuzin bekleme süreci
    if (this.currentPhase === STORY_PHASES.WAIT_LIMO) {
      if (!this.limo && this.phaseTimer > 1.5) {
        this._spawnLimoApproaching();
      }
      if (this.limo) {
        // Limuzin bize doğru yanaşır ve durur
        if (this.limo.position.x < -95.0) {
          this.limo.position.x += dt * 14.0;
        } else {
          // Limuzine biniş
          if (this.phaseTimer > 5.0) {
            this.startLimoRide();
          }
        }
      }
    }

    // Limuzin yolculuğu simülasyonu
    if (this.currentPhase === STORY_PHASES.LIMO_RIDE) {
      this._updateLimoRide(dt);
    }

    // İsyancıların pankart sallama ve zıplama animasyonu
    if (this.protesters && this.protesters.length > 0) {
      for (const p of this.protesters) {
        if (p.userData.dead) continue;
        const t = this.phaseTimer * 5.0 + (p.userData.animOffset || 0);
        p.position.y = p.userData.baseY + Math.abs(Math.sin(t)) * 0.28;
        const placard = p.userData.placard;
        if (placard) {
          placard.rotation.z = Math.sin(t * 1.5) * 0.25;
          placard.rotation.x = -Math.sin(t * 1.2) * 0.15;
        }
      }
    }

    // Savaş alanından şehre kaçış engeli (David'in güvenlik bariyeri)
    if (this.currentPhase === STORY_PHASES.MISSION_COMBAT && this.character) {
      // Villa rampasından aşağı şehre kaçmaya çalışırsa (x < 370)
      if (this.character.mesh.position.x < 370) {
        this.character.mesh.position.x = 370.5;
        if (this.character.body) this.character.body.position.x = 370.5;
      }
    }
  }

  _updateLimoRide(dt) {
    if (!this.limo) return;
    this.limoProgress += dt * 0.085; // ~11 saniyede tüm yolu tamamlar

    const points = this.limoPath;
    const totalSegments = points.length - 1;
    const scaledProg = Math.min(1.0, this.limoProgress) * totalSegments;
    const segIdx = Math.floor(scaledProg);
    const frac = scaledProg - segIdx;

    if (segIdx < totalSegments) {
      const pA = points[segIdx], pB = points[segIdx + 1];
      const curX = THREE.MathUtils.lerp(pA.x, pB.x, frac);
      const curY = THREE.MathUtils.lerp(pA.y, pB.y, frac);
      const curZ = THREE.MathUtils.lerp(pA.z, pB.z, frac);

      this.limo.position.set(curX, curY, curZ);
      const dx = pB.x - pA.x, dz = pB.z - pA.z;
      this.limo.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;

      // Oyuncuyu limuzinin arka lüks VIP kabininde tut
      if (this.character && this.character.mesh) {
        this.character.mesh.position.set(curX, curY + 1.2, curZ);
        if (this.character.body) this.character.body.position.set(curX, curY + 1.2, curZ);
      }

      // Kamera limuzin içinden dışarıyı ve karşıdaki korumaları görecek şekilde ayarlanır
      // Oyuncu fareyi hareket ettirerek içeride özgürce etrafa bakabilir
      const yaw = (window._storyCamYaw !== undefined ? window._storyCamYaw : 0);
      const pitch = (window._storyCamPitch !== undefined ? window._storyCamPitch : 0);
      const lookX = -Math.sin(yaw) * Math.cos(pitch);
      const lookY = -Math.sin(pitch);
      const lookZ = -Math.cos(yaw) * Math.cos(pitch);

      this.camera.position.set(curX - 0.4, curY + 1.25, curZ);
      this.camera.lookAt(this.camera.position.x + lookX, this.camera.position.y + lookY, this.camera.position.z + lookZ);
    } else {
      // Villaya ulaşıldı
      this.startPhaseVillaArrival();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3D MODEL OLUŞTURUCULARI (David, Kaslı Koruma, İsyancı, Lüks Limuzin)
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Milyarder David Sterling Modeli (Lüks lacivert takım, altın saat, puro)
  _buildDavidModel() {
    const g = new THREE.Group();
    // Bacaklar (Lacivert pantolon)
    const legMat = MAT(0x0f172a);
    const lLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); lLeg.position.set(-0.2, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); rLeg.position.set(0.2, 0.45, 0); g.add(rLeg);

    // Gövde (Lüks takım ceket, beyaz gömlek, bordo kravat, altın düğmeler)
    const torso = new THREE.Mesh(BOX(0.7, 0.85, 0.42), MAT(0x1e1b4b));
    torso.position.set(0, 1.32, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.65, 0.44), MAT(0x991b1b));
    tie.position.set(0, 1.32, 0.02); g.add(tie);

    // Kafa, Saç ve Yüz Detayları
    const head = new THREE.Mesh(BOX(0.42, 0.44, 0.42), MAT(0xe0ac86));
    head.position.set(0, 1.95, 0); g.add(head);

    const hair = new THREE.Mesh(BOX(0.45, 0.16, 0.44), MAT(0x334155));
    hair.position.set(0, 2.15, 0.01); g.add(hair);

    // Altın çerçeveli gözlük
    const glasses = new THREE.Mesh(BOX(0.38, 0.09, 0.44), MAT(0xfacc15, { metalness: 0.9 }));
    glasses.position.set(0, 1.96, 0.03); g.add(glasses);

    // Kollar
    const lArm = new THREE.Mesh(BOX(0.22, 0.8, 0.22), MAT(0x1e1b4b));
    lArm.position.set(-0.46, 1.3, 0); g.add(lArm);
    const rArm = new THREE.Mesh(BOX(0.22, 0.8, 0.22), MAT(0x1e1b4b));
    rArm.position.set(0.46, 1.3, 0); g.add(rArm);

    return g;
  }

  // 2. Bankalar Birliği Başkanı Arthur Pendelton (Gri takım, gözlük)
  _buildArthurModel() {
    const g = new THREE.Group();
    const matSuit = MAT(0x475569);
    const lLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); lLeg.position.set(-0.18, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); rLeg.position.set(0.18, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.65, 0.8, 0.38), matSuit);
    torso.position.set(0, 1.3, 0); g.add(torso);

    const head = new THREE.Mesh(BOX(0.4, 0.42, 0.4), MAT(0xf1c27d));
    head.position.set(0, 1.9, 0); g.add(head);

    return g;
  }

  // 3. KASLI GÜVENLİK KORUMA (Kırmızı kravat, kollar göğüste kavuşmuş, geniş gövde)
  _buildMuscleGuardModel(hasBriefcase = false) {
    const g = new THREE.Group();
    const blackSuit = MAT(0x020617);
    const redTie = MAT(0xdc2626);
    const skin = MAT(0xd4a373);

    // Geniş kaslı bacaklar
    const lLeg = new THREE.Mesh(BOX(0.36, 1.05, 0.36), blackSuit); lLeg.position.set(-0.25, 0.52, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.36, 1.05, 0.36), blackSuit); rLeg.position.set(0.25, 0.52, 0); g.add(rLeg);

    // Geniş V-Şekilli Kaslı Gövde (Geniş omuzlar)
    const torso = new THREE.Mesh(BOX(0.95, 1.05, 0.52), blackSuit);
    torso.position.set(0, 1.55, 0); g.add(torso);

    // Kırmızı Kravat
    const tie = new THREE.Mesh(BOX(0.16, 0.75, 0.54), redTie);
    tie.position.set(0, 1.55, 0.02); g.add(tie);

    // Kafa, Güneş Gözlüğü ve Telsiz Kulaklığı
    const head = new THREE.Mesh(BOX(0.46, 0.48, 0.46), skin);
    head.position.set(0, 2.3, 0); g.add(head);

    const shades = new THREE.Mesh(BOX(0.42, 0.12, 0.48), MAT(0x000000, { roughness: 0.1 }));
    shades.position.set(0, 2.32, 0.03); g.add(shades);

    if (hasBriefcase) {
      // Çanta taşıyan koruma: Sol kol yanında, sağ elde çelik silah çantası
      const lArm = new THREE.Mesh(BOX(0.28, 0.95, 0.28), blackSuit);
      lArm.position.set(-0.62, 1.45, 0); g.add(lArm);

      const rArm = new THREE.Mesh(BOX(0.28, 0.95, 0.28), blackSuit);
      rArm.position.set(0.62, 1.45, 0); g.add(rArm);

      // Çelik Silah Çantası (Gümüş / Titanyum)
      const briefcase = new THREE.Mesh(BOX(0.22, 0.65, 0.85), MAT(0x94a3b8, { metalness: 0.85, roughness: 0.2 }));
      briefcase.position.set(0.72, 0.9, 0.1);
      g.add(briefcase);
    } else {
      // KOLLAR GÖĞÜSTE KAVUŞMUŞ ("Küsmüş eleman gibi" / Arms Crossed)
      const crossedArmLeft = new THREE.Mesh(BOX(0.85, 0.26, 0.32), blackSuit);
      crossedArmLeft.position.set(0.08, 1.58, 0.34);
      crossedArmLeft.rotation.z = 0.08;
      g.add(crossedArmLeft);

      const crossedArmRight = new THREE.Mesh(BOX(0.85, 0.26, 0.32), blackSuit);
      crossedArmRight.position.set(-0.08, 1.44, 0.38);
      crossedArmRight.rotation.z = -0.08;
      g.add(crossedArmRight);
    }

    return g;
  }

  // 4. İsyancı Halk Modeli (Ellerinde protesto pankartı tutan öfkeli halk)
  _buildProtesterModel(sloganText = 'DEFOL!') {
    const g = new THREE.Group();
    const colors = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0891b2];
    const shirtMat = MAT(colors[Math.floor(Math.random() * colors.length)]);
    const pantMat = MAT(0x334155);
    const skinMat = MAT(0xe0ac86);

    const lLeg = new THREE.Mesh(BOX(0.26, 0.9, 0.26), pantMat); lLeg.position.set(-0.16, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.26, 0.9, 0.26), pantMat); rLeg.position.set(0.16, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.6, 0.8, 0.35), shirtMat);
    torso.position.set(0, 1.3, 0); g.add(torso);

    const head = new THREE.Mesh(BOX(0.38, 0.4, 0.38), skinMat);
    head.position.set(0, 1.9, 0); g.add(head);

    // Kollar yukarı kalkık vaziyette pankartı tutar
    const lArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), shirtMat);
    lArm.position.set(-0.4, 1.65, 0.2);
    lArm.rotation.x = -Math.PI * 0.4;
    g.add(lArm);

    const rArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), shirtMat);
    rArm.position.set(0.4, 1.65, 0.2);
    rArm.rotation.x = -Math.PI * 0.4;
    g.add(rArm);

    // Ahşap sopa ve büyük protesto pankartı
    const placardGroup = new THREE.Group();
    const pole = new THREE.Mesh(BOX(0.08, 2.2, 0.08), MAT(0x78350f));
    pole.position.set(0, 1.1, 0);
    placardGroup.add(pole);

    // Pankart Levhası
    const board = new THREE.Mesh(BOX(1.8, 0.95, 0.06), MAT(0xfef08a)); // Sarı karton
    board.position.set(0, 2.0, 0.05);
    placardGroup.add(board);

    // Pankart üzerindeki kırmızı yasak / slogan şeridi
    const banner = new THREE.Mesh(BOX(1.5, 0.4, 0.08), MAT(0xdc2626));
    banner.position.set(0, 2.0, 0.06);
    placardGroup.add(banner);

    placardGroup.position.set(0, 1.0, 0.35);
    g.add(placardGroup);
    g.userData.placard = placardGroup;

    return g;
  }

  // 5. LÜKS BEYAZ & ALTIN LİMUZİN (Uzun gövde, altın çıtalar, mor LED iç aydınlatma)
  _buildLuxuryLimoModel() {
    const g = new THREE.Group();
    const whiteMat = MAT(0xf8fafc, { roughness: 0.15, metalness: 0.2 });
    const goldMat = MAT(0xf59e0b, { roughness: 0.1, metalness: 0.85 });
    const glassDark = MAT(0x0f172a, { transparent: true, opacity: 0.92, roughness: 0.1 });
    const tireMat = MAT(0x111827, { roughness: 0.8 });

    // Uzun Limuzin Gövdesi (10.5 metre uzunluk, 2.4 metre genişlik)
    const body = new THREE.Mesh(BOX(10.5, 1.25, 2.4), whiteMat);
    body.position.y = 0.85;
    g.add(body);

    // Altın Yan Çıtalar ve Tamponlar
    const goldTrimL = new THREE.Mesh(BOX(10.2, 0.1, 0.06), goldMat);
    goldTrimL.position.set(0, 0.7, 1.22);
    g.add(goldTrimL);

    const goldTrimR = new THREE.Mesh(BOX(10.2, 0.1, 0.06), goldMat);
    goldTrimR.position.set(0, 0.7, -1.22);
    g.add(goldTrimR);

    // Kabin Üstü (Gövde ve Siyah VIP Camlar)
    const cabin = new THREE.Mesh(BOX(7.2, 0.95, 2.15), whiteMat);
    cabin.position.set(-0.4, 1.85, 0);
    g.add(cabin);

    // Koyu VIP Camlar
    const glassL = new THREE.Mesh(BOX(6.8, 0.65, 0.06), glassDark);
    glassL.position.set(-0.4, 1.85, 1.09);
    g.add(glassL);

    const glassR = new THREE.Mesh(BOX(6.8, 0.65, 0.06), glassDark);
    glassR.position.set(-0.4, 1.85, -1.09);
    g.add(glassR);

    // Mor / Amber İç Ambiyans LED Işıkları
    const neonLED = new THREE.PointLight(0xa855f7, 2.5, 4.5);
    neonLED.position.set(-0.5, 1.8, 0);
    g.add(neonLED);

    // Karşı koltukta oturan 2 Kaslı Koruma (Limuzin içinde)
    const guardInLimo1 = this._buildMuscleGuardModel();
    guardInLimo1.scale.setScalar(0.72);
    guardInLimo1.position.set(1.5, 0.65, 0.45);
    guardInLimo1.rotation.y = -Math.PI / 2; // Arka koltuğa, oyuncuya doğru bakar
    g.add(guardInLimo1);

    const guardInLimo2 = this._buildMuscleGuardModel();
    guardInLimo2.scale.setScalar(0.72);
    guardInLimo2.position.set(1.5, 0.65, -0.45);
    guardInLimo2.rotation.y = -Math.PI / 2;
    g.add(guardInLimo2);

    // 6 Adet Altın Jantlı Lüks Tekerlek
    const wheelPositions = [
      [-4.0, 0.42, 1.25], [-4.0, 0.42, -1.25],
      [0.0, 0.42, 1.25], [0.0, 0.42, -1.25],
      [3.8, 0.42, 1.25], [3.8, 0.42, -1.25]
    ];
    for (const [wx, wy, wz] of wheelPositions) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.35, 18), tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(wx, wy, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 12), goldMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, wy, wz);
      g.add(tire);
      g.add(hub);
    }

    return g;
  }
}
