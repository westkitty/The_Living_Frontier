// Water field preview — writes the bytes the water shader actually samples.
//
// This is the real output of buildWaterField(), not a picture of the rendered
// game: there is no GPU in this environment, so nothing here validates the
// GLSL (npm run shaders does that). What it does show is the shoreline mask and
// depth ramp the surface is built from, which is where a hard shore seam would
// come from if one existed.
//
//   node tools/water-field-preview.mjs [out.png]
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { buildWaterField, FIELD_RES, FIELD_MAX_DEPTH } from '../src/water-field.js';
import { WORLD, heightAt } from '../src/worldgen.js';

const out = process.argv[2] || 'water-field-preview.png';
const bytes = buildWaterField(FIELD_RES);
const S = 2;                       // px per field cell
const GAP = 10, LABEL = 18;
const panels = ['depth', 'shore factor', 'flow magnitude', 'heightfield'];
const W = FIELD_RES * S * panels.length + GAP * (panels.length + 1);
const H = FIELD_RES * S + GAP + LABEL;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H);
ctx.font = '13px monospace'; ctx.fillStyle = '#c9d1d9';

panels.forEach((name, pi) => {
  const img = ctx.createImageData(FIELD_RES, FIELD_RES);
  const d = img.data;
  for (let j = 0; j < FIELD_RES; j++) {
    for (let i = 0; i < FIELD_RES; i++) {
      const o = (j * FIELD_RES + i) * 4;
      const depth = bytes[o] / 255;                 // 0 dry .. 1 = FIELD_MAX_DEPTH
      const shore = bytes[o + 1] / 255;             // 1 dry land .. 0 open water
      const fx = (bytes[o + 2] - 128) / 127, fz = (bytes[o + 3] - 128) / 127;
      const flow = Math.min(1, Math.hypot(fx, fz));
      let r, g, b;
      if (pi === 0) { const v = depth * 255; r = v * 0.25; g = v * 0.6; b = v; }
      else if (pi === 1) { const v = shore * 255; r = v * 0.55; g = v; b = v * 0.5; }
      else if (pi === 2) { const v = flow * 255; r = v; g = v * 0.75; b = v * 0.35; }
      else {
        // the heightfield the field was derived from, for comparison
        const x = -WORLD.half + ((i + 0.5) / FIELD_RES) * WORLD.size;
        const z = -WORLD.half + ((j + 0.5) / FIELD_RES) * WORLD.size;
        const h = Math.max(0, Math.min(1, (heightAt(x, z) + 12) / 90)) * 255;
        r = h * 0.85; g = h * 0.9; b = h * 0.7;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  const off = createCanvas(FIELD_RES, FIELD_RES);
  off.getContext('2d').putImageData(img, 0, 0);
  const x0 = GAP + pi * (FIELD_RES * S + GAP);
  ctx.drawImage(off, x0, LABEL, FIELD_RES * S, FIELD_RES * S);
  ctx.fillStyle = '#c9d1d9';
  ctx.fillText(name, x0, LABEL - 5);
});

writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`wrote ${out} — ${FIELD_RES}x${FIELD_RES} field, ${panels.length} panels (${W}x${H})`);
console.log(`depth channel saturates at ${FIELD_MAX_DEPTH} m; shore 255 = dry land, 0 = open water`);
