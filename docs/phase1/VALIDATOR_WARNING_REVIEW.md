# Phase 1 Khronos Validator Warning Review

Date: 2026-09-28 / 2026-09-29 UTC run
Validated revision source: Phase 1 asset-pipeline branch
Validator: Khronos `gltf-validator` 2.0.0-dev.3.10
Generated report: `docs/resources/validation/gltf-validator-report.json`

## Verdict

**REVIEWED / ACCEPTED FOR THE PHASE 1 PIPELINE FIXTURES.**

The current five GLBs validate with **0 errors and 4 warnings**. The earlier pine tangent-space warning was removed by exporting explicit tangent data. The remaining warnings are all `NODE_SKINNED_MESH_NON_ROOT` notices on the two animated fixture families:

- `player.phase1`: 1 warning
- `creature.deer.phase1`: 3 warnings

No static prop, vegetation, or structure warning remains.

## What the remaining warning means

The Khronos validator reports that a node containing a skinned mesh is not a root node and warns that parent-transform semantics for skinned meshes are not portable in the same way as ordinary mesh hierarchy transforms.

This is a real portability warning. It is not being suppressed or relabeled as an error-free authoring hierarchy.

## Why it is accepted for Phase 1

Phase 1 is a **runtime asset-pipeline vertical slice**, not final production-character acceptance. These animated models are representative fixtures used to prove that the project can preserve and exercise skeletal content through the source -> Blender conversion -> GLB -> manifest -> Three.js runtime path.

The target runtime evidence for both warning-bearing assets is positive:

1. Khronos validation reports zero structural errors.
2. The manifest records actual skin and animation facts from the generated GLBs rather than guessed names.
3. The real Three.js GLTFLoader path loads the models in Chromium.
4. The player fixture exposes one skinned mesh and one animation.
5. The deer fixture exposes skinned meshes and eleven animations.
6. The browser test selects an actual clip, creates a real AnimationMixer action, verifies that the action is running, waits, and verifies that mixer time advances.
7. The same path passes both desktop and narrow/mobile viewport runs without page or console errors.
8. The rendered canvas is nonblank and the actual deer fixture is visible in captured evidence.
9. Teardown releases asset-manager ownership and does not grow renderer geometry/texture counters.

That evidence is sufficient for the stated Phase 1 purpose: **the target Three.js runtime can load, render, animate, inspect, and dispose these representative skinned assets.**

## What this acceptance does NOT mean

This review does **not** certify the player or deer fixtures as final production characters, animation-ready art direction, final deformation quality, or renderer-independent hierarchy exemplars.

For later production integration:

- a final animated asset must be evaluated against its actual gameplay transforms and deformation needs;
- any required non-identity transform above a skinned mesh must be tested explicitly in the target runtime;
- if parent-transform semantics affect the intended result, repair or normalize the hierarchy in the authoring source and re-export;
- final character acceptance still requires game-specific deformation/animation visual QA.

The warnings remain visible in the committed validator report so later work cannot mistake this review for their disappearance.

## Phase 1 warning disposition

| Asset | Warning | Count | Phase 1 disposition |
| --- | --- | ---: | --- |
| `player.phase1` | `NODE_SKINNED_MESH_NON_ROOT` | 1 | Accepted for pipeline fixture; live Three.js animation proof passes |
| `creature.deer.phase1` | `NODE_SKINNED_MESH_NON_ROOT` | 3 | Accepted for pipeline fixture; live Three.js animation proof passes |
| `vegetation.pine.phase1` | tangent-space warning | 0 current | Corrected by exporting tangents |

**Result:** no unresolved validator warning blocks the Phase 1 pipeline contract. Production character integration remains a later-phase responsibility.
