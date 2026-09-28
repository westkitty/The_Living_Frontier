// Reproducible CPU/GPU-upload probe for the frame-owned visual effects system.
import * as THREE from 'three';
import { FX } from '../src/fx.js';
import { WorldState } from '../src/worldstate.js';
import { emitSmoke, updateSmokeParticles, updateSparkParticles } from '../src/fx-particles.js';

const state = new WorldState();
const scene = new THREE.Scene();
const renderer = { setClearColor() {} };
const fx = new FX(scene, renderer, state);
const camera = new THREE.PerspectiveCamera();
const player = new THREE.Vector3(0, 20, 0);
const frames = 900;
const warmup = 120;
const rounds = 5;
for (let i = 0; i < warmup; i++) fx.update(1 / 60, camera, player);
const smoke = fx.smoke.geometry.attributes.position;
const sparks = fx.sparks.geometry.attributes.position;
const smokeVersion = smoke.version, sparkVersion = sparks.version;
const originalClone = THREE.Color.prototype.clone;
let colorClones = 0;
THREE.Color.prototype.clone = function (...args) { colorClones++; return originalClone.apply(this, args); };
const medians = [], tails = [];
for (let round = 0; round < rounds; round++) {
  const samples = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    fx.update(1 / 60, camera, player);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  medians.push(samples[Math.floor(samples.length * 0.5)]);
  tails.push(samples[Math.floor(samples.length * 0.95)]);
}
medians.sort((a, b) => a - b); tails.sort((a, b) => a - b);
THREE.Color.prototype.clone = originalClone;
const smokeUploads = smoke.version - smokeVersion, sparkUploads = sparks.version - sparkVersion;
console.log(`idle FX: ${medians[2].toFixed(3)} ms median, ${tails[2].toFixed(3)} ms p95 (median of ${rounds} × ${frames} frames); smoke/spark uploads ${smokeUploads}/${sparkUploads}; THREE.Color.clone calls ${colorClones} over ${rounds * frames} frames`);
if (process.argv.includes('--assert')) {
  if (smokeUploads || sparkUploads) throw new Error('Idle smoke/spark buffers should not upload without live particles');
  if (colorClones) throw new Error('Frame-time sky interpolation should not clone THREE.Color instances');
  const sparkVersion = sparks.version;
  fx.emitSpark(player, 0xffd9a0, 5);
  updateSparkParticles(fx, 1 / 60);
  if (fx.sparkActive.length !== 5 || sparks.version !== sparkVersion + 1) throw new Error('Live sparks must update and upload once');
  updateSparkParticles(fx, 2);
  const expiredSparkVersion = sparks.version;
  if (fx.sparkActive.length !== 0) throw new Error('Expired sparks must leave the active list');
  updateSparkParticles(fx, 1 / 60);
  if (sparks.version !== expiredSparkVersion) throw new Error('Expired spark buffers should stop uploading');

  const smokeVersionBefore = smoke.version;
  emitSmoke(fx, 0, 4, 0);
  updateSmokeParticles(fx, 1 / 60);
  if (fx.smokeActive.length !== 1 || smoke.version !== smokeVersionBefore + 1) throw new Error('Live smoke must update and upload once');
  updateSmokeParticles(fx, 10);
  const expiredSmokeVersion = smoke.version;
  if (fx.smokeActive.length !== 0) throw new Error('Expired smoke must leave the active list');
  updateSmokeParticles(fx, 1 / 60);
  if (smoke.version !== expiredSmokeVersion) throw new Error('Expired smoke buffers should stop uploading');
  console.log('particle lifecycle: live updates, expiration, and idle upload suppression ✓');
}
