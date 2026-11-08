import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// ATAHAN ŞEHİR HİKAYESİ & SİNEMATİK GÖREV YÖNETİCİSİ (STORY ENGINE V5)
// ─────────────────────────────────────────────────────────────────────────────
// Düzenlemeler:
//  • İsyancılar mermi / patlama / çekiç / kılıç ile anında ölür, kan küpleri saçar ve devrilir.
//  • Limuzin İçi Koltukta Hatasız Oturuş: Oyuncu limuzinin altında kalmaz; kabin içi lüks deri koltukta
//    göz hizasında oturur, karşısındaki 2 kaslı korumayı net görür.
//  • Oyun Açılışı (TV Odası): Yere bakmaz; tam yatay göz hizasında (pitch=0) televizyona bakar; çekiç yoktur.
//  • Şehirde Yaya / İnsan Yoktur: Senaryo boyunca ve malikanede şehirdeki tüm rastgele NPC'ler gizlenir.
//  • İsyancıların Konumu: Kapıyı geçmezler; villanın dışındaki rampada / caddede yolu kesmiş 56 isyancı bulunur.
// ─────────────────────────────────────────────────────────────────────────────

export const STORY_PHASES = {
  NONE: 0,
  CINEMATIC_BOARDROOM: 1,    // Sahne 1: 4. Katta David & Arthur sözleşme toplantısı
  CINEMATIC_DRONE_PROTEST: 2,// Sahne 2: Drone kamerası ile gökyüzünden kuş bakışı villadaki isyan
  PHONE_CALL: 3,             // Sahne 3: David'in araması & "Tamam geliyoruz" cevabımız
  TV_NEWS_MORNING: 4,        // Sahne 4: TV odasında açılış ve caddedeki bekleyen limuzine yürüyüş
  WAIT_LIMO: 5,              // Limuzine hayranlıkla 2 saniye bakış ve biniş
  LIMO_RIDE: 6,              // Limuzin içi VIP kabin, koltukta oturuş, 2 kaslı koruma, sakin köprü yolculuğu
  VILLA_ARRIVAL: 7,          // Villaya varış, David ve silah çantalı koruması, cephane teslimi
  MISSION_COMBAT: 8,         // Görev: Kapının önünü kapatan isyancıları temizleme
  BETRAYAL_CONFRONTATION: 9, // Sahne 9: İhanet! Korumalar bizi yakalar, silahlar/para gasp edilir, tekmeyle atılırız
  DEJECTED_WALK_HOME: 10,    // Sahne 10: Şehirde insanlar gezerken eve doğru kambur, hüzünlü yürüyüş
  HOME_COUCH_REVELATION: 11, // Sahne 11: Evde koltukta pişman oturuş, aniden kameraya bakış & ekran kararması
  SECRET_WORKSHOP_OCTOPUS: 12,// Sahne 12: Tony Stark stili mekanik laboratuvar, ahtapot kolları montajı
  FREE_ROAM_REVENGE: 13      // Hikaye bitti, Mekanik Ahtapot devrede, serbest intikam!
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

// Resmi Devir Sözleşmesi Kağıdı Dokusu (Yazı çizgileri, imza çizgisi ve [ X ] işareti)
function createContractTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 512);

  // Dış çerçeve
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, 476, 476);

  // Başlık
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FINANS DEVIR SOZLESMESI', 256, 64);

  ctx.fillStyle = '#1e3a8a';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('MERKEZ BANKALAR BIRLIGI & STERLING HOLDING', 256, 94);

  // Metin çizgileri (Maddeler)
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 3;
  for (let y = 135; y <= 365; y += 24) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(472, y);
    ctx.stroke();
  }

  // İmza Alanı
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('YETKILI IMZA:', 40, 435);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(210, 440);
  ctx.lineTo(370, 440);
  ctx.stroke();

  // Kırmızı [ X ] İşareti (İmzalama yeri)
  ctx.fillStyle = '#dc2626';
  ctx.font = 'bold 36px monospace';
  ctx.fillText('[ X ]', 390, 445);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class StoryManager {
  constructor(scene, voxelWorld, character, camera, weaponSystem, handWeapons) {
    this.scene = scene;
    this.voxelWorld = voxelWorld;
    this.character = character;
    this.camera = camera;
    this.weaponSystem = weaponSystem;
    this.handWeapons = handWeapons;
    window._storyManager = this;

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

    // Limuzin yolu (Nizamî yol güzergahı - duvara girmeden avluda durur)
    this.limoPath = [
      { x: -105, y: 0.5, z: 2.1 },
      { x: -50, y: 0.5, z: 2.1 },
      { x: -12, y: 0.5, z: 2.1 },   // Köprü girişi
      { x: 120, y: 0.5, z: 2.1 },   // Köprü ortası
      { x: 258, y: 0.5, z: 2.1 },   // Köprü çıkışı
      { x: 321, y: 0.5, z: 2.1 },   // Villa yolu başlangıcı
      { x: 350, y: 3.5, z: -15 },   // Villa rampası
      { x: 375, y: 8.5, z: -35 },   // Villa virajı
      { x: 388, y: 11.5, z: -45 },  // Kapı önü yaklaşma
      { x: 395, y: 12.0, z: -53.5 } // Kapıdan geçip avluya nizamî park
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
      <div id="story-mission-desc" style="font-size:13px;color:#94a3b8;margin-top:4px;">Kapıdan çık ve caddedeki bekleyen altın limuzine git.</div>
    `;
    container.appendChild(hud);
    this.missionHud = hud;

    // Undertale Tarzı Net & Görünür Retro Diyalog Kutusu
    const dbox = document.createElement('div');
    dbox.id = 'story-dialog-box';
    dbox.style.cssText = `
      position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
      width: 860px; max-width: 94vw; min-height: 165px;
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

    group.position.set(-105.0, 0.6, 4.2);
    group.visible = false;
    this.scene.add(group);
    this.waypointMarker = group;
  }

  // ── Undertale Kare Kafa Portre Çizimi (Voxel / Teardown Stili) ──
  _getPortraitSVG(speaker) {
    if (speaker === 'david') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="16" width="60" height="60" fill="#d4a373"/>
          <rect x="18" y="12" width="64" height="22" fill="#1e293b"/>
          <rect x="18" y="24" width="8" height="20" fill="#1e293b"/>
          <rect x="74" y="24" width="8" height="20" fill="#1e293b"/>
          <rect x="25" y="37" width="22" height="15" fill="#000000" stroke="#111111" stroke-width="2.5"/>
          <rect x="53" y="37" width="22" height="15" fill="#000000" stroke="#111111" stroke-width="2.5"/>
          <rect x="47" y="42" width="6" height="3" fill="#000000"/>
          <rect x="46" y="54" width="8" height="8" fill="#bc8a5f"/>
          <rect x="38" y="64" width="24" height="4" fill="#1e293b"/>
          <rect x="45" y="68" width="10" height="8" fill="#1e293b"/>
          <rect x="10" y="78" width="80" height="22" fill="#0f172a"/>
          <rect x="44" y="78" width="12" height="22" fill="#dc2626"/>
        </svg>
      `;
    } else if (speaker === 'player') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
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
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="18" width="60" height="60" fill="#f1c27d"/>
          <rect x="18" y="14" width="64" height="18" fill="#94a3b8"/>
          <rect x="26" y="38" width="20" height="17" fill="rgba(56,189,248,0.25)" stroke="#0284c7" stroke-width="2.5"/>
          <rect x="54" y="38" width="20" height="17" fill="rgba(56,189,248,0.25)" stroke="#0284c7" stroke-width="2.5"/>
          <rect x="46" y="44" width="8" height="2.5" fill="#0284c7"/>
          <circle cx="36" cy="46" r="4.5" fill="#0f172a"/>
          <circle cx="34.5" cy="44.5" r="1.5" fill="#ffffff"/>
          <circle cx="64" cy="46" r="4.5" fill="#0f172a"/>
          <circle cx="62.5" cy="44.5" r="1.5" fill="#ffffff"/>
          <path d="M35 60 Q50 78 65 60" fill="none" stroke="#be123c" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M38 61 Q50 72 62 61 Z" fill="#ffffff"/>
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
    } else if (speaker === 'guard') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="16" y="16" width="68" height="64" fill="#d4a373"/>
          <rect x="14" y="12" width="72" height="18" fill="#090d16"/>
          <rect x="22" y="36" width="25" height="15" fill="#000000"/>
          <rect x="53" y="36" width="25" height="15" fill="#000000"/>
          <rect x="47" y="41" width="6" height="3" fill="#000000"/>
          <rect x="36" y="64" width="28" height="5" fill="#090d16"/>
          <rect x="6" y="80" width="88" height="20" fill="#020617"/>
          <rect x="43" y="80" width="14" height="20" fill="#dc2626"/>
        </svg>
      `;
    } else if (speaker === 'thought') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="22" width="60" height="58" fill="#d4a373"/>
          <rect x="18" y="16" width="64" height="20" fill="#4a2f13"/>
          <rect x="18" y="24" width="8" height="14" fill="#4a2f13"/>
          <rect x="28" y="48" width="14" height="6" fill="#1e293b"/>
          <rect x="58" y="48" width="14" height="6" fill="#1e293b"/>
          <rect x="32" y="51" width="6" height="4" fill="#3b82f6"/>
          <rect x="62" y="51" width="6" height="4" fill="#3b82f6"/>
          <path d="M38 72 Q50 64 62 72" fill="none" stroke="#7f1d1d" stroke-width="3" stroke-linecap="round"/>
          <rect x="12" y="80" width="76" height="20" fill="#1e293b"/>
          <circle cx="82" cy="22" r="5" fill="#38bdf8" opacity="0.8"/>
          <circle cx="90" cy="14" r="7" fill="#38bdf8" opacity="0.9"/>
        </svg>
      `;
    } else if (speaker === 'player_determined') {
      return `
        <svg viewBox="0 0 100 100" width="105" height="105">
          <rect width="100" height="100" fill="#090d16"/>
          <rect x="20" y="18" width="60" height="60" fill="#ffdbac"/>
          <rect x="18" y="12" width="64" height="20" fill="#4a2f13"/>
          <rect x="18" y="22" width="8" height="14" fill="#4a2f13"/>
          <line x1="26" y1="36" x2="44" y2="42" stroke="#2b1b0e" stroke-width="4" stroke-linecap="round"/>
          <line x1="74" y1="36" x2="56" y2="42" stroke="#2b1b0e" stroke-width="4" stroke-linecap="round"/>
          <rect x="30" y="44" width="12" height="9" fill="#06b6d4"/>
          <rect x="58" y="44" width="12" height="9" fill="#06b6d4"/>
          <rect x="34" y="46" width="4" height="5" fill="#ffffff"/>
          <rect x="62" y="46" width="4" height="5" fill="#ffffff"/>
          <rect x="38" y="64" width="24" height="5" fill="#ffffff" stroke="#991b1b" stroke-width="1.5"/>
          <rect x="12" y="80" width="76" height="20" fill="#0284c7"/>
          <line x1="72" y1="28" x2="72" y2="60" stroke="#06b6d4" stroke-width="2"/>
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
    if (this.activeDialog && typeof this.activeDialog.onStart === 'function') {
      try { this.activeDialog.onStart(); } catch (e) { console.error(e); }
    }
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

    // Çekiç kesinlikle oyuncunun elinde görünmesin
    if (this.character && this.character.hammer) {
      this.character.hammer.visible = false;
    }

    // Şehirdeki ve malikanedeki tüm rastgele yayaları/çalışanları gizle
    if (this.voxelWorld && this.voxelWorld.npcs && this.voxelWorld.npcs.npcs) {
      this.voxelWorld.npcs.npcs.forEach(n => { if (n.group) n.group.visible = false; });
    }

    this.startPhaseBoardroomMeeting();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 1: 4. KAT ÖZEL YÖNETİM SALONU - SÖZLEŞME VE ANLAŞMA
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseBoardroomMeeting() {
    this.currentPhase = STORY_PHASES.CINEMATIC_BOARDROOM;
    this.phaseTimer = 0;
    this.showSkipButton(true);

    const rx = 0, ry = 35.0, rz = 0;
    this._buildHighBoardroomScene(rx, ry, rz);

    this.camera.position.set(rx, ry + 1.85, rz + 3.4);
    this.camera.lookAt(rx, ry + 1.45, rz);

    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Merhaba dostum, seninle bir anlaşma yapmak istiyorum! Masadaki bu resmi devir sözleşmesini görüyor musun?'
      },
      {
        speaker: 'arthur', name: 'ARTHUR PENDELTON (BANKALAR BİRLİĞİ)', color: '#38bdf8',
        text: 'Elbette Bay Sterling! Şehrin 4 dev bankası, 12 merkez şubesi ve trilyonluk mevduat hesaplarının tüm yetki devri bu belgede.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Tek bir imzanla tüm bankalar, kasalar ve para akışı tamamen bana geçecek. Karşılığında vaat ettiğim servet bu çantanın içinde!'
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
        text: 'O halde anlaşma tamamlandı! Sözleşmenin altındaki [X] işaretli yeri imzalıyorum. Tüm kasa anahtarları ve yetki sizindir!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING (MİLYARDER)', color: '#facc15',
        text: 'Harika bir ortaklık! Halk sadece sızlanmayı bilir. Artık bu şehrin tek bir efendisi var: David Sterling!'
      }
    ], () => {
      this.setFade(1, 400);
      setTimeout(() => {
        this.startPhaseDroneProtest();
      }, 450);
    });
  }

  _buildHighBoardroomScene(rx, ry, rz) {
    this.cinematicGroup.clear();

    const whiteWallMat = MAT(0xf8fafc, { roughness: 0.15 });
    const whiteCeilMat = MAT(0xf1f5f9, { roughness: 0.25 });
    const darkWoodMat = MAT(0x1e293b, { roughness: 0.25 });
    const goldMat = MAT(0xfacc15, { metalness: 0.9, roughness: 0.15 });
    const leatherBlack = MAT(0x0f172a, { roughness: 0.4 });

    // Zemin ve Tavan
    const floor = new THREE.Mesh(BOX(22, 0.4, 16), whiteWallMat);
    floor.position.set(rx, ry, rz);
    this.cinematicGroup.add(floor);

    const ceiling = new THREE.Mesh(BOX(22, 0.4, 16), whiteCeilMat);
    ceiling.position.set(rx, ry + 4.5, rz);
    this.cinematicGroup.add(ceiling);

    // Panoramik Cam Duvar (Pencerenin dışı net şekilde görünsün, arkada gökdelenler olsun)
    const glassMat = MAT(0xa5f3fc, { transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 });
    const frameDark = MAT(0x1e293b, { roughness: 0.2, metalness: 0.8 });

    // Alt ve üst pencere pervazları
    const sill = new THREE.Mesh(BOX(22, 0.4, 0.35), whiteWallMat);
    sill.position.set(rx, ry + 0.2, rz - 6.8);
    this.cinematicGroup.add(sill);

    const header = new THREE.Mesh(BOX(22, 0.4, 0.35), whiteWallMat);
    header.position.set(rx, ry + 4.3, rz - 6.8);
    this.cinematicGroup.add(header);

    // Ana panoramik cam yüzeyi
    const glassPanels = new THREE.Mesh(BOX(21.6, 3.7, 0.06), glassMat);
    glassPanels.position.set(rx, ry + 2.25, rz - 6.8);
    this.cinematicGroup.add(glassPanels);

    // Dikey ve yatay şık alüminyum pencere kayıtları (mullions)
    for (let x = -10; x <= 10; x += 2.5) {
      const vFrame = new THREE.Mesh(BOX(0.12, 3.7, 0.15), frameDark);
      vFrame.position.set(rx + x, ry + 2.25, rz - 6.78);
      this.cinematicGroup.add(vFrame);

      const goldPinstripe = new THREE.Mesh(BOX(0.04, 3.7, 0.16), goldMat);
      goldPinstripe.position.set(rx + x, ry + 2.25, rz - 6.77);
      this.cinematicGroup.add(goldPinstripe);
    }
    const hFrame = new THREE.Mesh(BOX(21.6, 0.12, 0.14), frameDark);
    hFrame.position.set(rx, ry + 2.2, rz - 6.78);
    this.cinematicGroup.add(hFrame);

    // DIŞARIDA GÖRÜNEN METROPOL VE GÖKDELENLER (Pencereden dışarı bakınca görünen şehir silüeti)
    this._buildSkylineOutsideWindow(rx, ry, rz - 6.8);

    const leftWall = new THREE.Mesh(BOX(0.3, 4.4, 15.8), whiteWallMat);
    leftWall.position.set(rx - 10.8, ry + 2.25, rz);
    this.cinematicGroup.add(leftWall);

    const rightWall = new THREE.Mesh(BOX(0.3, 4.4, 15.8), whiteWallMat);
    rightWall.position.set(rx + 10.8, ry + 2.25, rz);
    this.cinematicGroup.add(rightWall);

    // Yönetim Masası ve Resmi Sözleşme
    const table = new THREE.Mesh(BOX(3.2, 0.88, 1.8), darkWoodMat);
    table.position.set(rx, ry + 0.44, rz);
    this.cinematicGroup.add(table);

    const contractMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.015, 0.65), new THREE.MeshStandardMaterial({
      map: createContractTexture(), roughness: 0.35, metalness: 0.05
    }));
    contractMesh.position.set(rx, ry + 0.90, rz + 0.15);
    this.cinematicGroup.add(contractMesh);

    const briefcase = new THREE.Mesh(BOX(0.8, 0.24, 0.5), goldMat);
    briefcase.position.set(rx - 0.75, ry + 0.9 + 0.12, rz - 0.3);
    this.cinematicGroup.add(briefcase);

    const chairDavid = new THREE.Mesh(BOX(0.8, 1.2, 0.8), leatherBlack);
    chairDavid.position.set(rx - 2.4, ry + 0.6, rz);
    this.cinematicGroup.add(chairDavid);

    const chairArthur = new THREE.Mesh(BOX(0.8, 1.2, 0.8), leatherBlack);
    chairArthur.position.set(rx + 2.4, ry + 0.6, rz);
    this.cinematicGroup.add(chairArthur);

    // David Sterling (Masadan ferah mesafede)
    const david = this._buildDavidModel();
    david.position.set(rx - 2.2, ry, rz);
    david.rotation.y = Math.PI / 2;
    this.cinematicGroup.add(david);
    this.davidActor = david;

    const dg1 = this._buildMuscleGuardModel();
    dg1.position.set(rx - 3.4, ry, rz - 1.1);
    dg1.rotation.y = Math.PI * 0.4;
    this.cinematicGroup.add(dg1);

    const dg2 = this._buildMuscleGuardModel();
    dg2.position.set(rx - 3.4, ry, rz + 1.1);
    dg2.rotation.y = Math.PI * 0.6;
    this.cinematicGroup.add(dg2);

    // Arthur Pendelton (Saydam gözlük, mutlu)
    const arthur = this._buildArthurHappyModel();
    arthur.position.set(rx + 2.2, ry, rz);
    arthur.rotation.y = -Math.PI / 2;
    this.cinematicGroup.add(arthur);
    this.arthurActor = arthur;

    const ag1 = this._buildArthurGuardModel();
    ag1.position.set(rx + 3.4, ry, rz - 1.1);
    ag1.rotation.y = -Math.PI * 0.4;
    this.cinematicGroup.add(ag1);

    const ag2 = this._buildArthurGuardModel();
    ag2.position.set(rx + 3.4, ry, rz + 1.1);
    ag2.rotation.y = -Math.PI * 0.6;
    this.cinematicGroup.add(ag2);

    const light = new THREE.PointLight(0xfffbeb, 3.0, 16);
    light.position.set(rx, ry + 4.0, rz);
    this.cinematicGroup.add(light);
  }

  // Pencereden dışarı bakıldığında görünen devasa metropol gökdelen silüeti
  _buildSkylineOutsideWindow(rx, ry, rz) {
    const towers = [
      { x: -14, z: -14, w: 9, d: 9, h: 48, col: 0x1e293b, glass: 0x38bdf8 },
      { x: -6,  z: -20, w: 8, d: 8, h: 54, col: 0x0f172a, glass: 0x60a5fa },
      { x: 3,   z: -16, w: 10, d: 8, h: 46, col: 0x334155, glass: 0xfacc15 },
      { x: 12,  z: -22, w: 9, d: 9, h: 52, col: 0x1e293b, glass: 0x38bdf8 },
      { x: -22, z: -26, w: 11, d: 10, h: 42, col: 0x475569, glass: 0x93c5fd },
      { x: 22,  z: -25, w: 10, d: 10, h: 44, col: 0x1e3a8a, glass: 0x38bdf8 },
      { x: -10, z: -38, w: 14, d: 14, h: 62, col: 0x0f172a, glass: 0x38bdf8 },
      { x: 8,   z: -42, w: 15, d: 12, h: 68, col: 0x1e293b, glass: 0x60a5fa },
      { x: -28, z: -46, w: 12, d: 12, h: 50, col: 0x334155, glass: 0xfacc15 },
      { x: 28,  z: -48, w: 14, d: 14, h: 56, col: 0x0f172a, glass: 0x38bdf8 }
    ];

    for (const t of towers) {
      const bMat = MAT(t.col, { roughness: 0.35, metalness: 0.6 });
      const towerMesh = new THREE.Mesh(BOX(t.w, t.h, t.d), bMat);
      towerMesh.position.set(rx + t.x, ry - 6 + t.h / 2, rz + t.z);
      this.cinematicGroup.add(towerMesh);

      // Pencereler (Işıklı ofis cam şeritleri)
      const winMat = MAT(t.glass, { emissive: t.glass, emissiveIntensity: 0.8, roughness: 0.1 });
      for (let wy = ry - 2; wy < ry - 6 + t.h - 3; wy += 3.2) {
        const winBand = new THREE.Mesh(BOX(t.w + 0.12, 1.4, t.d + 0.12), winMat);
        winBand.position.set(rx + t.x, wy, rz + t.z);
        this.cinematicGroup.add(winBand);
      }

      // Çatı anteni ve kırmızı ikaz lambası
      const ant = new THREE.Mesh(BOX(0.3, 6, 0.3), MAT(0x94a3b8, { metalness: 0.9 }));
      ant.position.set(rx + t.x, ry - 6 + t.h + 3, rz + t.z);
      this.cinematicGroup.add(ant);

      const beacon = new THREE.Mesh(BOX(0.5, 0.5, 0.5), MAT(0xef4444, { emissive: 0xef4444, emissiveIntensity: 2.0 }));
      beacon.position.set(rx + t.x, ry - 6 + t.h + 6, rz + t.z);
      this.cinematicGroup.add(beacon);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 2: DRONE İLE KUŞ BAKIŞI VİLLADAKİ İSYAN VE HABER ARACI
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseDroneProtest() {
    this.currentPhase = STORY_PHASES.CINEMATIC_DRONE_PROTEST;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const vx = 395, vy = 12.0, vz = -40;
    this._buildProtestScene(vx, vy, vz);

    this.camera.position.set(vx + 32, vy + 26, vz + 34);
    this.camera.lookAt(vx, vy + 2.0, vz);

    this.setFade(0, 600);
    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'news', name: 'CANLI DRONE HABER YAYINI', color: '#f43f5e',
        text: 'SON DAKİKA: David Sterling’in şehirdeki tüm bankaları gizlice devraldığı haberi duyuldu! Öfkeli halk Sterling Malikanesi’ne giden yolu kesti!'
      },
      {
        speaker: 'news', name: 'CANLI YAYIN MUHABİRİ', color: '#f43f5e',
        text: 'Drone kameralarımız villanın dış kapısı önündeki dev kalabalığı görüntülüyor. Yolu barikatlarla kapatmış durumdalar!'
      }
    ], () => {
      this.startPhasePhoneCall();
    });
  }

  _buildProtestScene(vx, vy, vz) {
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

    van.position.set(vx + 9.5, vy, vz + 14.0);
    van.rotation.y = -Math.PI / 4;
    this.cinematicGroup.add(van);
    this.newsVan = van;

    // Kapının dışındaki yolda toplanan isyancılar
    this.protesters = [];
    const slogans = ['DEFOL STERLING!', 'PARALARIMIZI VER!', 'BANKALARI BIRAK!', 'HIRSIZ STERLING!', 'HAKKIMIZI YEDİRMEYİZ!', 'YALANCI PATRON!'];
    for (let i = 0; i < 40; i++) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const px = 384 + col * 2.2 + (Math.random() - 0.5) * 0.8;
      const pz = -44.0 + row * 4.5 + (Math.random() - 0.5) * 1.0;
      const p = this._buildProtesterModel(slogans[i % slogans.length]);
      p.position.set(px, vy, pz);
      p.rotation.y = 0; // Kapıya (kuzeye) doğru bakar
      p.userData.baseY = vy;
      p.userData.animOffset = Math.random() * 12;
      this.cinematicGroup.add(p);
      this.protesters.push(p);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 3: TELEFON GÖRÜŞMESİ
  // ═══════════════════════════════════════════════════════════════════════════
  startPhasePhoneCall() {
    this.currentPhase = STORY_PHASES.PHONE_CALL;
    this.phaseTimer = 0;

    sound.playPhoneRing();

    const vx = 395, vy = 12.0, vz = -55;
    const davidWithPhone = this._buildDavidWithPhoneModel();
    davidWithPhone.position.set(vx, vy, vz);
    davidWithPhone.rotation.y = 0; // Güneye (kapıya) doğru bakar
    this.cinematicGroup.add(davidWithPhone);

    this.camera.position.set(vx - 2.4, vy + 2.2, vz + 3.0);
    this.camera.lookAt(vx, vy + 1.8, vz);

    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING (TELEFON)', color: '#facc15',
        text: 'Alo! Beni duyabiliyor musun? Bankaları devraldık ama bu aptal halk kapıma dayandı, yolumu kestiler!'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Hemen Doğu Ada’daki villama gel. Bu isyancıları temizle; sana dağlar kadar servet ve özel cephaneliğimi vereceğim!'
      },
      {
        speaker: 'player', name: 'SEN (OYUNCU)', color: '#38bdf8',
        text: 'Tamam, geliyoruz.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Harika! Özel altın kaplama lüks limuzinim evinin önündeki caddede seni bekliyor, acele et!'
      }
    ], () => {
      this.setFade(1, 500);
      setTimeout(() => {
        this.startPhaseTvNewsMorning();
      }, 550);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 4: EVDEN ÇIKIŞ VE TV ODASINDA AÇILIŞ
  // (Yere bakmaz, televizyona bakar; çekiç yoktur; şehirde hiç insan yoktur)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseTvNewsMorning() {
    this.currentPhase = STORY_PHASES.TV_NEWS_MORNING;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    // Çekiç kesinlikle gizlenir
    if (this.character && this.character.hammer) {
      this.character.hammer.visible = false;
    }

    // Şehirdeki ve dünyadaki tüm rastgele insanları gizli tut (kesinlikle görünmesinler)
    if (this.voxelWorld && this.voxelWorld.npcs && this.voxelWorld.npcs.npcs) {
      this.voxelWorld.npcs.npcs.forEach(n => { if (n.group) n.group.visible = false; });
    }

    // Limuzini caddede beklemede başlat
    this._spawnLimoWaitingOnStreet();

    const spawnPos = { x: -110.25, y: 7.05, z: 19.75 };
    if (this.character && this.character.body) {
      this.character.body.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      this.character.vel.set(0, 0, 0);
      this.character.mesh.position.set(spawnPos.x, spawnPos.y - 0.525, spawnPos.z);
    }

    // Tam yatay göz hizasında (pitch = 0), doğrudan doğudaki televizyona bakar (+x)
    this.camera.position.set(spawnPos.x, spawnPos.y + 0.6, spawnPos.z);
    this.camera.lookAt(spawnPos.x + 5.0, spawnPos.y + 0.6, spawnPos.z);

    this.setFade(0, 800);
    this.showSkipButton(false);

    this.controlsLocked = false;
    this.weaponsLocked = true;

    this.setMission('EVDEN ÇIK VE LİMUZİNE GİT', 'Merdivenlerden aşağı in, kapıdan caddeye çık ve bekleyen altın limuzine git.');

    if (this.waypointMarker) {
      this.waypointMarker.position.set(-105.0, 0.6, 4.2);
      this.waypointMarker.visible = true;
    }
  }

  skipCurrentCinematic() {
    this.dialogBox.style.display = 'none';
    this.setFade(0, 300);
    if (this.currentPhase <= STORY_PHASES.PHONE_CALL) {
      this.startPhaseTvNewsMorning();
    } else if (this.currentPhase === STORY_PHASES.LIMO_RIDE || this.currentPhase === STORY_PHASES.WAIT_LIMO) {
      this.startPhaseVillaArrival();
    } else if (this.currentPhase === STORY_PHASES.VILLA_ARRIVAL) {
      this.startCombatPhase();
    } else if (this.currentPhase === STORY_PHASES.MISSION_COMBAT) {
      for (const p of this.protesters) { p.userData.dead = true; p.visible = false; }
      this.startBetrayalConfrontation();
    } else if (this.currentPhase === STORY_PHASES.BETRAYAL_CONFRONTATION) {
      this.startDejectedWalkHome();
    } else if (this.currentPhase === STORY_PHASES.DEJECTED_WALK_HOME) {
      this.startHomeCouchRevelation();
    } else if (this.currentPhase === STORY_PHASES.HOME_COUCH_REVELATION) {
      this.startSecretWorkshopOctopus();
    } else if (this.currentPhase === STORY_PHASES.SECRET_WORKSHOP_OCTOPUS) {
      this.finishStoryAndUnlockRevenge();
    } else {
      this.startPhaseTvNewsMorning();
    }
  }

  // Oyuncu limuzine yaklaştığında tetiklenir (2 saniye bakar, sonra biner)
  checkPlayerReachedLimoStop(playerPos) {
    if (this.currentPhase !== STORY_PHASES.TV_NEWS_MORNING) return;
    const dist = Math.hypot(playerPos.x - (-105.0), playerPos.z - 3.5);
    if (dist < 4.2) {
      this.currentPhase = STORY_PHASES.WAIT_LIMO;
      this.phaseTimer = 0;
      this.controlsLocked = true;

      if (this.waypointMarker) this.waypointMarker.visible = false;

      // Kamera limuzine 2 saniye hayranlıkla bakar
      this.camera.lookAt(-105.0, 1.2, 2.1);

      this.setMission('LİMUZİNE BİNİLİYOR...', 'David Sterling’in altın kaplama limuzini sizi bekliyor.');
      sound.playUiBeep();
    }
  }

  _spawnLimoWaitingOnStreet() {
    if (this.limo) this.scene.remove(this.limo);
    const limo = this._buildLuxuryLimoModel();
    limo.position.set(-105.0, 0.5, 2.1);
    limo.rotation.y = 0;
    this.scene.add(limo);
    this.limo = limo;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 5 & 6: LİMUZİN İÇİ VIP SEYAHAT
  // (Oyuncu limuzinin altında DEĞİL, kabin koltuğunda oturur; karşıda 2 kaslı koruma)
  // ═══════════════════════════════════════════════════════════════════════════
  startLimoRide() {
    this.currentPhase = STORY_PHASES.LIMO_RIDE;
    this.phaseTimer = 0;
    this.limoProgress = 0;
    this.controlsLocked = true;
    window._storyCamYaw = 0;
    window._storyCamPitch = 0;

    sound.playLimoDoor();
    this.setMission('LİMUZİN İLE SEYAHAT', 'David Sterling’in korumalarıyla Doğu Ada’daki malikaneye gidiyorsunuz.');

    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'guard', name: 'BAŞ KORUMA (LİMUZİN İÇİ)', color: '#dc2626',
          text: 'Arkamıza yaslanalım dostum. Patronumuz David Sterling seninle resmi bir anlaşma yaptı.'
        },
        {
          speaker: 'guard', name: 'BAŞ KORUMA', color: '#dc2626',
          text: 'Şehrin bütün finansı ve bankaları artık patronun elinde. Halk öfkeden delirmek üzere.'
        },
        {
          speaker: 'guard', name: 'BAŞ KORUMA', color: '#dc2626',
          text: 'Malikanenin dış kapısına barikat kurmuş o isyancı sürüsünü tek tek temizleyeceksin.'
        },
        {
          speaker: 'guard', name: 'BAŞ KORUMA', color: '#dc2626',
          text: 'Sözleşmeye sadık kalırsan dağlar kadar servet ve cephanelikteki en ağır silahlar tamamen sende kalacak!'
        },
        {
          speaker: 'guard', name: 'BAŞ KORUMA', color: '#dc2626',
          text: 'Köprüyü geçtik, Doğu Ada rampasına tırmanıyoruz. Silahlarını kuşan, kapıdan içeri giriyoruz!'
        }
      ]);
    }, 1200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 7: VİLLAYA VARIŞ & CEPHANE TESLİMİ
  // (David kapının içinde güvendedir, isyancılar kapının dışındaki yoldadır)
  // ═══════════════════════════════════════════════════════════════════════════
  startPhaseVillaArrival() {
    this.currentPhase = STORY_PHASES.VILLA_ARRIVAL;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const vx = 395.0, vy = 12.0, vz = -55.0;

    // Oyuncu villanın kapı içindeki avluda durur
    if (this.character && this.character.body) {
      this.character.body.position.set(vx - 2.5, vy + 1.0, vz);
      this.character.mesh.position.set(vx - 2.5, vy, vz);
      this.character.body.velocity.set(0, 0, 0);
    }

    // David Sterling (Kapının içinde, SİYAH GÜNEŞ GÖZLÜKLÜ)
    window._octopusUnlocked = false; // Ahtapot kesinlikle henüz açık değildir!
    const david = this._buildDavidModel();
    david.position.set(vx + 1.2, vy, vz - 1.5);
    david.rotation.y = 0; // Dışarıdaki kapıya bakar
    this.cinematicGroup.add(david);
    this.davidActor = david;

    // David'in Sağında Koruması (Çantayı tutan)
    const guardR = this._buildMuscleGuardModel(true);
    guardR.position.set(vx + 2.6, vy, vz - 1.5);
    guardR.rotation.y = 0;
    this.cinematicGroup.add(guardR);
    this.guardR = guardR;

    // David'in Solunda Koruması (Kolları bağlı)
    const guardL = this._buildMuscleGuardModel(false);
    guardL.position.set(vx - 0.2, vy, vz - 1.5);
    guardL.rotation.y = 0;
    this.cinematicGroup.add(guardL);
    this.guardL = guardL;

    // İSYANCILAR: Kapıyı kesinlikle geçmezler, dışarıdaki yolda barikat kurmuşlardır!
    this._spawnMissionProtesters();

    this.camera.position.set(vx - 3.5, vy + 2.2, vz + 2.5);
    this.camera.lookAt(vx + 1.2, vy + 1.8, vz - 1.5);

    sound.playCinematicBoom();

    this.startDialogQueue([
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Vaktinde geldin dostum. Olayı biliyorsun; kapımın dışındaki yola barikat kurmuş bu isyancı ayak takımı servetimi ve canımı tehdit ediyor.'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Al bakalım! Özel cephaneliğimin en nadide parçaları bu çantada: Minigun, Lazer, Sniper, Pompalı ve Ağır Tabanca...'
      },
      {
        speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
        text: 'Dışarı çık ve kapımın önündeki bütün bu isyancıları temizle! İşini bitirdiğinde gel, ödülünü fazlasıyla alacaksın!'
      }
    ], () => {
      this.startCombatPhase();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 8: ÇATIŞMA GÖREVİ (Kapının Dışındaki İsyancıları Temizleme)
  // ═══════════════════════════════════════════════════════════════════════════
  startCombatPhase() {
    this.currentPhase = STORY_PHASES.MISSION_COMBAT;
    this.controlsLocked = false;
    this.weaponsLocked = false;
    this._betrayalTriggered = false;

    if (this.weaponSystem) this.weaponSystem.setWeapon(1);
    if (this.handWeapons) this.handWeapons.setWeapon(1);

    sound.playCashRegister();
    this.updateCombatMissionHUD();
  }

  // 36 Adet İsyancı: Kapının hemen önünde sık ve öfkeli kalabalık olarak toplanırlar (z = -46.5 .. -37.0)
  _spawnMissionProtesters() {
    this.protesters = [];
    const slogans = [
      'DEFOL STERLING!', 'PARAMIZI VER!', 'KATİL STERLING!',
      'HESAP VERECEKSİN!', 'HAKKIMIZI YEDİRMEYİZ!', 'YALANCI PATRON!',
      'BANKALAR BİZİMDİR!', 'PARAMI ÇALAMAZSIN!'
    ];

    const totalCount = 36;
    for (let i = 0; i < totalCount; i++) {
      const col = i % 9;
      const row = Math.floor(i / 9);

      // Yol genişliği x = 387 .. 403 (Tam kapı önü)
      const px = 387.0 + col * 1.8 + (Math.random() - 0.5) * 0.4;
      // Dış yol derinliği z = -46.5 .. -37.0 (hepsi kapıdan net görünür, rampada kaybolmazlar)
      const pz = -46.5 + row * 2.8 + (Math.random() - 0.5) * 0.5;

      const gy = (this.voxelWorld && this.voxelWorld.terrain) ? this.voxelWorld.terrain.topYAt(px, pz) : 12.0;
      const finalY = Math.max(0.5, gy);

      const p = this._buildProtesterModel(slogans[i % slogans.length]);
      p.position.set(px, finalY, pz);
      p.rotation.y = Math.PI + (Math.random() - 0.5) * 0.3; // Villaya ve kapıya doğru dönük
      p.userData.isTarget = true;
      p.userData.hp = 100;
      p.userData.dead = false;
      p.userData.baseY = finalY;
      p.userData.animOffset = Math.random() * 12;

      this.cinematicGroup.add(p);
      this.protesters.push(p);
    }
  }

  updateCombatMissionHUD() {
    if (this.currentPhase !== STORY_PHASES.MISSION_COMBAT) return;
    if (this._betrayalTriggered) return;
    const remaining = this.protesters.filter(p => !p.userData.dead).length;
    if (remaining > 0) {
      this.setMission('KAPININ ÖNÜNDEKİ İSYANCILARI ETKİSİZ HALE GETİR', `Kalan İsyancı Sayısı: ${remaining}`);
    } else {
      this._betrayalTriggered = true;
      // Bütün adamlar öldüğünde ve tabela kaldırma tamamen bittiğinde sahne başlar
      this.setMission('GÖREV TAMAMLANDI! BÜTÜN İSYANCILAR TEMİZLENDİ', 'David Sterling ile konuşmak için villaya dönülüyor...');
      setTimeout(() => {
        this.startBetrayalConfrontation();
      }, 1200);
    }
  }

  // İsyancı Vurulma Mantığı (Tek atışta patlayarak parçalanma, et ve kan küpleri saçılması)
  onHitProtester(protesterMesh, hitPoint) {
    if (!protesterMesh || !protesterMesh.userData || protesterMesh.userData.dead) return;
    protesterMesh.userData.dead = true;
    protesterMesh.userData.hp = 0;

    // Patlama, vurulma ve parçalanma sesleri
    sound.playExplosion(0.75);
    sound.playNpcHit();
    sound.playBlockHit();

    // Büyük kırmızı kan ve et küpleri fışkırması / patlama parçalanması
    if (this.voxelWorld && this.voxelWorld.spawnLooseVoxel) {
      const bloodCols = [0x991b1b, 0xdc2626, 0xef4444, 0x7f1d1d, 0xb91c1c];
      const pos = hitPoint || protesterMesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      for (let i = 0; i < 38; i++) {
        const spread = (Math.random() - 0.5) * 0.9;
        this.voxelWorld.spawnLooseVoxel(
          pos.x + spread,
          pos.y + (Math.random() - 0.1) * 1.2,
          pos.z + (Math.random() - 0.5) * 0.9,
          { color: bloodCols[i % bloodCols.length] },
          pos,
          1.8 + Math.random() * 2.2,
          3.5 + Math.random() * 2.5,
          120,
          null,
          1.8
        );
      }
    }

    // İsyancı gövdesi ve tabelası anında gizlenir ve sahneden tamamen kaldırılır
    protesterMesh.visible = false;
    if (protesterMesh.userData.placard) protesterMesh.userData.placard.visible = false;
    if (protesterMesh.parent) protesterMesh.parent.remove(protesterMesh);
    this.cinematicGroup.remove(protesterMesh);

    this.updateCombatMissionHUD();
  }

  // Mermi Çarpışma Tespiti (Genişletilmiş gövde + tabela vuruş kapsülü)
  checkBulletHit(origin, dir, maxDist = 120) {
    if (this.currentPhase !== STORY_PHASES.MISSION_COMBAT && this.currentPhase !== STORY_PHASES.VILLA_ARRIVAL) return null;
    let closest = null, closestDist = maxDist;
    const rayDir = dir.clone().normalize();

    for (const p of this.protesters) {
      if (p.userData.dead) continue;
      const cy = (p.userData.baseY !== undefined ? p.userData.baseY : p.position.y) + 1.4;
      const px = p.position.x, pz = p.position.z;

      const toX = px - origin.x, toY = cy - origin.y, toZ = pz - origin.z;
      const proj = toX * rayDir.x + toY * rayDir.y + toZ * rayDir.z;
      if (proj <= 0.2 || proj >= closestDist) continue;

      const closeX = origin.x + rayDir.x * proj;
      const closeY = origin.y + rayDir.y * proj;
      const closeZ = origin.z + rayDir.z * proj;

      const dy = Math.abs(closeY - cy);
      const dh = Math.hypot(closeX - px, closeZ - pz);

      // Cömert vuruş alanı (gövde + tabela + kollar)
      if (dh < 2.4 && dy < 3.2) {
        closestDist = proj;
        closest = p;
      }
    }

    if (closest) {
      const hitPt = origin.clone().addScaledVector(rayDir, closestDist);
      this.onHitProtester(closest, hitPt);
      return { point: hitPt, protester: closest };
    }
    return null;
  }

  // Alan Hasarı (Patlama, çekiç, kılıç, nuke, bomba)
  checkSphereHit(pos, radius = 3.5) {
    for (const p of this.protesters) {
      if (p.userData.dead) continue;
      const cy = (p.userData.baseY !== undefined ? p.userData.baseY : p.position.y) + 1.3;
      const d = Math.hypot(p.position.x - pos.x, cy - pos.y, p.position.z - pos.z);
      if (d <= radius + 2.4) {
        this.onHitProtester(p, p.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 9: İHANET! (David & Korumalar parayı ve silahları gasp eder, tekmeyle atarlar)
  // ═══════════════════════════════════════════════════════════════════════════
  startBetrayalConfrontation() {
    this.currentPhase = STORY_PHASES.BETRAYAL_CONFRONTATION;
    this.phaseTimer = 0;
    this.controlsLocked = true;
    this.weaponsLocked = true;
    this.guardsSeize = false;
    this.guardsAdvancing = false;
    this.davidHandsBehindBack = false;
    this.guardKick = false;

    // Kalan isyancı nesnelerini temizle
    for (const p of this.protesters) {
      if (p.parent) p.parent.remove(p);
    }
    this.protesters = [];

    sound.playLevelWin();
    this.setMission('GÖREV TAMAMLANDI', 'David Sterling ile görüşmek için villaya dönüldü...');

    const vx = 395.0, vy = 12.0, vz = -55.0;

    // Oyuncu villanın kapısından David'in yanına doğru yavaşça yürümeye başlar
    this.playerApproachingDavid = true;
    if (this.character) {
      this.character.setFirstPerson(false);
      this.character.mesh.position.set(vx, vy, vz + 9.5);
      this.character.mesh.rotation.y = Math.PI; // David'e bakar
      if (this.character.body) {
        this.character.body.position.set(vx, vy + 1.0, vz + 9.5);
        this.character.body.velocity.set(0, 0, 0);
      }
    }

    // David ve Korumaların konumunu garantiye al
    if (!this.davidActor) {
      const david = this._buildDavidModel();
      david.position.set(vx, vy, vz + 1.0);
      david.rotation.y = 0;
      this.cinematicGroup.add(david);
      this.davidActor = david;
    } else {
      this.davidActor.position.set(vx, vy, vz + 1.0);
      this.davidActor.rotation.y = 0;
    }

    if (!this.guardL) {
      this.guardL = this._buildMuscleGuardModel(false);
      this.guardL.position.set(vx - 1.8, vy, vz + 1.0);
      this.cinematicGroup.add(this.guardL);
    } else {
      this.guardL.position.set(vx - 1.8, vy, vz + 1.0);
    }

    if (!this.guardR) {
      this.guardR = this._buildMuscleGuardModel(true);
      this.guardR.position.set(vx + 1.8, vy, vz + 1.0);
      this.cinematicGroup.add(this.guardR);
    } else {
      this.guardR.position.set(vx + 1.8, vy, vz + 1.0);
    }

    // Kamera: Geniş sinematik yüzleşme açısı
    this.camera.position.set(vx - 3.2, vy + 2.0, vz + 7.8);
    this.camera.lookAt(vx, vy + 1.5, vz + 1.5);

    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Aferin! Sen başardın, yaptığın iş için teşekkür ederim. Kapımın önündeki o sefil isyancı ayak takımı tamamen temizlendi.',
          onStart: () => {
            this.davidHandsBehindBack = false;
            this.guardsAdvancing = false;
            this.guardsSeize = false;
          }
        },
        {
          speaker: 'player', name: 'OYUNCU', color: '#38bdf8',
          text: 'Tamam güzel, ancak şu para işini konuşalım. Söz verdiğin yüklü miktardaki ödemeyi ve silahları ver bakalım.',
          onStart: () => {
            // Biz konuşurken güvenlikler yavaşça bize doğru yürümeye başlar
            this.guardsAdvancing = true;
          }
        },
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Evet... Üzgünüm dostum... Ama para falan yok! Sen gerçekten bu kadar saf mısın? GÜVENLİKLER! ALIN ŞUNU VE TEMİZLEYİN!',
          onStart: () => {
            // Adam ellerini arkaya doğru koyar
            this.davidHandsBehindBack = true;
            this.guardsAdvancing = false;
            this.guardsSeize = true; // Güvenlikler bizi tutar
            sound.playIronHit();
            sound.playBlockHit();
            // Silahlar ve para zorla alınır
            this.weaponsLocked = true;
            if (this.character && this.character.hammer) this.character.hammer.visible = false;
            if (this.character && this.character.pistolGroup) this.character.pistolGroup.visible = false;
            if (this.handWeapons) this.handWeapons.setWeapon(0);
            this.setMission('İHANET! TÜM SİLAHLAR VE PARA GASP EDİLDİ!', 'David anlaşmayı bozdu! Korumalar tüm teçhizatını zorla aldı.');
          }
        },
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Ah sen ne kadar aptalsın! Koskoca bankaların, gökdelenlerin ve şehrin mutlak sahibi sana bir servet ve bu silahları bırakır mı sandın?'
        },
        {
          speaker: 'david', name: 'DAVID STERLING', color: '#facc15',
          text: 'Sen sadece benim kirli işlerimi yapan, kullanılıp atılacak küçük bir maşaydın! İşin bitti, şimdi çöplüğüne geri dön! Korumalar... Atın bu dilenciyi dışarı!'
        }
      ], () => {
        // Diyalog bitince koruma arkadan tekme vurur, kapı dışarı atılırız
        this.guardKick = true;
        sound.playExplosion(0.25);
        sound.playIronHit();

        if (this.character) {
          this.character.mesh.position.z = vz + 15.0; // Kapı dışına fırlatılırız
          if (this.character.body) this.character.body.position.z = vz + 15.0;
        }

        // Kapı çarparak kilitlenir
        setTimeout(() => {
          sound.playDoorSlide();
          sound.playIronHit();
          this.setFade(1, 900);
          setTimeout(() => {
            this.startDejectedWalkHome();
          }, 1100);
        }, 600);
      });
    }, 1200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 10: ŞEHİRDE İNSANLAR GEZERKEN EVE DOĞRU KAMBUR, HÜZÜNLÜ YÜRÜYÜŞ
  // (Araya bina girmeyen geniş cadde açısı, kambur hüzünlü yürüyüş, iç ses pişmanlık)
  // ═══════════════════════════════════════════════════════════════════════════
  startDejectedWalkHome() {
    this.currentPhase = STORY_PHASES.DEJECTED_WALK_HOME;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    // Şehirdeki yayaları ve trafiği yeniden aktifleştir
    if (this.voxelWorld && this.voxelWorld.npcs && this.voxelWorld.npcs.npcs) {
      this.voxelWorld.npcs.npcs.forEach(n => { if (n.group) n.group.visible = true; });
    }

    this.setMission('PİŞMANLIK & DÖNÜŞ', 'Her şeyinizi kaybettiniz... Yıkılmış halde eve doğru yürüyorsunuz.');
    this.setFade(0, 600);

    // Oyuncuyu Batı Şehir'deki ana caddenin kaldırımına yerleştir (-60'tan -105'e yürür)
    const startX = -60.0, startY = 1.0, startZ = 27.5;
    if (this.character) {
      this.character.setFirstPerson(false);
      this.character.mesh.position.set(startX, startY, startZ);
      this.character.mesh.rotation.y = -Math.PI / 2; // Batıya (eve) doğru yürür
      if (this.character.body) {
        this.character.body.position.set(startX, startY, startZ);
        this.character.body.velocity.set(0, 0, 0);
      }
    }

    // Yolda geçen 2-3 sivil vatandaş modeli ekle
    const npc1 = this._buildProtesterModel();
    if (npc1.userData && npc1.userData.placard) npc1.remove(npc1.userData.placard);
    npc1.position.set(-78.0, 1.0, 24.5);
    npc1.rotation.y = Math.PI / 2; // Karşı yöne yürür
    this.cinematicGroup.add(npc1);

    const npc2 = this._buildProtesterModel();
    if (npc2.userData && npc2.userData.placard) npc2.remove(npc2.userData.placard);
    npc2.position.set(-92.0, 1.0, 30.5);
    npc2.rotation.y = Math.PI / 2;
    this.cinematicGroup.add(npc2);

    this.startDialogQueue([
      {
        speaker: 'thought', name: 'İÇ SES (PİŞMANLIK)', color: '#93c5fd',
        text: 'Neden yaptım bunu?.. O açgözlü milyarderin yalanları uğruna masum insanları vurdum...'
      },
      {
        speaker: 'thought', name: 'İÇ SES', color: '#93c5fd',
        text: 'Paramı, silahlarımı, her şeyimi elimden aldı... Beni bir çöp gibi kapının önüne koydu.'
      },
      {
        speaker: 'thought', name: 'İÇ SES', color: '#93c5fd',
        text: 'Ona güvenmek hayatımın en büyük hatasıydı. Çok pişmanım, hem de çok...'
      }
    ], () => {
      // Yürüyüş tamamlanınca ev sahnesine geç
      this.setFade(1, 750);
      setTimeout(() => {
        this.startHomeCouchRevelation();
      }, 900);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 11: EVDE KOLTUKTA PİŞMAN OTURUŞ, ANİDEN KAMERAYA BAKIŞ & ANINDA KARARMA
  // ═══════════════════════════════════════════════════════════════════════════
  startHomeCouchRevelation() {
    this.currentPhase = STORY_PHASES.HOME_COUCH_REVELATION;
    this.phaseTimer = 0;
    this.headSnapUp = false;
    this.cinematicGroup.clear();

    const couchX = -110.25, couchY = 7.05, couchZ = 19.75;

    // Oyuncu 2. kattaki koltukta oturur
    if (this.character) {
      this.character.setFirstPerson(false);
      this.character.mesh.position.set(couchX, couchY, couchZ);
      this.character.mesh.rotation.y = 0; // Karşıya odaya bakar
      if (this.character.body) {
        this.character.body.position.set(couchX, couchY, couchZ);
        this.character.body.velocity.set(0, 0, 0);
      }
      // Hüzünlü koltuk oturuşu: Dizler bükülü, kollar dizlerde, kafa yere eğik
      if (this.character.leftLeg) this.character.leftLeg.rotation.x = -Math.PI / 2;
      if (this.character.rightLeg) this.character.rightLeg.rotation.x = -Math.PI / 2;
      if (this.character.torso) this.character.torso.rotation.x = 0.35;
      if (this.character.leftArm) this.character.leftArm.rotation.x = 0.65;
      if (this.character.rightArm) this.character.rightArm.rotation.x = 0.65;
      if (this.character.head) this.character.head.rotation.x = 0.55; // Yere bakar
    }

    // Kamera: Koltuktaki oyuncunun tam karşısı (yakın plan sinematik açı)
    this.camera.position.set(couchX, couchY + 0.75, couchZ + 2.1);
    this.camera.lookAt(couchX, couchY + 0.35, couchZ);

    this.setFade(0, 600);
    this.setMission('BİR FİKİR DOĞUYOR...', 'Yenilgiyi kabullenecek misin, yoksa kendi kurallarını mı yazacaksın?');

    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'thought', name: 'İÇ SES', color: '#93c5fd',
          text: 'Elimde hiçbir şey kalmadı... Burada bir kenara atılmış bir hiç gibi oturup çürümeyi mi bekleyeceğim?..'
        }
      ], () => {
        // 1.5 saniye derin sessizlik, sonra fikir kıvılcımı sesi
        setTimeout(() => {
          sound.playExplosion(0.12);
          sound.playZap();

          this.startDialogQueue([
            {
              speaker: 'player_determined', name: 'OYUNCU (KARARLILIK)', color: '#38bdf8',
              text: '...HAYIR! Pes etmeyeceğim. Eğer onun kurallarıyla oynarsam kaybederim... Ama kendi kurallarımı yaratırsam...'
            }
          ], () => {
            // Tam bu anda kafa aniden kameraya döner ve EKRAN ANINDA SİMSİYAH KARARIR!
            this.headSnapUp = true;
            sound.playIronHit();
            setTimeout(() => {
              this.setFade(1, 30); // Kullanıcı isteği: Ekran baktığımız anda hemen kararır
              setTimeout(() => {
                this.startSecretWorkshopOctopus();
              }, 400);
            }, 300);
          });
        }, 1200);
      });
    }, 800);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAHNE 12: TONY STARK MEKANİK LABORATUVARI & MEKANİK AHTAPOT ROBOTU MONTAJI
  // (Önce sağ kol gösterilir, titanyum kollarda çukurlar/oyuklar bulunur, intikam yemini)
  // ═══════════════════════════════════════════════════════════════════════════
  startSecretWorkshopOctopus() {
    this.currentPhase = STORY_PHASES.SECRET_WORKSHOP_OCTOPUS;
    this.phaseTimer = 0;
    this.cinematicGroup.clear();

    const wx = 0, wy = -45.0, wz = 0; // Yeraltı mekanik atölye koordinatları
    this._buildTonyStarkWorkshopAndArms(wx, wy, wz);

    // Oyuncu laboratuvarın merkezindeki teknolojik platformda durur
    if (this.character) {
      this.character.setFirstPerson(false);
      this.character.mesh.position.set(wx, wy + 0.25, wz);
      this.character.mesh.rotation.y = 0; // Karşıya bakar
      if (this.character.body) {
        this.character.body.position.set(wx, wy + 0.25, wz);
        this.character.body.velocity.set(0, 0, 0);
      }
      if (this.character.leftLeg) this.character.leftLeg.rotation.set(0, 0, 0);
      if (this.character.rightLeg) this.character.rightLeg.rotation.set(0, 0, 0);
      if (this.character.torso) this.character.torso.rotation.set(0, 0, 0);
      if (this.character.head) this.character.head.rotation.set(0, 0, 0);
      if (this.character.leftArm) this.character.leftArm.rotation.set(-0.2, 0, -0.2);
      if (this.character.rightArm) this.character.rightArm.rotation.set(-0.45, 0, 0.35); // Sağ kol öne uzanır
    }

    // Kamera: Kullanıcı isteği -> "Ekran bizim ilk önce sağ kolumuzu göstersin"
    this.camera.position.set(wx + 0.65, wy + 1.45, wz + 0.95);
    this.camera.lookAt(wx + 0.35, wy + 1.25, wz + 0.1);

    this.setFade(0, 600);
    sound.playSaberOn();
    sound.playTentacleWrap();
    this.setMission('GİZLİ LABORATUVAR', 'Mekanik Ahtapot Robotu prototipi monte ediliyor...');

    setTimeout(() => {
      this.startDialogQueue([
        {
          speaker: 'player_determined', name: 'OYUNCU (GİZLİ ATÖLYE)', color: '#38bdf8',
          text: 'Elimdeki son kuruşa kadar her şeyi bu yeraltı atölyesine ve prototipe yatırdım...'
        },
        {
          speaker: 'player_determined', name: 'OYUNCU', color: '#38bdf8',
          text: 'Titanyum alaşımlı çubuklar, mikro-hidrolikler ve gövdeye oyulmuş metal çukurlar... Mekanik Ahtapot Robotu tamamlandı!'
        },
        {
          speaker: 'player_determined', name: 'OYUNCU', color: '#38bdf8',
          text: 'David Sterling... Beni sokağa attın ama şimdi karşına silahsız değil, durdurulamaz bir güç olarak çıkıyorum! İNTİKAM VAKTİ GELDİ!'
        }
      ], () => {
        this.finishStoryAndUnlockRevenge();
      });
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HİKAYE TAMAMLANDI: MEKANİK AHTAPOT ROBOTU AÇILIR & SERBEST İNTİKAM BAŞLAR!
  // ═══════════════════════════════════════════════════════════════════════════
  finishStoryAndUnlockRevenge() {
    this.currentPhase = STORY_PHASES.FREE_ROAM_REVENGE;
    this.controlsLocked = false;
    this.weaponsLocked = false;
    window._octopusUnlocked = true;

    // Oyuncuyu dışarı caddenin önüne ışınla
    const returnPos = new THREE.Vector3(-105.0, 1.2, 28.0);
    if (this.character) {
      this.character.mesh.position.copy(returnPos);
      this.character.mesh.rotation.set(0, 0, 0);
      if (this.character.body) {
        this.character.body.position.copy(returnPos);
        this.character.body.velocity.set(0, 0, 0);
      }
      this.character.setFirstPerson(true);
      if (this.character.head) this.character.head.rotation.set(0, 0, 0);
      if (this.character.torso) this.character.torso.rotation.set(0, 0, 0);
      if (this.character.leftArm) this.character.leftArm.rotation.set(0, 0, 0);
      if (this.character.rightArm) this.character.rightArm.rotation.set(0, 0, 0);
      if (this.character.leftLeg) this.character.leftLeg.rotation.set(0, 0, 0);
      if (this.character.rightLeg) this.character.rightLeg.rotation.set(0, 0, 0);
    }

    // Mekanik Ahtapot silahını otomatik olarak kuşan
    if (this.weaponSystem) this.weaponSystem.setWeapon(16);
    if (this.handWeapons) this.handWeapons.setWeapon(16);

    this.cinematicGroup.clear();
    this.setFade(0, 400);

    sound.playLevelWin();
    sound.playTentacleWrap();
    this.setMission('🦾 İNTİKAM ZAMANI!', 'Mekanik Ahtapot devreye girdi! David Sterling’e ve şehrine haddini bildir!');
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

    // Sahne 1: Toplantı Odası & David'in Konuşurken El Kaldırma Animasyonu
    if (this.currentPhase === STORY_PHASES.CINEMATIC_BOARDROOM) {
      const rx = 0, ry = 35.0, rz = 0;
      const zoomT = Math.min(1.0, this.phaseTimer * 0.04);
      const camZ = 3.4 - zoomT * 0.45;
      this.camera.position.set(rx, ry + 1.85, rz + camZ);
      this.camera.lookAt(rx, ry + 1.45, rz);

      if (this.davidActor && this.davidActor.userData) {
        const { lArm, rArm } = this.davidActor.userData;
        if (lArm && rArm) {
          if (this.dialogIndex === 0) {
            lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, -1.25, dt * 4.0);
            lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, -0.35, dt * 4.0);
            rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, -1.25, dt * 4.0);
            rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, 0.35, dt * 4.0);
          } else {
            lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, -0.4, dt * 2.5);
            lArm.rotation.z = THREE.MathUtils.lerp(lArm.rotation.z, 0, dt * 2.5);
            rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, -0.4, dt * 2.5);
            rArm.rotation.z = THREE.MathUtils.lerp(rArm.rotation.z, 0, dt * 2.5);
          }
        }
      }
    }

    // Sahne 2: Drone Kuş Bakışı Kamera Hareketi
    if (this.currentPhase === STORY_PHASES.CINEMATIC_DRONE_PROTEST) {
      this.droneAngle += dt * 0.22;
      const vx = 395, vy = 12.0, vz = -40;
      const camR = 26 + Math.sin(this.droneAngle * 0.8) * 6;
      const camH = vy + 22 - Math.min(10, this.phaseTimer * 1.5);
      this.camera.position.set(
        vx + Math.cos(this.droneAngle) * camR,
        camH,
        vz + Math.sin(this.droneAngle) * camR
      );
      this.camera.lookAt(vx, vy + 2.0, vz);
    }

    // Hedef işaretçisi animasyonu & limuzine varış kontrolü
    if (this.waypointMarker && this.waypointMarker.visible) {
      const arrow = this.waypointMarker.userData.arrow;
      if (arrow) {
        arrow.position.y = 3.6 + Math.sin(this.phaseTimer * 4.5) * 0.4;
        arrow.rotation.y += dt * 2.2;
      }
      this.checkPlayerReachedLimoStop(playerPos);
    }

    // Limuzin bekleme: 2 saniye limuzine bakılır, ardından otomatik binilir
    if (this.currentPhase === STORY_PHASES.WAIT_LIMO) {
      if (this.phaseTimer > 2.0) {
        this.startLimoRide();
      }
    }

    // Limuzin yolculuğu: Sakin, akıcı lüks araba hızı & kabin koltuğunda kusursuz oturuş
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

    // Sahne 9: İhanet Yüzleşmesi & Korumaların Bizi Yakalaması
    if (this.currentPhase === STORY_PHASES.BETRAYAL_CONFRONTATION) {
      const vx = 395.0, vy = 12.0, vz = -55.0;

      // Oyuncunun David'e doğru yavaşça yürüyüşü
      if (this.playerApproachingDavid) {
        if (this.character && this.character.mesh) {
          const curZ = this.character.mesh.position.z;
          if (curZ > vz + 4.8) {
            this.character.mesh.position.z -= dt * 2.8;
            this.character.mesh.position.x = THREE.MathUtils.lerp(this.character.mesh.position.x, vx, dt * 2.5);
            if (this.character.body) this.character.body.position.copy(this.character.mesh.position);

            const t = this.phaseTimer * 4.5;
            if (this.character.leftLeg) this.character.leftLeg.rotation.x = -Math.sin(t) * 0.35;
            if (this.character.rightLeg) this.character.rightLeg.rotation.x = Math.sin(t) * 0.35;
            if (this.character.leftArm) this.character.leftArm.rotation.x = Math.sin(t) * 0.25;
            if (this.character.rightArm) this.character.rightArm.rotation.x = -Math.sin(t) * 0.25;
          } else {
            this.playerApproachingDavid = false;
            if (this.character.leftLeg) this.character.leftLeg.rotation.set(0, 0, 0);
            if (this.character.rightLeg) this.character.rightLeg.rotation.set(0, 0, 0);
            if (this.character.leftArm) this.character.leftArm.rotation.set(0, 0, 0);
            if (this.character.rightArm) this.character.rightArm.rotation.set(0, 0, 0);
          }
        }
      }

      this.camera.position.set(vx - 3.2, vy + 2.0, vz + 7.8);
      this.camera.lookAt(vx, vy + 1.5, vz + 1.5);

      if (this.davidActor && this.davidActor.userData) {
        const { lArm, rArm } = this.davidActor.userData;
        if (lArm && rArm) {
          if (this.davidHandsBehindBack) {
            // David ellerini arkaya doğru koyar
            lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, -0.65, dt * 4.0);
            rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, -0.65, dt * 4.0);
          } else {
            lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, 0.45, dt * 3.0);
            rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, 0.45, dt * 3.0);
          }
        }
      }

      if (this.guardsAdvancing && !this.guardKick) {
        // Güvenlikler yavaşça oyuncunun iki yanına yaklaşır
        const targetZ = vz + 5.0;
        if (this.guardL) {
          this.guardL.position.z = THREE.MathUtils.lerp(this.guardL.position.z, targetZ, dt * 2.2);
          this.guardL.position.x = THREE.MathUtils.lerp(this.guardL.position.x, vx - 1.1, dt * 2.2);
        }
        if (this.guardR) {
          this.guardR.position.z = THREE.MathUtils.lerp(this.guardR.position.z, targetZ, dt * 2.2);
          this.guardR.position.x = THREE.MathUtils.lerp(this.guardR.position.x, vx + 1.1, dt * 2.2);
        }
      }

      if (this.guardsSeize && !this.guardKick) {
        // Güvenlikler oyuncuyu kollarından tutar
        const targetZ = vz + 4.8;
        if (this.guardL) {
          this.guardL.position.set(vx - 0.72, vy, targetZ);
          this.guardL.rotation.y = 0.25;
        }
        if (this.guardR) {
          this.guardR.position.set(vx + 0.72, vy, targetZ);
          this.guardR.rotation.y = -0.25;
        }
      }
    }

    // Sahne 10: Hüzünlü, Kambur Yürüyüş (Cadde boyunca batıya doğru -X yönünde)
    if (this.currentPhase === STORY_PHASES.DEJECTED_WALK_HOME) {
      if (this.character && this.character.mesh) {
        const curX = Math.max(-105.0, this.character.mesh.position.x - dt * 1.8);
        this.character.mesh.position.x = curX;
        if (this.character.body) this.character.body.position.x = curX;

        const t = this.phaseTimer * 2.4;
        if (this.character.head) this.character.head.rotation.x = 0.42;
        if (this.character.torso) this.character.torso.rotation.x = 0.18;
        if (this.character.leftArm) this.character.leftArm.rotation.x = 0.22 + Math.sin(t) * 0.12;
        if (this.character.rightArm) this.character.rightArm.rotation.x = 0.22 - Math.sin(t) * 0.12;
        if (this.character.leftLeg) this.character.leftLeg.rotation.x = -Math.sin(t) * 0.28;
        if (this.character.rightLeg) this.character.rightLeg.rotation.x = Math.sin(t) * 0.28;

        // Geniş açık cadde hizasından takip (araya bina girmez!)
        this.camera.position.set(curX - 4.2, 1.0 + 1.8, 27.5 + 3.4);
        this.camera.lookAt(curX + 0.6, 1.0 + 1.2, 27.5);
      }
    }

    // Sahne 11: Koltukta Pişman Oturuş & Aniden Kameraya Bakış
    if (this.currentPhase === STORY_PHASES.HOME_COUCH_REVELATION) {
      const couchX = -110.25, couchY = 7.05, couchZ = 19.75;
      this.camera.position.set(couchX, couchY + 0.75, couchZ + 2.1);
      this.camera.lookAt(couchX, couchY + 0.35, couchZ);

      if (this.character && this.character.head) {
        if (this.headSnapUp) {
          this.character.head.rotation.x = THREE.MathUtils.lerp(this.character.head.rotation.x, -0.05, dt * 14.0);
        } else {
          this.character.head.rotation.x = 0.55;
        }
      }
    }

    // Sahne 12: Tony Stark Tarzı Yeraltı Mekanik Laboratuvarı & Ahtapot Kolları Montajı
    if (this.currentPhase === STORY_PHASES.SECRET_WORKSHOP_OCTOPUS) {
      const wx = 0, wy = -45.0, wz = 0;

      if (this.sparkLight) {
        this.sparkLight.intensity = (Math.random() > 0.35 ? 2.5 + Math.random() * 2.5 : 0.4);
      }

      if (this.phaseTimer < 4.0) {
        this.camera.position.set(wx + 0.65, wy + 1.45, wz + 0.95);
        this.camera.lookAt(wx + 0.35, wy + 1.25, wz + 0.1);
      } else {
        const camAngle = (this.phaseTimer - 4.0) * 0.45;
        this.camera.position.set(
          wx + Math.sin(camAngle) * 3.4,
          wy + 1.6 + Math.sin(camAngle * 0.8) * 0.3,
          wz + Math.cos(camAngle) * 3.4
        );
        this.camera.lookAt(wx, wy + 1.25, wz);
      }

      if (this.workshopTentacles && this.workshopTentacles.length > 0) {
        const tTime = this.phaseTimer * 3.5;
        this.workshopTentacles.forEach((tObj, idx) => {
          const side = tObj.cfg.side;
          const isTop = tObj.cfg.isTop;
          tObj.segs.forEach((segGroup, sIdx) => {
            const wave = Math.sin(tTime + sIdx * 0.4 + idx) * 0.15;
            segGroup.rotation.x = (isTop ? -0.18 : 0.12) + wave;
            segGroup.rotation.y = side * (0.16 + wave * 0.5);
          });
        });
      }
    }
  }

  // Sakin, akıcı, gerçekçi limuzin sürüşü & VIP kabinde kusursuz oturuş
  _updateLimoRide(dt) {
    if (!this.limo) return;

    const cruiseRate = Math.min(0.023, 0.007 + this.phaseTimer * 0.002);
    this.limoProgress += dt * cruiseRate;

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
      const rotY = Math.atan2(dx, dz) - Math.PI / 2;
      this.limo.rotation.y = rotY;

      // OYUNCUNUN KABİN KOLTUĞUNDAKİ KONUMU (Limuzinin altında DEĞİL, koltuk üstünde oturur!)
      // Yerel ofset: arka deri koltuk (x = -1.6, y = 2.15, z = 0)
      const seatOffset = new THREE.Vector3(-1.6, 2.15, 0);
      seatOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const camPos = this.limo.position.clone().add(seatOffset);

      // Karakter fiziği aşağı düşmesin, koltukta sabit kalsın
      if (this.character) {
        this.character.mesh.position.copy(camPos);
        if (this.character.body) {
          this.character.body.position.copy(camPos);
          this.character.body.velocity.set(0, 0, 0);
        }
      }

      // İçeride 360 derece bakış (Sağa fare -> sağa bakış, sola fare -> sola bakış)
      const yaw = (window._storyCamYaw !== undefined ? window._storyCamYaw : 0);
      const pitch = (window._storyCamPitch !== undefined ? window._storyCamPitch : 0);

      // Limuzinin önüne (+x) ve karşıdaki 2 kaslı korumaya bakan yön
      const lookLocal = new THREE.Vector3(
        Math.cos(pitch) * Math.cos(yaw),
        Math.sin(pitch),
        -Math.cos(pitch) * Math.sin(yaw)
      );
      lookLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

      this.camera.position.copy(camPos);
      this.camera.lookAt(camPos.clone().add(lookLocal));
    } else {
      this.startPhaseVillaArrival();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3D MODELLER (Siyah Gözlüklü David, Mutlu Arthur, Farklı Korumalar, Limuzin, Tony Stark Atölyesi)
  // ═══════════════════════════════════════════════════════════════════════════

  _buildTonyStarkWorkshopAndArms(wx, wy, wz) {
    const g = new THREE.Group();
    g.position.set(wx, wy, wz);

    const darkMetalMat = MAT(0x1e293b, { roughness: 0.4, metalness: 0.7 });
    const floorSteelMat = MAT(0x0f172a, { roughness: 0.3, metalness: 0.85 });
    const cautionYellow = MAT(0xfacc15, { roughness: 0.4 });
    const cyanNeonMat = MAT(0x06b6d4, { emissive: 0x06b6d4, emissiveIntensity: 2.2, roughness: 0.1 });
    const titaniumMat = MAT(0x334155, { roughness: 0.3, metalness: 0.8 });
    const steelMat = MAT(0x64748b, { roughness: 0.25, metalness: 0.9 });
    const pitMat = MAT(0x020617, { roughness: 0.95 }); // Metal çukur / oyuk detayı
    const arcGlowMat = MAT(0x38bdf8, { emissive: 0x0284c7, emissiveIntensity: 3.5 });

    // 1. Zemin ve Emniyet Şeritleri
    const floor = new THREE.Mesh(BOX(18, 0.4, 16), floorSteelMat);
    floor.position.y = -0.2;
    g.add(floor);

    for (let i = -7; i <= 7; i += 2) {
      const stripeL = new THREE.Mesh(BOX(0.6, 0.42, 1.4), cautionYellow);
      stripeL.position.set(-8.2, -0.19, i);
      g.add(stripeL);
      const stripeR = new THREE.Mesh(BOX(0.6, 0.42, 1.4), cautionYellow);
      stripeR.position.set(8.2, -0.19, i);
      g.add(stripeR);
    }

    // 2. Duvarlar (Perçinli endüstriyel metal paneller)
    const backWall = new THREE.Mesh(BOX(18, 6.5, 0.4), darkMetalMat);
    backWall.position.set(0, 3.0, -7.8);
    g.add(backWall);

    const leftWall = new THREE.Mesh(BOX(0.4, 6.5, 16), darkMetalMat);
    leftWall.position.set(-8.8, 3.0, 0);
    g.add(leftWall);

    const rightWall = new THREE.Mesh(BOX(0.4, 6.5, 16), darkMetalMat);
    rightWall.position.set(8.8, 3.0, 0);
    g.add(rightWall);

    // 3. Tavan Çelik Kirişleri
    for (let z = -6; z <= 6; z += 4) {
      const girder = new THREE.Mesh(BOX(18, 0.35, 0.35), darkMetalMat);
      girder.position.set(0, 6.2, z);
      g.add(girder);
    }

    // 4. Merkezi Platform (Oyuncunun durduğu teknolojik zemin)
    const platMat = MAT(0x334155, { metalness: 0.8, roughness: 0.3 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.25, 8), platMat);
    platform.position.set(0, 0.12, 0);
    g.add(platform);

    const platRing = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.38, 0.08, 8), cyanNeonMat);
    platRing.position.set(0, 0.22, 0);
    g.add(platRing);

    // 5. Sol Tezgah: Mekanik Torna & Kaynak İstasyonu
    const bench1 = new THREE.Mesh(BOX(1.4, 1.2, 4.2), darkMetalMat);
    bench1.position.set(-4.5, 0.6, -2.5);
    g.add(bench1);

    const vice = new THREE.Mesh(BOX(0.35, 0.35, 0.45), steelMat);
    vice.position.set(-4.3, 1.35, -3.2);
    g.add(vice);

    const weldBase = new THREE.Mesh(BOX(0.4, 0.5, 0.4), darkMetalMat);
    weldBase.position.set(-4.2, 1.45, -1.8);
    g.add(weldBase);

    const weldArm = new THREE.Mesh(BOX(0.12, 0.8, 0.12), steelMat);
    weldArm.position.set(-3.9, 1.85, -1.8);
    weldArm.rotation.z = -0.55;
    g.add(weldArm);

    const sparkLight = new THREE.PointLight(0x67e8f9, 2.5, 4.5);
    sparkLight.position.set(-3.5, 1.7, -1.8);
    g.add(sparkLight);
    this.sparkLight = sparkLight;

    // 6. Sağ Hologram / Bilgisayar Konsolu
    const terminalBase = new THREE.Mesh(BOX(1.5, 1.1, 3.2), darkMetalMat);
    terminalBase.position.set(4.5, 0.55, -2.5);
    g.add(terminalBase);

    const screen1 = new THREE.Mesh(BOX(0.08, 0.85, 1.2), MAT(0x0284c7, { emissive: 0x0284c7, emissiveIntensity: 2.0 }));
    screen1.position.set(4.2, 1.45, -3.1);
    screen1.rotation.y = -0.3;
    g.add(screen1);

    const screen2 = new THREE.Mesh(BOX(0.08, 0.85, 1.2), MAT(0x0369a1, { emissive: 0x0369a1, emissiveIntensity: 1.8 }));
    screen2.position.set(4.2, 1.45, -1.9);
    screen2.rotation.y = 0.2;
    g.add(screen2);

    // 7. Aydınlatma
    const cyanSpot = new THREE.SpotLight(0x38bdf8, 3.2, 14, Math.PI / 4, 0.4);
    cyanSpot.position.set(0, 5.8, 0);
    cyanSpot.target.position.set(0, 1.0, 0);
    g.add(cyanSpot);
    g.add(cyanSpot.target);

    const warmLight = new THREE.PointLight(0xfef08a, 1.0, 6.0);
    warmLight.position.set(-4.0, 2.5, -2.5);
    g.add(warmLight);

    // 8. OYUNCUNUN SIRTINA TAKILAN MEKANİK AHTAPOT ROBOTU MODELİ
    // (Titanyum çubuklar, mikro-hidrolik pistonlar ve gövdede çukurlar / oyuklar)
    const apparatus = new THREE.Group();
    apparatus.position.set(0, 0, 0);

    const chassis = new THREE.Mesh(BOX(0.68, 0.82, 0.26), titaniumMat);
    chassis.position.set(0, 1.35, -0.22);
    apparatus.add(chassis);

    const arcCore = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), arcGlowMat);
    arcCore.rotation.x = Math.PI / 2;
    arcCore.position.set(0, 1.35, -0.36);
    apparatus.add(arcCore);

    // Sağ Kol Siber Zırhı / Mekanik Bileklik (İlk kadrajda öne çıkar)
    const cyberArm = new THREE.Mesh(BOX(0.32, 0.55, 0.32), steelMat);
    cyberArm.position.set(0.62, 1.15, 0.1);
    apparatus.add(cyberArm);

    const pitArm = new THREE.Mesh(BOX(0.08, 0.28, 0.34), pitMat);
    pitArm.position.set(0.62, 1.15, 0.1);
    apparatus.add(pitArm);

    // 4 Adet Eklemli Mekanik Ahtapot Kolu (Titanyum çubuklar & minik çukurlar)
    const tentacles = [];
    const tentacleConfigs = [
      { startX: -0.32, startY: 1.62, startZ: -0.28, side: -1, isTop: true },
      { startX:  0.32, startY: 1.62, startZ: -0.28, side:  1, isTop: true },
      { startX: -0.28, startY: 1.08, startZ: -0.28, side: -1, isTop: false },
      { startX:  0.28, startY: 1.08, startZ: -0.28, side:  1, isTop: false }
    ];

    tentacleConfigs.forEach((cfg) => {
      const tRoot = new THREE.Group();
      tRoot.position.set(cfg.startX, cfg.startY, cfg.startZ);

      let curParent = tRoot;
      const segGroups = [];
      const numSegs = 7;

      for (let s = 0; s < numSegs; s++) {
        const segGroup = new THREE.Group();
        const u = s / (numSegs - 1);
        const w = 0.22 * (1 - u * 0.45);
        const h = 0.20 * (1 - u * 0.45);
        const d = 0.32;

        const segMesh = new THREE.Mesh(BOX(w, h, d), s % 2 === 0 ? titaniumMat : steelMat);
        segMesh.position.set(0, 0, -d * 0.5);
        segGroup.add(segMesh);

        // KULLANICI İSTEĞİ: Metal çubuk olduğu için bazı yerlerinde minik çukurlar / oyuklar (Pits)
        const pitLeft = new THREE.Mesh(BOX(0.04, h * 0.45, d * 0.38), pitMat);
        pitLeft.position.set(-w * 0.51, 0, -d * 0.5);
        segGroup.add(pitLeft);

        const pitRight = new THREE.Mesh(BOX(0.04, h * 0.45, d * 0.38), pitMat);
        pitRight.position.set(w * 0.51, 0, -d * 0.5);
        segGroup.add(pitRight);

        // Cyan Enerji Devresi
        const cyanLine = new THREE.Mesh(BOX(w * 0.28, 0.03, d * 0.75), cyanNeonMat);
        cyanLine.position.set(0, h * 0.51, -d * 0.5);
        segGroup.add(cyanLine);

        // Uç Kısma Üçlü Çelik Kıskaç Pençeler
        if (s === numSegs - 1) {
          const clawMat = MAT(0xe2e8f0, { roughness: 0.15, metalness: 0.95 });
          const claw1 = new THREE.Mesh(BOX(0.05, 0.05, 0.25), clawMat);
          claw1.position.set(0, 0.08, -d - 0.1);
          claw1.rotation.x = -0.25;
          const claw2 = new THREE.Mesh(BOX(0.05, 0.05, 0.25), clawMat);
          claw2.position.set(-0.08, -0.06, -d - 0.1);
          claw2.rotation.z = -0.4;
          const claw3 = new THREE.Mesh(BOX(0.05, 0.05, 0.25), clawMat);
          claw3.position.set(0.08, -0.06, -d - 0.1);
          claw3.rotation.z = 0.4;
          segGroup.add(claw1, claw2, claw3);
        }

        segGroup.position.set(0, 0, s === 0 ? 0 : -d);
        curParent.add(segGroup);
        segGroups.push(segGroup);
        curParent = segGroup;
      }

      apparatus.add(tRoot);
      tentacles.push({ root: tRoot, segs: segGroups, cfg });
    });

    g.add(apparatus);
    this.workshopApparatus = apparatus;
    this.workshopTentacles = tentacles;

    this.cinematicGroup.add(g);
    return g;
  }

  _buildDavidModel() {
    const g = new THREE.Group();
    const legMat = MAT(0x0f172a);
    const lLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); lLeg.position.set(-0.2, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.3, 0.9, 0.3), legMat); rLeg.position.set(0.2, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.7, 0.85, 0.42), MAT(0x1e1b4b));
    torso.position.set(0, 1.32, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.65, 0.44), MAT(0xdc2626));
    tie.position.set(0, 1.32, 0.02); g.add(tie);

    const head = new THREE.Mesh(BOX(0.48, 0.48, 0.48), MAT(0xd4a373));
    head.position.set(0, 1.98, 0); g.add(head);

    const hair = new THREE.Mesh(BOX(0.5, 0.18, 0.5), MAT(0x1e293b));
    hair.position.set(0, 2.18, 0); g.add(hair);

    const shadesMat = MAT(0x050505, { roughness: 0.1, metalness: 0.9 });
    const shadesL = new THREE.Mesh(BOX(0.17, 0.13, 0.5), shadesMat);
    shadesL.position.set(-0.12, 1.98, 0.03); g.add(shadesL);
    const shadesR = new THREE.Mesh(BOX(0.17, 0.13, 0.5), shadesMat);
    shadesR.position.set(0.12, 1.98, 0.03); g.add(shadesR);
    const shadesBridge = new THREE.Mesh(BOX(0.1, 0.04, 0.5), shadesMat);
    shadesBridge.position.set(0, 2.0, 0.03); g.add(shadesBridge);

    const armMat = MAT(0x1e1b4b);
    const lArmGroup = new THREE.Group();
    lArmGroup.position.set(-0.46, 1.65, 0);
    const lArmMesh = new THREE.Mesh(BOX(0.22, 0.8, 0.22), armMat);
    lArmMesh.position.set(0, -0.35, 0);
    lArmGroup.add(lArmMesh);
    g.add(lArmGroup);

    const rArmGroup = new THREE.Group();
    rArmGroup.position.set(0.46, 1.65, 0);
    const rArmMesh = new THREE.Mesh(BOX(0.22, 0.8, 0.22), armMat);
    rArmMesh.position.set(0, -0.35, 0);
    rArmGroup.add(rArmMesh);
    g.add(rArmGroup);

    g.userData.lArm = lArmGroup;
    g.userData.rArm = rArmGroup;

    return g;
  }

  _buildDavidWithPhoneModel() {
    const g = this._buildDavidModel();
    const phone = new THREE.Mesh(BOX(0.1, 0.22, 0.06), MAT(0xfacc15, { metalness: 0.9 }));
    phone.position.set(0.26, 1.98, 0.1);
    g.add(phone);
    return g;
  }

  _buildArthurHappyModel() {
    const g = new THREE.Group();
    const matSuit = MAT(0x1e3a8a);
    const lLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); lLeg.position.set(-0.18, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.28, 0.9, 0.28), matSuit); rLeg.position.set(0.18, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.65, 0.8, 0.38), matSuit);
    torso.position.set(0, 1.3, 0); g.add(torso);

    const tie = new THREE.Mesh(BOX(0.12, 0.6, 0.4), MAT(0x38bdf8));
    tie.position.set(0, 1.3, 0.02); g.add(tie);

    const head = new THREE.Mesh(BOX(0.46, 0.46, 0.46), MAT(0xf1c27d));
    head.position.set(0, 1.93, 0); g.add(head);

    const hair = new THREE.Mesh(BOX(0.48, 0.15, 0.48), MAT(0x94a3b8));
    hair.position.set(0, 2.12, 0); g.add(hair);

    const frameMat = MAT(0x0284c7, { metalness: 0.8 });
    const glassLensMat = MAT(0x38bdf8, { transparent: true, opacity: 0.28, roughness: 0.1 });

    const lFrame = new THREE.Mesh(BOX(0.16, 0.13, 0.48), frameMat);
    lFrame.position.set(-0.11, 1.95, 0.02); g.add(lFrame);
    const rFrame = new THREE.Mesh(BOX(0.16, 0.13, 0.48), frameMat);
    rFrame.position.set(0.11, 1.95, 0.02); g.add(rFrame);

    const lensL = new THREE.Mesh(BOX(0.14, 0.11, 0.49), glassLensMat);
    lensL.position.set(-0.11, 1.95, 0.025); g.add(lensL);
    const lensR = new THREE.Mesh(BOX(0.14, 0.11, 0.49), glassLensMat);
    lensR.position.set(0.11, 1.95, 0.025); g.add(lensR);

    const pupilMat = MAT(0x0f172a);
    const pL = new THREE.Mesh(BOX(0.06, 0.06, 0.48), pupilMat); pL.position.set(-0.11, 1.95, 0.01); g.add(pL);
    const pR = new THREE.Mesh(BOX(0.06, 0.06, 0.48), pupilMat); pR.position.set(0.11, 1.95, 0.01); g.add(pR);

    const smile = new THREE.Mesh(BOX(0.2, 0.06, 0.48), MAT(0xbe123c));
    smile.position.set(0, 1.82, 0.03); g.add(smile);

    const lArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), matSuit);
    lArm.position.set(-0.42, 1.25, 0.1); lArm.rotation.x = -0.5; g.add(lArm);
    const rArm = new THREE.Mesh(BOX(0.2, 0.75, 0.2), matSuit);
    rArm.position.set(0.42, 1.25, 0.1); rArm.rotation.x = -0.5; g.add(rArm);

    return g;
  }

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

  // Limuzin içinde koltukta oturan kaslı koruma modeli
  // (Kafası, siyah güneş gözlükleri, kırmızı kravatı ve göğsünde kavuşmuş kaslı kolları tam göz hizasında)
  _buildSeatedMuscleGuardModel() {
    const g = new THREE.Group();
    const blackSuit = MAT(0x020617, { roughness: 0.3 });
    const redTie = MAT(0xdc2626);
    const skin = MAT(0xd4a373);
    const shoeMat = MAT(0x09090b, { roughness: 0.2, metalness: 0.4 });

    // 1. Ayakkabılar ve Alt Bacaklar (Zemine dik basar)
    const lShoe = new THREE.Mesh(BOX(0.28, 0.10, 0.18), shoeMat);
    lShoe.position.set(-0.30, 0.05, 0.18);
    g.add(lShoe);
    const rShoe = new THREE.Mesh(BOX(0.28, 0.10, 0.18), shoeMat);
    rShoe.position.set(-0.30, 0.05, -0.18);
    g.add(rShoe);

    const lShin = new THREE.Mesh(BOX(0.20, 0.32, 0.20), blackSuit);
    lShin.position.set(-0.30, 0.22, 0.18);
    g.add(lShin);
    const rShin = new THREE.Mesh(BOX(0.20, 0.32, 0.20), blackSuit);
    rShin.position.set(-0.30, 0.22, -0.18);
    g.add(rShin);

    // 2. Uyluklar (Koltuk minderi üzerinde yatay uzanır)
    const lThigh = new THREE.Mesh(BOX(0.34, 0.18, 0.22), blackSuit);
    lThigh.position.set(-0.14, 0.38, 0.18);
    g.add(lThigh);
    const rThigh = new THREE.Mesh(BOX(0.34, 0.18, 0.22), blackSuit);
    rThigh.position.set(-0.14, 0.38, -0.18);
    g.add(rThigh);

    const pelvis = new THREE.Mesh(BOX(0.28, 0.18, 0.60), blackSuit);
    pelvis.position.set(0.04, 0.38, 0);
    g.add(pelvis);

    // 3. Kaslı Üst Gövde (Geniş omuzlu takım elbiseli ceket)
    const torso = new THREE.Mesh(BOX(0.34, 0.52, 0.78), blackSuit);
    torso.position.set(0.04, 0.70, 0);
    g.add(torso);

    // Kırmızı İpek Kravat
    const tie = new THREE.Mesh(BOX(0.36, 0.38, 0.12), redTie);
    tie.position.set(-0.01, 0.70, 0);
    g.add(tie);

    // Göğüste Birbirine Bağlanmış Kaslı Kollar
    const crossedArm1 = new THREE.Mesh(BOX(0.22, 0.16, 0.68), blackSuit);
    crossedArm1.position.set(-0.16, 0.74, 0.02);
    crossedArm1.rotation.y = 0.04;
    g.add(crossedArm1);

    const crossedArm2 = new THREE.Mesh(BOX(0.22, 0.16, 0.68), blackSuit);
    crossedArm2.position.set(-0.18, 0.64, -0.02);
    crossedArm2.rotation.y = -0.04;
    g.add(crossedArm2);

    const lShoulder = new THREE.Mesh(BOX(0.28, 0.18, 0.20), blackSuit);
    lShoulder.position.set(0.04, 0.90, 0.38);
    g.add(lShoulder);
    const rShoulder = new THREE.Mesh(BOX(0.28, 0.18, 0.20), blackSuit);
    rShoulder.position.set(0.04, 0.90, -0.38);
    g.add(rShoulder);

    // 4. Boyun ve Kafa (Tam göz hizasında, kafası kesinlikle tavana girmez)
    const neck = new THREE.Mesh(BOX(0.18, 0.10, 0.18), skin);
    neck.position.set(0.04, 0.98, 0);
    g.add(neck);

    const head = new THREE.Mesh(BOX(0.34, 0.34, 0.34), skin);
    head.position.set(0.04, 1.15, 0);
    g.add(head);

    // Siyah Güneş Gözlüğü (Önde bize dönük)
    const shades = new THREE.Mesh(BOX(0.10, 0.10, 0.32), MAT(0x000000, { roughness: 0.1 }));
    shades.position.set(-0.14, 1.17, 0);
    g.add(shades);

    // Siyah Taranmış Saç
    const hair = new THREE.Mesh(BOX(0.36, 0.10, 0.36), MAT(0x0a0a0a, { roughness: 0.9 }));
    hair.position.set(0.04, 1.30, 0);
    g.add(hair);

    return g;
  }

  _buildProtesterModel(sloganText = 'DEFOL!') {
    const g = new THREE.Group();
    const colors = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0891b2, 0xe11d48, 0x475569];
    const shirtMat = MAT(colors[Math.floor(Math.random() * colors.length)]);
    const pantMat = MAT(0x334155);
    const skinMat = MAT(0xe0ac86);

    const lLeg = new THREE.Mesh(BOX(0.26, 0.9, 0.26), pantMat); lLeg.position.set(-0.16, 0.45, 0); g.add(lLeg);
    const rLeg = new THREE.Mesh(BOX(0.26, 0.9, 0.26), pantMat); rLeg.position.set(0.16, 0.45, 0); g.add(rLeg);

    const torso = new THREE.Mesh(BOX(0.6, 0.8, 0.35), shirtMat);
    torso.position.set(0, 1.3, 0); g.add(torso);

    const head = new THREE.Mesh(BOX(0.42, 0.42, 0.42), skinMat);
    head.position.set(0, 1.95, 0); g.add(head);

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

    const board = new THREE.Mesh(BOX(1.9, 0.95, 0.06), MAT(0xfef08a));
    board.position.set(0, 2.0, 0.05);
    placardGroup.add(board);

    const banner = new THREE.Mesh(BOX(1.6, 0.42, 0.08), MAT(0xdc2626));
    banner.position.set(0, 2.0, 0.06);
    placardGroup.add(banner);

    placardGroup.position.set(0, 1.0, 0.35);
    g.add(placardGroup);
    g.userData.placard = placardGroup;

    g.scale.setScalar(1.55);
    return g;
  }

  // 6. Lüks Altın & Beyaz Limuzin Modeli
  // (Kabin tabanı y=1.05, koltuk y=1.45, tavan y=2.65, oyuncu göz yüksekliği y=2.15)
  _buildLuxuryLimoModel() {
    const g = new THREE.Group();
    const whiteMat = MAT(0xf8fafc, { roughness: 0.15, metalness: 0.2 });
    const goldMat = MAT(0xf59e0b, { roughness: 0.1, metalness: 0.9, emissive: 0xb45309 });
    const glassDark = MAT(0x0a0f1d, { transparent: true, opacity: 0.92, roughness: 0.1 });
    const tireMat = MAT(0x111827, { roughness: 0.8 });
    const blackLeather = MAT(0x0f172a, { roughness: 0.4 });

    // Ana Gövde
    const body = new THREE.Mesh(BOX(11.2, 1.25, 2.5), whiteMat);
    body.position.y = 0.85;
    g.add(body);

    // Altın Yan Çıtalar
    const goldTrimL = new THREE.Mesh(BOX(11.0, 0.1, 0.08), goldMat);
    goldTrimL.position.set(0, 0.7, 1.26);
    g.add(goldTrimL);

    const goldTrimR = new THREE.Mesh(BOX(11.0, 0.1, 0.08), goldMat);
    goldTrimR.position.set(0, 0.7, -1.26);
    g.add(goldTrimR);

    // Ön Kaput Izgarası ve Altın Heykelcik
    const grille = new THREE.Mesh(BOX(0.12, 0.85, 1.4), goldMat);
    grille.position.set(5.55, 0.85, 0);
    g.add(grille);

    const ornamentBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.08, 12), goldMat);
    ornamentBase.position.set(5.45, 1.52, 0);
    g.add(ornamentBase);

    const ornamentBody = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10), goldMat);
    ornamentBody.position.set(5.43, 1.65, 0);
    ornamentBody.rotation.z = -0.3;
    g.add(ornamentBody);

    const ornamentWingL = new THREE.Mesh(BOX(0.08, 0.14, 0.02), goldMat);
    ornamentWingL.position.set(5.4, 1.70, 0.08);
    ornamentWingL.rotation.y = 0.5;
    g.add(ornamentWingL);

    const ornamentWingR = new THREE.Mesh(BOX(0.08, 0.14, 0.02), goldMat);
    ornamentWingR.position.set(5.4, 1.70, -0.08);
    ornamentWingR.rotation.y = -0.5;
    g.add(ornamentWingR);

    // VIP Kabin Yapısı
    const cabinFloor = new THREE.Mesh(BOX(7.6, 0.15, 2.3), whiteMat);
    cabinFloor.position.set(-0.4, 1.05, 0);
    g.add(cabinFloor);

    const cabinRoof = new THREE.Mesh(BOX(7.6, 0.15, 2.3), whiteMat);
    cabinRoof.position.set(-0.4, 2.65, 0);
    g.add(cabinRoof);

    // Karartmalı Yan Camlar
    const glassL = new THREE.Mesh(BOX(7.2, 0.95, 0.06), glassDark);
    glassL.position.set(-0.4, 1.95, 1.15);
    g.add(glassL);

    const glassR = new THREE.Mesh(BOX(7.2, 0.95, 0.06), glassDark);
    glassR.position.set(-0.4, 1.95, -1.15);
    g.add(glassR);

    // Şık Çizgi Şeklinde Mor LED Şerit Aydınlatma (Kabin tavanı kenarları boyunca uzanır)
    const ledMat = MAT(0xa855f7, { emissive: 0xa855f7, emissiveIntensity: 2.5, roughness: 0.1 });
    const ledStripL = new THREE.Mesh(BOX(7.2, 0.03, 0.05), ledMat);
    ledStripL.position.set(-0.4, 2.62, 1.08);
    g.add(ledStripL);

    const ledStripR = new THREE.Mesh(BOX(7.2, 0.03, 0.05), ledMat);
    ledStripR.position.set(-0.4, 2.62, -1.08);
    g.add(ledStripR);

    // Ön ve arka tavan enine LED şeritleri
    const ledFront = new THREE.Mesh(BOX(0.05, 0.03, 2.16), ledMat);
    ledFront.position.set(3.2, 2.62, 0);
    g.add(ledFront);

    const ledBack = new THREE.Mesh(BOX(0.05, 0.03, 2.16), ledMat);
    ledBack.position.set(-4.0, 2.62, 0);
    g.add(ledBack);

    // Yumuşak, sıcak ve dengeli kabin ambiyans ışığı (bütün arabayı mor yapmaz, yüzleri aydınlatır)
    const cabinLight = new THREE.PointLight(0xfff7ed, 0.95, 6.5);
    cabinLight.position.set(-0.2, 2.45, 0);
    g.add(cabinLight);

    // Lüks Deri Koltuklar
    // 1) Oyuncunun oturduğu arka koltuk (x = -1.6, y = 1.35)
    const seatPlayer = new THREE.Mesh(BOX(1.1, 0.45, 2.0), blackLeather);
    seatPlayer.position.set(-1.6, 1.35, 0);
    g.add(seatPlayer);

    const seatPlayerBack = new THREE.Mesh(BOX(0.2, 0.9, 2.0), blackLeather);
    seatPlayerBack.position.set(-2.15, 1.8, 0);
    g.add(seatPlayerBack);

    // 2) Korumaların oturduğu ön karşı koltuk (x = 1.2, y = 1.35)
    const seatGuards = new THREE.Mesh(BOX(1.1, 0.45, 2.0), blackLeather);
    seatGuards.position.set(1.2, 1.35, 0);
    g.add(seatGuards);

    const seatGuardsBack = new THREE.Mesh(BOX(0.2, 0.9, 2.0), blackLeather);
    seatGuardsBack.position.set(1.75, 1.8, 0);
    g.add(seatGuardsBack);

    // KABİN İÇİNDE OYUNCUYA BAKAN 2 KASLI KORUMA (Kafaları, güneş gözlükleri ve kravatları tam göz hizasında)
    const guard1 = this._buildSeatedMuscleGuardModel();
    guard1.position.set(1.15, 1.05, 0.48);
    g.add(guard1);

    const guard2 = this._buildSeatedMuscleGuardModel();
    guard2.position.set(1.15, 1.05, -0.48);
    g.add(guard2);

    // 6 Adet Altın Jantlı Tekerlek
    const wheelPositions = [
      [-4.0, 0.45, 1.28], [-4.0, 0.45, -1.28],
      [0.0, 0.45, 1.28], [0.0, 0.45, -1.28],
      [3.8, 0.45, 1.28], [3.8, 0.45, -1.28]
    ];
    for (const [wx, wy, wz] of wheelPositions) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.36, 18), tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(wx, wy, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.38, 12), goldMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, wy, wz);
      g.add(tire);
      g.add(hub);
    }

    return g;
  }
}
