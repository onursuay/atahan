import * as THREE from 'three';
import { sound } from './audio.js';

export class LightSwitchManager {
  constructor(scene, voxelWorld) {
    this.scene = scene;
    this.vw = voxelWorld;
    this.switches = [];
    this._audioCtx = null;
  }

  // Duvara monte elektrik ışık anahtarı ekler
  // x, y, z: anahtar konumu (metre)
  // rotY: yönü
  // opts: { name, lamps: [{ x, y, z, rodLen, voxelCoords }], initialOn }
  addSwitch(x, y, z, rotY = 0, opts = {}) {
    const group = new THREE.Group();

    // 1. Anahtar Ön Çerçevesi (Standart duvara monte beyaz parlak çerçeve)
    const plateGeo = new THREE.BoxGeometry(0.12, 0.16, 0.02);
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.25,
      metalness: 0.05
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.castShadow = true;
    group.add(plate);

    // 2. İç Yuva / Çerçeve Çıtası
    const slotGeo = new THREE.BoxGeometry(0.06, 0.09, 0.022);
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.4
    });
    const slot = new THREE.Mesh(slotGeo, slotMat);
    group.add(slot);

    // 3. Aç / Kapa Butonu (Rocker / Toggle Tuşu)
    const rockerGeo = new THREE.BoxGeometry(0.048, 0.076, 0.028);
    const rockerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1
    });
    const rocker = new THREE.Mesh(rockerGeo, rockerMat);
    rocker.position.set(0, 0, 0.012);
    group.add(rocker);

    // Küçük durum göstergesi (açıkken minik fosforlu yeşil/turuncu nokta)
    const indGeo = new THREE.BoxGeometry(0.012, 0.012, 0.03);
    const indMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const indicator = new THREE.Mesh(indGeo, indMat);
    indicator.position.set(0, 0.024, 0.016);
    group.add(indicator);

    group.position.set(x, y, z);
    group.rotation.y = rotY;
    this.scene.add(group);

    // Bağlı tavan lambaları ve dinamik ışıklar (PointLight)
    const pointLights = [];
    const lampMeshes = [];

    const lampPositions = opts.lamps || [];
    for (const lp of lampPositions) {
      const lampG = new THREE.Group();

      // Askı kablosu / çubuğu
      const rodLen = lp.rodLen || 0.45;
      const rodGeo = new THREE.CylinderGeometry(0.014, 0.014, rodLen, 8);
      const rodMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });
      const rod = new THREE.Mesh(rodGeo, rodMat);
      rod.position.y = rodLen / 2;

      // Abajur / Modern lamba kapağı
      const shadeGeo = new THREE.CylinderGeometry(0.14, 0.28, 0.18, 16);
      const shadeMat = new THREE.MeshStandardMaterial({
        color: lp.shadeColor || 0x334155,
        roughness: 0.3,
        metalness: 0.6
      });
      const shade = new THREE.Mesh(shadeGeo, shadeMat);

      // Ampul
      const bulbGeo = new THREE.SphereGeometry(0.09, 16, 16);
      const bulbMat = new THREE.MeshStandardMaterial({
        color: 0xfffbeb,
        emissive: 0xffedd5,
        emissiveIntensity: 1.2,
        roughness: 0.1
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.y = -0.07;

      lampG.add(rod, shade, bulb);
      lampG.position.set(lp.x, lp.y, lp.z);
      this.scene.add(lampG);

      // Gerçek 3D Işık Kaynağı (Dinamik PointLight)
      const pl = new THREE.PointLight(0xffedd5, 1.8, 16, 1.6);
      pl.position.set(lp.x, lp.y - 0.18, lp.z);
      this.scene.add(pl);
      pointLights.push(pl);

      lampMeshes.push({
        group: lampG,
        bulb,
        bulbMat,
        voxelCoords: lp.voxelCoords || []
      });
    }

    const sw = {
      id: this.switches.length + 1,
      group,
      rocker,
      indicator,
      indMat,
      pos: new THREE.Vector3(x, y, z),
      half: new THREE.Vector3(0.18, 0.22, 0.18),
      on: opts.initialOn !== false,
      pointLights,
      lampMeshes,
      rotY
    };

    this.switches.push(sw);
    this._updateVisuals(sw);
    return sw;
  }

  _updateVisuals(sw) {
    // Tuş pozisyonu (açıkken yukarı eğik, kapalıyken aşağı eğik)
    sw.rocker.rotation.x = sw.on ? 0.24 : -0.24;
    sw.indMat.color.setHex(sw.on ? 0x22c55e : 0xef4444);

    for (const pl of sw.pointLights) {
      pl.intensity = sw.on ? 1.9 : 0.0;
    }

    for (const lm of sw.lampMeshes) {
      if (lm.bulbMat) {
        lm.bulbMat.emissive.setHex(sw.on ? 0xffedd5 : 0x1e293b);
        lm.bulbMat.emissiveIntensity = sw.on ? 1.2 : 0.0;
        lm.bulbMat.color.setHex(sw.on ? 0xfffbeb : 0x475569);
      }
      if (lm.voxelCoords && this.vw && this.vw.voxels) {
        for (const [vx, vy, vz] of lm.voxelCoords) {
          const v = this.vw.voxels.get(`${vx},${vy},${vz}`);
          if (v) {
            v.active = sw.on;
          }
        }
      }
    }
  }

  // Mekanik ışık anahtarı tıklama sesi üret
  _playClickSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._audioCtx) this._audioCtx = new AudioCtx();
      if (this._audioCtx.state === 'suspended') this._audioCtx.resume();

      const t = this._audioCtx.currentTime;
      const osc = this._audioCtx.createOscillator();
      const gain = this._audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.04);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

      osc.connect(gain);
      gain.connect(this._audioCtx.destination);

      osc.start(t);
      osc.stop(t + 0.05);
    } catch (e) {
      // Audio fallback
    }
  }

  _rayAabb(o, d, p, h) {
    let tmin = 0, tmax = 1e9;
    for (const a of ['x', 'y', 'z']) {
      const lo = p.pos[a] - h[a] - 0.12, hi = p.pos[a] + h[a] + 0.12;
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo || o[a] > hi) return -1;
        continue;
      }
      let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  // Oyuncunun kamerası bir ışık anahtarına bakıyor mu?
  pick(camera, reach = 3.6) {
    const o = camera.position, d = new THREE.Vector3();
    camera.getWorldDirection(d);
    let best = null;
    for (const sw of this.switches) {
      const t = this._rayAabb(o, d, sw, sw.half);
      if (t >= 0 && t <= reach && (!best || t < best.dist)) {
        best = { switch: sw, dist: t };
      }
    }
    return best;
  }

  aim(camera) {
    return !!this.pick(camera);
  }

  toggle(sw) {
    if (!sw) return false;
    sw.on = !sw.on;
    this._updateVisuals(sw);
    this._playClickSound();
    return sw.on;
  }
}
