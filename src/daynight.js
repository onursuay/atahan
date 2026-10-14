import * as THREE from 'three';
import { PALETTE } from './teardown.js';
import { beamMat } from './carmodels.js';

// ─────────────────────────────────────────────────────────────────────────────
// GECE / GÜNDÜZ DÖNGÜSÜ: 10 dakika gündüz, 10 dakika gece, art arda. Geçişler (alacakaranlık ve şafak) ~60 sn sürer.
//  • Gökyüzü, sis, ortam ışığı, güneş/ay ışığı ve rengi, güneş/ay/yıldızlar, bulutlar ve deniz rengi döngüyle değişir.
//  • Lambalar (sokak, bina içi, villa) akşam önce yanar, gece olunca iyice parlar (iki aşamalı yükselir).
//  • Sokak lambalarının altında yola ışık havuzları oluşur; oyuncuya en yakın lambalar gerçek ışık verir.
//  • Arabaların farları gece ışık huzmesi bırakır; sürdüğün arabanın önünü gerçek ışık aydınlatır.
// ─────────────────────────────────────────────────────────────────────────────
const PERIOD = 1200;           // 10 dk gündüz + 10 dk gece (sn)
const DUSK_AT = 600, DUSK = 60;   // akşam geçişi 570..630 (ortası 600), şafak geçişi 1170..1230 (ortası 1200 = 0)
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const AZ = Math.atan2(45, 60);  // güneşin sabit yön açısı (eski konumla aynı)

