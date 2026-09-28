# Performance pass — 2026-09-28

## Scope and measurement limits

The project is a static, offline-first, procedural Three.js wilderness game. Its
world, simulation, controls, persistence format, geometry budget and existing
adaptive quality behavior are protected. There are no downloaded game assets,
external API requests, bundler, browser GPU, or audio device in this sandbox.
The renderer seam and shader parser can validate behavior and GLSL, but cannot
supply real-device FPS, GPU time, battery, browser heap or audible/pixel QA.

Evidence labels: **MEASURED** = repeatable fixture/benchmark output in this
checkout; **OBSERVED** = source, budgets or automated behavior; **INFERRED** =
expected real-device consequence, not measured end-to-end; **UNKNOWN** = not
available here. Performance probes use the same deterministic workload for old
and new paths. Wall-clock microbenchmarks are directional; operation counts and
buffer versions are the stronger evidence.

## Before scorecard

Scores are evidence-anchored readiness scores, not device FPS. 0 means broken;
5 means constrained or materially unverified; 10 means strong measured headroom.
A score does not rise for code cleanup alone.

| Category | Before | Evidence / confidence |
|---|---:|---|
| Startup: first usable world | 6/10 | **MEASURED:** the old boot built the full 49-chunk scene synchronously; the exact startup-shaped fixture's median task was 18.1 ms. Full click-to-play browser timing is **UNKNOWN**. |
| Runtime / CPU responsiveness | 6/10 | **OBSERVED:** terrain sampling and ambient updates ran on the frame path; no actual browser frame-time trace. |
| Adaptive quality response | 0/10 | **OBSERVED / proven by bounds:** the 50 ms simulation clamp made 55/70 ms monitoring thresholds unreachable. |
| Main-thread task consistency | 6/10 | **MEASURED:** the 49-chunk boot work was one continuous task; per-frame precipitation rewrote 2,200 positions in rain/snow. |
| CPU hot-loop efficiency | 5/10 | **MEASURED:** matched old-path fixtures: ambient inputs 6,000/6,000 frames; rain loop 55.59 ms median for 6,000 frames in the final matched probe. |
| Memory / heap efficiency | N/M | No browser heap/GPU-memory tooling. Several collections are bounded in source, but no heap snapshot or long-session growth measurement. |
| Long-session stability | 7/10 | **OBSERVED:** bounded chunk streaming, particle pools, carcasses and histories; smoke tests cover disposal/save/reload. Heap trend is **UNKNOWN**. |
| Rendering / draw-call efficiency | 8/10 | **MEASURED:** 92 scene meshes/draw calls and 80,112 triangles, within the existing 96-mesh/99,915-triangle canopy budget. GPU frame time is **UNKNOWN**. |
| Geometry efficiency | 8/10 | Same measured geometry counts; vegetation is instanced/merged and terrain streamed. |
| Shader / texture / pixel-fill efficiency | N/M | No GPU profiler; texture residency, fill rate and shader occupancy cannot be measured here. |
| Audio/terrain sampling schedule | 5/10 | **OBSERVED:** expensive water-nearness terrain reads, fire-distance scan and settlement reads were calculated every rendered frame, though WebAudio eases targets over 0.5–1.2 s. |
| Asset/network efficiency | 9/10 | **OBSERVED:** procedural content, no remote assets/APIs. Browser request count, compression and cache headers are **UNKNOWN**. |
| Mobile/low-end/battery behavior | N/M | Touch paths and adaptive quality exist, but no physical device, thermal, battery or mobile GPU test. |
| Scalability | 7/10 | **OBSERVED:** chunks stream; active animals are capped at 16 and carcasses at 48. Dense-fire and long-session device performance remain unmeasured. |

## Profile findings and ranked work

No **A — critical** end-to-end bottleneck can be claimed without a browser/GPU
trace. The strongest evidenced opportunities are below; each is ranked on user
impact × frequency × confidence against implementation cost and regression risk.

