// Headless smoke test: boots the whole game inside jsdom with a stub renderer
// so every system (worldgen, simulation, streaming, entities, UI, interaction,
// save/load) is actually executed. Run with: npm run smoke
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

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
  setAnimationLoop(cb) { frameCb = cb; }
  dispose() { }
  get capabilities() { return { isWebGL2: true, getMaxAnisotropy: () => 1 }; }
}
globalThis.__LF_RENDERER = FakeRenderer;

// --- boot -------------------------------------------------------------------
const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));
process.on('unhandledRejection', (r) => errors.push('unhandled rejection: ' + (r && r.stack || r)));
process.on('uncaughtException', (r) => errors.push('uncaught: ' + (r && r.stack || r)));

const t0 = Date.now();
await import('../src/main.js');
await new Promise(r => setTimeout(r, 80));

const log = (...a) => console.log('  ', ...a);
console.log('\n THE LIVING FRONTIER — smoke test\n');

// start a fresh world
localStorage.removeItem('living_frontier_save_v1');
document.querySelector('#btn-new').click();
await new Promise(r => setTimeout(r, 2500));

const game = window.GAME || globalThis.GAME;
if (!game) { console.error('FAILED: game did not boot'); console.error(errors); process.exit(1); }
log('booted in', Date.now() - t0, 'ms');
log('terrain chunks:', game.chunks.chunks.size, '| veg chunks:', game.veg.chunks.size);
let objs = 0; game.scene.traverse(() => objs++);
log('scene objects:', objs);

// ---- drive frames ----------------------------------------------------------
let now = 0;
game.clock.getDelta = () => 0.033;
const step = (n) => { for (let i = 0; i < n; i++) { now += 33; frameCb && frameCb(); } };

step(30);
log('frames rendered:', drawCalls);

// ---- walk around -----------------------------------------------------------
const st = game.state, p = game.player;
game.input.keys.KeyW = true; game.input.keys.ShiftLeft = true;
step(240);
game.input.keys.KeyW = false; game.input.keys.ShiftLeft = false;
log('walked to', p.pos.x.toFixed(1), p.pos.z.toFixed(1), '| distance', st.player.stats.distance.toFixed(1), 'm');
let trail = 0; for (let i = 1; i < st.ground.length; i += 4) if (st.ground[i] > 0) trail++;
log('trail cells worn into the ground:', trail);

// ---- camera-relative controls -------------------------------------------
{
  const cam = game.camera;
  p.camYaw = 0; p.camPitch = 0.24; p._camInit = false;
  const { heightAt: H0 } = await import('../src/worldgen.js');
  p.pos.set(0, H0(0, 0), 0); p.vel.set(0, 0, 0);
  p.updateCamera(0.5, cam, game.input);
  const behind = cam.position.clone().sub(p.pos);
  const start = p.pos.clone();
  game.input.keys.KeyW = true;
  for (let i = 0; i < 40; i++) { p.update(0.033, game.input, cam); }
  game.input.keys.KeyW = false;
  const moved = p.pos.clone().sub(start).setY(0);
  const away = moved.clone().normalize().dot(behind.clone().setY(0).normalize());
  log('camera sits at', behind.x.toFixed(1), behind.z.toFixed(1), '| W moves', moved.x.toFixed(1), moved.z.toFixed(1),
    '| away-from-camera dot =', away.toFixed(2), away < -0.9 ? '✓ forward' : '✗ INVERTED');
  if (away > -0.9) errors.push('W does not move away from the camera (inverted controls)');
  // strafe
  p.pos.set(0, H0(0, 0), 0); p.vel.set(0, 0, 0); p.camYaw = 0;
  const s0 = p.pos.clone();
  game.input.keys.KeyD = true;
  for (let i = 0; i < 30; i++) p.update(0.033, game.input, cam);
  game.input.keys.KeyD = false;
  const right = p.pos.clone().sub(s0).setY(0).normalize();
  log('D moves', right.x.toFixed(2), right.z.toFixed(2), right.x > 0.85 ? '✓ right' : '✗ wrong');
  if (right.x < 0.85) errors.push('strafe direction wrong');
  // never below the terrain
  let sank = 0;
  const heightAt = H0;
  for (let i = 0; i < 200; i++) {
    game.input.keys.KeyW = true; game.input.keys.ShiftLeft = true;
    p.update(0.033, game.input, cam);
    if (p.pos.y < heightAt(p.pos.x, p.pos.z) - 0.4) sank++;
    if (cam.position.y < heightAt(cam.position.x, cam.position.z)) sank++;
  }
  game.input.keys.KeyW = false; game.input.keys.ShiftLeft = false;
  log('player/camera clipped below ground on', sank, 'of 200 frames', sank === 0 ? '✓' : '✗');
  if (sank > 4) errors.push('player or camera sinks through terrain');
}

// ---- harvest ---------------------------------------------------------------
let harvested = 0;
for (let t = 0; t < 60 && harvested < 6; t++) {
  const v = game.veg.nearest(p.pos.x, p.pos.z, 400);
  if (!v) break;
  p.pos.set(v.item.x, v.item.y, v.item.z + 1);
  game.interactTarget = game.findTarget();
  if (game.interactTarget && game.interactTarget.type === 'veg') { game.interact(); harvested++; }
  else { st.removeVeg(v.key, v.item.id, 999); game.veg.hideInstance(v.key, v.item); }
}
log('harvested', harvested, 'nodes ->', JSON.stringify(st.player.inv));

