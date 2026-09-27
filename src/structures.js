// Procedural landmarks, settlements and faction outposts.
// Each is merged into a single geometry so the whole world costs few draw calls.
import * as THREE from 'three';
import { WORLD, LANDMARKS, SETTLEMENTS, FACTIONS, heightAt, settlementGroundY, caveFloor } from './worldgen.js';
import { mulberry32, clamp, lerp } from './rng.js';
import { applyGroundShader } from './terrain.js';
import { regionIndex } from './worldstate.js';

class Builder {
  constructor() { this.parts = []; }
  add(geo, color, jitter = 0.04) { this.parts.push({ geo, color, jitter }); return this; }
  box(w, h, d, x, y, z, color, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color);
  }
  cyl(rt, rb, h, seg, x, y, z, color, rot) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rot) { g.rotateX(rot[0] || 0); g.rotateZ(rot[2] || 0); g.rotateY(rot[1] || 0); }
    g.translate(x, y, z);
    return this.add(g, color);
  }
  cone(r, h, seg, x, y, z, color, ry = 0) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, color);
  }
  rock(r, x, y, z, color) {
    const g = new THREE.DodecahedronGeometry(r, 0);
    g.translate(x, y, z);
    return this.add(g, color, 0.1);
  }
  arch(x, y, z, w, h, t, color, steps = 7) {
    // a semicircular arch made of trapezoid-ish boxes
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * (i / steps);
      const ax = x - Math.cos(a) * w * 0.5;
      const ay = y + Math.sin(a) * w * 0.5;
      const g = new THREE.BoxGeometry(t * 1.25, h, t);
      g.rotateZ(-a + Math.PI / 2);
      g.translate(ax, ay, z);
      this.add(g, color, 0.05);
    }
    return this;
  }
  build(flat = true) {
    const parts = this.parts.filter(p => p.geo.attributes && p.geo.attributes.position);
    let vC = 0, iC = 0;
    for (const p of parts) {
      if (!p.geo.index) {
        const n = p.geo.attributes.position.count;
        const seq = new Uint32Array(n);
        for (let i = 0; i < n; i++) seq[i] = i;
        p.geo.setIndex(new THREE.BufferAttribute(seq, 1));
      }
      vC += p.geo.attributes.position.count; iC += p.geo.index.count;
    }
    const pos = new Float32Array(vC * 3), nor = new Float32Array(vC * 3), col = new Float32Array(vC * 3);
    const idx = vC > 65000 ? new Uint32Array(iC) : new Uint16Array(iC);
    let vo = 0, io = 0; const c = new THREE.Color();
    for (const p of parts) {
      const g = p.geo, n = g.attributes.position.count;
      const gp = g.attributes.position.array, gn = g.attributes.normal.array;
      c.set(p.color);
      for (let i = 0; i < n; i++) {
        pos[(vo + i) * 3] = gp[i * 3]; pos[(vo + i) * 3 + 1] = gp[i * 3 + 1]; pos[(vo + i) * 3 + 2] = gp[i * 3 + 2];
        nor[(vo + i) * 3] = gn[i * 3]; nor[(vo + i) * 3 + 1] = gn[i * 3 + 1]; nor[(vo + i) * 3 + 2] = gn[i * 3 + 2];
        const j = (Math.sin((vo + i) * 12.9898) * 43758.5453 % 1) * p.jitter;
        col[(vo + i) * 3] = clamp(c.r + j, 0, 1); col[(vo + i) * 3 + 1] = clamp(c.g + j, 0, 1); col[(vo + i) * 3 + 2] = clamp(c.b + j, 0, 1);
      }
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += n; io += gi.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.parts = [];
    return geo;
  }
}

const STONE = 0x8d8577, STONE_D = 0x6f6a60, WOOD = 0x6b4f33, WOOD_D = 0x4c3823;
const THATCH = 0xa98b4e, DARK = 0x39332c, BONE = 0xb9b2a0;

