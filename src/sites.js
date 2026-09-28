// Every fixed place in the world, plus the terrain each kind of place demands.
// Headless: pure data and pure maths, so worldgen and the save format can lean
// on it without a DOM. The builders that give these sites a body live in
// structures.js, ruins.js and wonders.js.
import { clamp, lerp, smoothstep } from './rng.js';

export const WORLD = {
  seed: 1337,
  half: 1150,          // world extends -half..half on X and Z
  water: 0.0,          // sea / river level
  chunk: 180,          // chunk size in world units
  stateRes: 512,       // resolution of the persistent ground-state texture
  exploreRes: 128,     // resolution of the player's remembered map (fog of war)
  fireRes: 96,         // resolution of the fire/fuel grid
  regionRes: 12,       // ecology / faction region grid
};
WORLD.size = WORLD.half * 2;
WORLD.stateCell = WORLD.size / WORLD.stateRes;
WORLD.exploreCell = WORLD.size / WORLD.exploreRes;
WORLD.fireCell = WORLD.size / WORLD.fireRes;
WORLD.regionCell = WORLD.size / WORLD.regionRes;

export const FACTIONS = [
  { id: 0, name: 'The Verdant Pact', color: 0x4a9d5f, accent: '#68d18a', desc: 'Settlers, farmers, wardens of the woods.' },
  { id: 1, name: 'Ashen Legion', color: 0xb5482e, accent: '#ef7a54', desc: 'Iron discipline. They take what the land owes.' },
  { id: 2, name: 'Hollow Kin', color: 0x6a5bb5, accent: '#a08ef0', desc: 'Ruin-dwellers who speak to the old stones.' },
];

// Settlements (villages). Faction "home" is their founding allegiance.
export const SETTLEMENTS = [
  { id: 'greenhollow', name: 'Greenhollow', x: -180, z: 260, faction: 0 },
  { id: 'stonebeck', name: 'Stonebeck', x: 470, z: 180, faction: 0 },
  { id: 'ashford', name: 'Ashford', x: -560, z: -180, faction: 1 },
  { id: 'redmoor', name: 'Redmoor', x: 250, z: -230, faction: 2 },
  { id: 'highfen', name: 'Highfen', x: -60, z: 620, faction: 0 },
];

// Faction camps: static outposts whose colours follow whoever holds the ground.
export const CAMPS = [
  { id: 'camp_north', x: -300, z: 520 },
  { id: 'camp_east', x: 640, z: 300 },
  { id: 'camp_south', x: -120, z: -560 },
  { id: 'camp_west', x: -700, z: -60 },
  { id: 'camp_ridge', x: 420, z: 640 },
  { id: 'camp_waste', x: 240, z: -300 },
];

// Unbreakable power centres. Borders move, but no faction is ever wiped out,
// so the three-way war keeps running for as long as the world exists.
export const STRONGHOLDS = [
  { faction: 0, x: -180, z: 260, name: 'Greenhollow' },
  { faction: 0, x: -60, z: 620, name: 'Highfen' },
  { faction: 1, x: 140, z: 800, name: 'Fort Ashken' },
  { faction: 1, x: -560, z: -180, name: 'Ashford' },
  { faction: 2, x: -700, z: -620, name: 'Starfall Crater' },
  { faction: 2, x: 360, z: -560, name: 'The Drowned Halls' },
];

