import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import confetti from 'canvas-confetti';
import { Character } from './character.js';
import { WeaponSystem } from './weapons.js';
import { LevelManager } from './levels.js';
import { ParticleSystem } from './particles.js';
import { sound } from './audio.js';

// Oyun Durumu
let scene, camera, renderer;
let physicsWorld;
let character, weaponSystem, levelManager, particleSystem;

let currentScore = 0;
let isLevelCompleted = false;
let screenShake = 0;

// Kamera Açıları (TPS Mouse Look)
let cameraYaw = Math.PI; // Karşıya (kuzeye) baksın
let cameraPitch = 0.25;  // Hafif yukarıdan aşağı baksın
const cameraDistance = 9;
const cameraHeight = 3.5;

// Giriş Durumu (W, A, S, D, Space vb.)
const inputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

// Ekran / DOM Elemanları
const canvasContainer = document.getElementById('canvas-container');
const levelTitleEl = document.getElementById('level-title');
const levelDescEl = document.getElementById('level-desc');
const destructionPercentEl = document.getElementById('destruction-percent');
const destructionBarEl = document.getElementById('destruction-bar');
const targetPercentEl = document.getElementById('target-percent');
const targetMarkerEl = document.getElementById('target-marker');
const scoreDisplayEl = document.getElementById('score-display');
const scorePopupsEl = document.getElementById('score-popups');

// Modallar
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

// Başlatma (Init)
function init() {
  // 1. Three.js Sahnesi
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f19);
  scene.fog = new THREE.FogExp2(0x0b0f19, 0.012);

  // 2. Kamera
  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.appendChild(renderer.domElement);

  // 4. Işıklandırma
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
  dirLight.position.set(30, 45, 30);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 120;
  const d = 35;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  scene.add(dirLight);

  // Vurgulu Neon Dolgu Işığı
  const pointLight = new THREE.PointLight(0xff6600, 1.2, 50);
  pointLight.position.set(0, 15, 10);
  scene.add(pointLight);

  // 5. Cannon.js Fizik Dünyası
  physicsWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -25, 0)
  });
  physicsWorld.solver.iterations = 10;
  physicsWorld.defaultContactMaterial.friction = 0.5;
  physicsWorld.defaultContactMaterial.restitution = 0.15;

  // 6. Zemin ve Arena Platformu
  createArena();

  // 7. Parçacık, Karakter, Silah ve Seviye Sistemleri
  particleSystem = new ParticleSystem(scene);

  character = new Character(scene, physicsWorld, particleSystem);

  weaponSystem = new WeaponSystem(scene, physicsWorld, particleSystem, (points, text) => {
    addScore(points, text);
    screenShake = 0.4;
  });

  levelManager = new LevelManager(scene, physicsWorld);

  // İlk Bölümü Yükle
  loadLevel(0);

  // 8. Olay Dinleyicileri (Event Listeners)
  setupEventListeners();
  buildLevelSelectButtons();

  // 9. Ana Döngüyü Başlat
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

// Zemin ve Arena Platformu Tasarımı
function createArena() {
  // Fizik Zemin
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane()
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);

  // Görsel Zemin Tabakası
  const groundGeo = new THREE.PlaneGeometry(160, 160);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.8,
    metalness: 0.2
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Izgara Deseni (Grid)
  const gridHelper = new THREE.GridHelper(160, 80, 0xff6600, 0x1e293b);
  gridHelper.position.y = 0.02;
  scene.add(gridHelper);

  // Hedef Yıkım Alanı Dairesi (Merkez Zemin İşareti)
  const ringGeo = new THREE.RingGeometry(8, 8.5, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6600, side: THREE.DoubleSide });
  const targetRing = new THREE.Mesh(ringGeo, ringMat);
  targetRing.rotation.x = -Math.PI / 2;
  targetRing.position.y = 0.05;
  scene.add(targetRing);
}

// Oyun Güncelleme Döngüsü
function updateGame(dt) {
  // 1. Fizik Simülasyonu
  physicsWorld.step(1 / 60, dt, 3);

  // 2. Karakter Güncellemesi (W, A, S, D, Zıplama)
  character.update(dt, inputState, cameraYaw);

  // 3. Seviye Blokları ve Yıkım Kontrolü
  levelManager.update();
  const currentPct = levelManager.getDestructionPercentage();
  updateDestructionUI(currentPct);

  // Bölüm Hedefine Ulaşıldı mı?
  const cfg = levelManager.levelConfigs[levelManager.currentLevelIndex];
  if (currentPct >= cfg.targetPercent && !isLevelCompleted) {
    triggerLevelWin(currentPct);
  }

  // 4. Silahlar ve Parçacıklar
  weaponSystem.update(dt);
  particleSystem.update(dt);

  // 5. 3. Şahıs (TPS) Kamera Takibi
  updateCamera(dt);
}

