// Compare the former all-at-once boot stream with the production near-field
// helper and normal two-chunk frame stream, using real terrain + vegetation.
import * as THREE from 'three';
import { ChunkManager } from '../src/terrain.js';
import { Vegetation } from '../src/veg.js';
import { WorldState } from '../src/worldstate.js';
import { prepareNearField } from '../src/startup.js';

const ROUNDS = 5;
function rig() {
  const state = new WorldState(), scene = new THREE.Scene();
  const chunks = new ChunkManager(scene, state), vegetation = new Vegetation(scene, state);
  chunks.onChunkBuild = (key, rec, ring) => vegetation.buildChunk(key, rec, ring);
  chunks.onChunkRemove = key => vegetation.removeChunk(key);
  chunks.onRingChange = (key, rec, ring) => vegetation.setRing(key, ring);
  chunks.radius = 3;
  return { state, chunks, vegetation };
}
function legacyBoot() {
  const { chunks } = rig();
  const t = performance.now();
  for (let i = 0; i < 60; i++) {
    chunks.update(0, 0, 4);
    if (!chunks.queue.length) break;
  }
  return { ms: performance.now() - t, loaded: chunks.chunks.size };
}
async function stagedBoot() {
  const setup = rig(), { chunks, vegetation } = setup;
  const tasks = [];
  const update = chunks.update.bind(chunks);
  chunks.update = (x, z, budget = 2) => {
    const start = performance.now();
    update(x, z, budget);
    if (budget) tasks.push(performance.now() - start);
  };
  const status = { textContent: '' };
  const t = performance.now();
  const ready = await prepareNearField({ chunks }, setup.state, status);
  const interactiveMs = performance.now() - t;
  const interactiveChunks = chunks.chunks.size;
  while (chunks.queue.length) chunks.update(0, 0, 2);
  tasks.sort((a, b) => a - b);
  return {
    interactiveMs, ready, interactiveChunks, loaded: chunks.chunks.size,
    vegetation: vegetation.chunks.size, maxBatch: tasks.at(-1), medianBatch: tasks[Math.floor(tasks.length / 2)],
    queueEmpty: chunks.queue.length === 0, status: status.textContent,
  };
}
const old = [], next = [];
for (let i = 0; i < ROUNDS; i++) { old.push(legacyBoot()); next.push(await stagedBoot()); }
const median = (arr, key) => arr.map(v => v[key]).sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const beforeMs = median(old, 'ms'), afterInteractive = median(next, 'interactiveMs');
const maxBatch = median(next, 'maxBatch');
console.log(`initial world stream, same 49 real terrain+vegetation chunks (${ROUNDS} rounds):`);
console.log(`  former boot task: ${beforeMs.toFixed(1)} ms synchronous main-thread work before reveal`);
console.log(`  staged: ${median(next, 'interactiveChunks')} near-field chunks ready before reveal (${afterInteractive.toFixed(1)} ms wall to reveal, including yields)`);
console.log(`  largest post-change chunk batch: ${maxBatch.toFixed(1)} ms; ${median(next, 'loaded')} chunks and ${median(next, 'vegetation')} vegetation chunks eventually complete`);
if (process.argv.includes('--assert')) {
  if (old.some(v => v.loaded !== 49)) throw new Error('Legacy control did not stream the expected 49 chunks');
  if (next.some(v => v.ready !== 25 || v.interactiveChunks !== 25 || v.loaded !== 49 || v.vegetation !== 25 || !v.queueEmpty)) {
    throw new Error('Staged startup must reveal with 25 near-field chunks, then complete all terrain/vegetation');
  }
  if (!(maxBatch < beforeMs)) throw new Error('Staged boot still has an all-chunks main-thread task');
  console.log('  near-field first, queue completion, and smaller synchronous batches verified ✓');
}
