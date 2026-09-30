// Contextual teaching is a preference, not part of a particular world's diary.
import { Settings } from './settings.js';

export const HINTS = {
  night: 'Night draws wolves closer. A village hearth is safer than the open woods.',
  tree: 'That stump will regrow. Heavy felling also costs the nearby village its timber.',
  fire: 'Fire follows the wind. Rain slows it; blackened ground remembers it.',
  village: 'Speak at the village hall. Gifts of timber can become real homes.',
  banner: 'A banner has changed. The compass and survey map now show the new owner.',
  landmark: 'This stone unseals the Long Record. Find its relic; press E again to read.'
};

export class Guidance {
  constructor(state, ui) {
    this.state = state;
    this.ui = ui;
    this.night = state.time < 0.22 || state.time > 0.8;
    this.felled = state.player.stats.felled;
    this.fires = state.player.stats.fires;
    this.found = Object.keys(state.discovered).length;
  }

  once(key) {
    if (!Settings.get('hints')) return;
    const seen = Settings.get('seenHints') || {};
    if (seen[key]) return;
    Settings.set('seenHints', { ...seen, [key]: true });
    this.ui.toast(HINTS[key]);
  }

  note(entry) {
    if (entry.kind === 'faction') this.once('banner');
  }

  update(pos) {
    const st = this.state, stats = st.player.stats;
    const night = st.time < 0.22 || st.time > 0.8;
    if (night && !this.night) this.once('night');
    if (stats.felled > this.felled) this.once('tree');
    if (stats.fires > this.fires) this.once('fire');
    const found = Object.keys(st.discovered).length;
    if (found > this.found) this.once('landmark');
    if (st.settlements.some(s => !s.abandoned && Math.hypot(s.x - pos.x, s.z - pos.z) < 45)) this.once('village');
    this.night = night; this.felled = stats.felled; this.fires = stats.fires; this.found = found;
  }
}
