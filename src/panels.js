// The bag, the chronicle, and the way into the chronicle's chart.
// The world screen itself is its own module: it is a reading instrument, and
// it has to own the geometry and the time it is describing.
import { FACTIONS, LANDMARKS } from './worldgen.js';
import { $, icon, ITEM_ICONS, crest } from './uikit.js';

const BAG_ITEMS = ['wood', 'stone', 'hide', 'herb', 'ore', 'berry', 'relic'];

export const PanelsMixin = {
  // The bag used to be a row of divs with a click handler: the only way to use
  // anything you were carrying was to hold a mouse over it, and every refresh
  // rebuilt the row and took the keyboard with it. The slots are buttons now,
  // and the grid is built once so it can be re-read without being re-made.
  buildBag() {
    const g = $('#bag-grid');
    g.innerHTML = '';
    this._bagSlots = {};
    const USES = this.itemUses();
    for (const k of BAG_ITEMS) {
      const use = USES[k];
      const el = document.createElement(use ? 'button' : 'div');
      el.className = 'slot';
      el.innerHTML = `<span class="ico">${icon(ITEM_ICONS[k] || 'relic', 'ic lg')}</span>`
        + `<span class="n">0</span><span class="l">${k}</span>`
        + (use ? `<span class="use">${use.label}<em>Q</em></span>` : '');
      if (use) {
        el.type = 'button';
        el.addEventListener('click', () => {
          const inv = this.state.player.inv;
          if ((inv[k] || 0) < 1) { this.toast(`No ${k} left.`); return; }
          inv[k] -= 1; use.run(); this.world.audio.play('pick');
          this.toast(`Used 1 ${k}`, 'good');
          this.updateBag();
        });
      }
      g.appendChild(el);
      this._bagSlots[k] = { el, use, n: el.querySelector('.n') };
    }
  },

  updateBag() {
    const inv = this.state.player.inv;
    if (!this._bagSlots) this.buildBag();
    for (const k of BAG_ITEMS) {
      const slot = this._bagSlots[k];
      const have = Math.floor(inv[k] || 0);
      if (slot.n.textContent !== String(have)) slot.n.textContent = have;
      if (!slot.use) continue;
      // an empty slot is still a slot, but it is not a button that does nothing
      slot.el.disabled = have < 1;
      slot.el.classList.toggle('empty', have < 1);
      slot.el.setAttribute('aria-label', have < 1
        ? `${k}: none left.`
        : `${k}: ${have} carried. Use one — ${slot.use.label.toLowerCase()}.`);
    }
    const st = this.state.player.stats;
    const rep = this.state.player.rep;
    $('#bag-stats').innerHTML = `
      <div><b>Standing</b> — ${FACTIONS.map((f, i) => `${crest(i, f.name, f.accent)}${f.name}: <b style="color:${f.accent}">${Math.round(rep[i])}</b>`).join(' &nbsp;·&nbsp; ')}</div>
      <div><b>Travelled</b> ${(st.distance / 1000).toFixed(2)} km &nbsp;·&nbsp; <b>Trees felled</b> ${st.felled} &nbsp;·&nbsp; <b>Animals taken</b> ${st.hunted}</div>
      <div><b>Fires lit</b> ${st.fires} &nbsp;·&nbsp; <b>Saplings planted</b> ${st.planted} &nbsp;·&nbsp; <b>Tasks done</b> ${st.quests} &nbsp;·&nbsp; <b>Aid given</b> ${st.helped}</div>
      <div><b>Day</b> ${this.state.day} &nbsp;·&nbsp; <b>Discoveries</b> ${Object.keys(this.state.discovered).length}/${LANDMARKS.length}</div>`;
  },

  renderBag() {
    if (!this._bagSlots) this.buildBag();
    this.updateBag();
  },

  // Jump from a chronicle entry to the state of the world on that day.
  showDayOnChart(day) {
    this.chartDay = day;
    this.showTab('world');
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
    const entries = this.state.journal.slice(0, 60);
    // only re-lay the chronicle when it has actually changed, and put the
    // reader back on the day button they were standing on
    const sig = qs.map((q) => q.id + q.progress + q.done).join('|') + '//' + entries.map((e) => e.day + e.text).join('|');
    if (sig === this._journalSig) return;
    const focused = document.activeElement && document.activeElement.classList.contains('jday-btn')
      ? (document.activeElement.textContent.match(/Day (\d+)/) || [])[1] : null;
    this._journalSig = sig;
    jl.innerHTML = '';
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
          b.setAttribute('aria-label', `Day ${e.day} — open the state of the world on that day`);
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
    if (focused) {
      const back = [...jl.querySelectorAll('.jday-btn')].find((b) => b.textContent.startsWith(`Day ${focused} `));
      if (back) back.focus();
    }
  },
};
