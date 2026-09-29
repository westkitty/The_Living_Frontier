import * as THREE from 'three';
import { ClipPlayer } from './animation-runtime.js';
import { AssetManager } from './asset-manager.js';

function clampTimeScale(value) {
  return Math.max(0.05, Math.min(4, Number.isFinite(value) ? value : 1));
}

function cloneTintedMaterials(root, names, color) {
  if (!names?.length || color === null || color === undefined) return new Set();
  const wanted = new Set(names);
  const clonesBySource = new Map();
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const next = source.map((material) => {
      if (!material || !wanted.has(material.name)) return material;
      if (!clonesBySource.has(material)) {
        const clone = material.clone();
        clone.name = material.name;
        clone.color?.setHex(color);
        clone.needsUpdate = true;
        clonesBySource.set(material, clone);
      }
      return clonesBySource.get(material);
    });
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  return new Set(clonesBySource.values());
}

export class ActorVisual {
  constructor({
    gameplayRoot,
    fallbackRoot,
    assetManager,
    assetId,
    localOffsetY = 0,
    rotateY = 0,
    clipMap = {},
    oneShotStates = [],
    timeScale = () => 1,
    materialTint = null,
    fallbackDeadTilt = 1.25,
    staticDeadTilt = 0,
    label = assetId,
  }) {
    this.gameplayRoot = gameplayRoot;
    this.fallbackRoot = fallbackRoot;
    this.assetManager = assetManager;
    this.assetId = assetId;
    this.localOffsetY = localOffsetY;
    this.rotateY = rotateY;
    this.clipMap = clipMap;
    this.oneShotStates = new Set(oneShotStates);
    this.timeScale = timeScale;
    this.materialTint = materialTint;
    this.fallbackDeadTilt = fallbackDeadTilt;
    this.staticDeadTilt = staticDeadTilt;
    this.label = label;
    this.state = 'idle';
    this.speed = 0;
    this.status = 'loading';
    this.error = null;
    this.handle = null;
    this.root = null;
    this.clipPlayer = null;
    this.activeClipName = null;
    this.ownedMaterials = new Set();
    this.disposed = false;
    this.ready = this.load();
  }

  async load() {
    if (!this.assetManager || !this.assetId) {
      this.status = 'fallback';
      this.applyPose();
      return false;
    }
    try {
      const handle = await this.assetManager.acquire(this.assetId);
      if (this.disposed) {
        this.assetManager.release(handle);
        return false;
      }
      const root = handle.root;
      root.name = `runtime-visual:${this.assetId}`;
      this.presentationBaseY = root.position.y;
      this.presentationBaseRotationZ = root.rotation.z;
      root.position.y += this.localOffsetY;
      root.rotation.y += this.rotateY;
      root.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      if (this.materialTint) {
        this.ownedMaterials = cloneTintedMaterials(root, this.materialTint.names, this.materialTint.color);
      }
      this.gameplayRoot.add(root);
      this.handle = handle;
      this.root = root;
      this.clipPlayer = new ClipPlayer(root, handle.animations);
      this.fallbackRoot.visible = false;
      this.status = 'asset';
      this.applyState();
      this.applyPose();
      return true;
    } catch (error) {
      this.error = error;
      this.status = 'fallback';
      this.fallbackRoot.visible = true;
      this.applyPose();
      console.warn(`[actor-visual] ${this.label} using procedural fallback: ${error?.message || error}`);
      return false;
    }
  }

  preferencesFor(state) {
    if (Object.prototype.hasOwnProperty.call(this.clipMap, state)) return this.clipMap[state];
    if (Object.prototype.hasOwnProperty.call(this.clipMap, 'default')) return this.clipMap.default;
    return [state];
  }

  applyPose() {
    const dead = this.state === 'dead';
    this.fallbackRoot.rotation.z = dead ? this.fallbackDeadTilt : 0;
    if (!this.root) return;
    const staticTilt = dead && this.preferencesFor('dead') === null ? this.staticDeadTilt : 0;
    this.root.rotation.z = (this.presentationBaseRotationZ || 0) + staticTilt;
  }

