# Visual asset integration history

## Phase 1 — verified asset-pipeline vertical slice

Branch: `phase1/visual-asset-pipeline`

Scope:
- establish stable logical asset IDs and a manifest-backed loader;
- self-host the matching Three.js r160 GLTFLoader/SkeletonUtils support files;
- acquire and convert five representative asset roles;
- preserve current procedural gameplay/state ownership;
- provide an isolated real-browser asset probe before production replacement begins.

Representative roles:
1. static prop — axe
2. instanced vegetation — pine
3. modular structure — hut/building
4. skinned animated humanoid — player candidate
5. skinned animated quadruped — deer candidate

Phase 2 owns production player/NPC/wildlife replacement. Phase 3 owns production vegetation and settlement replacement. Phase 1 does not silently move gameplay authority into imported scenes.

## Phase 3 — authored world presentation seam

The existing deterministic vegetation, settlement, terrain, streaming, and
world-state systems remain authoritative. The production presentation seam now
loads the verified `vegetation.pine.phase1` asset for one representative pine
per near streamed chunk and `structure.hut.phase1` for one representative hut
per active settlement. The remaining families intentionally stay hybrid
procedural presentation so density, burn/regrowth, construction state, and
disposal behavior remain owned by the existing systems. Each acquired handle
is released when its chunk or settlement presentation is rebuilt or unloaded.
