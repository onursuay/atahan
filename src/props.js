import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// TUTULABİLİR EŞYALAR (Teardown'daki gibi el mekaniği): askıdaki kıyafetler, sandalyeler, kutular, şişeler, minderler, saksılar...
//  • Sağ tık basılı: nişangâhın baktığı eşyayı eldeki gibi tutar ve önünde taşırsın; fareyle yön verirsin, tekerlekle uzaklığı ayarlarsın.
//  • Bırakınca (sağ tık) elindeki hızla düşer ya da fırlar. Eşyalar voxel zemine, duvara ve eşyaya çarpar; patlama onları savurur.
//  • Her eşya türü tek bir InstancedMesh'te çizilir (çok sayıda eşya ucuzdur); fizik yalnız hareket eden eşyalar için çalışır.
//  • Sağ tık hiçbir şeye zarar vermez.
// ─────────────────────────────────────────────────────────────────────────────
const S = VOXEL_SIZE;
const GRAV = 22;
const EPS = 1e-4;
const CAP = 900;                  // tür başına en çok eşya

const parts = (list) => mergeGeometries(list.map(([w, h, d, x, y, z, c]) => {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}), false);

// Eşya türleri: yarı boyutlar (çarpışma kutusu), model parçaları (merkeze göre [w,h,d,x,y,z,renk]); tint: örnek rengiyle boyanır (taban beyaz)
const KINDS = {
  shirt: { half: [0.32, 0.34, 0.07], tint: true, mass: 0.6, geo: () => parts([
    [0.5, 0.52, 0.09, 0, -0.04, 0, 0xffffff], [0.2, 0.2, 0.09, -0.34, 0.09, 0, 0xffffff], [0.2, 0.2, 0.09, 0.34, 0.09, 0, 0xffffff],
    [0.16, 0.05, 0.1, 0, 0.23, 0, 0x2a2a30], [0.05, 0.1, 0.04, 0, 0.3, 0, 0x6b7280], [0.5, 0.025, 0.025, 0, 0.27, 0, 0x6b7280]]) },
  jacket: { half: [0.34, 0.4, 0.09], tint: true, mass: 0.9, geo: () => parts([
    [0.56, 0.66, 0.11, 0, -0.08, 0, 0xffffff], [0.2, 0.5, 0.11, -0.38, -0.05, 0, 0xffffff], [0.2, 0.5, 0.11, 0.38, -0.05, 0, 0xffffff],
    [0.04, 0.6, 0.12, 0, -0.08, 0, 0x2a2a30], [0.05, 0.1, 0.04, 0, 0.36, 0, 0x6b7280], [0.56, 0.025, 0.025, 0, 0.32, 0, 0x6b7280]]) },
  pants: { half: [0.22, 0.45, 0.07], tint: true, mass: 0.7, geo: () => parts([
    [0.2, 0.7, 0.09, -0.12, -0.12, 0, 0xffffff], [0.2, 0.7, 0.09, 0.12, -0.12, 0, 0xffffff], [0.44, 0.12, 0.1, 0, 0.26, 0, 0xffffff],
    [0.05, 0.12, 0.04, 0, 0.4, 0, 0x6b7280], [0.4, 0.025, 0.025, 0, 0.36, 0, 0x6b7280]]) },
  chair: { half: [0.27, 0.46, 0.27], tint: true, mass: 3, geo: () => parts([
    [0.5, 0.07, 0.5, 0, 0, 0, 0xffffff], [0.5, 0.5, 0.06, 0, 0.3, -0.22, 0xffffff],
    ...[[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]].map(([x, z]) => [0.06, 0.42, 0.06, x, -0.24, z, 0x3a3f47])]) },
  box: { half: [0.27, 0.22, 0.27], tint: false, mass: 2, geo: () => parts([[0.54, 0.44, 0.54, 0, 0, 0, 0xb08b5a], [0.56, 0.04, 0.12, 0, 0.23, 0, 0xd6b98a], [0.55, 0.03, 0.55, 0, -0.2, 0, 0x8a6a3e]]) },
  bottle: { half: [0.07, 0.22, 0.07], tint: true, mass: 0.4, geo: () => parts([[0.13, 0.28, 0.13, 0, -0.07, 0, 0xffffff], [0.06, 0.16, 0.06, 0, 0.15, 0, 0xffffff], [0.07, 0.04, 0.07, 0, 0.25, 0, 0x2a2a30]]) },
  cushion: { half: [0.26, 0.09, 0.26], tint: true, mass: 0.5, geo: () => parts([[0.5, 0.15, 0.5, 0, 0, 0, 0xffffff], [0.2, 0.17, 0.2, 0, 0, 0, 0xe5e7eb]]) },
  plant: { half: [0.2, 0.36, 0.2], tint: false, mass: 2, geo: () => parts([[0.3, 0.26, 0.3, 0, -0.22, 0, 0xb4532a], [0.1, 0.22, 0.1, 0, 0.0, 0, 0x4d7c2f], [0.38, 0.26, 0.38, 0, 0.2, 0, 0x3f8f3a], [0.22, 0.2, 0.22, 0, 0.38, 0, 0x4fae45]]) },
  tray: { half: [0.28, 0.12, 0.2], tint: false, mass: 0.6, geo: () => parts([
    [0.56, 0.03, 0.4, 0, -0.1, 0, 0xdc2626], [0.2, 0.05, 0.2, -0.12, -0.065, 0, 0xe9b85a], [0.2, 0.04, 0.2, -0.12, -0.02, 0, 0x7c2d12], [0.2, 0.025, 0.2, -0.12, 0.01, 0, 0x4d9a3a],
    [0.2, 0.05, 0.2, -0.12, 0.04, 0, 0xe9b85a], [0.12, 0.14, 0.1, 0.17, -0.02, 0.06, 0xfacc15], [0.1, 0.11, 0.1, 0.17, -0.03, -0.1, 0xefefef]]) },
  pizzabox: { half: [0.27, 0.05, 0.27], tint: false, mass: 0.5, geo: () => parts([[0.54, 0.08, 0.54, 0, 0, 0, 0xf3f4f6], [0.3, 0.085, 0.3, 0, 0, 0, 0xdc2626]]) },
  teddy: { half: [0.2, 0.3, 0.16], tint: true, mass: 0.7, geo: () => parts([
    [0.3, 0.32, 0.22, 0, -0.1, 0, 0xffffff], [0.26, 0.24, 0.24, 0, 0.16, 0, 0xffffff], [0.09, 0.09, 0.06, -0.1, 0.3, 0, 0xffffff], [0.09, 0.09, 0.06, 0.1, 0.3, 0, 0xffffff],
    [0.08, 0.2, 0.1, -0.2, -0.08, 0, 0xffffff], [0.08, 0.2, 0.1, 0.2, -0.08, 0, 0xffffff], [0.1, 0.1, 0.03, 0, 0.14, 0.13, 0x2a2a30]]) },
  book: { half: [0.17, 0.08, 0.12], tint: true, mass: 0.4, geo: () => parts([[0.34, 0.07, 0.24, 0, -0.045, 0, 0xffffff], [0.32, 0.07, 0.22, 0, 0.025, 0, 0xe5e7eb], [0.34, 0.06, 0.24, 0, 0.09, 0, 0xffffff]]) },
  // ── Dükkân ürünleri (AVM): yiyecek, içecek, ayakkabı, elektronik, hediye, poşet ──
  doner_plate: { half: [0.18, 0.05, 0.14], tint: false, mass: 0.35, geo: () => parts([
    [0.36, 0.02, 0.28, 0, -0.04, 0, 0xf8fafc],                                        // porselen tabak
    [0.26, 0.035, 0.14, -0.02, -0.015, -0.03, 0x6d3816],                              // ince yaprak döner etleri
    [0.24, 0.025, 0.12, -0.02, 0.005, -0.03, 0x854d0e],
    [0.09, 0.035, 0.16, 0.1, -0.02, 0.02, 0xfacc15],                                   // kızarmış patates dilimleri
    [0.06, 0.03, 0.06, -0.1, -0.02, 0.08, 0xef4444],                                   // domates dilimi
    [0.04, 0.025, 0.1, -0.02, -0.02, 0.08, 0x16a34a]                                   // közlenmiş biber
  ]) },
  doner_wrap: { half: [0.08, 0.08, 0.18], tint: false, mass: 0.25, geo: () => parts([
    [0.12, 0.12, 0.34, 0, 0, 0, 0xfde047],                                             // lavaş sarılı döner dürüm
    [0.125, 0.125, 0.16, 0, 0, -0.09, 0xe2e8f0],                                      // alüminyum sarma folyosu
    [0.08, 0.06, 0.03, 0, 0.01, 0.17, 0x78350f],                                      // et ucu
    [0.06, 0.04, 0.03, 0.01, -0.01, 0.17, 0x16a34a]                                   // maydanoz
  ]) },
  kebap_plate: { half: [0.2, 0.05, 0.14], tint: false, mass: 0.4, geo: () => parts([
    [0.4, 0.02, 0.28, 0, -0.04, 0, 0xf8fafc],                                         // servis tabağı
    [0.34, 0.035, 0.07, 0, -0.02, -0.04, 0x7c2d12],                                   // Adana şiş kebap
    [0.32, 0.03, 0.06, 0, 0.005, -0.04, 0x991b1b],
    [0.07, 0.04, 0.07, 0.12, -0.02, 0.05, 0xdc2626],                                  // közlenmiş domates
    [0.04, 0.03, 0.14, 0.03, -0.02, 0.05, 0x15803d],                                  // közlenmiş acı biber
    [0.14, 0.025, 0.14, -0.1, -0.02, 0.05, 0xfef08a]                                  // tırnak pide / lavaş
  ]) },
  ayran: { half: [0.07, 0.11, 0.07], tint: false, mass: 0.25, geo: () => parts([
    [0.12, 0.18, 0.12, 0, 0, 0, 0xf8fafc],                                             // yayık ayran bardağı
    [0.13, 0.02, 0.13, 0, 0.09, 0, 0x16a34a],                                         // yeşil folyo kapak
    [0.03, 0.01, 0.03, 0.02, 0.10, 0, 0x0284c7]                                       // pipet deliği
  ]) },
  table_menu: { half: [0.06, 0.1, 0.06], tint: false, mass: 0.15, geo: () => parts([
    [0.04, 0.18, 0.12, 0, 0, 0, 0xf8fafc],                                             // dik üçgen menü kartı
    [0.045, 0.04, 0.12, 0, 0.07, 0, 0xdc2626],                                        // kırmızı MENÜ başlığı
    [0.06, 0.02, 0.14, 0, -0.08, 0, 0x1e293b]                                         // alt stand
  ]) },
  table_reserved: { half: [0.06, 0.05, 0.09], tint: false, mass: 0.2, geo: () => parts([
    [0.08, 0.06, 0.16, 0, 0, 0, 0xfacc15],                                             // pirinç rezerv prizması
    [0.084, 0.035, 0.13, 0, 0.005, 0, 0x0f172a],                                      // siyah REZERV levhası
    [0.086, 0.015, 0.11, 0, 0.005, 0, 0xffffff]                                       // beyaz REZERV yazısı
  ]) },
  donut: { half: [0.13, 0.05, 0.13], tint: true, mass: 0.15, geo: () => parts([       // kremalı donat: hamur halkası + krema halkası + şeker serpintisi
    [0.26, 0.06, 0.09, 0, -0.02, -0.085, 0xf3d9a8], [0.26, 0.06, 0.09, 0, -0.02, 0.085, 0xf3d9a8], [0.09, 0.06, 0.08, -0.085, -0.02, 0, 0xf3d9a8], [0.09, 0.06, 0.08, 0.085, -0.02, 0, 0xf3d9a8],
    [0.26, 0.03, 0.08, 0, 0.025, -0.09, 0xffffff], [0.26, 0.03, 0.08, 0, 0.025, 0.09, 0xffffff], [0.08, 0.03, 0.1, -0.09, 0.025, 0, 0xffffff], [0.08, 0.03, 0.1, 0.09, 0.025, 0, 0xffffff],
    [0.02, 0.012, 0.02, -0.05, 0.048, -0.09, 0xfff7d6], [0.02, 0.012, 0.02, 0.07, 0.048, 0.08, 0xfff7d6], [0.02, 0.012, 0.02, 0.0, 0.048, 0.09, 0xffd1dc]]) },
  coffee: { half: [0.18, 0.3, 0.18], tint: false, mass: 0.6, geo: () => parts([           // 3 kat büyük kahve bardağı: kağıt bardak, kahverengi kılıf, siyah kapak
    [0.3, 0.48, 0.3, 0, -0.06, 0, 0xf8fafc], [0.315, 0.18, 0.315, 0, -0.06, 0, 0x8b5a2b], [0.375, 0.075, 0.375, 0, 0.225, 0, 0x2a2018], [0.12, 0.06, 0.12, 0, 0.294, 0, 0x2a2018]]) },
  pizzaslice: { half: [0.15, 0.025, 0.16], tint: false, mass: 0.15, geo: () => parts([    // pizza dilimi: kalın kenar + peynir üçgeni (basamaklı) + sucuk
    [0.32, 0.04, 0.05, 0, 0, -0.13, 0xd49a52], [0.28, 0.03, 0.07, 0, 0.005, -0.075, 0xf2b84b], [0.22, 0.03, 0.07, 0, 0.005, -0.01, 0xf2b84b], [0.15, 0.03, 0.07, 0, 0.005, 0.055, 0xf2b84b], [0.07, 0.03, 0.06, 0, 0.005, 0.115, 0xf2b84b],
    [0.05, 0.015, 0.05, -0.07, 0.027, -0.07, 0xb91c1c], [0.05, 0.015, 0.05, 0.07, 0.027, -0.05, 0xb91c1c], [0.05, 0.015, 0.05, 0.0, 0.027, 0.02, 0xb91c1c]]) },
  burger: { half: [0.13, 0.12, 0.13], tint: false, mass: 0.3, geo: () => parts([          // hamburger: üst-alt ekmek, köfte, peynir, marul, domates
    [0.24, 0.05, 0.24, 0, -0.09, 0, 0xd99a4e], [0.25, 0.045, 0.25, 0, -0.04, 0, 0x5b2e12], [0.26, 0.015, 0.26, 0, -0.01, 0, 0xfacc15], [0.27, 0.02, 0.27, 0, 0.012, 0, 0x4ca64c],
    [0.24, 0.025, 0.24, 0, 0.04, 0, 0xdc2626], [0.24, 0.08, 0.24, 0, 0.09, 0, 0xe0a35a], [0.025, 0.012, 0.025, -0.05, 0.135, 0.03, 0xfff3d1], [0.025, 0.012, 0.025, 0.05, 0.135, -0.03, 0xfff3d1]]) },
  shoe: { half: [0.17, 0.08, 0.08], tint: true, mass: 0.4, geo: () => parts([            // spor ayakkabı: taban + bilek + burun (örnek rengiyle boyanır)
    [0.34, 0.04, 0.15, 0, -0.06, 0, 0x2a2a30], [0.14, 0.13, 0.14, -0.1, 0.02, 0, 0xffffff], [0.2, 0.07, 0.14, 0.07, -0.005, 0, 0xffffff], [0.1, 0.02, 0.1, -0.1, 0.095, 0, 0xe5e7eb]]) },
  icecream: { half: [0.07, 0.17, 0.07], tint: false, mass: 0.2, geo: () => parts([       // külah + iki top dondurma
    [0.1, 0.06, 0.1, 0, -0.14, 0, 0xd9a05b], [0.08, 0.05, 0.08, 0, -0.18, 0, 0xc98f4a], [0.15, 0.1, 0.15, 0, -0.06, 0, 0xd49a52], [0.17, 0.1, 0.17, 0, 0.04, 0, 0xf9a8d4], [0.14, 0.09, 0.14, 0, 0.13, 0, 0xfafafa]]) },
  wrap: { half: [0.06, 0.06, 0.17], tint: false, mass: 0.2, geo: () => parts([           // dürüm: lavaş rulo, folyo, iç malzeme
    [0.11, 0.11, 0.34, 0, 0, 0, 0xf2d9a0], [0.115, 0.115, 0.14, 0, 0, -0.1, 0xe5e7eb], [0.08, 0.05, 0.02, 0, 0.02, 0.17, 0x4ca64c], [0.05, 0.04, 0.02, 0.01, -0.02, 0.17, 0xb45309]]) },
  lahmacun: { half: [0.18, 0.02, 0.18], tint: false, mass: 0.2, geo: () => parts([       // lahmacun: ince yuvarlak hamur, kıyma, maydanoz, limon
    [0.36, 0.02, 0.36, 0, 0, 0, 0xd9824a], [0.3, 0.012, 0.3, 0, 0.012, 0, 0xb8532a], [0.05, 0.012, 0.05, -0.08, 0.022, 0.05, 0x4ca64c], [0.05, 0.012, 0.05, 0.07, 0.022, -0.06, 0x4ca64c], [0.06, 0.03, 0.06, 0.2, 0.01, 0.02, 0xfacc15]]) },
  bucket: { half: [0.12, 0.15, 0.12], tint: false, mass: 0.4, geo: () => parts([          // kızarmış tavuk kovası: kırmızı-beyaz çizgili, üstünde parçalar
    [0.22, 0.2, 0.22, 0, -0.04, 0, 0xffffff], [0.225, 0.05, 0.225, 0, -0.08, 0, 0xdc2626], [0.225, 0.05, 0.225, 0, 0.02, 0, 0xdc2626], [0.2, 0.07, 0.2, 0, 0.1, 0, 0xc2742a], [0.07, 0.06, 0.07, 0.04, 0.15, 0.03, 0xd48a38], [0.07, 0.05, 0.07, -0.05, 0.14, -0.03, 0xb5651f]]) },
  sushi: { half: [0.15, 0.05, 0.1], tint: false, mass: 0.2, geo: () => parts([           // suşi tabağı: 3 rulo (pirinç + nori + somon)
    [0.3, 0.015, 0.2, 0, -0.03, 0, 0xf8fafc], [0.07, 0.06, 0.07, -0.09, 0.015, 0, 0x14161a], [0.07, 0.06, 0.07, 0.0, 0.015, 0, 0x14161a], [0.07, 0.06, 0.07, 0.09, 0.015, 0, 0x14161a],
    [0.05, 0.015, 0.05, -0.09, 0.052, 0, 0xfb923c], [0.05, 0.015, 0.05, 0.0, 0.052, 0, 0xf87171], [0.05, 0.015, 0.05, 0.09, 0.052, 0, 0xfb923c]]) },
  sweet: { half: [0.15, 0.04, 0.1], tint: false, mass: 0.2, geo: () => parts([           // baklava tepsisi: altın tepsi + bal rengi dilimler
    [0.3, 0.02, 0.2, 0, -0.03, 0, 0xd4a017], [0.09, 0.05, 0.09, -0.09, 0.005, 0, 0xc98a1b], [0.09, 0.05, 0.09, 0.0, 0.005, 0, 0xd99a22], [0.09, 0.05, 0.09, 0.09, 0.005, 0, 0xc98a1b], [0.02, 0.012, 0.02, 0, 0.034, 0, 0x65a30d]]) },
  phone: { half: [0.045, 0.012, 0.085], tint: false, mass: 0.1, geo: () => parts([[0.09, 0.014, 0.17, 0, 0, 0, 0x111827], [0.075, 0.004, 0.14, 0, 0.009, 0, 0x38bdf8]]) },
  laptop: { half: [0.18, 0.12, 0.14], tint: false, mass: 0.7, shatterColor: 0x38bdf8, geo: () => parts([          // teknomarket vitrin laptopu: ince metalik gövde + ultra parlak IPS ekran + RGB klavye
    [0.34, 0.016, 0.24, 0, -0.095, 0.02, 0x1e293b],                                    // alt gövde (uzay grisi / alüminyum)
    [0.32, 0.005, 0.09, 0, -0.086, 0.08, 0x38bdf8],                                     // RGB aydınlatmalı klavye alanı
    [0.10, 0.004, 0.07, 0, -0.086, -0.04, 0x0f172a],                                    // geniş cam touchpad
    [0.34, 0.22, 0.012, 0, 0.01, -0.095, 0x0b0f19],                                     // ince ekran kapağı ve çerçeve
    [0.32, 0.19, 0.005, 0, 0.012, -0.088, 0x06b6d4],                                    // parlak teknomarket demo ekranı (cyan)
    [0.18, 0.12, 0.004, 0.05, 0.02, -0.085, 0xf8fafc],                                  // ekranda açık ürün tanıtım sayfası
    [0.08, 0.08, 0.004, -0.09, 0.02, -0.085, 0x8b5cf6],                                 // ekranda renkli grafik penceresi
    [0.32, 0.016, 0.004, 0, -0.075, -0.085, 0x0284c7]                                   // görev çubuğu
  ]) },
  // ── Şirket binaları & Teknomarketler için son model gaming masaüstü bilgisayar (RGB cam kasa + ultra-wide kavisli monitör + RGB mekanik klavye + gaming mouse) ──
  desktop_pc: { half: [0.38, 0.28, 0.28], tint: false, mass: 2.2, shatterColor: 0x38bdf8, geo: () => parts([
    // Monitör metal tabanı ve modern çift mafsallı dikme
    [0.24, 0.016, 0.16, -0.05, -0.232, 0.08, 0x0f172a],
    [0.05, 0.16, 0.04, -0.05, -0.15, 0.11, 0x334155],
    // Ultra-wide kavisli çerçevesiz monitör arka gövdesi
    [0.56, 0.32, 0.026, -0.05, 0.02, 0.08, 0x090d16],
    [0.32, 0.18, 0.02, -0.05, 0.02, 0.10, 0x1e293b],
    // Monitör arka RGB halkası (teknomarket ambiyans ışığı)
    [0.18, 0.18, 0.006, -0.05, 0.02, 0.115, 0xa855f7],
    // Parlak ultra-wide IPS panel (teknomarket yüksek çözünürlüklü demo ekranı)
    [0.53, 0.29, 0.006, -0.05, 0.02, 0.064, 0x0284c7],
    // Ekranda teknomarket canlı demo pencereleri ve benchmark grafikleri
    [0.26, 0.18, 0.004, 0.07, 0.04, 0.060, 0xf8fafc],
    [0.26, 0.028, 0.005, 0.07, 0.115, 0.059, 0x2563eb],
    [0.18, 0.15, 0.004, -0.18, 0.045, 0.060, 0x0f172a],
    [0.03, 0.07, 0.005, -0.22, 0.02, 0.059, 0x10b981],                                  // FPS göstergesi (yeşil)
    [0.03, 0.11, 0.005, -0.17, 0.04, 0.059, 0x06b6d4],                                  // GPU yük grafiği (cyan)
    [0.03, 0.09, 0.005, -0.12, 0.03, 0.059, 0xf43f5e],                                  // CPU sıcaklık grafiği (pembe/kırmızı)
    [0.53, 0.022, 0.004, -0.05, -0.115, 0.060, 0x030712],                               // görev çubuğu
    [0.016, 0.008, 0.006, -0.29, -0.135, 0.064, 0x22c55e],                              // güç LED'i
    // RGB Mekanik Klavye (tuş altından parlayan neon aydınlatma)
    [0.36, 0.02, 0.13, -0.03, -0.231, -0.11, 0x111827],
    [0.34, 0.006, 0.022, -0.03, -0.218, -0.07, 0x38bdf8],                               // mavi LED tuş sırası
    [0.34, 0.006, 0.022, -0.03, -0.218, -0.10, 0xa855f7],                               // mor LED tuş sırası
    [0.26, 0.006, 0.022, -0.03, -0.218, -0.13, 0xec4899],                               // pembe LED tuş sırası
    [0.15, 0.008, 0.018, -0.03, -0.218, -0.155, 0xffffff],                              // boşluk tuşu (beyaz)
    // RGB Işıklı Geniş Gaming Mousepad ve LED Fare
    [0.16, 0.006, 0.18, -0.28, -0.236, -0.11, 0x0b0f19],
    [0.164, 0.003, 0.184, -0.28, -0.237, -0.11, 0x06b6d4],                              // mousepad kenar RGB neon şerit
    [0.06, 0.028, 0.095, -0.28, -0.222, -0.11, 0x1e293b],                               // ergonomik gaming mouse gövdesi
    [0.015, 0.012, 0.026, -0.28, -0.207, -0.09, 0xf43f5e],                              // aydınlatmalı tekerlek (RGB)
    // Şeffaf Temperli Camlı RGB Gaming PC Kasası (PC Tower)
    [0.16, 0.38, 0.32, 0.27, -0.05, 0.02, 0x090d16],                                    // ana metal gövde (siyah mat)
    [0.01, 0.35, 0.29, 0.185, -0.05, 0.02, 0x38bdf8],                                   // şeffaf temperli cam panel ve iç neon aydınlatma
    [0.14, 0.35, 0.014, 0.27, -0.05, -0.142, 0x111827],                                 // ön mesh ızgara
    [0.08, 0.08, 0.012, 0.27, 0.06, -0.140, 0x06b6d4],                                  // ön üst RGB fan (cyan)
    [0.08, 0.08, 0.012, 0.27, -0.05, -0.140, 0xa855f7],                                 // ön orta RGB fan (mor)
    [0.08, 0.08, 0.012, 0.27, -0.15, -0.140, 0xf43f5e],                                 // ön alt RGB fan (kırmızı)
    [0.06, 0.035, 0.012, 0.27, 0.11, 0.02, 0x22c55e]                                    // iç GPU LED barı
  ]) },
  gift: { half: [0.1, 0.1, 0.1], tint: true, mass: 0.3, geo: () => parts([[0.2, 0.2, 0.2, 0, 0, 0, 0xffffff], [0.05, 0.205, 0.205, 0, 0, 0, 0xfacc15], [0.205, 0.205, 0.05, 0, 0, 0, 0xfacc15], [0.08, 0.05, 0.05, 0, 0.12, 0, 0xfacc15]]) },
  can: { half: [0.04, 0.065, 0.04], tint: true, mass: 0.2, geo: () => parts([[0.075, 0.13, 0.075, 0, 0, 0, 0xffffff], [0.078, 0.02, 0.078, 0, 0.07, 0, 0xcbd5e1], [0.078, 0.02, 0.078, 0, -0.07, 0, 0xcbd5e1]]) },
  dumbbell: { half: [0.2, 0.07, 0.07], tint: true, mass: 0.8, geo: () => parts([       // minyatür dambıl: çubuk + iki yanda ağırlık plakaları
    [0.4, 0.035, 0.035, 0, 0, 0, 0x9ca3af], [0.05, 0.14, 0.14, -0.14, 0, 0, 0xffffff], [0.05, 0.14, 0.14, 0.14, 0, 0, 0xffffff], [0.04, 0.1, 0.1, -0.19, 0, 0, 0xe5e7eb], [0.04, 0.1, 0.1, 0.19, 0, 0, 0xe5e7eb]]) },
  ball: { half: [0.1, 0.1, 0.1], tint: true, mass: 0.3, geo: () => parts([[0.2, 0.2, 0.2, 0, 0, 0, 0xffffff], [0.205, 0.03, 0.205, 0, 0, 0, 0x2a2a30], [0.03, 0.205, 0.205, 0, 0, 0, 0x2a2a30]]) },
  toycar: { half: [0.13, 0.065, 0.06], tint: true, mass: 0.3, geo: () => parts([
    [0.26, 0.07, 0.12, 0, -0.02, 0, 0xffffff], [0.12, 0.06, 0.1, -0.01, 0.04, 0, 0xe5e7eb], ...[[-0.08, -0.06], [0.08, -0.06], [-0.08, 0.06], [0.08, 0.06]].map(([x, z]) => [0.05, 0.05, 0.02, x, -0.05, z, 0x2a2a30])]) },
  bag: { half: [0.11, 0.15, 0.06], tint: true, mass: 0.3, geo: () => parts([[0.22, 0.26, 0.1, 0, -0.02, 0, 0xffffff], [0.15, 0.03, 0.02, 0, 0.14, 0, 0x2a2a30], [0.02, 0.1, 0.02, -0.06, 0.1, 0, 0x2a2a30], [0.02, 0.1, 0.02, 0.06, 0.1, 0, 0x2a2a30]]) },
  remote: { half: [0.11, 0.045, 0.25], tint: false, mass: 0.35, shatterColor: 0x1e293b, geo: () => parts([
    [0.18, 0.065, 0.48, 0, 0, 0, 0x15181d],
    [0.044, 0.026, 0.044, -0.038, 0.038, -0.15, 0xdc2626],
    [0.044, 0.026, 0.044, 0.038, 0.038, -0.15, 0x22c55e],
    [0.044, 0.026, 0.044, -0.038, 0.038, -0.07, 0x3b82f6],
    [0.044, 0.026, 0.044, 0.038, 0.038, -0.07, 0xfacc15],
    [0.044, 0.026, 0.044, -0.038, 0.038, 0.02, 0x9ca3af],
    [0.044, 0.026, 0.044, 0.038, 0.038, 0.02, 0x9ca3af],
    [0.044, 0.026, 0.044, -0.038, 0.038, 0.10, 0x9ca3af],
    [0.044, 0.026, 0.044, 0.038, 0.038, 0.10, 0x9ca3af],
    [0.04, 0.024, 0.024, 0, 0.034, -0.232, 0xff3b3b]
  ]) },
  // ── Ev & Mutfak Eşyaları (Teardown tarzı dolap, çekmece, fırın ve buzdolabı içi) ──
  canned_food: { half: [0.065, 0.085, 0.065], tint: true, mass: 0.35, shatterColor: 0xdc2626, geo: () => parts([
    [0.12, 0.16, 0.12, 0, 0, 0, 0x94a3b8],
    [0.126, 0.09, 0.126, 0, 0, 0, 0xffffff],
    [0.128, 0.018, 0.128, 0, 0.075, 0, 0xcbd5e1],
    [0.128, 0.018, 0.128, 0, -0.075, 0, 0xcbd5e1],
    [0.05, 0.035, 0.13, 0, 0.005, 0, 0xfef08a]
  ]) },
  water_bottle: { half: [0.065, 0.18, 0.065], tint: false, mass: 0.4, shatterColor: 0x38bdf8, geo: () => parts([
    [0.12, 0.24, 0.12, 0, -0.05, 0, 0x7dd3fc],
    [0.124, 0.06, 0.124, 0, -0.04, 0, 0xe0f2fe],
    [0.065, 0.07, 0.065, 0, 0.10, 0, 0xbae6fd],
    [0.05, 0.035, 0.05, 0, 0.155, 0, 0x0284c7]
  ]) },
  cat_food: { half: [0.08, 0.095, 0.06], tint: false, mass: 0.35, shatterColor: 0xf472b6, geo: () => parts([
    [0.15, 0.18, 0.11, 0, 0, 0, 0xf472b6],
    [0.154, 0.05, 0.114, 0, 0.04, 0, 0xfef08a],
    [0.05, 0.05, 0.118, 0, -0.02, 0, 0xf97316],
    [0.022, 0.025, 0.12, -0.018, 0.012, 0, 0xf97316],
    [0.022, 0.025, 0.12, 0.018, 0.012, 0, 0xf97316]
  ]) },
  flour: { half: [0.10, 0.15, 0.075], tint: false, mass: 0.65, shatterColor: 0xfef3c7, geo: () => parts([
    [0.19, 0.27, 0.14, 0, -0.01, 0, 0xfafaf9],
    [0.195, 0.07, 0.145, 0, 0.0, 0, 0xf59e0b],
    [0.16, 0.03, 0.11, 0, 0.135, 0, 0xe7e5e4],
    [0.07, 0.04, 0.148, 0, 0.0, 0, 0xb91c1c]
  ]) },
  cola: { half: [0.055, 0.11, 0.055], tint: false, mass: 0.3, shatterColor: 0xdc2626, geo: () => parts([
    [0.10, 0.18, 0.10, 0, -0.01, 0, 0xdc2626],
    [0.104, 0.03, 0.104, 0, 0.0, 0, 0xffffff],
    [0.095, 0.02, 0.095, 0, 0.09, 0, 0xcbd5e1],
    [0.095, 0.015, 0.095, 0, -0.10, 0, 0xcbd5e1]
  ]) },
  cake: { half: [0.16, 0.09, 0.16], tint: false, mass: 0.55, shatterColor: 0xfde68a, geo: () => parts([
    [0.30, 0.025, 0.30, 0, -0.07, 0, 0x94a3b8],
    [0.26, 0.09, 0.26, 0, -0.015, 0, 0xd97706],
    [0.27, 0.035, 0.27, 0, 0.042, 0, 0xfffbeb],
    [0.04, 0.035, 0.04, -0.06, 0.072, -0.05, 0xef4444],
    [0.04, 0.035, 0.04, 0.06, 0.072, -0.05, 0xef4444],
    [0.04, 0.035, 0.04, 0.0, 0.072, 0.06, 0xef4444],
    [0.04, 0.035, 0.04, 0.0, 0.072, -0.01, 0x78350f]
  ]) },
  chips: { half: [0.12, 0.16, 0.06], tint: false, mass: 0.15, geo: () => parts([
    [0.22, 0.3, 0.1, 0, 0, 0, 0xdc2626],
    [0.23, 0.02, 0.105, 0, 0.14, 0, 0xfacc15],
    [0.23, 0.02, 0.105, 0, -0.14, 0, 0xfacc15],
    [0.14, 0.08, 0.105, 0, 0.01, 0, 0xfef08a]
  ]) },
  iced_tea: { half: [0.07, 0.14, 0.07], tint: false, mass: 0.35, geo: () => parts([
    [0.12, 0.25, 0.12, 0, 0, 0, 0xf59e0b],
    [0.125, 0.08, 0.125, 0, 0.02, 0, 0x0284c7],
    [0.11, 0.02, 0.11, 0, 0.13, 0, 0xd1d5db],
    [0.05, 0.04, 0.01, 0.04, 0.02, 0.065, 0x16a34a]
  ]) },
  brownie: { half: [0.08, 0.05, 0.08], tint: false, mass: 0.15, geo: () => parts([
    [0.16, 0.08, 0.16, 0, 0, 0, 0x3f1d0b],
    [0.14, 0.015, 0.14, 0, 0.045, 0, 0x78350f],
    [0.04, 0.01, 0.04, 0.03, 0.052, 0.02, 0xfafafa],
    [0.04, 0.01, 0.04, -0.04, 0.052, -0.03, 0xfafafa]
  ]) },
  pasta: { half: [0.08, 0.16, 0.05], tint: false, mass: 0.45, geo: () => parts([
    [0.14, 0.3, 0.09, 0, 0, 0, 0x1e3a8a],
    [0.09, 0.12, 0.092, 0, -0.02, 0, 0xfde047],
    [0.12, 0.04, 0.092, 0, 0.09, 0, 0xdc2626]
  ]) },
  rice: { half: [0.11, 0.15, 0.08], tint: false, mass: 0.55, geo: () => parts([
    [0.2, 0.28, 0.14, 0, 0, 0, 0xf8fafc],
    [0.205, 0.06, 0.145, 0, 0.03, 0, 0x0284c7],
    [0.18, 0.03, 0.04, 0, 0.13, 0, 0xb45309]
  ]) },
  bread: { half: [0.1, 0.07, 0.22], tint: false, mass: 0.3, geo: () => parts([
    [0.16, 0.11, 0.42, 0, 0, 0, 0xd97706],
    [0.17, 0.04, 0.36, 0, 0.04, 0, 0xb45309],
    [0.12, 0.02, 0.05, 0, 0.06, -0.1, 0xfde68a],
    [0.12, 0.02, 0.05, 0, 0.06, 0.02, 0xfde68a],
    [0.12, 0.02, 0.05, 0, 0.06, 0.14, 0xfde68a]
  ]) },
  produce_crate: { half: [0.22, 0.14, 0.22], tint: false, mass: 1.5, geo: () => parts([
    [0.44, 0.03, 0.44, 0, -0.12, 0, 0x92400e],
    [0.44, 0.24, 0.03, 0, 0, -0.21, 0x78350f],
    [0.44, 0.24, 0.03, 0, 0, 0.21, 0x78350f],
    [0.03, 0.24, 0.44, -0.21, 0, 0, 0x78350f],
    [0.03, 0.24, 0.44, 0.21, 0, 0, 0x78350f],
    [0.1, 0.1, 0.1, -0.1, 0.02, -0.1, 0xdc2626],
    [0.1, 0.1, 0.1, 0.1, 0.02, -0.1, 0xf97316],
    [0.1, 0.1, 0.1, -0.1, 0.02, 0.1, 0x65a30d],
    [0.1, 0.1, 0.1, 0.1, 0.02, 0.1, 0xfacc15]
  ]) },
  baking_tray: { half: [0.24, 0.03, 0.18], tint: false, mass: 0.5, shatterColor: 0x64748b, geo: () => parts([
    [0.46, 0.02, 0.34, 0, -0.015, 0, 0x475569],
    [0.48, 0.045, 0.025, 0, 0.0, -0.165, 0x334155],
    [0.48, 0.045, 0.025, 0, 0.0, 0.165, 0x334155],
    [0.025, 0.045, 0.34, -0.23, 0.0, 0, 0x334155],
    [0.025, 0.045, 0.34, 0.23, 0.0, 0, 0x334155]
  ]) },
  plate: { half: [0.14, 0.025, 0.14], tint: false, mass: 0.25, shatterColor: 0xf8fafc, geo: () => parts([
    [0.22, 0.02, 0.22, 0, -0.01, 0, 0xe2e8f0],
    [0.27, 0.022, 0.035, 0, 0.006, -0.12, 0xf8fafc],
    [0.27, 0.022, 0.035, 0, 0.006, 0.12, 0xf8fafc],
    [0.035, 0.022, 0.24, -0.12, 0.006, 0, 0xf8fafc],
    [0.035, 0.022, 0.24, 0.12, 0.006, 0, 0xf8fafc]
  ]) },
  spoon: { half: [0.035, 0.018, 0.11], tint: false, mass: 0.12, shatterColor: 0xcbd5e1, geo: () => parts([
    [0.022, 0.014, 0.14, 0, 0, 0.035, 0x94a3b8],
    [0.062, 0.018, 0.075, 0, -0.003, -0.065, 0xe2e8f0],
    [0.042, 0.012, 0.05, 0, 0.005, -0.065, 0xcbd5e1]
  ]) },
  fork: { half: [0.035, 0.018, 0.11], tint: false, mass: 0.12, shatterColor: 0xcbd5e1, geo: () => parts([
    [0.022, 0.014, 0.13, 0, 0, 0.04, 0x94a3b8],
    [0.064, 0.014, 0.02, 0, 0, -0.03, 0xcbd5e1],
    [0.012, 0.014, 0.06, -0.024, 0, -0.068, 0xe2e8f0],
    [0.012, 0.014, 0.06, 0.0, 0, -0.068, 0xe2e8f0],
    [0.012, 0.014, 0.06, 0.024, 0, -0.068, 0xe2e8f0]
  ]) },
  knife: { half: [0.02, 0.025, 0.15], tint: false, mass: 0.15, shatterColor: 0xcbd5e1, geo: () => parts([
    [0.022, 0.024, 0.12, 0, 0, 0.07, 0x1e293b],
    [0.024, 0.026, 0.015, 0, 0, 0.01, 0x94a3b8],
    [0.006, 0.038, 0.15, 0, 0.005, -0.07, 0xe2e8f0],
    [0.004, 0.015, 0.14, 0, -0.015, -0.065, 0xffffff]
  ]) },
  mug: { half: [0.08, 0.07, 0.06], tint: true, mass: 0.25, shatterColor: 0xffffff, geo: () => parts([
    [0.10, 0.12, 0.10, 0, 0, 0, 0xffffff],
    [0.08, 0.02, 0.08, 0, 0.045, 0, 0x3f2214],
    [0.02, 0.07, 0.02, -0.065, 0.005, 0, 0xffffff],
    [0.02, 0.02, 0.02, -0.055, 0.035, 0, 0xffffff],
    [0.02, 0.02, 0.02, -0.055, -0.025, 0, 0xffffff]
  ]) },
  game_console: { half: [0.22, 0.16, 0.14], tint: false, mass: 1.5, shatterColor: 0x38bdf8, geo: () => parts([
    // Konsol ana gövdesi (siyah çekirdek + beyaz aerodinamik dış kanatlar)
    [0.09, 0.28, 0.24, -0.06, 0, 0, 0x111827],
    [0.015, 0.32, 0.25, -0.11, 0, 0, 0xf8fafc],
    [0.015, 0.32, 0.25, -0.01, 0, 0, 0xf8fafc],
    // Mavi parlayan LED güç şeridi
    [0.005, 0.24, 0.008, -0.06, 0.02, 0.122, 0x38bdf8],
    // Disk yuvası ve havalandırma çizgisi
    [0.008, 0.12, 0.005, -0.03, -0.05, 0.122, 0x030712],
    // Yanında kablosuz ergonomik oyun kolu (gamepad)
    [0.15, 0.04, 0.09, 0.12, -0.12, 0, 0xf8fafc],
    [0.035, 0.035, 0.06, 0.06, -0.12, 0.05, 0xf8fafc],
    [0.035, 0.035, 0.06, 0.18, -0.12, 0.05, 0xf8fafc],
    [0.022, 0.02, 0.022, 0.10, -0.09, 0.01, 0x1e293b],
    [0.022, 0.02, 0.022, 0.14, -0.09, 0.01, 0x1e293b],
    [0.024, 0.012, 0.024, 0.08, -0.095, -0.02, 0x334155],
    [0.008, 0.01, 0.008, 0.16, -0.095, -0.02, 0x38bdf8],
    [0.008, 0.01, 0.008, 0.16, -0.095, -0.035, 0xef4444]
  ]) },
  cash_register: { half: [0.20, 0.20, 0.18], tint: false, mass: 2.2, shatterColor: 0x475569, geo: () => parts([
    // Para çekmecesi tabanı
    [0.34, 0.08, 0.32, 0, -0.10, 0, 0x1e293b],
    [0.32, 0.02, 0.02, 0, -0.10, 0.162, 0x94a3b8],
    // Kasa gövdesi
    [0.26, 0.14, 0.22, 0, 0.01, -0.03, 0x334155],
    // Eğimli tuş takımı
    [0.20, 0.03, 0.12, 0, 0.02, 0.06, 0x64748b],
    [0.03, 0.01, 0.03, -0.06, 0.038, 0.06, 0x22c55e],
    [0.03, 0.01, 0.03, 0.06, 0.038, 0.06, 0xef4444],
    // Ekran ayağı ve dokunmatik POS ekranı
    [0.05, 0.12, 0.04, 0, 0.14, -0.08, 0x0f172a],
    [0.24, 0.16, 0.025, 0, 0.24, -0.06, 0x0f172a],
    [0.21, 0.13, 0.006, 0, 0.24, -0.045, 0x0284c7],
    [0.16, 0.02, 0.004, 0, 0.26, -0.04, 0x22c55e],
    // Barkod okuyucu tabancası
    [0.04, 0.07, 0.09, 0.15, 0.06, 0.06, 0x0f172a],
    [0.02, 0.02, 0.005, 0.15, 0.08, 0.106, 0xef4444]
  ]) }
};
// Dışarıdan eşya yerleştirirken zemine oturtmak için: türün yarı yüksekliği (m)
export const PROP_HALF = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.half[1]]));
const PALETTE_TINT = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0891b2, 0xe11d48, 0xf97316, 0x111827, 0xf3f4f6, 0xfacc15, 0x84cc16];

