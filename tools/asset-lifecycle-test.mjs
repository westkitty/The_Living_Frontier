import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetManager } from '../src/assets/asset-manager.js';

const manifest = {
  schemaVersion: 1,
  assets: [{
    id: 'test.lifecycle',
    type: 'model',
    uri: '../../assets/runtime/props/axe.glb',
    bytes: 1,
    memoryBudgetBytes: 1,
    streamGroup: 'test',
    disposalPolicy: 'asset-manager-refcount-cache',
    presentation: { targetHeight: 1, ground: true, centerXZ: true },
  }],
};

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial();
const source = new THREE.Group();
source.add(new THREE.Mesh(geometry, material));

const manager = new AssetManager({ fetchImpl: async () => ({ ok: true, json: async () => manifest }) });
manager.loader = { loadAsync: async () => ({ scene: source, animations: [] }) };

const first = await manager.acquire('test.lifecycle');
const second = await manager.acquire('test.lifecycle');
assert.deepEqual(manager.stats(), { cached: 1, referencedIds: 1, references: 2, records: 1 });

manager.release(first);
assert.equal(manager.stats().references, 1);
await manager.disposeUnused();
assert.equal(manager.stats().cached, 1, 'referenced asset was disposed');

manager.release(second);
await manager.disposeUnused();
assert.deepEqual(manager.stats(), { cached: 0, referencedIds: 0, references: 0, records: 1 });

const third = await manager.acquire('test.lifecycle');
assert.equal(manager.stats().references, 1);
await manager.disposeAll();
assert.deepEqual(manager.stats(), { cached: 0, referencedIds: 0, references: 0, records: 0 });
assert.equal(third.released, false, 'disposeAll must not mutate caller handle state');

console.log('ASSET LIFECYCLE PASS — acquire, shared references, release, unused disposal, and disposeAll verified.');