  applyState() {
    if (!this.clipPlayer) {
      this.applyPose();
      return null;
    }
    const preferred = this.preferencesFor(this.state);
    if (preferred === null) {
      if (this.clipPlayer.action) this.clipPlayer.action.paused = true;
      this.activeClipName = null;
      this.applyPose();
      return null;
    }
    const clip = this.clipPlayer.play(Array.isArray(preferred) ? preferred : [preferred]);
    const action = this.clipPlayer.action;
    if (action) {
      action.paused = false;
      action.timeScale = clampTimeScale(this.timeScale(this.state, this.speed, clip));
      if (this.oneShotStates.has(this.state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }
    }
    this.activeClipName = clip?.name || null;
    this.applyPose();
    return clip;
  }

  update(dt, state = this.state, speed = this.speed) {
    const changed = state !== this.state;
    this.state = state;
    this.speed = speed;
    if (changed) this.applyState();
    else if (this.clipPlayer?.action) {
      this.clipPlayer.action.timeScale = clampTimeScale(this.timeScale(this.state, this.speed, this.clipPlayer.action.getClip()));
    }
    this.applyPose();
    this.clipPlayer?.update(dt);
  }

  snapshot() {
    return {
      assetId: this.assetId,
      status: this.status,
      state: this.state,
      speed: this.speed,
      activeClipName: this.activeClipName,
      fallbackVisible: this.fallbackRoot.visible,
      assetAttached: !!this.root && this.root.parent === this.gameplayRoot,
      appliedLocalOffsetY: this.root ? this.root.position.y - this.presentationBaseY : null,
      ownedMaterialCount: this.ownedMaterials.size,
      tint: this.materialTint?.color ?? null,
      error: this.error?.message || null,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clipPlayer?.stop();
    this.clipPlayer = null;
    if (this.root) this.root.removeFromParent();
    for (const material of this.ownedMaterials) material.dispose?.();
    this.ownedMaterials.clear();
    if (this.handle) this.assetManager.release(this.handle);
    this.handle = null;
    this.root = null;
    this.fallbackRoot.visible = true;
    this.fallbackRoot.rotation.z = 0;
    this.status = 'disposed';
  }
}

export function createActorAssetManager() {
  const assets = new AssetManager();
  assets.preload(['player.phase2']).catch((error) => {
    console.warn('[assets] Phase 2 player warmup fell back to procedural presentation:', error?.message || error);
  });
  return assets;
}

export function attachPlayerVisual(player, world) {
  return new ActorVisual({
    gameplayRoot: player.group,
    fallbackRoot: player.fallbackRoot,
    assetManager: world.assets,
    assetId: 'player.phase2',
    clipMap: {
      idle: ['Idle'],
      walk: ['Walk'],
      run: ['Run'],
      attack: ['SwordSlash'],
      dead: ['Death'],
      default: ['Idle'],
    },
    oneShotStates: ['attack', 'dead'],
    fallbackDeadTilt: 1.5,
    timeScale: (state, speed) => state === 'run' ? Math.max(0.75, Math.min(1.45, speed / 6.2)) : 1,
    label: 'player',
  });
}

const ANIMAL_VISUALS = {
  deer: {
    id: 'creature.deer.phase2',
    clips: {
      idle: ['Idle', 'Stand', 'LookAround.000'],
      wander: ['Run'], flee: ['Run'], chase: ['Run'], charge: ['Run'],
      feed: ['Eat.001'], dead: ['Die.000'], default: ['Idle', 'Stand'],
    },
    oneShot: ['dead'],
  },
  wolf: {
    id: 'creature.wolf.phase2',
    clips: {
      idle: ['Idle'], wander: ['Walking'], flee: ['Walking'], chase: ['Walking'],
      charge: ['Walking'], feed: ['Idle'], dead: null, default: ['Idle'],
    },
    staticDeadTilt: 1.25,
  },
  boar: {
    id: 'creature.boar.phase2',
    clips: {
      idle: ['default'], wander: ['walk'], flee: ['walk'], chase: ['walk'],
      charge: ['attack'], feed: ['default'], dead: null, default: ['default'],
    },
    staticDeadTilt: 1.25,
  },
  rabbit: {
    id: 'creature.rabbit.phase2',
    clips: {
      idle: ['Sitting.000', 'Basic'], wander: ['Running'], flee: ['Running'],
      chase: ['Running'], charge: ['Running'], feed: ['Basic'],
      dead: ['Dying.000', 'Dead'], default: ['Basic'],
    },
    oneShot: ['dead'],
  },
};

export function attachAnimalVisual(actor, world) {
  const config = ANIMAL_VISUALS[actor.kind];
  if (!config) return null;
  return new ActorVisual({
    gameplayRoot: actor.group,
    fallbackRoot: actor.fallbackRoot,
    assetManager: world.assets,
    assetId: config.id,
    localOffsetY: -actor.def.y,
    clipMap: config.clips,
    oneShotStates: config.oneShot || [],
    staticDeadTilt: config.staticDeadTilt || 0,
    timeScale: (state, speed) => state === 'idle' || state === 'dead'
      ? 1 : Math.max(0.5, Math.min(1.5, speed / Math.max(0.1, actor.def.speed))),
    label: actor.kind,
  });
}

const HUMAN_IDS = {
  villager: {
    male: 'human.villager-male.phase2',
    female: 'human.villager-female.phase2',
  },
  soldier: {
    male: 'human.soldier-male.phase2',
    female: 'human.soldier-female.phase2',
  },
};

export function attachHumanVisual(actor, world, {
  role = 'villager',
  variant = 'male',
  tintColor = null,
} = {}) {
  const assetId = HUMAN_IDS[role]?.[variant] || HUMAN_IDS.villager.male;
  return new ActorVisual({
    gameplayRoot: actor.group,
    fallbackRoot: actor.fallbackRoot,
    assetManager: world.assets,
    assetId,
    localOffsetY: -actor.def.y,
    clipMap: {
      idle: ['Idle'], walk: ['Walk'], run: ['Run'], flee: ['Run'],
      attack: ['SwordSlash', 'Punch'], dead: ['Death'], default: ['Idle'],
    },
    oneShotStates: ['attack', 'dead'],
    materialTint: role === 'soldier' && tintColor !== null
      ? { names: ['DarkGreen'], color: tintColor } : null,
    timeScale: (state, speed) => state === 'run'
      ? Math.max(0.75, Math.min(1.4, speed / 3.4))
      : state === 'walk' ? Math.max(0.75, Math.min(1.3, speed / 2.1)) : 1,
    label: `${role}-${variant}`,
  });
}
