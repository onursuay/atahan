import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import confetti from 'canvas-confetti';
import { Character } from './character.js';
import { WeaponSystem } from './weapons.js';
import { LevelManager } from './levels.js';
import { ParticleSystem } from './particles.js';
import { VoxelWorld, VOXEL_SIZE } from './teardown.js';
import { GROUND_Y } from './terrain.js';
import { HandWeapons } from './handweapons.js';
import { NPCManager } from './npc.js';
import { BombManager } from './bombs.js';
import { PlaneManager } from './planes.js';
import { CarManager } from './cars.js';
import { DayNight } from './daynight.js';
import { TrafficLights } from './traffic.js';
import { PropManager } from './props.js';
import { sound } from './audio.js';
import { getGrassTopTexture } from './textures.js';
import { MapSystem } from './map.js';
import { MetroSystem } from './metro.js';

let scene, camera, renderer;
let physicsWorld;
let inCar = false, scopeOn = false, targetFov = 70;
let cars, hp = 100, lastHitT = 0, invulnUntil = 0;
let planes, bombs, npcs, handWeapons, character, weaponSystem, levelManager, particleSystem, voxelWorld;
let props, mapSystem, metro;

let currentScore = 0;
let isLevelCompleted = false;
let screenShake = 0;
let clouds = [];

// Kamera Açıları
let cameraYaw = Math.PI;
let cameraPitch = 0.05;
let firstPerson = true; // varsayılan: karakterin gözünden (V ile uzak kameraya geçilebilir)
let eyeY = null;        // yumuşatılmış göz yüksekliği (basamakta/inişte sıçramasın)
let bobAmount = 0;      // yürüyüş sallanması şiddeti (0..1)
const cameraDistance = 9.0;
const cameraHeight = 3.2;

// ── AÇILIŞ JENERİĞİ ──
// Siyah ekran → ekran yavaşça açılır; karakter kendi evinde koltukta otururken yere doğru bakar, ekran görünmeye başlayınca
// yavaşça kafasını kaldırıp televizyona bakar. Jenerik boyunca kontroller kapalıdır; televizyona bakınca kontroller geri gelir.
const INTRO_TURN = 0;                         // doğrudan TV hizasında yere bakar, kafasını yavaşça TV'ye kaldırır
const INTRO_PITCH0 = 1.05;                    // başlangıçta yere doğru bakış (rad, aşağı bakış)
const INTRO_BASE_YAW = -Math.PI / 2;          // TV yönü (doğu, +x)
const INTRO_SEAT_EYE = 0.85;                  // oturan karakterin göz yüksekliği (ayak seviyesinden, m)
// 2 kat yavaş jenerik: Ekran önce siyah kalır, yavaş yavaş açılır ve yavaşça televizyona bakar
const INTRO_T = { fadeStart: 0.4, fadeEnd: 3.6, lookStart: 0.6, lookEnd: 4.5, remoteDown: 3.8, end: 4.5 };
let introActive = false, introPlayed = false, introT = 0, introWaiting = false;
let eyeOffset = 1.8;                          // kamera göz yüksekliği (ayaktan); oturunca düşer
let seated = false;                           // koltukta oturuyor (ilk hareketle kalkar)
let introFadeEl = null, remoteModel = null, introMenuEl = null;
let mouseSens = 1;                            // ayarlar menüsünden: fare hassasiyeti çarpanı
const smoothstep01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

// UI DOM Elemanları
const canvasContainer = document.getElementById('canvas-container');
const levelTitleEl = document.getElementById('level-title');
const levelDescEl = document.getElementById('level-desc');
const destructionPercentEl = document.getElementById('destruction-percent');
const destructionBarEl = document.getElementById('destruction-bar');
const targetPercentEl = document.getElementById('target-percent');
const targetMarkerEl = document.getElementById('target-marker');
const scoreDisplayEl = document.getElementById('score-display');
const scorePopupsEl = document.getElementById('score-popups');

const levelModal = document.getElementById('level-modal');
const modalTitle = document.getElementById('modal-title');
const modalSubtitle = document.getElementById('modal-subtitle');
const modalDestruction = document.getElementById('modal-destruction');
const modalScore = document.getElementById('modal-score');
const star1 = document.getElementById('star-1');
const star2 = document.getElementById('star-2');
const star3 = document.getElementById('star-3');

const levelsModal = document.getElementById('levels-modal');
const levelsGrid = document.getElementById('levels-grid');

function setLoadingProgress(pct, title, sub) {
  const bar = document.getElementById('mm-loading-bar');
  const txt = document.getElementById('mm-loading-text');
  const subTxt = document.getElementById('mm-loading-sub');
  if (bar) bar.style.width = `${pct}%`;
  if (txt && title) txt.innerText = title;
  if (subTxt && sub) subTxt.innerText = sub;
}

export function finishLoadingUI() {
  try {
    setLoadingProgress(100, 'ŞEHİR HAZIR!', 'Başlamak için OYNA butonuna tıkla.');
    const loadEl = document.getElementById('mm-loading');
    if (loadEl) loadEl.style.display = 'none';
    const homeEl = document.getElementById('mm-home');
    if (homeEl) homeEl.style.display = 'flex';
  } catch (e) {
    console.warn('finishLoadingUI error:', e);
  }
}