// 3. Şahıs Kamera Takibi ve Ekran Titremesi
function updateCamera(dt) {
  const charPos = character.mesh.position;

  // Küresel koordinatlardan kamera ofseti
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

  // Yumuşak kamera geçişi
  camera.position.lerp(targetCamPos, 14 * dt);

  // Ekran Titremesi (Screen Shake)
  if (screenShake > 0) {
    camera.position.x += (Math.random() - 0.5) * screenShake;
    camera.position.y += (Math.random() - 0.5) * screenShake;
    camera.position.z += (Math.random() - 0.5) * screenShake;
    screenShake = Math.max(0, screenShake - dt * 1.5);
  }

  // Kameranın odaklanacağı hedef (Karakterin biraz üstü)
  const lookTarget = new THREE.Vector3(charPos.x, charPos.y + 1.8, charPos.z);
  camera.lookAt(lookTarget);
}

// Bölüm Yükleme
function loadLevel(index) {
  isLevelCompleted = false;
  levelModal.classList.remove('active');
  levelsModal.classList.remove('active');

  const cfg = levelManager.loadLevel(index);
  weaponSystem.clear();
  particleSystem.clear();
  character.resetPosition(0, 3, 26);

  // UI Güncelle
  levelTitleEl.innerText = cfg.title;
  levelDescEl.innerText = cfg.desc;
  targetPercentEl.innerText = `${cfg.targetPercent}%`;
  targetMarkerEl.style.left = `${cfg.targetPercent}%`;
  updateDestructionUI(0);
  updateWeaponUI();
}

// Yıkım Oranı Arayüzü
function updateDestructionUI(percent) {
  destructionPercentEl.innerText = `${percent}%`;
  destructionBarEl.style.width = `${percent}%`;

  if (percent >= 70) {
    destructionBarEl.style.background = 'linear-gradient(90deg, #00ff88, #00ffff)';
    destructionBarEl.style.boxShadow = '0 0 16px rgba(0, 255, 255, 0.9)';
  } else {
    destructionBarEl.style.background = 'linear-gradient(90deg, #ff4500, #ff8c00, #ffdd00)';
    destructionBarEl.style.boxShadow = '0 0 14px rgba(255, 140, 0, 0.8)';
  }
}

// Skor Ekleme ve Havada Uçan Skor Yazısı
function addScore(points, label) {
  currentScore += points;
  scoreDisplayEl.innerText = currentScore.toLocaleString();

  // Popup Oluştur
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.innerText = label || `+${points}`;
  popup.style.left = `${window.innerWidth / 2 + (Math.random() - 0.5) * 120}px`;
  popup.style.top = `${window.innerHeight / 2 - 40 + (Math.random() - 0.5) * 60}px`;
  scorePopupsEl.appendChild(popup);

  setTimeout(() => {
    if (popup.parentElement) popup.parentElement.removeChild(popup);
  }, 1200);
}

// Bölüm Başarısı ve Konfeti
function triggerLevelWin(pct) {
  isLevelCompleted = true;
  sound.playLevelWin();

  // Konfeti Patlat
  confetti({
    particleCount: 120,
    spread: 80,
    origin: { y: 0.6 }
  });

  // Yıldız Sayısı Hesabı
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

// Silah Seçimi Arayüzü
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

// Ateş Etme Fonksiyonu
function fireWeapon() {
  sound.init(); // Kullanıcı ilk tıkladığında AudioContext'i başlat

  // Ekranın tam ortasındaki nişangahın (Crosshair) 3D dünya yönünü hesapla
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Işının ulaştığı hedef nokta (Uzak bir nokta veya blok hedefi)
  const targetPoint = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(60));

  // Karakter namlu ucu
  const muzzlePos = character.getMuzzleWorldPosition();
  const dir = targetPoint.clone().sub(muzzlePos).normalize();

  const success = weaponSystem.shoot(muzzlePos, dir);
  if (success) {
    updateWeaponUI();
    screenShake = 0.15;
  }
}

// Olay Dinleyicileri (Klavye & Fare & Arayüz)
function setupEventListeners() {
  // Klavye Tuşları (W, A, S, D, Boşluk, 1, 2, 3)
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

    // Silah Değiştirme
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

  // Fare Nişan Alma ve Kamerayı Döndürme
  let isMouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;

  // Pointer Lock desteği (Tıklanınca tam ekran FPS/TPS kontrolü)
  canvasContainer.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      // Sol Tık ile ateş et
      fireWeapon();
    }
    isMouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
  });

  window.addEventListener('mousemove', (e) => {
    // Fare hareket ettikçe kamerayı döndür
    const sensitivity = 0.0035;
    cameraYaw -= e.movementX * sensitivity;
    cameraPitch += e.movementY * sensitivity;

    // Pitch açısını sınırla (Yere veya gökyüzüne aşırı bükülmesin)
    cameraPitch = Math.max(-0.2, Math.min(0.9, cameraPitch));
  });

  // Canvas Tıklanınca Pointer Lock İsteği
  canvasContainer.addEventListener('click', () => {
    if (document.pointerLockElement !== canvasContainer) {
      canvasContainer.requestPointerLock();
    }
  });

  // Silah Butonları
  document.querySelectorAll('.weapon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wId = parseInt(btn.dataset.weapon);
      weaponSystem.setWeapon(wId);
      updateWeaponUI();
    });
  });

  // Hızlı Aksiyon Butonları
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

  // Modal Butonları
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

  // Pencere Boyutlandırma (Resize)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Bölüm Seçim Menüsü Butonlarını Dinamik Oluştur
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

// Başlat
window.addEventListener('DOMContentLoaded', init);
