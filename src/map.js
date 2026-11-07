// ─────────────────────────────────────────────────────────────────────────────
// HARİTA SİSTEMİ (MİNİMAP & GELİŞMİŞ KUŞ BAKIŞI DÜNYA HARİTASI)
//  • Minimap (HUD): Ekranın sağ üstünde 1:1 metrik oranlı, yüksek teknolojili radar.
//  • Kuş Bakışı Büyük Harita [M]: Bütün metropolü, Havalimanı pistini, Merkez Park'ı,
//    Silindir Kuleleri, Boğaz Köprüsünü ve Zengin Villası'nı detaylıca gösterir.
//  • Fare ile sürükleyip gezme (pan) ve fare tekerleğiyle yakınlaşma/uzaklaşma (zoom).
//  • Aktif görev hedefini (Waypoint) parlak altın yıldızla hem minimap'te hem büyük haritada gösterir.
// ─────────────────────────────────────────────────────────────────────────────

export class MapSystem {
  constructor() {
    this.isOpen = false;
    this.playerX = 0;
    this.playerZ = 0;
    this.playerYaw = 0;
    this.pulse = 0;

    // Gerçek dünya sınırları: Batıda Uluslararası Havalimanı (-760m), Doğuda Zengin Villası (520m)
    this.worldBounds = {
      minX: -760,
      maxX: 520,
      minZ: -800,
      maxZ: 800
    };

    // Büyük harita kamera konumu ve yakınlaşması (etkileşimli pan & zoom)
    this.largePan = { x: -120, z: 0 };
    this.largeZoom = 1.0;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.panStart = { x: 0, z: 0 };

    this.activeWaypoint = null;

    this._createDOM();
    this._bindEvents();
  }

