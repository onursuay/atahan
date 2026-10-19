// ─────────────────────────────────────────────────────────────────────────────
// ŞEHİR PLANI — yollar TEK KAYNAKTAN tanımlanır (eski birim: 1 birim = 0.75 m).
// Hem asfalt boyama (levels.js) hem trafik ağı (cars.js) hem de yol/bina çakışma denetimi buradan beslenir; böylece asfaltın bittiği
// yerde trafik ağı da biter, hiçbir yol çıkmaz uçta kalmaz (her yol bir başka yola ya da göbeğe bağlanır) ve donatılar/binalar yola girmez.
//
//  Batı ada: kıyı bulvarı + 4 kuzey-güney sokak + 8 doğu-batı cadde; kuzeyde bir GÖBEK (çevresinde araçların döndüğü kavşak adası).
//  Doğu ada: batı yolu, otoyol, doğu yolu + doğu-batı caddeler; ana cadde köprüden doğu yoluna uzanır.
//  Her yolun iki ucu başka bir yolda biter (T kavşağı) ya da göbeğe/köprüye bağlanır.
// ─────────────────────────────────────────────────────────────────────────────
export const U = 0.75;

// Göbekler (yuvarlak kavşaklar) — eski birim. Dış yarıçap 22, orta şerit yarıçapı 17.5, ada yarıçapı 13. Kuzeyde ve güneyde birer tane.
export const ROUNDABOUTS = [
  { cx: -87, cz: -200, rOuter: 22, rMid: 17.5, rIsland: 13 },
  { cx: -87, cz: 200, rOuter: 22, rMid: 17.5, rIsland: 13 }
];
export const ROUNDABOUT = ROUNDABOUTS[0];

export const ROADS = [];
const add = (name, x0, z0, x1, z1, w, o = {}) => {
  const ns = x0 === x1;
  ROADS.push({ name, x0, z0, x1, z1, w, ns, lanes: o.lanes || 1, off: o.off ?? (ns ? 1.7 : 2.06), noMerge: !!o.noMerge, paint: o.paint || null, cells: o.cells || null, graph: o.graph !== false });
};

const RC = ROUNDABOUT.rMid;
// ── BATI ADA ──
add('bulvar', -170, -266, -170, 266, 11);                                  // kıyı bulvarı
add('s5', -127, -266, -127, 266, 9);
const RN = ROUNDABOUTS[0], RS = ROUNDABOUTS[1];
add('s6-kuzey', -87, -266, -87, RN.cz - RC, 9, { paint: [[-266, RN.cz - 22]] });                  // kuzey göbeğin kuzeyi
add('s6-orta', -87, RN.cz + RC, -87, RS.cz - RC, 9, { paint: [[RN.cz + 22, RS.cz - 22]] });       // iki göbek arası
add('s6-guney', -87, RS.cz + RC, -87, 266, 9, { paint: [[RS.cz + 22, 266]] });                    // güney göbeğin güneyi
add('s7', -47, -266, -47, 266, 9);
add('s8', -27, -266, -27, 266, 9);
add('cadde-0', -170, 0, 366, 0, 11, { noMerge: true, paint: [[-170, -12], [258, 366]] });              // ana cadde: batı ada + 3x uzun köprü + doğu ada (üst geçitten geçer)
[-66, 66, -134, 134, -266, 266].forEach(z => add(`cadde${z}`, -170, z, -27, z, 11));
for (const g of ROUNDABOUTS) {
  add(`cadde${g.cz}-bati`, -170, g.cz, g.cx - RC, g.cz, 11, { paint: [[-170, g.cx - 22]] });
  add(`cadde${g.cz}-dogu`, g.cx + RC, g.cz, -27, g.cz, 11, { paint: [[g.cx + 22, -27]] });
}
add('site', -67, -134, -67, -66, 7, { off: 1.3 });                         // konut sitesi iç yolu: iki caddeyi birleştirir (kapılar açık)
// ── DOĞU ADA (köprü 3 kat uzadığı için +180 eski birim / +135 m doğuya kaydırıldı) ──
add('otoyol', 305, -134, 305, 134, 32, { lanes: 3, off: 1.75, cells: [290, 321] });
add('ei-bati', 264, -134, 264, 134, 9);
add('ei-dogu', 366, -134, 366, 134, 9);
[-44, 44, -134, 134].forEach(z => add(`ei-cadde${z}`, 264, z, 366, z, 11));
[-88, 88].forEach(z => add(`ei-cadde${z}`, 264, z, 305, z, 11, { paint: [[264, 289]] }));

// Rampalı üst geçit şeridi: yalnız asfalt/temizlik için (trafik ağında değil; ana caddenin kendisi)
add('ust-gecit-serit', 258, 0, 360, 0, 13, { graph: false });

