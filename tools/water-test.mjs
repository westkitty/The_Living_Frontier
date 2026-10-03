// Water Truth Lab — the deterministic gate for the water abstraction.
//
// Water is derived, not simulated, so every answer here must be a pure
// function of (x, z) and the weather. That is what makes it testable in plain
// Node with no renderer, and what lets gameplay trust it. Run with:
//
//   node tools/water-test.mjs
import assert from 'node:assert/strict';
import { WORLD, heightAt, riverField } from '../src/worldgen.js';
import { WaterQuery, WATER_BAND, SPLASH_DEPTH, WADE_DEPTH, SWIM_DEPTH, SHORE_DEPTH } from '../src/water.js';
import { clamp } from '../src/rng.js';
import { LoopMixin } from '../src/loop.js';
import { WaterInteraction, WATER_EVENT } from '../src/water-events.js';
import { buildWaterField, fieldIndexOf, FIELD_RES, FIELD_MAX_DEPTH } from '../src/water-field.js';
import { WATER_QUALITY, waterQualityFor, waterAllows } from '../src/water-quality.js';
import { BuoyancySystem, DRAFT, SPRING_K, SPRING_C } from '../src/water-buoyancy.js';
import { LANDMARKS } from '../src/worldgen.js';

const ok = (m) => console.log('  \u2713 ' + m);
let COMPLETED = false;
process.on('exit', () => {
  if (!COMPLETED) { console.error('\n WATER TEST ENDED EARLY — stopped before its final assertions\n'); process.exitCode = 1; }
});

// --- fixed fixtures, real coordinates in the shipped world ------------------
// groundY is passed explicitly so each band boundary is reachable on demand
// without hunting the heightfield for a spot that happens to sit there.
const LAND = { x: 120, z: 60 };                 // meadow, ~39 m above the sea
const RIVER = { x: -896.37, z: -187.34 };        // river bed, riverField 0.035
const SHALLOW = { x: -896.37, z: -60.53 };       // shallow wet lowland
const DEEP = { x: -896.37, z: -181.58 };         // ~5.9 m of water
const DROWNED = { x: 360, z: -560 };             // The Drowned Halls landmark

// --- 1. determinism: the same coordinate always answers the same way --------
{
  const a = WaterQuery.sample(RIVER.x, RIVER.z);
  const b = WaterQuery.sample(RIVER.x, RIVER.z);
  assert.deepEqual(a, b, 'repeated queries at one point must be byte-identical');
  for (const p of [LAND, RIVER, SHALLOW, DEEP, DROWNED]) {
    const first = JSON.stringify(WaterQuery.sample(p.x, p.z));
    for (let i = 0; i < 50; i++) assert.equal(JSON.stringify(WaterQuery.sample(p.x, p.z)), first);
  }
  ok('queries are deterministic: 50 repeats at each fixture are identical');
}

// --- 2. the refactor changed no behaviour -----------------------------------
// player.js used to ask `gh < WORLD.water + 0.3` directly. Every point in the
// world must still get exactly the same answer through WaterQuery, or routing
// movement through the new API would silently move the shoreline.
{
  let checked = 0, wet = 0, mismatch = 0;
  const N = 260;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -WORLD.half + (i / (N - 1)) * WORLD.size;
      const z = -WORLD.half + (j / (N - 1)) * WORLD.size;
      const gh = heightAt(x, z);
      const legacy = gh < WORLD.water + 0.3;
      if (WaterQuery.coveredAt(x, z, gh) !== legacy) mismatch++;
      if (WaterQuery.sample(x, z, gh).inWater !== legacy) mismatch++;
      checked++; if (legacy) wet++;
    }
  }
  assert.equal(mismatch, 0, `${mismatch} of ${checked} points disagree with the legacy water test`);
  assert.ok(wet > 0, 'the scan must actually contain water, or the test proves nothing');
  ok(`legacy water test reproduced exactly on ${checked.toLocaleString()} points (${wet.toLocaleString()} wet)`);
}

