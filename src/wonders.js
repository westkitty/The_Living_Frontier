// Wonders of the land: impact craters, a crystal cathedral, the deep vault
// with its hidden world, a cenote, a mesa, a volcano and the rest. Same
// contract as ruins.js: (site, Builder) -> mesh origin Y. buildWonderGlow
// adds the unlit, self-luminous parts (crystal, lava, fungus) as a second
// geometry so they still shine at night.
import * as THREE from 'three';
import { heightAt } from './worldgen.js';
import { Builder } from './structures.js';
import { mulberry32 } from './rng.js';
import { column, fallenColumn, rubble, archR, pitched, gy } from './ruins.js';

const STONE_D = 0x6f6a60, MARBLE = 0xcfc7b6, MARBLE_D = 0xa9a292, DARK = 0x39332c, BONE = 0xc9c1ad, BONE_D = 0xa89f8a;
const BASALT = 0x3b3a3d, OBSIDIAN = 0x1f2326, CRYSTAL = 0xbfe6f2, CRYSTAL_D = 0x8fc4d6, OCHRE = 0xb7783f, OCHRE_D = 0x8f5a2e;
const FUNGUS = 0x5a7a63, FUNGUS_CAP = 0x8fd3a4, WOOD_D = 0x4c3823, GLASS = 0x233a40;

// A hexagonal crystal spike: point up, optionally leaning.
function spike(b, x, y, z, r, h, col, lean = 0, ry = 0, jitter = 0.08) {
  const g = new THREE.CylinderGeometry(0, r, h, 6);
  g.translate(0, h / 2, 0); g.rotateZ(lean); g.rotateY(ry); g.translate(x, y, z);
  b.add(g, col, jitter);
}
function cluster(b, rnd, x, y, z, n, size, col) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = rnd() * size * 0.6;
    spike(b, x + Math.cos(a) * d, y, z + Math.sin(a) * d, size * (0.25 + rnd() * 0.3), size * (0.8 + rnd() * 1.6), col, (rnd() - 0.5) * 0.9, rnd() * 6.283);
  }
}

// -------------------------------------------------------------------- impact
function buildImpact(L, b) {
  const baseY = heightAt(L.x, L.z + L.r * 1.05);
  const rnd = mulberry32(L.seed);
  // ejecta rays: lines of thrown boulders running out from the rim
  for (let ray = 0; ray < 7; ray++) {
    const a = ray / 7 * 6.283 + rnd() * 0.4;
    for (let k = 0; k < 6; k++) {
      const d = L.r * (0.85 + k * 0.11 + rnd() * 0.05), x = Math.cos(a) * d + (rnd() - 0.5) * 8, z = Math.sin(a) * d + (rnd() - 0.5) * 8;
      b.rock(1.2 + rnd() * 3.5 * (1 - k / 7), x, gy(L, x, z, baseY) + 0.8, z, rnd() < 0.3 ? 0x40383a : STONE_D);
    }
  }
  for (let i = 0; i < 20; i++) {   // rim boulders
    const a = rnd() * 6.283, d = L.r * (0.72 + rnd() * 0.16), x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.rock(2 + rnd() * 4, x, gy(L, x, z, baseY) + 1, z, STONE_D);
  }
  if (L.glass) {   // the bowl is floored with fused glass shards
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * L.r * 0.62, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const g = new THREE.OctahedronGeometry(0.8 + rnd() * 2.2, 0); g.scale(1, 1.8 + rnd(), 1); g.rotateZ((rnd() - 0.5) * 0.8); g.rotateY(rnd() * 6.28);
      g.translate(x, gy(L, x, z, baseY) + 0.6, z); b.add(g, rnd() < 0.5 ? GLASS : 0x2e4a4e, 0.06);
    }
  }
  if (L.peak) {   // the central peak carries what fell
    const py = gy(L, 0, 0, baseY);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.OctahedronGeometry(3.5 + (i % 3) * 2, 0); g.rotateZ(0.5 + i * 0.3); g.rotateY(i * 1.1);
      g.translate(Math.cos(i * 1.05) * i * 1.8, py + 2 + i * 1.6, Math.sin(i * 1.05) * i * 1.8); b.add(g, i % 2 ? 0x2b2233 : 0x3a2c44, 0.08);
    }
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; b.cyl(0.6, 1.0, 5 + (i % 3) * 2, 5, Math.cos(a) * 14, py + 2.5, Math.sin(a) * 14, 0x453b4c, [0.15 * Math.cos(a), 0, 0.15 * Math.sin(a)]); }
  }
  if (L.lake) {   // the Hollow Kin raised stones around the drowned star
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.283, d = L.r * 0.86, x = Math.cos(a) * d, z = Math.sin(a) * d;
      b.box(1.8, 5 + (i % 2) * 2, 1.2, x, gy(L, x, z, baseY) + 3, z, BASALT, -a + 1.571);
    }
    b.box(2.6, 1.0, 2.6, L.r * 0.86, gy(L, L.r * 0.86, 0, baseY) + 0.5, 0, BASALT);
    b.cyl(0.4, 0.4, 3.2, 5, 0, gy(L, 0, 0, baseY) + 12, 0, 0x2b2233);       // the tip still breaks the surface
  }
  return baseY;
}

