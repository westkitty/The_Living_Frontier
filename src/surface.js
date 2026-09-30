// One answer to two questions every drawn surface in this game has to ask:
// how big is its backing store, and what colour is the paper it is drawn on?
//
// The survey map, the minimap, the chronicle chart and the Long Record are all
// ink on the same valley. They were each carrying their own copy of the sizing
// rule and their own near-black, which is why one of them ended up drawing
// seven-pixel text: a canvas whose backing store nobody matched to its box.
// Sizing and palette live here so they cannot drift apart again.

// The type the whole project is set in, for canvas work as well as CSS.
export const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";

// The paper and ink shared by every drawn surface. Each surface may darken or
// warm these, but they are the same family: a survey sheet, not a dashboard.
export const PAPER = {
  ground: '#171b18',   // the sheet: the colour unsurveyed country is left
  panel: '#12150f',    // inset plots drawn inside a panel
  core: '#0a0d0e',     // the Long Record: the deepest cut of the column
  paperInk: 'rgba(226,208,164,.055)',
  ink: '#e6d9b8',      // primary drawn text
  inkFaint: 'rgba(230,217,184,.45)',
  inkDim: 'rgba(230,217,184,.62)',
  grid: 'rgba(226,208,164,.09)',
  axis: 'rgba(226,208,164,.20)',
  rule: 'rgba(226,208,164,.26)',
  cursor: 'rgba(245,238,220,.6)',
  tick: 'rgba(226,208,164,.45)',
};

// Sizes a canvas to its CSS box at device resolution, so a surface is drawn
// once at the pixel density it will actually be seen at. Every canvas that is
// a reading instrument goes through this; a backing store that is smaller than
// the box it is shown in is what turns real text into an unreadable smear.
export function fitCanvas(el, fallbackW, fallbackH) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
  const cw = el.clientWidth || fallbackW, ch = el.clientHeight || fallbackH;
  const w = Math.max(32, Math.round(cw * dpr)), h = Math.max(32, Math.round(ch * dpr));
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
  return { w, h, dpr, cw, ch, boxW: cw, boxH: ch };
}

// Draws at CSS-pixel coordinates: a 1px line is one physical pixel on any
// display, whatever the backing store happens to be.
export function inkSpace(ctx, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Font shorthand in the project's own type, at CSS-pixel size.
export function typeface(px) { return `${px}px ${SERIF}`; }
