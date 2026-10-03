// WaterInteraction — the seam between simulation state and presentation.
//
// Simulation asks WaterQuery and emits semantic events; splashes, ripples,
// wakes, audio and camera effects subscribe. Nothing that draws or plays a
// sound is allowed to re-derive water depth from terrain on its own, which is
// what keeps gameplay and presentation from drifting apart.
//
// Deterministic on purpose: this module never calls Math.random, so a fixed
// sequence of positions always produces the same event sequence. The effects
// that subscribe may randomise their own appearance.
import { WaterQuery, WATER_BAND } from './water.js';

export const WATER_EVENT = {
  ENTER: 'enter',       // a body first becomes wet
  EXIT: 'exit',         // a body leaves the water
  BAND: 'band',         // ankle -> wade -> swim (or back)
  IMPACT: 'impact',     // arrived with speed: splash-worthy
  WAKE: 'wake',         // moving through water: leave a trail
  SUBMERGE: 'submerge', // the camera went under
  SURFACE: 'surface',   // the camera came back up
};

// How far a body must travel before it earns another wake ripple.
const WAKE_SPACING = 1.6;
// Entering faster than this is a splash rather than a step in.
const IMPACT_SPEED = 3.0;

export class WaterInteraction {
  constructor() {
    this.handlers = new Map();
    this.tracks = new Map();
    this.scratch = {};
    this.cameraUnder = false;
  }

  // Subscribe to one event kind. Returns the unsubscribe function so a system
  // that is disposed cannot keep receiving events it can no longer answer.
  on(kind, fn) {
    let list = this.handlers.get(kind);
    if (!list) this.handlers.set(kind, list = []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit(kind, e) {
    const list = this.handlers.get(kind);
    if (!list || !list.length) return false;
    for (let i = 0; i < list.length; i++) list[i](e);
    return true;
  }

  // Begin following a body. `kind` is only a label for subscribers
  // ('player', 'deer', 'projectile') so effects can be sized by what fell in.
  track(id, kind = 'body') {
    let t = this.tracks.get(id);
    if (!t) this.tracks.set(id, t = { kind, inWater: false, band: WATER_BAND.DRY, wakeAt: 0, x: 0, z: 0 });
    return t;
  }

  untrack(id) { this.tracks.delete(id); }

  get size() { return this.tracks.size; }

  // One body, one frame. `vy` is its vertical speed and `speed` its horizontal
  // speed, both optional; without them the impact and wake events simply do
  // not fire. Returns the query so callers can reuse it instead of asking twice.
  probe(id, x, y, z, vy = 0, speed = 0, dt = 0) {
    const t = this.track(id);
    const q = WaterQuery.sample(this.scratch, x, z);
    const wasIn = t.inWater, wasBand = t.band;
    const moved = Math.hypot(x - t.x, z - t.z);
    // Callers that do not carry a velocity (wildlife does not) get one derived
    // from how far they actually moved, so wakes still work for them.
    const spd = speed > 0 ? speed : (dt > 0 ? moved / dt : 0);
    const e = { id, kind: t.kind, x, y, z, depth: q.depth, waterType: q.waterType, speed: spd, vy };

    if (q.inWater && !wasIn) {
      this.emit(WATER_EVENT.ENTER, e);
      // A hard arrival gets its own event: it is the difference between a
      // footstep and a belly flop.
      if (-vy > IMPACT_SPEED) this.emit(WATER_EVENT.IMPACT, { ...e, strength: Math.min(1, -vy / 18) });
    } else if (!q.inWater && wasIn) {
      this.emit(WATER_EVENT.EXIT, e);
    }
    if (q.band !== wasBand) this.emit(WATER_EVENT.BAND, { ...e, from: wasBand, to: q.band });

    if (q.inWater && spd > 0.6) {
      t.wakeAt += moved;
      if (t.wakeAt >= WAKE_SPACING) {
        t.wakeAt = 0;
        this.emit(WATER_EVENT.WAKE, { ...e, strength: Math.min(1, spd / 6) });
      }
    }
    t.inWater = q.inWater; t.band = q.band; t.x = x; t.z = z;
    return q;
  }

  // The camera is its own body: crossing the waterline is an environment
  // change, not a splash. Driven by camera height against the surface, never
  // by `player.inWater`, so looking down into a river does not submerge you.
  probeCamera(cameraY, x, z) {
    const under = cameraY < WaterQuery.surfaceY - 0.05;
    if (under !== this.cameraUnder) {
      this.cameraUnder = under;
      this.emit(under ? WATER_EVENT.SUBMERGE : WATER_EVENT.SURFACE, { x, z, cameraY });
    }
    return under;
  }

  dispose() {
    this.handlers.clear();
    this.tracks.clear();
    this.cameraUnder = false;
  }
}