// --------------------------------------------------------- crystal cathedral
function buildCrystal(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const nave = 100, half = 15;
  // the nave: pairs of spires leaning inward to meet as pointed arches
  const bays = Math.floor(L.spires / 2);
  for (let i = 0; i < bays; i++) {
    const z = -nave / 2 + (i + 0.5) * nave / bays;
    const h = 46 + Math.sin(i * 1.3) * 7 + rnd() * 9;
    for (const s of [-1, 1]) {
      spike(b, s * half, gy(L, s * half, z, baseY), z, 3.4 + rnd(), h, i % 3 ? CRYSTAL : CRYSTAL_D, -s * 0.36, 0);
      spike(b, s * (half + 9), gy(L, s * (half + 9), z, baseY), z, 2.2, h * 0.55, CRYSTAL_D, -s * 0.55, 0);   // flying buttress
      cluster(b, rnd, s * (half + 4), gy(L, s * (half + 4), z, baseY), z + 1.5, 3, 1.4, CRYSTAL_D);
    }
    if (i % 2 === 0) b.box(half * 2 + 2, 0.4, 2.4, 0, gy(L, 0, z, baseY) + 0.2, z, MARBLE_D);   // the floor's stone ribs
  }
  // the apse: a half-ring of great spires behind the altar
  for (let i = 0; i < 9; i++) {
    const a = -1.571 + i / 8 * 3.1416, x = Math.cos(a) * (half + 6), z = nave / 2 + 4 + Math.sin(a) * (half + 6) * 0.6;
    spike(b, x, gy(L, x, z, baseY), z, 3.6 + (i % 2), 58 + (i === 4 ? 20 : 0) - Math.abs(i - 4) * 3, i % 2 ? CRYSTAL : CRYSTAL_D, -Math.cos(a) * 0.25, 0);
  }
  // the transept crossing and its lantern spire
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) spike(b, s * (half + 6 + k * 6), gy(L, s * (half + 6 + k * 6), 6, baseY), 6, 2.2, 22 - k * 3, CRYSTAL_D, -s * 0.3 - k * 0.05, 0);
  spike(b, 0, gy(L, 0, 6, baseY) + 28, 6, 4.2, 50, CRYSTAL, 0, 0);
  // altar, benches and a shattered rose window on the floor
  const ay = gy(L, 0, nave / 2 - 6, baseY);
  b.box(6, 1.2, 3, 0, ay + 0.6, nave / 2 - 6, MARBLE); spike(b, 0, ay + 1.2, nave / 2 - 6, 1.2, 6, CRYSTAL, 0, 0);
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) b.box(7, 0.6, 1.0, s * 6, gy(L, s * 6, -nave / 2 + 8 + i * 5.5, baseY) + 0.5, -nave / 2 + 8 + i * 5.5, MARBLE_D);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; b.box(2.4, 0.3, 0.8, Math.cos(a) * 5, gy(L, 0, -nave / 2 + 2, baseY) + 0.15, -nave / 2 + 2 + Math.sin(a) * 5, CRYSTAL_D, -a); }
  // the ground itself crystallises in fields around the cathedral
  for (let i = 0; i < 30; i++) {
    const a = rnd() * 6.283, d = 56 + rnd() * 60, x = Math.cos(a) * d, z = Math.sin(a) * d;
    cluster(b, rnd, x, gy(L, x, z, baseY), z, 2 + Math.floor(rnd() * 3), 1.2 + rnd() * 2.4, rnd() < 0.5 ? CRYSTAL : CRYSTAL_D);
  }
  rubble(b, rnd, 8, 44, 70, 0.4, MARBLE_D);
  return baseY;
}

