# Phase 2 Khronos Validator Warning Review

Date: 2026-09-29 UTC
Validated branch: `phase2/living-actors`
Generated report: `docs/resources/validation/gltf-validator-report.json`

## Verdict

**REVIEWED / ACCEPTED FOR THE PROJECT'S TARGET THREE.JS RUNTIME.**

The current manifest contains 14 GLBs and validates with **0 errors and 16 warnings**. Phase 2 contributes 12 warnings, all of one known type: `NODE_SKINNED_MESH_NON_ROOT`.

This review does not suppress the warnings, reinterpret them as harmless in every renderer, or claim the authoring hierarchy is renderer-independent. It records why the current production assets are accepted for this game's actual Three.js runtime.

## Phase 2 warning inventory

| Asset | Warning | Count |
| --- | --- | ---: |
| `player.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `human.villager-male.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `human.villager-female.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `human.soldier-male.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `human.soldier-female.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `creature.deer.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 3 |
| `creature.wolf.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `creature.boar.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 1 |
| `creature.rabbit.phase2` | `NODE_SKINNED_MESH_NON_ROOT` | 2 |

Phase 2 total: **12 warnings, 0 errors**.

## What the warning means

The validator is warning that a node containing a skinned mesh is not a root node. Parent-transform behavior around skinned meshes is therefore less portable than a hierarchy whose skinned meshes are rooted in the form recommended by the validator.

That portability concern is real. Phase 2 accepts the hierarchy only because the target runtime has been exercised directly and because gameplay authority does not depend on the warned parent transforms.

## Target-runtime evidence

The production integration deliberately isolates gameplay authority from imported hierarchy:

1. `Player.group` and `Actor.group` remain the authoritative gameplay transform roots.
2. Each imported model is a presentation child acquired through the manifest-backed `AssetManager`.
3. Skinned instances are cloned through the project's `SkeletonUtils` path.
4. Every independently animated instance owns an independent `AnimationMixer` and action state.
5. A live browser proof advanced one villager mixer while confirming a second instance using the same runtime asset did not advance.
6. Imported animation does not mutate the authoritative player gameplay transform or the presentation child's local placement.
7. Player semantic states select verified `Idle`, `Walk`, `Run`, `Jump`, and `SwordSlash` clips.
8. Villagers, patrols, deer, wolf, boar, and rabbit select only animation names physically present in the generated manifest.
9. Spawn/despawn and harvest/consumption paths release their live asset references.
10. Load failure leaves the procedural actor visible and functional.
11. Isolated desktop and narrow/mobile review probes load and animate the current production human and wildlife GLBs.
12. Existing architecture, smoke, player-journey, persistence, and representative performance gates remain green on the integration branch.

## Why this is acceptable here

The warned hierarchy is not being used as a state owner. All gameplay position, yaw, collision, AI, health, faction, ecology, settlement, persistence, and interaction semantics remain outside the imported skeleton hierarchy.

The target Three.js runtime has demonstrated that these exact asset families load, render, animate, clone independently, tint safely where required, and dispose under the project's actual presentation-child architecture. That evidence addresses the risk relevant to this game even though it does not eliminate the validator's portability warning.

## What this acceptance does not mean

This is not a blanket waiver for future assets.

A future model carrying the same warning must still be rejected or repaired if any of the following occurs:

- animation or deformation visibly regresses;
- parent transforms produce incorrect scale, position, rotation, grounding, or culling;
- imported nodes begin owning gameplay truth;
- clone instances share mutable animation or material state unsafely;
- target-browser evidence fails;
- a future renderer or export path changes the observed behavior.

The warnings remain committed in the generated Khronos report so they cannot be mistaken for having disappeared.

## Disposition

**No current Phase 2 validator warning blocks the target Three.js production integration.** The release gate still requires the final combined branch browser/visual pass, merge to `main`, and successful Pages deployment.
