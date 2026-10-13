import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import confetti from 'canvas-confetti';
import { Character } from './character.js';
import { WeaponSystem } from './weapons.js';
import { LevelManager } from './levels.js';
import { ParticleSystem } from './particles.js';
import { VoxelWorld, VOXEL_SIZE } from './teardown.js';
import { sound } from './audio.js';
import { getGrassTopTexture } from './textures.js';

let scene, camera, renderer;
let physicsWorld;
let character, weaponSystem, levelManager, particleSystem, voxelWorld;

let currentScore = 0;
let isLevelCompleted = false;
let screenShake = 0;
let clouds = [];

// Kamera Açıları
let cameraYaw = Math.PI;
let cameraPitch = 0.25;
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
  scene.fog = new THREE.Fog(0x78a7ff, 50, 140);

  // 2. Kamera
  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  // 4. Işıklandırma ve Gerçekçi Gölgeler (Gelişmiş Gölge Haritası)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55); // Gölgelerin net ve derin görünmesi için dengeli ortam ışığı
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfffbe8, 1.4);
  sunLight.position.set(60, 95, 45);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 4096; // Yüksek çözünürlüklü keskin gölgeler
  sunLight.shadow.mapSize.height = 4096;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 260;

  // Tüm şehri, sahili, uzun köprüyü ve adayı kapsayan geniş gölge alanı
  const dx = 110;
  const dz = 80;
  sunLight.shadow.camera.left = -dx;
  sunLight.shadow.camera.right = dx;
  sunLight.shadow.camera.top = dz;
  sunLight.shadow.camera.bottom = -dz;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);

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

  weaponSystem = new WeaponSystem(scene, physicsWorld, particleSystem, voxelWorld, (points, text) => {
    addScore(points, text);
    screenShake = 0.4;
  });

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
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

function createWorldArena() {
  // Zemin artık voxelWorld.terrain tarafından kurulur (yollar, kumsal, iskele kaplama + fizik kutuları)

  // Deniz / Okyanus Suyu Düzlemi (Şehir ve Adayı Çevreleyen Deniz)
  const waterGeo = new THREE.PlaneGeometry(380, 380);
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

function updateGame(dt) {
  physicsWorld.step(1 / 60, dt, 3);

  // Karakter Kontrolü (W tuşu ileri vb.)
  character.update(dt, inputState, cameraYaw);

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
  particleSystem.update(dt);

  // Bulutlar
  clouds.forEach(c => {
    c.mesh.position.x += c.speed * dt;
    if (c.mesh.position.x > 80) c.mesh.position.x = -80;
  });

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
  particleSystem.clear();
  character.resetPosition(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z); // Batı kumsalı
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
      useHammer();
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