export function makeStructureMaterial() {
  const m = applyGroundShader(new THREE.MeshLambertMaterial({ vertexColors: true }));
  return m;
}

// ---------------------------------------------------------------- landmarks
function buildAqueduct(L, b) {
  const baseY = heightAt(L.x, L.z);
  const span = 26, count = 9;
  for (let i = 0; i < count; i++) {
    const px = L.x - (count - 1) * span * 0.5 + i * span;
    const broken = i === 4 || i === 5;
    const gy = heightAt(px, L.z);
    const pierH = Math.max(12, baseY + 34 - gy);
    if (!broken || i === 5) {
      b.box(7, pierH, 9, px - L.x, gy - baseY + pierH / 2, 0, STONE);
      b.arch(px - L.x, gy - baseY + pierH - 2, 0, span * 0.62, 6.5, 2.4, STONE_D, 7);
    } else {
      b.box(7, pierH * 0.52, 9, px - L.x, gy - baseY + pierH * 0.26, 0, STONE_D);
      b.rock(3.2, px - L.x + 4, gy - baseY + 1.5, 6, STONE_D);
      b.rock(2.4, px - L.x - 5, gy - baseY + 1.2, -5, STONE_D);
    }
    if (!broken) {
      b.box(span + 1, 4.2, 11, px - L.x, gy - baseY + pierH + 4.6, 0, STONE);
      b.box(span + 1, 2.0, 1.4, px - L.x, gy - baseY + pierH + 7.6, 4.4, STONE_D);
      b.box(span + 1, 2.0, 1.4, px - L.x, gy - baseY + pierH + 7.6, -4.4, STONE_D);
      // upper tier arches
      b.arch(px - L.x, gy - baseY + pierH + 7.0, 0, span * 0.48, 3.0, 1.6, STONE, 6);
      b.box(span + 1, 2.4, 8, px - L.x, gy - baseY + pierH + 15.5, 0, STONE);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 1.9;
    b.rock(1 + (i % 3) * 0.8, Math.cos(a) * (28 + i * 3), 0.4, Math.sin(a) * (22 + i * 2), STONE_D);
  }
  return baseY;
}

function buildFlooded(L, b) {
  const baseY = -7.5;
  const rnd = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 12 + rnd() * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 5 + rnd() * 16;
    b.cyl(1.5, 1.8, h, 8, x, h / 2, z, STONE);
    if (rnd() < 0.5) b.box(4, 1.2, 4, x, h + 0.6, z, STONE_D);
  }
  b.box(44, 3, 30, 0, 1.5, 0, STONE_D);
  for (let i = 0; i < 6; i++) b.arch(-18 + i * 7.5, 3, -14, 6.5, 3.5, 1.2, STONE, 5);
  b.box(10, 22, 10, 22, 11, 20, STONE);
  b.cone(8.5, 9, 6, 22, 26, 20, STONE_D);
  b.cyl(2.2, 2.6, 14, 6, -26, 7, -22, STONE);
  b.rock(3.5, -26, 15, -22, BONE);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.28, r = 40 + rnd() * 55;
    b.rock(1.5 + rnd() * 2.5, Math.cos(a) * r, rnd() * 2, Math.sin(a) * r, STONE_D);
  }
  return baseY;
}

function buildCliff(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(31);
  for (let t = 0; t < 4; t++) {
    const ty = -t * 13 + 2;
    const rad = 16 + t * 16;
    const n = 3 + t * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 1.5 + t * 0.4;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const gy = ty;
      b.box(6, 4.6, 6, x, gy + 2.3, z, t % 2 ? WOOD : STONE, a);
      b.cone(5.0, 3.2, 4, x, gy + 6.0, z, THATCH, a + 0.78);
      b.box(1.0, 3.0, 1.0, x + 3, gy + 1.5, z + 3, WOOD_D);
    }
    // terrace platform
    b.cyl(rad + 5, rad + 5, 1.2, 12, 0, ty, 0, STONE_D);
    // stair
    for (let s = 0; s < 10; s++) b.box(3.4, 1.0, 2.2, rad * 0.5, ty - s * 1.3, -rad * 0.6 - s * 1.6, STONE);
  }
  b.cyl(3, 3.6, 24, 8, -12, 12, 6, STONE);
  b.cone(5, 6, 6, -12, 27, 6, STONE_D);
  return baseY;
}

