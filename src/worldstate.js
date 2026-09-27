// The persistent, simulated world. Everything the player changes lives here,
// is ticked over time (even while the game is closed) and is saved to localStorage.
import { WORLD, SETTLEMENTS, FACTIONS, LANDMARKS, STRONGHOLDS, treeDensityAt, heightAt, moistureAt } from './worldgen.js';
import { clamp, lerp, mulberry32 } from './rng.js';

export const SAVE_KEY = 'living_frontier_save_v1';
export const DAY_LENGTH = 420;       // real seconds for a full day/night cycle
const R = WORLD.stateRes, FR = WORLD.fireRes, RR = WORLD.regionRes;
const XR = WORLD.exploreRes;

// ---------------------------------------------------------------------------
// Compression helpers (RLE + base64) so a 256KB ground map fits in localStorage
// ---------------------------------------------------------------------------
function deinterleave(u8, ch) {
  const n = u8.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = u8[i * 4 + ch];
  return out;
}
function interleaveInto(u8, plane, ch) {
  for (let i = 0; i < plane.length; i++) u8[i * 4 + ch] = plane[i];
}
function rleEncode(u8) {
  const out = [];
  let i = 0;
  while (i < u8.length) {
    const v = u8[i]; let n = 1;
    while (i + n < u8.length && u8[i + n] === v && n < 65535) n++;
    out.push(v, n); i += n;
  }
  const buf = new Uint8Array(out.length * 3 / 2 | 0 + 8);
  const arr = [];
  for (let k = 0; k < out.length; k += 2) { arr.push(out[k], out[k + 1] & 255, (out[k + 1] >> 8) & 255); }
  const bytes = new Uint8Array(arr);
  let s = '';
  for (let k = 0; k < bytes.length; k += 4096) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 4096));
  return btoa(s);
}
function quantize(u8, step) {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = Math.round(u8[i] / step) * step;
  return out;
}
export function rleDecode(b64, length) {
  const bin = atob(b64);
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 2 < bin.length + 1 && p < length; i += 3) {
    const v = bin.charCodeAt(i);
    const n = bin.charCodeAt(i + 1) | (bin.charCodeAt(i + 2) << 8);
    for (let k = 0; k < n && p < length; k++) out[p++] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
export function worldToState(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.stateCell), 0, R - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.stateCell), 0, R - 1);
  return j * R + i;
}
export function worldToFire(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.fireCell), 0, FR - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.fireCell), 0, FR - 1);
  return j * FR + i;
}
export function fireToWorld(idx) {
  const i = idx % FR, j = (idx / FR) | 0;
  return [(i + 0.5) * WORLD.fireCell - WORLD.half, (j + 0.5) * WORLD.fireCell - WORLD.half];
}
export function regionIndex(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.regionCell), 0, RR - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.regionCell), 0, RR - 1);
  return j * RR + i;
}
export function regionCenter(idx) {
  const i = idx % RR, j = (idx / RR) | 0;
  return [(i + 0.5) * WORLD.regionCell - WORLD.half, (j + 0.5) * WORLD.regionCell - WORLD.half];
}

// Ground channels
export const CH = { BURN: 0, TRAIL: 1, LUSH: 2, DEV: 3 };

export class WorldState {
  constructor(seed = WORLD.seed) {
    this.seed = seed;
    this.version = 1;
    this.time = 0.28;           // 0..1 fraction of day (0.28 = morning)
    this.day = 1;
    this.elapsed = 0;           // total simulated seconds
    this.savedAt = Date.now();

    this.ground = new Uint8Array(R * R * 4);
    // The map the player has personally earned. 0 = never seen, 255 = walked it.
    this.groundStamp = 0;
    this.explored = new Uint8Array(XR * XR);
    this.exploredDirty = true;
    // one compact sample per in-world day, so the world can show its own past
    this.history = [];
    this.fuel = new Uint8Array(FR * FR);
    this.burning = new Float32Array(FR * FR);
    this.burnTimer = new Float32Array(FR * FR);

    this.burningList = [];
    this.weather = { type: 'clear', intensity: 0, target: 0, next: 90, windDir: 0.7, windSpeed: 0.45 };

    this.regions = [];
    this.settlements = [];
    this.factions = [];
    this.vegRemoved = {};       // chunkKey -> { index: regrowAtElapsed }
    this.plantings = [];        // trees the player planted, with their planting time
    this.discovered = {};
    this.journal = [];
    this.events = [];
    this.quests = [];
    this.questCooldown = 20;

    this.player = {
      x: SETTLEMENTS[0].x + 40, y: 0, z: SETTLEMENTS[0].z + 46, yaw: 2.4,
      hp: 100, maxHp: 100, stamina: 100, warmth: 1,
      inv: { wood: 0, stone: 0, hide: 0, herb: 0, ore: 0, berry: 0, relic: 0 },
      rep: [10, 0, 0],
      stats: { hunted: 0, felled: 0, fires: 0, quests: 0, planted: 0, distance: 0, helped: 0, kills: 0 },
      firstRun: true,
    };
    this.initDerived();
  }