function init() {
  setLoadingProgress(20, 'GRAFİK VE FİZİK MOTORU BAŞLATILIYOR...', 'Üç boyutlu dünya oluşturuluyor...');
  // 1. Sahne (Teardown Tarzı Aydınlık Gökyüzü - 5X Genişletilmiş Harita Görüşü)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x78a7ff);
  scene.fog = new THREE.Fog(0x78a7ff, 600, 9500);

  // 2. Kamera: 15000 m görüş mesafesi (5 kat geniş harita)
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 15000);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.autoClear = false; // silah modeli ikinci geçişte çizilir
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  // 4. Işıklandırma ve Gerçekçi Gölgeler (Gelişmiş Gölge Haritası)
  ambientLight = new THREE.AmbientLight(0xffffff, 0.55); // Gölgelerin net ve derin görünmesi için dengeli ortam ışığı
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfffbe8, 1.4);
  sunLight.position.set(60, 95, 45);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048; // Optimize edilmiş keskin gölgeler
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 260;

  // Tüm şehri, sahili, uzun köprüyü ve adayı kapsayan geniş gölge alanı
  const dx = 150;
  const dz = 125;
  sunLight.shadow.camera.left = -dx;
  sunLight.shadow.camera.right = dx;
  sunLight.shadow.camera.top = dz;
  sunLight.shadow.camera.bottom = -dz;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);   // gölge alanı oyuncuyu izler (şehir büyüdü)

  // Gökyüzünde Kare Güneş
  const sunGeo = new THREE.BoxGeometry(6, 6, 0.5);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.set(40, 50, 35);
  sunMesh.lookAt(0, 0, 0);
  scene.add(sunMesh);

  // 5. Cannon.js Fizik Dünyası
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -25, 0)
  });
  physicsWorld.solver.iterations = 8;
  physicsWorld.defaultContactMaterial.friction = 0.55;
  physicsWorld.defaultContactMaterial.restitution = 0.1;

  // 6. Çimen Zemin ve Voxel Bulutlar
  createWorldArena();

  // 7. Teardown Voxel Dünyası, Parçacıklar ve Karakter
  particleSystem = new ParticleSystem(scene);

  voxelWorld = new VoxelWorld(scene, physicsWorld, particleSystem, (points, text) => {
    addScore(points, text);
    screenShake = 0.35;
  });
  props = new PropManager(scene, voxelWorld);
  voxelWorld.props = props;

  character = new Character(scene, physicsWorld, particleSystem, voxelWorld);
  setFirstPerson(true);

  weaponSystem = new WeaponSystem(scene, physicsWorld, particleSystem, voxelWorld, (points, text) => {
    addScore(points, text);
    screenShake = 0.4;
  });

  handWeapons = new HandWeapons(scene, camera, voxelWorld, particleSystem, (points, text) => addScore(points, text));
  handWeapons.setFirstPerson(firstPerson);
  handWeapons.onAmmoChange = updateMagUI;
  handWeapons.arsenal.onShake = (s) => { screenShake = Math.max(screenShake, s); };
  handWeapons.arsenal.onHint = showWeaponHint;
  handWeapons.props = props;

  voxelWorld.collapse.onShake = (v) => { screenShake = Math.max(screenShake, v); };
  cars = new CarManager(scene, voxelWorld, particleSystem, (points, text) => addScore(points, text), (dx, dz, speed) => {
    character.applyKnock(dx * Math.min(14, 4 + speed * 0.6), 4, dz * Math.min(14, 4 + speed * 0.6));
    damagePlayer(8 + speed * 1.2);
  });
  voxelWorld.cars = cars;
  cars.onCrash = (impact) => { damagePlayer(Math.min(35, impact * 1.1)); screenShake = Math.max(screenShake, 0.5); };
  handWeapons.cars = cars;
  planes = new PlaneManager(scene, voxelWorld, particleSystem, (points, text) => addScore(points, text), (s) => { screenShake = Math.max(screenShake, s); });
  voxelWorld.planes = planes;
  handWeapons.planes = planes;
  voxelWorld.onBlast = (pos, radius, force) => {
    const p = character.mesh.position;
    const dx = p.x - pos.x, dy = p.y + 1 - pos.y, dz = p.z - pos.z;
    const d = Math.hypot(dx, dy, dz), reach = radius * 1.8;
    // Yakın patlamada hasar: merkezde ağır, uzaklaştıkça hafif
    const dmgReach = radius * 1.3;
    if (d < dmgReach) damagePlayer((1 - d / dmgReach) * (radius * 24 + 25));
    if (d > reach || d < 0.01) return;
    const k = (1 - d / reach) * Math.min(1, force / 300) * 16;   // m/s
    character.applyKnock((dx / d) * k, Math.max(0, dy / d) * k * 0.7 + k * 0.25, (dz / d) * k);
  };
  bombs = new BombManager(scene, camera, voxelWorld, particleSystem, (s) => { screenShake = s; }, (n) => {
    document.getElementById('detonate-btn').classList.toggle('show', n > 0);
  });
  npcs = new NPCManager(scene, voxelWorld, particleSystem, (points, text) => addScore(points, text));
  voxelWorld.npcs = npcs;
  handWeapons.npcs = npcs;
  metro = new MetroSystem(scene, voxelWorld, (s) => { screenShake = Math.max(screenShake, s); });
  voxelWorld.metro = metro;

  levelManager = new LevelManager(voxelWorld);

  // İlk Bölümü Yükle
  setLoadingProgress(55, 'DEVASA METROPOL HARİTASI İNŞA EDİLİYOR...', 'Bulvarlar, caddeler ve kumsal hazırlanıyor...');
  try {
    loadLevel(0);
  } catch (err) {
    console.error('loadLevel(0) hatası:', err);
  }

  try { setupEventListeners(); } catch (e) { console.warn(e); }
  try { buildLevelSelectButtons(); } catch (e) { console.warn(e); }
  try { mapSystem = new MapSystem(); } catch (e) { console.warn(e); }

  finishLoadingUI();
  // Garanti yükleme emniyet kilitleri (Watchdog)
  setTimeout(finishLoadingUI, 1200);
  setTimeout(finishLoadingUI, 3000);

  // Oyun Döngüsü
  let lastTime = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    updateGame(dt);
    renderer.clear();
    renderer.render(scene, camera);
    handWeapons.render(renderer);
  }
  requestAnimationFrame(animate);
}

function createWorldArena() {
  // Zemin artık voxelWorld.terrain tarafından kurulur (yollar, kumsal, iskele kaplama + fizik kutuları)

  // Deniz / Okyanus Suyu Düzlemi (5 Kat Genişletilmiş Harita Okyanusu: 50000 m)
  waterGeo = new THREE.PlaneGeometry(50000, 50000, 40, 40);
  waterMat = new THREE.MeshLambertMaterial({
    color: 0x0369a1,
    transparent: true,
    opacity: 0.85
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.15;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);

  // Yüzen Voxel Bulutlar (10 Kat Dünya Gökyüzü)
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });

  for (let i = 0; i < 32; i++) {
    const w = 24 + Math.random() * 32;
    const d = 20 + Math.random() * 28;
    const cloudGeo = new THREE.BoxGeometry(w, 2.0, d);
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.position.set(
      (Math.random() - 0.5) * 2800,
      45 + Math.random() * 15,
      (Math.random() - 0.5) * 2800
    );
    scene.add(cloudMesh);
    clouds.push({ mesh: cloudMesh, speed: 2.0 + Math.random() * 3.5 });
  }
}

function damagePlayer(amount) {
  if (performance.now() < invulnUntil || amount <= 0) return;
  hp -= amount;
  lastHitT = performance.now();
  screenShake = Math.max(screenShake, Math.min(0.8, amount / 80));
  if (hp <= 0) respawnPlayer();
}

// Ölünce spawn noktasında yeniden doğar; dünya, yıkım ve puan olduğu gibi kalır
function respawnPlayer() {
  if (inCar) exitCar();
  hp = 100;
  invulnUntil = performance.now() + 1500;
  const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
  character.resetPosition(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);
  character.fuel = 1; character.knock.set(0, 0, 0);
  const f = document.getElementById('death-flash');
  f.style.transition = 'none'; f.style.opacity = '0.85';
  requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity 1.4s ease-out'; f.style.opacity = '0'; }));
}

function updateVitals(dt) {
  if (hp < 100 && performance.now() - lastHitT > 5000) hp = Math.min(100, hp + 8 * dt); // yavaş iyileşme
  document.getElementById('hp-bar').style.width = `${Math.max(0, hp)}%`;
  document.getElementById('hp-text').innerText = Math.max(0, Math.round(hp));
  document.getElementById('jet-bar').style.width = `${Math.round(character.fuel * 100)}%`;
  document.getElementById('jet-bar').style.background = character.jetting ? '#fde047' : '#38bdf8';
}