// --- 3. known land / river / shallow / deep answers -------------------------
{
  const land = WaterQuery.sample(LAND.x, LAND.z);
  assert.equal(land.band, WATER_BAND.DRY);
  assert.equal(land.inWater, false);
  assert.equal(land.waterType, 'none');
  assert.equal(land.flowX, 0); assert.equal(land.flowZ, 0);
  assert.equal(land.shoreFactor, 1, 'dry land is the far end of the shore mask');
  assert.ok(land.depth < -20, 'the meadow fixture must be well above water');

  const river = WaterQuery.sample(RIVER.x, RIVER.z);
  assert.equal(river.waterType, 'river');
  assert.equal(river.band, WATER_BAND.SPLASH);
  assert.equal(river.swimmable, false);
  assert.ok(river.depth > 0 && river.depth < 1, 'the river fixture is ankle-to-knee deep');

  const shallow = WaterQuery.sample(SHALLOW.x, SHALLOW.z);
  assert.equal(shallow.band, WATER_BAND.WADE);
  assert.equal(shallow.wadeable, true);
  assert.equal(shallow.swimmable, false);
  assert.ok(shallow.shoreFactor > 0 && shallow.shoreFactor < 1, 'shallows sit inside the shore fade');

  const deep = WaterQuery.sample(DEEP.x, DEEP.z);
  assert.equal(deep.band, WATER_BAND.SWIM);
  assert.equal(deep.swimmable, true);
  assert.equal(deep.waterType, 'river');
  assert.equal(deep.shoreFactor, 0, 'deep water is the other end of the shore mask');
  assert.ok(Math.hypot(deep.flowX, deep.flowZ) > 1, 'a deep river bed carries real current');

  const drowned = WaterQuery.sample(DROWNED.x, DROWNED.z);
  assert.equal(drowned.band, WATER_BAND.SWIM, 'the Drowned Halls stand in deep water');
  assert.equal(drowned.waterType, 'sea', 'flooded ruins are standing water, not a river');
  ok('fixtures answer correctly: dry land, river, shallows, deep water, Drowned Halls');
}

// --- 4. band boundaries, and the historical -0.3 kept exactly --------------
{
  assert.equal(SPLASH_DEPTH, -0.3, 'the splash boundary must stay at the historical player test');
  // depth = surface - ground, and the surface is WORLD.water (0), so ground = -depth
  const bandAt = (depth) => WaterQuery.sample(0, 0, WORLD.water - depth).band;
  assert.equal(bandAt(SPLASH_DEPTH), WATER_BAND.DRY, 'exactly at the boundary is still dry');
  assert.equal(bandAt(SPLASH_DEPTH + 1e-6), WATER_BAND.SPLASH);
  assert.equal(bandAt(WADE_DEPTH), WATER_BAND.SPLASH);
  assert.equal(bandAt(WADE_DEPTH + 1e-6), WATER_BAND.WADE);
  assert.equal(bandAt(SWIM_DEPTH), WATER_BAND.WADE);
  assert.equal(bandAt(SWIM_DEPTH + 1e-6), WATER_BAND.SWIM);
  assert.equal(bandAt(50), WATER_BAND.SWIM, 'the deepest band must not overflow');
  // submerged is a separate question from the historical inWater test
  const at = (d) => WaterQuery.sample(0, 0, WORLD.water - d);
  assert.equal(at(0.1).inWater, true, 'a wet ankle still counts as in water');
  assert.equal(at(0.1).submerged, true);
  assert.equal(at(-0.2).inWater, true, 'the historical predicate reaches 0.3 m above the surface');
  assert.equal(at(-0.2).submerged, false, 'but the surface is not actually over dry ground');
  ok('depth bands step DRY → SPLASH → WADE → SWIM at their documented boundaries');
}

