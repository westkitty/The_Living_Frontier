# Refinement verification

Scope: A1–A3 and B1–B10. No requested refinement was skipped.

`npm run check` runs arch → ui → shaders → visit → smoke. No new dependencies.
Every implementation commit was preceded by a green full chain. The visit gate
was added because the original checkout had no such script.

## Deliberate failures, restored before committing

| Change | Mutation observed to fail |
|---|---|
| A1 / A3 | Remove each `touch-action:none` separately: UI gate identifies `index.html`'s record canvas and `panels.js`'s runtime history canvas respectively. |
| A2 | Restore territory-based war: smoke rejects war on a fresh tenancy. Journalled war and hunting precedence are also asserted. |
| B1 | Clear rather than assign the waypoint: smoke reports each tested sealed entry missing its stone. Native button focus, journal note, closure and discovery unsealing are asserted. |
| B2 | Replace patterned territory fills with plain faction accents: the three raster alpha signatures become identical; refinement gate fails. |
| B3 | Set wear to zero: the 20-day settlement-route/control comparison fails. Separately remove trail bias: preferred-step assertion fails. |
| B4 | Skip ring-two canopy construction: canopy ownership assertion fails. Burn exclusion and geometry disposal are asserted too. |
| B5 | Draw `0` for every y tick: true min/mid/max drawing assertion fails. Tests isolate through actual legend buttons. |
| B6 | Disable scent attraction: predator-distance assertion fails. Separately disable decay: lifecycle assertion fails. Feeding, real hide harvest and scene cleanup are asserted. |
| B7 | Keep hint flags only in memory: independent return boot repeats hints and fails. Six real game triggers, repeat triggers, reload persistence and hints-disabled boots are covered. |
| B8 | Remove wetness from shared fire conditions: risk/spread assertion fails. Separately force HUD to always say dry: visit gate fails. The tinder prompt is exercised through real target selection and strike. |
| B9 | Disable recovery: truncated-diary assertion fails. Recovered ground, survey, regions, settlements and position are compared with originals; diary loss, raw quarantine, healthy load and unrecoverable fallback are checked. |
| B10 | Append 200 filler lines to each of 28 source modules separately: every attempt fails architecture. Remove both game mixin applications: wiring gate fails. All mutations restored. |

## Uplift-pass gates (same day, restored before committing)

The performance uplift added four modules and one probe, and each gate change it
needed was failure-tested rather than assumed:

| Change | Mutation observed to fail |
|---|---|
| `arch-check.mjs` now blanks quoted strings as well as template literals when looking for a name a module never imported, because the selector `'#weather-icon'` read as the `icon` export. | Append `const p = () => icon("sun") + WORLD.size;` to `hud.js`: two `✗ … uses X without importing it` plus the line ratchet. The widened scan still catches real undeclared use; what it stopped reporting was a string literal. |
| `ui-check.mjs` validates `hudEl('#id')` as well as `$('#id')`, so the HUD's selectors stayed covered after moving to `hud.js`. | Rename `#time-label` to `#time-label-typo` in `hud.js`: `✗ code queries elements that do not exist: #time-label-typo (hud.js)`. |
| `module-lines.json` records a ceiling for `hud.js` (256) and lowers `ui.js` 608 → 434, `entities.js` 574 → 569, `fx.js` 398 → 395, `streaming.js` 183 → 182, `worldstate.js` 591 → 590; worst module `ui.js` 608 → `worldstate.js` 590. | Add two lines to `hud.js`: `✗ hud.js: 257 lines exceeds its ratchet 255`. Ceilings may only decrease relative to the preceding commit, so the tightened values cannot be quietly raised again. |
| `hud-perf-probe.mjs --assert` requires identical DOM state, an identical effective-write count, ≤0.05 lookups/frame, ≤1 layout read per run, and redundant writes cut >4× — all of which are exact and repeatable. It deliberately does *not* assert on milliseconds: a tick costs ~10 µs, and at that scale the sandbox reorders the two columns between runs, so timing is printed as a diagnostic only. | Point the optimized slot at the reference implementation instead of `HudMixin`: `AssertionError: element lookups are still uncached (standing still): 11.06/frame`. The equality assertion also caught a real probe defect — a second stub document left the shipped element cache pointing at detached nodes, so the harness now retires the previous document the way a browser would. |

