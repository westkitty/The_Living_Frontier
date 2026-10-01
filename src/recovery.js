// Recovery Trajectories & Regional Diagnosis
// Communicates whether damaged land is recovering, stable, or deteriorating.
// Per-region diagnosis with diegetic and analytical presentations.

import { clamp } from './rng.js';
import { WORLD, FACTIONS } from './worldgen.js';
import { regionCenter, CH } from './worldstate.js';
import { CausalEngine, CAUSE_TYPES } from './causal.js';
import { NPCMemoryManager } from './npc-memory.js';

// ---------------------------------------------------------------------------
// Regional Sampling & Trajectory
// ---------------------------------------------------------------------------
export function sampleRegion(state, regionIdx, prevSample = null) {
  const r = state.regions[regionIdx];
  if (!r) return null;
  const [cx, cz] = regionCenter(regionIdx);

  // Nearest settlement
  let nearestSettlement = null, nearestDist = Infinity;
  for (const s of state.settlements) {
    if (s.abandoned) continue;
    const d = Math.hypot(s.x - cx, s.z - cz);
    if (d < nearestDist) { nearestDist = d; nearestSettlement = s; }
  }

  const eco = r;
  const food = 0.35 + eco.trees * 0.65;
  const cap = Math.max(2, eco.cap * food);
  const preyRatio = eco.prey / Math.max(1, cap);
  const predRatio = eco.pred / Math.max(0.5, cap * 0.2);
  const grazingPressure = clamp(eco.prey / (cap + 1), 0, 1.4);

  // Fire state
  let burnCells = 0, scarred = false;
  const FR = WORLD.fireRes;
  const cellSize = WORLD.fireCell;
  const startI = Math.max(0, Math.floor((cx - WORLD.regionCell * 0.6 + WORLD.half) / cellSize));
  const endI = Math.min(FR - 1, Math.floor((cx + WORLD.regionCell * 0.6 + WORLD.half) / cellSize));
  const startJ = Math.max(0, Math.floor((cz - WORLD.regionCell * 0.6 + WORLD.half) / cellSize));
  const endJ = Math.min(FR - 1, Math.floor((cz + WORLD.regionCell * 0.6 + WORLD.half) / cellSize));
  for (let j = startJ; j <= endJ; j++) {
    for (let i = startI; i <= endI; i++) {
      if (state.ground[(j * WORLD.stateRes + i) * 4 + CH.BURN] > 60) burnCells++;
    }
  }

  // Settlement demand on this region
  let settlementDemand = { wood: 0, food: 0, safety: 0 };
  if (nearestSettlement && nearestDist < WORLD.regionCell * 2.5) {
    const s = nearestSettlement;
    settlementDemand.wood = s.prosperity * 0.8 + (s.constructing > 0 ? 0.5 : 0);
    settlementDemand.food = settlement.population * 0.1;
    settlementDemand.safety = eco.heat > 0.3 ? 1 : 0.3;
  }

  return {
    index: regionIdx,
    center: [cx, cz],
    settlement: nearestSettlement ? { id: nearestSettlement.id, name: nearestSettlement.name, dist: nearestDist, prosperity: nearestSettlement.prosperity, status: settlement.status } : null,
    ecology: {
      prey: eco.prey, pred: eco.pred, cap,
      preyPressure: preyRatio, predPressure: predRatio, grazingPressure,
      trees: eco.trees, ore: eco.ore,
      health: clamp((eco.trees * 0.4 + (1 - grazingPressure) * 0.3 + (1 - predRatio) * 0.3), 0, 1),
    },
    faction: {
      owner: eco.owner,
      pressure: eco.pressure,
      dominantFaction: eco.dominantFaction,
      dominance: eco.dominance,
      heat: eco.heat,
    },
    fire: { burnCells, scarred: burnCells > 5 },
    demand: settlementDemand,
    trajectory: 'stable',
  };
}

