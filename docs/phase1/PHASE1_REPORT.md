# Phase 1 Report — Visual Asset Pipeline

## Status at report creation

**BRANCH QA: PASS**

Release gates still to execute after this report is committed:

1. merge the verified Phase 1 branch to `main`;
2. confirm the resulting GitHub Pages deployment succeeds.

This report deliberately does not call the phase complete before those release gates occur.

## Scope delivered

Phase 1 establishes a verified asset lifecycle for the existing Three.js game without replacing its authoritative gameplay/simulation architecture.

Implemented:

- `asset-policy.json` with accepted-license, runtime-root, and byte-budget policy;
- stable logical asset IDs;
- license, provenance, credits, third-party notice, rejection, and integration-history records;
- untouched source-download preservation in the `phase1-source-archives` GitHub release;
- deterministic Blender conversion to self-hosted GLB;
- a generated runtime manifest with source/runtime hashes and semantic facts derived from the generated GLBs;
- manifest-backed `AssetManager` with logical-ID loading, runtime-root enforcement, reference ownership, explicit disposal, and contextual load errors;
- vendored Three.js r160 loader support matching the project runtime;
- isolated `asset-probe.html` inspection viewer;
- official Khronos glTF validation;
- real-browser desktop and narrow/mobile probe automation;
- screenshot evidence;
- preservation of the existing game checks and performance gates.

Production gameplay remains intentionally unchanged by these representative fixtures.

## Representative runtime package

Latest branch QA generated five self-hosted runtime assets totaling **2,626,812 bytes**.

| Logical ID | Runtime role | Bytes | Runtime facts |
| --- | --- | ---: | --- |
| `prop.axe.phase1` | static prop | 48,512 | 1 rendered mesh; 826 triangles |
| `vegetation.pine.phase1` | instanced vegetation | 1,102,148 | 2 rendered mesh primitives; 3,947 triangles; real InstancedMesh path |
| `structure.hut.phase1` | structure | 253,616 | 6 rendered mesh primitives; 4,668 triangles |
| `player.phase1` | animated humanoid | 384,696 | 1 skinned mesh; 1 verified animation |
| `creature.deer.phase1` | animated quadruped | 837,840 | 4 meshes / 3 skinned meshes; 11 verified animations |

The generated manifest also records actual node names, material/mesh metadata, extension use, verified animation clip names, explicit `collisionStrategy: none-phase1-probe`, and `lodGroup: null`. No collider or LOD fact is invented for a fixture that does not provide it.

## Verified animation facts

The generated current GLBs report these actual clip names:

- player: `Human Armature|Human Armature|ArmatureAction.001`
- deer: `Die.000`, `Die.001`, `Die.002`, `Eat.001`, `Idle`, `Idle.000`, `Idle.001`, `LookAround.000`, `LookAround.001`, `Run`, `Stand`

The browser gate goes beyond clip existence: it selects an actual player/deer clip, confirms the AnimationMixer action is running, waits, and confirms action time advances.

## Structural validation

Khronos `gltf-validator` 2.0.0-dev.3.10:

- assets validated: 5
- errors: **0**
- warnings: **4**
- pine tangent-space warning: corrected; current count **0**

The four remaining warnings are `NODE_SKINNED_MESH_NON_ROOT` notices on the animated player/deer fixture exports. They are explicitly reviewed in `docs/phase1/VALIDATOR_WARNING_REVIEW.md` and accepted for this pipeline-fixture scope based on successful target Three.js runtime/animation evidence. They are not presented as final production-character acceptance.

## Browser / interaction proof

GitHub Actions run `36515292960` passed the real Chromium probe at:

- desktop viewport;
- narrow/mobile viewport.

The gate verified:

- WebGL context availability;
- all five manifest assets load through the project GLTFLoader path;
- actual mesh rendering and nonblank framebuffer;
- real InstancedMesh vegetation exercise;
- skinned player/deer loading;
- running animation actions whose mixer time advances;
- orbit drag;
- wheel zoom;
- reset camera;
- no page/console errors;
- asset-manager cache/reference teardown;
- no post-teardown increase in renderer geometry/texture counters.

The run retained two actual canvas screenshots as the `phase1-asset-probe-screenshots` artifact. Both were manually inspected after the run; the current deer model is visibly rendered in both desktop and narrow/mobile captures.

## Existing game regression proof

The same run passed:

- architecture checks;
- UI checks;
- shader checks;
- visit/player-journey checks;
- smoke/refinement checks;
- existing representative performance probes.

Smoke result: `SMOKE TEST PASSED`, no reported errors.

Representative performance evidence from the run includes:

- initial 49 chunks: 51 ms;
- heightAt: about 1,590k calls/sec;
- 92 scene draw calls / 80,112 triangles in the existing representative workload;
- idle FX median 0.009 ms / p95 0.016 ms;
- existing fire/recovery/adaptive-quality assertions passed.

These measurements describe the repository's existing probe workload; they are not claims about every browser/device.

## Provenance and rights

All Phase 1 representative sources are recorded as CC0 in the project ledgers. Exact source downloads are preserved separately from runtime derivatives, and current source SHA-256 values are linked into the generated manifest/provenance records.

## Deferred by design

Phase 1 does not replace or redefine:

- production player or NPC art;
- production wildlife;
- production vegetation scatter;
- settlement/structure presentation;
- gameplay collision authority;
- simulation/world state;
- chunk streaming architecture;
- final production LOD strategy.

Those belong to later production-integration phases and must use the verified lifecycle established here rather than bypass it.

## Branch QA verdict

The asset lifecycle is proven from source acquisition through runtime browser exercise and cleanup. The branch is ready for merge.

**Phase-level completion remains pending only the merge-to-main and Pages publication checks listed at the top of this report.**