let fountainTimer = 0;
function updateFountains(dt) {
  fountainTimer += dt;
  if (fountainTimer < 0.045) return;
  fountainTimer = 0;
  const cp = character.mesh.position;
  (voxelWorld.fountains || []).forEach(f => {
    if (f.dead) return;
    // Orta sütun ya da üst kase kırılırsa çeşme akmayı bırakır
    if (f.keys && f.keys.some(k => { const v = voxelWorld.voxels.get(k); return !v || !v.active; })) { f.dead = true; return; }
    if (Math.abs(f.x - cp.x) > 90 || Math.abs(f.z - cp.z) > 90) return; // uzaktakini çizme
    particleSystem.createFountainJet(new THREE.Vector3(f.x, f.y, f.z));
  });
}

// Deniz yüzeyi: hafif dalgalar
let waveTime = 0, waveFrame = 0, waterGeo = null;
function updateWaves(dt) {
  if (!waterGeo) return;
  waveTime += dt;
  if ((waveFrame++ & 1) !== 0) return;
  const pos = waterGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sin(x * 0.18 + waveTime * 1.6) * 0.06 + Math.cos(y * 0.15 + waveTime * 1.2) * 0.05);
  }
  pos.needsUpdate = true;
}

const doorActors = [];
let sunLight = null, ambientLight = null, sunMesh = null, waterMat = null, dayNight = null, clockT = 0;
function updateGame(dt) {
  if (introActive && introWaiting) {
    // Menüde bekleme süresince dünya simülasyonu çalışmasın, tam başlangıç anında dondurulsun
    const cfg = levelManager ? levelManager.levelConfigs[levelManager.currentLevelIndex] : null;
    if (cfg && character && character.body) {
      character.body.position.set(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);
      character.vel.set(0, 0, 0);
      character.mesh.position.set(cfg.spawn.x, cfg.spawn.y - 0.525, cfg.spawn.z);
    }
    if (sunLight) {
      const sx = Math.round(camera.position.x / 8) * 8, sz = Math.round(camera.position.z / 8) * 8;
      sunLight.target.position.set(sx, 0, sz);
      const sd = dayNight ? dayNight.dir : new THREE.Vector3(0.45, 0.72, 0.34);
      sunLight.position.set(sx + sd.x * 118, sd.y * 118, sz + sd.z * 118);
    }
    updateCamera(dt);
    return;
  }

  physicsWorld.step(1 / 60, dt, 3);
  // Güneş ve gölge alanı oyuncuyu izler (8 m'lik adımlarla: gölgeler titremesin)
  if (sunLight) {
    const sx = Math.round(camera.position.x / 8) * 8, sz = Math.round(camera.position.z / 8) * 8;
    sunLight.target.position.set(sx, 0, sz);
    const sd = dayNight ? dayNight.dir : new THREE.Vector3(0.45, 0.72, 0.34);   // gündüz güneş, gece ay yönü (gece-gündüz döngüsü)
    sunLight.position.set(sx + sd.x * 118, sd.y * 118, sz + sd.z * 118);
  }
  props.update(dt);
  if (voxelWorld.traffic) voxelWorld.traffic.update(dt);
  if (dayNight) {
    dayNight.update(dt, camera.position, inCar ? cars.driven : null);
    clockT -= dt;
    if (clockT <= 0) { clockT = 1; const el = document.getElementById('daynight'); if (el) el.innerText = dayNight.label(); }
  }

  // Karakter Kontrolü (W tuşu ileri vb.)
  if (inCar) {
    cars.updateDriven(dt, inputState);
    const cp = cars.driven.pos;
    character.mesh.position.set(cp.x, cp.y, cp.z);       // kamera ve diğer sistemler oyuncuyu arabayla birlikte görür
    character.body.position.set(cp.x, cp.y + 1, cp.z);
    const dc = cars.driven;
    sound.updateEngine(dc.speed / (dc.T.speed[1] * 1.4), inputState.forward, inputState.jump || inputState.backward && dc.speed > 0);
  } else {
    sound.stopEngine();
    if (introActive && introWaiting) {
      // Menüde bekleme süresince fizik motorunun karakteri koltuktan düşürmesini veya kaydırmasını engelle
      const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
      character.body.position.set(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);
      character.vel.set(0, 0, 0);
      character.mesh.position.set(cfg.spawn.x, cfg.spawn.y - 0.525, cfg.spawn.z);
    } else {
      character.update(dt, inputState, cameraYaw);
    }
  }
  // Jenerik: kontroller kapalı; bitince oyuncu ilk hareketinde koltuktan kalkar (göz yüksekliği yükselir)
  if (introActive) { for (const k in inputState) inputState[k] = false; updateIntro(dt); }
  else if (seated && (inputState.forward || inputState.backward || inputState.left || inputState.right || inputState.jump)) seated = false;
  if (!introActive) eyeOffset += ((seated ? INTRO_SEAT_EYE : 1.8) - eyeOffset) * (1 - Math.exp(-5 * dt));
  if (voxelWorld.homeTV) {
    voxelWorld.homeTV.light.intensity = voxelWorld.homeTV.broken ? 0 : (14 + Math.sin(performance.now() * 0.011) * 2 + Math.sin(performance.now() * 0.0047) * 2.5);   // TV ışığı hafifçe titrer, kırılınca söner
    if (voxelWorld.homeTV.update) voxelWorld.homeTV.update(dt);
  }
  // Birinci kişi: karakter her zaman baktığımız yöne dönük olsun (silah öne baksın)
  if (firstPerson && !inCar) character.mesh.rotation.y = cameraYaw + Math.PI;
  // Nişangâh yakınlaştırması (yumuşak)
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();

  // Teardown Voxel Dünyası ve Döküntü Fiziği
  voxelWorld.update(dt);

  // Yıkım Oranı
  const currentPct = voxelWorld.getDestructionPercentage();
  updateDestructionUI(currentPct);

  const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
  if (currentPct >= cfg.targetPercent && !isLevelCompleted) {
    triggerLevelWin(currentPct);
  }

  // Silahlar ve Parçacıklar
  weaponSystem.update(dt);
  npcs.update(dt, character.mesh.position);
  bombs.update(dt);
  planes.update(dt);
  cars.update(dt, character.mesh.position);
  if (metro && !introWaiting) metro.update(dt, character);
  // Otomatik (sürgülü) kapıları açan hareketliler: oyuncu (ya da sürdüğü araç), yayalar ve trafik
  doorActors.length = 0;
  doorActors.push({ x: character.mesh.position.x, y: character.mesh.position.y, z: character.mesh.position.z });
  for (const n of npcs.npcs) doorActors.push({ x: n.x, y: n.y, z: n.z, npc: true });
  for (const c of cars.cars) if (c.state === 'drive') doorActors.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z });
  voxelWorld.doors.update(dt, doorActors);
  updateCrosshair();
  updateFountains(dt);
  updateVitals(dt);
  updateWaves(dt);
  handWeapons.update(dt, {
    moving: character.isGrounded && !character.inWater &&
      (Math.abs(character.vel.x) + Math.abs(character.vel.z)) > 1.5,
    walkCycle: character.walkCycle,
    character,
    onYawDelta: (d) => { cameraYaw -= d; },
    onScreenShake: (s) => { screenShake = Math.max(screenShake, s); }
  });
  particleSystem.update(dt);

  // Bulutlar (10 kat geniş gökyüzünde süzülür)
  clouds.forEach(c => {
    c.mesh.position.x += c.speed * dt;
    if (c.mesh.position.x > 1400) c.mesh.position.x = -1400;
  });

  // Harita (Minimap ve Büyük Dünya Haritası)
  if (mapSystem) {
    mapSystem.update(character.mesh.position, cameraYaw, dt);
  }

  updateCamera(dt);
}

