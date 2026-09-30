// The world screen: what the simulation has actually been doing.
//
// It used to be one innerHTML string, re-assigned every two seconds while the
// tab was open. That was cheap to write and wrong in three ways a player can
// feel: it threw away keyboard focus mid-sentence, it rebuilt a screen whose
// numbers had not changed, and it left the chart's selected day sitting beside
// a world screen reporting today. So the shell is built once and only the
// readings are rewritten — and the day you scrub to on the chart now governs
// the whole screen, because a world screen that says "day 12" above numbers
// from day 44 is telling a lie.
import { FACTIONS, LANDMARKS } from './worldgen.js';
import { clamp } from './rng.js';
import { $, icon, crest } from './uikit.js';
import { chartSeries, drawChronicleChart, dayAtClientX, seriesRanges } from './chart.js';

export const WorldScreenMixin = {
  // The five tracked quantities, in one place so the chart, the legend and the
  // readout can never disagree about what is being drawn.
  chartSeries,
  chartHiddenSet() {
    if (!this._chartHidden) this._chartHidden = new Set();
    return this._chartHidden;
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

  // The row of the chronicle the reader is standing on: the day they chose, or
  // today when they have not chosen one. Everything day-scoped reads from here.
  readingRow() {
    const h = this.state.history;
    if (h.length < 2) return null;
    return h[this.chartIndex(h)];
  },
  isToday() {
    const r = this.readingRow();
    return !r || r[0] >= this.state.day;
  },

  // ------------------------------------------------------------- the shell
  // Built once per world. Returns true when it had to be rebuilt, so callers
  // know whether the chart and its listeners need re-binding.
  buildWorldScreen() {
    const st = this.state;
    const el = $('#world-state');
    const hasHistory = st.history.length >= 2;
    if (el && el.dataset.built === (hasHistory ? 'live' : 'young') && el.dataset.settled === '1') return false;
    el.dataset.built = hasHistory ? 'live' : 'young';
    el.dataset.settled = '0';
    if (!hasHistory) {
      el.innerHTML = `<div class="ws-block"><h4>The last days</h4>
        <p class="ws-empty">The frontier has not lived long enough to have a history yet.
        Come back after a couple of days and this becomes a chart of everything you changed.</p></div>`
        + this.worldScreenFooter();
      el.dataset.settled = '1';
      return true;
    }

    const eco = [
      { id: 'prey', label: 'Grazing herds', unit: 'head', color: '#9ec98a' },
      { id: 'pred', label: 'Predators', unit: 'head', color: '#ef6a54' },
      { id: 'forest', label: 'Forest health', unit: '%', color: '#68d18a' },
      { id: 'burn', label: 'Scorched land', unit: '%', color: '#8a6a4a' },
    ];

    el.innerHTML = `
      <p id="ws-time" class="ws-time" role="status" aria-live="polite"></p>
      <div class="ws-block"><h4><span id="ws-when">Now</span> · the frontier's own vital signs</h4>
        <canvas id="ws-chart" role="img" tabindex="0" aria-label="Chart of the frontier's vital signs"></canvas>
        <div id="ws-read" class="ws-read"></div>
        <p id="ws-say" class="sr-only" role="status" aria-live="polite"></p>
        <div class="ws-legend" id="ws-legend" role="group" aria-label="Chart lines — show one on its own, or put it back"></div>
        <p class="ws-hint">Click a line to read it alone against its real values; click again to put the others back.
        Drag across the chart — or focus it and use the arrow keys, Home and End — to take the whole screen to any day.</p>
      </div>

      <div class="ws-block"><h4>Ecology <span class="ws-asof"></span></h4>
        ${eco.map((e) => `<div class="frow"><span class="nm">${e.label}</span>
          <span class="meter" id="ws-m-${e.id}"><i style="background:${e.color}"></i></span>
          <span class="vv" id="ws-v-${e.id}">—</span></div>`).join('')}
        <div class="frow ws-now"><span class="nm">Active fires</span>
          <span class="meter" id="ws-m-fire"><i style="background:#ff8c3a"></i></span>
          <span class="vv" id="ws-v-fire">—</span></div>
      </div>

      <div class="ws-block"><h4>Factions <span class="ws-asof"></span></h4>
        ${FACTIONS.map((f, i) => `<div class="frow"><span class="nm" style="color:${f.accent}">${crest(i, f.name, f.accent)}${f.name}</span>
            <span class="meter" id="ws-m-ter${i}"><i style="background:${f.accent}"></i></span>
            <span class="vv" id="ws-v-ter${i}">—</span></div>
          <div class="frow"><span class="nm" style="opacity:.6;font-size:11px">your standing</span>
            <span class="meter" id="ws-m-rep${i}"><i></i></span>
            <span class="vv" id="ws-v-rep${i}">—</span></div>`).join('')}
      </div>

      <div class="ws-block"><h4>Settlements <span class="ws-now-tag">as they stand</span></h4>
        <div id="ws-settlements"></div></div>

      <div class="ws-block"><h4>Your survey</h4>
        <div class="frow"><span class="nm">Map drawn</span>
          <span class="meter" id="ws-m-survey"><i style="background:#e0b661"></i></span>
          <span class="vv" id="ws-v-survey">—</span></div>
        <div class="frow"><span class="nm">Ground walked</span>
          <span class="meter" id="ws-m-walked"><i style="background:#c9b98a"></i></span>
          <span class="vv" id="ws-v-walked">—</span></div>
        <div id="ws-waypoint" class="vil"><span>No waypoint set</span></div>
      </div>

      <div class="ws-block"><h4>Discoveries <span class="ws-asof"></span></h4>
        <div id="ws-discoveries"></div></div>
      ${this.worldScreenFooter()}`;

    // these two only change when the world does, not when the screen refreshes
    this.bindChart();
    const rec = $('#ws-open-record');
    if (rec) rec.addEventListener('click', () => { this.closePanel(); this.openRecord(); });
    el.dataset.settled = '1';
    return true;
  },

  worldScreenFooter() {
    return `<div class="ws-block"><h4>The Long Record</h4>
      <p class="hint">Fourteen centuries of this valley are cut into the ground beneath these
      villages. Your days are the last band of it.</p>
      <button class="btn wide ws-record" id="ws-open-record" type="button">
        ${icon('relic')} Read the Long Record <span class="kbd">R</span></button></div>`;
  },

  // ------------------------------------------------------------- readings
  // The world screen refreshes while it is open. It refreshes the numbers.
  updateWorldScreen() {
    const st = this.state, row = this.readingRow();
    const live = !row || row[0] >= st.day;
    const regions = st.regions.length;

    // the honest header: what day this screen is about, and what it is not about
    const t = $('#ws-time');
    if (t) {
      t.textContent = live ? ''
        : `Reading day ${row[0]} — the vital signs below are that day's. Villages, banners and waypoint are as they stand now.`;
      t.classList.toggle('hidden', live);
    }
    const when = $('#ws-when');
    if (when) when.textContent = live ? 'Now' : `Day ${row[0]}`;
    for (const tag of document.querySelectorAll('#world-state .ws-asof')) {
      tag.textContent = live ? '' : `· as of day ${row[0]}`;
    }

    // ecology and territory are measured every day, so they can be read back
    const set = (id, frac, text) => {
      const m = $(`#ws-m-${id}`), v = $(`#ws-v-${id}`);
      if (m) { const bar = m.querySelector('i'); if (bar) bar.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%'; }
      if (v) v.textContent = text;
    };
    const burnPct = (st.scorchedCells() / (st.ground.length / 4)) * 100;
    if (row) {
      set('prey', row[1] / (regions * 22), String(Math.round(row[1])));
      set('pred', row[2] / (regions * 3.2), String(Math.round(row[2])));
      set('forest', row[3] / 100, row[3] + '%');
      set('burn', (row[4] / (regions * 26)) / 0.25, row[4] + ' cells');
      for (let i = 0; i < 3; i++) set('ter' + i, row[5 + i] / (regions * 2.2), Math.round(row[5 + i] / regions * 100) + '% land');
    }
    set('fire', st.burningCount() / 40, String(st.burningCount()));
    for (let i = 0; i < 3; i++) {
      const rep = st.player.rep[i];
      set('rep' + i, (rep + 100) / 200, String(Math.round(rep)));
      const bar = $(`#ws-m-rep${i} i`);
      if (bar) bar.style.background = rep < 0 ? '#ef6a54' : '#68d18a';
    }

    // settlements and the waypoint are only ever true right now
    const sl = $('#ws-settlements');
    if (sl && sl.dataset.n !== String(st.settlements.length)) {
      sl.dataset.n = String(st.settlements.length);
      sl.innerHTML = st.settlements.map((s) => {
        const cls = s.abandoned ? 'abandoned' : s.status;
        return `<div class="vil"><span>${s.name} ${crest(s.banner, FACTIONS[s.banner].name, FACTIONS[s.banner].accent,
          `flies the banner of ${FACTIONS[s.banner].name}`)}
          <span style="color:var(--dim);font-size:11px"> · ${Math.round(s.population)} souls · ${s.buildings} buildings${s.walls ? ` · walls ${s.walls}/3` : ''}</span></span>
          <span class="tag ${cls}">${s.abandoned ? 'abandoned' : s.status}</span></div>`;
      }).join('');
    }
    const wp = $('#ws-waypoint');
    if (wp) {
      const w = this.waypoint;
      wp.innerHTML = w
        ? `<span>Waypoint · ${w.name || 'unnamed'}</span><span class="tag">${Math.round(Math.hypot(w.x - this.world.player.pos.x, w.z - this.world.player.pos.z))} m</span>`
        : '<span style="opacity:.55">No waypoint set — tap the map to plant one</span>';
    }
    const surveyed = st.exploredFraction();
    set('survey', surveyed * 1.6, Math.round(surveyed * 100) + '%');
    set('walked', st.player.stats.distance / 22000, (st.player.stats.distance / 1000).toFixed(2) + ' km');

    // a landmark is found on a day, so a past day can honestly say which ones
    // you had already stood in front of
    const dl = $('#ws-discoveries');
    if (dl) {
      const asOf = live ? Infinity : row[0];
      const found = LANDMARKS.filter((L) => st.discovered[L.id] && st.discovered[L.id] <= asOf).length;
      dl.innerHTML = `<div class="vil"><span>Found</span><span class="tag thriving">${found} of ${LANDMARKS.length}</span></div>`
        + LANDMARKS.map((L) => {
          const d = st.discovered[L.id];
          const known = d && d <= asOf;
          return `<div class="vil"><span style="${known ? '' : 'opacity:.45'}">${known ? L.name : '??? — undiscovered'}</span>
            <span class="tag ${known ? 'thriving' : ''}">${known ? 'found day ' + d : 'rumoured'}</span></div>`;
        }).join('');
    }

    this.drawHistoryChart(st);
  },

  renderWorldState() {
    const rebuilt = this.buildWorldScreen();
    if (this.state.history.length >= 2) this.updateWorldScreen();
    return rebuilt;
  },

  // -------------------------------------------------------------- the chart
  bindChart() {
    const cv = $('#ws-chart');
    if (!cv) return;
    const pick = (clientX) => {
      const res = this._chartResult;
      if (!res) return;
      const i = dayAtClientX(res, clientX, cv.getBoundingClientRect());
      this.chartDay = this.state.history[i][0];
      this.updateWorldScreen();
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => {
      dragging = true;
      this._scrubbing = true;
      if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
      pick(e.clientX); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => { if (dragging) pick(e.clientX); });
    const stop = () => {
      if (!dragging) return;
      dragging = false; this._scrubbing = false; this._saidAt = -1e9;
      this.updateWorldScreen();
    };
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
      else if (e.key === 'PageUp') i -= 10;
      else if (e.key === 'PageDown') i += 10;
      else return;
      this.chartDay = h[clamp(i, 0, h.length - 1)][0];
      this._saidAt = -1e9;                    // a deliberate step is always spoken
      this.updateWorldScreen();
      e.preventDefault(); e.stopPropagation();
    });
  },

  visibleSeries() {
    const hidden = this.chartHiddenSet();
    return chartSeries().filter((s) => !hidden.has(s.k));
  },

  drawHistoryChart(st) {
    const cv = $('#ws-chart');
    if (!cv || st.history.length < 2) return;
    const series = this.visibleSeries();
    const h = st.history;
    const result = drawChronicleChart(cv, {
      rows: h,
      series,
      written: new Set(st.journal.map((e) => e.day)),
      cursor: this.chartIndex(h),
    });
    this._chartResult = result;
    this.updateChartLegend(st, h, this.chartIndex(h));
    const read = this.renderChartReadout(st, h[this.chartIndex(h)]);
    if (read) cv.setAttribute('aria-label', this.describeHistory(st) + ' Selected: ' + read);
  },

  // The legend is both the value readout and the isolate control. Its buttons
  // are built once and then only rewritten, because a drag across the chart
  // redraws it sixty times a second and five fresh buttons per redraw is sixty
  // button constructions per second.
  updateChartLegend(st, h, ci) {
    const box = $('#ws-legend');
    if (!box) return;
    const hidden = this.chartHiddenSet();
    const series = chartSeries();
    const ranges = seriesRanges(h, series);
    const all = series.map((s) => s.k);
    const solo = all.length - hidden.size === 1;
    if (!box.__built) {
      box.__built = true;
      box.innerHTML = '';
      for (let i = 0; i < series.length; i++) {
        const s = series[i];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'leg';
        b.dataset.k = String(s.k);
        b.innerHTML = `<i style="background:${s.c}"></i><b>${s.label}</b><span></span><em></em>`;
        b.addEventListener('click', () => {
          const hid = this.chartHiddenSet();
          const off = hid.has(s.k);
          if (all.length - hid.size === 1) {
            // one line is being read alone. Click the line you are reading and
            // the others come back; click a hidden line and that one is read
            // alone instead.
            if (off) { hid.clear(); for (const k of all) if (k !== s.k) hid.add(k); }
            else hid.clear();
          } else if (off) hid.delete(s.k);
          else { for (const k of all) if (k !== s.k) hid.add(k); }
          this.updateWorldScreen();
        });
        box.appendChild(b);
      }
    }
    for (let i = 0; i < series.length; i++) {
      const s = series[i], r = ranges[i];
      const b = box.children[i];
      const off = hidden.has(s.k);
      b.classList.toggle('off', off);
      b.setAttribute('aria-pressed', off ? 'false' : 'true');
      b.setAttribute('aria-label', off
        ? `${s.label}: hidden. Show it again.`
        : `${s.label}: showing ${s.fmt(h[ci][s.k])}, drawn between ${s.fmt(r.lo)} and ${s.fmt(r.hi)} ${s.unit}.`
          + (solo ? ' This is the only line shown.' : ' Select to read this one alone.'));
      b.children[2].textContent = s.fmt(h[ci][s.k]);
      b.children[3].textContent = `${s.fmt(r.lo)}–${s.fmt(r.hi)}`;
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

  renderChartReadout(st, row) {
    const el = $('#ws-read');
    if (!el) return '';
    const events = st.journal.filter((e) => e.day === row[0]);
    const text = `Day ${row[0]} · ${row[1]} herd animals · ${row[2]} predators · `
      + `${row[3]}% forest · ${row[4]} scorched cells · prosperity ${(row[8] / 100).toFixed(2)}`;
    const visible = this.visibleSeries();
    const scale = visible.length === 1 ? `Y-axis: ${visible[0].unit}.`
      : visible.length ? `Normalised view: ${visible.length} lines, each on its own range.`
        : 'No line is shown — pick one from the legend below.';
    el.innerHTML = `<b>${text}</b><span>${scale}</span>`
      + (events.length
        ? `<ul>${events.slice(0, 4).map((e) => `<li class="k-${e.kind}">${e.text}</li>`).join('')}</ul>`
        : `<span class="none">nothing was written in the chronicle that day</span>`);
    const spoken = text + '. ' + scale + (events.length ? `. Chronicle: ${events.slice(0, 4).map((e) => e.text).join(' ')}` : '. Nothing recorded.');
    // The drawn readout follows the pointer every frame; what is *said* does
    // not. A sweep across the record is one journey, not seventy announcements.
    const say = $('#ws-say');
    if (say) {
      const now = Date.now();
      if (now - (this._saidAt || -1e9) > 600) { this._saidAt = now; say.textContent = spoken; }
    }
    return spoken;
  },
};
