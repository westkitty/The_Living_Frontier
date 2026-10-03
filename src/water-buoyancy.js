// BuoyancySystem — analytic floating, not fluid simulation.
//
// A floating crate does not need SPH. Sampling the surface at a few points and
// applying a spring toward the riding height is stable, deterministic and free,
// which is exactly the tier the frontier needs. Coupled particle buoyancy is a
// separate, deliberately unreachable experiment.
//
// Pure CPU and headless: given a position it always answers the same way.
import { WaterQuery, SWIM_DEPTH } from './water.js';
import { clamp } from './rng.js';

export const DRAFT = 0.85;        // metres of a body that sit under the surface
export const SPRING_K = 26;       // restoring stiffness toward the riding height
export const SPRING_C = 8.2;      // damping: high enough that it never oscillates away

export class BuoyancySystem {
  constructor() {
    this.scratch = {};
    // Four support points, evenly spread, at 45 degrees so none of them lines
    // up with the world axes (which would make tilt snap to the diagonals).
    this.points = [0.25, 0.75, 1.25, 1.75].map(f => f * Math.PI);
  }

  // Sample the four support points around (x, z) at body height `y`.
  // Returns how much lift the water offers and the tilt the body wants.
  support(x, z, y, spread = 0.7, out = this.scratch) {
    const surface = WaterQuery.surfaceY;
    let lift = 0, wet = 0, tx = 0, tz = 0;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i];
      const px = x + Math.cos(a) * spread, pz = z + Math.sin(a) * spread;
      if (!WaterQuery.coveredAt(px, pz)) continue;
      const sub = clamp((surface - y + DRAFT * 0.5) / DRAFT, 0, 1);
      if (sub <= 0) continue;
      lift += sub; wet += 1;
      tx += Math.cos(a) * sub; tz += Math.sin(a) * sub;
    }
    const n = this.points.length;
    out.lift = lift / n;
    out.wet = wet / n;
    // Tilt away from the heavier side, capped so a half-out crate leans
    // rather than flipping.
    out.tiltX = clamp(-tz / n * 0.9, -0.4, 0.4);
    out.tiltZ = clamp(tx / n * 0.9, -0.4, 0.4);
    return out;
  }

  // Vertical acceleration that holds a body at the surface: a damped spring
  // toward the riding height. Critically damped enough to bob, never to
  // explode — the failure mode this replaces is a body launched skywards by
  // an undamped restoring force.
  verticalAccel(y, vy, lift) {
    const surface = WaterQuery.surfaceY;
    const riding = surface - DRAFT * 0.35;
    return (riding - y) * SPRING_K * lift - vy * SPRING_C * lift;
  }

  // Advance a simple floating body. `body` needs {pos, vel} with a y on each;
  // x/z are carried by the current rather than by this system. Out of the
  // water it simply falls — the spring only exists where there is water to
  // push back.
  floatBody(body, dt, spread = 0.7, gravity = 9.8) {
    const s = this.support(body.pos.x, body.pos.z, body.pos.y, spread);
    body.vel.y += (s.lift > 0.001 ? this.verticalAccel(body.pos.y, body.vel.y, s.lift) : -gravity) * dt;
    body.pos.y += body.vel.y * dt;
    return s;
  }

  // Should this body be swimming rather than walking on the bed?
  swimmableAt(x, z) {
    return WaterQuery.sample(this.scratch, x, z).depth > SWIM_DEPTH;
  }
}
