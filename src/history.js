// Compact daily samples and truthful homecoming comparisons, mixed onto WorldState.
import { FACTIONS } from './worldgen.js';
export const HistoryMixin = {
  // ------------------------------------------------------------- homecoming
  // A compact photograph of the frontier, written into every save. When the
  // player returns it is compared against the world that kept running without
  // them, so "come back and see what changed" can actually be shown.
  // A day's vital signs, quantised small enough to keep 90 of them in the save.
  // This is what lets the world draw its own biography on the world screen.
  recordHistory() {
    let prey = 0, pred = 0, trees = 0;
    for (const r of this.regions) { prey += r.prey; pred += r.pred; trees += r.trees; }
    const n = this.regions.length;
    let alive = 0, pros = 0;
    for (const s of this.settlements) { if (!s.abandoned) { alive++; pros += s.prosperity; } }
    this.history.push([
      this.day,
      Math.round(prey),
      Math.round(pred),
      Math.round((trees / n) * 100),
      this.scorchedCells(),
      this.factions[0].territory, this.factions[1].territory, this.factions[2].territory,
      Math.round((alive ? pros / alive : 0) * 100),
    ]);
    if (this.history.length > 90) this.history.splice(0, this.history.length - 90);
  },

  snapshot() {
    let prey = 0, pred = 0, trees = 0;
    for (const r of this.regions) { prey += r.prey; pred += r.pred; trees += r.trees; }
    return {
      day: this.day,
      set: this.settlements.map(s => ({
        n: s.name, p: +s.prosperity.toFixed(3), b: s.buildings, w: s.walls,
        ban: s.banner, ab: !!s.abandoned, st: s.status, pop: Math.round(s.population),
      })),
      ter: this.factions.map(f => f.territory),
      eco: { prey: Math.round(prey), pred: Math.round(pred), trees: +(trees / this.regions.length).toFixed(3) },
      burn: this.scorchedCells(),
    };
  },
  scorchedCells() {
    let n = 0;
    for (let i = 0; i < this.ground.length; i += 4) if (this.ground[i] > 60) n++;
    return n;
  },

};

export const HomecomingMixin = {
  // Produces the plain-language account of what happened while away.
  diffSnapshots(before, after, awaySeconds) {
    if (!before || !after) return [];
    const lines = [];
    const days = after.day - before.day;
    const byName = Object.fromEntries((before.set || []).map(s => [s.n, s]));
    for (const a of after.set || []) {
      const b = byName[a.n];
      if (!b) continue;
      if (a.ab && !b.ab) { lines.push({ kind: 'bad', text: `${a.n} was abandoned. Nothing is left but rubble.` }); continue; }
      if (!a.ab && b.ab) { lines.push({ kind: 'good', text: `${a.n} was resettled.` }); continue; }
      if (a.ban !== b.ban) lines.push({ kind: 'faction', text: `${a.n} now flies a different banner.`, banner: a.ban });
      if (a.b > b.b) lines.push({ kind: 'good', text: `${a.n} raised ${a.b - b.b} new building${a.b - b.b > 1 ? 's' : ''} (${a.pop} souls).` });
      else if (a.b < b.b) lines.push({ kind: 'bad', text: `${a.n} lost ${b.b - a.b} building${b.b - a.b > 1 ? 's' : ''} to neglect.` });
      else if (a.st !== b.st) lines.push({ kind: a.p > b.p ? 'good' : 'bad', text: `${a.n} is ${a.st} now, where it was ${b.st}.` });
      if (a.w > b.w) lines.push({ kind: 'world', text: `${a.n} put up new walls.` });
    }
    for (let i = 0; i < (after.ter || []).length; i++) {
      const d = after.ter[i] - (before.ter[i] || 0);
      if (Math.abs(d) >= 3) {
        lines.push({
          kind: 'faction', faction: i,
          text: d > 0 ? `${FACTIONS[i].name} pushed into ${d} more regions.` : `${FACTIONS[i].name} was driven out of ${-d} regions.`,
        });
      }
    }
    const e0 = before.eco || {}, e1 = after.eco || {};
    if (e0.prey && Math.abs(e1.prey - e0.prey) / Math.max(1, e0.prey) > 0.18) {
      lines.push({ kind: 'world', text: e1.prey > e0.prey ? 'The herds have grown fat in your absence.' : 'The herds have thinned.' });
    }
    if (e0.pred && Math.abs(e1.pred - e0.pred) / Math.max(1, e0.pred) > 0.22) {
      lines.push({ kind: e1.pred > e0.pred ? 'bad' : 'world', text: e1.pred > e0.pred ? 'Wolves are bolder and more numerous.' : 'The wolf packs have shrunk.' });
    }
    if (e0.trees !== undefined && Math.abs(e1.trees - e0.trees) > 0.045) {
      lines.push({ kind: e1.trees > e0.trees ? 'good' : 'bad', text: e1.trees > e0.trees ? 'The woods have crept back in.' : 'The woods are thinner than you left them.' });
    }
    const burnDelta = (after.burn || 0) - (before.burn || 0);
    if (burnDelta > 40) lines.push({ kind: 'bad', text: 'Fire took more ground while you were gone.' });
    else if (burnDelta < -40) lines.push({ kind: 'good', text: 'Old burn scars have greened over.' });
    if (!lines.length && days > 0) lines.push({ kind: 'world', text: 'The frontier turned quietly. Nothing of note changed.' });
    return lines.slice(0, 8);
  },

};
