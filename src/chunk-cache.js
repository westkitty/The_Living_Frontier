// Deterministic terrain chunk geometry, and a bounded cache for it.
//
// A chunk's mesh is a pure function of (i, j, segments): heightAt, fbm2 and
// valueNoise2 are seeded and immutable once the module has loaded, and the
// things that *do* change - burn scars, worn trails, lushness, development -
// are sampled from the ground-memory texture in the shader rather than baked
// into vertex colours. Nothing about the world simulation can therefore make a
// cached chunk mesh stale, which is what makes it safe to hand the same
// geometry back instead of recomputing it.
//
// That matters because streaming recomputes constantly: crossing one chunk
// seam re-LODs a whole row, and pacing back and forth across a boundary
// rebuilds identical geometry over and over. Building the height grid alone is
// ~1089 heightAt() calls for a 32-segment chunk, which measured as 64% of the
// chunk's total build cost.
//
// Vegetation is deliberately NOT cached here: scatter depends on live ground
// bytes, region tree multipliers, harvests and plantings, so it is rebuilt by
// veg.js every time and its instanced meshes are disposed on unload.
import * as THREE from 'three';
import { WORLD, heightAt } from './worldgen.js';
import { clamp, fbm2, valueNoise2 } from './rng.js';

// ---------------------------------------------------------------- biome paint
const cWater = new THREE.Color(0x3a5c52);
const cSand = new THREE.Color(0x9a8a63);
const cGrass = new THREE.Color(0x5f7a3c);
const cGrassDry = new THREE.Color(0x8a8c4c);
const cForest = new THREE.Color(0x3f5c30);
const cHigh = new THREE.Color(0x6a6a4e);
const cRock = new THREE.Color(0x6e6b66);
const cSnow = new THREE.Color(0xe9eef5);
const cMarsh = new THREE.Color(0x4d5c34);
const tmpC = new THREE.Color();

export function colorFor(h, slope, m, out) {
  if (h < 0.4) out.copy(cWater).lerp(cSand, clamp((h + 3) / 3.4, 0, 1));
  else if (h < 2.4) out.copy(cSand).lerp(m > 0.6 ? cMarsh : cGrass, clamp((h - 0.4) / 2.0, 0, 1));
  else if (h < 62) out.copy(cGrassDry).lerp(cGrass, clamp(m * 1.5, 0, 1)).lerp(cForest, clamp((m - 0.45) * 1.6, 0, 1));
  else if (h < 100) out.copy(cGrass).lerp(cHigh, clamp((h - 62) / 38, 0, 1));
  else if (h < 148) out.copy(cHigh).lerp(cRock, clamp((h - 100) / 48, 0, 1));
  else out.copy(cRock).lerp(cSnow, clamp((h - 148) / 30, 0, 1));
  if (slope > 0.32) out.lerp(cRock, clamp((slope - 0.32) * 2.2, 0, 0.9));
  return out;
}

// ------------------------------------------------------------------- builder
// Returns chunk-local geometry (the mesh is positioned at ox/oz by the caller)
// plus the height grid, which veg.js reuses to place scattered objects without
// re-evaluating the height field.
export function makeChunkGeometry(ci, cj, segs) {
  const C = WORLD.chunk;
  const ox = ci * C, oz = cj * C;
  const n = segs + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const heights = new Float32Array(n * n);
  const step = C / segs;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = ox + i * step, z = oz + j * step;
      heights[j * n + i] = heightAt(x, z);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const x = ox + i * step, z = oz + j * step;
      const h = heights[idx];
      const hl = heights[j * n + Math.max(0, i - 1)], hr = heights[j * n + Math.min(n - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * n + i], hu = heights[Math.min(n - 1, j + 1) * n + i];
      const sx = (hl - hr) / (2 * step), sz = (hd - hu) / (2 * step);
      let nx = sx, ny = 1, nz = sz;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const slope = 1 - ny;
      const m = clamp(fbm2(x * 0.0022 + 100, z * 0.0022 - 60, 3, WORLD.seed + 11) * 0.72 +
        (1 - clamp((h - 2) / 24, 0, 1)) * 0.3, 0, 1);
      colorFor(h, slope, m, tmpC);
      const grain = (valueNoise2(x * 0.09, z * 0.09, 7) - 0.5) * 0.07;
      positions[idx * 3] = i * step; positions[idx * 3 + 1] = h; positions[idx * 3 + 2] = j * step;
      normals[idx * 3] = nx; normals[idx * 3 + 1] = ny; normals[idx * 3 + 2] = nz;
      colors[idx * 3] = clamp(tmpC.r + grain, 0, 1);
      colors[idx * 3 + 1] = clamp(tmpC.g + grain, 0, 1);
      colors[idx * 3 + 2] = clamp(tmpC.b + grain, 0, 1);
    }
  }
  const indices = new Uint32Array(segs * segs * 6);
  let p = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const bytes = positions.byteLength + colors.byteLength + normals.byteLength +
    indices.byteLength + heights.byteLength;
  return { geo, heights, step, bytes };
}

// --------------------------------------------------------------------- cache
// Least-recently-used, bounded by total attribute bytes rather than entry
// count, because a 32-segment chunk costs ~14x a 8-segment one. Eviction
// disposes the geometry, which is also what releases its GPU buffers; a cached
// chunk that comes back into range is re-added without a fresh upload.
//
// Retaining geometry retains GPU memory, so the budget is deliberately modest
// and `dispose()` exists for teardown. At the default radius the whole visible
// set is ~1 MB, so 8 MB keeps a long walk's worth of ground warm.
export const DEFAULT_GEO_BUDGET = 8 * 1024 * 1024;

export class ChunkGeometryCache {
  constructor(budget = DEFAULT_GEO_BUDGET) {
    this.budget = budget;
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.entries = new Map();      // insertion order == recency order
  }

  get size() { return this.entries.size; }

  take(key) {
    const hit = this.entries.get(key);
    if (!hit) { this.misses++; return null; }
    // refresh recency: delete+set moves the key to the newest end
    this.entries.delete(key);
    this.entries.set(key, hit);
    this.hits++;
    return hit;
  }

  put(key, entry) {
    if (this.entries.has(key)) this.drop(key);
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    this.trim();
    return entry;
  }

  drop(key) {
    const e = this.entries.get(key);
    if (!e) return false;
    this.entries.delete(key);
    this.bytes -= e.bytes;
    return true;
  }

  trim() {
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.budget) break;
      const e = this.entries.get(key);
      this.entries.delete(key);
      this.bytes -= e.bytes;
      this.evictions++;
      e.geo.dispose();               // releases the GPU buffers with it
    }
  }

  // Raise or lower the budget at runtime (adaptive quality) and reconcile.
  setBudget(bytes) {
    this.budget = Math.max(0, bytes);
    this.trim();
  }

  dispose() {
    for (const e of this.entries.values()) e.geo.dispose();
    this.entries.clear();
    this.bytes = 0;
  }
}
