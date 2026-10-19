// Duman testi: tarayıcı olmadan şehri/dünyayı kurar ve çalışma anı hatalarını yakalar.
//   node tools/smoke.mjs
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const noop = () => {};
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return noop;
  },
  set: (t, k, v) => { t[k] = v; return true; }
});
const mkCanvas = () => ({ width: 1, height: 1, style: {}, getContext: () => ctxStub, addEventListener: noop });
globalThis.document = { createElement: () => mkCanvas(), getElementById: () => null, body: { appendChild: noop }, head: { appendChild: noop }, addEventListener: noop };
globalThis.window = globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.addEventListener = noop;

const { VoxelWorld } = await import('../src/teardown.js');
const { LevelManager } = await import('../src/levels.js');
const { CarManager } = await import('../src/cars.js');

const scene = new THREE.Scene();
const physics = new CANNON.World();
const ps = new Proxy({}, { get: () => noop });
const vw = new VoxelWorld(scene, physics, ps, noop);
const lm = new LevelManager(vw);
const t0 = Date.now();
const cfg = lm.loadLevel(0);
console.log('Dünya kuruldu:', Date.now() - t0, 'ms | voxel:', vw.voxels.size, '| prop:', vw.propSpawns.length, '| işçi:', (vw.workers || []).length, '| köpek/kedi:', (vw.dogs || []).length);
const cars = new CarManager(scene, vw, ps, noop, noop);
cars.build();
console.log('Trafik ağı: kenar', cars.edges.length, '| araç', cars.cars.length);
const b = vw.terrain.bounds;
console.log('Zemin sınırı:', b ? `${b.cols}x${b.rows} hücre` : 'yok');
console.log('Spawn:', JSON.stringify(cfg.spawn));
console.log('TAMAM: çalışma anı hatası yok');
