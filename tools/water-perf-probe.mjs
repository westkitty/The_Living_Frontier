// Water performance and lifecycle probe.
//
// The atlas asks for three specific numbers, and they are the three this probe
// asserts: what the water costs to build at boot, what it costs per frame when
// nothing is happening near it, and whether repeated create/destroy cycles leak.
// Run with: node tools/water-perf-probe.mjs [--assert]
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterSystem } from '../src/water-system.js';
import { buildWaterField, FIELD_RES } from '../src/water-field.js';

const shouldAssert = process.argv.includes('--assert');
const ms = (t) => (performance.now() - t);

// A renderer stub: the water system only touches it for fog and exposure.
const renderer = {
  setClearColor() { }, toneMappingExposure: 1.06,
  info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
};
function makeGame() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa8b0b4, 60, 520);
  return {
    scene, renderer, quality: 'high',
    camera: new THREE.PerspectiveCamera(62, 1.5, 0.4, 3000),
    state: { weather: { type: 'clear', intensity: 0, windSpeed: 0.45, windDir: 0.7 } },
    player: { pos: new THREE.Vector3(120, 40, 60), vel: new THREE.Vector3() },
    actors: { animals: [] },
  };
}
const countOwned = (scene) => {
  let geometries = 0, materials = 0;
  scene.traverse((o) => { if (o.geometry) geometries++; if (o.material) materials++; });
  return { geometries, materials, children: scene.children.length };
};

// --- 1. cold start: building the field is the expensive part ---------------
let t = performance.now();
const field = buildWaterField(FIELD_RES);
const fieldMs = ms(t);
assert.ok(field.length === FIELD_RES * FIELD_RES * 4);
console.log(`water field ${FIELD_RES}x${FIELD_RES} build (cold): ${fieldMs.toFixed(0)} ms`);
if (shouldAssert) assert.ok(fieldMs < 400, `water field build too slow: ${fieldMs.toFixed(0)} ms`);

// --- 2. constructing the whole subsystem ----------------------------------
const game = makeGame();
t = performance.now();
game.waterSys = new WaterSystem(game);
const buildMs = ms(t);
console.log(`WaterSystem construct (incl. field + texture): ${buildMs.toFixed(0)} ms`);
if (shouldAssert) assert.ok(buildMs < 900, `WaterSystem construct too slow: ${buildMs.toFixed(0)} ms`);

// --- 3. steady frame with no water nearby: the dormant rule ---------------
{
  const N = 3000;
  for (let i = 0; i < 200; i++) game.waterSys.update(1 / 60);      // warm up
  const samples = [];
  for (let r = 0; r < 5; r++) {
    t = performance.now();
    for (let i = 0; i < N; i++) game.waterSys.update(1 / 60);
    samples.push(ms(t) / N);
  }
  samples.sort((a, b) => a - b);
  const median = samples[2], p95 = samples[4];
  console.log(`idle water update: ${median.toFixed(4)} ms median, ${p95.toFixed(4)} ms p95 (player 120 m from water)`);
  if (shouldAssert) assert.ok(median < 0.25, `idle water update too expensive: ${median.toFixed(3)} ms`);
}

// --- 4. the same frame while standing in a river with effects running -----
{
  game.player.pos.set(-896.37, 0, -181.58);
  game.camera.position.set(-896.37, 0.6, -181.58);
  const N = 1200;
  const samples = [];
  for (let r = 0; r < 5; r++) {
    t = performance.now();
    for (let i = 0; i < N; i++) {
      // Keep the pools genuinely populated for the whole run: ripples live
      // 2.6 s, so a pool filled once before the loop would be empty well
      // before the timing meant anything.
      if (i % 10 === 0) game.waterSys.fx.ripple(-896 + (i % 40), -181, 1);
      game.waterSys.update(1 / 60);
    }
    samples.push(ms(t) / N);
  }
  samples.sort((a, b) => a - b);
  const live = game.waterSys.fx.activeRipples;
  console.log(`busy water update: ${samples[2].toFixed(4)} ms median (in a river, ${live} live ripples, ${game.waterSys.fx.activeDrops} drops, bubbles on)`);
  if (shouldAssert) {
    assert.ok(live > 5, `the busy run had only ${live} live ripples, so it measured an empty pool`);
    assert.ok(samples[2] < 1.2, `busy water update too expensive: ${samples[2].toFixed(3)} ms`);
  }
}

// --- 5. lifecycle torture: 50 create/destroy cycles must not grow ---------
{
  const fresh = makeGame();
  const baseline = countOwned(fresh.scene);
  let peakChildren = 0;
  for (let i = 0; i < 50; i++) {
    const sys = new WaterSystem(fresh);
    for (let k = 0; k < 20; k++) { sys.update(1 / 60); sys.fx.ripple(-896, -181, 1); }
    sys.setQuality(['high', 'medium', 'low'][i % 3]);
    sys.update(1 / 60);
    peakChildren = Math.max(peakChildren, countOwned(fresh.scene).children);
    sys.dispose();
  }
  const after = countOwned(fresh.scene);
  console.log(`50 create/dispose cycles: scene children ${baseline.children} -> ${after.children} (peak ${peakChildren}), geometries ${after.geometries}, materials ${after.materials}`);
  if (shouldAssert) {
    assert.deepEqual(after, baseline, 'water leaked scene objects across 50 lifecycles');
    assert.ok(peakChildren <= baseline.children + 4, `peak ownership grew to ${peakChildren}`);
  }
  game.waterSys.dispose();
}

// --- 6. quality switching must not accumulate -----------------------------
{
  const fresh = makeGame();
  const sys = new WaterSystem(fresh);
  const before = countOwned(fresh.scene);
  for (let i = 0; i < 60; i++) {
    sys.setQuality(['high', 'medium', 'low'][i % 3]);
    sys.update(1 / 60);
  }
  const after = countOwned(fresh.scene);
  console.log(`60 quality switches: scene children ${before.children} -> ${after.children}`);
  if (shouldAssert) assert.deepEqual(after, before, 'quality cycling leaked scene objects');
  sys.dispose();
}

console.log(shouldAssert ? 'water performance: cold start, idle cost and lifecycle all within budget ✓'
  : 'water performance probe complete (no assertions)');
