// Chunk lifetime and structures. Mixed onto Game.prototype, never an entry point.
import * as THREE from 'three';
import { LANDMARKS, FACTIONS, CAMPS, heightAt, caveFloor, placeOnLand } from './worldgen.js';
import { regionIndex } from './worldstate.js';
import { ChunkManager, makeWater, makeGroundTexture, shared } from './terrain.js';
import { Vegetation } from './veg.js';
import { acquireStaticWorldAsset, releaseStaticWorldAsset } from './assets/actor-visual.js';
import { buildLandmarks, buildSettlementGeometry, makeStructureMaterial, makeBanner, buildCaveGlow, buildCampGeometry } from './structures.js';

export const StreamingMixin = {
  initStreaming() {
    const state = this.state;
    makeGroundTexture(state);
    this.chunks = new ChunkManager(this.scene, state);
    this.veg = new Vegetation(this.scene, state, this.assets);
    this.chunks.onChunkBuild = (k, rec, ring) => this.veg.buildChunk(k, rec, ring);
    this.chunks.onChunkRemove = (k) => this.veg.removeChunk(k);
    this.chunks.onRingChange = (k, rec, ring) => this.veg.setRing(k, ring);
    this.water = makeWater(this.scene);

    this.structMat = makeStructureMaterial();
    this.landmarks = buildLandmarks(this.scene, this.structMat);
    this.settlementMeshes = [];
    this.banners = [];
    this.buildSettlements();
    this.buildLandmarkBanners();
    this.buildCaves();
    this.buildCamps();
  },
  streamChunks(blocking) {
    this.chunks.update(this.player.pos.x, this.player.pos.z, blocking ? 1 : 2);
  },
  updateGroundMemory(dtRaw) {
    const st = this.state;
    // Ground memory texture upload (throttled)
    this.groundTexTimer -= dtRaw;
    if (st.groundDirty && this.groundTexTimer <= 0) {
      shared.uGround.value.needsUpdate = true;
      st.groundDirty = false;
      this.groundTexTimer = 0.4;
    }
    // Vegetation regrowth / burn refresh
    if (st.vegDirtyKeys && st.vegDirtyKeys.size) {
      const k = st.vegDirtyKeys.values().next().value;
      st.vegDirtyKeys.delete(k);
      this.veg.rebuild(k);
    }
  },
  // ------------------------------------------------------------ settlements
  settlementHash(s) {
    return `${s.buildings}|${s.walls}|${s.fields}|${s.abandoned ? 1 : 0}|${s.constructing > 0 ? 1 : 0}|${Math.round(s.prosperity * 5)}`;
  },
  buildSettlements() {
    for (let i = 0; i < this.state.settlements.length; i++) this.rebuildSettlement(i);
  },
  rebuildSettlement(i) {
    const s = this.state.settlements[i];
    const old = this.settlementMeshes[i];
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); if (old.banner) this.scene.remove(old.banner); if (old.authoredHut) releaseStaticWorldAsset(this.assets, this.scene, old.authoredHut); if (old.authoredAxe) releaseStaticWorldAsset(this.assets, this.scene, old.authoredAxe); }
    const { geo, baseY } = buildSettlementGeometry(s, i);
    const mesh = new THREE.Mesh(geo, this.structMat);
    mesh.position.set(s.x, baseY, s.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    let banner = null;
    if (!s.abandoned) {
      banner = makeBanner(FACTIONS[s.banner].color);
      banner.position.set(s.x + 4, baseY + heightAt(s.x + 4, s.z + 4) - baseY, s.z + 4);
      banner.position.y = heightAt(s.x + 4, s.z + 4);
      this.scene.add(banner);
      this.banners.push(banner);
    }
    this.settlementMeshes[i] = { mesh, banner, hash: this.settlementHash(s), bannerFaction: s.banner, baseY, authoredHut: null, authoredAxe: null }; const rec = this.settlementMeshes[i], x = s.x - 12 - i * 2, z = s.z - 7;
    if (this.assets && !globalThis.__LF_RENDERER && !s.abandoned) void acquireStaticWorldAsset(this.assets, this.scene, 'structure.hut.phase1', { name: `world-visual:hut:${s.id}`, position: new THREE.Vector3(x, heightAt(x, z), z), rotationY: i * 0.73, isCurrent: () => this.settlementMeshes[i] === rec && !s.abandoned }).then((record) => { if (record) rec.authoredHut = record; }).catch((error) => console.warn(`[settlement] authored hut unavailable for ${s.id}; procedural family retained`, error?.message || error));
    if (this.assets && !globalThis.__LF_RENDERER && !s.abandoned) void acquireStaticWorldAsset(this.assets, this.scene, 'prop.axe.phase1', { name: `world-visual:axe:${s.id}`, position: new THREE.Vector3(s.x + 3, heightAt(s.x + 3, s.z + 2), s.z + 2), rotationY: i * 0.41, scale: 0.8, isCurrent: () => this.settlementMeshes[i] === rec && !s.abandoned }).then((record) => { if (record) rec.authoredAxe = record; }).catch((error) => console.warn(`[settlement] authored axe unavailable for ${s.id}; procedural work area retained`, error?.message || error));
  },
  buildCaves() {
    this.caves = [];
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const L of LANDMARKS) {
      if (L.kind !== 'cave') continue;
      const floorY = caveFloor(L);
      const glow = new THREE.Mesh(buildCaveGlow(L), glowMat);
      glow.position.set(L.x, floorY, L.z);
      glow.matrixAutoUpdate = false; glow.updateMatrix();
      this.scene.add(glow);
      const light = new THREE.PointLight(0x7fe0d8, 0, 70, 2);
      light.position.set(L.x + Math.cos(L.dir) * L.len * 0.6, floorY + 4, L.z + Math.sin(L.dir) * L.len * 0.6);
      this.scene.add(light);
      this.caves.push({ L, glow, light, floorY });
    }
  },

  buildCamps() {
    this.camps = [];
    for (let i = 0; i < CAMPS.length; i++) {
      const raw = CAMPS[i];
      const [cx, cz] = placeOnLand(raw.id, raw.x, raw.z, 5, 0.2);
      const c = { id: raw.id, x: cx, z: cz };
      CAMPS[i].x = cx; CAMPS[i].z = cz;
      const owner = this.state.regions[regionIndex(c.x, c.z)].owner;
      const mesh = new THREE.Mesh(buildCampGeometry(i * 131 + 7, Math.max(0, owner)), this.structMat);
      mesh.position.set(c.x, heightAt(c.x, c.z), c.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.visible = owner >= 0;
      this.scene.add(mesh);
      const banner = makeBanner(owner >= 0 ? FACTIONS[owner].color : 0x777777);
      banner.position.set(c.x + 5, heightAt(c.x + 5, c.z + 2), c.z + 2);
      banner.visible = owner >= 0;
      this.scene.add(banner);
      this.banners.push(banner);
      this.camps.push({ c, mesh, banner, owner, seed: i * 131 + 7 });
    }
  },

  buildLandmarkBanners() {
    this.landmarkBanners = [];
    for (const lm of this.landmarks) {
      if (lm.L.kind !== 'fortress' && lm.L.kind !== 'cliff') continue;
      const b = makeBanner(0x888888);
      b.position.set(lm.L.x + 10, heightAt(lm.L.x + 10, lm.L.z + 10) + (lm.L.kind === 'fortress' ? 0 : 0), lm.L.z + 10);
      this.scene.add(b);
      this.banners.push(b);
      this.landmarkBanners.push({ L: lm.L, banner: b, faction: -1 });
    }
  },
  syncStructures(dt) {
    for (let i = 0; i < this.state.settlements.length; i++) {
      const s = this.state.settlements[i];
      const rec = this.settlementMeshes[i];
      if (!rec) continue;
      const h = this.settlementHash(s);
      if (h !== rec.hash) { this.rebuildSettlement(i); continue; }
      if (rec.bannerFaction !== s.banner && rec.banner) {
        rec.banner.userData.cloth.material.color.setHex(FACTIONS[s.banner].color);
        rec.bannerFaction = s.banner;
      }
    }
    for (const lb of this.landmarkBanners) {
      const owner = this.state.regions[regionIndex(lb.L.x, lb.L.z)].owner;
      if (owner !== lb.faction) {
        lb.faction = owner;
        lb.banner.visible = owner >= 0;
        if (owner >= 0) lb.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // camps change hands with the region they sit in
    for (const camp of this.camps) {
      const owner = this.state.regions[regionIndex(camp.c.x, camp.c.z)].owner;
      if (owner !== camp.owner) {
        camp.owner = owner;
        this.scene.remove(camp.mesh);
        camp.mesh.geometry.dispose();
        camp.mesh = new THREE.Mesh(buildCampGeometry(camp.seed, Math.max(0, owner)), this.structMat);
        camp.mesh.position.set(camp.c.x, heightAt(camp.c.x, camp.c.z), camp.c.z);
        camp.mesh.castShadow = true; camp.mesh.receiveShadow = true;
        camp.mesh.matrixAutoUpdate = false; camp.mesh.updateMatrix();
        camp.mesh.visible = owner >= 0;
        this.scene.add(camp.mesh);
        camp.banner.visible = owner >= 0;
        if (owner >= 0) camp.banner.userData.cloth.material.color.setHex(FACTIONS[owner].color);
      }
    }
    // cave glow pulses, and its light only burns while the player is inside
    for (const cave of this.caves) {
      const d = Math.hypot(cave.L.x - this.player.pos.x, cave.L.z - this.player.pos.z);
      const near = d < cave.L.len + 40;
      cave.glow.visible = near;
      cave.light.intensity = near ? 3.2 + Math.sin(shared.uTime.value * 1.6) * 0.8 : 0;
    }

    // flag cloth wave
    const t = shared.uTime.value;
    for (const b of this.banners) {
      const c = b.userData.cloth;
      c.rotation.y = Math.sin(t * 2.2 + b.position.x) * 0.35;
      c.scale.x = 1 + Math.sin(t * 3.1 + b.position.z) * 0.06;
    }
  },

};
