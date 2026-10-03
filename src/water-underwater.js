// UnderwaterEnvironment — what the world looks and sounds like from below the
// surface.
//
// Driven by camera height against the water surface, never by `player.inWater`:
// leaning over a river to look at it must not submerge you, and a body standing
// in deep water must not drag the whole screen under with it. The transition is
// a continuous ramp across the waterline, so there is no frame where the world
// suddenly turns blue.
import * as THREE from 'three';
import { clamp, lerp } from './rng.js';
import { WaterQuery } from './water.js';

// The ramp spans this many metres either side of the surface.
const RAMP = 0.42;

export class UnderwaterEnvironment {
  constructor(scene, renderer, audio) {
    this.scene = scene;
    this.renderer = renderer;
    this.audio = audio;
    this.amount = 0;
    this.tint = new THREE.Color(0x123c46);
    this.hooked = false;
    this.filter = null;
    this.prevExposure = 0;
  }

  // How submerged the camera is: 0 above the surface, 1 well below it.
  update(dt, cameraY, weather) {
    const surface = WaterQuery.surfaceY;
    const target = clamp((surface + RAMP - cameraY) / (RAMP * 2), 0, 1);
    // Asymmetric easing: going under is quick, coming up lingers a little so
    // the surface does not snap away.
    this.amount += (target - this.amount) * clamp(dt * (target > this.amount ? 9 : 5), 0, 1);
    const a = this.amount;

    const fog = this.scene.fog;
    if (fog && this.renderer) {
      // FX owns the fog and recomputes it every frame from the weather, so
      // this narrows whatever FX produced instead of overwriting it. At a == 0
      // every expression below is a no-op, which is how surfacing hands
      // control straight back with nothing to restore.
      fog.color.lerp(this.tint, a * 0.92);
      fog.far = Math.min(fog.far, lerp(fog.far, 38, a));
      fog.near = Math.min(fog.near, lerp(fog.near, 0.6, a));
      if (a > 0.001) this.renderer.setClearColor(fog.color);
      if (this.prevExposure === 0) this.prevExposure = this.renderer.toneMappingExposure;
      this.renderer.toneMappingExposure = lerp(this.prevExposure, this.prevExposure * 0.8, a);
    }
    this.applyAudio(a);
    return a;
  }

  // Muffle the world by putting a lowpass between the engine's master gain and
  // the output. AudioEngine owns its own graph, so this rewires from outside
  // and puts everything back on dispose().
  applyAudio(a) {
    const au = this.audio;
    if (!au || !au.ctx || !au.master) return;
    if (!this.hooked) {
      try {
        this.filter = au.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 18000;
        this.filter.Q.value = 0.4;
        au.master.disconnect(au.ctx.destination);
        au.master.connect(this.filter);
        this.filter.connect(au.ctx.destination);
        this.hooked = true;
      } catch (e) { this.hooked = false; return; }
    }
    this.filter.frequency.value = lerp(18000, 420, a);
  }

  restoreAudio() {
    const au = this.audio;
    if (!this.hooked || !au || !au.ctx || !au.master) return;
    try {
      au.master.disconnect(this.filter);
      this.filter.disconnect(au.ctx.destination);
      au.master.connect(au.ctx.destination);
    } catch (e) { /* the context may already be gone */ }
    this.hooked = false;
    this.filter = null;
  }

  get under() { return this.amount > 0.5; }

  dispose() {
    // Fog needs no restoring: FX rewrites it every frame and this module only
    // ever narrowed it. Exposure is ours, so it goes back.
    if (this.renderer && this.prevExposure > 0) this.renderer.toneMappingExposure = this.prevExposure;
    this.restoreAudio();
    this.amount = 0;
  }
}