| Rank | Root cause and journey | Evidence / confidence | Payoff / cost / risk |
|---|---|---|---|
| **B — high value** | Rain and snow updated all 2,200 particle positions in JavaScript and dirtied the complete position buffer every visible precipitation frame. Affects storms and snow, most relevant on CPU- and upload-sensitive devices. | **MEASURED:** 55.59 ms over 6,000 frames in the matched legacy path; 6,000 full-buffer dirty marks. A 2,200 × 3 Float32 position buffer is 26,400 bytes, or 158.4 MB of nominal repeated position uploads per 100 s at 60 Hz. Actual bus/GPU transfer is **INFERRED**, not observed. | High during weather; one point shader and immutable velocity attribute; low-to-medium visual risk, mitigated by shader parsing and behavior checks. |
| **B — high value** | Ambient audio target inputs sampled terrain, all burning cells and settlements on every frame even though output is smoothed. | **MEASURED:** matched 6,000-frame fixture with 512 burning cells; same water signal and target values. | High ratio in the affected path; small isolated runtime slice; low risk because only target-sample cadence changes. |
| **B — high value, tradeoff documented** | Boot pre-streamed all 49 chunks in one uninterrupted sequence before reveal; future normal frame streaming already builds only two chunks at a time. | **MEASURED:** exact 49-chunk fixture, old synchronous task versus staged batch maximum and first-reveal wall time. | Reduces longest task; modestly delays first reveal while yielding. Near field remains complete; the existing streamer finishes the same distant ring. Low architectural risk. |
| **B — high value** | Adaptive quality measured `dtRaw` after a 50 ms cap, then compared it with 55 ms and 70 ms thresholds. The fallback could never trigger on a slow device. | **OBSERVED / proven by bounds:** `min(frameDelta, 0.05)` cannot exceed either threshold; a focused test now exercises sustained 80 ms render frames while the simulation step stays capped. | Restores the already-designed downgrade without changing normal quality/settings. Low risk; actual browser frame recovery remains unmeasured. |
| **C — opportunistic** | Keep these operation-count and buffer-upload probes in `npm run perf`. | **MEASURED:** deterministic fixtures and assertions. | Low maintenance cost; protects actual wins against silent reintroduction. |

### Rejected for this pass

- **Lower draw distance, reduce animals, or lower visual quality globally:** no
  evidence that the GPU is the limiter, and this would trade away wilderness
  scale/ecology. Existing adaptive quality remains untouched.
- **Workers or a simulation rewrite:** world generation/state have tight
  deterministic and renderer interactions; no profile shows them as the top
  bottleneck. Complexity and correctness risk exceed demonstrated gain.
- **Pool all actor arrays or replace AI searches:** active populations are
  already capped; no matched actor-profile result justifies changing behavior.
- **Texture compression, asset prefetch, code splitting or a new build system:**
  the experience ships procedural assets offline with no asset waterfall. A new
  pipeline would add weight without evidence of a loading win.
- **More aggressive ambient throttling:** 8.3 Hz already matches the slow
  WebAudio smoothing; slower sampling risks audible lag with little extra value.

## Changes implemented

1. `src/fx-rain.js` keeps rain/snow base positions and per-point velocities
   static. Fall, wind drift and wrap are applied in the existing PointsMaterial
   vertex shader via uniforms. Clear weather freezes/hides the same system; snow
   retains its slower fall and stronger wind drift. The only recurring CPU work
   is a few uniform/object updates, not a 6,600-float loop and buffer upload.
2. `src/ambient.js` samples audio world inputs every 0.12 seconds (8.3 Hz at 60
   Hz) and skips all world sampling if sound is disabled, muted or at zero volume.
   WebAudio interpolation, parameter meanings, weather/fire/water/hearth inputs
   and sound beds are unchanged.
3. `src/startup.js` reveals after the central 5×5 near-field is built in
   four-chunk yielding batches. The ordinary two-chunk-per-frame streamer
   completes the remaining fog-distant chunks. The 49-chunk scene and 25
   vegetation chunks still finish; no quality or gameplay capability was cut.
4. `src/frame-budget.js` now records elapsed render time before the separate
   50 ms simulation safety cap; the original 55/70 ms adaptive downgrade thresholds
   can therefore be reached after sustained slow frames. Long background-resume
   deltas are capped at 250 ms in the monitor so one pause cannot dominate a window.
5. `npm run perf` now runs repeatable ambient, rain and startup probes. Shader
   validation parses the actual injected rain PointsMaterial shader. The module
   architecture/size gates include the new focused modules.

## Same-scenario before/after

Values below are from the final `npm run perf` invocation in this sandbox. The
ambient and rain probes run five identical 6,000-frame rounds and report median
wall time for one round. Baseline and production algorithms execute against the
same static fixture in the same process; these are subsystem timings, not whole-
game frame timings.

