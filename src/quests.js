// Quests generated from world state, and what completing one does to it.
// Mixed onto Game.prototype in main.js.
import { clamp } from './rng.js';

export const QuestMixin = {
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
  },

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
  },
};
