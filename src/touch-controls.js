// The thumb controls: a left stick for walking and a right hand of buttons.
// Split out of ui.js because it is the one part of the interface that is
// literally a different device — it exists only when a finger is driving, and
// it is the part a mouse user should never be shown.
import { clamp } from './rng.js';
import { $ } from './uikit.js';

export const TouchMixin = {
  bindTouch() {
    // joystick
    const zone = $('#touch-left'), base = $('#stick-base'), knob = $('#stick-knob');
    if (!zone || !base || !knob) return;
    let id = null, cx = 0, cy = 0;
    const R = 52;
    const set = (dx, dy) => {
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      this.world.input.move.set(clamp(dx / R, -1, 1), clamp(-dy / R, -1, 1));
    };
    zone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = zone.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      base.classList.add('active');
      set(t.clientX - cx, t.clientY - cy);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) set(t.clientX - cx, t.clientY - cy);
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; knob.style.transform = 'translate(0px,0px)';
        base.classList.remove('active'); this.world.input.move.set(0, 0);
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    // a button that fires on press and stops on release, on both input models
    const hold = (el, press) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); press(); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); press(); });
    };
    hold($('#tb-interact'), () => { this.world.input.interactPressed = true; });
    hold($('#tb-attack'), () => { this.world.input.attackPressed = true; });
    hold($('#tb-jump'), () => { this.world.input.jumpPressed = true; });

    // sprint latches, because holding a thumb for thirty seconds is not running
    const sprint = $('#tb-sprint');
    if (sprint) sprint.addEventListener('click', () => {
      this.world.input.sprint = !this.world.input.sprint;
      sprint.classList.toggle('on', this.world.input.sprint);
      sprint.setAttribute('aria-pressed', this.world.input.sprint ? 'true' : 'false');
    });
  },

}
