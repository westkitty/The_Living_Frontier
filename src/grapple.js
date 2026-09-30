// Grappling hook: a 50-metre rope onto any solid surface. Hold G to hang on
// and winch in, push forward to reel faster, Space to slingshot off.
import * as THREE from 'three';
import { heightAt } from './worldgen.js';
import { clamp } from './rng.js';

const REACH = 50;
const SOLID = ['pine', 'broad', 'charred', 'rock', 'ore'];

export class Grapple {
  constructor(player, scene) {
    this.player = player;
    this.active = false;
    this.point = new THREE.Vector3();
    this.length = 0;
    this.at = -9;
    this._a = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._ray.far = REACH;
    this.rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xe8dcc0 }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    scene.add(this.rope);
  }
  release() { this.active = false; this.rope.visible = false; }
  // Everything the hook can bite: trees, snags, rocks and buildings.
  colliders() {
    const out = [], w = this.player.world;
    if (w.veg) for (const [, c] of w.veg.chunks) {
      for (const t of SOLID) if (c.meshes[t]) out.push(c.meshes[t]);
    }
    if (w.settlementMeshes) for (const r of w.settlementMeshes) if (r && r.mesh) out.push(r.mesh);
    if (w.camps) for (const c of w.camps) if (c.mesh && c.mesh.visible) out.push(c.mesh);
    return out;
  }
  fire(camera) {
    const p = this.player, now = p.state.elapsed;
    if (now - this.at < 0.35) return;
    this.at = now;
    p.world.audio.play('grapple');
    const from = this._a.copy(p.pos); from.y += 1.05;
    camera.getWorldDirection(this._dir);
    // throw toward where the eyes rest, so the hook lands where you look
    const cp = camera.position;
    let lookT = 60;
    for (let t = 2; t <= 60; t += 2) {
      if (cp.y + this._dir.y * t < heightAt(cp.x + this._dir.x * t, cp.z + this._dir.z * t)) { lookT = t; break; }
    }
    this._dir.set(cp.x + this._dir.x * lookT, cp.y + this._dir.y * lookT, cp.z + this._dir.z * lookT).sub(from).normalize();
    let best = REACH + 1;
    const hit = new THREE.Vector3();
    // open ground: march the ray against the heightfield itself
    for (let t = 1; t <= REACH; t += 1) {
      const rx = from.x + this._dir.x * t, ry = from.y + this._dir.y * t, rz = from.z + this._dir.z * t;
      const g = heightAt(rx, rz);
      if (ry < g) { best = t; hit.set(rx, g, rz); break; }
    }
    // ...and whatever stands on it
    this._ray.set(from, this._dir);
    const struck = this._ray.intersectObjects(this.colliders(), false)[0];
    if (struck && struck.distance < best) { best = struck.distance; hit.copy(struck.point); }
    if (best > REACH || best < 2.2) return; // sky, or close enough to touch
    this.active = true;
    this.point.copy(hit);
    this.length = Math.max(2.6, best);
    p.world.audio.play('grappleHit');
    p.world.fx.hitSpark(hit);
  }
  update(dt, p, input, camera, forward) {
    if (input.grapplePressed) { input.grapplePressed = false; this.fire(camera); }
    if (this.active && !input.keys['KeyG']) this.release();
    if (this.active) {
      this._a.copy(p.pos).sub(this.point);
      const dist = this._a.length();
      this.length = Math.max(2.0, this.length - dt * (forward > 0.3 ? 16 : 6));
      if (dist <= 2.8) this.release();
      else {
        if (dist > this.length) {
          // the rope goes taut: swing, never stretch
          this._a.multiplyScalar(1 / dist);
          p.pos.copy(this.point).addScaledVector(this._a, this.length);
          const radialV = p.vel.dot(this._a);
          if (radialV > 0) p.vel.addScaledVector(this._a, -radialV);
          p.grounded = false;
        }
        this._a.copy(this.point).sub(p.pos).normalize();
        p.vel.addScaledVector(this._a, dt * 30);
      }
      if (input.jumpPressed) { // slingshot dismount keeps every scrap of speed
        input.jumpPressed = false; p.jumpBuffer = 0;
        this.release();
        p.vel.y = clamp(p.vel.y + 3.5, 7, 15);
        p.world.audio.play('jump');
      }
    }
    this.rope.visible = this.active;
    if (this.active) {
      const rp = this.rope.geometry.attributes.position;
      rp.setXYZ(0, p.pos.x, p.pos.y + 1.0, p.pos.z);
      rp.setXYZ(1, this.point.x, this.point.y, this.point.z);
      rp.needsUpdate = true;
    }
  }
}