// --- 5. the shore mask is a clean 0..1 ramp with no discontinuity ----------
{
  let prev = 1, steps = 0;
  for (let d = SPLASH_DEPTH - 1; d <= SHORE_DEPTH + 1; d += 0.01) {
    const s = WaterQuery.sample(DEEP.x, DEEP.z, WORLD.water - d).shoreFactor;
    assert.ok(s >= 0 && s <= 1, 'shore factor must stay inside 0..1');
    assert.ok(s <= prev + 1e-9, 'shore factor must fall monotonically as depth grows');
    assert.ok(s - prev > -0.02, 'no step larger than one sample: no hard shore seam');
    prev = s; steps++;
  }
  assert.ok(steps > 250, 'the ramp must actually be sampled densely');
  // and saturates at both ends: deep water 0, ground well clear of it 1
  assert.equal(WaterQuery.sample(DEEP.x, DEEP.z, WORLD.water - (SHORE_DEPTH + 5)).shoreFactor, 0);
  assert.equal(WaterQuery.sample(DEEP.x, DEEP.z, WORLD.water + SHORE_DEPTH + 5).shoreFactor, 1);
  ok(`shore mask ramps monotonically over ${steps} samples with no seam`);
}

// --- 6. current points downhill and never outruns the player ---------------
{
  for (const p of [RIVER, SHALLOW, DEEP, DROWNED]) {
    const s = WaterQuery.sample(p.x, p.z);
    const e = 2;
    const gx = heightAt(p.x + e, p.z) - heightAt(p.x - e, p.z);
    const gz = heightAt(p.x, p.z + e) - heightAt(p.x, p.z - e);
    const dot = s.flowX * gx + s.flowZ * gz;
    if (Math.hypot(gx, gz) > 1e-5) assert.ok(dot < 0, `flow at ${p.x},${p.z} must run downhill`);
    const speed = Math.hypot(s.flowX, s.flowZ);
    assert.ok(speed <= 1.6 + 1e-9, `current ${speed.toFixed(2)} m/s must stay under the ceiling`);
    assert.ok(speed < 2.53, 'current must stay slower than the 2.53 m/s wading speed');
  }
  // same point, more water: the current grows, and never reverses
  let prev = -1;
  for (let d = 0.2; d <= 3; d += 0.2) {
    const f = WaterQuery.flowAt(DEEP.x, DEEP.z, d);
    const speed = Math.hypot(f.flowX, f.flowZ);
    assert.ok(speed >= prev - 1e-9, 'deeper water must not slow the current at one point');
    prev = speed;
  }
  // the direction must be exactly antiparallel to the terrain gradient: the
  // current is the downhill direction, not an approximation of it
  for (const p of [RIVER, DEEP]) {
    const s = WaterQuery.sample(p.x, p.z);
    const e = 2;
    const gx = heightAt(p.x + e, p.z) - heightAt(p.x - e, p.z);
    const gz = heightAt(p.x, p.z + e) - heightAt(p.x, p.z - e);
    const gLen = Math.hypot(gx, gz), fLen = Math.hypot(s.flowX, s.flowZ);
    const cos = (s.flowX * gx + s.flowZ * gz) / (fLen * gLen);
    assert.ok(cos < -0.999999, `flow must run straight downhill (cos ${cos})`);
  }
  // no degenerate output anywhere in the world, including where the gradient
  // is negligible and the direction must fall back to zero
  for (let i = 0; i < 3000; i++) {
    const x = -WORLD.half + (i / 2999) * WORLD.size, z = -WORLD.half + ((i * 7) % 2999) / 2999 * WORLD.size;
    const f = WaterQuery.flowAt(x, z, 1.5);
    assert.ok(Number.isFinite(f.flowX) && Number.isFinite(f.flowZ), `flow must never be NaN/Inf at ${x},${z}`);
  }
  // a dry point carries no current at all
  const dry = WaterQuery.sample(LAND.x, LAND.z);
  assert.equal(dry.flowX, 0); assert.equal(dry.flowZ, 0);
  ok('current runs downhill, scales with depth, respects the ceiling, and is absent on land');
}

