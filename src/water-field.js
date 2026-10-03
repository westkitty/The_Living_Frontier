// WaterField — the coarse world representation the renderer samples.
//
// This is the CPU-side field the atlas calls for, deliberately *not* at
// INKWAVE's 0.25 m resolution: a 2.3 km world at that spacing would be absurd.
// It sits at the scale of the grids the game already keeps, which is enough
// for a shoreline mask and depth tint. Exact gameplay never reads this — it
// calls WaterQuery, which goes to the heightfield directly.
//
// Headless by design (no THREE), so the bytes are testable in plain Node and
// the texture wrapper in water-surface.js is the only GPU-aware part.
import { WORLD, heightAt } from './worldgen.js';
import { clamp } from './rng.js';
import { WaterQuery } from './water.js';

export const FIELD_RES = 256;                 // ~9 m per cell across 2,300 m
export const FIELD_MAX_DEPTH = 12;            // metres that saturate the R channel
export const FIELD_FLOW_RANGE = 1.6;          // m/s that saturates the B/A channels

// Channel meaning, matching the texture the shader reads:
//   R = depth / FIELD_MAX_DEPTH
//   G = shore factor, 1 = dry land, 0 = open water
//   B = flow X, biased to 0.5
//   A = flow Z, biased to 0.5
export function buildWaterField(res = FIELD_RES, out = new Uint8Array(res * res * 4)) {
  const size = WORLD.size, half = WORLD.half;
  const flow = { flowX: 0, flowZ: 0 };
  for (let j = 0; j < res; j++) {
    const z = -half + ((j + 0.5) / res) * size;
    for (let i = 0; i < res; i++) {
      const x = -half + ((i + 0.5) / res) * size;
      const o = (j * res + i) * 4;
      const groundY = heightAt(x, z);
      const depth = WaterQuery.depthAt(x, z, groundY);
      // Only cells the surface can actually reach pay for the noise fields;
      // everything well above water is dry and costs one heightAt().
      if (depth <= -2.5) {
        out[o] = 0; out[o + 1] = 255; out[o + 2] = 128; out[o + 3] = 128;
        continue;
      }
      WaterQuery.flowAt(x, z, depth, flow);
      out[o] = Math.round(clamp(depth / FIELD_MAX_DEPTH, 0, 1) * 255);
      out[o + 1] = Math.round(WaterQuery.shoreFactorAt(x, z, groundY) * 255);
      out[o + 2] = Math.round((clamp(flow.flowX / FIELD_FLOW_RANGE, -1, 1) * 0.5 + 0.5) * 255);
      out[o + 3] = Math.round((clamp(flow.flowZ / FIELD_FLOW_RANGE, -1, 1) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

// World position -> field index, using the same mapping as the ground-state
// texture so the two line up exactly. Returns -1 outside the world.
export function fieldIndexOf(x, z, res = FIELD_RES) {
  const i = Math.floor(((x + WORLD.half) / WORLD.size) * res);
  const j = Math.floor(((z + WORLD.half) / WORLD.size) * res);
  if (i < 0 || j < 0 || i >= res || j >= res) return -1;
  return j * res + i;
}
