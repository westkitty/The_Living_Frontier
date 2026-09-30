// Unified keyboard / mouse / touch input: movement, look, and action edges.
// The frame loop lets the player drink jumpPressed before consume() clears
// the glass, so a buffered leap is never lost between the two.
import * as THREE from 'three';

export class Input {
  constructor(dom) {
    this.keys = {};
    this.move = new THREE.Vector2();       // -1..1
    this.look = new THREE.Vector2();       // delta accumulated per frame
    this.sprint = false;
    this.jumpPressed = false;
    this.interactPressed = false;
    this.attackPressed = false;
    this.cameraPressed = false; this.grapplePressed = false; this.castPressed = false;
    this._touchJump = false;
    this.touch = false;
    this.dom = dom;
    this.lookScale = 1;
    this.sensitivity = 1;
    this.invertY = false;
    this._bind();
  }
  // Held all the way through the rise for the full leap; let go to cut it short.
  get jumpHeld() { return !!this.keys['Space'] || this._touchJump; }
  _bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.jumpPressed = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter') this.interactPressed = true;
      if (e.code === 'KeyF') this.attackPressed = true; if (e.code === 'KeyG') this.grapplePressed = true;
      if (e.code === 'KeyC') this.cameraPressed = true; if (e.code === 'KeyX') this.castPressed = true;
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
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
    // The on-screen leap button also reports being held, for variable height.
    try {
      const tj = typeof document !== 'undefined' && document.querySelector('#tb-jump');
      if (tj) {
        tj.addEventListener('touchstart', () => { this._touchJump = true; }, { passive: true });
        const tjEnd = () => { this._touchJump = false; };
        tj.addEventListener('touchend', tjEnd);
        tj.addEventListener('touchcancel', tjEnd);
      }
    } catch (e) { /* headless */ }
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
    const r = { jump: this.jumpPressed, interact: this.interactPressed, attack: this.attackPressed, camera: this.cameraPressed, grapple: this.grapplePressed, cast: this.castPressed };
    this.castPressed = this.jumpPressed = this.interactPressed = this.attackPressed = this.cameraPressed = this.grapplePressed = false;
    return r;
  }
}