function buildCrater(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(7);
  for (let i = 0; i < 34; i++) {
    const a = rnd() * 6.283, r = 60 + rnd() * 95;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = heightAt(L.x + x, L.z + z) - baseY;
    b.rock(2 + rnd() * 5, x, y + 1, z, rnd() < 0.3 ? 0x40383a : STONE_D);
  }
  // meteor shard cluster
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, r = i * 2.2;
    const g = new THREE.OctahedronGeometry(3 + (i % 3) * 2.5, 0);
    g.rotateZ(0.4 + i * 0.2); g.rotateY(a);
    g.translate(Math.cos(a) * r, 3 + i * 1.4, Math.sin(a) * r);
    b.add(g, i % 2 ? 0x2b2233 : 0x3a2c44, 0.08);
  }
  b.cyl(9, 12, 2.4, 9, 0, 0.6, 0, 0x2a2429);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * 6.283;
    b.cyl(0.7, 1.0, 6 + (i % 3) * 2, 5, Math.cos(a) * 20, 3, Math.sin(a) * 20, 0x453b4c, [0.12 * Math.cos(a), 0, 0.12 * Math.sin(a)]);
  }
  return baseY;
}

function buildFortress(L, b) {
  const baseY = 58;
  const W = 46;
  const wallH = 11;
  for (let s = 0; s < 4; s++) {
    const horiz = s % 2 === 0;
    const sign = s < 2 ? 1 : -1;
    const x = horiz ? 0 : sign * W, z = horiz ? sign * W : 0;
    const len = W * 2 + 5;
    const broken = s === 1;
    if (!broken) {
      b.box(horiz ? len : 4.5, wallH, horiz ? 4.5 : len, x, wallH / 2, z, STONE);
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * len;
        b.box(2.4, 2.2, 2.4, horiz ? t : x, wallH + 1.1, horiz ? z : t, STONE_D);
      }
    } else {
      b.box(horiz ? len * 0.35 : 4.5, wallH * 0.6, horiz ? 4.5 : len * 0.35, horiz ? -len * 0.3 : x, wallH * 0.3, horiz ? z : -len * 0.3, STONE_D);
      for (let i = 0; i < 8; i++) b.rock(1.5 + (i % 3), (horiz ? i * 6 - 10 : x + (i % 3) * 3 - 3), 1, (horiz ? z + (i % 3) * 3 - 3 : i * 6 - 10), STONE_D);
    }
  }
  for (let c = 0; c < 4; c++) {
    const sx = c < 2 ? 1 : -1, sz = c % 2 === 0 ? 1 : -1;
    const tall = c !== 2;
    b.cyl(5.5, 6.5, tall ? 20 : 9, 8, sx * W, (tall ? 20 : 9) / 2, sz * W, STONE);
    if (tall) b.cone(7.2, 6, 8, sx * W, 23, sz * W, 0x55402c);
  }
  b.box(22, 16, 18, 0, 8, 0, STONE);
  b.box(24, 3, 20, 0, 17, 0, STONE_D);
  b.box(7, 10, 2, 0, 5, 9.5, DARK);
  for (let i = 0; i < 12; i++) {
    const a = i * 0.52;
    b.rock(1 + (i % 4) * 0.7, Math.cos(a) * (W + 12 + i), 0.5, Math.sin(a) * (W + 10 + i), STONE_D);
  }
  return baseY;
}

