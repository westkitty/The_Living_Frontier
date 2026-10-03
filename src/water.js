// WaterQuery — the one authoritative answer to "what is the water doing here?"
//
// Gameplay asks this. The renderer never does. Water in the frontier is not
// simulated: it is *derived*. heightAt() is already a pure function of (x, z),
// rivers are a procedural valley field, and the surface is a single level, so
// depth, shoreline, flow and wade/swim state all fall out of terrain the
// project already trusts. That keeps water deterministic, headless (it runs in
// Node with no DOM), and free of GPU readback.
//
// This module owns truth only. Splashes, foam, caustics, fog and buoyancy are
// later layers that subscribe to these answers; none of them may re-derive
// depth from terrain on their own.
import { WORLD, heightAt, riverField, moistureFrom } from './worldgen.js';
import { clamp, smoothstep } from './rng.js';

// Depth measured down from the surface, so depth > 0 means the surface is
// above the ground and the point is covered.
export const WATER_BAND = { DRY: 0, SPLASH: 1, WADE: 2, SWIM: 3 };

// -0.3 is the historical player test (`gh < WORLD.water + 0.3`). It is kept
// bit-for-bit so routing movement through WaterQuery changes no behaviour.
export const SPLASH_DEPTH = -0.3;
export const WADE_DEPTH = 0.6;      // knees-to-waist: wading, still footed
export const SWIM_DEPTH = 1.4;      // past the chest: swimming
export const SHORE_DEPTH = 2.5;     // deeper than this reads as open water

const CURRENT_MAX = 1.6;            // m/s mid-channel. Deliberately well under
                                    // the 2.53 m/s wading speed so a river
                                    // nudges the player instead of owning them.
const FLOW_EPS = 2.0;               // terrain gradient step, in metres
const RIVER_FIELD = 0.10;           // riverField() at or below this is a river

export const WaterQuery = {
  // Surface height. Read live from WORLD so a future flood level changes here
  // alone instead of leaving a second copy of the truth to drift.
  get surfaceY() { return WORLD.water; },

  // Cheapest possible question, and the hot one: how deep is it here? One
  // heightAt() call, no allocation. Pass a groundY you already sampled to make
  // it free.
  depthAt(x, z, groundY = heightAt(x, z)) {
    return WORLD.water - groundY;
  },

  // Is this point covered at all (the legacy inWater predicate)?
  coveredAt(x, z, groundY = heightAt(x, z)) {
    return WORLD.water - groundY > SPLASH_DEPTH;
  },

  // Which side of the waterline a point sits on, 1 = dry land, 0 = open water.
  shoreFactorAt(x, z, groundY = heightAt(x, z)) {
    return smoothstep(SHORE_DEPTH, SPLASH_DEPTH, WORLD.water - groundY);
  },

  bandFor(depth) {
    if (depth <= SPLASH_DEPTH) return WATER_BAND.DRY;
    if (depth <= WADE_DEPTH) return WATER_BAND.SPLASH;
    if (depth <= SWIM_DEPTH) return WATER_BAND.WADE;
    return WATER_BAND.SWIM;
  },

  // Downhill flow of the terrain, scaled by how much water sits on it and by
  // how strongly this point belongs to a river valley. Rivers already carve
  // toward the water level, so their tangent *is* the current — no authored
  // vectors and no simulation required. Writes into out to stay allocation
  // free; magnitude is metres per second.
  flowAt(x, z, depth, out = { flowX: 0, flowZ: 0 }) {
    const hx = heightAt(x + FLOW_EPS, z) - heightAt(x - FLOW_EPS, z);
    const hz = heightAt(x, z + FLOW_EPS) - heightAt(x, z - FLOW_EPS);
    const len = Math.hypot(hx, hz);
    const river = smoothstep(RIVER_FIELD, 0.02, riverField(x, z));
    const speed = clamp(Math.min(depth, 2) / 2, 0, 1) * (0.35 + 0.65 * river) * CURRENT_MAX;
    out.flowX = len > 1e-5 ? (-hx / len) * speed : 0;
    out.flowZ = len > 1e-5 ? (-hz / len) * speed : 0;
    return out;
  },

  // What kind of water is here: 'river', 'marsh' (shallow standing water on
  // low wet ground) or 'sea' (deep standing water — lakes, flooded ruins, the
  // coast). Only worth paying for once something is wet, which is why it lives
  // behind the depth test in sampleInto.
  typeAt(x, z, groundY) {
    if (smoothstep(RIVER_FIELD, 0.02, riverField(x, z)) > 0.5) return 'river';
    if (groundY > -1.2 && groundY < 1.6 && moistureFrom(groundY, x, z) > 0.62) return 'marsh';
    return 'sea';
  },

  // The full answer. `groundY` is optional: pass it when the caller has
  // already sampled terrain this frame (the player does) and the query costs
  // nothing extra. Dry points return before touching the noise fields at all,
  // which is what keeps a frame with no water nearby nearly dormant.
  sampleInto(out, x, z, groundY = heightAt(x, z), weather = null) {
    const surfaceY = WORLD.water;
    const depth = surfaceY - groundY;
    out.surfaceY = surfaceY;
    out.groundY = groundY;
    out.depth = depth;
    out.shoreFactor = smoothstep(SHORE_DEPTH, SPLASH_DEPTH, depth);
    out.band = this.bandFor(depth);
    out.inWater = depth > SPLASH_DEPTH;          // the historical predicate
    out.submerged = depth > 0;                   // surface actually above ground
    out.wadeable = depth > WADE_DEPTH;
    out.swimmable = depth > SWIM_DEPTH;

    if (!out.inWater) {
      // Dry: no water type, no current. This is the common case.
      out.waterType = 'none';
      out.flowX = 0; out.flowZ = 0;
    } else {
      out.waterType = this.typeAt(x, z, groundY);
      this.flowAt(x, z, depth, out);
    }
    out.wetness = weather ? weatherWetness(weather) : 0;
    return out;
  },

  // Allocating form for occasional callers (tests, saves, UI, one-off probes).
  sample(x, z, groundY, weather = null) {
    return this.sampleInto({}, x, z, groundY, weather);
  },
};

// Matches WorldState.fireConditions(): rain soaks, snow half soaks, and a
// lingering groundWetness keeps things damp after the sky clears.
function weatherWetness(w) {
  const rain = w.type === 'rain' || w.type === 'storm' ? 1 : w.type === 'snow' ? 0.8 : 0;
  return Math.max(rain, clamp(w.groundWetness || 0, 0, 1));
}
