// THE LIVING FRONTIER - entry point.
import * as THREE from 'three';
import { WORLD, LANDMARKS, SETTLEMENTS, FACTIONS, CAMPS, heightAt, settlementGroundY, caveFloor, placeOnLand } from './worldgen.js';
import { clamp, lerp } from './rng.js';
import { WorldState, CH, regionIndex, SAVE_KEY, DAY_LENGTH } from './worldstate.js';
import { Settings } from './settings.js';
import { ChunkManager, makeWater, makeGroundTexture, shared } from './terrain.js';
import { Vegetation } from './veg.js';
import { buildLandmarks, buildSettlementGeometry, makeStructureMaterial, makeBanner, buildCaveGlow, buildCampGeometry } from './structures.js';
import { ActorSystem } from './entities.js';
import { Player, Input } from './player.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';

const $ = (s) => document.querySelector(s);

class Game {
  constructor(state) {
    this.state = state;
    state.plantings = state.plantings || (state.player.plantings || []);
    this.canvas = $('#gl');
    // (globalThis.__LF_RENDERER is a test seam used by tools/smoke-test.mjs)
    const RendererClass = globalThis.__LF_RENDERER || THREE.WebGLRenderer;
    this.renderer = new RendererClass({ canvas: this.canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 3000);

    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.fx = new FX(this.scene, this.renderer, state);
    this.ui = new UI(state, this);

    makeGroundTexture(state);
    this.chunks = new ChunkManager(this.scene, state);
    this.veg = new Vegetation(this.scene, state);
    this.chunks.onChunkBuild = (k, rec, ring) => this.veg.buildChunk(k, rec, ring);
    this.chunks.onChunkRemove = (k) => this.veg.removeChunk(k);
    this.chunks.onRingChange = (k, rec, ring) => this.veg.setRing(k, ring);
    this.water = makeWater(this.scene);

    this.structMat = makeStructureMaterial();
    this.landmarks = buildLandmarks(this.scene, this.structMat);
    this.settlementMeshes = [];
    this.banners = [];
    this.buildSettlements();
    this.buildLandmarkBanners();
    this.buildCaves();
    this.buildCamps();

    this.player = new Player(this.scene, state, this);
    this.actors = new ActorSystem(this.scene, state, this);

    this.quality = 'high';
    this.clock = new THREE.Clock();
    this.saveTimer = 25;
    this.groundTexTimer = 0;
    this.fireCheckTimer = 0;
    this.interactTarget = null;
    this.timeScale = 1;
    this.frameTimes = [];

    state.onNote = (e) => {
      if (e.kind === 'faction') this.ui.toast(e.text, 'faction');
      else if (e.kind === 'settlement') this.ui.toast(e.text);
      else if (e.kind === 'combat') this.ui.toast(e.text, 'faction');
      else if (e.kind === 'quest') { this.ui.toast(e.text, 'good'); this.audio.play('quest'); }
    };
    state.onNewDay = (d) => this.ui.toast(`Day ${d} breaks over the frontier.`);

    addEventListener('resize', () => this.resize());
    this.resize();

    document.addEventListener('visibilitychange', () => { if (document.hidden) this.state.save(); });
    addEventListener('pagehide', () => this.state.save());
    addEventListener('beforeunload', () => this.state.save());

    // First-time unlock of audio
    const unlock = () => { this.audio.init(); this.audio.resume(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { once: true }));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  cycleQuality() {
    const order = ['high', 'medium', 'low'];
    return this.setQuality(order[(order.indexOf(this.quality) + 1) % 3]);
  }

  setQuality(q) {
    this.quality = ['high', 'medium', 'low'].includes(q) ? q : 'high';
    if (this.quality === 'high') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true; this.chunks.radius = 3; this.actors.maxAnimals = 16;
    } else if (this.quality === 'medium') {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
      this.renderer.shadowMap.enabled = true; this.chunks.radius = 3; this.actors.maxAnimals = 12;
    } else {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false; this.chunks.radius = 2; this.actors.maxAnimals = 8;
    }
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.chunks.center = { i: 9999, j: 9999 };
    return this.quality;
  }

  // ------------------------------------------------------------ settlements
  settlementHash(s) {
    return `${s.buildings}|${s.walls}|${s.fields}|${s.abandoned ? 1 : 0}|${s.constructing > 0 ? 1 : 0}|${Math.round(s.prosperity * 5)}`;
  }
  buildSettlements() {
    for (let i = 0; i < this.state.settlements.length; i++) this.rebuildSettlement(i);
  }
  rebuildSettlement(i) {
    const s = this.state.settlements[i];
    const old = this.settlementMeshes[i];
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); if (old.banner) this.scene.remove(old.banner); }
    const { geo, baseY } = buildSettlementGeometry(s, i);
    const mesh = new THREE.Mesh(geo, this.structMat);
    mesh.position.set(s.x, baseY, s.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    let banner = null;
    if (!s.abandoned) {
      banner = makeBanner(FACTIONS[s.banner].color);
      banner.position.set(s.x + 4, baseY + heightAt(s.x + 4, s.z + 4) - baseY, s.z + 4);
      banner.position.y = heightAt(s.x + 4, s.z + 4);
      this.scene.add(banner);
      this.banners.push(banner);
    }
    this.settlementMeshes[i] = { mesh, banner, hash: this.settlementHash(s), bannerFaction: s.banner, baseY };
  }
  buildCaves() {
    this.caves = [];
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const L of LANDMARKS) {
      if (L.kind !== 'cave') continue;
      const floorY = caveFloor(L);
      const glow = new THREE.Mesh(buildCaveGlow(L), glowMat);
      glow.position.set(L.x, floorY, L.z);
      glow.matrixAutoUpdate = false; glow.updateMatrix();
      this.scene.add(glow);
      const light = new THREE.PointLight(0x7fe0d8, 0, 70, 2);
      light.position.set(L.x + Math.cos(L.dir) * L.len * 0.6, floorY + 4, L.z + Math.sin(L.dir) * L.len * 0.6);
      this.scene.add(light);
      this.caves.push({ L, glow, light, floorY });
    }
  }

  buildCamps() {
    this.camps = [];
    for (let i = 0; i < CAMPS.length; i++) {
      const raw = CAMPS[i];
      const [cx, cz] = placeOnLand(raw.id, raw.x, raw.z, 5, 0.2);
      const c = { id: raw.id, x: cx, z: cz };
      CAMPS[i].x = cx; CAMPS[i].z = cz;
      const owner = this.state.regions[regionIndex(c.x, c.z)].owner;
      const mesh = new THREE.Mesh(buildCampGeometry(i * 131 + 7, Math.max(0, owner)), this.structMat);
      mesh.position.set(c.x, heightAt(c.x, c.z), c.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.visible = owner >= 0;
      this.scene.add(mesh);
      const banner = makeBanner(owner >= 0 ? FACTIONS[owner].color : 0x777777);
      banner.position.set(c.x + 5, heightAt(c.x + 5, c.z + 2), c.z + 2);
      banner.visible = owner >= 0;
      this.scene.add(banner);
      this.banners.push(banner);
      this.camps.push({ c, mesh, banner, owner, seed: i * 131 + 7 });
    }
  }

  buildLandmarkBanners() {
    this.landmarkBanners = [];
    for (const lm of this.landmarks) {
      if (lm.L.kind !== 'fortress' && lm.L.kind !== 'cliff') continue;
      const b = makeBanner(0x888888);
      b.position.set(lm.L.x + 10, heightAt(lm.L.x + 10, lm.L.z + 10) + (lm.L.kind === 'fortress' ? 0 : 0), lm.L.z + 10);
      this.scene.add(b);
      this.banners.push(b);
      this.landmarkBanners.push({ L: lm.L, banner: b, faction: -1 });
    }
  }
  syncStructures(dt) {
    for (let i = 0; i < this.state.settlements.length; i++) {
      const s = this.state.settlements[i];
      const rec = this.settlementMeshes[i];
      if (!rec) continue;
      const h = this.settlementHash(s);
      if (h !== rec.hash) { this.rebuildSettlement(i); continue; }
      if (rec.bannerFaction !== s.banner && rec.banner) {
        rec.banner.userData.cloth.material.color.setHex(FACTIONS[s.banner].color);
        rec.bannerFaction = s.banner;
      }
    }
    for (const lb of this.landmarkBanners) {
      const owner = this.state.regions[regionIndex(lb.L.x, lb.L.z)].owner;
      if (owner !== lb.faction) {
        lb.faction = owner;
        lb.banner.visible = owner >= 0;
        if (owner >= 0) lb.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // camps change hands with the region they sit in
    for (const camp of this.camps) {
      const owner = this.state.regions[regionIndex(camp.c.x, camp.c.z)].owner;
      if (owner !== camp.owner) {
        camp.owner = owner;
        this.scene.remove(camp.mesh);
        camp.mesh.geometry.dispose();
        camp.mesh = new THREE.Mesh(buildCampGeometry(camp.seed, Math.max(0, owner)), this.structMat);
        camp.mesh.position.set(camp.c.x, heightAt(camp.c.x, camp.c.z), camp.c.z);
        camp.mesh.castShadow = true; camp.mesh.receiveShadow = true;
        camp.mesh.matrixAutoUpdate = false; camp.mesh.updateMatrix();
        camp.mesh.visible = owner >= 0;
        this.scene.add(camp.mesh);
        camp.banner.visible = owner >= 0;
        if (owner >= 0) camp.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // cave glow pulses, and its light only burns while the player is inside
    for (const cave of this.caves) {
      const d = Math.hypot(cave.L.x - this.player.pos.x, cave.L.z - this.player.pos.z);
      const near = d < cave.L.len + 40;
      cave.glow.visible = near;
      cave.light.intensity = near ? 3.2 + Math.sin(shared.uTime.value * 1.6) * 0.8 : 0;
    }

    // flag cloth wave
    const t = shared.uTime.value;
    for (const b of this.banners) {
      const c = b.userData.cloth;
      c.rotation.y = Math.sin(t * 2.2 + b.position.x) * 0.35;
      c.scale.x = 1 + Math.sin(t * 3.1 + b.position.z) * 0.06;
    }
  }

  // ------------------------------------------------------------ interaction
  findTarget() {
    const p = this.player.pos;
    const forward = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    const probe = p.clone().addScaledVector(forward, 1.1);

    // settlement centre
    for (let i = 0; i < this.state.settlements.length; i++) {
      const s = this.state.settlements[i];
      if (Math.hypot(s.x - p.x, s.z - p.z) < 7.5) {
        return { type: 'settlement', s, i, label: s.abandoned ? `Search the ruins of ${s.name}` : `Speak with ${s.name}`, alt: null };
      }
    }
    // actors
    const act = this.actors.nearestInteractable(probe, 3.6);
    if (act) {
      const a = act.actor;
      if (act.type === 'npc') return { type: 'npc', actor: a, label: a.fleeing > 0 ? `${a.name} flees from you` : `Talk to ${a.name}`, alt: 'Attack' };
      if (act.type === 'soldier') return { type: 'soldier', actor: a, label: `Hail the ${FACTIONS[a.faction].name}`, alt: 'Attack' };
      if (!a.alive) return { type: 'carcass', actor: a, label: 'Take hide & meat', alt: null };
      return { type: 'animal', actor: a, label: a.def.pred ? 'Wolf — dangerous' : 'Approach quietly', alt: 'Strike' };
    }
    // relics at landmarks
    for (const L of LANDMARKS) {
      const d = Math.hypot(L.x - p.x, L.z - p.z);
      if (d < 12 && !this.state.player['relic_' + L.id]) return { type: 'relic', L, label: `Take relic of ${L.name}`, alt: null };
    }
    // vegetation
    const v = this.veg.nearest(probe.x, probe.z, 3.2);
    if (v) {
      const t = v.item.type;
      const label = t === 'pine' || t === 'broad' ? 'Fell tree'
        : t === 'charred' ? 'Gather charcoal'
          : t === 'berry' ? 'Forage berries'
            : t === 'ore' ? 'Mine ore'
              : t === 'rock' ? 'Break stone'
                : t === 'sapling' ? 'Tend sapling' : 'Gather herbs';
      const alt = (t === 'pine' || t === 'broad' || t === 'bush' || t === 'fern' || t === 'berry') ? 'Set alight' : null;
      return { type: 'veg', veg: v, label, alt };
    }
    // plant sapling on bare ground
    if (this.state.player.inv.wood >= 1 && heightAt(p.x, p.z) > 1.5) {
      return { type: 'plant', label: 'Plant a sapling (1 wood)', alt: null };
    }
    return null;
  }

  interact() {
    const t = this.interactTarget;
    if (!t) return;
    const st = this.state, inv = st.player.inv;
    switch (t.type) {
      case 'veg': return this.harvest(t.veg);
      case 'carcass': {
        inv.hide += 1; inv.berry += 1;
        this.audio.play('pick');
        this.ui.toast('+1 hide, +1 meat');
        this.actors.remove(t.actor, t.actor.faction !== undefined ? this.actors.soldiers : this.actors.animals);
        break;
      }
      case 'relic': {
        inv.relic += 1;
        st.player['relic_' + t.L.id] = true;
        this.audio.play('discover');
        this.ui.toast(`Relic of ${t.L.name} recovered`);
        st.note(`You recovered a relic from ${t.L.name}.`, 'discovery');
        break;
      }
      case 'plant': {
        inv.wood -= 1;
        st.plantings.push({ id: Math.floor(Math.random() * 1e9), x: this.player.pos.x, z: this.player.pos.z, t: st.elapsed, r: Math.random() * 6.28, kind: Math.random() < 0.5 ? 'pine' : 'broad' });
        st.player.stats.planted++;
        st.paintGround(this.player.pos.x, this.player.pos.z, CH.LUSH, 0.5, 9);
        const r = st.regions[regionIndex(this.player.pos.x, this.player.pos.z)];
        r.trees = clamp(r.trees + 0.02, 0, 1.25);
        this.audio.play('build');
        this.ui.toast('Sapling planted — it will grow');
        this.progressQuests('plant', this.player.pos);
        this.veg.rebuild(this.chunkKeyAt(this.player.pos.x, this.player.pos.z));
        break;
      }
      case 'npc': return this.talkNPC(t.actor);
      case 'soldier': return this.talkSoldier(t.actor);
      case 'settlement': return this.settlementDialog(t.s, t.i);
      case 'animal': {
        this.ui.toast(t.actor.def.pred ? 'It watches you. Strike or back away.' : 'It eyes you warily.');
        break;
      }
    }
  }

  chunkKeyAt(x, z) {
    return Math.floor(x / WORLD.chunk) + ',' + Math.floor(z / WORLD.chunk);
  }

  harvest(v) {
    const st = this.state, inv = st.player.inv;
    const { key, item } = v;
    const region = st.regions[regionIndex(item.x, item.z)];
    let regrow = 600;
    switch (item.type) {
      case 'pine': case 'broad': {
        inv.wood += 2 + Math.round(item.scale);
        st.player.stats.felled++;
        region.trees = clamp(region.trees - 0.012, 0, 1.25);
        st.paintGround(item.x, item.z, CH.LUSH, -0.25, 6);
        regrow = 900;
        this.audio.play('chop');
        this.fx.chop(new THREE.Vector3(item.x, item.y + 2, item.z));
        this.ui.toast(`+${2 + Math.round(item.scale)} wood`);
        // villagers notice heavy logging
        for (const s of st.settlements) {
          if (!s.abandoned && Math.hypot(s.x - item.x, s.z - item.z) < 90 && region.trees < 0.55) {
            s.rep -= 1; st.addRep(s.banner, -0.5);
          }
        }
        break;
      }
      case 'charred': inv.wood += 1; regrow = 4000; this.audio.play('chop'); this.ui.toast('+1 charcoal'); break;
      case 'berry': inv.berry += 2; regrow = 420; this.audio.play('pick'); this.ui.toast('+2 berries'); break;
      case 'fern': case 'bush': inv.herb += 1; regrow = 400; this.audio.play('pick'); this.ui.toast('+1 herb'); break;
      case 'rock': inv.stone += 2; regrow = 1500; this.audio.play('mine'); this.fx.dust(new THREE.Vector3(item.x, item.y + 1, item.z)); this.ui.toast('+2 stone'); break;
      case 'ore': {
        if (region.ore < 8) { this.ui.toast('This seam is played out.'); return; }
        region.ore -= 8;
        inv.ore += 2; inv.stone += 1; regrow = 2400;
        this.audio.play('mine');
        this.fx.chop(new THREE.Vector3(item.x, item.y + 1, item.z));
        this.ui.toast(region.ore < 25 ? '+2 ore — the seam is thinning' : '+2 ore');
        break;
      }
      case 'sapling': {
        inv.herb += 1; this.audio.play('pick'); this.ui.toast('You tend the sapling (+1 herb)');
        st.paintGround(item.x, item.z, CH.LUSH, 0.3, 6);
        return;
      }
    }
    this.player.attack();
    st.removeVeg(key, item.id, regrow);
    this.veg.hideInstance(key, item);
    this.progressQuests('harvest', null, item.type);
  }

  strike() {
    this.player.attack();
    this.audio.play('hit');
    this.player.addShake(0.16);
    const t = this.interactTarget;
    const p = this.player.pos;
    if (t && t.type === 'veg' && t.alt === 'Set alight') {
      if (this.state.ignite(t.veg.item.x, t.veg.item.z, 0.8)) {
        this.audio.play('fire');
        this.ui.toast('Flames catch and spread with the wind…');
        this.state.note('You set a fire in the wilds.', 'world');
      } else this.ui.toast('Nothing here will catch.');
      return;
    }
    if (t && t.type === 'npc') {
      const a = t.actor;
      const s = a.home;
      a.hp -= 30 + Math.random() * 20;
      a.fleeing = 25;
      this.fx.hitSpark(a.pos);
      this.player.addShake(0.3);
      this.hitStop = 0.05;
      for (const n of this.actors.npcs) if (n.home === s && n.pos.distanceTo(a.pos) < 60) n.fleeing = 25;
      if (a.hp <= 0) {
        a.alive = false; a.deadTime = 0; a.group.rotation.z = 1.5;
        s.rep = clamp(s.rep - 45, -100, 100);
        s.prosperity = clamp(s.prosperity - 0.06, 0, 1);
        s.population = Math.max(0, s.population - 1);
        this.state.addRep(s.banner, -30);
        this.state.note(`You killed ${a.name} of ${s.name}.`, 'combat');
        this.ui.toast(`${s.name} will not forget this.`, 'faction');
      } else {
        s.rep = clamp(s.rep - 12, -100, 100);
        this.state.addRep(s.banner, -8);
        this.ui.toast('Villagers scatter in fear.');
      }
      return;
    }
    if (t && (t.type === 'animal' || t.type === 'soldier')) {
      const a = t.actor;
      a.hp -= 26 + Math.random() * 14;
      this.fx.hitSpark(a.pos);
      this.player.addShake(0.3);
      this.hitStop = 0.05;
      if (a.def && a.def.aggressive) a.angry = true;
      if (a.hp <= 0) {
        if (t.type === 'animal') this.actors.killAnimal(a, true);
        else {
          this.actors.killSoldier(a, -1);
          this.state.addRep(a.faction, -12);
          const rivals = [0, 1, 2].filter(f => f !== a.faction);
          for (const r of rivals) this.state.addRep(r, 3);
          this.ui.toast(`${FACTIONS[a.faction].name} will remember this.`, 'faction');
        }
        this.progressQuests('kill', a.pos, a.kind, a.def && a.def.pred);
      } else if (t.type === 'soldier') {
        this.state.addRep(a.faction, -3);
      }
      return;
    }
    // swing at empty air also disturbs nearby animals
    for (const a of this.actors.animals) if (a.alive && a.pos.distanceTo(p) < 12) a.timer = 0;
  }

  // -------------------------------------------------------------- dialogue
  talkNPC(a) {
    const st = this.state, s = a.home;
    const r = st.regions[regionIndex(s.x, s.z)];
    const lines = [];
    if (s.abandoned) lines.push('There is nothing left here.');
    else if (s.status === 'thriving') lines.push(`${s.name} has never been so full. We owe some of that to travellers like you.`);
    else if (s.status === 'dying') lines.push(`We are burying more than we birth. ${s.name} may not last the season.`);
    else if (s.supplies < 0.4) lines.push('Stores are thin. Timber, food — anything helps.');
    else lines.push(`${s.name} holds. For now.`);
    if (r.pred > r.cap * 0.14) lines.push('Wolves have grown bold near the treeline.');
    if (r.prey < r.cap * 0.25) lines.push('The herds have thinned. Hunters come back empty-handed.');
    if (r.trees < 0.5) lines.push('The woods are not what they were.');
    if (r.owner >= 0 && r.owner !== s.banner) lines.push(`${FACTIONS[r.owner].name} patrols these hills now. We keep our heads down.`);
    if (st.player.rep[s.banner] > 40) lines.push('You are welcome at any fire in this valley.');
    if (st.player.rep[s.banner] < -25) lines.push('Keep your distance, stranger.');

    const opts = [];
    const q = st.quests.find(q => !q.done && q.target === s.id);
    if (q) {
      if (q.kind === 'deliver' && (st.player.inv[q.item] || 0) >= q.need) {
        opts.push({
          label: `Hand over ${q.need} ${q.item}`, sub: q.title, action: () => {
            st.player.inv[q.item] -= q.need;
            this.completeQuest(q, s);
          }
        });
      } else opts.push({ label: `About "${q.title}"…`, sub: q.desc, action: () => this.ui.toast(q.desc) });
    }
    opts.push({ label: 'Give supplies', sub: 'Strengthen the village', action: () => this.settlementDialog(s, st.settlements.indexOf(s)), keepOpen: false });
    opts.push({ label: 'Ask about the land', sub: 'Rumours and directions', action: () => this.rumour(s) });
    opts.push({ label: 'Leave' });
    this.ui.openDialog(`${a.name} · ${a.job}`, lines.join(' '), opts);
  }

  rumour(s) {
    const st = this.state;
    const undiscovered = LANDMARKS.filter(L => !st.discovered[L.id]);
    if (undiscovered.length) {
      const L = undiscovered[Math.floor(Math.random() * undiscovered.length)];
      const dx = L.x - s.x, dz = L.z - s.z;
      const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((Math.atan2(dx, -dz) + 6.283) % 6.283) / 0.785) % 8];
      this.ui.toast(`"${L.name} lies ${dir} of here, some ${Math.round(Math.hypot(dx, dz))} paces."`);
      st.note(`Heard of ${L.name}, ${dir} of ${s.name}.`, 'discovery');
    } else {
      const worst = [...st.settlements].sort((a, b) => a.prosperity - b.prosperity)[0];
      this.ui.toast(`"Word is ${worst.name} is ${worst.abandoned ? 'empty now' : worst.status}."`);
    }
  }

  talkSoldier(a) {
    const st = this.state;
    const f = FACTIONS[a.faction];
    const rep = st.player.rep[a.faction];
    const region = st.regions[regionIndex(a.pos.x, a.pos.z)];
    const line = rep > 30 ? `Well met. ${f.name} holds ${st.factions[a.faction].territory} regions and grows.`
      : rep < -25 ? 'Walk away while you still can.'
        : `This land answers to ${f.name}. Keep to the paths.`;
    this.ui.openDialog(f.name + ' patrol', line, [
      {
        label: 'Offer tribute (5 ore or 10 wood)', sub: 'Improve standing', action: () => {
          const inv = st.player.inv;
          if (inv.ore >= 5) { inv.ore -= 5; st.addRep(a.faction, 10); this.ui.toast(`${f.name} standing +10`, 'good'); }
          else if (inv.wood >= 10) { inv.wood -= 10; st.addRep(a.faction, 7); this.ui.toast(`${f.name} standing +7`, 'good'); }
          else this.ui.toast('You have nothing they want.');
        }
      },
      {
        label: 'Ask about the war', action: () => {
          const owner = region.owner;
          this.ui.toast(owner === a.faction ? 'This ground is ours, and we mean to keep it.' : 'Contested ground. Blood will settle it.');
        }
      },
      { label: 'Leave' },
    ]);
  }

  settlementDialog(s, i) {
    const st = this.state, inv = st.player.inv;
    if (s.abandoned) {
      this.ui.openDialog(`Ruins of ${s.name}`, 'Roofs have fallen in. Something could still be rebuilt here, with enough supplies.', [
        {
          label: 'Leave 10 wood and 10 stone', sub: 'Begin resettlement', action: () => {
            if (inv.wood >= 10 && inv.stone >= 10) {
              inv.wood -= 10; inv.stone -= 10;
              s.supplies = 1.0; s.rep += 30; st.player.stats.helped++;
              st.addRep(s.banner, 8);
              this.ui.toast(`${s.name} may yet live again.`, 'good');
            } else this.ui.toast('Not enough supplies.');
          }
        },
        { label: 'Leave' },
      ]);
      return;
    }
    const give = (item, amount, effect, text) => ({
      label: `Give ${amount} ${item}`, sub: text, action: () => {
        if ((inv[item] || 0) < amount) { this.ui.toast(`You need ${amount} ${item}.`); return; }
        inv[item] -= amount;
        effect();
        s.rep = clamp(s.rep + 10, -100, 100);
        st.addRep(s.banner, 4);
        st.player.stats.helped++;
        this.audio.play('build');
        this.ui.toast(`${s.name} thanks you.`, 'good');
        st.note(`You aided ${s.name}.`, 'settlement');
        this.progressQuests('give', { x: s.x, z: s.z }, item, false, amount, s);
      }
    });
    this.ui.openDialog(s.name, `${s.name} is ${s.status}. ${Math.round(s.population)} souls, ${s.buildings} buildings${s.walls ? `, palisade at ${s.walls}/3` : ', no defences'}. Supplies ${Math.round(s.supplies * 100)}%.`, [
      give('wood', 5, () => { s.supplies = clamp(s.supplies + 0.22, 0, 1.4); s.prosperity = clamp(s.prosperity + 0.05, 0, 1.2); }, 'Builds and repairs'),
      give('stone', 5, () => { s.defense = clamp(s.defense + 0.12, 0, 1); }, 'Raises the walls'),
      give('berry', 5, () => { s.supplies = clamp(s.supplies + 0.3, 0, 1.4); }, 'Feeds the village'),
      {
        label: 'Rest by the fire', sub: 'Recover, and let time pass', action: () => {
          this.player.heal(60);
          this.state.update(240);
          this.ui.toast('You rest. Hours pass.');
        }
      },
      { label: 'Leave' },
    ]);
  }

  // ---------------------------------------------------------------- quests
  progressQuests(kind, pos, item, isPred, amount = 1, settlement = null) {
    const st = this.state;
    for (const q of st.quests) {
      if (q.done) continue;
      if (q.kind === 'cull' && kind === 'kill' && isPred && pos && Math.hypot(q.x - pos.x, q.z - pos.z) < 220) {
        q.progress++;
        if (q.progress >= q.need) this.completeQuest(q);
        else this.ui.toast(`${q.title}: ${q.progress}/${q.need}`);
      }
      if (q.kind === 'restock' && kind === 'plant' && pos && Math.hypot(q.x - pos.x, q.z - pos.z) < 260) {
        q.progress++;
        if (q.progress >= q.need) this.completeQuest(q);
        else this.ui.toast(`${q.title}: ${q.progress}/${q.need}`);
      }
      if (q.kind === 'deliver' && kind === 'give' && settlement && settlement.id === q.target && item === q.item) {
        q.progress += amount;
        if (q.progress >= q.need) this.completeQuest(q, settlement);
        else this.ui.toast(`${q.title}: ${q.progress}/${q.need}`);
      }
    }
  }

  completeQuest(q, s) {
    const st = this.state;
    q.done = true;
    q.progress = q.need || 1;
    st.player.stats.quests++;
    const settlement = s || st.settlements.find(x => x.id === q.target);
    if (settlement) {
      settlement.rep = clamp(settlement.rep + 25, -100, 100);
      settlement.supplies = clamp(settlement.supplies + 0.35, 0, 1.4);
      settlement.prosperity = clamp(settlement.prosperity + 0.08, 0, 1.2);
      st.addRep(settlement.banner, 12);
    }
    st.player.inv.herb += 2;
    this.audio.play('quest');
    this.ui.toast(`✓ ${q.title}`, 'good');
    st.note(`Completed: ${q.title}`, 'quest');
  }

  // ----------------------------------------------------------- discoveries
  checkDiscoveries() {
    const st = this.state, p = this.player.pos;
    const intro = st.quests.find(q => q.id === 'q_intro' && !q.done);
    if (intro && Math.hypot(intro.x - p.x, intro.z - p.z) < 26) {
      intro.done = true; intro.progress = 1;
      st.player.stats.quests++;
      this.audio.play('quest');
      this.ui.toast('✓ Found Greenhollow — speak to its people', 'good');
    }
    for (const L of LANDMARKS) {
      if (st.discovered[L.id]) continue;
      if (Math.hypot(L.x - p.x, L.z - p.z) < L.r * 0.62) {
        st.discovered[L.id] = st.day;
        this.ui.discovery(L.name);
        this.audio.play('discover');
        st.note(`Discovered ${L.name}.`, 'discovery');
        st.player.inv.relic += 0;
        for (let i = 0; i < 3; i++) st.player.rep[i] = clamp(st.player.rep[i] + 2, -100, 100);
        for (const q of st.quests) if (!q.done && q.kind === 'explore' && q.target === L.id) this.completeQuest(q);
      }
    }
  }

  // Reveals the remembered map around the player. Sight carries further from
  // high, exposed ground, so a ridge line is worth climbing.
  updateSight(dt) {
    this.sightTimer = (this.sightTimer || 0) - dt;
    if (this.sightTimer > 0) return;
    this.sightTimer = 0.35;
    const p = this.player.pos;
    // prominence: how far above the surrounding land the player stands
    const around = (heightAt(p.x + 210, p.z) + heightAt(p.x - 210, p.z) +
      heightAt(p.x, p.z + 210) + heightAt(p.x, p.z - 210)) / 4;
    const prominence = Math.max(0, p.y - around);
    const weather = this.state.weather;
    const murk = (weather.type === 'fogbank' ? 0.45 : weather.type === 'storm' ? 0.65 :
      weather.type === 'rain' ? 0.8 : weather.type === 'snow' ? 0.75 : 1);
    const night = (this.state.time < 0.22 || this.state.time > 0.82) ? 0.55 : 1;
    const radius = clamp((105 + prominence * 2.6) * murk * night, 55, 430);
    this.sightRadius = radius;
    const changed = this.state.markExplored(p.x, p.z, radius);
    if (changed > 0) {
      this.newGround = (this.newGround || 0) + changed;
      // a quiet, earned reward for pushing into genuinely unknown country
      if (this.newGround > 900) {
        this.newGround = 0;
        this.ui.toast('New country mapped', 'good');
        this.audio.play('discover');
      }
    }
  }

  // ---------------------------------------------------------------- loop
  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  frame() {
    const dtRaw = Math.min(this.clock.getDelta(), 0.05);
    const blocking = this.ui.blocking;
    // a few frames of slow-motion on a landed blow: the hit gets weight
    let impact = 1;
    if (this.hitStop > 0) { this.hitStop -= dtRaw; impact = 0.25; }
    const dt = (blocking ? dtRaw * 0.15 : dtRaw) * impact;
    const st = this.state;

    st.update(dt * this.timeScale);

    if (!blocking) {
      const consumed = this.input.consume();
      this.player.update(dtRaw, this.input, this.camera);
      if (consumed.interact) this.interact();
      if (consumed.attack) this.strike();
    } else {
      this.input.consume();
      this.input.look.set(0, 0);
      this.player.updateCamera(dtRaw, this.camera, this.input);
    }

    this.chunks.update(this.player.pos.x, this.player.pos.z, blocking ? 1 : 2);
    this.actors.update(dt, this.player);
    this.fx.update(dtRaw, this.camera, this.player.pos);
    this.syncStructures(dt);
    this.checkDiscoveries();
    this.updateSight(dtRaw);

    // Ground memory texture upload (throttled)
    this.groundTexTimer -= dtRaw;
    if (st.groundDirty && this.groundTexTimer <= 0) {
      shared.uGround.value.needsUpdate = true;
      st.groundDirty = false;
      this.groundTexTimer = 0.4;
    }

    // Vegetation regrowth / burn refresh
    if (st.vegDirtyKeys && st.vegDirtyKeys.size) {
      const k = st.vegDirtyKeys.values().next().value;
      st.vegDirtyKeys.delete(k);
      this.veg.rebuild(k);
    }
    this.fireCheckTimer -= dtRaw;
    if (this.fireCheckTimer <= 0) {
      this.fireCheckTimer = 3.0;
      if (st.fireActive) {
        // re-scatter vegetation near the closest fire so burnt trees appear
        let best = null, bd = 1e9;
        for (const c of st.burningList) {
          const d = Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z);
          if (d < bd) { bd = d; best = [c.x, c.z]; }
        }
        if (best && bd < 260) this.veg.rebuild(this.chunkKeyAt(best[0], best[1]));
      }
    }

    // Audio ambience
    const w = st.weather;
    this.audio.ambience(w.windSpeed, (w.type === 'rain' || w.type === 'storm') ? w.intensity : 0,
      clamp(st.burningCount() * 0.25, 0, 1) * (1 - clamp(Math.abs(this.nearestFireDist() / 90), 0, 1)), st.time < 0.22 || st.time > 0.8);
    this.ambienceTimer = (this.ambienceTimer || 0) - dtRaw;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 3 + Math.random() * 7;
      const night = st.time < 0.22 || st.time > 0.8;
      if (!night && Math.random() < 0.6 && w.intensity < 0.5) this.audio.play('bird');
      else if (night && Math.random() < 0.4) this.audio.play(Math.random() < 0.6 ? 'owl' : 'wolfhowl');
    }

    // interaction prompt
    if (!blocking) {
      this.interactTarget = this.findTarget();
      if (this.interactTarget) {
        const t = this.interactTarget;
        this.ui.setPrompt(t.label, 'E', t.alt || null, 'F');
      } else this.ui.setPrompt(null);
    }

    this.ui.update(dtRaw, this.player);

    // autosave
    this.saveTimer -= dtRaw;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      const ok = st.save();
      if (!ok && !this._saveWarned) {
        this._saveWarned = true;
        this.ui.toast('The frontier cannot be written to storage — progress will be lost.', 'bad');
      } else if (ok && this._saveWarned) {
        this._saveWarned = false;
        this.ui.toast('Storage recovered — the world is being remembered again.', 'good');
      }
    }

    this.renderer.render(this.scene, this.camera);

    // adaptive quality
    this.frameTimes.push(dtRaw);
    if (this.frameTimes.length > 120) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (avg > 0.055 && this.quality === 'high') { this.cycleQuality(); this.ui.toast('Quality lowered for smoother play'); }
      else if (avg > 0.07 && this.quality === 'medium') { this.cycleQuality(); }
    }
  }

  nearestFireDist() {
    let bd = 1e9;
    for (const c of this.state.burningList) {
      const d = Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z);
      if (d < bd) bd = d;
    }
    return bd === 1e9 ? 999 : bd;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function describeSave(obj) {
  if (!obj) return null;
  try {
    const away = Math.max(0, (Date.now() - obj.savedAt) / 1000);
    const hrs = away / 3600;
    const set = obj.settlements || [];
    const alive = set.filter(s => !s.abandoned).length;
    const best = set.slice().sort((a, b) => b.prosperity - a.prosperity)[0];
    return `<b>Day ${obj.day}</b> · ${Object.keys(obj.discovered || {}).length} landmarks found · ${alive}/${set.length} villages standing<br>
      ${best ? `${best.name} is ${best.abandoned ? 'abandoned' : best.status}.` : ''}
      ${hrs > 0.05 ? `<br><span style="color:var(--amber)">The frontier moved on for ${hrs < 1 ? Math.round(away / 60) + ' minutes' : hrs.toFixed(1) + ' hours'} without you.</span>` : ''}`;
  } catch (e) { return null; }
}

