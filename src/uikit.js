// Small shared UI primitives. Lives on its own so that the panel modules and
// the UI shell can both use them without importing each other in a cycle.
export const $ = (s) => document.querySelector(s);

// Inventory items map onto the inline SVG sprite by name.
export const ITEM_ICONS = {
  wood: 'wood', stone: 'stone', hide: 'hide', herb: 'herb',
  ore: 'ore', berry: 'berry', relic: 'relic', sapling: 'sapling',
};

// Each faction has a crest in the same line-art family as the rest of the
// sprite: the Pact a warded shield with a sprig, the Legion an iron shield and
// spear, the Kin two standing stones under a moon. Colour alone never carries
// the meaning — every crest ships with the faction's name for assistive tech.
export const FACTION_CRESTS = ['crest-pact', 'crest-legion', 'crest-kin'];

export function crest(i, name, accent, label) {
  const sym = FACTION_CRESTS[i] || FACTION_CRESTS[0];
  return `<svg class="crest" style="color:${accent}" aria-hidden="true"><use href="#i-${sym}"/></svg>`
    + `<span class="sr-only">${label || name}</span>`;
}

// One way to draw an icon everywhere: a <use> into the sprite in index.html.
export const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
