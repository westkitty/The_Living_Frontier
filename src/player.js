// Third-person player: movement over the heightfield, smooth spring camera,
// unified keyboard/mouse + touch input, stamina, damage and animation.
import * as THREE from 'three';
import { WORLD, heightAt } from './worldgen.js';
import { clamp, lerp, damp } from './rng.js';
import { Builder } from './structures.js';
import { CH } from './worldstate.js';
import { Mobility } from './mobility.js';
export { Input } from './input.js';

// ---------------------------------------------------------------------------
function playerGeo(part) {
  const b = new Builder();
  if (part === 'body') {
    b.box(0.62, 0.78, 0.38, 0, 0.39, 0, 0x4a5b47);          // torso
    b.box(0.68, 0.22, 0.44, 0, 0.72, 0, 0x6b5436);          // shoulder cloak
    b.box(0.36, 0.36, 0.34, 0, 1.0, 0, 0xc9a887);           // head
    b.box(0.38, 0.14, 0.36, 0, 1.15, 0.02, 0x5a4630);       // hair/hood
    b.box(0.16, 0.4, 0.14, 0, 0.5, -0.26, 0x7a6244);        // pack
  } else if (part === 'armL') {
    b.box(0.18, 0.62, 0.18, 0, -0.31, 0, 0x4a5b47);
  } else if (part === 'armR') {
    b.box(0.18, 0.62, 0.18, 0, -0.31, 0, 0x4a5b47);
    b.box(0.07, 0.52, 0.07, 0, -0.68, 0.05, 0x7b5a34);      // tool haft
    b.box(0.1, 0.16, 0.24, 0, -0.92, 0.1, 0x8a8f96);        // blade
  } else if (part === 'leg') {
    b.box(0.2, 0.62, 0.22, 0, -0.31, 0, 0x3e3a30);
    b.box(0.22, 0.12, 0.3, 0, -0.62, 0.04, 0x2e2a22);
  }
  return b.build();
}

