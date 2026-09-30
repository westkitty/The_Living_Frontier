// The chronicle chart: the frontier's own vital signs, drawn.
//
// This used to live inside panels.js and drew into whatever size the canvas
// element happened to declare — 720x240 backing pixels shown in a 120-pixel
// box, which is how you get seven-pixel axis labels. It is its own module now
// for a reason that is not tidiness: it is the one surface in the game whose
// job is to be *read*, so it owns the geometry, the type and the scale, and it
// hands the rest of the interface the plot rectangle it used.
import { fitCanvas, inkSpace, typeface, PAPER } from './surface.js';
import { clamp } from './rng.js';

// Where the ink is allowed to go inside the box. Everything is in CSS pixels
// so the same numbers describe the drawing on a phone and on a 4K monitor.
const PAD = 14, FOOT = 28, HEAD = 12;
const AXIS_GUTTER = 92;      // room for real values when one line is isolated

// The plot box for a canvas of the given CSS size.
export function chartPlot(box, isolated) {
  const top = HEAD, bot = Math.max(top + 24, box.ch - FOOT);
  const left = isolated ? Math.min(AXIS_GUTTER, box.cw * 0.34) : PAD;
  const right = PAD;
  return { top, bot, left, right, w: Math.max(1, box.cw - left - right), h: Math.max(1, bot - top) };
}

// The five tracked quantities. Chart, legend and readout all read this list, so
// they cannot disagree about what is being drawn.
export function chartSeries() {
  return [
    { k: 1, c: '#9ec98a', label: 'herds', unit: 'herd animals', fmt: (v) => String(v) },
    { k: 2, c: '#ef6a54', label: 'predators', unit: 'predators', fmt: (v) => String(v) },
    { k: 3, c: '#68d18a', label: 'forest', unit: 'forest cover (%)', fmt: (v) => v + '%' },
    { k: 4, c: '#8a6a4a', label: 'scorched', unit: 'scorched ground cells', fmt: (v) => v + ' cells' },
    { k: 8, c: '#e0b661', label: 'prosperity', unit: 'prosperity (0–1)', fmt: (v) => (v / 100).toFixed(2) },
  ];
}

