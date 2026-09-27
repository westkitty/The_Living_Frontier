# THE LIVING FRONTIER

A mobile-first, third-person open-world exploration game built with Three.js.
One seamless wilderness of forests, rivers, mountains, ruins, caves, villages and
contested territory — and **the world remembers what you do in it**.

Everything is procedural: terrain, vegetation, creatures, buildings, landmarks,
weather, audio and maps. There are no downloaded assets, no texture files and
no model files; the interface iconography is a hand-drawn inline SVG family
defined once in `index.html`. The only third-party code is a vendored copy of
Three.js (`vendor/three.module.js`, MIT — see `vendor/README.md`), so the game
has no network dependency at all.

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

**The map you make yourself** — the world starts as blank paper. Land is inked
in only where you have actually been, and how far you can survey depends on
where you stand: from a ridge you can map several hundred metres, from a hollow
almost nothing, and rain, fog and darkness close it in further. The survey is
persistent, so the map is a record of your own travels. Tap it to plant a
waypoint; it rides the compass until you arrive.

**Persistence** — the whole world (ground memory, surveyed map, waypoint,
plantings, quests, chronicle) is saved to `localStorage` in under 40 KB, all
run-length encoded. On return, the simulation fast-forwards through the time
you were away. If storage is full or blocked the game says so instead of
quietly losing your frontier.

## Controls

| | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrows | left stick |
| Look | drag, or move the mouse | drag the right side |
| Sprint | Shift | `»` toggle |
| Jump | Space | `⤒` |
| Interact | E | `E` |
| Strike / set fire | F or right-click | `✦` |
| Mend yourself | Q | tap an item in the bag |
| Map / Bag / Journal / World | M / I / J / V | HUD icons |
| Help | H | Menu → Controls |
| Menu | Esc | ☰ |

The survey map supports drag to pan, scroll or pinch to zoom, arrow keys and
`+` / `-` when focused, and tap-to-set-waypoint. Sound, detail level, look
speed, volume, inverted look and reduced motion are all remembered between
sessions, separately from the world save.

Sound is fully procedural WebAudio — no audio files. The beds are driven by
simulation state rather than by a playlist: wind and rain from the weather,
fire from burning cells near you, water from the nearest shore or river bed,
and a low hearth hum that rises as you approach a village that is doing well.
Footfalls change with the ground you are standing on — ash crunches, packed
village paths and worn trails ring harder, grass is soft.

The title screen draws a portrait of the world you are about to return to,
rendered from that save's own exploration plane: only the ground you actually
surveyed, with your villages, your burn scars and where you stopped walking.

## The world screen is a chart of what you did

The frontier takes one compact reading of its own vital signs every in-world
day — herd numbers, predator numbers, forest cover, scorched cells, faction
territory and average village prosperity — and keeps the last 90 of them in
the save (a few hundred bytes). The world screen draws them as a chronicle:
five lines, each normalised against its own range, so an over-hunted herd
crashing or a burn scar spreading is visible as a shape rather than a number.
The chart carries a plain-language summary as its accessible label, generated
from the same rows it draws.

It can be read, not just looked at. Drag across it — or focus it and use the
arrow keys, Home and End — and a cursor lands on a day, reports that day's
numbers, and lists what the chronicle recorded then. Days you have entries for
are ticked along the axis, so the chart doubles as an index into the journal;
and every day heading in the chronicle is a button that opens the chart on
that day. The accessible label updates with the selected day, so the readout
is available without seeing the drawing.

## Heraldry, and never colour alone

The three factions have crests drawn in the same line-art family as the rest of
the sprite: the Verdant Pact a warded shield with a sprig, the Ashen Legion an
iron shield and spear, the Hollow Kin two standing stones under a moon. They
appear wherever allegiance matters — the world screen, each settlement's entry,
the standing line in the bag, the homecoming report and the header of any
conversation held under a banner. Every crest ships with the faction's name in
text for assistive technology, so ownership is never signalled by colour alone.

On the maps the same rule holds in pixels: each faction owns a silhouette as
well as a colour — the Pact round, the Legion square, the Kin triangular — used
for both settlements and patrols, with a key printed under the survey map. A
greyscale screenshot still tells you who holds what.

The survey map describes itself too: its aria-label reports how wide the view
is, how much of the frontier you have surveyed, the settlements inside the
frame with their standing and banner — never one you have not found yet — and
the distance and bearing to your waypoint, using the same bearing maths as the
compass pips.

## Coming back

