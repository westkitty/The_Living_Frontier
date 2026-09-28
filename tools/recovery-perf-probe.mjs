// Paired regression/performance probe for the slow world-recovery tick.
// The reference path matches the pre-cache full-map/noise implementation.
import assert from 'node:assert/strict';
import { WorldState, regionIndex } from '../src/worldstate.js';
import { WORLD, treeDensityAt } from '../src/worldgen.js';
import { clamp } from '../src/rng.js';

const FR = WORLD.fireRes, RR = WORLD.regionRes;
const shouldAssert = process.argv.includes('--assert');

function legacyRecovery(state, dt) {
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
  const g = state.ground;
  for (let i = 0; i < g.length; i += 4) {
    if (burnHeal && g[i]) g[i] = Math.max(0, g[i] - burnHeal);
    if (trailFade && g[i + 1]) g[i + 1] = Math.max(0, g[i + 1] - trailFade);
    if (lushGain && g[i + 2] < 255 && g[i] < 40) g[i + 2] = Math.min(255, g[i + 2] + lushGain);
  }
  state.groundDirty = true; state.groundStamp++;
  for (let j = 0; j < FR; j++) for (let i = 0; i < FR; i++) {
    const idx = j * FR + i;
    const x = (i + 0.5) * WORLD.fireCell - WORLD.half, z = (j + 0.5) * WORLD.fireCell - WORLD.half;
    const target = clamp(treeDensityAt(x, z) * state.regions[regionIndex(x, z)].trees * 1.1, 0, 1) * 255;
    if (state.fuel[idx] < target) state.fuel[idx] = Math.min(target, state.fuel[idx] + step * (0.06 + rain * 0.5));
  }
  for (const key in state.vegRemoved) {
    const m = state.vegRemoved[key]; let empty = true;
    for (const i in m) {
      if (m[i] <= state.elapsed) {
        delete m[i]; state.vegDirty = true;
        state.vegDirtyKeys = state.vegDirtyKeys || new Set(); state.vegDirtyKeys.add(key);
      } else empty = false;
    }
    if (empty) delete state.vegRemoved[key];
  }
}

function resetNoOp(state) {
  state.recoverAccum = state.rainAccum = state._healFrac = state._trailFrac = state._lushFrac = 0;
  state.ground.fill(0); state.groundDirty = false; state.groundStamp = 0; state.vegRemoved = {};
}

