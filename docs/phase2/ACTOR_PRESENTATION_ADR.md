# Phase 2 ADR — Gameplay Root / Presentation Child

Status: ACCEPTED

## Context

The existing game already has authoritative player and actor state:

- Player.pos / velocity / yaw and player controller own player movement.
- Actor.pos / yaw / state, ActorSystem AI, ecology, combat, settlement and faction systems own NPC/wildlife behavior.
- Player.group and Actor.group are synchronized from those gameplay values.
- Procedural body/limb geometry is presentation only.

Phase 2 needs to replace presentation with skinned glTF actors without moving gameplay authority into model nodes or animation tracks.

## Decision

Keep each existing gameplay group as the authoritative transform root.

Attach a runtime model beneath that root as a presentation child:

gameplay state -> gameplay root transform -> imported presentation root -> bones / skinned meshes

Rules:

1. Imported animation never owns gameplay position, yaw, AI state, health, combat truth, ecology state, or persistence.
2. The imported model is cloned through the existing AssetManager / SkeletonUtils path.
3. Each independently animated actor owns independent AnimationMixer playback state.
4. Existing procedural geometry stays available as a load-failure fallback until the runtime asset has successfully loaded.
5. Despawn/death/replacement explicitly stops animation ownership and releases the AssetManager handle.
6. Semantic game states map only to animation clip names physically verified in the generated manifest.
7. Shared loaded geometry/material resources remain cache-owned; per-instance state must not mutate shared materials without first establishing explicit instance ownership.

## Evidence

This matches current Three.js guidance and examples:

- Three.js SkeletonUtils provides clone support for skinned model hierarchies.
- AnimationMixer is intended to manage animation playback for an animated object.
- The Three.js game manual demonstrates cloning loaded character scenes, keeping a separate parent transform for game movement, and creating per-character animation mixers.

References:

- https://threejs.org/docs/#examples/en/utils/SkeletonUtils
- https://threejs.org/docs/#api/en/animation/AnimationMixer
- https://threejs.org/manual/en/game.html
- https://threejs.org/examples/#webgl_animation_multiple

The project-specific evidence is stronger still: the first Phase 2 browser slice proved that player movement changes the gameplay root while the imported presentation root keeps stable local placement, and deer despawn releases its live asset reference.

## Rejected alternatives

### Make glTF scene nodes authoritative gameplay objects

Rejected. It would couple animation/authoring hierarchy to simulation, persistence, AI and collision semantics.

### Replace current movement/AI controllers with model-driven motion

Rejected. Phase 2 is a presentation integration phase, not a movement/AI rewrite.

### Hide procedural presentation before load completes

Rejected. A failed or slow asset request must not create an invisible actor.

## Consequence

Production actor art can be replaced incrementally without destabilizing the existing simulation. Asset-specific orientation, scale, clip mapping and visual variants remain presentation metadata rather than gameplay truth.
