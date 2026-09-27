// The panels that show the player what the simulation is doing: the bag, the
// chronicle, and the world screen with its chart of the world's own past.
// Mixed onto UI.prototype in ui.js.
import { FACTIONS, LANDMARKS } from './worldgen.js';
import { clamp } from './rng.js';
import { $, icon, ITEM_ICONS } from './uikit.js';

export const PanelsMixin = {
  renderBag() {
    const inv = this.state.player.inv;
    const g = $('#bag-grid');
    g.innerHTML = '';
    const USES = this.itemUses();
    for (const k of ['wood', 'stone', 'hide', 'herb', 'ore', 'berry', 'relic']) {
      const el = document.createElement('div');
      el.className = 'slot';
      const use = USES[k];
      el.innerHTML = `<div class="ico">${icon(ITEM_ICONS[k] || 'relic', 'ic lg')}</div><div class="n">${Math.floor(inv[k] || 0)}</div><div class="l">${k}</div>` +
        (use ? `<div class="use">${use.label}<em>Q</em></div>` : '');
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
  },

  // Jump from a chronicle entry to the state of the world on that day.
  showDayOnChart(day) {
    this.chartDay = day;
    this.showTab('world');
    this.drawHistoryChart(this.state);
    const cv = document.getElementById('ws-chart');
    if (cv && cv.focus) cv.focus();
    this.world.audio.play('ui');
  },

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
    const entries = this.state.journal.slice(0, 60);
    if (!entries.length) {
      jl.innerHTML = '<p class="hint">Nothing has happened yet. The chronicle fills itself as the frontier changes — fires, raids, villages rising and falling, whether you were there or not.</p>';
    }
    let lastDay = null;
    for (const e of entries) {
      if (e.day !== lastDay) {
        lastDay = e.day;
        const h = document.createElement('div');
        h.className = 'jday';
        const known = this.state.history.some(r => r[0] === e.day);
        if (known) {
          // the chronicle and the chart are two views of the same day
          const b = document.createElement('button');
          b.className = 'jday-btn';
          b.type = 'button';
          b.innerHTML = `Day ${e.day} <span>see the world that day</span>`;
          b.addEventListener('click', () => this.showDayOnChart(e.day));
          h.appendChild(b);
        } else {
          h.textContent = 'Day ' + e.day;
        }
        jl.appendChild(h);
      }
      const el = document.createElement('div');
      el.className = 'jrow ' + e.kind;
      el.innerHTML = `<span class="t">${e.text}</span>`;
      jl.appendChild(el);
    }
  },

  // A plain-language reading of the same data the chart draws, so the chart is
  // not the only way to get at it.
  describeHistory(st) {
    const h = st.history, a = h[0], b = h[h.length - 1];
    const dir = (from, to, noun) => {
      const d = to - from;
      if (Math.abs(d) < Math.max(1, from * 0.08)) return `${noun} steady`;
      return `${noun} ${d > 0 ? 'up' : 'down'} from ${from} to ${to}`;
    };
    return `Over ${b[0] - a[0]} days: ${dir(a[1], b[1], 'herds')}, ${dir(a[2], b[2], 'predators')}, `
      + `${dir(a[3], b[3], 'forest cover')}, ${dir(a[4], b[4], 'scorched cells')}, `
      + `${dir(a[8], b[8], 'village prosperity')}.`;
  },

  // The world's own biography: one line per tracked quantity, normalised
  // against its own range so a crash in the herds is visible even when the
  // absolute numbers are large.
  // Reading the chart: the chart is also the index to the chronicle, so
  // landing on a day shows both the numbers and what you wrote down that day.
  bindHistoryChart(cv, st) {
    if (!cv || cv.__bound) return;
    cv.__bound = true;
    const pick = (clientX) => {
      const r = cv.getBoundingClientRect();
      const w = r.width || cv.width;
      const t = w ? (clientX - r.left) / w : 0;
      const pad = 16 / cv.width;
      const u = Math.max(0, Math.min(1, (t - pad) / Math.max(1e-6, 1 - pad * 2)));
      const h = this.state.history;
      this.chartDay = h[Math.round(u * (h.length - 1))][0];
      this.drawHistoryChart(this.state);
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => {
      dragging = true;
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      pick(e.clientX); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => { if (dragging) pick(e.clientX); });
    const stop = () => { dragging = false; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('keydown', (e) => {
      const h = this.state.history;
      if (!h.length) return;
      let i = this.chartIndex(h);
      if (e.key === 'ArrowLeft') i--;
      else if (e.key === 'ArrowRight') i++;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = h.length - 1;
      else return;
      this.chartDay = h[Math.max(0, Math.min(h.length - 1, i))][0];
      this.drawHistoryChart(this.state);
      e.preventDefault(); e.stopPropagation();
    });
  },

  // Which sample the reader is looking at: their chosen day if it still
  // exists in the kept history, otherwise today.
  chartIndex(h) {
    if (this.chartDay == null) return h.length - 1;
    let best = h.length - 1, bd = Infinity;
    for (let i = 0; i < h.length; i++) {
      const d = Math.abs(h[i][0] - this.chartDay);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },

  // The readout for one day: the numbers, and the chronicle of that day.
  renderChartReadout(st, row) {
    const el = $('#ws-read');
    if (!el) return '';
    const events = st.journal.filter(e => e.day === row[0]);
    const text = `Day ${row[0]} · ${row[1]} herd animals · ${row[2]} predators · `
      + `${row[3]}% forest · ${row[4]} scorched cells · prosperity ${(row[8] / 100).toFixed(2)}`;
    el.innerHTML = `<b>${text}</b>`
      + (events.length
        ? `<ul>${events.slice(0, 4).map(e => `<li class="k-${e.kind}">${e.text}</li>`).join('')}</ul>`
        : `<span class="none">nothing was written in the chronicle that day</span>`);
    return text + (events.length ? `. Chronicle: ${events.slice(0, 4).map(e => e.text).join(' ')}` : '. Nothing recorded.');
  },

  drawHistoryChart(st) {
    const cv = document.getElementById('ws-chart');
    if (!cv || st.history.length < 2) return;
    this.bindHistoryChart(cv, st);
    const g = cv.getContext('2d');
    if (!g) return;
    const W = cv.width, H = cv.height, pad = 16, foot = 26;   // foot leaves room for labels
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#12150f';
    g.fillRect(0, 0, W, H);
    const h = st.history;
    const x = (i) => pad + (i / (h.length - 1)) * (W - pad * 2);

    // day gridlines every 5 in-world days
    g.strokeStyle = 'rgba(226,208,164,.09)'; g.lineWidth = 1;
    for (let i = 0; i < h.length; i++) {
      if (h[i][0] % 5) continue;
      g.beginPath(); g.moveTo(x(i), pad * 0.4); g.lineTo(x(i), H - foot); g.stroke();
    }

    const series = [
      { k: 1, c: '#9ec98a' },   // prey
      { k: 2, c: '#ef6a54' },   // predators
      { k: 3, c: '#68d18a' },   // forest
      { k: 4, c: '#8a6a4a' },   // scorched
      { k: 8, c: '#e0b661' },   // prosperity
    ];
    for (const s of series) {
      let lo = Infinity, hi = -Infinity;
      for (const row of h) { lo = Math.min(lo, row[s.k]); hi = Math.max(hi, row[s.k]); }
      const range = hi - lo;
      const top = pad, bot = H - foot;
      const y = (v) => range < 1e-6 ? (top + bot) / 2 : bot - ((v - lo) / range) * (bot - top);
      g.beginPath();
      for (let i = 0; i < h.length; i++) {
        const px = x(i), py = y(h[i][s.k]);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.strokeStyle = s.c; g.lineWidth = 2; g.lineJoin = 'round';
      g.globalAlpha = range < 1e-6 ? 0.35 : 1;
      g.stroke();
      // a dot on today's value, so the present is findable at a glance
      g.beginPath(); g.arc(x(h.length - 1), y(h[h.length - 1][s.k]), 3, 0, Math.PI * 2);
      g.fillStyle = s.c; g.fill();
      g.globalAlpha = 1;
    }
    // days you wrote something on get a tick: the chart is an index
    const written = new Set(st.journal.map(e => e.day));
    g.fillStyle = 'rgba(226,208,164,.45)';
    for (let i = 0; i < h.length; i++) {
      if (!written.has(h[i][0])) continue;
      g.fillRect(x(i) - 1, H - foot + 2, 2, 5);
    }

    // the reading cursor
    const ci = this.chartIndex(h);
    const cx = x(ci);
    g.strokeStyle = 'rgba(245,238,220,.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, pad * 0.4); g.lineTo(cx, H - foot); g.stroke();
    for (const s of series) {
      let lo = Infinity, hi = -Infinity;
      for (const row of h) { lo = Math.min(lo, row[s.k]); hi = Math.max(hi, row[s.k]); }
      const range = hi - lo, top = pad, bot = H - foot;
      const yv = range < 1e-6 ? (top + bot) / 2 : bot - ((h[ci][s.k] - lo) / range) * (bot - top);
      g.beginPath(); g.arc(cx, yv, 4.5, 0, Math.PI * 2);
      g.fillStyle = '#12150f'; g.fill();
      g.lineWidth = 2; g.strokeStyle = s.c; g.stroke();
    }
    const read = this.renderChartReadout(st, h[ci]);
    if (read) cv.setAttribute('aria-label', this.describeHistory(st) + ' Selected: ' + read);

    // day labels at the ends
    g.strokeStyle = 'rgba(226,208,164,.18)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, H - foot + 6); g.lineTo(W - pad, H - foot + 6); g.stroke();
    g.fillStyle = 'rgba(226,208,164,.55)'; g.font = '14px system-ui, sans-serif';
    g.fillText('day ' + h[0][0], pad, H - 6);
    const last = 'day ' + h[h.length - 1][0];
    g.fillText(last, W - pad - g.measureText(last).width, H - 6);
  },

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

    let html = '';
    if (st.history.length >= 2) {
      const span = st.history[st.history.length - 1][0] - st.history[0][0];
      html += `<div class="ws-block"><h4>The last ${span} days</h4>
        <canvas id="ws-chart" width="720" height="240" role="img" tabindex="0"
          aria-label="${this.describeHistory(st)}"></canvas>
        <div id="ws-read" class="ws-read" aria-live="polite"></div>
        <div class="ws-legend">
          <span><i style="background:#9ec98a"></i>herds</span>
          <span><i style="background:#ef6a54"></i>predators</span>
          <span><i style="background:#68d18a"></i>forest</span>
          <span><i style="background:#8a6a4a"></i>scorched</span>
          <span><i style="background:#e0b661"></i>prosperity</span>
        </div>
        <p class="ws-hint">Drag across the chart — or focus it and use the arrow keys — to read any
        day, and see what you wrote in the chronicle that day.</p></div>`;
    } else {
      html += `<div class="ws-block"><h4>The last days</h4>
        <p class="ws-empty">The frontier has not lived long enough to have a history yet.
        Come back after a couple of days and this becomes a chart of everything you changed.</p></div>`;
    }

    html += `<div class="ws-block"><h4>Factions</h4>`;
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

    const surveyed = st.exploredFraction();
    html += `<div class="ws-block"><h4>Your survey</h4>
      <div class="frow"><span class="nm">Map drawn</span>${bar(surveyed * 1.6, '#e0b661')}<span class="vv">${Math.round(surveyed * 100)}%</span></div>
      <div class="frow"><span class="nm">Ground walked</span>${bar(st.player.stats.distance / 22000, '#c9b98a')}<span class="vv">${(st.player.stats.distance / 1000).toFixed(2)} km</span></div>
      ${this.waypoint ? `<div class="vil"><span>Waypoint · ${this.waypoint.name || 'unnamed'}</span><span class="tag">${Math.round(Math.hypot(this.waypoint.x - this.world.player.pos.x, this.waypoint.z - this.world.player.pos.z))} m</span></div>` : '<div class="vil"><span style="opacity:.55">No waypoint set — tap the map to plant one</span></div>'}
      </div>`;

    html += `<div class="ws-block"><h4>Discoveries</h4>`;
    for (const L of LANDMARKS) {
      const k = st.discovered[L.id];
      html += `<div class="vil"><span style="${k ? '' : 'opacity:.45'}">${k ? L.name : '??? — undiscovered'}</span>
        <span class="tag ${k ? 'thriving' : ''}">${k ? 'found day ' + k : 'rumoured'}</span></div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
    this.drawHistoryChart(st);
  },
};