function buildDeadTree(L, b) {
  const baseY = heightAt(L.x, L.z);
  const H = 78;
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const y = t * H;
    const r = lerp(7.5, 1.6, t) * (1 + Math.sin(i * 1.7) * 0.07);
    const sway = Math.sin(i * 0.6) * 2.2;
    b.cyl(lerp(7.5, 1.6, (i + 1) / segs), r, H / segs + 0.4, 9, sway, y + H / segs / 2, Math.cos(i * 0.8) * 1.5, i % 2 ? 0x4a4038 : 0x534840);
  }
  const rnd = mulberry32(3);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.283;
    const y = 26 + rnd() * 44;
    const len = 12 + rnd() * 20;
    const g = new THREE.CylinderGeometry(0.35, 1.3, len, 6);
    g.rotateZ(Math.PI / 2 - (0.5 + rnd() * 0.6));
    g.rotateY(a);
    g.translate(Math.cos(a) * len * 0.35, y + len * 0.22, Math.sin(a) * len * 0.35);
    b.add(g, 0x4d4239, 0.06);
  }
  // exposed roots
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.283;
    const g = new THREE.CylinderGeometry(0.8, 2.4, 14, 6);
    g.rotateZ(1.15); g.rotateY(a);
    g.translate(Math.cos(a) * 6, 1.6, Math.sin(a) * 6);
    b.add(g, 0x453b33, 0.06);
  }
  b.cyl(9, 11, 2.0, 10, 0, 0.6, 0, 0x554a41);
  return baseY;
}

function buildCave(L, b) {
  const floorY = caveFloor(L);
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  const half = L.w * 0.5;
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = ex * L.len * t, cz = ez * L.len * t;
    const roofY = 7.5 - t * 1.6 + Math.sin(i * 1.7) * 0.6;
    const wide = (half + 6) * (1 - t * 0.18);
    // roof slab
    const g = new THREE.BoxGeometry(wide * 2, 3.2 + t * 2, L.len / steps + 2.4);
    g.rotateY(-L.dir);
    g.translate(cx, roofY + 1.6, cz);
    b.add(g, i % 2 ? 0x4a453f : 0x403b36, 0.07);
    // side walls
    for (const sgn of [1, -1]) {
      const wg = new THREE.BoxGeometry(5, 9, L.len / steps + 2);
      wg.rotateY(-L.dir);
      wg.translate(cx - ez * sgn * (half + 2.5), 3.5, cz + ex * sgn * (half + 2.5));
      b.add(wg, 0x514b44, 0.08);
    }
    // stalactites / stalagmites
    if (i % 2 === 0) {
      const sx = cx + (Math.sin(i * 3.1)) * half * 0.5, sz = cz + Math.cos(i * 2.3) * half * 0.5;
      b.cone(0.5 + (i % 3) * 0.2, 2.6 + (i % 4), 5, sx, roofY - 1.2, sz, 0x585048, Math.PI);
      b.cone(0.7, 1.8 + (i % 3), 5, sx * 0.9 + 2, 0.9, sz * 0.9 - 1.5, 0x5c554c);
    }
  }
  // entrance arch and rubble
  b.arch(0, 1.0, 0, L.w + 5, 6, 3.2, 0x4f4941, 8);
  for (let i = 0; i < 14; i++) {
    const a = i * 0.9, r = half + 3 + (i % 4) * 2.5;
    b.rock(1 + (i % 3) * 0.9, Math.cos(a) * r * 0.7 + ex * 6, 0.5, Math.sin(a) * r * 0.7 + ez * 6, 0x565049);
  }
  // deep chamber back wall
  b.rock(9, ex * (L.len + 6), 4, ez * (L.len + 6), 0x4b453e);
  return floorY;
}

