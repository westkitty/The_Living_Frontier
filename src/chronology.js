// THE LONG RECORD — the frontier's deep time.
//
// Everything here is derived, never authored twice: the same seed that raises
// the terrain also decides when the sky fell, when the aqueduct was cut, and
// how many times these five valleys have been settled and lost before the
// player arrived. The record speaks in exactly the vocabulary the living world
// produces — ash, silt, bone, char, iron, greenwood — so that a band left by
// the player's own fires is indistinguishable in kind from one left nine
// centuries ago. That equivalence is the point.
//
// No DOM, no Three.js: this module must stay readable by the headless tests.
import { mulberry32 } from './rng.js';
import { LANDMARKS, SETTLEMENTS, FACTIONS } from './worldgen.js';

export const YEAR_DAYS = 60;              // in-world days per frontier year

// The six named places anchor the chronology. Their order is fixed because
// causality depends on it: the aqueduct is cut, and the halls drown.
const SPINE = [
  {
    at: 0, id: 'crater', landmark: 'crater', kind: 'fall',
    title: 'The Starfall',
    line: 'Something came down in the north-west and did not burn up. The crater it left still will not hold snow.',
    after: 'Everything since is counted from the year it landed. Nobody has agreed on what it was.',
  },
  {
    at: 344, id: 'aqueduct_raised', landmark: 'aqueduct', kind: 'work',
    title: 'The Aqueduct is raised',
    line: 'Water carried on stone legs from the high moor to the low valley, ninety spans of it.',
    after: 'Whoever cut and set those blocks left no name on them. The joints are better than anything built since.',
  },
  {
    at: 519, id: 'cliffhold', landmark: 'cliffhold', kind: 'work',
    title: 'Cliffhold is cut',
    line: 'A settlement carved into the rock face, reachable only from above.',
    after: 'They built where nothing could reach them. Something still did.',
  },
  {
    at: 761, id: 'aqueduct_cut', landmark: 'aqueduct', kind: 'break',
    title: 'The Aqueduct is cut',
    line: 'Three spans dropped in a single night. The tool marks are on the inside of the channel.',
    after: 'It did not fall. It was opened — from within, by someone who knew which stones were load-bearing.',
  },
  {
    at: 761, id: 'drowning', landmark: 'drowned', kind: 'flood',
    title: 'The Drowning',
    line: 'The released water went down the valley in one night and did not leave.',
    after: 'The halls below were not empty when the water reached them. The doors were barred from the outside.',
  },
  {
    at: 803, id: 'deadtree', landmark: 'deadtree', kind: 'death',
    title: 'The Hollow Giant dies',
    line: 'The great tree took forty years to finish dying, its roots standing in the new silt.',
    after: 'It is still standing. Nothing has rotted it. Nothing nests in it.',
  },
  {
    at: 1047, id: 'ashken_raised', landmark: 'fortress', kind: 'work',
    title: 'Fort Ashken is raised',
    line: 'A garrison thrown up on the ridge, facing the drowned valley rather than the border.',
    after: 'They built it to watch the water, not the road. They expected something to come back out.',
  },
  {
    at: 1288, id: 'ashken_fell', landmark: 'fortress', kind: 'fall',
    title: 'Fort Ashken falls',
    line: 'Taken in a winter. The walls were not breached; the gate was opened.',
    after: 'The Ashen Legion holds it again today, and does not discuss the first garrison.',
  },
];

// Fates a tenancy can end in. Each one leaves a signature the living world
// still produces today — which is how the record can be read at all.
const FATES = [
  { kind: 'burn', band: 'ash', verb: 'burned', line: 'fire took the roofs in a dry season' },
  { kind: 'flood', band: 'silt', verb: 'drowned', line: 'the valley took the water back' },
  { kind: 'starve', band: 'bone', verb: 'starved', line: 'the herds thinned and did not return' },
  { kind: 'war', band: 'iron', verb: 'was taken', line: 'a banner changed and the people did not' },
  { kind: 'leave', band: 'greenwood', verb: 'was abandoned', line: 'the last of them walked out and the forest closed over it' },
];

export function bandOf(kind) {
  const f = FATES.find(x => x.kind === kind);
  return f ? f.band : 'greenwood';
}

