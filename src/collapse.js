import * as THREE from 'three';
import { sound } from './audio.js';
import { VOXEL_SIZE } from './teardown.js';

// ─────────────────────────────────────────────────────────────────────────────
// YAPISAL ÇÖKME: bir bina ikiye bölünürse, zemine bağlı olmayan üst parça yerçekimiyle aşağı düşer.
//  1) Voxel kaldırılınca komşuları "tohum" olarak sıraya alınır.
//  2) Tohumdan başlayarak (önce aşağı) bağlantılı küpler gezilir; zemine ulaşılırsa yapı sağlamdır.
//  3) Zemine ulaşılamazsa o küp topluluğu tek parça halinde düşer, çarpınca yerine oturur
//     (hızlı düşerse bir kısmı kırılıp dağılır). Oturan küpler yine kırılabilir.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_COMPONENT = 60000;   // bundan büyük topluluk "zemine bağlı" sayılır
const BUDGET_MS = 6;           // kare başına bağlantı kontrolü süresi
const MAX_CHUNKS = 10;
const GRAVITY = 22;
const key = (x, y, z) => `${x},${y},${z}`;
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]; // önce aşağı

export class CollapseSystem {
  constructor(voxelWorld) {
    this.vw = voxelWorld;
    this.seeds = new Set();
    this.ok = new Set(); // zemine bağlı bulunan küpler (tohum kuyruğu bitene kadar saklanır)
    this.chunks = [];
    this.onShake = null;
  }

  // Kaldırılan voxelin komşularını kontrol sırasına ekle
  queue(v) {
    if (this.seeds.size > 600000) return;
    for (const [dx, dy, dz] of DIRS) this.seeds.add(key(v.ix + dx, v.iy + dy, v.iz + dz));
  }

  // Voxel zemine (arazi üst/alt katmanı) oturuyor mu?
  _grounded(v) {
    if (v.groundCell !== undefined) return true;
    const t = this.vw.terrain;
    if (v.y - VOXEL_SIZE / 2 <= -1.0) return true; // deniz tabanına inen kazık/ayak
    const h = t.heightAt(v.x, v.z);
    return h > -Infinity && v.y - VOXEL_SIZE / 2 <= h + 1e-3;
  }

