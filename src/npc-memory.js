// NPC Memory System — villagers remember specific major acts, not just reputation values.
// Compresses large histories into a few memorable references.

import { mulberry32, clamp } from './rng.js';
import { FACTIONS } from './worldgen.js';
import { CAUSE_TYPES } from './causal.js';
import { regionIndex } from './worldstate.js';

// ---------------------------------------------------------------------------
// Memory significance thresholds
// ---------------------------------------------------------------------------
const MEMORY_THRESHOLDS = {
  // Player actions that create memories
  huntCount: 5,           // animals killed near village
  fellCount: 3,           // trees felled near village
  fireCount: 1,           // any fire near village
  giveCount: 2,           // supplies given
  killVillager: 1,        // any villager killed
  killSoldier: 2,         // soldiers killed near village
  spellCast: 3,           // spells cast near village
  questComplete: 1,       // any quest completed for village
  questFail: 1,           // any quest failed for village

  // Time decay
  memoryHalfLife: 120,    // days until memory fades to half strength
  maxMemories: 8,         // max memories per NPC
  settlementMaxMemories: 15, // max collective memories per settlement
};

// Memory types
export const MEMORY_TYPES = {
  HUNTING: 'hunting',           // "They took too many deer"
  LOGGING: 'logging',           // "They cleared the ridge"
  FIRE: 'fire',                 // "They set the woods alight"
  GENEROSITY: 'generosity',     // "They brought timber when we needed it"
  VIOLENCE_VILLAGER: 'violence_villager', // "They killed Mara"
  VIOLENCE_SOLDIER: 'violence_soldier',   // "They cut down our protectors"
  MAGIC: 'magic',               // "They called a storm"
  QUEST_SUCCESS: 'quest_success', // "They saved us from starvation"
  QUEST_FAILURE: 'quest_failure', // "They promised food and never returned"
  BANNER_CHANGE: 'banner_change', // "The Pact's colours fly here now"
  ABANDONMENT: 'abandonment',   // "Everyone left, even the elders"
  RESETTLEMENT: 'resettlement', // "New families arrived in spring"
};

export class NPCMemory {
  constructor(type, strength, details = {}) {
    this.type = type;
    this.strength = strength;      // 0..1, decays over time
    this.details = details;        // { count, location, day, year, targetName, etc. }
    this.createdDay = 0;
    this.createdYear = 0;
    this.lastReinforced = 0;       // when this memory was last strengthened
    this.narrated = false;         // has this been spoken in dialogue
    this.id = Math.random().toString(36).slice(2, 9);
  }

  // Decay memory based on elapsed days
  decay(elapsedDays) {
    const halfLife = MEMORY_THRESHOLDS.memoryHalfLife;
    this.strength *= Math.pow(0.5, elapsedDays / halfLife);
    return this.strength > 0.05; // return true if still relevant
  }

  // Reinforce an existing memory (make it stronger and fresher)
  reinforce(amount = 0.3, day, year) {
    this.strength = clamp(this.strength + amount, 0, 1);
    this.lastReinforced = day + year * 360; // simple combined timestamp
    this.details.count = (this.details.count || 0) + 1;
  }

