// Headless smoke test: boots the whole game inside jsdom with a stub renderer
// so every system (worldgen, simulation, streaming, entities, UI, interaction,
// save/load) is actually executed. Run with: npm run smoke
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

// A test run that stops in the middle must never look like a pass. Node has
// been seen to end this script quietly when something throws deep inside a
// jsdom callback, so the run has to prove it reached its own last line.
let COMPLETED = false;
process.on('uncaughtException', (e) => { console.error('\n  uncaught exception:', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('\n  unhandled rejection:', e); process.exit(1); });
process.on('exit', () => {
  if (!COMPLETED) {
    console.error('\n SMOKE TEST ENDED EARLY — the run stopped before its final assertions\n');
    process.exitCode = 1;
  }
});

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
{
  const head = document.querySelector('#dlg-name');
  const ok = head.querySelector('.crest') && /Verdant Pact|Ashen Legion|Hollow Kin/.test(head.textContent);
  log('settlement dialogue names the banner it flies:', ok ? '✓' : '✗', JSON.stringify(head.textContent.slice(0, 40)));
  if (!ok) errors.push('settlement dialogue does not identify the faction in text');
}
const opts = document.querySelectorAll('#dlg-options .btn');
st.player.inv.wood += 20;
opts[0].click();
log('gave wood to', st.settlements[0].name, '-> supplies', st.settlements[0].supplies.toFixed(2), 'rep', st.settlements[0].rep);
game.ui.closeDialog();

// ---- the map you make by walking -------------------------------------------
{
  const fresh0 = st.exploredFraction();
  const { heightAt } = await import('../src/worldgen.js');
  // a walk across unknown country
  const sx = 300, sz = -300;
  for (let i = 0; i < 120; i++) {
    p.pos.set(sx + i * 6, heightAt(sx + i * 6, sz), sz);
    game.sightTimer = 0; game.updateSight(0.4);
  }
  const afterWalk = st.exploredFraction();
  log('surveyed by walking:', (fresh0 * 100).toFixed(1) + '%', '->', (afterWalk * 100).toFixed(1) + '%',
    afterWalk > fresh0 ? '✓' : '✗');
  if (afterWalk <= fresh0) errors.push('walking did not reveal any map');

  // standing on a peak must survey more ground than standing in a hollow
  // find the most and least prominent ground: prominence is what the sight
  // model actually keys on, so that is what the test must vary
  const prom = (x, z) => heightAt(x, z) -
    (heightAt(x + 210, z) + heightAt(x - 210, z) + heightAt(x, z + 210) + heightAt(x, z - 210)) / 4;
  const lowPos = [0, 0], peak = [0, 0];
  let lowest = 1e9, highest = -1e9;
  for (let x = -1000; x <= 1000; x += 60) for (let z = -1000; z <= 1000; z += 60) {
    if (heightAt(x, z) < 2) continue;
    const pr = prom(x, z);
    if (pr > highest) { highest = pr; peak[0] = x; peak[1] = z; }
    if (pr < lowest) { lowest = pr; lowPos[0] = x; lowPos[1] = z; }
  }
  const measure = (x, z) => {
    p.pos.set(x, heightAt(x, z), z);
    game.sightTimer = 0; game.updateSight(0.4);
    return game.sightRadius;
  };
  const rLow = measure(lowPos[0], lowPos[1]);
  const rHigh = measure(peak[0], peak[1]);
  log(`sight from a hollow (prominence ${Math.round(lowest)} m): ${Math.round(rLow)} m | from a ridge (prominence ${Math.round(highest)} m): ${Math.round(rHigh)} m`,
    rHigh > rLow * 1.3 ? '✓ climbing pays' : '✗');
  if (rHigh <= rLow * 1.3) errors.push('high ground does not extend the survey');

  // fog survives the save
  const snap = st.explored.slice();
  const round = (await import('../src/worldstate.js')).WorldState.deserialize(JSON.parse(JSON.stringify(st.serialize())));
  const same = round.explored.every((v, i) => v === snap[i]);
  log('remembered map survives save/load:', same ? '✓' : '✗');
  if (!same) errors.push('explored map lost on save/load');
}

// ---- waypoints & compass ----------------------------------------------------
{
  const ui = game.ui;
  ui.mapView = { cx: 0, cz: 0, span: 2300 };
  ui.tapMap({ x: 420, z: -180 });
  const w = ui.waypoint;
  log('waypoint set:', w ? `${w.x},${w.z}` : 'none', w && st.player.waypoint ? '✓ saved with the player' : '✗');
  if (!w || !st.player.waypoint) errors.push('waypoint not stored in player state');
  // a target dead ahead of the camera must sit at the centre of the compass
  p.pos.set(0, 0, 0); p.camYaw = 0;
  const ahead = { x: 0, z: -400 };            // camera at +Z looks toward -Z
  const heading = ((-p.camYaw + Math.PI) % 6.283185 + 6.283185) % 6.283185;
  let delta = ui.bearingTo(ahead.x, ahead.z) - heading;
  while (delta > Math.PI) delta -= 6.283185;
  while (delta < -Math.PI) delta += 6.283185;
  log('compass bearing error for a target straight ahead:', (delta * 57.3).toFixed(1) + '°', Math.abs(delta) < 0.02 ? '✓' : '✗');
  if (Math.abs(delta) > 0.02) errors.push('compass pips point the wrong way');
  ui.updateCompassPips(p);
  ui.tapMap({ x: 420, z: -180 });             // tapping it again lifts it
  if (ui.waypoint) errors.push('tapping a waypoint again did not lift it');
}

// ---- preferences persist ----------------------------------------------------
{
  const { Settings } = await import('../src/settings.js');
  Settings.load();
  Settings.set('quality', 'low');
  Settings.set('sensitivity', 1.6);
  Settings.set('muted', true);
  const again = Object.assign({}, Settings.values);
  Settings.values = {};
  Settings.load();
  const ok = Settings.get('quality') === 'low' && Settings.get('sensitivity') === 1.6 && Settings.get('muted') === true;
  log('preferences persist across sessions:', ok ? '✓' : '✗', JSON.stringify(Settings.values));
  if (!ok) errors.push('settings did not round-trip');
  game.setQuality('low');
  const lowRadius = game.chunks.radius;
  game.setQuality('high');
  log('quality switch changes streaming radius:', lowRadius, '->', game.chunks.radius, game.chunks.radius > lowRadius ? '✓' : '✗');
  if (game.chunks.radius <= lowRadius) errors.push('setQuality had no effect');
  Settings.set('quality', 'high'); Settings.set('muted', false); Settings.set('sensitivity', 1);
}

// ---- modal stack, focus and destructive confirmation ------------------------
{
  const ui = game.ui;
  const esc = () => window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  game.talkNPC(game.actors.npcs[0] || { name: 'x', role: 'farmer', settlement: st.settlements[0], pos: p.pos, faction: 0 });
  esc();
  const menuOpen = !document.querySelector('#menu').classList.contains('hidden');
  log('Escape closes the conversation instead of opening the menu:', !ui.dialogOpen && !menuOpen ? '✓' : '✗');
  if (ui.dialogOpen || menuOpen) errors.push('Escape stack is wrong with a dialogue open');

  let erased = false;
  ui.confirmAction('Erase this world?', 'test', 'Hold to erase', () => { erased = true; });
  log('confirm sheet blocks the world while open:', ui.blocking ? '✓' : '✗');
  if (!ui.blocking) errors.push('confirm sheet does not pause the game');
  ui.closeConfirm();
  log('dismissing the confirm did not erase anything:', !erased ? '✓' : '✗');
  if (erased) errors.push('confirm fired without being held');
}

// ---- reaching for food without opening the bag ------------------------------
{
  const ui = game.ui, inv = st.player.inv;
  p.hp = 40; p.stamina = 20;
  inv.berry = 0; inv.herb = 0; inv.hide = 0;
  const empty = ui.quickRestore();
  log('quick restore with an empty bag:', empty === false ? '✓ refuses' : '✗');
  if (empty !== false) errors.push('quickRestore consumed nothing but claimed success');
  inv.berry = 2;
  const hp0 = p.hp;
  const used = ui.quickRestore();
  log('quick restore eats a berry:', hp0, '->', p.hp, '| berries', inv.berry, used && p.hp > hp0 && inv.berry === 1 ? '✓' : '✗');
  if (!(used && p.hp > hp0 && inv.berry === 1)) errors.push('quickRestore did not consume and heal');
  p.hp = p.maxHp; p.stamina = 100;
}

// ---- the world keeps its own biography ------------------------------------
{
  const d0 = st.day, n0 = st.history.length;
  st.fastForward(60 * 60 * 3);                       // three real hours away
  const grew = st.history.length - n0;
  log(`history: ${st.day - d0} days passed, ${grew} daily samples recorded`);
  if (grew !== st.day - d0) errors.push('history did not record one sample per day');
  const row = st.history[st.history.length - 1];
  const live = (() => { let prey = 0; for (const r of st.regions) prey += r.prey; return Math.round(prey); })();
  log(`  last sample: day ${row[0]} herds ${row[1]} vs live ${live}`);
  if (row[0] !== st.day || Math.abs(row[1] - live) > Math.max(3, live * 0.05)) {
    errors.push('history sample does not match the live simulation');
  }
  // it survives the save, and it is bounded
  st.save();
  const { WorldState: WS } = await import('../src/worldstate.js');
  const back = WS.load();
  const same = JSON.stringify(back.history.slice(-5)) === JSON.stringify(st.history.slice(-5));
  log('  history survives save/load:', same ? '✓' : '✗', '| samples kept:', back.history.length);
  if (!same) errors.push('history did not survive the save');
  const spare = new WS();                       // a throwaway world, so the live one keeps its real past
  for (let i = 0; i < 150; i++) { spare.day++; spare.recordHistory(); }
  log('  history stays bounded at', spare.history.length, 'samples after 150 days');
  if (spare.history.length > 90) errors.push('history grows without bound');
  if (spare.history[0][0] !== spare.day - 89) errors.push('history did not keep the most recent days');
  // the chart has an honest text alternative
  const desc = game.ui.describeHistory(st);
  log('  chart alt text:', JSON.stringify(desc.slice(0, 96) + '…'));
  if (!/days:/.test(desc) || !/herds/.test(desc)) errors.push('history chart has no usable alt text');
}

// ---- the chronicle chart can be read, day by day --------------------------
{
  game.ui.openPanel('world');
  const cv = document.querySelector('#ws-chart');
  const h = st.history;
  // land on a day we know had something written in it
  const written = st.journal.find(e => h.some(r => r[0] === e.day));
  game.ui.chartDay = written ? written.day : h[Math.floor(h.length / 2)][0];
  game.ui.drawHistoryChart(st);
  const read = document.querySelector('#ws-read').textContent;
  const row = h[game.ui.chartIndex(h)];
  const okNums = read.includes(`Day ${row[0]}`) && read.includes(`${row[1]} herd animals`)
    && read.includes(`${row[3]}% forest`);
  const sameDay = st.journal.filter(e => e.day === row[0]);
  const okJournal = !sameDay.length || read.includes(sameDay[0].text.slice(0, 24));
  log(`chart readout for day ${row[0]}: numbers ${okNums ? '✓' : '✗'} | chronicle lines ${sameDay.length} ${okJournal ? '✓' : '✗'}`);
  if (!okNums) errors.push('chart readout does not report the selected day honestly');
  if (!okJournal) errors.push('chart readout does not surface that day\'s chronicle');

  // arrow keys walk the selection, and stop at the ends
  const before = game.ui.chartIndex(h);
  cv.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  const left = game.ui.chartIndex(h);
  cv.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  const end = game.ui.chartIndex(h);
  cv.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const past = game.ui.chartIndex(h);
  log(`keyboard scrub: ${before} -> left ${left} -> End ${end} -> clamped ${past} of ${h.length - 1}`);
  if (left !== before - 1 || end !== h.length - 1 || past !== h.length - 1) {
    errors.push('keyboard scrubbing does not move or clamp correctly');
  }
  // and a pointer drag picks a different day than the keyboard left it on
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 240, right: 720, bottom: 240 });
  cv.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 20, bubbles: true }));
  const dragged = game.ui.chartIndex(h);
  log(`pointer at the left edge selects sample ${dragged} (day ${h[dragged][0]})`);
  if (dragged !== 0) errors.push('dragging the chart does not select the day under the pointer');
  // the panel refreshing must not throw the reader off their day
  const held = game.ui.chartDay;
  game.ui.renderWorldState();
  if (game.ui.chartDay !== held) errors.push('refreshing the world screen loses the selected day');
  // the legend reports real scale and can isolate a line
  {
    const hh = st.history, ci = game.ui.chartIndex(hh);
    const legs = document.querySelectorAll('#ws-legend .leg');
    const first = legs[0];
    const shownVal = first.querySelector('span').textContent;
    const shownRange = first.querySelector('em').textContent;
    let lo = Infinity, hi = -Infinity;
    for (const row of hh) { lo = Math.min(lo, row[1]); hi = Math.max(hi, row[1]); }
    const okScale = shownVal === String(hh[ci][1]) && shownRange === `${lo}–${hi}`;
    log(`legend scale: herds ${shownVal} of range ${shownRange} ${okScale ? '✓' : '✗'}`);
    if (!okScale) errors.push('chart legend does not report the real value and range');
    first.click();
    const hiddenNow = game.ui.chartHiddenSet().has(1)
      && document.querySelector('#ws-legend .leg').getAttribute('aria-pressed') === 'false';
    log('  isolating a line:', hiddenNow ? 'hidden and announced ✓' : '✗');
    if (!hiddenNow) errors.push('toggling a chart series does not hide it');
    // hiding everything must not break the drawing
    for (const s2 of game.ui.chartSeries()) game.ui.chartHiddenSet().add(s2.k);
    game.ui.drawHistoryChart(st);
    log('  all five lines hidden: chart still renders ✓');
    game.ui.chartHiddenSet().clear();
    game.ui.drawHistoryChart(st);
  }

  // the survey map says what it is showing
  {
    game.ui.showTab('map');
    game.ui.mapView.cx = st.settlements[0].x; game.ui.mapView.cz = st.settlements[0].z;
    game.ui.mapView.span = 900;
    game.ui.waypoint = { x: p.pos.x, z: p.pos.z + 300, name: 'the ford' };   // due south of the player
    game.ui.drawBigMap();
    const label = document.querySelector('#bigmap').getAttribute('aria-label');
    const names = st.settlements.filter(s2 => Math.abs(s2.x - game.ui.mapView.cx) <= 450
      && Math.abs(s2.z - game.ui.mapView.cz) <= 450 && st.exploredAt(s2.x, s2.z) >= 0.25).map(s2 => s2.name);
    const okSpan = label.includes('900 metres across');
    const okNames = names.every(n => label.includes(n));
    // the spoken bearing must agree with the compass pips, which use bearingTo
    const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const expectDir = compass[Math.round(game.ui.bearingTo(0, 300) / (Math.PI / 4)) % 8];
    const okWp = new RegExp(`Waypoint "the ford" lies (29[5-9]|30[0-5]) metres ${expectDir}\\.`).test(label);
    log('survey map describes itself:', JSON.stringify(label.slice(0, 120) + '…'));
    log('  waypoint phrase:', (label.match(/Waypoint[^.]*\./) || ['(none)'])[0]);
    log(`  span ${okSpan ? '✓' : '✗'} | ${names.length} surveyed places named ${okNames ? '✓' : '✗'} | waypoint bearing ${okWp ? '✓' : '✗'}`);
    if (!okSpan || !okNames || !okWp) errors.push('the survey map description does not match what it draws');
    // unsurveyed places must not be leaked by the description
    const hidden = st.settlements.find(s2 => st.exploredAt(s2.x, s2.z) < 0.25);
    if (hidden && label.includes(hidden.name)) errors.push('map description reveals an unsurveyed settlement');
    game.ui.waypoint = null;
    game.ui.showTab('world');
  }

  // every faction cue carries its name, not just a colour
  {
    const crests = document.querySelectorAll('#world-state .crest');
    const names = [...document.querySelectorAll('#world-state .sr-only')].map(e => e.textContent);
    const named = names.some(t => /flies the .* banner/.test(t)) && names.some(t => /Verdant Pact/.test(t));
    log(`heraldry: ${crests.length} crests drawn, ${names.length} carry a readable name`, named ? '✓' : '✗');
    if (!crests.length || crests.length !== names.length) errors.push('faction crests are not paired with text alternatives');
    if (!named) errors.push('banner ownership is still conveyed by colour alone');
  }

  // a chronicle entry is a door into the chart for that day
  game.ui.showTab('journal');
  const jumps = document.querySelectorAll('#journal-list .jday-btn');
  const target = jumps.length ? Number(jumps[jumps.length - 1].textContent.match(/Day (\d+)/)[1]) : null;
  if (!jumps.length) errors.push('no chronicle day can be opened on the chart');
  else {
    jumps[jumps.length - 1].click();
    const landed = game.ui.chartDay === target && game.ui.panelOpen === "world";
    log(`chronicle -> chart: clicked Day ${target}, chart now on day ${game.ui.chartDay},`,
      `panel showing ${game.ui.panelOpen}`, landed ? '✓' : '✗');
    if (!landed) errors.push('clicking a chronicle day does not open that day on the chart');
    if (!document.querySelector('#ws-read').textContent.includes('Day ' + target)) {
      errors.push('the chart readout does not follow the chronicle jump');
    }
  }
  game.ui.closePanel();
}

