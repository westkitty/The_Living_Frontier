// Player: heightfield movement, a shaped and forgiving leap, stamina, damage,
// animation, and eyes of your own — third person until you press C.
import * as THREE from 'three';
import { WORLD, heightAt, normalAt } from './worldgen.js';
import { clamp, lerp, damp } from './rng.js';
import { Builder } from './structures.js';
import { CH } from './worldstate.js';
import { Settings } from './settings.js';
import { PlayerCamera } from './player-camera.js';
import { Grapple } from './grapple.js';
import { attachPlayerVisual } from './assets/actor-visual.js';
export { Input } from './input.js';
const PLAYER_SCALE = 0.75;

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
    this.group = new THREE.Group(); this.fallbackRoot = new THREE.Group(); this.group.add(this.fallbackRoot);
    this.body = new THREE.Mesh(playerGeo('body'), mat);
    this.armL = new THREE.Mesh(playerGeo('armL'), mat);
    this.armR = new THREE.Mesh(playerGeo('armR'), mat);
    this.legL = new THREE.Mesh(playerGeo('leg'), mat);
    this.legR = new THREE.Mesh(playerGeo('leg'), mat);
    this.armL.position.set(0.4, 0.72, 0);
    this.armR.position.set(-0.4, 0.72, 0);
    this.legL.position.set(0.16, 0.62, 0);
    this.legR.position.set(-0.16, 0.62, 0);
    for (const m of [this.body, this.armL, this.armR, this.legL, this.legR]) { m.castShadow = true; this.fallbackRoot.add(m); }
    scene.add(this.group);
    this.visual = attachPlayerVisual(this, world); this.cameraRig = new PlayerCamera(this, scene); this.grapple = new Grapple(this, scene);
    const p = state.player;
    this.pos = new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.1, p.z);
    this.vel = new THREE.Vector3();
    this.yaw = p.yaw || 0;
    this.camYaw = this.yaw;
    this.camPitch = 0.24;
    this.camDist = 6.4;
    this.camDistTarget = 6.4;
    this.grounded = true; this.jumpBuffer = 0; this.coyote = 0; this.airJumps = 1; this.boost = 0;
    this.hp = p.hp; this.maxHp = p.maxHp;
    this.stamina = p.stamina ?? 100;
    this.phase = 0;
    this.swing = 0; this.squash = 0; this.stretch = 0; this.flip = 0;
    this.shake = 0;
    this.shakeScale = 1;
    this.crouched = false; this.firstPerson = Settings.get('cameraMode') === 'first';
    this.speedMul = 1;
    this.lastTrail = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.footTimer = 0;
    this.inWater = false;
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
      input.jumpPressed = input.cameraPressed = input.grapplePressed = false; this.grapple.release(); input.look.set(0, 0);
      this.group.rotation.z = 0;
      this.fallbackRoot.rotation.z = lerp(this.fallbackRoot.rotation.z, 1.5, dt * 3);
      if (this.deathTimer > 3.2) this.respawn();
      this.visual?.update(dt, 'dead', 0);
      this.updateCamera(dt, camera, input);
      return;
    }
    this.group.rotation.z = 0; this.fallbackRoot.rotation.z = 0;
    // --- gather input
    let [mx, my, sprintKey] = input.keyboardMove();
    if (input.move.lengthSq() > 0.001) { mx = input.move.x; my = input.move.y; }
    const moveLen = Math.min(1, Math.hypot(mx, my));
    const sprinting = (sprintKey || input.sprint) && moveLen > 0.4 && this.stamina > 2 && !this.crouched;
    // --- camera orientation from look input
    const sens = input.sensitivity || 1;
    this.camYaw -= input.look.x * sens;
    const pLo = this.firstPerson ? -1.25 : -0.45, pHi = this.firstPerson ? 1.25 : 1.15;
    this.camPitch = clamp(this.camPitch + input.look.y * sens * (input.invertY ? -1 : 1), pLo, pHi);
    input.look.set(0, 0);

    // --- movement (the air keeps your momentum: it steers, it never grabs)
    const speed = (this.crouched ? 1.9 : sprinting ? 9.2 : 4.6) * this.speedMul;
    const airK = this.grounded ? 1 : 0.32;
    if (moveLen > 0.05) {
      // forward is away from the camera: camera sits at +(sin(camYaw), cos(camYaw))
      const ang = Math.atan2(mx, -my) + this.camYaw;
      const dirX = Math.sin(ang), dirZ = Math.cos(ang);
      this.vel.x = damp(this.vel.x, dirX * speed * moveLen, 12 * airK, dt);
      this.vel.z = damp(this.vel.z, dirZ * speed * moveLen, 12 * airK, dt);
      const want = Math.atan2(dirX, dirZ);
      let d = want - this.yaw;
      while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
      this.yaw += clamp(d, -9 * dt, 9 * dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, this.grounded ? 14 : 0.7, dt);
      this.vel.z = damp(this.vel.z, 0, this.grounded ? 14 : 0.7, dt);
    }
    if (this.firstPerson) this.yaw = this.camYaw + Math.PI;
    this.grapple.update(dt, this, input, camera, my);

    // stamina
    if (sprinting) this.stamina = clamp(this.stamina - dt * 16, 0, 100);
    else this.stamina = clamp(this.stamina + dt * (moveLen > 0.1 ? 7 : 15), 0, 100);

    // --- vertical: buffered, forgiving, twice-jumpable, and shaped for feel
    const ground = heightAt(this.pos.x, this.pos.z);
    if (input.jumpPressed) { this.jumpBuffer = 0.18; input.jumpPressed = false; }
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.13 : Math.max(0, this.coyote - dt);
    if (input.jumpHeld && this.grounded) this.jumpBuffer = Math.max(this.jumpBuffer, 0.05);
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      const sprintBoost = Math.hypot(this.vel.x, this.vel.z) > 6 ? 1.06 : 1;
      this.vel.y = (this.inWater ? 10 : 15) * sprintBoost;
      this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
      this.stretch = 1; this.cameraRig.kick(-1.0); this.cameraRig.punch(3);
      this.vel.x *= 1.08; this.vel.z *= 1.08;      // a sprint carries into the leap
      this.world.audio.play('jump');
      this.world.fx.dust(this.pos);
    } else if (this.jumpBuffer > 0 && this.airJumps > 0) {
      this.airJumps -= 1; this.jumpBuffer = 0;
      this.vel.y = this.inWater ? 8 : 12.5; this.boost = 0.28;
      this.stretch = 1; this.flip = Settings.motionReduced ? 0 : 1;
      this.cameraRig.kick(-0.8); this.cameraRig.punch(2.5);
      this.world.audio.play('double');
      this.world.fx.emitSpark(this.pos, 0xbfe3ff, 14, 4, 2.5);
    }
    // held rises float, released rises cut short, falls are fast, the apex hangs
    const rising = this.vel.y > 0, nearApex = !this.grounded && Math.abs(this.vel.y) < 2.2;
    this.boost = Math.max(0, this.boost - dt);
    const grav = this.inWater ? 15 : nearApex ? 13 : rising ? (input.jumpHeld || this.boost > 0 ? 27 : 52) : 46;
    this.vel.y = Math.max(this.vel.y - grav * dt, -38);

    // --- integrate with slope resistance
    const stepX = this.vel.x * dt, stepZ = this.vel.z * dt;
    const tryX = this.pos.x + stepX, tryZ = this.pos.z + stepZ;
    const limX = clamp(tryX, -WORLD.half + 8, WORLD.half - 8);
    const limZ = clamp(tryZ, -WORLD.half + 8, WORLD.half - 8);
    const nh = heightAt(limX, limZ);
    const climb = nh - ground;
    const maxClimb = 1.35 * Math.max(0.4, Math.hypot(stepX, stepZ)) + 0.55;
    if (climb < maxClimb) { this.pos.x = limX; this.pos.z = limZ; }
    else {
      // slide along the slope
      const n = normalAt(this.pos.x, this.pos.z);
      const slideX = this.vel.x - n[0] * (this.vel.x * n[0] + this.vel.z * n[2]);
      const slideZ = this.vel.z - n[2] * (this.vel.x * n[0] + this.vel.z * n[2]);
      const sx = clamp(this.pos.x + slideX * dt * 0.5, -WORLD.half + 8, WORLD.half - 8);
      const sz = clamp(this.pos.z + slideZ * dt * 0.5, -WORLD.half + 8, WORLD.half - 8);
      if (heightAt(sx, sz) - ground < maxClimb) { this.pos.x = sx; this.pos.z = sz; }
    }

    this.pos.y += this.vel.y * dt;
    const gh = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gh) {
      const impact = this.grounded ? 0 : -this.vel.y;
      if (impact > 7) {
        this.squash = clamp(impact / 22, 0.25, 1);
        this.cameraRig.kick(impact * 0.06); this.cameraRig.punch(-impact * 0.1);
        this.world.fx.dust(this.pos);
        this.world.audio.play(impact > 12 ? 'land' : this.footstepSound(st));
      }
      if (impact > 26) this.damage(clamp((impact - 26) * 2.4, 0, 60), 'the fall');
      this.pos.y = gh; this.vel.y = 0; this.grounded = true; this.airJumps = 1;
    } else if (this.pos.y > gh + 0.02) this.grounded = false;

    // water
    this.inWater = gh < WORLD.water + 0.3;
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
        this.footTimer = sprinting ? 0.28 : 0.46;
        this.world.audio.play(this.footstepSound(st));
        if (Math.random() < 0.35) this.world.fx.dust(this.pos);
      }
    }

    // --- animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (sp * 1.8 + 1.2);
    const amp = clamp(sp * 0.10, 0, 0.85);
    const s = Math.sin(this.phase * 1.4);
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.85;
    this.swing = Math.max(0, this.swing - dt * 3.4);
    this.armR.rotation.x = this.swing > 0 ? lerp(0.6, -2.2, 1 - this.swing) : s * amp * 0.85;
    this.body.rotation.x = clamp(sp * 0.012, 0, 0.16);
    this.body.position.y = Math.abs(Math.sin(this.phase * 1.4)) * amp * 0.09 - (this.crouched ? 0.25 : 0);
    if (!this.grounded) { this.legL.rotation.x = 0.4; this.legR.rotation.x = -0.25; }
    // leaps stretch the body, landings squash it — the eye reads weight
    this.squash = Math.max(0, this.squash - dt * 5); this.stretch = Math.max(0, this.stretch - dt * 6);
    this.group.scale.set((1 + this.squash * 0.13 - this.stretch * 0.07) * PLAYER_SCALE, (1 - this.squash * 0.22 + this.stretch * 0.13) * PLAYER_SCALE, (1 + this.squash * 0.13 - this.stretch * 0.07) * PLAYER_SCALE);
    this.flip = Math.max(0, this.flip - dt * 2.2);
    this.group.rotation.x = this.flip > 0 ? (1 - this.flip) * 6.283 : 0;

    const visualState = this.swing > 0 ? 'attack' : !this.grounded ? 'jump' : sp > 6 ? 'run' : sp > 0.2 ? 'walk' : 'idle';
    this.visual?.update(dt, visualState, sp);

    this.updateCamera(dt, camera, input);

    // sync save-state
    st.player.x = this.pos.x; st.player.y = this.pos.y; st.player.z = this.pos.z;
    st.player.yaw = this.yaw; st.player.hp = this.hp; st.player.stamina = this.stamina;
  }

  attack() { this.swing = 1; }
  // Impact kick. Scaled (or silenced) by the reduce-motion preference.
  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount * this.shakeScale); }
  // Where the hands reach: the body's facing, or the eyes' in first person.
  get aimYaw() { return this.firstPerson ? this.camYaw + Math.PI : this.yaw; }
  setFirstPerson(fp) { this.firstPerson = !!fp; this.cameraRig.applyMode(false); }

  respawn() {
    const st = this.state;
    // wake at the nearest living settlement
    let best = null, bd = 1e9;
    for (const s of st.settlements) {
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    const x = best ? best.x + 27 : 0, z = best ? best.z + 27 : 0;
    this.pos.set(x, heightAt(x, z) + 0.2, z);
    this.vel.set(0, 0, 0); this.grapple.release();
    this.hp = this.maxHp * 0.6;
    this.dead = false;
    this.group.rotation.z = 0; this.group.rotation.x = 0;
    this.fallbackRoot.rotation.z = 0;
    // you lose some cargo when you fall
    const inv = st.player.inv;
    for (const k in inv) inv[k] = Math.floor(inv[k] * 0.5);
    this.world.ui.toast(best ? `${best.name} took you in. Some supplies were lost.` : 'You wake in the wilds.');
  }

  updateCamera(dt, camera, input) { this.cameraRig.update(dt, this, camera, input); }
}
