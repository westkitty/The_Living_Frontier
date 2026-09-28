// THE LIVING FRONTIER - entry point.
import * as THREE from 'three';
import { WORLD, LANDMARKS, SETTLEMENTS, FACTIONS, CAMPS, heightAt, caveFloor, placeOnLand } from './worldgen.js';
import { clamp } from './rng.js';
import { WorldState, regionIndex, SAVE_KEY } from './worldstate.js';
import { drawSurveyThumb } from './cartography.js';
import { Settings } from './settings.js';
import { ChunkManager, makeWater, makeGroundTexture, shared } from './terrain.js';
import { Vegetation } from './veg.js';
import { buildLandmarks, buildSettlementGeometry, makeStructureMaterial, makeBanner, buildCaveGlow, buildCampGeometry } from './structures.js';
import { ActorSystem } from './entities.js';
import { Player, Input } from './player.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { InteractionMixin } from './interaction.js';
import { DialogueMixin } from './dialogue.js';
import { QuestMixin } from './quests.js';

const $ = (s) => document.querySelector(s);

class Game {
  constructor(state) {
    this.state = state;
    state.plantings = state.plantings || (state.player.plantings || []);
    this.canvas = $('#gl');
    // (globalThis.__LF_RENDERER is a test seam used by tools/smoke-test.mjs)
    const RendererClass = globalThis.__LF_RENDERER || THREE.WebGLRenderer;
    this.renderer = new RendererClass({ canvas: this.canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 3000);

    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.fx = new FX(this.scene, this.renderer, state);
    this.ui = new UI(state, this);

    makeGroundTexture(state);
    this.chunks = new ChunkManager(this.scene, state);
    this.veg = new Vegetation(this.scene, state);
    this.chunks.onChunkBuild = (k, rec, ring) => this.veg.buildChunk(k, rec, ring);
    this.chunks.onChunkRemove = (k) => this.veg.removeChunk(k);
    this.chunks.onRingChange = (k, rec, ring) => this.veg.setRing(k, ring);
    this.water = makeWater(this.scene);

    this.structMat = makeStructureMaterial();
    this.landmarks = buildLandmarks(this.scene, this.structMat);
    this.settlementMeshes = [];
    this.banners = [];
    this.buildSettlements();
    this.buildLandmarkBanners();
    this.buildCaves();
    this.buildCamps();

    this.player = new Player(this.scene, state, this);
    this.actors = new ActorSystem(this.scene, state, this);

    this.quality = 'high';
    this.clock = new THREE.Clock();
    this.saveTimer = 25;
    this.groundTexTimer = 0;
    this.interactTarget = null;
    this.timeScale = 1;
    this.frameTimes = [];

    state.onNote = (e) => {
      if (e.kind === 'faction') this.ui.toast(e.text, 'faction');
      else if (e.kind === 'settlement') this.ui.toast(e.text);
      else if (e.kind === 'combat') this.ui.toast(e.text, 'faction');
      else if (e.kind === 'quest') { this.ui.toast(e.text, 'good'); this.audio.play('quest'); }
    };
    state.onNewDay = (d) => this.ui.toast(`Day ${d} breaks over the frontier.`);

    addEventListener('resize', () => this.resize());
    this.resize();

    document.addEventListener('visibilitychange', () => { if (document.hidden) this.state.save(); });
    addEventListener('pagehide', () => this.state.save());
    addEventListener('beforeunload', () => this.state.save());

    // First-time unlock of audio
    const unlock = () => { this.audio.init(); this.audio.resume(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { once: true }));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  cycleQuality() {
    const order = ['high', 'medium', 'low'];
    return this.setQuality(order[(order.indexOf(this.quality) + 1) % 3]);
  }

  setQuality(q) {
    this.quality = ['high', 'medium', 'low'].includes(q) ? q : 'high';
    if (this.quality === 'high') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true; this.chunks.radius = 3; this.actors.maxAnimals = 16;
    } else if (this.quality === 'medium') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
      this.renderer.shadowMap.enabled = true; this.chunks.radius = 3; this.actors.maxAnimals = 12;
    } else {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false; this.chunks.radius = 2; this.actors.maxAnimals = 8;
    }
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.chunks.center = { i: 9999, j: 9999 };
    return this.quality;
  }

