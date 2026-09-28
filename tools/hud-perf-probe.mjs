// Reproducible paired probe for the per-frame heads-up display.
//
// The HUD ticks once per frame for the whole session, so its DOM bookkeeping is
// the most-repeated code in the project. This probe drives the shipped
// implementation in src/hud.js and a verbatim copy of the same code as it stood
// in ui.js before the extraction through identical workloads, and counts every
// DOM operation each one performs. Both harnesses share a stub document detailed
// enough to be measured - textContent, inline style, attributes, dataset, class
// lists, children and clientWidth - and both stub out drawMinimap, so the only
// difference between the two columns is the HUD code itself.
//
//   node tools/hud-perf-probe.mjs [--assert]
//
// --assert additionally requires the two paths to leave byte-identical DOM state
// behind, which is what makes the optimization a refactor rather than a change
// in behavior.
import assert from 'node:assert/strict';
import { clamp } from '../src/rng.js';
import { WorldState } from '../src/worldstate.js';
import { HudMixin } from '../src/hud.js';

const shouldAssert = process.argv.includes('--assert');
const FRAMES = 600;
const SELECTORS = [
  '#time-label', '#day-label', '#weather-icon', '#weather-label', '#fire-risk',
  '#hp-fill', '#st-fill', '#hp-num', '#hp-bar', '#st-num', '#st-bar',
  '#compass', '#compass-strip', '#compass-pips', '#minimap', '#quest-tracker',
  '#prompt', '#prompt-text', '#prompt-key', '#prompt-alt', '#prompt-alt-key',
  '#prompt-alt-text',
];

