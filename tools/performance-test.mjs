// Focused regressions for frame-time quality adaptation. A slow frame is not
// capped by the simulation delta, and a single tab-resume spike is not a trend.
import assert from 'node:assert/strict';
import { LoopMixin } from '../src/loop.js';

function makeGame(quality = 'high') {
  const game = Object.assign({
    frameTimes: [],
    quality,
    toasts: [],
    cycleQuality() {
      this.quality = this.quality === 'high' ? 'medium' : this.quality === 'medium' ? 'low' : 'high';
    },
    ui: { toast(message) { game.toasts.push(message); } },
  }, LoopMixin);
  return game;
}

const high = makeGame('high');
for (let i = 0; i < 120; i++) high.sampleAdaptiveQuality(0.06);
assert.equal(high.quality, 'high', 'quality should wait for a complete sample window');
high.sampleAdaptiveQuality(0.06);
assert.equal(high.quality, 'medium', 'sustained 60 ms frames should lower high quality');
assert.deepEqual(high.toasts, ['Quality lowered for smoother play']);
assert.equal(high.frameTimes.length, 0, 'sample window should reset after evaluation');

const mediumSlow = makeGame('medium');
for (let i = 0; i < 121; i++) mediumSlow.sampleAdaptiveQuality(0.08);
assert.equal(mediumSlow.quality, 'low', 'sustained 80 ms frames should lower medium quality');

const mediumHealthy = makeGame('medium');
for (let i = 0; i < 121; i++) mediumHealthy.sampleAdaptiveQuality(0.06);
assert.equal(mediumHealthy.quality, 'medium', 'medium quality should tolerate frames below its 70 ms threshold');

const resumeSpike = makeGame('high');
for (let i = 0; i < 120; i++) resumeSpike.sampleAdaptiveQuality(1 / 60);
resumeSpike.sampleAdaptiveQuality(10);
assert.equal(resumeSpike.quality, 'high', 'one background-tab gap must not downgrade quality');

const invalidSample = makeGame('high');
invalidSample.sampleAdaptiveQuality(Number.NaN);
assert.equal(invalidSample.frameTimes[0], 0, 'non-finite timing samples should be ignored safely');

const simulationSteps = [], effectSteps = [], frameToasts = [];
const frameGame = Object.assign({
  clock: { getDelta: () => 0.06 }, frameTimes: [], quality: 'high', hitStop: 0,
  timeScale: 1, saveTimer: 100, ambienceTimer: 10,
  ui: { blocking: false, tickRecord() {}, setPrompt() {}, update() {}, toast(m) { frameToasts.push(m); } },
  state: { time: 0.4, weather: { type: 'clear', windSpeed: 0.2, intensity: 0 }, settlements: [], burningList: [], burningCount: () => 0, update(dt) { simulationSteps.push(dt); } },
  input: { consume: () => ({ interact: false, attack: false }), look: { set() {} } },
  player: { pos: { x: 0, y: 0, z: 0 }, update() {} }, camera: {}, scene: {},
  streamChunks() {}, actors: { update() {} }, fx: { update(dt) { effectSteps.push(dt); } },
  syncStructures() {}, checkDiscoveries() {}, guidance: { update() {} }, updateSight() {}, updateGroundMemory() {},
  audio: { ambience() {}, play() {} }, nearestFireDist: () => 999, waterNearness: () => 0,
  hearthNearness: () => 0, findTarget: () => null, renderer: { render() {} },
  cycleQuality() { this.quality = 'medium'; },
}, LoopMixin);
frameGame.checkDiscoveries = () => {};
frameGame.updateSight = () => {};
frameGame.updateGroundMemory = () => {};
for (let i = 0; i < 121; i++) frameGame.frame();
assert.equal(frameGame.quality, 'medium', 'the actual frame loop must downshift on sustained 60 ms frames');
assert.ok(simulationSteps.every(dt => dt <= 0.05) && effectSteps.every(dt => dt <= 0.05),
  'simulation and effects must retain the 50 ms catch-up cap');
assert.deepEqual(frameToasts, ['Quality lowered for smoother play']);

console.log('adaptive quality: slow frames lower quality, simulation stays capped, and resume spikes do not downshift ✓');
