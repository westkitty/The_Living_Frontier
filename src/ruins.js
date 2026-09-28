// Ruins of the builders: coliseum, temples, ziggurat, roads, aqueducts and the
// rest of what an older people left standing. Every builder takes the site
// spec and a Builder, pours geometry into it and returns the mesh origin Y.
// Each reads its site's `seed` and parameters, so one generator raises many
// different places.
import * as THREE from 'three';
import { heightAt } from './worldgen.js';
import { mulberry32, lerp } from './rng.js';

const STONE = 0x8d8577, STONE_D = 0x6f6a60, MARBLE = 0xcfc7b6, MARBLE_D = 0xa9a292, DARK = 0x39332c;
const WOOD_D = 0x4c3823, BRONZE = 0x7d6a3c, BASALT = 0x3b3a3d, SAND = 0xc2ad82, MOSS = 0x5f7a3a, WATER = 0x3e7f8a;

const gy = (L, x, z, baseY) => heightAt(L.x + x, L.z + z) - baseY;
const rot = (x, z, a) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];

// A column with base and (unless broken) capital.
function column(b, x, y, z, h, r, col, broken = false) {
  b.cyl(r * 0.82, r, h, 8, x, y + h / 2, z, col);
  b.box(r * 2.4, r * 0.5, r * 2.4, x, y + r * 0.25, z, col);
  if (!broken) b.box(r * 2.7, r * 0.6, r * 2.7, x, y + h + r * 0.3, z, col);
}
// A fallen column: drums lying end to end.
function fallenColumn(b, rnd, x, y, z, len, r, col) {
  const a = rnd() * 6.283, n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * len;
    b.cyl(r, r, len / n - 0.3, 8, x + Math.cos(a) * t, y + r, z + Math.sin(a) * t, col, [Math.PI / 2, a + Math.PI / 2, 0]);
  }
}
function rubble(b, rnd, n, rmin, rmax, y = 0.4, col = STONE_D, cx = 0, cz = 0) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, r = rmin + rnd() * (rmax - rmin);
    b.rock(0.7 + rnd() * 1.8, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, col);
  }
}
// Arch whose plane is turned by ry about its own centre (Builder.arch is fixed to XY).
function archR(b, x, y, z, w, h, t, col, steps, ry) {
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * (i / steps);
    const lx = -Math.cos(a) * w * 0.5, ly = Math.sin(a) * w * 0.5;
    const g = new THREE.BoxGeometry(t * 1.25, h, t);
    g.rotateZ(-a + Math.PI / 2); g.rotateY(ry);
    const [wx, wz] = rot(lx, 0, ry);
    g.translate(x + wx, y + ly, z + wz);
    b.add(g, col, 0.05);
  }
}
// Triangular prism lying along Z: a pediment or pitched roof.
function pitched(b, w, h, d, x, y, z, col, ry = 0) {
  const g = new THREE.CylinderGeometry(w * 0.58, w * 0.58, d, 3);
  g.rotateX(Math.PI / 2); g.rotateY(ry);
  g.scale(1, h / (w * 0.58), 1);
  g.translate(x, y, z);
  b.add(g, col, 0.04);
}

// ------------------------------------------------------------------ coliseum
function buildColiseum(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const ra = L.ra, rb = L.rb, tiers = L.tiers, storeys = 3, sh = 8.5;
  const outerA = ra + tiers * 5 + 4, outerB = rb + tiers * 5 + 4;
  const n = L.gates * 5;
  const fallFrom = rnd() * 6.283, fallArc = L.fallen * 6.283;
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.283, a2 = (i + 1) / n * 6.283;
    const da = ((a - fallFrom) % 6.283 + 6.283) % 6.283;
    const collapsed = da < fallArc;
    const px = Math.cos(a) * outerA, pz = Math.sin(a) * outerB;
    const qx = Math.cos(a2) * outerA, qz = Math.sin(a2) * outerB;
    const mx = (px + qx) / 2, mz = (pz + qz) / 2, seg = Math.hypot(qx - px, qz - pz);
    const face = Math.atan2(qx - px, qz - pz);
    const y0 = gy(L, px, pz, baseY);
    const keep = collapsed ? 1 : storeys;
    for (let s = 0; s < keep; s++) {
      const y = y0 + s * sh;
      b.box(1.6, sh, 1.6, px, y + sh / 2, pz, s ? STONE : STONE_D);
      if (!collapsed || s === 0) archR(b, mx, y + sh * 0.35, mz, seg * 0.72, 1.3, 1.4, STONE, 6, face);
      b.box(seg, 1.0, 2.0, mx, y + sh - 0.5, mz, STONE_D, face);
    }
    if (collapsed) rubble(b, rnd, 3, 0, 6, y0 + 0.5, STONE_D, mx * 0.92, mz * 0.92);
    if (i % 5 === 0 && !collapsed) {   // one of the nine gates
      b.box(3.2, storeys * sh + 2, 3.2, px, y0 + (storeys * sh + 2) / 2, pz, STONE_D);
      b.box(2.4, 1.4, 6, px * 0.98, y0 + 6, pz * 0.98, BRONZE, a + 1.571);
    }
  }
  // seating tiers follow the terraced ground: stone benches and radial stairs
  for (let t = 0; t < tiers; t++) {
    const m = 40 + t * 8;
    for (let i = 0; i < m; i++) {
      const a = i / m * 6.283;
      const x = Math.cos(a) * (ra + t * 5 + 2.5), z = Math.sin(a) * (rb + t * 5 + 2.5);
      const y = gy(L, x, z, baseY);
      if (i % 10 === 0) b.box(2.2, 0.5, 4.6, x, y + 0.25, z, STONE, a + 1.571);
      else b.box(3.2, 0.9, 1.6, x, y + 0.45, z, i % 3 ? STONE : MARBLE_D, a + 1.571);
    }
  }
  // the arena floor: sand, a broken statue, the gates' stone posts
  const g = new THREE.CylinderGeometry(rb * 0.98, rb * 0.98, 0.3, 32); g.scale(ra / rb, 1, 1); g.translate(0, gy(L, 0, 0, baseY) + 0.1, 0); b.add(g, SAND, 0.03);
  const fy = gy(L, 0, 0, baseY);
  b.box(3, 2.4, 3, 0, fy + 1.2, 0, MARBLE_D);
  b.cyl(0.9, 1.1, 4, 8, 0, fy + 4.4, 0, MARBLE, [0, 0, 0.3]);
  b.rock(1.3, 5, fy + 0.8, 3, MARBLE_D);
  for (let i = 0; i < 6; i++) { const a = i * 1.047; b.box(1.2, 3.0, 1.2, Math.cos(a) * (ra - 3), fy + 1.5, Math.sin(a) * (rb - 3), WOOD_D); }
  rubble(b, rnd, 18, outerA + 3, outerA + 22, 0.5);
  return baseY;
}

