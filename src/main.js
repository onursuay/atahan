import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import confetti from 'canvas-confetti';
import { Character } from './character.js';
import { WeaponSystem } from './weapons.js';
import { LevelManager } from './levels.js';
import { ParticleSystem } from './particles.js';
import { sound } from './audio.js';
import { getGrassTopTexture } from './textures.js';

// Oyun Değişkenleri
let scene, camera, renderer;
let physicsWorld;
let character, weaponSystem, levelManager, particleSystem;

let currentScore = 0;
let isLevelCompleted = false;
let screenShake = 0;
let clouds = [];

// Kamera Açıları
let cameraYaw = Math.PI;
let cameraPitch = 0.25;
const cameraDistance = 8.5;
const cameraHeight = 3.2;

// Giriş Durumu
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
  // 1. Minecraft Gökyüzü (Açık Mavi)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x78a7ff);
  scene.fog = new THREE.Fog(0x78a7ff, 45, 120);

  // 2. Kamera
  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  // 4. Minecraft Güneşi ve Işıklandırma
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfffbe8, 1.4);
  sunLight.position.set(35, 55, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 140;
  const d = 35;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  // Gökyüzünde Kare Minecraft Güneşi
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
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.5;
  physicsWorld.defaultContactMaterial.restitution = 0.15;

  // 6. Minecraft Çimen Zemin ve Voxel Bulutlar
  createMinecraftWorld();

  // 7. Karakter, Seviyeler ve Silahlar
  particleSystem = new ParticleSystem(scene);
  character = new Character(scene, physicsWorld, particleSystem);
  weaponSystem = new WeaponSystem(scene, physicsWorld, particleSystem, (points, text) => {
    addScore(points, text);
    screenShake = 0.4;
  });
  levelManager = new LevelManager(scene, physicsWorld);

  // İlk Bölümü Başlat
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
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

// Minecraft Dünyası (Çimen Blok Zemin & Yüzen Voxel Bulutlar)
function createMinecraftWorld() {
  // Fizik Zemin
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane()
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);

  // Görsel Minecraft Çimen Zemin
  const grassTex = getGrassTopTexture();
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(80, 80);

  const groundGeo = new THREE.PlaneGeometry(160, 160);
  const groundMat = new THREE.MeshLambertMaterial({ map: grassTex });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Minecraft Kare Bulutları
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
      30 + Math.random() * 8,
      (Math.random() - 0.5) * 140
    );
    scene.add(cloudMesh);
    clouds.push({ mesh: cloudMesh, speed: 1.5 + Math.random() * 2 });
  }
}

function updateGame(dt) {
  physicsWorld.step(1 / 60, dt, 3);

  // Karakter Güncellemesi (W tuşu vb.)
  character.update(dt, inputState, cameraYaw);

  // Seviye ve Yıkım Kontrolü
  levelManager.update();
  const currentPct = levelManager.getDestructionPercentage();
  updateDestructionUI(currentPct);

  const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
  if (currentPct >= cfg.targetPercent && !isLevelCompleted) {
    triggerLevelWin(currentPct);
  }

  // Silahlar ve Parçacıklar
  weaponSystem.update(dt);
  particleSystem.update(dt);

  // Bulutları hareket ettir
  clouds.forEach(c => {
    c.mesh.position.x += c.speed * dt;
    if (c.mesh.position.x > 80) c.mesh.position.x = -80;
  });

  // Kamera Takibi
  updateCamera(dt);
}

function updateCamera(dt) {
  const charPos = character.mesh.position;

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

  // Ekran Sarsıntısı (Screen Shake)
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
  particleSystem.clear();
  character.resetPosition(0, 2.5, 25);

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
    particleCount: 130,
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
  modalSubtitle.innerText = `Harika Yıkım! Hedef %${cfg.targetPercent} aşıldı.`;

  setTimeout(() => {
    levelModal.classList.add('active');
  }, 1000);
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

function fireWeapon() {
  sound.init();

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const targetPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(60));
  const muzzlePos = character.getMuzzleWorldPosition();
  const dir = targetPoint.clone().sub(muzzlePos).normalize();

  const success = weaponSystem.shoot(muzzlePos, dir);
  if (success) {
    updateWeaponUI();
    screenShake = 0.2;
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

    if (key === '1') { weaponSystem.setWeapon(0); updateWeaponUI(); }
    if (key === '2') { weaponSystem.setWeapon(1); updateWeaponUI(); }
    if (key === '3') { weaponSystem.setWeapon(2); updateWeaponUI(); }
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || e.code === 'KeyW') inputState.forward = false;
    if (key === 's' || e.code === 'KeyS') inputState.backward = false;
    if (key === 'a' || e.code === 'KeyA') inputState.left = false;
    if (key === 'd' || e.code === 'KeyD') inputState.right = false;
    if (e.code === 'Space') inputState.jump = false;
  });

  canvasContainer.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      fireWeapon();
    }
  });

  window.addEventListener('mousemove', (e) => {
    const sensitivity = 0.0035;
    cameraYaw -= e.movementX * sensitivity;
    cameraPitch += e.movementY * sensitivity;
    cameraPitch = Math.max(-0.2, Math.min(0.9, cameraPitch));
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
      weaponSystem.setWeapon(wId);
      updateWeaponUI();
    });
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
