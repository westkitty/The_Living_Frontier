// Behavioural refinement assertions, also executed by the real-game smoke gate.
import { JSDOM } from 'jsdom';
import { InteractionMixin } from '../src/interaction.js';
import { PanelsMixin } from '../src/panels.js';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Cartographer } from '../src/cartography.js';
import * as THREE from 'three';
import { Vegetation } from '../src/veg.js';
import { ChunkManager } from '../src/terrain.js';
import { ActorSystem } from '../src/entities.js';
import { DAY_LENGTH, CH } from '../src/worldstate.js';
import { heightAt } from '../src/worldgen.js';
import { WorldState } from '../src/worldstate.js';
import { WORLD } from '../src/worldgen.js';

{
  const state = new WorldState(), map = new Cartographer(state);
  const signatures = [];
  for (let faction = 0; faction < 3; faction++) {
    state.regions.forEach(r => { r.owner = faction; });
    const ctx = createCanvas(128, 128).getContext('2d');
    map._territory(ctx, 128, 128, { cx: 0, cz: 0, span: WORLD.regionCell }, createCanvas);
    // Alpha alone is greyscale-independent; sample inside borders.
    const pixels = ctx.getImageData(16, 16, 32, 32).data;
    const alpha = [...pixels].filter((v, i) => i % 4 === 3);
    assert(Math.max(...alpha) < 51, 'territory fill must remain below 20% opacity');
    signatures.push(alpha.join(','));
  }
  assert.equal(new Set(signatures).size, 3, 'territories need three different non-colour fill signatures');
  console.log('  ✓ territory fills differ even without colour');
}

{
  const state = new WorldState(), scene = new THREE.Scene();
  const player = { pos: new THREE.Vector3(0, 200, 0), hp: 100, damage() {} };
  const actors = new ActorSystem(scene, state, { player });
  actors.spawnTimer = Infinity; // isolate existing villagers, no random population changes
  const home = state.settlements[0];
  const walker = actors.spawnNPC(home, 2);
  walker.setPos(home.x, heightAt(home.x, home.z) + 1, home.z);
  // Twenty actor-simulation days, without player updates or player ground wear.
  for (let t = 0; t < 20 * DAY_LENGTH; t += 0.5) {
    state.time = (0.28 + t / DAY_LENGTH) % 1;
    actors.update(0.5, player);
  }
  const dest = walker.destination;
  assert(dest, 'villagers must actually travel to a neighbour');
  const dx = dest.x - home.x, dz = dest.z - home.z, length = Math.hypot(dx, dz);
  const mean = offset => {
    let sum = 0;
    for (let i = 10; i <= 90; i++) {
      sum += state.getGround(home.x + dx * i / 100 - dz / length * offset,
        home.z + dz * i / 100 + dx / length * offset, CH.TRAIL);
    }
    return sum / 81;
  };
  console.log('  autonomous route/control TRAIL:', mean(0).toFixed(3), mean(100).toFixed(3));
  assert(mean(0) > mean(100) + 0.04, '20 days of villagers must wear the settlement line more than the 100m parallel control');

  // A nearby worn step beats bare direct ground, but still makes forward progress.
  state.ground.fill(0);
  walker.setPos(0, heightAt(0, 0) + 1, 0);
  state.paintGround(Math.cos(0.6) * 8, Math.sin(0.6) * 8, CH.TRAIL, 1, 0);
  actors.moveActor(walker, 1, 0, 2, 0.1);
  assert(walker.pos.x > 0 && walker.pos.z > 0.02, 'human steering must prefer an existing trail');
}

{
  const state = new WorldState(), scene = new THREE.Scene();
  const terrain = new ChunkManager(scene, state), veg = new Vegetation(scene, state);
  terrain.onChunkBuild = (key, rec, ring) => veg.buildChunk(key, rec, ring);
  terrain.onChunkRemove = key => veg.removeChunk(key);
  terrain.onRingChange = (key, rec, ring) => veg.setRing(key, ring);
  terrain.update(0, 180, 999);
  const found = [...veg.chunks].find(([, c]) => c.ring === 2 && c.meshes.canopy);
  assert(found, 'ring two forests need a canopy');
  const [key, chunk] = found, canopy = chunk.meshes.canopy;
  assert.equal(Object.keys(chunk.meshes).length, 1, 'one canopy mesh per distant forest chunk');
  assert.equal(canopy.material.vertexColors, true);
  assert.equal(canopy.castShadow, false);
  let disposed = false;
  canopy.geometry.addEventListener('dispose', () => { disposed = true; });
  terrain.disposeChunk(key);
  assert(!canopy.parent && disposed && !veg.chunks.has(key), 'unloading must remove and dispose canopy');
  // Rebuilding a completely burnt patch cannot leave a green shell behind.
  state.ground.forEach((v, i) => { if (i % 4 === CH.BURN) state.ground[i] = 255; });
  veg.buildChunk(key, chunk.rec, 2);
  assert(!veg.chunks.get(key).meshes.canopy, 'burn scars must suppress distant canopy');
  console.log('  ✓ ring-two canopy ownership, burn exclusion and disposal');
}