// -------------------------------------------------------------------- temple
function buildTemple(L, b) {
  const baseY = heightAt(L.x, L.z) + 0.2;
  const rnd = mulberry32(L.seed);
  const sp = 3.6, colH = 9.5, cr = 0.72;
  if (L.round) {   // a tholos: a ring of columns under a fallen dome
    const R = L.cols * 1.6;
    for (let s = 0; s < 3; s++) b.cyl(R + 4 - s * 1.2, R + 4 - s * 1.2, 0.8, 24, 0, 0.4 + s * 0.8, 0, s % 2 ? MARBLE_D : MARBLE);
    const y0 = 2.4;
    for (let i = 0; i < L.cols * 2; i++) {
      const a = i / (L.cols * 2) * 6.283, x = Math.cos(a) * R, z = Math.sin(a) * R;
      const broken = rnd() < L.ruin;
      column(b, x, y0, z, broken ? 2 + rnd() * 5 : colH, cr, MARBLE, broken);
      if (broken) fallenColumn(b, rnd, x * 1.3, y0, z * 1.3, 6, cr, MARBLE_D);
    }
    for (let i = 0; i < L.cols * 2; i++) {
      if (rnd() < L.ruin) continue;
      const a = (i + 0.5) / (L.cols * 2) * 6.283;
      b.box(R * 0.32, 0.9, 1.6, Math.cos(a) * R, y0 + colH + 0.9, Math.sin(a) * R, MARBLE_D, -a + 1.571);
    }
    b.cyl(2.2, 2.6, 3.2, 10, 0, y0 + 1.6, 0, MARBLE_D);                 // the altar
    b.box(1.4, 0.4, 1.4, 0, y0 + 3.4, 0, BRONZE);
    const dome = new THREE.SphereGeometry(R * 0.55, 10, 5, 0, 6.283, 0, 1.4); dome.rotateZ(2.6); dome.translate(R * 1.4, 2.5, R * 0.5);
    b.add(dome, MARBLE_D, 0.05);
    rubble(b, rnd, 14, R + 6, R + 26, 0.4, MARBLE_D);
    return baseY;
  }
  const W = (L.cols - 1) * sp, D = (L.rows - 1) * sp;
  for (let s = 0; s < 3; s++) b.box(W + 10 - s * 2, 0.8, D + 10 - s * 2, 0, 0.4 + s * 0.8, 0, s % 2 ? MARBLE_D : MARBLE);
  const y0 = 2.4;
  const cols = [];
  for (let i = 0; i < L.cols; i++) for (let j = 0; j < L.rows; j++) {
    if (i > 0 && i < L.cols - 1 && j > 0 && j < L.rows - 1) continue;
    const x = -W / 2 + i * sp, z = -D / 2 + j * sp;
    const broken = rnd() < L.ruin;
    column(b, x, y0, z, broken ? 1.5 + rnd() * 6 : colH, cr, MARBLE, broken);
    if (broken && rnd() < 0.7) fallenColumn(b, rnd, x * 1.4 + (rnd() - 0.5) * 6, y0, z * 1.25, 7, cr, MARBLE_D);
    cols.push(!broken);
  }
  // entablature and roof survive only where the columns beneath still stand
  const roofed = rnd() < L.roof;
  for (const side of [-1, 1]) {
    b.box(W + 2, 1.2, 1.6, 0, y0 + colH + 0.9, side * D / 2, MARBLE_D);
    b.box(1.6, 1.2, D + 2, side * W / 2, y0 + colH + 0.9, 0, MARBLE_D);
    if (roofed) pitched(b, W + 3, 3.4, 1.4, 0, y0 + colH + 3.0, side * D / 2, MARBLE);
  }
  if (roofed) {
    const span = D * (0.35 + rnd() * 0.3);
    pitched(b, W + 3, 3.4, span, 0, y0 + colH + 3.0, -D / 2 + span / 2, MARBLE_D);
    for (let i = 0; i < 5; i++) b.box(W * 0.6, 0.4, 2.4, (rnd() - 0.5) * W * 0.4, y0 + 0.6, D * 0.2 + i * 2.5, MARBLE_D, rnd() * 0.5);
  }
  // cella: the inner sanctum, one wall breached, a fire bowl before the idol
  b.box(W * 0.55, colH * 0.8, 1.2, 0, y0 + colH * 0.4, -D * 0.32, STONE);
  b.box(1.2, colH * 0.8, D * 0.55, -W * 0.27, y0 + colH * 0.4, 0, STONE);
  b.box(1.2, colH * 0.5, D * 0.3, W * 0.27, y0 + colH * 0.25, -D * 0.12, STONE);
  b.box(W * 0.2, colH * 0.8, 1.2, -W * 0.17, y0 + colH * 0.4, D * 0.32, STONE);
  b.box(W * 0.2, colH * 0.8, 1.2, W * 0.17, y0 + colH * 0.4, D * 0.32, STONE);
  b.box(2.6, 5.5, 2.0, 0, y0 + 2.75, -D * 0.22, BRONZE);
  b.cyl(1.4, 1.0, 1.0, 8, 0, y0 + 0.5, -D * 0.05, DARK);
  rubble(b, rnd, 16, W / 2 + 8, W / 2 + 30, 0.4, MARBLE_D);
  return baseY;
}