| Scenario | Before | Final | Delta / proof |
|---|---:|---:|---|
| Ambient inputs, 6,000 × 60 Hz frames, 512 burning cells | 6,000 samples; 100.50 ms | 833 samples; 12.88 ms | **86.1% fewer samples; 87.2% lower measured slice time.** All six audio targets match exactly; muted case does zero sampling. |
| Storm particle update, 2,200 points, 6,000 frames | 55.59 ms; 6,000 position-buffer dirty marks | 1.23 ms; 0 position-buffer dirty marks | **97.8% lower measured rain-update time.** 158.4 MB nominal repeated position uploads avoided per 100 simulated seconds; zero live geometry changes. GPU bus traffic itself is not instrumented. |
| Near-field startup batch (same real 49 terrain chunks) | One 18.1 ms synchronous task before reveal | Largest four/two-chunk task 6.4 ms; 25 chunks ready before reveal | **64.6% smaller maximum measured batch.** Interactive reveal wall time was 27.3 ms vs 18.1 ms for the old chunk-only path, including event-loop yields; this is a 9.2 ms startup-latency regression traded for shorter main-thread tasks. Remaining chunks complete during normal streaming. |
| Adaptive-quality trigger, sustained 80 ms render delta | Average input capped at 50 ms; thresholds 55/70 ms could never be crossed | Full elapsed render delta sampled (250 ms ceiling); high→medium and medium→low transitions now reachable | Focused test verifies the exact window, thresholds, healthy no-downgrade case and independent 50 ms simulation cap. Real-device frame recovery remains unknown. |
| Final scene budget | 92 meshes; 80,112 triangles | 92 meshes; 80,112 triangles | No geometry, draw-call or fidelity reduction. Existing budget passes. |
| Idle visual FX invariants | 0 idle particle-buffer uploads / 0 sky-color clones | 0 / 0 | No idle-effect quality change; existing upload/clone assertions still pass. The sub-0.02 ms per-call timings vary too much to score. |

A separate chunk probe in this run measured 45 ms to build all 49 chunks in one
unbudgeted call and 22/17/11/9/7/22/8/8/7/7/7/18 ms for row crossings. Those
are **not** startup numbers and should not be compared to the startup fixture's
four-chunk task. The variation reinforces that timings depend on workload and
runtime; no hardware-independent frame-rate claim is made.

## Final scorecard

| Category | Before | Final | Evidence / remaining limit |
|---|---:|---:|---|
| Startup / first usable world | 6/10 | 6/10 | Nearby 25 chunks are ready, but first reveal is 9.2 ms later in the isolated fixture because of yields. No score increase: total first-use latency did not improve. |
| Runtime responsiveness | 6/10 | 7/10 | Targeted main-thread work is lower and the existing adaptive downshift now observes unclamped render time; actual browser input latency/FPS remains unknown. |
| Adaptive quality response | 0/10 | 7/10 | Before, thresholds were impossible after the 50 ms cap. Focused logic tests prove both downgrades are reachable; real-device recovery/fidelity perception is unverified. |
| CPU efficiency | 5/10 | 8/10 | Measured 87.2% / 97.8% reductions in the two targeted kernels. Whole-frame CPU not measured. |
| Main-thread task consistency | 6/10 | 8/10 | Startup fixture max batch 18.1 → 6.4 ms; rain loop and ambient world scans are reduced. No browser long-task trace. |
| Memory / heap efficiency | N/M | N/M | No heap/GPU-memory telemetry. Rain now uploads a one-time 8.8 KB velocity attribute; CPU-side position and velocity arrays total 35.2 KB, the same nominal arrays as before. Repeated position uploads are removed. |
| Long-session stability | 7/10 | 7/10 | Existing bounded pools/chunks and smoke lifecycle checks remain; no multi-hour heap test. |
| Draw calls / geometry | 8/10 | 8/10 | 92 calls / 80,112 triangles unchanged and inside established budget. |
| CPU animation efficiency | 5/10 | 8/10 | Rain CPU loop replaced by shader motion; shader syntax and snow/rain/freeze behavior checked, GPU cost unknown. |
| Shader/GPU/pixel-fill | N/M | N/M | GLSL parses; no GPU frame-time, overdraw, shader occupancy or visual-pixel comparison. |
| Asset/network | 9/10 | 9/10 | Procedural, offline content unchanged; browser-level request/cache timing unavailable. |
| Mobile, battery, thermal | N/M | N/M | No physical device or power instrumentation. |
| Scalability | 7/10 | 7/10 | Existing streaming/caps retained and stress tests pass; stress on real hardware unknown. |

## Regression protection and verification

`npm run perf` now asserts ambient cadence/output equivalence, muted no-op,
rain/snow motion and clear-weather freeze, static rain buffers, near-field-first
startup plus full queue completion, and the existing 92/80,112 geometry budget.
`npm run shaders` parses the injected rain vertex shader. `npm run visit`
exercises fresh/return/no-WebGL boots. `npm run smoke` exercises controls,
persistence, world simulation, discoveries, particles and streaming. No full
production build exists because the app is a static ES-module project.

Remaining ceiling: real-device GPU and browser traces. In particular, run the
rain shader on WebGL1/WebGL2 low-end mobile GPUs and compare actual pixels,
frame-time percentiles, long-task events, memory and battery before claiming
whole-game FPS or power gains.