export const BAND_INK = {
  ash: '#4a4038', silt: '#4e5a63', bone: '#8d8674',
  iron: '#6b4a3e', greenwood: '#3f5a3c', char: '#2a2320', living: '#c9a24a',
};

// The year the player's story begins, and the year it is now.
export function arrivalYear(seed) {
  const r = mulberry32((seed ^ 0x51ed2701) >>> 0);
  return 1400 + Math.floor(r() * 120);
}
export function presentYear(state) {
  return arrivalYear(state.seed) + Math.floor((state.day - 1) / YEAR_DAYS);
}

// Every settlement site has been used before. The same five places keep being
// chosen because the water and the soil keep being right there — and each time
// it ends, it ends in one of five ways the frontier still uses today.
export function tenancies(seed) {
  const out = [];
  const r = mulberry32((seed ^ 0x2f9e3b17) >>> 0);
  const end = arrivalYear(seed);
  for (let si = 0; si < SETTLEMENTS.length; si++) {
    const site = SETTLEMENTS[si];
    let year = 90 + Math.floor(r() * 220);
    while (year < end - 40) {
      const span = 30 + Math.floor(r() * 130);
      const fate = FATES[Math.floor(r() * FATES.length)];
      const close = Math.min(year + span, end - 5);
      out.push({
        site: si, name: site.name, start: year, end: close, span: close - year,
        fate: fate.kind, band: fate.band, verb: fate.verb, line: fate.line,
        souls: 20 + Math.floor(r() * 180),
      });
      year = close + 10 + Math.floor(r() * 90);      // the ground rests, then someone tries again
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// The fixed spine, with the caveat that a stone you have never stood in front
// of cannot be read. Discovery is the key to the archive.
export function deepEvents(state) {
  const disc = state.discovered || {};
  return SPINE.map(e => {
    const lm = LANDMARKS.find(l => l.id === e.landmark);
    const found = !!disc[e.landmark];
    return {
      ...e, place: lm ? lm.name : null, x: lm ? lm.x : 0, z: lm ? lm.z : 0,
      sealed: !found,
    };
  });
}

// What the player's own tenancy looks like in the same terms as all the others.
// Read from live state only — nothing here is narrated, it is measured.
export function livingBand(state) {
  const s = state.player.stats;
  const burnt = state.scorchedCells();
  const lost = state.settlements.filter(x => x.abandoned).length;
  const built = state.settlements.reduce((n, x) => n + Math.max(0, x.buildings - 4), 0);
  const bannerChanged = (state.journal || []).some(j => j.kind === 'faction');
  let fate = 'leave';
  if (s.fires > 0 && burnt > 200) fate = 'burn';
  else if (s.hunted > 30) fate = 'starve';
  else if (lost > 0) fate = 'starve';
  else if (bannerChanged) fate = 'war';
  return {
    start: arrivalYear(state.seed),
    end: presentYear(state),
    days: state.day,
    fate, band: bandOf(fate),
    felled: s.felled, hunted: s.hunted, fires: s.fires, helped: s.helped,
    planted: s.planted, scorched: burnt, abandoned: lost, built,
    distance: s.distance,
  };
}

// One line of plain language for a tenancy, in the register of a record
// keeper who has written this same sentence hundreds of times.
export function describeTenancy(t) {
  return `${t.name} stood ${t.span} years, perhaps ${t.souls} souls, and ${t.verb}: ${t.line}.`;
}

// How many lives have been laid down on the same ground the player is standing
// on — the number that makes the column stop being an abstraction.
export function weight(seed) {
  const ten = tenancies(seed);
  return {
    tenancies: ten.length,
    years: arrivalYear(seed),
    souls: ten.reduce((n, t) => n + t.souls, 0),
    burned: ten.filter(t => t.fate === 'burn').length,
    drowned: ten.filter(t => t.fate === 'flood').length,
    starved: ten.filter(t => t.fate === 'starve').length,
    taken: ten.filter(t => t.fate === 'war').length,
    walked: ten.filter(t => t.fate === 'leave').length,
  };
}

// The three factions are young. The record is not.
export function factionAge(seed) {
  const r = mulberry32((seed ^ 0x77a15b03) >>> 0);
  const base = arrivalYear(seed);
  return FACTIONS.map((f, i) => ({
    name: f.name, accent: f.accent,
    founded: base - (40 + Math.floor(r() * 150) + i * 20),
  }));
}
