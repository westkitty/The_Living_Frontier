// Save encoding, section recovery and load factories. No DOM and no dependency on WorldState.
import { WORLD } from './worldgen.js';
import { invalidSaveSections, recoverSave } from './save-recovery.js';
export const SAVE_KEY = 'living_frontier_save_v1';
const R = WORLD.stateRes, FR = WORLD.fireRes, XR = WORLD.exploreRes;

// ---------------------------------------------------------------------------
// Compression helpers (RLE + base64) so a 256KB ground map fits in localStorage
// ---------------------------------------------------------------------------
function deinterleave(u8, ch) {
  const n = u8.length / 4;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = u8[i * 4 + ch];
  return out;
}
function interleaveInto(u8, plane, ch) {
  for (let i = 0; i < plane.length; i++) u8[i * 4 + ch] = plane[i];
}
function rleEncode(u8) {
  const out = [];
  let i = 0;
  while (i < u8.length) {
    const v = u8[i]; let n = 1;
    while (i + n < u8.length && u8[i + n] === v && n < 65535) n++;
    out.push(v, n); i += n;
  }
  const buf = new Uint8Array(out.length * 3 / 2 | 0 + 8);
  const arr = [];
  for (let k = 0; k < out.length; k += 2) { arr.push(out[k], out[k + 1] & 255, (out[k + 1] >> 8) & 255); }
  const bytes = new Uint8Array(arr);
  let s = '';
  for (let k = 0; k < bytes.length; k += 4096) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 4096));
  return btoa(s);
}
function quantize(u8, step) {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) out[i] = Math.round(u8[i] / step) * step;
  return out;
}
export function rleDecode(b64, length) {
  const bin = atob(b64);
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 2 < bin.length + 1 && p < length; i += 3) {
    const v = bin.charCodeAt(i);
    const n = bin.charCodeAt(i + 1) | (bin.charCodeAt(i + 2) << 8);
    for (let k = 0; k < n && p < length; k++) out[p++] = v;
  }
  return out;
}

export const PersistenceMixin = {
  serialize() {
    return {
      v: this.version, seed: this.seed, time: this.time, day: this.day, elapsed: this.elapsed,
      savedAt: Date.now(),
      ground: [0, 1, 2, 3].map(ch => rleEncode(deinterleave(this.ground, ch))),
      fuel: rleEncode(quantize(this.fuel, 16)),
      weather: this.weather,
      regions: this.regions.map(r => [+r.prey.toFixed(2), +r.pred.toFixed(2), r.cap, +r.trees.toFixed(3), Math.round(r.ore), r.owner, r.pressure.map(p => Math.round(p)), +r.heat.toFixed(2)]),
      settlements: this.settlements,
      factions: this.factions,
      explored: rleEncode(this.explored),
      vegRemoved: this.vegRemoved,
      plantings: this.plantings || [],
      discovered: this.discovered,
      journal: this.journal.slice(0, 60),
      quests: this.quests,
      player: this.player,
      snap: this.snapshot(),
      history: this.history.slice(-90),
    };
  },

  save() {
    let payload;
    try {
      payload = JSON.stringify(this.serialize());
    } catch (e) {
      console.warn('could not serialise world', e);
      this.saveError = 'serialise';
      return false;
    }
    try {
      localStorage.setItem(SAVE_KEY, payload);
      this.lastSave = Date.now();
      this.saveBytes = payload.length;
      this.saveError = null;
      return true;
    } catch (e) {
      // Quota or a blocked storage partition. Try once more without the
      // chronicle, which is the largest expendable part of the save.
      this.saveError = (e && e.name) || 'blocked';
      try {
        const slim = this.serialize();
        slim.journal = slim.journal.slice(0, 10);
        localStorage.setItem(SAVE_KEY, JSON.stringify(slim));
        this.lastSave = Date.now();
        this.saveError = null;
        return true;
      } catch (e2) {
        console.warn('save failed', e2);
        return false;
      }
    }
  },

};