export class DayNight {
  constructor(o) {
    this.scene = o.scene; this.ambient = o.ambient; this.sun = o.sun; this.sunMesh = o.sunMesh; this.clouds = o.clouds;
    this.water = o.water; this.vw = o.vw; this.cars = o.cars;
    this.t = 40;                 // oyun saati (sn); 0 ve 1200 şafağın ortasıdır, 600 akşamın ortasıdır; 40'ta tam gündüz başlar
    this.d = 1;                  // gündüz miktarı 0..1
    this.lampFactor = 0;
    this.dayCol = new THREE.Color(0x78a7ff); this.duskCol = new THREE.Color(0xff9a5c); this.nightCol = new THREE.Color(0x050a1c);
    this.waterDay = new THREE.Color(0x0369a1), this.waterNight = new THREE.Color(0x011a2e);
    this.ambDay = new THREE.Color(0xffffff), this.ambNight = new THREE.Color(0x3b4f8a);
    this.sunWhite = new THREE.Color(0xfffbe8), this.sunOrange = new THREE.Color(0xff9a55), this.moonCol = new THREE.Color(0x9db8ff);
    this.tmp = new THREE.Color();
    this.dir = new THREE.Vector3(0.6, 0.8, 0.45).normalize();

    // Ay (kare) ve yıldızlar
    this.moonMesh = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.5, 0.4), new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false }));
    this.scene.add(this.moonMesh);
    const N = 520, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * r * 420; pos[i * 3 + 1] = Math.abs(u) * 420 * 0.9 + 20; pos[i * 3 + 2] = Math.sin(a) * r * 420;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat); this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // Işık havuzları: her sokak lambasının altında yere yayılan sıcak ışık (ucuz: tek InstancedMesh, gerçek ışık değil)
    const lamps = this.vw.lamps || [];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    if (cx && cx.createRadialGradient) {
      const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,226,150,0.85)'); gr.addColorStop(0.45, 'rgba(255,200,110,0.35)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    }
    this.poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11), this.poolMat, Math.max(1, lamps.length));
    this.pools.frustumCulled = false; this.pools.renderOrder = 2;
    const d = new THREE.Object3D();
    lamps.forEach((l, i) => { d.position.set(l.x, l.gy + 0.07, l.z); d.rotation.set(-Math.PI / 2, 0, 0); d.updateMatrix(); this.pools.setMatrixAt(i, d.matrix); });
    this.pools.count = lamps.length;
    this.scene.add(this.pools);

    // Gerçek ışıklar: oyuncuya en yakın 4 lamba + sürülen arabanın farı
    this.lampLights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 22, 2); this.scene.add(l); this.lampLights.push(l); }
    this.carSpot = new THREE.SpotLight(0xfff1c0, 0, 55, 0.6, 0.6, 1.2); this.scene.add(this.carSpot); this.scene.add(this.carSpot.target);
    this.assignT = 0;
    this.lampMats = [PALETTE.LAMP, PALETTE.LAMP_BLUE, PALETTE.LAMP_PINK, PALETTE.LAMP_GREEN, PALETTE.LAMP_PURPLE, PALETTE.LAMP_ORANGE].map(m => this.vw.materials[m.id]).filter(Boolean);
    this.apply(true);
  }

  // Gündüz miktarı: 1 gündüz, 0 gece
  // Gündüz tam 10 dk (d > 0.5: 0..600 sn), gece tam 10 dk (600..1200 sn)
  static dayAmount(u) {
    u = ((u + DUSK / 2) % PERIOD + PERIOD) % PERIOD - DUSK / 2;     // [-30, 1170)
    if (u < DUSK / 2) return smooth((u + DUSK / 2) / DUSK);         // şafak
    if (u < DUSK_AT - DUSK / 2) return 1;
    if (u < DUSK_AT + DUSK / 2) return 1 - smooth((u - (DUSK_AT - DUSK / 2)) / DUSK);   // alacakaranlık
    return 0;
  }

  dispose() {
    [this.moonMesh, this.stars, this.pools, this.carSpot, this.carSpot.target, ...this.lampLights].forEach(o => this.scene.remove(o));
    beamMat.opacity = 0;
  }

  setTime(sec) { this.t = sec; this.apply(true, this._lastCam); }
  get isNight() { return this.d < 0.5; }
  // "GÜNDÜZ 08:12" gibi: bu fazın kalan süresi
  label() {
    const u = ((this.t % PERIOD) + PERIOD) % PERIOD, day = u < DUSK_AT;
    const left = day ? DUSK_AT - u : PERIOD - u;
    const m = Math.floor(left / 60), s = Math.floor(left % 60);
    return `${day ? '☀️ GÜNDÜZ' : '🌙 GECE'}  ${m}:${String(s).padStart(2, '0')}`;
  }

  update(dt, camPos, driven) {
    this.t += dt;
    this.apply(false, camPos, dt, driven);
  }

  apply(force, camPos = null, dt = 0, driven = null) {
    if (camPos) this._lastCam = camPos;
    const d = DayNight.dayAmount(this.t), night = 1 - d;
    this.d = d;
    // Gökyüzü / sis / ortam
    const dusk = Math.max(0, 1 - Math.abs(2 * d - 1)) * 0.75;
    const sky = this.tmp.copy(this.nightCol).lerp(this.dayCol, d).lerp(this.duskCol, dusk);
    this.scene.background.copy(sky); this.scene.fog.color.copy(sky); this.scene.fog.far = 330 - 90 * night;
    this.ambient.intensity = 0.3 + 0.25 * d; this.ambient.color.copy(this.ambNight).lerp(this.ambDay, d);
    // Güneş / ay ışığı: tek yönlü ışık; ufka inerken turuncu, gece mavi
    const sunUp = d >= 0.5, k = sunUp ? smooth((d - 0.5) / 0.5) : smooth((0.5 - d) / 0.5);
    const el = THREE.MathUtils.degToRad(sunUp ? 7 + 51 * k : 7 + 48 * k), az = sunUp ? AZ : AZ + Math.PI;
    this.dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    this.sun.intensity = sunUp ? 1.4 * smooth((d - 0.45) / 0.55) : 0.65 * (1 - smooth(d / 0.45));
    this.sun.color.copy(sunUp ? this.sunOrange.clone().lerp(this.sunWhite, smooth((d - 0.5) / 0.4)) : this.moonCol);
    // Su, bulutlar
    this.water.color.copy(this.waterNight).lerp(this.waterDay, d);
    this.clouds.forEach(c => c.mesh.material.color.setScalar(0.18 + 0.82 * d));
    this.starMat.opacity = Math.pow(night, 2);
    // Lambalar: akşam yanar (1. aşama), gece iyice parlar (2. aşama)
    const on = smooth(night / 0.5), full = smooth((night - 0.5) / 0.5);
    this.lampFactor = Math.min(1, on * 0.55 + full * 0.45);
    for (const m of this.lampMats) m.emissiveIntensity = 0.2 + 1.2 * on + 1.3 * full;
    this.poolMat.opacity = 0.9 * this.lampFactor;
    beamMat.opacity = 0.16 * this.lampFactor;
    if (camPos) {
      this.sunMesh.position.copy(camPos).addScaledVector(this.dir, 190); this.sunMesh.visible = sunUp && d > 0.35; this.sunMesh.lookAt(camPos);
      this.moonMesh.position.copy(camPos).addScaledVector(this.dir, 190); this.moonMesh.visible = !sunUp && d < 0.65; this.moonMesh.lookAt(camPos);
      this.stars.position.copy(camPos);
      // en yakın lambalar gerçek ışık verir (yarım saniyede bir yeniden dağıtılır)
      this.assignT -= dt;
      if (this.assignT <= 0 && this.lampFactor > 0.02) {
        this.assignT = 0.5;
        const lamps = this.vw.lamps || [], best = [];
        for (const l of lamps) { const dd = (l.x - camPos.x) ** 2 + (l.z - camPos.z) ** 2 + (l.y - camPos.y) ** 2; if (dd < 2500) best.push([dd, l]); }
        best.sort((a, b) => a[0] - b[0]);
        this.lampLights.forEach((li, i) => { if (best[i]) li.position.set(best[i][1].x, best[i][1].y - 0.3, best[i][1].z); else li.position.set(0, -50, 0); });
      }
      this.lampLights.forEach(li => { li.intensity = 38 * this.lampFactor; });
      // sürülen arabanın farı
      if (driven && this.lampFactor > 0.02) {
        const f = driven.fwd, p = driven.pos;
        this.carSpot.position.set(p.x + f.x * (driven.T.len / 2 - 0.2), p.y + 0.8, p.z + f.z * (driven.T.len / 2 - 0.2));
        this.carSpot.target.position.set(p.x + f.x * 30, p.y - 1.2, p.z + f.z * 30);
        this.carSpot.intensity = 130 * this.lampFactor;
      } else this.carSpot.intensity = 0;
    }
  }
}
