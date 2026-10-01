// Ecological Early-Warning System — makes instability visible before collapse
// through tracks, silence, vegetation, carcasses, NPC remarks, and subtle HUD clues.
// Designed to be diegetic — the world speaks, not a HUD meter.

import { WORLD } from './worldgen.js';
import { regionIndex, regionCenter } from './worldstate.js';
import { weight } from './chronology.js';
import { icon } from './uikit.js';

// ---------------------------------------------------------------------------
// Warning Grammars — each is a diegetic "grammar" of signs
// ---------------------------------------------------------------------------

// 1. Tracks & Signs — physical evidence on the ground
const TRACKS = {
  id: 'tracks',
  name: 'Tracks & Sign',
  weight: 1.0,
  cues: [
    { condition: (state, r) => r.prey < r.cap * 0.2 && r.pred > r.cap * 0.15,
      cue: 'wolf_tracks_fresh', message: 'Fresh wolf tracks cross the trail. The deer are gone.',
      visual: 'wolf_tracks_fresh', audio: 'wolf_howl_distant', priority: 'high' },
    { condition: (state, r) => r.prey < r.cap * 0.15 && r.pred < r.cap * 0.05,
      cue: 'silence_total', message: 'No birds. No insects. The silence has weight.',
      visual: 'still_air', audio: 'silence_heavy', priority: 'critical' },
    { condition: (state, r) => {
        const idx = regionIndex(state.player.pos.x, state.player.pos.z);
        return state.plantings.some(p => {
          const ri = regionIndex(p.x, p.z);
          return ri === idx && state.elapsed - p.t < 86400 * 30;
        });
      },
      cue: 'saplings_young', message: 'Your saplings stand knee-high. Deer test them nightly; birds nest in them.' },
    { condition: (state, r) => {
        const idx = regionIndex(state.player.pos.x, state.player.pos.z);
        return state.plantings.some(p => {
          const ri = regionIndex(p.x, p.z);
          return ri === idx && state.elapsed - p.t > 86400 * 180;
        });
      },
      cue: 'saplings_mature', message: 'Your saplings are young trees now. Deer browse them; birds nest in them.' },
    { condition: (state, r) => r.trees > 1.0 && r.prey < r.cap * 0.2,
      cue: 'hollow_forest', message: 'Trees stand full but nothing browses them. A forest without animals.' },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority });
    }
    return cues;
  },
};

// 2. Silence & Sound — audible ecology
const SILENCE = {
  id: 'silence',
  name: 'Silence & Sound',
  weight: 0.9,
  cues: [
    { condition: (state, r) => r.prey < r.cap * 0.15 && r.pred < r.cap * 0.05,
      cue: 'silence_total', message: 'No birds. No insects. The silence has weight.',
      visual: 'still_air', audio: 'silence_heavy', priority: 'critical' },
    { condition: (state, r) => r.prey > r.cap * 1.2 && r.trees > 0.8,
      cue: 'dawn_chorus_loud', message: 'Dawn chorus so loud it wakes you. Life overflows.' },
    { condition: (state, r) => r.trees > 0.9 && r.prey > r.cap * 0.8,
      cue: 'birds_mixed', message: 'Mixed flock calls — three species in one tree. The forest is whole.' },
    { condition: (state, r) => r.trees < 0.5 && r.prey > r.cap * 0.8,
      cue: 'birds_frantic', message: 'Birds call in alarm flights. Something moves in the canopy.' },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority });
    }
    return cues;
  },
};

// 3. Vegetation & Ground (visible, physical)
const VEGETATION = {
  id: 'vegetation',
  name: 'Vegetation & Ground',
  weight: 0.85,
  cues: [
    { condition: (state, r) => r.trees < 0.3,
      cue: 'saplings_absent', message: 'No saplings. No seedlings. The forest has no children.' },
    { condition: (state, r) => r.trees > 0.9 && r.grazingPressure < 0.3,
      cue: 'saplings_thick', message: 'Saplings carpet the undergrowth. The forest is birthing itself.' },
    { condition: (state, r) => {
        const idx = regionIndex(state.player.pos.x, state.player.pos.z);
        return state.plantings.some(p => {
          const ri = regionIndex(p.x, p.z);
          return ri === idx && state.elapsed - p.t < 86400 * 30;
        });
      },
      cue: 'saplings_young', message: 'Your saplings stand knee-high. Deer test them nightly; birds nest in them.' },
    { condition: (state, r) => r.trees > 1.0 && r.prey < r.cap * 0.2,
      cue: 'hollow_forest', message: 'Trees stand full but nothing browses them. A forest without animals.' },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority });
    }
    return cues;
  },
};