// ------------------------------------------------------------------ ziggurat
function buildZiggurat(L, b) {
  const baseY = heightAt(L.x, L.z + L.w * 0.75);
  const rnd = mulberry32(L.seed);
  const stepH = 3.2, half = L.w / 2, steps = L.steps;
  for (let s = 0; s < steps; s++) {
    const w = (half - s * half / steps) * 2, y = s * stepH;
    // facing slabs: each terrace edge gets a lip of dressed stone
    for (const [dx, dz, ry] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1.571], [0, -1, 1.571]]) {
      b.box(2.4, stepH + 1.2, w + 2.4, dx * w / 2, y + stepH / 2 + 0.3, dz * w / 2, s % 2 ? 0x9a7f5a : 0x86704f, ry);
    }
    b.box(w, 0.6, w, 0, y + stepH + 0.4, 0, s % 2 ? 0xa48a62 : 0x947c58);   // paved terrace
    for (let i = 0; i < 4; i++) {  // corner braziers on the lower tiers
      const a = i * 1.571 + 0.785;
      if (s < 2) b.cyl(0.6, 0.9, 1.4, 6, Math.cos(a) * w * 0.68, y + stepH + 0.7, Math.sin(a) * w * 0.68, DARK);
    }
  }
  // the grand stair climbs the +X face; the shrine crowns the top
  for (let i = 0; i < steps * 4; i++) {
    const t = i / (steps * 4);
    b.box(3.4, 0.6, 7.4, half * (1 - t) + 1.2, t * stepH * steps + 0.3, 0, 0xb09a72);
  }
  b.box(3.8, 1.2, 9, half + 4, 0.6, 0, 0xb09a72);
  const top = steps * stepH, tw = half * 2 / steps * 0.9;
  b.box(tw, 6, tw, 0, top + 3, 0, 0x6d4d3d);
  b.box(tw * 0.6, 4, tw * 0.6, 0, top + 8, 0, 0x5b3f33);
  b.box(2.2, 3.2, 1.4, tw / 2, top + 1.6, 0, DARK);
  b.cone(tw * 0.5, 3, 4, 0, top + 11.5, 0, BRONZE, 0.785);
  for (let i = 0; i < 2; i++) b.box(1.6, 5.5, 1.6, half + 6, 2.75, (i ? 1 : -1) * 6.5, BASALT);
  rubble(b, rnd, 20, half + 8, half + 30, 0.5, 0x7d6a55);
  return baseY;
}

// ------------------------------------------------------------- henge & needles
function buildHenge(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let ring = 0; ring < L.rings; ring++) {
    const R = 22 - ring * 10, n = ring ? Math.round(L.stones * 0.5) : L.stones;
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283, x = Math.cos(a) * R, z = Math.sin(a) * R;
      const y = gy(L, x, z, baseY), h = 5 + rnd() * 3.5;
      const fallen = rnd() < 0.2;
      if (fallen) b.box(2.4, 1.6, h, x + 2, y + 0.8, z, STONE_D, a + rnd());
      else {
        b.box(2.4, h, 1.4, x, y + h / 2, z, i % 3 ? STONE : STONE_D, -a + 1.571);
        if (!ring && i % 2 === 0 && rnd() < 0.7) {
          const a2 = (i + 1) / n * 6.283;
          b.box(Math.hypot(Math.cos(a2) * R - x, Math.sin(a2) * R - z) + 1.6, 1.2, 1.6, (x + Math.cos(a2) * R) / 2, y + h + 0.6, (z + Math.sin(a2) * R) / 2, STONE_D, -(a + a2) / 2 + 1.571);
        }
      }
    }
  }
  b.box(4.2, 1.1, 2.4, 0, gy(L, 0, 0, baseY) + 0.55, 0, BASALT);           // the altar stone
  for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.4; b.cyl(0.35, 0.45, 2.6, 5, Math.cos(a) * 34, gy(L, Math.cos(a) * 34, Math.sin(a) * 34, baseY) + 1.3, Math.sin(a) * 34, STONE_D); }
  rubble(b, rnd, 8, 30, 45, 0.3);
  return baseY;
}
function buildObelisks(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let i = 0; i < L.count; i++) {
    const a = rnd() * 6.283, r = 6 + Math.sqrt(rnd()) * 42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = gy(L, x, z, baseY);
    const h = 8 + rnd() * 10, w = 1.1 + rnd() * 0.6;
    const col = rnd() < 0.3 ? BASALT : STONE;
    b.box(w * 2, 1, w * 2, x, y + 0.5, z, STONE_D);
    if (rnd() < 0.28) {   // toppled, snapped in two
      const ry = rnd() * 6.283;
      b.cyl(w * 0.7, w, h * 0.55, 4, x + Math.cos(ry) * h * 0.3, y + w * 0.8, z + Math.sin(ry) * h * 0.3, col, [Math.PI / 2, ry + 1.571, 0]);
      b.cyl(w * 0.4, w * 0.7, h * 0.4, 4, x + Math.cos(ry) * h * 0.85, y + w * 0.6, z + Math.sin(ry) * h * 0.85, col, [Math.PI / 2, ry + 1.571 + 0.3, 0]);
      b.cyl(w * 0.8, w * 0.95, 1.4, 4, x, y + 1.7, z, col);
    } else {
      b.cyl(w * 0.55, w, h, 4, x, y + 1 + h / 2, z, col, [0, 0.785, 0]);
      b.cone(w * 0.8, w * 1.2, 4, x, y + 1 + h + w * 0.6, z, BRONZE, 0.785);
      for (let k = 0; k < 3; k++) b.box(w * 0.4, 0.6, 0.1, x, y + 3 + k * 2.4, z + w * 0.72, DARK);
    }
  }
  b.cyl(6, 7, 0.6, 12, 0, gy(L, 0, 0, baseY) + 0.3, 0, MARBLE_D);
  rubble(b, rnd, 10, 40, 58, 0.3);
  return baseY;
}