  // Get a dialogue line for this memory
  getDialogueLine(npc, settlement, state) {
    const d = this.details;
    const templates = this.getTemplates(npc, settlement);
    const template = templates[Math.floor(mulberry32(this.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0))() * templates.length)];
    return template(d, npc, settlement, state);
  }

  getTemplates(npc, settlement) {
    const job = npc.job || 'villager';
    const base = {
      [MEMORY_TYPES.HUNTING]: [
        d => `${job === 'hunter' ? 'The herds' : 'Game'} thinned after ${d.count} kills near ${settlement.name}. ${job === 'hunter' ? 'I' : 'Our hunters'} found empty trails.`,
        d => `They hunted ${d.count} beasts in our valley. The wolves came closer after, taking our goats.`,
      ],
      [MEMORY_TYPES.LOGGING]: [
        d => `They felled ${d.count} trees on the ridge. The wind howls different now — no canopy to break it.`,
        d => `The woodcutters say the soil washes away where the big trees stood. ${d.count} gone in one season.`,
      ],
      [MEMORY_TYPES.FIRE]: [
        d => `The fire they lit took the east woods. We smelled smoke for weeks. The ash still blows into the well.`,
        d => `They set the forest alight. ${d.burned || 'A good stretch'} of hunting ground gone. The deer haven't returned.`,
      ],
      [MEMORY_TYPES.GENEROSITY]: [
        d => `They brought ${d.item || 'supplies'} when the stores were empty. The children ate that winter.`,
        d => `${d.count} loads of ${d.item || 'wood'} appeared at the gate. No questions asked. We remember.`,
      ],
      [MEMORY_TYPES.VIOLENCE_VILLAGER]: [
        d => `They killed ${d.name || 'one of ours'} in the square. The elder said nothing. We all heard the silence after.`,
        d => `${d.name || 'Mara'} fell to their blade. Her children ask for her still.`,
      ],
      [MEMORY_TYPES.VIOLENCE_SOLDIER]: [
        d => `They cut down ${d.factionName || 'our soldiers'} on the road. The banner changed within a moon.`,
        d => `Our protectors died by their hand. Now ${d.rivalFaction || 'others'} patrol where our people walked.`,
      ],
      [MEMORY_TYPES.MAGIC]: [
        d => `They spoke and the sky answered. ${d.spellName || 'Lightning'} cracked the ridge. The old ones crossed themselves.`,
        d => `Magic walked here. ${d.spellName || 'Something'} bloomed where nothing grew. Unnatural.`,
      ],
      [MEMORY_TYPES.QUEST_SUCCESS]: [
        d => `They did what they said. ${d.questTitle || 'The task'} finished, and the village breathed again.`,
        d => `A stranger kept their word. ${d.questTitle || 'It'} worked. Rare thing, that.`,
      ],
      [MEMORY_TYPES.QUEST_FAILURE]: [
        d => `They swore they'd ${d.questTitle || 'help'}. The deadline passed. Three families left.`,
        d => `Promised ${d.questTitle || 'aid'} and vanished. The elder still watches the road.`,
      ],
      [MEMORY_TYPES.BANNER_CHANGE]: [
        d => `The ${d.oldBanner || 'old'} banner came down. The ${d.newBanner || 'new'} one went up. Nobody asked us.`,
        d => `One morning the colours changed. ${d.factionName || 'They'} claim the village now.`,
      ],
      [MEMORY_TYPES.ABANDONMENT]: [
        d => `The last family walked out on the ${d.season || 'autumn'} road. Didn't look back.`,
        d => `Empty hearths, cold forges. ${d.population || 'Everyone'} gone. The forest took the streets back.`,
      ],
      [MEMORY_TYPES.RESETTLEMENT]: [
        d => `New roofs on old foundations. ${d.count || 'Families'} came from ${d.from || 'the south'}. Hope looks like smoke from a new chimney.`,
        d => `They're building again where the last ones died. Brave or foolish. Time will tell.`,
      ],
    };
    return base[this.type] || [d => `They remember: ${this.type}.`];
  }
}

export class SettlementMemory {
  constructor(settlementId) {
    this.settlementId = settlementId;
    this.memories = []; // NPCMemory[]
    this.collectiveMemory = ''; // synthesized summary
    this.lastSynthesis = 0;
  }

  addMemory(memory) {
    // Check if similar memory exists and reinforce
    for (const m of this.memories) {
      if (m.type === memory.type && m.details.count) {
        m.reinforce(0.2, memory.createdDay, memory.createdYear);
        return;
      }
    }
    this.memories.push(memory);
    // Trim to max
    if (this.memories.length > MEMORY_THRESHOLDS.settlementMaxMemories) {
      this.memories.sort((a, b) => b.strength - a.strength);
      this.memories = this.memories.slice(0, MEMORY_THRESHOLDS.settlementMaxMemories);
    }
    this.collectiveMemory = '';
  }

