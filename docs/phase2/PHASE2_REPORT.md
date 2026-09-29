# Phase 2 Report — Living Actors

## Status at report creation

**RELEASE CANDIDATE — FINAL COMBINED BRANCH QA PENDING.**

Current production asset head at report preparation: `cb48318daacd23314b022364ab73b8d130f791ac`.

The production human and wildlife build pipelines have passed independently, and the integrated gameplay architecture has passed repeated live-browser regression runs. This report commit intentionally triggers the final combined branch gate against the latest human and wildlife bytes before merge.

Phase 2 is not called complete until:

1. the final combined branch gate passes on the current asset set;
2. its integrated live/diagnostic screenshots are manually inspected;
3. the verified branch is merged to `main`;
4. the GitHub Pages deployment from merged `main` succeeds.

## Scope delivered

Phase 2 replaces the procedural presentation of living actors while preserving the existing authoritative simulation and gameplay architecture.

Production integration now covers:

- player;
- male and female villagers;
- male and female faction patrol presentation;
- deer;
- wolf;
- boar;
- rabbit;
- species-preserving animal carcasses and death presentation.

The imported models remain presentation children. Existing player movement, camera, combat, actor AI, ecology, settlement routines, faction pressure, dialogue identity, collision semantics, persistence, and interaction state remain gameplay-owned.

## Production runtime package

The current Phase 2 runtime package contains **9 production GLBs totaling 6,075,796 bytes**.

| Logical ID | Source variant / role | Bytes | Runtime SHA-256 |
| --- | --- | ---: | --- |
| `player.phase2` | Viking_Male | 872,540 | `cfcf605bc529229bba8a9e22667a9511147a9bd6631d2637999ecaa1316aabf3` |
| `human.villager-male.phase2` | Worker_Male | 644,740 | `fcb584693c2d1cbe852557538f4c1fd07659e0981895a02ed261946ee725e9df` |
| `human.villager-female.phase2` | Worker_Female | 831,008 | `22b49157ac60fe0a5e7b5ccf8baf1f07556299dd204525aaedd16dcce910cfc9` |
| `human.soldier-male.phase2` | Soldier_Male | 686,920 | `c09f8ffc64c0e939b21693b51eab51464028c95cec09e744b45dc8f55258a850` |
| `human.soldier-female.phase2` | Soldier_Female | 896,244 | `9d51cbeda614c9e1702acd36e5e2860d32119fefefad4041517a3368875a5d1b` |
| `creature.deer.phase2` | production deer | 836,972 | `7ebf77212181594532185133f648a806a6d0756ff04ecbc828773f4a8842c6fe` |
| `creature.wolf.phase2` | production wolf | 128,968 | `c3ff6c8c8bdb0a06e66cc65561ecdd19b49a7a7ea04df74b2c851733cc591e46` |
| `creature.boar.phase2` | production boar | 134,080 | `34e4f77b980c0cc67e3664fb56e2e49f714e5c0fafc24602d894be0d3eb51550` |
| `creature.rabbit.phase2` | production rabbit | 1,044,324 | `030ad50454f278d7a52339cf9519d554f07ba100fe9bc4667671c1d09025f73a` |

All runtime facts above come from the generated manifest after the verified build pipelines, not from planned filenames or assumed source metadata.

## Visual correction pass

Manual source/runtime review caught a real color-management defect before release: palette hex values were being assigned to Blender as if sRGB channel values were already linear. This made intended skin, deer, and boar colors substantially too pale.

Both Phase 2 Blender exporters now convert sRGB palette channels to linear values before assigning `diffuse_color` and Principled `Base Color`.

The rebuilt visual probes were manually reviewed:

- deer now reads as a coherent warm brown animal rather than chalk/cream;
- boar now reads as a dark brown low-poly boar;
- wolf and rabbit retained coherent source presentation;
- player, worker, and soldier variants retain distinct low-poly silhouettes and corrected skin-tone ranges;
- no inspected rebuild showed missing geometry or obvious catastrophic deformation.

Wildlife rebuild run: `36527062238`.
Human rebuild run: `36527062278`.

