# THE LIVING FRONTIER

A mobile-first, third-person open-world exploration game built with Three.js.
One seamless wilderness of forests, rivers, mountains, ruins, caves, villages and
contested territory — and **the world remembers what you do in it**.

Everything is procedural: terrain, vegetation, creatures, buildings, landmarks,
weather, audio. There are no downloaded assets, no textures, no model files.
The only dependency is a vendored copy of Three.js (`vendor/three.module.js`).

```
open index.html through any static server, e.g.
    python3 -m http.server 8080      # then visit http://localhost:8080
```

---

## The core idea

Every system writes into one persistent world state that keeps simulating —
while you play, and while the game is closed. Come back an hour later and the
frontier has moved on without you.

| You do this | The world does this |
|---|---|
| Hunt heavily in a valley | Herds thin out, then predators starve, then the nearby village runs short of food and starts to decline |
| Kill the wolves | Deer multiply, overgraze, and the woodland slowly thins |
| Fell trees | Forest health drops, the village's timber supply falls, villagers resent you |
| Set a fire | It spreads with the wind, eats fuel, kills wildlife, leaves black scars and charred snags that stay for many in-world days |
| Plant saplings | Saplings visibly grow into trees; forest health recovers; herds return |
| Give supplies to a village | Scaffolding appears, new huts are built, fields expand, palisades go up, population grows |
| Neglect or ruin a village | Buildings collapse, roofs fall in, it becomes struggling → dying → abandoned rubble |
| Walk the same route repeatedly | A dirt trail is gradually worn into the ground, and vegetation stops growing on it |
| Kill a faction patrol | Their pressure in that region drops, rivals push in, borders move, banners change |
| Kill a villager | The whole village flees you, reputation collapses, its population drops |

Nothing above is scripted — it all falls out of the simulation.

## Systems

**World** — deterministic seeded heightfield (fBm + ridged mountains + warped
river network), streamed as 180 m chunks with three LOD levels around the
player, instanced vegetation, procedural biome colouring, bounded by an
impassable mountain ring. ~85 draw calls and ~80k triangles in a forest.

**Ground memory** — a 512×512 persistent RGBA state map covering the whole world
(burn / trail / lushness / development). Terrain, trees and grass all sample it
in their shaders, so consequences are visible in the world, not in a menu.

**Day / night + weather** — a full sky shader with sun, dusk, stars, drifting
cloud layers, and clear / cloudy / rain / storm / fog states that change fog
distance, light colour, wind strength, precipitation particles and fire spread.

**Ecology** — 144 regions each run a predator/prey model with carrying capacity
tied to forest health. Live animals near the player are spawned in proportion to
their region's population, so a hunted-out valley really does feel empty.

**Fire** — a 96×96 fuel/burning grid. Fire consumes fuel, spreads downwind, is
extinguished by rain, kills wildlife, strips forest health, and paints permanent
scars that take many days to green over.

**Settlements** — five villages whose prosperity chases the carrying capacity of
the land around them. Buildings, fields, walls, scaffolding, banners, rubble and
population all rebuild from world state. Villagers have day/night routines
(fields in the morning, work at midday, the fire in the evening, home at night).

**Factions** — three powers with campaigns, patrols, strongholds, supply
projection and overextension. Territory changes hands region by region; camps,
banners and fortress flags recolour with whoever holds the ground.

**Quests** — generated from actual world state (a starving village, thinning
herds, too many wolves, an undiscovered landmark), never from a fixed list.

**Landmarks** — the Broken Aqueduct, the Drowned Halls, Cliffhold, the Starfall
Crater, Fort Ashken, the Hollow Giant, plus three real, walkable caves carved
into hillsides with glowing crystals. Each is built from procedural geometry and
merged into a single mesh.

**Persistence** — the whole world (including the ground memory map, run-length
encoded per channel) is saved to `localStorage` in about 30 KB. On return, the
simulation fast-forwards through the time you were away.

## Controls

| | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrows | left stick |
| Look | drag, or move the mouse | drag the right side |
| Sprint | Shift | `»` toggle |
| Jump | Space | `⤒` |
| Interact | E | `E` |
| Strike / set fire | F or right-click | `✦` |
| Map / Bag / Journal / World | M / I / J / V | HUD icons |
| Menu | Esc | ☰ |

## Project layout

```
index.html          shell, HUD markup, import map
styles.css          all UI styling and transitions
vendor/three.module.js
src/rng.js          seeded hashing, value noise, fBm, ridged noise
src/worldgen.js     heightfield, biomes, rivers, landmark & settlement siting
src/worldstate.js   the persistent simulation + save/load + fast-forward
src/terrain.js      chunk streaming, LOD, ground-memory shader, water
src/veg.js          instanced procedural vegetation, wind, harvest, regrowth
src/structures.js   landmarks, villages, caves, camps, banners (merged meshes)
src/entities.js     wildlife, villager routines, faction patrols and combat
src/player.js       controller, spring camera, unified keyboard/touch input
src/fx.js           sky, lights, weather, fire, smoke, sparks, birds
src/ui.js           HUD, minimap, world map, panels, dialogue, touch stick
src/audio.js        fully procedural WebAudio ambience and effects
src/main.js         bootstrap, interaction system, quests, save loop
```

## Development checks

Because the sandbox this was built in has no GPU, two headless checks stand in
for manual testing:

```
npm install
npm run smoke      # boots the whole game in jsdom with a stub renderer:
                   # streaming, controls, harvesting, fire, ecology, factions,
                   # dialogue, UI panels and a save/load round-trip
npm run shaders    # assembles every custom shader with Three's chunks and
                   # parses the GLSL to catch syntax errors
```

`npm run smoke` asserts, among other things, that forward/strafe movement stays
camera-relative, that the player and camera never sink through terrain, that
fire leaves scars that survive a save/load cycle, and that the ground memory map
round-trips byte-for-byte.