  // ------------------------------------------------------------ settlements
  settlementHash(s) {
    return `${s.buildings}|${s.walls}|${s.fields}|${s.abandoned ? 1 : 0}|${s.constructing > 0 ? 1 : 0}|${Math.round(s.prosperity * 5)}`;
  }
  buildSettlements() {
    for (let i = 0; i < this.state.settlements.length; i++) this.rebuildSettlement(i);
  }
  rebuildSettlement(i) {
    const s = this.state.settlements[i];
    const old = this.settlementMeshes[i];
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); if (old.banner) this.scene.remove(old.banner); }
    const { geo, baseY } = buildSettlementGeometry(s, i);
    const mesh = new THREE.Mesh(geo, this.structMat);
    mesh.position.set(s.x, baseY, s.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    let banner = null;
    if (!s.abandoned) {
      banner = makeBanner(FACTIONS[s.banner].color);
      banner.position.set(s.x + 4, baseY + heightAt(s.x + 4, s.z + 4) - baseY, s.z + 4);
      banner.position.y = heightAt(s.x + 4, s.z + 4);
      this.scene.add(banner);
      this.banners.push(banner);
    }
    this.settlementMeshes[i] = { mesh, banner, hash: this.settlementHash(s), bannerFaction: s.banner, baseY };
  }
  buildCaves() {
    this.caves = [];
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const L of LANDMARKS) {
      if (L.kind !== 'cave') continue;
      const floorY = caveFloor(L);
      const glow = new THREE.Mesh(buildCaveGlow(L), glowMat);
      glow.position.set(L.x, floorY, L.z);
      glow.matrixAutoUpdate = false; glow.updateMatrix();
      this.scene.add(glow);
      const light = new THREE.PointLight(0x7fe0d8, 0, 70, 2);
      light.position.set(L.x + Math.cos(L.dir) * L.len * 0.6, floorY + 4, L.z + Math.sin(L.dir) * L.len * 0.6);
      this.scene.add(light);
      this.caves.push({ L, glow, light, floorY });
    }
  }

  buildCamps() {
    this.camps = [];
    for (let i = 0; i < CAMPS.length; i++) {
      const raw = CAMPS[i];
      const [cx, cz] = placeOnLand(raw.id, raw.x, raw.z, 5, 0.2);
      const c = { id: raw.id, x: cx, z: cz };
      CAMPS[i].x = cx; CAMPS[i].z = cz;
      const owner = this.state.regions[regionIndex(c.x, c.z)].owner;
      const mesh = new THREE.Mesh(buildCampGeometry(i * 131 + 7, Math.max(0, owner)), this.structMat);
      mesh.position.set(c.x, heightAt(c.x, c.z), c.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.visible = owner >= 0;
      this.scene.add(mesh);
      const banner = makeBanner(owner >= 0 ? FACTIONS[owner].color : 0x777777);
      banner.position.set(c.x + 5, heightAt(c.x + 5, c.z + 2), c.z + 2);
      banner.visible = owner >= 0;
      this.scene.add(banner);
      this.banners.push(banner);
      this.camps.push({ c, mesh, banner, owner, seed: i * 131 + 7 });
    }
  }

  buildLandmarkBanners() {
    this.landmarkBanners = [];
    for (const lm of this.landmarks) {
      if (lm.L.kind !== 'fortress' && lm.L.kind !== 'cliff') continue;
      const b = makeBanner(0x888888);
      b.position.set(lm.L.x + 10, heightAt(lm.L.x + 10, lm.L.z + 10) + (lm.L.kind === 'fortress' ? 0 : 0), lm.L.z + 10);
      this.scene.add(b);
      this.banners.push(b);
      this.landmarkBanners.push({ L: lm.L, banner: b, faction: -1 });
    }
  }
  syncStructures(dt) {
    for (let i = 0; i < this.state.settlements.length; i++) {
      const s = this.state.settlements[i];
      const rec = this.settlementMeshes[i];
      if (!rec) continue;
      const h = this.settlementHash(s);
      if (h !== rec.hash) { this.rebuildSettlement(i); continue; }
      if (rec.bannerFaction !== s.banner && rec.banner) {
        rec.banner.userData.cloth.material.color.setHex(FACTIONS[s.banner].color);
        rec.bannerFaction = s.banner;
      }
    }
    for (const lb of this.landmarkBanners) {
      const owner = this.state.regions[regionIndex(lb.L.x, lb.L.z)].owner;
      if (owner !== lb.faction) {
        lb.faction = owner;
        lb.banner.visible = owner >= 0;
        if (owner >= 0) lb.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // camps change hands with the region they sit in
    for (const camp of this.camps) {
      const owner = this.state.regions[regionIndex(camp.c.x, camp.c.z)].owner;
      if (owner !== camp.owner) {
        camp.owner = owner;
        this.scene.remove(camp.mesh);
        camp.mesh.geometry.dispose();
        camp.mesh = new THREE.Mesh(buildCampGeometry(camp.seed, Math.max(0, owner)), this.structMat);
        camp.mesh.position.set(camp.c.x, heightAt(camp.c.x, camp.c.z), camp.c.z);
        camp.mesh.castShadow = true; camp.mesh.receiveShadow = true;
        camp.mesh.matrixAutoUpdate = false; camp.mesh.updateMatrix();
        camp.mesh.visible = owner >= 0;
        this.scene.add(camp.mesh);
        camp.banner.visible = owner >= 0;
        if (owner >= 0) camp.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // cave glow pulses, and its light only burns while the player is inside
    for (const cave of this.caves) {
      const d = Math.hypot(cave.L.x - this.player.pos.x, cave.L.z - this.player.pos.z);
      const near = d < cave.L.len + 40;
      cave.glow.visible = near;
      cave.light.intensity = near ? 3.2 + Math.sin(shared.uTime.value * 1.6) * 0.8 : 0;
    }

    // flag cloth wave
    const t = shared.uTime.value;
    for (const b of this.banners) {
      const c = b.userData.cloth;
      c.rotation.y = Math.sin(t * 2.2 + b.position.x) * 0.35;
      c.scale.x = 1 + Math.sin(t * 3.1 + b.position.z) * 0.06;
    }
  }

  // interaction, dialogue and quest behaviour live in their own modules
  // and are mixed onto this prototype at the bottom of the file.


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
        this.ui.discovery(L.name);
        this.audio.play('discover');
        st.note(`Discovered ${L.name}.`, 'discovery');
        st.player.inv.relic += 0;
        for (let i = 0; i < 3; i++) st.player.rep[i] = clamp(st.player.rep[i] + 2, -100, 100);
        for (const q of st.quests) if (!q.done && q.kind === 'explore' && q.target === L.id) this.completeQuest(q);
      }
    }
  }

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
  }

  // ---------------------------------------------------------------- loop
  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  frame() {
    const dtRaw = Math.min(this.clock.getDelta(), 0.05);
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

    this.chunks.update(this.player.pos.x, this.player.pos.z, blocking ? 1 : 2);
    this.actors.update(dt, this.player);
    this.fx.update(dtRaw, this.camera, this.player.pos);
    this.ui.tickRecord(dtRaw);
    this.syncStructures(dt);
    this.checkDiscoveries();
    this.updateSight(dtRaw);

    // Ground memory texture upload (throttled)
    this.groundTexTimer -= dtRaw;
    if (st.groundDirty && this.groundTexTimer <= 0) {
      shared.uGround.value.needsUpdate = true;
      st.groundDirty = false;
      this.groundTexTimer = 0.4;
    }

    // Vegetation regrowth / burn refresh
    if (st.vegDirtyKeys && st.vegDirtyKeys.size) {
      const k = st.vegDirtyKeys.values().next().value;
      st.vegDirtyKeys.delete(k);
      this.veg.rebuild(k);
    }

    // Audio ambience
    const w = st.weather;
    this.audio.ambience({
      wind: w.windSpeed,
      rain: (w.type === 'rain' || w.type === 'storm') ? w.intensity : 0,
      fire: clamp(st.burningCount() * 0.25, 0, 1) * (1 - clamp(Math.abs(this.nearestFireDist() / 90), 0, 1)),
      water: this.waterNearness(),
      hearth: this.hearthNearness(),
      night: st.time < 0.22 || st.time > 0.8,
    });
    this.ambienceTimer = (this.ambienceTimer || 0) - dtRaw;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 3 + Math.random() * 7;
      const night = st.time < 0.22 || st.time > 0.8;
      if (!night && Math.random() < 0.6 && w.intensity < 0.5) this.audio.play('bird');
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

    // adaptive quality
    this.frameTimes.push(dtRaw);
    if (this.frameTimes.length > 120) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (avg > 0.055 && this.quality === 'high') { this.cycleQuality(); this.ui.toast('Quality lowered for smoother play'); }
      else if (avg > 0.07 && this.quality === 'medium') { this.cycleQuality(); }
    }
  }

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
  }

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
  }

  nearestFireDist() {
    let bd = 1e9;
    for (const c of this.state.burningList) {
      const d = Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z);
      if (d < bd) bd = d;
    }
    return bd === 1e9 ? 999 : bd;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
