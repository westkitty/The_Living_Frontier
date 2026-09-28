// Streaming terrain chunks with LOD + the shared "ground memory" texture
// (burn scars, trails, lushness, development) that every surface samples.
import * as THREE from 'three';
import { WORLD, heightAt } from './worldgen.js';
import { clamp, fbm2, valueNoise2 } from './rng.js';

export const shared = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.7, 0.4) },
  uWindStrength: { value: 0.5 },
  uGround: { value: null },
  uWorldHalf: { value: WORLD.half },
  uSnow: { value: 0 },
  uWet: { value: 0 },
};

export function makeGroundTexture(state) {
  const tex = new THREE.DataTexture(state.ground, WORLD.stateRes, WORLD.stateRes, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  shared.uGround.value = tex;
  return tex;
}

const GROUND_CHUNK_VERT = /* glsl */`
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const GROUND_FRAG_HEAD = /* glsl */`
  uniform sampler2D uGround;
  uniform float uWorldHalf;
  uniform float uWet;
  uniform float uSnow;
  varying vec3 vWPos;
`;

const GROUND_FRAG_BODY = /* glsl */`
  vec2 gUv = (vWPos.xz + uWorldHalf) / (uWorldHalf * 2.0);
  vec4 gs = texture2D(uGround, gUv);
  float burn = gs.r, trail = gs.g, lush = gs.b, dev = gs.a;
  vec3 col = diffuseColor.rgb;
  col = mix(col, col * vec3(1.06, 1.12, 0.92), lush * 0.5);
  col = mix(col, vec3(0.33, 0.27, 0.20), clamp(trail * 1.15, 0.0, 0.88));
  col = mix(col, vec3(0.055, 0.048, 0.05), clamp(burn * 1.25, 0.0, 0.94));
  col = mix(col, vec3(0.42, 0.36, 0.28), dev * 0.55);
  col = mix(col, col * 0.72, uWet * 0.55);
  float snowMask = smoothstep(0.55, 1.0, uSnow) * smoothstep(60.0, 120.0, vWPos.y) * (1.0 - burn);
  col = mix(col, vec3(0.92, 0.94, 0.99), snowMask * 0.85);
  diffuseColor.rgb = col;
`;

export function applyGroundShader(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGround = shared.uGround;
    sh.uniforms.uWorldHalf = shared.uWorldHalf;
    sh.uniforms.uWet = shared.uWet;
    sh.uniforms.uSnow = shared.uSnow;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n' + GROUND_CHUNK_VERT);
    sh.fragmentShader = GROUND_FRAG_HEAD + sh.fragmentShader.replace(
      '#include <color_fragment>', '#include <color_fragment>\n' + GROUND_FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'groundshader';
  return mat;
}

// --------------------------------------------------------------------------
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

function colorFor(h, slope, m, out) {
  if (h < 0.4) out.copy(cWater).lerp(cSand, clamp((h + 3) / 3.4, 0, 1));
  else if (h < 2.4) out.copy(cSand).lerp(m > 0.6 ? cMarsh : cGrass, clamp((h - 0.4) / 2.0, 0, 1));
  else if (h < 62) out.copy(cGrassDry).lerp(cGrass, clamp(m * 1.5, 0, 1)).lerp(cForest, clamp((m - 0.45) * 1.6, 0, 1));
  else if (h < 100) out.copy(cGrass).lerp(cHigh, clamp((h - 62) / 38, 0, 1));
  else if (h < 148) out.copy(cHigh).lerp(cRock, clamp((h - 100) / 48, 0, 1));
  else out.copy(cRock).lerp(cSnow, clamp((h - 148) / 30, 0, 1));
  if (slope > 0.32) out.lerp(cRock, clamp((slope - 0.32) * 2.2, 0, 0.9));
  return out;
}

export class ChunkManager {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.chunks = new Map();
    this.queue = [];
    this.radius = 3;
    this.vegRadius = 1;
    this.material = applyGroundShader(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.material.side = THREE.FrontSide;
    this.onChunkBuild = null;      // set by vegetation system
    this.onChunkRemove = null;
    this.center = { i: 9999, j: 9999 };
  }

  keyOf(i, j) { return i + ',' + j; }

  update(px, pz, budget = 2) {
    const C = WORLD.chunk;
    const ci = Math.floor(px / C), cj = Math.floor(pz / C);
    if (ci !== this.center.i || cj !== this.center.j) {
      this.center = { i: ci, j: cj };
      this.rebuildList(ci, cj);
    }
    let built = 0;
    while (this.queue.length && built < budget) {
      const t = this.queue.shift();
      const k = this.keyOf(t.i, t.j);
      const existing = this.chunks.get(k);
      if (existing && existing.lod === t.lod) continue;
      if (existing) this.disposeChunk(k);
      this.buildChunk(t.i, t.j, t.lod, t.ring);
      built++;
    }
  }

  rebuildList(ci, cj) {
    const wanted = new Set();
    const list = [];
    for (let j = -this.radius; j <= this.radius; j++) {
      for (let i = -this.radius; i <= this.radius; i++) {
        const ring = Math.max(Math.abs(i), Math.abs(j));
        const lod = ring <= 1 ? 32 : ring === 2 ? 16 : 8;
        const gi = ci + i, gj = cj + j;
        const k = this.keyOf(gi, gj);
        wanted.add(k);
        const ex = this.chunks.get(k);
        if (!ex || ex.lod !== lod) list.push({ i: gi, j: gj, lod, ring, d: i * i + j * j });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this.queue = list;
    for (const k of [...this.chunks.keys()]) if (!wanted.has(k)) this.disposeChunk(k);
    // chunks that stay but change ring (grass only lives in the closest ring)
    for (let j = -this.radius; j <= this.radius; j++) {
      for (let i = -this.radius; i <= this.radius; i++) {
        const k = this.keyOf(ci + i, cj + j);
        const ex = this.chunks.get(k);
        if (!ex) continue;
        const ring = Math.max(Math.abs(i), Math.abs(j));
        if (ex.ring !== ring) { ex.ring = ring; if (this.onRingChange) this.onRingChange(k, ex, ring); }
      }
    }
  }

  disposeChunk(k) {
    const c = this.chunks.get(k);
    if (!c) return;
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (this.onChunkRemove) this.onChunkRemove(k, c);
    this.chunks.delete(k);
  }

  buildChunk(ci, cj, segs, ring) {
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

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = ring <= 1;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    const rec = { mesh, lod: segs, ring, i: ci, j: cj, ox, oz, heights, segs, step };
    this.chunks.set(this.keyOf(ci, cj), rec);
    if (this.onChunkBuild) this.onChunkBuild(this.keyOf(ci, cj), rec, ring);
  }
}

// --------------------------------------------------------------------------
export function makeWater(scene) {
  const geo = new THREE.PlaneGeometry(WORLD.size * 1.6, WORLD.size * 1.6, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2f5a63, transparent: true, opacity: 0.82, depthWrite: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = 'uniform float uTime;\nvarying vec3 vWP;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 wp = (modelMatrix * vec4(transformed,1.0)).xyz;
       transformed.y += sin(wp.x * 0.06 + uTime * 1.1) * 0.22 + sin(wp.z * 0.045 - uTime * 0.8) * 0.20;
       vWP = wp;`);
    sh.fragmentShader = 'varying vec3 vWP;\nuniform float uTime;\n' + sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float ripple = sin(vWP.x*0.55 + uTime*1.7) * sin(vWP.z*0.5 - uTime*1.3);
       diffuseColor.rgb += ripple * 0.035;
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62,0.80,0.83), smoothstep(0.75,1.0,ripple)*0.35);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.water - 0.05;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}
