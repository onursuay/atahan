// Web Audio API Tabanlı Prosedürel Ses Motoru
// Harici mp3 yüklemeye gerek kalmadan anında yüksek kaliteli ses efektleri üretir.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API başlatılamadı:', e);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  // Roket / bazuka fırlatma: namludan çıkış çatlaması, gürleyen itki ve uzaklaşan tıslama.
  // Patlama sesi çarpma anında ayrıca (playExplosion) çalar.
  playShoot() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._burst(now, 0.05, 0.45, 'highpass', 2600, 1200, 0.7);          // çıkış çatlaması
    this._thump(now, 0.32, 0.65, 130, 38, 'sine');                       // itki darbesi
    this._burst(now, 0.22, 0.5, 'lowpass', 2200, 220, 0.8);              // yanma gürlemesi
    this._burst(now + 0.04, 0.7, 0.30, 'bandpass', 500, 2200, 0.9);      // yükselerek uzaklaşan tıslama
    this._thump(now + 0.02, 0.5, 0.12, 70, 140, 'sawtooth');             // motor ağzı vızıltısı
  }

  // Çekiç Savurma Sesi (Whoosh)
  playHammerSwing() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
    this.playNoise(0.1, 0.15, 600);
  }

  // Çekiç Vuruş Sesi (Sert çarpma / Tok darbe)
  playHammerHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
    this.playNoise(0.14, 0.4, 1200);
  }

  // 2. Madde: Demir Çekiç Çarpma Sesi (Metalik Tınlama / Clang Sesi)
  playIronHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Metalik çift osilatör (Demir rezonansı)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(980, now);
    osc1.frequency.exponentialRampToValueAtTime(650, now + 0.35);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1850, now);
    osc2.frequency.exponentialRampToValueAtTime(1200, now + 0.25);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);

    // Kısa metalik kıvılcım gürültüsü
    this.playNoise(0.06, 0.2, 2800);
  }

  // 1. Madde: Tahta Kırılma Sesi (Çıtırtılı ahşap darbesi)
  playWoodHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.12);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
    this.playNoise(0.12, 0.35, 750);
  }

  // Devasa Patlama Sesi (Sub-bass + Gürültü Filtresi)
  playExplosion(intensity = 1.0) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const duration = 0.8 * intensity;

    // Derin sub-bass darbesi
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140 * intensity, now);
    osc.frequency.exponentialRampToValueAtTime(25, now + duration);

    oscGain.gain.setValueAtTime(0.6 * Math.min(intensity, 1.5), now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);

    // Patlama gürültüsü
    this.playNoise(duration, 0.7 * intensity, 800);

    // Büyük patlamalarda (roket vb.) keskin çatlama ve uzayan alçak gürleme
    if (intensity >= 1.0) {
      this._burst(now, 0.06, 0.45, 'highpass', 3000, 1500, 0.7);
      this._burst(now + 0.08, duration * 1.6, 0.28, 'lowpass', 450, 55, 0.6);
    }
  }

  // TNT Zincirleme Patlama sesi
  playTNTExplosion() {
    if (this.muted || !this.ctx) return;
    this.playExplosion(1.4);
    // Ekstra çıtırtı
    setTimeout(() => {
      this.playNoise(0.3, 0.4, 1200);
    }, 60);
  }

  // Blok çarpışma / yıkılma sesi
  playBlockHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const freq = 120 + Math.random() * 80;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  // Karakter zıplama sesi (Kullanıcı talebi: kaldırıldı)
  playJump() {}

  // Bölüm Tamamlama Fanfarı (Kullanıcı talebi: kaldırıldı)
  playLevelWin() {}

  // ───────────────────────── Ortak yardımcılar ─────────────────────────
  // Tüm yeni sesler tek bir paylaşılan gürültü tamponundan beslenir (her seferinde yeni tampon üretilmez).
  _noiseBuffer() {
    if (this._noiseBuf) return this._noiseBuf;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  // Zarflı gürültü patlaması: filtre frekansı f0'dan f1'e süpürülür, ses üstel olarak söner.
  _burst(at, dur, vol, type, f0, f1, q = 0.7, dest = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter); filter.connect(gain); gain.connect(dest || ctx.destination);
    src.start(at, Math.random() * 1.5, dur + 0.02);
  }

  // Düşen frekanslı tok vuruş (silahın gövdesindeki "thump")
  _thump(at, dur, vol, f0, f1, type = 'sine', dest = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain); gain.connect(dest || ctx.destination);
    osc.start(at); osc.stop(at + dur + 0.02);
  }

  // Kısa metalik "tık": gürültü + ince bir tını
  _click(at, freq, vol, dest = null) {
    this._burst(at, 0.03, vol, 'bandpass', freq, freq * 0.8, 4, dest);
    this._thump(at, 0.04, vol * 0.5, freq * 0.6, freq * 0.4, 'triangle', dest);
  }

  // ───────────────────────── Silah sesleri ─────────────────────────
  // Her silahın kendi karakteri: keskin çatlama (crack) + gövde patlaması + tok vuruş + yankı kuyruğu.
  static GUN_PROFILES = {
    //            çatlama         gövde (süre, ses, filtre başı→sonu)  vuruş (süre, ses, f0→f1)  kuyruk (süre, ses, filtre)
    pistol:  { crack: [0.045, 0.55, 2400], body: [0.13, 0.5, 4200, 350],  thump: [0.10, 0.45, 240, 70],  tail: [0.45, 0.14, 1400] },
    shotgun: { crack: [0.060, 0.70, 1800], body: [0.30, 0.85, 3000, 160], thump: [0.26, 0.75, 130, 34],  tail: [0.80, 0.28, 900] },
    ak47:    { crack: [0.040, 0.50, 2800], body: [0.11, 0.55, 3400, 300], thump: [0.10, 0.50, 190, 60],  tail: [0.35, 0.13, 1300] },
    sniper:  { crack: [0.070, 0.85, 2200], body: [0.38, 0.90, 3200, 140], thump: [0.40, 0.85, 95, 26],   tail: [1.50, 0.34, 800] },
    minigun: { crack: [0.030, 0.40, 3000], body: [0.08, 0.50, 3200, 350], thump: [0.08, 0.45, 170, 55],  tail: [0.14, 0.05, 1400] }
  };

  playGunShot(kind = 'pistol') {
    if (this.muted || !this.ctx) return;
    const p = SoundEngine.GUN_PROFILES[kind] || SoundEngine.GUN_PROFILES.pistol;
    const now = this.ctx.currentTime;
    const jitter = 0.94 + Math.random() * 0.12;   // art arda atışlar birebir aynı çıkmasın
    this._burst(now, p.crack[0], p.crack[1], 'highpass', p.crack[2] * jitter, p.crack[2] * 0.5, 0.7);
    this._burst(now, p.body[0], p.body[1], 'lowpass', p.body[2] * jitter, p.body[3], 0.8);
    this._thump(now, p.thump[0], p.thump[1], p.thump[2] * jitter, p.thump[3], 'sine');
    this._burst(now + 0.02, p.tail[0], p.tail[1], 'lowpass', p.tail[2], 120, 0.5);
    if (kind === 'sniper') this._burst(now + 0.22, 0.9, 0.12, 'lowpass', 700, 100, 0.5);  // uzaktan yankı
  }

  // Pompalının sürgüsü (Kullanıcı talebi: kaldırıldı)
  playPump() {}

  // Şarjör değiştirme / dolum sesi (Kullanıcı talebi: kaldırıldı)
  playReload() {
    return { cancel() {} };
  }

  // Boş tetik sesi (Kullanıcı talebi: kaldırıldı)
  playDryFire() {}

  // ───────────────────────── Araba motoru ─────────────────────────
  // Kullanıcı talebi: Sürekli dönen motor döngüsü ve sesleri tamamen kaldırıldı.
  updateEngine() {
    if (this.engine) this.stopEngine();
  }

  _buildEngine() {
    return null;
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    try {
      if (e.sources) e.sources.forEach(s => { try { s.stop(); } catch (_) {} });
      if (e.out) e.out.disconnect();
    } catch (_) {}
  }

  // ───────────────────────── Yüzme ─────────────────────────
  // Kullanıcı talebi: Arkada sürekli dönen dıryt dıryt sesleri ve motor uğultuları kökünden kapatıldı.
  updateSwim() {
    if (this.swim) this.stopSwim();
  }

  _buildSwim() {
    return null;
  }

  stopSwim() {
    const s = this.swim;
    if (!s) return;
    this.swim = null;
    try {
      if (s.sources) s.sources.forEach(n => { try { n.stop(); } catch (_) {} });
      if (s.gain) s.gain.disconnect();
    } catch (_) {}
  }

  // Cyborg Lazer Sesi (Elektrik Humming)
  playLaserShot() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1200, now);
    osc1.frequency.exponentialRampToValueAtTime(400, now + 0.22);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(2400, now);
    osc2.frequency.exponentialRampToValueAtTime(800, now + 0.18);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now); osc2.start(now);
    osc1.stop(now + 0.25); osc2.stop(now + 0.25);
    this.playNoise(0.05, 0.15, 5000);
  }

  // Jetpack alevi (Kullanıcı talebi: kaldırıldı)
  playJet() {}

  // Bomba bip sesi (Kullanıcı talebi: kaldırıldı)
  playBeep() {}

  // Kapı sesleri (Kullanıcı talebi: kaldırıldı)
  playDoorGrab() {}
  playDoorHit() {}
  playDoorSlide() {}

  // Işın kılıcı açılış sesi (Kullanıcı talebi: kaldırıldı)
  playSaberOn() {}

  // Işın kılıcı savurma: hızlı "vııın" (perde yükselip alçalır)
  playSaberSwing() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.42);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    osc.connect(f); f.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.46);
    this._burst(now, 0.4, 0.12, 'bandpass', 900, 500, 1.5);
  }

  // Çift bıçağın çok turlu dönüşü: her turda iki bıçak kulağın yanından geçer; perde bu hızda salınır (Doppler),
  // hız yavaşça yükselip alçalır. turns = toplam tur sayısı.
  playSaberSpin(dur = 1.5, turns = 4) {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.linearRampToValueAtTime(260, now + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(170, now + dur);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();       // bıçak geçişi: turda 2 kez
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(turns * 2 / dur * 0.45, now);
    lfo.frequency.linearRampToValueAtTime(turns * 2 / dur * 1.5, now + dur * 0.5);
    lfo.frequency.linearRampToValueAtTime(turns * 2 / dur * 0.45, now + dur);
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + dur * 0.12);
    gain.gain.setValueAtTime(0.22, now + dur * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700;
    osc.connect(f); f.connect(gain); gain.connect(ctx.destination);
    osc.start(now); lfo.start(now); osc.stop(now + dur + 0.02); lfo.stop(now + dur + 0.02);
    this._burst(now, dur, 0.14, 'bandpass', 700, 1500, 1.2);
  }

  // Işın kılıcı bir şeyi keserken: kıvılcım cızırtısı + tiz elektrik "zzt"
  playSaberHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._burst(now + i * 0.035, 0.05, 0.22, 'highpass', 3500 + i * 700, 2500, 1);
    this._thump(now, 0.14, 0.12, 1900, 700, 'sawtooth');
    this._burst(now, 0.12, 0.14, 'lowpass', 900, 200, 0.7);
  }

  // Elde tutulan çift bıçağın sürekli vızıltısı: iki hafif ayarsız osilatör (vuruntu), harekete göre perde yükselir.
  // motion: 0..1 (kılıcın o anki hızı). active=false ise ses kapanır.
  updateSaberHum() { if (this.saberHum) this.stopSaberHum(); }
  _buildSaberHum() { return null; }
  stopSaberHum() {
    const h = this.saberHum;
    if (!h) return;
    this.saberHum = null;
    try {
      if (h.oscs) h.oscs.forEach(o => { try { o.stop(); } catch (_) {} });
      if (h.gain) h.gain.disconnect();
    } catch (_) {}
  }

  // ───────────────────────── Minigun motoru ─────────────────────────
  // Kullanıcı talebi: Minigun motor vızıltısı ve arkadaki sürekli makine sesi tamamen kapatıldı.
  updateMinigun(spin) {
    if (this.minigunLoop) this.stopMinigun();
  }

  _buildMinigun() {
    return null;
  }

  stopMinigun() {
    const m = this.minigunLoop;
    if (!m) return;
    this.minigunLoop = null;
    try {
      const now = this.ctx ? this.ctx.currentTime : 0;
      if (m.gain && this.ctx) {
        m.gain.gain.cancelScheduledValues(now);
        m.gain.gain.setValueAtTime(0, now);
      }
      if (m.whine) try { m.whine.stop(); } catch (_) {}
      if (m.gear) try { m.gear.stop(); } catch (_) {}
      if (m.gain) m.gain.disconnect();
    } catch (_) {}
  }

  // Suya giriş / su sıçraması
  // Köprü ipi koptu: sert çıtlama + hızla düşen titrek tel sesi
  playRopeSnap() {}
  playBridgeCreak() {}

  // ───────────────────────── Cephanelik (yeni silahlar) ─────────────────────────
  // Kara delik topu: fırlatma
  playGravityLaunch() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._thump(now, 0.55, 0.32, 240, 55, 'sine');
    this._thump(now, 0.4, 0.12, 80, 40, 'sawtooth');
    this._burst(now, 0.5, 0.16, 'bandpass', 700, 160, 1.6);
  }
  // Kütleçekim kuyusu: sürekli alçalan/yükselen uğultu (p: 0..1 ilerleme; perde yükselir)
  updateWell() { if (this.wellLoop) this.stopWell(); }
  stopWell() {
    const w = this.wellLoop;
    if (!w) return;
    this.wellLoop = null;
    try {
      if (w.a) try { w.a.stop(); } catch (_) {}
      if (w.b) try { w.b.stop(); } catch (_) {}
      if (w.g) w.g.disconnect();
    } catch (_) {}
  }
  // Kuyunun çökmesi: çöken ton + gürleyen boşalma
  playImplosion() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._thump(now, 1.0, 0.55, 280, 26, 'sine');
    this._thump(now, 0.7, 0.35, 95, 24, 'sawtooth');
    this._burst(now + 0.05, 0.85, 0.5, 'lowpass', 2600, 110, 0.8);
  }
  // Yıldırım bobini: çıtırtılı elektrik atışı
  playZap() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._burst(now + i * 0.014, 0.04, 0.15, 'highpass', 3500 + i * 1400, 7000, 1);
    this._thump(now, 0.07, 0.09, 150, 85, 'square');
    this._burst(now, 0.09, 0.1, 'bandpass', 1800, 900, 2);
  }
  // Eritici: fırlatma, yapışma, cızırdama
  playMeltFire() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._burst(now, 0.3, 0.22, 'bandpass', 2400, 700, 1.1);
    this._thump(now, 0.18, 0.18, 420, 110, 'sawtooth');
  }
  playMeltHit() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._burst(now, 0.55, 0.26, 'bandpass', 3200, 1200, 1.2);
    this._thump(now, 0.25, 0.2, 320, 80, 'sawtooth');
  }
  playSizzle() {}
  // Yer sarsıcı: derin gümbürtü + çatırdayan kayalar
  playQuake() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._thump(now, 1.7, 0.62, 85, 21, 'sine');
    this._thump(now + 0.04, 0.55, 0.3, 170, 48, 'sawtooth');
    this._burst(now, 1.5, 0.45, 'lowpass', 520, 55, 0.9);
    for (let i = 0; i < 6; i++) this._burst(now + 0.25 + i * 0.17, 0.12, 0.14, 'bandpass', 900 + Math.random() * 900, 300, 2);
  }
  // Yıkım topu: fırlatma ve çarpma
  playWreckLaunch() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._burst(now, 0.45, 0.24, 'bandpass', 450, 2300, 0.8);
    this._thump(now, 0.32, 0.42, 115, 44, 'sine');
  }
  playWreckHit(power = 1) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._thump(now, 0.4, 0.38 * power, 125, 36, 'sine');
    this._burst(now, 0.28, 0.3 * power, 'lowpass', 1600, 200, 0.8);
    this._thump(now, 0.12, 0.18 * power, 720, 190, 'square');
  }
  // Testere diski: fırlatma ve uçarken dönen vızıltı (motion: 0..1 disk hızı)
  playSawThrow() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._burst(now, 0.28, 0.2, 'bandpass', 900, 3600, 2);
    this._thump(now, 0.12, 0.14, 900, 300, 'square');
  }
  updateSaw() { if (this.sawLoop) this.stopSaw(); }
  stopSaw() {
    const w = this.sawLoop;
    if (!w) return;
    this.sawLoop = null;
    try {
      if (w.a) try { w.a.stop(); } catch (_) {}
      if (w.b) try { w.b.stop(); } catch (_) {}
      if (w.lfo) try { w.lfo.stop(); } catch (_) {}
      if (w.g) w.g.disconnect();
    } catch (_) {}
  }

  playSplash() {}

  // ───────────────────────── Ahtapot Silahı / Dönüşümü Sesleri ─────────────────────────
  // Ahtapot ekrana atlayıp yavaşça kaybolurken çıkan "vıcık vıcık" ıslak/yapışkan sesler
  playOctopusSquish() {}
  playTentacleShoot() {}
  playTentacleWrap() {}
  playTentaclePull() {}
  playOctopusJump() {}
  playOctopusSpin() {}
  playOctopusThrow() {}

  // Şehir Otobüsü Havalı Fren Sesi (Pneumatic Air Brake Release Hiss)
  playBusBrake() {}
  playBusChime() {}
  playBusDoor() {}
  playBusHorn() {}

  // Okul zili tınısı: neşeli melodi ("DİNG DONG DİNG DONG")
  playSchoolBell() {}
  playMetroChime() {}
  playMeow() {}
  playCashRegister() {}
  playDialogBeep() {}
  playPhoneRing() {}
  playLimoDoor() {}
  playPoliceSiren() { return null; }

  // Gürültü (Noise) Üreteci
  playNoise(duration, volume, filterFreq = 1000) {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(this.ctx.currentTime);
  }

  // ── Elemental Ateş Sesleri ──
  playFireball() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.32);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(now); osc.stop(now + 0.35);
    this.playNoise(0.28, 0.45, 1200);
  }

  playFlameBreath() {
    if (this.muted || !this.ctx) return;
    if (this._flameBreathTick && performance.now() - this._flameBreathTick < 80) return;
    this._flameBreathTick = performance.now();
    this.playNoise(0.12, 0.28, 850);
  }

  playFireIgnite() {}
  playFireSwordIgnite() {}
  playFlightWhoosh() {}
}

export const sound = new SoundEngine();