// ---- the world is audible: beds and footfalls follow real state -----------
{
  const { AudioEngine } = await import('../src/audio.js');
  const { Settings } = await import('../src/settings.js');
  const { CH } = await import('../src/worldstate.js');
  const p = game.player;

  // footfalls read the ground the player is standing on
  const here = () => ({ x: p.pos.x, z: p.pos.z });
  const surf = {};
  p.inWater = false;
  st.paintGround(p.pos.x, p.pos.z, CH.BURN, 1, 3); surf.ash = p.footstepSound(st);
  st.paintGround(p.pos.x, p.pos.z, CH.BURN, -1, 3);
  st.paintGround(p.pos.x, p.pos.z, CH.DEV, 1, 3); surf.stone = p.footstepSound(st);
  st.paintGround(p.pos.x, p.pos.z, CH.DEV, -1, 3);
  st.paintGround(p.pos.x, p.pos.z, CH.LUSH, 1, 3); surf.grass = p.footstepSound(st);
  st.paintGround(p.pos.x, p.pos.z, CH.LUSH, -1, 3);
  p.inWater = true; surf.water = p.footstepSound(st); p.inWater = false;
  log('footfall by surface:', JSON.stringify(surf));
  const wantSurf = { ash: 'step-ash', stone: 'step-stone', grass: 'step-grass', water: 'splash' };
  for (const k of Object.keys(wantSurf)) if (surf[k] !== wantSurf[k]) errors.push(`footstep on ${k} was ${surf[k]}`);

  // the hearth bed only sounds near a living village
  const home = st.settlements.find(s => !s.abandoned);
  const away = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.pos.set(home.x, p.pos.y, home.z);
  const near = game.hearthNearness();
  p.pos.set(home.x + 400, p.pos.y, home.z + 400);
  const far = game.hearthNearness();
  p.pos.set(home.x, p.pos.y, home.z);
  home.abandoned = true;
  const ghost = game.hearthNearness();
  home.abandoned = false;
  p.pos.set(away.x, away.y, away.z);
  log(`hearth: in ${home.name} ${near.toFixed(2)} | 400 m away ${far.toFixed(2)} | if abandoned ${ghost.toFixed(2)}`);
  if (!(near > 0.25 && far === 0 && ghost < near)) errors.push('hearth ambience is not tied to living settlements');

  // volume is a real, clamped, persisted preference
  const eng = new AudioEngine();
  eng.setVolume(2); const hi = eng.volume;
  eng.setVolume(-1); const lo = eng.volume;
  Settings.set('volume', 0.35);
  const reread = (Settings.values.volume = undefined, Settings.load().volume);
  log(`volume clamps to ${lo}–${hi} and persists as ${reread}`);
  if (hi !== 1 || lo !== 0 || reread !== 0.35) errors.push('volume preference is not clamped or not persisted');
}

