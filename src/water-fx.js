// WaterFX — pooled water effects: ripple rings, splash droplets, wake trails,
// rain impacts and underwater bubbles.
//
// Everything here is bounded and disposable. Effects are cosmetic, so they may
// randomise their appearance (the randomness is injectable so tests can pin
// it); they must never be the reason gameplay knows something is wet — that is
// WaterQuery's job.
import * as THREE from 'three';
import { clamp } from './rng.js';
import { WaterQuery } from './water.js';

const RIPPLE_LIFE = 2.6;
const DROP_LIFE = 1.1;
const CULL_DIST = 140;      // beyond this, do not even spawn
const RAIN_INTERVAL = 0.06; // seconds between rain ripple rolls

export class WaterFX {
  constructor(scene, quality, rand = Math.random) {
    this.scene = scene;
    this.rand = rand;
    this.quality = quality;
    this.rainTimer = 0;
    this.bubbleTimer = 0;

    // --- ripple rings: one InstancedMesh, matrices written per live ripple --
    const ringGeo = new THREE.RingGeometry(0.82, 1.0, 20);
    ringGeo.rotateX(-Math.PI / 2);
    this.rippleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide,
    });
    this.rippleMesh = new THREE.InstancedMesh(ringGeo, this.rippleMat, quality.ripples);
    this.rippleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.renderOrder = 2;
    this.rippleMesh.count = 0;
    this.scene.add(this.rippleMesh);
    this.ripples = [];
    for (let i = 0; i < quality.ripples; i++) this.ripples.push({ life: 0, r0: 0, r1: 0, x: 0, z: 0, y: 0 });
    this.rippleHead = 0;
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();

    // --- splash droplets ---------------------------------------------------
    this.dropPos = new Float32Array(quality.splash * 3);
    this.dropVel = new Float32Array(quality.splash * 3);
    this.dropLife = new Float32Array(quality.splash);
    for (let i = 0; i < quality.splash * 3; i++) this.dropPos[i] = -9999;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    this.dropMat = new THREE.PointsMaterial({
      color: 0xdff0f6, size: 0.24, transparent: true, opacity: 0.85, depthWrite: false, fog: true,
    });
    this.drops = new THREE.Points(dg, this.dropMat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 2;
    this.scene.add(this.drops);
    this.dropHead = 0;

    // --- suspended bubbles (underwater) ------------------------------------
    this.bubPos = new Float32Array(quality.bubbles * 3);
    for (let i = 0; i < quality.bubbles * 3; i++) this.bubPos[i] = -9999;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bubPos, 3));
    this.bubMat = new THREE.PointsMaterial({
      color: 0xbfe6ef, size: 0.14, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.bubbles = new THREE.Points(bg, this.bubMat);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 3;
    this.scene.add(this.bubbles);
    this.bubCount = 0;
  }

  // Quality changes resize the pools rather than leaking a second set.
  setQuality(quality) {
    this.quality = quality;
    this.rippleMesh.count = 0;
    this.ripples.length = 0;
    for (let i = 0; i < quality.ripples; i++) this.ripples.push({ life: 0, r0: 0, r1: 0, x: 0, z: 0, y: 0 });
    this.rippleHead = 0;
  }

  get activeRipples() {
    let n = 0;
    for (let i = 0; i < this.ripples.length; i++) if (this.ripples[i].life > 0) n++;
    return n;
  }

  get activeDrops() {
    let n = 0;
    for (let i = 0; i < this.dropLife.length; i++) if (this.dropLife[i] > 0) n++;
    return n;
  }

  // An expanding ring on the surface. `strength` scales radius and brightness.
  ripple(x, z, strength = 1, camera = null) {
    if (!this.ripples.length || this.quality.foam <= 0 && strength < 0.5) return false;
    if (camera && Math.hypot(camera.x - x, camera.z - z) > CULL_DIST) return false;
    const r = this.ripples[this.rippleHead];
    this.rippleHead = (this.rippleHead + 1) % this.ripples.length;
    r.life = RIPPLE_LIFE;
    r.r0 = 0.3 + strength * 0.5;
    r.r1 = r.r0 + 1.6 + strength * 4.2;
    r.x = x; r.z = z;
    r.y = WaterQuery.surfaceY + 0.03;
    return true;
  }

  // Droplets thrown up by something arriving with speed.
  splash(x, y, z, strength = 1, camera = null) {
    if (!this.dropLife.length) return 0;
    if (camera && Math.hypot(camera.x - x, camera.z - z) > CULL_DIST) return 0;
    const want = Math.max(1, Math.round(this.quality.splash * clamp(strength, 0.15, 1)));
    let made = 0;
    for (let n = 0; n < want; n++) {
      const i = this.dropHead;
      this.dropHead = (this.dropHead + 1) % this.dropLife.length;
      const a = this.rand() * Math.PI * 2, sp = 1.4 + this.rand() * 3.4 * strength;
      this.dropPos[i * 3] = x; this.dropPos[i * 3 + 1] = y; this.dropPos[i * 3 + 2] = z;
      this.dropVel[i * 3] = Math.cos(a) * sp * 0.5;
      this.dropVel[i * 3 + 1] = 3.2 + this.rand() * 4.6 * strength;
      this.dropVel[i * 3 + 2] = Math.sin(a) * sp * 0.5;
      this.dropLife[i] = DROP_LIFE * (0.6 + this.rand() * 0.6);
      made++;
    }
    return made;
  }

  // A moving body leaves a short trail: ripples behind it, spaced by the
  // caller. Cheap, and it reads as a wake without touching the water volume.
  wake(x, z, strength = 1, camera = null) {
    if (this.quality.wake <= 0) return false;
    return this.ripple(x, z, strength * 0.55 * this.quality.wake, camera);
  }

  // Rain: a scatter of small rings on water near the camera.
  rainImpacts(camera, intensity, dt) {
    if (this.quality.rainRipples <= 0 || intensity <= 0.02 || !camera) return 0;
    this.rainTimer -= dt;
    if (this.rainTimer > 0) return 0;
    this.rainTimer = RAIN_INTERVAL;
    const n = Math.round(1 + intensity * 3 * this.quality.rainRipples);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const x = camera.x + (this.rand() - 0.5) * 44, z = camera.z + (this.rand() - 0.5) * 44;
      if (!WaterQuery.coveredAt(x, z)) continue;
      if (this.ripple(x, z, 0.22, camera)) made++;
    }
    return made;
  }

  // Suspended particulate around the camera while it is under the surface.
  setBubbles(camera, amount) {
    const target = amount > 0.02 ? Math.min(this.quality.bubbles, Math.round(this.quality.bubbles * amount)) : 0;
    const arr = this.bubPos;
    while (this.bubCount < target) {
      const i = this.bubCount++;
      arr[i * 3] = camera.x + (this.rand() - 0.5) * 14;
      arr[i * 3 + 1] = camera.y + (this.rand() - 0.5) * 8;
      arr[i * 3 + 2] = camera.z + (this.rand() - 0.5) * 14;
    }
    this.bubCount = target;
    for (let i = target; i < arr.length / 3; i++) arr[i * 3 + 1] = -9999;
    this.bubMat.opacity = clamp(amount * 0.7, 0, 0.7);
  }

  update(dt, camera = null) {
    // ripples
    let n = 0;
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) continue;
      const t = 1 - r.life / RIPPLE_LIFE;
      const radius = r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t));
      this.matrix.makeScale(radius, 1, radius);
      this.matrix.setPosition(r.x, r.y, r.z);
      this.rippleMesh.setMatrixAt(n, this.matrix);
      const fade = Math.sin(Math.min(1, t) * Math.PI);
      this.rippleMesh.setColorAt(n, this.tint.setScalar(fade * 0.9));
      n++;
    }
    this.rippleMesh.count = n;
    this.rippleMesh.instanceMatrix.needsUpdate = n > 0;
    if (this.rippleMesh.instanceColor) this.rippleMesh.instanceColor.needsUpdate = n > 0;

    // droplets
    const dp = this.dropPos, dv = this.dropVel;
    let dirty = false;
    for (let i = 0; i < this.dropLife.length; i++) {
      if (this.dropLife[i] <= 0) continue;
      this.dropLife[i] -= dt;
      const surface = WaterQuery.surfaceY;
      if (this.dropLife[i] <= 0 || dp[i * 3 + 1] < surface - 0.1) {
        this.dropLife[i] = 0; dp[i * 3 + 1] = -9999; dirty = true; continue;
      }
      dv[i * 3 + 1] -= 13 * dt;
      dp[i * 3] += dv[i * 3] * dt;
      dp[i * 3 + 1] += dv[i * 3 + 1] * dt;
      dp[i * 3 + 2] += dv[i * 3 + 2] * dt;
      dirty = true;
    }
    if (dirty) this.drops.geometry.attributes.position.needsUpdate = true;

    // bubbles drift up and recycle around the camera
    if (this.bubCount > 0 && camera) {
      const bp = this.bubPos;
      for (let i = 0; i < this.bubCount; i++) {
        bp[i * 3 + 1] += dt * (0.35 + (i % 5) * 0.12);
        if (bp[i * 3 + 1] > camera.y + 5) bp[i * 3 + 1] = camera.y - 5;
        if (Math.abs(bp[i * 3] - camera.x) > 9) bp[i * 3] = camera.x + (this.rand() - 0.5) * 14;
        if (Math.abs(bp[i * 3 + 2] - camera.z) > 9) bp[i * 3 + 2] = camera.z + (this.rand() - 0.5) * 14;
      }
      this.bubbles.geometry.attributes.position.needsUpdate = true;
    }
  }

  // Suspend without tearing down: used when the game pauses.
  suspend() { this.rippleMesh.count = 0; this.bubMat.opacity = 0; }
  resume() { /* state is retained; the next update() redraws what is alive */ }

  dispose() {
    this.scene.remove(this.rippleMesh, this.drops, this.bubbles);
    this.rippleMesh.geometry.dispose();
    this.rippleMat.dispose();
    this.rippleMesh.dispose();
    this.drops.geometry.dispose();
    this.dropMat.dispose();
    this.bubbles.geometry.dispose();
    this.bubMat.dispose();
    this.ripples.length = 0;
    this.bubCount = 0;
  }
}
