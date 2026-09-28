// Movement that means something: a jump you can shape by how long you hold
// it, a second jump in the air, coyote time and a jump buffer so the input
// never feels swallowed, a real sprint, a slide that keeps your speed, ledge
// mantling, and a landing roll that turns a bad fall into momentum.
import { WORLD, heightAt, normalAt } from './worldgen.js';
import { clamp, damp } from './rng.js';

export const MOVE = {
  walk: 4.8, sprint: 13.5, crouch: 2.0, slide: 1.4,          // m/s (slide is a multiplier on entry speed)
  gravity: 30, floatGravity: 13, holdTime: 0.26,             // held jumps rise longer
  jump: 10.6, airJump: 9.4, sprintJumpBoost: 1.18,
  coyote: 0.14, buffer: 0.16, airJumps: 1,
  groundAccel: 12, airAccel: 3.2, slideFriction: 1.1,
  mantleReach: 1.7, mantleMax: 4.6,
  fallHurt: 18, rollHurt: 27,
  staminaSprint: 9, staminaJump: 4, staminaAirJump: 10, staminaSlide: 6, staminaMantle: 4,
};

export class Mobility {
  constructor(player) {
    this.p = player;
    this.coyote = 0; this.buffer = 0; this.airJumps = 0; this.holdT = 0;
    this.slideT = 0; this.rollT = 0; this.mantleT = 0; this.winded = 0;
    this.slideDir = [0, 0];
    this.sprinting = false;
    this.airTime = 0;
    this.peakFall = 0;
  }

