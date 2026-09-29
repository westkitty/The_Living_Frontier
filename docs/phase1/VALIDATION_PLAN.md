# Phase 1 ValidationPlan — Visual Asset Pipeline

## Classification

Phase 1 is an asset-pipeline vertical slice for an existing Three.js browser game, not a final character/environment art replacement pass. The current procedural simulation, gameplay state, renderer, streaming model, and tested player journeys remain authoritative.

## What correct means

Phase 1 passes only if the repository can reproducibly take approved source assets through provenance capture, conversion, runtime packaging, manifest registration, browser loading, animation/instancing exercise, inspection, and deterministic cleanup without inventing asset facts or regressing the existing game.

## Authoritative evidence

1. GENERAL_3D_CREATION_AND_CHARACTER_FIDELITY_STANDARD.md
2. MODERN_3D_BROWSER_GAME_ARCHITECTURE_TOOLKIT_OPTIMIZED_V1_1
3. The repository's existing source, tests, renderer, and performance probes
4. Exact source pages and untouched source downloads recorded by the Phase 1 provenance/rights ledgers
5. Generated runtime GLBs and the generated manifest; names, hashes, and stats are facts only after generation

## Required representative roles

- prop.axe.phase1 — static prop
- vegetation.pine.phase1 — instanced vegetation path
- structure.hut.phase1 — settlement/building path
- player.phase1 — skinned animated humanoid path
- creature.deer.phase1 — skinned animated quadruped path

These are pipeline fixtures. They are not declarations that the final game must use these exact models.

## Mandatory structural gates

- all five logical IDs are present exactly once
- every runtime URI resolves under assets/runtime/
- no runtime model depends on remote/external URIs
- source and runtime SHA-256 values are present and match current bytes
- source license/provenance records exist and satisfy project policy
- static representatives contain meshes
- animated representatives contain a skin and at least one animation
- texture dimensions are bounded by the conversion pipeline
- Phase 1 runtime bytes remain within the declared budget
- the official Khronos glTF Validator reports zero errors for every runtime GLB
- validator warnings are recorded and must be reviewed before Phase 1 is called complete

## Mandatory browser gates

The real asset-probe.html page must be exercised in Chromium at desktop and narrow/mobile viewport sizes.

For each viewport:

- WebGL context exists
- all five runtime assets load through the project loader path
- every asset renders actual mesh content
- player and deer expose skinned animated content
- pine is exercised through a real THREE.InstancedMesh
- the rendered canvas is nonblank
- orbit drag changes camera orientation
- wheel zoom changes camera distance
- Reset restores the canonical camera
- no page/console errors occur
- teardown releases all asset-manager references/cache entries
- renderer geometry/texture counters do not increase after teardown

Screenshots from the actual probe are retained as CI evidence.

## Regression gates

The unchanged game must still pass:

- architecture checks
- UI checks
- shader checks
- visit/player-journey checks
- smoke/refinement checks
- existing representative performance probes

A source inspection is not counted as any of these runtime/browser proofs.

## Meaningful metrics

- runtime bytes
- meshes/primitives/materials/textures
- skins/animations
- official validator issue counts
- loader/browser success
- instancing exercised
- teardown ownership
- existing project performance probes

## Metrics intentionally irrelevant to Phase 1

Phase 1 does not score final art-direction fidelity, final character likeness, final gameplay animation quality, final LOD coverage, or final collision metadata. Those are production-integration concerns for later phases. Attractive screenshots cannot substitute for the structural/runtime gates above.

## Critical regressions

Any of the following rejects the candidate:

- existing game gate fails
- a runtime asset or license/provenance record is missing
- hash/byte facts drift
- runtime hotlink/external dependency appears
- animated fixture loses skin or animation
- probe loads a blank canvas or throws
- orbit/zoom/reset fails
- cleanup ownership fails
- Khronos validator reports an error
- generated asset facts are manually invented instead of derived

## Completion evidence

Phase 1 is eligible for completion only when every mandatory gate above is green, the CompletionContract is satisfied, the verified branch is merged to main, and the Pages publication from that merged revision succeeds.
