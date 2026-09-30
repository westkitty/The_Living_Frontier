// The reading instrument for THE LONG RECORD.
//
// The record is drawn as a core sample: one column, oldest at the top, the
// present at the bottom edge. Every band in it is a settlement that stood on
// the same five sites the player's villages stand on now, coloured by how it
// ended. The player's own tenancy is the last band — at the widest zoom it is
// less than a pixel tall, which is the entire argument the screen is making.
//
// Reading is the interaction: scrub for a year, zoom to change what a pixel
// means, and the readout tells you what the column is made of at that depth.
import { $ } from './uikit.js';
import { fitCanvas, PAPER, typeface } from './surface.js';
import { clamp } from './rng.js';
import { Settings } from './settings.js';
import { drawRecordMark } from './record-ink.js';
import { SETTLEMENTS } from './worldgen.js';
import {
  tenancies, deepEvents, livingBand, describeTenancy, weight, factionAge,
  presentYear, BAND_INK, YEAR_DAYS,
} from './chronology.js';

// What one screen of column is worth, from the whole record down to one day.
const SCALES = [
  { id: 'record', span: null, label: 'the whole record' },
  { id: 'age', span: 260, label: 'an age' },
  { id: 'life', span: 34, label: 'a lifetime' },
  { id: 'season', span: 3, label: 'a few seasons' },
];
export const RecordMixin = {
  openRecord() {
    if (this.recordOpen) return;
    this.recordOpen = true;
    this.recordScale = this.recordScale || 0;
    const st = this.state;
    this.recordYear = presentYear(st); this.recordTargetYear = null;
    // The crossing: the record opens on your own days, filling the screen, and
    // then pulls back until they are a hairline. Nothing is faked — it is the
    // same column at every moment of the pull, only the scale changes.
    this.recordEnter = Settings.motionReduced ? 1 : 0;
    this.recordScale = Settings.motionReduced ? 0 : SCALES.length - 1;
    this.openSheet('#record');
    this.bindRecord();
    this.drawRecord();
    this.world.audio.play('discover');
  },

  closeRecord() {
    if (!this.recordOpen) return;
    this.recordOpen = false;
    this.closeSheet('#record');
  },

  bindRecord() {
    const cv = $('#rec-canvas');
    if (cv._bound) return;
    cv._bound = true;
    const yearAt = (clientY) => {
      const r = cv.getBoundingClientRect();
      const t = clamp((clientY - r.top) / Math.max(1, r.height), 0, 1);
      const w = this.recordWindow();
      return w.top + t * w.span;
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => {
      dragging = true;
      if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
      this.recordYear = yearAt(e.clientY);
      this.drawRecord();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.recordYear = yearAt(e.clientY);
      this.drawRecord();
    });
    const stop = () => { dragging = false; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('wheel', (e) => {
      this.zoomRecord(e.deltaY < 0 ? 1 : -1);
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      const w = this.recordWindow();
      const stepY = Math.max(1, Math.round(w.span / 40));
      if (e.key === 'ArrowUp') this.recordYear -= stepY;
      else if (e.key === 'ArrowDown') this.recordYear += stepY;
      else if (e.key === 'PageUp') this.recordYear -= w.span / 3;
      else if (e.key === 'PageDown') this.recordYear += w.span / 3;
      else if (e.key === 'Home') this.recordYear = 0;
      else if (e.key === 'End') this.recordYear = presentYear(this.state);
      else if (e.key === '+' || e.key === '=') this.zoomRecord(1);
      else if (e.key === '-' || e.key === '_') this.zoomRecord(-1);
      else return;
      e.preventDefault();
      this.drawRecord();
    });
    $('#rec-in').addEventListener('click', () => this.zoomRecord(1));
    $('#rec-out').addEventListener('click', () => this.zoomRecord(-1));
    $('#rec-me').addEventListener('click', () => {
      this.recordScale = SCALES.length - 1;
      this.recordYear = presentYear(this.state);
      this.drawRecord();
      this.world.audio.play('ui');
    });
    $('#rec-close').addEventListener('click', () => this.closeRecord());
  },

  zoomRecord(dir) {
    const next = clamp(this.recordScale + dir, 0, SCALES.length - 1);
    if (next === this.recordScale) return;
    this.recordScale = next;
    this.world.audio.play('ui');
    this.drawRecord();
  },

  // The slice of years currently on screen, clamped to the record itself.
  recordWindow() {
    const st = this.state;
    const now = presentYear(st);
    const sc = SCALES[this.recordScale || 0];
    if (this.recordEnter < 1) {
      // mid-crossing: a continuous pull from a few seasons to the whole record
      const t = this.recordEnter;
      const from = Math.log(SCALES[SCALES.length - 1].span);
      const to = Math.log(now + 6);
      const span = Math.exp(from + (to - from) * (t * t * (3 - 2 * t)));
      const top = clamp(now - span * 0.86, 0, Math.max(0, now + 6 - span));
      return { top, span, scale: sc, crossing: true };
    }
    if (!sc.span) return { top: 0, span: now + 6, scale: sc };
    const span = Math.min(sc.span, now + 6);
    let top = clamp((this.recordYear ?? now) - span * 0.55, 0, Math.max(0, now + 6 - span));
    return { top, span, scale: sc };
  },

  drawRecord() {
    const cv = $('#rec-canvas');
    if (!cv) return;
    const st = this.state;
    const { w: W, h: H, dpr } = fitCanvas(cv, 360, 620);
    const ctx = cv.getContext('2d');
    const s = dpr;
    const now = presentYear(st);
    const win = this.recordWindow();
    const reveal = this.recordEnter >= 1 ? 1 : this.recordEnter;
    const toY = (year) => ((year - win.top) / win.span) * H;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = PAPER.core;
    ctx.fillRect(0, 0, W, H);

    const colX = W * 0.30, colW = W * 0.30, rightLabelX = colX + colW + 17 * s, rightLabelWidth = Math.max(1, W - rightLabelX - 8 * s);
    const yearRows = [];                    // where event years are printed, so the
                                            // depth scale can get out of their way

    // rock: the ground the record is cut out of
    const rock = ctx.createLinearGradient(colX, 0, colX + colW, 0);
    for (const [at, col] of [[0, '#191a19'], [0.5, '#23241f'], [1, '#141513']]) rock.addColorStop(at, col);
    ctx.fillStyle = rock;
    ctx.fillRect(colX, 0, colW, H);

    // ---- lanes: the five sites, side by side, for as long as there have been
    // people here. The same ground keeps being chosen, and keeps being lost.
    const lanes = SETTLEMENTS.length;
    const laneW = colW / lanes;
    const ten = tenancies(st.seed);
    this.recordBands = ten;
    for (let i = 0; i < lanes; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.015)' : 'rgba(0,0,0,.12)';
      ctx.fillRect(colX + i * laneW, 0, laneW, H);
    }
    for (const t of ten) {
      const y0 = toY(t.start), y1 = toY(t.end);
      if (y1 < -40 || y0 > H + 40) continue;
      const h = Math.max(0.7 * s, y1 - y0);
      const x = colX + t.site * laneW;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = BAND_INK[t.band];
      ctx.fillRect(x + 0.5 * s, y0, laneW - 1 * s, h);
      // the year it ended is always darker than the years it lived
      ctx.fillStyle = '#08090a';
      ctx.fillRect(x + 0.5 * s, y1 - Math.max(0.6 * s, h * 0.08), laneW - 1 * s, Math.max(0.7 * s, h * 0.08));
      ctx.globalAlpha = 1;
    }

    // ---- the living band: the player's own tenancy, in gold
    const live = livingBand(st);
    const ly0 = toY(live.start), ly1 = toY(now + (st.day % YEAR_DAYS) / YEAR_DAYS);
    const lh = Math.max(0.8 * s, ly1 - ly0);
    ctx.fillStyle = BAND_INK.living;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < lanes; i++) {
      const s2 = st.settlements[i];
      ctx.globalAlpha = s2 && s2.abandoned ? 0.35 : 1;      // the ones you have already lost
      ctx.fillRect(colX + i * laneW + 0.5 * s, ly0, laneW - 1 * s, lh);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(240,214,152,.55)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(colX - 7 * s, ly1); ctx.lineTo(colX + colW + 7 * s, ly1); ctx.stroke();
    // You are down here. At the widest reading this band is thinner than the
    // line that points at it, which is the honest way to show the proportion.
    ctx.font = typeface(9.5 * s);
    ctx.textAlign = 'left';
    if (ly1 > -20 && ly0 < H + 20) {
      const py0 = clamp(ly0, 6 * s, H - 14 * s);
      ctx.fillStyle = '#f0d698';
      ctx.fillText(lh < 3 * s ? 'you — thinner than this line' : 'you', rightLabelX, py0 + 3 * s, rightLabelWidth);
      ctx.strokeStyle = 'rgba(240,214,152,.45)';
      ctx.beginPath();
      ctx.moveTo(colX + colW, ly0 + lh / 2); ctx.lineTo(colX + colW + 15 * s, py0);
      ctx.stroke();
    } else {
      // your band is off this screen: say how far, rather than pretending
      const below = Math.round(live.start - (win.top + win.span));
      ctx.fillStyle = 'rgba(240,214,152,.65)';
      ctx.fillText(below > 0 ? `your years: ${below} further down` : `your years: ${Math.round(win.top - live.end)} above`,
        rightLabelX, H - 8 * s, rightLabelWidth);
    }

    // ---- close reading: at a lifetime or less, name what you are inside of
    if (win.span <= 40) {
      ctx.font = typeface(10 * s);
      ctx.textAlign = 'left';
      const rows = [];
      for (const t of ten) {
        const y0 = toY(t.start), y1 = toY(t.end);
        if (y1 < 0 || y0 > H) continue;
        let ly = clamp((Math.max(y0, 0) + Math.min(y1, H)) / 2, 12 * s, H - 20 * s);
        while (rows.some(r => Math.abs(r - ly) < 24 * s)) ly += 24 * s;
        rows.push(ly);
        const x = colX + t.site * laneW + laneW / 2;
        ctx.strokeStyle = 'rgba(200,190,164,.25)';
        ctx.lineWidth = 0.8 * s;
        ctx.beginPath(); ctx.moveTo(x, ly - 3 * s); ctx.lineTo(colX + colW + 15 * s, ly - 3 * s); ctx.stroke();
        ctx.fillStyle = BAND_INK[t.band];
        ctx.fillRect(colX + colW + 17 * s, ly - 9 * s, 3 * s, 8 * s);
        ctx.fillStyle = 'rgba(236,226,200,.9)';
        ctx.fillText(t.name, colX + colW + 24 * s, ly - 2 * s, Math.max(1, W - colX - colW - 32 * s));
        ctx.fillStyle = 'rgba(190,178,150,.55)';
        ctx.fillText(`${t.span} years, then ${t.verb} — ${t.souls} souls`, colX + colW + 24 * s, ly + 10 * s, Math.max(1, W - colX - colW - 32 * s));
      }
      // inside your own band the hairs are days you wrote something on
      if (ly1 > 0 && ly0 < H) {
        for (const j of (st.journal || []).slice(0, 120)) {
          const yr = live.start + (j.day - 1) / YEAR_DAYS;
          const py = toY(yr);
          if (py < 0 || py > H) continue;
          ctx.fillStyle = j.kind === 'fire' ? 'rgba(239,106,84,.9)'
            : j.kind === 'faction' ? 'rgba(160,142,240,.9)'
            : j.kind === 'settlement' ? 'rgba(104,209,138,.9)' : 'rgba(240,214,152,.8)';
          ctx.fillRect(colX, py, colW, Math.max(1, 0.9 * s));
        }
      }
    }

    // ---- the spine: named events, sealed until you have stood there
    const events = deepEvents(st);
    ctx.font = typeface(10.5 * s);
    const taken = [];                       // label rows already used, so two
    const rowFor = (y) => {                 // events in the same year stay readable
      let ly = clamp(y, 9 * s, H - 5 * s);
      while (taken.some(t => Math.abs(t - ly) < 12 * s)) ly += 12 * s;
      taken.push(ly);
      return ly;
    };
    for (const e of events) {
      const y = toY(e.at);
      if (y < -10 || y > H + 10) continue;
      ctx.strokeStyle = e.sealed ? 'rgba(150,140,120,.35)' : 'rgba(226,208,164,.85)';
      ctx.lineWidth = (e.sealed ? 0.8 : 1.2) * s;
      ctx.setLineDash(e.sealed ? [2 * s, 3 * s] : []);
      ctx.beginPath();
      ctx.moveTo(colX - 12 * s, y); ctx.lineTo(colX + colW + 12 * s, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const ly = rowFor(y);
      if (Math.abs(ly - y) > 1) {          // a leader line, so the label still points at its year
        ctx.strokeStyle = 'rgba(226,208,164,.28)';
        ctx.lineWidth = 0.8 * s;
        ctx.beginPath();
        ctx.moveTo(colX + colW + 12 * s, y);
        ctx.lineTo(colX + colW + 15 * s, ly);
        ctx.stroke();
      }
      drawRecordMark(ctx, e, rightLabelX - 8 * s, ly, s);
      ctx.textAlign = 'left';
      ctx.fillStyle = e.sealed ? 'rgba(150,140,120,.6)' : '#e2d0a4';
      ctx.fillText(e.sealed ? 'SEALED' : e.title, rightLabelX, ly + 3.5 * s, rightLabelWidth);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(190,178,150,.55)';
      ctx.fillText(String(e.at), colX - 16 * s, clamp(y, 9 * s, H - 5 * s) + 3.5 * s);
      yearRows.push(clamp(y, 9 * s, H - 5 * s));
    }

    // ---- depth scale down the left edge
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(160,150,128,.45)';
    const tick = win.span > 900 ? 200 : win.span > 200 ? 50 : win.span > 40 ? 10 : 1;
    for (let y = Math.ceil(win.top / tick) * tick; y < win.top + win.span; y += tick) {
      const py = toY(y);
      ctx.fillRect(colX - 9 * s, py, 5 * s, 1);
      if (yearRows.some(r => Math.abs(r - py) < 11 * s)) continue;
      if (win.span <= 900 || y % (tick * 2) === 0) ctx.fillText(String(y), colX - 13 * s, py + 3.5 * s);
    }

    // ---- which lane is which
    ctx.font = typeface(8.5 * s);
    ctx.textAlign = 'center';
    for (let i = 0; i < lanes; i++) {
      const s2 = st.settlements[i];
      ctx.fillStyle = s2 && s2.abandoned ? 'rgba(150,140,120,.5)' : 'rgba(210,198,170,.65)';
      ctx.fillText(SETTLEMENTS[i].name.slice(0, 2).toUpperCase(), colX + i * laneW + laneW / 2, H - 4 * s);
    }

    // ---- the reading cursor
    const cy = toY(clamp(this.recordYear ?? now, win.top, win.top + win.span));
    ctx.strokeStyle = 'rgba(240,214,152,.9)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    ctx.fillStyle = 'rgba(240,214,152,.9)';
    ctx.beginPath();
    ctx.moveTo(0, cy - 4 * s); ctx.lineTo(6 * s, cy); ctx.lineTo(0, cy + 4 * s);
    ctx.closePath(); ctx.fill();

    // during the crossing the labels are still settling, so they fade in last
    if (reveal < 1) {
      ctx.fillStyle = `rgba(7,9,10,${0.55 * (1 - reveal)})`;
      ctx.fillRect(0, 0, W, H);
    }

    this.writeRecordReadout(st, win, live);
    cv.setAttribute('aria-label', this.describeRecord(st, win, live));
  },

  // What is at this depth, in the register of someone who has read the column
  // many times and is no longer impressed by it.
  writeRecordReadout(st, win, live) {
    const year = Math.round(clamp(this.recordYear ?? presentYear(st), 0, presentYear(st)));
    const now = presentYear(st);
    const here = this.recordAt(st, year);
    $('#rec-year').textContent = year >= live.start
      ? `Year ${year} — yours`
      : `Year ${year}`;
    $('#rec-depth').textContent = `${now - year} years before now · ${SCALES[this.recordScale || 0].label} to a screen`;
    const box = $('#rec-lines');
    box.innerHTML = '';
    for (const line of here) {
      const p = document.createElement(line.target ? 'button' : 'p');
      p.className = 'rec-line ' + (line.kind || '');
      p.textContent = line.text;
      if (line.target) {
        p.type = 'button';
        p.dataset.recordLandmark = line.target.landmark;
        p.addEventListener('click', () => {
          const e = line.target;
          this.waypoint = { x: e.x, z: e.z, name: e.place };
          st.note(`Something is recorded at ${e.place} that cannot be read from here.`, 'discovery');
          this.closeRecord();
        });
      }
      box.appendChild(p);
    }
    const wt = weight(st.seed);
    $('#rec-weight').textContent =
      `${wt.tenancies} settlements have stood on these five sites. ${wt.souls.toLocaleString()} people are accounted for in this column. `
      + `${wt.burned} burned, ${wt.drowned} drowned, ${wt.starved} starved, ${wt.taken} were taken, ${wt.walked} walked out.`;
    const share = ((st.day / YEAR_DAYS) / Math.max(1, now)) * 100;
    $('#rec-share').textContent =
      `Your tenancy: ${st.day} days — ${share < 0.1 ? 'less than a tenth of one per cent' : share.toFixed(2) + ' per cent'} of the record.`;
  },
  // Everything true at one year, gathered from the same data the column draws.
  recordAt(st, year) {
    const out = [];
    const live = livingBand(st);
    for (const e of deepEvents(st)) {
      if (Math.abs(e.at - year) > Math.max(1, Math.round(this.recordWindow().span / 90))) continue;
      out.push({
        kind: 'event',
        target: e.sealed ? e : null,
        text: e.sealed
          ? `SEALED · Year ${e.at} · ${e.place}. Set a waypoint to the unread stone.`
          : `Year ${e.at} — ${e.title}. ${e.line} ${e.after}`,
      });
    }
    const standing = tenancies(st.seed).filter(t => year >= t.start && year <= t.end);
    for (const t of standing) out.push({ kind: 'tenancy', text: describeTenancy(t) });
    if (!standing.length && year < live.start) {
      out.push({ kind: 'quiet', text: 'Nothing was standing anywhere in the valley this year. The record is only ash and silt at this depth.' });
    }
    if (year >= live.start) {
      const fromDay = Math.max(1, Math.round((year - live.start) * YEAR_DAYS));
      const toDay = fromDay + YEAR_DAYS;
      const mine = (st.journal || []).filter(j => j.day >= fromDay && j.day < toDay).slice(0, 6);
      out.push({
        kind: 'living',
        text: `This is your band. ${live.felled} trees felled, ${live.hunted} animals taken, ${live.fires} fires set, `
          + `${live.scorched} cells of ground still scorched, ${live.helped} gifts given, ${live.planted} saplings planted, `
          + `${(live.distance / 1000).toFixed(1)} km walked.`,
      });
      for (const j of mine) out.push({ kind: 'mine', text: `Day ${j.day}: ${j.text}` });
      if (!mine.length) out.push({ kind: 'quiet', text: 'Nothing has been written in this year of yours yet.' });
    }
    const fa = factionAge(st.seed).filter(f => Math.abs(f.founded - year) <= Math.max(1, Math.round(this.recordWindow().span / 120)));
    for (const f of fa) out.push({ kind: 'event', text: `${f.name} is founded — ${presentYear(st) - f.founded} years ago. Everything above this line happened without them.` });
    return out;
  },

  describeRecord(st, win, live) {
    const year = Math.round(clamp(this.recordYear ?? presentYear(st), 0, presentYear(st)));
    const lines = this.recordAt(st, year).map(l => l.text).join(' ');
    return `The Long Record, a core sample of ${presentYear(st)} years. Showing years `
      + `${Math.round(win.top)} to ${Math.round(win.top + win.span)}. Reading year ${year}. ${lines}`;
  },

  tickRecord(dt) {
    if (!this.recordOpen || this.recordEnter >= 1) return;
    this.recordEnter = Math.min(1, this.recordEnter + dt * 0.62);
    if (this.recordEnter >= 1) { this.recordScale = 0; if (Number.isFinite(this.recordTargetYear)) { this.recordYear = this.recordTargetYear; this.recordTargetYear = null; } }
    this.drawRecord();
  },
};
