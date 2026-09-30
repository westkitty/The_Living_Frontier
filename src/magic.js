// Magic: a mana pool and twenty-four spells that bite the real simulation —
// fire grids, weather, factions, villages, wildlife, the map and time itself.
// The mana bar, spell line and spellbook are owned here so ui.js stays shut.
import * as THREE from 'three';
import { WORLD, LANDMARKS, FACTIONS, heightAt } from './worldgen.js';
import { clamp } from './rng.js';
import { CH } from './worldstate.js';

export const SPELLS = [
  { id: 'firebolt', name: 'Firebolt', cost: 12, desc: 'Hurls flame where you look: 34 damage and sets the ground alight.' },
  { id: 'frostbolt', name: 'Frostbolt', cost: 14, desc: '20 damage and a heavy 8-second slow on whatever it strikes.' },
  { id: 'sparkburst', name: 'Sparkburst', cost: 24, desc: 'Lightning out to 10 paces: 24 damage to everyone nearby. Fire does not choose.' },
  { id: 'chain', name: 'Chain Lightning', cost: 30, desc: 'Arcs across four bodies for 20 damage each. Needs a first victim in 35 paces.' },
  { id: 'heal', name: 'Heal', cost: 18, desc: 'Knit flesh: restores 45 health.' },
  { id: 'secondwind', name: 'Second Wind', cost: 12, desc: 'Full stamina and 12 health, breathed back in one gasp.' },
  { id: 'stoneskin', name: 'Stoneskin', cost: 20, desc: '20 seconds of granite: damage taken falls two thirds, pace falls one third.' },
  { id: 'haste', name: 'Haste', cost: 16, desc: '12 seconds at nearly half again your speed.' },
  { id: 'featherfall', name: 'Featherfall', cost: 14, desc: '25 seconds of slow air: falls are gentle and landing harm is halved.' },
  { id: 'blink', name: 'Blink', cost: 10, desc: 'Step 14 paces forward through the between-place.' },
  { id: 'recall', name: 'Recall', cost: 22, desc: 'The nearest living village pulls you home to its edge.' },
  { id: 'ignite', name: 'Ignite', cost: 8, desc: 'Set alight the ground where you look, up to 40 paces out. Needs fuel.' },
  { id: 'quench', name: 'Quench', cost: 14, desc: 'Douses every burning cell within 45 paces.' },
  { id: 'stormcall', name: 'Stormcall', cost: 35, desc: 'Calls a true storm for a minute — and lightning smites two nearby hostiles.' },
  { id: 'bloom', name: 'Bloom', cost: 20, desc: 'Harvested growth within 45 paces springs back; planted saplings mature.' },
  { id: 'mend', name: 'Mend Village', cost: 25, desc: 'The nearest village in 60 paces prospers: richer, fuller stores, warmer tales.' },
  { id: 'rebuild', name: 'Rebuild', cost: 40, desc: 'A ruin within 100 paces lives again — roofs, hearths and all.' },
  { id: 'survey', name: 'Survey', cost: 12, desc: 'The land within 150 paces lays itself bare on your map.' },
  { id: 'reveal', name: 'Reveal', cost: 18, desc: 'Unseals the nearest undiscovered landmark, wherever it hides.' },
  { id: 'fear', name: 'Fear', cost: 16, desc: 'Everything wild or soldierly within 30 paces flees you for 6 seconds.' },
  { id: 'charm', name: 'Charm', cost: 14, desc: 'Soothe the nearest mind in 16 paces: soldiers stand down, beasts grow calm.' },
  { id: 'banish', name: 'Banish', cost: 45, desc: 'Unmakes the nearest hostile within 25 paces. Nothing left to bury.' },
  { id: 'wisp', name: 'Wisp Light', cost: 15, desc: 'A light that orbits you for a minute and a half. Night becomes noon.' },
  { id: 'dilation', name: 'Dilation', cost: 30, desc: 'The world slows to a quarter for 6 seconds. You do not.' },
];