## Animation and state mapping

The human production family physically exposes 17 animation clips. Runtime semantic mappings use verified clips, including:

- player: `Idle`, `Walk`, `Run`, `Jump`, `SwordSlash`, `Death`;
- villagers/patrols: `Idle`, `Walk`, `Run`, `SwordSlash`, `Death`.

Wildlife mappings use only clips present in their generated GLBs:

- deer: idle/stand, `Run`, `Eat.001`, `Die.000`;
- wolf: `Idle`, `Walking`; source has no death clip, so death uses an explicit static presentation tilt;
- boar: `default`, `walk`, `attack`; source has no death clip, so death uses an explicit static presentation tilt;
- rabbit: `Basic`/sitting, `Running`, `Dying.000`.

Browser evidence has confirmed action time advances for mapped clips.

## Independent instance ownership

The integration uses the existing `AssetManager` / `SkeletonUtils` clone path and a per-`ActorVisual` `AnimationMixer`.

The live-browser gate explicitly created two villagers using the same runtime asset and verified:

- same logical asset ID;
- different mixer objects;
- different action objects;
- advancing instance A advanced A's action time;
- instance B's action time did not drift.

Faction patrol tinting similarly clones only the affected per-instance material before changing faction color. The browser proof confirmed distinct material UUIDs across factions and the expected faction tint values.

## Death and carcasses

The old generic carcass substitute has been removed from the production death path.

Killed wildlife now retains its actual species presentation while the existing gameplay semantics remain authoritative:

- harvest interaction still grants hide and removes the carcass;
- predator scent attraction remains functional;
- predator consumption removes the carcass and applies the existing regional predator consequence;
- corpse lifetime cleanup remains functional;
- hunted predator/prey population consequences remain gameplay-owned.

Rabbit uses a verified death animation. Deer has verified death clips. Wolf and boar use explicit static dead poses because their source GLBs do not contain death clips.

## Structural validation

Current Khronos glTF report:

- assets validated: **14** total;
- errors: **0**;
- warnings: **16** total;
- Phase 2 warnings: **12**, all `NODE_SKINNED_MESH_NON_ROOT`.

The Phase 2 warnings are explicitly reviewed in `docs/phase2/VALIDATOR_WARNING_REVIEW.md`. They are accepted for this target Three.js runtime based on direct gameplay-root, animation, clone-isolation, cleanup, and browser evidence; they are not hidden or claimed to be renderer-independent.

## Provenance and rights

Every Phase 2 production source has an item-level project license record and provenance record.

Recorded production sources are CC0 and include:

- CDmir — Deer Female;
- Quaternius — Animated Animals / Animal Pack Vol. 2;
- CDmir / TinyWorlds — Rabbit;
- Teh_Bucket — Boar;
- Quaternius — Animated Characters Pack.

Source archive hashes are preserved in the provenance ledger. Runtime hashes and semantic facts are regenerated from the actual output files.

## Regression evidence assembled before the final combined gate

The integration branch has already demonstrated:

- architecture/module-ratchet checks pass;
- UI/shader/visit/smoke suites pass;
- `SMOKE TEST PASSED`;
- persistence and recovery negative controls pass;
- representative performance probes pass;
- real keyboard input reaches the existing player controller;
- player gameplay root advances while presentation-local placement remains stable;
- desktop and narrow/mobile actor integration journeys pass;
- explicit asset failure preserves procedural fallback;
- wildlife, villagers, and patrols acquire/release AssetManager references correctly;
- faction materials are instance-owned;
- death, harvest, and predator-consumption semantics remain intact.

A prior integrated success run was `36527490688`. The final release decision must use the post-report run produced from the latest rebuilt human and wildlife bytes.

## Branch QA gate

This report is intentionally conservative: **Phase 2 is not yet marked complete.**

Next release gates:

1. final combined `phase2/living-actors` workflow succeeds after this report commit;
2. final live and diagnostic screenshots are inspected;
3. merge verified branch to `main`;
4. verify GitHub Pages deployment from merged `main`.