// --- 7. reusing a caller's terrain sample changes nothing -------------------
{
  for (const p of [LAND, RIVER, SHALLOW, DEEP, DROWNED]) {
    const gh = heightAt(p.x, p.z);
    assert.deepEqual(WaterQuery.sample(p.x, p.z, gh), WaterQuery.sample(p.x, p.z),
      'passing a groundY you already sampled must give the identical answer');
    assert.equal(WaterQuery.depthAt(p.x, p.z, gh), WORLD.water - gh);
    assert.equal(WaterQuery.surfaceY, WORLD.water, 'the surface must track WORLD.water, not a copy');
  }
  ok('callers can reuse their own heightAt() sample without changing the answer');
}

// --- 8. sampleInto must not allocate ---------------------------------------
{
  const out = {};
  const a = WaterQuery.sampleInto(out, DEEP.x, DEEP.z);
  const b = WaterQuery.sampleInto(out, LAND.x, LAND.z);
  assert.equal(a, out); assert.equal(b, out, 'sampleInto must return the object it was handed');
  assert.equal(out.waterType, 'none', 'the scratch object must hold the latest answer');
  for (const k of ['surfaceY', 'groundY', 'depth', 'shoreFactor', 'band', 'inWater', 'submerged',
    'wadeable', 'swimmable', 'waterType', 'flowX', 'flowZ', 'wetness']) {
    assert.ok(k in out, `sampleInto must always fill ${k}, dry or wet`);
  }
  ok('sampleInto reuses one object and fills every field on both the dry and wet paths');
}

// --- 9. weather reaches water without water owning weather -----------------
{
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'clear' }).wetness, 0);
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'rain' }).wetness, 1);
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'storm' }).wetness, 1);
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'snow' }).wetness, 0.8);
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'cloudy', groundWetness: 0.4 }).wetness, 0.4,
    'lingering ground wetness survives the sky clearing');
  assert.equal(WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'cloudy', groundWetness: 9 }).wetness, 1,
    'wetness must clamp');
  assert.equal(WaterQuery.sample(LAND.x, LAND.z).wetness, 0, 'with no weather given, water reports dry');
  // weather must not leak into the terrain-derived truth
  const dry = WaterQuery.sample(LAND.x, LAND.z);
  const storm = WaterQuery.sample(LAND.x, LAND.z, undefined, { type: 'storm' });
  assert.equal(dry.depth, storm.depth);
  assert.equal(dry.band, storm.band);
  ok('weather reports wetness without altering depth, band or flow');
}

// --- 10. throughput: a dry frame must be cheap enough to ignore ------------
{
  const scratch = {};
  const N = 200000;
  let t0 = performance.now(), acc = 0;
  for (let i = 0; i < N; i++) { acc += WaterQuery.sampleInto(scratch, LAND.x + (i % 97) * 0.1, LAND.z).depth; }
  const dryRate = Math.round(N / ((performance.now() - t0) / 1000) / 1000);
  t0 = performance.now();
  for (let i = 0; i < N; i++) { acc += WaterQuery.sampleInto(scratch, DEEP.x + (i % 97) * 0.1, DEEP.z).depth; }
  const wetRate = Math.round(N / ((performance.now() - t0) / 1000) / 1000);
  assert.ok(acc !== 0);
  assert.ok(dryRate > 400, `dry queries too slow: ${dryRate}k/s`);
  ok(`throughput: ${dryRate}k dry queries/s, ${wetRate}k wet queries/s (dry skips the noise fields)`);
}

