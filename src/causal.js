// Causal Engine — tracks cause-effect relationships across all simulation systems.
// No DOM, no Three.js: pure simulation logic for headless tests.

import { DAY_LENGTH } from './worldstate.js';

// ---------------------------------------------------------------------------
// Event types that can be linked in causal chains
// ---------------------------------------------------------------------------
export const CAUSE_TYPES = {
  // Player actions
  PLAYER_HUNT: 'player_hunt',
  PLAYER_FELL: 'player_fell',
  PLAYER_FIRE: 'player_fire',
  PLAYER_PLANT: 'player_plant',
  PLAYER_GIVE: 'player_give',
  PLAYER_KILL_VILLAGER: 'player_kill_villager',
  PLAYER_KILL_SOLDIER: 'player_kill_soldier',
  PLAYER_SPELL: 'player_spell',
  PLAYER_QUEST: 'player_quest',

  // Natural simulation
  ECO_PREDATION: 'eco_predation',
  ECO_STARVATION: 'eco_starvation',
  ECO_OVERGRAZING: 'eco_overgrazing',
  ECO_RECOVERY: 'eco_recovery',
  FIRE_SPREAD: 'fire_spread',
  FIRE_RAIN_EXTINGUISH: 'fire_rain_extinguish',
  WEATHER_CHANGE: 'weather_change',
  SETTLEMENT_GROWTH: 'settlement_growth',
  SETTLEMENT_DECLINE: 'settlement_decline',
  SETTLEMENT_ABANDON: 'settlement_abandon',
  SETTLEMENT_RESETTLE: 'settlement_resettle',
  FACTION_EXPANSION: 'faction_expansion',
  FACTION_CONTRACTION: 'faction_contraction',
  FACTION_RAID: 'faction_raid',
  BANNER_FLIP: 'banner_flip',
  LANDMARK_DISCOVERY: 'landmark_discovery',

  // Quest outcomes
  QUEST_COMPLETE: 'quest_complete',
  QUEST_FAIL: 'quest_fail',
  QUEST_EXPIRE: 'quest_expire',

  // Magic consequences
  MAGIC_STORMCALL: 'magic_stormcall',
  MAGIC_BLOOM: 'magic_bloom',
  MAGIC_MEND: 'magic_mend',
  MAGIC_REBUILD: 'magic_rebuild',
  MAGIC_BANISH: 'magic_banish',
  MAGIC_FEAR: 'magic_fear',
  MAGIC_CHARM: 'magic_charm',
};

// Link strength: 1 = direct, 0.5 = contributing, 0.2 = distant/background
export class CausalLink {
  constructor(causeType, effectType, strength, region, data = {}) {
    this.causeType = causeType;
    this.effectType = effectType;
    this.strength = strength;
    this.region = region;           // region index or -1 for global
    this.data = data;               // quantitative details (amounts, counts, etc.)
    this.timestamp = 0;             // set when recorded
    this.day = 0;                   // in-world day
    this.year = 0;                  // in-world year
    this.playerDirect = false;      // true if player directly caused the cause
    this.playerContributed = false; // true if player contributed
    this.natural = false;           // true if fully natural
  }
}

// Causal chain: a sequence of links forming a narrative
export class CausalChain {
  constructor(rootCause, initialEffect) {
    this.links = [];
    this.rootCause = rootCause;
    this.initialEffect = initialEffect;
    this.terminalEffects = [];
    this.strength = 1.0;
    this.discovered = false;
    this.narrated = false;
  }

  addLink(link) {
    this.links.push(link);
    this.strength *= link.strength;
    this.terminalEffects.push(link.effectType);
  }

  // Get human-readable summary
  summarize(state) {
    if (this.links.length === 0) return null;
    const first = this.links[0];
    const last = this.links[this.links.length - 1];
    return {
      root: first.causeType,
      chain: this.links.map(l => l.effectType).join(' → '),
      terminal: last.effectType,
      strength: this.strength,
      region: first.region,
      playerDirect: this.links.some(l => l.playerDirect),
      playerContributed: this.links.some(l => l.playerContributed),
    };
  }
}

// ---------------------------------------------------------------------------
// CausalEngine: records events and builds chains
// ---------------------------------------------------------------------------
export class CausalEngine {
  constructor() {
    this.events = [];          // recent raw events (circular buffer)
    this.chains = [];          // discovered causal chains
    this.maxEvents = 500;
    this.maxChains = 200;
    this.linkRules = this.buildLinkRules();
  }