// ---------------------------------------------------------------------------
// Compute trajectory: recovering / stable / deteriorating
// ---------------------------------------------------------------------------
export function computeTrajectory(state, regionIdx, prevSample = null) {
  const r = state.regions[regionIdx];
  if (!r) return 'unknown';

  const food = 0.35 + r.trees * 0.65;
  const cap = Math.max(2, r.cap * food);
  const preyRatio = r.prey / Math.max(1, cap);
  const predRatio = r.pred / Math.max(0.5, cap * 0.2);

  // Compare with previous sample
  if (prevSample) {
    let improving = 0, declining = 0;
    const prevEco = prevSample.ecology;

    if (r.trees > prevSample.ecology.trees + 0.02) improving++;
    else if (r.trees < prevSample.ecology.trees - 0.02) declining++;

    if (r.prey / Math.max(1, cap) > prevSample.ecology.preyPressure + 0.1) improving++;
    else if (r.prey / Math.max(1, cap) < prevSample.ecology.preyPressure - 0.1) declining++;

    if (predRatio < prevSample.ecology.predPressure - 0.1) improving++;
    else if (predRatio > prevSample.ecology.predPressure + 0.1) declining++;

    if (improving > declining) return 'recovering';
    if (declining > improving) return 'deteriorating';
    return 'stable';
  } else {
    // Infer from derivatives (first-order approximation)
    const dailyGrowth = 0.022 * (1 - r.trees) - 0.10 * Math.max(0, clamp(r.prey / (cap + 1), 0, 1.4) - 0.85);
    let improving = 0, declining = 0;
    if (dailyGrowth > 0.005) improving++;
    else if (dailyGrowth < -0.005) declining++;

    const preyGrowth = 0.22 * (1 - r.prey / cap) - 0.9 * r.pred * clamp(r.prey / (cap * 0.4 + 1), 0, 1.5);
    if (preyGrowth > 0.01) improving++;
    else if (preyGrowth < -0.01) declining++;

    if (r.pred < 0.25 && r.prey > cap * 0.5) improving++; // predators drifting in
    else if (predRatio > 1.2) declining++;

    if (improving > declining) return 'recovering';
    if (declining > improving) return 'deteriorating';
    return 'stable';
  }
}

// ---------------------------------------------------------------------------
// Regional Diagnosis — a readable summary per region
// ---------------------------------------------------------------------------
export function diagnoseRegion(state, regionIdx, options = {}) {
  const { verbose = false, perspective = 'ranger' } = options;
  const sample = sampleRegion(state, regionIdx);
  if (!sample) return { summary: 'No data for this region.', details: [] };

  const trajectory = computeTrajectory(state, regionIdx);
  sample.trajectory = trajectory;

  const lines = [];
  const eco = sample.ecology;
  const fac = sample.faction;
  const fire = sample.fire;
  const dem = sample.demand;

  // 1. Regional character (one-line flavour)
  const character = getRegionalCharacter(sample);
  lines.push({ kind: 'character', text: character });

  // 2. Ecology
  if (eco.preyPressure < 0.3) {
    lines.push({ kind: 'ecology', severity: 'bad', text: `Herds are critically thin — ${Math.round(eco.prey)} animals where ${Math.round(eco.cap * 0.5)} would be healthy.` });
  } else if (eco.preyPressure < 0.6) {
    lines.push({ kind: 'ecology', severity: 'warn', text: `Game is scarce. ${Math.round(eco.prey)} herd animals remain.` });
  } else if (eco.preyPressure > 1.3) {
    lines.push({ kind: 'ecology', severity: 'good', text: `Herds are abundant — ${Math.round(eco.prey)} animals grazing.` });
  }

  if (eco.predPressure > 1.0) {
    lines.push({ kind: 'ecology', severity: 'bad', text: `Predators are thick — ${Math.round(eco.pred)} wolves prowl where half that many would be natural.` });
  } else if (eco.predPressure > 0.6) {
    lines.push({ kind: 'ecology', severity: 'warn', text: `Wolf packs are bold. ${Math.round(eco.pred)} counted.` });
  }

  if (eco.trees < 0.4) {
    lines.push({ kind: 'ecology', severity: 'bad', text: `The woods are stripped — only ${Math.round(eco.trees * 100)}% canopy remains.` });
  } else if (eco.trees < 0.7) {
    lines.push({ kind: 'ecology', severity: 'warn', text: `Forest cover is thin at ${Math.round(eco.trees * 100)}%.` });
  } else if (eco.trees > 1.05) {
    lines.push({ kind: 'ecology', severity: 'good', text: `The forest is thick and healthy — ${Math.round(eco.trees * 100)}% cover.` });
  }

  if (eco.grazingPressure > 1.0) {
    lines.push({ kind: 'ecology', severity: 'warn', text: `Overgrazing shows — bare earth where grass should be.` });
  }

  // Fire
  if (fire.burnCells > 20) {
    lines.push({ kind: 'fire', severity: 'bad', text: `Fresh burns blacken ${fire.burnCells} cells. The land is still raw.` });
  } else if (fire.burnCells > 5) {
    lines.push({ kind: 'fire', severity: 'warn', text: `Scorch marks linger on ${fire.burnCells} cells.` });
  } else if (fire.scarred) {
    lines.push({ kind: 'fire', severity: 'info', text: `Old fire scars green over slowly.` });
  }

  // Faction
  if (fac.owner >= 0) {
    const ownerName = FACTIONS[fac.owner].name;
    if (fac.dominance > 0.7) {
      lines.push({ kind: 'faction', severity: 'info', text: `${ownerName} holds this ground firmly.` });
    } else if (fac.dominance > 0.4) {
      lines.push({ kind: 'faction', severity: 'warn', text: `${ownerName} claims this valley but rivals press close.` });
    } else {
      lines.push({ kind: 'faction', severity: 'warn', text: `Control is fragile. ${ownerName} banners fly but rivals press close.` });
    }
  } else {
    lines.push({ kind: 'faction', severity: 'info', text: `No faction holds sway here — wild ground.` });
  }

  if (fac.heat > 0.5) {
    lines.push({ kind: 'faction', severity: 'bad', text: `Recent violence hangs in the air. Raids are likely.` });
  }

  // Settlement influence
  if (sample.settlement) {
    const s = sample.settlement;
    if (s.prosperity > 0.7) {
      lines.push({ kind: 'settlement', severity: 'good', text: `${s.name} thrives nearby (${Math.round(s.population)} souls). Its demand for wood and game is steady.` });
    } else if (s.prosperity > 0.4) {
      lines.push({ kind: 'settlement', severity: 'info', text: `${s.name} endures (${Math.round(s.population)} souls). It draws ${dem.wood.toFixed(1)} wood and ${dem.food.toFixed(1)} food from these lands.` });
    } else {
      lines.push({ kind: 'settlement', severity: 'bad', text: `${s.name} struggles (${Math.round(s.population)} souls). It cannot protect or manage these woods.` });
    }
  }

  // Trajectory line
  const trajText = {
    recovering: 'Signs point to recovery — cover returning, herds stabilizing.',
    stable: 'Conditions hold steady for now.',
    deteriorating: 'The trend is downward — without intervention, this valley will worsen.',
  }[trajectory];
  lines.push({ kind: 'trajectory', severity: trajectory === 'recovering' ? 'good' : trajectory === 'deteriorating' ? 'bad' : 'info', text: trajText });

  // Verbose: causal explanation
  if (verbose) {
    const chain = state.causalEngine?.explainEffect(
      eco.preyPressure < 0.5 ? CAUSE_TYPES.ECO_STARVATION : CAUSE_TYPES.ECO_RECOVERY,
      regionIdx, state
    );
    if (chain) {
      lines.push({ kind: 'cause', severity: 'info', text: `Why? ${chain.text}` });
    }
  }

  return {
    region: regionIdx,
    center: sample.center,
    settlement: sample.settlement,
    trajectory,
    health: eco.health,
    summary: lines.filter(l => l.severity !== 'info').slice(0, 4).map(l => l.text).join(' '),
    details: lines,
  };
}