// Elde tutulan TV kumandası (silah modelinin çizildiği ayrı sahnede; kamerayla birlikte durur)
function buildRemote() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.028, 0.24), new THREE.MeshLambertMaterial({ color: 0x15181d }));
  g.add(body);
  const cols = [0xdc2626, 0x22c55e, 0x3b82f6, 0xfacc15];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.02), new THREE.MeshLambertMaterial({ color: r === 0 && c === 0 ? 0xdc2626 : cols[(r + c) % 4] }));
    b.position.set(-0.016 + c * 0.032, 0.018, -0.07 + r * 0.04);
    g.add(b);
  }
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
  led.position.set(0, 0.016, -0.115);
  g.add(led);
  g.visible = false;
  handWeapons.viewScene.add(g);
  return g;
}

function startIntro() {
  introPlayed = true; introActive = true; introT = 0;
  if (!firstPerson) setFirstPerson(true);
  seated = true; eyeOffset = INTRO_SEAT_EYE; eyeY = null;
  for (const k in inputState) inputState[k] = false;
  if (!introFadeEl) {
    introFadeEl = document.getElementById('intro-fade') || document.createElement('div');
    const menu = document.getElementById('main-menu') || document.createElement('div');
    const $ = (id) => menu.querySelector('#' + id);
    const sBtn = $('mm-settings'), bBtn = $('mm-back'), sndBtn = $('mm-sound'), sensInp = $('mm-sens'), pBtn = $('mm-play');
    if (sBtn) sBtn.onclick = () => { $('mm-home').style.display = 'none'; $('mm-set').style.display = 'flex'; };
    if (bBtn) bBtn.onclick = () => { $('mm-set').style.display = 'none'; $('mm-home').style.display = 'flex'; };
    if (sndBtn) sndBtn.onclick = () => { sound.init(); const m = sound.toggleMute(); sndBtn.innerText = m ? 'SES: KAPALI' : 'SES: AÇIK'; const b = document.getElementById('btn-sound'); if (b) b.innerText = m ? '🔇' : '🔊'; };
    if (sensInp) sensInp.oninput = (e) => { mouseSens = parseFloat(e.target.value); };
    if (pBtn) pBtn.onclick = () => {      // OYNA: menü kapanır, jenerik başlar
      try {
        menu.style.display = 'none';
        introWaiting = false; introT = 0;
        try { sound.init(); } catch (e) {}
        // Oyuna başlandığı an şehirdeki evimizin 2. katındaki televizyon odasında koltukta başlasın
        const cfg = (levelManager && levelManager.levelConfigs) ? levelManager.levelConfigs[levelManager.currentLevelIndex || 0] : null;
        if (cfg && cfg.spawn) character.resetPosition(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z);
        seated = true; eyeOffset = INTRO_SEAT_EYE; eyeY = null;
        cameraYaw = INTRO_BASE_YAW + INTRO_TURN; cameraPitch = INTRO_PITCH0;
        if (document.pointerLockElement !== canvasContainer) canvasContainer.requestPointerLock();
      } catch (err) {
        console.warn('Oyna basildiginda kurtarma calisti:', err);
        menu.style.display = 'none';
        document.body.classList.remove('intro');
        if (introFadeEl) introFadeEl.style.display = 'none';
        introActive = false;
      }
    };
    introMenuEl = menu;
  }
  // Oyun ana menüyle başlar: OYNA'ya basılana kadar ekran siyah, jenerik bekler
  introWaiting = true;
  if (introMenuEl) introMenuEl.style.display = 'flex';
  if (introFadeEl) { introFadeEl.style.display = 'block'; introFadeEl.style.opacity = '1'; }
  document.body.classList.add('intro');
  if (!remoteModel) remoteModel = buildRemote();
  remoteModel.visible = true;
  handWeapons.root.visible = false;
  cameraYaw = INTRO_BASE_YAW + INTRO_TURN; cameraPitch = INTRO_PITCH0;

  finishLoadingUI();
}

function updateIntro(dt) {
  if (introWaiting) return;   // oyuncu başlat ekranına tıklayana kadar siyah ekranda bekler
  introT += dt;
  const T = INTRO_T;
  if (introFadeEl) {
    const fadeVal = 1 - smoothstep01((introT - T.fadeStart) / (T.fadeEnd - T.fadeStart));
    introFadeEl.style.opacity = String(Math.max(0, fadeVal));
    if (fadeVal <= 0) introFadeEl.style.display = 'none';
  }
  // Baş hareketi: önce aşağı (yere/dizlere) bakıyor, 2 kat yavaşça başını yukarı kaldırır ve TV'ye bakar
  const k = smoothstep01((introT - T.lookStart) / (T.lookEnd - T.lookStart));
  cameraPitch = INTRO_PITCH0 * (1 - k) + 0.0 * k;
  cameraYaw = INTRO_BASE_YAW;

  // Kumanda: elinde tutar, TV'ye doğru bakarken butona basar, sonra el aşağı iner
  if (remoteModel) {
    const down = smoothstep01((introT - T.remoteDown) / (T.end - T.remoteDown));
    const press = Math.max(0, Math.sin((introT - 2.8) * 10)) * (introT > 2.8 && introT < 3.3 ? 1 : 0);
    remoteModel.position.set(0.16, -0.27 + Math.sin(introT * 1.5) * 0.003 - down * 0.35, -0.42);
    remoteModel.rotation.set(0.55 + press * 0.12, -0.25, 0.08);
  }

  // Televizyona bakar bakmaz jenerik biter, kontroller geri gelir
  if (introT >= T.end) endIntro();
}

function endIntro() {
  introActive = false;
  introFadeEl.style.opacity = '0'; introFadeEl.style.display = 'none';
  document.body.classList.remove('intro');
  remoteModel.visible = false;
  handWeapons.root.visible = true;
  cameraPitch = 0.0; cameraYaw = INTRO_BASE_YAW;
}

