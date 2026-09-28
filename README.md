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
impassable mountain ring. 92 draw calls and ~80k triangles in the standard forest probe. Distant dense
forest patches use a single low-poly, vertex-coloured canopy mesh per chunk;
scorched patches omit those shells, and unloading disposes their geometry.

**Ground memory** — a 512×512 persistent RGBA state map covering the whole world
(burn / trail / lushness / development). Terrain, trees and grass all sample it
in their shaders, so consequences are visible in the world, not in a menu.

**Day / night + weather** — a full sky shader with sun, dusk, stars, drifting
cloud layers, and clear / cloudy / rain / storm / fog states that change fog
distance, light colour, wind strength, precipitation particles and fire spread.

**Ecology** — 144 regions each run a predator/prey model with carrying capacity
tied to forest health. Live animals near the player are spawned in proportion to
their region's population, so a hunted-out valley really does feel empty.
Killed animals leave small dark carcasses for one in-world day. Nearby predators
prefer that scent over hunting, consume the carcass and gain a small population
benefit. Press E to harvest hide before they reach it. Carcasses are temporary
live-scene objects, not saved inventory caches; at most 48 are kept at once.

**Fire** — a 96×96 fuel/burning grid. Fire consumes fuel, spreads downwind, is
extinguished by rain, kills wildlife, strips forest health, and paints permanent
scars that take many days to green over. The HUD's **damp / dry / tinder** risk
uses the same rain, lingering ground wetness and wind multiplier as fire spread;
it is not a separate prediction model. Tinder conditions also appear in the
strike-to-ignite prompt. Rain leaves damp ground after the weather clears.

**Settlements** — five villages whose prosperity chases the carrying capacity of
the land around them. Buildings, fields, walls, scaffolding, banners, rubble and
population all rebuild from world state. Villagers have day/night routines
(fields in the morning, work at midday, the fire in the evening, home at night).
Hunter villagers make return journeys to the nearest living neighbouring village.
Moving villagers and patrols sample candidate steps, prefer worn ground and
leave a little more wear with each metre. Paths emerge from active actors, not
from authored road geometry or a pathfinding graph. Distant/offline abstract
population simulation does not lay down trails.

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
plantings, quests, chronicle) is saved to `localStorage` with run-length encoded ground and survey planes.
Saves start small and grow with the land changed and explored (the smoke
scenario is about 53 KB), rather than having a fixed 40 KB ceiling. On return, the simulation fast-forwards through the time
you were away. If storage is full or blocked the game says so instead of
quietly losing your frontier. A damaged save is quarantined when storage allows,
then intact sections are recovered independently. The boot screen names what
survived and what was lost or reset. A torn journal loses its diary, not intact
ground, survey, regions, settlements or player position. Unknown loss counts
are explicitly reported as unknown. Recovery does not fast-forward the land
before handing it back; an unreadable shell with no world data is not called a
recovery.

## Controls

| | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrows | left stick |
| Look | drag, or move the mouse | drag the right side |
| Sprint | Shift | `»` toggle |
| Jump | Space | `⤒` |
| Interact / harvest carcass hide | E | `E` |
| Strike / set fire | F or right-click | `✦` |
| Mend yourself | Q | tap an item in the bag |
| Map / Bag / Journal / World | M / I / J / V | HUD icons |
| The Long Record | R; focus a sealed readout and press Enter/Space to set its waypoint | world screen → Read the Long Record; tap a sealed readout to set its waypoint |
| Help | H | Menu → Controls |
| Menu | Esc | ☰ |

The survey map supports drag to pan, scroll or pinch to zoom, arrow keys and
`+` / `-` when focused, and tap-to-set-waypoint. Sound, detail level, look
speed, volume, inverted look and reduced motion are all remembered between
sessions, separately from the world save. Contextual guidance gives one short
line on first nightfall, tree felled, fire lit, village entered, banner change
and landmark discovery. Each is remembered in `living_frontier_settings_v1`
across save loads and new worlds, and suppressed when `hints` is false.

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
from the same rows it draws. Isolate one series using the legend and three
y-axis gridlines show its real minimum, midpoint and maximum; the readout names
the unit. Multiple visible lines explicitly report that they are normalised.
Both chart canvases reserve touch drags for scrubbing instead of page scrolling.

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
for both settlements and patrols. Territory has a second non-colour cue:
solid-light Pact land, diagonal-hatched Legion land and dotted Kin land, all
below 20% fill opacity. The key beneath the survey map names both marker and
land patterns. A greyscale screenshot still distinguishes the factions.

The survey map describes itself too: its aria-label reports how wide the view
is, how much of the frontier you have surveyed, the settlements inside the
frame with their standing and banner — never one you have not found yet — and
the distance and bearing to your waypoint, using the same bearing maths as the
compass pips.

## The Long Record

The frontier did not begin when you arrived. Press **R**, or open it from the
world screen, and the ground opens into a core sample of every year this valley
has been counted — fourteen centuries of it, drawn from the same seed that
raised the terrain.

It opens on your own days, filling the screen, and then pulls back until they
are a hairline. Five lanes run down the column, one for each settlement site,
because the same five pieces of good ground keep being chosen: you can watch
them occupied, lost, left fallow and settled again, over and over, each band
coloured by how it ended — ash, silt, bone, iron, greenwood. Those are the same
five endings the living world still produces, which is the only reason the
column can be read at all.

