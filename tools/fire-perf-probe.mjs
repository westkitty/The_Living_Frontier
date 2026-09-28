// Reproducible paired CPU probe for nearby fire visuals. The reference updater
// is the pre-optimization full-filter/sort path, retained here only for an
// apples-to-apples workload comparison against FX.updateFire.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FX } from '../src/fx.js';
import { WORLD, heightAt } from '../src/worldgen.js';
import { clamp, lerp } from '../src/rng.js';
import { shared } from '../src/terrain.js';
import { emitSmoke, updateSmokeParticles } from '../src/fx-particles.js';

const shouldAssert = process.argv.includes('--assert');
const player = new THREE.Vector3(0, 0, 0);
const originalRandom = Math.random;
Math.random = () => 1; // prevent smoke emission so this isolates fire selection

function legacyUpdateFire(dt, playerPos) {
  const st = this.state;
  const cells = [];
  for (const c of st.burningList) {
    const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
    if (d < 220) cells.push({ x: c.x, z: c.z, v: c.v, d });
  }
  cells.sort((a, b) => a.d - b.d);
  for (let i = 0; i < this.flamePool.length; i++) {
    const m = this.flamePool[i], c = cells[i];
    if (!c) { m.visible = false; continue; }
    m.visible = true;
    const y = heightAt(c.x, c.z);
    const flick = 0.75 + Math.sin(shared.uTime.value * 11 + i * 2.1) * 0.25;
    m.position.set(c.x + Math.sin(shared.uTime.value + i) * 1.2, y, c.z + Math.cos(shared.uTime.value * 1.2 + i) * 1.2);
    const s = (2.2 + c.v * 5) * flick;
    m.scale.set(s * 0.7, s, s * 0.7);
    m.material.color.setHSL(lerp(0.02, 0.11, flick), 1, lerp(0.45, 0.62, flick));
    m.material.opacity = 0.75 + flick * 0.2;
    if (Math.random() < dt * 14) emitSmoke(this, c.x, y + 3, c.z);
  }
  if (cells.length) {
    this.fireLight.position.set(cells[0].x, heightAt(cells[0].x, cells[0].z) + 4, cells[0].z);
    this.fireLight.intensity = clamp(6 * cells[0].v, 0, 8) * (0.8 + Math.sin(shared.uTime.value * 9) * 0.2);
    this.fireLight.distance = 70;
  } else this.fireLight.intensity = lerp(this.fireLight.intensity, 0, dt * 4);
  updateSmokeParticles(this, dt);
}

function makeFixture(count, local) {
  const cells = [];
  if (local) {
    // Actual 96×96 fire-grid cell centres, all within the 220 m visual radius.
    for (let j = 0; j < WORLD.fireRes; j++) for (let i = 0; i < WORLD.fireRes; i++) {
      const x = (i + 0.5) * WORLD.fireCell - WORLD.half;
      const z = (j + 0.5) * WORLD.fireCell - WORLD.half;
      const d2 = x * x + z * z;
      if (d2 < 220 * 220) cells.push({ x, z, v: 0.45 + (i + j) % 6 * 0.08, d2 });
    }
    cells.sort((a, b) => a.d2 - b.d2);
    cells.length = Math.min(count, cells.length);
  } else {
    // 2,000 distinct active cells spread over the real fire grid.
    const size = WORLD.fireRes * WORLD.fireRes;
    for (let n = 0; n < count; n++) {
      const idx = (n * 37) % size;
      const i = idx % WORLD.fireRes, j = Math.floor(idx / WORLD.fireRes);
      cells.push({
        x: (i + 0.5) * WORLD.fireCell - WORLD.half,
        z: (j + 0.5) * WORLD.fireCell - WORLD.half,
        v: 0.45 + (n % 6) * 0.08,
        idx,
      });
    }
  }
  return cells.map(({ x, z, v }, idx) => ({ x, z, v, idx }));
}

function makeFx(state) {
  const fx = new FX(new THREE.Scene(), { setClearColor() {} }, state);
  fx.flamePool = fx.flamePool || [];
  return fx;
}

function summarize(samples) {
  const ordered = Array.from(samples).sort((a, b) => a - b);
  return {
    median: ordered[Math.floor(ordered.length * 0.5)],
    p95: ordered[Math.floor(ordered.length * 0.95)],
  };
}

function countHotPathOps(fx, update, frames = 8) {
  let sorts = 0, pushes = 0;
  const nativeSort = Array.prototype.sort, nativePush = Array.prototype.push;
  Array.prototype.sort = function (...args) { sorts++; return nativeSort.apply(this, args); };
  Array.prototype.push = function (...args) { pushes += args.length; return nativePush.apply(this, args); };
  try { for (let i = 0; i < frames; i++) update.call(fx, 1 / 60, player); }
  finally { Array.prototype.sort = nativeSort; Array.prototype.push = nativePush; }
  return { sorts, pushes, frames };
}

