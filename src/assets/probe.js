import * as THREE from 'three';
import { AssetManager } from './asset-manager.js';
import { ClipPlayer } from './animation-runtime.js';

const ids = [
  ['prop.axe.phase1', 'Static prop'],
  ['vegetation.pine.phase1', 'Instanced pine'],
  ['structure.hut.phase1', 'Modular structure'],
  ['player.phase1', 'Animated player'],
  ['creature.deer.phase1', 'Animated deer'],
];

const canvas = document.querySelector('#probe-canvas');
const status = document.querySelector('#probe-status');
const details = document.querySelector('#probe-details');
const buttons = document.querySelector('#probe-buttons');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111713);
scene.add(new THREE.HemisphereLight(0xe8eadb, 0x263026, 2.1));
const key = new THREE.DirectionalLight(0xfff0d0, 2.6);
key.position.set(5, 9, 7); scene.add(key);
const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x263329, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
let yaw = 0.75, pitch = 0.34, distance = 7, drag = null;
const clock = new THREE.Clock();
const assets = new AssetManager();
let current = null, clipPlayer = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function updateCamera() {
  const cp = Math.cos(pitch);
  camera.position.set(Math.sin(yaw) * cp * distance, 1.3 + Math.sin(pitch) * distance, Math.cos(yaw) * cp * distance);
  camera.lookAt(0, 1.15, 0);
}
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.008;
  pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag[1]) * 0.006, -0.15, 1.05);
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); distance = THREE.MathUtils.clamp(distance + e.deltaY * 0.006, 2.4, 14); }, { passive: false });
document.querySelector('#probe-reset').addEventListener('click', () => { yaw = 0.75; pitch = 0.34; distance = 7; });

function stats(root, animations) {
  let meshes = 0, skinned = 0, triangles = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skinned++;
    const g = o.geometry;
    triangles += g?.index ? g.index.count / 3 : (g?.attributes?.position?.count || 0) / 3;
  });
  return { meshes, skinned, triangles: Math.round(triangles), animations: animations.length };
}

function buildInstancedPreview(root) {
  root.updateMatrixWorld(true);
  const group = new THREE.Group();
  const offsets = [-2.2, -1.1, 0, 1.1, 2.2];
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh) return;
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, offsets.length);
    for (let i = 0; i < offsets.length; i++) {
      const t = new THREE.Matrix4().makeTranslation(offsets[i], 0, (i % 2) * 0.45 - 0.2);
      inst.setMatrixAt(i, t.multiply(mesh.matrixWorld));
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });
  return group;
}

async function show(id) {
  status.textContent = `Loading ${id}…`;
  clipPlayer?.stop(); clipPlayer = null;
  if (current) { scene.remove(current.display); assets.release(current.handle); current = null; }
  const handle = await assets.acquire(id);
  const display = id === 'vegetation.pine.phase1' ? buildInstancedPreview(handle.root) : handle.root;
  scene.add(display);
  const s = stats(handle.root, handle.animations);
  if (id === 'player.phase1') {
    clipPlayer = new ClipPlayer(handle.root, handle.animations); clipPlayer.play(['idle', 'walk', 'run']);
  } else if (id === 'creature.deer.phase1') {
    clipPlayer = new ClipPlayer(handle.root, handle.animations); clipPlayer.play(['idle', 'walk', 'run', 'action']);
  }
  current = { handle, display };
  status.textContent = id;
  details.textContent = `${s.meshes} mesh(es) · ${s.skinned} skinned · ${s.triangles.toLocaleString()} triangles · ${s.animations} animation(s)`;
  const result = { id, ...s, instanced: id === 'vegetation.pine.phase1' ? display.children.some((o) => o.isInstancedMesh) : null };
  window.__LF_ASSET_PROBE.results[id] = result;
  return result;
}

window.__LF_ASSET_PROBE = { ready: false, results: {}, show };
for (const [id, label] of ids) {
  const b = document.createElement('button');
  b.textContent = label; b.addEventListener('click', () => show(id).catch(fail)); buttons.appendChild(b);
}
function fail(error) {
  console.error(error); status.textContent = 'FAILED'; details.textContent = error?.message || String(error);
  window.__LF_ASSET_PROBE.error = details.textContent;
}
async function verifyAll() {
  await assets.loadManifest();
  for (const [id] of ids) await show(id);
  window.__LF_ASSET_PROBE.ready = true;
  status.textContent = 'Phase 1 probe ready';
}
verifyAll().catch(fail);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  clipPlayer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