export class PropManager {
  constructor(scene, voxelWorld) {
    this.scene = scene; this.vw = voxelWorld;
    this.group = new THREE.Group(); scene.add(this.group);
    this.kinds = {};
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [name, k] of Object.entries(KINDS)) {
      const mesh = new THREE.InstancedMesh(k.geo(), mat, CAP);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      this.group.add(mesh);
      this.kinds[name] = { mesh, half: new THREE.Vector3(...k.half), tint: k.tint, mass: k.mass, shatterColor: k.shatterColor || 0xd6b98a };
    }
    this.props = [];
    this.held = null; this.holdDist = 2.2; this.cam = null;
    this.tmpQ = new THREE.Quaternion(); this.tmpE = new THREE.Euler(); this.tmpM = new THREE.Matrix4(); this.one = new THREE.Vector3(1, 1, 1);
  }

  clear() {
    this.held = null; this.props = [];
    for (const k of Object.values(this.kinds)) k.mesh.count = 0;
  }

  // opts: { yaw, color, hung (askıda sabit), awake (havadan düşecek) }
  add(kind, x, y, z, opts = {}) {
    const k = this.kinds[kind];
    if (!k || k.mesh.count >= CAP) return null;
    const colHex = k.tint ? (opts.color ?? PALETTE_TINT[Math.floor(Math.random() * PALETTE_TINT.length)]) : (opts.color ?? k.shatterColor);
    const p = {
      kind, k, idx: k.mesh.count++, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      yaw: opts.yaw || 0, roll: 0, pitch: 0,
      spin: 0, wx: 0, wz: 0, restPitch: 0, restRoll: 0, tipped: false,
      half: k.half.clone(), baseHalf: k.half, held: false, hung: !!opts.hung, sleep: !opts.awake, still: 0, grounded: false,
      broken: false, thrown: false, color: colHex
    };
    if (k.tint) { const c = new THREE.Color(colHex); k.mesh.setColorAt(p.idx, c); k.mesh.instanceColor.needsUpdate = true; }
    this.props.push(p);
    this._upload(p);
    return p;
  }

  _upload(p) {
    this.tmpE.set(p.pitch, p.yaw, p.roll, 'YXZ'); this.tmpQ.setFromEuler(this.tmpE);
    this.tmpM.compose(p.pos, this.tmpQ, this.one);
    p.k.mesh.setMatrixAt(p.idx, this.tmpM); p.k.mesh.instanceMatrix.needsUpdate = true;
  }

  // Eşyayı kırıp küçük voxel parçalarına ayırır (mermi, çekiç, patlama veya sert fırlatma çarpması)
  breakProp(p, hitOrigin = null) {
    if (!p || p.broken) return;
    p.broken = true;
    if (this.held === p) this.held = null;
    const pos = p.pos.clone();
    p.pos.set(0, -100, 0);
    p.sleep = true;
    p.held = false;
    p.vel.set(0, 0, 0);
    this._upload(p);

    const vw = this.vw;
    const col = p.color || p.k.shatterColor || 0xd6b98a;
    const altCol = p.kind === 'plate' || p.kind === 'flour' || p.kind === 'water_bottle' ? 0xf8fafc : 0x94a3b8;
    const pieces = Math.min(8, Math.max(4, Math.round((p.baseHalf.x + p.baseHalf.y + p.baseHalf.z) * 14)));
    const center = hitOrigin || pos.clone().add(new THREE.Vector3(0, -0.1, 0));
    for (let i = 0; i < pieces && vw.dynamicDebris.length < vw.maxDynamicDebris; i++) {
      const ox = (Math.random() - 0.5) * p.baseHalf.x * 1.6;
      const oy = (Math.random() - 0.5) * p.baseHalf.y * 1.6;
      const oz = (Math.random() - 0.5) * p.baseHalf.z * 1.6;
      vw.spawnLooseVoxel(
        pos.x + ox, pos.y + oy, pos.z + oz,
        { color: i % 3 === 0 ? altCol : col },
        center, 0.25, 1.5, 48
      );
    }
    if (vw.particleSystem) {
      if (vw.particleSystem.createDust) vw.particleSystem.createDust(pos);
      if (vw.particleSystem.createSpark) vw.particleSystem.createSpark(pos);
    }
    if (sound.playWoodHit) sound.playWoodHit();
  }

  // Mermi veya çekiç ışını eşyaya çarptı mı?
  rayHit(origin, dir, maxDist) {
    let best = null;
    for (const p of this.props) {
      if (p.broken || p.held) continue;
      const t = this._rayAabb(origin, dir, p, p.half);
      if (t >= 0.1 && t <= maxDist && (!best || t < best.dist)) {
        best = { prop: p, dist: t, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  // Çekiç / patlama / topaç küresi içindeki eşyaları kırar
  hitSphere(center, radius) {
    let count = 0;
    for (const p of this.props) {
      if (p.broken) continue;
      const r = radius + Math.max(p.half.x, p.half.y, p.half.z);
      if (p.pos.distanceToSquared(center) <= r * r) {
        this.breakProp(p, center);
        count++;
      }
    }
    return count;
  }

  // Kutu (merkez p, yarı boyut h) voxel/zemin/kapıya/rafa giriyor mu?
  _solid(x, y, z, h) {
    const vw = this.vw, t = vw.terrain;
    const feet = y - h.y, hw = Math.max(h.x, h.z);
    if (t.solidAt(x, feet + 0.02, z, hw)) return true;
    if (vw.doors && vw.doors.blocks(x, feet, z, hw, h.y * 2)) return true;
    if (vw.shelves) {
      for (const sh of vw.shelves) {
        if (x + h.x > sh.x0 && x - h.x < sh.x1 && z + h.z > sh.z0 && z - h.z < sh.z1) {
          if (feet <= sh.y + 0.025 && y + h.y >= sh.y - 0.025) return true;
        }
      }
    }
    if (vw.doors) {
      for (const d of vw.doors.doors) {
        if (d.broken || d.kind !== 'drawer') continue;
        if (feet <= d.y + 0.035 && y + h.y >= d.y - 0.02) {
          const rx = x - (d.hx + d.nx * d.open), rz = z - (d.hz + d.nz * d.open);
          const u = rx * d.ax + rz * d.az, v = -(rx * d.nx + rz * d.nz);
          if (u >= -0.02 && u <= d.width + 0.02 && v >= -0.02 && v <= d.depth + 0.02) return true;
        }
      }
    }
    const ix0 = Math.floor((x - h.x + EPS) / S + 0.5), ix1 = Math.floor((x + h.x - EPS) / S + 0.5);
    const iz0 = Math.floor((z - h.z + EPS) / S + 0.5), iz1 = Math.floor((z + h.z - EPS) / S + 0.5);
    const iy0 = Math.floor((feet + 0.02) / S), iy1 = Math.floor((y + h.y - EPS) / S);
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) {
      const v = vw.voxels.get(`${ix},${iy},${iz}`);
      if (v && v.active) return true;
    }
    return false;
  }

  // ── Tutma ──
  _rayAabb(o, d, p, h) {
    let tmin = 0, tmax = 1e9;
    for (const a of ['x', 'y', 'z']) {
      const lo = p.pos[a] - h[a] - 0.08, hi = p.pos[a] + h[a] + 0.08;
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return -1; continue; }
      let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  // Bakılan eşya (en yakın, duvar veya kapalı dolap kapağı arkasında değil): { prop, dist } ya da null
  pick(camera, reach = 4.6) {
    const o = camera.position, d = new THREE.Vector3(); camera.getWorldDirection(d);
    let best = null;
    for (const p of this.props) {
      if (p.broken) continue;
      const t = this._rayAabb(o, d, p, p.half);
      if (t >= 0 && t <= reach && (!best || t < best.dist)) best = { prop: p, dist: t };
    }
    if (!best) return null;
    // arada duvar/zemin var mı?
    for (let s = 0.28; s < best.dist - 0.18; s += 0.22) {
      const q = o.clone().addScaledVector(d, s);
      const v = this.vw.voxels.get(`${Math.round(q.x / S)},${Math.round((q.y - S / 2) / S)},${Math.round(q.z / S)}`);
      if (v && v.active) return null;
    }
    // arada kapalı kapı / dolap kapağı / fırın kapağı / çekmece var mı?
    if (this.vw.doors) {
      const dh = this.vw.doors.rayHit(o, d, best.dist - 0.05);
      if (dh) return null;
    }
    return best;
  }

  aim(camera) { return !this.held && !!this.pick(camera); }

  beginGrab(camera) {
    const r = this.pick(camera);
    if (!r) return false;
    const p = r.prop;
    p.held = true; p.hung = false; p.sleep = false; p.still = 0; p.tipped = false; p.thrown = false; p.steadyDrop = false;
    p.half.copy(p.baseHalf);
    this.held = p; this.cam = camera; this.holdDist = THREE.MathUtils.clamp(r.dist, 1.0, 3.4);
    this.swipeSpeed = 0;
    sound.playWoodHit && sound.playWoodHit();
    return true;
  }

  // Eşya bırakıldığında (sağ tık bırakma): fare kaydırılmadıysa döndürmeden sabit ve düz bir şekilde bırakır;
  // sadece fare hızla kaydırılıp bırakıldıysa döne döne fırlatır.
  endGrab() {
    if (!this.held) return;
    const p = this.held;
    p.held = false; p.sleep = false; p.still = 0;
    const sp = Math.max(p.vel.length(), this.swipeSpeed || 0);
    const swiped = sp > 5.0;
    if (swiped) {
      if (sp > 6.5) p.thrown = true;
      p.steadyDrop = false;
      p.wx = (Math.random() - 0.5) * 9 + (p.vel.z * 0.45);
      p.wz = (Math.random() - 0.5) * 9 - (p.vel.x * 0.45);
      p.spin = (Math.random() - 0.5) * 8;
      this._assignFallRestAngles(p, true);
    } else {
      // Normal bırakma: döndürmeden sabit ve dik şekilde olduğu yere bırak
      p.vel.set(0, 0, 0);
      p.wx = 0; p.wz = 0; p.spin = 0;
      p.pitch = 0; p.roll = 0;
      p.restPitch = 0; p.restRoll = 0;
      p.tipped = false; p.thrown = false;
      p.steadyDrop = true;
    }
    this.swipeSpeed = 0;
    this.held = null;
  }

  // Sol tıkla eldeki eşyayı ileri fırlat: sadece fare kaydırıldıysa döne döne gider, sabit atıldıysa dönmeden gider
  throwHeld(camera) {
    if (!this.held) return false;
    const p = this.held;
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const swiped = Math.max(p.vel.length(), this.swipeSpeed || 0) > 3.2;
    p.held = false; p.sleep = false; p.still = 0; p.thrown = true;
    const throwSpeed = 16 / Math.max(0.55, Math.sqrt(p.k.mass));
    p.vel.copy(d).multiplyScalar(throwSpeed);
    p.vel.y += 2.2;
    if (swiped) {
      p.steadyDrop = false;
      p.wx = (Math.random() < 0.5 ? 1 : -1) * (8 + Math.random() * 7);
      p.wz = (Math.random() - 0.5) * 11;
      p.spin = (Math.random() - 0.5) * 12;
      this._assignFallRestAngles(p, true);
    } else {
      p.steadyDrop = true;
      p.wx = 0; p.wz = 0; p.spin = 0;
      p.pitch = 0; p.roll = 0;
      p.restPitch = 0; p.restRoll = 0;
      p.tipped = false;
    }
    this.swipeSpeed = 0;
    this.held = null;
    sound.playWoodHit && sound.playWoodHit();
    return true;
  }

  // Eşya düştüğünde veya çarptığında dimdik durmak yerine yan/sırtüstü/yüzüstü devrilerek oturacağı açıyı hesaplar
  _assignFallRestAngles(p, forceTip = false) {
    const bh = p.baseHalf;
    // Uzun/yüksek eşyalar (sandalye, şişe, kahve, saksı, oyuncak ayı, kıyafet) yan devrilir (±90 derece)
    // Yassı eşyalar (kumanda, pizza kutusu, kitap, telefon, tepsi) hafif eğik/ters veya çarpık düşer
    const tall = bh.y > Math.min(bh.x, bh.z) * 1.15;
    if (tall || forceTip) {
      if (bh.y >= bh.x && bh.y >= bh.z) {
        // Dik duran eşya: tamamen yan yatar (pitch veya roll ±PI/2 civarı)
        if (Math.random() < 0.55) {
          p.restPitch = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 - 0.06 + (Math.random() - 0.5) * 0.16);
          p.restRoll = (Math.random() - 0.5) * 0.35;
        } else {
          p.restRoll = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 - 0.06 + (Math.random() - 0.5) * 0.16);
          p.restPitch = (Math.random() - 0.5) * 0.35;
        }
        p.tipped = true;
      } else {
        // Yassı/geniş eşya: bazen ters döner (PI), bazen yan/eğik çakılır
        const flip = Math.random() < 0.45 ? Math.PI : 0;
        p.restPitch = flip + (Math.random() - 0.5) * 0.38;
        p.restRoll = (Math.random() - 0.5) * 0.42;
        p.tipped = true;
      }
    }
  }

  adjustDistance(delta) { this.holdDist = THREE.MathUtils.clamp(this.holdDist + delta, 0.85, 4.2); }

  // Patlama: merkezdeki eşyaları parçalar, yakındakileri savurur
  impulse(center, radius, force) {
    for (const p of this.props) {
      if (p.broken) continue;
      const d = p.pos.distanceTo(center);
      if (d > radius * 1.6) continue;
      if (d <= radius * 0.95) {
        this.breakProp(p, center);
        continue;
      }
      const k = (1 - d / (radius * 1.6)) * force / Math.max(0.5, p.k.mass);
      const dir = p.pos.clone().sub(center).normalize(); dir.y = Math.abs(dir.y) * 0.5 + 0.6;
      p.vel.addScaledVector(dir, k * 0.12); p.hung = false; p.sleep = false; p.still = 0; p.thrown = true;
      p.spin = (Math.random() - 0.5) * 14;
      p.wx = (Math.random() - 0.5) * 16;
      p.wz = (Math.random() - 0.5) * 16;
      this._assignFallRestAngles(p, true);
    }
  }

  // ── Güncelleme ──
  update(dt) {
    // Uyuyan eşyaların altındaki zemin/döşeme yok olduysa (kırıldıysa) uyandır: her karede birkaçı denetlenir
    const n = this.props.length;
    for (let k = 0; k < 6 && n; k++) {
      this.rr = ((this.rr || 0) + 1) % n;
      const p = this.props[this.rr];
      if (!p.broken && p.sleep && !p.held && !p.hung && !this._solid(p.pos.x, p.pos.y - 0.06, p.pos.z, p.half)) {
        p.sleep = false; p.still = 0;
        p.wx = (Math.random() - 0.5) * 6; p.wz = (Math.random() - 0.5) * 6;
        this._assignFallRestAngles(p, true);
      }
    }
    for (const p of this.props) {
      if (p.broken) continue;
      if (p.sleep && !p.held) continue;
      if (p.hung && !p.held) continue;
      if (p.held) this._stepHeld(p, dt); else this._stepFree(p, dt);
      if (!p.broken) this._upload(p);
    }
  }

  _stepHeld(p, dt) {
    const cam = this.cam, d = new THREE.Vector3(); cam.getWorldDirection(d);
    const target = cam.position.clone().addScaledVector(d, this.holdDist); target.y -= 0.15;
    const want = target.sub(p.pos);
    if (want.length() > 7) { this.endGrab(); return; }
    p.vel.copy(want.multiplyScalar(14));
    const sp = p.vel.length(); if (sp > 22) p.vel.multiplyScalar(22 / sp);
    this.swipeSpeed = Math.max(p.vel.length(), (this.swipeSpeed || 0) * Math.exp(-7 * dt));
    this._move(p, dt, false);
    // Elde tutarken kamera yönüne döner (sabit tutarken eğilmez)
    const yawT = Math.atan2(d.x, d.z) + Math.PI;
    p.yaw += Math.atan2(Math.sin(yawT - p.yaw), Math.cos(yawT - p.yaw)) * Math.min(1, dt * 8);
    p.pitch = 0;
    p.roll = 0;
  }

  _stepFree(p, dt) {
    p.vel.y = Math.max(-42, p.vel.y - GRAV * dt);
    // Devrilmiş eşyanın yere temas yüksekliğini (half.y) eğimine göre ayarla ki havada asılı kalmasın, yere tam otursun
    if (p.tipped && !p.steadyDrop) {
      const bh = p.baseHalf;
      const tiltAmt = Math.min(1, (Math.abs(Math.sin(p.pitch)) + Math.abs(Math.sin(p.roll))) * 0.85);
      const sideH = Math.min(bh.x, bh.z);
      p.half.y = bh.y * (1 - tiltAmt) + sideH * tiltAmt;
    }
    const hit = this._move(p, dt, true);
    // Fırlatılan veya yüksek hızla çarpan eşya parçalanarak kırılır!
    if ((p.thrown && hit > 4.8) || hit > 10.5) {
      this.breakProp(p);
      return;
    }
    if (p.steadyDrop) {
      p.wx = 0; p.wz = 0; p.spin = 0;
      p.pitch = 0; p.roll = 0;
      p.restPitch = 0; p.restRoll = 0;
      if (p.grounded) {
        const f = Math.pow(0.015, dt);
        p.vel.x *= f; p.vel.z *= f;
      }
    } else if (p.grounded) {
      const f = Math.pow(0.035, dt);
      p.vel.x *= f; p.vel.z *= f;
      p.spin *= Math.pow(0.04, dt);
      p.wx *= Math.pow(0.04, dt);
      p.wz *= Math.pow(0.04, dt);
      // Yere çarptığında dimdik (0,0) olmak yerine devrildiği açıya (restPitch, restRoll) doğru devrilip çakılır!
      if (!p.tipped && (hit > 1.2 || Math.abs(p.pitch) > 0.18 || Math.abs(p.roll) > 0.18)) {
        this._assignFallRestAngles(p, true);
      }
      const kSettle = 1 - Math.exp(-9 * dt);
      p.pitch += (p.restPitch - p.pitch) * kSettle + p.wx * dt * 0.35;
      p.roll += (p.restRoll - p.roll) * kSettle + p.wz * dt * 0.35;
    } else {
      // Havada düşerken 3 eksende gerçekçi takla atar / döner
      p.pitch += p.wx * dt;
      p.roll += p.wz * dt;
    }
    p.yaw += p.spin * dt;
    if (hit > 2.2) {
      if (!p.steadyDrop) {
        // Çarpma anında sekme ve açısal sarsıntı (çakılma hissi)
        p.wx += (Math.random() - 0.5) * hit * 1.4;
        p.wz += (Math.random() - 0.5) * hit * 1.4;
        p.spin += (Math.random() - 0.5) * hit * 0.9;
      }
      if (sound.playWoodHit) sound.playWoodHit();
      if (hit > 5.5 && this.vw.particleSystem && this.vw.particleSystem.createDust) {
        this.vw.particleSystem.createDust(p.pos.clone());
      }
    }
    if (p.vel.lengthSq() < 0.015 && p.grounded && Math.abs(p.pitch - p.restPitch) < 0.05 && Math.abs(p.roll - p.restRoll) < 0.05) {
      p.still += dt;
      if (p.still > 0.55) {
        p.sleep = true; p.thrown = false;
        p.vel.set(0, 0, 0);
        p.spin = 0; p.wx = 0; p.wz = 0;
        p.pitch = p.restPitch; p.roll = p.restRoll;
      }
    } else {
      p.still = 0;
    }
    if (p.pos.y < -6) { p.pos.set(0, -100, 0); p.sleep = true; this._upload(p); }
  }

  // Eksen eksen hareket; çarpma hızını döndürür (ses ve çakılma etkisi için)
  _move(p, dt, gravity) {
    let impact = 0; p.grounded = false;
    for (const [a] of [['x', 0], ['z', 2], ['y', 1]]) {
      const delta = p.vel[a] * dt;
      if (delta === 0) continue;
      const np = p.pos.clone(); np[a] += delta;
      if (!this._solid(np.x, np.y, np.z, p.half)) { p.pos[a] = np[a]; continue; }
      // küçük basamak (yalnız yatay harekette): 0.3 m yukarı çık
      if (a !== 'y' && !this._solid(np.x, np.y + 0.3, np.z, p.half) && !this._solid(p.pos.x, p.pos.y + 0.3, p.pos.z, p.half)) { p.pos.x = np.x; p.pos.z = np.z; p.pos.y += 0.3; continue; }
      // çarpmadan önceki en uzak noktaya kadar ilerle (havada asılı boşluk kalmasın)
      let lo = 0, hi = 1;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2, q = p.pos.clone(); q[a] += delta * m; if (this._solid(q.x, q.y, q.z, p.half)) hi = m; else lo = m; }
      p.pos[a] += delta * lo;
      impact = Math.max(impact, Math.abs(p.vel[a]));
      if (a === 'y' && p.vel.y < 0) p.grounded = true;
      p.vel[a] = gravity ? -p.vel[a] * 0.28 : 0;
      if (Math.abs(p.vel[a]) < 0.5) p.vel[a] = 0;
    }
    if (gravity && !p.grounded) {                                  // ayak altında zemin var mı (küçük sıçramalarda yanlış havada kalmasın)
      if (this._solid(p.pos.x, p.pos.y - 0.04, p.pos.z, p.half) && p.vel.y <= 0) p.grounded = true;
    }
    return impact;
  }
}