// -------------------------------------------------------- the undervault
// The fungal forest is walked twice (body, then glowing gills), so it draws
// from its own seed to land in the same places both times.
function forEachMushroom(L, baseY, fn) {
  const mr = mulberry32(L.seed + 1);
  for (let i = 0; i < 44; i++) {
    const a = mr() * 6.283, d = 14 + Math.sqrt(mr()) * L.r * 0.5, x = Math.cos(a) * d, z = Math.sin(a) * d;
    fn(x, gy(L, x, z, baseY), z, 2 + mr() * 6, 1.2 + mr() * 2.2, mr() < 0.7, mr() < 0.4);
  }
}
function buildChasm(L, b) {
  const baseY = L.floor;
  const rnd = mulberry32(L.seed);
  const top = heightAt(L.x + L.r, L.z) - baseY;
  // the roof: rings of leaning slabs close over the pit, leaving an oculus
  for (let ring = 0; ring < 5; ring++) {
    const rr = L.r * (0.96 - ring * 0.12), n = 26 - ring * 4, y = top + 2 + ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i + ring * 0.5) / n * 6.283, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const g = new THREE.BoxGeometry(rr * 6.6 / n + 3, 3.5 + rnd() * 2, L.r * 0.24);
      g.rotateX(-0.3 - ring * 0.12); g.rotateY(-a + 1.571); g.translate(x, y, z);
      b.add(g, ring % 2 ? 0x4a453f : 0x403b36, 0.07);
      if (rnd() < 0.35) b.cone(0.8 + rnd(), 3 + rnd() * 6, 5, x * 0.9, y - 3, z * 0.9, 0x585048, Math.PI);   // stalactites
    }
  }
  // the hidden world: a fungal forest, an underground shrine, the pool
  forEachMushroom(L, baseY, (x, y, z, h, cap, pale, twin) => {
    b.cyl(0.3 * cap, 0.45 * cap, h, 6, x, y + h / 2, z, FUNGUS);
    b.cone(cap, cap * 0.8, 8, x, y + h + cap * 0.3, z, pale ? FUNGUS_CAP : 0xd8b46a);
    if (twin) b.cyl(0.15, 0.2, h * 0.5, 5, x + 1, y + h * 0.25, z + 0.6, FUNGUS);
  });
  for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, d = 20 + rnd() * 40, x = Math.cos(a) * d, z = Math.sin(a) * d; cluster(b, rnd, x, gy(L, x, z, baseY), z, 4, 1.6, 0xa4e3b8); }
  const sy = gy(L, 0, -34, baseY);
  b.box(16, 1.2, 12, 0, sy + 0.6, -34, MARBLE_D);
  for (let i = 0; i < 6; i++) column(b, (i % 3 - 1) * 5.5, sy + 1.2, -34 + (i < 3 ? -4.5 : 4.5), 7, 0.6, MARBLE, rnd() < 0.3);
  b.box(3, 3.4, 2, 0, sy + 2.9, -34, 0x6a5bb5); pitched(b, 17, 2.4, 12.6, 0, sy + 9.6, -34, MARBLE_D);
  fallenColumn(b, rnd, 12, sy, -28, 6, 0.6, MARBLE_D);
  // bones of something that never saw the sun
  for (let i = 0; i < 7; i++) archR(b, 30 + i * 2.4, gy(L, 30 + i * 2.4, 22, baseY), 22, 8 - i * 0.6, 0.6, 0.5, BONE, 6, 1.571);
  b.box(6, 2.6, 4, 47, gy(L, 47, 22, baseY) + 1.3, 22, BONE_D, 0.3);
  // cave walls: boulders heaped along the throat's foot, stalagmites in the dark
  for (let i = 0; i < 30; i++) { const a = rnd() * 6.283, d = L.r * (0.2 + rnd() * 0.15), x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(1.5 + rnd() * 3, x, gy(L, x, z, baseY) + 0.5, z, 0x4b453e); }
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, d = L.r * (0.32 + rnd() * 0.5), x = Math.cos(a) * d, z = Math.sin(a) * d; b.cone(0.8 + rnd(), 2 + rnd() * 5, 5, x, gy(L, x, z, baseY) + 1, z, 0x5c554c); }
  return baseY;
}

