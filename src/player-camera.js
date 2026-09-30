// The player's eyes: a third-person spring camera and a first-person view that
// share one look direction, so stepping into your own head never spins you.
// Head-bob, landing dip, sprint FOV, impact shake and a hand with a tool.
import * as THREE from 'three';
import { heightAt } from './worldgen.js';
import { clamp, damp } from './rng.js';
import { Settings } from './settings.js';

export class PlayerCamera {
  constructor(player, scene) {
    this.player = player;
    this.scene = scene;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._off = new THREE.Vector3();
    this.bobPhase = 0; this.dip = 0; this.dipV = 0;
    this.fov = 62; this.fovPunch = 0; this.roll = 0; this.eyeH = 1.22;
    this._t = 0; this._init = false; this._hinted = false;
    this.buildViewmodel();
    this.bindButtons();
    this.applyMode(false);
  }
  // A shove to the landing-dip spring: negative rises, positive sinks.
  kick(dv) { this.dipV += dv; }
  punch(v) { this.fovPunch = clamp(this.fovPunch + v, -8, 8); }
  setMode(fp) {
    if (!!this.player.firstPerson === !!fp) { this.applyMode(false); return; }
    this.player.firstPerson = !!fp;
    Settings.set('cameraMode', fp ? 'first' : 'third');
    this.applyMode(true);
  }
  toggle() { this.setMode(!this.player.firstPerson); }
  applyMode(announce) {
    const fp = !!this.player.firstPerson;
    this.player.group.visible = !fp;
    this.viewmodel.visible = fp;
    try {
      document.body.classList.toggle('first-person', fp);
      const cross = document.querySelector('#crosshair');
      if (cross) cross.classList.toggle('hidden', !fp);
      for (const id of ['#btn-camera', '#tb-camera']) {
        const b = document.querySelector(id);
        if (b) { b.classList.toggle('on', fp); b.setAttribute('aria-pressed', fp ? 'true' : 'false'); }
      }
      if (fp && !document.body.classList.contains('touch')) document.querySelector('#gl')?.requestPointerLock?.();
      else if (document.pointerLockElement) document.exitPointerLock?.();
    } catch (e) { /* headless tests */ }
    if (announce && fp && !this._hinted) {
      this._hinted = true;
      this.player.world.ui.toast('First person — C to step back · click captures the mouse');
    }
  }
  bindButtons() {
    try {
      const btn = document.querySelector('#btn-camera');
      if (btn) btn.addEventListener('click', () => this.toggle());
      const tb = document.querySelector('#tb-camera');
      if (tb) {
        tb.addEventListener('touchstart', (e) => { e.preventDefault(); this.toggle(); }, { passive: false });
        tb.addEventListener('mousedown', (e) => { e.preventDefault(); this.toggle(); });
      }
      const canvas = document.querySelector('#gl');
      if (canvas) canvas.addEventListener('click', () => {
        if (this.player.firstPerson && !document.pointerLockElement && !document.body.classList.contains('touch')) {
          try { canvas.requestPointerLock?.(); } catch (e) { /* headless */ }
        }
      });
    } catch (e) { /* headless tests */ }
  }
  buildViewmodel() {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const add = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
      m.position.set(x, y, z); g.add(m);
    };
    add(0.08, 0.08, 0.23, 0xc9a887, 0, 0, 0);            // hand
    add(0.10, 0.10, 0.14, 0x4a5b47, 0, 0.01, 0.17);      // sleeve
    add(0.034, 0.034, 0.39, 0x7b5a34, 0.015, 0.022, -0.21); // haft
    add(0.05, 0.09, 0.15, 0x8a8f96, 0.015, 0.045, -0.44);   // blade
    g.visible = false;
    this.scene.add(g);
    this.viewmodel = g;
  }
  updateViewmodel(camera, player) {
    const g = this.viewmodel;
    g.visible = !!player.firstPerson && !player.dead;
    if (!g.visible) return;
    this._off.set(0.20 + Math.cos(this.bobPhase) * 0.006, -0.19 + Math.sin(this.bobPhase * 2) * 0.008, -0.38)
      .applyQuaternion(camera.quaternion);
    g.position.copy(camera.position).add(this._off);
    g.quaternion.copy(camera.quaternion);
    const s = player.swing;
    g.rotateX(s > 0 ? 0.9 - (1 - s) * 2.2 : 0.12 + Math.sin(this.bobPhase * 2) * 0.02);
    g.rotateZ(0.08);
  }
  update(dt, player, camera, input) {
    if (input.cameraPressed) { input.cameraPressed = false; this.toggle(); }
    if (input.zoom) {
      if (player.firstPerson) { if (input.zoom > 0) this.setMode(false); }
      else {
        player.camDistTarget = clamp(player.camDistTarget + input.zoom, 2.6, 14);
        if (player.camDistTarget <= 2.6 && input.zoom < 0) this.setMode(true);
      }
      input.zoom = 0;
    }
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const motionK = Settings.motionReduced ? 0.15 : 1;
    if (player.grounded && speed > 0.4 && !player.dead) this.bobPhase += dt * (3.4 + speed * 1.15);
    // the landing-dip spring: jumps rise through it, landings sink into it
    this.dipV += (-this.dip * 170 - this.dipV * 13) * dt;
    this.dip = clamp(this.dip + this.dipV * dt, -0.25, 0.6);
    if (player.firstPerson) this.updateFirst(dt, player, camera, speed, motionK);
    else this.updateThird(dt, player, camera);
    // impact kick: a short, decaying shove that never fights the look controls
    if (player.shake > 0.001) {
      this._t += dt * 34;
      const k = player.shake * player.shake * 0.55;
      camera.position.x += Math.sin(this._t * 1.7) * k;
      camera.position.y += Math.sin(this._t * 2.3 + 1.1) * k * 0.8;
      camera.position.z += Math.cos(this._t * 1.9 + 0.4) * k;
      player.shake = Math.max(0, player.shake - dt * 4.2);
    }
    // sprint stretches the view, airtime lifts it, landings punch through it
    this.fovPunch = damp(this.fovPunch, 0, 7, dt);
    const wantFov = 62 + (speed > 6.5 ? 6 : 0) + (!player.grounded && !player.dead ? 3 : 0) + this.fovPunch;
    if (Math.abs(wantFov - this.fov) > 0.02) {
      this.fov = damp(this.fov, wantFov, 7, dt);
      camera.fov = this.fov; camera.updateProjectionMatrix();
    }
    this.updateViewmodel(camera, player);
  }
  updateThird(dt, player, camera) {
    const height = 1.16;
    player.camDist = damp(player.camDist, player.camDistTarget, 6, dt);
    this.camTarget.set(player.pos.x, player.pos.y + height - this.dip, player.pos.z);
    const cp = Math.cos(player.camPitch), sp2 = Math.sin(player.camPitch);
    this._dir.set(Math.sin(player.camYaw) * cp, sp2 + 0.28, Math.cos(player.camYaw) * cp);
    this._want.copy(this.camTarget).addScaledVector(this._dir, player.camDist);
    // keep the camera above ground
    const gh = heightAt(this._want.x, this._want.z) + 1.4;
    if (this._want.y < gh) this._want.y = gh;
    this.camPos.lerp(this._want, 1 - Math.exp(-9 * dt));
    if (!this._init) { this.camPos.copy(this._want); this._init = true; }
    camera.position.copy(this.camPos);
    camera.lookAt(this.camTarget);
  }
  updateFirst(dt, player, camera, speed, motionK) {
    const alive = !player.dead, grounded = player.grounded && alive;
    const bobA = clamp(speed / 6, 0, 1) * 0.04 * motionK * (grounded ? 1 : 0);
    const cp = Math.cos(player.camPitch), sp = Math.sin(player.camPitch);
    const fx = -Math.sin(player.camYaw) * cp, fz = -Math.cos(player.camYaw) * cp;
    this.eyeH = damp(this.eyeH, alive ? 1.22 : 0.42, 2.5, dt);
    const side = Math.cos(this.bobPhase) * bobA * 0.7;
    const eyeY = player.pos.y + this.eyeH + Math.sin(this.bobPhase * 2) * bobA - this.dip;
    camera.position.set(player.pos.x - fz * side, eyeY, player.pos.z + fx * side);
    // never let the eyes sink into a slope when landing downhill
    const floorY = heightAt(camera.position.x, camera.position.z) + 0.4;
    if (camera.position.y < floorY) camera.position.y = floorY;
    this._look.set(camera.position.x + fx, camera.position.y - sp, camera.position.z + fz);
    camera.lookAt(this._look);
    const latV = player.vel.x * -fz + player.vel.z * fx;
    const wantRoll = clamp(-latV * 0.006, -0.035, 0.035) * motionK
      + Math.cos(this.bobPhase) * 0.006 * motionK * (grounded ? 1 : 0) + (alive ? 0 : 0.35);
    this.roll = damp(this.roll, wantRoll, 8, dt);
    camera.rotateZ(this.roll);
  }
}