  initDerived() {
    const rnd = mulberry32(this.seed ^ 0x9e37);
    // Fuel map from base vegetation density
    for (let j = 0; j < FR; j++) {
      for (let i = 0; i < FR; i++) {
        const x = (i + 0.5) * WORLD.fireCell - WORLD.half;
        const z = (j + 0.5) * WORLD.fireCell - WORLD.half;
        this.fuel[j * FR + i] = Math.round(clamp(treeDensityAt(x, z) * 1.1 + moistureAt(x, z) * 0.25, 0, 1) * 255);
      }
    }
    // Regions: ecology + faction ownership
    for (let idx = 0; idx < RR * RR; idx++) {
      const [x, z] = regionCenter(idx);
      const dens = treeDensityAt(x, z);
      const h = heightAt(x, z);
      const capacity = 8 + dens * 26 + (h > 0 && h < 90 ? 8 : 0);
      // nearest settlement decides starting owner; wilds are contested
      let owner = -1, best = 1e9;
      for (let s = 0; s < SETTLEMENTS.length; s++) {
        const d = Math.hypot(SETTLEMENTS[s].x - x, SETTLEMENTS[s].z - z);
        if (d < best) { best = d; owner = SETTLEMENTS[s].faction; }
      }
      if (best > 420) owner = h > 100 ? 2 : (rnd() < 0.4 ? 1 : -1);
      this.regions.push({
        prey: capacity * (0.5 + rnd() * 0.4),
        pred: Math.max(0, capacity * 0.07 * (0.4 + rnd())),
        cap: capacity,
        trees: 1.0,           // multiplier on base tree density (harvest/fire reduce it)
        ore: h > 60 ? 60 + rnd() * 60 : 15 + rnd() * 30,
        owner,
        pressure: [0, 0, 0],
        heat: 0,              // recent violence
      });
      const r = this.regions[idx];
      if (owner >= 0) r.pressure[owner] = 40 + rnd() * 25;
    }
    // Settlements
    for (let i = 0; i < SETTLEMENTS.length; i++) {
      const s = SETTLEMENTS[i];
      this.settlements.push({
        id: s.id, name: s.name, x: s.x, z: s.z, faction: s.faction,
        prosperity: 0.42 + (i % 3) * 0.08,
        population: 6 + (i % 3) * 2,
        defense: 0.2,
        supplies: 0.5,
        rep: 0,
        status: 'steady',
        buildings: 4 + (i % 3),
        walls: 0,
        fields: 1,
        banner: s.faction,
        raidTimer: DAY_LENGTH * (1 + i * 0.4),
        land: 0.72 + treeDensityAt(s.x, s.z) * 0.55 + moistureAt(s.x, s.z) * 0.42,
        lastSeenDay: 0,
        abandoned: false,
        smoke: 0,
      });
    }
    for (const f of FACTIONS) this.factions.push({ id: f.id, power: 1, territory: 0, aggression: f.id === 1 ? 0.72 : f.id === 2 ? 0.62 : 0.55 });
    this.recountTerritory();
  }

  recountTerritory() {
    for (const f of this.factions) f.territory = 0;
    for (const r of this.regions) if (r.owner >= 0) this.factions[r.owner].territory++;
  }

