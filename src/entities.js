// Actors: wildlife (predator/prey), villagers with daily routines and faction
// patrols that fight over territory. Populations come from the persistent
// region simulation - killing things here changes the simulation there.
import * as THREE from 'three';
import { WORLD, FACTIONS, heightAt } from './worldgen.js';
import { clamp, mulberry32, damp } from './rng.js';
import { Builder } from './structures.js';
import { regionIndex, regionCenter, CH } from './worldstate.js';

const up = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ creature art
function bodyGeo(kind) {
  const b = new Builder();
  if (kind === 'deer') {
    b.box(0.85, 0.85, 1.9, 0, 0, 0, 0x9a7b52);
    b.box(0.55, 0.55, 0.6, 0, 0.45, 1.15, 0xa98c60);
    b.box(0.32, 0.32, 0.5, 0, 0.55, 1.55, 0x8d7048);
    b.cyl(0.05, 0.08, 0.6, 4, 0.18, 0.95, 1.2, 0xd8cdb4, [0.3, 0, 0.25]);
    b.cyl(0.05, 0.08, 0.6, 4, -0.18, 0.95, 1.2, 0xd8cdb4, [0.3, 0, -0.25]);
    b.box(0.2, 0.32, 0.18, 0, 0.2, -1.0, 0xe6ddc8);
  } else if (kind === 'wolf') {
    b.box(0.72, 0.62, 1.7, 0, 0, 0, 0x55575b);
    b.box(0.46, 0.44, 0.62, 0, 0.16, 1.05, 0x5f6166);
    b.box(0.22, 0.2, 0.34, 0, 0.02, 1.45, 0x3f4145);
    b.box(0.12, 0.2, 0.1, 0.16, 0.44, 0.95, 0x6a6c70);
    b.box(0.12, 0.2, 0.1, -0.16, 0.44, 0.95, 0x6a6c70);
    b.cyl(0.08, 0.14, 0.75, 4, 0, 0.28, -1.0, 0x4b4d51, [0.9, 0, 0]);
  } else if (kind === 'boar') {
    b.box(1.0, 0.85, 1.6, 0, 0, 0, 0x5a4636);
    b.box(0.6, 0.55, 0.7, 0, -0.05, 1.05, 0x6a5240);
    b.box(0.16, 0.16, 0.3, 0.2, 0.0, 1.45, 0xd8d0bb);
    b.box(0.5, 0.4, 0.3, 0, 0.45, -0.2, 0x453629);
  } else if (kind === 'rabbit') {
    b.box(0.35, 0.32, 0.55, 0, 0, 0, 0x9d9484);
    b.box(0.26, 0.26, 0.25, 0, 0.15, 0.35, 0xa89f8e);
    b.box(0.07, 0.3, 0.07, 0.08, 0.38, 0.32, 0xb5ab99);
    b.box(0.07, 0.3, 0.07, -0.08, 0.38, 0.32, 0xb5ab99);
  } else if (kind === 'human') {
    b.box(0.62, 0.9, 0.42, 0, 0.0, 0, 0x6d6152);
    b.box(0.36, 0.36, 0.34, 0, 0.62, 0, 0xc9a887);
    b.box(0.2, 0.7, 0.2, 0.42, -0.02, 0, 0x6d6152);
    b.box(0.2, 0.7, 0.2, -0.42, -0.02, 0, 0x6d6152);
  }
  return b.build();
}

function legsGeo(kind, tint) {
  const b = new Builder();
  if (kind === 'human') {
    b.box(0.24, 0.9, 0.26, 0.16, -0.45, 0, tint);
  } else {
    const w = kind === 'rabbit' ? 0.11 : 0.18;
    const h = kind === 'rabbit' ? 0.3 : kind === 'boar' ? 0.7 : 0.95;
    b.box(w, h, w, 0.28, -h / 2, 0, tint);
    b.box(w, h, w, -0.28, -h / 2, 0, tint);
  }
  return b.build();
}

