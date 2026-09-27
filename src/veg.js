// Procedural, instanced vegetation. Trees can be harvested, burned (they turn
// to charred snags) and regrow - all driven by the persistent world state.
import * as THREE from 'three';
import { WORLD, treeDensityFrom, heightAt, moistureFrom, slopeAt } from './worldgen.js';
import { hash2i, clamp, lerp, mulberry32 } from './rng.js';
import { shared } from './terrain.js';
import { CH, regionIndex } from './worldstate.js';

// ---------------------------------------------------------------- geometry
function ensureIndex(geo) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geo;
}

function mergeGeos(parts) {
  let vCount = 0, iCount = 0;
  for (const p of parts) { ensureIndex(p.geo); vCount += p.geo.attributes.position.count; iCount += p.geo.index.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo; const n = g.attributes.position.count;
    const gp = g.attributes.position.array, gn = g.attributes.normal.array;
    c.set(p.color);
    for (let i = 0; i < n; i++) {
      pos[(vo + i) * 3] = gp[i * 3]; pos[(vo + i) * 3 + 1] = gp[i * 3 + 1]; pos[(vo + i) * 3 + 2] = gp[i * 3 + 2];
      nor[(vo + i) * 3] = gn[i * 3]; nor[(vo + i) * 3 + 1] = gn[i * 3 + 1]; nor[(vo + i) * 3 + 2] = gn[i * 3 + 2];
      const j = p.jitter ? (hash2i(i * 13, vo + 7, 3) - 0.5) * p.jitter : 0;
      col[(vo + i) * 3] = clamp(c.r + j, 0, 1); col[(vo + i) * 3 + 1] = clamp(c.g + j, 0, 1); col[(vo + i) * 3 + 2] = clamp(c.b + j, 0, 1);
    }
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function translated(geo, x, y, z) { geo.translate(x, y, z); return geo; }

function pineGeo() {
  const parts = [
    { geo: translated(new THREE.CylinderGeometry(0.28, 0.42, 3.2, 5), 0, 1.6, 0), color: 0x4a3524, jitter: 0.05 },
    { geo: translated(new THREE.ConeGeometry(2.5, 5.0, 7), 0, 4.6, 0), color: 0x2f5227, jitter: 0.07 },
    { geo: translated(new THREE.ConeGeometry(1.9, 4.2, 7), 0, 7.0, 0), color: 0x365c2b, jitter: 0.07 },
    { geo: translated(new THREE.ConeGeometry(1.15, 3.2, 6), 0, 9.3, 0), color: 0x3d6630, jitter: 0.07 },
  ];
  return mergeGeos(parts);
}
function broadGeo() {
  const parts = [
    { geo: translated(new THREE.CylinderGeometry(0.34, 0.55, 4.0, 5), 0, 2.0, 0), color: 0x54402c, jitter: 0.05 },
    { geo: translated(new THREE.IcosahedronGeometry(2.7, 0), 0, 5.6, 0), color: 0x4a7233, jitter: 0.09 },
    { geo: translated(new THREE.IcosahedronGeometry(1.9, 0), 1.7, 4.4, 0.6), color: 0x41682d, jitter: 0.09 },
    { geo: translated(new THREE.IcosahedronGeometry(1.7, 0), -1.5, 4.8, -0.8), color: 0x517c38, jitter: 0.09 },
  ];
  return mergeGeos(parts);
}
function charredGeo() {
  const parts = [
    { geo: translated(new THREE.CylinderGeometry(0.2, 0.45, 4.2, 5), 0, 2.1, 0), color: 0x241f1d, jitter: 0.03 },
    { geo: translated(new THREE.CylinderGeometry(0.08, 0.16, 1.8, 4).rotateZ(0.7), 0.7, 3.6, 0), color: 0x2a2422, jitter: 0.03 },
    { geo: translated(new THREE.CylinderGeometry(0.07, 0.14, 1.4, 4).rotateZ(-0.9), -0.6, 3.1, 0.3), color: 0x2a2422, jitter: 0.03 },
  ];
  return mergeGeos(parts);
}
function bushGeo() {
  const parts = [
    { geo: translated(new THREE.IcosahedronGeometry(0.9, 0), 0, 0.75, 0), color: 0x3f6b30, jitter: 0.1 },
    { geo: translated(new THREE.IcosahedronGeometry(0.62, 0), 0.7, 0.5, 0.35), color: 0x497a36, jitter: 0.1 },
  ];
  return mergeGeos(parts);
}
function berryBushGeo() {
  const parts = [
    { geo: translated(new THREE.IcosahedronGeometry(0.95, 0), 0, 0.8, 0), color: 0x38652c, jitter: 0.08 },
    { geo: translated(new THREE.IcosahedronGeometry(0.22, 0), 0.6, 1.2, 0.3), color: 0xa02a3a, jitter: 0.05 },
    { geo: translated(new THREE.IcosahedronGeometry(0.2, 0), -0.5, 1.0, -0.4), color: 0xb23245, jitter: 0.05 },
    { geo: translated(new THREE.IcosahedronGeometry(0.18, 0), 0.1, 1.45, -0.2), color: 0x981f33, jitter: 0.05 },
  ];
  return mergeGeos(parts);
}
function rockGeo() {
  const parts = [
    { geo: translated(new THREE.DodecahedronGeometry(1.0, 0), 0, 0.55, 0), color: 0x6c6a66, jitter: 0.12 },
    { geo: translated(new THREE.DodecahedronGeometry(0.55, 0), 0.9, 0.3, 0.3), color: 0x5f5d59, jitter: 0.12 },
  ];
  return mergeGeos(parts);
}
function oreRockGeo() {
  const parts = [
    { geo: translated(new THREE.DodecahedronGeometry(1.05, 0), 0, 0.6, 0), color: 0x59574f, jitter: 0.1 },
    { geo: translated(new THREE.OctahedronGeometry(0.42, 0), 0.5, 1.1, 0.2), color: 0xb98b3a, jitter: 0.06 },
    { geo: translated(new THREE.OctahedronGeometry(0.3, 0), -0.45, 0.85, -0.35), color: 0xcfa04a, jitter: 0.06 },
  ];
  return mergeGeos(parts);
}
function grassGeo() {
  const blade = (a) => {
    const g = new THREE.PlaneGeometry(0.5, 0.85, 1, 1);
    g.translate(0, 0.42, 0); g.rotateY(a);
    return g;
  };
  return mergeGeos([
    { geo: blade(0), color: 0x6d8a3e, jitter: 0.12 },
    { geo: blade(Math.PI / 2), color: 0x63803a, jitter: 0.12 },
  ]);
}
function fernGeo() {
  return mergeGeos([
    { geo: translated(new THREE.ConeGeometry(0.55, 1.1, 4), 0, 0.55, 0), color: 0x486b2c, jitter: 0.1 },
  ]);
}
function saplingGeo() {
  return mergeGeos([
    { geo: translated(new THREE.CylinderGeometry(0.06, 0.09, 1.0, 4), 0, 0.5, 0), color: 0x5a442e, jitter: 0.04 },
    { geo: translated(new THREE.ConeGeometry(0.5, 1.2, 5), 0, 1.3, 0), color: 0x59a044, jitter: 0.08 },
  ]);
}

// ------------------------------------------------------------------ material
export function makeFoliageMaterial(swayAmount = 1.0, extraGlsl = '') {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = shared.uWind;
    sh.uniforms.uWindStrength = shared.uWindStrength;
    sh.uniforms.uGround = shared.uGround;
    sh.uniforms.uWorldHalf = shared.uWorldHalf;
    sh.uniforms.uSway = { value: swayAmount };
    sh.vertexShader = `
      uniform float uTime; uniform vec2 uWind; uniform float uWindStrength; uniform float uSway;
      varying vec3 vWPos;
    ` + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
      float h = max(transformed.y, 0.0);
      float phase = iw.x * 0.22 + iw.z * 0.19;
      float gust = sin(uTime * 1.35 + phase) * 0.6 + sin(uTime * 0.52 + phase * 0.7) * 0.4;
      float bend = gust * uWindStrength * uSway * pow(h * 0.16, 1.35);
      transformed.x += uWind.x * bend;
      transformed.z += uWind.y * bend;
      vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
    `);
    sh.fragmentShader = `
      uniform sampler2D uGround; uniform float uWorldHalf; varying vec3 vWPos;
    ` + sh.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec4 gs = texture2D(uGround, (vWPos.xz + uWorldHalf) / (uWorldHalf * 2.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.30,0.26,0.24), gs.r * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05,1.15,0.92), gs.b * 0.35);
      ${extraGlsl}
    `);
  };
  mat.customProgramCacheKey = () => 'foliage' + swayAmount + extraGlsl.length;
  return mat;
}

