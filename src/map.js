// ─────────────────────────────────────────────────────────────────────────────
// HARİTA SİSTEMİ (MİNİMAP & BÜYÜYEN DÜNYA HARİTASI)
//  • Küçük harita (Minimap): Ekranın sağ üstünde kompakt, şık retro-modern çerçeve.
//  • Üzerine tıklanınca (veya M tuşuna basılınca) ekranın ortasında BÜYÜK DÜNYA HARİTASI açılır.
//  • Bütün 10 kat haritayı, New York tarzı Merkez Park'ı, Silindir Şirket Kulelerini,
//    Villayı, AVM'yi, Köprüyü ve oyuncunun anlık konum/yönünü gösterir.
// ─────────────────────────────────────────────────────────────────────────────

export class MapSystem {
  constructor() {
    this.isOpen = false;
    this.playerX = 0;
    this.playerZ = 0;
    this.playerYaw = 0;
    this.pulse = 0;

    // Dünya sınırları (5 kat genişletilmiş harita alanı): metre cinsinden
    this.worldBounds = {
      minX: -2600,
      maxX: 3600,
      minZ: -3400,
      maxZ: 3400
    };

    this._createDOM();
    this._bindEvents();
  }

  _createDOM() {
    // 1. Küçük Harita (Minimap) Konteyneri
    const minimap = document.createElement('div');
    minimap.id = 'minimap-container';
    minimap.innerHTML = `
      <div class="minimap-header">
        <span>🗺️ HARİTA</span>
        <span class="minimap-key">[M]</span>
      </div>
      <div class="minimap-canvas-wrap">
        <canvas id="minimap-canvas" width="340" height="340"></canvas>
      </div>
      <div class="minimap-hint">Büyütmek için tıkla 🔍</div>
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
          <div class="largemap-title">🗺️ BÜYÜK DÜNYA HARİTASI (10X HARİTA)</div>
          <button class="largemap-close" id="largemap-close-btn" title="Kapat (ESC / M)">✖ KAPAT</button>
        </div>
        <div class="largemap-canvas-container">
          <canvas id="largemap-canvas" width="1000" height="700"></canvas>
        </div>
        <div class="largemap-footer">
          <div class="largemap-location" id="largemap-loc-text">📍 Konum: Şehir Merkezi | X: 0, Z: 0</div>
          <div class="largemap-legend">
            <span><i class="leg-dot" style="background:#22c55e"></i> Merkez Park (New York)</span>
            <span><i class="leg-dot" style="background:#38bdf8"></i> Silindir Kuleler</span>
            <span><i class="leg-dot" style="background:#eab308"></i> Zengin Villası</span>
            <span><i class="leg-dot" style="background:#f43f5e"></i> Büyük AVM</span>
            <span><i class="leg-dot" style="background:#64748b"></i> Asma Köprü</span>
            <span><i class="leg-dot" style="background:#ef4444"></i> Sen (Oyuncu)</span>
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
        width: 175px;
        background: rgba(22, 27, 34, 0.88);
        border: 3px solid #4a5568;
        border-radius: 8px;
        padding: 6px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.65), 0 0 10px rgba(56, 189, 248, 0.2);
        cursor: pointer;
        transition: transform 0.18s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        backdrop-filter: blur(6px);
        user-select: none;
      }
      #minimap-container:hover {
        transform: scale(1.04);
        border-color: #38bdf8;
        box-shadow: 0 10px 28px rgba(0,0,0,0.8), 0 0 16px rgba(56, 189, 248, 0.5);
      }
      .minimap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        font-weight: 700;
        color: #38bdf8;
        text-shadow: 1px 1px #000;
        margin-bottom: 4px;
        padding: 0 2px;
      }
      .minimap-key {
        font-size: 9px;
        background: #1e293b;
        color: #f1f5f9;
        padding: 1px 4px;
        border-radius: 3px;
        border: 1px solid #64748b;
      }
      .minimap-canvas-wrap {
        width: 100%;
        height: 155px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid #334155;
        background: #0284c7;
      }
      #minimap-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .minimap-hint {
        font-size: 8.5px;
        color: #94a3b8;
        text-align: center;
        margin-top: 4px;
        letter-spacing: 0.3px;
      }

      /* Büyük Harita Overlay */
      .largemap-overlay {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: rgba(5, 10, 20, 0.88);
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        animation: fadeInMap 0.2s ease-out;
      }
      @keyframes fadeInMap {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
      .largemap-window {
        width: 950px;
        max-width: 95vw;
        height: 720px;
        max-height: 92vh;
        background: #0f172a;
        border: 4px solid #38bdf8;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 50px rgba(0,0,0,0.85), 0 0 30px rgba(56, 189, 248, 0.35);
        overflow: hidden;
      }
      .largemap-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 18px;
        background: #1e293b;
        border-bottom: 2px solid #334155;
      }
      .largemap-title {
        font-size: 15px;
        font-weight: 800;
        color: #f8fafc;
        letter-spacing: 0.6px;
        text-shadow: 2px 2px #000;
      }
      .largemap-close {
        background: #ef4444;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 11px;
        font-weight: 700;
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
        background: #0369a1;
      }
      #largemap-canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .largemap-footer {
        padding: 10px 18px;
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
        gap: 12px;
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

    // M tuşu veya ESC
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
  }

  closeMap() {
    this.isOpen = false;
    this.largeModal.style.display = 'none';
  }

  // Oyuncunun konumu ve rotasyonu güncellenir
  update(playerPos, cameraYaw, dt = 0.016) {
    this.playerX = playerPos.x;
    this.playerZ = playerPos.z;
    this.playerYaw = cameraYaw;
    this.pulse = (this.pulse + dt * 4) % (Math.PI * 2);

    // Her karede küçük harita çizilir
    this._drawMini();

    // Büyük harita açıksa o da güncellenir
    if (this.isOpen) {
      this._drawLarge();
    }
  }

  _getLocationName(x, z) {
    if (Math.abs(x - (-110)) < 24 && Math.abs(z - 20) < 24) return '🏠 Bizim Evimiz & Garajımız';
    if (x < -165 && Math.abs(z) < 8) return '🛣️ Çöl Ana Otoyolu';
    if (x < -165 && (Math.abs(z - (-345)) < 12 || Math.abs(z - 345) < 12)) return '🛣️ Çöl Çevre Yolu';
    if (x < -165) return '🏜️ Uçsuz Bucaksız Büyük Çöl';
    if (x >= -165 && x <= 20 && Math.abs(z) <= 500) return '🏙️ Dubai Mega Şehri';
    if (x >= 250 && x <= 450 && z >= 20 && z <= 260) return '🌳 Merkez Park (New York Tarzı)';
    if (x >= 300 && x <= 440 && z >= -148 && z <= -48) return '🏰 Villa 1: Hilltop Mansion';
    if (x >= 300 && x <= 440 && z >= -340 && z <= -260) return '🏰 Villa 2: Glass Cliff Palace';
    if (x >= 300 && x <= 440 && z >= 260 && z <= 340) return '🏰 Villa 3: Lakefront Estate';
    if (x >= 380 && x <= 450 && z >= -170 && z <= -90) return '🏰 Villa 4: Mountain Palace';
    if (x >= 242 && x <= 270 && z >= -95 && z <= -38) return '🏬 Büyük AVM (Alışveriş Merkezi)';
    if (x >= 246 && x <= 270 && z >= 38 && z <= 88) return '🏥 Merkez Şehir Hastanesi';
    if (x >= -10 && x <= 194 && Math.abs(z) < 18) return '🌉 Boğaz Asma Köprüsü';
    if (x >= 194 && x <= 500) return '🏰 Zengin Şehri (25X Lüks Ada)';
    return '🌊 Okyanus / Sahil Şeridi';
  }

  // Koordinatları canvas pikseline dönüştür
  _toPixel(x, z, width, height, zoom = 1, center = null) {
    const cx = center ? center.x : (this.worldBounds.minX + this.worldBounds.maxX) / 2;
    const cz = center ? center.z : (this.worldBounds.minZ + this.worldBounds.maxZ) / 2;
    const spanX = (this.worldBounds.maxX - this.worldBounds.minX) / zoom;
    const spanZ = (this.worldBounds.maxZ - this.worldBounds.minZ) / zoom;

    const px = ((x - cx) / spanX + 0.5) * width;
    const pz = ((z - cz) / spanZ + 0.5) * height;
    return [px, pz];
  }

  // ── Küçük Harita Çizimi (Minimap: oyuncu odaklı) ──
  _drawMini() {
    try {
      const ctx = this.miniCtx, c = this.miniCanvas;
      if (!ctx || !c) return;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);

      // Oyuncu merkezli yerel görünüm (zoom = 3.6)
      this._renderWorldMap(ctx, w, h, 3.6, { x: this.playerX, z: this.playerZ }, true);
    } catch (e) {
      console.warn('Minimap draw error:', e);
    }
  }

  // ── Büyük Harita Çizimi (Bütün 10X Harita) ──
  _drawLarge() {
    try {
      const ctx = this.largeCtx, c = this.largeCanvas;
      if (!ctx || !c) return;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);

      // Bütün dünyayı kapsayan genel görünüm (zoom = 1.0)
      this._renderWorldMap(ctx, w, h, 1.0, { x: -80, z: 0 }, false);

      // Konum metnini güncelle
      const locName = this._getLocationName(this.playerX, this.playerZ);
      if (this.locText) {
        this.locText.textContent = `${locName}  |  X: ${Math.round(this.playerX)} m, Z: ${Math.round(this.playerZ)} m`;
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

    // 1. Okyanus Suyu Arka Planı
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, width, height);

    // Kıyı sığ su gradyanı / dalgaları
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(0, 0, width, height);

    // 2. DEVASA UÇSUZ BUCAKSIZ ÇÖL (Şehrin arkasında)
    rect(-1450, -640, -165, 640, '#eab308'); // altın sarısı devasa çöl kumu
    // Çöl engebeleri / dalgalı kum hatları
    ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = Math.max(1, 1.5 * zoom);
    for (let dy = -600; dy <= 600; dy += 45) {
      if (Math.abs(dy) < 18) continue;
      const [d0x, d0z] = pt(-1400, dy), [d1x, d1z] = pt(-175, dy + 20);
      ctx.beginPath(); ctx.moveTo(d0x, d0z); ctx.quadraticCurveTo((d0x + d1x) / 2, d0z + 10, d1x, d1z); ctx.stroke();
    }

    // ── KESİNTİSİZ ÇÖL ÇEVRE OTOYOLU (Dairesel Kapalı Yol Ağı: Hiçbir Yol Sonlu Değil!) ──
    rect(-900, -4, -155, 4, '#1e293b');         // Çöl ana yolu (orta)
    rect(-900, -349, -155, -341, '#1e293b');    // Kuzey çöl çevre yolu
    rect(-900, 341, -155, 349, '#1e293b');      // Güney çöl çevre yolu
    rect(-904, -349, -896, 349, '#1e293b');     // Batı çöl dönüş bağlantı yolu
    // Yol sarı kesik orta çizgisi
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = Math.max(1, 1.2 * zoom);
    const [ry0x, ry0z] = pt(-895, 0), [ry1x, ry1z] = pt(-155, 0);
    ctx.beginPath(); ctx.moveTo(ry0x, ry0z); ctx.lineTo(ry1x, ry1z); ctx.stroke();

    // ── ŞEHİRDEKİ EVİMİZ & GARAJ (ESKİSİ GİBİ ŞEHİRDE!) ──
    // Evimiz (x: -112.5m .. -100.5m, z: 6m .. 30m)
    rect(-112.5, 6, -100.5, 30, '#f8fafc'); // ev tabanı
    rect(-111, 7.5, -102, 28.5, '#b91c1c'); // ev çatısı
    // Yanındaki Garaj (x: -112.5m .. -100.5m, z: 34.5m .. 46.5m)
    rect(-112.5, 34.5, -100.5, 46.5, '#475569'); // garaj tabanı
    rect(-120, 38, -112.5, 43, '#1e293b');       // garajdan caddeye çıkış yolu
    // Garaj içindeki normal araba (mavi sedan)
    const [cx, cz] = pt(-106.5, 40.5);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(cx - 3, cz - 4, 6, 8);

    // ── ÇÖLDEKİ KAKTÜSLER (Yeşil ve Mor noktalar) ──
    for (let cidx = 0; cidx < 60; cidx++) {
      const cwx = -1350 + (cidx * 37) % 1150;
      const cwz = -580 + (cidx * 73) % 1160;
      if (Math.abs(cwz) < 20) continue;
      const [kax, kaz] = pt(cwx, cwz);
      ctx.fillStyle = cidx % 4 === 0 ? '#a855f7' : '#16a34a'; // %25 mor, %75 yeşil
      ctx.beginPath(); ctx.arc(kax, kaz, Math.max(1.5, 2.5 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // 3. 10 KAT BÜYÜTÜLMÜŞ DUBAİ MEGA ŞEHRİ
    rect(-165, -490, 75, 490, '#475569'); // devasa şehir tabanı
    rect(-175, -490, -165, 490, '#fde047'); // sahil kumsalı
    rect(-168, -488, -166, 488, '#92400e'); // ahşap sahil yolu
    rect(-168, -238, -166, 238, '#92400e'); // ahşap sahil yolu

    // Batı caddeleri & yolları
    const roadColor = '#1e293b';
    ctx.fillStyle = roadColor;
    // Kuzey-güney sokaklar
    for (const sx of [-128, -95, -65, -35, -20]) {
      const [rx, rz0] = pt(sx - 3, -215);
      const [, rz1] = pt(sx + 3, 215);
      ctx.fillRect(rx, Math.min(rz0, rz1), Math.abs(pt(sx + 3, 0)[0] - rx), Math.abs(rz1 - rz0));
    }
    // Doğu-batı caddeler
    for (const cz of [-200, -150, -100, -50, 0, 50, 100, 150, 200]) {
      const [rx0, rz] = pt(-145, cz - 3.5);
      const [rx1,] = pt(-9, cz + 3.5);
      ctx.fillRect(Math.min(rx0, rx1), rz, Math.abs(rx1 - rx0), Math.abs(pt(0, cz + 3.5)[1] - rz));
    }
    // İki Göbek (Kavşak Adaları)
    for (const gz of [-150, 150]) {
      const [gx, gy] = pt(-65, gz);
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(4, 16 * zoom), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#16a34a'; // orta ada çimi
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(2, 9 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // 4. Asma Köprü (İki adayı bağlayan 3x uzun ikonik hat: -9 m .. 193.5 m)
    const [b0x, b0z] = pt(-9, 0);
    const [b1x, b1z] = pt(193.5, 0);
    const bw = Math.max(3, 8 * zoom);
    ctx.fillStyle = '#475569';
    ctx.fillRect(Math.min(b0x, b1x), b0z - bw / 2, Math.abs(b1x - b0x), bw);
    // Köprü kuleleri
    ctx.fillStyle = '#f8fafc';
    const [t1x,] = pt(40.5, 0), [t2x,] = pt(144, 0);
    ctx.fillRect(t1x - 3, b0z - bw / 2 - 2, 6, bw + 4);
    ctx.fillRect(t2x - 3, b0z - bw / 2 - 2, 6, bw + 4);

    // 5. Doğu Şehir Adası & Bloklar (+135 m doğuya kaydırıldı)
    rect(193.5, -125, 277, 125, '#475569'); // doğu ada zemin betonu
    rect(193.5, -125, 320, 125, '#15803d'); // doğu yeşil alan
    // Otoyol (kuzey-güney geniş yol)
    const [ox, oz0] = pt(229 - 10, -100);
    const [, oz1] = pt(229 + 10, 100);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(ox, Math.min(oz0, oz1), Math.abs(pt(229 + 10, 0)[0] - ox), Math.abs(oz1 - oz0));

    // AVM (Alışveriş Merkezi)
    rect(242, -95, 270, -38, '#f43f5e'); // pembe/kırmızı büyük AVM binası
    // Hastane
    rect(246, 38, 270, 88, '#ffffff'); // beyaz hastane
    // Kırmızı artı
    const [hx, hz] = pt(258, 63);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(hx - 4, hz - 1.5, 8, 3);
    ctx.fillRect(hx - 1.5, hz - 4, 3, 8);

    // 6. Zenginler Bölgesi & Villa Platosu
    rect(277, -52, 321, 52, '#94a3b8'); // zengin yaya meydanı
    // Tepe Platosu (12 m)
    rect(371, -148, 449, -48, '#15803d');
    // Villa Kavisli Yolu
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = Math.max(2, 4 * zoom);
    ctx.beginPath();
    const [vx0, vz0] = pt(321, 0);
    const [vx1, vz1] = pt(357, 0);
    const [vx2, vz2] = pt(391, -38);
    const [vx3, vz3] = pt(397, -50);
    ctx.moveTo(vx0, vz0); ctx.lineTo(vx1, vz1);
    ctx.quadraticCurveTo(vx2, vz1, vx3, vz3);
    ctx.stroke();
    // Villa Binası & Havuz
    rect(379, -123, 425, -90, '#f8fafc'); // lüks villa
    rect(391, -135, 420, -125, '#0ea5e9'); // parıldayan havuz

    // ══════════════════════════════════════════════════════════
    // 7. NEW YORK TARZI MERKEZ PARK (Central Park esintili)
    // ══════════════════════════════════════════════════════════
    // Park Alanı: 335..503 x, 14..186 z
    const [pk0x, pk0z] = pt(335, 14);
    const [pk1x, pk1z] = pt(503, 186);
    const pkw = Math.abs(pk1x - pk0x), pkh = Math.abs(pk1z - pk0z);

    // Park çim zemini (canlı New York Central Park yeşili)
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(Math.min(pk0x, pk1x), Math.min(pk0z, pk1z), pkw, pkh);

    // Park çevre çitleri (koyu demir kontur)
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = Math.max(1.5, 2.5 * zoom);
    ctx.strokeRect(Math.min(pk0x, pk1x), Math.min(pk0z, pk1z), pkw, pkh);

    // Park içi ana patikalar (açık kum rengi)
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = Math.max(1.5, 3 * zoom);
    // Doğu-Batı ana patika
    const [pp0x, pp0z] = pt(335, 100), [pp1x, pp1z] = pt(503, 100);
    ctx.beginPath(); ctx.moveTo(pp0x, pp0z); ctx.lineTo(pp1x, pp1z); ctx.stroke();
    // Kuzey-Güney ana patika
    const [pp2x, pp2z] = pt(419, 14), [pp3x, pp3z] = pt(419, 186);
    ctx.beginPath(); ctx.moveTo(pp2x, pp2z); ctx.lineTo(pp3x, pp3z); ctx.stroke();

    // Çeşme Meydanı (Taş Plaza + Su Havuzu)
    const [plzX, plzZ] = pt(419, 100);
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath(); ctx.arc(plzX, plzZ, Math.max(3, 13 * zoom), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8'; // fıskiye havuzu
    ctx.beginPath(); ctx.arc(plzX, plzZ, Math.max(2, 8 * zoom), 0, Math.PI * 2); ctx.fill();

    // Göl ve İskele (Doğu-Güney)
    const [lakeX, lakeZ] = pt(467, 150);
    if (ctx.ellipse) ctx.ellipse(lakeX, lakeZ, Math.max(4, 20 * zoom), Math.max(3, 12 * zoom), 0, 0, Math.PI * 2);
    else ctx.arc(lakeX, lakeZ, Math.max(4, 16 * zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b45309'; // iskele
    ctx.fillRect(lakeX - Math.max(3, 15 * zoom), lakeZ - 2, Math.max(4, 12 * zoom), 4);

    // Buz Pisti (Açık mavi)
    const [rinkX0, rinkZ0] = pt(361, 44), [rinkX1, rinkZ1] = pt(401, 68);
    ctx.fillStyle = '#bae6fd';
    ctx.fillRect(Math.min(rinkX0, rinkX1), Math.min(rinkZ0, rinkZ1), Math.abs(rinkX1 - rinkX0), Math.abs(rinkZ1 - rinkZ0));
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.min(rinkX0, rinkX1), Math.min(rinkZ0, rinkZ1), Math.abs(rinkX1 - rinkX0), Math.abs(rinkZ1 - rinkZ0));

    // Çocuk Oyun Parkı (Renkli kum alanı)
    const [playX0, playZ0] = pt(455, 41), [playX1, playZ1] = pt(495, 71);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(Math.min(playX0, playX1), Math.min(playZ0, playZ1), Math.abs(playX1 - playX0), Math.abs(playZ1 - playZ0));
    // Salıncak & Kaydırak sembolleri
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(Math.min(playX0, playX1) + 4, Math.min(playZ0, playZ1) + 4, 6, 6);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(Math.max(playX0, playX1) - 10, Math.min(playZ0, playZ1) + 4, 6, 6);

    // Köpek Parkı (Çitli alan)
    const [dpX0, dpZ0] = pt(360, 131), [dpX1, dpZ1] = pt(398, 161);
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(Math.min(dpX0, dpX1), Math.min(dpZ0, dpZ1), Math.abs(dpX1 - dpX0), Math.abs(dpZ1 - dpZ0));
    ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.min(dpX0, dpX1), Math.min(dpZ0, dpZ1), Math.abs(dpX1 - dpX0), Math.abs(dpZ1 - dpZ0));

    // Park İçi Ağaç Grupları (koyu yeşil noktalar)
    ctx.fillStyle = '#14532d';
    for (const [tx, tz] of [
      [355, 25], [375, 25], [395, 25], [435, 25], [465, 25], [485, 25],
      [355, 175], [375, 175], [395, 175], [425, 175], [455, 175], [485, 175],
      [347, 60], [347, 100], [347, 140], [493, 100], [493, 130],
      [400, 80], [440, 80], [400, 120], [440, 120]
    ]) {
      const [ax, az] = pt(tx, tz);
      ctx.beginPath(); ctx.arc(ax, az, Math.max(1.5, 3 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // ══════════════════════════════════════════════════════════
    // 8. SİLİNDİR ŞİRKET BİNALARI (Kule İkonları)
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
      const r = Math.max(3, 8 * zoom);
      // Dış parlama
      ctx.fillStyle = tw.col;
      ctx.beginPath(); ctx.arc(tx, tz, r + 2, 0, Math.PI * 2); ctx.fill();
      // Silindir gövde
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.arc(tx, tz, r, 0, Math.PI * 2); ctx.fill();
      // İç neon taç
      ctx.fillStyle = tw.col;
      ctx.beginPath(); ctx.arc(tx, tz, Math.max(1.5, 3.5 * zoom), 0, Math.PI * 2); ctx.fill();
    }

    // ══════════════════════════════════════════════════════════
    // 9. ETİKETLER (Büyük Harita veya yakın planda)
    // ══════════════════════════════════════════════════════════
    if (!isMini || zoom > 2.5) {
      ctx.font = `bold ${Math.max(9, Math.round(11 * zoom))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      const drawLabel = (text, wx, wz, col = '#ffffff', bg = 'rgba(15,23,42,0.85)') => {
        const [lx, lz] = pt(wx, wz);
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = bg;
        ctx.fillRect(lx - tw / 2 - 4, lz - 8, tw + 8, 16);
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.strokeRect(lx - tw / 2 - 4, lz - 8, tw + 8, 16);
        ctx.fillStyle = col;
        ctx.fillText(text, lx, lz);
      };

      drawLabel('🏠 BİZİM EVİMİZ & GARAJ', -110, 20, '#38bdf8');
      drawLabel('🏜️ BÜYÜK ÇÖL', -550, -150, '#facc15');
      drawLabel('🌵 KAKTÜSLER', -350, -100, '#4ade80');
      drawLabel('🛣️ ÇÖL ÇEVRE YOLU', -650, 0, '#38bdf8');
      drawLabel('🏙️ DUBAİ MEGA ŞEHRİ', -45, 0, '#38bdf8');
      drawLabel('🌳 MERKEZ PARK', 320, 100, '#4ade80');
      drawLabel('🏰 4 LÜKS VİLLA & SARAYLAR', 380, -100, '#fde047');
      drawLabel('🏬 AVM', 256, -66, '#fb7185');
      drawLabel('🏢 SİLİNDİR KULELER', -81, 165, '#38bdf8');
      drawLabel('🏢 ŞİRKETLER', -81, -165, '#fb923c');
      drawLabel('🌉 ASMA KÖPRÜ', 92, 0, '#94a3b8');
      if (!isMini) {
        drawLabel('🏖️ BATI SAHİLİ', -150, 0, '#fef08a');
        drawLabel('🏥 HASTANE', 258, 63, '#38bdf8');
      }
    }

    // ══════════════════════════════════════════════════════════
    // 10. OYUNCU İKONU (RADAR & DÖNEN YÖN OKU)
    // ══════════════════════════════════════════════════════════
    const [px, pz] = pt(this.playerX, this.playerZ);

    // Yanıp sönen radar halkası
    const ringR = Math.max(6, 12 * zoom) + Math.sin(this.pulse) * 4;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, pz, Math.max(3, ringR), 0, Math.PI * 2); ctx.stroke();

    // Dönen yön oku (Oyuncunun baktığı yön)
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.playerYaw + Math.PI); // Three.js cameraYaw yön dönüşümü

    // Ok çizimi
    const arrowSize = Math.max(6, 10 * zoom);
    ctx.fillStyle = '#ef4444'; // parlak kırmızı gövde
    ctx.strokeStyle = '#ffffff'; // beyaz keskin kontur
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize * 1.5); // uç
    ctx.lineTo(arrowSize * 0.9, arrowSize);
    ctx.lineTo(0, arrowSize * 0.4); // girinti
    ctx.lineTo(-arrowSize * 0.9, arrowSize);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Merkez parıltı noktası
    ctx.fillStyle = '#ffff55';
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // "SEN" etiketi (küçük harita ve büyük haritada belirgin)
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('SEN', px, pz + arrowSize + 4);
  }
}