  // Decay all memories
  decay(elapsedDays) {
    this.memories = this.memories.filter(m => m.decay(elapsedDays));
    this.collectiveMemory = '';
  }

  // Get memories for a specific NPC (filtered by job/perspective)
  getMemoriesForNPC(npc, limit = 3) {
    const relevant = this.memories.filter(m => this.isRelevantToJob(m.type, npc.job));
    relevant.sort((a, b) => b.strength - a.strength);
    return relevant.slice(0, limit);
  }

  isRelevantToJob(memoryType, job) {
    const relevance = {
      hunter: [MEMORY_TYPES.HUNTING, MEMORY_TYPES.FIRE, MEMORY_TYPES.MAGIC, MEMORY_TYPES.QUEST_SUCCESS, MEMORY_TYPES.QUEST_FAILURE],
      woodcutter: [MEMORY_TYPES.LOGGING, MEMORY_TYPES.FIRE, MEMORY_TYPES.GENEROSITY, MEMORY_TYPES.QUEST_SUCCESS],
      farmer: [MEMORY_TYPES.GENEROSITY, MEMORY_TYPES.QUEST_SUCCESS, MEMORY_TYPES.QUEST_FAILURE, MEMORY_TYPES.ABANDONMENT, MEMORY_TYPES.RESETTLEMENT],
      builder: [MEMORY_TYPES.LOGGING, MEMORY_TYPES.GENEROSITY, MEMORY_TYPES.RESETTLEMENT, MEMORY_TYPES.QUEST_SUCCESS],
      elder: [MEMORY_TYPES.HUNTING, MEMORY_TYPES.LOGGING, MEMORY_TYPES.FIRE, MEMORY_TYPES.VIOLENCE_VILLAGER, MEMORY_TYPES.VIOLENCE_SOLDIER, MEMORY_TYPES.BANNER_CHANGE, MEMORY_TYPES.ABANDONMENT, MEMORY_TYPES.RESETTLEMENT, MEMORY_TYPES.MAGIC],
    };
    const list = relevance[job] || relevance.villager || [];
    return list.includes(memoryType) || job === 'elder'; // elders remember everything
  }