// ---------------------------------------------------------------- necropolis
function buildNecropolis(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const rowsN = Math.ceil(Math.sqrt(L.tombs));
  for (let i = 0; i < L.tombs; i++) {
    const gx = (i % rowsN - rowsN / 2 + 0.5) * 11, gz = (Math.floor(i / rowsN) - rowsN / 2 + 0.5) * 11;
    if (Math.hypot(gx, gz) < 9) continue;
    const x = gx + (rnd() - 0.5) * 3, z = gz + (rnd() - 0.5) * 3, y = gy(L, x, z, baseY);
    const w = 3.2 + rnd() * 2, h = 2.6 + rnd() * 1.6, ry = (rnd() - 0.5) * 0.4;
    const col = rnd() < 0.5 ? STONE : MARBLE_D;
    b.box(w, h, w * 1.4, x, y + h / 2, z, col, ry);
    if (rnd() < 0.7) pitched(b, w + 0.6, 1.4, w * 1.5, x, y + h + 0.7, z, STONE_D, ry);
    else b.rock(w * 0.5, x + 1, y + h + 0.3, z, STONE_D);
    b.box(1.0, 1.8, 0.3, x, y + 0.9, z + w * 0.7, DARK, ry);
    if (rnd() < 0.4) b.cone(0.9, 4.5, 6, x + w, y + 2.2, z - w, 0x2f4a2c);     // cypress
    if (rnd() < 0.3) b.cyl(0.4, 0.6, 1.2, 6, x - w * 0.8, y + 0.6, z + w, BRONZE);
  }
  // the great mausoleum
  const y0 = gy(L, 0, 0, baseY);
  b.box(14, 1.2, 14, 0, y0 + 0.6, 0, MARBLE);
  b.box(10, 7, 10, 0, y0 + 4.7, 0, MARBLE_D);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; column(b, Math.cos(a) * 6.2, y0 + 1.2, Math.sin(a) * 6.2, 6.5, 0.5, MARBLE); }
  const dome = new THREE.SphereGeometry(5.6, 12, 6, 0, 6.283, 0, 1.5); dome.translate(0, y0 + 8.2, 0); b.add(dome, MARBLE_D, 0.05);
  b.box(2.2, 3.6, 0.6, 0, y0 + 3, 5.2, DARK);
  // boundary wall with breaches
  const R = rowsN * 5.5 + 8;
  for (let i = 0; i < 36; i++) {
    if (rnd() < 0.25) continue;
    const a = i / 36 * 6.283, x = Math.cos(a) * R, z = Math.sin(a) * R;
    b.box(R * 0.18, 2.2, 0.8, x, gy(L, x, z, baseY) + 1.1, z, STONE_D, -a + 1.571);
  }
  rubble(b, rnd, 10, R + 2, R + 18, 0.3);
  return baseY;
}

