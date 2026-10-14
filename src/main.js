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
import { sound } from './audio.js';
import { getGrassTopTexture } from './textures.js';

let scene, camera, renderer;
let physicsWorld;
let inCar = false, scopeOn = false, targetFov = 70;
let cars, hp = 100, lastHitT = 0, invulnUntil = 0;
let planes, bombs, npcs, handWeapons, character, weaponSystem, levelManager, particleSystem, voxelWorld;

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

function init() {
  // 1. Sahne (Teardown Tarzı Aydınlık Gökyüzü)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x78a7ff);
  scene.fog = new THREE.Fog(0x78a7ff, 90, 330);

  // 2. Kamera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false; // silah modeli ikinci geçişte çizilir
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  // 4. Işıklandırma ve Gerçekçi Gölgeler (Gelişmiş Gölge Haritası)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55); // Gölgelerin net ve derin görünmesi için dengeli ortam ışığı
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfffbe8, 1.4);
  sunLight.position.set(60, 95, 45);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 4096; // Yüksek çözünürlüklü keskin gölgeler
  sunLight.shadow.mapSize.height = 4096;
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
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
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

  levelManager = new LevelManager(voxelWorld);

  // İlk Bölümü Yükle
  loadLevel(0);

  setupEventListeners();
  buildLevelSelectButtons();

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

  // Deniz / Okyanus Suyu Düzlemi (Şehir ve Adayı Çevreleyen Deniz)
  waterGeo = new THREE.PlaneGeometry(1200, 1200, 120, 120);   // şehir büyüdü: deniz düzlemi 1200 m
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x0369a1,
    transparent: true,
    opacity: 0.85
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.15;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);

  // Yüzen Voxel Bulutlar
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });

  for (let i = 0; i < 12; i++) {
    const w = 12 + Math.random() * 16;
    const d = 10 + Math.random() * 14;
    const cloudGeo = new THREE.BoxGeometry(w, 1.2, d);
    const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
    cloudMesh.position.set(
      (Math.random() - 0.5) * 140,
      32 + Math.random() * 8,
      (Math.random() - 0.5) * 140
    );
    scene.add(cloudMesh);
    clouds.push({ mesh: cloudMesh, speed: 1.5 + Math.random() * 2 });
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
let sunLight = null;
function updateGame(dt) {
  physicsWorld.step(1 / 60, dt, 3);
  // Güneş ve gölge alanı oyuncuyu izler (8 m'lik adımlarla: gölgeler titremesin)
  if (sunLight) {
    const sx = Math.round(camera.position.x / 8) * 8, sz = Math.round(camera.position.z / 8) * 8;
    sunLight.target.position.set(sx, 0, sz);
    sunLight.position.set(sx + 60, 95, sz + 45);
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
    character.update(dt, inputState, cameraYaw);
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
  // Otomatik (sürgülü) kapıları açan hareketliler: oyuncu (ya da sürdüğü araç), yayalar ve trafik
  doorActors.length = 0;
  doorActors.push({ x: character.mesh.position.x, y: character.mesh.position.y, z: character.mesh.position.z });
  for (const n of npcs.npcs) doorActors.push({ x: n.x, y: n.y, z: n.z });
  for (const c of cars.cars) if (c.state === 'drive') doorActors.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z });
  voxelWorld.doors.update(dt, doorActors);
  updateCrosshair();
  updateFountains(dt);
  updateVitals(dt);
  updateWaves(dt);
  handWeapons.update(dt, {
    moving: character.isGrounded && !character.inWater &&
      (Math.abs(character.vel.x) + Math.abs(character.vel.z)) > 1.5,
    walkCycle: character.walkCycle
  });
  particleSystem.update(dt);

  // Bulutlar
  clouds.forEach(c => {
    c.mesh.position.x += c.speed * dt;
    if (c.mesh.position.x > 80) c.mesh.position.x = -80;
  });

  updateCamera(dt);
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
    const targetY = charPos.y + 1.8;
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
  levelModal.classList.remove('active');
  levelsModal.classList.remove('active');

  const cfg = levelManager.loadLevel(index);
  weaponSystem.clear();
  bombs.clear();
  planes.clear();
  particleSystem.clear();
  handWeapons.resetAmmo();
  character.resetPosition(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z); // Batı kumsalı
  npcs.playerPos.set(cfg.spawn.x, 0, cfg.spawn.z);
  npcs.reset();
  cars.build();
  cameraYaw = -Math.PI / 2; // Şehir caddesinden uzun köprüye ve zengin adaya doğru baksın

  levelTitleEl.innerText = cfg.title;
  levelDescEl.innerText = cfg.desc;
  targetPercentEl.innerText = `${cfg.targetPercent}%`;
  targetMarkerEl.style.left = `${cfg.targetPercent}%`;
  updateDestructionUI(0);
  updateWeaponUI();
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

function toggleWeaponMenu() {
  releaseHand();
  const bar = document.getElementById('weapon-selector');
  if (bar.classList.contains('menu-open')) { closeWeaponMenu(true); return; }
  bar.classList.add('menu-open');
  handWeapons.fireHeld = false;
  if (document.pointerLockElement) document.exitPointerLock();
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
  if (voxelWorld.doors.beginDrag(camera)) { rightHeld = true; setCrosshair('grab'); }
}
function releaseHand() {
  if (!rightHeld) return;
  rightHeld = false;
  voxelWorld.doors.endDrag();
  setCrosshair(null);
}
// Her karede: kapıya bakıyor muyuz?
function updateCrosshair() {
  if (rightHeld) return;
  setCrosshair(!inCar && voxelWorld.doors.aim(camera) ? 'hand' : null);
}

function fireWeapon() {
  if (inCar || rightHeld) return;   // kapı tutulurken ateş yok
  sound.init();
  const cur = weaponSystem.currentWeapon;

  if (cur === 2) { handWeapons.startSpin(); return; }    // Işın kılıcı: sol tık = çift bıçağı döndür
  if (cur === 1 || cur === 9) { handWeapons.fireHeld = true; return; } // Minigun / çift minigun: basılı tutunca ateş
  if (cur === 7) { handWeapons.fireHeld = true; return; } // AK-47: otomatik
  if (cur === 5) { handWeapons.fireGun('pistol'); return; }
  if (cur === 6) { handWeapons.fireGun('shotgun'); return; }
  if (cur === 8) { handWeapons.fireGun('sniper'); screenShake = 0.12; return; }
  if (cur >= 10 && cur <= 15) { handWeapons.arsenal.fire(cur); return; }   // cephanelik: kara delik, yıldırım, eritici, deprem, yıkım topu, testere
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
  if (handWeapons) handWeapons.setBombModel(idx);
  updateWeaponUI();
}

// Bilgisayarın E Tuşuna Basınca Çekiç Vursun (Belli bir mesafeye kadar)
function useHammer() {
  sound.init();
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

  // Çekiç menzilindeki kapıyı da kırar (menteşeli kapı birkaç vuruşta, vurdukça titrer)
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
    const key = e.key.toLowerCase();

    // W tuşu: Karakter öne gider
    if (key === 'w' || e.code === 'KeyW') inputState.forward = true;
    if (key === 's' || e.code === 'KeyS') inputState.backward = true;
    if (key === 'a' || e.code === 'KeyA') inputState.left = true;
    if (key === 'd' || e.code === 'KeyD') inputState.right = true;
    if (e.code === 'Space') {
      inputState.jump = true;
      e.preventDefault();
    }

    // E tuşu: Çekiç vuruşu
    if (key === 'e' || e.code === 'KeyE') {
      if (inCar) exitCar();
      else {
        const car = cars.nearestEnterable(character.mesh.position);
        if (car) enterCar(car); else useHammer();
      }
    }

    // X: sniper nişangâhı
    if (key === 'x' || e.code === 'KeyX') toggleScope();

    // Z: testere diskinin yönünü değiştir (yatay kat keser / dikey dilim keser)
    if ((key === 'z' || e.code === 'KeyZ') && !inCar && weaponSystem.currentWeapon === 15) handWeapons.arsenal.toggleSawMode();

    if (key === 'v' || e.code === 'KeyV') setFirstPerson(!firstPerson);

    // TAB: silah menüsü. İmleç serbest kalır, silah çubuğundan tıklayarak seçilir.
    // F: yerleştirilmiş uzaktan bombaları patlat (ekrandaki PATLAT butonuyla aynı)
    if (key === 'f' || e.code === 'KeyF') bombs.detonateRemote();

    // R: şarjör değiştir (tabanca, pompalı, AK-47, sniper)
    if ((key === 'r' || e.code === 'KeyR') && !inCar && !e.repeat) handWeapons.reload();

    if (e.code === 'Tab') {
      e.preventDefault();
      toggleWeaponMenu();
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
  window.addEventListener('contextmenu', (e) => e.preventDefault());   // sağ tık menüsü açılmasın: sağ tık = el

  canvasContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest && e.target.closest('.weapon-selector')) return; // silah menüsüne tıklama ateş etmez
    if (e.button === 0) {
      fireWeapon();
    }
    if (e.button === 2) grabDoor();
  });

  window.addEventListener('mousemove', (e) => {
    // Kapı tutulurken fare bakışı değil kapıyı sürükler
    if (voxelWorld.doors.drag) {
      voxelWorld.doors.dragMove(e.movementX, e.movementY, camera);
      return;
    }
    const sensitivity = scopeOn ? 0.0011 : 0.0035;
    if (handWeapons) { handWeapons.mx += e.movementX; handWeapons.my += e.movementY; }
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

window.addEventListener('DOMContentLoaded', init);
