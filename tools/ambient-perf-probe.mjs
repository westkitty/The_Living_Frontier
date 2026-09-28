// Same 100-second, 60 Hz workload through the old per-frame audio sampling
// policy and the production scheduler. Terrain, settlements and 512 fire
// cells are fixed so call counts and timings are directly comparable.
import { LoopMixin } from '../src/loop.js';
import { updateAmbientAudio } from '../src/ambient.js';
import { WorldState } from '../src/worldstate.js';
import { heightAt } from '../src/worldgen.js';

const FRAMES = 6000, DT = 1 / 60, ROUNDS = 5;
const at = { x: -604, z: -952 };
function fixture() {
  const state = new WorldState();
  state.time = 0.5;
  state.weather.type = 'storm';
  state.weather.intensity = 0.82;
  state.weather.windSpeed = 0.74;
  state.weather.windDir = 1.1;
  state.burningList = Array.from({ length: 512 }, (_, i) => ({
    x: (i * 67) % 1800 - 900, z: (i * 97) % 1800 - 900,
  }));
  state.settlements.forEach((s, i) => {
    s.x = at.x + 18 + i * 23;
    s.z = at.z + 10 - i * 13;
    s.prosperity = 0.7;
  });
  const audio = { enabled: true, muted: false, volume: 0.7, calls: 0, last: null,
    ambience(value) { this.calls++; this.last = value; } };
  return {
    state, audio, player: { pos: at },
    waterNearness: LoopMixin.waterNearness,
    nearestFireDist: LoopMixin.nearestFireDist,
    hearthNearness: LoopMixin.hearthNearness,
  };
}
function legacyPerFrame(world, dt) {
  const st = world.state, w = st.weather;
  world.audio.ambience({
    wind: w.windSpeed,
    rain: w.type === 'rain' || w.type === 'storm' ? w.intensity : 0,
    fire: Math.min(1, st.burningCount() * 0.25)
      * (1 - Math.max(0, Math.min(1, Math.abs(world.nearestFireDist() / 90)))),
    water: world.waterNearness(),
    hearth: world.hearthNearness(),
    night: st.time < 0.22 || st.time > 0.8,
  });
}
function run(policy) {
  const world = fixture();
  // Same warm-up on both paths, then exclude it from the measurement.
  for (let i = 0; i < 600; i++) policy(world, DT);
  world.audio.calls = 0;
  const times = [];
  for (let round = 0; round < ROUNDS; round++) {
    world.audio.calls = 0;
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) policy(world, DT);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { ms: times[2], calls: world.audio.calls, last: world.audio.last };
}
const before = run(legacyPerFrame);
const after = run(updateAmbientAudio);
const ratio = after.calls / before.calls;
console.log(`ambient sampling, same ${FRAMES} frames × ${ROUNDS} rounds (100 s @ 60 Hz), 512 burning cells:`);
console.log(`  every-frame baseline: ${before.calls} samples/round, ${before.ms.toFixed(2)} ms median/round`);
console.log(`  scheduled production: ${after.calls} samples/round, ${after.ms.toFixed(2)} ms median/round`);
console.log(`  input work reduction: ${(100 * (1 - ratio)).toFixed(1)}%; scheduled / baseline wall time: ${(100 * after.ms / before.ms).toFixed(1)}%`);
console.log(`  local water signal: ${after.last?.water.toFixed(3)}; audio targets remain live: ${after.calls > 0}`);
if (process.argv.includes('--assert')) {
  if (!(ratio > 0 && ratio < 0.16)) throw new Error('Ambient scheduler did not reduce samples to the expected sub-16% rate');
  for (const key of ['wind', 'rain', 'fire', 'water', 'hearth', 'night']) {
    if (before.last[key] !== after.last[key]) throw new Error(`Ambient target changed for ${key}`);
  }
  const muted = fixture();
  muted.audio.muted = true;
  if (updateAmbientAudio(muted, DT) || muted.audio.calls) throw new Error('Muted ambience should skip world sampling');
  console.log('  preserved target values; muted path skips sampling ✓');
}