// -------------------------------------------------------------------- cenote
function buildCenote(L, b) {
  const baseY = heightAt(L.x + L.r, L.z);
  const rnd = mulberry32(L.seed);
  const rim = L.r * 0.36;
  for (let i = 0; i < 22; i++) {   // rim stones and vines trailing over the lip
    const a = i / 22 * 6.283, x = Math.cos(a) * rim, z = Math.sin(a) * rim, y = gy(L, x * 1.15, z * 1.15, baseY);
    b.rock(1.2 + rnd() * 1.6, x * 1.12, y + 0.4, z * 1.12, STONE_D);
    if (rnd() < 0.5) b.cyl(0.12, 0.2, 8 + rnd() * 10, 4, x, y - 4 - rnd() * 5, z, 0x3f6b30);
  }
  const fy = gy(L, 0, 0, baseY);
  for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, d = 4 + rnd() * rim * 0.8, x = Math.cos(a) * d, z = Math.sin(a) * d; cluster(b, rnd, x, gy(L, x, z, baseY), z, 3, 1.3, 0x9fd6ff); }
  for (let i = 0; i < 5; i++) { const a = i * 1.26, x = Math.cos(a) * rim * 0.7, z = Math.sin(a) * rim * 0.7; b.cone(1 + rnd(), 3 + rnd() * 4, 5, x, gy(L, x, z, baseY) + 1.5, z, 0x5c554c); }
  b.box(2.4, 0.8, 2.4, 0, fy + 0.4, 0, MARBLE_D); b.cyl(0.5, 0.6, 2.4, 6, 0, fy + 2, 0, MARBLE);   // an offering stone
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  for (let i = 0; i < 7; i++) { const t = L.r * (0.2 + i * 0.1), x = ex * t, z = ez * t; b.box(2.4, 0.4, 1.2, x - ez * 3, gy(L, x, z, baseY) + 0.2, z + ex * 3, STONE_D, -L.dir); }
  return baseY;
}

// ---------------------------------------------------------------------- mesa
function buildMesa(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const R = L.r * 0.36;
  // a palace of kings on the tabletop: colonnade, hall, throne
  for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; column(b, Math.cos(a) * R, gy(L, Math.cos(a) * R, Math.sin(a) * R, baseY), Math.sin(a) * R, rnd() < 0.35 ? 3 : 8, 0.7, MARBLE, rnd() < 0.35); }
  b.box(18, 1.0, 14, 0, 0.5, 0, MARBLE_D);
  b.box(1.4, 6, 14, -9, 4, 0, OCHRE_D); b.box(18, 6, 1.4, 0, 4, -7, OCHRE_D); b.box(1.4, 4, 8, 9, 3, -3, OCHRE_D);
  b.box(3, 2, 3, 0, 2, -4, MARBLE); b.box(3, 4, 0.8, 0, 4, -5.4, MARBLE); b.box(0.6, 3, 2.6, -1.4, 3.5, -4, MARBLE); b.box(0.6, 3, 2.6, 1.4, 3.5, -4, MARBLE);
  b.cone(1.4, 2, 6, 0, 6.8, -5.4, 0xd4a640);
  for (let i = 0; i < 12; i++) { const a = rnd() * 6.283, d = R * 0.7 + rnd() * R * 0.5, x = Math.cos(a) * d, z = Math.sin(a) * d; b.box(2, 3 + rnd() * 5, 2, x, gy(L, x, z, baseY) + 2, z, OCHRE_D); }
  // the cliff edge is studded with stone markers; the ramp is stepped
  for (let i = 0; i < 20; i++) { const a = i / 20 * 6.283, d = L.r * 0.43, x = Math.cos(a) * d, z = Math.sin(a) * d; b.box(1.2, 2.4, 1.2, x, gy(L, x, z, baseY) + 1.2, z, OCHRE); }
  const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
  for (let i = 0; i < 24; i++) { const t = L.r * (0.42 + i * 0.024), x = ex * t, z = ez * t; b.box(9, 0.45, 2.4, x, gy(L, x, z, baseY) + 0.1, z, i % 2 ? OCHRE : OCHRE_D, -L.dir); }
  for (let i = 0; i < 18; i++) { const a = rnd() * 6.283, d = L.r * (0.5 + rnd() * 0.5), x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(2 + rnd() * 4, x, gy(L, x, z, baseY) + 1, z, OCHRE_D); }
  return baseY;
}

