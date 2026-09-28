// Frame scheduling, discovery and ambient state. Mixed onto Game.prototype.
import { WORLD, LANDMARKS, heightAt } from './worldgen.js';
import { clamp } from './rng.js';
import { updateAmbientAudio } from './ambient.js';
import { simulationDelta, sampleFrameCost, nextQuality } from './frame-budget.js';

export const LoopMixin = {
  // ----------------------------------------------------------- discoveries
  checkDiscoveries() {
    const st = this.state, p = this.player.pos;
    const intro = st.quests.find(q => q.id === 'q_intro' && !q.done);
    if (intro && Math.hypot(intro.x - p.x, intro.z - p.z) < 26) {
      intro.done = true; intro.progress = 1;
      st.player.stats.quests++;
      this.audio.play('quest');
      this.ui.toast('✓ Found Greenhollow — speak to its people', 'good');
    }
    for (const L of LANDMARKS) {
      if (st.discovered[L.id]) continue;
      if (Math.hypot(L.x - p.x, L.z - p.z) < L.r * 0.62) {
        st.discovered[L.id] = st.day;
        this.ui.discovery(L.name, L);
        this.audio.play('discover');
        st.note(`Discovered ${L.name}.`, 'discovery');
        st.player.inv.relic += 0;
        for (let i = 0; i < 3; i++) st.player.rep[i] = clamp(st.player.rep[i] + 2, -100, 100);
        for (const q of st.quests) if (!q.done && q.kind === 'explore' && q.target === L.id) this.completeQuest(q);
      }
    }
  },

  // Reveals the remembered map around the player. Sight carries further from
  // high, exposed ground, so a ridge line is worth climbing.
  updateSight(dt) {
    this.sightTimer = (this.sightTimer || 0) - dt;
    if (this.sightTimer > 0) return;
    this.sightTimer = 0.35;
    const p = this.player.pos;
    // prominence: how far above the surrounding land the player stands
    const around = (heightAt(p.x + 210, p.z) + heightAt(p.x - 210, p.z) +
      heightAt(p.x, p.z + 210) + heightAt(p.x, p.z - 210)) / 4;
    const prominence = Math.max(0, p.y - around);
    const weather = this.state.weather;
    const murk = (weather.type === 'fogbank' ? 0.45 : weather.type === 'storm' ? 0.65 :
      weather.type === 'rain' ? 0.8 : weather.type === 'snow' ? 0.75 : 1);
    const night = (this.state.time < 0.22 || this.state.time > 0.82) ? 0.55 : 1;
    const radius = clamp((105 + prominence * 2.6) * murk * night, 55, 430);
    this.sightRadius = radius;
    const changed = this.state.markExplored(p.x, p.z, radius);
    if (changed > 0) {
      this.newGround = (this.newGround || 0) + changed;
      // a quiet, earned reward for pushing into genuinely unknown country
      if (this.newGround > 900) {
        this.newGround = 0;
        this.ui.toast('New country mapped', 'good');
        this.audio.play('discover');
      }
    }
  },

  // ---------------------------------------------------------------- loop
  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  },

  frame() {
    const frameElapsed = this.clock.getDelta();
    const dtRaw = simulationDelta(frameElapsed);
    const blocking = this.ui.blocking;
    // a few frames of slow-motion on a landed blow: the hit gets weight
    let impact = 1;
    if (this.hitStop > 0) { this.hitStop -= dtRaw; impact = 0.25; }
    const dt = (blocking ? dtRaw * 0.15 : dtRaw) * impact;
    const st = this.state;

    st.update(dt * this.timeScale);

    if (!blocking) {
      const consumed = this.input.consume();
      this.player.update(dtRaw, this.input, this.camera);
      if (consumed.interact) this.interact();
      if (consumed.attack) this.strike();
    } else {
      this.input.consume();
      this.input.look.set(0, 0);
      this.player.updateCamera(dtRaw, this.camera, this.input);
    }

    this.streamChunks(blocking);
    this.actors.update(dt, this.player);
    this.fx.update(dtRaw, this.camera, this.player.pos);
    this.ui.tickRecord(dtRaw);
    this.syncStructures(dt);
    this.checkDiscoveries();
    this.guidance.update(this.player.pos);
    this.updateSight(dtRaw);

    this.updateGroundMemory(dtRaw);

    // Ambient values are smoothed over hundreds of milliseconds by WebAudio;
    // sampling terrain and fire state every rendered frame does not improve it.
    updateAmbientAudio(this, dtRaw);
    this.ambienceTimer = (this.ambienceTimer || 0) - dtRaw;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 3 + Math.random() * 7;
      const night = st.time < 0.22 || st.time > 0.8;
      if (!night && Math.random() < 0.6 && st.weather.intensity < 0.5) this.audio.play('bird');
      else if (night && Math.random() < 0.4) this.audio.play(Math.random() < 0.6 ? 'owl' : 'wolfhowl');
    }

    // interaction prompt
    if (!blocking) {
      this.interactTarget = this.findTarget();
      if (this.interactTarget) {
        const t = this.interactTarget;
        this.ui.setPrompt(t.label, 'E', t.alt || null, 'F');
      } else this.ui.setPrompt(null);
    }

    this.ui.update(dtRaw, this.player);

    // autosave
    this.saveTimer -= dtRaw;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      const ok = st.save();
      if (!ok && !this._saveWarned) {
        this._saveWarned = true;
        this.ui.toast('The frontier cannot be written to storage — progress will be lost.', 'bad');
      } else if (ok && this._saveWarned) {
        this._saveWarned = false;
        this.ui.toast('Storage recovered — the world is being remembered again.', 'good');
      }
    }

    this.renderer.render(this.scene, this.camera);

    // Quality observes real elapsed frame time; simulation dt remains capped.
    const avgFrame = sampleFrameCost(this.frameTimes, frameElapsed);
    if (avgFrame !== null) {
      const before = this.quality;
      const next = nextQuality(before, avgFrame);
      if (next !== before) {
        this.setQuality(next);
        if (before === 'high') this.ui.toast('Quality lowered for smoother play');
      }
    }
  },

  // how close the player is to moving water: the shoreline, or a river bed
  waterNearness() {
    const p = this.player.pos;
    const depth = WORLD.water - heightAt(p.x, p.z);          // >0 means underwater
    if (depth > -1.5) return clamp(1 - Math.max(0, depth) * 0.12, 0.35, 1);
    let near = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = heightAt(p.x + Math.cos(a) * 14, p.z + Math.sin(a) * 14);
      if (h < WORLD.water + 0.6) near = Math.max(near, 1 - Math.abs(h - WORLD.water) * 0.5);
    }
    return clamp(near * 0.8, 0, 1);
  },

  // the sound of a living settlement: louder the closer and the better it does
  hearthNearness() {
    const p = this.player.pos;
    let best = 0;
    for (const s of this.state.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > 90) continue;
      best = Math.max(best, (1 - d / 90) * clamp(0.25 + s.prosperity, 0, 1.25));
    }
    return clamp(best, 0, 1);
  },

  nearestFireDist() {
    let bd = 1e9;
    for (const c of this.state.burningList) {
      const d = Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z);
      if (d < bd) bd = d;
    }
    return bd === 1e9 ? 999 : bd;
  },
};
