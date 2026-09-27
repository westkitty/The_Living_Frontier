// Cartography — everything that turns the simulated world into a drawn map.
//
// The map is not a satellite view: it is the map the player has personally
// made. Land you have never seen stays unsurveyed paper; land you have walked
// is inked in, contoured and labelled. Fog is read from WorldState.explored,
// which is persisted, so the map is another thing the world remembers.
import { WORLD, LANDMARKS, FACTIONS, heightAt, moistureAt } from './worldgen.js';
import { clamp, lerp, hash2i } from './rng.js';

const XR = WORLD.exploreRes;

// --- palette (shared by every map surface so they read as one document) -----
export const MAP = {
  paper: '#171b18',
  paperInk: 'rgba(226,208,164,.055)',
  deep: [26, 46, 58],
  shallow: [46, 78, 86],
  shore: [116, 108, 80],
  grass: [104, 124, 74],
  forest: [56, 88, 56],
  dry: [138, 130, 84],
  rock: [116, 110, 98],
  high: [150, 146, 138],
  snow: [226, 230, 236],
  contour: 'rgba(24,30,26,.34)',
  ink: '#e6d9b8',
  inkDim: 'rgba(230,217,184,.45)',
};

function terrainColor(h, m, out) {
  let c;
  if (h < -6) c = MAP.deep;
  else if (h < 0.2) c = MAP.shallow;
  else if (h < 2.2) c = MAP.shore;
  else if (h < 66) {
    const f = clamp((m - 0.28) * 2.1, 0, 1);
    out[0] = lerp(MAP.dry[0], MAP.forest[0], f) * 0.55 + lerp(MAP.grass[0], MAP.forest[0], f) * 0.45;
    out[1] = lerp(MAP.dry[1], MAP.forest[1], f) * 0.55 + lerp(MAP.grass[1], MAP.forest[1], f) * 0.45;
    out[2] = lerp(MAP.dry[2], MAP.forest[2], f) * 0.55 + lerp(MAP.grass[2], MAP.forest[2], f) * 0.45;
    return out;
  }
  else if (h < 112) c = MAP.rock;
  else if (h < 158) c = MAP.high;
  else c = MAP.snow;
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

export class Cartographer {
  constructor(state) {
    this.state = state;
    this.atlas = null;        // whole-world terrain raster
    this.atlasRes = 0;
    this.heights = null;      // height grid behind the atlas (reused for relief)
    this.fog = null;          // explored mask
    this.fogStamp = -1;
    this.overlay = null;      // burn / trail / clearing memory
    this.overlayStamp = -1;
  }

  // ------------------------------------------------------------ world atlas
  // One pass: sample height + moisture, shade from the grid (no extra height
  // lookups), then ink contour lines on top.
  buildAtlas(res = 288, makeCanvas) {
    const t0 = Date.now();
    const c = makeCanvas(res, res);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(res, res);
    const d = img.data;
    const H = new Float32Array(res * res);
    const M = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      const z = (j / res) * WORLD.size - WORLD.half;
      for (let i = 0; i < res; i++) {
        const x = (i / res) * WORLD.size - WORLD.half;
        const h = heightAt(x, z);
        H[j * res + i] = h;
        M[j * res + i] = h > 0 ? moistureAt(x, z) : 0;
      }
    }
    const rgb = [0, 0, 0];
    const step = WORLD.size / res;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const h = H[k];
        terrainColor(h, M[k], rgb);
        // relief shading from a north-west light
        const hl = H[j * res + Math.max(0, i - 1)];
        const hu = H[Math.max(0, j - 1) * res + i];
        const dx = (h - hl) / step, dz = (h - hu) / step;
        let shade = clamp(1 + (dx + dz) * 4.2, 0.55, 1.5);
        if (h < 0.2) shade = 1 + Math.sin(i * 0.6 + j * 0.4) * 0.03;   // calm water
        // subtle paper grain keeps large flat areas from reading as plastic
        const grain = ((hash2i(i, j) & 255) / 255 - 0.5) * 0.055;
        const o = k * 4;
        d[o] = clamp(rgb[0] * (shade + grain), 0, 255);
        d[o + 1] = clamp(rgb[1] * (shade + grain), 0, 255);
        d[o + 2] = clamp(rgb[2] * (shade + grain), 0, 255);
        d[o + 3] = 255;
      }
    }
    // contour lines every 30 m of elevation — drawn into the pixels directly
    const IV = 30;
    for (let j = 1; j < res; j++) {
      for (let i = 1; i < res; i++) {
        const k = j * res + i, h = H[k];
        if (h < 1) continue;
        const a = Math.floor(h / IV);
        if (Math.floor(H[k - 1] / IV) !== a || Math.floor(H[k - res] / IV) !== a) {
          const o = k * 4;
          const major = a % 3 === 0 ? 0.42 : 0.2;
          d[o] *= 1 - major; d[o + 1] *= 1 - major; d[o + 2] *= 1 - major;
        }
      }
    }
    // shoreline ink
    for (let j = 1; j < res - 1; j++) {
      for (let i = 1; i < res - 1; i++) {
        const k = j * res + i;
        const w = H[k] < 0.2;
        if (w !== (H[k - 1] < 0.2) || w !== (H[k - res] < 0.2)) {
          const o = k * 4;
          d[o] = d[o] * 0.45 + 18; d[o + 1] = d[o + 1] * 0.45 + 26; d[o + 2] = d[o + 2] * 0.45 + 28;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.atlas = c; this.atlasRes = res; this.heights = H;
    this.atlasMs = Date.now() - t0;
    return c;
  }

  // ------------------------------------------------------- local detail tile
  // The world atlas is ~8 m per pixel, which is fine for the wall map but mush
  // at minimap range. This renders a high-detail tile around the player a few
  // rows at a time, so the close-in map is sharp without ever costing a frame.
  updateLocal(cx, cz, makeCanvas, rowBudget = 14) {
    const N = 160, SPAN = 440;
    if (!this.local) {
      this.local = makeCanvas(N, N);
      this.localCtx = this.local.getContext('2d');
      this.localImg = this.localCtx.createImageData(N, N);
      this.localRow = N; this.lcx = 1e9; this.lcz = 1e9;
      this.pcx = cx; this.pcz = cz; this.localRow = 0;   // first tile
    }
    // recentre once the player leaves the comfortable middle of the *pending*
    // tile (comparing against the finished tile would restart it every call)
    if (this.localRow >= N &&
        (Math.abs(cx - this.pcx) > SPAN * 0.22 || Math.abs(cz - this.pcz) > SPAN * 0.22)) {
      this.pcx = cx; this.pcz = cz; this.localRow = 0;
    }
    if (this.localRow >= N) return this.local;
    const d = this.localImg.data, rgb = [0, 0, 0];
    const step = SPAN / N;
    const x0 = this.pcx - SPAN / 2, z0 = this.pcz - SPAN / 2;
    const end = Math.min(N, this.localRow + rowBudget);
    for (let j = this.localRow; j < end; j++) {
      const z = z0 + j * step;
      for (let i = 0; i < N; i++) {
        const x = x0 + i * step;
        const h = heightAt(x, z);
        terrainColor(h, h > 0 ? moistureAt(x, z) : 0, rgb);
        const dx = (h - heightAt(x - step, z)) / step, dz = (h - heightAt(x, z - step)) / step;
        const shade = h < 0.2 ? 1 : clamp(1 + (dx + dz) * 3.4, 0.5, 1.6);
        const o = (j * N + i) * 4;
        d[o] = clamp(rgb[0] * shade, 0, 255);
        d[o + 1] = clamp(rgb[1] * shade, 0, 255);
        d[o + 2] = clamp(rgb[2] * shade, 0, 255);
        d[o + 3] = 255;
      }
    }
    this.localRow = end;
    if (end >= N) { this.localCtx.putImageData(this.localImg, 0, 0); this.lcx = this.pcx; this.lcz = this.pcz; }
    return this.local;
  }
  localWindow() { return this.lcx > 1e8 ? null : { cx: this.lcx, cz: this.lcz, span: 440, res: 160 }; }

  // --------------------------------------------------------------- fog mask
  // White where the player has been, transparent where they have not.
  fogMask(makeCanvas) {
    const st = this.state;
    if (!this.fog) {
      this.fog = makeCanvas(XR, XR);
      this.fogCtx = this.fog.getContext('2d');
      this.fogImg = this.fogCtx.createImageData(XR, XR);
      for (let i = 0; i < XR * XR; i++) {
        this.fogImg.data[i * 4] = 255; this.fogImg.data[i * 4 + 1] = 255; this.fogImg.data[i * 4 + 2] = 255;
      }
      this.fogStamp = -1;
    }
    if (st.exploredDirty || this.fogStamp < 0) {
      const d = this.fogImg.data, e = st.explored;
      for (let i = 0; i < XR * XR; i++) d[i * 4 + 3] = e[i];
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      st.exploredDirty = false;
      this.fogStamp = st.elapsed;
    }
    return this.fog;
  }

  // ----------------------------------------------------- ground memory wash
  // Burn scars, worn trails and cleared/built ground, straight from the
  // persistent ground texture.
  groundOverlay(makeCanvas) {
    const R = WORLD.stateRes;
    if (!this.overlay) {
      this.overlay = makeCanvas(R, R);
      this.overlayCtx = this.overlay.getContext('2d');
      this.overlayImg = this.overlayCtx.createImageData(R, R);
      this.overlayStamp = -1;
    }
    const st = this.state;
    if (this.overlayStamp === st.groundStamp) return this.overlay;
    this.overlayStamp = st.groundStamp;
    const g = st.ground, d = this.overlayImg.data;
    for (let i = 0; i < R * R; i++) {
      const burn = g[i * 4], trail = g[i * 4 + 1], dev = g[i * 4 + 3];
      const a = Math.max(burn * 0.9, Math.max(trail * 0.7, dev * 0.55));
      const o = i * 4;
      if (a < 6) { d[o + 3] = 0; continue; }
      if (burn >= trail && burn >= dev) { d[o] = 34; d[o + 1] = 27; d[o + 2] = 24; }
      else if (trail >= dev) { d[o] = 134; d[o + 1] = 108; d[o + 2] = 72; }
      else { d[o] = 168; d[o + 1] = 148; d[o + 2] = 100; }
      d[o + 3] = a;
    }
    this.overlayCtx.putImageData(this.overlayImg, 0, 0);
    return this.overlay;
  }

  // ------------------------------------------------------------ composition
  // Draws the surveyed world into ctx for an arbitrary window, with fog.
  // win = { cx, cz, span } in world units; the target is (0,0,w,h).
  drawSurvey(ctx, w, h, win, makeCanvas, opts = {}) {
    const { cx, cz, span } = win;
    const spanY = span * (h / w);            // keep world units square on screen
    const u0 = (cx - span / 2 + WORLD.half) / WORLD.size;
    const v0 = (cz - spanY / 2 + WORLD.half) / WORLD.size;
    const uw = span / WORLD.size;
    const vh = spanY / WORLD.size;

    // 1. unsurveyed paper
    ctx.fillStyle = MAP.paper;
    ctx.fillRect(0, 0, w, h);
    if (opts.paperGrid !== false) {
      ctx.strokeStyle = MAP.paperInk;
      ctx.lineWidth = 1;
      const gm = span > 1400 ? 400 : span > 600 ? 200 : 100;   // grid in metres
      const gStep = (gm / span) * w;
      const x0 = (((-(cx - span / 2) % gm) + gm) % gm / span) * w;
      const y0 = (((-(cz - spanY / 2) % gm) + gm) % gm / spanY) * h;
      for (let x = x0; x < w; x += gStep) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = y0; y < h; y += gStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }

    // 2. surveyed land, masked by the fog of war, composed off-screen
    const layer = this._layer(w, h, makeCanvas);
    const lc = layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, w, h);
    lc.imageSmoothingEnabled = true;
    const A = this.atlasRes;
    lc.drawImage(this.atlas, u0 * A, v0 * A, uw * A, vh * A, 0, 0, w, h);
    // sharper local survey where we have it
    const L = this.localWindow();
    if (L && opts.detail !== false) {
      const fits = Math.abs(cx - L.cx) + span / 2 <= L.span / 2 && Math.abs(cz - L.cz) + spanY / 2 <= L.span / 2;
      if (fits) {
        const lu = (cx - span / 2 - (L.cx - L.span / 2)) / L.span * L.res;
        const lv = (cz - spanY / 2 - (L.cz - L.span / 2)) / L.span * L.res;
        lc.drawImage(this.local, lu, lv, (span / L.span) * L.res, (spanY / L.span) * L.res, 0, 0, w, h);
      }
    }
    const R = WORLD.stateRes;
    lc.drawImage(this.groundOverlay(makeCanvas), u0 * R, v0 * R, uw * R, vh * R, 0, 0, w, h);
    if (opts.territory !== false) this._territory(lc, w, h, win);
    // punch out everything the player has not surveyed
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(this.fogMask(makeCanvas), u0 * XR, v0 * XR, uw * XR, vh * XR, 0, 0, w, h);
    lc.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer, 0, 0);
  }

  _layer(w, h, makeCanvas) {
    if (!this._lay || this._lay.width !== w || this._lay.height !== h) this._lay = makeCanvas(w, h);
    return this._lay;
  }

  // Faction holdings: a light tint plus an inked border where ownership
  // changes, so borders read as borders instead of as a grid of squares.
  _territory(ctx, w, h, win) {
    const st = this.state, RR = WORLD.regionRes;
    const cell = WORLD.size / RR;
    const spanY = win.span * (h / w);
    const toX = (wx) => ((wx - win.cx) / win.span + 0.5) * w;
    const toY = (wz) => ((wz - win.cz) / spanY + 0.5) * h;
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let j = 0; j < RR; j++) {
      for (let i = 0; i < RR; i++) {
        const r = st.regions[j * RR + i];
        if (!r || r.owner < 0) continue;
        const x = toX(i * cell - WORLD.half), y = toY(j * cell - WORLD.half);
        const x2 = toX((i + 1) * cell - WORLD.half), y2 = toY((j + 1) * cell - WORLD.half);
        ctx.fillStyle = FACTIONS[r.owner].accent;
        ctx.fillRect(x, y, x2 - x + 0.6, y2 - y + 0.6);
      }
    }
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = Math.max(1.5, w / 260);
    ctx.setLineDash([Math.max(3, w / 90), Math.max(3, w / 120)]);
    for (let j = 0; j < RR; j++) {
      for (let i = 0; i < RR; i++) {
        const o = st.regions[j * RR + i].owner;
        if (o < 0) continue;
        const x = toX(i * cell - WORLD.half), y = toY(j * cell - WORLD.half);
        const x2 = toX((i + 1) * cell - WORLD.half), y2 = toY((j + 1) * cell - WORLD.half);
        ctx.strokeStyle = FACTIONS[o].accent;
        const right = i + 1 < RR ? st.regions[j * RR + i + 1].owner : -1;
        const down = j + 1 < RR ? st.regions[(j + 1) * RR + i].owner : -1;
        if (right !== o) { ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2, y2); ctx.stroke(); }
        if (down !== o) { ctx.beginPath(); ctx.moveTo(x, y2); ctx.lineTo(x2, y2); ctx.stroke(); }
        if (i === 0 || st.regions[j * RR + i - 1].owner !== o) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y2); ctx.stroke(); }
        if (j === 0 || st.regions[(j - 1) * RR + i].owner !== o) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y); ctx.stroke(); }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // --------------------------------------------------------------- markers
  label(ctx, text, x, y, color = MAP.ink, size = 11) {
    ctx.font = `${size}px 'Iowan Old Style',Palatino,Georgia,serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8,10,9,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // A settlement drawn as its own state: size = prosperity, ring = walls,
  // hollow = abandoned, colour = the banner that currently flies over it.
  settlementGlyph(ctx, s, x, y, scale = 1) {
    const r = (3.2 + s.prosperity * 5.2) * scale;
    const accent = s.abandoned ? '#7d7469' : FACTIONS[s.banner].accent;
    ctx.save();
    ctx.translate(x, y);
    if (s.walls > 0 && !s.abandoned) {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.55 + s.walls * 0.15; ctx.lineWidth = 1.4 * scale;
      ctx.beginPath(); ctx.arc(0, 0, r + 3.4 * scale, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    if (s.abandoned) {
      ctx.strokeStyle = accent; ctx.lineWidth = 1.6 * scale;
      ctx.moveTo(-r, r); ctx.lineTo(0, -r * 0.6); ctx.lineTo(r, r);
      ctx.stroke();
    } else {
      ctx.fillStyle = accent;
      ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(8,10,9,.7)'; ctx.lineWidth = 1.2 * scale; ctx.stroke();
      if (s.smoke > 0.02) {   // hearth smoke = the village is alive right now
        ctx.strokeStyle = 'rgba(240,232,210,.5)'; ctx.lineWidth = 1 * scale;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.8, -r * 2, 0, -r * 2.8); ctx.stroke();
      }
    }
    ctx.restore();
  }

  landmarkGlyph(ctx, L, x, y, known, scale = 1) {
    const r = 5 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.86, r * 0.6); ctx.lineTo(-r * 0.86, r * 0.6); ctx.closePath();
    if (known) {
      ctx.fillStyle = '#e0b661'; ctx.fill();
      ctx.strokeStyle = 'rgba(8,10,9,.7)'; ctx.lineWidth = 1 * scale; ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(224,182,97,.5)'; ctx.lineWidth = 1.2 * scale;
      ctx.setLineDash([2.5 * scale, 2.5 * scale]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  playerGlyph(ctx, x, y, yaw, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-yaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -8 * scale); ctx.lineTo(5.4 * scale, 6.5 * scale);
    ctx.lineTo(0, 3.2 * scale); ctx.lineTo(-5.4 * scale, 6.5 * scale);
    ctx.closePath();
    ctx.fillStyle = '#ffeec4';
    ctx.strokeStyle = 'rgba(8,10,9,.8)'; ctx.lineWidth = 1.2 * scale;
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Scale bar in real metres — makes the world legible as a place.
  scaleBar(ctx, w, h, span, pad = 12) {
    const targetPx = Math.min(120, w * 0.3);
    const metres = [50, 100, 200, 400, 800, 1600].reduce((best, m) =>
      Math.abs((m / span) * w - targetPx) < Math.abs((best / span) * w - targetPx) ? m : best, 100);
    const px = (metres / span) * w;
    const x = pad, y = h - pad;
    ctx.save();
    ctx.strokeStyle = 'rgba(8,10,9,.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.stroke();
    ctx.strokeStyle = MAP.ink; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.font = "10px 'Iowan Old Style',Palatino,Georgia,serif";
    ctx.textAlign = 'left';
    ctx.fillStyle = MAP.ink;
    ctx.strokeStyle = 'rgba(8,10,9,.85)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(metres + ' m', x, y - 7);
    ctx.fillText(metres + ' m', x, y - 7);
    ctx.restore();
  }
}

export { XR as EXPLORE_RES };