// 4. Carcasses & Scavengers
const CARCASSES = {
  id: 'carcasses',
  name: 'Carcasses & Scavengers',
  weight: 0.8,
  cues: [
    { condition: (state, r) => state.corpses.some(c => regionIndex(c.a.pos.x, c.a.pos.z) === regionIdx && c.a.def.prey),
      cue: 'carcass_fresh', message: 'A fresh carcass. Flies. The wolves will come tonight.' },
    { condition: (state, r) => state.corpses.filter(c => regionIndex(c.a.pos.x, c.a.pos.z) === regionIdx && c.a.def.pred).length > 2,
      cue: 'carcasses_predators', message: 'Multiple predator carcasses. Something is killing the hunters.' },
    { condition: (state, r) => state.corpses.filter(c => regionIndex(c.a.pos.x, c.a.pos.z) === regionIdx).length > 5,
      cue: 'carcasses_many', message: 'Too many bodies. Disease or poison — not hunger.' },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority });
    }
    return cues;
  },
};

// 5. NPC Remarks — villagers, hunters, travelers speak
const NPC_REMARKS = {
  id: 'npc_remarks',
  name: 'NPC Remarks',
  weight: 0.95,
  cues: [
    { condition: (state, r, sample) => {
        return sample.settlement && sample.settlement.prosperity < 0.3 && r.prey < r.cap * 0.2;
      },
      cue: 'villager_hunger', message: '"The hunters come back empty. The children ask when the meat comes back."' },
    { condition: (state, r, sample) => {
        return sample.settlement && sample.settlement.prosperity < 0.3 && r.trees < 0.5;
      },
      cue: 'villager_despair', message: '"The forest fed us. Now it gives nothing. The elders speak of leaving."' },
    { condition: (state, r, sample) => {
        return sample.settlement && sample.settlement.prosperity > 0.7 && r.trees > 0.8;
      },
      cue: 'villager_pride', message: '"We planted those saplings. The forest remembers our hands."' },
    { condition: (state, r, sample) => {
        return sample.settlement && sample.settlement.status === 'dying' && r.trees < 0.5;
      },
      cue: 'villager_leaving', message: '"We leave at spring. There is nothing left to stay for."' },
    { condition: (state, r, sample) => {
        return sample.settlement && sample.settlement.status === 'thriving' && r.trees > 0.8;
      },
      cue: 'villager_pride_forest', message: '"We planted those saplings. The forest remembers our hands."' },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const sample = { settlement: null };
    const [cx, cz] = regionCenter(regionIdx);
    let nearestDist = Infinity;
    for (const s of state.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d < nearestDist) { nearestDist = d; sample.settlement = s; }
    }
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r, sample)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority });
    }
    return cues;
  },
};

// 6. Subtle HUD / World Clues (non-intrusive, diegetic)
const HUD_CLUES = {
  id: 'hud_clues',
  name: 'Subtle HUD / World Clues',
  weight: 0.6,
  cues: [
    { condition: (state, r) => r.preyPressure < 0.25 && r.predPressure > 0.8,
      cue: 'hud_prey_crash', message: 'HUD: Herd icon flickers. Predator icon pulses.',
      priority: 'high', hudOnly: true },
    { condition: (state, r) => r.trees < 0.35 && r.prey < r.cap * 0.3,
      cue: 'hud_village_starving', message: 'Village icon on compass pulses faintly. Hunger.',
      priority: 'high', hudOnly: true },
    { condition: (state, r) => state.weather.type === 'storm' && r.trees < 0.5,
      cue: 'hud_storm_flood_risk', message: 'Storm coming. The hills have no roots to hold the water.',
      priority: 'high', hudOnly: true },
    { condition: (state, r) => state.player.stats.felled > 50 && r.trees < 0.6,
      cue: 'hud_guilt', message: 'The compass needle trembles when you face the stripped ridge.',
      priority: 'high', hudOnly: true },
  ],
  generateCues(state, regionIdx) {
    const r = state.regions[regionIdx];
    const cues = [];
    for (const cue of this.cues) {
      if (cue.condition(state, r)) cues.push({ type: cue.cue, message: cue.message, strength: 1, visual: cue.visual, audio: cue.audio, priority: cue.priority, hudOnly: cue.hudOnly });
    }
    return cues;
  },
};

