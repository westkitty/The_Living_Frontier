// The fire model: ignition, fuel consumption, downwind spread, rain
// extinction and the scars it burns into ground memory.
//
// This is the system the frontier is named for - set a fire and it spreads with
// the wind, eats fuel, kills wildlife, strips forest health and leaves black
// ground that takes many in-world days to green over - so it is also the one
// whose per-tick cost is most visible. A burning frontier ticks four times a
// second, and every burning cell stains the ground twice, feeds a region and
// invalidates vegetation, which is why the hot path here is written to allocate
// nothing and to walk only the cells that are actually alight.
//
// It takes the world state as a parameter rather than living inside it, exactly
// as world-recovery.js does: the model needs the state's grids and its ground
// painter, but the simulation core does not need to carry 100 lines of fire
// arithmetic, and this way the model can be driven directly by the fire probes.
import { WORLD } from './worldgen.js';
import { clamp } from './rng.js';
import { CH, regionIndex, worldToFire } from './grid.js';

const FR = WORLD.fireRes;

export function igniteFire(st, x, z, strength = 1) {
  const idx = worldToFire(x, z);
  if (st.fuel[idx] < 12) return false;
  const was = st.burning[idx];
  st.burning[idx] = Math.max(was, strength);
  if (was <= 0.02 && st.burning[idx] > 0.02) st._burnCount++;
  st.player.stats.fires++;
  st.fireActive = true;
  return true;
}

// The HUD reads this every frame and the fire tick reads it every tick, so it
// refills one reusable result object instead of allocating an object and a
// closure per call. `multiplier` is a stable function reading the values
// just written; nothing holds the result across a later call.
export function fireConditionsAt(st) {
  const w = st.weather;
  const rain = w.type === 'rain' || w.type === 'storm' ? 1 : w.type === 'snow' ? 0.8 : 0;
  const c = st._fireCond || (st._fireCond = { wetness: 0, wind: 0, multiplier: null, risk: 'dry' });
  c.wetness = Math.max(rain, clamp(w.groundWetness || 0, 0, 1));
  c.wind = Math.max(0, w.windSpeed) / 0.45;
  if (!c.multiplier) c.multiplier = (along) => (0.45 + c.wind * (along * 0.5 + 0.5)) * (1 - c.wetness);
  // The displayed risk is the maximum directional spread multiplier, not a second model.
  c.risk = c.wetness >= 0.5 ? 'damp' : c.multiplier(1) >= 1.15 ? 'tinder' : 'dry';
  return c;
}

export function runFireTick(st, dt) {
  // Nothing alight: the scan below would walk all 9,216 cells to discover
  // that, four times a second, for the whole time no fire exists.
  if (st._burnCount === 0) {
    if (st.burningList.length) st.burningList.length = 0;
    st.fireActive = false;
    return;
  }
  const w = st.weather;
  const { wetness, multiplier } = fireConditionsAt(st);
  const wx = Math.cos(w.windDir), wz = Math.sin(w.windDir);
  const cell = WORLD.fireCell, half = WORLD.half;
  const spread = st._spread;
  spread.length = 0;
  // burningList entries are reused in place: the list is rebuilt four times a
  // second and every consumer (flames, map markers, the audio bed) only reads
  // x/z/v/idx within the frame it is given, so no entry is ever retained.
  const list = st.burningList;
  let n = 0, live = 0, any = false;
  for (let j = 0; j < FR; j++) {
    const wzp = (j + 0.5) * cell - half;
    for (let i = 0; i < FR; i++) {
      const idx = j * FR + i;
      let b = st.burning[idx];
      if (b <= 0.02) continue;
      any = true;
      const fuel = st.fuel[idx] / 255;
      // consume fuel, scar the ground
      st.fuel[idx] = Math.max(0, st.fuel[idx] - dt * 0.055 * (0.4 + b) * 255);
      const wxp = (i + 0.5) * cell - half;
      let e = list[n];
      if (!e) e = list[n] = { x: 0, z: 0, v: 0, idx: 0 };
      e.x = wxp; e.z = wzp; e.v = b; e.idx = idx; n++;
      st.paintGround(wxp, wzp, CH.BURN, dt * 0.35, cell * 0.7);
      st.paintGround(wxp, wzp, CH.LUSH, -dt * 0.5, cell * 0.7);
      const reg = st.regions[regionIndex(wxp, wzp)];
      reg.trees = Math.max(0, reg.trees - dt * 0.004);
      // Trees here are burning, so whatever is scattered in this chunk is
      // now wrong. Mark it for re-scatter: the renderer drains this set, so
      // the charred snags appear whether or not the player watched it burn,
      // and a fire crossing a chunk seam marks both sides.
      st.markVegDirty(wxp, wzp);
      reg.prey = Math.max(0, reg.prey - dt * 0.03);
      reg.pred = Math.max(0, reg.pred - dt * 0.006);
      // decay
      b -= dt * (0.030 + wetness * 0.40) + (fuel < 0.05 ? dt * 0.45 : 0);
      b = b > 0 ? b : 0;
      st.burning[idx] = b;
      if (b > 0.02) live++;
      if (b > 0.25 && wetness < 0.5) {
        for (let d = 0; d < 4; d++) {
          const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
          const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
          const ni = i + dx, nj = j + dz;
          if (ni < 0 || nj < 0 || ni >= FR || nj >= FR) continue;
          const nidx = nj * FR + ni;
          if (st.burning[nidx] > 0.1 || st.fuel[nidx] < 40) continue;
          const along = clamp(dx * wx + dz * wz, -1, 1);
          const chance = dt * (0.008 + 0.055 * (st.fuel[nidx] / 255)) * multiplier(along);
          if (Math.random() < chance) spread.push(nidx);
        }
      }
    }
  }
  for (let q = 0; q < spread.length; q++) {
    const idx = spread[q];
    st.burning[idx] = 0.55;
    let e = list[n];
    if (!e) e = list[n] = { x: 0, z: 0, v: 0, idx: 0 };
    e.x = (idx % FR + 0.5) * cell - half;
    e.z = (((idx / FR) | 0) + 0.5) * cell - half;
    e.v = 0.55; e.idx = idx; n++;
  }
  list.length = n;
  // Deliberately conservative: a cell can be counted both by the scan and by
  // a spread onto it, which only ever over-counts. Under-counting to zero
  // would freeze a live fire behind the early return above.
  st._burnCount = live + spread.length;
  st.fireActive = any || spread.length > 0;
}