const CREATURE_DEF = {
  deer: { speed: 5.6, hp: 30, y: 1.05, tint: 0x8a6d47, flee: 24, prey: true },
  wolf: { speed: 6.6, hp: 34, y: 0.95, tint: 0x4d4f53, pred: true },
  boar: { speed: 4.6, hp: 46, y: 0.85, tint: 0x4a382a, prey: true, aggressive: true },
  rabbit: { speed: 5.0, hp: 8, y: 0.32, tint: 0x8d8474, prey: true, flee: 16 },
  human: { speed: 2.4, hp: 60, y: 1.0, tint: 0x4f4636 },
};

export class Actor {
  constructor(kind, mats) {
    const def = CREATURE_DEF[kind];
    this.kind = kind;
    this.def = def;
    this.group = new THREE.Group();
    const mat = mats.get(kind);
    this.body = new THREE.Mesh(Actor.geoCache(kind, 'body'), mat);
    this.body.castShadow = true;
    this.legsF = new THREE.Mesh(Actor.geoCache(kind, 'legs', def.tint), mat);
    this.legsB = new THREE.Mesh(Actor.geoCache(kind, 'legs', def.tint), mat);
    const zf = kind === 'human' ? 0 : 0.62, zb = kind === 'human' ? 0 : -0.62;
    this.legsF.position.set(kind === 'human' ? 0 : 0, 0, zf);
    this.legsB.position.set(0, 0, zb);
    if (kind === 'human') { this.legsB.position.x = -0.32; this.legsF.position.x = 0.0; }
    this.group.add(this.body, this.legsF, this.legsB);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.yaw = Math.random() * 6.28;
    this.phase = Math.random() * 6.28;
    this.state = 'idle';
    this.timer = Math.random() * 3;
    this.alive = true;
    this.deadTime = 0;
  }
  static _cache = {};
  static geoCache(kind, part, tint) {
    const k = kind + part;
    if (!Actor._cache[k]) Actor._cache[k] = part === 'body' ? bodyGeo(kind) : legsGeo(kind, tint);
    return Actor._cache[k];
  }
  setPos(x, y, z) { this.pos.set(x, y, z); this.group.position.set(x, y, z); }
}

// ---------------------------------------------------------------------------
export class ActorSystem {
  constructor(scene, state, world) {
    this.scene = scene;
    this.state = state;
    this.world = world;
    this.animals = [];
    this.npcs = [];
    this.soldiers = [];
    this.corpses = [];
    this.mats = new Map();
    for (const k of ['deer', 'wolf', 'boar', 'rabbit', 'human']) {
      this.mats.set(k, new THREE.MeshLambertMaterial({ vertexColors: true }));
    }
    this.humanMats = FACTIONS.map(f => new THREE.MeshLambertMaterial({ color: f.color }));
    this.villagerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.maxAnimals = 16;
    this.spawnTimer = 0;
    this.skirmish = 0;
  }

  spawnAnimal(kind, x, z) {
    const a = new Actor(kind, this.mats);
    a.setPos(x, heightAt(x, z) + a.def.y, z);
    a.region = regionIndex(x, z);
    this.scene.add(a.group);
    this.animals.push(a);
    return a;
  }

  spawnNPC(settlement, idx) {
    const a = new Actor('human', this.mats);
    const mat = this.villagerMat;
    a.body.material = mat; a.legsF.material = mat; a.legsB.material = mat;
    const ang = Math.random() * 6.28, r = 6 + Math.random() * 14;
    const x = settlement.x + Math.cos(ang) * r, z = settlement.z + Math.sin(ang) * r;
    a.setPos(x, heightAt(x, z) + 1.0, z);
    a.home = settlement;
    a.npcIndex = idx;
    a.name = villagerName(settlement.id, idx);
    a.job = ['farmer', 'woodcutter', 'hunter', 'builder', 'elder'][idx % 5];
    this.scene.add(a.group);
    this.npcs.push(a);
    return a;
  }