Object.assign(Game.prototype, InteractionMixin, DialogueMixin, QuestMixin);

function describeSave(obj) {
  if (!obj) return null;
  try {
    const away = Math.max(0, (Date.now() - obj.savedAt) / 1000);
    const hrs = away / 3600;
    const set = obj.settlements || [];
    const alive = set.filter(s => !s.abandoned).length;
    const best = set.slice().sort((a, b) => b.prosperity - a.prosperity)[0];
    return `<b>Day ${obj.day}</b> · ${Object.keys(obj.discovered || {}).length} landmarks found · ${alive}/${set.length} villages standing<br>
      ${best ? `${best.name} is ${best.abandoned ? 'abandoned' : best.status}.` : ''}
      ${hrs > 0.05 ? `<br><span style="color:var(--amber)">The frontier moved on for ${hrs < 1 ? Math.round(away / 60) + ' minutes' : hrs.toFixed(1) + ' hours'} without you.</span>` : ''}`;
  } catch (e) { return null; }
}

function fatal(msg, detail) {
  const el = document.getElementById('boot-status');
  if (el) { el.style.color = '#ef8a74'; el.textContent = msg; }
  const s = document.getElementById('save-summary');
  if (s) s.innerHTML = `<b>${msg}</b><br><span style="font-size:11px;opacity:.7">${detail || ''}</span>`;
  console.error(msg, detail);
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

async function boot() {
  const status = $('#boot-status');
  addEventListener('error', (e) => {
    if (window.GAME && window.GAME.ui) window.GAME.ui.toast('⚠ ' + (e.message || 'error'));
  });
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
  const summary = describeSave(raw);
  $('#save-summary').innerHTML = summary || 'No world yet. The frontier is waiting to be shaped — and it will remember everything you do to it.';
  $('#btn-continue').classList.toggle('hidden', !summary);
  if (summary) {
    const frac = drawSurveyThumb($('#save-thumb'), raw);
    if (frac !== null && frac !== undefined) {
      $('#save-thumb-wrap').classList.remove('hidden');
      $('#save-thumb-cap').textContent = (frac * 100).toFixed(frac < 0.1 ? 1 : 0) + '% surveyed';
      $('#save-thumb').setAttribute('aria-label',
        `Survey map of your frontier: ${(frac * 100).toFixed(1)} per cent of the land explored, day ${raw.day}.`);
    }
  }
  if (!summary) $('#btn-new').classList.add('primary');
  status.textContent = 'Ready';

  const startGame = async (fresh) => {
    $('#boot-status').textContent = 'Shaping the frontier…';
    $('#btn-continue').disabled = $('#btn-new').disabled = true;
    await new Promise(r => setTimeout(r, 30));
    if (!globalThis.__LF_RENDERER && !webglAvailable()) {
      fatal('WebGL is not available in this browser.', 'Try a different browser, or enable hardware acceleration.');
      return;
    }
    let state, loadStatus = 'new';
    try {
      if (fresh) { localStorage.removeItem(SAVE_KEY); state = new WorldState(); }
      else {
        const res = WorldState.loadResult();
        loadStatus = res.status;
        state = res.state || new WorldState();
      }
    } catch (e) { state = new WorldState(); loadStatus = 'damaged'; }

    let game;
    try { game = new Game(state); }
    catch (e) { fatal('The frontier failed to load.', e && e.message); throw e; }
    window.GAME = game;

    // restore how this player likes to play
    const prefs = Settings.load();
    Settings.applyDocument();
    game.audio.setMuted(prefs.muted);
    game.audio.setVolume(prefs.volume);
    game.setQuality(prefs.quality);
    game.input.sensitivity = prefs.sensitivity;
    game.input.invertY = prefs.invertY;
    game.player.shakeScale = Settings.motionReduced ? 0.15 : 1;
    game.ui.syncSettingsUI();

    $('#boot-status').textContent = 'Drawing the map…';
    await new Promise(r => setTimeout(r, 20));
    game.ui.buildBaseMap(288);
    $('#boot-status').textContent = 'Growing the forests…';
    await new Promise(r => setTimeout(r, 20));
    // pre-stream the chunks around the player before revealing the world
    for (let i = 0; i < 60; i++) {
      game.chunks.update(state.player.x, state.player.z, 4);
      if (!game.chunks.queue.length) break;
    }
    game.player.updateCamera(0.2, game.camera, game.input);
    game.renderer.render(game.scene, game.camera);

    $('#boot').style.transition = 'opacity .8s ease';
    $('#boot').style.opacity = '0';
    setTimeout(() => $('#boot').classList.add('hidden'), 820);
    $('#hud').classList.remove('hidden');
    game.start();

    if (fresh || state.player.firstRun) {
      state.note('You arrive on the frontier.', 'world');
      state.quests.push({
        id: 'q_intro', kind: 'explore', title: 'Find Greenhollow',
        desc: 'A village lies nearby. Villages ask for help — and remember who gave it.',
        target: 'greenhollow', x: SETTLEMENTS[0].x, z: SETTLEMENTS[0].z,
        progress: 0, expires: state.elapsed + 1e9, done: false,
      });
      const touch = document.body.classList.contains('touch');
      const tips = [
        'Everything you do here leaves a mark. Leave, come back, and see.',
        touch ? 'Hand button acts · blade strikes · » to run.' : 'E acts · F strikes or sets alight · Shift runs · H for help.',
        'Your map is blank until you walk it. Climb high ground to see further.',
      ];
      tips.forEach((t, i) => setTimeout(() => game.ui.toast(t), 1600 + i * 4200));
    } else if (state.homecoming && state.homecoming.length) {
      for (const l of state.homecoming.slice().reverse()) state.note(l.text, l.kind === 'faction' ? 'faction' : 'world');
      setTimeout(() => game.ui.showHomecoming(state.homecoming, state.homecomingDays, state.awaySeconds), 900);
    } else if (loadStatus === 'damaged') {
      setTimeout(() => game.ui.toast('That saved world could not be read — a new frontier was raised in its place.', 'bad'), 1200);
    } else if (state.awaySeconds > 60) {
      const recent = state.journal.slice(0, 3).map(j => j.text);
      setTimeout(() => game.ui.toast(`While you were gone: ${recent[0] || 'the seasons turned.'}`), 1400);
    }
  };

  $('#btn-continue').addEventListener('click', () => startGame(false));
  $('#btn-new').addEventListener('click', () => startGame(true));
}

boot();
