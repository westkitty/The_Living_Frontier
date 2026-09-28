// Unified keyboard / mouse / touch input. Edge-triggered actions are consumed
// by whoever reads them; held state (movement, sprint, a held jump) is polled.
import * as THREE from 'three';

export class Input {
  constructor(dom) {
    this.keys = {};
    this.move = new THREE.Vector2();       // -1..1
    this.look = new THREE.Vector2();       // delta accumulated per frame
    this.sprint = false;
    this.jumpPressed = false;
    this.jumpHeld = false;
    this.crouchPressed = false;
    this.interactPressed = false;
    this.attackPressed = false;
    this.touch = false;
    this.dom = dom;
    this.lookScale = 1;
    this.sensitivity = 1;
    this.invertY = false;
    this._bind();
  }
  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.jumpPressed = true; this.jumpHeld = true; e.preventDefault(); }
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouchPressed = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.interactPressed = true;
      if (e.code === 'KeyF') this.attackPressed = true;
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'Space') this.jumpHeld = false; });
    addEventListener('blur', () => { this.keys = {}; this.jumpHeld = false; });

    // Mouse look (drag or pointer lock)
    const canvas = this.dom;
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; }
      if (e.button === 2) this.attackPressed = true;
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX * 0.0022;
        this.look.y += e.movementY * 0.0022;
      } else if (this.dragging) {
        this.look.x += (e.clientX - this.lastX) * 0.004;
        this.look.y += (e.clientY - this.lastY) * 0.004;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.zoom = (this.zoom || 0) + Math.sign(e.deltaY) * 0.6; e.preventDefault(); }, { passive: false });

    // Touch look on the right half of the screen
    this.touches = new Map();
    const startLook = (t) => { this.lookId = t.identifier; this.lastTX = t.clientX; this.lastTY = t.clientY; };
    canvas.addEventListener('touchstart', (e) => {
      this.touch = true;
      for (const t of e.changedTouches) {
        if (t.clientX > innerWidth * 0.38 && this.lookId === undefined) startLook(t);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookId) {
          this.look.x += (t.clientX - this.lastTX) * 0.006;
          this.look.y += (t.clientY - this.lastTY) * 0.006;
          this.lastTX = t.clientX; this.lastTY = t.clientY;
        }
      }
    }, { passive: true });
    const endTouch = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.lookId) this.lookId = undefined;
    };
    canvas.addEventListener('touchend', endTouch, { passive: true });
    canvas.addEventListener('touchcancel', endTouch, { passive: true });
  }
  keyboardMove() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.KeyW || k.ArrowUp) y += 1;
    if (k.KeyS || k.ArrowDown) y -= 1;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    return [x, y, !!(k.ShiftLeft || k.ShiftRight)];
  }
  consume() {
    const r = { jump: this.jumpPressed, interact: this.interactPressed, attack: this.attackPressed };
    this.jumpPressed = this.interactPressed = this.attackPressed = false;
    return r;
  }
}