// ---------------------------------------------------------------------------
// Landmarks. `kind` picks the builder; `shape` picks how the ground is bent
// under it (see shapeSite). `seed` and the per-kind parameters make every
// instance of a kind come out differently, so the same generator can raise a
// dozen distinct temples or aqueducts.
// ---------------------------------------------------------------------------
export const LANDMARKS = [
  // --- the original nine (worldgen shapes these itself) --------------------
  { id: 'aqueduct', name: 'The Broken Aqueduct', x: -430, z: 110, r: 150, kind: 'aqueduct' },
  { id: 'drowned', name: 'The Drowned Halls', x: 360, z: -560, r: 150, kind: 'flooded' },
  { id: 'cliffhold', name: 'Cliffhold', x: 720, z: 600, r: 130, kind: 'cliff' },
  { id: 'crater', name: 'The Starfall Crater', x: -700, z: -620, r: 190, kind: 'crater' },
  { id: 'fortress', name: 'Fort Ashken', x: 140, z: 800, r: 130, kind: 'fortress' },
  { id: 'deadtree', name: 'The Hollow Giant', x: -130, z: -280, r: 110, kind: 'deadtree' },
  { id: 'cave_ember', name: 'Emberdeep Cavern', x: 620, z: -120, r: 70, kind: 'cave', dir: 2.35, len: 64, w: 17 },
  { id: 'cave_whisper', name: 'The Whispering Hollow', x: -840, z: 300, r: 70, kind: 'cave', dir: 0.5, len: 58, w: 15 },
  { id: 'cave_warren', name: 'The Sunken Warren', x: 40, z: -820, r: 70, kind: 'cave', dir: 4.1, len: 54, w: 16 },

  // --- ruins of the builders ----------------------------------------------
  { id: 'coliseum', name: 'The Coliseum of Nine Gates', x: 80, z: 380, r: 110, kind: 'coliseum', shape: 'arena', clear: 95, seed: 11, tiers: 4, ra: 46, rb: 36, gates: 9, fallen: 0.32 },
  { id: 'temple_dawn', name: 'The Temple of the First Dawn', x: -820, z: -380, r: 90, kind: 'temple', shape: 'flat', clear: 70, seed: 21, cols: 8, rows: 14, roof: 0.55, ruin: 0.25 },
  { id: 'temple_moon', name: 'The Moon Sanctum', x: 620, z: 720, r: 70, kind: 'temple', shape: 'flat', lift: 6, clear: 55, seed: 22, cols: 6, rows: 9, roof: 0.0, ruin: 0.6, round: true },
  { id: 'ziggurat', name: 'The Ziggurat of Ash', x: 760, z: -450, r: 100, kind: 'ziggurat', shape: 'zig', clear: 80, seed: 31, steps: 6, w: 64, stepH: 3.2 },
  { id: 'henge', name: 'The Standing Council', x: -480, z: 400, r: 70, kind: 'henge', shape: 'flat', clear: 50, seed: 41, stones: 13, rings: 2 },
  { id: 'obelisks', name: 'The Field of Needles', x: -50, z: 60, r: 80, kind: 'obelisks', shape: 'flat', clear: 60, seed: 51, count: 19 },
  { id: 'necropolis', name: 'The Silent Necropolis', x: -380, z: -420, r: 95, kind: 'necropolis', shape: 'flat', clear: 80, seed: 61, tombs: 26 },
  { id: 'athenaeum', name: 'The Fallen Athenaeum', x: -750, z: 100, r: 80, kind: 'athenaeum', shape: 'flat', clear: 60, seed: 71, wings: 3 },
  { id: 'baths', name: 'The Drowned Baths', x: -640, z: 520, r: 70, kind: 'baths', shape: 'flat', clear: 55, seed: 81, pools: 4 },
  { id: 'gate', name: 'The Triumphal Gate', x: 280, z: 300, r: 55, kind: 'gate', shape: 'flat', clear: 35, seed: 91, arches: 3 },
  { id: 'colossus', name: 'The Fallen Colossus', x: -250, z: -50, r: 80, kind: 'colossus', shape: 'flat', clear: 60, seed: 101 },
  { id: 'observatory', name: 'The Star Observatory', x: 860, z: 380, r: 65, kind: 'observatory', shape: 'flat', lift: 14, clear: 45, seed: 111 },
  { id: 'watchtower', name: "Sentinel's Rest", x: 600, z: 40, r: 45, kind: 'watchtower', shape: 'flat', lift: 12, clear: 25, seed: 121, h: 30 },
  { id: 'labyrinth', name: 'The Labyrinth of Quiet Stone', x: -650, z: -450, r: 80, kind: 'labyrinth', shape: 'flat', clear: 65, seed: 131, cells: 11 },
  { id: 'windmill', name: 'The Miller\'s Folly', x: 400, z: -80, r: 40, kind: 'windmill', shape: 'flat', lift: 4, clear: 22, seed: 141 },
  { id: 'lighthouse', name: 'The Drowned Beacon', x: 200, z: -700, r: 90, kind: 'lighthouse', shape: 'isle', dir: 2.2, clear: 90, seed: 151, h: 36 },
  { id: 'viaduct_marsh', name: 'The Marsh Aqueduct', x: -300, z: -720, r: 160, kind: 'viaduct', shape: 'flat', flatten: 0.5, clear: 40, seed: 161, dir: 0.55, span: 22, count: 13, broken: [3, 9, 10], tall: 30 },
  { id: 'viaduct_fen', name: 'The Highfen Aqueduct', x: 300, z: 470, r: 130, kind: 'viaduct', shape: 'flat', flatten: 0.5, clear: 40, seed: 162, dir: 2.0, span: 28, count: 9, broken: [6], tall: 40 },
  { id: 'road_pact', name: 'The Pact Road', x: -50, z: 320, r: 140, kind: 'road', clear: 0, seed: 171, from: [-160, 240], to: [60, 360], shrines: 2 },
  { id: 'road_gate', name: 'The Gate Road', x: 300, z: 260, r: 190, kind: 'road', clear: 0, seed: 172, from: [110, 360], to: [440, 190], shrines: 3 },
  { id: 'road_ash', name: 'The Ashen Way', x: -690, z: -280, r: 160, kind: 'road', clear: 0, seed: 173, from: [-580, -200], to: [-800, -360], shrines: 2 },
  { id: 'road_south', name: 'The Old Salt Road', x: 500, z: -340, r: 280, kind: 'road', clear: 0, seed: 174, from: [270, -250], to: [730, -430], shrines: 4 },
  { id: 'bridge', name: 'The Weeping Bridge', x: -500, z: -690, r: 60, kind: 'bridge', clear: 30, seed: 181 },

  // --- wonders of the land -------------------------------------------------
  { id: 'impact_glass', name: 'The Glass Crater', x: 820, z: 100, r: 120, kind: 'impact', shape: 'impact', depth: 28, rim: 16, peak: true, clear: 130, seed: 201, glass: true },
  { id: 'impact_lake', name: 'The Drowned Star', x: -860, z: -160, r: 80, kind: 'impact', shape: 'impact', depth: 40, rim: 14, clear: 90, seed: 202, lake: true },
  { id: 'crystal', name: 'The Crystal Cathedral', x: -560, z: 760, r: 130, kind: 'crystal', shape: 'flat', lift: -4, clear: 130, seed: 211, spires: 24, glow: 0x8fe8ff, glowRange: 120 },
  { id: 'chasm', name: 'The Undervault', x: 640, z: -850, r: 130, kind: 'chasm', shape: 'pit', floor: 4, clear: 140, seed: 221, glow: 0x9be6a8, glowRange: 110 },
  { id: 'cenote', name: 'The Well of Echoes', x: 300, z: 40, r: 60, kind: 'cenote', shape: 'sink', dir: 3.6, clear: 65, seed: 231, glow: 0x6fc8ff, glowRange: 60 },
  { id: 'mesa', name: 'The Table of Kings', x: 720, z: -650, r: 110, kind: 'mesa', shape: 'mesa', dir: 1.2, lift: 42, clear: 60, seed: 241 },
  { id: 'volcano', name: 'The Cinder Throat', x: -860, z: 640, r: 150, kind: 'volcano', shape: 'cone', lift: 88, clear: 160, seed: 251, glow: 0xff7a2a, glowRange: 90 },
  { id: 'geysers', name: 'The Steaming Terraces', x: 150, z: -450, r: 75, kind: 'geysers', shape: 'flat', clear: 70, seed: 261, vents: 9 },
  { id: 'petrified', name: 'The Petrified Grove', x: -300, z: 800, r: 85, kind: 'petrified', shape: 'flat', clear: 85, seed: 271, trees: 22 },
  { id: 'hoodoos', name: 'The Wind Arches', x: 900, z: -200, r: 90, kind: 'hoodoos', clear: 70, seed: 281, arches: 4, pillars: 14 },
  { id: 'bones', name: 'The Leviathan Bones', x: 500, z: 850, r: 80, kind: 'bones', shape: 'flat', clear: 70, seed: 291, ribs: 16 },
  { id: 'shipwreck', name: 'The Wreck of the Aster', x: 440, z: -720, r: 70, kind: 'shipwreck', shape: 'lagoon', dir: 0.9, clear: 60, seed: 301 },
  { id: 'monolith', name: 'The Black Monolith', x: -100, z: 880, r: 50, kind: 'monolith', shape: 'flat', lift: 3, clear: 45, seed: 311, glow: 0xb08cff, glowRange: 50 },
];

