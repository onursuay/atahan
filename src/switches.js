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
  // opts: { name, lamps: [{ x, y, z, rodLen, voxelCoords }], initialOn, luxury, style }
  addSwitch(x, y, z, rotY = 0, opts = {}) {
    const group = new THREE.Group();
    const isLuxury = !!(opts.luxury || opts.style === 'luxury');

    // 1. Anahtar Ön Çerçevesi (Lüks için fırçalanmış şampanya altını, standart için beyaz)
    const plateGeo = new THREE.BoxGeometry(0.12, 0.16, 0.016);
    const plateMat = new THREE.MeshStandardMaterial({
      color: isLuxury ? 0xd4af37 : 0xf8fafc,
      roughness: isLuxury ? 0.2 : 0.25,
      metalness: isLuxury ? 0.85 : 0.05
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.castShadow = true;
    group.add(plate);

    // 2. İç Yuva / Çerçeve Çıtası (Lüks için obsidyen cam, standart için açık antrasit)
    const slotGeo = new THREE.BoxGeometry(0.064, 0.096, 0.018);
    const slotMat = new THREE.MeshStandardMaterial({
      color: isLuxury ? 0x0f172a : 0x94a3b8,
      roughness: isLuxury ? 0.1 : 0.4,
      metalness: isLuxury ? 0.9 : 0.1
    });
    const slot = new THREE.Mesh(slotGeo, slotMat);
    group.add(slot);

    // 3. Aç / Kapa Butonu (Lüks için altın dokunmatik tuş, standart için beyaz rocker)
    const rockerGeo = new THREE.BoxGeometry(0.048, 0.076, 0.022);
    const rockerMat = new THREE.MeshStandardMaterial({
      color: isLuxury ? 0xfacc15 : 0xffffff,
      roughness: isLuxury ? 0.15 : 0.2,
      metalness: isLuxury ? 0.8 : 0.1
    });
    const rocker = new THREE.Mesh(rockerGeo, rockerMat);
    rocker.position.set(0, 0, 0.008);
    group.add(rocker);

    // Küçük durum göstergesi (açıkken lüks için şık buz mavisi LED, standart için yeşil LED)
    const indGeo = new THREE.BoxGeometry(0.012, 0.012, 0.024);
    const indMat = new THREE.MeshBasicMaterial({ color: isLuxury ? 0x38bdf8 : 0x22c55e });
    const indicator = new THREE.Mesh(indGeo, indMat);
    indicator.position.set(0, 0.024, 0.012);
    group.add(indicator);

    group.position.set(x, y, z);
    group.rotation.y = rotY;
    this.scene.add(group);

    // Bağlı tavan lambaları ve dinamik ışıklar (PointLight)
    const pointLights = [];
    const lampMeshes = [];

    if (opts.pointLights && Array.isArray(opts.pointLights)) {
      pointLights.push(...opts.pointLights);
    }

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

  // Mekanik ışık anahtarı tıklama sesi (Kullanıcı talebiyle kaldırıldı)
  _playClickSound() {}

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
