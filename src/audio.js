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

  // Karakter zıplama sesi
  playJump() {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.18);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  // Bölüm Tamamlama Fanfarı
  playLevelWin() {
    if (this.muted || !this.ctx) return;
    const notes = [261.63, 329.63, 392.00, 523.25]; // C, E, G, High C
    const now = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);

      gain.gain.setValueAtTime(0.25, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.3);
    });
  }

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

  // Pompalının sürgüsü: ileri-geri "çak-çuk"
  playPump(delay = 0.4) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    this._click(t, 900, 0.35);
    this._burst(t + 0.02, 0.07, 0.18, 'bandpass', 1400, 2600, 2);
    this._click(t + 0.16, 1300, 0.4);
  }

  // Şarjör değiştirme / dolum sesi. `dur` toplam süredir; ses parçaları ona oranlanır.
  // Dönen nesnenin cancel() çağrısı (silah değişince) kalan sesleri susturur.
  playReload(kind = 'pistol', dur = 1.5) {
    if (this.muted || !this.ctx) return { cancel() {} };
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const group = ctx.createGain();
    group.gain.value = 1;
    group.connect(ctx.destination);

    if (kind === 'shotgun') {
      // Kovanlar tek tek yuvaya sürülür, en sonda sürgü çekilir
      const n = 4;
      for (let i = 0; i < n; i++) {
        const at = t + 0.15 + i * ((dur - 0.9) / n);
        this._click(at, 1100 + Math.random() * 300, 0.4, group);
        this._thump(at + 0.01, 0.06, 0.25, 160, 80, 'triangle', group);
      }
      this._click(t + dur - 0.5, 900, 0.4, group);
      this._burst(t + dur - 0.48, 0.07, 0.18, 'bandpass', 1400, 2600, 2, group);
      this._click(t + dur - 0.34, 1300, 0.45, group);
    } else {
      // 1) şarjör mandalı  2) boş şarjör düşer  3) yeni şarjör oturur  4) sürgü/kurma kolu
      this._click(t + 0.05, 1500, 0.35, group);
      this._thump(t + dur * 0.17, 0.1, 0.3, 150, 55, 'sine', group);
      this._burst(t + dur * 0.17, 0.08, 0.2, 'lowpass', 900, 200, 0.7, group);
      const ins = t + dur * 0.62;
      this._burst(ins - 0.07, 0.07, 0.12, 'bandpass', 1800, 900, 2, group);  // şarjör yuvaya kayar
      this._click(ins, 1000, 0.55, group);
      this._thump(ins, 0.08, 0.35, 190, 70, 'sine', group);
      const bolt = t + dur * 0.86;
      this._burst(bolt, 0.08, 0.2, 'bandpass', 1200, 2800, 2.5, group);        // sürgü geri
      this._click(bolt + 0.1, 1700, 0.5, group);                                // sürgü ileri
    }
    return {
      cancel: () => {
        const n = ctx.currentTime;
        group.gain.cancelScheduledValues(n);
        group.gain.setValueAtTime(0, n);
      }
    };
  }

  // Boş tetik "tık"
  playDryFire() {
    if (this.muted || !this.ctx) return;
    this._click(this.ctx.currentTime, 1200, 0.3);
  }

  // ───────────────────────── Araba motoru ─────────────────────────
  // Sürekli çalan döngü: testere dişi motor tonu (rpm = hız), ateşleme titreşimi,
  // gazda egzoz gürlemesi, hızla artan tekerlek/yol gürültüsü, frende lastik cızırtısı.
  // Oyuncunun sürdüğü araç için her karede updateEngine çağrılır.
  updateEngine(speedRatio, throttle, braking) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this.engine) this.engine = this._buildEngine();
    const e = this.engine;
    const sp = Math.min(1, Math.abs(speedRatio));
    const th = throttle ? 1 : 0;
    const on = this.muted ? 0 : 1;
    // Temel frekans (Hz). UYARI: osilatörler ve ateşleme titreşimi rpm'in TAM katları olmalı (1, 1/2, 1/2);
    // oran tam değilse aralarında 1-3 Hz'lik yavaş vuruntu oluşur ve rölantide ayak sesi gibi "tup, tup" duyulur.
    const rpm = 48 + sp * 85 + th * 12;
    e.osc1.frequency.setTargetAtTime(rpm, now, 0.08);
    e.osc2.frequency.setTargetAtTime(rpm * 0.5, now, 0.08);
    e.fire.frequency.setTargetAtTime(rpm * 0.5, now, 0.08);    // silindir ateşleme titreşimi (osc2 ile faz kilitli)
    e.engFilter.frequency.setTargetAtTime(260 + sp * 700 + th * 450, now, 0.1);
    e.engGain.gain.setTargetAtTime((0.10 + th * 0.07 + sp * 0.04) * on, now, 0.1);
    e.exhaustGain.gain.setTargetAtTime((0.03 + th * 0.10) * on, now, 0.08);
    e.exhaustFilter.frequency.setTargetAtTime(160 + sp * 260 + th * 200, now, 0.1);
    e.wheelGain.gain.setTargetAtTime(Math.pow(sp, 1.3) * 0.16 * on, now, 0.12);
    e.wheelFilter.frequency.setTargetAtTime(380 + sp * 900, now, 0.12);
    const skid = braking && sp > 0.25 ? Math.min(1, sp * 1.2) : 0;
    e.skidGain.gain.setTargetAtTime(skid * 0.12 * on, now, 0.05);
  }

  _buildEngine() {
    const ctx = this.ctx;
    const e = {};
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);

    // Motor gövdesi: iki osilatör → ateşleme tremolosu → alçak geçiren filtre
    e.osc1 = ctx.createOscillator(); e.osc1.type = 'sawtooth';
    e.osc2 = ctx.createOscillator(); e.osc2.type = 'square';
    e.engFilter = ctx.createBiquadFilter(); e.engFilter.type = 'lowpass'; e.engFilter.Q.value = 2;
    e.engGain = ctx.createGain(); e.engGain.gain.value = 0;
    const pulse = ctx.createGain(); pulse.gain.value = 0.65;   // tremolo ortalaması
    e.fire = ctx.createOscillator(); e.fire.type = 'sine';
    const fireDepth = ctx.createGain(); fireDepth.gain.value = 0.2;
    e.fire.connect(fireDepth); fireDepth.connect(pulse.gain);
    e.osc1.connect(pulse); e.osc2.connect(pulse);
    pulse.connect(e.engFilter); e.engFilter.connect(e.engGain); e.engGain.connect(out);

    // Egzoz: alçak frekanslı filtrelenmiş gürültü
    const mk = (type, freq, q) => {
      const s = ctx.createBufferSource(); s.buffer = this._noiseBuffer(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(out);
      return { s, f, g };
    };
    const ex = mk('lowpass', 200, 1);
    const wh = mk('bandpass', 500, 0.9);
    const sk = mk('bandpass', 2300, 5);
    e.exhaustFilter = ex.f; e.exhaustGain = ex.g;
    e.wheelFilter = wh.f; e.wheelGain = wh.g;
    e.skidGain = sk.g;

    const t = ctx.currentTime;
    [e.osc1, e.osc2, e.fire, ex.s, wh.s, sk.s].forEach(n => n.start(t));
    e.sources = [e.osc1, e.osc2, e.fire, ex.s, wh.s, sk.s];
    e.out = out;
    return e;
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    const now = this.ctx.currentTime;
    e.out.gain.cancelScheduledValues(now);
    e.out.gain.setTargetAtTime(0, now, 0.08);
    setTimeout(() => { e.sources.forEach(s => { try { s.stop(); } catch (_) {} }); e.out.disconnect(); }, 500);
  }

  // ───────────────────────── Yüzme ─────────────────────────
  // Suyun içinde sürekli şapırtı: hareket edildikçe yükselir, kulaç ritmiyle dalgalanır.
  updateSwim(moving) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this.swim) this.swim = this._buildSwim();
    const s = this.swim;
    const on = this.muted ? 0 : 1;
    s.gain.gain.setTargetAtTime((moving ? 0.30 : 0.09) * on, now, 0.12);
    s.filter.frequency.setTargetAtTime(moving ? 900 : 500, now, 0.15);
    s.lfo.frequency.setTargetAtTime(moving ? 2.2 : 0.8, now, 0.2);
  }

  _buildSwim() {
    const ctx = this.ctx;
    const s = {};
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(); src.loop = true;
    s.filter = ctx.createBiquadFilter(); s.filter.type = 'bandpass'; s.filter.frequency.value = 500; s.filter.Q.value = 0.8;
    const wobble = ctx.createGain(); wobble.gain.value = 0.7;
    s.lfo = ctx.createOscillator(); s.lfo.type = 'sine'; s.lfo.frequency.value = 0.8;
    const depth = ctx.createGain(); depth.gain.value = 0.3;
    s.lfo.connect(depth); depth.connect(wobble.gain);
    s.gain = ctx.createGain(); s.gain.gain.value = 0;
    src.connect(s.filter); s.filter.connect(wobble); wobble.connect(s.gain); s.gain.connect(ctx.destination);
    const t = ctx.currentTime;
    src.start(t); s.lfo.start(t);
    s.sources = [src, s.lfo];
    return s;
  }

  stopSwim() {
    const s = this.swim;
    if (!s) return;
    this.swim = null;
    const now = this.ctx.currentTime;
    s.gain.gain.cancelScheduledValues(now);
    s.gain.gain.setTargetAtTime(0, now, 0.1);
    setTimeout(() => { s.sources.forEach(n => { try { n.stop(); } catch (_) {} }); s.gain.disconnect(); }, 600);
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

  // Jetpack alevi (kısa tıslama)
  playJet() {
    if (this.muted || !this.ctx) return;
    this.playNoise(0.12, 0.12, 900);
  }

  // Bomba bip sesi (pitch yükseldikçe daha tiz)
  playBeep(pitch = 1) {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880 * pitch, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(now); osc.stop(now + 0.08);
  }

  // Işın kılıcı açılışı: yükselen enerji vızıltısı + kısa elektrik çıtırtısı
  playSaberOn() {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = 'sawtooth'; osc2.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);  osc.frequency.exponentialRampToValueAtTime(330, now + 0.4);
    osc2.frequency.setValueAtTime(73, now); osc2.frequency.exponentialRampToValueAtTime(336, now + 0.4);
    filter.type = 'lowpass'; filter.Q.value = 3;
    filter.frequency.setValueAtTime(250, now); filter.frequency.exponentialRampToValueAtTime(3200, now + 0.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc2.start(now); osc.stop(now + 0.52); osc2.stop(now + 0.52);
    this._burst(now + 0.02, 0.18, 0.16, 'bandpass', 3500, 6000, 3);         // çıtırtı
    this._thump(now, 0.2, 0.25, 90, 45, 'sine');
  }

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
  updateSaberHum(active, motion = 0) {
    if (!this.ctx) return;
    if (!active) { this.stopSaberHum(); return; }
    const now = this.ctx.currentTime;
    if (!this.saberHum) this.saberHum = this._buildSaberHum();
    const h = this.saberHum, m = Math.min(1, motion), on = this.muted ? 0 : 1;
    const pitch = 1 + m * 0.5;
    h.oscs[0].frequency.setTargetAtTime(104 * pitch, now, 0.05);
    h.oscs[1].frequency.setTargetAtTime(108.5 * pitch, now, 0.05);   // ~4.5 Hz vuruntu
    h.oscs[2].frequency.setTargetAtTime(208 * pitch, now, 0.05);
    h.filter.frequency.setTargetAtTime(500 + m * 1500, now, 0.06);
    h.gain.gain.setTargetAtTime((0.05 + m * 0.07) * on, now, 0.06);
  }

  _buildSaberHum() {
    const ctx = this.ctx, h = {};
    h.oscs = ['sawtooth', 'sawtooth', 'square'].map(t => { const o = ctx.createOscillator(); o.type = t; return o; });
    h.filter = ctx.createBiquadFilter(); h.filter.type = 'lowpass'; h.filter.Q.value = 2; h.filter.frequency.value = 500;
    h.gain = ctx.createGain(); h.gain.gain.value = 0;
    h.oscs.forEach(o => o.connect(h.filter));
    h.filter.connect(h.gain); h.gain.connect(ctx.destination);
    const t = ctx.currentTime;
    h.oscs.forEach(o => o.start(t));
    return h;
  }

  stopSaberHum() {
    const h = this.saberHum;
    if (!h) return;
    this.saberHum = null;
    const now = this.ctx.currentTime;
    h.gain.gain.cancelScheduledValues(now);
    h.gain.gain.setTargetAtTime(0, now, 0.05);
    setTimeout(() => { h.oscs.forEach(o => { try { o.stop(); } catch (_) {} }); h.gain.disconnect(); }, 400);
  }

  // ───────────────────────── Minigun motoru ─────────────────────────
  // Namlular dönerken sürekli mekanik vızıltı (hız = perde). spin: 0..1. Çok küçükse kapanır.
  updateMinigun(spin) {
    if (!this.ctx) return;
    if (spin < 0.02) { this.stopMinigun(); return; }
    const now = this.ctx.currentTime;
    if (!this.minigunLoop) this.minigunLoop = this._buildMinigun();
    const m = this.minigunLoop, on = this.muted ? 0 : 1;
    m.whine.frequency.setTargetAtTime(55 + spin * 200, now, 0.05);
    m.gear.frequency.setTargetAtTime(18 + spin * 120, now, 0.05);     // dişli takırtısı
    m.filter.frequency.setTargetAtTime(300 + spin * 1500, now, 0.05);
    m.gain.gain.setTargetAtTime(spin * 0.16 * on, now, 0.05);
  }

  _buildMinigun() {
    const ctx = this.ctx, m = {};
    m.whine = ctx.createOscillator(); m.whine.type = 'sawtooth';
    m.gear = ctx.createOscillator(); m.gear.type = 'square';
    const gearGain = ctx.createGain(); gearGain.gain.value = 0.5;
    m.filter = ctx.createBiquadFilter(); m.filter.type = 'lowpass'; m.filter.Q.value = 1.5;
    m.gain = ctx.createGain(); m.gain.gain.value = 0;
    m.whine.connect(m.filter); m.gear.connect(gearGain); gearGain.connect(m.filter);
    m.filter.connect(m.gain); m.gain.connect(ctx.destination);
    const t = ctx.currentTime;
    m.whine.start(t); m.gear.start(t);
    return m;
  }

  stopMinigun() {
    const m = this.minigunLoop;
    if (!m) return;
    this.minigunLoop = null;
    const now = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(now);
    m.gain.gain.setTargetAtTime(0, now, 0.06);
    setTimeout(() => { try { m.whine.stop(); m.gear.stop(); } catch (_) {} m.gain.disconnect(); }, 500);
  }

  // Suya giriş / su sıçraması
  playSplash() {
    if (this.muted || !this.ctx) return;
    this.playNoise(0.35, 0.3, 1200);
  }

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
}

export const sound = new SoundEngine();