// ------------------------------------------------------------------- volcano
function buildVolcano(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  // basalt colonnades line the caldera; obsidian spurs break the slopes
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * 6.283, d = L.r * (0.2 + rnd() * 0.05), x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 4 + rnd() * 8; b.cyl(1.4, 1.4, h, 6, x, gy(L, x, z, baseY) + h / 2 - 1, z, i % 3 ? BASALT : 0x2f2e31);
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.283, d = L.r * (0.3 + rnd() * 0.65), x = Math.cos(a) * d, z = Math.sin(a) * d;
    spike(b, x, gy(L, x, z, baseY), z, 1 + rnd() * 2, 4 + rnd() * 8, OBSIDIAN, (rnd() - 0.5) * 0.7, rnd() * 6.283, 0.03);
    if (rnd() < 0.5) b.rock(1.5 + rnd() * 3, x + 3, gy(L, x + 3, z, baseY) + 0.6, z, 0x2f2b2a);
  }
  // the lava pool's crust and the ash-buried shrine on the rim
  const cy = gy(L, 0, 0, baseY);
  for (let i = 0; i < 12; i++) { const a = rnd() * 6.283, d = rnd() * L.r * 0.06, x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(2 + rnd() * 3, x, cy + 0.5, z, 0x1f1c1c); }
  const sx = Math.cos(1.2) * L.r * 0.26, sz = Math.sin(1.2) * L.r * 0.26, sy = gy(L, sx, sz, baseY);
  b.box(8, 1, 8, sx, sy + 0.5, sz, BASALT); for (let i = 0; i < 4; i++) column(b, sx + ((i % 2) - 0.5) * 5, sy + 1, sz + (Math.floor(i / 2) - 0.5) * 5, 5, 0.5, 0x5a5654, i === 3);
  b.box(2, 3, 1.4, sx, sy + 2.5, sz, 0xb5482e);
  return baseY;
}

// ------------------------------------------------------- geysers, petrified
function buildGeysers(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const tints = [0x3fa7a1, 0xd7a13a, 0xc46a2e, 0xe8dcc2];
  for (let v = 0; v < L.vents; v++) {
    const a = v / L.vents * 6.283 + rnd(), d = 8 + rnd() * 34, x = Math.cos(a) * d, z = Math.sin(a) * d, y = gy(L, x, z, baseY);
    const R = 4 + rnd() * 6;
    for (let t = 0; t < 3; t++) b.cyl(R - t * 1.3, R - t * 1.3 + 0.6, 0.6, 14, x, y + 0.3 + t * 0.55, z, tints[(v + t) % 4]);
    b.cyl(R * 0.5, R * 0.5, 0.3, 12, x, y + 1.9, z, 0x5fc6c2);                                       // the hot pool
    if (rnd() < 0.6) b.cone(1.2, 1.6, 6, x, y + 2.6, z, 0xe0d2b4);                                    // the vent cone
  }
  // a boardwalk the settlers laid to reach the hottest spring
  for (let i = 0; i < 14; i++) { const x = -40 + i * 3, z = 4 + Math.sin(i * 0.5) * 3; b.box(3, 0.3, 2.4, x, gy(L, x, z, baseY) + 0.5, z, WOOD_D, -Math.cos(i * 0.5) * 0.4); }
  for (let i = 0; i < 6; i++) { const x = -40 + i * 7.5, z = 4 + Math.sin(i * 1.25) * 3; b.cyl(0.15, 0.2, 1.6, 4, x, gy(L, x, z, baseY) + 0.8, z + 1.6, WOOD_D); }
  rubble(b, rnd, 8, 44, 60, 0.3, 0xe0d2b4);
  return baseY;
}
function buildPetrified(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let i = 0; i < L.trees; i++) {
    const a = rnd() * 6.283, d = 6 + Math.sqrt(rnd()) * 52, x = Math.cos(a) * d, z = Math.sin(a) * d, y = gy(L, x, z, baseY);
    const h = 5 + rnd() * 12, col = rnd() < 0.5 ? 0x7f7a72 : 0x8d857a;
    if (rnd() < 0.3) {   // fallen, snapped into logs
      const ry = rnd() * 6.283;
      for (let k = 0; k < 3; k++) b.cyl(0.9 - k * 0.15, 1.1 - k * 0.15, h / 3 - 0.4, 7, x + Math.cos(ry) * (k + 0.5) * h / 3, y + 0.9, z + Math.sin(ry) * (k + 0.5) * h / 3, col, [Math.PI / 2, ry + 1.571 + (rnd() - 0.5) * 0.2, 0]);
      b.cyl(1.1, 1.4, 1.6, 7, x, y + 0.8, z, col);
      continue;
    }
    b.cyl(0.6, 1.3, h, 7, x, y + h / 2, z, col);
    for (let k = 0; k < 3; k++) {
      const ba = rnd() * 6.283, bl = 2 + rnd() * 4, by = y + h * (0.5 + rnd() * 0.45);
      b.cyl(0.15, 0.4, bl, 5, x + Math.cos(ba) * bl * 0.4, by, z + Math.sin(ba) * bl * 0.4, col, [0, ba, 1.1]);
    }
    if (rnd() < 0.4) b.rock(0.5, x + 1.2, y + 0.4, z, 0xc98a2e);   // amber
  }
  rubble(b, rnd, 10, 50, 66, 0.3, 0x7f7a72);
  return baseY;
}