The spine of named events is fixed and causal: the Starfall in year 0, the
aqueduct raised in 344 and *cut* in 761 — not fallen, cut, from the inside —
and the Drowned Halls flooded the same night, their doors barred from the
outside. Entries stay **SEALED** until you have stood in front of the stone
that carries them, so the archive is unlocked by walking, not by reading.
Scrub to a sealed year and its readout offers a native button: activate it to
mark that stone on your compass, write a journal reminder and close the record.
Discovery replaces that control with the unsealed account. The living band's
war ending measures banner changes recorded during your tenancy, not the
territory factions already held when you arrived.

At the closest reading, each hair in your own band is a day you wrote something
on. At the widest, the readout does the arithmetic you were avoiding:

```
41 settlements have stood on these five sites. 4,693 people are accounted for
in this column. 10 burned, 10 drowned, 11 starved, 7 were taken, 8 walked out.
Your tenancy: 70 days — less than a tenth of one per cent of the record.
```

Every number there is measured, not written: the deep history is derived
deterministically from the world seed, and your band is read from your own
statistics — trees felled, animals taken, fires set, ground still scorched.

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
src/cartography.js  the atlas, fog of war, ground-memory wash, map glyphs and patterns
src/map-ui.js       survey gestures and drawing, mixed onto UI
src/settings.js     player preferences, stored apart from the world
src/worldgen.js     heightfield, biomes, rivers, landmark & settlement siting
src/worldstate.js   persistent simulation + fast-forward
src/persistence.js  save/load, compression and recovery orchestration
src/save-recovery.js section validation and conservative damaged-JSON recovery
src/history.js      daily measurements and homecoming comparisons
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
src/guidance.js     once-only contextual teaching, backed by settings
src/loop.js         frame loop, discovery, sight and ambient helpers
src/streaming.js    chunk lifetime, ground uploads and structure syncing
src/main.js         bootstrap and systems wiring
```

## Development checks

Because the sandbox this was built in has no GPU or audio device, automated
checks cover logic, shader syntax and rasterised 2D surfaces, not WebGL pixels
or audible output:

```
npm install
npm run check      # arch + ui + shaders + visit + smoke, in that order
npm run arch       # module boundaries: no import cycles, no upward imports,
                   #   the simulation core stays DOM-free, no unused imports,
                   #   no module using a name it never imported, one entry
                   #   point, no orphaned modules; 700-line absolute limit,
                   #   per-module shrinking ceilings in tools/module-lines.json
npm run ui         # wiring & accessibility gate: dangling selectors, missing
                   # icons, duplicate ids, unnamed buttons, modal semantics,
                   # live regions, unstyled classes, touch target sizes, and
                   # that every control in the markup reaches a real handler;
                   # focusable canvases in HTML and runtime templates must
                   # declare touch-action:none in their id rule
npm run shaders    # assembles every custom shader with Three's chunks and
                   # parses the GLSL to catch syntax errors
npm run visit      # real fresh/return/salvaged boots, no-WebGL fallback and
                   # six hints firing only once across independent processes
npm run smoke      # boots the whole game in jsdom with a stub renderer
npm run visual     # renders the real map code with a real rasteriser and
                   # writes PNGs to /tmp/lf-visual for inspection
npm run perf       # scene budget, FX/fire/recovery probes and adaptive-quality regressions
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
that walking a four-kilometre round trip leaves the scene the size it started
— no leaked chunks, no detached meshes — that the deep record is deterministic
per seed and chronological, that fresh tenancies are not branded as war,
that journalled banner changes yield war and heavy hunting overrides it,
that sealed readout buttons focus, set the correct waypoint, journal the trip
and close the record, that entries unseal when the matching landmark is found,
that reading a year reports what actually stood there, that
the opening pull-back ends at the whole record, that footfalls change with the
ground underfoot, and that preferences persist across sessions.

The smoke gate also runs `tools/refinement-test.mjs`: real raster alpha signatures
for all three territory patterns; 20 actor-simulation days comparing a village
route with a parallel control 100 m away; worn-step preference; canopy ownership,
burn exclusion and disposal; actual drawn isolated-series tick labels; predator
attraction, feeding, carcass decay, hide harvest and scene cleanup; identically
seeded damp/tinder ignitions; and damaged-diary salvage with byte-for-byte ground
and survey comparisons. `npm run perf` enforces the canopy budget: at most 96
meshes and 99,915 triangles in its standard route.

The module-size ratchet records the largest module and individual ceilings.
Lower ceilings when shrinking modules; adding 200 lines to **any** source module
fails. A ceiling cannot be raised relative to the preceding commit to bypass the
gate. See [verification notes](tools/VERIFICATION.md) for deliberate failure tests
and historical refinement data. [Current performance notes](tools/PERFORMANCE.md)
record paired before/after scorecards, methodology and limitations, and link the
[fire](tools/fire-perf-probe.mjs) and [recovery](tools/recovery-perf-probe.mjs)
probes.

The harness also proves it finished: if the run stops early — an exception in
a jsdom callback used to end it quietly, which is how a missing import once
slipped through — it prints `SMOKE TEST ENDED EARLY` and exits non-zero rather
than looking like a pass.

Known gap: there is no GPU in the build environment, so the WebGL render path
itself is exercised against a stub renderer. Shaders are validated by parsing,
the 2D map surfaces are validated by rasterising them for real, and game behaviour is exercised headlessly. Audible output and actual WebGL
pixels remain unverified; these checks are not substitutes for device playtesting.
