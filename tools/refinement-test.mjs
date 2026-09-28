// Behavioural refinement assertions, also executed by the real-game smoke gate.
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Cartographer } from '../src/cartography.js';
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
