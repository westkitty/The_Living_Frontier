// Deterministic world generation: heightfield, biomes, landmark sites, settlement sites.
import { fbm2, ridge2, valueNoise2, clamp, lerp, smoothstep, hash2i } from './rng.js';

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

// ---------------------------------------------------------------------------
// Landmarks (hand-placed, procedurally built)
// ---------------------------------------------------------------------------
export const LANDMARKS = [
  { id: 'aqueduct', name: 'The Broken Aqueduct', x: -430, z: 110, r: 150, kind: 'aqueduct' },
  { id: 'drowned', name: 'The Drowned Halls', x: 360, z: -560, r: 150, kind: 'flooded' },
  { id: 'cliffhold', name: 'Cliffhold', x: 720, z: 600, r: 130, kind: 'cliff' },
  { id: 'crater', name: 'The Starfall Crater', x: -700, z: -620, r: 190, kind: 'crater' },
  { id: 'fortress', name: 'Fort Ashken', x: 140, z: 800, r: 130, kind: 'fortress' },
  { id: 'deadtree', name: 'The Hollow Giant', x: -130, z: -280, r: 110, kind: 'deadtree' },
  { id: 'cave_ember', name: 'Emberdeep Cavern', x: 620, z: -120, r: 70, kind: 'cave', dir: 2.35, len: 64, w: 17 },
  { id: 'cave_whisper', name: 'The Whispering Hollow', x: -840, z: 300, r: 70, kind: 'cave', dir: 0.5, len: 58, w: 15 },
  { id: 'cave_warren', name: 'The Sunken Warren', x: 40, z: -820, r: 70, kind: 'cave', dir: 4.1, len: 54, w: 16 },
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

// Settlements (villages). Faction "home" is their founding allegiance.
export const SETTLEMENTS = [
  { id: 'greenhollow', name: 'Greenhollow', x: -180, z: 260, faction: 0 },
  { id: 'stonebeck', name: 'Stonebeck', x: 470, z: 180, faction: 0 },
  { id: 'ashford', name: 'Ashford', x: -560, z: -180, faction: 1 },
  { id: 'redmoor', name: 'Redmoor', x: 250, z: -230, faction: 2 },
  { id: 'highfen', name: 'Highfen', x: -60, z: 620, faction: 0 },
];

export const FACTIONS = [
  { id: 0, name: 'The Verdant Pact', color: 0x4a9d5f, accent: '#68d18a', desc: 'Settlers, farmers, wardens of the woods.' },
  { id: 1, name: 'Ashen Legion', color: 0xb5482e, accent: '#ef7a54', desc: 'Iron discipline. They take what the land owes.' },
  { id: 2, name: 'Hollow Kin', color: 0x6a5bb5, accent: '#a08ef0', desc: 'Ruin-dwellers who speak to the old stones.' },
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

// A gentle site influence used to flatten/shape terrain around structures.
function siteFalloff(dx, dz, r) {
  const d = Math.sqrt(dx * dx + dz * dz);
  return 1 - smoothstep(r * 0.35, r, d);
}

// ---------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------
const S = WORLD.seed;

export function continentMask(x, z) {
  // Keeps the playable area an island-ish basin ringed by impassable mountains.
  const d = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
  return smoothstep(1.02, 0.80, d);
}

export function riverField(x, z) {
  // Warped ridged field -> thin winding valleys where |n| is small.
  const wx = x * 0.0011 + fbm2(x * 0.0009, z * 0.0009, 3, S + 51) * 1.7;
  const wz = z * 0.0011 + fbm2(x * 0.0009 + 31.7, z * 0.0009 - 12.3, 3, S + 52) * 1.7;
  const n = valueNoise2(wx, wz, S + 77) * 2 - 1;
  return Math.abs(n);
}

export function baseHeight(x, z) {
  const m = continentMask(x, z);
  const rolling = fbm2(x * 0.0016, z * 0.0016, 5, S + 1) - 0.5;      // -0.5..0.5
  const hills = fbm2(x * 0.0060, z * 0.0060, 4, S + 2) - 0.5;
  const mountainMask = smoothstep(0.52, 0.86, fbm2(x * 0.0011 + 9.1, z * 0.0011 - 4.4, 4, S + 3));
  const mountains = ridge2(x * 0.0035, z * 0.0035, 5, S + 4);

  let h = 14 + rolling * 78 + hills * 16;
  h += mountainMask * mountains * 155;

  // Ring of border mountains so the world feels bounded but natural.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD.half;
  h += smoothstep(0.78, 1.05, edge) * 260;
  h = lerp(-6, h, clamp(m + smoothstep(0.78, 1.0, edge), 0, 1));
  return h;
}

export function heightAt(x, z) {
  let h = baseHeight(x, z);

  // Rivers carve valleys toward water level.
  const rv = riverField(x, z);
  const bank = smoothstep(0.085, 0.012, rv);
  if (bank > 0) {
    const bed = -3.2 - smoothstep(0.05, 0.0, rv) * 2.0;
    const lowlandOnly = 1 - smoothstep(60, 150, h);   // rivers don't cut through peaks
    h = lerp(h, bed, bank * 0.92 * lowlandOnly + bank * 0.12);
  }

  // Landmark shaping
  for (let i = 0; i < LANDMARKS.length; i++) {
    const L = LANDMARKS[i];
    const dx = x - L.x, dz = z - L.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > (L.kind === 'cave' ? L.len + L.w + 20 : L.r * 1.4)) continue;
    if (L.kind === 'crater') {
      const rr = d / L.r;
      const bowl = -46 * (1 - smoothstep(0.0, 0.74, rr));
      const rim = 30 * Math.exp(-Math.pow((rr - 0.80) * 6.0, 2));
      h = h * (1 - siteFalloff(dx, dz, L.r * 1.25) * 0.5) + bowl + rim;
    } else if (L.kind === 'flooded') {
      const f = siteFalloff(dx, dz, L.r * 1.3);
      h = lerp(h, -7.5, f * 0.94);
    } else if (L.kind === 'fortress') {
      const f = siteFalloff(dx, dz, L.r * 0.9);
      const plateau = 58;
      h = lerp(h, plateau, f * 0.95);
    } else if (L.kind === 'cliff') {
      const f = siteFalloff(dx, dz, L.r * 1.2);
      const terrace = 92 + Math.floor(clamp((d / L.r) * 3, 0, 3)) * -13;
      h = lerp(h, terrace, f * 0.85);
    } else if (L.kind === 'aqueduct') {
      const f = siteFalloff(dx, dz, L.r * 1.25);
      h = lerp(h, 10 + Math.sin(x * 0.01) * 3, f * 0.6);
    } else if (L.kind === 'cave' && !_skipCaves) {
      // carve a roofed slot into the hillside so caves are real, walkable space
      const ex = Math.cos(L.dir), ez = Math.sin(L.dir);
      const px = x - L.x, pz = z - L.z;
      const t = clamp((px * ex + pz * ez) / L.len, 0, 1);
      const cxp = t * L.len * ex, czp = t * L.len * ez;
      const dd = Math.hypot(px - cxp, pz - czp);
      const halfW = L.w * 0.5;
      const carve = 1 - smoothstep(halfW, halfW + 7, dd);
      if (carve > 0) {
        const floorY = caveFloor(L);
        h = h - Math.max(0, h - floorY) * carve * (0.55 + 0.45 * smoothstep(0, 0.35, t));
      }
    } else if (L.kind === 'deadtree') {
      const f = siteFalloff(dx, dz, L.r);
      h = lerp(h, 26, f * 0.7) + f * 6;
    }
  }

  // Settlements sit on flattened ground.
  for (let i = 0; i < SETTLEMENTS.length; i++) {
    const Sx = SETTLEMENTS[i];
    const dx = x - Sx.x, dz = z - Sx.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 200 * 200) continue;
    const f = siteFalloff(dx, dz, 92);
    if (f > 0) {
      const target = settlementGroundY(i);
      h = lerp(h, target, f * 0.93);
    }
  }
  return h;
}

