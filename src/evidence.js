// Physical discovery opens a site-specific reading in the same Long Record.
// The field never authors a second version of history: its fragment is drawn
// from the chronology and its action takes the player to that exact year.
import { deepEvents } from './chronology.js';
import { $ } from './uikit.js';

export const EvidenceMixin = {
  discovery(title, landmark = null) {
    const banner = $('#discovery-banner');
    const events = landmark
      ? deepEvents(this.state).filter(e => e.landmark === landmark.id && !e.sealed).sort((a, b) => b.at - a.at)
      : [];
    this.pendingEvidence = events[0] || null;
    banner.querySelector('.db-title').textContent = title;
    banner.querySelector('.db-fragment').textContent = this.pendingEvidence
      ? this.pendingEvidence.after || this.pendingEvidence.line
      : 'The place is entered on your survey. The record changes when ground is reached.';
    const read = $('#db-read');
    read.hidden = !this.pendingEvidence;
    if (this.pendingEvidence) {
      read.setAttribute('aria-label', `Trace evidence from year ${this.pendingEvidence.at} at ${title} in the Long Record`);
    }
    banner.classList.add('show');
    clearTimeout(this._discoveryTimer);
    this._discoveryTimer = setTimeout(() => banner.classList.remove('show'), 11000);
  },

  readEvidence() {
    const evidence = this.pendingEvidence;
    if (!evidence) return;
    clearTimeout(this._discoveryTimer);
    $('#discovery-banner').classList.remove('show');
    this.openRecord();
    // Follow the evidence to its year and change the scale to a human span.
    // This is the same archive used by R; no parallel lore is fabricated here.
    this.recordEnter = 1;
    this.recordScale = 2;
    this.recordYear = evidence.at;
    this.drawRecord();
    this.world.audio.play('ui');
  },
};