  spawnSoldier(faction, x, z, squad) {
    const a = new Actor('human', this.mats);
    const m = this.humanMats[faction];
    a.body.material = m; a.legsF.material = m; a.legsB.material = m;
    a.setPos(x, heightAt(x, z) + 1.0, z);
    a.faction = faction;
    a.squad = squad;
    a.hp = a.maxHp = 55 + faction * 10;
    a.speed = 3.4;
    this.scene.add(a.group);
    this.soldiers.push(a);
    return a;
  }

  remove(a, list) {
    this.scene.remove(a.group);
    const i = list.indexOf(a);
    if (i >= 0) list.splice(i, 1);
  }

  // ------------------------------------------------------------ population
  manageSpawns(px, pz, dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 1.1;
    const st = this.state;
    // despawn distant
    for (const a of [...this.animals]) {
      if (a.pos.distanceTo(this.world.player.pos) > 170) this.remove(a, this.animals);
    }
    for (const a of [...this.npcs]) {
      if (!a.home || Math.hypot(a.home.x - px, a.home.z - pz) > 220) this.remove(a, this.npcs);
    }
    for (const a of [...this.soldiers]) {
      if (a.pos.distanceTo(this.world.player.pos) > 220) this.remove(a, this.soldiers);
    }

    // wildlife: sample nearby regions and spawn in proportion to population
    if (this.animals.length < this.maxAnimals) {
      for (let tries = 0; tries < 6 && this.animals.length < this.maxAnimals; tries++) {
        const ang = Math.random() * 6.28;
        const dist = 55 + Math.random() * 95;
        const x = px + Math.cos(ang) * dist, z = pz + Math.sin(ang) * dist;
        if (Math.abs(x) > WORLD.half - 40 || Math.abs(z) > WORLD.half - 40) continue;
        const h = heightAt(x, z);
        if (h < 1.2 || h > 140) continue;
        const ri = regionIndex(x, z);
        const r = st.regions[ri];
        const burn = st.getGround(x, z, CH.BURN);
        if (burn > 0.5) continue;
        const preyDensity = clamp(r.prey / Math.max(4, r.cap), 0, 1.2);
        const predDensity = clamp(r.pred / Math.max(1.2, r.cap * 0.2), 0, 1.2);
        const roll = Math.random();
        if (roll < predDensity * 0.35) this.spawnAnimal('wolf', x, z);
        else if (roll < preyDensity * 0.85) {
          const k = Math.random();
          this.spawnAnimal(k < 0.5 ? 'deer' : k < 0.78 ? 'rabbit' : 'boar', x, z);
        }
      }
    }

    // villagers
    for (let i = 0; i < st.settlements.length; i++) {
      const s = st.settlements[i];
      if (s.abandoned) continue;
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d > 190) continue;
      const want = Math.min(7, Math.round(s.population * 0.5));
      const have = this.npcs.filter(n => n.home === s).length;
      if (have < want) this.spawnNPC(s, have + i * 5);
    }