  buildLinkRules() {
    // Rules: { causeType: { effectType: { strength, condition? } } }
    // Condition is a function(state, causeData, effectData) -> bool
    return {
      [CAUSE_TYPES.PLAYER_HUNT]: {
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.7, condition: (s, c, e) => c.count > e.cap * 0.3 },
        [CAUSE_TYPES.ECO_OVERGRAZING]: { strength: 0.5 },
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.4, condition: (s, c, e) => c.region === e.region },
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.2 },
      },
      [CAUSE_TYPES.PLAYER_FELL]: {
        [CAUSE_TYPES.ECO_OVERGRAZING]: { strength: 0.8 },
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.6, condition: (s, c, e) => c.region === e.region },
        [CAUSE_TYPES.FIRE_SPREAD]: { strength: 0.3 },
      },
      [CAUSE_TYPES.PLAYER_FIRE]: {
        [CAUSE_TYPES.FIRE_SPREAD]: { strength: 0.9 },
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.6 },
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.7, condition: (s, c, e) => c.distance < 200 },
        [CAUSE_TYPES.FACTION_CONTRACTION]: { strength: 0.3 },
      },
      [CAUSE_TYPES.PLAYER_PLANT]: {
        [CAUSE_TYPES.ECO_RECOVERY]: { strength: 0.9 },
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 0.4, condition: (s, c, e) => c.region === e.region },
      },
      [CAUSE_TYPES.PLAYER_GIVE]: {
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 0.8 },
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.3 },
      },
      [CAUSE_TYPES.PLAYER_KILL_VILLAGER]: {
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.9 },
        [CAUSE_TYPES.BANNER_FLIP]: { strength: 0.3 },
      },
      [CAUSE_TYPES.PLAYER_KILL_SOLDIER]: {
        [CAUSE_TYPES.FACTION_CONTRACTION]: { strength: 0.7 },
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.4, condition: (s, c, e) => c.faction !== e.faction },
      },
      [CAUSE_TYPES.ECO_PREDATION]: {
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.6 },
      },
      [CAUSE_TYPES.ECO_STARVATION]: {
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.8, condition: (s, c, e) => c.region === e.region },
        [CAUSE_TYPES.FACTION_RAID]: { strength: 0.4 },
      },
      [CAUSE_TYPES.ECO_OVERGRAZING]: {
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.7 },
        [CAUSE_TYPES.FIRE_SPREAD]: { strength: 0.4 },
      },
      [CAUSE_TYPES.ECO_RECOVERY]: {
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 0.6, condition: (s, c, e) => c.region === e.region },
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.2 },
      },
      [CAUSE_TYPES.FIRE_SPREAD]: {
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.8 },
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.7, condition: (s, c, e) => c.distance < 150 },
        [CAUSE_TYPES.FACTION_CONTRACTION]: { strength: 0.3 },
      },
      [CAUSE_TYPES.SETTLEMENT_GROWTH]: {
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.4 },
        [CAUSE_TYPES.ECO_OVERGRAZING]: { strength: 0.3 },
      },
      [CAUSE_TYPES.SETTLEMENT_DECLINE]: {
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.5, condition: (s, c, e) => c.banner !== e.faction },
        [CAUSE_TYPES.BANNER_FLIP]: { strength: 0.6 },
        [CAUSE_TYPES.ECO_RECOVERY]: { strength: 0.3 },
      },
      [CAUSE_TYPES.FACTION_EXPANSION]: {
        [CAUSE_TYPES.BANNER_FLIP]: { strength: 0.8 },
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.4 },
      },
      [CAUSE_TYPES.FACTION_RAID]: {
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.9 },
      },
      [CAUSE_TYPES.QUEST_COMPLETE]: {
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 0.5 },
        [CAUSE_TYPES.ECO_RECOVERY]: { strength: 0.4 },
      },
      [CAUSE_TYPES.QUEST_FAIL]: {
        [CAUSE_TYPES.SETTLEMENT_DECLINE]: { strength: 0.4 },
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.3 },
      },
      [CAUSE_TYPES.MAGIC_STORMCALL]: {
        [CAUSE_TYPES.WEATHER_CHANGE]: { strength: 1.0 },
        [CAUSE_TYPES.FIRE_SPREAD]: { strength: -0.5 }, // rain suppresses fire
        [CAUSE_TYPES.ECO_STARVATION]: { strength: 0.2 },
      },
      [CAUSE_TYPES.MAGIC_BLOOM]: {
        [CAUSE_TYPES.ECO_RECOVERY]: { strength: 1.0 },
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 0.3 },
      },
      [CAUSE_TYPES.MAGIC_MEND]: {
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 1.0 },
      },
      [CAUSE_TYPES.MAGIC_REBUILD]: {
        [CAUSE_TYPES.SETTLEMENT_GROWTH]: { strength: 1.0 },
        [CAUSE_TYPES.SETTLEMENT_RESETTLE]: { strength: 1.0 },
      },
      [CAUSE_TYPES.MAGIC_BANISH]: {
        [CAUSE_TYPES.FACTION_CONTRACTION]: { strength: 0.8 },
      },
      [CAUSE_TYPES.MAGIC_FEAR]: {
        [CAUSE_TYPES.FACTION_CONTRACTION]: { strength: 0.2 },
      },
      [CAUSE_TYPES.MAGIC_CHARM]: {
        [CAUSE_TYPES.FACTION_EXPANSION]: { strength: 0.3 },
      },
    };
  }

  // Record a raw event
  recordEvent(type, region, data, playerDirect = false, playerContributed = false, natural = false, state = null) {
    const event = {
      type,
      region,
      data,
      playerDirect,
      playerContributed,
      natural,
      timestamp: state?.elapsed ?? 0,
      day: state?.day ?? 0,
      year: state ? Math.floor((state.day - 1) / 60) + 1400 : 0,
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();

    // Try to link to recent events as effects
    this.buildChainsFromEvent(event, state);
  }

  // Build causal chains from a new event (as a potential effect)
  buildChainsFromEvent(newEvent, state) {
    // Look backwards for potential causes
    for (let i = this.events.length - 2; i >= 0; i--) {
      const causeEvent = this.events[i];
      const rule = this.linkRules[causeEvent.type]?.[newEvent.type];
      if (!rule) continue;

      // Check condition if present
      if (rule.condition && !rule.condition(state, causeEvent.data, newEvent.data)) continue;

      // Time window: causes must be within reasonable timeframe
      const timeDiff = newEvent.timestamp - causeEvent.timestamp;
      if (timeDiff > DAY_LENGTH * 30) continue; // 30 in-world days max

      // Create or extend chain
      let chain = this.findChainEndingWith(causeEvent.type, causeEvent.region);
      if (!chain) {
        chain = new CausalChain(causeEvent.type, newEvent.type);
        this.chains.push(chain);
      }

      const link = new CausalLink(
        causeEvent.type,
        newEvent.type,
        rule.strength,
        newEvent.region,
        { ...causeEvent.data, ...newEvent.data }
      );
      link.timestamp = newEvent.timestamp;
      link.day = newEvent.day;
      link.year = newEvent.year;
      link.playerDirect = causeEvent.playerDirect;
      link.playerContributed = causeEvent.playerContributed;
      link.natural = causeEvent.natural && !causeEvent.playerContributed;

      chain.addLink(link);

      // Propagate player attribution
      if (causeEvent.playerDirect) {
        chain.links.forEach(l => l.playerDirect = true);
      } else if (causeEvent.playerContributed) {
        chain.links.forEach(l => l.playerContributed = true);
      }

      // Limit chains
      if (this.chains.length > this.maxChains) this.chains.shift();
      break; // Only link to most recent valid cause
    }
  }

  findChainEndingWith(effectType, region) {
    for (let i = this.chains.length - 1; i >= 0; i--) {
      const chain = this.chains[i];
      if (chain.terminalEffects.includes(effectType) &&
        (chain.links[chain.links.length - 1].region === region || region === -1)) {
        return chain;
      }
    }
    return null;
  }

  // Get chains relevant to a region or global
  getChainsForRegion(region, limit = 10) {
    return this.chains
      .filter(c => c.links.some(l => l.region === region || l.region === -1))
      .slice(-limit)
      .reverse();
  }

  // Get chains where player was involved
  getPlayerChains(limit = 10) {
    return this.chains
      .filter(c => c.links.some(l => l.playerDirect || l.playerContributed))
      .slice(-limit)
      .reverse();
  }

  // Get the strongest chain explaining a specific effect
  getExplanationFor(effectType, region, state) {
    const relevant = this.chains.filter(c =>
      c.terminalEffects.includes(effectType) &&
      c.links.some(l => l.region === region || l.region === -1)
    );
    if (!relevant.length) return null;

    // Score by strength and recency
    relevant.sort((a, b) => {
      const aRecency = a.links[a.links.length - 1].timestamp;
      const bRecency = b.links[b.links.length - 1].timestamp;
      return (b.strength * 0.7 + (bRecency / 1e6) * 0.3) - (a.strength * 0.7 + (aRecency / 1e6) * 0.3);
    });

    return relevant[0];
  }

  // Generate a "Why did this happen?" explanation
  explainEffect(effectType, region, state) {
    const chain = this.getExplanationFor(effectType, region, state);
    if (!chain) return null;

    const summary = chain.summarize(state);
    return this.formatExplanation(chain, summary, state);
  }

  formatExplanation(chain, summary, state) {
    const typeNames = {
      [CAUSE_TYPES.PLAYER_HUNT]: 'heavy hunting',
      [CAUSE_TYPES.PLAYER_FELL]: 'logging',
      [CAUSE_TYPES.PLAYER_FIRE]: 'a fire you set',
      [CAUSE_TYPES.PLAYER_PLANT]: 'your plantings',
      [CAUSE_TYPES.PLAYER_GIVE]: 'your aid',
      [CAUSE_TYPES.PLAYER_KILL_VILLAGER]: 'killing a villager',
      [CAUSE_TYPES.PLAYER_KILL_SOLDIER]: 'killing soldiers',
      [CAUSE_TYPES.PLAYER_SPELL]: 'your magic',
      [CAUSE_TYPES.ECO_PREDATION]: 'predator pressure',
      [CAUSE_TYPES.ECO_STARVATION]: 'prey collapse',
      [CAUSE_TYPES.ECO_OVERGRAZING]: 'overgrazing',
      [CAUSE_TYPES.ECO_RECOVERY]: 'land recovery',
      [CAUSE_TYPES.FIRE_SPREAD]: 'fire spreading',
      [CAUSE_TYPES.WEATHER_CHANGE]: 'weather shifts',
      [CAUSE_TYPES.SETTLEMENT_GROWTH]: 'village prosperity',
      [CAUSE_TYPES.SETTLEMENT_DECLINE]: 'village decline',
      [CAUSE_TYPES.SETTLEMENT_ABANDON]: 'abandonment',
      [CAUSE_TYPES.FACTION_EXPANSION]: 'faction expansion',
      [CAUSE_TYPES.FACTION_CONTRACTION]: 'faction retreat',
      [CAUSE_TYPES.FACTION_RAID]: 'raids',
      [CAUSE_TYPES.BANNER_FLIP]: 'banner change',
      [CAUSE_TYPES.QUEST_COMPLETE]: 'a completed task',
      [CAUSE_TYPES.QUEST_FAIL]: 'a failed task',
      [CAUSE_TYPES.MAGIC_STORMCALL]: 'Stormcall',
      [CAUSE_TYPES.MAGIC_BLOOM]: 'Bloom',
      [CAUSE_TYPES.MAGIC_MEND]: 'Mend Village',
      [CAUSE_TYPES.MAGIC_REBUILD]: 'Rebuild',
      [CAUSE_TYPES.MAGIC_BANISH]: 'Banish',
      [CAUSE_TYPES.MAGIC_FEAR]: 'Fear',
      [CAUSE_TYPES.MAGIC_CHARM]: 'Charm',
    };

    const parts = chain.links.map(l => typeNames[l.causeType] || l.causeType);
    let text = parts.join(' → ');

    // Add attribution
    const hasDirect = chain.links.some(l => l.playerDirect);
    const hasContributed = chain.links.some(l => l.playerContributed);
    if (hasDirect) text = 'You directly caused: ' + text;
    else if (hasContributed) text = 'You contributed to: ' + text;
    else text = 'This happened naturally: ' + text;

    return {
      text,
      chain: summary,
      attribution: hasDirect ? 'direct' : hasContributed ? 'contributed' : 'natural',
      strength: chain.strength,
    };
  }

  // Serialize for save
  serialize() {
    return {
      events: this.events.slice(-100), // only keep recent
      chains: this.chains.map(c => ({
        rootCause: c.rootCause,
        initialEffect: c.initialEffect,
        terminalEffects: c.terminalEffects,
        strength: c.strength,
        discovered: c.discovered,
        narrated: c.narrated,
        links: c.links.map(l => ({
          causeType: l.causeType,
          effectType: l.effectType,
          strength: l.strength,
          region: l.region,
          data: l.data,
          timestamp: l.timestamp,
          day: l.day,
          year: l.year,
          playerDirect: l.playerDirect,
          playerContributed: l.playerContributed,
          natural: l.natural,
        })),
      }),
    };
  }

  // Deserialize from save
  deserialize(data) {
    if (!data) return;
    this.events = data.events || [];
    this.chains = (data.chains || []).map(c => {
      const chain = new CausalChain(c.rootCause, c.initialEffect);
      chain.terminalEffects = c.terminalEffects;
      chain.strength = c.strength;
      chain.discovered = c.discovered;
      chain.narrated = c.narrated;
      chain.links = (c.links || []).map(l => {
        const link = new CausalLink(l.causeType, l.effectType, l.strength, l.region, l.data);
        link.timestamp = l.timestamp;
        link.day = l.day;
        link.year = l.year;
        link.playerDirect = l.playerDirect;
        link.playerContributed = l.playerContributed;
        link.natural = l.natural;
        return link;
      });
      return chain;
    });
  }
}

// Singleton instance
export const causalEngine = new CausalEngine();