// ---- fire ------------------------------------------------------------------
// light it in the thickest fuel we can find so we exercise real spreading
let bestCell = 0;
for (let i = 0; i < st.fuel.length; i++) if (st.fuel[i] > st.fuel[bestCell]) bestCell = i;
const { fireToWorld } = await import('../src/worldstate.js');
const [fx0, fz0] = fireToWorld(bestCell);
st.weather.type = 'clear'; st.weather.intensity = 0;
const lit = st.ignite(fx0, fz0, 1);
log('fire lit at', fx0.toFixed(0), fz0.toFixed(0), '(fuel', st.fuel[bestCell], ') ->', lit);
let peak = 0;
for (let i = 0; i < 240; i++) { st.update(1.0); peak = Math.max(peak, st.burningCount()); }
let burn = 0; for (let i = 0; i < st.ground.length; i += 4) if (st.ground[i] > 40) burn++;
const region0 = st.regions[(await import('../src/worldstate.js')).regionIndex(fx0, fz0)];
log('fire: peak', peak, 'cells burning | scarred ground cells now', burn, '| local forest health', region0.trees.toFixed(2));
st.fastForward(60 * 60 * 2);
let burnLater = 0; for (let i = 0; i < st.ground.length; i += 4) if (st.ground[i] > 40) burnLater++;
log('scar still visible 2 sim-hours later:', burnLater, 'cells');

// ---- entities ------------------------------------------------------------
{ const { SETTLEMENTS } = await import('../src/worldgen.js');
  p.pos.set(SETTLEMENTS[0].x + 12, 0, SETTLEMENTS[0].z + 12); p.vel.set(0, 0, 0); }
// ---- entities (cont) -------------------------------------------------------------
step(120);
log('actors — animals:', game.actors.animals.length, 'villagers:', game.actors.npcs.length, 'soldiers:', game.actors.soldiers.length);
const animal = game.actors.animals.find(a => a.alive);
if (animal) {
  p.pos.copy(animal.pos); p.pos.z += 1.2;
  game.interactTarget = game.findTarget();
  const before = st.regions[0].prey;
  animal.hp = 1; game.strike();
  log('struck an animal ->', animal.alive ? 'survived' : 'killed', '| hunted total', st.player.stats.hunted);
}

// ---- simulation over time --------------------------------------------------
const before = st.settlements.map(s => ({ n: s.name, p: s.prosperity, b: s.buildings }));
st.fastForward(60 * 60 * 3);
st.player.stats.felled += 0;
const after = st.settlements.map(s => ({ n: s.name, p: s.prosperity, b: s.buildings, a: s.abandoned, st: s.status }));
log('3 simulated hours later:');
for (let i = 0; i < after.length; i++) {
  log(`   ${after[i].n}: prosperity ${before[i].p.toFixed(2)} -> ${after[i].p.toFixed(2)}, buildings ${before[i].b} -> ${after[i].b} (${after[i].a ? 'abandoned' : after[i].st})`);
}
log('day', st.day, '| territory', st.factions.map(f => f.territory).join('/'), '| quests', st.quests.length, '| journal', st.journal.length);

// ---- settlements visually react -------------------------------------------
game.syncStructures(0.1);
step(20);

// ---- UI panels -------------------------------------------------------------
for (const tab of ['map', 'bag', 'journal', 'world']) { game.ui.openPanel(tab); step(2); game.ui.closePanel(); }
log('UI panels rendered ok');
game.ui.toast('test'); game.ui.discovery('Test Landmark');

// ---- dialogue --------------------------------------------------------------
const npc = game.actors.npcs[0];
if (npc) { game.talkNPC(npc); log('dialogue opened:', document.querySelector('#dlg-name').textContent); game.ui.closeDialog(); }
game.settlementDialog(st.settlements[0], 0);
const opts = document.querySelectorAll('#dlg-options .btn');
st.player.inv.wood += 20;
opts[0].click();
log('gave wood to', st.settlements[0].name, '-> supplies', st.settlements[0].supplies.toFixed(2), 'rep', st.settlements[0].rep);
game.ui.closeDialog();

// ---- save / load round-trip ------------------------------------------------
st.player.inv.relic = 7;
const saved = st.save();
const raw = localStorage.getItem('living_frontier_save_v1');
log('save ok:', saved, '| size', (raw.length / 1024).toFixed(1), 'KB');
const { WorldState } = await import('../src/worldstate.js');
const reloaded = WorldState.deserialize(JSON.parse(raw));
const groundMatch = reloaded.ground.every((v, i) => v === st.ground[i]);
log('reload: day', reloaded.day, '| relics', reloaded.player.inv.relic, '| ground map identical:', groundMatch,
  '| burn scars preserved:', reloaded.ground.filter((v, i) => i % 4 === 0 && v > 40).length);

// ---- discoveries -----------------------------------------------------------
const { LANDMARKS } = await import('../src/worldgen.js');
for (const L of LANDMARKS) { p.pos.set(L.x, 0, L.z); game.checkDiscoveries(); }
log('landmarks discoverable:', Object.keys(st.discovered).length, '/', LANDMARKS.length);

step(30);
console.log('\n  errors:', errors.length ? errors : 'none');
console.log('  frames drawn:', drawCalls);
console.log(errors.length ? '\n SMOKE TEST FAILED\n' : '\n SMOKE TEST PASSED\n');
process.exit(errors.length ? 1 : 0);
