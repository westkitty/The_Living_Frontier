# Phase 2A Candidate Review — Player + Deer Phase 1 Fixtures

Status: REJECTED AS PRODUCTION PRESENTATION

The first live-game integration slice successfully proved the architecture, but the Phase 1 fixture models are not accepted as the final Phase 2 actor art.

## What passed

GitHub Actions run `36520124841` passed:

- existing asset validation
- architecture / UI / shader / visit / smoke gates
- representative performance probes
- desktop Chromium live-game path
- narrow/mobile Chromium live-game path
- player model attached below the authoritative Player.group
- player movement with zero gameplay-root divergence
- zero presentation-local drift during player movement
- deer model attached below the authoritative Actor.group
- deer flee state mapped to the physically verified `Run` clip
- deer animation time advanced
- deer despawn released exactly one live asset reference

This proves the presentation architecture.

## Why the candidate is rejected visually

Manual inspection of the browser screenshots found defects that the structural/browser assertions did not catch.

### Deer fixture

The Phase 1 deer source contains a separate mesh/node named `Plane`, physically recorded in the generated manifest. It renders as a large dark planar shape in the inspection/live-game view and is not acceptable game presentation.

Current manifest facts:

- deer nodes include `Plane`
- deer mesh names include `Plane`
- four total meshes, while the visible animal itself does not require that large environmental/helper plane

The Phase 1 desktop probe already contained this defect; Phase 2 made its gameplay impact obvious.

### Player fixture

The narrow/mobile live-game screenshot shows conspicuous bright block-like geometry around the player's feet. The single opaque animation clip is also insufficiently described to make reliable semantic idle/walk/run/combat mappings.

## Disposition

- KEEP the new ActorVisual architecture and browser proof.
- KEEP Phase 1 fixture IDs as pipeline fixtures.
- DO NOT promote the Phase 1 player/deer models as final Phase 2 production actor art.
- Build corrected/production Phase 2 runtime assets behind new stable IDs.
- Re-run the same live-game proof plus manual visual review before promotion.

A green loader test is not permission to ship broken geometry. Quite a concept.
