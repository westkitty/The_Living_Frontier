// Contextual interaction: what the player is looking at, and what happens to
// the world when they act on it. Mixed onto Game.prototype in main.js.
import * as THREE from 'three';
import { WORLD, LANDMARKS, FACTIONS, heightAt } from './worldgen.js';
import { clamp } from './rng.js';
import { CH, regionIndex } from './worldstate.js';

export const InteractionMixin = {
  findTarget() {
    const p = this.player.pos;
    const aimY = this.player.firstPerson ? this.player.camYaw + Math.PI : this.player.yaw, forward = new THREE.Vector3(Math.sin(aimY), 0, Math.cos(aimY));
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
      if (!a.alive) return { type: 'carcass', actor: a, label: 'Harvest hide', alt: null };
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
      const canIgnite = (t === 'pine' || t === 'broad' || t === 'bush' || t === 'fern' || t === 'berry');
      const alt = canIgnite ? (this.state.fireConditions().risk === 'tinder' ? 'Set alight — tinder risk' : 'Set alight') : null;
      return { type: 'veg', veg: v, label, alt, canIgnite };
    }
    // plant sapling on bare ground
    if (this.state.player.inv.wood >= 1 && heightAt(p.x, p.z) > 1.5) {
      return { type: 'plant', label: 'Plant a sapling (1 wood)', alt: null };
    }
    return null;
  },

  interact() {
    const t = this.interactTarget;
    if (!t) return;
    const st = this.state, inv = st.player.inv;
    switch (t.type) {
      case 'veg': return this.harvest(t.veg);
      case 'carcass': {
        if (!this.actors.corpses.includes(t.actor)) return;
        const amount = t.actor.kind === 'rabbit' ? 1 : 2;
        inv.hide += amount;
        this.audio.play('pick');
        this.ui.toast(`+${amount} hide`);
        this.actors.remove(t.actor, this.actors.corpses);
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
  },

  chunkKeyAt(x, z) {
    return Math.floor(x / WORLD.chunk) + ',' + Math.floor(z / WORLD.chunk);
  },

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
  },

  strike() {
    this.player.attack();
    this.audio.play('hit');
    this.player.addShake(0.16);
    const t = this.interactTarget;
    const p = this.player.pos;
    if (t && t.type === 'veg' && t.canIgnite) {
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
        a.alive = false; a.deadTime = 0; this.actors.markDead(a);
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
  },
};