export class Magic {
  constructor(player, scene) {
    this.player = player;
    this.world = player.world;
    this.state = player.state;
    this.scene = scene;
    this.camera = null;
    const st = this.state;
    this.selected = Number.isInteger(st.player.spell) && st.player.spell >= 0 && st.player.spell < SPELLS.length ? st.player.spell : 0;
    if (!Number.isFinite(st.player.mana)) st.player.mana = this.maxMana();
    this.stoneUntil = 0; this.hasteUntil = 0; this.featherUntil = 0; this.wispUntil = 0; this.wispAngle = 0;
    this._dir = new THREE.Vector3(); this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._hudAt = 0; this._hudDirty = true; this._lastBuffs = ''; this._bookHinted = false;
    this.bookOpen = false;
    // bolt pool: small bright meshes that fly where you look
    this.bolts = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.bolts.push({ mesh: m, active: false, vel: new THREE.Vector3(), life: 0, kind: '', trail: 0 });
    }
    // beam pool: brief lines for arcs and sky-strikes
    this.beams = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0 }));
      line.visible = false; line.frustumCulled = false; scene.add(line);
      this.beams.push({ line, life: 0 });
    }
    this.wispLight = new THREE.PointLight(0xbfd8ff, 0, 36, 2);
    this.wispSprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.wispSprite.scale.setScalar(1.4); this.wispSprite.visible = false;
    scene.add(this.wispLight, this.wispSprite);
    this.buildDom();
    this.bindKeys();
  }
  maxMana() { return 100 + Object.keys(this.state.discovered).length * 8; }
  get mana() { return this.state.player.mana; }
  set mana(v) { this.state.player.mana = v; }
  speedMul() {
    const e = this.state.elapsed;
    return (e < this.hasteUntil ? 1.45 : 1) * (e < this.stoneUntil ? 0.65 : 1);
  }
  maxFall() { return this.state.elapsed < this.featherUntil ? -3 : -38; }
  // the one gate every harm to the player passes through
  ward(amount, source) {
    const e = this.state.elapsed;
    if (e < this.stoneUntil) { amount *= 0.35; this.burst(this.player.pos, 0x9a9a9a, 4); }
    if (source === 'the fall' && e < this.featherUntil) amount *= 0.5;
    return amount;
  }
  update(dt, input, camera) {
    this.camera = camera;
    const st = this.state;
    this.mana = Math.min(this.maxMana(), this.mana + 7 * dt);
    if (input.castPressed) { input.castPressed = false; this.tryCast(camera); }
    this.updateBolts(dt);
    this.updateBeams(dt);
    this.updateWisp(dt);
    this._hudAt -= dt;
    if (this._hudDirty || this._hudAt <= 0) { this._hudAt = 0.25; this._hudDirty = false; this.refreshHud(); }
  }
  // ------------------------------------------------------------ selection
  select(i) {
    this.selected = clamp(i, 0, SPELLS.length - 1);
    this.state.player.spell = this.selected;
    this._hudDirty = true;
    this.world.audio.play('ui');
    if (this.bookOpen) this.markSelected();
  }
  cycle(d) { this.select((this.selected + d + SPELLS.length) % SPELLS.length); }
  keyLabel(i) { return i < 10 ? String((i + 1) % 10) : i < 20 ? '⇧' + String((i - 9) % 10) : 'Z'; }
  // ---------------------------------------------------------------- casting
  tryCast(camera) {
    const w = this.world, p = this.player;
    if (p.dead || w.ui.blocking) return false;
    const s = SPELLS[this.selected];
    if (this.mana < s.cost) { w.ui.toast(`Need ${s.cost} mana for ${s.name}.`, 'bad'); w.audio.play('ui'); return false; }
    const ok = this.effects[s.id].call(this, camera || this.camera);
    if (ok) {
      this.mana -= s.cost;
      w.state.player.stats.spellsCast = (w.state.player.stats.spellsCast || 0) + 1;
      w.audio.play('cast');
      this._hudDirty = true;
    }
    return ok;
  }
  get effects() {
    return {
      firebolt: (cam) => this.fireBolt(cam, 'fire'),
      frostbolt: (cam) => this.fireBolt(cam, 'frost'),
      sparkburst: () => this.castSparkburst(),
      chain: () => this.castChain(),
      heal: () => this.castHeal(),
      secondwind: () => { this.player.stamina = 100; this.player.heal(12); this.burst(this.player.pos, 0x9fe8a0, 10); this.world.ui.toast('Second wind.'); return true; },
      stoneskin: () => { this.stoneUntil = this.state.elapsed + 20; this.burst(this.player.pos, 0x9a9a9a, 12); this.world.ui.toast('Skin of granite — 20 seconds.'); return true; },
      haste: () => { this.hasteUntil = this.state.elapsed + 12; this.burst(this.player.pos, 0xf0d68c, 12); this.world.ui.toast('Fleet of foot — 12 seconds.'); return true; },
      featherfall: () => { this.featherUntil = this.state.elapsed + 25; this.burst(this.player.pos, 0xd8ecff, 12); this.world.ui.toast('The air will catch you — 25 seconds.'); return true; },
      blink: () => this.castBlink(),
      recall: () => this.castRecall(),
      ignite: (cam) => this.castIgnite(cam),
      quench: () => this.castQuench(),
      stormcall: () => this.castStormcall(),
      bloom: () => this.castBloom(),
      mend: () => this.castMend(),
      rebuild: () => this.castRebuild(),
      survey: () => this.castSurvey(),
      reveal: () => this.castReveal(),
      fear: () => this.castFear(),
      charm: () => this.castCharm(),
      banish: () => this.castBanish(),
      wisp: () => { this.wispUntil = this.state.elapsed + 90; this.world.ui.toast('A wisp attends you.'); return true; },
      dilation: () => { this.world.hitStop = 6; this.burst(this.player.pos, 0xc9a0ff, 16); this.world.audio.play('thunder'); this.world.ui.toast('Time thins.'); return true; },
    };
  }
  // -------------------------------------------------------------- helpers
  aimDir(out) {
    const p = this.player;
    const a = p.firstPerson ? p.camYaw + Math.PI : p.yaw;
    return out.set(Math.sin(a), 0, Math.cos(a));
  }
  lookPoint(cam, maxT) {
    const cp = cam ? cam.position : this.player.pos;
    if (cam) cam.getWorldDirection(this._dir); else this.aimDir(this._dir);
    for (let t = 2; t <= maxT; t += 2) {
      const x = cp.x + this._dir.x * t, y = cp.y + this._dir.y * t, z = cp.z + this._dir.z * t;
      if (y < heightAt(x, z)) return { x, z };
    }
    return { x: cp.x + this._dir.x * maxT, z: cp.z + this._dir.z * maxT };
  }
  liveActors() {
    const A = this.world.actors, out = [];
    for (const a of A.animals) if (a.alive) out.push({ a, list: A.animals, kind: 'animal' });
    for (const a of A.npcs) if (a.alive) out.push({ a, list: A.npcs, kind: 'npc' });
    for (const a of A.soldiers) if (a.alive) out.push({ a, list: A.soldiers, kind: 'soldier' });
    return out;
  }
  nearestActor(x, z, r, filter) {
    let best = null, bd = r * r;
    for (const e of this.liveActors()) {
      if (filter && !filter(e)) continue;
      const d = (e.a.pos.x - x) * (e.a.pos.x - x) + (e.a.pos.z - z) * (e.a.pos.z - z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  isHostile(e) {
    if (e.kind === 'animal') return e.a.kind === 'wolf' || !!e.a.angry;
    if (e.kind === 'soldier') {
      const rep = this.state.player.rep[e.a.faction];
      return rep < -25 || (FACTIONS[e.a.faction].id === 1 && rep < -10);
    }
    return false;
  }
  // harm with the same consequences as the blade: loot, grief, faction memory
  hurt(e, dmg) {
    const w = this.world, a = e.a;
    a.hp -= dmg;
    w.fx.bloodPuff(a.pos);
    if (e.kind === 'animal') {
      if (a.def && a.def.aggressive) a.angry = true;
      if (a.hp <= 0) { w.actors.killAnimal(a, true); w.progressQuests('kill', a.pos, a.kind, a.def && a.def.pred); }
    } else if (e.kind === 'soldier') {
      if (a.hp <= 0) {
        w.actors.killSoldier(a, -1);
        w.state.addRep(a.faction, -12);
        for (const r of [0, 1, 2].filter(f => f !== a.faction)) w.state.addRep(r, 3);
        w.ui.toast(`${FACTIONS[a.faction].name} will remember this.`, 'faction');
        w.progressQuests('kill', a.pos, a.kind, false);
      } else w.state.addRep(a.faction, -3);
    } else {
      const s = a.home;
      a.fleeing = 25;
      for (const n of w.actors.npcs) if (n.home === s && n.pos.distanceTo(a.pos) < 60) n.fleeing = 25;
      if (a.hp <= 0) {
        a.alive = false; a.deadTime = 0; w.actors.markDead(a);
        s.rep = clamp(s.rep - 45, -100, 100);
        s.prosperity = clamp(s.prosperity - 0.06, 0, 1);
        s.population = Math.max(0, s.population - 1);
        w.state.addRep(s.banner, -30);
        w.state.note(`You killed ${a.name} of ${s.name} with magic.`, 'combat');
        w.ui.toast(`${s.name} will not forget this.`, 'faction');
      } else {
        s.rep = clamp(s.rep - 12, -100, 100);
        w.state.addRep(s.banner, -8);
        w.ui.toast('Villagers scatter in fear.');
      }
    }
  }
  burst(pos, color, n) { this.world.fx.emitSpark(pos, color, n || 10, 4, 3); }
  fireBeam(from, to, color) {
    const b = this.beams.find(b => b.life <= 0) || this.beams[0];
    const rp = b.line.geometry.attributes.position;
    rp.setXYZ(0, from.x, from.y, from.z); rp.setXYZ(1, to.x, to.y, to.z); rp.needsUpdate = true;
    b.line.material.color.setHex(color || 0xbfe3ff);
    b.line.visible = true; b.life = 0.3;
  }
  updateBeams(dt) {
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life / 0.3);
      if (b.life <= 0) b.line.visible = false;
    }
  }
  // ----------------------------------------------------------------- bolts
  fireBolt(cam, kind) {
    const p = this.player, b = this.bolts.find(b => !b.active);
    if (!b) return false;
    const from = this._p.set(p.pos.x, p.pos.y + 1.0, p.pos.z);
    const look = this.lookPoint(cam, 60);
    const tx = look.x, ty = heightAt(look.x, look.z) + 1.2, tz = look.z;
    b.vel.set(tx - from.x, ty - from.y, tz - from.z).normalize().multiplyScalar(46);
    b.mesh.position.copy(from);
    b.mesh.material.color.setHex(kind === 'fire' ? 0xff7a30 : 0x9fd8ff);
    b.mesh.visible = true;
    b.active = true; b.life = 1.5; b.kind = kind; b.trail = 0;
    return true;
  }
  updateBolts(dt) {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      const m = b.mesh.position;
      m.addScaledVector(b.vel, dt);
      b.trail -= dt;
      if (b.trail <= 0) { b.trail = 0.05; this.world.fx.emitSpark(m, b.kind === 'fire' ? 0xff8a3a : 0xafe0ff, 2, 1, 0.6); }
      let done = b.life <= 0;
      if (!done && m.y < heightAt(m.x, m.z)) { this.boltImpact(null, m, b.kind); done = true; }
      if (!done) {
        const hit = this.nearestActor(m.x, m.z, 3.0);
        if (hit && Math.abs(hit.a.pos.y - m.y) < 3.5) { this.boltImpact(hit, m, b.kind); done = true; }
      }
      if (done) { b.active = false; b.mesh.visible = false; }
    }
  }
  boltImpact(hit, m, kind) {
    const w = this.world;
    if (hit) {
      if (kind === 'fire') {
        this.hurt(hit, 34);
        w.state.ignite(hit.a.pos.x, hit.a.pos.z, 1);
        w.audio.play('fire');
      } else {
        this.hurt(hit, 20);
        hit.a.slowUntil = this.state.elapsed + 8; hit.a.slowMul = 0.4;
      }
      this.burst(hit.a.pos, kind === 'fire' ? 0xff7a30 : 0xafe0ff, 14);
    } else {
      if (kind === 'fire') w.state.ignite(m.x, m.z, 1);
      this.burst(m, kind === 'fire' ? 0xff7a30 : 0xafe0ff, 8);
    }
    w.audio.play('zap');
  }
  // ---------------------------------------------------------------- effects
  castSparkburst() {
    const w = this.world, p = this.player;
    let n = 0;
    for (const e of this.liveActors()) {
      if (Math.hypot(e.a.pos.x - p.pos.x, e.a.pos.z - p.pos.z) > 10) continue;
      this.hurt(e, 24); n++;
    }
    this.burst(this._v.set(p.pos.x, p.pos.y + 1, p.pos.z), 0xcfe8ff, 18);
    p.addShake(0.5);
    w.hitStop = Math.max(w.hitStop || 0, 0.12);
    w.audio.play('zap');
    if (!n) w.ui.toast('The sparks find no one.');
    return true;
  }
  castChain() {
    const w = this.world, p = this.player;
    const first = this.nearestActor(p.pos.x, p.pos.z, 35);
    if (!first) { w.ui.toast('No victim in reach.'); return false; }
    const hitSet = new Set();
    let from = this._v.set(p.pos.x, p.pos.y + 1.2, p.pos.z).clone(), cur = first;
    for (let h = 0; h < 4 && cur; h++) {
      hitSet.add(cur.a);
      this.fireBeam(from, cur.a.pos, 0xbfe3ff);
      from = cur.a.pos.clone();
      this.hurt(cur, 20);
      let next = null, bd = 20 * 20;
      for (const e of this.liveActors()) {
        if (hitSet.has(e.a)) continue;
        const d = e.a.pos.distanceToSquared(cur.a.pos);
        if (d < bd) { bd = d; next = e; }
      }
      cur = next;
    }
    this.burst(p.pos, 0xbfe3ff, 10);
    w.audio.play('zap');
    return true;
  }
  castHeal() {
    const w = this.world, p = this.player;
    if (p.hp >= p.maxHp) { w.ui.toast('Already whole.'); return false; }
    p.heal(45);
    this.burst(p.pos, 0x7fe08a, 14);
    w.audio.play('heal');
    return true;
  }
  castBlink() {
    const p = this.player, w = this.world;
    this.aimDir(this._dir);
    const nx = clamp(p.pos.x + this._dir.x * 14, -WORLD.half + 8, WORLD.half - 8);
    const nz = clamp(p.pos.z + this._dir.z * 14, -WORLD.half + 8, WORLD.half - 8);
    this.burst(p.pos, 0xc9a0ff, 10);
    p.pos.set(nx, heightAt(nx, nz) + 0.2, nz);
    this.burst(p.pos, 0xc9a0ff, 10);
    w.audio.play('cast');
    return true;
  }
  castRecall() {
    const w = this.world, p = this.player, st = this.state;
    let best = null, bd = 1e9;
    for (const s of st.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) { w.ui.toast('No living village answers.'); return false; }
    this.burst(p.pos, 0xc9a0ff, 12);
    p.pos.set(best.x + 27, heightAt(best.x + 27, best.z + 27) + 0.2, best.z + 27);
    p.vel.set(0, 0, 0);
    this.burst(p.pos, 0xc9a0ff, 12);
    w.ui.toast(`${best.name} pulls you home.`);
    return true;
  }
  castIgnite(cam) {
    const w = this.world, st = this.state;
    const t = this.lookPoint(cam, 40);
    if (st.ignite(t.x, t.z, 1)) {
      w.audio.play('fire');
      st.note('You set a fire in the wilds.', 'world');
      return true;
    }
    w.ui.toast('Nothing here will catch.');
    return false;
  }
  castQuench() {
    const w = this.world, st = this.state, p = this.player;
    let n = 0;
    for (const c of st.burningList) {
      if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) > 45 || st.burning[c.idx] <= 0) continue;
      st.burning[c.idx] = 0; n++;
    }
    if (!n) { w.ui.toast('No fire in reach to douse.'); return false; }
    this.burst(p.pos, 0xd8ecff, 14);
    w.audio.play('splash');
    w.ui.toast(`${n} fire${n === 1 ? '' : 's'} doused.`);
    return true;
  }
  castStormcall() {
    const w = this.world, st = this.state, p = this.player;
    const weather = st.weather;
    weather.type = 'storm'; weather.target = 1; weather.next = Math.max(weather.next, 75);
    const foes = this.liveActors().filter(e => this.isHostile(e) &&
      Math.hypot(e.a.pos.x - p.pos.x, e.a.pos.z - p.pos.z) < 40).slice(0, 2);
    for (const e of foes) {
      this.fireBeam(this._v.set(e.a.pos.x, e.a.pos.y + 40, e.a.pos.z).clone(), e.a.pos, 0xfff2b0);
      this.burst(e.a.pos, 0xfff2b0, 12);
      this.hurt(e, 30);
    }
    w.audio.play('thunder');
    w.ui.toast(foes.length ? 'The sky answers — and strikes.' : 'The sky answers.');
    return true;
  }
  castBloom() {
    const w = this.world, st = this.state, p = this.player;
    const C = WORLD.chunk, keys = new Set();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      keys.add(Math.floor((p.pos.x + i * 45) / C) + ',' + Math.floor((p.pos.z + j * 45) / C));
    }
    let cleared = 0, matured = 0;
    const dirty = new Set(keys);
    for (const key of keys) {
      const m = st.vegRemoved[key];
      if (m) { cleared += Object.keys(m).length; delete st.vegRemoved[key]; }
    }
    for (const s of st.plantings || []) {
      if (Math.hypot(s.x - p.pos.x, s.z - p.pos.z) > 45) continue;
      if (st.elapsed - s.t < 600) { s.t = st.elapsed - 600; matured++; }
      dirty.add(Math.floor(s.x / C) + ',' + Math.floor(s.z / C));
    }
    if (!cleared && !matured) { w.ui.toast('Nothing here needs regrowing.'); return false; }
    st.vegDirty = true;
    st.vegDirtyKeys = st.vegDirtyKeys || new Set();
    for (const key of dirty) st.vegDirtyKeys.add(key);
    st.paintGround(p.pos.x, p.pos.z, CH.LUSH, 0.4, 45);
    this.burst(p.pos, 0x7fe08a, 14);
    w.ui.toast(`The land blooms: ${cleared} regrown, ${matured} matured.`);
    return true;
  }
  castMend() {
    const w = this.world, st = this.state, p = this.player;
    let best = null, bd = 60;
    for (const s of st.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) { w.ui.toast('No village in reach.'); return false; }
    best.prosperity = clamp(best.prosperity + 0.15, 0, 1);
    best.supplies = clamp((best.supplies || 0) + 0.4, 0, 1.4);
    st.addRep(best.banner, 5);
    this.burst(this._v.set(best.x, heightAt(best.x, best.z) + 2, best.z), 0xf0d68c, 14);
    st.note(`${best.name} flourishes by your hand.`, 'settlement');
    w.audio.play('build');
    return true;
  }
  castRebuild() {
    const w = this.world, st = this.state, p = this.player;
    let best = null, bd = 100;
    for (const s of st.settlements) {
      if (!s.abandoned) continue;
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) { w.ui.toast('No ruin in reach.'); return false; }
    best.abandoned = false;
    best.buildings = Math.max(3, best.buildings);
    best.prosperity = 0.35;
    this.burst(this._v.set(best.x, heightAt(best.x, best.z) + 2, best.z), 0xf0d68c, 18);
    st.note(`${best.name} lives again.`, 'settlement');
    w.audio.play('build');
    return true;
  }
  castSurvey() {
    const w = this.world, st = this.state, p = this.player;
    const n = st.markExplored(p.pos.x, p.pos.z, 150);
    if (!n) { w.ui.toast('Already mapped, far as the eye can see.'); return false; }
    w.audio.play('discover');
    w.ui.toast(`The land lays itself bare: ${n} new ground.`);
    return true;
  }
  castReveal() {
    const w = this.world, st = this.state, p = this.player;
    let best = null, bd = 600;
    for (const L of LANDMARKS) {
      if (st.discovered[L.id]) continue;
      const d = Math.hypot(L.x - p.pos.x, L.z - p.pos.z);
      if (d < bd) { bd = d; best = L; }
    }
    if (!best) { w.ui.toast('The Record holds no more secrets near you.'); return false; }
    st.discovered[best.id] = st.day;
    w.ui.discovery(best.name);
    w.audio.play('discover'); w.hitStop = Math.max(w.hitStop || 0, 0.9);
    st.note(`Revealed ${best.name} by magic.`, 'discovery');
    for (let i = 0; i < 3; i++) st.player.rep[i] = clamp(st.player.rep[i] + 2, -100, 100);
    for (const q of st.quests) if (!q.done && q.kind === 'explore' && q.target === best.id) w.completeQuest(q);
    return true;
  }
  castFear() {
    const w = this.world, p = this.player;
    let n = 0;
    for (const e of this.liveActors()) {
      const dx = e.a.pos.x - p.pos.x, dz = e.a.pos.z - p.pos.z;
      if (Math.hypot(dx, dz) > 30) continue;
      if (e.kind === 'animal') {
        e.a.fearUntil = this.state.elapsed + 6; e.a.timer = 6; e.a.aim = null; e.a.angry = false;
        if (e.a.def.pred) e.a.wanderDir = Math.atan2(e.a.pos.x - p.pos.x, e.a.pos.z - p.pos.z);
        n++;
      }
      else if (e.kind === 'npc') { e.a.fleeing = 6; n++; }
      else if (e.a.squad) { e.a.squad.target = [e.a.pos.x + dx * 4, e.a.pos.z + dz * 4]; e.a.timer = 3; n++; }
    }
    if (!n) { w.ui.toast('Nothing here to frighten.'); return false; }
    this.burst(p.pos, 0x8a2a3a, 14);
    w.audio.play('wolfhowl');
    w.ui.toast(`${n} flee${n === 1 ? 's' : ''} in terror.`);
    return true;
  }
  castCharm() {
    const w = this.world, st = this.state, p = this.player;
    const e = this.nearestActor(p.pos.x, p.pos.z, 16);
    if (!e) { w.ui.toast('No mind in reach.'); return false; }
    const a = e.a;
    if (e.kind === 'soldier') {
      st.addRep(a.faction, 20); a.timer = 3;
      w.ui.toast(`The ${FACTIONS[a.faction].name} stands down.`, 'good');
    } else if (e.kind === 'npc') {
      st.addRep(a.home.banner, 10);
      w.ui.toast(`${a.name} smiles on you.`, 'good');
    } else {
      a.calmUntil = this.state.elapsed + 10; a.timer = 4; a.aim = null; a.angry = false;
      w.ui.toast(`The ${a.kind} grows calm.`, 'good');
    }
    this.burst(a.pos, 0xf0b0d8, 12);
    w.audio.play('quest');
    return true;
  }
  castBanish() {
    const w = this.world, p = this.player;
    const e = this.nearestActor(p.pos.x, p.pos.z, 25, (c) => this.isHostile(c));
    if (!e) { w.ui.toast('No hostile mind to banish.'); return false; }
    this.burst(e.a.pos, 0x7a4fd0, 18);
    w.actors.remove(e.a, e.list);
    w.audio.play('zap');
    w.ui.toast('Banished. Nothing left to bury.');
    return true;
  }
  updateWisp(dt) {
    const on = this.state.elapsed < this.wispUntil;
    this.wispLight.intensity = on ? 5 : 0;
    this.wispSprite.visible = on;
    if (!on) return;
    this.wispAngle += dt * 1.2;
    const p = this.player.pos;
    this._v.set(p.x + Math.cos(this.wispAngle) * 3, p.y + 2.6 + Math.sin(this.wispAngle * 2) * 0.4, p.z + Math.sin(this.wispAngle) * 3);
    this.wispLight.position.copy(this._v);
    this.wispSprite.position.copy(this._v);
  }
  // ------------------------------------------------------------- interface
  buildDom() {
    const vitals = document.getElementById('vitals');
    vitals.insertAdjacentHTML('beforeend',
      `<div class="bar mana" role="progressbar" id="mana-bar" aria-label="Mana" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="mana-fill"></i><b id="mana-num">100</b></div>`);
    document.getElementById('hud').insertAdjacentHTML('beforeend',
      `<div id="magic-hud"><div id="spell-line"><span id="spell-key">X</span><span id="spell-name"></span><span id="spell-cost"></span></div><div id="buff-line"></div></div>
      <div id="spellbook" class="hidden" role="dialog" aria-label="Spellbook"><div id="sb-head"><b>Tome of the frontier</b><button id="sb-close" aria-label="Close spellbook">✕</button></div><div id="sb-grid"></div><div id="sb-hint">Keys 1–0 and Shift+1–0 select · Z cycles · X casts · T closes</div></div>`);
    const grid = document.getElementById('sb-grid');
    SPELLS.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'sb-row'; row.dataset.i = i;
      row.innerHTML = `<span class="sb-key">${this.keyLabel(i)}</span><span class="sb-name">${s.name}</span><span class="sb-cost">${s.cost}✦</span><span class="sb-desc">${s.desc}</span>`;
      const cast = document.createElement('button');
      cast.className = 'sb-cast'; cast.textContent = 'Cast'; cast.setAttribute('aria-label', `Cast ${s.name}`);
      cast.addEventListener('click', (ev) => { ev.stopPropagation(); this.select(i); this.tryCast(this.camera); });
      row.appendChild(cast);
      row.addEventListener('click', () => this.select(i));
      grid.appendChild(row);
    });
    document.getElementById('sb-close').addEventListener('click', () => this.toggleBook(false));
    const touch = document.getElementById('touch-right');
    const mk = (id, ic, label, down) => {
      const b = document.createElement('button');
      b.id = id; b.className = 'tbtn'; b.setAttribute('aria-label', label);
      b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${ic}"/></svg>`;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); down(); }, { passive: false });
      b.addEventListener('mousedown', (e) => { e.preventDefault(); down(); });
      touch.appendChild(b);
    };
    mk('tb-cast', 'i-spark', 'Cast spell', () => { this.world.input.castPressed = true; });
    mk('tb-book', 'i-tome', 'Open spellbook', () => this.toggleBook());
    this.markSelected();
  }
  bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.repeat || this.world.ui.blocking) return;
      if (e.code === 'Escape') { if (this.bookOpen) this.toggleBook(false); return; }
      if (/^Digit\d$/.test(e.code)) {
        const d = e.code === 'Digit0' ? 9 : Number(e.code[5]) - 1;
        const i = d + (e.shiftKey ? 10 : 0);
        if (i < SPELLS.length) { this.select(i); e.preventDefault(); }
      } else if (e.code === 'KeyZ') { this.cycle(e.shiftKey ? -1 : 1); }
      else if (e.code === 'KeyT') { this.toggleBook(); }
    });
  }
  toggleBook(force) {
    this.bookOpen = force !== undefined ? force : !this.bookOpen;
    document.getElementById('spellbook').classList.toggle('hidden', !this.bookOpen);
    if (this.bookOpen) {
      this.markSelected();
      if (!this._bookHinted) { this._bookHinted = true; this.world.ui.toast('Keys 1–0 and Shift+1–0 select · Z cycles · X casts'); }
    }
  }
  markSelected() {
    for (const row of document.querySelectorAll('#sb-grid .sb-row')) {
      row.classList.toggle('sel', Number(row.dataset.i) === this.selected);
    }
  }
  refreshHud() {
    const max = this.maxMana(), frac = clamp(this.mana / max, 0, 1);
    document.getElementById('mana-fill').style.transform = `scaleX(${frac})`;
    document.getElementById('mana-num').textContent = `${Math.floor(this.mana)}`;
    document.getElementById('mana-bar').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    document.getElementById('mana-bar').classList.toggle('low', frac < 0.25);
    const s = SPELLS[this.selected];
    document.getElementById('spell-name').textContent = s.name;
    document.getElementById('spell-cost').textContent = `${s.cost}✦`;
    const e = this.state.elapsed, parts = [];
    if (e < this.stoneUntil) parts.push(`stone ${Math.ceil(this.stoneUntil - e)}`);
    if (e < this.hasteUntil) parts.push(`haste ${Math.ceil(this.hasteUntil - e)}`);
    if (e < this.featherUntil) parts.push(`feather ${Math.ceil(this.featherUntil - e)}`);
    if (e < this.wispUntil) parts.push(`wisp ${Math.ceil(this.wispUntil - e)}`);
    if ((this.world.hitStop || 0) > 0) parts.push('time thins');
    const buffs = parts.join(' · ');
    if (buffs !== this._lastBuffs) { this._lastBuffs = buffs; document.getElementById('buff-line').textContent = buffs; }
  }
}