// Every distinct generator the world draws on.
export const SITE_KINDS = [...new Set(LANDMARKS.map(L => L.kind))];

const wrap = (a) => { while (a > Math.PI) a -= 6.283185; while (a < -Math.PI) a += 6.283185; return a; };
const fall = (d, r) => 1 - smoothstep(r * 0.35, r, d);

// Bend the terrain under a site. `base` is the untouched ground height at the
// site centre; every profile is written relative to it so a site can sit on
// any hillside without opening a cliff at its edge.
export function shapeSite(L, dx, dz, d, h, base) {
  const r = L.r, rr = d / r;
  switch (L.shape) {
    case 'flat': {
      const t = Math.max(4, base + (L.lift || 0));
      return lerp(h, t, fall(d, r) * (L.flatten ?? 0.92));
    }
    case 'arena': {
      // sunken floor ringed by terraced stands you can climb
      const e = Math.sqrt((dx / L.ra) ** 2 + (dz / L.rb) ** 2);
      const tier = clamp(Math.floor((e - 1) / (5 / L.ra)) + 1, 0, L.tiers);
      const p = e < 1 ? -2.4 : (e < 1 + L.tiers * 5 / L.ra + 0.08 ? tier * 2.2 : 0);
      const t = Math.max(4, base) + p;
      return lerp(h, t, fall(d, r) * 0.95);
    }
    case 'zig': {
      // a stepped pyramid raised out of the ground itself, one face a ramp
      const half = L.w / 2, m = Math.max(Math.abs(dx), Math.abs(dz)), t = Math.max(4, base);
      let level = m < half ? clamp(Math.floor((half - m) / (half / L.steps)) + 1, 0, L.steps) : 0;
      let lift = level * L.stepH;
      if (Math.abs(dz) < 4 && dx > 0 && dx < half + 4) lift = Math.max(lift, L.steps * L.stepH * clamp(1 - dx / half, 0, 1));
      return lerp(h, t + lift, fall(d, r) * 0.95);
    }
    case 'impact': {
      const depth = L.depth || 30, rimH = L.rim || 16;
      const bowl = -depth * (1 - smoothstep(0.0, 0.72, rr));
      const peak = L.peak ? depth * 0.5 * (1 - smoothstep(0, 0.16, rr)) : 0;
      const rim = rimH * Math.exp(-Math.pow((rr - 0.8) * 6, 2));
      const g = 1 - smoothstep(0.9, 1.35, rr);
      return lerp(h, Math.max(3, base) + bowl + peak + rim, g);
    }
    case 'pit': {
      // a deep terraced throat with a wet floor: the way down is a walk, not a fall
      const floor = L.floor ?? 4, top = Math.max(floor + 34, base);
      let s = smoothstep(0.26, 0.92, rr);
      s += Math.sin(s * Math.PI * 7) * 0.025 * (1 - s);
      const pool = -6 * (1 - smoothstep(0.04, 0.12, rr));
      const g = 1 - smoothstep(0.92, 1.35, rr);
      return lerp(h, floor + (top - floor) * s + pool, g);
    }
    case 'sink': {
      // a sheer-walled well; one collapsed slope (facing L.dir) offers a way out
      const floor = -6, top = Math.max(floor + 22, base);
      const da = Math.abs(wrap(Math.atan2(dz, dx) - L.dir));
      const wall = smoothstep(0.34, 0.5, rr);
      const ramp = smoothstep(0.12, 1.0, rr);
      const s = lerp(wall, ramp, 1 - smoothstep(0.32, 0.55, da));
      const g = 1 - smoothstep(0.9, 1.3, rr);
      return lerp(h, floor + (top - floor) * s, g);
    }
    case 'mesa': {
      const lift = L.lift || 40;
      const da = Math.abs(wrap(Math.atan2(dz, dx) - L.dir));
      let s = 1 - smoothstep(0.42, 0.62, rr);
      const rampS = (1 - smoothstep(0.42, 1.0, rr)) * (1 - smoothstep(0.16, 0.26, da));
      s = Math.max(s, rampS);
      const g = 1 - smoothstep(0.95, 1.35, rr);
      return lerp(h, Math.max(4, base) + lift * s, g);
    }
    case 'cone': {
      const lift = L.lift || 80;
      let s = 1 - smoothstep(0.0, 0.95, rr);
      s -= 0.42 * (1 - smoothstep(0.07, 0.24, rr));            // caldera
      const g = 1 - smoothstep(0.95, 1.35, rr);
      return lerp(h, Math.max(4, base) + lift * s, g);
    }
    case 'isle': {
      // a rock in a shallow bay, tied to the shore by a causeway along L.dir
      const da = Math.abs(wrap(Math.atan2(dz, dx) - L.dir));
      let t = lerp(7, -3.5, smoothstep(0.28, 0.46, rr));
      t = Math.max(t, 1.4 * (1 - smoothstep(0.05, 0.11, da)));
      const g = 1 - smoothstep(0.7, 1.3, rr);
      return lerp(h, t, g);
    }
    case 'lagoon': return lerp(h, -2.6, fall(d, r) * 0.95);
    default: return h;
  }
}

