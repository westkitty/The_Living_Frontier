# OPERATIONAL_STATE

## Current phase

Phases 1–2 verified; Phase 3 authored world presentation in progress

## Verified baseline

Main revision at Phase 2 branch creation: `1a31b39106117680b3d4144385d81c3b71c4d1f4`.

Phase 1 asset lifecycle is complete and published. Phase 2 preserves the existing engine, renderer, authoritative gameplay roots, world-state ownership, persistence, interaction systems, browser journeys, and representative performance probes.

## Phase 2 invariant

Actor presentation may change. Gameplay authority may not migrate into imported model nodes or animation.

`Player.group` and `Actor.group` remain authoritative. Production models attach below them through `AssetManager`; procedural presentation remains the load-failure fallback.

## Current release candidate

All fixed Phase 2 actor families now have physically generated production runtime assets:

- player;
- male/female villagers;
- male/female patrol presentation;
- deer;
- wolf;
- boar;
- rabbit.

The current package contains 9 Phase 2 GLBs totaling 6,075,796 bytes.

Production integration includes per-instance animation mixers, safe per-instance faction tinting, verified semantic clip mappings, load fallback, deterministic reference release, and species-preserving carcasses.

Manual isolated visual review caught and corrected an sRGB/linear palette conversion defect. The rebuilt human and wildlife review probes now show the intended darker/natural skin, deer, and boar palettes without observed geometry loss.

## Verified behavior

Existing gameplay remains authoritative and regression gates have demonstrated:

- player movement/camera/controller ownership remains outside imported animation;
- actor AI, ecology, villages, factions, dialogue, combat, persistence, and interaction semantics remain gameplay-owned;
- independent animated instances do not share mixer/action state;
- wildlife harvest, predator consumption, corpse cleanup, and population consequences remain functional;
- faction material mutations are instance-owned;
- asset failures retain functional procedural presentation;
- representative spawn/despawn paths release asset references.

## Current gate

The report/contract update at this stage exists to trigger one final combined living-actor workflow against the latest rebuilt human and wildlife bytes.

Do not merge until that run passes and its final integrated live/diagnostic screenshots are manually inspected.

## Verified Phase 3 presentation seam

The existing procedural world remains authoritative. One verified Quaternius
pine presentation is attached to each active near streamed chunk, and one
verified Quaternius hut presentation is attached to each non-abandoned active
settlement. These are hybrid presentation overlays with explicit asset-manager
release on chunk unload and settlement rebuild; all other vegetation and
settlement families remain procedural by design pending their own source and
visual acceptance.

## Remaining release work

- pass final combined living-actor CI on the latest production assets
- manually inspect final integrated desktop and narrow/mobile screenshots
- merge verified branch to `main`
- confirm GitHub Pages deployment from merged `main`
- record Phase 2 COMPLETE only after those release gates pass