// Glowing crystals + ore veins that need their own (unlit) material.
export function buildCaveGlow(L) {
  const b = new Builder();
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  const rnd = mulberry32(L.id.length * 7717);
  for (let i = 0; i < 16; i++) {
    const t = 0.25 + rnd() * 0.75;
    const side = (rnd() - 0.5) * L.w * 0.8;
    const x = ex * L.len * t - ez * side, z = ez * L.len * t + ex * side;
    const g = new THREE.OctahedronGeometry(0.4 + rnd() * 0.7, 0);
    g.rotateZ(rnd()); g.rotateY(rnd() * 6.28);
    g.translate(x, 0.5 + rnd() * 4.5, z);
    b.add(g, rnd() < 0.6 ? 0x7fe0d8 : 0x9ad8ff, 0.1);
  }
  return b.build();
}

const LANDMARK_BUILDERS = {
  aqueduct: buildAqueduct, flooded: buildFlooded, cliff: buildCliff,
  crater: buildCrater, fortress: buildFortress, deadtree: buildDeadTree, cave: buildCave,
};

export function buildLandmarks(scene, material) {
  const groups = [];
  for (const L of LANDMARKS) {
    const b = new Builder();
    const baseY = LANDMARK_BUILDERS[L.kind](L, b);
    const geo = b.build();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(L.x, baseY, L.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
    groups.push({ L, mesh, baseY });
  }
  return groups;
}

// -------------------------------------------------------------- settlements
function hut(b, x, z, y, r, style, quality) {
  const w = 5 + (style % 2) * 1.6;
  const dec = quality < 0.35;
  const wallCol = dec ? 0x5d5348 : (style % 3 === 0 ? WOOD : 0x8c7b5e);
  const roofCol = dec ? 0x6a5c44 : (style % 2 ? THATCH : 0x8a5b3c);
  b.box(w, 4.2 * (dec ? 0.85 : 1), w, x, y + 2.1, z, wallCol, r);
  if (quality > 0.15) b.cone(w * 0.92, 3.4, 4, x, y + 5.6, z, roofCol, r + 0.785);
  else { b.box(w * 0.7, 0.6, w * 0.6, x + 0.6, y + 4.4, z, roofCol, r + 0.2); }
  b.box(1.4, 2.4, 0.4, x + Math.cos(r) * (w / 2), y + 1.2, z + Math.sin(r) * (w / 2), 0x3b2b1d, r);
  if (quality > 0.6) b.cyl(0.4, 0.5, 3.2, 5, x + 1.6, y + 5.6, z + 1.4, STONE_D);
}

export function buildSettlementGeometry(s, index) {
  const b = new Builder();
  const baseY = settlementGroundY(index);
  const rnd = mulberry32(1000 + index * 77);
  const q = s.abandoned ? 0.05 : clamp(s.prosperity, 0, 1.2);
  const n = Math.max(1, s.buildings);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + index;
    const r = 13 + (i % 3) * 8 + rnd() * 5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gy = heightAt(s.x + x, s.z + z) - baseY;
    hut(b, x, z, gy, a + Math.PI, i, s.abandoned ? 0.05 : clamp(q + (rnd() - 0.5) * 0.25, 0, 1));
  }
  // central fire + well
  b.cyl(2.4, 2.8, 0.8, 9, 0, 0.4, 0, STONE_D);
  if (!s.abandoned) {
    for (let i = 0; i < 5; i++) b.cyl(0.18, 0.22, 2.2, 4, Math.cos(i * 1.25) * 0.7, 1.2, Math.sin(i * 1.25) * 0.7, WOOD_D, [0.3 * Math.cos(i), 0, 0.3 * Math.sin(i)]);
  } else {
    b.rock(1.2, 0.5, 0.6, 0.4, 0x333029);
  }
  // fields
  for (let f = 0; f < s.fields; f++) {
    const a = f * 1.35 + 0.6, r = 34 + (f % 2) * 8;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gy = heightAt(s.x + x, s.z + z) - baseY;
    for (let row = 0; row < 5; row++) {
      b.box(11, 0.32, 1.1, x, gy + 0.2, z + row * 1.9 - 3.8, s.abandoned ? 0x5a5240 : (q > 0.6 ? 0x7d8f3e : 0x6d6a44), a);
    }
    if (q > 0.5 && !s.abandoned) b.box(0.4, 2.2, 0.4, x + 5, gy + 1.1, z - 4, WOOD_D);
  }
  // palisade walls by defense level
  if (s.walls > 0 && !s.abandoned) {
    const rad = 26 + s.walls * 2;
    const posts = 26 + s.walls * 8;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * 6.283;
      if (a > 1.1 && a < 1.55) continue;   // gate
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const gy = heightAt(s.x + x, s.z + z) - baseY;
      const h = 3 + s.walls * 1.1;
      b.cyl(0.32, 0.42, h, 5, x, gy + h / 2, z, WOOD_D);
      if (s.walls >= 2 && i % 6 === 0) b.box(1.6, 0.4, 1.6, x, gy + h + 0.2, z, WOOD);
    }
    if (s.walls >= 3) {
      for (let t = 0; t < 2; t++) {
        const a = 2.4 + t * 2.6;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const gy = heightAt(s.x + x, s.z + z) - baseY;
        b.box(4, 8, 4, x, gy + 4, z, WOOD);
        b.cone(3.4, 2.6, 4, x, gy + 9.2, z, 0x5a4029, 0.78);
      }
    }
  }
  // scaffolding while building
  if (s.constructing > 0) {
    const x = 9, z = -12;
    const gy = heightAt(s.x + x, s.z + z) - baseY;
    for (let i = 0; i < 4; i++) {
      const px = x + (i % 2 ? 3 : -3), pz = z + (i < 2 ? 3 : -3);
      b.cyl(0.18, 0.2, 6, 4, px, gy + 3, pz, 0xa8874f);
    }
    b.box(7, 0.4, 7, x, gy + 5.6, z, 0xb08b50);
    b.box(5, 2.2, 5, x, gy + 1.1, z, 0x7e7060);
  }
  // rubble for abandoned villages
  if (s.abandoned) {
    for (let i = 0; i < 12; i++) {
      const a = rnd() * 6.283, r = 8 + rnd() * 26;
      b.rock(0.8 + rnd() * 1.6, Math.cos(a) * r, 0.4, Math.sin(a) * r, 0x53544b);
    }
  }
  return { geo: b.build(), baseY };
}

