// Boots fresh documents/processes: first visit, no-WebGL, and persistent once-only guidance.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
if (process.argv[2] !== '--worker') {
  const run = (mode, data = {}) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', mode], {
      input: JSON.stringify(data), encoding: 'utf8', timeout: 30000,
    });
    if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error(`visit ${mode} failed (${r.status})`); }
    return JSON.parse(r.stdout.split('VISIT_RESULT ')[1].split('\n')[0]);
  };
  run('no-webgl');
  const first = run('first');
  run('return', first);
  run('salvage', { ...first, save: first.save.replace(/("journal":\[)[\s\S]*?(,"quests":)/, '$1{"text":"torn$2') });
  run('disabled');
  console.log(' VISIT CHECK PASSED — first visit, no-WebGL, six hints once across two boots, hints disabled');
} else {
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// --- minimal 2D canvas so the map/minimap code runs -------------------------
class FakeImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const ctx2d = () => new Proxy({
  canvas: null, font: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true,
  createImageData: (w, h) => new FakeImageData(w, h),
  getImageData: (x, y, w, h) => new FakeImageData(w, h),
  putImageData() { }, drawImage() { }, clearRect() { }, fillRect() { }, strokeRect() { },
  save() { }, restore() { }, beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { },
  fill() { }, stroke() { }, clip() { }, translate() { }, rotate() { }, scale() { }, fillText() { },
  createRadialGradient: () => ({ addColorStop() {} }),
  measureText: () => ({ width: 10 }), setTransform() { }, createLinearGradient: () => ({ addColorStop() { } }),
}, { get: (t, k) => (k in t ? t[k] : () => { }), set: (t, k, v) => (t[k] = v, true) });

window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') { const c = ctx2d(); c.canvas = this; return c; }
  return null;
};

// --- globals expected by the game ------------------------------------------
global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLCanvasElement = window.HTMLCanvasElement;
global.Image = window.Image;
global.ImageData = FakeImageData;
global.devicePixelRatio = 1;
global.innerWidth = 900; global.innerHeight = 640;
global.addEventListener = window.addEventListener.bind(window);
global.removeEventListener = window.removeEventListener.bind(window);
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
global.cancelAnimationFrame = clearTimeout;
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
global.confirm = () => false;
window.devicePixelRatio = 1;

// --- stub WebGL renderer ----------------------------------------------------
let frameCb = null, drawCalls = 0;
class FakeRenderer {
  constructor() {
    this.shadowMap = { enabled: false, type: null };
    this.domElement = window.document.querySelector('#gl');
    this.info = { render: { calls: 0, triangles: 0 } };
  }
  setPixelRatio() { } setSize() { } setClearColor() { } render() { drawCalls++; }
  setAnimationLoop(cb) { frameCb = cb; if (cb) cb(); }
  dispose() { }
  get capabilities() { return { isWebGL2: true, getMaxAnisotropy: () => 1 }; }
}
if (process.argv[3] !== 'no-webgl') globalThis.__LF_RENDERER = FakeRenderer;


const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const { SAVE_KEY } = await import('../src/worldstate.js');
const { HINTS } = await import('../src/guidance.js');
const key = 'living_frontier_settings_v1', mode = process.argv[3];
if (input.save) localStorage.setItem(SAVE_KEY, input.save);
if (input.settings) localStorage.setItem(key, input.settings);
if (mode === 'disabled') localStorage.setItem(key, JSON.stringify({ hints: false }));
await import('../src/main.js');
assert.equal(document.querySelector('#btn-continue').classList.contains('hidden'), !input.save);
if (mode === 'salvage') assert(/Recovered:.*lost or reset:.*journal/.test(document.querySelector('#save-recovery').textContent), 'boot must honestly report salvage before continuing');
document.querySelector(input.save ? '#btn-continue' : '#btn-new').click();
await new Promise(r => setTimeout(r, 2500));
if (mode === 'no-webgl') {
  assert(!window.GAME, 'no-WebGL must not start a broken game');
  assert(document.querySelector('#boot-status').textContent.includes('WebGL is not available'));
  console.log('VISIT_RESULT {}'); process.exit(0);
}
const game = window.GAME;
assert(game && drawCalls > 0, 'real game must boot and render through the seam');
const state = game.state, texts = [], toast = game.ui.toast.bind(game.ui);
game.ui.toast = (text, ...args) => { texts.push(text); toast(text, ...args); };
game.clock.getDelta = () => 0.01;
const tick = () => game.frame();
state.weather.type = 'rain'; state.weather.next = 999; tick();
assert.equal(document.querySelector('#fire-risk').textContent, 'damp');
assert.equal(document.querySelector('#fire-risk').getAttribute('aria-label'), 'Fire risk: damp');
state.weather.type = 'clear'; state.weather.groundWetness = 0; state.weather.windSpeed = 0.9; tick();
assert.equal(document.querySelector('#fire-risk').textContent, 'tinder');

// Actual game paths trigger the observations; do not call Guidance.once directly.
state.time = 0.5; tick(); state.time = 0.81; tick();
const tree = [...game.veg.chunks].flatMap(([key, c]) => c.items.map(item => ({ key, item })))
  .find(v => v.item.type === 'pine' || v.item.type === 'broad');
assert(tree, 'need a real harvestable tree');
// This assertion targets the vegetation interaction path. Random actor spawns must not mask it.
for (const list of [game.actors.animals, game.actors.npcs, game.actors.soldiers, game.actors.corpses]) list.length = 0;
game.player.pos.set(tree.item.x, tree.item.y + 1, tree.item.z);
const target = game.findTarget();
assert(target.canIgnite && target.alt.includes('tinder'), 'tinder risk must be in the real ignition prompt');
game.interactTarget = target;
game.strike(); tick();
assert(state.player.stats.fires > 0, 'tinder label must not break strike-to-ignite');
game.harvest(tree); tick();
state.fuel.fill(255);
state.ignite(game.player.pos.x + 30, game.player.pos.z, 1); tick();
const village = state.settlements[0];
game.player.pos.set(village.x, 10, village.z); tick();
state.note('A banner changed hands.', 'faction');
const { LANDMARKS } = await import('../src/worldgen.js');
const landmark = LANDMARKS.find(l => !state.discovered[l.id]);
game.player.pos.set(landmark.x, 10, landmark.z); tick();
for (let i = 0; i < 3; i++) { state.time = 0.5; tick(); state.time = 0.81; tick(); state.note('A banner changed hands.', 'faction'); }
for (const [id, text] of Object.entries(HINTS)) {
  assert(text.length < 90, `${id} hint is too long`);
  assert.equal(texts.filter(t => t === text).length, mode === 'first' ? 1 : 0, `${id} must fire exactly once across boots, and obey hints setting`);
}
assert(state.save());
console.log('VISIT_RESULT ' + JSON.stringify({ save: localStorage.getItem(SAVE_KEY), settings: localStorage.getItem(key) }));
process.exit(0);
}