  // Synthesize collective memory for display
  synthesize(state) {
    if (this.collectiveMemory && state.day - this.lastSynthesis < 5) return this.collectiveMemory;
    if (!this.memories.length) return 'The village remembers little of the stranger.';

    const strong = this.memories.filter(m => m.strength > 0.4).slice(0, 5);
    if (!strong.length) return 'Faint memories of a traveler pass through the village.';

    const byType = {};
    for (const m of strong) {
      byType[m.type] = (byType[m.type] || 0) + m.strength;
    }

    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0][0];
    const template = this.getSynthesisTemplate(topType);
    this.collectiveMemory = template(strong, state);
    this.lastSynthesis = state.day;
    return this.collectiveMemory;
  }

  getSynthesisTemplate(topType) {
    const templates = {
      [MEMORY_TYPES.HUNTING]: m => `They speak of the hunter who emptied the valleys. ${m[0].details.count} kills, they say. The wolves grew bold after.`,
      [MEMORY_TYPES.LOGGING]: m => `The ridge stands bare where they cut. Wind sings different through the stumps.`,
      [MEMORY_TYPES.FIRE]: m => `Ash still blows on the wind from the fire they lit. The old forest won't return in our lifetime.`,
      [MEMORY_TYPES.GENEROSITY]: m => `They fed us when the stores were empty. The children grew on their timber and berries.`,
      [MEMORY_TYPES.VIOLENCE_VILLAGER]: m => `Blood on the square stones. ${m[0].details.name || 'One of ours'} died by their hand. We do not forget.`,
      [MEMORY_TYPES.VIOLENCE_SOLDIER]: m => `Our defenders fell. Their banner flies where ours stood. The stranger's doing.`,
      [MEMORY_TYPES.MAGIC]: m => `The sky answered their voice. ${m[0].details.spellName || 'Sorcery'} walked these streets.`,
      [MEMORY_TYPES.QUEST_SUCCESS]: m => `A promise kept. ${m[0].details.questTitle || 'The task'} done, and the village stands.`,
      [MEMORY_TYPES.QUEST_FAILURE]: m => `A promise broken. They swore to ${m[0].details.questTitle || 'help'} and vanished.`,
      [MEMORY_TYPES.BANNER_CHANGE]: m => `The colours changed. ${m[0].details.newBanner || 'New masters'} claim our hearths now.`,
      [MEMORY_TYPES.ABANDONMENT]: m => `Empty streets. The last walked out and the forest closed over their footprints.`,
      [MEMORY_TYPES.RESETTLEMENT]: m => `New smoke rises from old chimneys. Strangers building on borrowed ground.`,
    };
    return templates[topType] || (m => `They remember the stranger. ${m.length} tales told.`);
  }

  serialize() {
    return {
      settlementId: this.settlementId,
      memories: this.memories.map(m => ({
        type: m.type,
        strength: m.strength,
        details: m.details,
        createdDay: m.createdDay,
        createdYear: m.createdYear,
        lastReinforced: m.lastReinforced,
        narrated: m.narrated,
        id: m.id,
      })),
      collectiveMemory: this.collectiveMemory,
      lastSynthesis: this.lastSynthesis,
    };
  }

  static deserialize(data) {
    const mem = new SettlementMemory(data.settlementId);
    mem.memories = (data.memories || []).map(m => {
      const nm = new NPCMemory(m.type, m.strength, m.details);
      nm.createdDay = m.createdDay;
      nm.createdYear = m.createdYear;
      nm.lastReinforced = m.lastReinforced;
      nm.narrated = m.narrated;
      nm.id = m.id;
      return nm;
    });
    mem.collectiveMemory = data.collectiveMemory || '';
    mem.lastSynthesis = data.lastSynthesis || 0;
    return mem;
  }
}

// Manager for all settlement memories
export class NPCMemoryManager {
  constructor() {
    this.settlements = new Map(); // settlementId -> SettlementMemory
  }

  getMemory(settlementId) {
    if (!this.settlements.has(settlementId)) {
      this.settlements.set(settlementId, new SettlementMemory(settlementId));
    }
    return this.settlements.get(settlementId);
  }