// Banner: small animated flag mesh (separate so it can recolour instantly)
export function makeBanner(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 8, 5), new THREE.MeshLambertMaterial({ color: 0x4a3a28 }));
  pole.position.y = 4;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7, 6, 3), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  cloth.position.set(1.3, 6.6, 0);
  cloth.userData.cloth = true;
  g.add(pole, cloth);
  g.userData.cloth = cloth;
  return g;
}

// ----------------------------------------------------------- faction camps
export function buildCampGeometry(seed, faction) {
  const b = new Builder();
  const rnd = mulberry32(seed);
  const col = faction === 1 ? 0x6a3a2c : faction === 2 ? 0x453a5e : 0x3f5a3a;
  for (let i = 0; i < 3 + (seed % 2); i++) {
    const a = rnd() * 6.283, r = 4 + rnd() * 5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.cone(2.6, 3.6, 5, x, 1.8, z, col);
    b.cyl(0.1, 0.1, 4.6, 4, x, 2.3, z, 0x4a3a28);
  }
  b.cyl(1.4, 1.6, 0.5, 8, 0, 0.25, 0, 0x3b3630);
  for (let i = 0; i < 4; i++) b.cyl(0.14, 0.18, 1.6, 4, Math.cos(i * 1.6) * 0.5, 0.8, Math.sin(i * 1.6) * 0.5, WOOD_D, [0.35 * Math.cos(i), 0, 0.35 * Math.sin(i)]);
  for (let i = 0; i < 5; i++) {
    const a = rnd() * 6.283, r = 8 + rnd() * 6;
    b.box(2.2, 1.0, 1.0, Math.cos(a) * r, 0.5, Math.sin(a) * r, 0x6a5a42, a);
  }
  return b.build();
}

export { Builder };
