// Conservative section recovery: never eval, never invent missing diary text.
import { WORLD } from './worldgen.js';

const finite = Number.isFinite;
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = v => Array.isArray(v) && v.every(finite);
const position = v => object(v) && finite(v.x) && finite(v.z)
  && Math.abs(v.x) <= WORLD.half && Math.abs(v.z) <= WORLD.half;
const count = v => finite(v) && v >= 0;

function plane(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    const bytes = atob(value);
    if (bytes.length % 3) return false;
    let n = 0;
    for (let i = 0; i < bytes.length; i += 3) {
      const run = bytes.charCodeAt(i + 1) | bytes.charCodeAt(i + 2) << 8;
      if (!run) return false;
      n += run;
      if (n > size) return false;
    }
    return n === size;
  } catch { return false; }
}

const validators = {
  v: v => v === 1,
  seed: finite, savedAt: count, time: v => finite(v) && v >= 0 && v < 1,
  day: v => Number.isInteger(v) && v >= 1, elapsed: count,
  ground: v => Array.isArray(v) ? v.length === 4 && v.every(p => plane(p, WORLD.stateRes ** 2))
    : plane(v, WORLD.stateRes ** 2 * 4),
  fuel: v => plane(v, WORLD.fireRes ** 2),
  explored: v => plane(v, WORLD.exploreRes ** 2),
  regions: v => Array.isArray(v) && v.length === WORLD.regionRes ** 2 && v.every(r =>
    Array.isArray(r) && r.length === 8 && r.slice(0, 5).every(count) &&
    Number.isInteger(r[5]) && r[5] >= -1 && r[5] <= 2 && numbers(r[6]) && r[6].length === 3 && count(r[7])),
  settlements: v => Array.isArray(v) && v.length === 5 && v.every(s => position(s)
    && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.status === 'string'
    && ['prosperity', 'population', 'buildings', 'walls', 'fields', 'supplies', 'defense', 'land', 'raidTimer'].every(k => count(s[k]))
    && finite(s.rep) && Number.isInteger(s.banner) && s.banner >= 0 && s.banner <= 2),
  factions: v => Array.isArray(v) && v.length === 3 && v.every((f, i) => object(f) && f.id === i
    && ['territory', 'power', 'aggression'].every(k => finite(f[k]))),
  weather: v => object(v) && ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fogbank'].includes(v.type)
    && ['intensity', 'target', 'next', 'windDir', 'windSpeed'].every(k => finite(v[k]))
    && (v.groundWetness === undefined || count(v.groundWetness)),
  player: v => position(v) && ['y', 'yaw', 'hp', 'maxHp', 'stamina', 'warmth'].every(k => finite(v[k]))
    && object(v.inv) && ['wood', 'stone', 'hide', 'herb', 'ore', 'berry', 'relic'].every(k => count(v.inv[k]))
    && object(v.stats) && ['hunted', 'felled', 'fires', 'quests', 'planted', 'distance', 'helped', 'kills'].every(k => count(v.stats[k]))
    && numbers(v.rep) && v.rep.length === 3 && (!v.waypoint || position(v.waypoint)),
  journal: v => Array.isArray(v) && v.every(j => object(j) && finite(j.day) && finite(j.t)
    && typeof j.text === 'string' && typeof j.kind === 'string'),
  history: v => Array.isArray(v) && v.every(r => numbers(r) && r.length >= 9),
  plantings: v => Array.isArray(v) && v.every(p => position(p) && finite(p.t)),
  discovered: v => object(v) && Object.values(v).every(n => count(n) || n === true),
  vegRemoved: v => object(v) && Object.values(v).every(m => object(m) && Object.values(m).every(count)),
  quests: v => Array.isArray(v) && v.every(q => object(q) && typeof q.id === 'string'
    && typeof q.kind === 'string' && typeof q.title === 'string' && finite(q.expires)),
  snap: v => object(v) && finite(v.day) && Array.isArray(v.set) && numbers(v.ter) && object(v.eco),
};

export function invalidSaveSections(obj) {
  if (!object(obj)) return ['world'];
  const invalid = Object.entries(obj).filter(([k, v]) => validators[k] && !validators[k](v)).map(([k]) => k);
  for (const required of ['time', 'day', 'player', 'regions']) if (!(required in obj)) invalid.push(required);
  return invalid;
}

export function recoverSave(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const recovered = {}, lost = [];
  if (object(parsed)) {
    for (const [key, value] of Object.entries(parsed)) {
      if (!validators[key]) continue;
      if (validators[key](value)) recovered[key] = value; else lost.push(key);
    }
  } else {
    // Candidate section boundaries. A nested key is skipped unless the entire
    // preceding value parses, so player.stats.quests cannot split the player.
    const keys = Object.keys(validators).join('|');
    const starts = [...raw.matchAll(new RegExp(`(?:^\\s*\\{|,)\\s*"(${keys})"\\s*:`, 'g'))];
    for (let i = 0; i < starts.length; i++) {
      const m = starts[i], key = m[1], begin = m.index + m[0].length;
      let found = false;
      for (let j = i + 1; j <= starts.length; j++) {
        const end = j < starts.length ? starts[j].index : raw.replace(/}\s*$/, '').length;
        try {
          const value = JSON.parse(raw.slice(begin, end));
          if (validators[key](value)) { recovered[key] = value; found = true; }
          else lost.push(key);
          i = j - 1;
          break;
        } catch { /* incomplete value: try the next boundary */ }
      }
      if (!found && !lost.includes(key)) lost.push(key);
    }
  }
  // Clock metadata alone is not a world. Never claim recovery for an empty shell.
  const substantial = ['ground', 'regions', 'settlements', 'player', 'explored'].filter(k => k in recovered);
  if (!substantial.length) return null;
  for (const key of ['ground', 'regions', 'settlements', 'player', 'journal']) {
    if (!(key in recovered) && !lost.includes(key)) lost.push(key);
  }
  const names = { ground: 'the land', explored: 'your survey', player: 'your position and inventory' };
  const kept = substantial.map(k => names[k] || k);
  const journalCount = parsed && Array.isArray(parsed.journal) ? parsed.journal.length : null;
  const missing = [...new Set(lost)].map(k => k === 'journal'
    ? journalCount === null ? 'journal (entry count unknown)' : `${journalCount} journal entries` : k);
  return { payload: recovered, report: `Recovered: ${kept.join(', ')}; lost or reset: ${missing.join(', ') || 'unreadable formatting'}.` };
}
