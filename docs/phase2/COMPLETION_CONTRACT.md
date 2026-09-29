# Phase 2 CompletionContract — Living Actors

Phase 2 is COMPLETE only when every required actor family is integrated and verified.

## Architecture

- [ ] Existing simulation/gameplay state remains authoritative.
- [ ] Player.group and Actor.group remain gameplay transform roots.
- [ ] Imported models are presentation children rather than state owners.
- [ ] AssetManager stable logical IDs own production actor loading.
- [ ] Every independently animated instance has independent animation playback state.
- [ ] Failed loads preserve a functioning procedural fallback.
- [ ] Despawn/death/replacement has explicit animation and asset-reference cleanup.

## Player

- [ ] Production runtime model is physically present and validated.
- [ ] Player movement/camera/combat/persistence remain behaviorally unchanged.
- [ ] Verified animation clips are mapped to actual player semantic states.
- [ ] Live desktop and narrow/mobile browser proof passes.

## Villagers and patrols

- [ ] Production human runtime assets are physically present and validated.
- [ ] Villager routines, jobs, dialogue identity, trails, and settlement ownership remain intact.
- [ ] Faction patrol state and faction identity remain visually distinguishable without mutating shared materials unsafely.
- [ ] Spawn/despawn and independent animation instances are browser-tested.

## Wildlife

- [ ] Deer is production integrated.
- [ ] Wolf is production integrated.
- [ ] Boar is production integrated.
- [ ] Rabbit is production integrated.
- [ ] Existing predator/prey/flee/charge/feed behavior remains authoritative.
- [ ] Each species uses only physically verified animation clips.
- [ ] Representative spawn/despawn cycles release ownership.

## Death / carcasses

- [ ] Death/carcass presentation is upgraded without changing gameplay semantics.
- [ ] Harvest interaction remains functional.
- [ ] Predator carcass attraction/consumption remains functional.
- [ ] Corpse lifetime and population effects remain functional.

## Evidence

- [ ] Source/provenance/license records are complete for every new source.
- [ ] Runtime hashes and semantic manifest facts match actual generated files.
- [ ] Khronos glTF validation reports zero errors.
- [ ] Remaining warnings, if any, are explicitly reviewed.
- [ ] Existing npm run assets/check/perf gates pass.
- [ ] Live-game Playwright desktop and narrow/mobile journeys pass.
- [ ] Visual screenshots are inspected.
- [ ] Phase 2 report records what was actually verified.
- [ ] Verified branch merges to main.
- [ ] GitHub Pages deployment from merged main succeeds.

## Status rule

The current player + deer integration slice may be marked PASS while Phase 2 remains PARTIAL. Do not call the phase complete until all boxes above are evidence-backed.