// Her yolun boyalı aralıkları (boylamsal, eski birim) ve enine hücre aralığı [min,max]
export function paintSegments(r) {
  const along = r.paint || [r.ns ? [r.z0, r.z1] : [r.x0, r.x1]];
  const half = (r.w - 1) / 2;
  const across = r.cells || (r.ns ? [r.x0 - half, r.x0 + half] : [r.z0 - half, r.z0 + half]);
  return along.map(([a, b]) => r.ns
    ? { x0: across[0], x1: across[1], z0: Math.min(a, b), z1: Math.max(a, b) }
    : { x0: Math.min(a, b), x1: Math.max(a, b), z0: across[0], z1: across[1] });
}

// Tüm boyalı yol dikdörtgenleri (eski birim, hücre sınırlarıyla: ±0.5)
export function roadRects() {
  const out = [];
  for (const r of ROADS) for (const s of paintSegments(r)) out.push({ name: r.name, minX: s.x0 - 0.5, maxX: s.x1 + 0.5, minZ: s.z0 - 0.5, maxZ: s.z1 + 0.5 });
  for (const g of ROUNDABOUTS) out.push({ name: 'gobek', minX: g.cx - g.rOuter, maxX: g.cx + g.rOuter, minZ: g.cz - g.rOuter, maxZ: g.cz + g.rOuter, round: true, g });
  return out;
}

// (x,z) eski birim noktası, margin kadar genişletilmiş herhangi bir yolun içinde mi?
export function onRoad(x, z, margin = 1) {
  for (const r of roadRects()) {
    if (r.round) { if (Math.hypot(x - r.g.cx, z - r.g.cz) <= r.g.rOuter + margin) return true; continue; }
    if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) return true;
  }
  return false;
}
let _cache = null;
export function onRoadFast(x, z, margin = 1) {
  if (!_cache) _cache = roadRects();
  for (const r of _cache) {
    if (r.round) { if (Math.hypot(x - r.g.cx, z - r.g.cz) <= r.g.rOuter + margin) return true; continue; }
    if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) return true;
  }
  return false;
}

// Trafik ağı için yollar (metre). Göbek halkası ayrıca ringNodes() ile eklenir.
export function graphRoads() {
  return ROADS.filter(r => r.graph).map(r => ({ name: r.name, a: [r.x0 * U, r.z0 * U], b: [r.x1 * U, r.z1 * U], lanes: r.lanes, off: r.off, noMerge: r.noMerge }));
}

// Göbek halkasının düğümleri (metre): 8 köşe, saat yönünün tersine (sağdan trafik: doğu → kuzey → batı → güney).
// Açı θ doğudan güneye (+z) doğru ölçülür; sayfa yukarısı kuzey (−z). Saat yönünün tersi = θ azalır.
export function ringNodes(g = ROUNDABOUT) {
  const out = [];
  for (let k = 0; k < 8; k++) {
    const th = -k * Math.PI / 4;
    out.push({ x: (g.cx + g.rMid * Math.cos(th)) * U, z: (g.cz + g.rMid * Math.sin(th)) * U });
  }
  return out;
}

// Kavşaklar (iki şehir caddesinin kesiştiği/birleştiği noktalar): trafik ışığı konacak yerler. Otoyol ve göbek halkası hariç.
// { x, z (eski birim), ns, ew (yollar), from: { n, s, e, w } hangi yönden yaklaşım var }
export function intersections() {
  const city = ROADS.filter(r => r.graph && r.lanes === 1 && r.name !== 'site');
  const painted = (r, x, z) => paintSegments(r).some(sg => x >= sg.x0 - 0.01 && x <= sg.x1 + 0.01 && z >= sg.z0 - 0.01 && z <= sg.z1 + 0.01);
  const out = [];
  for (const a of city) if (a.ns) for (const b of city) if (!b.ns) {
    const x = a.x0, z = b.z0;
    if (z < Math.min(a.z0, a.z1) - 0.01 || z > Math.max(a.z0, a.z1) + 0.01) continue;
    if (x < Math.min(b.x0, b.x1) - 0.01 || x > Math.max(b.x0, b.x1) + 0.01) continue;
    if (ROUNDABOUTS.some(g => Math.hypot(x - g.cx, z - g.cz) < g.rOuter + 3)) continue;
    if (!painted(a, x, z) || !painted(b, x, z)) continue;
    out.push({ x, z, ns: a, ew: b, from: { n: Math.min(a.z0, a.z1) < z - 1, s: Math.max(a.z0, a.z1) > z + 1, w: Math.min(b.x0, b.x1) < x - 1, e: Math.max(b.x0, b.x1) > x + 1 } });
  }
  return out;
}