{
  const savedDocument = globalThis.document;
  const dom = new JSDOM('<canvas id="ws-chart" width="720" height="240"></canvas><div id="ws-read"></div><div id="ws-legend"></div>');
  globalThis.document = dom.window.document;
  try {
    const state = new WorldState();
    state.history = [[1, 102, 12, 90, 4, 0, 0, 0, 41], [2, 201, 20, 91, 8, 0, 0, 0, 51], [3, 130, 15, 95, 6, 0, 0, 0, 45]];
    const panel = Object.assign({ state }, PanelsMixin);
    const canvas = document.querySelector('#ws-chart'), ctx = createCanvas(720, 240).getContext('2d');
    const drawn = [], fill = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y) => { drawn.push(String(text)); fill(text, x, y); };
    canvas.getContext = () => ctx;
    panel.drawHistoryChart(state);
    assert(document.querySelector('#ws-read').textContent.includes('Normalised view'));
    // Isolate through the actual legend buttons, not a fabricated hidden-set result.
    for (const k of [2, 3, 4, 8]) document.querySelector(`[data-k="${k}"]`).click();
    drawn.length = 0;
    panel.drawHistoryChart(state);
    const min = Math.min(...state.history.map(r => r[1])), max = Math.max(...state.history.map(r => r[1]));
    assert.deepEqual(drawn.filter(v => !v.startsWith('day ')), [min, (min + max) / 2, max].map(String), 'isolated chart must draw true min/mid/max');
    assert(document.querySelector('#ws-read').textContent.includes('Y-axis: herd animals'));
    assert(canvas.getAttribute('aria-label').includes('Y-axis: herd animals'));
    console.log('  ✓ isolated herd axis labels and units match history');
  } finally { globalThis.document = savedDocument; dom.window.close(); }
}

{
  const state = new WorldState(), scene = new THREE.Scene();
  const player = { pos: new THREE.Vector3(1000, 0, 1000), hp: 100, damage() {} };
  const world = { state, player, audio: { play() {} }, ui: { toast() {} }, fx: { bloodPuff() {} } };
  const actors = world.actors = new ActorSystem(scene, state, world);
  actors.spawnTimer = Infinity;
  const baseline = scene.children.length;
  const deer = actors.spawnAnimal('deer', 0, 0), wolf = actors.spawnAnimal('wolf', 30, 0);
  actors.killAnimal(deer, false);
  assert.equal(actors.corpses.length, 1, 'killed animal must leave a carcass');
  const distance = wolf.pos.distanceTo(deer.pos);
  for (let i = 0; i < 20; i++) actors.update(0.05, player);
  assert(wolf.pos.distanceTo(deer.pos) < distance - 1, 'predator must approach nearest carcass');
  const pred = state.regions[wolf.region].pred;
  wolf.setPos(deer.pos.x + 1, deer.pos.y, deer.pos.z);
  actors.update(0.05, player);
  assert.equal(actors.corpses.length, 0, 'feeding removes carcass early');
  assert(state.regions[wolf.region].pred > pred, 'feeding improves region predator population');
  actors.remove(wolf, actors.animals);
  const decay = actors.spawnAnimal('rabbit', 0, 0);
  actors.killAnimal(decay, false);
  actors.update(DAY_LENGTH - 1, player);
  assert.equal(actors.corpses.length, 1, 'carcass should remain for roughly a day');
  actors.update(2, player);
  assert.equal(actors.corpses.length, 0, 'carcass must decay after one day');
  assert.equal(scene.children.length, baseline, 'decay must restore scene object baseline');
  const harvest = actors.spawnAnimal('deer', 0, 0);
  actors.killAnimal(harvest, true);
  const hide = state.player.inv.hide;
  assert.equal(actors.nearestInteractable(harvest.pos).type, 'carcass');
  world.interactTarget = { type: 'carcass', actor: harvest };
  InteractionMixin.interact.call(world);
  InteractionMixin.interact.call(world);
  assert.equal(state.player.inv.hide, hide + 2, 'harvesting gives hide exactly once');
  assert.equal(scene.children.length, baseline);
  console.log('  ✓ carcass attraction, feeding, day-long decay, harvest and cleanup');
}