// Height queries run in the millions, so sites are bucketed on a coarse grid
// and each query only considers the handful whose reach covers its cell.
const GRID = 32, EMPTY = [];
let grid = null;
export function invalidateSiteGrid() { grid = null; for (const L of LANDMARKS) L.baseH = undefined; }
function buildSiteGrid() {
  grid = Array.from({ length: GRID * GRID }, () => []);
  const cell = WORLD.size / GRID;
  for (const L of LANDMARKS) {
    L.reach = L.kind === 'cave' ? L.len + L.w + 20 : L.r * 1.4;
    const span = Math.max(L.reach, L.clear || 0);
    const i0 = Math.max(0, Math.floor((L.x - span + WORLD.half) / cell)), i1 = Math.min(GRID - 1, Math.floor((L.x + span + WORLD.half) / cell));
    const j0 = Math.max(0, Math.floor((L.z - span + WORLD.half) / cell)), j1 = Math.min(GRID - 1, Math.floor((L.z + span + WORLD.half) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * GRID + i].push(L);
  }
}
export function sitesNear(x, z) {
  if (!grid) buildSiteGrid();
  const cell = WORLD.size / GRID;
  const i = Math.floor((x + WORLD.half) / cell), j = Math.floor((z + WORLD.half) / cell);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return EMPTY;
  return grid[j * GRID + i];
}

// Vegetation thins out across a site so ruins read as ruins, not thickets.
export function siteClearing(x, z) {
  let k = 1;
  const near = sitesNear(x, z);
  for (let i = 0; i < near.length; i++) {
    const L = near[i];
    if (!L.clear) continue;
    const dx = x - L.x, dz = z - L.z, c = L.clear;
    if (dx * dx + dz * dz > c * c) continue;
    k *= smoothstep(c * 0.55, c, Math.sqrt(dx * dx + dz * dz));
  }
  return k;
}
