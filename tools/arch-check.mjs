// Architecture gate.
//
// The module boundaries in this project are real, not decorative: the
// simulation must never reach up into the DOM, the leaves must stay
// leaves, and nothing may import in a circle. A cycle between ui.js and
// panels.js once crashed the game at module-evaluation time and slipped past
// every other check, so that class of mistake is now a build failure.
//
//   node tools/arch-check.mjs
import { execFileSync } from 'node:child_process';
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
  // note: imports may span several lines, so this must not be line-anchored
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'\.\/([A-Za-z0-9_.-]+)'/g)) deps.add(m[1]);
  for (const m of code.matchAll(/import\('\.\/([A-Za-z0-9_.-]+)'\)/g)) deps.add(m[1]);
  graph.set(f, deps);
}
console.log(`  read ${graph.size} modules`);

// --- layer map --------------------------------------------------------------
// Lower numbers = foundation (no deps upward). Higher = interface.
// Every import must point DOWN the layer stack (from higher layer to lower).
const LAYER = {
  // Layer 0: Foundation — no internal deps, headless
  'rng.js': 0,
  'worldgen.js': 0,
  'worldstate.js': 0,
  'world-recovery.js': 0,
  'chronology.js': 0,
  'history.js': 0,
  'persistence.js': 0,
  'save-recovery.js': 0,

  // Layer 1: Core simulation primitives
  'entities.js': 1,
  'structures.js': 1,
  'veg.js': 1,
  'terrain.js': 1,
  'streaming.js': 1,
  'magic.js': 1,
  'loop.js': 1,

  // Layer 2: Domain logic / analysis
  'causal.js': 2,
  'npc-memory.js': 2,
  'footprint.js': 2,
  'warnings.js': 2,
  'regional.js': 2,
  'recovery.js': 2,
  'quests.js': 2,
  'guidance.js': 2,
  'risk-monitor.js': 2,

  // Layer 3: Interface / presentation
  'ui.js': 3,
  'uikit.js': 3,
  'panels.js': 3,
  'map-ui.js': 3,
  'cartography.js': 3,
  'fx.js': 3,
  'fx-particles.js': 3,
  'audio.js': 3,
  'audio-procedural.js': 3,
  'settings.js': 3,
  'deeprecord.js': 3,
  'narrative.js': 3,

  // Layer 4: Entry point
  'main.js': 4,
};

// --- no import cycles -------------------------------------------------------
const visitState = new Map();          // 0 = visiting, 1 = done
const stack = [];
const cycles = [];
function walk(n) {
  if (visitState.get(n) === 1) return;
  if (visitState.get(n) === 0) {
    cycles.push([...stack.slice(stack.indexOf(n)), n].join(' \u2192 '));
    return;
  }
  visitState.set(n, 0); stack.push(n);
  for (const d of graph.get(n) || []) if (graph.has(d)) walk(d);
  stack.pop(); visitState.set(n, 1);
}
for (const f of files) walk(f);
if (cycles.length) problems.push('import cycles: ' + [...new Set(cycles)].join(' \u2192 '));
else ok('no import cycles');

// --- the simulation stays headless -----------------------------------------
// worldstate/worldgen/rng must run with no DOM at all: that is what makes the
// headless smoke test, the offline fast-forward and the save format testable.
const HEADLESS = ['history.js', 'persistence.js', 'save-recovery.js', 'rng.js', 'worldgen.js', 'world-recovery.js', 'worldstate.js', 'chronology.js'];
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

// --- every imported name is actually used ----------------------------------
// Stale imports are how a module quietly keeps a dependency it no longer has,
// which makes the layer map above a lie.
for (const f of files) {
  const code = readFileSync(resolve(srcDir, f), 'utf8');
  // remove import statements (single or multi-line) before looking for uses,
  // but keep re-exports: `export { x } from ...` is itself a use.
  const body = code.replace(/(^|\n)import\s[^;]*?;/g, '\n');
  for (const m of code.matchAll(/(^|\n)import\s+\{([^}]*)\}\s+from\s+'([^']+)';/g)) {   // { } may wrap lines
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      const re = new RegExp(`(?<![A-Za-z0-9_$.])${name.replace('$', '\\$')}(?![A-Za-z0-9_$])`);
      if (!re.test(body)) problems.push(`${f} imports ${name} from ${m[3]} but never uses it`);
    }
  }
}
if (!problems.some(p => p.includes('never uses it'))) ok('no unused imports');

// --- no module uses a name another module exports without importing it -----
// This is the shape of the bug that once crashed the bag panel: the code read
// fine, the tests were green, and the first real click threw ReferenceError.
const exportsOf = new Map();
for (const f of files) {
  const code = readFileSync(resolve(srcDir, f), 'utf8');
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const s of m[1].split(',')) { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) names.add(n); }
  }
  exportsOf.set(f, names);
}
const owner = new Map();
for (const [f, ns] of exportsOf) for (const n of ns) if (!owner.has(n)) owner.set(n, f);
for (const f of files) {
  const code = readFileSync(resolve(srcDir, f), 'utf8');
  // template literals hold GLSL and HTML, which share words with our exports
  const scan = code.replace(/`[\s\S]*?`/g, '``').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const known = new Set();
  for (const m of code.matchAll(/import\s+(?:\*\s+as\s+([A-Za-z0-9_$]+)|{([^}]*)\}|([A-Za-z0-9_$]+))\s+from/g)) {
    if (m[1]) known.add(m[1]);
    if (m[3]) known.add(m[3]);
    if (m[2]) for (const s of m[2].split(',')) { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) known.add(n); }
  }
  for (const m of code.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)) known.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const s of m[1].split(',')) { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) known.add(n); }
  }
  for (const [name, from] of owner) {
    if (from === f || known.has(name) || name === '$') continue;
    const re = new RegExp(`(?<![A-Za-z0-9_$.'"\`])${name}(?![A-Za-z0-9_$])`);
    if (re.test(scan)) problems.push(`${f} uses ${name} (exported by ${from}) without importing it`);
  }
}
if (!problems.some(p => p.includes('without importing'))) ok('no module leans on an import it never declared');

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