# Performance follow-up — 2026-09-28

This report records measured changes, reference workloads and limits for the
performance pass. Timings are CPU-side Node.js measurements in this sandbox,
not browser frame-rate or GPU measurements. The paired probes live in
[`fire-perf-probe.mjs`](fire-perf-probe.mjs) and
[`recovery-perf-probe.mjs`](recovery-perf-probe.mjs); run them with
`npm run perf` or directly with `--assert`.

## Scorecard

The before columns use the pre-optimization algorithms as reference functions
in the paired probes. Each old/new pair ran in the same process with the same
fixture; the order alternates between rounds. Fire results below are the median
of four independent probe runs, each with 600 timed frames per path and
workload. Recovery results are the median of four independent probe runs, each
with 40 timed due ticks per path. For each run, the probe computes median and
p95; the table reports the median of those four per-run statistics.

| Workload | Reference median / p95 | Optimized median / p95 | Other measured evidence |
|---|---:|---:|---|
| 163 nearby burning cells | 0.018 / 0.078 ms | 0.010 / 0.023 ms | Hot-path sort calls 8 → 0; candidate pushes 1,304 → 0 per 8 instrumented frames |
| 2,000 map-wide burning cells | 0.058 / 0.134 ms | 0.016 / 0.023 ms | Hot-path sort calls 8 → 0; candidate pushes 440 → 0 per 8 instrumented frames |
| Due recovery tick with no ground-byte changes | 23.08 / 25.53 ms | 0.08 / 0.14 ms | Ground dirty/stamp: true/1 → false/0 when no bytes change |

These timings are rounded to the precision available from `performance.now()`
in the sandbox. The especially small optimized values vary between runs; use
the operation counts and equivalence assertions as the stronger evidence, not a
precise speedup multiplier. The recovery reference exceeded a 16.7 ms 60 Hz
frame budget in this Node microbenchmark, while the optimized no-op tick was
well below it. That comparison is not a claim about a real browser frame.

### Current diagnostics (not all are before/after claims)

A full `npm run perf` snapshot also reported:

- One idle FX snapshot: **0.007 ms median / 0.008 ms p95** over the median of
  five rounds × 900 frames; **0** smoke and spark position-buffer version bumps
  and **0** `THREE.Color.clone()` calls across 4,500 frames. The assertions also
  exercise live particle updates, expiration, and a return to upload-free idle.
  Historical before/after measurements for this probe are recorded in
  [`VERIFICATION.md`](VERIFICATION.md); the current result alone is not an
  independent before/after comparison.
- Standard scene: **92 meshes / 80,112 triangles**, within the guard of 96
  meshes / 99,915 triangles.
- One terrain-probe snapshot: 49 initial chunks built in **50 ms**; twelve row-crossing
  updates ranged **6–23 ms**; `heightAt` throughput was **1.782 million calls/s**.
  These are a current diagnostic snapshot, not a paired terrain optimization
  result. The row-crossing samples are worth profiling on actual devices.

Adaptive-quality tests are behavioral rather than throughput measurements: a
sustained 60 ms sample window steps high → medium, 80 ms steps medium → low,
medium tolerates 60 ms, invalid samples are ignored, and one 10-second
background-tab gap does not trigger a downgrade. The actual frame-loop test
confirms simulation and effects retain their 50 ms delta cap. This does not
measure the resulting FPS or prove a particular graphics setting is best for a
device.

## What changed and why

### Nearby-fire selection

The prior visual updater filtered and allocated a candidate object for every
burning cell within 220 m, computed square-root distances, sorted the full
nearby list, and then rendered at most 16 flames. It now keeps the nearest 16
in reusable fixed slots, ranks by squared distance and does no per-frame sort or
candidate-list push. The paired probe checks that visible flame positions,
count and firelight match the reference path, including sparse and out-of-range
fixtures. The measured workloads cover both a locally dense fire and 2,000
active cells spread across the actual fire grid.

### Recovery and fuel regrowth

`WorldState.update()` calls `tickRecovery()` each simulation update, but recovery
only becomes due after four accumulated simulation seconds. At the default
`timeScale = 1`, that is nominally once per 240 frames at 60 Hz (or once per 80
frames when each loop delta reaches its 50 ms cap), not every rendered frame.
The previous due path recomputed `treeDensityAt()` at all 9,216 fire cells,
scanned the full 1 MiB ground buffer even when recovery increments were still
fractional, and always marked the ground dirty/incremented its cache stamp.

The implementation now stores the immutable base tree-density sample for each
fire cell in a derived `Float64Array` (9,216 entries, 73,728 bytes), uses that
sample with the live region tree multiplier, skips the ground-buffer scan when
all three ground-recovery increments are fractional, and changes dirty/stamp
state only when at least one ground byte changes. The cache is rebuilt from
terrain during world construction; it is not part of the save format. Region
mapping is tested against the reference fuel output over the complete fuel
array, with varied region tree multipliers.

The paired no-op workload sets a due four-second tick, starts with a zeroed
ground map and zero recovery fractions, and therefore makes no ground or fuel
byte changes. It demonstrates the exact old hotspot and tests the new dirty
suppression. A separate wet, nonzero fixture compares every ground and fuel
byte plus recovery fractions and vegetation-regrowth state against the original
algorithm. Threshold tests prove that fractional ticks remain upload-free and
the first real lushness change dirties the ground and advances its stamp.

The probe also confirms the unchanged nominal cadence from source inspection;
it does not record a live browser's wall-clock interval. `fastForward()` calls
world updates in larger steps, so recovery is due more often per call there;
whole-load/fast-forward wall time has not been separately benchmarked.

## Method and environment

- Node **v22.22.3**, Linux x64, Intel Xeon Processor @ 2.60 GHz, two available
  vCPUs in the sandbox. Measurements were collected on 2026-09-28.
- Timed loops use `performance.now()`. Reference and optimized paths are
  interleaved and receive the same deterministic state/fixture; recovery setup
  and resets are outside the timed section. Probes include output-equivalence
  and mutation/invalidation assertions, not timing thresholds.
- The recovery baseline is a retained test-only copy of the original method;
  this is a same-process algorithm comparison, not two separate browser builds.
  The fire reference likewise preserves the old full filter/sort selection.
- `npm run perf` gates functional invariants and the scene mesh/triangle budget,
  but the observed millisecond values are diagnostic and are not hard-coded as
  pass/fail limits.

## Verification and remaining uncertainty

Final independent delivery verification on 2026-09-28 completed successfully:
`npm run check`, `npm run visual`, and `npm run perf` all exited 0. The smoke
suite's malformed-save and quota fixtures intentionally emit error-looking
console diagnostics; the suite ended with `SMOKE TEST PASSED` and no test errors.
Visual QA rasterised the minimap, big map, save thumbnail, charts and three Long
Record views; the resulting images were inspected and showed no obvious
regression. The full console output is available from the commands above.

No physical GPU or audio device is available here. The browser's WebGL draw
path, actual texture-transfer cost, device frame pacing, mobile performance and
audible output remain unverified. Sandbox timing is sensitive to scheduling and
is not a device guarantee. The terrain snapshot still includes individual row
crossings above one 16.7 ms frame budget; it is an observed follow-up candidate,
not a proven regression or an optimized result. A browser/device profile with
GPU timings and a representative loaded-world route is still needed before
making user-visible FPS claims.