function setFirstPerson(on) {
  firstPerson = on;
  eyeY = null;
  character.setFirstPerson(on);
  if (handWeapons) handWeapons.setFirstPerson(on);
  cameraPitch = on ? Math.min(cameraPitch, 1.3) : Math.max(-0.2, Math.min(0.9, cameraPitch));
  const btn = document.getElementById('btn-camera');
  if (btn) btn.classList.toggle('active', on);
}

function updateCamera(dt) {
  const charPos = character.mesh.position;

  if (inCar && cars.driven) {
    // Araç takip kamerası: arkadan, hafif yüksekten
    const c = cars.driven;
    const target = new THREE.Vector3(c.pos.x - c.fwd.x * 8.5, c.pos.y + 3.6, c.pos.z - c.fwd.z * 8.5);
    camera.position.lerp(target, Math.min(1, dt * 6));
    camera.lookAt(c.pos.x + c.fwd.x * 3, c.pos.y + 1.0, c.pos.z + c.fwd.z * 3);
    return;
  }

  if (firstPerson) {
    // Göz: kafanın olduğu nokta, biraz önde (gövde çarpışma kutusunun içinde kalır, duvara girmez)
    const dirX = -Math.sin(cameraYaw) * Math.cos(cameraPitch);
    const dirY = -Math.sin(cameraPitch);
    const dirZ = -Math.cos(cameraYaw) * Math.cos(cameraPitch);

    // Yükseklik yumuşatılır: basamak çıkarken ve inerken kamera sıçramaz
    const targetY = charPos.y + eyeOffset;
    if (eyeY === null || Math.abs(targetY - eyeY) > 3) eyeY = targetY;
    eyeY += (targetY - eyeY) * (1 - Math.exp(-16 * dt));

    // Hafif yürüyüş sallanması (yalnız karada yürürken), suda yavaş dalgalanma
    const walking = character.isGrounded && !character.inWater &&
      (Math.abs(character.vel.x) + Math.abs(character.vel.z)) > 1.5;
    bobAmount += ((walking ? 1 : 0) - bobAmount) * (1 - Math.exp(-8 * dt));
    let bobY = Math.sin(character.walkCycle * 2) * 0.035 * bobAmount;
    let bobX = Math.sin(character.walkCycle) * 0.02 * bobAmount;
    if (character.inWater) bobY += Math.sin(performance.now() * 0.002) * 0.04;

    const rightX = Math.cos(cameraYaw), rightZ = -Math.sin(cameraYaw);
    camera.position.set(
      charPos.x - Math.sin(cameraYaw) * 0.25 + rightX * bobX,
      eyeY + bobY,
      charPos.z - Math.cos(cameraYaw) * 0.25 + rightZ * bobX
    );
    if (screenShake > 0) {
      camera.position.x += (Math.random() - 0.5) * screenShake * 0.4;
      camera.position.y += (Math.random() - 0.5) * screenShake * 0.4;
      camera.position.z += (Math.random() - 0.5) * screenShake * 0.4;
      screenShake = Math.max(0, screenShake - dt * 1.5);
    }
    camera.lookAt(camera.position.x + dirX, camera.position.y + dirY, camera.position.z + dirZ);
    return;
  }

  const cosPitch = Math.cos(cameraPitch);
  const sinPitch = Math.sin(cameraPitch);
  const sinYaw = Math.sin(cameraYaw);
  const cosYaw = Math.cos(cameraYaw);

  const offsetX = sinYaw * cosPitch * cameraDistance;
  const offsetY = sinPitch * cameraDistance + cameraHeight;
  const offsetZ = cosYaw * cosPitch * cameraDistance;

  const targetCamPos = new THREE.Vector3(
    charPos.x + offsetX,
    charPos.y + offsetY,
    charPos.z + offsetZ
  );

  camera.position.lerp(targetCamPos, 14 * dt);

  // Ekran Sarsıntısı
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    camera.position.z += (Math.random() - 0.5) * screenShake;
    screenShake = Math.max(0, screenShake - dt * 1.5);
  }

  const lookTarget = new THREE.Vector3(charPos.x, charPos.y + 1.6, charPos.z);
  camera.lookAt(lookTarget);
}

function loadLevel(index) {
  isLevelCompleted = false;
  try {
    levelModal.classList.remove('active');
    levelsModal.classList.remove('active');
  } catch (e) {}

  setLoadingProgress(80, 'BİNALAR VE YAŞAM ALANLARI KURULUYOR...', 'Okul, hastane, gökdelenler ve yapay zeka ekleniyor...');
  
  let cfg = null;
  try {
    cfg = levelManager.loadLevel(index);
  } catch (err) {
    console.error('Bölüm yüklenirken hata oluştu:', err);
  }
  if (!cfg) cfg = { spawn: { x: 0, y: 15, z: 0 }, title: 'BÜYÜK ŞEHİR', desc: 'Şehri keşfet!', targetPercent: 70 };

  try { weaponSystem.clear(); } catch(e){}
  try { bombs.clear(); } catch(e){}
  try { planes.clear(); } catch(e){}
  try { particleSystem.clear(); } catch(e){}
  try { handWeapons.resetAmmo(); } catch(e){}
  try { character.resetPosition(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z); } catch(e){}
  try { npcs.playerPos.set(cfg.spawn.x, 0, cfg.spawn.z); } catch(e){}
  try {
    props.clear();
    for (const s of (voxelWorld.propSpawns || [])) props.add(s.kind, s.x, s.y, s.z, s);
  } catch(e){ console.warn('Prop spawn warn:', e); }
  try { npcs.reset(); } catch(e){ console.warn('NPC reset warn:', e); }
  try { voxelWorld.traffic = new TrafficLights(voxelWorld); } catch(e){}
  try { cars.build(); } catch(e){ console.warn('Car build warn:', e); }
  try { if (metro) metro.initWorld(); } catch(e){}
  try {
    if (dayNight && typeof dayNight.dispose === 'function') dayNight.dispose();
    dayNight = new DayNight({ scene, ambient: ambientLight, sun: sunLight, sunMesh, clouds, water: waterMat, vw: voxelWorld });
    npcs.day = () => DayNight.dayAmount(dayNight.t);
    window.__gece = (sn) => dayNight.setTime(sn);
  } catch(e){ console.warn('DayNight warn:', e); }

  cameraYaw = -Math.PI / 2; // Evdeki koltuktan doğuya, televizyona doğru baksın
  seated = true; eyeOffset = INTRO_SEAT_EYE; eyeY = null;

  try {
    if (!introPlayed) startIntro();   // açılış jeneriği yalnız oyun ilk açıldığında
    else cameraPitch = 0.0;
  } catch (e) {
    console.warn('Intro warn:', e);
  } finally {
    finishLoadingUI();
  }

  try {
    levelTitleEl.innerText = cfg.title;
    levelDescEl.innerText = cfg.desc;
    targetPercentEl.innerText = `${cfg.targetPercent}%`;
    targetMarkerEl.style.left = `${cfg.targetPercent}%`;
    updateDestructionUI(0);
    updateWeaponUI();
  } catch (e) {}
}

