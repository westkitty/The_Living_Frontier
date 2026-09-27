// Player preferences. Kept apart from the world save so that erasing a world
// does not throw away how the player likes to play.
const KEY = 'living_frontier_settings_v1';

const DEFAULTS = {
  muted: false,
  quality: 'high',        // high | medium | low
  reducedMotion: null,    // null = follow the operating system
  sensitivity: 1,         // look speed multiplier, 0.4 – 2
  invertY: false,
  hints: true,
  lastTab: 'map',
  mapView: null,          // where the player last had the survey map
};

function systemReducedMotion() {
  try { return !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

export const Settings = {
  values: { ...DEFAULTS },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw) || {});
    } catch (e) { /* corrupt or unavailable storage: fall back to defaults */ }
    // clamp anything a hand-edited/corrupt store could have broken
    const v = this.values;
    if (!['high', 'medium', 'low'].includes(v.quality)) v.quality = 'high';
    v.sensitivity = Math.min(2, Math.max(0.4, Number(v.sensitivity) || 1));
    v.muted = !!v.muted; v.invertY = !!v.invertY; v.hints = v.hints !== false;
    if (v.mapView && !(Number.isFinite(v.mapView.cx) && Number.isFinite(v.mapView.cz) && v.mapView.span > 0)) v.mapView = null;
    if (!['map', 'bag', 'journal', 'world'].includes(v.lastTab)) v.lastTab = 'map';
    return this.values;
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); return true; }
    catch (e) { return false; }
  },

  set(key, value) { this.values[key] = value; this.save(); return value; },
  get(key) { return this.values[key]; },

  // Effective motion preference: explicit choice wins, otherwise the OS setting.
  get motionReduced() {
    return this.values.reducedMotion === null ? systemReducedMotion() : !!this.values.reducedMotion;
  },

  // Applies the preferences that live outside the game object.
  applyDocument() {
    try {
      document.body.classList.toggle('reduced-motion', this.motionReduced);
    } catch (e) { /* no document (tests) */ }
  },
};
