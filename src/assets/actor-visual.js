import { ClipPlayer } from './animation-runtime.js';
import { AssetManager } from './asset-manager.js';

function clampTimeScale(value) {
  return Math.max(0.05, Math.min(4, Number.isFinite(value) ? value : 1));
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
    timeScale = () => 1,
    label = assetId,
  }) {
    this.gameplayRoot = gameplayRoot;
    this.fallbackRoot = fallbackRoot;
    this.assetManager = assetManager;
    this.assetId = assetId;
    this.localOffsetY = localOffsetY;
    this.rotateY = rotateY;
    this.clipMap = clipMap;
    this.timeScale = timeScale;
    this.label = label;
    this.state = 'idle';
    this.speed = 0;
    this.status = 'loading';
    this.error = null;
    this.handle = null;
    this.root = null;
    this.clipPlayer = null;
    this.activeClipName = null;
    this.disposed = false;
    this.ready = this.load();
  }

  async load() {
    if (!this.assetManager || !this.assetId) {
      this.status = 'fallback';
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
      root.position.y += this.localOffsetY;
      root.rotation.y += this.rotateY;
      root.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      this.gameplayRoot.add(root);
      this.handle = handle;
      this.root = root;
      this.clipPlayer = new ClipPlayer(root, handle.animations);
      this.fallbackRoot.visible = false;
      this.status = 'asset';
      this.applyState();
      return true;
    } catch (error) {
      this.error = error;
      this.status = 'fallback';
      this.fallbackRoot.visible = true;
      console.warn(`[actor-visual] ${this.label} using procedural fallback: ${error?.message || error}`);
      return false;
    }
  }

  preferencesFor(state) {
    if (Object.prototype.hasOwnProperty.call(this.clipMap, state)) return this.clipMap[state];
    if (Object.prototype.hasOwnProperty.call(this.clipMap, 'default')) return this.clipMap.default;
    return [state];
  }

  applyState() {
    if (!this.clipPlayer) return null;
    const preferred = this.preferencesFor(this.state);
    if (preferred === null) {
      if (this.clipPlayer.action) this.clipPlayer.action.paused = true;
      this.activeClipName = this.clipPlayer.action?.getClip()?.name || null;
      return null;
    }
    const clip = this.clipPlayer.play(Array.isArray(preferred) ? preferred : [preferred]);
    if (this.clipPlayer.action) {
      this.clipPlayer.action.paused = false;
      this.clipPlayer.action.timeScale = clampTimeScale(this.timeScale(this.state, this.speed, clip));
    }
    this.activeClipName = clip?.name || null;
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
      error: this.error?.message || null,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clipPlayer?.stop();
    this.clipPlayer = null;
    if (this.root) this.root.removeFromParent();
    if (this.handle) this.assetManager.release(this.handle);
    this.handle = null;
    this.root = null;
    this.fallbackRoot.visible = true;
    this.status = 'disposed';
  }
}


export function createActorAssetManager() {
  const assets = new AssetManager();
  assets.preload(['player.phase1', 'creature.deer.phase1']).catch((error) => {
    console.warn('[assets] Phase 2 warmup fell back to procedural visuals:', error?.message || error);
  });
  return assets;
}

export function attachPlayerVisual(player, world) {
  return new ActorVisual({
    gameplayRoot: player.group,
    fallbackRoot: player.fallbackRoot,
    assetManager: world.assets,
    assetId: 'player.phase1',
    clipMap: { dead: null, default: [] },
    label: 'player',
  });
}

export function attachDeerVisual(actor, world) {
  return new ActorVisual({
    gameplayRoot: actor.group,
    fallbackRoot: actor.fallbackRoot,
    assetManager: world.assets,
    assetId: 'creature.deer.phase1',
    localOffsetY: -actor.def.y,
    clipMap: {
      idle: ['Idle', 'Stand', 'LookAround'],
      wander: ['Run'],
      flee: ['Run'],
      chase: ['Run'],
      charge: ['Run'],
      feed: ['Eat'],
      default: ['Idle', 'Stand'],
    },
    timeScale: (state, speed) => state === 'idle' ? 1 : Math.max(0.45, Math.min(1.25, speed / actor.def.speed)),
    label: 'deer',
  });
}