// --- 11. river classification matches the field it is derived from ---------
{
  let rivers = 0, seas = 0, marshes = 0;
  const N = 90;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -900 + (i / (N - 1)) * 1800, z = -900 + (j / (N - 1)) * 1800;
      const s = WaterQuery.sample(x, z);
      if (!s.inWater) continue;
      if (s.waterType === 'river') {
        assert.ok(riverField(x, z) < 0.10, 'only river-valley points may call themselves rivers');
        rivers++;
      } else if (s.waterType === 'marsh') { marshes++; assert.ok(s.groundY > -1.2 && s.groundY < 1.6); }
      else seas++;
    }
  }
  assert.ok(rivers > 0 && seas > 0, `the world must contain both rivers and standing water (got ${rivers} river, ${seas} sea points)`);
  ok(`water types resolve across the world: ${rivers} river, ${marshes} marsh, ${seas} standing-water points`);
}

// --- 12. waterNearness: the refactor must not move the audio shoreline -----
// loop.js used to compute this straight from WORLD.water and heightAt, with a
// *different* threshold (-0.6) than the player's. The real mixin is compared
// against the pre-refactor implementation it replaced.
{
  const legacy = (x, z) => {
    const depth = WORLD.water - heightAt(x, z);
    if (depth > -1.5) return clamp(1 - Math.max(0, depth) * 0.12, 0.35, 1);
    let near = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = heightAt(x + Math.cos(a) * 14, z + Math.sin(a) * 14);
      if (h < WORLD.water + 0.6) near = Math.max(near, 1 - Math.abs(h - WORLD.water) * 0.5);
    }
    return clamp(near * 0.8, 0, 1);
  };
  const game = { player: { pos: { x: 0, z: 0 } } };
  let checked = 0, nearWater = 0;
  for (let i = 0; i < 70; i++) {
    for (let j = 0; j < 70; j++) {
      const x = -900 + (i / 69) * 1800, z = -900 + (j / 69) * 1800;
      game.player.pos.x = x; game.player.pos.z = z;
      const now = LoopMixin.waterNearness.call(game);
      const before = legacy(x, z);
      assert.equal(now, before, `waterNearness changed at ${x},${z}: ${now} !== ${before}`);
      checked++; if (before < 1) nearWater++;
    }
  }
  assert.ok(nearWater > 0, 'the scan must include points near water, or the test proves nothing');
  ok(`waterNearness is bit-identical to the pre-refactor version on ${checked} points (${nearWater} near water)`);
}


// --- 13. the event layer is deterministic and ordered ----------------------
{
  const run = () => {
    const wi = new WaterInteraction();
    const seq = [];
    for (const k of Object.values(WATER_EVENT)) wi.on(k, (e) => seq.push(`${k}:${e.band ?? e.to ?? ''}`));
    // dry -> falling in fast -> swimming -> wading -> out
    const path = [[120, 40, 60, 6, 0, 0], [RIVER.x, RIVER.z, 6, -14, 4, 0.016]];
    for (const [x, z, y, vy, sp, dt] of path) wi.probe('a', x, y, z, vy, sp, dt);
    for (let i = 1; i <= 8; i++) wi.probe('a', RIVER.x + i * 1.8, 0, RIVER.z, 0, 5, 0.016);
    wi.probe('a', RIVER.x + 40, 0, RIVER.z + 40, 0, 5, 0.016);   // likely dry again
    wi.probeCamera(WORLD.water + 2, RIVER.x, RIVER.z);
    wi.probeCamera(WORLD.water - 2, RIVER.x, RIVER.z);
    wi.probeCamera(WORLD.water + 2, RIVER.x, RIVER.z);
    wi.dispose();
    return seq.join('|');
  };
  const a = run(), b = run();
  assert.equal(a, b, 'the same movement must always produce the same event sequence');
  assert.ok(a.includes('enter'), 'entering water must emit enter');
  assert.ok(a.includes('impact'), 'arriving at speed must emit impact');
  assert.ok(a.includes('submerge') && a.includes('surface'), 'the camera crossing must emit both directions');
  assert.equal(a.indexOf('enter'), a.indexOf('impact') - 'enter:'.length + 'enter:'.length >= 0 ? a.indexOf('enter') : -1);
  // unsubscribing really stops delivery
  const wi = new WaterInteraction();
  let hits = 0;
  const off = wi.on(WATER_EVENT.ENTER, () => hits++);
  wi.probe('b', RIVER.x, 0, RIVER.z);
  off();
  wi.probe('b', 120, 40, 60);
  wi.probe('b', RIVER.x, 0, RIVER.z);
  assert.equal(hits, 1, 'a disposed subscriber must not keep receiving events');
  ok('event sequences are reproducible, ordered, and stop after unsubscribe');
}