function updateDestructionUI(percent) {
  destructionPercentEl.innerText = `${percent}%`;
  destructionBarEl.style.width = `${percent}%`;

  if (percent >= 70) {
    destructionBarEl.style.background = 'linear-gradient(90deg, #5b8e32, #69a139)';
  } else {
    destructionBarEl.style.background = 'linear-gradient(90deg, #db3323, #fed83d)';
  }
}

function addScore(points, label) {
  currentScore += points;
  scoreDisplayEl.innerText = currentScore.toLocaleString();

  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerText = label || `+${points}`;
  popup.style.left = `${window.innerWidth / 2 + (Math.random() - 0.5) * 100}px`;
  popup.style.top = `${window.innerHeight / 2 - 40 + (Math.random() - 0.5) * 50}px`;
  scorePopupsEl.appendChild(popup);

  setTimeout(() => {
    if (popup.parentElement) popup.parentElement.removeChild(popup);
  }, 1200);
}

function triggerLevelWin(pct) {
  isLevelCompleted = true;
  sound.playLevelWin();

  confetti({
    particleCount: 140,
    spread: 80,
    origin: { y: 0.6 }
  });

  const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
  let stars = 1;
  if (pct >= cfg.targetPercent + 10) stars = 2;
  if (pct >= 95) stars = 3;

  star1.classList.toggle('lit', stars >= 1);
  star2.classList.toggle('lit', stars >= 2);
  star3.classList.toggle('lit', stars >= 3);

  modalDestruction.innerText = `${pct}%`;
  modalScore.innerText = currentScore;
  modalTitle.innerText = 'BÖLÜM TAMAMLANDI!';
  modalSubtitle.innerText = `Harika Teardown Yıkımı! Hedef %${cfg.targetPercent} aşıldı.`;

  setTimeout(() => {
    levelModal.classList.add('active');
  }, 1000);
}

function closeWeaponMenu(relock) {
  document.getElementById('weapon-selector').classList.remove('menu-open');
  if (relock && document.pointerLockElement !== canvasContainer) canvasContainer.requestPointerLock();
}

// Şarjör göstergesi (sol altta): elde şarjörlü silah varsa görünür
function updateMagUI(info) {
  const el = document.getElementById('mag-hud');
  if (!el) return;
  el.style.display = info ? 'block' : 'none';
  if (!info) return;
  document.getElementById('mag-count').innerText = info.reloading ? 'ŞARJÖR DEĞİŞİYOR…' : `${info.mag} / ${info.size}`;
  el.classList.toggle('low', !info.reloading && info.mag <= Math.ceil(info.size * 0.25));
}

// Yeni silah seçilince kısa kullanım ipucu (alt ortada, 3.2 sn)
let hintTimer = null;
function showWeaponHint(text) {
  const el = document.getElementById('weapon-hint');
  if (!el) return;
  el.innerText = text; el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('on'), 3200);
}

function updateWeaponUI() {
  const now = document.getElementById('weapon-now');
  if (now) {
    const cw = weaponSystem.currentWeapon, nameEl = document.querySelector(`#w-btn-${cw} .w-name`), a = weaponSystem.weapons[cw].ammo;
    now.innerText = `${nameEl ? nameEl.innerText : ''}   ${a === Infinity ? '∞' : a}   (${cw + 1}/${weaponSystem.weapons.length})`;
  }
  document.querySelectorAll('.weapon-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === weaponSystem.currentWeapon);
    const ammoEl = document.getElementById(`w-ammo-${idx}`);
    if (ammoEl) {
      const a = weaponSystem.weapons[idx].ammo;
      ammoEl.innerText = a === Infinity ? '∞' : a;
    }
  });
}

function enterCar(car) {
  releaseHand();
  if (scopeOn) toggleScope();
  cars.enter(car);
  inCar = true;
  character.mesh.visible = false;
  handWeapons.setFirstPerson(false);   // elde silah görünmez
  handWeapons.fireHeld = false;
  document.getElementById('vitals').dataset.car = '1';
}

function exitCar() {
  const at = cars.exit();
  inCar = false;
  character.mesh.visible = true;
  handWeapons.setFirstPerson(firstPerson);
  if (at) {
    character.resetPosition(at.x, at.y + 1.2, at.z);
    cameraYaw = Math.atan2(at.x - cars.player.x, at.z - cars.player.z) + Math.PI;
  }
  eyeY = null;
}

function toggleScope() {
  if (inCar) return;
  const want = !scopeOn;
  if (want && weaponSystem.currentWeapon !== 8) return;     // yalnız sniper elde iken
  scopeOn = want;
  handWeapons.setScoped(scopeOn);
  targetFov = scopeOn ? 16 : 70;
  document.getElementById('scope').classList.toggle('on', scopeOn);
}

// Sağ tık: kapıya bakarken basılı tutup SÜRÜKLEYİNCE kapı açılır (tek tıklama bir şey yapmaz). Nişangâh kapıya bakınca küçük bir
// ele döner; kapıyı tutarken yumruk olur. Kapı tutulurken ateş edilmez.
let rightHeld = false;
const crosshairEl = document.getElementById('crosshair');
function setCrosshair(mode) {
  crosshairEl.classList.toggle('hand', mode === 'hand');
  crosshairEl.classList.toggle('grab', mode === 'grab');
}
function grabDoor() {
  if (inCar || rightHeld) return;
  if (document.getElementById('weapon-selector').classList.contains('menu-open')) return;
  // Sağ tık HER ZAMAN el olur (zarar vermez, ateş etmez): açık dolap/çekmece/fırın içindeki eşya daha yakınsa eşyayı, değilse kapağı tutar
  rightHeld = true;
  const dp = voxelWorld.doors.pick(camera);
  const pp = props.pick(camera);
  let grabbed = false;
  if (pp && (!dp || pp.dist <= dp.dist + 0.08)) grabbed = props.beginGrab(camera);
  if (!grabbed && dp) grabbed = voxelWorld.doors.beginDrag(camera);
  if (!grabbed && pp) grabbed = props.beginGrab(camera);
  setCrosshair(grabbed ? 'grab' : 'hand');
}
function releaseHand() {
  if (!rightHeld) return;
  rightHeld = false;
  voxelWorld.doors.endDrag();
  props.endGrab();
  setCrosshair(null);
}
// Her karede: kapıya veya eşyaya bakıyor muyuz?
function updateCrosshair() {
  if (rightHeld) return;
  setCrosshair(!inCar && (voxelWorld.doors.aim(camera) || props.aim(camera)) ? 'hand' : null);
}

