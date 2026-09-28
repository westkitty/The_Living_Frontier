// The world's fixed coordinate grids.
//
// THE LIVING FRONTIER lays four independent grids over the same 2,300 m world:
// ground memory (512x512 RGBA: burn / trail / lushness / development), the
// player's surveyed map (128x128), the fire and fuel grid (96x96) and the
// ecology/faction regions (12x12). Converting between world metres and those
// grids is pure arithmetic over the WORLD constants, and nearly every system
// needs it - the simulation, the renderer, the vegetation scatterer, the maps
// and the interaction probe.
//
// It lives here, below the simulation, so that subsystems extracted from the
// world state (fire, recovery) can map coordinates without importing the world
// state back and creating a cycle. These helpers are re-exported from
// worldstate.js, which is where existing callers already find them.
import { WORLD } from './worldgen.js';
import { clamp } from './rng.js';

const R = WORLD.stateRes, FR = WORLD.fireRes, RR = WORLD.regionRes;

// Ground-memory channels. Order matters: it is the byte order of the saved
// plane and of the texture every surface shader samples.
export const CH = { BURN: 0, TRAIL: 1, LUSH: 2, DEV: 3 };

export function worldToState(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.stateCell), 0, R - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.stateCell), 0, R - 1);
  return j * R + i;
}

export function worldToFire(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.fireCell), 0, FR - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.fireCell), 0, FR - 1);
  return j * FR + i;
}

export function fireToWorld(idx) {
  const i = idx % FR, j = (idx / FR) | 0;
  return [(i + 0.5) * WORLD.fireCell - WORLD.half, (j + 0.5) * WORLD.fireCell - WORLD.half];
}

export function regionIndex(x, z) {
  const i = clamp(Math.floor((x + WORLD.half) / WORLD.regionCell), 0, RR - 1);
  const j = clamp(Math.floor((z + WORLD.half) / WORLD.regionCell), 0, RR - 1);
  return j * RR + i;
}

export function regionCenter(idx) {
  const i = idx % RR, j = (idx / RR) | 0;
  return [(i + 0.5) * WORLD.regionCell - WORLD.half, (j + 0.5) * WORLD.regionCell - WORLD.half];
}