  update(dt) {
    this._processSeeds();
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this._stepChunk(this.chunks[i], dt)) this.chunks.splice(i, 1);
    }
  }

  _processSeeds() {
    if (this.seeds.size === 0) { this.ok.clear(); return; }
    const t0 = performance.now();
    const ok = this.ok;
    for (const k of this.seeds) {
      this.seeds.delete(k);
      if (ok.has(k)) continue;
      const v = this.vw.voxels.get(k);
      if (!v || !v.active) continue;
      this._checkComponent(v, ok);
      if (performance.now() - t0 > BUDGET_MS) break;
    }
  }

  _checkComponent(start, ok) {
    const vox = this.vw.voxels;
    const visited = new Map();
    const stack = [start];
    visited.set(key(start.ix, start.iy, start.iz), start);
    let grounded = false;

    while (stack.length) {
      const v = stack.pop();
      if (this._grounded(v)) { grounded = true; break; }
      for (let d = DIRS.length - 1; d >= 0; d--) { // sondan başa: "aşağı" en son itilir, ilk çıkar
        const [dx, dy, dz] = DIRS[d];
        const k = key(v.ix + dx, v.iy + dy, v.iz + dz);
        if (visited.has(k)) continue;
        if (ok.has(k)) { grounded = true; break; }
        const n = vox.get(k);
        if (!n || !n.active) continue;
        visited.set(k, n);
        stack.push(n);
      }
      if (grounded || visited.size > MAX_COMPONENT) { grounded = true; break; }
    }

    if (grounded) { for (const k of visited.keys()) ok.add(k); return; }
    if (this.chunks.length >= MAX_CHUNKS) return;
    this._makeChunk(Array.from(visited.values()));
  }

  // ── Düşen parça ──
  _makeChunk(list) {
    const vw = this.vw;
    const byType = new Map();
    list.forEach(v => {
      vw.voxels.delete(key(v.ix, v.iy, v.iz));
      vw._hideVoxel(v);                       // eski örneği gizle
      if (!byType.has(v.type.id)) byType.set(v.type.id, []);
      byType.get(v.type.id).push(v);
    });

    const dummy = new THREE.Object3D();
    const meshes = [];
    for (const [typeId, vs] of byType.entries()) {
      const mesh = new THREE.InstancedMesh(vw.cubeGeo, vw.materials[typeId], vs.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      vs.forEach((v, i) => {
        dummy.position.set(v.x, v.y, v.z); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        v.mesh = mesh; v.instanceIdx = i;
      });
      mesh.instanceMatrix.needsUpdate = true;
      vw.scene.add(mesh);
      meshes.push(mesh);
    }

    // Her (ix, iz) sütununun en alt küpü: çarpışma kontrolü için
    const bottoms = new Map();
    list.forEach(v => {
      const c = `${v.ix},${v.iz}`;
      const b = bottoms.get(c);
      if (!b || v.iy < b.iy) bottoms.set(c, v);
    });

    this.chunks.push({ list, meshes, bottoms: Array.from(bottoms.values()), shift: 0, acc: 0, vy: 0 });
    sound.playBlockHit();
  }

  _canMoveDown(c) {
    const vox = this.vw.voxels, t = this.vw.terrain;
    for (const b of c.bottoms) {
      const iy = b.iy - c.shift;
      const n = vox.get(key(b.ix, iy - 1, b.iz));
      if (n && n.active) return false;
      const h = t.heightAt(b.x, b.z);
      if (h > -Infinity && (iy - 1) * VOXEL_SIZE < h - 1e-6) return false;
    }
    return true;
  }

  // true dönerse parça artık yok (yerine oturdu ya da denize düştü)
  _stepChunk(c, dt) {
    c.vy = Math.min(30, c.vy + GRAVITY * dt);
    c.acc += c.vy * dt;
    while (c.acc >= VOXEL_SIZE) {
      if (!this._canMoveDown(c)) { this._land(c); return true; }
      c.shift++; c.acc -= VOXEL_SIZE;
      // Denize düşen parça kaybolur
      if (c.bottoms[0] && (c.bottoms[0].iy - c.shift) * VOXEL_SIZE < -8) { this._dispose(c); return true; }
    }
    c.meshes.forEach(m => { m.position.y = -(c.shift * VOXEL_SIZE + c.acc); });
    return false;
  }

  _dispose(c) {
    c.meshes.forEach(m => { this.vw.scene.remove(m); m.dispose(); });
  }

  _land(c) {
    const vw = this.vw;
    const impact = c.vy;
    const dummy = new THREE.Object3D();
    const shatter = impact > 5 ? Math.min(0.45, impact / 60) : 0; // hızlı çarpan parça kırılır
    let broken = 0, debris = 0;

    c.list.forEach(v => {
      const niy = v.iy - c.shift;
      const nk = key(v.ix, niy, v.iz);
      const drop = Math.random() < shatter || vw.voxels.has(nk);
      if (drop) {
        v.active = false;
        vw._hideVoxel(v);
        broken++;
        if (debris < 50 && vw.dynamicDebris.length < vw.maxDynamicDebris) {
          debris++;
          vw.spawnLooseVoxel(v.x, v.y - c.shift * VOXEL_SIZE, v.z, v.type,
            { x: v.x, y: v.y - c.shift * VOXEL_SIZE - 1, z: v.z }, 0.5, 3, 30);
        }
        return;
      }
      v.iy = niy;
      v.y = niy * VOXEL_SIZE + VOXEL_SIZE / 2;
      vw.voxels.set(nk, v);
      dummy.position.set(v.x, v.y, v.z); dummy.updateMatrix();
      v.mesh.setMatrixAt(v.instanceIdx, dummy.matrix);
    });
    c.meshes.forEach(m => { m.position.y = 0; m.instanceMatrix.needsUpdate = true; });
    vw.destroyedVoxels += broken;

    // Toz ve çarpma etkisi
    const low = c.bottoms[Math.floor(c.bottoms.length / 2)];
    if (low) {
      const p = new THREE.Vector3(low.x, low.y - c.shift * VOXEL_SIZE, low.z);
      vw.particleSystem.createExplosion(p, Math.min(9, 3 + c.list.length / 4000), 0x9c9484);
    }
    sound.playExplosion(Math.min(2, 0.6 + c.list.length / 8000));
    if (this.onShake) this.onShake(Math.min(0.6, 0.1 + c.list.length / 15000));
  }

  clear() {
    this.seeds.clear();
    this.chunks.forEach(c => this._dispose(c));
    this.chunks = [];
  }
}