// ------------------------------------------------------- a measurable DOM ---
let liveDoc = null;
function makeDoc() {
  // Retire the previous document so a cached reference to it reads as detached.
  if (liveDoc) for (const n of liveDoc._all) n.isConnected = false;
  const counters = {
    qs: 0, textSet: 0, textSame: 0, styleSet: 0, styleSame: 0, attrSet: 0,
    attrSame: 0, reflow: 0, innerHTML: 0, createElement: 0, appendChild: 0,
    dataSet: 0, dataSame: 0, classOp: 0,
  };
  const mk = (tag) => {
    const attrs = new Map(), style = {}, classes = new Set(), kids = [];
    let text = '', html = '';
    const node = {
      tagName: tag, isConnected: true, children: kids,
      get clientWidth() { counters.reflow++; return 260; },
      get clientHeight() { counters.reflow++; return 64; },
      get textContent() { return text; },
      set textContent(v) { const s = String(v); if (s === text) counters.textSame++; else counters.textSet++; text = s; },
      get innerHTML() { return html; },
      set innerHTML(v) { counters.innerHTML++; html = String(v); if (v === '') kids.length = 0; },
      appendChild(c) { counters.appendChild++; kids.push(c); return c; },
      setAttribute(k, v) { const s = String(v); if (attrs.get(k) === s) counters.attrSame++; else counters.attrSet++; attrs.set(k, s); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      querySelector() { return tag === 'svg' ? mk('use') : null; },
      classList: {
        add(c) { counters.classOp++; classes.add(c); },
        remove(c) { counters.classOp++; classes.delete(c); },
        toggle(c, on) { counters.classOp++; if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
        contains(c) { return classes.has(c); },
      },
      // dataset is a plain object in the browser too; count writes through a
      // Proxy so an identical re-assignment is visible as waste.
      dataset: new Proxy({}, {
        set(t, k, v) { const s = String(v); if (t[k] === s) counters.dataSame++; else counters.dataSet++; t[k] = s; return true; },
      }),
      style: new Proxy(style, {
        set(t, k, v) { const s = String(v); if (t[k] === s) counters.styleSame++; else counters.styleSet++; t[k] = s; return true; },
        get(t, k) { return t[k] === undefined ? '' : t[k]; },
      }),
      _attrs: attrs, _classes: classes,
    };
    return node;
  };
  const nodes = new Map(), all = [];
  const tracked = (n) => { all.push(n); return n; };
  for (const s of SELECTORS) nodes.set(s, tracked(mk(s === '#weather-icon' ? 'svg' : 'div')));
  const doc = {
    counters, nodes, _all: all,
    querySelector(sel) { counters.qs++; return nodes.get(sel) || null; },
    createElement(tag) { counters.createElement++; return tracked(mk(tag)); },
    body: tracked(mk('body')),
  };
  liveDoc = doc;
  return doc;
}

// The two harnesses run one after the other, so a single `$` and a single
// global document can serve both; each run points them at its own stub.
let activeDoc = null;
const $ = (sel) => activeDoc.querySelector(sel);
globalThis.addEventListener = () => {};

// --------------------------------------------- the reference implementation ---
// Verbatim copy of the HUD tick as it stood in ui.js before it moved to hud.js.
// It is retained here only so both paths can be driven through the same
// workload and compared operation for operation.
class LegacyHud {
  // ------------------------------------------------------------ hud tick
  update(dt, player) {
    const st = this.state;
    const mins = Math.floor(st.time * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('#time-label').textContent = `${hh}:${mm}`;
    $('#day-label').textContent = 'Day ' + st.day;
    const night = st.time < 0.22 || st.time > 0.8;
    const wIcon = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', fogbank: 'fog', snow: 'snow' }[st.weather.type] || 'sun';
    const wantIcon = night && st.weather.type === 'clear' ? 'moon' : wIcon;
    if (this._wIcon !== wantIcon) {
      this._wIcon = wantIcon;
      const u = $('#weather-icon').querySelector('use');
      if (u) u.setAttribute('href', '#i-' + wantIcon);
    }
    $('#weather-label').textContent = st.weather.type[0].toUpperCase() + st.weather.type.slice(1);

    const risk = st.fireConditions().risk;
    const riskEl = $('#fire-risk');
    if (riskEl.dataset.risk !== risk) {
      riskEl.dataset.risk = risk;
      riskEl.textContent = risk;
      riskEl.setAttribute('aria-label', `Fire risk: ${risk}`);
    }

    const hpF = clamp(player.hp / player.maxHp, 0, 1), stF = clamp(player.stamina / 100, 0, 1);
    $('#hp-fill').style.transform = `scaleX(${hpF})`;
    $('#st-fill').style.transform = `scaleX(${stF})`;
    const hpN = Math.ceil(player.hp), stN = Math.ceil(player.stamina);
    if (this._hpN !== hpN) {
      this._hpN = hpN;
      $('#hp-num').textContent = hpN;
      $('#hp-bar').setAttribute('aria-valuenow', hpN);
      $('#hp-bar').classList.toggle('low', hpF < 0.32);
    }
    if (this._stN !== stN) {
      this._stN = stN;
      $('#st-num').textContent = stN;
      $('#st-bar').setAttribute('aria-valuenow', stN);
      $('#st-bar').classList.toggle('low', stF < 0.25);
    }

    // compass
    const strip = $('#compass-strip');
    if (!this._compassBuilt) {
      let h = '';
      for (let i = 0; i < 48; i++) {
        const deg = i * 15;
        const label = deg % 90 === 0 ? ['N', 'E', 'S', 'W'][(deg / 90) % 4] : (deg % 45 === 0 ? '·' : '|');
        h += `<i class="${deg % 90 === 0 ? 'card' : ''}" style="width:40px">${label}</i>`;
      }
      strip.innerHTML = h + h;
      this._compassBuilt = true;
    }
    const heading = ((-player.camYaw + Math.PI) % 6.283 + 6.283) % 6.283;
    const px = (heading / 6.283) * (48 * 40);
    strip.style.transform = `translateX(${-px + $('#compass').clientWidth / 2}px)`;

    this.updateCompassPips(player);

    this.minimapT -= dt;
    if (this.minimapT <= 0) { this.minimapT = 0.12; this.drawMinimap(player); }

    // keep the map's text alternative describing the real surroundings
    this._a11yT = (this._a11yT || 0) - dt;
    if (this._a11yT <= 0) {
      this._a11yT = 3;
      const near = [];
      for (const s of st.settlements) {
        const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
        if (d < 400) near.push(`${s.name} ${Math.round(d)} metres`);
      }
      const fires = st.burningList.length;
      $('#minimap').setAttribute('aria-label',
        `Local map. ${near.length ? 'Near: ' + near.join(', ') + '.' : 'No settlement within 400 metres.'}` +
        (fires ? ` ${fires} fires burning.` : ''));
    }

    // quest tracker
    // questHash() joins every quest into a string; it used to run twice a frame
    // here, once to compare and once to store.
    const qhash = this.questHash();
    if (this._qhash !== qhash) {
      this._qhash = qhash;
      const box = $('#quest-tracker');
      box.innerHTML = '';
      if (this.waypoint) {
        const d = Math.round(Math.hypot(this.waypoint.x - player.pos.x, this.waypoint.z - player.pos.z));
        const el = document.createElement('div');
        el.className = 'qt way';
        el.innerHTML = `<div class="qt-title">◈ ${this.waypoint.name || 'Waypoint'}</div><div class="qt-sub">${d > 999 ? (d / 1000).toFixed(1) + ' km' : d + ' m'}</div>`;
        box.appendChild(el);
      }
      for (const q of st.quests.filter(q => !q.done).slice(0, 3)) {
        const d = Math.round(Math.hypot(q.x - player.pos.x, q.z - player.pos.z));
        const el = document.createElement('div');
        el.className = 'qt';
        el.innerHTML = `<div class="qt-title">${q.title}</div><div class="qt-sub">${q.need ? `${Math.min(q.progress, q.need)}/${q.need} · ` : ''}${d} m</div>`;
        box.appendChild(el);
      }
    }
    if (this.panelOpen === 'world' && (this._wsT = (this._wsT || 0) + dt) > 2) { this._wsT = 0; this.renderWorldState(); }
  }
  // Bearing in the same frame the compass strip uses (see updateCompassPips).
  bearingTo(dx, dz) {
    const yaw = Math.atan2(-dx, -dz);
    return ((-yaw + Math.PI) % 6.283185 + 6.283185) % 6.283185;
  }
  // Pips ride the compass so the player can navigate by looking at the world
  // instead of by opening a map.
  updateCompassPips(player) {
    const box = $('#compass-pips');
    if (!box) return;
    const targets = [];
    if (this.waypoint) targets.push({ x: this.waypoint.x, z: this.waypoint.z, cls: 'way', label: this.waypoint.name || 'Waypoint' });
    for (const q of this.state.quests) if (!q.done) targets.push({ x: q.x, z: q.z, cls: 'quest', label: q.title });
    for (const s of this.state.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d < 420) targets.push({ x: s.x, z: s.z, cls: 'place', label: s.name });
    }
    const key = targets.map(t => t.cls + t.x + t.z).join('|');
    if (key !== this._pipKey) {
      this._pipKey = key;
      box.innerHTML = '';
      this._pips = targets.map(t => {
        const el = document.createElement('i');
        el.className = 'pip ' + t.cls;
        el.dataset.label = t.label;
        box.appendChild(el);
        return { el, t };
      });
    }
    if (!this._pips) return;
    const W = $('#compass').clientWidth || 260;
    const heading = ((-player.camYaw + Math.PI) % 6.283185 + 6.283185) % 6.283185;
    const pxPerRad = (48 * 40) / 6.283185;
    for (const { el, t } of this._pips) {
      const dx = t.x - player.pos.x, dz = t.z - player.pos.z;
      let delta = this.bearingTo(dx, dz) - heading;
      while (delta > Math.PI) delta -= 6.283185;
      while (delta < -Math.PI) delta += 6.283185;
      const x = W / 2 + delta * pxPerRad;
      const dist = Math.round(Math.hypot(dx, dz));
      if (x < -20 || x > W + 20) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translateX(${x}px)`;
      el.style.opacity = String(clamp(1 - Math.abs(delta) / 1.4, 0.35, 1));
      el.dataset.dist = dist > 999 ? (dist / 1000).toFixed(1) + 'km' : dist + 'm';
    }
  }

  questHash() {
    const w = this.waypoint;
    return this.state.quests.map(q => q.id + q.progress + q.done).join('|') +
      (w ? `w${w.x},${w.z}` : '') + Math.round(this.world.player.pos.x / 25) + Math.round(this.world.player.pos.z / 25);
  }

  // The contextual prompt shows the real keys, and hides them on touch where
  // the on-screen buttons are the controls.
  setPrompt(text, key = 'E', alt = null, altKey = 'F') {
    const p = $('#prompt');
    if (!text) { p.classList.add('hidden'); this._prompt = null; return; }
    const sig = text + '|' + (alt || '');
    if (this._prompt !== sig) {
      this._prompt = sig;
      const touch = document.body.classList.contains('touch');
      $('#prompt-text').textContent = text;
      $('#prompt-key').textContent = touch ? '◉' : key;
      const altBox = $('#prompt-alt');
      if (alt) {
        altBox.classList.remove('hidden');
        $('#prompt-alt-key').textContent = touch ? '✦' : altKey;
        $('#prompt-alt-text').textContent = alt;
      } else altBox.classList.add('hidden');
    }
    p.classList.remove('hidden');
  }
}

// --------------------------------------------------------------- workload ---
function makeHost(state, player) {
  return {
    state, world: { player }, player, panelOpen: null, minimapT: 0,
    waypoint: { x: 180, z: -240, name: 'Ridge camp' },
    drawMinimap() { }, renderWorldState() { },
  };
}
const PROMPTS = [
  ['Pick up the flare', 'E', null, 'F'],
  ['Speak to the surveyor', 'E', 'Trade', 'F'],
  [null],
  ['Rest at the fire', 'E', null, 'F'],
];

// `moving` decides whether anything on screen is actually changing: a player who
// stands still with a full bar and a steady heading is the case the guards exist
// for, and a sprinting, turning player is the case that must not regress.
function run(Harness, moving) {
  const doc = makeDoc();
  activeDoc = doc;
  globalThis.document = doc;
  const state = new WorldState();
  const player = { pos: { x: 0, z: 0 }, hp: 100, maxHp: 100, stamina: 100, camYaw: 0.4 };
  const host = Object.assign(Object.create(Harness), makeHost(state, player));
  const dt = 1 / 60;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i++) {
    const t = i * dt;
    if (moving) {
      player.pos.x = Math.sin(t * 0.7) * 60;
      player.pos.z = Math.cos(t * 0.5) * 60;
      player.camYaw = Math.sin(t * 1.3) * 3;
      player.stamina = 20 + Math.abs(Math.sin(t * 0.9)) * 80;
      player.hp = 55 + Math.sin(t * 0.31) * 40;
    }
    state.time = (state.time + dt / 420) % 1;
    if (i % 150 === 0) state.weather.type = ['clear', 'cloudy', 'rain', 'storm'][i / 150 % 4];
    const p = PROMPTS[i % 97 === 0 ? (i / 97 | 0) % PROMPTS.length : (i / 97 | 0) % PROMPTS.length];
    host.setPrompt(...p);
    host.update(dt, player);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { doc, ms, counters: doc.counters, host };
}

function snapshot(doc) {
  const out = {};
  const walk = (node) => ({
    text: node.textContent, html: node.innerHTML,
    attrs: [...node._attrs].sort(), classes: [...node._classes].sort(),
    style: Object.keys(node.style).sort().map(k => [k, node.style[k]]),
    dataset: Object.keys(node.dataset).sort().map(k => [k, node.dataset[k]]),
    kids: node.children.map(walk),
  });
  for (const [sel, node] of doc.nodes) out[sel] = walk(node);
  return out;
}

// ------------------------------------------------------------------ report ---
// Wall-clock timings are printed as a diagnostic only. At roughly 12
// microseconds a tick, a single 600-frame run on a shared two-vCPU sandbox moves
// by more than any honest tolerance, so the gate asserts the things that are
// deterministic instead: the DOM state both paths leave behind, and how many
// operations each one performs to get there. That matches the other probes in
// this directory, which assert equivalence and mutation rather than milliseconds.
const ROUNDS = 3;
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const rows = [];
for (const moving of [false, true]) {
  const label = moving ? 'moving + turning' : 'standing still';
  const ms = { before: [], after: [] };
  let last = null;
  for (let r = 0; r < ROUNDS; r++) {
    // Alternate which path runs first so neither gets the warm-up for free.
    const pair = r % 2 ? [run(HudMixin, moving), run(LegacyHud.prototype, moving)]
      : [run(LegacyHud.prototype, moving), run(HudMixin, moving)];
    const [first, second] = pair;
    const before = r % 2 ? second : first, after = r % 2 ? first : second;
    ms.before.push(before.ms / FRAMES);
    ms.after.push(after.ms / FRAMES);
    last = { before, after };
  }
  const { before, after } = last;
  const b = before.counters, a = after.counters;
  const per = (c, n) => c[n] / FRAMES;
  const changed = (c) => c.textSet + c.styleSet + c.attrSet + c.dataSet;
  const waste = (c) => c.textSame + c.styleSame + c.attrSame + c.dataSame;
  if (shouldAssert) {
    assert.deepEqual(snapshot(after.doc), snapshot(before.doc),
      `the optimized HUD left different DOM state behind (${label})`);
    assert.equal(changed(a), changed(b),
      `the optimized HUD performed a different number of effective writes (${label})`);
    assert.ok(per(a, 'qs') <= 0.05,
      `element lookups are still uncached (${label}): ${per(a, 'qs').toFixed(2)}/frame`);
    assert.ok(a.reflow <= 1,
      `the compass is still measured per frame (${label}): ${a.reflow} reads over ${FRAMES} frames`);
    assert.ok(waste(a) < waste(b) / 4,
      `redundant writes were not cut by at least 4x (${label}): ${waste(b)} -> ${waste(a)}`);
  }
  rows.push({
    label, msBefore: median(ms.before), msAfter: median(ms.after),
    qsBefore: per(b, 'qs'), qsAfter: per(a, 'qs'),
    reflowBefore: per(b, 'reflow'), reflowAfter: per(a, 'reflow'),
    writesBefore: changed(b) / FRAMES, writesAfter: changed(a) / FRAMES,
    wasteBefore: waste(b) / FRAMES, wasteAfter: waste(a) / FRAMES,
  });
}

const f = (n) => n.toFixed(2).padStart(7);
const f1 = (n) => n.toFixed(1).padStart(7);
const f3 = (n) => n.toFixed(3).padStart(7);
console.log(`\n=== HUD DOM work per frame over ${FRAMES} frames (paired, same workload) ===`);
console.log('                              standing still        moving + turning');
console.log('                            before    after        before    after');
const line = (name, k, fmt) => console.log(
  `  ${name.padEnd(29)}${fmt(rows[0][k + 'Before'])} ${fmt(rows[0][k + 'After'])}       ${fmt(rows[1][k + 'Before'])} ${fmt(rows[1][k + 'After'])}`);
line('element lookups', 'qs', f);
line('layout reads', 'reflow', f);
line('writes that changed', 'writes', f1);
line('writes that changed nothing', 'waste', f1);
line('tick cost, ms (diagnostic)', 'ms', f3);
if (shouldAssert) {
  console.log(`\n  \u2713 ${ROUNDS} rounds x 2 workloads: identical DOM state, identical effective-write count,`);
  console.log('    cached lookups, one layout read per run, redundant writes cut by more than 4x');
}
console.log(' HUD PROBE PASSED\n');
