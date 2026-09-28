// The heads-up display, ticked once per frame for as long as the game runs.
//
// This file was extracted from ui.js to make that tick cheap to reason about.
// tools/hud-perf-probe.mjs drives it and a verbatim copy of the pre-extraction
// code through the same 600 frames and counts the DOM work each one does. A
// moving, turning player used to cost 13.6 document-wide selector searches per
// frame, 2 reads of clientWidth - each one forcing the browser to lay the page
// out again, because a style write sits either side of them - and 6.2 writes per
// frame that assigned a property the value it already held. None of that reached
// the screen. The same frames now cost 0.04 searches, no layout reads at all and
// no redundant writes, while the number of writes that actually change something
// is unchanged, and the probe asserts the two paths leave identical DOM state.
//
// LAYER 5. Only rng.js supplies it, and it is mixed into the same UI object as
// ui.js, so the panels and the map keep reaching these methods through `this`.
import { clamp } from './rng.js';

// ---------------------------------------------------------- element lookup
// The HUD's markup is static in index.html and the ui gate fails the build if
// any of these selectors stops resolving, so a reference is resolved once and
// reused. A cached node that has left the document is re-resolved, which keeps
// the cache honest if a panel ever rebuilds part of the shell.
const els = new Map();
export function hudEl(sel) {
  const hit = els.get(sel);
  if (hit && hit.isConnected) return hit;
  const found = document.querySelector(sel);
  els.set(sel, found);
  return found;
}

// Writing a property costs style recalculation and often a reflow; reading the
// one already there does not, and most frames change very little. textContent
// and getAttribute are always strings while some HUD values are numbers, so the
// comparison coerces the way the browser would before deciding anything changed.
export function setText(e, v) { const s = String(v); if (e && e.textContent !== s) e.textContent = s; }
export function setStyle(e, prop, v) { if (e && e.style[prop] !== v) e.style[prop] = v; }
export function setAttr(e, name, v) { const s = String(v); if (e && e.getAttribute(name) !== s) e.setAttribute(name, s); }

const WEATHER_ICONS = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', fogbank: 'fog', snow: 'snow' };