// ---- the account of what happened while you were away ----------------------
{
  const { WorldState } = await import('../src/worldstate.js');
  const before = st.snapshot();
  // a controlled set of changes the report must notice
  const a = st.settlements[0], b = st.settlements[1], c = st.settlements[2];
  a.buildings += 2; a.population += 4;
  b.abandoned = true;
  c.banner = (c.banner + 1) % 3;
  st.factions[0].territory += 5;
  st.day += 3;
  const lines = WorldState.diffSnapshots(before, st.snapshot(), 7200);
  const text = lines.map(l => l.text).join(' | ');
  const saw = {
    built: /raised 2 new buildings/.test(text),
    lost: new RegExp(`${b.name} was abandoned`).test(text),
    banner: new RegExp(`${c.name} now flies a different banner`).test(text),
    land: /pushed into 5 more regions/.test(text),
  };
  log('homecoming report notices:', Object.entries(saw).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join(' '));
  for (const [k, v] of Object.entries(saw)) if (!v) errors.push(`homecoming report missed the ${k} change`);
  log('  e.g. "' + (lines[0] && lines[0].text) + '"');
  // and it renders
  game.ui.showHomecoming(lines, 3, 7200);
  const rendered = document.querySelectorAll('#rep-list li').length;
  log('report renders', rendered, 'entries and pauses the world:', game.ui.blocking ? '✓' : '✗');
  if (rendered !== lines.length) errors.push('homecoming report did not render every line');
  if (!game.ui.blocking) errors.push('homecoming report does not pause the world');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  log('  Escape dismisses the report:', !game.ui.reportOpen ? '✓' : '✗');
  if (game.ui.reportOpen) { errors.push('Escape did not close the homecoming report'); game.ui.closeHomecoming(); }
  // an unchanged world says so rather than inventing drama
  const still = JSON.parse(JSON.stringify(before)); still.day = before.day + 2;
  const quiet = WorldState.diffSnapshots(before, still, 7200);
  log('an unchanged frontier reports:', JSON.stringify(quiet.map(l => l.text)));
  if (quiet.length !== 1 || !/quietly/.test(quiet[0].text)) errors.push('unchanged world produced a noisy report');
  if (WorldState.diffSnapshots(before, before, 7200).length) errors.push('report invented news when no time passed');
  // restore
  a.buildings -= 2; a.population -= 4; b.abandoned = false; c.banner = (c.banner + 2) % 3;
  st.factions[0].territory -= 5; st.day -= 3;
}

