# Visual replacement ledger

This ledger records the current state of every visual family. `VERIFIED` means
the repository gate and live browser path support the claim. `HYBRID` means the
authoritative procedural system remains active and only a bounded authored
presentation seam has been integrated.

| Family | Final intended state | Current evidence | Status |
| --- | --- | --- | --- |
| Player, villagers, patrols | Authored model assets | Phase 2 manifest, actor visual ownership, semantic clips, fallback | VERIFIED / Phase 2 |
| Deer, wolf, boar, rabbit, carcasses | Authored model assets | Phase 2 manifest, species-preserving carcass path, cleanup proof | VERIFIED / Phase 2 |
| Pine trees | Hybrid authored + procedural | `vegetation.pine.phase1` attaches to one near streamed chunk representative; deterministic instanced scatter remains authoritative | VERIFIED seam |
| Broadleaf trees, bushes, berry bushes, grass, ferns, saplings | Procedural visual retained intentionally | Burn, planting, regrowth, density, and chunk ownership are state-derived | INTENTIONAL PROCEDURAL |
| Rocks and ore | Procedural visual retained intentionally | Deterministic chunk scatter and harvest ownership remain in `Vegetation` | INTENTIONAL PROCEDURAL |
| Huts and settlement buildings | Hybrid authored + procedural | `structure.hut.phase1` and `prop.axe.phase1` attach to non-abandoned settlement work areas; settlement geometry remains state-derived | VERIFIED seam |
| Fields, walls, gates, towers, scaffolding, markets, clutter | Procedural visual retained intentionally | Prosperity, construction, defenses, and abandonment remain state-derived | INTENTIONAL PROCEDURAL |
| Camps and banners | Hybrid procedural system | Runtime faction ownership and banner recolouring remain authoritative | INTENTIONAL HYBRID |
| Landmarks | Bespoke project asset / authored composition | Named landmarks use deterministic bespoke compositions with landmark-specific silhouettes and dressing | VERIFIED procedural composition |
| Caves | Bespoke project asset / authored dressing | Traversable cave authority remains procedural; each cave now has a distinct ember, violet, or cyan crystal palette | VERIFIED procedural composition |
| Fire, smoke, embers, hit, dust, weather | Procedural visual retained intentionally | Simulation-owned effects and existing performance probes | INTENTIONAL PROCEDURAL |
| Cartography, fog, chronology, faction crests | Bespoke project-owned UI | Generated state-aware UI remains project-owned | VERIFIED existing system |

No runtime hotlinks were added. Pine and hut handles are released when their
chunk or settlement presentation is rebuilt or unloaded. This ledger is not a
completion declaration; exhaustive landmark/cave visual acceptance and release
gates remain open.
