// HUD, maps, panels, touch controls, dialogue and toasts.
import { WORLD, FACTIONS } from './worldgen.js';
import { clamp } from './rng.js';
import { Cartographer } from './cartography.js';
import { Settings } from './settings.js';
import { PanelsMixin } from './panels.js';
import { MapMixin } from './map-ui.js';
import { RecordMixin } from './deeprecord.js';
import { $, icon, ITEM_ICONS, crest } from './uikit.js';

export { icon, ITEM_ICONS } from './uikit.js';

export class UI {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.panelOpen = null;
    this.mapScale = 1;
    this.baseMap = null;
    this.minimapT = 0;
    this.toastEls = [];
    this.carto = new Cartographer(state);
    this.mapView = Settings.get('mapView') || { cx: 0, cz: 0, span: WORLD.size };
    // the waypoint is part of the player's saved state, so a journey survives
    // closing the game
    Object.defineProperty(this, 'waypoint', {
      get: () => this.state.player.waypoint || null,
      set: (v) => { this.state.player.waypoint = v; },
    });
    this.bind();
  }

  bind() {
    document.querySelectorAll('.icon-btn[data-panel]').forEach(b => {
      b.addEventListener('click', () => this.openPanel(b.dataset.panel));
    });
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => this.showTab(t.dataset.tab));
    });
    $('#panel-close').addEventListener('click', () => this.closePanel());
    $('#panel').addEventListener('click', (e) => { if (e.target.id === 'panel') this.closePanel(); });
    $('#btn-menu').addEventListener('click', () => this.openMenu());
    // Tab / Journal etc. reopen where the player left off when opened generically
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !this.blocking) this.togglePanel(this.lastTab);
    });
    $('#menu-close').addEventListener('click', () => this.closeMenu());
    $('#menu').addEventListener('click', (e) => { if (e.target.id === 'menu') this.closeMenu(); });
    $('#m-resume').addEventListener('click', () => this.closeMenu());
    $('#m-save').addEventListener('click', () => {
      const ok = this.state.save();
      this.toast(ok ? 'World saved.' : 'Could not save — storage is full or blocked.', ok ? 'good' : 'bad');
    });
    const mute = $('#m-mute');
    mute.addEventListener('click', () => {
      const m = !this.world.audio.muted;
      this.world.audio.setMuted(m);
      Settings.set('muted', m);
      this.syncSettingsUI();
    });
    document.querySelectorAll('.seg-btn[data-q]').forEach(b => {
      b.addEventListener('click', () => {
        this.world.setQuality(b.dataset.q);
        Settings.set('quality', b.dataset.q);
        this.syncSettingsUI();
        this.toast('Detail: ' + b.dataset.q);
      });
    });
    const vol = $('#m-vol');
    vol.addEventListener('input', () => {
      const v = Number(vol.value) / 100;
      Settings.set('volume', v);
      this.world.audio.setVolume(v);
      if (v > 0 && this.world.audio.muted) { this.world.audio.setMuted(false); Settings.set('muted', false); }
      $('#m-vol-out').textContent = Math.round(v * 100) + '%';
      $('#m-mute').textContent = this.world.audio.muted ? 'Off' : 'On';
      $('#m-mute').setAttribute('aria-pressed', this.world.audio.muted ? 'false' : 'true');
    });
    vol.addEventListener('change', () => this.world.audio.play('ui'));
    const sens = $('#m-sens');
    sens.addEventListener('input', () => {
      const v = Number(sens.value);
      Settings.set('sensitivity', v);
      this.world.input.sensitivity = v;
      $('#m-sens-out').textContent = v.toFixed(1) + '×';
    });
    $('#m-motion').addEventListener('click', () => {
      Settings.set('reducedMotion', !Settings.motionReduced);
      Settings.applyDocument();
      this.world.player.shakeScale = Settings.motionReduced ? 0.15 : 1;
      this.syncSettingsUI();
    });
    $('#m-invert').addEventListener('click', () => {
      Settings.set('invertY', !Settings.get('invertY'));
      this.world.input.invertY = Settings.get('invertY');
      this.syncSettingsUI();
    });
    $('#m-help').addEventListener('click', () => this.showHelp());
    $('#m-reset').addEventListener('click', () => {
      this.confirmAction(
        'Erase this world?',
        'Every trail you have worn, every scar you have burned and every village you have helped will be gone. This cannot be undone.',
        'Hold to erase',
        () => { try { localStorage.removeItem('living_frontier_save_v1'); } catch (e) { } location.reload(); });
    });
    this.bindConfirm();
    $('#rep-close').addEventListener('click', () => this.closeHomecoming());
    $('#report').addEventListener('click', (e) => { if (e.target.id === 'report') this.closeHomecoming(); });
    $('#dlg-close').addEventListener('click', () => this.closeDialog());

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.key === 'Escape') {
        // close the top-most surface first, only then reach for the menu
        if (this.reportOpen) this.closeHomecoming();
        else if (this.confirmOpen) this.closeConfirm();
        else if (this.dialogOpen) this.closeDialog();
        else if (this.recordOpen) this.closeRecord();
        else if (this.panelOpen) this.closePanel();
        else if (!$('#menu').classList.contains('hidden')) this.closeMenu();
        else this.openMenu();
        e.preventDefault();
        return;
      }
      if (e.code === 'Tab') this.trapFocus(e);
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyH' && !this.blocking) { this.showHelp(); return; }
      if (e.code === 'KeyQ' && !this.blocking) { this.quickRestore(); return; }
      if (e.code === 'KeyM') this.togglePanel('map');
      if (e.code === 'KeyI' || e.code === 'KeyB') this.togglePanel('bag');
      if (e.code === 'KeyJ') this.togglePanel('journal');
      if (e.code === 'KeyV') this.togglePanel('world');
      if (e.code === 'KeyR') { if (this.recordOpen) this.closeRecord(); else { this.closePanel(); this.openRecord(); } }
    });

    // touch joystick
    const zone = $('#touch-left'), base = $('#stick-base'), knob = $('#stick-knob');
    let id = null, cx = 0, cy = 0;
    const R = 52;
    const set = (dx, dy) => {
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      this.world.input.move.set(clamp(dx / R, -1, 1), clamp(-dy / R, -1, 1));
    };
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = zone.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      base.classList.add('active');
      set(t.clientX - cx, t.clientY - cy);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) set(t.clientX - cx, t.clientY - cy);
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; knob.style.transform = 'translate(0,0)';
        base.classList.remove('active'); this.world.input.move.set(0, 0);
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    const hold = (el, down, up) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); up && up(); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); down(); });
      el.addEventListener('mouseup', () => up && up());
    };
    hold($('#tb-interact'), () => { this.world.input.interactPressed = true; });
    hold($('#tb-attack'), () => { this.world.input.attackPressed = true; });
    hold($('#tb-jump'), () => { this.world.input.jumpPressed = true; });
    const sprintBtn = $('#tb-sprint');
    sprintBtn.addEventListener('click', () => {
      this.world.input.sprint = !this.world.input.sprint;
      sprintBtn.classList.toggle('on', this.world.input.sprint);
      sprintBtn.setAttribute('aria-pressed', this.world.input.sprint ? 'true' : 'false');
    });

    this.bindMap();
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
  }

  quickRestore() {
    const inv = this.state.player.inv;
    const p = this.world.player;
    const hurt = p.hp < p.maxHp - 6, tired = p.stamina < 70;
    const order = hurt ? ['berry', 'herb', 'hide'] : tired ? ['herb', 'hide', 'berry'] : [];
    if (!order.length) { this.toast('Nothing to mend right now.'); return false; }
    const USES = this.itemUses();
    for (const k of order) {
      if ((inv[k] || 0) < 1) continue;
      inv[k] -= 1;
      USES[k].run();
      this.world.audio.play('pick');
      this.toast(`${USES[k].verb} · ${USES[k].label}`, 'good');
      if (this.panelOpen === 'bag') this.renderBag();
      return true;
    }
    this.toast('No food or herbs in the bag.');
    return false;
  }
  itemUses() {
    const p = this.world.player;
    return {
      berry: { verb: 'Ate berries', label: '+18 health', run: () => p.heal(18) },
      herb: { verb: 'Chewed herbs', label: '+12 health, +40 stamina', run: () => { p.heal(12); p.stamina = clamp(p.stamina + 40, 0, 100); } },
      hide: { verb: 'Wrapped up', label: '+25 stamina', run: () => { p.stamina = clamp(p.stamina + 25, 0, 100); } },
    };
  }

  // ----------------------------------------------------------- preferences
  syncSettingsUI() {
    const muted = this.world.audio.muted;
    const mute = $('#m-mute');
    if (mute) { mute.textContent = muted ? 'Off' : 'On'; mute.setAttribute('aria-pressed', muted ? 'false' : 'true'); mute.classList.toggle('on', !muted); }
    document.querySelectorAll('.seg-btn[data-q]').forEach(b => {
      const on = b.dataset.q === this.world.quality;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const m = $('#m-motion');
    if (m) { const on = Settings.motionReduced; m.textContent = on ? 'On' : 'Off'; m.classList.toggle('on', on); m.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const inv = $('#m-invert');
    if (inv) { const on = !!Settings.get('invertY'); inv.textContent = on ? 'On' : 'Off'; inv.classList.toggle('on', on); inv.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const vol = $('#m-vol');
    if (vol) { vol.value = String(Math.round(Number(Settings.get('volume')) * 100)); $('#m-vol-out').textContent = vol.value + '%'; }
    const sens = $('#m-sens');
    if (sens) { sens.value = String(Settings.get('sensitivity')); $('#m-sens-out').textContent = Number(sens.value).toFixed(1) + '×'; }
  }

  // The account of everything that happened without you. Shown once, on
  // return, and also written into the chronicle so it is never lost.
  showHomecoming(lines, days, awaySeconds) {
    if (!lines || !lines.length) return false;
    const hrs = awaySeconds / 3600;
    const real = hrs < 1 ? `${Math.max(1, Math.round(awaySeconds / 60))} minutes` : `${hrs.toFixed(1)} hours`;
    $('#rep-sub').textContent = `${real} away · ${days} day${days === 1 ? '' : 's'} passed on the frontier`;
    const list = $('#rep-list');
    list.innerHTML = '';
    for (const l of lines) {
      const li = document.createElement('li');
      li.className = l.kind || 'world';
      const fi = l.banner !== undefined ? l.banner : l.faction;
      if (fi !== undefined && FACTIONS[fi]) {
        li.style.borderLeftColor = FACTIONS[fi].accent;
        li.innerHTML = crest(fi, FACTIONS[fi].name, FACTIONS[fi].accent) + '<span></span>';
        li.lastChild.textContent = l.text;          // text stays text, never markup
      } else {
        li.textContent = l.text;
      }
      list.appendChild(li);
    }
    this.reportOpen = true;
    this.openSheet('#report');
    return true;
  }
  closeHomecoming() { this.reportOpen = false; this.closeSheet('#report'); }

  // ----------------------------------------------- destructive confirmation
  // A native confirm() is silently suppressed inside sandboxed frames, so the
  // game asks for itself — and asks the player to hold, not just tap.
  bindConfirm() {
    const yes = $('#cfm-yes'), no = $('#cfm-no');
    if (!yes) return;
    let raf = null, t0 = 0;
    const HOLD = 900;
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      yes.style.setProperty('--fill', '0%');
    };
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / HOLD);
      yes.style.setProperty('--fill', (p * 100) + '%');
      if (p >= 1) { stop(); const fn = this._confirmFn; this.closeConfirm(); fn && fn(); return; }
      raf = requestAnimationFrame(tick);
    };
    const start = (e) => { e.preventDefault(); t0 = Date.now(); stop(); raf = requestAnimationFrame(tick); };
    yes.addEventListener('pointerdown', start);
    yes.addEventListener('pointerup', stop);
    yes.addEventListener('pointercancel', stop);
    yes.addEventListener('pointerleave', stop);
    yes.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !raf) { t0 = Date.now(); raf = requestAnimationFrame(tick); } });
    yes.addEventListener('keyup', stop);
    no.addEventListener('click', () => this.closeConfirm());
    $('#confirm').addEventListener('click', (e) => { if (e.target.id === 'confirm') this.closeConfirm(); });
  }
  confirmAction(title, text, label, fn) {
    $('#cfm-title').textContent = title;
    $('#cfm-text').textContent = text;
    $('#cfm-yes').querySelector('.cfm-label').textContent = label;
    this._confirmFn = fn;
    this.confirmOpen = true;
    this.openSheet('#confirm');
  }
  closeConfirm() { this.confirmOpen = false; this._confirmFn = null; this.closeSheet('#confirm'); }

  showHelp() {
    const touch = document.body.classList.contains('touch');
    this.openDialog('How the frontier works', '', [
      { label: touch ? 'Move · left stick' : 'Move · W A S D', sub: touch ? 'Look · drag anywhere on the right' : 'Look · drag the mouse · Sprint · Shift · Jump · Space', keepOpen: true },
      { label: touch ? 'Act · the hand button' : 'Act · E', sub: 'Harvest, talk, trade, enter. A second action sits on F (or the blade button): chop, set alight, attack.', keepOpen: true },
      { label: 'Your map is drawn by walking', sub: 'Country you have never seen stays blank paper. Climb high ground to survey further. Tap the map to plant a waypoint.', keepOpen: true },
      { label: 'The world keeps its memory', sub: 'Trails wear in, fires leave scars, hunted valleys empty out, villages you help build up — and it all keeps running while you are away.', keepOpen: true },
      { label: 'Q mends you', sub: 'Eats or chews whatever in your bag helps most, without opening it.', keepOpen: true },
      { label: 'Close', action: () => this.closeDialog() },
    ]);
  }

  // Generic modal sheet handling with focus management.
  openSheet(sel) {
    const el = $(sel);
    this._lastFocus = document.activeElement;
    el.classList.remove('hidden');
    const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable && focusable.focus) setTimeout(() => focusable.focus(), 30);
  }
  closeSheet(sel) {
    const el = $(sel);
    el.classList.add('closing');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('closing'); }, 200);
    if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus();
  }

  // Keeps Tab inside whichever modal surface is open.
  trapFocus(e) {
    const host = this.reportOpen ? $('#report') : this.confirmOpen ? $('#confirm') : this.dialogOpen ? $('#dialog')
      : this.panelOpen ? $('#panel') : !$('#menu').classList.contains('hidden') ? $('#menu') : null;
    if (!host) return;
    const items = [...host.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null || el.tagName === 'CANVAS');
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  // --------------------------------------------------------------- panels
  togglePanel(name) { if (this.panelOpen === name) this.closePanel(); else this.openPanel(name); }
  get lastTab() { const t = Settings.get('lastTab'); return ['map', 'bag', 'journal', 'world'].includes(t) ? t : 'map'; }
  openPanel(name) {
    this.panelOpen = name;
    this.openSheet('#panel');
    this.showTab(name);
    this.world.audio.play('ui');
  }
  closePanel() {
    this.closeSheet('#panel');
    this.panelOpen = null;
  }
  showTab(name) {
    this.panelOpen = name;
    Settings.set('lastTab', name);
    document.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
    if (name === 'map') this.drawBigMap();
    if (name === 'bag') this.renderBag();
    if (name === 'journal') this.renderJournal();
    if (name === 'world') this.renderWorldState();
  }
  openMenu() { this.syncSettingsUI(); this.openSheet('#menu'); this.world.audio.play('ui'); }
  closeMenu() { this.closeSheet('#menu'); }

  // -------------------------------------------------------------- dialogue
  openDialog(name, text, options, faction) {
    const nameEl = $('#dlg-name');
    nameEl.textContent = name;
    // who you are speaking for, shown as heraldry and said in words
    if (faction !== undefined && FACTIONS[faction]) {
      const f = FACTIONS[faction];
      nameEl.insertAdjacentHTML('afterbegin', crest(faction, f.name, f.accent, `Under the banner of ${f.name}. `));
      nameEl.style.color = f.accent;
    } else {
      nameEl.style.color = '';
    }
    $('#dlg-text').textContent = text;
    const box = $('#dlg-options');
    box.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.innerHTML = o.label + (o.sub ? `<small>${o.sub}</small>` : '');
      b.addEventListener('click', () => { this.world.audio.play('ui'); o.action && o.action(); if (!o.keepOpen) this.closeDialog(); });
      box.appendChild(b);
    }
    this.dialogOpen = true;
    this.openSheet('#dialog');
  }
  closeDialog() {
    this.dialogOpen = false;
    this.closeSheet('#dialog');
  }
  get blocking() {
    return this.recordOpen || this.panelOpen !== null || this.dialogOpen || this.confirmOpen
      || this.reportOpen || !$('#menu').classList.contains('hidden');
  }

  // ---------------------------------------------------------------- toasts
  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 3000);
    const kids = $('#toasts').children;
    while (kids.length > 4) kids[0].remove();
  }
  damageFlash() {
    const f = $('#damage-flash');
    f.style.opacity = '0.85';
    setTimeout(() => { f.style.opacity = '0'; }, 90);
  }
  discovery(title) {
    const b = $('#discovery-banner');
    b.querySelector('.db-title').textContent = title;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 3200);
  }

  // ---------------------------------------------------------------- views

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
    if (!this._qhash || this._qhash !== this.questHash()) {
      this._qhash = this.questHash();
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

Object.assign(UI.prototype, PanelsMixin, RecordMixin, MapMixin);