// ---- a damaged save is reported, not silently discarded ---------------------
{
  const { WorldState } = await import('../src/worldstate.js');
  st.save();                                   // make sure a healthy save exists
  const good = localStorage.getItem('living_frontier_save_v1');
  localStorage.setItem('living_frontier_save_v1', '{"day":3,"ground":["AAA');   // truncated
  const res = WorldState.loadResult();
  log('truncated save detected as:', res.status, res.status === 'damaged' && !res.state ? '✓' : '✗');
  if (res.status !== 'damaged') errors.push('a corrupt save was not reported as damaged');
  const kept = localStorage.getItem('living_frontier_save_v1_damaged');
  log('unreadable save kept aside for inspection:', kept ? '✓' : '✗');
  if (!kept) errors.push('corrupt save was thrown away');
  localStorage.removeItem('living_frontier_save_v1_damaged');
  localStorage.setItem('living_frontier_save_v1', good);
  const back = WorldState.loadResult();
  log('a healthy save still loads:', back.status === 'ok' ? '✓' : '✗');
  if (back.status !== 'ok') errors.push('loadResult broke the normal load path');
}

// ---- impact feedback --------------------------------------------------------
{
  p.shake = 0; p.shakeScale = 1;
  p.addShake(0.4);
  const kicked = p.shake;
  for (let i = 0; i < 40; i++) p.updateCamera(0.033, game.camera, game.input);
  log('impact kick decays away:', kicked.toFixed(2), '->', p.shake.toFixed(2), p.shake === 0 && kicked > 0 ? '✓' : '✗');
  if (!(kicked > 0 && p.shake === 0)) errors.push('camera shake did not decay');
  p.shakeScale = 0.15; p.shake = 0; p.addShake(0.4);
  log('reduce-motion damps it to', p.shake.toFixed(3), p.shake < 0.1 ? '✓' : '✗');
  if (p.shake >= 0.1) errors.push('reduce-motion does not damp camera shake');
  p.shakeScale = 1; p.shake = 0;
}

// ---- a save that cannot be written is reported, not swallowed ---------------
{
  // jsdom's localStorage is a Proxy, so patch the prototype, not the instance
  const proto = Object.getPrototypeOf(localStorage);
  const realSet = proto.setItem;
  let calls = 0;
  proto.setItem = function () { calls++; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const ok = st.save();
  proto.setItem = realSet;
  log('save under a full quota:', ok ? 'claimed success' : 'reported failure', ok ? '✗' : '✓', `(retried ${calls}x)`);
  if (ok) errors.push('save() lied about a failed write');
  if (calls < 2) errors.push('save() did not retry with a slimmer payload');
  log('and the world still saves normally afterwards:', st.save() ? '✓' : '✗');
}

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
COMPLETED = true;
console.log(errors.length ? '\n SMOKE TEST FAILED\n' : '\n SMOKE TEST PASSED\n');
process.exit(errors.length ? 1 : 0);
