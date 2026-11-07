import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// ATAHAN ŞEHİR HİKAYESİ & SİNEMATİK GÖREV YÖNETİCİSİ (STORY ENGINE V3)
// ─────────────────────────────────────────────────────────────────────────────
// Özellikler:
//  • 4. Kat Özel Yönetim Kurulu Salonu (Hiçbir bina veya yaya görüşü kapatmaz).
//  • David Sterling: Kare kafa, SİYAH GÜNEŞ GÖZLÜĞÜ, lacivert takım, kırmızı kravatlı kaslı korumalar.
//  • Arthur Pendelton: Kare kafa, gözlüklü, KAŞSIZ, MUTLU TEBESSÜM EDEN bankacı.
//  • Arthur'un Güvenlikleri: Lacivert üniforma, açık mavi kravat, gümüş rozetli korumalar.
//  • Uzatılmış, sürükleyici anlaşma diyalogları (Doğrudan masada başlar, bekleme yok).
//  • Villaya Drone Kuş Bakışı Kamera geçişi (Halk isyanı & canlı yayın aracı).
//  • David Sterling telefon görüşmesi ve "Tamam, geliyoruz." yanıtımız.
// ─────────────────────────────────────────────────────────────────────────────

export const STORY_PHASES = {
  NONE: 0,
  CINEMATIC_BOARDROOM: 1,    // Sahne 1: 4. Katta David & Arthur lüks masa toplantısı
  CINEMATIC_DRONE_PROTEST: 2,// Sahne 2: Drone kamerası ile gökyüzünden kuş bakışı villadaki isyan
  PHONE_CALL: 3,             // Sahne 3: David'in araması & "Tamam geliyoruz" cevabımız
  TV_NEWS_MORNING: 4,        // Sahne 4: Salondaki TV ve kontrollerin açılması (Evden çık görevi)
  WAIT_LIMO: 5,              // Caddedeki limuzine biniş
  LIMO_RIDE: 6,              // Limuzin içi: Mor neon, 2 kaslı koruma, köprü yolculuğu
  VILLA_ARRIVAL: 7,          // Villaya varış, David ve sağında-solunda korumaları, silah çantası teslimi
  MISSION_COMBAT: 8,         // Görev: Villayı kuşatan isyancıları temizleme
  MISSION_VICTORY: 9         // Zafer ve David'in tebriği
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
    this.protesters = [];
    this.muscleGuards = [];
    this.davidActor = null;
    this.arthurActor = null;
    this.newsVan = null;

    // Drone kamera açısı
    this.droneAngle = 0;

    // Limuzin yolu (Waypoints)
    this.limoPath = [
      { x: -95, y: 0.5, z: 2.1 },
      { x: -40, y: 0.5, z: 2.1 },
      { x: -12, y: 0.5, z: 2.1 },   // Köprü girişi
      { x: 120, y: 0.5, z: 2.1 },   // Köprü ortası
      { x: 258, y: 0.5, z: 2.1 },   // Köprü çıkışı
      { x: 321, y: 0.5, z: 2.1 },   // Villa yolu başlangıcı
      { x: 350, y: 3.5, z: -15 },   // Villa rampası
      { x: 380, y: 8.5, z: -38 },   // Villa virajı
      { x: 395, y: 12.0, z: -54 }   // Villa kapısı önü
    ];
    this.limoProgress = 0;

    // Zemin hedef göstergesi
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
      container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,monospace;';
      document.body.appendChild(container);
    }
    this.uiContainer = container;

    // Karartma perdesi (Fade overlay)
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;transition:opacity 0.6s ease;pointer-events:none;z-index:99998;';
    container.appendChild(fade);
    this.fadeOverlay = fade;

    // Skip (Geç) Butonu
    const skip = document.createElement('button');
    skip.id = 'story-skip-btn';
    skip.innerHTML = '⏭ GEÇ (SKIP)';
    skip.style.cssText = `
      position: absolute; top: 24px; right: 28px;
      padding: 12px 24px; background: rgba(15, 23, 42, 0.95);
      color: #facc15; border: 2px solid #eab308; border-radius: 8px;
      font-size: 15px; font-weight: 800; letter-spacing: 1px;
      cursor: pointer; pointer-events: auto; opacity: 0; z-index: 100001;
      box-shadow: 0 4px 24px rgba(0,0,0,0.8);
      transition: opacity 0.3s, transform 0.15s, background 0.2s;
    `;
    skip.onmouseenter = () => { skip.style.background = '#eab308'; skip.style.color = '#000'; };
    skip.onmouseleave = () => { skip.style.background = 'rgba(15, 23, 42, 0.95)'; skip.style.color = '#facc15'; };
    skip.onclick = (e) => {
      e.stopPropagation();
      sound.playUiBeep();
      this.skipCurrentCinematic();
    };
    container.appendChild(skip);
    this.skipButton = skip;

    window.addEventListener('mousedown', () => {
      if (this.controlsLocked && this.currentPhase !== STORY_PHASES.NONE && this.currentPhase !== STORY_PHASES.MISSION_COMBAT) {
        this.showSkipButton(true);
      }
    });

    // Görev Bildirim HUD'u
    const hud = document.createElement('div');
    hud.id = 'story-mission-hud';
    hud.style.cssText = `
      position: absolute; top: 80px; right: 28px;
      background: rgba(10, 15, 30, 0.95); border-left: 5px solid #38bdf8;
      border-radius: 6px; padding: 14px 20px; color: #fff;
      box-shadow: 0 6px 28px rgba(0,0,0,0.7); display: none;
      min-width: 270px; max-width: 390px; pointer-events: none; z-index: 100000;
    `;
    hud.innerHTML = `
      <div style="font-size:11px;font-weight:900;color:#38bdf8;letter-spacing:1.5px;margin-bottom:4px;">AKTİF GÖREV</div>
      <div id="story-mission-title" style="font-size:16px;font-weight:700;color:#f8fafc;line-height:1.3;">Evden Çık</div>
      <div id="story-mission-desc" style="font-size:13px;color:#94a3b8;margin-top:4px;">Merdivenlerden aşağı in ve caddedeki limuzine git.</div>
    `;
    container.appendChild(hud);
    this.missionHud = hud;

    // Undertale Tarzı Net & Görünür Retro Diyalog Kutusu
    const dbox = document.createElement('div');
    dbox.id = 'story-dialog-box';
    dbox.style.cssText = `
      position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
      width: 840px; max-width: 94vw; min-height: 165px;
      background: rgba(4, 7, 15, 0.98); border: 4px double #ffffff; border-radius: 10px;
      padding: 18px 24px; display: none; pointer-events: auto; z-index: 100002;
      box-shadow: 0 12px 50px rgba(0,0,0,0.95), 0 0 25px rgba(255,255,255,0.15);
      font-family: 'Courier New', Courier, monospace;
      color: #ffffff; cursor: pointer; user-select: none;
    `;
    dbox.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:22px;">
        <div id="story-speaker-avatar" style="width:115px;height:115px;background:#090d16;border:3px solid #64748b;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <!-- SVG Kare Kafa Portre -->
        </div>
        <div style="flex:1;">
          <div id="story-speaker-name" style="font-size:19px;font-weight:900;color:#facc15;letter-spacing:1px;margin-bottom:8px;text-transform:uppercase;">DAVID STERLING</div>
          <div id="story-dialog-text" style="font-size:17px;line-height:1.55;color:#f8fafc;min-height:60px;">...</div>
        </div>
      </div>
      <div id="story-dialog-indicator" style="position:absolute;bottom:12px;right:20px;font-size:14px;color:#facc15;animation:blink 0.8s infinite;">▼ Tıkla / [Space]</div>
    `;
    dbox.onclick = () => this.advanceDialog();
    container.appendChild(dbox);

    this.dialogBox = dbox;
    this.dialogTextEl = dbox.querySelector('#story-dialog-text');
    this.dialogSpeakerEl = dbox.querySelector('#story-speaker-name');
    this.dialogPortraitEl = dbox.querySelector('#story-speaker-avatar');

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

  _createWaypointMarker() {
    const group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(1.8, 2.4, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    group.add(new THREE.Mesh(ringGeo, ringMat));

    const colGeo = new THREE.CylinderGeometry(1.8, 1.8, 5.0, 24, 1, true);
    const colMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const colMesh = new THREE.Mesh(colGeo, colMat);
    colMesh.position.y = 2.5;
    group.add(colMesh);

    const arrowCone = new THREE.ConeGeometry(0.8, 1.4, 16);
    arrowCone.rotateX(Math.PI);
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xd97706, emissiveIntensity: 0.6 });
    const arrowMesh = new THREE.Mesh(arrowCone, arrowMat);
    arrowMesh.position.y = 3.6;
    group.add(arrowMesh);
    group.userData.arrow = arrowMesh;

    group.position.set(-95.2, 0.6, 6.2);
    group.visible = false;
    this.scene.add(group);
    this.waypointMarker = group;
  }

  // ── Undertale Kare Kafa Portre Çizimi (Voxel / Teardown Stili) ──
  _getPortraitSVG(speaker) {
    if (speaker === 'david') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <!-- David Sterling: KARE KAFA, SİYAH GÜNEŞ GÖZLÜĞÜ -->
          <rect width="100" height="100" fill="#090d16"/>
          <!-- Kare Kafa Ten -->
          <rect x="20" y="16" width="60" height="60" fill="#d4a373"/>
          <!-- Kare Siyah Saç -->
          <rect x="18" y="12" width="64" height="22" fill="#1e293b"/>
          <rect x="18" y="24" width="8" height="20" fill="#1e293b"/>
          <rect x="74" y="24" width="8" height="20" fill="#1e293b"/>
          <!-- SİYAH GÜNEŞ GÖZLÜĞÜ (Kullanıcı Talebi: Siyah olsun) -->
          <rect x="25" y="37" width="22" height="15" fill="#000000" stroke="#111111" stroke-width="2.5"/>
          <rect x="53" y="37" width="22" height="15" fill="#000000" stroke="#111111" stroke-width="2.5"/>
          <rect x="47" y="42" width="6" height="3" fill="#000000"/>
          <!-- Kare Burun -->
          <rect x="46" y="54" width="8" height="8" fill="#bc8a5f"/>
          <!-- Kare Sinsi Bıyık & Sakal -->
          <rect x="38" y="64" width="24" height="4" fill="#1e293b"/>
          <rect x="45" y="68" width="10" height="8" fill="#1e293b"/>
          <!-- Omuzlar & Kırmızı Kravat -->
          <rect x="10" y="78" width="80" height="22" fill="#0f172a"/>
          <rect x="44" y="78" width="12" height="22" fill="#dc2626"/>
        </svg>
      `;
    } else if (speaker === 'player') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <!-- Oyuncu Karakter: KARE KAFA (Voxel stili) -->
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="18" width="60" height="60" fill="#ffdbac"/>
          <rect x="18" y="12" width="64" height="20" fill="#4a2f13"/>
          <rect x="18" y="22" width="8" height="14" fill="#4a2f13"/>
          <rect x="30" y="42" width="10" height="10" fill="#2563eb"/>
          <rect x="60" y="42" width="10" height="10" fill="#2563eb"/>
          <rect x="33" y="44" width="4" height="4" fill="#ffffff"/>
          <rect x="63" y="44" width="4" height="4" fill="#ffffff"/>
          <rect x="42" y="64" width="16" height="5" fill="#991b1b"/>
          <rect x="12" y="80" width="76" height="20" fill="#1d4ed8"/>
        </svg>
      `;
    } else if (speaker === 'arthur') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <!-- Arthur Pendelton: KARE KAFA, GÖZLÜKLÜ, KAŞSIZ, MUTLU GÜLEN YÜZ -->
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="18" width="60" height="60" fill="#f1c27d"/>
          <rect x="18" y="14" width="64" height="18" fill="#94a3b8"/>
          <!-- Mavi Çerçeveli Kare Gözlük (KAŞSIZ!) -->
          <rect x="27" y="38" width="18" height="16" fill="none" stroke="#0284c7" stroke-width="3"/>
          <rect x="55" y="38" width="18" height="16" fill="none" stroke="#0284c7" stroke-width="3"/>
          <rect x="45" y="44" width="10" height="3" fill="#0284c7"/>
          <!-- Mutlu Kısık Gözler -->
          <path d="M30 46 Q36 41 42 46" stroke="#000" stroke-width="3" fill="none"/>
          <path d="M58 46 Q64 41 70 46" stroke="#000" stroke-width="3" fill="none"/>
          <!-- KOCAMAN MUTLU GÜLÜMSEME -->
          <path d="M36 58 Q50 76 64 58 Z" fill="#b91c1c"/>
          <rect x="42" y="59" width="16" height="4" fill="#ffffff"/>
          <!-- Lacivert Ceket & Açık Mavi Kravat -->
          <rect x="12" y="80" width="76" height="20" fill="#1e3a8a"/>
          <rect x="44" y="80" width="12" height="20" fill="#38bdf8"/>
        </svg>
      `;
    } else if (speaker === 'news') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <rect width="100" height="100" fill="#1e3a8a"/>
          <rect x="22" y="20" width="56" height="56" fill="#fbcfe8"/>
          <rect x="18" y="14" width="64" height="20" fill="#fde047"/>
          <circle cx="42" cy="48" r="4" fill="#1e293b"/>
          <circle cx="58" cy="48" r="4" fill="#1e293b"/>
          <path d="M42 62 Q50 68 58 62" fill="none" stroke="#be185d" stroke-width="3"/>
          <polygon points="20,100 35,78 65,78 80,100" fill="#be123c"/>
          <circle cx="76" cy="80" r="8" fill="#475569"/>
        </svg>
      `;
    }
    return '';
  }

  // ── Diyalog Akışı ──
  startDialogQueue(queue, onComplete) {
    this.dialogQueue = queue;
    this.onDialogComplete = onComplete;
    this.dialogIndex = -1;
    this.dialogBox.style.display = 'block';
    this.advanceDialog();
  }

  advanceDialog() {
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

    // Sinematik boyunca sokaktaki rastgele yayaları gizle (sahneye girmesinler)
    if (this.voxelWorld && this.voxelWorld.npcs && this.voxelWorld.npcs.npcs) {
      this.voxelWorld.npcs.npcs.forEach(n => { if (n.group) n.group.visible = false; });
    }

    this.startPhaseBoardroomMeeting();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 1: 4. KAT ÖZEL YÖNETİM SALONU - DOĞRUDAN MASADA ANLAŞMA
  // (Önünde bina yok, yaya yok, içeriden net görüş)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseBoardroomMeeting() {
    this.currentPhase = STORY_PHASES.CINEMATIC_BOARDROOM;
    this.phaseTimer = 0;
    this.showSkipButton(true);

    // 4. Kat Yüksekliği: y = 35.0 m (Şehir binalarının çok üstünde, panoramik açık hava)
    const rx = 0, ry = 35.0, rz = 0;
    this._buildHighBoardroomScene(rx, ry, rz);

    // Kamera: Salonun içinde masaya 3.4 metre mesafede, doğrudan David ve Arthur'u net görür!
    this.camera.position.set(rx, ry + 1.85, rz + 3.4);
    this.camera.lookAt(rx, ry + 1.45, rz);

    sound.playCinematicBoom();

    // DOĞRUDAN UZATILMIŞ DİYALOG BAŞLAR (Bekleme yok!)
    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Şehrin bütün finansal omurgası... 4 büyük banka, 12 şube ve halkın trilyonluk vadeli mevduatları. Belgeleri hazırladın mı Arthur?'
      },
      {
        speaker: 'arthur', name: 'ARTHUR PENDELTON (BANKALAR BİRLİĞİ)', color: '#38bdf8',
        text: 'Her şey hazırlandı Bay Sterling! Sözleşmeyi imzaladığınız an, Merkez Finans Birliği tüm hesapların tek imza yetkisini size devredecek.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'İşte karşılığında vaat ettiğim çek. Bu meblağ seni hayatının sonuna kadar dünyanın en lüks adalarında krallar gibi yaşatır.'
      },
      {
        speaker: 'arthur', name: 'ARTHUR PENDELTON', color: '#38bdf8',
        text: 'Muazzam bir servet... Ancak halk bankalardaki birikimlerine el koyduğunuzu ve faizlerin dondurulduğunu öğrenirse sokaklar fena karışır!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Bırak sokaklar karışsın Arthur! Parayı yöneten, kanunu da yönetir. Bu şehirde kuralları artık halk değil, ben belirlerim!'
      },
      {
        speaker: 'arthur', name: 'ARTHUR PENDELTON', color: '#38bdf8',
        text: 'O halde anlaşma tamamlandı! Tüm kasa anahtarları ve yetki devri sizindir. Ortaklığımız hayırlı olsun Bay Sterling!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Halk sadece sızlanmayı bilir. Artık bu şehrin tek bir efendisi var: David Sterling!'
      }
    ], () => {
      // Sahne 2: Drone Kuş Bakışı İsyan Sahnesi
      this.setFade(1, 400);
      setTimeout(() => {
        this.startPhaseDroneProtest();
      }, 450);
    });
  }

  _buildHighBoardroomScene(rx, ry, rz) {
    this.cinematicGroup.clear();

    const whiteMarble = MAT(0xf8fafc, { roughness: 0.15 });
    const glassMat = MAT(0x38bdf8, { transparent: true, opacity: 0.35, roughness: 0.1 });
    const woodMat = MAT(0x1e293b, { roughness: 0.25 });
    const goldMat = MAT(0xfacc15, { metalness: 0.9, roughness: 0.15 });

    // 1. Odanın Zemin Tabliyesi (Beyaz Mermer)
    const floor = new THREE.Mesh(BOX(18, 0.4, 14), whiteMarble);
    floor.position.set(rx, ry, rz);
    this.cinematicGroup.add(floor);

    // 2. Tavan ve Şık Beyaz Sütunlar
    const ceiling = new THREE.Mesh(BOX(18, 0.4, 14), whiteMarble);
    ceiling.position.set(rx, ry + 4.2, rz);
    this.cinematicGroup.add(ceiling);

    // Arka Panoramik Cam Duvar (Gökyüzü manzaralı)
    const glassWall = new THREE.Mesh(BOX(17.8, 3.8, 0.2), glassMat);
    glassWall.position.set(rx, ry + 2.0, rz - 6.5);
    this.cinematicGroup.add(glassWall);

    // 3. Lüks Yönetim Masası
    const table = new THREE.Mesh(BOX(3.8, 0.9, 1.8), woodMat);
    table.position.set(rx, ry + 0.45, rz);
    this.cinematicGroup.add(table);

    // Altın Para Çantası ve Resmi Sözleşme Dosyaları
    const briefcase = new THREE.Mesh(BOX(0.85, 0.25, 0.55), goldMat);
    briefcase.position.set(rx, ry + 0.9 + 0.12, rz);
    this.cinematicGroup.add(briefcase);

    for (let i = -1; i <= 1; i += 0.8) {
      const doc = new THREE.Mesh(BOX(0.5, 0.05, 0.4), MAT(0xffffff));
      doc.position.set(rx + i * 0.7, ry + 0.9 + 0.03, rz + 0.3);
      this.cinematicGroup.add(doc);
    }

    // 4. Milyarder David Sterling (Masanın solunda, SİYAH GÜNEŞ GÖZLÜKLÜ)
    const david = this._buildDavidModel();
    david.position.set(rx - 1.4, ry, rz);
    david.rotation.y = Math.PI / 2;
    this.cinematicGroup.add(david);
    this.davidActor = david;

    // David'in 2 Kırmızı Kravatlı KASLI KORUMASI (David'in arkasında, kollar göğüste kavuşmuş)
    const dg1 = this._buildMuscleGuardModel();
    dg1.position.set(rx - 2.5, ry, rz - 0.9);
    dg1.rotation.y = Math.PI * 0.4;
    this.cinematicGroup.add(dg1);

    const dg2 = this._buildMuscleGuardModel();
    dg2.position.set(rx - 2.5, ry, rz + 0.9);
    dg2.rotation.y = Math.PI * 0.6;
    this.cinematicGroup.add(dg2);

    // 5. Arthur Pendelton (Masanın sağında, GÖZLÜKLÜ, KAŞSIZ, MUTLU TEBESSÜM EDEN)
    const arthur = this._buildArthurHappyModel();
    arthur.position.set(rx + 1.4, ry, rz);
    arthur.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(arthur);
    this.arthurActor = arthur;

    // Arthur'un 2 Kendi Güvenliği (Lacivert Üniforma, Açık Mavi Kravat, Gümüş Rozet)
    const ag1 = this._buildArthurGuardModel();
    ag1.position.set(rx + 2.5, ry, rz - 0.9);
    ag1.rotation.y = -Math.PI * 0.4;
    this.cinematicGroup.add(ag1);

    const ag2 = this._buildArthurGuardModel();
    ag2.position.set(rx + 2.5, ry, rz + 0.9);
    ag2.rotation.y = -Math.PI * 0.6;
    this.cinematicGroup.add(ag2);

    // Tavandan yumuşak lüks spot aydınlatma
    const light = new THREE.PointLight(0xfffbeb, 2.5, 12);
    light.position.set(rx, ry + 3.8, rz);
    this.cinematicGroup.add(light);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 2: DRONE İLE KUŞ BAKIŞI VİLLADAKİ İSYAN VE HABER ARACI
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseDroneProtest() {
    this.currentPhase = STORY_PHASES.CINEMATIC_DRONE_PROTEST;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const vx = 395, vy = 12.0, vz = -54;
    this._buildProtestScene(vx, vy, vz);

    // DRONE KAMERASI: Gökyüzünde kuş bakışı başlar
    this.camera.position.set(vx + 34, vy + 30, vz + 36);
    this.camera.lookAt(vx, vy + 2.0, vz);

    this.setFade(0, 600);
    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'news', name: 'CANLI DRONE HABER YAYINI', color: '#f43f5e',
        text: 'SON DAKİKA: David Sterling’in şehirdeki tüm bankaları gizlice devraldığı haberi duyuldu! Öfkeli halk Sterling Malikanesi’ni kuşattı!'
      },
      {
        speaker: 'news', name: 'CANLI YAYIN MUHABİRİ', color: '#f43f5e',
        text: 'Drone kameralarımız villanın kapısındaki dev kalabalığı görüntülüyor. Halk paralarını geri istiyor, güvenlik barikatı zorlanıyor!'
      }
    ], () => {
      // Sahne 3: Telefon görüşmesi
      this.startPhasePhoneCall();
    });
  }

  _buildProtestScene(vx, vy, vz) {
    // Canlı Yayın Haber Aracı (TV News Van)
    const van = new THREE.Group();
    const vanBody = new THREE.Mesh(BOX(5.2, 2.4, 2.2), MAT(0x1e293b));
    vanBody.position.y = 1.2;
    van.add(vanBody);

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

    // Pankartlı İsyancılar (Kullanıcı Talebi: David'in villası önünde çok fazla halk/kalabalık olsun)
    this.protesters = [];
    const slogans = ['DEFOL STERLING!', 'PARALARIMIZI VER!', 'HIRSIZ STERLING!', 'BANKALARI BIRAK!', 'HAKKIMIZI YEDİRMEYİZ!', 'YALANCI PATRON!'];
    for (let i = 0; i < 32; i++) {
      const row = Math.floor(i / 11);
      const col = i % 11;
      const ang = (col / 10) * Math.PI * 0.85 - 0.25;
      const r = 4.2 + row * 2.8 + (Math.random() - 0.5) * 1.2;
      const px = vx + Math.cos(ang) * r;
      const pz = vz + 2.5 + Math.sin(ang) * r;
      const p = this._buildProtesterModel(slogans[i % slogans.length]);
      p.position.set(px, vy, pz);
      p.rotation.y = Math.PI + (Math.random() - 0.5) * 0.6;
      p.userData.baseY = vy;
      p.userData.animOffset = Math.random() * 12;
      this.cinematicGroup.add(p);
      this.protesters.push(p);
    }

    // Villayı koruyan David'in 3 Kaslı Koruması (Kırmızı kravatlı)
    for (let i = -1; i <= 1; i++) {
      const g = this._buildMuscleGuardModel();
      g.position.set(vx + i * 2.8, vy, vz - 1.5);
      g.rotation.y = 0;
      this.cinematicGroup.add(g);
      this.muscleGuards.push(g);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 3: TELEFON GÖRÜŞMESİ (David Arar, Biz "Tamam Geliyoruz" Deriz)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhasePhoneCall() {
    this.currentPhase = STORY_PHASES.PHONE_CALL;
    this.phaseTimer = 0;

    sound.playPhoneRing();

    const vx = 395, vy = 12.0, vz = -54;
    const davidWithPhone = this._buildDavidWithPhoneModel();
    davidWithPhone.position.set(vx, vy, vz - 4.5);
    this.cinematicGroup.add(davidWithPhone);

    this.camera.position.set(vx - 2.8, vy + 2.2, vz - 3.2);
    this.camera.lookAt(vx, vy + 1.8, vz - 4.5);

    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (TELEFON)', color: '#facc15',
        text: 'Alo! Beni duyabiliyor musun? Bankaları devraldık ama bu aptal halk kapıma dayandı, villamı kuşattılar!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Hemen Doğu Ada’daki villama gel. Bu isyancıları temizle; sana dağlar kadar servet ve özel askeri cephaneliğimi vereceğim!'
      },
      {
        speaker: 'player', name: 'SEN (OYUNCU)', color: '#38bdf8',
        text: 'Tamam, geliyoruz.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Harika! Özel altın limuzinim evinin önündeki caddede seni bekliyor, acele et!'
      }
    ], () => {
      this.setFade(1, 500);
      setTimeout(() => {
        this.startPhaseTvNewsMorning();
      }, 550);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 4: EVDEN ÇIKIŞ VE KONTROLLERİN AÇILMASI
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseTvNewsMorning() {
    this.currentPhase = STORY_PHASES.TV_NEWS_MORNING;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    // Yayaları tekrar görünür yap
    if (this.voxelWorld && this.voxelWorld.npcs && this.voxelWorld.npcs.npcs) {
      this.voxelWorld.npcs.npcs.forEach(n => { if (n.group) n.group.visible = true; });
    }

    const spawnPos = { x: -110.25, y: 7.05, z: 19.75 };
    if (this.character && this.character.body) {
      this.character.body.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      this.character.vel.set(0, 0, 0);
      this.character.mesh.position.set(spawnPos.x, spawnPos.y - 0.525, spawnPos.z);
    }

    this.camera.position.set(spawnPos.x, spawnPos.y + 0.6, spawnPos.z);
    this.camera.lookAt(spawnPos.x + 3.0, spawnPos.y + 0.6, spawnPos.z);

    this.setFade(0, 800);
    this.showSkipButton(false);

    this.controlsLocked = false;
    this.weaponsLocked = true;

    this.setMission('EVDEN ÇIK VE LİMUZİNE BİN', 'Merdivenlerden aşağı in ve caddedeki altın limuzine ulaş.');

    if (this.waypointMarker) {
      this.waypointMarker.visible = true;
    }
  }

  skipCurrentCinematic() {
    this.dialogBox.style.display = 'none';
    this.setFade(0, 300);
    this.startPhaseTvNewsMorning();
  }

  checkPlayerReachedLimoStop(playerPos) {
    if (this.currentPhase !== STORY_PHASES.TV_NEWS_MORNING) return;
    const dist = Math.hypot(playerPos.x - (-95.2), playerPos.z - 6.2);
    if (dist < 4.0) {
      this.currentPhase = STORY_PHASES.WAIT_LIMO;
      this.phaseTimer = 0;
      if (this.waypointMarker) this.waypointMarker.visible = false;

      this.setMission('LİMUZİNE BİNİLİYOR...', 'David Sterling’in altın beyaz limuzini bekliyor.');
      sound.playUiBeep();
    }
  }

  _spawnLimoWaitingOnStreet() {
    if (this.limo) this.scene.remove(this.limo);
    const limo = this._buildLuxuryLimoModel();
    limo.position.set(-95.0, 0.5, 2.1);
    limo.rotation.y = 0;
    this.scene.add(limo);
    this.limo = limo;
  }

  startLimoRide() {
    this.currentPhase = STORY_PHASES.LIMO_RIDE;
    this.phaseTimer = 0;
    this.limoProgress = 0;
    this.controlsLocked = true;

    sound.playLimoDoor();
    this.setMission('LİMUZİN İLE SEYAHAT', 'David Sterling’in korumalarıyla Doğu Ada’daki malikaneye gidiyorsunuz.');

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

  startPhaseVillaArrival() {
    this.currentPhase = STORY_PHASES.VILLA_ARRIVAL;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const vx = 395, vy = 12.0, vz = -54;

    if (this.character && this.character.body) {
      this.character.body.position.set(vx - 2.0, vy + 1.0, vz - 4.0);
      this.character.mesh.position.set(vx - 2.0, vy, vz - 4.0);
    }

    // David Sterling (Ortada, SİYAH GÜNEŞ GÖZLÜKLÜ)
    const david = this._buildDavidModel();
    david.position.set(vx + 1.5, vy, vz - 3.8);
    david.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(david);
    this.davidActor = david;

    // David'in Sağında Koruması (Çantayı tutan)
    const guardR = this._buildMuscleGuardModel(true);
    guardR.position.set(vx + 1.5, vy, vz - 2.4);
    guardR.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(guardR);

    // David'in Solunda Koruması (Kolları bağlı)
    const guardL = this._buildMuscleGuardModel(false);
    guardL.position.set(vx + 1.5, vy, vz - 5.2);
    guardL.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(guardL);

    this._spawnMissionProtesters(vx, vy, vz);

    this.camera.position.set(vx - 5.0, vy + 2.2, vz - 3.8);
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
      this.startCombatPhase();
    });
  }

  startCombatPhase() {
    this.currentPhase = STORY_PHASES.MISSION_COMBAT;
    this.controlsLocked = false;
    this.weaponsLocked = false;

    if (this.weaponSystem) this.weaponSystem.setWeapon(1);
    if (this.handWeapons) this.handWeapons.setWeapon(1);

    sound.playCashRegister();
    this.updateCombatMissionHUD();
  }

  _spawnMissionProtesters(vx, vy, vz) {
    this.protesters = [];
    const slogans = ['DEFOL STERLING!', 'PARAMIZI VER!', 'KATİL STERLING!', 'HESAP VERECEKSİN!', 'HAKKIMIZI YEDİRMEYİZ!', 'YALANCI PATRON!'];
    for (let i = 0; i < 32; i++) {
      const row = Math.floor(i / 11);
      const col = i % 11;
      const ang = (col / 10) * Math.PI * 0.9 - 0.3;
      const r = 4.8 + row * 2.8 + (Math.random() - 0.5) * 1.2;
      const px = vx + Math.cos(ang) * r;
      const pz = vz + 2.2 + Math.sin(ang) * r;
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

  onHitProtester(protesterMesh) {
    if (!protesterMesh || !protesterMesh.userData || protesterMesh.userData.dead) return;
    protesterMesh.userData.hp = (protesterMesh.userData.hp || 100) - 50;
    if (protesterMesh.userData.hp <= 0) {
      protesterMesh.userData.dead = true;
      sound.playNpcHit();
      protesterMesh.rotation.x = Math.PI / 2;
      protesterMesh.position.y -= 0.6;
      this.updateCombatMissionHUD();
    }
  }

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

  checkSphereHit(pos, radius = 3.0) {
    if (this.currentPhase !== STORY_PHASES.MISSION_COMBAT) return;
    for (const p of this.protesters) {
      if (p.userData.dead) continue;
      if (p.position.distanceTo(pos) < radius) {
        this.onHitProtester(p);
      }
    }
  }

  startVictoryPhase() {
    this.currentPhase = STORY_PHASES.MISSION_VICTORY;
    this.controlsLocked = true;

    sound.playLevelWin();
    this.setMission('GÖREV TAMAMLANDI!', 'David Sterling yanınıza geliyor...');

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

    // Sahne 1: 4. Katta Masaya Hafif Sinematik Yavaş Kamera Yaklaşması (Unobstructed View)
    if (this.currentPhase === STORY_PHASES.CINEMATIC_BOARDROOM) {
      const rx = 0, ry = 35.0, rz = 0;
      const zoomT = Math.min(1.0, this.phaseTimer * 0.04);
      const camZ = 3.4 - zoomT * 0.45; // 3.4m'den 2.95m'ye yumuşak yaklaşma
      this.camera.position.set(rx, ry + 1.85, rz + camZ);
      this.camera.lookAt(rx, ry + 1.45, rz);
    }

    // Sahne 2: Drone Kuş Bakışı Kamera Hareketi
    if (this.currentPhase === STORY_PHASES.CINEMATIC_DRONE_PROTEST) {
      this.droneAngle += dt * 0.22;
      const vx = 395, vy = 12.0, vz = -54;
      const camR = 26 + Math.sin(this.droneAngle * 0.8) * 6;
      const camH = vy + 22 - Math.min(10, this.phaseTimer * 1.5);
      this.camera.position.set(
        vx + Math.cos(this.droneAngle) * camR,
        camH,
        vz + Math.sin(this.droneAngle) * camR
      );
      this.camera.lookAt(vx, vy + 2.0, vz);
    }

    // Hedef işaretçisi animasyonu
    if (this.waypointMarker && this.waypointMarker.visible) {
      const arrow = this.waypointMarker.userData.arrow;
      if (arrow) {
        arrow.position.y = 3.6 + Math.sin(this.phaseTimer * 4.5) * 0.4;
        arrow.rotation.y += dt * 2.2;
      }
      this.checkPlayerReachedLimoStop(playerPos);
    }

    // Limuzin bekleme ve biniş
    if (this.currentPhase === STORY_PHASES.WAIT_LIMO) {
      if (!this.limo) {
        this._spawnLimoWaitingOnStreet();
      }
      if (this.phaseTimer > 1.8) {
        this.startLimoRide();
      }
    }

    // Limuzin yolculuğu
    if (this.currentPhase === STORY_PHASES.LIMO_RIDE) {
      this._updateLimoRide(dt);
    }

    // İsyancıların pankart sallama animasyonu
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

    // Kaçış engeli
    if (this.currentPhase === STORY_PHASES.MISSION_COMBAT && this.character) {
      if (this.character.mesh.position.x < 370) {
        this.character.mesh.position.x = 370.5;
        if (this.character.body) this.character.body.position.x = 370.5;
      }
    }
  }

  _updateLimoRide(dt) {
    if (!this.limo) return;
    this.limoProgress += dt * 0.085;

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

      if (this.character && this.character.mesh) {
        this.character.mesh.position.set(curX, curY + 1.2, curZ);
        if (this.character.body) this.character.body.position.set(curX, curY + 1.2, curZ);
      }

      const yaw = (window._storyCamYaw !== undefined ? window._storyCamYaw : 0);
      const pitch = (window._storyCamPitch !== undefined ? window._storyCamPitch : 0);
      const lookX = -Math.sin(yaw) * Math.cos(pitch);
      const lookY = -Math.sin(pitch);
      const lookZ = -Math.cos(yaw) * Math.cos(pitch);

      this.camera.position.set(curX - 0.4, curY + 1.25, curZ);
      this.camera.lookAt(this.camera.position.x + lookX, this.camera.position.y + lookY, this.camera.position.z + lookZ);
    } else {
      this.startPhaseVillaArrival();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3D MODELLER (Siyah Gözlüklü David, Mutlu Arthur, Farklı Korumalar, Limuzin)
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. Milyarder David Sterling (Kare Kafa, SİYAH GÜNEŞ GÖZLÜKLÜ, Lüks Takım)
  _buildDavidModel() {
    const g = new THREE.Group();
    const legMat = MAT(0x0f172a);
    const lLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); lLeg.position.set(-0.2, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); rLeg.position.set(0.2, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.7, 0.85, 0.42), MAT(0x1e1b4b));
    torso.position.set(0, 1.32, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.65, 0.44), MAT(0x991b1b));
    tie.position.set(0, 1.32, 0.02); g.add(tie);

    // KARE KAFA
    const head = new THREE.Mesh(BOX(0.48, 0.48, 0.48), MAT(0xd4a373));
    head.position.set(0, 1.98, 0); g.add(head);

    const hair = new THREE.Mesh(BOX(0.5, 0.18, 0.5), MAT(0x1e293b));
    hair.position.set(0, 2.18, 0); g.add(hair);

    // SİYAH GÜNEŞ GÖZLÜĞÜ (Kullanıcı Talebi: Gözlüğü siyah olsun)
    const shadesMat = MAT(0x050505, { roughness: 0.1, metalness: 0.9 });
    const shadesL = new THREE.Mesh(BOX(0.17, 0.13, 0.5), shadesMat);
    shadesL.position.set(-0.12, 1.98, 0.03); g.add(shadesL);
    const shadesR = new THREE.Mesh(BOX(0.17, 0.13, 0.5), shadesMat);
    shadesR.position.set(0.12, 1.98, 0.03); g.add(shadesR);
    const shadesBridge = new THREE.Mesh(BOX(0.1, 0.04, 0.5), shadesMat);
    shadesBridge.position.set(0, 2.0, 0.03); g.add(shadesBridge);

    // Kollar
    const lArm = new THREE.Mesh(BOX(0.22, 0.8, 0.22), MAT(0x1e1b4b));
    lArm.position.set(-0.46, 1.3, 0); g.add(lArm);
    const rArm = new THREE.Mesh(BOX(0.22, 0.8, 0.22), MAT(0x1e1b4b));
    rArm.position.set(0.46, 1.3, 0); g.add(rArm);

    return g;
  }

  _buildDavidWithPhoneModel() {
    const g = this._buildDavidModel();
    const phone = new THREE.Mesh(BOX(0.1, 0.22, 0.06), MAT(0xfacc15, { metalness: 0.9 }));
    phone.position.set(0.26, 1.98, 0.1);
    g.add(phone);
    return g;
  }

  // 2. Arthur Pendelton (KARE KAFA, GÖZLÜKLÜ, KAŞSIZ, MUTLU TEBESSÜM EDEN)
  _buildArthurHappyModel() {
    const g = new THREE.Group();
    const matSuit = MAT(0x1e3a8a);
    const lLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); lLeg.position.set(-0.18, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); rLeg.position.set(0.18, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.65, 0.8, 0.38), matSuit);
    torso.position.set(0, 1.3, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.6, 0.4), MAT(0x38bdf8));
    tie.position.set(0, 1.3, 0.02); g.add(tie);

    // KARE KAFA (Kaşsız, mutlu gözlüklü)
    const head = new THREE.Mesh(BOX(0.46, 0.46, 0.46), MAT(0xf1c27d));
    head.position.set(0, 1.93, 0); g.add(head);

    const hair = new THREE.Mesh(BOX(0.48, 0.15, 0.48), MAT(0x94a3b8));
    hair.position.set(0, 2.12, 0); g.add(hair);

    // Kare Gözlük (KAŞSIZ!)
    const glasses = new THREE.Mesh(BOX(0.38, 0.12, 0.48), MAT(0x0284c7, { metalness: 0.8 }));
    glasses.position.set(0, 1.95, 0.02); g.add(glasses);

    // Mutlu Gülümseyen Ağız (Tebessüm)
    const smile = new THREE.Mesh(BOX(0.18, 0.06, 0.48), MAT(0xb91c1c));
    smile.position.set(0, 1.82, 0.03); g.add(smile);

    // Kollar
    const lArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), matSuit);
    lArm.position.set(-0.42, 1.25, 0.1); lArm.rotation.x = -0.5; g.add(lArm);
    const rArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), matSuit);
    rArm.position.set(0.42, 1.25, 0.1); rArm.rotation.x = -0.5; g.add(rArm);

    return g;
  }

  // 3. Arthur'un Güvenlikleri (Lacivert Üniforma, Açık Mavi Kravat, Gümüş Rozet)
  _buildArthurGuardModel() {
    const g = new THREE.Group();
    const navyMat = MAT(0x1e3a8a);
    const lightBlueTie = MAT(0x38bdf8);
    const skin = MAT(0xe0ac86);

    const lLeg = new THREE.Mesh(BOX(0.3, 0.95, 0.3), navyMat); lLeg.position.set(-0.2, 0.48, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.3, 0.95, 0.3), navyMat); rLeg.position.set(0.2, 0.48, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.75, 0.95, 0.42), navyMat);
    torso.position.set(0, 1.45, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.65, 0.44), lightBlueTie);
    tie.position.set(0, 1.45, 0.02); g.add(tie);

    // Gümüş Rozet
    const badge = new THREE.Mesh(BOX(0.14, 0.14, 0.46), MAT(0xe2e8f0, { metalness: 0.95, roughness: 0.1 }));
    badge.position.set(-0.22, 1.65, 0.02); g.add(badge);

    const head = new THREE.Mesh(BOX(0.42, 0.42, 0.42), skin);
    head.position.set(0, 2.14, 0); g.add(head);

    const lArm = new THREE.Mesh(BOX(0.22, 0.85, 0.22), navyMat);
    lArm.position.set(-0.48, 1.4, 0); g.add(lArm);
    const rArm = new THREE.Mesh(BOX(0.22, 0.85, 0.22), navyMat);
    rArm.position.set(0.48, 1.4, 0); g.add(rArm);

    return g;
  }

  // 4. David Sterling'in Kırmızı Kravatlı KASLI KORUMASI (Geniş omuz, kollar göğüste kavuşmuş)
  _buildMuscleGuardModel(hasBriefcase = false) {
    const g = new THREE.Group();
    const blackSuit = MAT(0x020617);
    const redTie = MAT(0xdc2626);
    const skin = MAT(0xd4a373);

    const lLeg = new THREE.Mesh(BOX(0.36, 1.05, 0.36), blackSuit); lLeg.position.set(-0.25, 0.52, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.36, 1.05, 0.36), blackSuit); rLeg.position.set(0.25, 0.52, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.95, 1.05, 0.52), blackSuit);
    torso.position.set(0, 1.55, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.16, 0.75, 0.54), redTie);
    tie.position.set(0, 1.55, 0.02); g.add(tie);

    const head = new THREE.Mesh(BOX(0.46, 0.48, 0.46), skin);
    head.position.set(0, 2.3, 0); g.add(head);

    const shades = new THREE.Mesh(BOX(0.42, 0.12, 0.48), MAT(0x000000, { roughness: 0.1 }));
    shades.position.set(0, 2.32, 0.03); g.add(shades);

    if (hasBriefcase) {
      const lArm = new THREE.Mesh(BOX(0.28, 0.95, 0.28), blackSuit);
      lArm.position.set(-0.62, 1.45, 0); g.add(lArm);

      const rArm = new THREE.Mesh(BOX(0.28, 0.95, 0.28), blackSuit);
      rArm.position.set(0.62, 1.45, 0); g.add(rArm);

      const briefcase = new THREE.Mesh(BOX(0.22, 0.65, 0.85), MAT(0x94a3b8, { metalness: 0.85, roughness: 0.2 }));
      briefcase.position.set(0.72, 0.9, 0.1);
      g.add(briefcase);
    } else {
      // KOLLAR GÖĞÜSTE KAVUŞMUŞ ("Küsmüş eleman gibi")
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

  // 5. İsyancı Halk Modeli
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

    const lArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), shirtMat);
    lArm.position.set(-0.4, 1.65, 0.2);
    lArm.rotation.x = -Math.PI * 0.4;
    g.add(lArm);

    const rArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), shirtMat);
    rArm.position.set(0.4, 1.65, 0.2);
    rArm.rotation.x = -Math.PI * 0.4;
    g.add(rArm);

    const placardGroup = new THREE.Group();
    const pole = new THREE.Mesh(BOX(0.08, 2.2, 0.08), MAT(0x78350f));
    pole.position.set(0, 1.1, 0);
    placardGroup.add(pole);

    const board = new THREE.Mesh(BOX(1.8, 0.95, 0.06), MAT(0xfef08a));
    board.position.set(0, 2.0, 0.05);
    placardGroup.add(board);

    const banner = new THREE.Mesh(BOX(1.5, 0.4, 0.08), MAT(0xdc2626));
    banner.position.set(0, 2.0, 0.06);
    placardGroup.add(banner);

    placardGroup.position.set(0, 1.0, 0.35);
    g.add(placardGroup);
    g.userData.placard = placardGroup;

    return g;
  }

  // 6. Lüks Altın & Beyaz Limuzin Modeli
  _buildLuxuryLimoModel() {
    const g = new THREE.Group();
    const whiteMat = MAT(0xf8fafc, { roughness: 0.15, metalness: 0.2 });
    const goldMat = MAT(0xf59e0b, { roughness: 0.1, metalness: 0.85 });
    const glassDark = MAT(0x0f172a, { transparent: true, opacity: 0.92, roughness: 0.1 });
    const tireMat = MAT(0x111827, { roughness: 0.8 });

    const body = new THREE.Mesh(BOX(10.5, 1.25, 2.4), whiteMat);
    body.position.y = 0.85;
    g.add(body);

    const goldTrimL = new THREE.Mesh(BOX(10.2, 0.1, 0.06), goldMat);
    goldTrimL.position.set(0, 0.7, 1.22);
    g.add(goldTrimL);

    const goldTrimR = new THREE.Mesh(BOX(10.2, 0.1, 0.06), goldMat);
    goldTrimR.position.set(0, 0.7, -1.22);
    g.add(goldTrimR);

    const cabin = new THREE.Mesh(BOX(7.2, 0.95, 2.15), whiteMat);
    cabin.position.set(-0.4, 1.85, 0);
    g.add(cabin);

    const glassL = new THREE.Mesh(BOX(6.8, 0.65, 0.06), glassDark);
    glassL.position.set(-0.4, 1.85, 1.09);
    g.add(glassL);

    const glassR = new THREE.Mesh(BOX(6.8, 0.65, 0.06), glassDark);
    glassR.position.set(-0.4, 1.85, -1.09);
    g.add(glassR);

    const neonLED = new THREE.PointLight(0xa855f7, 2.5, 4.5);
    neonLED.position.set(-0.5, 1.8, 0);
    g.add(neonLED);

    const guardInLimo1 = this._buildMuscleGuardModel();
    guardInLimo1.scale.setScalar(0.72);
    guardInLimo1.position.set(1.5, 0.65, 0.45);
    guardInLimo1.rotation.y = -Math.PI / 2;
    g.add(guardInLimo1);

    const guardInLimo2 = this._buildMuscleGuardModel();
    guardInLimo2.scale.setScalar(0.72);
    guardInLimo2.position.set(1.5, 0.65, -0.45);
    guardInLimo2.rotation.y = -Math.PI / 2;
    g.add(guardInLimo2);

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
