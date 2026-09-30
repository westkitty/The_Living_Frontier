# OPERATIONAL_STATE

## Current phase

Phases 1–4 implementation complete; Phase 5 release preparation in progress

## Verified baseline

Main revision at Phase 2 branch creation: `1a31b39106117680b3d4144385d81c3b71c4d1f4`.

Phase 1 asset lifecycle is complete and published. Phase 2 preserves the existing engine, renderer, authoritative gameplay roots, world-state ownership, persistence, interaction systems, browser journeys, and representative performance probes.

## Phase 2 invariant

Actor presentation may change. Gameplay authority may not migrate into imported model nodes or animation.

`Player.group` and `Actor.group` remain authoritative. Production models attach below them through `AssetManager`; procedural presentation remains the load-failure fallback.

## Current release candidate

All fixed Phase 2 actor families now have physically generated production runtime assets:

- player;
- male/female villagers;
- male/female patrol presentation;
- deer;
- wolf;
- boar;
- rabbit.

The current package contains 9 Phase 2 GLBs totaling 6,075,796 bytes.

Production integration includes per-instance animation mixers, safe per-instance faction tinting, verified semantic clip mappings, load fallback, deterministic reference release, and species-preserving carcasses.

Manual isolated visual review caught and corrected an sRGB/linear palette conversion defect. The rebuilt human and wildlife review probes now show the intended darker/natural skin, deer, and boar palettes without observed geometry loss.

## Verified behavior

Existing gameplay remains authoritative and regression gates have demonstrated:

- player movement/camera/controller ownership remains outside imported animation;
- actor AI, ecology, villages, factions, dialogue, combat, persistence, and interaction semantics remain gameplay-owned;
- independent animated instances do not share mixer/action state;
- wildlife harvest, predator consumption, corpse cleanup, and population consequences remain functional;
- faction material mutations are instance-owned;
- asset failures retain functional procedural presentation;
- representative spawn/despawn paths release asset references.

## Current gate

The report/contract update at this stage exists to trigger one final combined living-actor workflow against the latest rebuilt human and wildlife bytes.

Do not merge until that run passes and its final integrated live/diagnostic screenshots are manually inspected.

## Verified Phase 3 presentation seam

The existing procedural world remains authoritative. One verified Quaternius
pine presentation is attached to each active near streamed chunk, and one
verified Quaternius hut presentation is attached to each non-abandoned active
settlement. These are hybrid presentation overlays with explicit asset-manager
release on chunk unload and settlement rebuild; all other vegetation and
settlement families remain procedural by design pending their own source and
visual acceptance.

## Remaining release work

- complete exhaustive landmark/cave visual acceptance across distance, night,
  weather, and traversal states
- pass Playwright desktop and narrow/mobile journeys once Chromium is available
- capture final integrated screenshots and post-integration performance evidence
- merge verified branch to `main`
- confirm GitHub Pages deployment from merged `main`
- record the migration COMPLETE only after those release gates pass

## Quality pass — 2026-09-30

A separate pass over the whole project, with no change to the asset pipeline,
the gameplay authority boundaries above, or the save format.

Repaired, each with a regression assertion in `tools/smoke-test.mjs`:

- the world screen was rebuilt wholesale every two seconds, which destroyed the
  chart canvas, threw keyboard focus to `<body>` mid-sentence, and re-attached
  the Long Record button's handler on every pass. The shell is now built once
  and only the readings are rewritten;
- the chronicle chart drew into a 720x240 backing store shown in a 120-pixel
  box, so its axis labels rendered at 6–7 px, and its pointer mapping mixed
  backing-store pixels with CSS pixels. It is now sized to its box at device
  resolution like every other drawn surface (`src/surface.js`);
- a panel asked to close and then reopened inside its closing animation was
  hidden by the first request afterwards, leaving the game holding an invisible
  panel that blocked every input;
- the bag's only action was a `div` with a click handler, and every rebuild took
  the keyboard with it. Slots are buttons with names, and an empty slot stands
  down;
- the compass pips carried a label nothing could reach; the strip now says what
  it points at, and one unusable coordinate no longer poisons every bearing;
- sweeping the chart rewrote an `aria-live` region on every pointer move.

Added: the survey map can be opened into a full key naming every mark it draws;
a single click on a legend line now reads that line alone, which is what the
copy has always claimed; and the day selected on the chart now governs the
whole world screen rather than sitting beside numbers from today.

Not done, and still outstanding: Playwright browser journeys. Chromium cannot
be downloaded in this environment (`cdn.playwright.dev` and both fallbacks
refuse the connection), so no WebGL pixel or real-audio evidence was gathered.
Runtime QA here is jsdom plus the `@napi-rs/canvas` rasteriser, which exercises
the real drawing code but not the GPU.