// ------------------------------------------------------- hoodoos, bones
function buildHoodoos(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let i = 0; i < L.pillars; i++) {
    const a = rnd() * 6.283, d = 10 + rnd() * 60, x = Math.cos(a) * d, z = Math.sin(a) * d;
    let y = gy(L, x, z, baseY) - 1, r = 2.2 + rnd() * 1.5;
    const n = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const h = 2 + rnd() * 3;
      b.cyl(r * (0.8 + rnd() * 0.3), r, h, 7, x, y + h / 2, z, k % 2 ? OCHRE : OCHRE_D);
      y += h; r *= 0.9;
    }
    b.rock(r * 1.6, x, y + r * 0.6, z, 0x6e5a4a);   // the capstone that saved it from the wind
  }
  for (let i = 0; i < L.arches; i++) {
    const a = i / L.arches * 6.283 + 0.5, d = 34 + (i % 2) * 14, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const w = 14 + rnd() * 10, y = gy(L, x, z, baseY);
    archR(b, x, y + 3, z, w, 5, 5, OCHRE, 8, rnd() * 3.14);
    for (const s of [-1, 1]) { const [px, pz] = [x + Math.cos(a + 1.571) * s * w / 2, z + Math.sin(a + 1.571) * s * w / 2]; b.cyl(2.6, 3.4, 5, 7, px, gy(L, px, pz, baseY) + 2, pz, OCHRE_D); }
  }
  for (let i = 0; i < 14; i++) { const a = rnd() * 6.283, d = rnd() * 70, x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(1 + rnd() * 3, x, gy(L, x, z, baseY) + 0.5, z, OCHRE_D); }
  return baseY;
}
function buildBones(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  const len = L.ribs * 5.2;
  for (let i = 0; i <= L.ribs * 2; i++) {   // the spine curves gently across the meadow
    const t = i / (L.ribs * 2), x = -len / 2 + t * len, z = Math.sin(t * 3.1) * 8;
    const y = gy(L, x, z, baseY), s = 1.2 * (1 - Math.abs(t - 0.35) * 0.9);
    b.box(2.4 * s, 1.6 * s, 2.0 * s, x, y + 1.2 * s + 0.3, z, i % 2 ? BONE : BONE_D, Math.cos(t * 3.1) * 0.3);
    if (i % 2 === 0 && i < L.ribs * 2 - 4 && i > 2) {
      const w = 10 + Math.sin(t * 3.1) * 16;
      if (rnd() < 0.8) archR(b, x, y + 0.5, z, w, 0.8, 0.7, BONE, 7, 1.571 + Math.cos(t * 3.1) * 0.3);
      else { b.cyl(0.4, 0.5, w * 0.4, 6, x, y + 0.5, z + w * 0.3, BONE_D, [1.2, 0, 0.4]); }
    }
  }
  // the skull, jaw agape, an eye socket you can walk into
  const sx = len / 2 + 6, sy = gy(L, sx, 0, baseY);
  b.box(14, 8, 9, sx, sy + 4, 0, BONE, 0.1);
  b.box(10, 2.2, 8, sx + 3, sy + 1.2, 1, BONE_D, 0.3);
  b.box(3.2, 3.2, 1, sx - 2, sy + 5, 4.6, DARK); b.box(3.2, 3.2, 1, sx - 2, sy + 5, -4.6, DARK);
  for (let i = 0; i < 6; i++) b.cone(0.4, 1.6, 4, sx - 4 + i * 1.8, sy + 2.6, 4.2, BONE, Math.PI);
  b.box(2.2, 6, 2.2, -len / 2 - 4, gy(L, -len / 2 - 4, 0, baseY) + 3, 0, MARBLE_D);   // the settlers' marker
  for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, d = 40 + rnd() * 24, x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(0.8 + rnd() * 1.4, x, gy(L, x, z, baseY) + 0.3, z, BONE_D); }
  return baseY;
}

