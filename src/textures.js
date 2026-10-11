import * as THREE from 'three';

// Minecraft Tarzı 16x16 Piksel Doku Üreteci (Procedural Voxel Textures)
// NearestFilter sayesinde pikseller pürüzsüz değil, tıpkı Minecraft gibi keskin görünür!

function createPixelTexture(drawFn) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  drawFn(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

// 1. Taş (Stone) Dokusu
export function getStoneTexture() {
  return createPixelTexture((ctx, size) => {
    const colors = ['#757575', '#686868', '#828282', '#5e5e5e'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

// 2. Kırık Taş (Cobblestone) Dokusu
export function getCobblestoneTexture() {
  return createPixelTexture((ctx, size) => {
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(0, 0, size, size);

    // Taş hatları
    const dark = '#4a4a4a';
    const light = '#8c8c8c';
    const mid = '#5a5a5a';

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const r = Math.random();
        if ((x + y * 2) % 4 === 0) ctx.fillStyle = dark;
        else if (r > 0.6) ctx.fillStyle = light;
        else if (r > 0.3) ctx.fillStyle = mid;
        else ctx.fillStyle = '#6e6e6e';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

// 3. Meşe Tahta (Wood Planks) Dokusu
export function getWoodPlankTexture() {
  return createPixelTexture((ctx, size) => {
    const base = ['#9e7447', '#ad8051', '#8c663d'];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = base[Math.floor(Math.random() * base.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Tahta çizgileri
    ctx.fillStyle = '#5c4126';
    ctx.fillRect(0, 3, size, 1);
    ctx.fillRect(0, 7, size, 1);
    ctx.fillRect(0, 11, size, 1);
    ctx.fillRect(0, 15, size, 1);
    // Dikey birleşimler
    ctx.fillRect(5, 0, 1, 4);
    ctx.fillRect(11, 4, 1, 4);
    ctx.fillRect(3, 8, 1, 4);
    ctx.fillRect(9, 12, 1, 4);
  });
}

// 4. Tuğla (Bricks) Dokusu
export function getBrickTexture() {
  return createPixelTexture((ctx, size) => {
    ctx.fillStyle = '#9b3d2b';
    ctx.fillRect(0, 0, size, size);

    const brickColors = ['#9b3d2b', '#aa4330', '#883323'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = brickColors[Math.floor(Math.random() * brickColors.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Harç çizgileri
    ctx.fillStyle = '#b7a99a';
    ctx.fillRect(0, 3, size, 1);
    ctx.fillRect(0, 7, size, 1);
    ctx.fillRect(0, 11, size, 1);
    ctx.fillRect(0, 15, size, 1);

    ctx.fillRect(4, 0, 1, 4);
    ctx.fillRect(12, 0, 1, 4);
    ctx.fillRect(8, 4, 1, 4);
    ctx.fillRect(0, 4, 1, 4);
    ctx.fillRect(4, 8, 1, 4);
    ctx.fillRect(12, 8, 1, 4);
    ctx.fillRect(8, 12, 1, 4);
  });
}

// 5. İkonik Minecraft TNT Dokusu (Kırmızı zemin + Beyaz şerit + Siyah TNT yazısı)
export function getTNTSideTexture() {
  return createPixelTexture((ctx, size) => {
    // Kırmızı TNT gövdesi
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = Math.random() > 0.4 ? '#db3323' : '#c42b1c';
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Orta beyaz şerit (4 piksel yükseklik)
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 6, size, 4);

    // Piksel "TNT" Yazısı
    ctx.fillStyle = '#111111';
    // T
    ctx.fillRect(2, 7, 3, 1);
    ctx.fillRect(3, 8, 1, 2);

    // N
    ctx.fillRect(6, 7, 1, 3);
    ctx.fillRect(7, 8, 1, 1);
    ctx.fillRect(8, 7, 1, 3);

    // T
    ctx.fillRect(10, 7, 3, 1);
    ctx.fillRect(11, 8, 1, 2);
  });
}

export function getTNTTopTexture() {
  return createPixelTexture((ctx, size) => {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = Math.random() > 0.4 ? '#c42b1c' : '#b22416';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Orta fünye noktası
    ctx.fillStyle = '#222222';
    ctx.fillRect(6, 6, 4, 4);
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(7, 7, 2, 2);
  });
}

// 6. Çimen Blok (Grass Top)
export function getGrassTopTexture() {
  return createPixelTexture((ctx, size) => {
    const greens = ['#5b8e32', '#69a139', '#4d7c2a', '#74b23f'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

// Çimen Blok Yanı (Üstü yeşil, altı toprak)
export function getGrassSideTexture() {
  return createPixelTexture((ctx, size) => {
    const dirts = ['#866043', '#725137', '#936b4b', '#61442e'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = dirts[Math.floor(Math.random() * dirts.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Üst sarkan yeşil çimen pikselleri
    const greens = ['#5b8e32', '#69a139', '#4d7c2a'];
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
      ctx.fillRect(x, 0, 1, 2);
      if (x % 2 === 0) ctx.fillRect(x, 2, 1, 1);
      if (x % 4 === 1) ctx.fillRect(x, 3, 1, 1);
    }
  });
}

// 7. Elmas Blok (Diamond Block)
export function getDiamondTexture() {
  return createPixelTexture((ctx, size) => {
    const cyans = ['#5febe1', '#40d5c8', '#7ef7ee', '#31b7ab'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = cyans[Math.floor(Math.random() * cyans.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Kenar çerçevesi
    ctx.strokeStyle = '#289d92';
    ctx.strokeRect(0.5, 0.5, 15, 15);
  });
}

// 8. Altın Blok (Gold Block)
export function getGoldTexture() {
  return createPixelTexture((ctx, size) => {
    const golds = ['#fed83d', '#f4c424', '#ffea6c', '#dea715'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = golds[Math.floor(Math.random() * golds.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.strokeStyle = '#c48f0d';
    ctx.strokeRect(0.5, 0.5, 15, 15);
  });
}

// 9. Karakter Kafası / Yüzü (Steve Tarzı)
export function getCharacterFaceTexture() {
  return createPixelTexture((ctx, size) => {
    // Ten rengi
    ctx.fillStyle = '#b98561';
    ctx.fillRect(0, 0, size, size);

    // Saç (Üst ve yanlar kahverengi)
    ctx.fillStyle = '#4a2f13';
    ctx.fillRect(0, 0, size, 4);
    ctx.fillRect(0, 4, 2, 3);
    ctx.fillRect(14, 4, 2, 3);

    // Gözler (Beyaz + Mavi)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 7, 3, 2);
    ctx.fillRect(10, 7, 3, 2);

    ctx.fillStyle = '#2b4bb5';
    ctx.fillRect(4, 7, 2, 2);
    ctx.fillRect(10, 7, 2, 2);

    // Burun & Ağız
    ctx.fillStyle = '#8f5e3e';
    ctx.fillRect(6, 9, 4, 1);

    ctx.fillStyle = '#59321e';
    ctx.fillRect(5, 11, 6, 2);
    ctx.fillStyle = '#b98561';
    ctx.fillRect(6, 12, 4, 1);
  });
}

// Karakter Gövdesi (Mavi Yıkım Gömleği / Tişört)
export function getCharacterShirtTexture() {
  return createPixelTexture((ctx, size) => {
    const blues = ['#008b8b', '#009e9e', '#007575'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = blues[Math.floor(Math.random() * blues.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Yaka açıklığı
    ctx.fillStyle = '#b98561';
    ctx.fillRect(6, 0, 4, 3);
  });
}

// Karakter Pantolonu (Koyu Mavi Kot)
export function getCharacterPantsTexture() {
  return createPixelTexture((ctx, size) => {
    const pants = ['#293b7a', '#223269', '#324891'];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        ctx.fillStyle = pants[Math.floor(Math.random() * pants.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}