let _skipCaves = false;
const caveFloors = {};
export function caveFloor(L) {
  // the floor sits just under the mouth, so the tunnel runs level into the hill
  if (caveFloors[L.id] === undefined) {
    _skipCaves = true;
    caveFloors[L.id] = Math.max(2.0, heightAt(L.x, L.z) - 2.2);
    _skipCaves = false;
  }
  return caveFloors[L.id];
}

// Caves need a dry hillside that actually rises in front of them: find one.
let _cavesResolved = false;
export function resolveCaveSites() {
  if (_cavesResolved) return;
  _cavesResolved = true;
  _skipCaves = true;
  for (const L of LANDMARKS) {
    if (L.kind !== 'cave') continue;
    let best = null, bestScore = -1e9;
    for (let r = 0; r <= 240; r += 24) {
      const n = r === 0 ? 1 : Math.max(6, Math.round(r / 12));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.11;
        const px = L.x + Math.cos(a) * r, pz = L.z + Math.sin(a) * r;
        if (Math.abs(px) > WORLD.half - 200 || Math.abs(pz) > WORLD.half - 200) continue;
        const h = heightAt(px, pz);
        if (h < 9 || h > 95) continue;
        if (riverField(px, pz) < 0.14) continue;          // not in a river bed
        for (let d = 0; d < 12; d++) {
          const ang = (d / 12) * Math.PI * 2;
          const ex = Math.cos(ang), ez = Math.sin(ang);
          const mid = heightAt(px + ex * L.len * 0.5, pz + ez * L.len * 0.5);
          const far = heightAt(px + ex * L.len, pz + ez * L.len);
          const rise = Math.min(mid - h, far - h);
          const score = rise - r * 0.06;
          if (rise > 18 && score > bestScore) { bestScore = score; best = [px, pz, ang]; }
        }
      }
      if (best && r >= 96) break;
    }
    if (best) { L.x = best[0]; L.z = best[1]; L.dir = best[2]; }
  }
  _skipCaves = false;
}