  // ----------------------------------------------------------------- ground
  getGround(x, z, ch) { return this.ground[worldToState(x, z) * 4 + ch] / 255; }
  addGround(x, z, ch, amt) {
    const i = worldToState(x, z) * 4 + ch;
    const v = clamp(this.ground[i] / 255 + amt, 0, 1);
    this.ground[i] = Math.round(v * 255);
    this.groundDirty = true; this.groundStamp++;
  }
  paintGround(x, z, ch, amt, radius) {
    const cells = Math.max(0, Math.round(radius / WORLD.stateCell));
    const ci = clamp(Math.floor((x + WORLD.half) / WORLD.stateCell), 0, R - 1);
    const cj = clamp(Math.floor((z + WORLD.half) / WORLD.stateCell), 0, R - 1);
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        const ii = ci + i, jj = cj + j;
        if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue;
        const d = Math.hypot(i, j) / (cells + 0.0001);
        if (d > 1) continue;
        const k = (jj * R + ii) * 4 + ch;
        const falloff = 1 - d * d;
        const v = clamp(this.ground[k] / 255 + amt * falloff, 0, 1);
        this.ground[k] = Math.round(v * 255);
      }
    }
    this.groundDirty = true; this.groundStamp++;
  }

  // ------------------------------------------------------------- homecoming
  // A compact photograph of the frontier, written into every save. When the
  // player returns it is compared against the world that kept running without
  // them, so "come back and see what changed" can actually be shown.
  // A day's vital signs, quantised small enough to keep 90 of them in the save.
  // This is what lets the world draw its own biography on the world screen.
  recordHistory() {
    let prey = 0, pred = 0, trees = 0;
    for (const r of this.regions) { prey += r.prey; pred += r.pred; trees += r.trees; }
    const n = this.regions.length;
    let alive = 0, pros = 0;
    for (const s of this.settlements) { if (!s.abandoned) { alive++; pros += s.prosperity; } }
    this.history.push([
      this.day,
      Math.round(prey),
      Math.round(pred),
      Math.round((trees / n) * 100),
      this.scorchedCells(),
      this.factions[0].territory, this.factions[1].territory, this.factions[2].territory,
      Math.round((alive ? pros / alive : 0) * 100),
    ]);
    if (this.history.length > 90) this.history.splice(0, this.history.length - 90);
  }

  snapshot() {
    let prey = 0, pred = 0, trees = 0;
    for (const r of this.regions) { prey += r.prey; pred += r.pred; trees += r.trees; }
    return {
      day: this.day,
      set: this.settlements.map(s => ({
        n: s.name, p: +s.prosperity.toFixed(3), b: s.buildings, w: s.walls,
        ban: s.banner, ab: !!s.abandoned, st: s.status, pop: Math.round(s.population),
      })),
      ter: this.factions.map(f => f.territory),
      eco: { prey: Math.round(prey), pred: Math.round(pred), trees: +(trees / this.regions.length).toFixed(3) },
      burn: this.scorchedCells(),
    };
  }
  scorchedCells() {
    let n = 0;
    for (let i = 0; i < this.ground.length; i += 4) if (this.ground[i] > 60) n++;
    return n;
  }

  // Produces the plain-language account of what happened while away.
  static diffSnapshots(before, after, awaySeconds) {
    if (!before || !after) return [];
    const lines = [];
    const days = after.day - before.day;
    const byName = Object.fromEntries((before.set || []).map(s => [s.n, s]));
    for (const a of after.set || []) {
      const b = byName[a.n];
      if (!b) continue;
      if (a.ab && !b.ab) { lines.push({ kind: 'bad', text: `${a.n} was abandoned. Nothing is left but rubble.` }); continue; }
      if (!a.ab && b.ab) { lines.push({ kind: 'good', text: `${a.n} was resettled.` }); continue; }
      if (a.ban !== b.ban) lines.push({ kind: 'faction', text: `${a.n} now flies a different banner.`, banner: a.ban });
      if (a.b > b.b) lines.push({ kind: 'good', text: `${a.n} raised ${a.b - b.b} new building${a.b - b.b > 1 ? 's' : ''} (${a.pop} souls).` });
      else if (a.b < b.b) lines.push({ kind: 'bad', text: `${a.n} lost ${b.b - a.b} building${b.b - a.b > 1 ? 's' : ''} to neglect.` });
      else if (a.st !== b.st) lines.push({ kind: a.p > b.p ? 'good' : 'bad', text: `${a.n} is ${a.st} now, where it was ${b.st}.` });
      if (a.w > b.w) lines.push({ kind: 'world', text: `${a.n} put up new walls.` });
    }
    for (let i = 0; i < (after.ter || []).length; i++) {
      const d = after.ter[i] - (before.ter[i] || 0);
      if (Math.abs(d) >= 3) {
        lines.push({
          kind: 'faction', faction: i,
          text: d > 0 ? `${FACTIONS[i].name} pushed into ${d} more regions.` : `${FACTIONS[i].name} was driven out of ${-d} regions.`,
        });
      }
    }
    const e0 = before.eco || {}, e1 = after.eco || {};
    if (e0.prey && Math.abs(e1.prey - e0.prey) / Math.max(1, e0.prey) > 0.18) {
      lines.push({ kind: 'world', text: e1.prey > e0.prey ? 'The herds have grown fat in your absence.' : 'The herds have thinned.' });
    }
    if (e0.pred && Math.abs(e1.pred - e0.pred) / Math.max(1, e0.pred) > 0.22) {
      lines.push({ kind: e1.pred > e0.pred ? 'bad' : 'world', text: e1.pred > e0.pred ? 'Wolves are bolder and more numerous.' : 'The wolf packs have shrunk.' });
    }
    if (e0.trees !== undefined && Math.abs(e1.trees - e0.trees) > 0.045) {
      lines.push({ kind: e1.trees > e0.trees ? 'good' : 'bad', text: e1.trees > e0.trees ? 'The woods have crept back in.' : 'The woods are thinner than you left them.' });
    }
    const burnDelta = (after.burn || 0) - (before.burn || 0);
    if (burnDelta > 40) lines.push({ kind: 'bad', text: 'Fire took more ground while you were gone.' });
    else if (burnDelta < -40) lines.push({ kind: 'good', text: 'Old burn scars have greened over.' });
    if (!lines.length && days > 0) lines.push({ kind: 'world', text: 'The frontier turned quietly. Nothing of note changed.' });
    return lines.slice(0, 8);
  }

  // -------------------------------------------------------------- discovery
  // Reveals the map around a point. Sight reaches further from high ground, so
  // climbing a ridge genuinely rewards you with more of the world.
  markExplored(x, z, radius = 110) {
    const cell = WORLD.exploreCell;
    const cells = Math.max(1, Math.round(radius / cell));
    const ci = Math.floor((x + WORLD.half) / cell);
    const cj = Math.floor((z + WORLD.half) / cell);
    let changed = 0;
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        const ii = ci + i, jj = cj + j;
        if (ii < 0 || jj < 0 || ii >= XR || jj >= XR) continue;
        const d = Math.hypot(i, j) / cells;
        if (d > 1) continue;
        // hard core, soft rim: the edge of vision is remembered vaguely
        const v = d < 0.62 ? 255 : Math.round(255 * (1 - (d - 0.62) / 0.38) * 0.72 + 40);
        const k = jj * XR + ii;
        if (this.explored[k] < v) { this.explored[k] = v; changed++; }
      }
    }
    if (changed) this.exploredDirty = true;
    return changed;
  }
  exploredAt(x, z) {
    const cell = WORLD.exploreCell;
    const i = clamp(Math.floor((x + WORLD.half) / cell), 0, XR - 1);
    const j = clamp(Math.floor((z + WORLD.half) / cell), 0, XR - 1);
    return this.explored[j * XR + i] / 255;
  }
  exploredFraction() {
    let n = 0;
    for (let i = 0; i < this.explored.length; i++) if (this.explored[i] > 90) n++;
    return n / this.explored.length;
  }

  // ------------------------------------------------------------------- fire
  ignite(x, z, strength = 1) {
    const idx = worldToFire(x, z);
    if (this.fuel[idx] < 12) return false;
    this.burning[idx] = Math.max(this.burning[idx], strength);
    this.player.stats.fires++;
    this.fireActive = true;
    return true;
  }
  burningCount() { return this.burningList.length; }

  tickFire(dt) {
    const w = this.weather;
    const wetness = w.type === 'rain' || w.type === 'storm' ? 1 : w.type === 'snow' ? 0.8 : 0;
    const wx = Math.cos(w.windDir), wz = Math.sin(w.windDir);
    let any = false;
    const spread = [];
    const list = [];
    for (let j = 0; j < FR; j++) {
      for (let i = 0; i < FR; i++) {
        const idx = j * FR + i;
        let b = this.burning[idx];
        if (b <= 0.02) continue;
        any = true;
        const fuel = this.fuel[idx] / 255;
        // consume fuel, scar the ground
        const consume = dt * 0.055 * (0.4 + b);
        this.fuel[idx] = Math.max(0, this.fuel[idx] - consume * 255);
        const [wxp, wzp] = fireToWorld(idx);
        list.push({ x: wxp, z: wzp, v: b, idx });
        this.paintGround(wxp, wzp, CH.BURN, dt * 0.35, WORLD.fireCell * 0.7);
        this.paintGround(wxp, wzp, CH.LUSH, -dt * 0.5, WORLD.fireCell * 0.7);
        const reg = this.regions[regionIndex(wxp, wzp)];
        reg.trees = Math.max(0, reg.trees - dt * 0.004);
        reg.prey = Math.max(0, reg.prey - dt * 0.03);
        reg.pred = Math.max(0, reg.pred - dt * 0.006);
        // decay
        b -= dt * (0.030 + wetness * 0.40) + (fuel < 0.05 ? dt * 0.45 : 0);
        this.burning[idx] = Math.max(0, b);
        if (b > 0.25 && wetness < 0.5) {
          for (let d = 0; d < 4; d++) {
            const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
            const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
            const ni = i + dx, nj = j + dz;
            if (ni < 0 || nj < 0 || ni >= FR || nj >= FR) continue;
            const nidx = nj * FR + ni;
            if (this.burning[nidx] > 0.1 || this.fuel[nidx] < 40) continue;
            const along = clamp(dx * wx + dz * wz, -1, 1);
            const chance = dt * (0.008 + 0.055 * (this.fuel[nidx] / 255)) * (0.45 + 1.0 * (along * 0.5 + 0.5)) * (1 - wetness);
            if (Math.random() < chance) spread.push(nidx);
          }
        }
      }
    }
    for (const idx of spread) {
      this.burning[idx] = 0.55;
      const [sx, sz] = fireToWorld(idx);
      list.push({ x: sx, z: sz, v: 0.55, idx });
    }
    this.burningList = list;
    this.fireActive = any || spread.length > 0;
  }

  // -------------------------------------------------------------- ecosystem
  tickEcology(dt) {
    const daily = dt / DAY_LENGTH;      // everything below is expressed per in-world day
    for (let idx = 0; idx < this.regions.length; idx++) {
      const r = this.regions[idx];
      const food = 0.35 + r.trees * 0.65;
      const cap = Math.max(2, r.cap * food);
      // logistic prey growth
      r.prey += daily * r.prey * 0.22 * (1 - r.prey / cap);
      // predation
      const eaten = daily * r.pred * 0.9 * clamp(r.prey / (cap * 0.4 + 1), 0, 1.5);
      r.prey = Math.max(0, r.prey - eaten);
      r.pred += eaten * 0.05 - daily * r.pred * 0.05;
      if (r.prey < 1.2) r.pred = Math.max(0, r.pred - daily * r.pred * 0.35);
      // a handful of predators always drift in from the deep wilds
      if (r.pred < 0.25 && r.prey > cap * 0.5) r.pred += daily * 0.05;
      r.pred = clamp(r.pred, 0, cap * 0.28);
      r.prey = clamp(r.prey, 0, cap * 1.3);
      // Overgrazing thins vegetation, absence of grazers lets it flourish
      const graze = clamp(r.prey / (cap + 1), 0, 1.4);
      r.trees = clamp(r.trees + daily * (0.022 * (1 - r.trees) - 0.10 * Math.max(0, graze - 0.85)), 0, 1.15);
      r.heat = Math.max(0, r.heat - daily * 0.8);
      r.ore = Math.min(r.ore + daily * 1.5, 140);
    }
  }

  // ---------------------------------------------------------------- factions
  pickCampaign(fi) {
    // choose a contested border region to push into
    const RRn = RR;
    const cands = [];
    for (let idx = 0; idx < this.regions.length; idx++) {
      const r = this.regions[idx];
      if (r.owner === fi) continue;
      const i0 = idx % RRn, j0 = (idx / RRn) | 0;
      let adj = 0;
      for (let d = 0; d < 4; d++) {
        const ii = i0 + (d === 0 ? 1 : d === 1 ? -1 : 0), jj = j0 + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (ii < 0 || jj < 0 || ii >= RRn || jj >= RRn) continue;
        if (this.regions[jj * RRn + ii].owner === fi) adj++;
      }
      if (adj > 0) cands.push({ idx, w: adj + (r.owner < 0 ? 1.2 : 0.3) + Math.random() });
    }
    if (!cands.length) return -1;
    cands.sort((a, b) => b.w - a.w);
    return cands[Math.min(cands.length - 1, Math.floor(Math.random() * 3))].idx;
  }

  tickFactions(dt) {
    const f = this.factions;
    // Each faction runs a campaign against one border region at a time.
    for (let k = 0; k < 3; k++) {
      const fa = f[k];
      fa.campaignTimer = (fa.campaignTimer || 0) - dt;
      if (fa.campaignTimer <= 0 || fa.campaign === undefined || fa.campaign < 0 ||
        (fa.campaign >= 0 && this.regions[fa.campaign].owner === k)) {
        fa.campaignTimer = DAY_LENGTH * (1.5 + Math.random() * 2.5);
        fa.campaign = this.pickCampaign(k);
        if (fa.campaign >= 0 && Math.random() < 0.5) {
          this.regions[fa.campaign].heat = Math.min(1, this.regions[fa.campaign].heat + 0.4);
        }
      }
    }
    for (let idx = 0; idx < this.regions.length; idx++) {
      const r = this.regions[idx];
      const [x, z] = regionCenter(idx);
      // each faction projects power from nearby owned regions & settlements
      const proj = [0, 0, 0];
      const i0 = idx % RR, j0 = (idx / RR) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i0 + di, jj = j0 + dj;
        if (ii < 0 || jj < 0 || ii >= RR || jj >= RR) continue;
        const nb = this.regions[jj * RR + ii];
        if (nb.owner >= 0) proj[nb.owner] += (di === 0 && dj === 0) ? 1.6 : 0.6;
      }
      for (const s of this.settlements) {
        if (s.abandoned) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < WORLD.regionCell * 2.2) proj[s.banner] += (1 - d / (WORLD.regionCell * 2.2)) * (1.4 + s.defense * 2 + s.prosperity);
      }
      for (const h of STRONGHOLDS) {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < WORLD.regionCell * 3.0) proj[h.faction] += (1 - d / (WORLD.regionCell * 3.0)) * 4.2;
      }
      for (let k = 0; k < 3; k++) {
        if (f[k].campaign === idx) proj[k] += 2.2 * f[k].aggression;
        const overextended = 1 - clamp(f[k].territory / this.regions.length, 0, 1) * 0.75;
        const aggro = f[k].aggression * (0.7 + f[k].power * 0.3) * overextended;
        const target = proj[k] * 16 * aggro;
        r.pressure[k] = lerp(r.pressure[k], target, clamp(dt * 0.006, 0, 1));
        // player reputation slightly aids the faction they favour
        r.pressure[k] += dt * 0.006 * clamp(this.player.rep[k] / 100, -1, 1) * (proj[k] > 0 ? 1 : 0);
        r.pressure[k] += dt * (Math.random() - 0.46) * 0.5;      // skirmish noise
        r.pressure[k] = clamp(r.pressure[k], 0, 120);
      }
      let bi = -1, bv = 12;
      for (let k = 0; k < 3; k++) if (r.pressure[k] > bv) { bv = r.pressure[k]; bi = k; }
      if (bi !== r.owner) {
        const prevOwner = r.owner;
        const second = Math.max(...r.pressure.filter((_, k) => k !== bi), 0);
        if (bv > second * 1.25) {
          r.owner = bi;
          r.heat = Math.min(1, r.heat + 0.5);
          this.recountTerritory();
          if (bi >= 0 && this.distToPlayerRegion(idx) < 1400) {
            this.note(`${FACTIONS[bi].name} seized territory ${prevOwner >= 0 ? `from ${FACTIONS[prevOwner].name}` : 'in the wilds'}.`, 'faction');
          }
        }
      }
    }
    for (const fa of f) fa.power = lerp(fa.power, 0.5 + fa.territory / (RR * RR) * 3, dt * 0.05);

    // Settlements can flip banner if surrounded
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      const r = this.regions[regionIndex(s.x, s.z)];
      const homeOf = STRONGHOLDS.find(h => h.name === s.name);
      if (r.owner >= 0 && r.owner !== s.banner && s.defense < 0.5 && !homeOf) {
        s.occupied = (s.occupied || 0) + dt;
        if (s.occupied > DAY_LENGTH * 2.5) {
          s.occupied = 0;
          s.banner = r.owner;
          s.rep = Math.max(-40, s.rep - 5);
          s.defense = clamp(s.defense + 0.2, 0, 1);
          this.note(`${s.name} now flies the colours of ${FACTIONS[r.owner].name}.`, 'faction');
        }
      } else s.occupied = Math.max(0, (s.occupied || 0) - dt);
    }
  }

  distToPlayerRegion(idx) {
    const [x, z] = regionCenter(idx);
    return Math.hypot(x - this.player.x, z - this.player.z);
  }

  // ------------------------------------------------------------ settlements
  tickSettlements(dt) {
    for (const s of this.settlements) {
      const r = this.regions[regionIndex(s.x, s.z)];
      if (s.abandoned) {
        // A ruined village can be reclaimed if the player invests in it
        if (s.supplies > 0.8 || s.rep > 45) {
          s.abandoned = false; s.prosperity = 0.25; s.population = 3; s.buildings = 3;
          this.note(`${s.name} is being resettled.`, 'settlement');
        }
        continue;
      }
      const land = s.land || 1;
      const food = clamp(r.prey / (r.cap + 1), 0, 1.2) * land;
      const wood = clamp(r.trees, 0, 1.15) * land;
      const help = clamp(s.rep / 100, -0.6, 1);
      const danger = clamp(r.heat + (r.owner !== s.banner ? 0.35 : 0), 0, 1.2);
      // Bigger villages eat more than they make: prosperity finds a level set
      // by the health of the land around it (and by what the player does to it).
      const daily = dt / DAY_LENGTH;
      // How much village this land can carry right now. Everything the player
      // does to the surroundings (hunting, logging, burning, aiding) feeds in.
      const capacity = clamp(
        food * 0.62 + wood * 0.35 + help * 0.60 + (s.supplies - 0.5) * 0.35
        - danger * 0.70 - 0.22, 0, 1);
      s.capacity = capacity;
      // stores build up from any surplus above what the village already uses
      const wantSupplies = clamp(capacity - s.prosperity + 0.5, 0, 1.4);
      s.supplies = clamp(s.supplies + daily * (wantSupplies - s.supplies) * 0.5, 0, 1.4);
      // prosperity chases capacity (first-order, so it settles instead of oscillating)
      const drift = capacity - s.prosperity;
      s.prosperity = clamp(s.prosperity + daily * drift * (drift < 0 ? 0.42 : 0.26), 0, 1);
      s.defense = clamp(s.defense + daily * ((s.prosperity - 0.42) * 0.22 + (danger > 0.4 ? 0.22 : -0.03)), 0, 1);
      s.population = clamp(3 + s.prosperity * 16, 0, 24);

      const wantBuildings = Math.round(3 + s.prosperity * 8);
      if (wantBuildings > s.buildings) {
        s.buildings++; s.constructing = 8;
        this.note(`${s.name} raises a new building.`, 'settlement');
      } else if (wantBuildings < s.buildings - 1) {
        s.buildings--;
        this.note(`A building in ${s.name} falls to ruin.`, 'settlement');
      }
      s.walls = clamp(Math.round(s.defense * 3), 0, 3);
      s.fields = clamp(Math.round(1 + s.prosperity * 4), 0, 5);
      if (s.constructing > 0) s.constructing -= dt;

      s.status = s.prosperity > 0.80 ? 'thriving' : s.prosperity > 0.58 ? 'growing' :
        s.prosperity > 0.34 ? 'steady' : s.prosperity > 0.14 ? 'struggling' : 'dying';

      if (s.prosperity <= 0.035 && s.supplies < 0.2) {
        s.abandoned = true; s.buildings = Math.max(2, (s.buildings / 2) | 0);
        this.note(`${s.name} has been abandoned.`, 'settlement');
      }

      // Raids from the strongest hostile faction
      s.raidTimer -= dt;
      if (s.raidTimer <= 0) {
        s.raidTimer = DAY_LENGTH * (1.2 + Math.random() * 2.8);
        const hostile = r.owner >= 0 && r.owner !== s.banner ? r.owner : -1;
        if (hostile >= 0 && Math.random() < 0.55 + this.factions[hostile].aggression * 0.3) {
          const win = s.defense * 1.4 + s.prosperity * 0.6 > Math.random() * (1.2 + this.factions[hostile].power);
          if (win) {
            s.defense = clamp(s.defense - 0.05, 0, 1);
            this.note(`${s.name} repelled a raid by ${FACTIONS[hostile].name}.`, 'combat');
          } else {
            s.prosperity = clamp(s.prosperity - 0.16, 0, 1.2);
            s.supplies = clamp(s.supplies - 0.3, 0, 1.4);
            s.defense = clamp(s.defense - 0.1, 0, 1);
            r.heat = Math.min(1, r.heat + 0.5);
            this.note(`${s.name} was raided by ${FACTIONS[hostile].name}.`, 'combat');
          }
        }
      }
      // Prospering settlements wear the ground around them
      this.paintGround(s.x, s.z, CH.DEV, daily * 0.5 * (s.prosperity - 0.2), 70);
    }
  }

  // ---------------------------------------------------------------- weather
  tickWeather(dt) {
    const w = this.weather;
    w.next -= dt;
    if (w.next <= 0) {
      w.next = 80 + Math.random() * 190;
      const roll = Math.random();
      const wet = this.timeOfYearWet();
      if (roll < 0.40 - wet * 0.15) w.type = 'clear';
      else if (roll < 0.66) w.type = 'cloudy';
      else if (roll < 0.85) w.type = 'rain';
      else if (roll < 0.94) w.type = 'storm';
      else w.type = 'fogbank';
      w.target = w.type === 'clear' ? 0 : w.type === 'cloudy' ? 0.42 : w.type === 'rain' ? 0.75 : w.type === 'storm' ? 1 : 0.6;
      w.windDir += (Math.random() - 0.5) * 1.6;
    }
    w.intensity = lerp(w.intensity, w.target, clamp(dt * 0.12, 0, 1));
    w.windSpeed = lerp(w.windSpeed, 0.25 + (w.type === 'storm' ? 0.9 : w.type === 'rain' ? 0.5 : 0.2) * w.intensity + 0.15, clamp(dt * 0.2, 0, 1));
    // Rain regrows the land a little and douses scars slowly
    if (w.type === 'rain' || w.type === 'storm') this.rainAccum = (this.rainAccum || 0) + dt * w.intensity;
  }
  timeOfYearWet() { return 0.5 + 0.5 * Math.sin(this.day * 0.12); }

  // ------------------------------------------------------------- recovery
  tickRecovery(dt) {
    // Slowly heal burn scars, fade trails that aren't used, regrow lushness, regrow fuel.
    this.recoverAccum = (this.recoverAccum || 0) + dt;
    if (this.recoverAccum < 4) return;
    const step = this.recoverAccum; this.recoverAccum = 0;
    const rain = clamp((this.rainAccum || 0) * 0.02, 0, 1); this.rainAccum = 0;
    // Scars are slow to heal: a burn takes many in-world days to green over,
    // and unused trails fade slower still.
    this._healFrac = (this._healFrac || 0) + step * (0.006 + rain * 0.06);
    const burnHeal = Math.floor(this._healFrac); this._healFrac -= burnHeal;
    this._trailFrac = (this._trailFrac || 0) + step * 0.004;
    const trailFade = Math.floor(this._trailFrac); this._trailFrac -= trailFade;
    this._lushFrac = (this._lushFrac || 0) + step * (0.03 + rain * 0.25);
    const lushGain = Math.floor(this._lushFrac); this._lushFrac -= lushGain;
    const g = this.ground;
    for (let i = 0; i < g.length; i += 4) {
      if (burnHeal && g[i]) g[i] = Math.max(0, g[i] - burnHeal);
      if (trailFade && g[i + 1]) g[i + 1] = Math.max(0, g[i + 1] - trailFade);
      if (lushGain && g[i + 2] < 255 && g[i] < 40) g[i + 2] = Math.min(255, g[i + 2] + lushGain);
    }
    this.groundDirty = true; this.groundStamp++;
    // fuel regrowth follows region tree health
    for (let j = 0; j < FR; j++) for (let i = 0; i < FR; i++) {
      const idx = j * FR + i;
      const x = (i + 0.5) * WORLD.fireCell - WORLD.half;
      const z = (j + 0.5) * WORLD.fireCell - WORLD.half;
      const target = clamp(treeDensityAt(x, z) * this.regions[regionIndex(x, z)].trees * 1.1, 0, 1) * 255;
      if (this.fuel[idx] < target) this.fuel[idx] = Math.min(target, this.fuel[idx] + step * (0.06 + rain * 0.5));
    }
    // vegetation regrowth
    for (const key in this.vegRemoved) {
      const m = this.vegRemoved[key];
      let empty = true;
      for (const i in m) {
        if (m[i] <= this.elapsed) { delete m[i]; this.vegDirty = true; this.vegDirtyKeys = this.vegDirtyKeys || new Set(); this.vegDirtyKeys.add(key); }
        else empty = false;
      }
      if (empty) delete this.vegRemoved[key];
    }
  }

  // ------------------------------------------------------------------ quests
  tickQuests(dt) {
    this.questCooldown -= dt;
    this.quests = this.quests.filter(q => q.done || q.expires > this.elapsed);
    const active = this.quests.filter(q => !q.done);
    if (this.questCooldown > 0 || active.length >= 3) return;
    this.questCooldown = 60 + Math.random() * 60;
    const q = this.generateQuest();
    if (q) { this.quests.push(q); this.note(`New task: ${q.title}`, 'quest'); }
  }

  generateQuest() {
    const cands = [];
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      const r = this.regions[regionIndex(s.x, s.z)];
      if (s.supplies < 0.55) cands.push({ w: 3, make: () => ({ kind: 'deliver', item: 'wood', need: 6, title: `Timber for ${s.name}`, desc: `${s.name} is short of building material. Bring 6 wood.`, target: s.id, x: s.x, z: s.z }) });
      if (r.prey < r.cap * 0.25) cands.push({ w: 2, make: () => ({ kind: 'restock', title: `Let the herds recover near ${s.name}`, desc: `Game is scarce. Plant 4 saplings nearby to restore cover.`, target: s.id, x: s.x, z: s.z, need: 4, item: 'sapling' }) });
      if (r.pred > r.cap * 0.14) cands.push({ w: 3, make: () => ({ kind: 'cull', title: `Wolves near ${s.name}`, desc: `Predators are thick around ${s.name}. Thin them (3).`, target: s.id, x: s.x, z: s.z, need: 3 }) });
      if (s.prosperity < 0.3) cands.push({ w: 3, make: () => ({ kind: 'deliver', item: 'berry', need: 8, title: `Food for ${s.name}`, desc: `${s.name} is starving. Bring 8 berries.`, target: s.id, x: s.x, z: s.z }) });
      if (s.defense < 0.35 && this.regions[regionIndex(s.x, s.z)].heat > 0.2) cands.push({ w: 2, make: () => ({ kind: 'deliver', item: 'stone', need: 8, title: `Fortify ${s.name}`, desc: `Raiders are near. Bring 8 stone for the walls.`, target: s.id, x: s.x, z: s.z }) });
    }
    for (const L of LANDMARKS) if (!this.discovered[L.id]) cands.push({ w: 1.2, make: () => ({ kind: 'explore', title: `Rumours of ${L.name}`, desc: `Travellers speak of ${L.name}. Find it.`, target: L.id, x: L.x, z: L.z }) });
    if (!cands.length) return null;
    const total = cands.reduce((a, c) => a + c.w, 0);
    let pick = Math.random() * total;
    for (const c of cands) { pick -= c.w; if (pick <= 0) { const q = c.make(); q.id = 'q' + Math.floor(Math.random() * 1e9); q.progress = 0; q.expires = this.elapsed + 1200; q.done = false; return q; } }
    return null;
  }

  // ------------------------------------------------------------------ misc
  note(text, kind = 'world') {
    const entry = { t: this.elapsed, day: this.day, text, kind };
    this.events.unshift(entry);
    if (this.events.length > 60) this.events.pop();
    this.journal.unshift(entry);
    if (this.journal.length > 120) this.journal.pop();
    this.onNote && this.onNote(entry);
  }

  addRep(faction, amount) {
    this.player.rep[faction] = clamp(this.player.rep[faction] + amount, -100, 100);
    // Helping one faction irritates its rivals a little
    for (let i = 0; i < 3; i++) if (i !== faction) this.player.rep[i] = clamp(this.player.rep[i] - amount * 0.25, -100, 100);
  }

  vegIsRemoved(key, i) { const m = this.vegRemoved[key]; return !!(m && m[i] !== undefined); }
  removeVeg(key, i, regrowSeconds) {
    if (!this.vegRemoved[key]) this.vegRemoved[key] = {};
    this.vegRemoved[key][i] = this.elapsed + regrowSeconds;
  }

  // ------------------------------------------------------------------ update
  update(dt, fast = false) {
    this.elapsed += dt;
    this.time += dt / DAY_LENGTH;
    while (this.time >= 1) {
      this.time -= 1; this.day++;
      this.recordHistory();
      this.onNewDay && this.onNewDay(this.day);
    }
    this.tickWeather(dt);
    this._fireAcc = (this._fireAcc || 0) + dt;
    if (this._fireAcc > 0.25) { this.tickFire(this._fireAcc); this._fireAcc = 0; }
    this._ecoAcc = (this._ecoAcc || 0) + dt;
    if (this._ecoAcc > 1.5) { this.tickEcology(this._ecoAcc); this._ecoAcc = 0; }
    this._facAcc = (this._facAcc || 0) + dt;
    if (this._facAcc > 3) { this.tickFactions(this._facAcc); this.tickSettlements(this._facAcc); this._facAcc = 0; }
    this.tickRecovery(dt);
    if (!fast) this.tickQuests(dt);
  }

  fastForward(seconds) {
    const step = 12;
    let left = Math.min(seconds, 60 * 60 * 8);
    let guard = 0;
    while (left > 0 && guard++ < 2600) { this.update(Math.min(step, left), true); left -= step; }
  }

  // ------------------------------------------------------------------- save
  serialize() {
    return {
      v: this.version, seed: this.seed, time: this.time, day: this.day, elapsed: this.elapsed,
      savedAt: Date.now(),
      ground: [0, 1, 2, 3].map(ch => rleEncode(deinterleave(this.ground, ch))),
      fuel: rleEncode(quantize(this.fuel, 16)),
      weather: this.weather,
      regions: this.regions.map(r => [+r.prey.toFixed(2), +r.pred.toFixed(2), r.cap, +r.trees.toFixed(3), Math.round(r.ore), r.owner, r.pressure.map(p => Math.round(p)), +r.heat.toFixed(2)]),
      settlements: this.settlements,
      factions: this.factions,
      explored: rleEncode(this.explored),
      vegRemoved: this.vegRemoved,
      plantings: this.plantings || [],
      discovered: this.discovered,
      journal: this.journal.slice(0, 60),
      quests: this.quests,
      player: this.player,
      snap: this.snapshot(),
      history: this.history.slice(-90),
    };
  }

  static deserialize(obj) {
    const s = new WorldState(obj.seed ?? WORLD.seed);
    s.burningList = [];
    s.time = obj.time; s.day = obj.day; s.elapsed = obj.elapsed || 0;
    if (Array.isArray(obj.ground)) {
      for (let ch = 0; ch < 4; ch++) interleaveInto(s.ground, rleDecode(obj.ground[ch], R * R), ch);
    } else if (obj.ground) s.ground = rleDecode(obj.ground, R * R * 4);
    if (obj.fuel) s.fuel = rleDecode(obj.fuel, FR * FR);
    Object.assign(s.weather, obj.weather || {});
    if (obj.regions) obj.regions.forEach((a, i) => {
      const r = s.regions[i]; if (!r) return;
      r.prey = a[0]; r.pred = a[1]; r.cap = a[2]; r.trees = a[3]; r.ore = a[4]; r.owner = a[5]; r.pressure = a[6]; r.heat = a[7];
    });
    if (obj.settlements) obj.settlements.forEach((o, i) => { if (s.settlements[i]) Object.assign(s.settlements[i], o); });
    if (obj.factions) obj.factions.forEach((o, i) => { if (s.factions[i]) Object.assign(s.factions[i], o); });
    if (Array.isArray(obj.history)) {
      s.history = obj.history.filter(h => Array.isArray(h) && h.length >= 9 && Number.isFinite(h[0])).slice(-90);
    }
    if (obj.explored) {
      s.explored = rleDecode(obj.explored, XR * XR);
    } else {
      // Saves from before the map existed: reconstruct the remembered map from
      // the trails the player actually wore into the ground.
      for (let j = 0; j < XR; j++) for (let i = 0; i < XR; i++) {
        const x = (i + 0.5) * WORLD.exploreCell - WORLD.half;
        const z = (j + 0.5) * WORLD.exploreCell - WORLD.half;
        if (s.getGround.call(s, x, z, 1) > 0.12) s.markExplored(x, z, 130);
      }
    }
    s.vegRemoved = obj.vegRemoved || {};
    s.plantings = obj.plantings || [];
    s.discovered = obj.discovered || {};
    s.journal = obj.journal || [];
    s.events = (obj.journal || []).slice(0, 20);
    s.quests = obj.quests || [];
    Object.assign(s.player, obj.player || {});
    s.player.firstRun = false;
    s.recountTerritory();
    s.groundDirty = true;
    return s;
  }

  save() {
    let payload;
    try {
      payload = JSON.stringify(this.serialize());
    } catch (e) {
      console.warn('could not serialise world', e);
      this.saveError = 'serialise';
      return false;
    }
    try {
      localStorage.setItem(SAVE_KEY, payload);
      this.lastSave = Date.now();
      this.saveBytes = payload.length;
      this.saveError = null;
      return true;
    } catch (e) {
      // Quota or a blocked storage partition. Try once more without the
      // chronicle, which is the largest expendable part of the save.
      this.saveError = (e && e.name) || 'blocked';
      try {
        const slim = this.serialize();
        slim.journal = slim.journal.slice(0, 10);
        localStorage.setItem(SAVE_KEY, JSON.stringify(slim));
        this.lastSave = Date.now();
        this.saveError = null;
        return true;
      } catch (e2) {
        console.warn('save failed', e2);
        return false;
      }
    }
  }

  // Returns { state, status } so the caller can tell the player the truth:
  //   'new'      no save present
  //   'ok'       loaded
  //   'damaged'  a save existed but could not be read — a fresh world is given
  static loadResult() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); }
    catch (e) { return { state: null, status: 'new', reason: 'storage-blocked' }; }
    if (!raw) return { state: null, status: 'new' };
    try {
      const obj = JSON.parse(raw);
      const s = WorldState.deserialize(obj);
      const away = Math.max(0, (Date.now() - (obj.savedAt || Date.now())) / 1000);
      s.awaySeconds = away;
      if (away > 30) s.fastForward(Math.min(away * 6, 60 * 60 * 6));
      s.homecoming = away > 120 ? WorldState.diffSnapshots(obj.snap, s.snapshot(), away) : [];
      s.homecomingDays = obj.snap ? s.day - obj.snap.day : 0;
      return { state: s, status: 'ok' };
    } catch (e) {
      console.warn('load failed', e);
      // keep the unreadable save aside rather than overwriting it immediately
      try { localStorage.setItem(SAVE_KEY + '_damaged', raw.slice(0, 200000)); } catch (e2) { }
      return { state: null, status: 'damaged', reason: (e && e.message) || 'unreadable' };
    }
  }
  static load() { return WorldState.loadResult().state; }
}