The fire/grid extraction was additionally proven equivalent to a retained copy of
the pre-refactor module across ten scenarios (see
[PERFORMANCE.md](PERFORMANCE.md#fire-and-grid-extraction-srcgridjs-srcfirejs));
that harness was a one-off and is not part of `npm run perf`. The anchors that
are — `damp 1 cells, tinder 163 cells` and 704 → 704 burn scars — were unchanged
by the rewrite.

## Measured behaviours

- Autonomous actor fixture, twenty 420-second days: mean TRAIL **0.984** on
  the settlement route, **0.000** on the parallel control 100 m away. This tests
  live actor movement without player movement, not offline traffic simulation.
- Same seeded ignition: **1** fire cell reached in rain, **163** in tinder conditions.
- Carcasses approach one day in lifetime, but harvest and feeding remove them early.
- Fresh and loaded worlds boot in separate Node/jsdom processes, with storage passed
  between them. No-WebGL boot reports an actionable error rather than creating a game.
- Broken journal JSON preserves ground and survey byte-for-byte. Unknown lost-entry
  counts are honestly unknown; a malformed 43-entry array reports 43 lost entries.

## Performance

The scene probe reports **92 meshes / 80,112 triangles**, compared with
**86 / 79,932** on the original revision: +6 calls, +180 triangles (~0.23%).
This satisfies the requested +10-call / +25%-triangle canopy limits. Geometry
counts remain unchanged by this performance pass.

This pass adds a repeatable idle-effects probe to `npm run perf`: 120 warm-up
frames followed by five rounds of 900 identical FX updates at 60 Hz, recording
median/p95 update cost, Three.js `Color.clone()` calls, and smoke/spark position
buffer version changes. On the same sandbox before/after:

| Idle FX metric | Before | After |
|---|---:|---:|
| Median update time | 0.009 ms | 0.006 ms |
| p95 update time | 0.013 ms | 0.012 ms |
| Smoke / spark `needsUpdate` version bumps in 4,500 frames | 4,500 / 4,500 | 0 / 0 |
| `Color.clone()` calls in 4,500 frames | not instrumented; source did 6/frame | 0 (instrumented) |

The sub-0.02 ms timing is below a useful real-device frame budget and varies
between runs; treat those CPU timings as directional, not a demonstrated
user-visible speedup. The robust code-path gain is removing two redundant 500/220-point position-buffer
upload requests on every idle frame and replacing per-frame palette creation and
cloning with constructor-owned reusable colors. Actual GPU transfer and render
cost were unavailable in this environment. The probe asserts idle upload
suppression, zero sky-color clones, live particle updates, expiration, and return
to an upload-free idle state. `npm run perf` also preserves the existing terrain
mesh/triangle budget and chunk/height sampling probes.

Five interleaved runs of original commit `4909518` and the refined tree on the
same sandbox (no other dependencies installed):

| Median | Original | Refined |
|---|---:|---:|
| Initial 49-chunk stream | 72 ms | 72 ms |
| Per-run median chunk-row crossing | 13.5 ms | 16 ms |
| heightAt throughput | 1.142 M/s | 1.119 M/s |

Initial timings ranged 57–80 ms original and 57–89 ms refined. There is a small
row-streaming cost for canopies; do not mistake a single ~55 ms reference from a
different run for a hardware-invariant promise. Frame time on real GPU hardware
has not been measured here.

## Visual and device limits

`node tools/visual-qa.mjs` renders the production 2D code through @napi-rs/canvas.
The map, minimap, save thumbnail, normalised and isolated-herd charts, and three
Long Record scales are inspected as PNGs. The Long Record's narrow canvas can
clip long right-hand labels; its full textual readout remains available. That
pre-existing layout issue is outside these refinements.

There is no GPU or audio device. WebGL images and audible sound cannot be
verified. GLSL is parsed and scene ownership is checked with the renderer seam;
this does not prove GPU pixels. Keyboard focus/click behaviour and touch event
logic are tested, not physical mobile/browser gestures.

## Deliberate limits

- Candidate-step trail steering is not a pathfinding graph and can meet impassable
  terrain. Only active villagers/patrols wear trails, not offline population totals.
- Canopies represent dense forest patches, not every sparse tree or burnt patch.
- Carcasses are bounded temporary scene objects, not persistent save objects.
- Save recovery keeps intact validated sections and resets broken sections. It
  cannot reconstruct arbitrary missing JSON or diary prose. Quarantine itself
  remains subject to browser storage availability/quota.
