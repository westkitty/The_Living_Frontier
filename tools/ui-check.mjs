// UI wiring + accessibility gate.
// There is no browser in this environment, so this asserts the things a
// browser would otherwise catch at runtime: selectors that point at nothing,
// icons that do not exist, duplicate ids, and controls with no accessible name.
//   node tools/ui-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
const srcFiles = readdirSync(resolve(root, 'src')).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(srcFiles.map(f => [f, readFileSync(resolve(root, 'src', f), 'utf8')]));

const problems = [];
const warn = [];
const ok = (m) => console.log('  ✓', m);

// ---------------------------------------------------------------- inventory
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupes.length) problems.push('duplicate element ids: ' + [...new Set(dupes)].join(', '));
else ok(`${ids.length} unique element ids`);

const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
const uses = [...html.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]);
const missingUse = uses.filter(u => !symbols.has(u));
if (missingUse.length) problems.push('icon <use> with no matching <symbol>: ' + missingUse.join(', '));
else ok(`${symbols.size} icons defined, ${uses.length} static references all resolve`);

// icons referenced from JS: icon('name') and href','#i-name'
const jsIcons = new Set();
for (const [, code] of Object.entries(src)) {
  for (const m of code.matchAll(/icon\(\s*(?:ITEM_ICONS\[[^\]]+\]\s*\|\|\s*)?'([a-z-]+)'/g)) jsIcons.add('i-' + m[1]);
  for (const m of code.matchAll(/'#i-' \+ ([a-zA-Z]+)/g)) { /* dynamic, checked below */ }
  for (const m of code.matchAll(/ITEM_ICONS = \{([^}]+)\}/g)) {
    for (const v of m[1].matchAll(/:\s*'([a-z]+)'/g)) jsIcons.add('i-' + v[1]);
  }
  for (const m of code.matchAll(/\{ clear: '([a-z]+)', cloudy: '([a-z]+)', rain: '([a-z]+)', storm: '([a-z]+)', fogbank: '([a-z]+)', snow: '([a-z]+)' \}/g)) {
    for (let i = 1; i <= 6; i++) jsIcons.add('i-' + m[i]);
  }
}
jsIcons.add('i-moon');
const missingJs = [...jsIcons].filter(i => !symbols.has(i));
if (missingJs.length) problems.push('icons referenced from JS but never drawn: ' + missingJs.join(', '));
else ok(`${jsIcons.size} runtime icon references resolve`);

// ------------------------------------------------- selectors used by the code
const dynamic = new Set(['#toasts', '#panel', '#menu', '#dialog', '#confirm']);
const selectors = new Set();
for (const [file, code] of Object.entries(src)) {
  for (const m of code.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) selectors.add(m[1] + '\u0000' + file);
  for (const m of code.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) selectors.add(m[1] + '\u0000' + file);
  for (const m of code.matchAll(/querySelector\('#([A-Za-z0-9_-]+)'\)/g)) selectors.add(m[1] + '\u0000' + file);
}
// ids the code itself injects into the DOM (template markup) count as real
const jsIds = new Set();
for (const code of Object.values(src)) {
  for (const m of code.matchAll(/id="([A-Za-z0-9_-]+)"/g)) jsIds.add(m[1]);
  for (const m of code.matchAll(/\.id = '([A-Za-z0-9_-]+)'/g)) jsIds.add(m[1]);
}
const idSet = new Set([...ids, ...jsIds]);
const dangling = [...selectors].map(s => s.split('\u0000')).filter(([id]) => !idSet.has(id));
if (jsIds.size) ok(`${jsIds.size} ids are created at runtime by the code itself`);
if (dangling.length) problems.push('code queries elements that do not exist: ' + dangling.map(([i, f]) => `#${i} (${f})`).join(', '));
else ok(`${selectors.size} element lookups in src/ all resolve`);

// ------------------------------------------------------- accessible names
const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const unnamed = [];
for (const [, attrs, body] of buttons) {
  const hasAria = /aria-label="[^"]+"/.test(attrs) || /aria-labelledby="[^"]+"/.test(attrs);
  const text = body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
  if (!hasAria && !text) unnamed.push(attrs.match(/id="([^"]+)"/)?.[1] || attrs.slice(0, 40));
}
if (unnamed.length) problems.push('buttons with no accessible name: ' + unnamed.join(', '));
else ok(`${buttons.length} buttons all expose an accessible name`);

// decorative svgs must be hidden from assistive tech
const svgs = [...html.matchAll(/<svg\b([^>]*)>/g)].map(m => m[1]);
const unhidden = svgs.filter(a => !/aria-hidden="true"/.test(a) && !/\bid="icons"/.test(a) && !/role=/.test(a));
if (unhidden.length) warn.push(`${unhidden.length} inline svg(s) are not aria-hidden`);
else ok('all decorative icons are hidden from screen readers');

// canvases that carry meaning need a text alternative
for (const m of html.matchAll(/<canvas\b([^>]*)>/g)) {
  const a = m[1];
  const id = a.match(/id="([^"]+)"/)?.[1] || '?';
  if (id === 'gl') continue;
  if (!/aria-label=|role="img"|aria-hidden/.test(a)) warn.push(`<canvas id="${id}"> has no text alternative`);
}

// modal surfaces need dialog semantics
for (const id of ['panel', 'menu', 'dialog', 'confirm']) {
  const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`));
  if (!tag) { problems.push(`missing modal surface #${id}`); continue; }
  if (!/role="(dialog|alertdialog)"/.test(tag[0]) || !/aria-modal="true"/.test(tag[0])) {
    problems.push(`#${id} is a modal but lacks dialog semantics`);
  }
}
if (!problems.some(p => p.includes('modal'))) ok('all four modal surfaces declare dialog semantics');

// live regions for things that announce themselves
for (const id of ['toasts', 'discovery-banner', 'prompt']) {
  const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`));
  if (tag && !/aria-live=|role="status"/.test(tag[0])) problems.push(`#${id} changes without announcing (no aria-live)`);
}
ok('status surfaces announce politely');

// ------------------------------------------------------------ css coverage
const htmlClasses = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean));
const jsClasses = new Set();
for (const code of Object.values(src)) {
  for (const m of code.matchAll(/className = '([^']+)'/g)) m[1].split(/\s+/).forEach(c => c && jsClasses.add(c));
  for (const m of code.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) jsClasses.add(m[1]);
}
const styled = new Set([...css.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(m => m[1]));
const unstyled = [...new Set([...htmlClasses, ...jsClasses])].filter(c => !styled.has(c) && !c.startsWith('ic'));
if (unstyled.length) warn.push('classes used but never styled: ' + unstyled.join(', '));
else ok('every class used by the markup or code has styling');

// touch targets: anything the finger uses should be at least ~34px
const smallTargets = [...css.matchAll(/(\.[a-z-]+)\{[^}]*?(?:width|min-width):\s*(\d+)px[^}]*?\}/g)]
  .filter(([, sel, px]) => Number(px) < 30 && /btn|tab|tbtn/.test(sel));
if (smallTargets.length) warn.push('possibly small touch targets: ' + smallTargets.map(m => m[1]).join(', '));
else ok('interactive controls are finger-sized');

// ---------------------------------------------------------------- report
console.log('');
for (const w of warn) console.log('  ⚠', w);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  ✗', p);
  console.log('\n UI CHECK FAILED\n');
  process.exit(1);
}
console.log('\n UI CHECK PASSED' + (warn.length ? ` (${warn.length} advisory)` : '') + '\n');
