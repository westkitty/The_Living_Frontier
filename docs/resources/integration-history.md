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
