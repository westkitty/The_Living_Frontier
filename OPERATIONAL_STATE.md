# OPERATIONAL_STATE

## Current phase

Phase 2 — Living Actors

## Verified baseline

Main revision at Phase 2 branch creation: `1a31b39106117680b3d4144385d81c3b71c4d1f4`.

Phase 1 asset lifecycle is complete and published. Five verified runtime fixtures exist behind stable logical IDs. Existing game architecture, state ownership, browser journeys, and performance probes are protected.

## Phase 2 invariant

Actor presentation may change. Gameplay authority may not migrate into imported model nodes or animation.

Player and actor gameplay roots remain authoritative. Runtime models attach below them through AssetManager and keep procedural geometry as a failure fallback.

## Current bounded slice

The player + deer integration architecture has passed live browser/behavior gates, but the Phase 1 fixture models failed manual production visual review. The adapter architecture is retained; the fixture art is rejected for promotion.

Next: acquire and inspect the exact Phase 2 production candidates for humans, wolf, rabbit and boar, then generate corrected/new stable Phase 2 runtime IDs.

## Remaining Phase 2 work

- source/convert/integrate a multi-animation human set for final player/villager/patrol presentation
- source/convert/integrate wolf
- source/convert/integrate boar
- source/convert/integrate rabbit
- upgrade death/carcass presentation
- run full actor visual/deformation and gameplay regression proof
- final Phase 2 report, merge, Pages deployment