try {
  const legacy = new WorldState(), optimized = new WorldState();
  resetNoOp(legacy); resetNoOp(optimized);
  for (let i = 0; i < 3; i++) { legacyRecovery(legacy, 4); optimized.tickRecovery(4); resetNoOp(legacy); resetNoOp(optimized); }
  const rounds = 4, perRound = 10, frames = rounds * perRound;
  const oldSamples = new Float64Array(frames), newSamples = new Float64Array(frames);
  const run = (state, update, samples, offset) => {
    for (let i = 0; i < perRound; i++) {
      resetNoOp(state);
      const start = performance.now(); update(state, 4); samples[offset + i] = performance.now() - start;
    }
  };
  for (let round = 0; round < rounds; round++) {
    const offset = round * perRound;
    if (round % 2) { run(optimized, (s, dt) => s.tickRecovery(dt), newSamples, offset); run(legacy, legacyRecovery, oldSamples, offset); }
    else { run(legacy, legacyRecovery, oldSamples, offset); run(optimized, (s, dt) => s.tickRecovery(dt), newSamples, offset); }
  }
  const summarize = samples => {
    const ordered = Array.from(samples).sort((a, b) => a - b);
    return { median: ordered[Math.floor(frames * 0.5)], p95: ordered[Math.floor(frames * 0.95)] };
  };
  const old = summarize(oldSamples), current = summarize(newSamples);
  console.log(`recovery tick (no byte changes, ${frames} paired samples): legacy ${old.median.toFixed(2)} ms median / ${old.p95.toFixed(2)} ms p95; cached ${current.median.toFixed(2)} / ${current.p95.toFixed(2)} ms; ground dirty ${legacy.groundDirty}->${optimized.groundDirty}`);

  if (shouldAssert) {
    for (const idx of [0, 7, 8, 47 * FR + 48, FR * FR - 1]) {
      const j = (idx / FR) | 0, i = idx - j * FR;
      const x = (i + 0.5) * WORLD.fireCell - WORLD.half, z = (j + 0.5) * WORLD.fireCell - WORLD.half;
      assert.equal(optimized.fuelDensity[idx], treeDensityAt(x, z), `cached density ${idx} must match terrain`);
    }
    assert.equal(legacy.groundDirty, true, 'reference no-op path should expose its prior unconditional dirty mark');
    assert.equal(legacy.groundStamp, 1, 'reference no-op path should expose its prior unconditional cache invalidation');
    assert.equal(optimized.groundDirty, false, 'fraction-only recovery must not dirty the ground texture');
    assert.equal(optimized.groundStamp, 0, 'fraction-only recovery must not invalidate map caches');
    assert.deepEqual(optimized.ground, legacy.ground, 'no-op recovery must preserve ground bytes');
    assert.deepEqual(optimized.fuel, legacy.fuel, 'cached no-op recovery must preserve fuel bytes');

    const prior = new WorldState(), actual = new WorldState();
    for (const state of [prior, actual]) {
      for (let i = 0; i < state.ground.length; i++) state.ground[i] = (i * 17 + (i >>> 4)) & 255;
      for (let i = 0; i < state.fuel.length; i++) state.fuel[i] = (i * 11) % 240;
      state.regions.forEach((r, i) => { r.trees = 0.2 + (i % 10) * 0.1; });
      state.recoverAccum = 1; state.rainAccum = 40;
      state._healFrac = 0.8; state._trailFrac = 0.99; state._lushFrac = 0.75;
      state.elapsed = 100; state.groundDirty = false; state.groundStamp = 0;
      state.vegRemoved = { '1,1': { old: 99, future: 300 }, '2,2': {} };
    }
    legacyRecovery(prior, 3); actual.tickRecovery(3);
    assert.deepEqual(actual.ground, prior.ground, 'recovered ground must remain byte-identical');
    assert.deepEqual(actual.fuel, prior.fuel, 'cached fuel targets must match the original formula');
    assert.deepEqual(actual.vegRemoved, prior.vegRemoved, 'vegetation regrowth lifecycle must remain unchanged');
    assert.equal(actual.vegDirty, prior.vegDirty, 'vegetation mesh dirty state must remain unchanged');
    assert.deepEqual(actual.vegDirtyKeys, prior.vegDirtyKeys, 'vegetation dirty-chunk keys must remain unchanged');
    for (const key of ['recoverAccum', 'rainAccum', '_healFrac', '_trailFrac', '_lushFrac', 'groundDirty', 'groundStamp']) {
      assert.equal(actual[key], prior[key], `recovery field ${key} must remain equivalent`);
    }
    const threshold = new WorldState(); resetNoOp(threshold);
    for (let i = 0; i < 8; i++) threshold.tickRecovery(4);
    assert.equal(threshold.groundStamp, 0, 'fractional recovery should remain upload-free');
    assert.equal(threshold.groundDirty, false, 'fractional recovery should not mark the ground dirty');
    threshold.tickRecovery(4);
    assert.equal(threshold.groundStamp, 1, 'the first real byte change must invalidate ground consumers');
    assert.equal(threshold.groundDirty, true, 'real ground recovery must mark its texture dirty');
    assert.ok(threshold.ground.some((v, i) => i % 4 === 2 && v > 0), 'lush recovery must still modify ground bytes');
    console.log('recovery: byte parity, cached density, dirty-state suppression, and real-change invalidation ✓');
  }
} finally {
  // No global or persistent state is mutated by this standalone probe.
}
