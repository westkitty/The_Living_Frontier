// Slow world-memory and fuel recovery, separated from the per-frame simulation.
import { clamp } from './rng.js';
import { WORLD } from './worldgen.js';

const FR = WORLD.fireRes, RR = WORLD.regionRes;

export function recoverWorldState(state, dt) {
  state.recoverAccum = (state.recoverAccum || 0) + dt;
  if (state.recoverAccum < 4) return;
  const step = state.recoverAccum; state.recoverAccum = 0;
  const rain = clamp((state.rainAccum || 0) * 0.02, 0, 1); state.rainAccum = 0;
  state._healFrac = (state._healFrac || 0) + step * (0.006 + rain * 0.06);
  const burnHeal = Math.floor(state._healFrac); state._healFrac -= burnHeal;
  state._trailFrac = (state._trailFrac || 0) + step * 0.004;
  const trailFade = Math.floor(state._trailFrac); state._trailFrac -= trailFade;
  state._lushFrac = (state._lushFrac || 0) + step * (0.03 + rain * 0.25);
  const lushGain = Math.floor(state._lushFrac); state._lushFrac -= lushGain;

  // Fractional recovery changes no bytes; skip the 1 MiB map scan and upload.
  if (burnHeal || trailFade || lushGain) {
    const g = state.ground;
    let changed = false;
    for (let i = 0; i < g.length; i += 4) {
      if (burnHeal && g[i]) { g[i] = Math.max(0, g[i] - burnHeal); changed = true; }
      if (trailFade && g[i + 1]) { g[i + 1] = Math.max(0, g[i + 1] - trailFade); changed = true; }
      if (lushGain && g[i + 2] < 255 && g[i] < 40) { g[i + 2] = Math.min(255, g[i + 2] + lushGain); changed = true; }
    }
    if (changed) { state.groundDirty = true; state.groundStamp++; }
  }

  // Density is immutable after world creation; reuse the constructor's exact
  // samples instead of evaluating five terrain fields for every fire cell.
  const fuel = state.fuel, density = state.fuelDensity, regions = state.regions;
  for (let idx = 0; idx < fuel.length; idx++) {
    const j = (idx / FR) | 0, i = idx - j * FR;
    const ri = (((j + 0.5) * RR / FR) | 0) * RR + (((i + 0.5) * RR / FR) | 0);
    const target = clamp(density[idx] * regions[ri].trees * 1.1, 0, 1) * 255;
    if (fuel[idx] < target) fuel[idx] = Math.min(target, fuel[idx] + step * (0.06 + rain * 0.5));
  }

  for (const key in state.vegRemoved) {
    const m = state.vegRemoved[key];
    let empty = true;
    for (const i in m) {
      if (m[i] <= state.elapsed) {
        delete m[i]; state.vegDirty = true;
        state.vegDirtyKeys = state.vegDirtyKeys || new Set(); state.vegDirtyKeys.add(key);
      } else empty = false;
    }
    if (empty) delete state.vegRemoved[key];
  }
}
