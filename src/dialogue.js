// Everything the frontier says back: villagers, soldiers and settlement halls.
// Mixed onto Game.prototype in main.js.
import { LANDMARKS, FACTIONS } from './worldgen.js';
import { clamp } from './rng.js';
import { regionIndex } from './worldstate.js';

export const DialogueMixin = {
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
  },

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
  },

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
  },

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
  },
};