// ------------------------------------------------- athenaeum, baths, gate
function buildAthenaeum(L, b) {
  const baseY = Math.max(heightAt(L.x, L.z), 4.5);
  const rnd = mulberry32(L.seed);
  const HL = 46, HW = 16, colH = 8;
  b.box(HL + 12, 1.4, HW * L.wings + 14, 0, 0.7, 0, MARBLE_D);
  for (let w = 0; w < L.wings; w++) {
    const wz = (w - (L.wings - 1) / 2) * (HW + 2);
    for (let i = 0; i <= 10; i++) {
      const x = -HL / 2 + i * HL / 10;
      for (const side of [-1, 1]) {
        const broken = rnd() < 0.3;
        column(b, x, 1.4, wz + side * HW / 2, broken ? 2 + rnd() * 4 : colH, 0.6, MARBLE, broken);
      }
    }
    b.box(HL + 2, 1.0, 1.2, 0, 1.4 + colH + 0.6, wz - HW / 2, MARBLE_D);
    b.box(HL + 2, 1.0, 1.2, 0, 1.4 + colH + 0.6, wz + HW / 2, MARBLE_D);
    // shelves: books still in their rows, some spilled
    for (let i = 0; i < 7; i++) {
      const x = -HL / 2 + 5 + i * 6;
      if (rnd() < 0.25) { b.box(1.2, 0.8, HW * 0.5, x + 2, 1.8, wz, WOOD_D, 0.3); continue; }
      b.box(1.2, 5.2, HW * 0.5, x, 1.4 + 2.6, wz, WOOD_D);
      for (let k = 0; k < 4; k++) b.box(1.3, 0.7, HW * 0.44, x, 1.4 + 1.2 + k * 1.2, wz, [0x7a3a3a, 0x3a4f7a, 0x5a6a3a, 0x8a7a4a][(k + i) % 4]);
    }
    // the roof came down in beams
    for (let i = 0; i < 5; i++) {
      const x = -HL / 2 + 4 + rnd() * (HL - 8);
      b.box(1.0, 1.0, HW * 0.9, x, 1.4 + 2 + rnd() * 3, wz, WOOD_D, 0);
      const g = new THREE.BoxGeometry(1, 1, HW * 0.8); g.rotateX(0.5 + rnd() * 0.4); g.rotateY(rnd() * 0.4); g.translate(x + 2, 1.4 + 4, wz + 3); b.add(g, WOOD_D, 0.05);
    }
  }
  for (let i = 0; i < 5; i++) b.box(HW * L.wings + 14, 0.5, 2, HL / 2 + 6 - i * 1.6, 0.7 + (5 - i) * 0.3, 0, MARBLE, 1.571);
  b.box(3, 4, 2, -HL / 2 - 3, 3.4, 0, MARBLE_D);
  b.cyl(0.5, 0.5, 5.5, 6, -HL / 2 - 3, 7.7, 0, BRONZE);
  rubble(b, rnd, 14, HL / 2 + 10, HL / 2 + 28, 0.3, MARBLE_D);
  return baseY;
}
function buildBaths(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let p = 0; p < L.pools; p++) {
    const a = p / L.pools * 6.283, cx = Math.cos(a) * 18, cz = Math.sin(a) * 18;
    const w = 10 + rnd() * 6, d = 8 + rnd() * 6;
    b.box(w + 3, 1.2, d + 3, cx, 0.6, cz, MARBLE_D, a);
    b.box(w, 0.4, d, cx, 1.35, cz, WATER, a);               // still water
    for (let i = 0; i < 6; i++) { const t = i / 6 * 6.283; column(b, cx + Math.cos(t) * (w / 2 + 2.6), 1.2, cz + Math.sin(t) * (d / 2 + 2.6), rnd() < 0.3 ? 3 : 7, 0.5, MARBLE, rnd() < 0.3); }
  }
  b.box(12, 1.2, 12, 0, 0.6, 0, MARBLE);
  b.cyl(3.4, 3.8, 0.8, 12, 0, 1.6, 0, MARBLE_D);
  b.cyl(2.6, 2.6, 0.4, 12, 0, 2.2, 0, WATER);
  b.cyl(0.4, 0.5, 4, 6, 0, 3.5, 0, MARBLE); b.rock(0.8, 0, 5.8, 0, MARBLE);
  // the caldarium: half a vaulted hall, its hypocaust floor laid bare
  for (let i = 0; i < 6; i++) archR(b, -30, 1, -18 + i * 6, 12, 2.2, 1.2, STONE, 7, 1.571);
  for (let i = 0; i < 24; i++) b.box(0.8, 1.4, 0.8, -30 + (i % 6 - 2.5) * 2.2, 0.7, -14 + Math.floor(i / 6) * 3, 0x8a5b3c);
  for (let i = 0; i < 3; i++) b.box(1.0, 1.2, 4.0, -30 + (i - 1) * 4, 2.2, 2, DARK);
  rubble(b, rnd, 12, 30, 48, 0.3, MARBLE_D);
  return baseY;
}
function buildGate(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const H = 18, W = 26;
  b.box(W + 6, 1.2, 12, 0, 0.6, 0, MARBLE_D);
  for (let i = 0; i < L.arches; i++) {
    const mid = i === Math.floor(L.arches / 2), w = mid ? 9 : 5.5, x = (i - (L.arches - 1) / 2) * 9.2;
    const ah = mid ? H * 0.62 : H * 0.42;
    for (const s of [-1, 1]) b.box(2.2, ah, 8, x + s * (w / 2 + 1.1), ah / 2 + 1.2, 0, MARBLE);
    archR(b, x, ah + 1.2 - w * 0.1, 0, w + 2, 2.4, 6, MARBLE_D, 7, 1.571);
  }
  b.box(W, 4.5, 8.5, 0, H + 1.2, 0, MARBLE_D);                       // the attic
  for (let i = 0; i < 6; i++) b.box(3.2, 0.5, 0.2, -10 + i * 4, H + 1.2, 4.4, DARK);
  for (const s of [-1, 1]) { column(b, s * (W / 2 - 1.5), 1.2, 5.2, H - 1.5, 0.8, MARBLE); column(b, s * (W / 2 - 1.5), 1.2, -5.2, H - 1.5, 0.8, MARBLE); }
  b.box(6, 3, 4, W / 2 + 6, 1.5 + 1.2, 6, MARBLE_D, 0.6);              // a fallen chunk
  for (let i = 0; i < 4; i++) { const s = i < 2 ? 1 : -1; b.box(2.8, 5.2, 2.8, (i % 2 ? 1 : -1) * 10, H + 6, s * 2.4, BRONZE); }
  rubble(b, rnd, 8, 20, 32, 0.3, MARBLE_D);
  return baseY;
}

