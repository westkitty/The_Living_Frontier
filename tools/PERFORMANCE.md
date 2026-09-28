# Performance follow-up — 2026-09-28

This report records measured changes, reference workloads and limits for the
performance pass. Timings are CPU-side Node.js measurements in this sandbox,
not browser frame-rate or GPU measurements. The paired probes live in
[`fire-perf-probe.mjs`](fire-perf-probe.mjs),
[`recovery-perf-probe.mjs`](recovery-perf-probe.mjs) and
[`hud-perf-probe.mjs`](hud-perf-probe.mjs); run them with `npm run perf` or
directly with `--assert`. A second, later pass on the same day is recorded under
[Uplift pass](#uplift-pass--chunk-cache-fire-extraction-hud).

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

## Uplift pass — chunk cache, fire extraction, HUD

A second pass on 2026-09-28 targeted the three costs a profile actually showed:
terrain chunk rebuilds while walking, the fire tick, and the per-frame HUD. Every
number below is a CPU-side Node measurement in this sandbox.

### Chunk geometry cache (`src/chunk-cache.js`)

A chunk mesh is a pure function of `(i, j, segments)` — the noise fields are
seeded and immutable, and everything that changes (burn, trail, lushness,
development) is sampled from the ground-memory texture in the shader rather than
baked into vertices. Retired chunk geometry is therefore reusable, so it is kept
in a budget-bounded LRU (8 MB default) instead of being rebuilt on re-entry.

| Measurement | Before | After |
|---|---:|---:|
| Repeat row-crossing updates, three samples (`perf-probe.mjs`) | 31 / 27 / 27 ms | 12 / 6 / 6 ms |
| Frame-pacing p99 during a walking sprint | 1.79 ms | 0.54 ms |
| Cache after a 3,000-frame sprint | — | 72 entries, 1.35 MB of the 8 MB budget |

A warm rebuild was compared byte-for-byte against a cold build for the same
chunk, and budget eviction was confirmed to dispose what it drops.

### Fire and grid extraction (`src/grid.js`, `src/fire.js`)

The fire model and the grid arithmetic moved out of `worldstate.js` (642 → 590
lines) so the tick could be rewritten without touching the rest of the
simulation. The tick now keeps an explicit live-cell list with in-place reused
entries and a maintained burn counter, instead of rescanning the whole 96×96 fuel
grid and rebuilding arrays each tick.

| Workload | Before | After |
|---|---:|---:|
| Idle fire tick, mean over 2,000 ticks | 0.054 ms | 0.000 ms (270× less total) |
| 80 cells alight, mean | 0.334 ms | 0.114 ms (2.9×) |
| 162 cells alight, mean / p95 | 0.449 / 1.047 ms | 0.118 / 0.231 ms (3.8× / 4.5×) |
| `new WorldState()` | 51.0 ms | 39.7 ms (−22%) |

The construction gain came from the fuel map, which was 45.3 ms of the original
53.9 ms (89%). One regression found and fixed during the work: an early-out in
`treeDensityAt` skipped `slopeAt` when the height was out of range, and the first
rewrite computed it unconditionally — four extra `heightAt` calls per
out-of-range cell.

Equivalence was established against a retained copy of the pre-refactor module
over ten scenarios — construction, `paintGround` across 864 radius/point/channel
combinations, `fireConditions` across 10 weather states, 40 idle ticks, a tinder
fire (peak 239 cells), rain extinction, a 64-cell fire (peak 121, 44 remaining),
300 variable-`dt` ticks, `ignite` bookkeeping, and the burn counter checked
against a brute-force live-cell scan over 600 real `update()` ticks. All ten were
byte-for-byte identical. That harness was a one-off and is not retained; the
durable guards are the smoke suite's absolute anchors (`damp 1 cells, tinder 163
cells`, unchanged by this work) and its burn-scar parity check (704 → 704).

### Heads-up display (`src/hud.js`)

The HUD tick moved out of `ui.js` (611 → 434 lines; `hud.js` 256) and now
resolves each element once, caches the compass width until a resize, and writes a
property only when the value differs. `hud-perf-probe.mjs` drives it and a
verbatim copy of the pre-extraction code through the same 600 frames on a stub
document:

| Per frame | Standing still |  | Moving + turning |  |
|---|---:|---:|---:|---:|
|  | before | after | before | after |
| Element lookups | 11.06 | 0.04 | 13.55 | 0.04 |
| Layout reads (`clientWidth`) | 2.00 | 0.00 | 2.00 | 0.00 |
| Writes that changed something | 0.1 | 0.1 | 5.7 | 5.7 |
| Writes that changed nothing | 8.9 | 0.0 | 6.2 | 0.0 |
| Tick cost, ms (diagnostic) | 0.009–0.020 | 0.007–0.012 | 0.011–0.015 | 0.011–0.015 |

The four operation rows are exact and repeat identically on every run. The
timing row is not: a tick costs on the order of ten microseconds, and at that
scale a shared two-vCPU sandbox reorders the two columns between runs — the
moving workload has measured marginally faster before than after. The probe
therefore prints milliseconds as a diagnostic and asserts only the counts, which
is the same convention the fire and recovery probes follow.

The residual 0.04 lookups are the 22 first-frame resolutions amortised over 600
frames. The row that matters is the third: the number of writes that actually change
something is identical before and after, so nothing visible was dropped. Under
`--assert` the probe requires exactly that, plus byte-identical DOM state (text,
attributes, inline styles, datasets, class lists and child nodes) for both
workloads across three alternating rounds.

What this probe does *not* measure is the browser-side price of those operations.
It counts them on a stub; the claim that removing 6.2 redundant writes and 2
forced layouts per frame helps on a device is inferred from how browsers handle
style recalculation and synchronous layout, not measured here.

### Small hot-path fixes

- `loop.js`: `nearestFireDist` compares squared distances and takes one square
  root at the end instead of one per burning cell.
- `streaming.js`: a banner computed `heightAt` twice for the same point and then
  overwrote `y` with the same value — a defect, not just waste.
- `entities.js`: `nearestInteractable` makes a single pass and reuses its result
  object; the predator carcass search is a linear minimum scan instead of
  `filter` + `sort`.
- `ui.js`/`hud.js`: `questHash()` joins every quest into a string and was called
  twice per frame — once to compare, once to store.

### Considered and rejected

Bundling or code-splitting `src/` (the import map is the delivery mechanism and
39.5 ms of module evaluation is not the dominant cost); terrain generation in a
Web Worker (a rewrite of the streaming path for a one-off 32 ms); reducing chunk
radius or LOD (changes what the player sees); throttling audio ambience
(inaudible gains, real UX risk); shipping a minified Three.js (breaks the
vendored-file convention and source-level debugging); a spatial bucket index for
burning cells (the live-cell list already made the scan linear in what is
burning); numeric packing for `settlementHash` (injectivity assumptions for
~0.01 ms per frame); and removing spreads in `entities.js` (iteration-semantics
risk on small arrays).

### Where the remaining startup time goes

Measured, not yet optimized: `new WorldState()` 53.9 ms (of which the fuel map is
45.3 ms), the initial 49-chunk stream 32.0 ms, `buildLandmarks` 39.7 ms,
settlements 2.4 ms, module import 39.5 ms — roughly 200 ms of blocking work
before the first frame. Landmark building and the fuel map are the two largest
single items and the obvious next candidates.

The architecture ratchet tightened with this work: the recorded worst module went
from `ui.js` at 608 lines to `worldstate.js` at 590, and the ceilings for
`entities.js`, `fx.js`, `streaming.js` and `worldstate.js` were lowered to their
new actual sizes.

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

The uplift pass was re-verified the same way after it landed: `npm run check`,
`npm run visual` and `npm run perf` each exited 0, the smoke suite still reports
`damp 1 cells, tinder 163 cells` and 704 → 704 burn scars, and
`hud-perf-probe.mjs --assert` passed its DOM-state equality assertion for both
workloads. Its limits are the ones already listed, plus one of its own: the HUD
probe runs against a stub document, so it measures how many DOM operations the
code performs and not what a browser charges for them.

No physical GPU or audio device is available here. The browser's WebGL draw
path, actual texture-transfer cost, device frame pacing, mobile performance and
audible output remain unverified. Sandbox timing is sensitive to scheduling and
is not a device guarantee. The terrain snapshot still includes individual row
crossings above one 16.7 ms frame budget; it is an observed follow-up candidate,
not a proven regression or an optimized result. A browser/device profile with
GPU timings and a representative loaded-world route is still needed before
making user-visible FPS claims.
