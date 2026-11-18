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

    const isLuxury = !!(opts.style === 'luxury' || opts.luxury);

    let plate, slot, rocker, indicator, indMat, glowMesh;

    if (isLuxury) {
      // ── LÜKS VİLLA ÖZEL TASARIM ELEKTRİK & AKILLI AYDINLATMA PANELİ ──
      // 1. Zengin abimizin evine özel fırçalanmış şampanya altını masif ana gövde
      const plateGeo = new THREE.BoxGeometry(0.14, 0.18, 0.016);
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.2,
        metalness: 0.92,
        envMapIntensity: 1.4
      });
      plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(0, 0, 0.008);
      plate.castShadow = true;
      group.add(plate);

      // Parlak 24K altın pahlı / pürüzsüz dış çerçeve çıtası
      const rimGeo = new THREE.BoxGeometry(0.146, 0.186, 0.012);
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0xffdf78,
        metalness: 0.96,
        roughness: 0.1
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(0, 0, 0.006);
      group.add(rim);

      // 2. İç Panel: Derin parıltılı obsidyen siyah cam yüzey
      const glassGeo = new THREE.BoxGeometry(0.10, 0.14, 0.018);
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0x090d16,
        roughness: 0.08,
        metalness: 0.88
      });
      slot = new THREE.Mesh(glassGeo, glassMat);
      slot.position.set(0, 0, 0.009);
      group.add(slot);

      // 3. Altın Kaplama Çift Rocker / Minimalist Aç-Kapa Tuşu
      const rockerGeo = new THREE.BoxGeometry(0.054, 0.082, 0.024);
      const rockerMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.95,
        roughness: 0.15
      });
      rocker = new THREE.Mesh(rockerGeo, rockerMat);
      rocker.position.set(0, 0, 0.016);
      group.add(rocker);

      // Tuş üstü lüks altın vurgu çizgisi
      const accentGeo = new THREE.BoxGeometry(0.006, 0.068, 0.026);
      const accentMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        metalness: 0.98,
        roughness: 0.08
      });
      const accent = new THREE.Mesh(accentGeo, accentMat);
      accent.position.set(0, 0, 0.018);
      group.add(accent);

      // 4. İnce Kristal LED Durum Çubuğu (Açıkken fütüristik turkuaz/camgöbeği, kapalıyken lüks sıcak kehribar)
      const indGeo = new THREE.BoxGeometry(0.038, 0.006, 0.026);
      indMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 2.2,
        roughness: 0.1
      });
      indicator = new THREE.Mesh(indGeo, indMat);
      indicator.position.set(0, 0.028, 0.019);
      group.add(indicator);

      // 5. Duvara Yayılan Yumuşak Ambiyans Işığı (Hafif lüks neon aura)
      const glowGeo = new THREE.PlaneGeometry(0.18, 0.22);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        depthWrite: false
      });
      glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(0, 0, 0.0005);
      group.add(glowMesh);
    } else {
      // ── STANDART MODERN DUVARA MONTE ELEKTRİK IŞIK ANAHTARI ──
      // 1. Anahtar Ön Çerçevesi (Standart duvara monte beyaz parlak çerçeve, arkası duvara tam sıfır)
      const plateGeo = new THREE.BoxGeometry(0.12, 0.16, 0.016);
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.25,
        metalness: 0.05
      });
      plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(0, 0, 0.008);
      plate.castShadow = true;
      group.add(plate);

      // 2. İç Yuva / Çerçeve Çıtası
      const slotGeo = new THREE.BoxGeometry(0.06, 0.09, 0.018);
      const slotMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.4
      });
      slot = new THREE.Mesh(slotGeo, slotMat);
      slot.position.set(0, 0, 0.010);
      group.add(slot);

      // 3. Aç / Kapa Butonu (Rocker / Toggle Tuşu)
      const rockerGeo = new THREE.BoxGeometry(0.048, 0.076, 0.024);
      const rockerMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.1
      });
      rocker = new THREE.Mesh(rockerGeo, rockerMat);
      rocker.position.set(0, 0, 0.014);
      group.add(rocker);

      // Küçük durum göstergesi (açıkken minik fosforlu yeşil, kapalıyken kırmızı nokta)
      const indGeo = new THREE.BoxGeometry(0.012, 0.012, 0.026);
      indMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
      indicator = new THREE.Mesh(indGeo, indMat);
      indicator.position.set(0, 0.024, 0.016);
      group.add(indicator);
    }

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
      name: opts.name || (isLuxury ? 'Lüks Villa Akıllı Aydınlatma Anahtarı' : 'Elektrik Işık Anahtarı'),
      group,
      rocker,
      indicator,
      indMat,
      isLuxury,
      glowMesh,
      extraLights: opts.pointLights || opts.extraLights || [],
      onToggle: opts.onToggle || null,
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
    if (sw.isLuxury) {
      sw.rocker.rotation.x = sw.on ? 0.22 : -0.22;
      sw.indMat.color.setHex(sw.on ? 0x38bdf8 : 0xf59e0b);
      if (sw.indMat.emissive) {
        sw.indMat.emissive.setHex(sw.on ? 0x0284c7 : 0x78350f);
        sw.indMat.emissiveIntensity = sw.on ? 2.2 : 0.8;
      }
      if (sw.glowMesh) sw.glowMesh.visible = sw.on;
    } else {
      sw.rocker.rotation.x = sw.on ? 0.24 : -0.24;
      sw.indMat.color.setHex(sw.on ? 0x22c55e : 0xef4444);
    }

    for (const pl of sw.pointLights) {
      pl.intensity = sw.on ? 1.9 : 0.0;
    }

    if (sw.extraLights && Array.isArray(sw.extraLights)) {
      for (const el of sw.extraLights) {
        if (!el) continue;
        if (el.userData?.baseIntensity === undefined) el.userData = { ...el.userData, baseIntensity: el.intensity };
        el.intensity = sw.on ? (el.userData.baseIntensity || 20) : 0.0;
      }
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

    if (typeof sw.onToggle === 'function') {
      try { sw.onToggle(sw.on); } catch (e) {}
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
