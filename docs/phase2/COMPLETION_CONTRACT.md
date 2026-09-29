# Phase 2 CompletionContract — Living Actors

Phase 2 is COMPLETE only when every required actor family is integrated and verified.

## Architecture

- [x] Existing simulation/gameplay state remains authoritative.
- [x] Player.group and Actor.group remain gameplay transform roots.
- [x] Imported models are presentation children rather than state owners.
- [x] AssetManager stable logical IDs own production actor loading.
- [x] Every independently animated instance has independent animation playback state.
- [x] Failed loads preserve a functioning procedural fallback.
- [x] Despawn/death/replacement has explicit animation and asset-reference cleanup.

## Player

- [x] Production runtime model is physically present and validated.
- [x] Player movement/camera/combat/persistence remain behaviorally unchanged.
- [x] Verified animation clips are mapped to actual player semantic states.
- [ ] Final combined live desktop and narrow/mobile browser proof passes on the latest rebuilt asset bytes.

## Villagers and patrols

- [x] Production human runtime assets are physically present and validated.
- [x] Villager routines, jobs, dialogue identity, trails, and settlement ownership remain intact.
- [x] Faction patrol state and faction identity remain visually distinguishable without mutating shared materials unsafely.
- [x] Spawn/despawn and independent animation instances are browser-tested.

## Wildlife

- [x] Deer is production integrated.
- [x] Wolf is production integrated.
- [x] Boar is production integrated.
- [x] Rabbit is production integrated.
- [x] Existing predator/prey/flee/charge/feed behavior remains authoritative.
- [x] Each species uses only physically verified animation clips.
- [x] Representative spawn/despawn cycles release ownership.

## Death / carcasses

- [x] Death/carcass presentation is upgraded without changing gameplay semantics.
- [x] Harvest interaction remains functional.
- [x] Predator carcass attraction/consumption remains functional.
- [x] Corpse lifetime and population effects remain functional.

## Evidence

- [x] Source/provenance/license records are complete for every new source.
- [x] Runtime hashes and semantic manifest facts match actual generated files.
- [x] Khronos glTF validation reports zero errors.
- [x] Remaining warnings are explicitly reviewed.
- [x] Existing npm run assets/check/perf gates pass.
- [ ] Final combined live-game Playwright desktop and narrow/mobile journeys pass on the latest rebuilt asset bytes.
- [ ] Final integrated live/diagnostic screenshots are manually inspected.
- [x] Phase 2 report records the current verified evidence and remaining release gates.
- [ ] Verified branch merges to main.
- [ ] GitHub Pages deployment from merged main succeeds.

## Status rule

Phase 2 remains **RELEASE CANDIDATE / NOT COMPLETE** until every unchecked release gate above is evidence-backed.