// ------------------------------------------------------------------- system
const TYPES = ['pine', 'broad', 'charred', 'bush', 'berry', 'rock', 'ore', 'fern', 'sapling'];

export class Vegetation {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.geos = {
      pine: pineGeo(), broad: broadGeo(), charred: charredGeo(), bush: bushGeo(),
      berry: berryBushGeo(), rock: rockGeo(), ore: oreRockGeo(), fern: fernGeo(),
      grass: grassGeo(), sapling: saplingGeo(),
    };
    this.matTree = makeFoliageMaterial(1.0);
    this.matSmall = makeFoliageMaterial(1.6);
    this.matRock = makeFoliageMaterial(0.0);
    this.matGrass = makeFoliageMaterial(2.6);
    this.matGrass.side = THREE.DoubleSide;
    this.chunks = new Map();
    this.dummy = new THREE.Object3D();
    this.plantings = state.plantings || [];
  }

  capFor(type, ring) {
    if (ring > 1) return 0;
    switch (type) {
      case 'pine': case 'broad': return 150;
      case 'charred': return 90;
      case 'bush': return 90;
      case 'berry': return 26;
      case 'rock': return 70;
      case 'ore': return 12;
      case 'fern': return 80;
      case 'sapling': return 24;
      default: return 0;
    }
  }

  // Sample the terrain chunk's own height grid instead of re-evaluating the
  // (expensive) height function for every scattered object.
  sampler(rec) {
    const { heights, segs, ox, oz, step } = rec;
    if (!heights) return null;
    const n = segs + 1;
    const at = (i, j) => heights[clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1)];
    return {
      h(x, z) {
        const fx = (x - ox) / step, fz = (z - oz) / step;
        const i = Math.floor(fx), j = Math.floor(fz);
        const tx = fx - i, tz = fz - j;
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
      },
      slope(x, z) {
        const fx = (x - ox) / step, fz = (z - oz) / step;
        const i = Math.round(fx), j = Math.round(fz);
        const dx = (at(i - 1, j) - at(i + 1, j)) / (2 * step);
        const dz = (at(i, j - 1) - at(i, j + 1)) / (2 * step);
        return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
      },
    };
  }

  buildChunk(key, rec, ring) {
    if (ring > 1) return;
    const C = WORLD.chunk, ox = rec.ox, oz = rec.oz;
    const st = this.state;
    const smp = this.sampler(rec);
    const H = smp ? smp.h : heightAt;
    const SL = smp ? smp.slope : slopeAt;
    const buckets = {}; for (const t of TYPES) buckets[t] = [];
    const items = [];
    const rnd = mulberry32((rec.i * 73856093) ^ (rec.j * 19349663) ^ WORLD.seed);
    const regionTrees = (x, z) => st.regions[regionIndex(x, z)].trees;

    const N = 300;   // scatter attempts for trees & friends
    for (let s = 0; s < N; s++) {
      const x = ox + rnd() * C, z = oz + rnd() * C;
      const h = H(x, z);
      if (h < 1.0 || h > 150) continue;
      const slope = SL(x, z);
      if (slope > 0.55) continue;
      const moist = moistureFrom(h, x, z);
      const dens = treeDensityFrom(h, moist, slope, x, z) * regionTrees(x, z);
      const burn = st.getGround(x, z, CH.BURN);
      const lush = st.getGround(x, z, CH.LUSH);
      const dev = st.getGround(x, z, CH.DEV);
      const trail = st.getGround(x, z, CH.TRAIL);
      const id = s;
      if (st.vegIsRemoved(key, id)) continue;
      if (trail > 0.45 && rnd() < 0.85) continue;
      if (dev > 0.35 && rnd() < 0.7) continue;

      let type = null;
      const r = rnd();
      if (r < dens * (1 - burn * 0.9) * 0.85) {
        type = moist > 0.55 ? (rnd() < 0.55 ? 'broad' : 'pine') : (rnd() < 0.3 ? 'broad' : 'pine');
        if (h > 96) type = 'pine';
      } else if (burn > 0.25 && r < 0.25 + burn * 0.4) {
        type = 'charred';
      } else if (r < 0.30) {
        const rr = rnd();
        if (rr < 0.13 && dens > 0.18) type = 'berry';
        else if (rr < 0.5) type = dens > 0.25 ? 'fern' : 'bush';
        else if (rr < 0.92) type = 'rock';
        else type = 'ore';
      }
      if (!type) continue;
      if (type === 'ore' && (h < 45 || rnd() > 0.5)) continue;
      if ((type === 'fern' || type === 'berry') && burn > 0.3) continue;
      const cap = this.capFor(type, ring);
      if (buckets[type].length >= cap) continue;

      const y = h;
      const scale = (type === 'pine' || type === 'broad')
        ? (0.72 + rnd() * 0.75) * lerp(0.75, 1.15, lush)
        : 0.6 + rnd() * 0.8;
      const rot = rnd() * Math.PI * 2;
      const iIndex = buckets[type].length;
      buckets[type].push({ x, y, z, scale, rot });
      items.push({ id, type, i: iIndex, x, y, z, scale });
    }

    // player-planted saplings inside this chunk
    for (const p of st.plantings || []) {
      if (p.x < ox || p.x >= ox + C || p.z < oz || p.z >= oz + C) continue;
      const age = st.elapsed - p.t;
      const grown = clamp(age / 600, 0, 1);
      const type = grown > 0.95 ? (p.kind || 'pine') : 'sapling';
      const cap = this.capFor(type, ring);
      if (buckets[type].length >= cap) continue;
      const i = buckets[type].length;
      const scale = type === 'sapling' ? 0.6 + grown * 0.9 : 0.55 + grown * 0.4;
      const py = H(p.x, p.z);
      buckets[type].push({ x: p.x, y: py, z: p.z, scale, rot: p.r || 0 });
      items.push({ id: 'p' + p.id, type, i, x: p.x, y: py, z: p.z, scale, planted: true });
    }

    const meshes = {};
    for (const t of TYPES) {
      const arr = buckets[t];
      if (!arr.length) continue;
      const mat = (t === 'rock' || t === 'ore' || t === 'charred') ? this.matRock
        : (t === 'pine' || t === 'broad') ? this.matTree : this.matSmall;
      const mesh = new THREE.InstancedMesh(this.geos[t], mat, arr.length);
      mesh.castShadow = (t === 'pine' || t === 'broad' || t === 'charred') && ring === 0;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        this.dummy.position.set(a.x, a.y, a.z);
        this.dummy.rotation.set(0, a.rot, 0);
        this.dummy.scale.setScalar(a.scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      meshes[t] = mesh;
    }

    this.chunks.set(key, { meshes, grassMesh: null, items, ring, rec });
    if (ring === 0) this.buildGrass(key);
  }

  // Grass only exists in the ring of chunks the player is standing in.
  buildGrass(key) {
    const c = this.chunks.get(key);
    if (!c || c.grassMesh) return;
    const rec = c.rec, C = WORLD.chunk, ox = rec.ox, oz = rec.oz;
    const smp = this.sampler(rec);
    const H = smp ? smp.h : heightAt;
    const SL = smp ? smp.slope : slopeAt;
    const rnd = mulberry32((rec.i * 9176) ^ (rec.j * 31337) ^ 77);
    const tmp = [];
    for (let s = 0; s < 700; s++) {
      const x = ox + rnd() * C, z = oz + rnd() * C;
      const h = H(x, z);
      if (h < 0.9 || h > 120) continue;
      if (SL(x, z) > 0.5) continue;
      if (this.state.getGround(x, z, CH.BURN) > 0.35) continue;
      if (this.state.getGround(x, z, CH.TRAIL) > 0.5) continue;
      tmp.push([x, h, z, 0.6 + rnd() * 1.1, rnd() * 3.14]);
    }
    if (!tmp.length) return;
    const mesh = new THREE.InstancedMesh(this.geos.grass, this.matGrass, tmp.length);
    for (let i = 0; i < tmp.length; i++) {
      const a = tmp[i];
      this.dummy.position.set(a[0], a[1], a[2]);
      this.dummy.rotation.set(0, a[4], 0);
      this.dummy.scale.set(a[3], a[3] * (0.8 + (i % 5) * 0.12), a[3]);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    c.grassMesh = mesh;
  }

  setRing(key, ring) {
    const c = this.chunks.get(key);
    if (!c) return;
    c.ring = ring;
    if (ring === 0) this.buildGrass(key);
    else if (c.grassMesh) { this.scene.remove(c.grassMesh); c.grassMesh.dispose(); c.grassMesh = null; }
  }

  removeChunk(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    for (const t in c.meshes) { this.scene.remove(c.meshes[t]); c.meshes[t].dispose(); }
    if (c.grassMesh) { this.scene.remove(c.grassMesh); c.grassMesh.dispose(); }
    this.chunks.delete(key);
  }

  rebuild(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    const rec = c.rec, ring = c.ring;
    this.removeChunk(key);
    this.buildChunk(key, rec, ring);
  }

  // Hide a single instance instantly (used when harvesting / felling).
  hideInstance(key, item) {
    const c = this.chunks.get(key);
    if (!c) return;
    const mesh = c.meshes[item.type];
    if (!mesh) return;
    this.dummy.position.set(item.x, -9999, item.z);
    this.dummy.scale.setScalar(0.001);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(item.i, this.dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Find nearest harvestable within radius
  nearest(x, z, radius = 3.2, filter = null) {
    let best = null, bd = radius * radius;
    const cull = (WORLD.chunk * 0.75 + radius) ** 2;
    for (const [key, c] of this.chunks) {
      const cx = c.rec.ox + WORLD.chunk * 0.5, cz = c.rec.oz + WORLD.chunk * 0.5;
      if ((cx - x) ** 2 + (cz - z) ** 2 > cull) continue;
      for (const it of c.items) {
        if (filter && !filter(it)) continue;
        const dx = it.x - x, dz = it.z - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = { key, item: it }; }
      }
    }
    return best;
  }
}