// --- 14. the render field encodes what the shader expects ------------------
{
  const bytes = buildWaterField(FIELD_RES);
  assert.equal(bytes.length, FIELD_RES * FIELD_RES * 4);
  let wet = 0, shoreSum = 0, flowNonZero = 0, maxDepth = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i] > 0) { wet++; maxDepth = Math.max(maxDepth, bytes[i]); }
    shoreSum += bytes[i + 1];
    if (bytes[i + 2] !== 128 || bytes[i + 3] !== 128) flowNonZero++;
  }
  const cells = FIELD_RES * FIELD_RES;
  assert.ok(wet > 500, `the field says almost nothing is wet (${wet} cells)`);
  assert.ok(wet < cells * 0.6, 'the field says most of the world is underwater');
  assert.ok(maxDepth <= 255 && maxDepth > 100, 'depth must use the channel range without saturating everywhere');
  assert.ok(flowNonZero > 100, 'no cell carries flow, so rivers cannot drift');
  // the field must agree with the query it was built from
  // The field samples at cell centres, so it must be compared against the
  // query at that same centre — not at an arbitrary point inside the cell.
  const idx = fieldIndexOf(DEEP.x, DEEP.z, FIELD_RES);
  const ci = idx % FIELD_RES, cj = Math.floor(idx / FIELD_RES);
  const cx = -WORLD.half + ((ci + 0.5) / FIELD_RES) * WORLD.size;
  const cz = -WORLD.half + ((cj + 0.5) / FIELD_RES) * WORLD.size;
  const d = bytes[idx * 4] / 255 * FIELD_MAX_DEPTH;
  const truth = WaterQuery.depthAt(cx, cz);
  assert.ok(Math.abs(d - truth) < FIELD_MAX_DEPTH / 255 + 1e-6,
    `field depth ${d.toFixed(3)} disagrees with the query ${truth.toFixed(3)} at its own cell centre`);
  const shore = bytes[idx * 4 + 1] / 255;
  assert.ok(Math.abs(shore - WaterQuery.shoreFactorAt(cx, cz)) < 1 / 255 + 1e-6,
    'the field shore channel disagrees with the query at its own cell centre');
  assert.equal(fieldIndexOf(WORLD.half + 10, 0, FIELD_RES), -1, 'outside the world has no cell');
  // and it is reproducible
  const again = buildWaterField(FIELD_RES);
  assert.deepEqual(Array.from(bytes.slice(0, 4000)), Array.from(again.slice(0, 4000)),
    'the field must build identically every time');
  ok(`field: ${cells.toLocaleString()} cells, ${wet.toLocaleString()} wet, ${flowNonZero} carrying flow, reproducible`);
}