export const HudMixin = {
  // ------------------------------------------------------------ hud tick
  update(dt, player) {
    const st = this.state;

    // A full day runs 420 s, so one in-game minute passes every ~0.29 s: the
    // clock label is rebuilt from numbers only on the frames it changes.
    const mins = Math.floor(st.time * 24 * 60);
    if (mins !== this._mins) {
      this._mins = mins;
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      setText(hudEl('#time-label'), `${hh}:${mm}`);
    }
    if (st.day !== this._day) { this._day = st.day; setText(hudEl('#day-label'), 'Day ' + st.day); }

    const night = st.time < 0.22 || st.time > 0.8;
    const wantIcon = night && st.weather.type === 'clear' ? 'moon' : (WEATHER_ICONS[st.weather.type] || 'sun');
    if (this._wIcon !== wantIcon) {
      this._wIcon = wantIcon;
      setAttr(hudEl('#weather-icon').querySelector('use'), 'href', '#i-' + wantIcon);
    }
    if (st.weather.type !== this._wType) {
      this._wType = st.weather.type;
      setText(hudEl('#weather-label'), st.weather.type[0].toUpperCase() + st.weather.type.slice(1));
    }

    const risk = st.fireConditions().risk;
    const riskEl = hudEl('#fire-risk');
    if (riskEl.dataset.risk !== risk) {
      riskEl.dataset.risk = risk;
      riskEl.textContent = risk;
      riskEl.setAttribute('aria-label', `Fire risk: ${risk}`);
    }

    // The bars only move while stamina drains, health changes, or the weather
    // does, so a still player costs two comparisons instead of two writes.
    const hpF = clamp(player.hp / player.maxHp, 0, 1), stF = clamp(player.stamina / 100, 0, 1);
    if (hpF !== this._hpF) { this._hpF = hpF; setStyle(hudEl('#hp-fill'), 'transform', `scaleX(${hpF})`); }
    if (stF !== this._stF) { this._stF = stF; setStyle(hudEl('#st-fill'), 'transform', `scaleX(${stF})`); }
    const hpN = Math.ceil(player.hp), stN = Math.ceil(player.stamina);
    if (this._hpN !== hpN) {
      this._hpN = hpN;
      setText(hudEl('#hp-num'), hpN);
      setAttr(hudEl('#hp-bar'), 'aria-valuenow', hpN);
      hudEl('#hp-bar').classList.toggle('low', hpF < 0.32);
    }
    if (this._stN !== stN) {
      this._stN = stN;
      setText(hudEl('#st-num'), stN);
      setAttr(hudEl('#st-bar'), 'aria-valuenow', stN);
      hudEl('#st-bar').classList.toggle('low', stF < 0.25);
    }

    // compass
    const strip = hudEl('#compass-strip');
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
    if (px !== this._compassPx) {
      this._compassPx = px;
      setStyle(strip, 'transform', `translateX(${-px + this.compassWidth() / 2}px)`);
    }

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
      setAttr(hudEl('#minimap'), 'aria-label',
        `Local map. ${near.length ? 'Near: ' + near.join(', ') + '.' : 'No settlement within 400 metres.'}` +
        (fires ? ` ${fires} fires burning.` : ''));
    }

    // quest tracker
    // questHash() joins every quest into a string; it used to run twice a frame
    // here, once to compare and once to store.
    const qhash = this.questHash();
    if (this._qhash !== qhash) {
      this._qhash = qhash;
      const box = hudEl('#quest-tracker');
      box.innerHTML = '';
      if (this.waypoint) {
        const d = Math.round(Math.hypot(this.waypoint.x - player.pos.x, this.waypoint.z - player.pos.z));
        const node = document.createElement('div');
        node.className = 'qt way';
        node.innerHTML = `<div class="qt-title">◈ ${this.waypoint.name || 'Waypoint'}</div><div class="qt-sub">${d > 999 ? (d / 1000).toFixed(1) + ' km' : d + ' m'}</div>`;
        box.appendChild(node);
      }
      for (const q of st.quests.filter(q => !q.done).slice(0, 3)) {
        const d = Math.round(Math.hypot(q.x - player.pos.x, q.z - player.pos.z));
        const node = document.createElement('div');
        node.className = 'qt';
        node.innerHTML = `<div class="qt-title">${q.title}</div><div class="qt-sub">${q.need ? `${Math.min(q.progress, q.need)}/${q.need} · ` : ''}${d} m</div>`;
        box.appendChild(node);
      }
    }
    if (this.panelOpen === 'world' && (this._wsT = (this._wsT || 0) + dt) > 2) { this._wsT = 0; this.renderWorldState(); }
  },

  // The compass strip is laid out by CSS, so its width is only knowable from
  // the document - and asking for it forces a synchronous layout. Cache it, and
  // drop the cache (and the cached strip offset) when the window is resized.
  compassWidth() {
    if (this._compassW === undefined) {
      this._compassW = 0;
      addEventListener('resize', () => { this._compassW = 0; this._compassPx = null; });
    }
    if (this._compassW === 0) this._compassW = hudEl('#compass').clientWidth;
    return this._compassW;
  },

  // Bearing in the same frame the compass strip uses (see updateCompassPips).
  bearingTo(dx, dz) {
    const yaw = Math.atan2(-dx, -dz);
    return ((-yaw + Math.PI) % 6.283185 + 6.283185) % 6.283185;
  },

  // Pips ride the compass so the player can navigate by looking at the world
  // instead of by opening a map.
  updateCompassPips(player) {
    const box = hudEl('#compass-pips');
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
        const node = document.createElement('i');
        node.className = 'pip ' + t.cls;
        node.dataset.label = t.label;
        box.appendChild(node);
        return { node, t };
      });
    }
    if (!this._pips) return;
    const W = this.compassWidth() || 260;
    const heading = ((-player.camYaw + Math.PI) % 6.283185 + 6.283185) % 6.283185;
    const pxPerRad = (48 * 40) / 6.283185;
    for (const p of this._pips) {
      const { node, t } = p;
      const dx = t.x - player.pos.x, dz = t.z - player.pos.z;
      let delta = this.bearingTo(dx, dz) - heading;
      while (delta > Math.PI) delta -= 6.283185;
      while (delta < -Math.PI) delta += 6.283185;
      const x = W / 2 + delta * pxPerRad;
      if (x < -20 || x > W + 20) { if (p.shown !== 0) { p.shown = 0; setStyle(node, 'display', 'none'); } continue; }
      if (p.shown !== 1) { p.shown = 1; setStyle(node, 'display', ''); }
      if (p.x !== x) { p.x = x; setStyle(node, 'transform', `translateX(${x}px)`); }
      const op = clamp(1 - Math.abs(delta) / 1.4, 0.35, 1);
      if (p.op !== op) { p.op = op; setStyle(node, 'opacity', String(op)); }
      const dist = Math.round(Math.hypot(dx, dz));
      const label = dist > 999 ? (dist / 1000).toFixed(1) + 'km' : dist + 'm';
      if (p.dist !== label) { p.dist = label; node.dataset.dist = label; }
    }
  },

  questHash() {
    const w = this.waypoint;
    return this.state.quests.map(q => q.id + q.progress + q.done).join('|') +
      (w ? `w${w.x},${w.z}` : '') + Math.round(this.world.player.pos.x / 25) + Math.round(this.world.player.pos.z / 25);
  },

  // The contextual prompt shows the real keys, and hides them on touch where
  // the on-screen buttons are the controls.
  setPrompt(text, key = 'E', alt = null, altKey = 'F') {
    const p = hudEl('#prompt');
    if (!text) {
      if (this._promptShown !== 0) { this._promptShown = 0; p.classList.add('hidden'); }
      this._prompt = null;
      return;
    }
    const sig = text + '|' + (alt || '');
    if (this._prompt !== sig) {
      this._prompt = sig;
      const touch = document.body.classList.contains('touch');
      setText(hudEl('#prompt-text'), text);
      setText(hudEl('#prompt-key'), touch ? '◉' : key);
      const altBox = hudEl('#prompt-alt');
      if (alt) {
        altBox.classList.remove('hidden');
        setText(hudEl('#prompt-alt-key'), touch ? '✦' : altKey);
        setText(hudEl('#prompt-alt-text'), alt);
      } else altBox.classList.add('hidden');
    }
    if (this._promptShown !== 1) { this._promptShown = 1; p.classList.remove('hidden'); }
  }
};