Every save carries a snapshot of the frontier: each settlement's buildings,
walls, banner and standing, faction territory, herd and pack numbers, forest
cover and burn scars. When you return after more than two minutes away, the
world is fast-forwarded and the new snapshot is compared against the old one,
and you are handed a short report of what actually changed while you were
gone — villages that grew or emptied, banners that flipped, land that was
taken, woods that thinned. The lines are derived from the simulation, not
written in advance; a frontier that genuinely did nothing says so. Every line
is also filed in the journal.

## Project layout

```
index.html          shell, HUD markup, import map
styles.css          all UI styling and transitions
vendor/three.module.js
src/rng.js          seeded hashing, value noise, fBm, ridged noise
src/cartography.js  the atlas, fog of war, ground-memory wash, map glyphs
src/settings.js     player preferences, stored apart from the world
src/worldgen.js     heightfield, biomes, rivers, landmark & settlement siting
src/worldstate.js   the persistent simulation + save/load + fast-forward
src/terrain.js      chunk streaming, LOD, ground-memory shader, water
src/veg.js          instanced procedural vegetation, wind, harvest, regrowth
src/structures.js   landmarks, villages, caves, camps, banners (merged meshes)
src/entities.js     wildlife, villager routines, faction patrols and combat
src/player.js       controller, spring camera, unified keyboard/touch input
src/fx.js           sky, lights, weather, fire, smoke, sparks, birds
src/ui.js           HUD, minimap, world map, panel shell, dialogue, touch stick
src/panels.js       bag, chronicle, world screen and the readable history chart
src/uikit.js        the shared icon helper and inventory icon table
src/audio.js        fully procedural WebAudio: state-driven beds and effects
src/interaction.js  what you are looking at, and what acting on it does
src/dialogue.js     villagers, soldiers and settlement halls
src/quests.js       quests generated from world state, and their consequences
src/main.js         bootstrap, systems wiring, discoveries, frame loop
```

## Development checks

Because the sandbox this was built in has no GPU, two headless checks stand in
for manual testing:

```
npm install
npm run check      # arch + ui + shaders + smoke, in that order
npm run arch       # module boundaries: no import cycles, no upward imports,
                   #   the simulation core stays DOM-free, no unused imports,
                   #   no module using a name it never imported, one entry
                   #   point, no orphaned modules
npm run ui         # wiring & accessibility gate: dangling selectors, missing
                   # icons, duplicate ids, unnamed buttons, modal semantics,
                   # live regions, unstyled classes, touch target sizes, and
                   # that every control in the markup reaches a real handler
npm run shaders    # assembles every custom shader with Three's chunks and
                   # parses the GLSL to catch syntax errors
npm run smoke      # boots the whole game in jsdom with a stub renderer
npm run visual     # renders the real map code with a real rasteriser and
                   # writes PNGs to /tmp/lf-visual for inspection
npm run perf       # chunk streaming cost, draw calls and triangle counts
```

`npm run smoke` asserts behaviour, not just absence of crashes: that forward
and strafe stay camera-relative, that the player and camera never sink through
terrain, that walking reveals map and a ridge reveals more than a hollow, that
the surveyed map and the ground memory round-trip byte-for-byte, that fire
scars survive a save/load cycle, that Escape closes a conversation instead of
opening the menu, that a destructive confirm does nothing unless it is held,
that a save which cannot be written reports failure after retrying with a
slimmer payload, that the daily history matches the live simulation and stays
bounded, that scrubbing the chart reports the selected day honestly and clamps
at both ends, that the chart legend reports each line's true value and range
and can isolate it, that the survey map's description matches what it draws
and never names an unsurveyed place, that no two factions share a map
silhouette, that the touch stick moves the player and releasing it stops them,
that the touch look drag turns the camera and each on-screen action button
feeds real input, that burn scars survive the save byte-for-byte, that giving
a village timber raises a real building in the scene geometry, that a captured
settlement's banner cloth changes colour, that setting a wooded chunk alight
turns standing trees into charred snags in the scene without re-scattering
that chunk every frame, that hunting a valley out leaves it visibly emptier,
that footfalls change with the ground underfoot, and that preferences persist
across sessions.

The harness also proves it finished: if the run stops early — an exception in
a jsdom callback used to end it quietly, which is how a missing import once
slipped through — it prints `SMOKE TEST ENDED EARLY` and exits non-zero rather
than looking like a pass.

Known gap: there is no GPU in the build environment, so the WebGL render path
itself is exercised against a stub renderer. Shaders are validated by parsing,
the 2D map surfaces are validated by rasterising them for real, and everything
else is validated by running it.