// -------------------------------------------------------- shipwreck, monolith
function buildShipwreck(L, b) {
  const baseY = -1.0;
  const rnd = mulberry32(L.seed);
  const ry = L.dir, roll = 0.42, HULL = 0x4a3826, HULL_D = 0x3a2b1c;
  const part = (g, col) => { g.rotateZ(roll); g.rotateY(ry); b.add(g, col, 0.05); };
  const hull = new THREE.BoxGeometry(34, 7, 10); hull.translate(0, 2.4, 0); part(hull, HULL);
  const bow = new THREE.CylinderGeometry(0, 5.2, 12, 4); bow.rotateZ(-1.571); bow.rotateY(0.785); bow.translate(23, 3.2, 0); part(bow, HULL_D);
  const stern = new THREE.BoxGeometry(8, 9, 11); stern.translate(-19, 4.5, 0); part(stern, HULL_D);
  const deck = new THREE.BoxGeometry(30, 0.5, 9); deck.translate(0, 6.1, 0); part(deck, 0x6b5436);
  // the port side has rotted away to ribs
  for (let i = 0; i < 9; i++) { const rib = new THREE.BoxGeometry(0.7, 8, 0.6); rib.translate(-14 + i * 3.5, 3.5, 5.2); part(rib, HULL_D); }
  for (let i = 0; i < 3; i++) {
    const m = new THREE.CylinderGeometry(0.3, 0.5, i === 1 ? 26 : 16, 6); m.rotateZ(i === 1 ? 0.9 : 0.35 + i * 0.1); m.translate(-10 + i * 12, 12, 0); part(m, WOOD_D);
    if (i !== 1) { const yard = new THREE.BoxGeometry(0.4, 0.4, 12); yard.translate(-10 + i * 12, 15, 0); part(yard, WOOD_D); }
  }
  const nest = new THREE.CylinderGeometry(1.4, 1.1, 1.4, 8); nest.translate(2, 24, 0); part(nest, HULL_D);
  const sail = new THREE.BoxGeometry(0.2, 8, 11); sail.translate(-10, 11, 0); part(sail, 0xb9a98a);
  for (let i = 0; i < 6; i++) { const c = new THREE.BoxGeometry(1.6, 1.6, 1.6); c.translate(-8 + rnd() * 20, 7, -3 + rnd() * 6); part(c, 0xa08a58); }
  // cargo strewn across the shallows, and the anchor where it dragged
  for (let i = 0; i < 12; i++) { const a = rnd() * 6.283, d = 14 + rnd() * 30, x = Math.cos(a) * d, z = Math.sin(a) * d; b.box(1.4, 1.4, 1.4, x, gy(L, x, z, baseY) + 0.7, z, 0xa08a58, rnd()); }
  b.box(1.2, 6, 0.6, 30, gy(L, 30, 12, baseY) + 2.5, 12, 0x3a3a3f, 0.4); archR(b, 30, gy(L, 30, 12, baseY) + 0.2, 12, 5, 0.6, 0.6, 0x3a3a3f, 5, 1.2);
  return baseY;
}
function buildMonolith(L, b) {
  const baseY = heightAt(L.x, L.z);
  const rnd = mulberry32(L.seed);
  for (let s = 0; s < 4; s++) b.cyl(9 - s * 1.6, 9.4 - s * 1.6, 0.5, 16, 0, 0.25 + s * 0.5, 0, s % 2 ? BASALT : 0x46454a);
  b.box(3.2, 12, 1.1, 0, 2 + 6, 0, 0x121216);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 6.283, d = 20, x = Math.cos(a) * d, z = Math.sin(a) * d;
    b.box(1.2, 2.4 + (i % 3), 0.6, x, gy(L, x, z, baseY) + 1.4, z, BASALT, -a + 1.571);
  }
  for (let i = 0; i < 8; i++) { const a = rnd() * 6.283, d = 24 + rnd() * 16, x = Math.cos(a) * d, z = Math.sin(a) * d; b.rock(0.8 + rnd() * 1.6, x, gy(L, x, z, baseY) + 0.3, z, 0x2f2e31); }
  return baseY;
}

