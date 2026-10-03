// WaterSystem — the one object the game talks to about water.
//
// Everything else in this subsystem is a part: the surface draws, the FX pool
// splashes, the events layer notices, the underwater state changes the room
// you are standing in, and buoyancy floats things. The game constructs this,
// calls update() once a frame, and never has to know which part did what.
//
// Two rules hold the design together:
//   * WaterQuery is the only source of truth. Nothing here re-derives depth.
//   * Quality changes appearance only. A low-end machine and a desktop agree
//     on whether you are wading or swimming.
import { LANDMARKS } from './worldgen.js';
import { clamp } from './rng.js';
import { WaterQuery } from './water.js';
import { WaterInteraction, WATER_EVENT } from './water-events.js';
import { WaterFX } from './water-fx.js';
import { WaterSurface } from './water-surface.js';
import { UnderwaterEnvironment } from './water-underwater.js';
import { BuoyancySystem } from './water-buoyancy.js';
import { waterQualityFor } from './water-quality.js';
import { shared } from './terrain.js';
import { Settings } from './settings.js';

const ACTOR_RANGE = 90;      // only bodies this close are worth tracking
const SHOWCASE_LIFT = 0.5;   // extra life given to a flooded landmark

export class WaterSystem {
  constructor(game) {
    this.game = game;
    this.qualityName = game.quality || 'high';
    this.quality = waterQualityFor(this.qualityName, Settings.motionReduced);
    this.events = new WaterInteraction();
    this.surface = new WaterSurface(game.scene, this.quality);
    this.fx = new WaterFX(game.scene, this.quality);
    this.underwater = new UnderwaterEnvironment(game.scene, game.renderer, game.audio);
    this.buoyancy = new BuoyancySystem();
    this.suspended = false;
    // Flooded landmarks are the composed showcases: they get more caustics and
    // more suspended life than an ordinary riverbank.
    this.showcases = LANDMARKS.filter(l => l.kind === 'flooded');
    this.unsubscribe = [
      this.events.on(WATER_EVENT.IMPACT, (e) => this.onImpact(e)),
      this.events.on(WATER_EVENT.ENTER, (e) => this.onEnter(e)),
      this.events.on(WATER_EVENT.EXIT, (e) => this.onExit(e)),
      this.events.on(WATER_EVENT.WAKE, (e) => this.onWake(e)),
    ];
  }

  get cameraPos() {
    const c = this.game.camera;
    return c ? c.position : null;
  }

  onImpact(e) {
    const cam = this.cameraPos;
    this.fx.splash(e.x, WaterQuery.surfaceY, e.z, e.strength, cam);
    this.fx.ripple(e.x, e.z, 0.45 + e.strength * 0.9, cam);
  }

  onEnter(e) {
    const cam = this.cameraPos;
    // A slow step in still disturbs the surface; it just does not throw water.
    if (e.speed > 1.2) this.fx.splash(e.x, WaterQuery.surfaceY, e.z, clamp(e.speed / 8, 0.2, 0.7), cam);
    this.fx.ripple(e.x, e.z, 0.35, cam);
  }

  onExit(e) {
    this.fx.ripple(e.x, e.z, 0.3, this.cameraPos);
  }

  onWake(e) {
    this.fx.wake(e.x, e.z, e.strength, this.cameraPos);
  }

  update(dt) {
    if (this.suspended) return;
    const game = this.game, st = game.state;
    const cam = this.cameraPos;
    const player = game.player;

    // 1. who is in the water. The player first, then wildlife near enough that
    //    anybody could see the ripple.
    if (player && player.pos) {
      this.events.probe('player', player.pos.x, player.pos.y, player.pos.z,
        player.vel ? player.vel.y : 0, player.speedNow || 0, dt);
    }
    const actors = game.actors && game.actors.animals;
    if (actors && player) {
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (!a.pos || a.pos.distanceTo(player.pos) > ACTOR_RANGE) continue;
        this.events.probe(a.id || ('actor' + i), a.pos.x, a.pos.y, a.pos.z, 0, 0, dt);
      }
    }

    // 2. the surface responds to the weather the game already simulates
    if (st && st.weather) this.surface.setWeather(st.weather);

    // 3. rain lands on water
    const rain = st && st.weather && (st.weather.type === 'rain' || st.weather.type === 'storm')
      ? st.weather.intensity : 0;
    if (cam) this.fx.rainImpacts(cam, rain, dt);

    // 4. effects, then the room the camera is standing in
    this.fx.update(dt, cam);
    const under = this.underwater.update(dt, cam ? cam.y : 999, st ? st.weather : null);
    if (cam) this.fx.setBubbles(cam, under);

    // 5. caustics on the floor beneath the water
    let caustics = this.quality.caustics;
    if (caustics > 0 && player && this.showcases.length) {
      for (let i = 0; i < this.showcases.length; i++) {
        const L = this.showcases[i];
        const d = Math.hypot(player.pos.x - L.x, player.pos.z - L.z);
        if (d < L.r * 1.6) caustics = Math.min(1.6, caustics + SHOWCASE_LIFT * (1 - d / (L.r * 1.6)));
      }
    }
    shared.uCaustics.value = caustics * (0.55 + under * 0.45);
  }

  setQuality(name, reducedMotion = Settings.motionReduced) {
    this.qualityName = name;
    const next = waterQualityFor(name, reducedMotion);
    this.quality = next;
    this.surface.setQuality(next);
    this.fx.setQuality(next);
    shared.uCaustics.value = next.caustics;
    return next;
  }

  suspend() {
    this.suspended = true;
    this.surface.suspend();
    this.fx.suspend();
  }

  resume() {
    this.suspended = false;
    this.surface.resume();
    this.fx.resume();
  }

  dispose() {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.events.dispose();
    this.surface.dispose();
    this.fx.dispose();
    this.underwater.dispose();
    shared.uCaustics.value = 0;
  }
}
