// Architecture gate.
//
// The module boundaries in this project are real, not decorative: the
// simulation must never reach up into the interface, the leaves must stay
// leaves, and nothing may import in a circle. A cycle between ui.js and
// panels.js once crashed the game at module-evaluation time and slipped past
// every other check, so that class of mistake is now a build failure.
//
//   node tools/arch-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const files = readdirSync(srcDir).filter(f => f.endsWith('.js'));

const problems = [];
const ok = (m) => console.log('  \u2713 ' + m);

// --- read the import graph --------------------------------------------------
const graph = new Map();
for (const f of files) {
  const code = readFileSync(resolve(srcDir, f), 'utf8');
  const deps = new Set();
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+'\.\/([A-Za-z0-9_.-]+)'/g)) deps.add(m[1]);
  for (const m of code.matchAll(/import\('\.\/([A-Za-z0-9_.-]+)'\)/g)) deps.add(m[1]);
  graph.set(f, deps);
}
console.log(`  read ${graph.size} modules`);

// --- no import cycles -------------------------------------------------------
const state = new Map();          // 0 = visiting, 1 = done
const stack = [];
const cycles = [];
function walk(n) {
  if (state.get(n) === 1) return;
  if (state.get(n) === 0) {
    cycles.push([...stack.slice(stack.indexOf(n)), n].join(' \u2192 '));
    return;
  }
  state.set(n, 0); stack.push(n);
  for (const d of graph.get(n) || []) if (graph.has(d)) walk(d);
  stack.pop(); state.set(n, 1);
}
for (const f of files) walk(f);
if (cycles.length) problems.push('import cycles: ' + [...new Set(cycles)].join(' | '));
else ok('no import cycles');

// --- layering ---------------------------------------------------------------
// Lower layers must not know about higher ones. The numbers are the only
// place this ordering is written down, so keep them honest.
const LAYER = {
  'rng.js': 0, 'worldgen.js': 1, 'settings.js': 1, 'uikit.js': 1,
  'worldstate.js': 2, 'cartography.js': 3,
  'terrain.js': 3, 'veg.js': 3, 'structures.js': 3, 'entities.js': 3, 'fx.js': 3, 'audio.js': 3,
  'player.js': 4, 'panels.js': 5, 'ui.js': 5,
  'interaction.js': 6, 'dialogue.js': 6, 'quests.js': 6,
  'main.js': 7,
};
const unplaced = files.filter(f => !(f in LAYER));
if (unplaced.length) problems.push('modules missing from the layer map: ' + unplaced.join(', ')
  + ' — add them to tools/arch-check.mjs so the boundary is a decision, not an accident');
for (const [f, deps] of graph) {
  for (const d of deps) {
    if (!(f in LAYER) || !(d in LAYER)) continue;
    if (LAYER[d] > LAYER[f]) problems.push(`${f} (layer ${LAYER[f]}) imports upward into ${d} (layer ${LAYER[d]})`);
  }
}
if (!problems.some(p => p.includes('upward'))) ok('every import points down the layer stack');

// --- the simulation stays headless -----------------------------------------
// worldstate/worldgen/rng must run with no DOM at all: that is what makes the
// headless smoke test, the offline fast-forward and the save format testable.
const HEADLESS = ['rng.js', 'worldgen.js', 'worldstate.js'];
for (const f of HEADLESS) {
  for (const d of graph.get(f) || []) {
    if (!HEADLESS.includes(d)) problems.push(`${f} must stay headless but imports ${d}`);
  }
  const code = readFileSync(resolve(srcDir, f), 'utf8');
  const uses = [...code.matchAll(/\b(document|window|localStorage|requestAnimationFrame)\b/g)].map(m => m[1]);
  const guarded = /typeof (document|window|localStorage)/.test(code);
  const bare = uses.filter(u => u !== 'localStorage');       // saving is allowed, and is try/caught
  if (bare.length && !guarded) problems.push(`${f} touches the DOM (${[...new Set(bare)].join(', ')}) but must stay headless`);
}
if (!problems.some(p => p.includes('headless'))) ok('the simulation core stays free of the DOM');

// --- one entry point --------------------------------------------------------
const importers = new Map();
for (const [f, deps] of graph) for (const d of deps) importers.set(d, (importers.get(d) || 0) + 1);
if (importers.get('main.js')) problems.push('main.js is the entry point and must not be imported by other modules');
else ok('main.js remains the only entry point');

const orphans = files.filter(f => f !== 'main.js' && !importers.get(f));
if (orphans.length) problems.push('modules nothing imports (dead code?): ' + orphans.join(', '));
else ok('no orphaned modules');

console.log('');
if (problems.length) {
  for (const p of problems) console.log('  \u2717 ' + p);
  console.log('\n ARCHITECTURE CHECK FAILED\n');
  process.exit(1);
}
console.log(' ARCHITECTURE CHECK PASSED\n');