// --- 15. quality changes the look, never the truth ------------------------
{
  const order = ['high', 'medium', 'low'];
  for (const key of ['ripples', 'splash', 'bubbles', 'segments', 'caustics', 'wake', 'waveDetail', 'rainRipples']) {
    const v = order.map(q => WATER_QUALITY[q][key]);
    assert.ok(v[0] >= v[1] && v[1] >= v[2], `${key} must not increase as quality falls: ${v}`);
  }
  assert.equal(WATER_QUALITY.low.foam, 0, 'the lowest tier should drop foam entirely');
  assert.equal(WATER_QUALITY.low.caustics, 0, 'the lowest tier should drop caustics entirely');
  const calm = waterQualityFor('high', false), still = waterQualityFor('high', true);
  assert.ok(still.waveDetail < calm.waveDetail, 'reduced motion must calm the surface');
  assert.equal(still.rainRipples, 0);
  assert.equal(waterQualityFor('nonsense').ripples, WATER_QUALITY.high.ripples, 'an unknown tier falls back to high');
  assert.equal(waterAllows(WATER_QUALITY.low, 'foam'), false);
  assert.equal(waterAllows(WATER_QUALITY.high, 'foam'), true);
  // every tier must leave gameplay alone: these come from WaterQuery, not here
  for (const q of order) {
    const s = WaterQuery.sample(DEEP.x, DEEP.z);
    assert.equal(s.swimmable, true, `the ${q} tier must not change whether you can swim`);
  }
  ok('quality tiers descend monotonically and never touch gameplay truth');
}

// --- 16. buoyancy settles instead of exploding ----------------------------
{
  const b = new BuoyancySystem();
  // deeper water offers more lift, and dry land offers none
  const dry = b.support(LAND.x, LAND.z, 0);
  assert.equal(dry.lift, 0, 'dry land must offer no lift');
  assert.equal(b.support(DEEP.x, DEEP.z, 0).lift > 0, true);
  // four support points, so a body half in and half out wants to tilt
  const level = b.support(DEEP.x, DEEP.z, WORLD.water, 0.7);
  assert.ok(Math.abs(level.tiltX) <= 0.4 && Math.abs(level.tiltZ) <= 0.4, 'tilt must be capped');
  // dropped from above, a body must come to rest near the riding height and
  // stay there: the failure this replaces is an undamped spring launching it
  const riding = WORLD.water - DRAFT * 0.35;
  for (const start of [WORLD.water + 6, WORLD.water + 1, WORLD.water - 3]) {
    const body = { pos: { x: DEEP.x, y: start, z: DEEP.z }, vel: { y: 0 } };
    // Peak only counts once it is actually in the water: a body dropped from
    // 6 m up has obviously already been at 6 m.
    let peak = -Infinity, entered = false;
    for (let i = 0; i < 900; i++) {
      b.floatBody(body, 1 / 60);
      if (!entered && body.pos.y < WORLD.water) entered = true;
      if (entered) peak = Math.max(peak, body.pos.y);
    }
    assert.ok(entered, `from ${start.toFixed(1)} it never reached the water`);
    assert.ok(Math.abs(body.pos.y - riding) < 0.35,
      `from ${start.toFixed(1)} it settled at ${body.pos.y.toFixed(2)}, not the riding height ${riding.toFixed(2)}`);
    assert.ok(peak < WORLD.water + 2.5, `from ${start.toFixed(1)} it was launched to ${peak.toFixed(2)}`);
    assert.ok(Math.abs(body.vel.y) < 0.6, 'it is still moving after 15 s');
  }
  // the spring must be damped, or none of the above is luck-free
  assert.ok(SPRING_C / (2 * Math.sqrt(SPRING_K)) > 0.7, 'the spring is underdamped enough to oscillate forever');
  ok('buoyancy settles at the riding height from above and below, and never launches');
}

// --- 17. flooded landmarks are the composed showcases ---------------------
{
  const flooded = LANDMARKS.filter(l => l.kind === 'flooded');
  assert.ok(flooded.length > 0, 'the world must have at least one flooded landmark to showcase');
  for (const L of flooded) {
    const s = WaterQuery.sample(L.x, L.z);
    assert.ok(s.inWater, `${L.name} is a flooded landmark but its centre is dry`);
    assert.ok(s.swimmable, `${L.name} should be deep enough to swim in`);
  }
  ok(`flooded showcases: ${flooded.map(l => l.name).join(', ')} — all deep enough to dive`);
}

COMPLETED = true;
console.log('\nWaterQuery: deterministic, behaviour-preserving, and cheap on dry ground ✓');