export const WONDER_BUILDERS = {
  impact: buildImpact, crystal: buildCrystal, chasm: buildChasm, cenote: buildCenote, mesa: buildMesa,
  volcano: buildVolcano, geysers: buildGeysers, petrified: buildPetrified, hoodoos: buildHoodoos,
  bones: buildBones, shipwreck: buildShipwreck, monolith: buildMonolith,
};

// Self-lit geometry for the sites that glow. Positioned at (L.x, baseY, L.z)
// like the site mesh itself. Returns null for sites that do not shine.
export function buildWonderGlow(L, baseY) {
  if (!L.glow) return null;
  const b = new Builder(), rnd = mulberry32(L.seed + 5);
  const g = (x, y, z, r, h, lean, ry) => spike(b, x, y, z, r, h, L.glow, lean, ry, 0.1);
  if (L.kind === 'crystal') {
    const nave = 100, half = 15, bays = Math.floor(L.spires / 2);
    for (let i = 0; i < bays; i++) {
      const z = -nave / 2 + (i + 0.5) * nave / bays;
      for (const s of [-1, 1]) g(s * half, gy(L, s * half, z, baseY) + 0.5, z, 1.6, 36 + Math.sin(i * 1.3) * 6, -s * 0.36, 0);
    }
    g(0, gy(L, 0, 6, baseY) + 32, 6, 2.0, 40, 0, 0);
    g(0, gy(L, 0, nave / 2 - 6, baseY) + 1.4, nave / 2 - 6, 0.6, 5, 0, 0);
    for (let i = 0; i < 24; i++) { const a = rnd() * 6.283, d = 56 + rnd() * 60, x = Math.cos(a) * d, z = Math.sin(a) * d; g(x, gy(L, x, z, baseY), z, 0.5 + rnd() * 0.6, 1.5 + rnd() * 3, (rnd() - 0.5) * 0.8, rnd() * 6.28); }
  } else if (L.kind === 'chasm') {
    forEachMushroom(L, baseY, (x, y, z, h, cap) => b.cyl(cap * 0.6, cap * 0.6, 0.25, 8, x, y + h + cap * 0.02, z, L.glow));   // the gills shine
    for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, d = 10 + rnd() * L.r * 0.7, x = Math.cos(a) * d, z = Math.sin(a) * d; g(x, gy(L, x, z, baseY), z, 0.3 + rnd() * 0.4, 1 + rnd() * 2.5, (rnd() - 0.5), rnd() * 6.28); }
  } else if (L.kind === 'cenote') {
    for (let i = 0; i < 30; i++) { const a = rnd() * 6.283, d = 3 + rnd() * L.r * 0.34, x = Math.cos(a) * d, z = Math.sin(a) * d; g(x, gy(L, x, z, baseY) + 0.2, z, 0.3 + rnd() * 0.4, 1 + rnd() * 2, (rnd() - 0.5), rnd() * 6.28); }
  } else if (L.kind === 'volcano') {
    b.cyl(L.r * 0.07, L.r * 0.07, 0.4, 20, 0, gy(L, 0, 0, baseY) + 0.3, 0, L.glow);
    for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, d = L.r * (0.08 + rnd() * 0.12), x = Math.cos(a) * d, z = Math.sin(a) * d; b.box(1.2 + rnd() * 3, 0.3, 0.5, x, gy(L, x, z, baseY) + 0.3, z, 0xffb050, a); }
  } else if (L.kind === 'monolith') {
    b.box(0.5, 9, 1.3, 0, 8, 0, L.glow);
    for (let i = 0; i < 3; i++) b.cyl(3 + i * 2.2, 3.2 + i * 2.2, 0.15, 24, 0, 2.05, 0, L.glow);
  }
  return b.parts.length ? b.build() : null;
}