  // Record a player action that creates memories
  recordAction(state, settlementId, actionType, details) {
    const settlement = state.settlements.find(s => s.id === settlementId);
    if (!settlement || settlement.abandoned) return;

    const mem = this.getMemory(settlementId);
    let memoryType, strength, memDetails;

    switch (actionType) {
      case 'hunt':
        if (details.isPredator) {
          memoryType = MEMORY_TYPES.HUNTING;
          strength = 0.4;
          memDetails = { count: 1, region: details.region, isPredator: true };
        } else {
          memoryType = MEMORY_TYPES.HUNTING;
          strength = 0.3;
          memDetails = { count: 1, region: details.region };
        }
        break;
      case 'fell':
        memoryType = MEMORY_TYPES.LOGGING;
        strength = 0.4;
        memDetails = { count: 1, region: details.region };
        break;
      case 'fire':
        memoryType = MEMORY_TYPES.FIRE;
        strength = 0.7;
        memDetails = { burned: details.cells || 'ground', region: details.region };
        break;
      case 'give':
        memoryType = MEMORY_TYPES.GENEROSITY;
        strength = 0.5;
        memDetails = { count: details.amount || 1, item: details.item };
        break;
      case 'kill_villager':
        memoryType = MEMORY_TYPES.VIOLENCE_VILLAGER;
        strength = 1.0;
        memDetails = { name: details.name };
        break;
      case 'kill_soldier':
        memoryType = MEMORY_TYPES.VIOLENCE_SOLDIER;
        strength = 0.6;
        memDetails = { factionName: FACTIONS[details.faction]?.name, rivalFaction: FACTIONS[details.rivalFaction]?.name };
        break;
      case 'spell':
        memoryType = MEMORY_TYPES.MAGIC;
        strength = 0.6;
        memDetails = { spellName: details.spellName };
        break;
      case 'quest_complete':
        memoryType = MEMORY_TYPES.QUEST_SUCCESS;
        strength = 0.7;
        memDetails = { questTitle: details.title };
        break;
      case 'quest_fail':
        memoryType = MEMORY_TYPES.QUEST_FAILURE;
        strength = 0.7;
        memDetails = { questTitle: details.title };
        break;
      case 'banner_change':
        memoryType = MEMORY_TYPES.BANNER_CHANGE;
        strength = 0.8;
        memDetails = { oldBanner: details.oldBanner, newBanner: details.newBanner, factionName: FACTIONS[details.newBanner]?.name };
        break;
      case 'abandonment':
        memoryType = MEMORY_TYPES.ABANDONMENT;
        strength = 0.9;
        memDetails = { population: settlement.population, season: this.getSeason(state.day) };
        break;
      case 'resettlement':
        memoryType = MEMORY_TYPES.RESETTLEMENT;
        strength = 0.6;
        memDetails = { count: details.count || 'Families', from: details.from };
        break;
      default:
        return;
    }

    const memory = new NPCMemory(memoryType, strength, memDetails);
    memory.createdDay = state.day;
    memory.createdYear = Math.floor((state.day - 1) / 60) + 1400;
    mem.addMemory(memory);

    // Also add to causal engine
    const causeMap = {
      hunt: CAUSE_TYPES.PLAYER_HUNT,
      fell: CAUSE_TYPES.PLAYER_FELL,
      fire: CAUSE_TYPES.PLAYER_FIRE,
      give: CAUSE_TYPES.PLAYER_GIVE,
      kill_villager: CAUSE_TYPES.PLAYER_KILL_VILLAGER,
      kill_soldier: CAUSE_TYPES.PLAYER_KILL_SOLDIER,
      spell: CAUSE_TYPES.PLAYER_SPELL,
      quest_complete: CAUSE_TYPES.QUEST_COMPLETE,
      quest_fail: CAUSE_TYPES.QUEST_FAIL,
    };
    if (causeMap[actionType]) {
      state.causalEngine?.recordEvent(
        causeMap[actionType],
        details.region ?? regionIndex(settlement.x, settlement.z),
        details,
        true, // playerDirect
        false,
        false,
        state
      );
    }
  }

  // Decay all memories (called daily)
  decayAll(state) {
    const elapsed = 1; // per day
    for (const mem of this.settlements.values()) {
      mem.decay(elapsed);
    }
  }

  // Get dialogue lines for an NPC
  getNPCDialogue(npc, settlement, state) {
    const mem = this.getMemory(settlement.id);
    const memories = mem.getMemoriesForNPC(npc, 2);
    return memories.map(m => m.getDialogueLine(npc, settlement, state));
  }

  // Get collective settlement memory
  getSettlementMemory(settlementId, state) {
    const mem = this.getMemory(settlementId);
    return mem.synthesize(state);
  }

  getSeason(day) {
    const yearDay = (day - 1) % 60;
    if (yearDay < 15) return 'spring';
    if (yearDay < 30) return 'summer';
    if (yearDay < 45) return 'autumn';
    return 'winter';
  }

  serialize() {
    const out = {};
    for (const [id, mem] of this.settlements) {
      out[id] = mem.serialize();
    }
    return out;
  }

  deserialize(data) {
    if (!data) return;
    for (const [id, memData] of Object.entries(data)) {
      this.settlements.set(id, SettlementMemory.deserialize(memData));
    }
  }
}

export const npcMemoryManager = new NPCMemoryManager();