function fireWeapon() {
  if (inCar) return;
  if (rightHeld) {
    if (props.held) {
      props.throwHeld(camera);
      rightHeld = false;
      setCrosshair(null);
    }
    return;   // kapı/el tutulurken silah ateşlenmez
  }
  sound.init();
  const cur = weaponSystem.currentWeapon;

  if (cur === 2) { handWeapons.startSpin(); return; }    // Işın kılıcı: sol tık = çift bıçağı döndür
  if (cur === 1 || cur === 9) { handWeapons.fireHeld = true; return; } // Minigun / çift minigun: basılı tutunca ateş
  if (cur === 7) { handWeapons.fireHeld = true; return; } // AK-47: otomatik
  if (cur === 5) { handWeapons.fireGun('pistol'); return; }
  if (cur === 6) { handWeapons.fireGun('shotgun'); return; }
  if (cur === 8) { handWeapons.fireGun('sniper'); screenShake = 0.12; return; }
  if (cur === 17) { handWeapons.fireHeld = true; return; } // Plazma lazeri: basılı tutunca ateş
  if (cur >= 10 && cur <= 15 || cur === 18 || cur === 19) { handWeapons.arsenal.fire(cur); return; }   // cephanelik: kara delik, yıldırım, eritici, deprem, yıkım topu, testere, nuke, cryo
  if (cur === 16) { handWeapons.octopus.onLeftClick((s) => { screenShake = Math.max(screenShake, s); }); return; } // Ahtapot: sol tıkla dokunaç at / sar / tut / fırlat
  if (cur === 3 || cur === 4) {                           // Bombalar: yerleştir
    if (bombs.place(cur === 3 ? 'timed' : 'remote')) handWeapons.onRocketFired();
    return;
  }
  if (cur !== 0) return;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const targetPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(60));
  // Birinci şahısta roket elde görünen silahın namlusundan çıkar
  const muzzlePos = firstPerson
    ? handWeapons._handWorld({ x: 0.3, y: -0.26, z: -1.05 })
    : character.getMuzzleWorldPosition();
  const dir = targetPoint.clone().sub(muzzlePos).normalize();

  const success = weaponSystem.shoot(muzzlePos, dir);
  if (success) {
    handWeapons.onRocketFired();
    updateWeaponUI();
    screenShake = 0.2;
  }
}

function selectWeapon(idx) {
  if (scopeOn && idx !== 8) toggleScope();
  weaponSystem.setWeapon(idx);
  handWeapons.setWeapon(idx);
  character.pistolGroup.visible = idx === 0 && character.currentMode !== 'cyborg';
  if (handWeapons) {
    handWeapons.setBombModel(idx);
    if (handWeapons.octopus) handWeapons.octopus.onSwitch(idx, character);
  }
  updateWeaponUI();
}

// Bilgisayarın E Tuşuna Basınca Çekiç Vursun (Ahtapot modundaysa Topaç gibi dönerek etrafındaki eşyaları kırsın!)
function useHammer() {
  sound.init();
  if (weaponSystem.currentWeapon === 16) {
    handWeapons.octopus.startTopacSpin(
      character,
      (d) => { cameraYaw -= d; },
      (s) => { screenShake = Math.max(screenShake, s); }
    );
    return;
  }
  const swung = character.triggerHammerSwing();
  if (!swung) return;

  // Belli bir mesafeye kadar vursun (Menzil ~3.2m)
  const HAMMER_REACH = 3.2;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const charPos = character.mesh.position.clone();
  charPos.y += 1.0;

  const dir = raycaster.ray.direction.clone().normalize();
  let hitPoint = null;

  // Çekiç menzilindeki NPC'ye de vurur
  npcs.hitSphere(charPos.clone().addScaledVector(dir, 1.8), 0.9);

  // Çekiç menzilindeki kapıyı, eşyaları veya televizyon ekranını da kırar
  if (voxelWorld.homeTV) {
    const th = voxelWorld.homeTV.rayHit(camera.position, dir, HAMMER_REACH);
    if (th) { voxelWorld.homeTV.hitAt(th.point.y, th.point.z); if (particleSystem.createSpark) particleSystem.createSpark(th.point); screenShake = 0.08; sound.playHammerHit(); }
  }
  if (props) {
    const ph = props.rayHit(camera.position, dir, HAMMER_REACH);
    if (ph) { props.breakProp(ph.prop, camera.position); screenShake = 0.08; }
    props.hitSphere(charPos.clone().addScaledVector(dir, 1.5), 0.75);
  }
  const dh = voxelWorld.doors.rayHit(camera.position, dir, HAMMER_REACH);
  if (dh) { voxelWorld.doors.damage(dh.door, 5); screenShake = 0.08; sound.playWoodHit(); }

  for (let dist = 0.4; dist <= HAMMER_REACH; dist += VOXEL_SIZE * 0.4) {
    const checkPos = charPos.clone().addScaledVector(dir, dist);
    const ix = Math.round(checkPos.x / VOXEL_SIZE);
    const iy = Math.round((checkPos.y - VOXEL_SIZE / 2) / VOXEL_SIZE);
    const iz = Math.round(checkPos.z / VOXEL_SIZE);
    const key = `${ix},${iy},${iz}`;

    const v = voxelWorld.voxels.get(key);
    if (v && v.active) {
      hitPoint = new THREE.Vector3(v.x, v.y, v.z);
      break;
    }
  }

  // Havada voxel yoksa çekiç yere vurmuş olabilir: zemin üst katmanı kırılır (alt katman kırılmaz)
  if (!hitPoint) {
    for (let dist = 0.4; dist <= HAMMER_REACH; dist += 0.1) {
      const p = charPos.clone().addScaledVector(dir, dist);
      const gy = voxelWorld.terrain.topYAt(p.x, p.z);
      if (p.y <= gy && voxelWorld.terrain.topIntactAt(p.x, p.z)) {
        voxelWorld.hammerGround(new THREE.Vector3(p.x, gy, p.z));
        screenShake = 0.1;
        return;
      }
    }
  }

  if (hitPoint) {
    voxelWorld.hammerHit(hitPoint, 1.0);
    screenShake = 0.08; // Çekiç az hasar verdiği için hafif sarsıntı
  }
}