// ---------------------------------------------------------------------------
// Aggregate all warning grammars
// ---------------------------------------------------------------------------
export const ALL_WARNING_GRAMMARS = [TRACKS, SILENCE, VEGETATION, CARCASSES, NPC_REMARKS, HUD_CLUES];

// ---------------------------------------------------------------------------
// Early Warning System — aggregates cues across nearby regions
// ---------------------------------------------------------------------------
export class EarlyWarningSystem {
  constructor() {
    this.activeCues = new Map(); // cueId -> { cue, region, strength, since }
    this.cueHistory = [];        // for pattern detection
    this.maxHistory = 200;
  }

  // Called each tick (or every few seconds) to evaluate cues near player
  evaluate(playerX, playerZ, state, radius = 800) {
    const RR = WORLD.regionRes;
    const playerRegion = regionIndex(playerX, playerZ);
    const newCues = [];
    const now = state.elapsed;

    // Check all grammars for nearby regions
    for (const grammar of ALL_WARNING_GRAMMARS) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = (playerRegion % RR) + di;
          const nj = Math.floor(playerRegion / RR) + dj;
          if (ni < 0 || nj < 0 || ni >= RR || nj >= RR) continue;
          const nIdx = nj * RR + ni;
          const [cx, cz] = regionCenter(nIdx);
          const dist = Math.hypot(cx - playerX, cz - playerZ);
          if (dist > radius) continue;

          const cues = ALL_WARNING_GRAMMARS.find(g => grammar.id === grammar.id)?.generateCues?.(state, nIdx) || grammar.generateCues(state, nIdx);
          for (const cue of cues) {
            cue.region = nIdx;
            cue.distance = dist;
            cue.timestamp = now;
            cue.grammar = grammar.id;
            newCues.push(cue);
          }
        }
      }
    }

    // Merge with active cues (reinforce existing, add new)
    for (const cue of newCues) {
      const key = `${cue.grammar}_${cue.type}_${cue.region}`;
      const existing = this.activeCues.get(key);
      if (existing) {
        existing.strength = Math.min(1, existing.strength + 0.15);
        existing.timestamp = now;
      } else {
        this.activeCues.set(key, { ...cue, strength: cue.strength || 1 });
        this.cueHistory.push({ ...cue, firstSeen: now });
        if (this.cueHistory.length > this.maxHistory) this.cueHistory.shift();
      }
    }

    // Decay old cues
    for (const [key, cue] of this.activeCues) {
      const age = now - cue.timestamp;
      cue.strength *= Math.pow(0.95, age / 60); // decay per minute
      if (cue.strength < 0.1) this.activeCues.delete(key);
    }

    return newCues;
  }

  // Get active cues for UI / audio
  getActiveCues(threshold = 0.2) {
    return [...this.activeCues.values()]
      .filter(c => c.strength >= threshold)
      .sort((a, b) => b.strength - a.strength);
  }

  // Get cues for a specific region (for regional panel)
  getCuesForRegion(regionIdx, threshold = 0.1) {
    return [...this.activeCues.values()]
      .filter(c => c.region === regionIdx && c.strength >= threshold)
      .sort((a, b) => b.strength - a.strength);
  }

  // Serialize for save
  serialize() {
    return {
      activeCues: [...this.activeCues.entries()].map(([k, v]) => [k, v]),
      cueHistory: this.cueHistory.slice(-100),
    };
  }

  deserialize(data) {
    if (!data) return;
    this.activeCues = new Map(data.activeCues || []);
    this.cueHistory = data.cueHistory || [];
  }
}

export const earlyWarningSystem = new EarlyWarningSystem();