function fatal(msg, detail) {
  const el = document.getElementById('boot-status');
  if (el) { el.style.color = '#ef8a74'; el.textContent = msg; }
  const s = document.getElementById('save-summary');
  if (s) s.innerHTML = `<b>${msg}</b><br><span style="font-size:11px;opacity:.7">${detail || ''}</span>`;
  console.error(msg, detail);
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

async function boot() {
  const status = $('#boot-status');
  addEventListener('error', (e) => {
    if (window.GAME && window.GAME.ui) window.GAME.ui.toast('⚠ ' + (e.message || 'error'));
  });
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
  const summary = describeSave(raw);
  $('#save-summary').innerHTML = summary || 'No world yet. The frontier is waiting to be shaped — and it will remember everything you do to it.';
  $('#btn-continue').classList.toggle('hidden', !summary);
  if (!summary) $('#btn-new').classList.add('primary');
  status.textContent = 'Ready';

  const startGame = async (fresh) => {
    $('#boot-status').textContent = 'Shaping the frontier…';
    $('#btn-continue').disabled = $('#btn-new').disabled = true;
    await new Promise(r => setTimeout(r, 30));
    if (!globalThis.__LF_RENDERER && !webglAvailable()) {
      fatal('WebGL is not available in this browser.', 'Try a different browser, or enable hardware acceleration.');
      return;
    }
    let state, loadStatus = 'new';
    try {
      if (fresh) { localStorage.removeItem(SAVE_KEY); state = new WorldState(); }
      else {
        const res = WorldState.loadResult();
        loadStatus = res.status;
        state = res.state || new WorldState();
      }
    } catch (e) { state = new WorldState(); loadStatus = 'damaged'; }

    let game;
    try { game = new Game(state); }
    catch (e) { fatal('The frontier failed to load.', e && e.message); throw e; }
    window.GAME = game;

    // restore how this player likes to play
    const prefs = Settings.load();
    Settings.applyDocument();
    game.audio.setMuted(prefs.muted);
    game.setQuality(prefs.quality);
    game.input.sensitivity = prefs.sensitivity;
    game.input.invertY = prefs.invertY;
    game.player.shakeScale = Settings.motionReduced ? 0.15 : 1;
    game.ui.syncSettingsUI();

    $('#boot-status').textContent = 'Drawing the map…';
    await new Promise(r => setTimeout(r, 20));
    game.ui.buildBaseMap(288);
    $('#boot-status').textContent = 'Growing the forests…';
    await new Promise(r => setTimeout(r, 20));
    // pre-stream the chunks around the player before revealing the world
    for (let i = 0; i < 60; i++) {
      game.chunks.update(state.player.x, state.player.z, 4);
      if (!game.chunks.queue.length) break;
    }
    game.player.updateCamera(0.2, game.camera, game.input);
    game.renderer.render(game.scene, game.camera);

    $('#boot').style.transition = 'opacity .8s ease';
    $('#boot').style.opacity = '0';
    setTimeout(() => $('#boot').classList.add('hidden'), 820);
    $('#hud').classList.remove('hidden');
    game.start();

    if (fresh || state.player.firstRun) {
      state.note('You arrive on the frontier.', 'world');
      state.quests.push({
        id: 'q_intro', kind: 'explore', title: 'Find Greenhollow',
        desc: 'A village lies nearby. Villages ask for help — and remember who gave it.',
        target: 'greenhollow', x: SETTLEMENTS[0].x, z: SETTLEMENTS[0].z,
        progress: 0, expires: state.elapsed + 1e9, done: false,
      });
      const touch = document.body.classList.contains('touch');
      const tips = [
        'Everything you do here leaves a mark. Leave, come back, and see.',
        touch ? 'Hand button acts · blade strikes · » to run.' : 'E acts · F strikes or sets alight · Shift runs · H for help.',
        'Your map is blank until you walk it. Climb high ground to see further.',
      ];
      tips.forEach((t, i) => setTimeout(() => game.ui.toast(t), 1600 + i * 4200));
    } else if (loadStatus === 'damaged') {
      setTimeout(() => game.ui.toast('That saved world could not be read — a new frontier was raised in its place.', 'bad'), 1200);
    } else if (state.awaySeconds > 60) {
      const recent = state.journal.slice(0, 3).map(j => j.text);
      setTimeout(() => game.ui.toast(`While you were gone: ${recent[0] || 'the seasons turned.'}`), 1400);
    }
  };

  $('#btn-continue').addEventListener('click', () => startGame(false));
  $('#btn-new').addEventListener('click', () => startGame(true));
}

boot();