function assertSameOutput(optimized, legacy, expected) {
  const live = optimized.flamePool.filter(m => m.visible);
  const prior = legacy.flamePool.filter(m => m.visible);
  assert.equal(live.length, prior.length, 'visible flame count must not change');
  assert.equal(live.length, Math.min(expected.length, optimized.flamePool.length));
  for (let i = 0; i < live.length; i++) {
    assert.ok(live[i].position.distanceTo(prior[i].position) < 1e-6,
      `optimized flame ${i} must match the prior nearest-cell selection`);
  }
  assert.ok(optimized.fireLight.position.distanceTo(legacy.fireLight.position) < 1e-6,
    'firelight position must remain unchanged');
  assert.equal(optimized.fireLight.intensity, legacy.fireLight.intensity,
    'firelight intensity must remain unchanged');
  for (let i = 0; i < live.length; i++) {
    const cell = expected[i];
    const time = shared.uTime.value;
    const x = cell.x + Math.sin(time + i) * 1.2;
    const z = cell.z + Math.cos(time * 1.2 + i) * 1.2;
    assert.ok(Math.hypot(live[i].position.x - x, live[i].position.z - z) < 1e-6,
      `flame ${i} should still render the corresponding nearest burning cell`);
  }
}

try {
  for (const workload of [
    { label: '163 nearby burning cells', count: 163, local: true },
    { label: '2,000 map-wide burning cells', count: 2000, local: false },
  ]) {
    const state = { weather: { windDir: 0.7 }, burningList: makeFixture(workload.count, workload.local) };
    const expected = state.burningList
      .map(c => ({ ...c, d: Math.hypot(c.x - player.x, c.z - player.z) }))
      .filter(c => c.d < 220)
      .sort((a, b) => a.d - b.d)
      .slice(0, 16);
    const legacy = makeFx(state);
    const optimized = makeFx(state);
    for (let i = 0; i < 80; i++) {
      legacyUpdateFire.call(legacy, 1 / 60, player);
      optimized.updateFire(1 / 60, player);
    }

    const rounds = 5, perRound = 120, frames = rounds * perRound;
    const oldMeasured = new Float64Array(frames), newMeasured = new Float64Array(frames);
    for (let round = 0; round < rounds; round++) {
      const offset = round * perRound;
      const run = (fx, update, target) => {
        for (let i = 0; i < perRound; i++) {
          const start = performance.now();
          update.call(fx, 1 / 60, player);
          target[offset + i] = performance.now() - start;
        }
      };
      if (round % 2 === 0) { run(legacy, legacyUpdateFire, oldMeasured); run(optimized, optimized.updateFire, newMeasured); }
      else { run(optimized, optimized.updateFire, newMeasured); run(legacy, legacyUpdateFire, oldMeasured); }
    }

    legacyUpdateFire.call(legacy, 0, player);
    optimized.updateFire(0, player);
    const oldStats = summarize(oldMeasured), newStats = summarize(newMeasured);
    const oldOps = countHotPathOps(legacy, legacyUpdateFire);
    const newOps = countHotPathOps(optimized, optimized.updateFire);
    console.log(`${workload.label} (${frames} frames): legacy ${oldStats.median.toFixed(3)} ms median / ${oldStats.p95.toFixed(3)} ms p95; optimized ${newStats.median.toFixed(3)} / ${newStats.p95.toFixed(3)} ms; sort calls ${oldOps.sorts}->${newOps.sorts}, candidate pushes ${oldOps.pushes}->${newOps.pushes}`);
    if (shouldAssert) {
      assertSameOutput(optimized, legacy, expected);
      assert.equal(newOps.sorts, 0, 'optimized fire selection must not sort per frame');
      assert.equal(newOps.pushes, 0, 'optimized fire selection must not allocate candidates through push');
      assert.ok(oldOps.sorts > 0 && oldOps.pushes > 0, 'reference path should exercise the removed work');
      for (const cells of [state.burningList.slice(0, 5), [{ x: 260, z: 0, v: 0.8 }], []]) {
        state.burningList = cells;
        const expectedLive = cells.filter(c => Math.hypot(c.x - player.x, c.z - player.z) < 220)
          .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))
          .slice(0, optimized.flamePool.length);
        legacyUpdateFire.call(legacy, 1 / 60, player);
        optimized.updateFire(1 / 60, player);
        assertSameOutput(optimized, legacy, expectedLive);
      }
    }
  }
} finally {
  Math.random = originalRandom;
}
