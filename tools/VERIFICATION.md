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

The scene probe now reports **92 meshes / 80,112 triangles**, compared with
**86 / 79,932** on the original revision: +6 calls, +180 triangles (~0.23%).
This satisfies the requested +10-call / +25%-triangle canopy limits. Geometry
counts were unchanged by the B10 extraction.

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
