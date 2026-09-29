import * as THREE from 'three';

export function findClip(clips, preferred = []) {
  if (!clips?.length) return null;
  const lowered = clips.map((clip) => [clip, (clip.name || '').toLowerCase()]);
  for (const token of preferred) {
    const t = token.toLowerCase();
    const hit = lowered.find(([, name]) => name === t || name.includes(t));
    if (hit) return hit[0];
  }
  return clips[0];
}

export class ClipPlayer {
  constructor(root, clips = []) {
    this.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    this.clips = clips;
    this.action = null;
  }

  play(preferred = ['idle']) {
    if (!this.mixer) return null;
    const clip = findClip(this.clips, preferred);
    if (!clip) return null;
    if (this.action?.getClip() === clip) return clip;
    this.action?.fadeOut(0.12);
    this.action = this.mixer.clipAction(clip);
    this.action.reset().fadeIn(0.12).play();
    return clip;
  }

  update(dt) { this.mixer?.update(dt); }
  stop() {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.action = null;
  }
}