// min/max per column, computed once per draw instead of once per line, per
// cursor and per legend entry.
export function seriesRanges(rows, series) {
  return series.map((s) => {
    let lo = Infinity, hi = -Infinity;
    for (const row of rows) { const v = row[s.k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return { lo, hi, range: hi - lo };
  });
}

/**
 * Draws the chart. Returns the plot geometry so the caller can turn a pointer
 * position back into a day, plus the series ranges the readout and legend want.
 */
export function drawChronicleChart(cv, opts) {
  const { rows, written, cursor, fallbackW = 720, fallbackH = 120 } = opts;
  const series = opts.series;
  const box = fitCanvas(cv, fallbackW, fallbackH);
  const g = cv.getContext('2d');
  if (!g || rows.length < 2) return null;
  inkSpace(g, box.dpr);

  g.clearRect(0, 0, box.cw, box.ch);
  g.fillStyle = PAPER.panel;
  g.fillRect(0, 0, box.cw, box.ch);

  const plot = chartPlot(box, series.length === 1);
  const n = rows.length;
  const x = (i) => plot.left + (i / (n - 1)) * plot.w;
  const ranges = seriesRanges(rows, series);
  const y = (v, r) => (r.range < 1e-6
    ? (plot.top + plot.bot) / 2
    : plot.bot - ((v - r.lo) / r.range) * plot.h);

  // day gridlines, every 5 in-world days
  g.strokeStyle = PAPER.grid; g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    if (rows[i][0] % 5) continue;
    g.moveTo(Math.round(x(i)) + 0.5, plot.top); g.lineTo(Math.round(x(i)) + 0.5, plot.bot);
  }
  g.stroke();

  // when a single line is isolated it gets real values on a real axis
  if (series.length === 1) {
    const s = series[0], r = ranges[0];
    g.font = typeface(11);
    g.fillStyle = PAPER.ink;
    g.strokeStyle = PAPER.axis;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const [value, yy] of [[r.lo, plot.bot], [(r.lo + r.hi) / 2, (plot.top + plot.bot) / 2], [r.hi, plot.top]]) {
      g.beginPath(); g.moveTo(plot.left, yy + 0.5); g.lineTo(box.cw - plot.right, yy + 0.5); g.stroke();
      g.fillText(s.fmt(value), 4, yy);
    }
  }

  g.lineJoin = 'round'; g.lineCap = 'round';
  for (let si = 0; si < series.length; si++) {
    const s = series[si], r = ranges[si];
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x(i), py = y(rows[i][s.k], r);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.strokeStyle = s.c; g.lineWidth = 2;
    g.globalAlpha = r.range < 1e-6 ? 0.35 : 1;
    g.stroke();
    // a dot on today's value, so the present is findable at a glance
    g.beginPath(); g.arc(x(n - 1), y(rows[n - 1][s.k], r), 3, 0, Math.PI * 2);
    g.fillStyle = s.c; g.fill();
    g.globalAlpha = 1;
  }

  // days you wrote something on get a tick: the chart is an index into the
  // chronicle, not just a picture of it
  if (written && written.size) {
    g.fillStyle = PAPER.tick;
    for (let i = 0; i < n; i++) {
      if (!written.has(rows[i][0])) continue;
      g.fillRect(Math.round(x(i)), box.ch - FOOT + 3, 2, 5);
    }
  }

  // the reading cursor
  const ci = clamp(cursor, 0, n - 1);
  const cx = Math.round(x(ci)) + 0.5;
  g.strokeStyle = PAPER.cursor; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx, plot.top); g.lineTo(cx, plot.bot); g.stroke();
  for (let si = 0; si < series.length; si++) {
    g.beginPath(); g.arc(cx, y(rows[ci][series[si].k], ranges[si]), 4.5, 0, Math.PI * 2);
    g.fillStyle = PAPER.panel; g.fill();
    g.lineWidth = 2; g.strokeStyle = series[si].c; g.stroke();
  }

  // The chart hides scale by design, and says so where the lines are rather than
  // only in the readout below. It is set on its own slip of paper, after the
  // ink, so a line running up under it cannot make it unreadable.
  if (series.length > 1) {
    const note = 'each line on its own range';
    g.font = typeface(10);
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = PAPER.panel;
    g.fillRect(plot.left + 1, plot.top + 1, g.measureText(note).width + 10, 16);
    g.fillStyle = PAPER.inkDim;
    g.fillText(note, plot.left + 6, plot.top + 4);
  }

  // the ends of the record, and the rule they sit on
  g.strokeStyle = PAPER.rule; g.lineWidth = 1;
  g.beginPath(); g.moveTo(plot.left, box.ch - FOOT + 13.5); g.lineTo(box.cw - plot.right, box.ch - FOOT + 13.5); g.stroke();
  g.fillStyle = PAPER.inkDim;
  g.font = typeface(11);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left'; g.fillText('day ' + rows[0][0], plot.left, box.ch - 4);
  const last = 'day ' + rows[n - 1][0];
  g.textAlign = 'right'; g.fillText(last, box.cw - plot.right, box.ch - 4);

  return { box, plot, x, ranges, cursor: ci, rows: n };
}

// Turns a client x into a row index, using the plot rectangle that was actually
// drawn rather than the canvas's declared attributes — those two disagree the
// moment a canvas is sized to its box, and the reader's finger does not.
export function dayAtClientX(result, clientX, rect) {
  if (!result) return null;
  const t = rect.width ? (clientX - rect.left) / rect.width : 0;
  const u = (t * result.box.cw - result.plot.left) / result.plot.w;
  return clamp(Math.round(u * (result.rows - 1)), 0, result.rows - 1);
}