    // patrols: spawn a squad when the player is inside claimed territory
    const ri = regionIndex(px, pz);
    const region = st.regions[ri];
    if (region.owner >= 0 && this.soldiers.length < 8 && Math.random() < 0.45) {
      const ang = Math.random() * 6.28, dist = 70 + Math.random() * 60;
      let x = px + Math.cos(ang) * dist, z = pz + Math.sin(ang) * dist;
      x = clamp(x, -WORLD.half + 30, WORLD.half - 30); z = clamp(z, -WORLD.half + 30, WORLD.half - 30);
      if (heightAt(x, z) > 1.5) {
        const squad = { id: Math.random(), faction: region.owner, target: this.pickPatrolTarget(region.owner, x, z) };
        const n = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) this.spawnSoldier(region.owner, x + i * 2.5, z + (i % 2) * 2.5, squad);
      }
    }
  }

  pickPatrolTarget(faction, x, z) {
    const st = this.state;
    let best = null, bv = -1;
    for (let i = 0; i < st.regions.length; i++) {
      const r = st.regions[i];
      const [cx, cz] = regionCenter(i);
      const d = Math.hypot(cx - x, cz - z);
      if (d > 520) continue;
      let v = (r.owner === faction ? 0.4 : 1.2) + r.heat * 0.6 - d / 900;
      v += Math.random() * 0.4;
      if (v > bv) { bv = v; best = [cx, cz]; }
    }
    return best || [x, z];
  }

  // ----------------------------------------------------------------- update
  update(dt, player) {
    const st = this.state;
    const p = player.pos;
    this.manageSpawns(p.x, p.z, dt);
    const dayT = st.time;
    const night = dayT < 0.22 || dayT > 0.80;

    // ---- animals
    for (const a of [...this.animals]) {
      if (!a.alive) { this.decayCorpse(a, dt, this.animals); continue; }
      a.timer -= dt;
      const def = a.def;
      let targetSpeed = 0;
      const distToPlayer = a.pos.distanceTo(p);

      if (def.pred) {
        // hunt nearest prey
        let prey = null, bd = 60 * 60;
        for (const o of this.animals) {
          if (!o.alive || !o.def.prey) continue;
          const d = o.pos.distanceToSquared(a.pos);
          if (d < bd) { bd = d; prey = o; }
        }
        const rep = st.player.rep;
        const huntPlayer = distToPlayer < 26 && (night || st.regions[regionIndex(a.pos.x, a.pos.z)].prey < 4) && player.hp > 0;
        if (huntPlayer && (!prey || distToPlayer < Math.sqrt(bd))) {
          a.state = 'chase'; a.aim = p; targetSpeed = def.speed;
          if (distToPlayer < 2.4 && a.timer <= 0) { player.damage(9, 'a wolf'); a.timer = 1.4; }
        } else if (prey) {
          a.state = 'chase'; a.aim = prey.pos; targetSpeed = def.speed * 0.95;
          if (Math.sqrt(bd) < 2.0) { this.killAnimal(prey, false); a.timer = 3; }
        } else { a.state = 'wander'; targetSpeed = def.speed * 0.32; }
      } else {
        // prey: flee player and predators
        let threat = null, bd = (def.flee || 20) ** 2;
        if (distToPlayer * distToPlayer < bd && !player.crouched) threat = p;
        for (const o of this.animals) {
          if (!o.alive || !o.def.pred) continue;
          const d = o.pos.distanceToSquared(a.pos);
          if (d < 34 * 34 && d < bd) { bd = d; threat = o.pos; }
        }
        if (threat) {
          a.state = 'flee';
          a.fleeFrom = threat;
          targetSpeed = def.speed * (def.aggressive && threat === p && distToPlayer < 6 ? 0 : 1);
          if (def.aggressive && threat === p && distToPlayer < 5.5 && a.angry) {
            a.state = 'charge'; a.aim = p; targetSpeed = def.speed;
            if (distToPlayer < 2.2 && a.timer <= 0) { player.damage(12, 'a boar'); a.timer = 1.8; }
          }
        } else { a.state = 'wander'; targetSpeed = def.speed * 0.25; }
      }

      // steering
      if (a.timer <= 0 && (a.state === 'wander')) {
        a.wanderDir = Math.random() * 6.28;
        a.timer = 2 + Math.random() * 4;
      }
      let dirX = 0, dirZ = 0;
      if (a.state === 'flee' && a.fleeFrom) { dirX = a.pos.x - a.fleeFrom.x; dirZ = a.pos.z - a.fleeFrom.z; }
      else if ((a.state === 'chase' || a.state === 'charge') && a.aim) { dirX = a.aim.x - a.pos.x; dirZ = a.aim.z - a.pos.z; }
      else { dirX = Math.cos(a.wanderDir || 0); dirZ = Math.sin(a.wanderDir || 0); }
      this.moveActor(a, dirX, dirZ, targetSpeed, dt);
      this.animate(a, dt, targetSpeed);
    }

    // ---- villagers
    for (const a of [...this.npcs]) {
      if (!a.alive) { this.decayCorpse(a, dt, this.npcs); continue; }
      const s = a.home;
      if (!s) continue;
      if (a.fleeing > 0) {
        a.fleeing -= dt;
        const dx = a.pos.x - p.x, dz = a.pos.z - p.z;
        const d = Math.hypot(dx, dz);
        this.moveActor(a, dx, dz, d < 55 ? 4.6 : 0, dt);
        this.animate(a, dt, d < 55 ? 4.6 : 0);
        continue;
      }
      const prosper = s.prosperity;
      let tx = s.x, tz = s.z, speed = 1.9;
      const idx = a.npcIndex;
      if (night) {
        const ang = (idx / 7) * 6.283;
        tx = s.x + Math.cos(ang) * 14; tz = s.z + Math.sin(ang) * 14;
        speed = 1.4;
      } else if (dayT < 0.45) {
        // morning: fields / forest
        const ang = idx * 1.35 + 0.6, r = a.job === 'woodcutter' ? 60 : 34;
        tx = s.x + Math.cos(ang) * r; tz = s.z + Math.sin(ang) * r;
      } else if (dayT < 0.62) {
        const ang = idx * 2.1, r = 8 + (idx % 3) * 6;
        tx = s.x + Math.cos(ang) * r; tz = s.z + Math.sin(ang) * r;
      } else {
        tx = s.x + Math.cos(idx) * 4; tz = s.z + Math.sin(idx) * 4;   // evening gathering at fire
      }
      if (s.constructing > 0 && a.job === 'builder') { tx = s.x + 9; tz = s.z - 12; }
      if (st.player.rep[s.banner] < -50 && a.pos.distanceTo(p) < 14) { tx = s.x + (a.pos.x - p.x); tz = s.z + (a.pos.z - p.z); }
      // Hunters carry supplies to the nearest living neighbour, then walk home.
      // This is a journey, not a painted road: every step uses the same steering.
      if (a.job === 'hunter') {
        if (!a.destination || a.destination.abandoned) {
          a.destination = st.settlements.filter(v => v !== s && !v.abandoned)
            .sort((u, v) => Math.hypot(u.x - s.x, u.z - s.z) - Math.hypot(v.x - s.x, v.z - s.z))[0];
        }
        const dest = a.returning ? s : a.destination;
        if (dest) {
          tx = dest.x; tz = dest.z;
          if (Math.hypot(tx - a.pos.x, tz - a.pos.z) < 4) a.returning = !a.returning;
        }
      }
      const dx = tx - a.pos.x, dz = tz - a.pos.z;
      const d = Math.hypot(dx, dz);
      const moving = d > 2.2;
      this.moveActor(a, dx, dz, moving ? speed * (prosper > 0.6 ? 1.15 : 0.85) : 0, dt);
      this.animate(a, dt, moving ? speed : 0);
      a.working = !moving;
    }

    // ---- soldiers
    this.skirmish = Math.max(0, this.skirmish - dt);
    for (const a of [...this.soldiers]) {
      if (!a.alive) { this.decayCorpse(a, dt, this.soldiers); continue; }
      a.timer -= dt;
      // enemy soldier?
      let enemy = null, bd = 44 * 44;
      for (const o of this.soldiers) {
        if (!o.alive || o.faction === a.faction) continue;
        const d = o.pos.distanceToSquared(a.pos);
        if (d < bd) { bd = d; enemy = o; }
      }
      const hostileToPlayer = st.player.rep[a.faction] < -25 ||
        (FACTIONS[a.faction].id === 1 && st.player.rep[1] < -10);
      const dp = a.pos.distanceTo(p);
      if (enemy) {
        const dx = enemy.pos.x - a.pos.x, dz = enemy.pos.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        this.moveActor(a, dx, dz, dist > 2.2 ? 4.2 : 0, dt);
        this.animate(a, dt, dist > 2.2 ? 4.2 : 0, true);
        if (dist < 2.6 && a.timer <= 0) {
          a.timer = 0.9;
          enemy.hp -= 9 + Math.random() * 7;
          this.skirmish = 1.0;
          this.world.fx.hitSpark(enemy.pos);
          if (enemy.hp <= 0) {
            this.killSoldier(enemy, a.faction);
          }
        }
      } else if (hostileToPlayer && dp < 34 && player.hp > 0) {
        const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
        this.moveActor(a, dx, dz, dp > 2.2 ? 4.0 : 0, dt);
        this.animate(a, dt, dp > 2.2 ? 4.0 : 0, true);
        if (dp < 2.6 && a.timer <= 0) { a.timer = 1.1; player.damage(11, FACTIONS[a.faction].name); }
      } else {
        const t = a.squad.target;
        const dx = t[0] - a.pos.x, dz = t[1] - a.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 12) a.squad.target = this.pickPatrolTarget(a.faction, a.pos.x, a.pos.z);
        this.moveActor(a, dx, dz, 2.6, dt);
        this.animate(a, dt, 2.6);
        // patrolling projects faction pressure and wears trails
        const r = st.regions[regionIndex(a.pos.x, a.pos.z)];
        r.pressure[a.faction] = clamp(r.pressure[a.faction] + dt * 1.2, 0, 120);

      }
    }
  }

  moveActor(a, dirX, dirZ, speed, dt) {
    const len = Math.hypot(dirX, dirZ) || 1;
    dirX /= len; dirZ /= len;
    if (speed > 0) {
      if (a.kind === 'human') {
        let best = -Infinity, bx = dirX, bz = dirZ;
        for (const angle of [0, -0.3, 0.3, -0.6, 0.6]) {
          const x = dirX * Math.cos(angle) - dirZ * Math.sin(angle);
          const z = dirX * Math.sin(angle) + dirZ * Math.cos(angle);
          const trail = this.state.getGround(a.pos.x + x * 8, a.pos.z + z * 8, CH.TRAIL);
          const score = trail * 0.8 - Math.abs(angle) * 0.3;
          if (score > best) { best = score; bx = x; bz = z; }
        }
        dirX = bx; dirZ = bz;
      }
      const oldX = a.pos.x, oldZ = a.pos.z;
      const nx = a.pos.x + dirX * speed * dt;
      const nz = a.pos.z + dirZ * speed * dt;
      if (Math.abs(nx) < WORLD.half - 12 && Math.abs(nz) < WORLD.half - 12) {
        const nh = heightAt(nx, nz);
        if (nh > 0.4 && Math.abs(nh - (a.pos.y - a.def.y)) < 4.5) {
          a.pos.x = nx; a.pos.z = nz;
        } else { a.wanderDir = Math.random() * 6.28; }
      } else { a.wanderDir = Math.random() * 6.28; }
      if (a.kind === 'human') {
        a.trailStride = (a.trailStride || 0) + Math.hypot(a.pos.x - oldX, a.pos.z - oldZ);
        // Accumulate distance before quantising to bytes; sub-frame wear must not round to zero.
        if (a.trailStride >= 1) {
          this.state.paintGround(a.pos.x, a.pos.z, CH.TRAIL, a.trailStride * 0.008, 3);
          a.trailStride = 0;
        }
      }
      const want = Math.atan2(dirX, dirZ);
      let diff = want - a.yaw;
      while (diff > Math.PI) diff -= 6.283;
      while (diff < -Math.PI) diff += 6.283;
      a.yaw += clamp(diff, -6 * dt, 6 * dt);
    }
    a.pos.y = damp(a.pos.y, heightAt(a.pos.x, a.pos.z) + a.def.y, 10, dt);
    a.group.position.copy(a.pos);
    a.group.rotation.y = a.yaw;
  }

  animate(a, dt, speed, fighting = false) {
    const moving = speed > 0.2;
    a.phase += dt * (moving ? speed * 2.1 : 1.4);
    const swing = moving ? Math.sin(a.phase) * clamp(speed * 0.14, 0.15, 0.7) : Math.sin(a.phase * 0.5) * 0.04;
    a.legsF.rotation.x = swing;
    a.legsB.rotation.x = -swing;
    a.body.position.y = moving ? Math.abs(Math.sin(a.phase)) * 0.06 : Math.sin(a.phase * 0.6) * 0.02;
    a.body.rotation.z = fighting ? Math.sin(a.phase * 3) * 0.25 : moving ? Math.sin(a.phase) * 0.03 : 0;
    if (a.kind !== 'human') a.body.rotation.x = moving ? -0.05 : Math.sin(a.phase * 0.4) * 0.03;
  }

  killAnimal(a, byPlayer) {
    if (!a.alive) return;
    a.alive = false;
    a.deadTime = 0;
    a.group.rotation.z = 1.4;
    const st = this.state;
    const r = st.regions[regionIndex(a.pos.x, a.pos.z)];
    if (a.def.pred) r.pred = Math.max(0, r.pred - 1);
    else r.prey = Math.max(0, r.prey - 1);
    if (byPlayer) {
      st.player.stats.hunted++;
      const inv = st.player.inv;
      inv.hide += a.kind === 'rabbit' ? 1 : 2;
      if (a.kind !== 'wolf') inv.berry += 1;
      this.world.fx.bloodPuff(a.pos);
      this.world.ui.toast(`${a.kind[0].toUpperCase() + a.kind.slice(1)} killed  +${a.kind === 'rabbit' ? 1 : 2} hide`);
      // villagers dislike over-hunting near their homes
      for (const s of st.settlements) {
        if (Math.hypot(s.x - a.pos.x, s.z - a.pos.z) < 120 && !s.abandoned) {
          if (a.def.pred) { s.rep += 3; st.addRep(s.banner, 1.5); }
          else if (r.prey < r.cap * 0.25) { s.rep -= 2; st.addRep(s.banner, -1); }
        }
      }
      st.player.stats.kills++;
    }
  }

  killSoldier(a, byFaction) {
    a.alive = false; a.deadTime = 0; a.group.rotation.z = 1.5;
    const st = this.state;
    const r = st.regions[regionIndex(a.pos.x, a.pos.z)];
    r.pressure[a.faction] = Math.max(0, r.pressure[a.faction] - 12);
    if (byFaction >= 0) r.pressure[byFaction] = clamp(r.pressure[byFaction] + 8, 0, 120);
    r.heat = Math.min(1, r.heat + 0.25);
  }

  decayCorpse(a, dt, list) {
    a.deadTime += dt;
    a.group.position.y = damp(a.group.position.y, heightAt(a.pos.x, a.pos.z) + 0.25, 3, dt);
    if (a.deadTime > 30) this.remove(a, list);
  }

  nearestInteractable(pos, radius = 3.4) {
    let best = null, bd = radius * radius;
    for (const a of this.animals) {
      if (!a.alive) continue;
      const d = a.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = { type: 'animal', actor: a }; }
    }
    for (const a of this.npcs) {
      if (!a.alive) continue;
      const d = a.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = { type: 'npc', actor: a }; }
    }
    for (const a of this.soldiers) {
      if (!a.alive) continue;
      const d = a.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = { type: 'soldier', actor: a }; }
    }
    return best;
  }
}

const FIRST = ['Bram', 'Wen', 'Orla', 'Teg', 'Marn', 'Sif', 'Doran', 'Kesh', 'Illa', 'Hark', 'Nym', 'Ruvo'];
const LAST = ['of the Fen', 'Ashdaughter', 'Quarryman', 'the Elder', 'Tallow', 'Reed', 'Harrow', 'Stonebrook'];
export function villagerName(seed, idx) {
  const r = mulberry32((seed.length * 977) ^ (idx * 7919));
  return FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)];
}
