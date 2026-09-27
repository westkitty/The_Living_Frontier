// Small shared UI primitives. Lives on its own so that the panel modules and
// the UI shell can both use them without importing each other in a cycle.
export const $ = (s) => document.querySelector(s);

// Inventory items map onto the inline SVG sprite by name.
export const ITEM_ICONS = {
  wood: 'wood', stone: 'stone', hide: 'hide', herb: 'herb',
  ore: 'ore', berry: 'berry', relic: 'relic', sapling: 'sapling',
};

// One way to draw an icon everywhere: a <use> into the sprite in index.html.
export const icon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
