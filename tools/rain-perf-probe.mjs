// Matched 100-second 60 Hz storm workload: the old CPU particle loop against
// the actual GPU-drift rain system. Attribute versions prove upload requests;
// transfer bytes are the position buffer's exact Float32Array size.
import * as THREE from 'three';
import { makeRain, updateRain } from '../src/fx-rain.js';

const COUNT = 2200, FRAMES = 6000, ROUNDS = 5, DT = 1 / 60;
const weather = { type: 'storm', intensity: 0.82, windSpeed: 0.74, windDir: 1.1 };
const player = { x: -604, y: 14, z: -952 };
const initial = new Float32Array(COUNT * 3);
const velocity = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  initial[i * 3] = (Math.random() - 0.5) * 90;
  initial[i * 3 + 1] = Math.random() * 46;
  initial[i * 3 + 2] = (Math.random() - 0.5) * 90;
  velocity[i] = 22 + Math.random() * 18;
}
const oldPositions = initial.slice();
const oldAttribute = new THREE.BufferAttribute(oldPositions, 3);
const oldMaterial = new THREE.PointsMaterial({ color: 0xaac4d8, size: 0.26, transparent: true, opacity: 0, depthWrite: false, fog: true });
const oldObject = { visible: false, position: new THREE.Vector3() };
function legacyUpdate() {
  const precipitation = weather.type === 'rain' || weather.type === 'storm' ? weather.intensity : 0;
  oldMaterial.opacity = Math.min(0.8, precipitation * 0.55);
  oldMaterial.size = 0.3;
  oldMaterial.color.setHex(0x9fb8cc);
  if (oldMaterial.opacity <= 0.01) { oldObject.visible = false; return; }
  oldObject.visible = true;
  oldObject.position.set(player.x, player.y, player.z);
  const wx = Math.cos(weather.windDir) * weather.windSpeed * 8;
  const wz = Math.sin(weather.windDir) * weather.windSpeed * 8;
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3;
    oldPositions[j + 1] -= velocity[i] * DT;
    oldPositions[j] += wx * DT;
    oldPositions[j + 2] += wz * DT;
    if (oldPositions[j + 1] < -6) {
      oldPositions[j + 1] = 42;
      oldPositions[j] = (Math.random() - 0.5) * 90;
      oldPositions[j + 2] = (Math.random() - 0.5) * 90;
    }
  }
  oldAttribute.needsUpdate = true;
}
function measure(policy) {
  const times = [];
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    for (let i = 0; i < FRAMES; i++) policy();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[2];
}
const oldMs = measure(legacyUpdate);
const legacyUploads = oldAttribute.version;
const scene = new THREE.Scene();
const rain = makeRain(scene);
const position = rain.points.geometry.attributes.position;
const velocityAttribute = rain.points.geometry.attributes.aRainVelocity;
const startVersion = position.version;
const newMs = measure(() => updateRain(rain, weather, DT, player));
const newUploads = position.version - startVersion;
const oldBytes = COUNT * 3 * Float32Array.BYTES_PER_ELEMENT * FRAMES;
console.log(`storm particles, same ${FRAMES} frames × ${ROUNDS} rounds, ${COUNT} rain points:`);
console.log(`  CPU baseline: ${oldMs.toFixed(2)} ms median/round, ${Math.round(legacyUploads / ROUNDS)} position-buffer dirty marks/round`);
console.log(`  GPU drift:    ${newMs.toFixed(2)} ms median/round, ${newUploads} position-buffer dirty marks/round`);
console.log(`  nominal position transfer requests avoided: ${(oldBytes / 1e6).toFixed(1)} MB per 100 s at 60 Hz`);
if (process.argv.includes('--assert')) {
  if (newUploads !== 0 || position.version !== startVersion) throw new Error('Rain position buffers must remain static during GPU animation');
  if (velocityAttribute.version !== 0 || !rain.points.visible || rain.uniforms.uRainFall.value <= 0) throw new Error('Rain shader inputs did not advance');
  const fall = rain.uniforms.uRainFall.value;
  const drift = rain.uniforms.uRainDrift.value.clone();
  updateRain(rain, { ...weather, type: 'snow' }, DT, player);
  if (Math.abs(rain.uniforms.uRainFall.value - fall - DT * 0.18) > 1e-10) throw new Error('Snow fall rate changed');
  if (!(rain.uniforms.uRainDrift.value.distanceTo(drift) > 0)) throw new Error('Snow wind drift stopped');
  const frozenAt = rain.uniforms.uRainFall.value;
  updateRain(rain, { ...weather, type: 'clear' }, DT, player);
  if (rain.points.visible || rain.uniforms.uRainFall.value !== frozenAt) throw new Error('Clear weather should hide and freeze precipitation');
  console.log('  rain/snow drift, clear-weather freeze and static GPU buffers verified ✓');
}