  // One physics step. Reads the player's pos/vel/stamina and writes them back,
  // returning what happened so the animation and sound layers can react.
  step(dt, input, mx, my, moveLen, sprintKey) {
    const p = this.p, M = MOVE, ev = { jumped: false, landed: false, airJumped: false, slid: false, mantled: false };
    const wasGrounded = p.grounded;
    this.winded = Math.max(0, this.winded - dt);
    this.slideT = Math.max(0, this.slideT - dt);
    this.rollT = Math.max(0, this.rollT - dt);
    this.mantleT = Math.max(0, this.mantleT - dt);

    // crouch toggle / slide entry
    if (input.crouchPressed) {
      input.crouchPressed = false;
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (p.grounded && sp > M.walk * 1.4 && p.stamina > M.staminaSlide && !this.slideT) {
        this.slideT = 0.75; ev.slid = true;
        this.slideDir = [p.vel.x / sp, p.vel.z / sp];
        p.vel.x = this.slideDir[0] * sp * M.slide; p.vel.z = this.slideDir[1] * sp * M.slide;
        p.stamina -= M.staminaSlide;
      } else p.crouched = !p.crouched;
    }
    if (this.slideT > 0) p.crouched = false;
    const sliding = this.slideT > 0;
    const sprinting = this.sprinting = !sliding && (sprintKey || input.sprint) && moveLen > 0.4 && p.stamina > 2 && !p.crouched && !this.winded;

    // --- horizontal: full authority on the ground, momentum in the air
    const speed = (p.crouched ? M.crouch : sprinting ? M.sprint : M.walk) * p.speedMul;
    if (sliding) {
      const k = Math.exp(-M.slideFriction * dt);
      p.vel.x *= k; p.vel.z *= k;
    } else if (moveLen > 0.05) {
      // forward is away from the camera: camera sits at +(sin(camYaw), cos(camYaw))
      const ang = Math.atan2(mx, -my) + p.camYaw;
      const dirX = Math.sin(ang), dirZ = Math.cos(ang);
      const accel = p.grounded ? M.groundAccel : M.airAccel;
      // never damp airborne momentum below the speed we left the ground with
      const cur = Math.hypot(p.vel.x, p.vel.z);
      const want = p.grounded ? speed * moveLen : Math.max(speed * moveLen, cur);
      p.vel.x = damp(p.vel.x, dirX * want, accel, dt);
      p.vel.z = damp(p.vel.z, dirZ * want, accel, dt);
      const face = Math.atan2(dirX, dirZ);
      let d = face - p.yaw;
      while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
      p.yaw += clamp(d, -10 * dt, 10 * dt);
    } else {
      const accel = p.grounded ? 14 : 0.8;
      p.vel.x = damp(p.vel.x, 0, accel, dt);
      p.vel.z = damp(p.vel.z, 0, accel, dt);
    }

    // --- stamina
    if (sprinting) {
      p.stamina = clamp(p.stamina - dt * M.staminaSprint, 0, 100);
      if (p.stamina <= 0) this.winded = 1.6;
    } else p.stamina = clamp(p.stamina + dt * (moveLen > 0.1 ? 8 : 15), 0, 100);

    // --- jump: buffered, forgiving, shaped by the hold, doubled in the air
    if (input.jumpPressed) { this.buffer = M.buffer; input.jumpPressed = false; }
    else this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = p.grounded ? M.coyote : Math.max(0, this.coyote - dt);
    if (this.buffer > 0) {
      if (this.coyote > 0 && p.stamina > 1) {
        p.vel.y = M.jump; p.grounded = false; this.coyote = 0; this.buffer = 0; this.holdT = M.holdTime;
        if (sprinting || sliding) { p.vel.x *= M.sprintJumpBoost; p.vel.z *= M.sprintJumpBoost; }
        this.slideT = 0; p.crouched = false; p.stamina -= M.staminaJump; ev.jumped = true;
      } else if (!p.grounded && this.airJumps < M.airJumps && p.stamina >= M.staminaAirJump) {
        // the second jump lets you redirect: it takes your input direction at full authority
        p.vel.y = Math.max(M.airJump, p.vel.y * 0.3 + M.airJump);
        if (moveLen > 0.05) {
          const ang = Math.atan2(mx, -my) + p.camYaw, sp = Math.max(M.walk, Math.hypot(p.vel.x, p.vel.z));
          p.vel.x = Math.sin(ang) * sp; p.vel.z = Math.cos(ang) * sp;
        }
        this.airJumps++; this.buffer = 0; this.holdT = M.holdTime * 0.7; p.stamina -= M.staminaAirJump; ev.airJumped = true;
      }
    }
    const floating = input.jumpHeld && p.vel.y > 0 && this.holdT > 0;
    if (floating) this.holdT -= dt; else this.holdT = 0;
    p.vel.y -= (floating ? M.floatGravity : M.gravity) * dt;
    if (!p.grounded) { this.airTime += dt; this.peakFall = Math.min(this.peakFall, p.vel.y); }

    // --- integrate with slope resistance and ledge mantling
    const ground = heightAt(p.pos.x, p.pos.z);
    const stepX = p.vel.x * dt, stepZ = p.vel.z * dt;
    const limX = clamp(p.pos.x + stepX, -WORLD.half + 8, WORLD.half - 8);
    const limZ = clamp(p.pos.z + stepZ, -WORLD.half + 8, WORLD.half - 8);
    const nh = heightAt(limX, limZ);
    const climb = nh - ground;
    const maxClimb = 1.35 * Math.max(0.4, Math.hypot(stepX, stepZ)) + 0.55;
    if (climb < maxClimb || (!p.grounded && nh < p.pos.y + 0.3)) { p.pos.x = limX; p.pos.z = limZ; }
    else if (!p.grounded && nh - p.pos.y < M.mantleReach && nh - ground < M.mantleMax && p.stamina > 1 && moveLen > 0.2) {
      // a ledge within arm's reach: pull up and over
      p.pos.x = limX; p.pos.z = limZ; p.pos.y = nh + 0.05;
      p.vel.y = Math.max(p.vel.y, 2.5); this.mantleT = 0.3; p.stamina -= M.staminaMantle; ev.mantled = true;
    } else {
      const n = normalAt(p.pos.x, p.pos.z);
      const dot = p.vel.x * n[0] + p.vel.z * n[2];
      const sx = clamp(p.pos.x + (p.vel.x - n[0] * dot) * dt * 0.5, -WORLD.half + 8, WORLD.half - 8);
      const sz = clamp(p.pos.z + (p.vel.z - n[2] * dot) * dt * 0.5, -WORLD.half + 8, WORLD.half - 8);
      if (heightAt(sx, sz) - ground < maxClimb) { p.pos.x = sx; p.pos.z = sz; }
      if (sliding) this.slideT = 0;
    }

    p.pos.y += p.vel.y * dt;
    const gh = heightAt(p.pos.x, p.pos.z);
    if (p.pos.y <= gh) {
      if (!wasGrounded) {
        ev.landed = true; ev.fallSpeed = -this.peakFall;
        const hurtAt = (sprintKey || input.sprint) && moveLen > 0.3 ? M.rollHurt : M.fallHurt;
        if (this.peakFall < -M.fallHurt && hurtAt === M.rollHurt) { this.rollT = 0.55; ev.rolled = true; }
        if (this.peakFall < -hurtAt) ev.hurt = clamp((-this.peakFall - hurtAt) * 2.2, 0, 60);
      }
      p.pos.y = gh; p.vel.y = 0; p.grounded = true; this.airJumps = 0; this.airTime = 0; this.peakFall = 0;
    } else if (p.vel.y < -1 || p.pos.y > gh + 0.25) p.grounded = false;
    return ev;
  }
}
