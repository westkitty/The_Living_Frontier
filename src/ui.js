// HUD, maps, panels, touch controls, dialogue and toasts.
import { WORLD, LANDMARKS, FACTIONS, heightAt, moistureAt, biomeAt, BIOME } from './worldgen.js';
import { clamp, lerp } from './rng.js';
import { CH, regionIndex, regionCenter, DAY_LENGTH } from './worldstate.js';

const $ = (s) => document.querySelector(s);
const ITEM_ICONS = { wood: '🪵', stone: '🪨', hide: '🦌', herb: '🌿', ore: '⛏', berry: '🍓', relic: '🏺', sapling: '🌱' };

export class UI {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.panelOpen = null;
    this.mapScale = 1;
    this.baseMap = null;
    this.minimapT = 0;
    this.toastEls = [];
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
    $('#menu-close').addEventListener('click', () => this.closeMenu());
    $('#menu').addEventListener('click', (e) => { if (e.target.id === 'menu') this.closeMenu(); });
    $('#m-resume').addEventListener('click', () => this.closeMenu());
    $('#m-save').addEventListener('click', () => { this.state.save(); this.toast('World saved.', 'good'); });
    $('#m-mute').addEventListener('click', (e) => {
      const m = !this.world.audio.muted;
      this.world.audio.setMuted(m);
      e.target.textContent = 'Sound: ' + (m ? 'off' : 'on');
    });
    $('#m-quality').addEventListener('click', (e) => {
      const q = this.world.cycleQuality();
      e.target.textContent = 'Quality: ' + q;
    });
    $('#m-reset').addEventListener('click', () => {
      if (confirm('Erase this world and all its memory?')) { localStorage.removeItem('living_frontier_save_v1'); location.reload(); }
    });
    $('#dlg-close').addEventListener('click', () => this.closeDialog());

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { if (this.panelOpen) this.closePanel(); else if (!$('#menu').classList.contains('hidden')) this.closeMenu(); else this.openMenu(); }
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyM') this.togglePanel('map');
      if (e.code === 'KeyI' || e.code === 'KeyB') this.togglePanel('bag');
      if (e.code === 'KeyJ') this.togglePanel('journal');
      if (e.code === 'KeyV') this.togglePanel('world');
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
    $('#tb-sprint').addEventListener('click', (e) => {
      this.world.input.sprint = !this.world.input.sprint;
      e.target.classList.toggle('on', this.world.input.sprint);
    });

    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
  }

  // --------------------------------------------------------------- panels
  togglePanel(name) { if (this.panelOpen === name) this.closePanel(); else this.openPanel(name); }
  openPanel(name) {
    this.panelOpen = name;
    $('#panel').classList.remove('hidden');
    this.showTab(name);
    this.world.audio.play('ui');
  }
  closePanel() {
    const p = $('#panel');
    p.classList.add('closing');
    setTimeout(() => { p.classList.add('hidden'); p.classList.remove('closing'); }, 200);
    this.panelOpen = null;
  }
  showTab(name) {
    this.panelOpen = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
    if (name === 'map') this.drawBigMap();
    if (name === 'bag') this.renderBag();
    if (name === 'journal') this.renderJournal();
    if (name === 'world') this.renderWorldState();
  }
  openMenu() { $('#menu').classList.remove('hidden'); this.world.audio.play('ui'); }
  closeMenu() { const m = $('#menu'); m.classList.add('closing'); setTimeout(() => { m.classList.add('hidden'); m.classList.remove('closing'); }, 200); }

  // -------------------------------------------------------------- dialogue
  openDialog(name, text, options) {
    $('#dlg-name').textContent = name;
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
    $('#dialog').classList.remove('hidden');
    this.dialogOpen = true;
  }
  closeDialog() {
    const d = $('#dialog');
    d.classList.add('closing');
    setTimeout(() => { d.classList.add('hidden'); d.classList.remove('closing'); }, 200);
    this.dialogOpen = false;
  }
  get blocking() { return this.panelOpen !== null || this.dialogOpen || !$('#menu').classList.contains('hidden'); }

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

  // ------------------------------------------------------------ base map
  buildBaseMap(res = 200) {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(res, res);
    const d = img.data;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = (i / res) * WORLD.size - WORLD.half;
        const z = (j / res) * WORLD.size - WORLD.half;
        const h = heightAt(x, z);
        const m = moistureAt(x, z);
        let r, g, b;
        if (h < 0) { r = 32; g = 58; b = 70; }
        else if (h < 2) { r = 120; g = 112; b = 84; }
        else if (h < 62) {
          const f = clamp((m - 0.3) * 2, 0, 1);
          r = lerp(126, 62, f); g = lerp(134, 96, f); b = lerp(76, 52, f);
        } else if (h < 108) { r = 108; g = 104; b = 78; }
        else if (h < 150) { r = 116; g = 112; b = 108; }
        else { r = 224; g = 230; b = 238; }
        const shade = clamp((heightAt(x - 12, z - 12) - h) * 0.03, -0.35, 0.35);
        const k = (j * res + i) * 4;
        d[k] = clamp(r * (1 - shade), 0, 255);
        d[k + 1] = clamp(g * (1 - shade), 0, 255);
        d[k + 2] = clamp(b * (1 - shade), 0, 255);
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.baseMap = c;
    this.baseRes = res;
    return c;
  }

  groundOverlay() {
    // cached canvas of burn/trail/dev drawn from the persistent ground buffer
    const R = WORLD.stateRes;
    if (!this._ovl) {
      this._ovl = document.createElement('canvas');
      this._ovl.width = this._ovl.height = R;
      this._ovlCtx = this._ovl.getContext('2d');
      this._ovlImg = this._ovlCtx.createImageData(R, R);
    }
    const g = this.state.ground, d = this._ovlImg.data;
    for (let i = 0; i < R * R; i++) {
      const burn = g[i * 4], trail = g[i * 4 + 1], dev = g[i * 4 + 3];
      const a = Math.max(burn * 0.85, Math.max(trail * 0.65, dev * 0.5));
      if (a < 6) { d[i * 4 + 3] = 0; continue; }
      if (burn >= trail && burn >= dev) { d[i * 4] = 46; d[i * 4 + 1] = 36; d[i * 4 + 2] = 32; }
      else if (trail >= dev) { d[i * 4] = 120; d[i * 4 + 1] = 98; d[i * 4 + 2] = 68; }
      else { d[i * 4] = 158; d[i * 4 + 1] = 140; d[i * 4 + 2] = 96; }
      d[i * 4 + 3] = a;
    }
    this._ovlCtx.putImageData(this._ovlImg, 0, 0);
    return this._ovl;
  }

  // ---------------------------------------------------------------- maps
  drawMinimap(player) {
    const c = $('#minimap');
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const view = 300; // metres across
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 1, 0, 6.283); ctx.clip();
    ctx.fillStyle = '#0d120f'; ctx.fillRect(0, 0, W, H);
    if (this.baseMap) {
      const px = (player.pos.x + WORLD.half) / WORLD.size;
      const pz = (player.pos.z + WORLD.half) / WORLD.size;
      const src = (view / WORLD.size) * this.baseRes;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.baseMap, px * this.baseRes - src / 2, pz * this.baseRes - src / 2, src, src, 0, 0, W, H);
      const ov = this.groundOverlay();
      const s2 = (view / WORLD.size) * WORLD.stateRes;
      ctx.drawImage(ov, px * WORLD.stateRes - s2 / 2, pz * WORLD.stateRes - s2 / 2, s2, s2, 0, 0, W, H);
    }
    const toXY = (x, z) => [((x - player.pos.x) / view + 0.5) * W, ((z - player.pos.z) / view + 0.5) * H];

    // settlements
    for (const s of this.state.settlements) {
      const [x, y] = toXY(s.x, s.z);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      ctx.fillStyle = s.abandoned ? '#6b6258' : FACTIONS[s.banner].accent;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // landmarks
    for (const L of LANDMARKS) {
      const [x, y] = toXY(L.x, L.z);
      ctx.fillStyle = this.state.discovered[L.id] ? '#e0b661' : 'rgba(224,182,97,.35)';
      ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.4, y + 3); ctx.lineTo(x - 3.4, y + 3); ctx.closePath(); ctx.fill();
    }
    // fires
    for (const c of this.state.burningList) {
      const [x, y] = toXY(c.x, c.z);
      ctx.fillStyle = '#ff8c3a'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.283); ctx.fill();
    }
    // actors
    for (const a of this.world.actors.animals) {
      if (!a.alive) continue;
      const [x, y] = toXY(a.pos.x, a.pos.z);
      ctx.fillStyle = a.def.pred ? '#ef6a54' : '#9ec98a';
      ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
    for (const a of this.world.actors.soldiers) {
      if (!a.alive) continue;
      const [x, y] = toXY(a.pos.x, a.pos.z);
      ctx.fillStyle = FACTIONS[a.faction].accent;
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
    // quest markers
    for (const q of this.state.quests) {
      if (q.done) continue;
      const [x, y] = toXY(q.x, q.z);
      ctx.strokeStyle = '#f2d698'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(clamp(x, 6, W - 6), clamp(y, 6, H - 6), 5, 0, 6.283); ctx.stroke();
    }
    // player
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-player.yaw + Math.PI);
    ctx.fillStyle = '#f5e7c0';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 5); ctx.lineTo(0, 2.6); ctx.lineTo(-4.2, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // ring
    ctx.strokeStyle = 'rgba(226,208,164,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 1, 0, 6.283); ctx.stroke();
    // north marker
    const na = -player.yaw + Math.PI;
    ctx.fillStyle = '#e0b661';
    ctx.font = '9px serif'; ctx.textAlign = 'center';
    ctx.fillText('N', W / 2 + Math.sin(na) * (W / 2 - 9), H / 2 - Math.cos(na) * (H / 2 - 9) + 3);
  }

  drawBigMap() {
    const c = $('#bigmap');
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d120f'; ctx.fillRect(0, 0, W, H);
    if (this.baseMap) ctx.drawImage(this.baseMap, 0, 0, W, H);
    ctx.drawImage(this.groundOverlay(), 0, 0, W, H);

    const toXY = (x, z) => [((x + WORLD.half) / WORLD.size) * W, ((z + WORLD.half) / WORLD.size) * H];

    // faction territory wash
    const RR = WORLD.regionRes, cell = W / RR;
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < this.state.regions.length; i++) {
      const r = this.state.regions[i];
      if (r.owner < 0) continue;
      ctx.fillStyle = FACTIONS[r.owner].accent;
      ctx.fillRect((i % RR) * cell, ((i / RR) | 0) * cell, cell, cell);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i <= RR; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(W, i * cell); ctx.stroke();
    }

    ctx.font = '11px serif'; ctx.textAlign = 'center';
    for (const L of LANDMARKS) {
      const [x, y] = toXY(L.x, L.z);
      const known = this.state.discovered[L.id];
      ctx.fillStyle = known ? '#e0b661' : 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath(); ctx.fill();
      if (known) { ctx.fillStyle = '#f3e6c6'; ctx.fillText(L.name, x, y - 11); }
    }
    for (const s of this.state.settlements) {
      const [x, y] = toXY(s.x, s.z);
      ctx.fillStyle = s.abandoned ? '#6b6258' : FACTIONS[s.banner].accent;
      const r = 4 + s.prosperity * 5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#efe6d2';
      ctx.fillText(s.name + (s.abandoned ? ' (ruined)' : ''), x, y - r - 5);
    }
    for (const c of this.state.burningList) {
      const [x, y] = toXY(c.x, c.z);
      ctx.fillStyle = '#ff8c3a'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.283); ctx.fill();
    }
    for (const q of this.state.quests) {
      if (q.done) continue;
      const [x, y] = toXY(q.x, q.z);
      ctx.strokeStyle = '#f2d698'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.stroke();
    }
    const p = this.world.player;
    const [px, py] = toXY(p.pos.x, p.pos.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-p.yaw + Math.PI);
    ctx.fillStyle = '#ffeec4';
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.6); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- views
  renderBag() {
    const inv = this.state.player.inv;
    const g = $('#bag-grid');
    g.innerHTML = '';
    const USES = {
      berry: { label: 'eat · +18 health', run: () => { this.world.player.heal(18); } },
      herb: { label: 'chew · +12 health, +40 stamina', run: () => { this.world.player.heal(12); this.world.player.stamina = clamp(this.world.player.stamina + 40, 0, 100); } },
      hide: { label: 'wrap up · +25 stamina', run: () => { this.world.player.stamina = clamp(this.world.player.stamina + 25, 0, 100); } },
    };
    for (const k of ['wood', 'stone', 'hide', 'herb', 'ore', 'berry', 'relic']) {
      const el = document.createElement('div');
      el.className = 'slot';
      const use = USES[k];
      el.innerHTML = `<div class="ico">${ITEM_ICONS[k] || '•'}</div><div class="n">${Math.floor(inv[k] || 0)}</div><div class="l">${k}</div>` +
        (use ? `<div class="use">${use.label}</div>` : '');
      if (use) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          if ((inv[k] || 0) < 1) { this.toast(`No ${k} left.`); return; }
          inv[k] -= 1; use.run(); this.world.audio.play('pick');
          this.toast(`Used 1 ${k}`, 'good');
          this.renderBag();
        });
      }
      g.appendChild(el);
    }
    const st = this.state.player.stats;
    const rep = this.state.player.rep;
    $('#bag-stats').innerHTML = `
      <div><b>Standing</b> — ${FACTIONS.map((f, i) => `${f.name}: <b style="color:${f.accent}">${Math.round(rep[i])}</b>`).join(' &nbsp;·&nbsp; ')}</div>
      <div><b>Travelled</b> ${(st.distance / 1000).toFixed(2)} km &nbsp;·&nbsp; <b>Trees felled</b> ${st.felled} &nbsp;·&nbsp; <b>Animals taken</b> ${st.hunted}</div>
      <div><b>Fires lit</b> ${st.fires} &nbsp;·&nbsp; <b>Saplings planted</b> ${st.planted} &nbsp;·&nbsp; <b>Tasks done</b> ${st.quests} &nbsp;·&nbsp; <b>Aid given</b> ${st.helped}</div>
      <div><b>Day</b> ${this.state.day} &nbsp;·&nbsp; <b>Discoveries</b> ${Object.keys(this.state.discovered).length}/${LANDMARKS.length}</div>`;
  }

  renderJournal() {
    const ql = $('#quest-list');
    ql.innerHTML = '';
    const qs = this.state.quests;
    if (!qs.length) ql.innerHTML = '<p class="hint">No tasks right now. Villages ask for help when they need it — visit them, or wait for word to spread.</p>';
    for (const q of qs) {
      const el = document.createElement('div');
      el.className = 'quest' + (q.done ? ' done' : '');
      el.innerHTML = `<h4>${q.title}</h4><p>${q.desc}</p>
        <div class="prog">${q.done ? '✓ complete' : q.need ? `${Math.min(q.progress, q.need)} / ${q.need}` : 'in progress'}</div>`;
      ql.appendChild(el);
    }
    const jl = $('#journal-list');
    jl.innerHTML = '';
    for (const e of this.state.journal.slice(0, 50)) {
      const el = document.createElement('div');
      el.className = 'jrow ' + e.kind;
      el.innerHTML = `<span class="d">Day ${e.day}</span><span class="t">${e.text}</span>`;
      jl.appendChild(el);
    }
  }

  renderWorldState() {
    const st = this.state;
    const el = $('#world-state');
    const totalRegions = st.regions.length;
    let prey = 0, pred = 0, trees = 0, burned = 0;
    for (const r of st.regions) { prey += r.prey; pred += r.pred; trees += r.trees; }
    for (let i = 0; i < st.ground.length; i += 4) if (st.ground[i] > 60) burned++;
    const burnPct = (burned / (st.ground.length / 4)) * 100;
    trees /= totalRegions;

    const bar = (v, color) => `<div class="meter"><i style="width:${clamp(v, 0, 1) * 100}%;background:${color}"></i></div>`;

    let html = `<div class="ws-block"><h4>Factions</h4>`;
    for (let i = 0; i < 3; i++) {
      const f = st.factions[i];
      html += `<div class="frow"><span class="nm" style="color:${FACTIONS[i].accent}">${FACTIONS[i].name}</span>
        ${bar(f.territory / totalRegions * 2.2, FACTIONS[i].accent)}
        <span class="vv">${Math.round(f.territory / totalRegions * 100)}% land</span></div>
        <div class="frow"><span class="nm" style="opacity:.6;font-size:11px">your standing</span>
        ${bar((st.player.rep[i] + 100) / 200, st.player.rep[i] < 0 ? '#ef6a54' : '#68d18a')}
        <span class="vv">${Math.round(st.player.rep[i])}</span></div>`;
    }
    html += `</div>`;

    html += `<div class="ws-block"><h4>Settlements</h4>`;
    for (const s of st.settlements) {
      const cls = s.abandoned ? 'abandoned' : s.status;
      html += `<div class="vil"><span>${s.name} <span style="color:${FACTIONS[s.banner].accent};font-size:10px">◆</span>
        <span style="color:var(--dim);font-size:11px"> · ${Math.round(s.population)} souls · ${s.buildings} buildings${s.walls ? ` · walls ${s.walls}/3` : ''}</span></span>
        <span class="tag ${cls}">${s.abandoned ? 'abandoned' : s.status}</span></div>`;
    }
    html += `</div>`;

    html += `<div class="ws-block"><h4>Ecology</h4>
      <div class="frow"><span class="nm">Grazing herds</span>${bar(prey / (totalRegions * 22), '#9ec98a')}<span class="vv">${Math.round(prey)}</span></div>
      <div class="frow"><span class="nm">Predators</span>${bar(pred / (totalRegions * 3.2), '#ef6a54')}<span class="vv">${Math.round(pred)}</span></div>
      <div class="frow"><span class="nm">Forest health</span>${bar(trees, '#68d18a')}<span class="vv">${Math.round(trees * 100)}%</span></div>
      <div class="frow"><span class="nm">Scorched land</span>${bar(burnPct / 25, '#8a6a4a')}<span class="vv">${burnPct.toFixed(1)}%</span></div>
      <div class="frow"><span class="nm">Active fires</span>${bar(st.burningCount() / 40, '#ff8c3a')}<span class="vv">${st.burningCount()}</span></div>
      </div>`;

    html += `<div class="ws-block"><h4>Discoveries</h4>`;
    for (const L of LANDMARKS) {
      const k = st.discovered[L.id];
      html += `<div class="vil"><span style="${k ? '' : 'opacity:.45'}">${k ? L.name : '??? — undiscovered'}</span>
        <span class="tag ${k ? 'thriving' : ''}">${k ? 'found day ' + k : 'rumoured'}</span></div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }

  // ------------------------------------------------------------ hud tick
  update(dt, player) {
    const st = this.state;
    const mins = Math.floor(st.time * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('#time-label').textContent = `${hh}:${mm}`;
    $('#day-label').textContent = 'Day ' + st.day;
    const wIcon = { clear: '☀', cloudy: '☁', rain: '🌧', storm: '⛈', fogbank: '🌫', snow: '❄' }[st.weather.type] || '☀';
    $('#weather-icon').textContent = st.time < 0.22 || st.time > 0.8 ? (st.weather.type === 'clear' ? '🌙' : wIcon) : wIcon;
    $('#weather-label').textContent = st.weather.type[0].toUpperCase() + st.weather.type.slice(1);

    $('#hp-fill').style.transform = `scaleX(${clamp(player.hp / player.maxHp, 0, 1)})`;
    $('#st-fill').style.transform = `scaleX(${clamp(player.stamina / 100, 0, 1)})`;

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

    this.minimapT -= dt;
    if (this.minimapT <= 0) { this.minimapT = 0.12; this.drawMinimap(player); }

    // quest tracker
    if (!this._qhash || this._qhash !== this.questHash()) {
      this._qhash = this.questHash();
      const box = $('#quest-tracker');
      box.innerHTML = '';
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
  questHash() {
    return this.state.quests.map(q => q.id + q.progress + q.done).join('|') + Math.round(this.world.player.pos.x / 25);
  }

  setPrompt(text, key = 'E') {
    const p = $('#prompt');
    if (!text) { p.classList.add('hidden'); this._prompt = null; return; }
    if (this._prompt !== text) {
      this._prompt = text;
      $('#prompt-text').textContent = text;
      $('#prompt-key').textContent = key;
    }
    p.classList.remove('hidden');
  }
}