// Deterministically nudge a point onto sensible, dry, walkable ground.
const landCache = {};
export function placeOnLand(key, x, z, minH = 4, maxSlope = 0.22) {
  if (landCache[key]) return landCache[key];
  let best = [x, z], bestScore = -1e9;
  for (let ring = 0; ring < 9; ring++) {
    const r = ring * 16;
    const n = ring === 0 ? 1 : ring * 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = heightAt(px, pz);
      const sl = slopeAt(px, pz);
      if (h < minH || h > 150) continue;
      const score = -sl * 40 - r * 0.02 + Math.min(h, 30) * 0.05;
      if (sl < maxSlope && score > bestScore) { bestScore = score; best = [px, pz]; }
    }
    if (bestScore > -1e8 && ring >= 2) break;
  }
  landCache[key] = best;
  return best;
}

const settleY = [];
export function settlementGroundY(i) {
  if (settleY[i] === undefined) {
    const s = SETTLEMENTS[i];
    settleY[i] = Math.max(3.5, baseHeight(s.x, s.z) * 0.85 + 4);
  }
  return settleY[i];
}

resolveCaveSites();   // deterministic, runs once at module load

export function normalAt(x, z, e = 1.2) {
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  const nx = hL - hR, nz = hD - hU, ny = 2 * e;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function slopeAt(x, z) {
  const n = normalAt(x, z);
  return 1 - n[1];
}

// Moisture & temperature drive biomes and vegetation density.
export function moistureFrom(h, x, z) {
  const base = fbm2(x * 0.0022 + 100, z * 0.0022 - 60, 4, S + 11);
  const nearWater = smoothstep(26, 2, Math.max(0, h));
  const river = smoothstep(0.10, 0.02, riverField(x, z));
  return clamp(base * 0.72 + nearWater * 0.3 + river * 0.45, 0, 1);
}
export function moistureAt(x, z) { return moistureFrom(heightAt(x, z), x, z); }

export const BIOME = { WATER: 0, BEACH: 1, MEADOW: 2, FOREST: 3, HIGHLAND: 4, ROCK: 5, SNOW: 6, MARSH: 7 };

export function biomeAt(x, z, h = heightAt(x, z), m = moistureAt(x, z)) {
  if (h < WORLD.water) return BIOME.WATER;
  if (h < 1.6) return m > 0.62 ? BIOME.MARSH : BIOME.BEACH;
  if (h > 150) return BIOME.SNOW;
  if (h > 104) return BIOME.ROCK;
  if (h > 66) return BIOME.HIGHLAND;
  return m > 0.52 ? BIOME.FOREST : BIOME.MEADOW;
}

// Base (pre-simulation) vegetation density 0..1 at a point.
// Cheap variant for the scatterer: takes values the caller already has.
export function treeDensityFrom(h, m, slope, x, z) {
  if (h < 1.2 || h > 128) return 0;
  const clump = fbm2(x * 0.0085, z * 0.0085, 3, S + 21);
  let d = clamp((m - 0.30) * 1.7, 0, 1) * clamp(clump * 1.5 - 0.22, 0, 1);
  d *= 1 - smoothstep(92, 128, h);
  d *= 1 - smoothstep(0.35, 0.75, slope);
  return clamp(d * 1.25, 0, 1);
}
export function treeDensityAt(x, z) {
  const h = heightAt(x, z);
  if (h < 1.2 || h > 128) return 0;
  return treeDensityFrom(h, moistureFrom(h, x, z), slopeAt(x, z), x, z);
}

export function isBuildableFlat(x, z) {
  return slopeAt(x, z) < 0.22 && heightAt(x, z) > 1.5;
}

// Deterministic ore / forage node seeding
export function resourceRoll(x, z, kind) {
  return hash2i(Math.round(x * 3.1), Math.round(z * 3.1), S + (kind === 'ore' ? 900 : 901));
}
