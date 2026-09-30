// THE LIVING FRONTIER - entry point.
import * as THREE from 'three';
import { SETTLEMENTS } from './worldgen.js';
import { WorldState, SAVE_KEY } from './worldstate.js';
import { drawSurveyThumb } from './cartography.js';
import { invalidSaveSections, recoverSave } from './save-recovery.js';
import { Guidance } from './guidance.js';
import { Settings } from './settings.js';
import { ActorSystem } from './entities.js';
import { Player, Input } from './player.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { InteractionMixin } from './interaction.js';
import { DialogueMixin } from './dialogue.js';
import { LoopMixin } from './loop.js';
import { StreamingMixin } from './streaming.js';
import { QuestMixin } from './quests.js';
import { createActorAssetManager } from './assets/actor-visual.js';
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
    this.assets = createActorAssetManager();
    this.initStreaming();
    this.player = new Player(this.scene, state, this);
    this.actors = new ActorSystem(this.scene, state, this);

    this.quality = 'high';
    this.clock = new THREE.Clock();
    this.saveTimer = 25;
    this.groundTexTimer = 0;
    this.interactTarget = null;
    this.timeScale = 1;
    this.frameTimes = [];

    this.guidance = new Guidance(state, this.ui);
    state.onNote = (e) => {
      this.guidance.note(e);
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

  // interaction, dialogue and quest behaviour live in their own modules
  // and are mixed onto this prototype at the bottom of the file.



}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
Object.assign(Game.prototype, InteractionMixin, DialogueMixin, QuestMixin, LoopMixin, StreamingMixin);

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
  let raw = null, savedText = null, recoveryReport = '';
  try {
    savedText = localStorage.getItem(SAVE_KEY);
    raw = JSON.parse(savedText || 'null');
    if (raw && invalidSaveSections(raw).length) throw new Error('Invalid sections');
  } catch (e) {
    const recovered = savedText && recoverSave(savedText);
    raw = recovered ? recovered.payload : null;
    recoveryReport = recovered ? recovered.report : 'The saved world is unreadable. No world data could be recovered.';
    try { if (savedText) localStorage.setItem(SAVE_KEY + '_damaged', savedText); } catch (storageError) { }
  }
  $('#save-recovery').textContent = recoveryReport;
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
    let state, loadStatus = 'new', loadReport = '';
    try {
      if (fresh) { localStorage.removeItem(SAVE_KEY); state = new WorldState(); }
      else {
        const res = WorldState.loadResult();
        loadStatus = res.status; loadReport = res.report || '';
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
    game.player.setFirstPerson(prefs.cameraMode === 'first');
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

    if (loadStatus === 'salvaged') game.ui.toast(loadReport, 'good');
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
        touch ? 'Hand button acts · blade strikes · spark casts · » to run.' : 'E acts · F strikes · X casts · T tome · Shift runs · H for help.',
        'Your map is blank until you walk it. Climb high ground to see further.',
      ];
      if (prefs.hints) tips.forEach((t, i) => setTimeout(() => {
        if (Settings.get('hints')) game.ui.toast(t);
      }, 1600 + i * 4200));
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