// --------------------------------------------- colossus, observatory, tower
function buildColossus(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const C = 0xa79a85, C2 = 0x8f8370;
  for (let s = 0; s < 3; s++) b.box(20 - s * 3, 1.2, 20 - s * 3, -22, 0.6 + s * 1.2, 0, s % 2 ? STONE : STONE_D);
  b.box(4.5, 6, 9, -25, 6.6, 3.5, C); b.box(4.5, 6, 9, -25, 6.6, -3.5, C);      // feet and shins still on the plinth
  b.box(4, 2.5, 5, -21, 4.85, 3.5, C2); b.box(4, 2.5, 5, -21, 4.85, -3.5, C2);
  // torso lies along +X, head rolled further, one hand reaching skyward
  const g = new THREE.BoxGeometry(22, 12, 14); g.rotateX(0.35); g.rotateY(0.15); g.translate(6, 5.5, 2); b.add(g, C, 0.05);
  b.box(14, 8, 6, 12, 4.2, 12, C2, 0.5);                                 // an arm
  b.box(5, 5, 5, 20, 3, 15, C, 0.8);
  for (let i = 0; i < 4; i++) b.box(1.4, 6, 1.4, 20 + (i - 1.5) * 1.7, 8, 15, C, 0.3);   // fingers
  const head = new THREE.BoxGeometry(11, 12, 10); head.rotateZ(1.2); head.rotateY(0.6); head.translate(30, 5.4, -6); b.add(head, C, 0.05);
  b.box(2.6, 1.2, 4, 33, 8.5, -9, DARK, 0.6); b.box(2.6, 1.2, 4, 31, 10.5, -3, DARK, 0.6);   // eyes
  for (let i = 0; i < 7; i++) { const a = i * 0.9; b.cone(1.4, 5, 4, 30 + Math.cos(a) * 7, 4 + Math.sin(a) * 6 + 4, -6 - 3, BRONZE, a); }
  b.box(3, 30, 3, -6, 15, -26, C2, 0.2);                                  // the sword, point-down in the earth
  b.box(9, 1.5, 2.5, -6, 27, -26, BRONZE, 0.2);
  rubble(b, rnd, 22, 14, 44, 0.4, C2);
  return baseY;
}
function buildObservatory(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  b.cyl(16, 17, 1.4, 20, 0, 0.7, 0, STONE_D);
  b.cyl(8.5, 9.5, 14, 14, 0, 7, 0, STONE);
  const dome = new THREE.SphereGeometry(9, 14, 8, 0, 6.283, 0, 1.55); dome.translate(0, 14, 0); b.add(dome, BRONZE, 0.05);
  b.box(3, 9.5, 20, 0, 18.5, 0, DARK);                                       // the viewing slot
  for (let i = 0; i < 18; i++) {      // a stair spirals up the tower
    const a = i * 0.42, y = 1.4 + i * 0.72;
    b.box(3.6, 0.5, 1.8, Math.cos(a) * 10.6, y, Math.sin(a) * 10.6, STONE_D, -a);
  }
  // the armillary sphere: three bronze rings on a plinth
  b.box(4, 2, 4, 20, 1.8, 6, MARBLE_D);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.TorusGeometry(3.4 - i * 0.7, 0.18, 6, 24);
    t.rotateX(i * 1.1); t.rotateZ(i * 0.7); t.translate(20, 6.4, 6);
    b.add(t, BRONZE, 0.03);
  }
  b.cyl(0.2, 0.2, 7, 5, 20, 6.4, 6, BRONZE, [0, 0, 0.4]);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; b.box(1.4, 2.4, 1.4, Math.cos(a) * 15.5, 2.6, Math.sin(a) * 15.5, STONE_D); }
  b.box(6, 3.5, 5, -18, 1.75 + 1.2, -4, STONE); pitched(b, 6.6, 1.6, 5.6, -18, 5.7, -4, WOOD_D);
  rubble(b, rnd, 8, 18, 30, 0.4);
  return baseY;
}
function buildWatchtower(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed), H = L.h;
  b.box(9, 1.2, 9, 0, 0.6, 0, STONE_D);
  b.box(6.5, H, 6.5, 0, H / 2, 0, STONE);
  b.box(3, H * 0.4, 3, 3.5, H * 0.2, 3.5, STONE_D);                             // a buttress
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.box(1.4, 1.6, 1.4, Math.cos(a) * 3.6, H + 0.8, Math.sin(a) * 3.6, STONE_D); }
  b.box(8, 0.5, 8, 0, H + 0.25, 0, WOOD_D);
  b.cyl(0.8, 1.1, 1.0, 6, 0, H + 1.0, 0, DARK);                                  // the brazier
  for (let i = 0; i < Math.floor(H / 1.4); i++) b.box(0.3, 0.3, 1.2, -3.4, 1 + i * 1.4, 0, WOOD_D);   // ladder rungs
  b.box(0.3, H, 0.3, -3.4, H / 2, 0.6, WOOD_D); b.box(0.3, H, 0.3, -3.4, H / 2, -0.6, WOOD_D);
  for (let i = 0; i < 4; i++) b.box(1.2, 2.5, 0.4, -1.5 + (i % 2) * 3, 6 + i * 6, 3.3, DARK);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * 6.283, r = 13;
    if (rnd() < 0.3) continue;
    b.cyl(0.3, 0.4, 2 + rnd() * 1.5, 5, Math.cos(a) * r, gy(L, Math.cos(a) * r, Math.sin(a) * r, baseY) + 1, Math.sin(a) * r, WOOD_D);
  }
  rubble(b, rnd, 6, 6, 12, 0.3);
  return baseY;
}