  _createDOM() {
    // 1. Küçük Harita (Minimap) Konteyneri
    const minimap = document.createElement('div');
    minimap.id = 'minimap-container';
    minimap.innerHTML = `
      <div class="minimap-header">
        <span>🗺️ GPS RADAR</span>
        <span class="minimap-key">[M]</span>
      </div>
      <div class="minimap-canvas-wrap">
        <canvas id="minimap-canvas" width="340" height="340"></canvas>
        <div class="minimap-compass-n">N</div>
      </div>
      <div class="minimap-hint">Haritayı açmak için tıkla [M] 🔍</div>
    `;
    document.body.appendChild(minimap);

    // 2. Büyük Harita (Full Map Modal)
    const largeModal = document.createElement('div');
    largeModal.id = 'largemap-modal';
    largeModal.className = 'largemap-overlay';
    largeModal.style.display = 'none';
    largeModal.innerHTML = `
      <div class="largemap-window">
        <div class="largemap-top">
          <div class="largemap-title">🗺️ ŞEHİR & METROPOL KUŞ BAKIŞI DÜNYA HARİTASI</div>
          <div class="largemap-controls">
            <button class="largemap-btn" id="lmap-zoom-in" title="Yakınlaş (Mouse Tekerleği)">➕ YAKINLAŞ</button>
            <button class="largemap-btn" id="lmap-zoom-out" title="Uzaklaş">➖ UZAKLAŞ</button>
            <button class="largemap-btn" id="lmap-find-player" title="Oyuncuya Odakla">🎯 BENİ BUL</button>
            <button class="largemap-btn" id="lmap-reset-view" title="Tüm Şehre Odakla">🌐 TÜM ŞEHİR</button>
            <button class="largemap-close" id="largemap-close-btn" title="Kapat (ESC / M)">✖ KAPAT</button>
          </div>
        </div>
        <div class="largemap-canvas-container">
          <canvas id="largemap-canvas" width="1000" height="700"></canvas>
          <div class="largemap-drag-hint">🖱️ Haritayı kaydırmak için sürükleyin • Yakınlaşmak için tekerleği çevirin</div>
        </div>
        <div class="largemap-footer">
          <div class="largemap-location" id="largemap-loc-text">📍 Konum: Şehir Merkezi | X: 0, Z: 0</div>
          <div class="largemap-legend">
            <span><i class="leg-dot" style="background:#a855f7"></i> Havalimanı</span>
            <span><i class="leg-dot" style="background:#475569"></i> Metropol</span>
            <span><i class="leg-dot" style="background:#38bdf8"></i> Silindir Kuleler</span>
            <span><i class="leg-dot" style="background:#94a3b8"></i> Asma Köprü</span>
            <span><i class="leg-dot" style="background:#22c55e"></i> Merkez Park</span>
            <span><i class="leg-dot" style="background:#facc15"></i> Zengin Villası</span>
            <span><i class="leg-dot" style="background:#f43f5e"></i> Büyük AVM</span>
            <span><i class="leg-dot" style="background:#ef4444"></i> Sen (Oyuncu)</span>
            <span><i class="leg-dot" style="background:#fbbf24"></i> ★ Görev Hedefi</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(largeModal);

    // 3. Stiller
    const style = document.createElement('style');
    style.textContent = `
      #minimap-container {
        position: fixed;
        right: 18px;
        top: 135px;
        z-index: 45;
        width: 180px;
        background: rgba(15, 23, 42, 0.90);
        border: 2px solid #38bdf8;
        border-radius: 12px;
        padding: 6px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.75), 0 0 16px rgba(56, 189, 248, 0.3);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.2s ease, opacity 0.3s ease;
        backdrop-filter: blur(8px);
        user-select: none;
      }
      #minimap-container:hover {
        transform: scale(1.04);
        border-color: #60a5fa;
        box-shadow: 0 12px 32px rgba(0,0,0,0.85), 0 0 20px rgba(96, 165, 250, 0.5);
      }
      .minimap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10.5px;
        font-weight: 800;
        color: #38bdf8;
        text-shadow: 1px 1px #000;
        margin-bottom: 5px;
        padding: 0 4px;
        letter-spacing: 0.5px;
      }
      .minimap-key {
        font-size: 9px;
        background: #1e293b;
        color: #f1f5f9;
        padding: 1px 5px;
        border-radius: 4px;
        border: 1px solid #475569;
      }
      .minimap-canvas-wrap {
        position: relative;
        width: 100%;
        height: 165px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #334155;
        background: #0284c7;
        box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
      }
      #minimap-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .minimap-compass-n {
        position: absolute;
        top: 4px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 10px;
        font-weight: 900;
        color: #ef4444;
        background: rgba(15, 23, 42, 0.75);
        padding: 0 4px;
        border-radius: 3px;
        border: 1px solid #ef4444;
        pointer-events: none;
        line-height: 12px;
      }
      .minimap-hint {
        font-size: 9px;
        color: #94a3b8;
        text-align: center;
        margin-top: 5px;
        letter-spacing: 0.3px;
      }

      /* Büyük Harita Overlay */
      .largemap-overlay {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(5, 10, 20, 0.90);
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: fadeInMap 0.2s ease-out;
      }
      @keyframes fadeInMap {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .largemap-window {
        width: 1050px;
        max-width: 96vw;
        height: 740px;
        max-height: 94vh;
        background: #0f172a;
        border: 3px solid #38bdf8;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 24px 60px rgba(0,0,0,0.9), 0 0 35px rgba(56, 189, 248, 0.35);
        overflow: hidden;
      }
      .largemap-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #1e293b;
        border-bottom: 2px solid #334155;
        gap: 10px;
        flex-wrap: wrap;
      }
      .largemap-title {
        font-size: 14px;
        font-weight: 800;
        color: #f8fafc;
        letter-spacing: 0.6px;
        text-shadow: 2px 2px #000;
      }
      .largemap-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .largemap-btn {
        background: #334155;
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.1s;
      }
      .largemap-btn:hover {
        background: #475569;
        border-color: #38bdf8;
        transform: translateY(-1px);
      }
      .largemap-close {
        background: #ef4444;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 5px 14px;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        transition: background 0.15s;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      }
      .largemap-close:hover {
        background: #dc2626;
      }
      .largemap-canvas-container {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: #0284c7;
        cursor: grab;
      }
      .largemap-canvas-container:active {
        cursor: grabbing;
      }
      #largemap-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .largemap-drag-hint {
        position: absolute;
        bottom: 8px;
        left: 12px;
        font-size: 10.5px;
        color: rgba(255,255,255,0.85);
        background: rgba(15,23,42,0.8);
        padding: 3px 8px;
        border-radius: 4px;
        pointer-events: none;
      }
      .largemap-footer {
        padding: 8px 16px;
        background: #1e293b;
        border-top: 2px solid #334155;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 11px;
      }
      #largemap-loc-text {
        color: #38bdf8;
        font-weight: 700;
        text-shadow: 1px 1px #000;
      }
      .largemap-legend {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 10px;
        color: #cbd5e1;
      }
      .largemap-legend span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .leg-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        border: 1px solid #000;
      }
    `;
    document.head.appendChild(style);

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas.getContext('2d');
    this.largeCanvas = document.getElementById('largemap-canvas');
    this.largeCtx = this.largeCanvas.getContext('2d');
    this.largeModal = largeModal;
    this.minimapEl = minimap;
    this.locText = document.getElementById('largemap-loc-text');
  }

  _bindEvents() {
    this.minimapEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMap();
    });

    document.getElementById('largemap-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMap();
    });

    // Kontrol Butonları
    document.getElementById('lmap-zoom-in').addEventListener('click', (e) => {
      e.stopPropagation();
      this.largeZoom = Math.min(3.5, this.largeZoom * 1.35);
      this._drawLarge();
    });

    document.getElementById('lmap-zoom-out').addEventListener('click', (e) => {
      e.stopPropagation();
      this.largeZoom = Math.max(0.65, this.largeZoom / 1.35);
      this._drawLarge();
    });

    document.getElementById('lmap-find-player').addEventListener('click', (e) => {
      e.stopPropagation();
      this.largePan = { x: this.playerX, z: this.playerZ };
      this.largeZoom = 2.0;
      this._drawLarge();
    });

    document.getElementById('lmap-reset-view').addEventListener('click', (e) => {
      e.stopPropagation();
      this.largePan = { x: -120, z: 0 };
      this.largeZoom = 1.0;
      this._drawLarge();
    });

    // Fare tekerleğiyle yakınlaşma
    this.largeCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      this.largeZoom = Math.max(0.65, Math.min(3.5, this.largeZoom * zoomFactor));
      this._drawLarge();
    }, { passive: false });

    // Fareyle haritayı sürükleme (pan)
    this.largeCanvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panStart = { x: this.largePan.x, z: this.largePan.z };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.isOpen) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;

      const baseSpan = Math.max(this.worldBounds.maxX - this.worldBounds.minX, this.worldBounds.maxZ - this.worldBounds.minZ);
      const ppm = (Math.min(this.largeCanvas.width, this.largeCanvas.height) / baseSpan) * this.largeZoom;

      this.largePan.x = this.panStart.x - dx / ppm;
      this.largePan.z = this.panStart.z - dy / ppm;
      this._drawLarge();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Klavye Kısayolları (M ve ESC)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        e.preventDefault();
        this.toggleMap();
      } else if (e.code === 'Escape' && this.isOpen) {
        this.closeMap();
      }
    });
  }

  toggleMap() {
    if (this.isOpen) this.closeMap();
    else this.openMap();
  }

  openMap() {
    this.isOpen = true;
    this.largeModal.style.display = 'flex';
    if (document.exitPointerLock) document.exitPointerLock();
    this._drawLarge();
  }

  closeMap() {
    this.isOpen = false;
    this.largeModal.style.display = 'none';
  }

  // Oyuncunun konumu, rotasyonu ve aktif görev güncellenir
  update(playerPos, cameraYaw, dt = 0.016, storyManager = null) {
    this.playerX = playerPos.x;
    this.playerZ = playerPos.z;
    this.playerYaw = cameraYaw;
    this.pulse = (this.pulse + dt * 4) % (Math.PI * 2);

    // Aktif görev waypoint göstergesi
    if (storyManager && storyManager.waypointMarker && storyManager.waypointMarker.visible) {
      this.activeWaypoint = {
        x: storyManager.waypointMarker.position.x,
        z: storyManager.waypointMarker.position.z,
        title: storyManager.missionTitle || 'GÖREV HEDEFİ'
      };
    } else {
      this.activeWaypoint = null;
    }

    // Sinematik ara sahnelerde minimap'i gizle / karart
    if (storyManager && storyManager.controlsLocked) {
      this.minimapEl.style.opacity = '0';
      this.minimapEl.style.pointerEvents = 'none';
      if (this.isOpen) this.closeMap();
    } else {
      this.minimapEl.style.opacity = '1';
      this.minimapEl.style.pointerEvents = 'auto';
    }

    // Küçük haritayı akıcı 20 FPS ile güncelle (60 FPS oyun performansını korur)
    this.miniTimer = (this.miniTimer || 0) + dt;
    if (this.miniTimer >= 0.05) {
      this.miniTimer = 0;
      this._drawMini();
    }

    if (this.isOpen) {
      this._drawLarge();
    }
  }

  _getLocationName(x, z) {
    if (x <= -530 && z <= -140) return '✈️ Uluslararası Havalimanı (Pist & Apron & Kule)';
    if (Math.abs(x - (-110)) < 24 && Math.abs(z - 20) < 24) return '🏠 Bizim Evimiz & Garajımız';
    if (x >= 262 && x <= 330 && z >= 148 && z <= 258) return '🏫 Şehir Koleji & Okul Kampüsü';
    if (x >= 320 && x <= 366 && z >= 38 && z <= 134) return '🏥 Devasa Şehir Hastanesi (Tıp Merkezi)';
    if (x >= -420 && x <= -10 && Math.abs(z) <= 800) return '🏙️ Büyük Metropol Şehri & Bulvarlar';
    if (x >= 335 && x <= 503 && z >= 14 && z <= 186) return '🌳 Merkez Park (New York Tarzı)';
    if (x >= 370 && x <= 450 && z >= -148 && z <= -48) return '🏰 David Sterling Tepedeki Zengin Villası';
    if (x >= 242 && x <= 270 && z >= -95 && z <= -38) return '🏬 Büyük AVM (Alışveriş Merkezi)';
    if (x >= -10 && x <= 194 && Math.abs(z) < 22) return '🌉 Boğaz Asma Köprüsü';
    if (x >= 194 && x <= 520) return '🏝️ Doğu Adası (Lüks & Sosyal Yaşam)';
    return '🌊 Okyanus / Sahil Şeridi';
  }

  // 1:1 Uniform Metrik Piksel Dönüşümü (Çarpılma, uzama, basılma olmadan tam ölçek)
  _toPixel(x, z, width, height, zoom = 1, center = null) {
    const cx = center ? center.x : (this.worldBounds.minX + this.worldBounds.maxX) / 2;
    const cz = center ? center.z : (this.worldBounds.minZ + this.worldBounds.maxZ) / 2;
    const baseSpan = Math.max(this.worldBounds.maxX - this.worldBounds.minX, this.worldBounds.maxZ - this.worldBounds.minZ);
    const ppm = (Math.min(width, height) / baseSpan) * zoom;

    const px = width / 2 + (x - cx) * ppm;
    const pz = height / 2 + (z - cz) * ppm;
    return [px, pz];
  }

  // ── Küçük Harita Çizimi (Minimap: oyuncu odaklı radar) ──
  _drawMini() {
    try {
      const ctx = this.miniCtx, c = this.miniCanvas;
      if (!ctx || !c) return;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);

      // Oyuncu merkezli yerel görünüm (zoom = 4.2: ~300m çevreyi gösterir)
      this._renderWorldMap(ctx, w, h, 4.2, { x: this.playerX, z: this.playerZ }, true);

      // Radar mesafe halkaları (50m, 100m, 140m)
      const baseSpan = Math.max(this.worldBounds.maxX - this.worldBounds.minX, this.worldBounds.maxZ - this.worldBounds.minZ);
      const ppm = (Math.min(w, h) / baseSpan) * 4.2;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1;
      [50, 100, 140].forEach(r => {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r * ppm, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Radar döner tarama çizgisi efekti
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(this.pulse);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 140 * ppm, 0, 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } catch (e) {
      console.warn('Minimap draw error:', e);
    }
  }

  // ── Büyük Harita Çizimi (Etkileşimli Pan & Zoom) ──
  _drawLarge() {
    try {
      const ctx = this.largeCtx, c = this.largeCanvas;
      if (!ctx || !c) return;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);

      // Bütün metropolü ve dünyayı kapsayan kuş bakışı harita
      this._renderWorldMap(ctx, w, h, this.largeZoom, this.largePan, false);

      // Konum ve Hedef Metnini Güncelle
      const locName = this._getLocationName(this.playerX, this.playerZ);
      let distText = '';
      if (this.activeWaypoint) {
        const d = Math.round(Math.hypot(this.playerX - this.activeWaypoint.x, this.playerZ - this.activeWaypoint.z));
        distText = `  |  ⭐ HEDEF: ${this.activeWaypoint.title} (${d} m)`;
      }
      if (this.locText) {
        this.locText.textContent = `${locName}  |  X: ${Math.round(this.playerX)} m, Z: ${Math.round(this.playerZ)} m${distText}`;
      }
    } catch (e) {
      console.warn('Large map draw error:', e);
    }
  }

  // ── Çekirdek Harita Çizim Motoru ──
  _renderWorldMap(ctx, width, height, zoom, center, isMini) {
    const pt = (x, z) => this._toPixel(x, z, width, height, zoom, center);
    const rect = (x0, z0, x1, z1, fill) => {
      const [p0x, p0z] = pt(x0, z0);
      const [p1x, p1z] = pt(x1, z1);
      ctx.fillStyle = fill;
      ctx.fillRect(Math.min(p0x, p1x), Math.min(p0z, p1z), Math.abs(p1x - p0x), Math.abs(p1z - p0z));
    };

    // 1. Okyanus Arka Planı
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, width, height);

    // Kıyı sığ su parıltısı
    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.fillRect(0, 0, width, height);

    // 2. Batı Şehir Adası (Devasa Metropol & Sahil Kordonu)
    rect(-420, -800, 20, 800, '#334155');  // Metropol taban alanı
    rect(-435, -800, -420, 800, '#fef08a'); // Sahil kumsalı
    rect(-426, -798, -420, 798, '#b45309'); // Ahşap kordon yürüme yolu

    // ══════════════════════════════════════════════════════════
    // 3. ULUSLARARASI HAVALİMANI (Pist, Taksi Yolları, Apron, Terminal, Kule)
    // ══════════════════════════════════════════════════════════
    rect(-745, -675, -530, -170, '#1e293b'); // Havalimanı beton tabanı
    rect(-748, -677, -528, -168, '#475569'); // Havalimanı tel örgü sınırı
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1;
    const [ap0x, ap0z] = pt(-748, -677);
    const [ap1x, ap1z] = pt(-528, -168);
    ctx.strokeRect(Math.min(ap0x, ap1x), Math.min(ap0z, ap1z), Math.abs(ap1x - ap0x), Math.abs(ap1z - ap0z));

    // Uçak Pisti (Runway 09/27: 480 metre uzunluk!)
    rect(-730, -660, -685, -180, '#0f172a'); // Pist asfaltı
    // Pist Eşik Çizgileri
    for (let x = -728; x <= -688; x += 6) {
      rect(x, -655, x + 3, -640, '#ffffff'); // Kuzey eşiği
      rect(x, -200, x + 3, -185, '#ffffff'); // Güney eşiği
    }
    // Pist Kesik Beyaz Orta Çizgisi
    for (let z = -620; z <= -220; z += 35) {
      rect(-709, z, -706, z + 20, '#ffffff');
    }
    // Taksi Yolları & Apron
    rect(-685, -550, -610, -520, '#1e293b');
    rect(-685, -310, -610, -280, '#1e293b');
    rect(-610, -560, -540, -270, '#0f172a'); // Ana Apron
    // Taksi Yolu Sarı Kılavuz Çizgileri
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = Math.max(1, 1.5 * zoom);
    const [tx0, tz0] = pt(-700, -535), [tx1, tz1] = pt(-570, -535);
    ctx.beginPath(); ctx.moveTo(tx0, tz0); ctx.lineTo(tx1, tz1); ctx.stroke();
    const [tx2, tz2] = pt(-700, -295), [tx3, tz3] = pt(-570, -295);
    ctx.beginPath(); ctx.moveTo(tx2, tz2); ctx.lineTo(tx3, tz3); ctx.stroke();

    // Havalimanı Terminal Binası & Kule
    rect(-580, -470, -545, -350, '#38bdf8'); // Büyük cam terminal
    rect(-565, -510, -548, -490, '#f43f5e'); // Havalimanı Kontrol Kulesi (Kırmızı/Beyaz ATC)

    // Apronda Duran Yolcu Uçakları (Jet Silüetleri)
    for (const [jx, jz] of [[-590, -440], [-590, -380]]) {
      const [px, pz] = pt(jx, jz);
      const s = Math.max(3, 7 * zoom);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px, pz - s * 1.5); // Burun
      ctx.lineTo(px + s * 1.6, pz + s * 0.4); // Sağ kanat
      ctx.lineTo(px + s * 0.4, pz + s * 0.4);
      ctx.lineTo(px + s * 0.8, pz + s * 1.2); // Sağ kuyruk
      ctx.lineTo(px, pz + s * 0.9);
      ctx.lineTo(px - s * 0.8, pz + s * 1.2); // Sol kuyruk
      ctx.lineTo(px - s * 0.4, pz + s * 0.4);
      ctx.lineTo(px - s * 1.6, pz + s * 0.4); // Sol kanat
      ctx.closePath();
      ctx.fill();
    }

    // ══════════════════════════════════════════════════════════
    // 4. BATI ŞEHİR CADDELERİ & BULVARLARI (Kusursuz Asfalt Ağı)
    // ══════════════════════════════════════════════════════════
    const roadColor = '#1e293b';
    ctx.fillStyle = roadColor;

    // Kuzey-Güney Ana Bulvarlar (x = -360 .. -10)
    for (const sx of [-360, -310, -260, -210, -170, -130, -90, -50, -10]) {
      const [rx, rz0] = pt(sx - 3.5, -750);
      const [, rz1] = pt(sx + 3.5, 750);
      ctx.fillRect(rx, Math.min(rz0, rz1), Math.abs(pt(sx + 3.5, 0)[0] - rx), Math.abs(rz1 - rz0));
    }

    // Doğu-Batı Bağlantı Caddeleri (z = -750 .. 750)
    for (const cz of [-750, -650, -550, -450, -380, -320, -266, -200, -134, -66, 0, 66, 134, 200, 266, 320, 380, 450, 550, 650, 750]) {
      const [rx0, rz] = pt(-360, cz - 3.5);
      const [rx1,] = pt(-10, cz + 3.5);
      ctx.fillRect(Math.min(rx0, rx1), rz, Math.abs(rx1 - rx0), Math.abs(pt(0, cz + 3.5)[1] - rz));
    }

    // Havalimanı Bağlantı Otoyolu (x = -530 .. -360, z = -450)
    rect(-530, -454, -360, -446, '#1e293b');

    // İki Ana Kavşak Göbeği (z = ±134, x = -90)
    for (const gz of [-134, 134]) {
      const [gx, gy] = pt(-90, gz);
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(4, 16 * zoom), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#16a34a'; // Yeşil ada
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(2, 9 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // ── ŞEHİRDEKİ EVİMİZ & GARAJ ──
    rect(-112.5, 6, -100.5, 30, '#f8fafc'); // Ev tabanı
    rect(-111, 7.5, -102, 28.5, '#b91c1c'); // Ev kiremit çatısı
    rect(-112.5, 34.5, -100.5, 46.5, '#475569'); // Garaj
    rect(-120, 38, -112.5, 43, '#1e293b');       // Garaj çıkış yolu
    // Garaj içindeki mavi sedan araba
    const [cx, cz] = pt(-106.5, 40.5);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(cx - 3, cz - 4, 6, 8);

    // Mahalle Çocuk Parkı
    rect(-72, 76, -54, 102, '#16a34a'); // Çim park
    rect(-68, 80, -58, 92, '#fde047');  // Kum havuzu

    // ══════════════════════════════════════════════════════════
    // 5. ASMA BOĞAZ KÖPRÜSÜ (-9 m .. 193.5 m)
    // ══════════════════════════════════════════════════════════
    const [b0x, b0z] = pt(-9, 0);
    const [b1x, b1z] = pt(193.5, 0);
    const bw = Math.max(4, 9 * zoom);
    ctx.fillStyle = '#334155';
    ctx.fillRect(Math.min(b0x, b1x), b0z - bw / 2, Math.abs(b1x - b0x), bw);
    // Asma Köprü Kuleleri
    ctx.fillStyle = '#f8fafc';
    const [t1x,] = pt(40.5, 0), [t2x,] = pt(144, 0);
    ctx.fillRect(t1x - 3, b0z - bw / 2 - 3, 6, bw + 6);
    ctx.fillRect(t2x - 3, b0z - bw / 2 - 3, 6, bw + 6);
    // Çelik askı halatları (kırmızı/gümüş estetik)
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b0x, b0z);
    ctx.lineTo(t1x, b0z - bw - 4);
    ctx.lineTo((t1x + t2x) / 2, b0z - 2);
    ctx.lineTo(t2x, b0z - bw - 4);
    ctx.lineTo(b1x, b0z);
    ctx.stroke();

    // ══════════════════════════════════════════════════════════
    // 6. DOĞU ADASI (Lüks Şehir, Sağlık, Eğitim, Park & Villa)
    // ══════════════════════════════════════════════════════════
    rect(193.5, -160, 480, 270, '#15803d'); // Doğu adası zümrüt yeşili doğası
    rect(193.5, -140, 290, 140, '#475569'); // Doğu metropol zemini

    // Doğu Ana Otoyolu (Köprü çıkışından kuzeye ve güneye uzanan geniş yol)
    const [ox, oz0] = pt(229 - 10, -150);
    const [, oz1] = pt(229 + 10, 150);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(ox, Math.min(oz0, oz1), Math.abs(pt(229 + 10, 0)[0] - ox), Math.abs(oz1 - oz0));

    // Büyük AVM (Alışveriş Merkezi)
    rect(242, -95, 270, -38, '#f43f5e');

    // Devasa Şehir Hastanesi (Tıp Merkezi)
    rect(320, 38, 366, 134, '#ffffff');
    const [hx, hz] = pt(343, 86);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(hx - 8, hz - 2.5, 16, 5);
    ctx.fillRect(hx - 2.5, hz - 8, 5, 16);

    // Devasa Şehir Okulu & Kampüsü
    rect(262, 148, 328, 258, '#1e293b'); // Okul bahçe duvarı
    rect(268, 156, 294, 206, '#15803d'); // Futbol sahası
    rect(300, 156, 322, 195, '#b45309'); // Basketbol sahası
    rect(270, 212, 320, 252, '#991b1b'); // Ana okul binası

    // ══════════════════════════════════════════════════════════
    // 7. NEW YORK TARZI MERKEZ PARK (Central Park)
    // ══════════════════════════════════════════════════════════
    const [pk0x, pk0z] = pt(335, 14);
    const [pk1x, pk1z] = pt(503, 186);
    const pkw = Math.abs(pk1x - pk0x), pkh = Math.abs(pk1z - pk0z);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(Math.min(pk0x, pk1x), Math.min(pk0z, pk1z), pkw, pkh);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = Math.max(1.5, 2 * zoom);
    ctx.strokeRect(Math.min(pk0x, pk1x), Math.min(pk0z, pk1z), pkw, pkh);

    // Park patikaları
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = Math.max(1.5, 2.5 * zoom);
    const [pp0x, pp0z] = pt(335, 100), [pp1x, pp1z] = pt(503, 100);
    ctx.beginPath(); ctx.moveTo(pp0x, pp0z); ctx.lineTo(pp1x, pp1z); ctx.stroke();
    const [pp2x, pp2z] = pt(419, 14), [pp3x, pp3z] = pt(419, 186);
    ctx.beginPath(); ctx.moveTo(pp2x, pp2z); ctx.lineTo(pp3x, pp3z); ctx.stroke();

    // Çeşme Meydanı
    const [plzX, plzZ] = pt(419, 100);
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath(); ctx.arc(plzX, plzZ, Math.max(3, 11 * zoom), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(plzX, plzZ, Math.max(2, 7 * zoom), 0, Math.PI * 2); ctx.fill();

    // Göl ve İskele
    const [lakeX, lakeZ] = pt(467, 150);
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(lakeX, lakeZ, Math.max(4, 18 * zoom), Math.max(3, 10 * zoom), 0, 0, Math.PI * 2);
    else ctx.arc(lakeX, lakeZ, Math.max(4, 14 * zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b45309';
    ctx.fillRect(lakeX - Math.max(3, 12 * zoom), lakeZ - 2, Math.max(4, 10 * zoom), 4);

    // Buz Pisti
    rect(361, 44, 401, 68, '#bae6fd');
    // Oyun Parkı
    rect(455, 41, 495, 71, '#fef08a');
    // Köpek Parkı
    rect(360, 131, 398, 161, '#bbf7d0');

    // ══════════════════════════════════════════════════════════
    // 8. ZENGİNLER BÖLGESİ & TEPEDEKİ VİLLA PLATOSU (David Sterling)
    // ══════════════════════════════════════════════════════════
    rect(371, -150, 452, -45, '#15803d'); // Dağ tepesi platosu
    // Villa Kavisli Dağ Yolu
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = Math.max(2.5, 4 * zoom);
    ctx.beginPath();
    const [vx0, vz0] = pt(321, 0);
    const [vx1, vz1] = pt(357, 0);
    const [vx2, vz2] = pt(391, -38);
    const [vx3, vz3] = pt(397, -50);
    ctx.moveTo(vx0, vz0); ctx.lineTo(vx1, vz1);
    ctx.quadraticCurveTo(vx2, vz1, vx3, vz3);
    ctx.stroke();

    // Villa Kapısı & İsyancı Bölgesi (Protester Zone)
    const [vgx, vgz] = pt(395, -49.5);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(vgx - 12, vgz - 2, 24, 4);

    // Modern Beyaz Villa & Yüzme Havuzu
    rect(379, -125, 425, -90, '#f8fafc'); // Malikane
    rect(391, -137, 420, -127, '#0ea5e9'); // Işıldayan havuz
    // Helikopter Pisti [ H ]
    const [hx0, hz0] = pt(435, -110);
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx0, hz0, Math.max(3, 8 * zoom), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#facc15'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', hx0, hz0);

    // ══════════════════════════════════════════════════════════
    // 9. SİLİNDİR ŞİRKET KULELERİ (Işıltılı İkonlar)
    // ══════════════════════════════════════════════════════════
    const towers = [
      { name: 'NOVA', x: -111, z: 165, col: '#38bdf8' },
      { name: 'APEX', x: -81, z: 165, col: '#34d399' },
      { name: 'VORTEX', x: -51, z: 165, col: '#c084fc' },
      { name: 'ATLAS', x: -111, z: -165, col: '#fb923c' },
      { name: 'ZENITH', x: -81, z: -165, col: '#facc15' },
      { name: 'CYBER', x: -51, z: -165, col: '#f43f5e' }
    ];
    for (const tw of towers) {
      const [tx, tz] = pt(tw.x, tw.z);
      const r = Math.max(3, 7.5 * zoom);
      ctx.fillStyle = tw.col;
      ctx.beginPath(); ctx.arc(tx, tz, r + 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.arc(tx, tz, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tw.col;
      ctx.beginPath(); ctx.arc(tx, tz, Math.max(1.5, 3 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // ══════════════════════════════════════════════════════════
    // 10. HARİTA ETİKETLERİ & NİRENGİ YAZILARI
    // ══════════════════════════════════════════════════════════
    if (!isMini || zoom > 2.8) {
      ctx.font = `bold ${Math.max(9, Math.round(11 * zoom))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      const drawLabel = (text, wx, wz, col = '#ffffff', bg = 'rgba(15,23,42,0.88)') => {
        const [lx, lz] = pt(wx, wz);
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = bg;
        ctx.fillRect(lx - tw / 2 - 4, lz - 8, tw + 8, 16);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.strokeRect(lx - tw / 2 - 4, lz - 8, tw + 8, 16);
        ctx.fillStyle = col;
        ctx.fillText(text, lx, lz);
      };

      drawLabel('✈️ ULUSLARARASI HAVALİMANI', -640, -420, '#c084fc');
      drawLabel('🏠 BİZİM EVİMİZ & GARAJ', -110, 20, '#38bdf8');
      drawLabel('🏙️ METROPOL ŞEHİR MERKEZİ', -180, 0, '#38bdf8');
      drawLabel('🍔 RESTORANLAR & KEBAPÇI', -110, -180, '#f97316');
      drawLabel('💻 TEKNO MARKET', -30, 30, '#38bdf8');
      drawLabel('🏫 ŞEHİR OKULU & KOLEJ', 295, 205, '#facc15');
      drawLabel('🏥 TIP MERKEZİ & HASTANE', 343, 86, '#38bdf8');
      drawLabel('🌳 MERKEZ PARK', 419, 100, '#4ade80');
      drawLabel('🏰 DAVID STERLING VİLLASI', 400, -100, '#fde047');
      drawLabel('🏬 BÜYÜK AVM', 256, -66, '#fb7185');
      drawLabel('🏢 SİLİNDİR KULELER', -81, 165, '#38bdf8');
      drawLabel('🌉 ASMA BOĞAZ KÖPRÜSÜ', 92, 0, '#94a3b8');
      if (!isMini) {
        drawLabel('🏖️ BATI SAHİL KORDONU', -390, 0, '#fef08a');
      }
    }

    // ══════════════════════════════════════════════════════════
    // 11. AKTİF GÖREV HEDEFİ GÖSTERGESİ (Waypoint Icon)
    // ══════════════════════════════════════════════════════════
    if (this.activeWaypoint) {
      const [wx, wz] = pt(this.activeWaypoint.x, this.activeWaypoint.z);
      const wpR = Math.max(6, 11 * zoom) + Math.sin(this.pulse * 1.5) * 3;

      // Dış sarı yanıp sönen radar halkası
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(wx, wz, wpR + 5, 0, Math.PI * 2); ctx.stroke();

      // Altın parlak elmas / yıldız ikonu
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(wx, wz - wpR);
      ctx.lineTo(wx + wpR, wz);
      ctx.lineTo(wx, wz + wpR);
      ctx.lineTo(wx - wpR, wz);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();

      // İkon içi yıldız işareti
      ctx.fillStyle = '#000000'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★', wx, wz);

      // Hedef Başlığı
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 9px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('HEDEF', wx, wz + wpR + 4);
    }

    // ══════════════════════════════════════════════════════════
    // 12. OYUNCU İKONU (RADAR & DÖNEN YÖN OKU)
    // ══════════════════════════════════════════════════════════
    const [px, pz] = pt(this.playerX, this.playerZ);

    // Yanıp sönen radar halkası
    const ringR = Math.max(6, 12 * zoom) + Math.sin(this.pulse) * 4;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, pz, Math.max(3, ringR), 0, Math.PI * 2); ctx.stroke();

    // Dönen yön oku (Oyuncunun baktığı yön)
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.playerYaw + Math.PI); // Three.js cameraYaw yön dönüşümü

    const arrowSize = Math.max(7, 11 * zoom);
    ctx.fillStyle = '#ef4444'; // Parlak kırmızı ok
    ctx.strokeStyle = '#ffffff'; // Keskin beyaz kontur
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize * 1.5); // Uç
    ctx.lineTo(arrowSize * 0.9, arrowSize);
    ctx.lineTo(0, arrowSize * 0.4); // Girinti
    ctx.lineTo(-arrowSize * 0.9, arrowSize);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Merkez parıltı noktası
    ctx.fillStyle = '#ffff55';
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // "SEN" etiketi
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('SEN', px, pz + arrowSize + 4);
  }
}
