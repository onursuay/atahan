import * as THREE from 'three';
import { sound } from './audio.js';

// ─────────────────────────────────────────────────────────────────────────────
// METRO SİSTEMİ (Subway / Metro Train & Stations)
//  • Batı İstasyonu (Metropol Merkezi, x: -75) ile Doğu İstasyonu (x: 290) arası
//  • Yeraltı istasyon peronları, merdiven girişi, raylar ve ışıklandırılmış tünel
//  • İstasyonlara varıp yavaşlayan, kapılarını açan, yolcu bindirip diğer istasyona giden tren
//  • Oyuncu trene binince trenle birlikte hareket eder!
// ─────────────────────────────────────────────────────────────────────────────

const mat = (col, opt = {}) => new THREE.MeshLambertMaterial({ color: col, ...opt });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export class MetroSystem {
  constructor(scene, voxelWorld, onShake) {
    this.scene = scene;
    this.vw = voxelWorld;
    this.onShake = onShake;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // İstasyon koordinatları
    this.st1 = { x: -75, y: -4.5, z: 22, name: 'Merkez İstasyonu' };
    this.st2 = { x: 290, y: -4.5, z: 22, name: 'Doğu Kolej & Hastane İstasyonu' };

    // Tren durumu
    this.trainPos = new THREE.Vector3(this.st1.x, this.st1.y, this.st1.z);
    this.trainSpeed = 0;
    this.maxSpeed = 28;     // m/s (~100 km/s)
    this.state = 'stopped_st1'; // stopped_st1, moving_to_st2, stopped_st2, moving_to_st1
    this.stopTimer = 8;     // bekleme süresi (sn)
    this.doorsOpen = false;
    this.doorProgress = 0;

    this.trainGroup = new THREE.Group();
    this.group.add(this.trainGroup);

    this.passengers = [];
    this.initWorld();
  }

  clear() {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
  }

  initWorld() {
    this.clear();
    this.trainGroup = new THREE.Group();
    this.group.add(this.trainGroup);

    // 1. Raylar ve Yeraltı Tüneli
    this.buildTracks();

    // 2. Batı ve Doğu İstasyonları
    this.buildStation(this.st1, true);
    this.buildStation(this.st2, false);

    // 3. Metro Tren Modeli
    this.buildTrain();
  }

  buildTracks() {
    const x0 = this.st1.x - 40, x1 = this.st2.x + 40;
    const len = x1 - x0;
    const midX = (x0 + x1) / 2;

    // Beton zemin yatağı
    const bedGeo = box(len, 0.4, 6.0);
    const bed = new THREE.Mesh(bedGeo, mat(0x1e293b));
    bed.position.set(midX, this.st1.y - 1.2, this.st1.z);
    bed.receiveShadow = true;
    this.group.add(bed);

    // Çelik raylar (iki paralel ray)
    const railMat = mat(0x94a3b8);
    const rail1 = new THREE.Mesh(box(len, 0.15, 0.12), railMat);
    rail1.position.set(midX, this.st1.y - 0.95, this.st1.z - 0.85);
    const rail2 = new THREE.Mesh(box(len, 0.15, 0.12), railMat);
    rail2.position.set(midX, this.st1.y - 0.95, this.st1.z + 0.85);
    this.group.add(rail1, rail2);

    // Ahşap traversler (her 1.2 metrede bir)
    const tieGeo = box(0.35, 0.14, 2.2);
    const tieMat = mat(0x451a03);
    const tieCount = Math.floor(len / 1.2);
    const ties = new THREE.InstancedMesh(tieGeo, tieMat, tieCount);
    const d = new THREE.Object3D();
    for (let i = 0; i < tieCount; i++) {
      d.position.set(x0 + i * 1.2, this.st1.y - 1.02, this.st1.z);
      d.updateMatrix();
      ties.setMatrixAt(i, d.matrix);
    }
    ties.instanceMatrix.needsUpdate = true;
    this.group.add(ties);
  }

  buildStation(st, isWest) {
    // Peron (Platform)
    const platGeo = box(46, 1.0, 7.0);
    const platMat = mat(0xd1d5db);
    const plat = new THREE.Mesh(platGeo, mat(0x475569));
    plat.position.set(st.x, st.y - 0.5, st.z + 4.5);
    plat.receiveShadow = true;
    this.group.add(plat);

    // Sarı Güvenlik Çizgisi
    const line = new THREE.Mesh(box(46, 0.04, 0.3), mat(0xfacc15));
    line.position.set(st.x, st.y + 0.02, st.z + 1.25);
    this.group.add(line);

    // İstasyon Duvarı ve LED Tabelası
    const wall = new THREE.Mesh(box(46, 4.5, 0.4), mat(0x0f172a));
    wall.position.set(st.x, st.y + 2.0, st.z + 7.8);
    this.group.add(wall);

    // Tavan
    const roof = new THREE.Mesh(box(46, 0.4, 11), mat(0x1e293b));
    roof.position.set(st.x, st.y + 4.4, st.z + 3.0);
    this.group.add(roof);

    // Metro İsim Tabelası
    const sign = new THREE.Mesh(box(14, 1.0, 0.1), mat(0x0284c7));
    sign.position.set(st.x, st.y + 3.2, st.z + 7.55);
    this.group.add(sign);

    // Yeryüzüne Çıkan Merdiven & Giriş Kanopisi
    const stairSteps = 12;
    for (let i = 0; i < stairSteps; i++) {
      const step = new THREE.Mesh(box(3.2, 0.42, 0.7), mat(0x64748b));
      step.position.set(st.x + (isWest ? 18 : -18), st.y + i * 0.42, st.z + 5.5 - i * 0.65);
      this.group.add(step);
    }

    // Sokak Seviyesi Metro Giriş Totemi / Tabelası (y = 0.8)
    const entranceX = st.x + (isWest ? 18 : -18);
    const entranceZ = st.z + 5.5 - stairSteps * 0.65 - 1.2;
    const totem = new THREE.Mesh(box(0.5, 3.2, 0.5), mat(0x0f172a));
    totem.position.set(entranceX, 2.1, entranceZ);
    const totemSign = new THREE.Mesh(box(1.8, 1.0, 0.3), mat(0x0284c7));
    totemSign.position.set(entranceX, 3.2, entranceZ);
    this.group.add(totem, totemSign);

    // Bekleyen Yolcular
    this.spawnStationPassengers(st);
  }

  spawnStationPassengers(st) {
    const clothes = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x475569];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const col = clothes[i % clothes.length];
      // Gövde & Baş
      const body = new THREE.Mesh(box(0.4, 0.6, 0.25), mat(col));
      body.position.y = 0.8;
      const head = new THREE.Mesh(box(0.24, 0.24, 0.24), mat(0xfbcfe8));
      head.position.y = 1.3;
      const legs = new THREE.Mesh(box(0.34, 0.5, 0.2), mat(0x1e293b));
      legs.position.y = 0.25;
      g.add(body, head, legs);
      g.position.set(st.x - 8 + i * 5 + Math.random() * 2, st.y, st.z + 2.5 + (Math.random() - 0.5) * 1.5);
      g.rotation.y = -Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      this.group.add(g);
      this.passengers.push({ g, st, originalX: g.position.x, onTrain: false });
    }
  }

  buildTrain() {
    // Metro Treni: Lokomotif & Yolcu Vagonu
    const trainLen = 22;
    const trainWid = 3.2;
    const trainH = 3.2;

    // Ana Gövde (Gümüş metalik)
    const bodyMat = mat(0xe2e8f0);
    const body = new THREE.Mesh(box(trainLen, trainH, trainWid), bodyMat);
    body.position.y = trainH / 2 + 0.1;
    body.castShadow = true;
    body.receiveShadow = true;
    this.trainGroup.add(body);

    // Mavi & Kırmızı Metro Şeridi
    const stripe = new THREE.Mesh(box(trainLen + 0.05, 0.35, trainWid + 0.05), mat(0x0284c7));
    stripe.position.y = 1.6;
    this.trainGroup.add(stripe);

    const stripe2 = new THREE.Mesh(box(trainLen + 0.06, 0.15, trainWid + 0.06), mat(0xdc2626));
    stripe2.position.y = 1.35;
    this.trainGroup.add(stripe2);

    // Geniş Yolcu Pencereleri (Koyu cam)
    const winMat = mat(0x0f172a, { transparent: true, opacity: 0.85 });
    for (let x = -8; x <= 8; x += 3.2) {
      const win1 = new THREE.Mesh(box(1.8, 1.1, trainWid + 0.12), winMat);
      win1.position.set(x, 2.1, 0);
      this.trainGroup.add(win1);
    }

    // Ön Aerodinamik Burun
    const nose = new THREE.Mesh(box(2.2, trainH - 0.4, trainWid - 0.2), mat(0x334155));
    nose.position.set(trainLen / 2 + 0.9, trainH / 2, 0);
    const noseBack = new THREE.Mesh(box(2.2, trainH - 0.4, trainWid - 0.2), mat(0x334155));
    noseBack.position.set(-trainLen / 2 - 0.9, trainH / 2, 0);
    this.trainGroup.add(nose, noseBack);

    // Farlar (LED Parlak Farlar)
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
    const head1 = new THREE.Mesh(box(0.1, 0.3, 0.4), lightMat);
    head1.position.set(trainLen / 2 + 2.0, 1.2, 0.8);
    const head2 = new THREE.Mesh(box(0.1, 0.3, 0.4), lightMat);
    head2.position.set(trainLen / 2 + 2.0, 1.2, -0.8);
    this.trainGroup.add(head1, head2);

    // Sürgülü Kapılar (Platform tarafı: z = trainWid / 2)
    this.doorMeshes = [];
    for (const dx of [-5, 5]) {
      const dMesh = new THREE.Mesh(box(1.6, 2.2, 0.1), mat(0x94a3b8));
      dMesh.position.set(dx, 1.2, trainWid / 2 + 0.05);
      this.trainGroup.add(dMesh);
      this.doorMeshes.push({ mesh: dMesh, baseX: dx });
    }

    this.trainGroup.position.copy(this.trainPos);
  }

  update(dt, character) {
    if (!this.trainGroup) return;

    // Metro Treni Hareketi & Duraklama Döngüsü
    if (this.state === 'stopped_st1') {
      this.trainSpeed = 0;
      this.stopTimer -= dt;
      this.setDoors(true, dt);

      if (this.stopTimer <= 0) {
        sound.playMetroChime();
        this.setDoors(false, dt);
        if (this.doorProgress <= 0.05) {
          this.state = 'moving_to_st2';
          this.stopTimer = 8;
        }
      }
    } else if (this.state === 'moving_to_st2') {
      const targetX = this.st2.x;
      const dist = targetX - this.trainPos.x;

      if (dist > 30) {
        this.trainSpeed = Math.min(this.maxSpeed, this.trainSpeed + dt * 8);
      } else {
        // İstasyon yaklaşımı: yavaşla
        this.trainSpeed = Math.max(2, this.trainSpeed - dt * 10);
      }

      this.trainPos.x += this.trainSpeed * dt;

      if (this.trainPos.x >= targetX) {
        this.trainPos.x = targetX;
        this.state = 'stopped_st2';
        sound.playMetroChime();
      }
    } else if (this.state === 'stopped_st2') {
      this.trainSpeed = 0;
      this.stopTimer -= dt;
      this.setDoors(true, dt);

      if (this.stopTimer <= 0) {
        sound.playMetroChime();
        this.setDoors(false, dt);
        if (this.doorProgress <= 0.05) {
          this.state = 'moving_to_st1';
          this.stopTimer = 8;
        }
      }
    } else if (this.state === 'moving_to_st1') {
      const targetX = this.st1.x;
      const dist = this.trainPos.x - targetX;

      if (dist > 30) {
        this.trainSpeed = Math.min(this.maxSpeed, this.trainSpeed + dt * 8);
      } else {
        this.trainSpeed = Math.max(2, this.trainSpeed - dt * 10);
      }

      this.trainPos.x -= this.trainSpeed * dt;

      if (this.trainPos.x <= targetX) {
        this.trainPos.x = targetX;
        this.state = 'stopped_st1';
        sound.playMetroChime();
      }
    }

    // Tren pozisyonunu güncelle
    const oldX = this.trainGroup.position.x;
    this.trainGroup.position.copy(this.trainPos);
    const deltaX = this.trainGroup.position.x - oldX;

    // Oyuncu trenin içindeyse trenle birlikte gitsin!
    if (character && character.body) {
      const cp = character.mesh.position;
      const insideX = Math.abs(cp.x - this.trainPos.x) < 11;
      const insideY = cp.y >= this.trainPos.y && cp.y <= this.trainPos.y + 3.5;
      const insideZ = Math.abs(cp.z - this.trainPos.z) < 1.8;

      if (insideX && insideY && insideZ) {
        character.body.position.x += deltaX;
        character.mesh.position.x += deltaX;
        if (Math.abs(deltaX) > 0.01 && this.onShake) {
          this.onShake(0.04);
        }
      }
    }

    // Yolcuların biniş / iniş animasyonu
    if (this.doorsOpen) {
      for (const p of this.passengers) {
        if (!p.onTrain && Math.random() < 0.02) {
          p.onTrain = true;
          p.g.position.set(this.trainPos.x + (Math.random() - 0.5) * 8, this.trainPos.y + 0.2, this.trainPos.z);
        }
      }
    }

    // Trendeki yolcular trenle birlikte yürür
    for (const p of this.passengers) {
      if (p.onTrain) {
        p.g.position.x += deltaX;
      }
    }
  }

  setDoors(open, dt) {
    this.doorsOpen = open;
    this.doorProgress += (open ? 1 : -1) * dt * 2.5;
    this.doorProgress = Math.max(0, Math.min(1, this.doorProgress));

    for (const d of this.doorMeshes || []) {
      d.mesh.position.x = d.baseX + this.doorProgress * 0.9;
    }
  }
}
