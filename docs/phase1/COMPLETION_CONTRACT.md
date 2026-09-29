# Phase 1 CompletionContract — Visual Asset Pipeline

Phase 1 is COMPLETE only when every required item below is satisfied by evidence from the current revision.

## Contract

- [ ] Stable logical asset IDs and asset-policy.json exist.
- [ ] Rights, provenance, credits, rejection history, and integration history are repository artifacts.
- [ ] Untouched source downloads are preserved separately from runtime derivatives.
- [ ] Five representative roles are physically generated as self-hosted runtime GLBs.
- [ ] Source and runtime hashes/byte counts are generated from the actual files.
- [ ] Runtime GLBs have no external resource URIs.
- [ ] Official Khronos glTF validation reports zero errors for all five GLBs.
- [ ] Any validator warnings are explicitly reviewed before final PASS.
- [ ] Manifest-backed AssetManager loads by logical ID and enforces the runtime asset root.
- [ ] Loader support is pinned to the project's Three.js revision and vendored for runtime use.
- [ ] Asset ownership includes deterministic release/disposal behavior.
- [ ] The real probe loads all five assets in a browser.
- [ ] Animated humanoid and deer fixtures prove skinned-animation runtime paths.
- [ ] Pine proves the instanced rendering path.
- [ ] The probe visibly renders nonblank output.
- [ ] Orbit, zoom, and reset are interaction-tested.
- [ ] Desktop and narrow/mobile viewport browser runs pass without console/page errors.
- [ ] Browser teardown leaves zero asset-manager cache/ref ownership and no increased renderer resource counters.
- [ ] Current game architecture/UI/shader/visit/smoke gates pass.
- [ ] Current representative performance gates pass.
- [ ] Probe screenshots are retained as run evidence.
- [ ] ValidationPlan and final Phase 1 report are committed.
- [ ] Verified Phase 1 work is merged to main.
- [ ] GitHub Pages deployment from the merged revision succeeds.

## Explicit non-goals

Phase 1 does not replace the production player, NPCs, wildlife, vegetation scatter, structures, gameplay collision authority, simulation state, or streaming architecture with imported models. It establishes the verified asset lifecycle those later replacements can use.

Phase 1 also does not claim that the representative fixtures are the final aesthetic selections. Production fidelity and game-specific animation/deformation acceptance belong to the later integration phases.

## Status rule

If any checked item lacks direct evidence, status is PARTIAL or BLOCKED, not COMPLETE.
