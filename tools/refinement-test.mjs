// Behavioural refinement assertions, also executed by the real-game smoke gate.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Cartographer } from '../src/cartography.js';
import * as THREE from 'three';
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