// ------------------------------------------- labyrinth, windmill, lighthouse
function buildLabyrinth(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const N = L.cells, cs = 5, wallH = 3.6, off = -N * cs / 2;
  // a perfect maze by depth-first carving; every cell keeps its (dx, dz) walls
  const seen = new Uint8Array(N * N), walls = new Uint8Array(N * N).fill(15);   // bits: 1 +x, 2 -x, 4 +z, 8 -z
  const stack = [0]; seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1], cx = c % N, cz = Math.floor(c / N);
    const opts = [];
    if (cx + 1 < N && !seen[c + 1]) opts.push([c + 1, 1, 2]);
    if (cx > 0 && !seen[c - 1]) opts.push([c - 1, 2, 1]);
    if (cz + 1 < N && !seen[c + N]) opts.push([c + N, 4, 8]);
    if (cz > 0 && !seen[c - N]) opts.push([c - N, 8, 4]);
    if (!opts.length) { stack.pop(); continue; }
    const [n, w1, w2] = opts[Math.floor(rnd() * opts.length)];
    walls[c] &= ~w1; walls[n] &= ~w2; seen[n] = 1; stack.push(n);
  }
  walls[N * N - 1] &= ~1;
  for (let c = 0; c < N * N; c++) {
    const cx = c % N, cz = Math.floor(c / N), x = off + cx * cs, z = off + cz * cs;
    const y = gy(L, x + cs / 2, z + cs / 2, baseY);
    const col = (cx + cz) % 2 ? STONE : STONE_D;
    if (walls[c] & 1 && rnd() > 0.06) b.box(0.8, wallH, cs + 0.8, x + cs, y + wallH / 2, z + cs / 2, col);
    if (walls[c] & 4 && rnd() > 0.06) b.box(cs + 0.8, wallH, 0.8, x + cs / 2, y + wallH / 2, z + cs, col);
    if (cx === 0 && walls[c] & 2) b.box(0.8, wallH, cs + 0.8, x, y + wallH / 2, z + cs / 2, col);
    if (cz === 0 && walls[c] & 8) b.box(cs + 0.8, wallH, 0.8, x + cs / 2, y + wallH / 2, z, col);
  }
  const mid = off + Math.floor(N / 2) * cs + cs / 2, my = gy(L, mid, mid, baseY);
  b.cyl(1.2, 1.4, 4.5, 8, mid, my + 2.25, mid, MARBLE); b.rock(1.1, mid, my + 5.2, mid, BRONZE);
  b.box(4, 0.4, 4, off - 3, gy(L, off - 3, off + cs / 2, baseY) + 0.2, off + cs / 2, MARBLE_D);
  rubble(b, rnd, 10, N * cs * 0.75, N * cs * 0.75 + 16, 0.3);
  return baseY;
}
function buildWindmill(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  b.cyl(4.2, 5.4, 14, 10, 0, 7, 0, STONE);
  b.cyl(0.5, 4.6, 4, 10, 1.2, 15.6, 0, WOOD_D, [0, 0, 0.35]);                   // the cap, half slid off
  b.box(1.2, 2.6, 0.4, 0, 1.4, 5.1, DARK);
  b.box(1.2, 1.0, 0.4, 0, 9, 5.1, DARK);
  // the sails have fallen and lean against the tower
  for (let i = 0; i < 2; i++) {
    const g = new THREE.BoxGeometry(1.2, 22, 0.4); g.rotateX(-0.5 - i * 0.2); g.rotateY(i * 1.4); g.translate(2 + i * 3, 9, 7 + i * 2); b.add(g, WOOD_D, 0.05);
    for (let k = 0; k < 4; k++) { const s = new THREE.BoxGeometry(3.4, 4, 0.15); s.rotateX(-0.5 - i * 0.2); s.rotateY(i * 1.4); s.translate(2 + i * 3 + 1.4, 3 + k * 4.5, 7 + i * 2 + k * 1.3); b.add(s, 0xb9a98a, 0.06); }
  }
  b.cyl(2.2, 2.2, 0.6, 12, -8, 0.3, 2, STONE_D); b.cyl(2.0, 2.0, 0.6, 12, -9, 0.9, 3, STONE_D, [0.3, 0, 0]);   // millstones
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.box(0.3, 1.2, 4.2, Math.cos(a) * 14, gy(L, Math.cos(a) * 14, Math.sin(a) * 14, baseY) + 0.6, Math.sin(a) * 14, WOOD_D, -a); }
  for (let i = 0; i < 5; i++) b.box(1.6, 1.6, 1.6, 6 + (i % 3) * 1.8, 0.8 + Math.floor(i / 3) * 1.6, -5, 0xa08a58);
  rubble(b, rnd, 6, 8, 16, 0.3);
  return baseY;
}
function buildLighthouse(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed), H = L.h;
  b.cyl(10, 11, 1.6, 16, 0, 0.8, 0, STONE_D);
  for (let s = 0; s < 6; s++) b.cyl(3.6 - s * 0.3, 4.0 - s * 0.3, H / 6, 12, 0, 1.6 + (s + 0.5) * H / 6, 0, s % 2 ? MARBLE : 0x8a3b32);
  b.cyl(3.4, 3.2, 1.0, 12, 0, H + 2.1, 0, DARK);
  b.cyl(2.4, 2.4, 3.2, 8, 0, H + 4.2, 0, 0x9fd6e8);                             // the lantern glass
  b.cone(3.2, 2.4, 8, 0, H + 7.0, 0, BRONZE);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.box(0.3, 3.2, 0.3, Math.cos(a) * 2.4, H + 4.2, Math.sin(a) * 2.4, DARK); }
  b.box(7, 4, 5, 9, 1.6 + 2, 2, STONE); pitched(b, 7.6, 1.8, 5.6, 9, 6.5, 2, WOOD_D);
  b.box(1.0, 2.2, 0.3, 9, 2.7, 4.6, DARK);
  b.box(4, 2.5, 3, -9, 2.85, -4, STONE_D, 0.4);
  // lamp posts down the causeway to the shore
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  for (let i = 2; i < 13; i++) {
    const t = i * 7, x = ex * t, z = ez * t;
    const y = gy(L, x, z, baseY);
    if (y + baseY < 0.5) continue;
    b.cyl(0.25, 0.32, 3.6, 5, x - ez * 2.2, y + 1.8, z + ex * 2.2, i % 3 ? STONE_D : WOOD_D);
    if (i % 3 === 0) b.box(0.9, 0.9, 0.9, x - ez * 2.2, y + 3.9, z + ex * 2.2, BRONZE);
  }
  for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, r = 11 + rnd() * 6; b.rock(1 + rnd() * 2, Math.cos(a) * r, gy(L, Math.cos(a) * r, Math.sin(a) * r, baseY) + 0.6, Math.sin(a) * r, BASALT); }
  return baseY;
}