export class Player {
  constructor(scene, state, world) {
    this.scene = scene; this.state = state; this.world = world;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mat = mat;
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(playerGeo('body'), mat);
    this.armL = new THREE.Mesh(playerGeo('armL'), mat);
    this.armR = new THREE.Mesh(playerGeo('armR'), mat);
    this.legL = new THREE.Mesh(playerGeo('leg'), mat);
    this.legR = new THREE.Mesh(playerGeo('leg'), mat);
    this.armL.position.set(0.4, 0.72, 0);
    this.armR.position.set(-0.4, 0.72, 0);
    this.legL.position.set(0.16, 0.62, 0);
    this.legR.position.set(-0.16, 0.62, 0);
    for (const m of [this.body, this.armL, this.armR, this.legL, this.legR]) { m.castShadow = true; this.group.add(m); }
    scene.add(this.group);

    const p = state.player;
    this.pos = new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.1, p.z);
    this.vel = new THREE.Vector3();
    this.yaw = p.yaw || 0;
    this.camYaw = this.yaw;
    this.camPitch = 0.24;
    this.camDist = 7.5;
    this.camDistTarget = 7.5;
    this.grounded = true;
    this.hp = p.hp; this.maxHp = p.maxHp;
    this.stamina = p.stamina ?? 100;
    this.phase = 0;
    this.swing = 0;
    this.shake = 0;
    this.shakeScale = 1;
    this.crouched = false;
    this.speedMul = 1;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._camWant = new THREE.Vector3();
    this.lastTrail = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.footTimer = 0;
    this.inWater = false;
    this.mobility = new Mobility(this);
  }

  damage(amount, source) {
    this.addShake(0.2 + Math.min(0.6, amount / 40));
    if (this.dead) return;
    this.hp = clamp(this.hp - amount, 0, this.maxHp);
    this.world.ui.damageFlash();
    this.world.audio.play('hurt');
    if (this.hp <= 0) {
      this.dead = true; this.deathTimer = 0;
      this.state.note(`You fell to ${source || 'the frontier'}.`, 'combat');
      this.world.ui.toast('You collapse... the frontier carries on without you.');
    }
  }
  heal(a) { this.hp = clamp(this.hp + a, 0, this.maxHp); }

  // the ground answers back differently depending on what you burned, built
  // or wore down: ash crunches, village paths are hard-packed, grass is soft
  footstepSound(st) {
    if (this.inWater) return 'splash';
    const x = this.pos.x, z = this.pos.z;
    if (st.getGround(x, z, CH.BURN) > 0.35) return 'step-ash';
    if (st.getGround(x, z, CH.DEV) > 0.4 || st.getGround(x, z, CH.TRAIL) > 0.55) return 'step-stone';
    if (st.getGround(x, z, CH.LUSH) > 0.25) return 'step-grass';
    return 'step';
  }

  update(dt, input, camera) {
    const st = this.state;
    if (this.dead) {
      this.deathTimer += dt;
      this.group.rotation.z = lerp(this.group.rotation.z, 1.5, dt * 3);
      if (this.deathTimer > 3.2) this.respawn();
      this.updateCamera(dt, camera, input);
      return;
    }
    this.group.rotation.z = 0;

    // --- gather input
    let [mx, my, sprintKey] = input.keyboardMove();
    if (input.move.lengthSq() > 0.001) { mx = input.move.x; my = input.move.y; }
    const moveLen = Math.min(1, Math.hypot(mx, my));

    // --- camera orientation from look input
    const sens = input.sensitivity || 1;
    this.camYaw -= input.look.x * sens;
    this.camPitch = clamp(this.camPitch + input.look.y * sens * (input.invertY ? -1 : 1), -0.45, 1.15);
    input.look.set(0, 0);
    if (input.zoom) { this.camDistTarget = clamp(this.camDistTarget + input.zoom, 3.2, 16); input.zoom = 0; }

    // --- movement (see mobility.js): sprint, shaped jumps, slides, mantling
    const ev = this.mobility.step(dt, input, mx, my, moveLen, sprintKey);
    if (ev.jumped || ev.airJumped) { this.world.audio.play('jump'); if (ev.airJumped) { this.world.fx.dust(this.pos); this.addShake(0.08); } }
    if (ev.slid || ev.mantled) this.world.audio.play(ev.slid ? 'step-stone' : 'step');
    if (ev.landed) {
      this.world.fx.dust(this.pos);
      if (ev.fallSpeed > 9) { this.world.audio.play(this.footstepSound(st)); this.addShake(Math.min(0.5, ev.fallSpeed * 0.015)); }
      if (ev.hurt) this.damage(ev.hurt, 'the fall');
      else if (ev.rolled) this.world.ui.toast('You roll through the landing.');
    }

    // water
    this.inWater = this.pos.y < WORLD.water + 0.4;
    this.speedMul = this.inWater ? 0.55 : 1;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // --- trails: repeated travel wears the ground
    const moved = Math.hypot(this.vel.x, this.vel.z) * dt;
    st.player.stats.distance += moved;
    if (moved > 0.01) {
      this.lastTrail += moved;
      if (this.lastTrail > 1.2) {
        this.lastTrail = 0;
        st.paintGround(this.pos.x, this.pos.z, CH.TRAIL, 0.030, 2.2);
      }
      this.footTimer -= dt;
      if (this.footTimer <= 0 && this.grounded) {
        this.footTimer = this.mobility.sprinting ? 0.24 : 0.46;
        this.world.audio.play(this.footstepSound(st));
        if (Math.random() < 0.35) this.world.fx.dust(this.pos);
      }
    }

    // --- animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (sp * 1.35 + 1.2);
    const amp = clamp(sp * 0.10, 0, 0.85);
    const s = Math.sin(this.phase * 1.4);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.85;
    this.swing = Math.max(0, this.swing - dt * 3.4);
    this.armR.rotation.x = this.swing > 0 ? lerp(0.6, -2.2, 1 - this.swing) : s * amp * 0.85;
    this.body.rotation.x = clamp(sp * 0.012, 0, 0.16);
    this.body.position.y = Math.abs(Math.sin(this.phase * 1.4)) * amp * 0.09 - (this.crouched ? 0.25 : 0);
    const mob = this.mobility;
    if (!this.grounded) {
      // tuck on the way up, reach on the way down; the second jump flips
      const rise = clamp(this.vel.y / 10, -1, 1);
      this.legL.rotation.x = 0.5 + rise * 0.4; this.legR.rotation.x = -0.3 - rise * 0.3;
      this.armL.rotation.x = -1.2 - rise * 0.8; this.armR.rotation.x = this.swing > 0 ? this.armR.rotation.x : -1.0 - rise * 0.6;
      this.body.rotation.x = mob.airJumps > 0 ? -Math.max(0, mob.holdT) * 12 : 0.1 - rise * 0.15;
    }
    if (mob.slideT > 0) { this.body.rotation.x = 0.9; this.body.position.y = -0.55; this.legL.rotation.x = -1.3; this.legR.rotation.x = -0.9; }
    if (mob.rollT > 0) this.body.rotation.x = (0.55 - mob.rollT) / 0.55 * 6.283;
    if (mob.mantleT > 0) { this.armL.rotation.x = this.armR.rotation.x = -2.6; this.body.position.y = -0.2; }

    this.updateCamera(dt, camera, input);

    // sync save-state
    st.player.x = this.pos.x; st.player.y = this.pos.y; st.player.z = this.pos.z;
    st.player.yaw = this.yaw; st.player.hp = this.hp; st.player.stamina = this.stamina;
  }

  attack() { this.swing = 1; }
  // Impact kick. Scaled (or silenced) by the reduce-motion preference.
  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount * this.shakeScale); }

  respawn() {
    const st = this.state;
    // wake at the nearest living settlement
    let best = null, bd = 1e9;
    for (const s of st.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    const x = best ? best.x + 18 : 0, z = best ? best.z + 18 : 0;
    this.pos.set(x, heightAt(x, z) + 0.2, z);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp * 0.6;
    this.dead = false;
    this.group.rotation.z = 0;
    // you lose some cargo when you fall
    const inv = st.player.inv;
    for (const k in inv) inv[k] = Math.floor(inv[k] * 0.5);
    this.world.ui.toast(best ? `${best.name} took you in. Some supplies were lost.` : 'You wake in the wilds.');
  }

  updateCamera(dt, camera, input) {
    const height = this.mobility.slideT > 0 ? 1.0 : 1.55;
    // speed reads as a slightly wider, further view
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const rush = clamp((sp - 5) / 9, 0, 1);
    this.camDist = damp(this.camDist, this.camDistTarget + rush * 1.4, 6, dt);
    if (camera.isPerspectiveCamera) {
      if (this._baseFov === undefined) this._baseFov = camera.fov;
      const wantFov = this._baseFov + rush * 7 + (this.grounded ? 0 : 2);
      if (Math.abs(camera.fov - wantFov) > 0.02) { camera.fov = damp(camera.fov, wantFov, 5, dt); camera.updateProjectionMatrix(); }
    }
    this.camTarget.set(this.pos.x, this.pos.y + height, this.pos.z);
    const cp = Math.cos(this.camPitch), sp2 = Math.sin(this.camPitch);
    const dir = this._camDir.set(Math.sin(this.camYaw) * cp, sp2 + 0.28, Math.cos(this.camYaw) * cp);
    const want = this._camWant.copy(this.camTarget).addScaledVector(dir, this.camDist);
    // keep the camera above ground
    const gh = heightAt(want.x, want.z) + 1.4;
    if (want.y < gh) want.y = gh;
    this.camPos.lerp(want, 1 - Math.exp(-9 * dt));
    if (!this._camInit) { this.camPos.copy(want); this._camInit = true; }
    camera.position.copy(this.camPos);
    // impact kick: a short, decaying shove that never fights the look controls
    if (this.shake > 0.001) {
      const t = this._shakeT = (this._shakeT || 0) + dt * 34;
      const k = this.shake * this.shake * 0.55;
      camera.position.x += Math.sin(t * 1.7) * k;
      camera.position.y += Math.sin(t * 2.3 + 1.1) * k * 0.8;
      camera.position.z += Math.cos(t * 1.9 + 0.4) * k;
      this.shake = Math.max(0, this.shake - dt * 4.2);
    }
    camera.lookAt(this.camTarget);
  }
}
