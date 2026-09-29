# Phase 2 ValidationPlan — Living Actors

## Classification

Phase 2 is a production-integration phase for living actors in the existing Three.js game. It replaces procedural presentation with verified runtime assets while preserving the existing simulation, gameplay controllers, world state, spawning, ecology, faction pressure, dialogue, combat, persistence, streaming, and camera authority.

## Fixed scope

Phase 2 ultimately covers:

- player
- villagers
- faction patrols
- deer
- wolf
- boar
- rabbit
- animal carcasses / death presentation

The first bounded integration slice is player + deer using the already verified Phase 1 runtime fixtures. The remaining actor families stay procedural until their exact source assets are acquired, inspected, converted, validated, and integrated on this branch.

## Architecture contract

- Player and Actor gameplay groups remain the authoritative transform roots.
- Imported models are presentation children only.
- glTF animation may animate the imported presentation subtree but must not own gameplay position, yaw, AI state, health, ecology state, combat truth, or persistence.
- Asset loading uses stable logical IDs through the existing AssetManager.
- Procedural actor geometry remains an immediate fallback until a runtime asset has loaded successfully.
- Failed asset loading must leave a visible working actor, not an empty Group.
- Skinned instances use SkeletonUtils-backed cloning through AssetManager.
- Each independently animated live actor owns an independent AnimationMixer.
- Despawn/replacement must release AssetManager references and stop animation ownership.

## Mandatory Phase 2A gates — player + deer

- current main gameplay checks stay green
- player runtime model replaces only the player presentation child
- player movement still comes from Player.pos / velocity and synchronizes the gameplay root
- imported animation does not drift the gameplay root or presentation placement
- deer runtime model replaces only the deer presentation child
- deer gameplay logic still uses existing Actor state and movement
- deer semantic flee/movement state maps to the verified Run clip
- deer animation action time demonstrably advances
- asset failure fallback path remains present
- deer despawn releases one live AssetManager reference
- desktop and narrow/mobile live-game browser journeys pass
- screenshots come from the actual game canvas
- no page or console errors occur
- existing representative performance probes pass

## Full Phase 2 completion gates

Before Phase 2 can be called complete, all remaining actor families must also have:

- exact source identity and item-level license evidence
- preserved source bytes / hashes
- generated browser runtime assets
- Khronos structural validation
- verified node / skin / animation facts
- explicit semantic animation mapping based only on clips that physically exist
- live-game browser proof for the relevant behavior
- failure fallback behavior
- deterministic unload/despawn ownership
- visual review against the game's art direction
- no regression of ecology, villages, factions, dialogue, combat, saves, or player journeys

Carcasses/death presentation must remain semantically tied to the killed actor and must not break harvesting, predator scent behavior, corpse lifetime, or region-population consequences.

## Critical regressions

Reject the candidate if any of the following occurs:

- imported animation moves authoritative gameplay transforms
- actor model load failure makes an actor invisible or noninteractive
- player movement/camera/combat changes unintentionally
- animal AI/ecology consequences change because presentation changed
- villagers or patrols lose existing routines/faction semantics
- asset references leak across spawn/despawn cycles
- source/license/clip facts are guessed
- an existing game, performance, asset, or browser gate fails

## Completion rule

A successful first slice is Phase 2 PARTIAL, not COMPLETE. Phase 2 is complete only when every fixed actor family above satisfies the full contract and the merged main revision is successfully published.