// ------------------------------------------------ viaduct, road, bridge
function buildViaduct(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir), span = L.span, count = L.count;
  const topY = baseY + L.tall;
  const face = -L.dir;
  for (let i = 0; i < count; i++) {
    const t = (i - (count - 1) / 2) * span;
    const px = ex * t, pz = ez * t;
    const y0 = gy(L, px, pz, baseY);
    const pierH = Math.max(6, topY - baseY - y0 - 2);
    const broken = L.broken.includes(i);
    if (broken) {
      b.box(6, pierH * (0.3 + rnd() * 0.3), 8, px, y0 + pierH * 0.2, pz, STONE_D, face);
      rubble(b, rnd, 5, 2, 9, y0 + 0.6, STONE_D, px, pz);
      continue;
    }
    b.box(6, pierH, 8, px, y0 + pierH / 2, pz, STONE, face);
    if (!L.broken.includes(i + 1) && i + 1 < count) {
      archR(b, px + ex * span / 2, y0 + pierH - 2, pz + ez * span / 2, span * 0.62, 5.5, 2.2, STONE_D, 7, face + 1.571);
      b.box(span + 1, 3.6, 9, px + ex * span / 2, topY - baseY + 1.8, pz + ez * span / 2, STONE, face);
      b.box(span + 1, 1.6, 1.2, px + ex * span / 2 - ez * 3.9, topY - baseY + 4.4, pz + ez * span / 2 + ex * 3.9, STONE_D, face);
      b.box(span + 1, 1.6, 1.2, px + ex * span / 2 + ez * 3.9, topY - baseY + 4.4, pz + ez * span / 2 - ex * 3.9, STONE_D, face);
      if (L.tall > 34) archR(b, px + ex * span / 2, topY - baseY + 5.6, pz + ez * span / 2, span * 0.46, 2.6, 1.4, STONE, 6, face + 1.571);
      if (L.tall > 34) b.box(span + 1, 2.2, 7, px + ex * span / 2, topY - baseY + 13, pz + ez * span / 2, STONE, face);
    }
  }
  rubble(b, rnd, 14, 10, 40, 0.4);
  return baseY;
}
function buildRoad(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const [ax, az] = L.from, [bx, bz] = L.to;
  const len = Math.hypot(bx - ax, bz - az);
  const nx = -(bz - az) / len, nz = (bx - ax) / len, bend = (rnd() - 0.5) * len * 0.35;
  const at = (t) => {
    const k = 4 * t * (1 - t);
    return [lerp(ax, bx, t) + nx * bend * k - L.x, lerp(az, bz, t) + nz * bend * k - L.z];
  };
  const n = Math.floor(len / 3.1);
  let shrine = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, [x, z] = at(t), [x2, z2] = at(Math.min(1, t + 0.01));
    const ry = -Math.atan2(z2 - z, x2 - x);
    const y = gy(L, x, z, baseY);
    if (y + baseY < 0.6) continue;                        // fords, not causeways
    if (rnd() < 0.12) { b.rock(0.6, x + (rnd() - 0.5) * 3, y + 0.2, z + (rnd() - 0.5) * 3, STONE_D); continue; }
    b.box(3.1, 0.35, 4.4, x, y + 0.15, z, i % 4 === 0 ? 0x847d70 : STONE, ry);
    if (i % 14 === 7) b.cyl(0.35, 0.5, 1.8, 4, x + nx * 3.2, y + 0.9, z + nz * 3.2, MARBLE_D);     // milestone
    if (i % Math.floor(n / (L.shrines + 1)) === Math.floor(n / (L.shrines + 1) / 2) && shrine < L.shrines) {
      shrine++;
      const sx = x - nx * 4.5, sz = z - nz * 4.5, sy = gy(L, sx, sz, baseY);
      b.box(2.6, 0.8, 2.6, sx, sy + 0.4, sz, STONE_D, ry);
      for (let k = 0; k < 4; k++) b.box(0.3, 2.8, 0.3, sx + ((k % 2) - 0.5) * 1.8, sy + 2.2, sz + (Math.floor(k / 2) - 0.5) * 1.8, WOOD_D);
      pitched(b, 3.0, 1.2, 3.0, sx, sy + 4.0, sz, 0x8a5b3c, ry);
      b.box(0.8, 1.2, 0.6, sx, sy + 1.4, sz, BRONZE, ry);
      b.cyl(0.15, 0.15, 0.5, 5, sx + 0.7, sy + 1.05, sz + 0.6, 0xe8d8a8);
    }
  }
  return baseY;
}
function buildBridge(L, b) {
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  const bankA = heightAt(L.x + ex * 26, L.z + ez * 26), bankB = heightAt(L.x - ex * 26, L.z - ez * 26);
  const baseY = Math.max(bankA, bankB, 1.5);
  const rnd = mulberry32(L.seed), face = -L.dir;
  const deckY = 1.5, span = 60;
  for (const s of [-1, 1]) {   // abutment towers on each bank
    const x = ex * 30 * s, z = ez * 30 * s, y = gy(L, x, z, baseY);
    b.box(7, deckY - y + 8, 9, x, y + (deckY - y + 8) / 2, z, STONE_D, face);
    b.box(1.6, 3.2, 9.5, x + ex * 4 * s, deckY + 8 + 1.2, z + ez * 4 * s, STONE, face);
    // weeping figures at the parapet ends
    b.cyl(0.5, 0.7, 2.4, 6, x - ez * 4 * s, deckY + 9.2, z + ex * 4 * s, MARBLE_D);
    b.rock(0.6, x - ez * 4 * s, deckY + 10.7, z + ex * 4 * s, MARBLE);
  }
  for (let i = -1; i <= 1; i += 2) {   // piers in the channel
    const x = ex * 10 * i, z = ez * 10 * i, y = gy(L, x, z, baseY) - 2;
    b.box(4, deckY - y + 6, 6, x, y + (deckY - y + 6) / 2, z, STONE, face);
    b.cone(2.2, 3, 4, x - ez * 3.5, deckY + 2, z + ex * 3.5, STONE_D, face + 0.785);
  }
  for (let i = -1; i <= 1; i++) archR(b, ex * 20 * i, deckY + 1.5, ez * 20 * i, 14, 2.4, 5, STONE_D, 7, face + 1.571);
  const broken = rnd() < 0.5;
  b.box(span, 1.6, 6, 0, deckY + 8.8, 0, STONE, face);
  for (const s of [-1, 1]) b.box(span, 1.2, 0.6, -ez * 2.8 * s, deckY + 10.2, ex * 2.8 * s, STONE_D, face);
  if (broken) {   // a bite out of the parapet, the fallen stones in the water below
    b.box(6, 3, 8, ex * 6, deckY + 9.5, ez * 6, STONE_D, face);
    rubble(b, rnd, 5, 2, 8, gy(L, ex * 6, ez * 6, baseY) - 1.5, STONE_D, ex * 6, ez * 6);
  }
  for (let i = 0; i < 6; i++) { const t = (i - 2.5) * 10; b.cyl(0.25, 0.32, 3.2, 5, ex * t - ez * 2.8, deckY + 11.4, ez * t + ex * 2.8, WOOD_D); }
  return baseY;
}

export const RUIN_BUILDERS = {
  coliseum: buildColiseum, temple: buildTemple, ziggurat: buildZiggurat, henge: buildHenge,
  obelisks: buildObelisks, necropolis: buildNecropolis, athenaeum: buildAthenaeum, baths: buildBaths,
  gate: buildGate, colossus: buildColossus, observatory: buildObservatory, watchtower: buildWatchtower,
  labyrinth: buildLabyrinth, windmill: buildWindmill, lighthouse: buildLighthouse,
  viaduct: buildViaduct, road: buildRoad, bridge: buildBridge,
};
export { column, fallenColumn, rubble, archR, pitched, gy };