function setupEventListeners() {
  window.addEventListener('keydown', (e) => {
    sound.init();
    if (introWaiting) {
      if (e.code === 'Enter' || e.code === 'Space') {
        const home = document.getElementById('mm-home');
        if (home && home.style.display !== 'none') {
          const pBtn = document.getElementById('mm-play');
          if (pBtn) pBtn.click();
        }
      }
      return;
    }
    const key = e.key.toLowerCase();
    if (introActive) {
      if (key === 'w' || key === 'a' || key === 's' || key === 'd' || e.code === 'Space' || key === 'e') {
        endIntro();
      } else {
        if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
        return;
      }
    }

    // W tuşu: Karakter öne gider
    if (key === 'w' || e.code === 'KeyW') inputState.forward = true;
    if (key === 's' || e.code === 'KeyS') inputState.backward = true;
    if (key === 'a' || e.code === 'KeyA') inputState.left = true;
    if (key === 'd' || e.code === 'KeyD') inputState.right = true;
    if (e.code === 'Space') {
      inputState.jump = true;
      e.preventDefault();
    }

    // E tuşu: Çekiç vuruşu (veya Ahtapot modunda topaç dönüşü)
    if (key === 'e' || e.code === 'KeyE') {
      if (inCar) exitCar();
      else {
        const car = cars.nearestEnterable(character.mesh.position);
        if (car) enterCar(car); else useHammer();
      }
    }

    // T tuşu: Son silah olan Ahtapot silahını al (veya ahtapottaysa önceki silaha dön)
    if ((key === 't' || e.code === 'KeyT') && !e.repeat && !inCar) {
      releaseHand();
      if (weaponSystem.currentWeapon === 16) selectWeapon(0);
      else selectWeapon(16);
    }

    // Q tuşu: Ahtapota dönüştüğümüz zaman her basışta çok büyük bir zıplama yapıp geri aşağı iner (zıpla-in)
    if ((key === 'q' || e.code === 'KeyQ') && !e.repeat && !inCar && weaponSystem.currentWeapon === 16) {
      if (seated) seated = false;
      handWeapons.octopus.superJump(character, camera);
    }

    // X: sniper nişangâhı
    if (key === 'x' || e.code === 'KeyX') toggleScope();

    // Z: testere diskinin yönünü değiştir (yatay kat keser / dikey dilim keser)
    if ((key === 'z' || e.code === 'KeyZ') && !inCar && weaponSystem.currentWeapon === 15) handWeapons.arsenal.toggleSawMode();

    if (key === 'v' || e.code === 'KeyV') setFirstPerson(!firstPerson);

    // TAB: silah menüsü. İmleç serbest kalır, silah çubuğundan tıklayarak seçilir.
    // F: yerleştirilmiş uzaktan bombaları patlat (ekrandaki PATLAT butonuyla aynı)
    if (key === 'f' || e.code === 'KeyF') bombs.detonateRemote();

    // R: Ahtapot modundaysa hedef aldığı yere iki kolunu kanca gibi atıp bizi o tarafa çeker; diğer silahlarda şarjör değiştirir
    if ((key === 'r' || e.code === 'KeyR') && !inCar && !e.repeat) {
      if (weaponSystem.currentWeapon === 16) {
        if (seated) seated = false;
        handWeapons.octopus.startDualGrapple(character, (s) => { screenShake = Math.max(screenShake, s); });
      } else {
        handWeapons.reload();
      }
    }

    // TAB: sıradaki silaha geç (son silahtan sonra başa döner); menü yoktur, imleç kilitli kalır
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat && !inCar) { releaseHand(); selectWeapon((weaponSystem.currentWeapon + 1) % weaponSystem.weapons.length); }
    }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.code === 'KeyW') inputState.forward = false;
    if (key === 's' || e.code === 'KeyS') inputState.backward = false;
    if (key === 'a' || e.code === 'KeyA') inputState.left = false;
    if (key === 'd' || e.code === 'KeyD') inputState.right = false;
    if (e.code === 'Space') inputState.jump = false;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) handWeapons.fireHeld = false;
    if (e.button === 2) releaseHand();
  });
  window.addEventListener('blur', releaseHand);
  window.addEventListener('wheel', (e) => { if (rightHeld && props.held) props.adjustDistance(-Math.sign(e.deltaY) * 0.3); });   // tutulan eşyanın uzaklığı
  window.addEventListener('contextmenu', (e) => e.preventDefault());   // sağ tık menüsü açılmasın: sağ tık = el

  canvasContainer.addEventListener('mousedown', (e) => {
    if (introActive) { endIntro(); return; }
    if (e.target.closest && e.target.closest('.weapon-selector')) return; // silah menüsüne tıklama ateş etmez
    if (e.button === 0) {
      fireWeapon();
    }
    if (e.button === 2) {
      if (weaponSystem.currentWeapon === 16) {
        const handled = handWeapons.octopus.onRightClick((s) => { screenShake = Math.max(screenShake, s); });
        if (!handled) {
          grabDoor();
        }
      } else {
        grabDoor();
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (introActive) return;   // jenerik: bakış animasyonla yönetilir, fare etkisiz
    // Kapı tutulurken fare bakışı değil kapıyı sürükler
    if (voxelWorld.doors.drag) {
      voxelWorld.doors.dragMove(e.movementX, e.movementY, camera);
      return;
    }
    const sensitivity = (scopeOn ? 0.0011 : 0.0035) * mouseSens;
    if (handWeapons) {
      handWeapons.mx += e.movementX;
      handWeapons.my += e.movementY;
      if (handWeapons.octopus) handWeapons.octopus.onMouseMove(e.movementX, e.movementY);
    }
    cameraYaw -= e.movementX * sensitivity;
    cameraPitch += e.movementY * sensitivity;
    cameraPitch = firstPerson
      ? Math.max(-1.3, Math.min(1.3, cameraPitch))
      : Math.max(-0.2, Math.min(0.9, cameraPitch));
  });

  canvasContainer.addEventListener('click', () => {
    if (document.pointerLockElement !== canvasContainer) {
      canvasContainer.requestPointerLock();
    }
  });

  document.querySelectorAll('.weapon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wId = parseInt(btn.dataset.weapon);
      selectWeapon(wId);
      closeWeaponMenu(true);
    });
  });

  document.getElementById('detonate-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    bombs.detonateRemote();
  });

  document.getElementById('btn-camera').addEventListener('click', (e) => {
    e.stopPropagation();
    setFirstPerson(!firstPerson);
  });

  document.getElementById('btn-sound').addEventListener('click', (e) => {
    e.stopPropagation();
    sound.init();
    const isMuted = sound.toggleMute();
    document.getElementById('btn-sound').innerText = isMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-restart').addEventListener('click', (e) => {
    e.stopPropagation();
    loadLevel(levelManager.currentLevelIndex);
  });

  document.getElementById('btn-levels').addEventListener('click', (e) => {
    e.stopPropagation();
    levelsModal.classList.add('active');
  });

  document.getElementById('modal-btn-retry').addEventListener('click', () => {
    loadLevel(levelManager.currentLevelIndex);
  });

  document.getElementById('modal-btn-next').addEventListener('click', () => {
    const nextIdx = (levelManager.currentLevelIndex + 1) % levelManager.levelConfigs.length;
    loadLevel(nextIdx);
  });

  document.getElementById('levels-close-btn').addEventListener('click', () => {
    levelsModal.classList.remove('active');
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function buildLevelSelectButtons() {
  levelsGrid.innerHTML = '';
  levelManager.levelConfigs.forEach((cfg, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.textAlign = 'left';
    btn.style.padding = '12px';
    btn.innerHTML = `<div style="font-size: 13px; font-weight: 900; color: #ffaa00;">${cfg.title}</div><div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Hedef: %${cfg.targetPercent}</div>`;
    btn.addEventListener('click', () => {
      loadLevel(idx);
    });
    levelsGrid.appendChild(btn);
  });
}

// Başlat: DOM hazırsa hemen çalıştır, değilse bekle
function safeInit() {
  try {
    init();
  } catch (err) {
    console.error('Kritik başlatma hatası yakalandı:', err);
  } finally {
    finishLoadingUI();
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
