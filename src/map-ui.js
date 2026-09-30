// Survey drawing and gestures, mixed onto UI.prototype.
import { WORLD, LANDMARKS, FACTIONS } from './worldgen.js';
import { clamp } from './rng.js';
import { Settings } from './settings.js';
import { $ } from './uikit.js';
import { fitCanvas, PAPER, typeface } from './surface.js';

export const MapMixin = {
  // --------------------------------------------------------- map interaction
  bindMap() {
    const c = $('#bigmap');
    if (!c) return;
    const view = () => this.mapView;
    const rect = () => c.getBoundingClientRect();
    const toWorld = (clientX, clientY) => {
      const r = rect();
      const v = view();
      const spanY = v.span * (r.height / r.width);
      return {
        x: v.cx + ((clientX - r.left) / r.width - 0.5) * v.span,
        z: v.cz + ((clientY - r.top) / r.height - 0.5) * spanY,
      };
    };
    const zoomAt = (factor, clientX, clientY) => {
      const v = view();
      const before = toWorld(clientX, clientY);
      v.span = clamp(v.span * factor, 260, WORLD.size * 1.05);
      const after = toWorld(clientX, clientY);
      v.cx += before.x - after.x; v.cz += before.z - after.z;
      this.drawBigMap();
    };

    const pointers = new Map();
    let moved = 0, lastPinch = 0;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; lastPinch = 0;
      c.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      const p0 = pointers.get(e.pointerId);
      if (!p0) return;
      const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
      p0.x = e.clientX; p0.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      const r = rect();
      const v = view();
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastPinch) {
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          zoomAt(clamp(lastPinch / dist, 0.5, 2), mid.x, mid.y);
        }
        lastPinch = dist;
        return;
      }
      v.cx -= (dx / r.width) * v.span;
      v.cz -= (dy / r.height) * v.span * (r.height / r.width);
      this.drawBigMap();
    });
    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        c.classList.remove('grabbing');
        if (moved < 8) this.tapMap(toWorld(e.clientX, e.clientY));
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.deltaY > 0 ? 1.22 : 0.82, e.clientX, e.clientY);
    }, { passive: false });
    c.addEventListener('keydown', (e) => {
      const v = view(), step = v.span * 0.12;
      const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (k) { v.cx += k[0]; v.cz += k[1]; this.drawBigMap(); e.preventDefault(); return; }
      if (e.key === '+' || e.key === '=') { v.span = clamp(v.span * 0.8, 260, WORLD.size * 1.05); this.drawBigMap(); e.preventDefault(); }
      if (e.key === '-' || e.key === '_') { v.span = clamp(v.span * 1.25, 260, WORLD.size * 1.05); this.drawBigMap(); e.preventDefault(); }
      if (e.key === 'Enter') { this.tapMap({ x: view().cx, z: view().cz }); e.preventDefault(); }
    });
    const btn = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    const centre = () => { const r = rect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    btn('#map-in', () => { const m = centre(); zoomAt(0.72, m.x, m.y); });
    btn('#map-out', () => { const m = centre(); zoomAt(1.38, m.x, m.y); });
    btn('#map-me', () => {
      const p = this.world.player.pos;
      this.mapView.cx = p.x; this.mapView.cz = p.z;
      this.mapView.span = Math.min(this.mapView.span, 900);
      this.drawBigMap();
    });
    btn('#map-all', () => {
      this.mapView.cx = 0; this.mapView.cz = 0; this.mapView.span = WORLD.size;
      this.drawBigMap();
    });
  },

  // Eat the most sensible thing in the bag without opening it. Reaching for
  // food in a fight should not cost three taps.
  // Tapping the map plants (or lifts) a waypoint: the one piece of navigation
  // the player authors themselves.
  tapMap(w) {
    const cur = this.waypoint;
    if (cur && Math.hypot(cur.x - w.x, cur.z - w.z) < this.mapView.span * 0.035) {
      this.waypoint = null;
      this.toast('Waypoint lifted');
    } else {
      const name = this.nearestPlaceName(w.x, w.z);
      this.waypoint = { x: Math.round(w.x), z: Math.round(w.z), name };
      this.toast(name ? `Waypoint set · ${name}` : 'Waypoint set', 'good');
    }
    this.world.audio.play('ui');
    this.drawBigMap();
  },
  nearestPlaceName(x, z) {
    let best = null, bd = 150;
    for (const s of this.state.settlements) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s.name; }
    }
    for (const L of LANDMARKS) {
      if (!this.state.discovered[L.id]) continue;
      const d = Math.hypot(L.x - x, L.z - z);
      if (d < bd) { bd = d; best = L.name; }
    }
    return best;
  },

  // ------------------------------------------------------------ the survey
  // The atlas is built once; everything else composes on top of it.
  buildBaseMap(res = 288) {
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.carto.buildAtlas(res, mk);
    this.baseMap = this.carto.atlas;
    this.baseRes = res;
    return this.baseMap;
  },
  _mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },

  // Sizes a canvas to its CSS box at device resolution — maps stay crisp on
  // phones instead of being upscaled 3x.
  fitCanvas(el, fallbackW, fallbackH) {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    const cw = el.clientWidth || fallbackW, ch = el.clientHeight || fallbackH;
    const w = Math.max(32, Math.round(cw * dpr)), h = Math.max(32, Math.round(ch * dpr));
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    return { w, h, dpr, cw, ch };
  },

  // ---------------------------------------------------------------- minimap
  drawMinimap(player) {
    const c = $('#minimap');
    const { w: W, h: H, dpr } = fitCanvas(c, 150, 150);
    const ctx = c.getContext('2d');
    const span = this.minimapSpan || 320;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - dpr, 0, 6.283); ctx.clip();

    const win = { cx: player.pos.x, cz: player.pos.z, span };
    this.carto.updateLocal(player.pos.x, player.pos.z, (w, h) => this._mk(w, h));
    if (this.carto.atlas) this.carto.drawSurvey(ctx, W, H, win, (w, h) => this._mk(w, h), { paperGrid: false });
    else { ctx.fillStyle = PAPER.ground; ctx.fillRect(0, 0, W, H); }

    const toXY = (x, z) => [((x - player.pos.x) / span + 0.5) * W, ((z - player.pos.z) / span + 0.5) * H];
    const st = this.state;
    const s = dpr;

    for (const set of st.settlements) {
      if (st.exploredAt(set.x, set.z) < 0.2) continue;
      const [x, y] = toXY(set.x, set.z);
      this.carto.settlementGlyph(ctx, set, x, y, 0.75 * s);
    }
    for (const L of LANDMARKS) {
      if (!st.discovered[L.id] && st.exploredAt(L.x, L.z) < 0.2) continue;
      const [x, y] = toXY(L.x, L.z);
      this.carto.landmarkGlyph(ctx, L, x, y, !!st.discovered[L.id], 0.8 * s);
    }
    for (const f of st.burningList) {
      const [x, y] = toXY(f.x, f.z);
      const pulse = 2.6 + Math.sin(st.elapsed * 6 + f.x) * 0.8;
      ctx.fillStyle = '#ff8c3a'; ctx.beginPath(); ctx.arc(x, y, pulse * s, 0, 6.283); ctx.fill();
    }
    for (const a of this.world.actors.animals) {
      if (!a.alive) continue;
      const [x, y] = toXY(a.pos.x, a.pos.z);
      ctx.fillStyle = a.def.pred ? '#ef6a54' : '#9ec98a';
      ctx.fillRect(x - 1.2 * s, y - 1.2 * s, 2.4 * s, 2.4 * s);
    }
    for (const a of this.world.actors.soldiers) {
      if (!a.alive) continue;
      const [x, y] = toXY(a.pos.x, a.pos.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = FACTIONS[a.faction].accent;
      this.carto.factionPath(ctx, a.faction, 2 * s);   // shape, not just colour
      ctx.fill();
      ctx.restore();
    }
    for (const q of st.quests) {
      if (q.done) continue;
      const [x, y] = toXY(q.x, q.z);
      ctx.strokeStyle = '#f2d698'; ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.arc(clamp(x, 7 * s, W - 7 * s), clamp(y, 7 * s, H - 7 * s), 5 * s, 0, 6.283); ctx.stroke();
    }
    if (this.waypoint) {
      const [x, y] = toXY(this.waypoint.x, this.waypoint.z);
      this.drawWaypointPin(ctx, clamp(x, 7 * s, W - 7 * s), clamp(y, 7 * s, H - 7 * s), s);
    }
    this.carto.playerGlyph(ctx, W / 2, H / 2, player.yaw, 0.85 * s);
    ctx.restore();

    ctx.strokeStyle = 'rgba(226,208,164,.3)'; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - dpr, 0, 6.283); ctx.stroke();
    const na = -player.camYaw + Math.PI;
    ctx.fillStyle = '#e0b661';
    ctx.font = typeface(9 * s);
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2 + Math.sin(na) * (W / 2 - 10 * s), H / 2 - Math.cos(na) * (H / 2 - 10 * s) + 3 * s);
  },

  drawWaypointPin(ctx, x, y, s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#f2d698'; ctx.lineWidth = 1.6 * s;
    ctx.beginPath(); ctx.arc(0, 0, 5 * s, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -8.5 * s); ctx.lineTo(0, -2.5 * s);
    ctx.moveTo(0, 2.5 * s); ctx.lineTo(0, 8.5 * s);
    ctx.moveTo(-8.5 * s, 0); ctx.lineTo(-2.5 * s, 0);
    ctx.moveTo(2.5 * s, 0); ctx.lineTo(8.5 * s, 0);
    ctx.stroke();
    ctx.restore();
  },

  // --------------------------------------------------------------- big map
  mapWindow() {
    const v = this.mapView;
    return { cx: v.cx, cz: v.cz, span: v.span };
  },
  // The survey map is a picture; this says out loud what the picture shows —
  // where the view sits, how much of it you have actually surveyed, what is
  // inside the frame, and which way your waypoint lies.
  describeMapView() {
    const st = this.state, p = this.world.player;
    const v = this.mapWindow();
    const half = v.span / 2;
    const inView = [];
    for (const s of st.settlements) {
      if (Math.abs(s.x - v.cx) > half || Math.abs(s.z - v.cz) > half) continue;
      if (st.exploredAt(s.x, s.z) < 0.25) continue;         // still unsurveyed: not on this map
      inView.push(`${s.name}, ${s.abandoned ? 'abandoned' : s.status}, under ${FACTIONS[s.banner].name}`);
    }
    const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    let wp = '';
    if (this.waypoint) {
      const dx = this.waypoint.x - p.pos.x, dz = this.waypoint.z - p.pos.z;
      const b = this.bearingTo(dx, dz);
      const dir = compass[Math.round(b / (Math.PI / 4)) % 8];
      wp = ` Waypoint ${this.waypoint.name ? `"${this.waypoint.name}" ` : ''}lies ${Math.round(Math.hypot(dx, dz))} metres ${dir}.`;
    }
    return `Survey map. View ${Math.round(v.span)} metres across. `
      + `${Math.round(st.exploredFraction() * 100)} per cent of the frontier surveyed. `
      + (inView.length ? `In view: ${inView.join('; ')}.` : 'No surveyed settlement in view.')
      + wp;
  },

  drawBigMap() {
    const c = $('#bigmap');
    this._saveViewT = (this._saveViewT || 0);
    const { w: W, h: H, dpr } = fitCanvas(c, 512, 512);
    const ctx = c.getContext('2d');
    const st = this.state;
    const p = this.world.player;
    if (!this.mapView) this.mapView = { cx: 0, cz: 0, span: WORLD.size };
    const v = this.mapView;
    v.span = clamp(v.span, 260, WORLD.size * 1.05);
    const lim = WORLD.half + 100;
    v.cx = clamp(v.cx, -lim, lim); v.cz = clamp(v.cz, -lim, lim);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // keep the window square in world units regardless of canvas aspect
    const span = v.span, spanY = span * (H / W);
    const win = { cx: v.cx, cz: v.cz, span };
    const toXY = (x, z) => [((x - v.cx) / span + 0.5) * W, ((z - v.cz) / spanY + 0.5) * H];

    if (this.carto.atlas) this.carto.drawSurvey(ctx, W, H, win, (w, h) => this._mk(w, h));

    const s = dpr * clamp(900 / (W / dpr), 0.8, 1.4);
    // fires
    for (const f of st.burningList) {
      const [x, y] = toXY(f.x, f.z);
      ctx.fillStyle = 'rgba(255,140,58,.9)';
      ctx.beginPath(); ctx.arc(x, y, 3.5 * s, 0, 6.283); ctx.fill();
    }
    // landmarks
    for (const L of LANDMARKS) {
      const seen = st.exploredAt(L.x, L.z) > 0.2;
      if (!st.discovered[L.id] && !seen) continue;
      const [x, y] = toXY(L.x, L.z);
      this.carto.landmarkGlyph(ctx, L, x, y, !!st.discovered[L.id], s);
      if (st.discovered[L.id]) this.carto.label(ctx, L.name, x, y - 9 * s, '#f0ddb0', (span < WORLD.size * 0.95 ? 11 : 10) * s);
    }
    // settlements
    for (const set of st.settlements) {
      if (st.exploredAt(set.x, set.z) < 0.2) continue;
      const [x, y] = toXY(set.x, set.z);
      this.carto.settlementGlyph(ctx, set, x, y, s);
      const r = (3.2 + set.prosperity * 5.2) * s;
      this.carto.label(ctx, set.name + (set.abandoned ? ' (ruined)' : ''), x, y - r - 6 * s, '#efe6d2', 11 * s);
      if (span < 1400) {
        this.carto.label(ctx, `${Math.round(set.population)} souls · ${set.abandoned ? 'abandoned' : set.status}`,
          x, y + r + 13 * s, 'rgba(230,217,184,.6)', 9.5 * s);
      }
    }
    // quests + waypoint
    for (const q of st.quests) {
      if (q.done) continue;
      const [x, y] = toXY(q.x, q.z);
      ctx.strokeStyle = '#f2d698'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(x, y, 9 * s, 0, 6.283); ctx.stroke();
      if (span < 1600) this.carto.label(ctx, q.title, x, y - 13 * s, '#f2d698', 10 * s);
    }
    if (this.waypoint) this.drawWaypointPin(ctx, ...toXY(this.waypoint.x, this.waypoint.z), s * 1.3);

    const [px, py] = toXY(p.pos.x, p.pos.z);
    this.carto.playerGlyph(ctx, px, py, p.yaw, s * 1.15);
    // sight circle: what you can survey from where you stand
    if (this.world.sightRadius && span < 1800) {
      ctx.strokeStyle = 'rgba(242,214,152,.22)';
      ctx.setLineDash([4 * s, 5 * s]); ctx.lineWidth = 1 * s;
      ctx.beginPath(); ctx.arc(px, py, (this.world.sightRadius / span) * W, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
    }

    this.carto.scaleBar(ctx, W, H, span, 14 * s);
    // surveyed fraction — the map as a record of your own travels
    const frac = this._exFrac === undefined || (this._exFracT || 0) < st.elapsed ? (this._exFracT = st.elapsed + 8, this._exFrac = st.exploredFraction()) : this._exFrac;
    ctx.textAlign = 'right';
    ctx.font = typeface(10 * s);
    ctx.fillStyle = 'rgba(230,217,184,.72)';
    ctx.fillText(`${Math.round(frac * 100)}% surveyed`, W - 14 * s, H - 14 * s);

    // remember where the player was looking on the map
    const now = Date.now();
    if (now - this._saveViewT > 1200) {
      this._saveViewT = now;
      Settings.set('mapView', { cx: Math.round(v.cx), cz: Math.round(v.cz), span: Math.round(v.span) });
    }
    c.setAttribute('aria-label', this.describeMapView());
  },

};