export const LoadMixin = {
  deserialize(obj) {
    const s = new this(obj.seed ?? WORLD.seed);
    s.burningList = [];
    s.time = obj.time ?? s.time; s.day = obj.day ?? s.day; s.elapsed = obj.elapsed || 0;
    if (Array.isArray(obj.ground)) {
      for (let ch = 0; ch < 4; ch++) interleaveInto(s.ground, rleDecode(obj.ground[ch], R * R), ch);
    } else if (obj.ground) s.ground = rleDecode(obj.ground, R * R * 4);
    if (obj.fuel) s.fuel = rleDecode(obj.fuel, FR * FR);
    Object.assign(s.weather, obj.weather || {});
    if (obj.regions) obj.regions.forEach((a, i) => {
      const r = s.regions[i]; if (!r) return;
      r.prey = a[0]; r.pred = a[1]; r.cap = a[2]; r.trees = a[3]; r.ore = a[4]; r.owner = a[5]; r.pressure = a[6]; r.heat = a[7];
    });
    if (obj.settlements) obj.settlements.forEach((o, i) => { if (s.settlements[i]) Object.assign(s.settlements[i], o); });
    if (obj.factions) obj.factions.forEach((o, i) => { if (s.factions[i]) Object.assign(s.factions[i], o); });
    if (Array.isArray(obj.history)) {
      s.history = obj.history.filter(h => Array.isArray(h) && h.length >= 9 && Number.isFinite(h[0])).slice(-90);
    }
    if (obj.explored) {
      s.explored = rleDecode(obj.explored, XR * XR);
    } else {
      // Saves from before the map existed: reconstruct the remembered map from
      // the trails the player actually wore into the ground.
      for (let j = 0; j < XR; j++) for (let i = 0; i < XR; i++) {
        const x = (i + 0.5) * WORLD.exploreCell - WORLD.half;
        const z = (j + 0.5) * WORLD.exploreCell - WORLD.half;
        if (s.getGround.call(s, x, z, 1) > 0.12) s.markExplored(x, z, 130);
      }
    }
    s.vegRemoved = obj.vegRemoved || {};
    s.plantings = obj.plantings || [];
    s.discovered = obj.discovered || {};
    s.journal = obj.journal || [];
    s.events = (obj.journal || []).slice(0, 20);
    s.quests = obj.quests || [];
    Object.assign(s.player, obj.player || {});
    s.player.firstRun = false;
    s.recountTerritory();
    s.groundDirty = true;
    return s;
  },

  // Returns { state, status } so the caller can tell the player the truth:
  //   'new'      no save present
  //   'ok'       loaded
  //   'damaged'  a save existed but could not be read — a fresh world is given
  loadResult() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); }
    catch (e) { return { state: null, status: 'new', reason: 'storage-blocked' }; }
    if (!raw) return { state: null, status: 'new' };
    try {
      const obj = JSON.parse(raw);
      const invalid = invalidSaveSections(obj);
      if (invalid.length) throw new Error('Broken save sections: ' + invalid.join(', '));
      const s = this.deserialize(obj);
      const away = Math.max(0, (Date.now() - (obj.savedAt || Date.now())) / 1000);
      s.awaySeconds = away;
      if (away > 30) s.fastForward(Math.min(away * 6, 60 * 60 * 6));
      s.homecoming = away > 120 ? this.diffSnapshots(obj.snap, s.snapshot(), away) : [];
      s.homecomingDays = obj.snap ? s.day - obj.snap.day : 0;
      return { state: s, status: 'ok' };
    } catch (e) {
      console.warn('load failed', e);
      // keep the unreadable save aside rather than overwriting it immediately
      try { localStorage.setItem(SAVE_KEY + '_damaged', raw); } catch (e2) { }
      const recovered = recoverSave(raw);
      if (recovered) {
        const state = this.deserialize(recovered.payload);
        // Do not fast-forward a recovery: preserve its ground byte-for-byte and
        // let the player read the recovery report before further simulation.
        state.awaySeconds = 0;
        return { state, status: 'salvaged', report: recovered.report };
      }
      return { state: null, status: 'damaged', reason: (e && e.message) || 'unreadable' };
    }
  },
  load() { return this.loadResult().state; },};