// ---------------------------------------------------------------------------
// Regional Overview — all regions at a glance (for world screen)
// ---------------------------------------------------------------------------
export function getRegionalOverview(state) {
  const RR = WORLD.regionRes;
  const overview = [];
  for (let idx = 0; idx < RR * RR; idx++) {
    const sample = sampleRegion(state, idx);
    if (!sample) continue;
    const trajectory = computeTrajectory(state, idx);
    const eco = sample.ecology;

    // Only include regions with some significance
    if (eco.health > 0.7 && sample.faction.dominance < 0.4 && !sample.settlement && !sample.fire.scarred) continue;

    overview.push({
      index: idx,
      center: sample.center,
      name: sample.settlement ? sample.settlement.name : `Region ${idx}`,
      health: eco.health,
      trajectory,
      faction: sample.faction.owner >= 0 ? FACTIONS[sample.faction.owner].name : 'Wild',
      burn: sample.fire.burnCells,
      hasSettlement: !!sample.settlement,
      severity: trajectory === 'deteriorating' ? 'bad' : trajectory === 'recovering' ? 'good' : eco.health < 0.4 ? 'bad' : 'info',
    });
  }
  return overview;
}

// ---------------------------------------------------------------------------
// Regional character — one-line flavour
// ---------------------------------------------------------------------------
function getRegionalCharacter(sample) {
  const eco = sample.ecology;
  const fac = sample.faction;

  if (eco.trees < 0.4 && eco.preyPressure < 0.4) return 'A hollowed-out valley. The woods are gone and the herds with them.';
  if (eco.trees > 1.0 && eco.preyPressure > 1.0) return 'Rich, wild country. Thick forest and fat herds.';
  if (eco.predPressure > 1.0) return 'Wolf country. Predators rule the ridges.';
  if (sample.fire.scarred) return 'Fire-scarred land. Ash in the soil, green returning slowly.';
  if (fac.owner >= 0 && fac.dominance > 0.6) return `Firmly held by the ${FACTIONS[fac.owner].name}. Order, such as it is.`;
  if (fac.heat > 0.5) return 'Contested ground. Blood has been spilled here recently.';
  return 'Quiet country. The land keeps its own counsel.';
}

// Integration with WorldState - attach causal engine
// This will be mixed into WorldState in worldstate.js
export function attachCausalEngine(state) {
  if (!state.causalEngine) state.causalEngine = new CausalEngine();
  if (!state.npcMemory) {
    state.npcMemory = new NPCMemoryManager();
  }
  if (!state.regionalHistory) state._regionalHistory = {};
}