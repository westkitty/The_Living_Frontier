// Visual QA: boots the real game in jsdom but backs every 2D canvas with a
// real rasteriser (@napi-rs/canvas), so the production map/minimap drawing code
// actually renders pixels. Writes PNGs to <out dir> for human inspection.
//   node tools/visual-qa.mjs [outDir]
import { JSDOM } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || '/tmp/lf-visual');
mkdirSync(out, { recursive: true });
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// back jsdom canvases with a real rasteriser
const backing = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== '2d') return null;
  let b = backing.get(this);
  const w = Number(this.width) || 300, h = Number(this.height) || 150;
  if (!b || b.width !== w || b.height !== h) {
    b = createCanvas(w, h); backing.set(this, b);
  }
  const ctx = b.getContext('2d');
  if (!ctx.__wrapped) {
    ctx.__wrapped = true;
    const di = ctx.drawImage.bind(ctx);
    ctx.drawImage = (img, ...rest) => di(backing.get(img) || img, ...rest);
  }
  try { ctx.canvas = this; } catch (e) { /* read-only */ }
  return ctx;
};
const png = (el, name) => {
  const b = backing.get(el);
  if (!b) { console.log('  (no pixels for ' + name + ')'); return; }
  writeFileSync(resolve(out, name), b.toBuffer('image/png'));
  console.log('  wrote', name, b.width + 'x' + b.height);
};

global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.location = window.location;
global.localStorage = window.localStorage;
global.HTMLCanvasElement = window.HTMLCanvasElement;
global.Image = window.Image;
global.ImageData = window.ImageData;
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

class FakeRenderer {
  constructor() { this.shadowMap = {}; this.domElement = window.document.querySelector('#gl'); this.info = { render: {} }; }
  setPixelRatio() { } setSize() { } setClearColor() { } render() { }
  setAnimationLoop() { } dispose() { }
  get capabilities() { return { isWebGL2: true, getMaxAnisotropy: () => 1 }; }
}
globalThis.__LF_RENDERER = FakeRenderer;

await import('../src/main.js');
await new Promise(r => setTimeout(r, 60));
const { SETTLEMENTS } = await import('../src/worldgen.js');
localStorage.removeItem('living_frontier_save_v1');
document.querySelector('#btn-new').click();
await new Promise(r => setTimeout(r, 2500));
const game = window.GAME;
if (!game) { console.error('game did not boot'); process.exit(1); }
const state = game.state;
game.ui.buildBaseMap(220);

// give the world some history so the map has something to show
state.fastForward(60 * 60 * 20);
const p = game.player;
// walk a real route between the villages, through the production sight path
const route = [SETTLEMENTS[0], SETTLEMENTS[1], SETTLEMENTS[3], SETTLEMENTS[0]];
const { heightAt } = await import('../src/worldgen.js');
for (let leg = 0; leg < route.length - 1; leg++) {
  const a = route[leg], b = route[leg + 1];
  const n = 260;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const wob = Math.sin(t * 9) * 60;
    const x = a.x + (b.x - a.x) * t + wob, z = a.z + (b.z - a.z) * t + Math.cos(t * 7) * 50;
    p.pos.set(x, heightAt(x, z), z);
    state.paintGround(x, z, 1, 0.55, 3);
    game.sightTimer = 0;
    game.updateSight(0.4);
    state.update(0.4);
  }
}
state.ignite(SETTLEMENTS[1].x + 40, SETTLEMENTS[1].z + 30, 1);
for (let i = 0; i < 400; i++) state.update(0.5);

console.log('rendering map surfaces…');
for (let i = 0; i < 12; i++) game.ui.drawMinimap(p);   // let the detail tile finish
game.ui.drawMinimap(p);
png(document.querySelector('#minimap'), 'minimap.png');
game.ui.drawBigMap();
png(document.querySelector('#bigmap'), 'bigmap.png');
console.log('done ->', out);
process.exit(0);
