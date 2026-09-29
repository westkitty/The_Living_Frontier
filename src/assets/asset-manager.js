import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from '../../vendor/examples/jsm/utils/SkeletonUtils.js';

const MANIFEST_URL = new URL('../../docs/resources/VISUAL_ASSET_MANIFEST.json', import.meta.url);
const RUNTIME_ROOT_URL = new URL('../../assets/runtime/', MANIFEST_URL);

function localRuntimeUri(uri) {
  if (typeof uri !== 'string' || !uri) return false;
  if (/^(?:[a-z]+:)?\/\//i.test(uri) || uri.startsWith('data:')) return false;
  const resolved = new URL(uri, MANIFEST_URL);
  return resolved.origin === MANIFEST_URL.origin && resolved.href.startsWith(RUNTIME_ROOT_URL.href);
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  for (const m of materials) {
    if (!m) continue;
    for (const value of Object.values(m)) {
      if (value?.isTexture) value.dispose();
    }
    m.dispose?.();
  }
}

export class AssetManager {
  constructor({ manifestUrl = MANIFEST_URL, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.manifestUrl = manifestUrl;
    this.fetchImpl = fetchImpl;
    this.loader = new GLTFLoader();
    this.manifest = null;
    this.records = new Map();
    this.cache = new Map();
    this.refs = new Map();
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    const injected = globalThis.__LF_ASSET_MANIFEST;
    const manifest = injected || await this.fetchImpl(this.manifestUrl).then((r) => {
      if (!r.ok) throw new Error(`asset manifest HTTP ${r.status}`);
      return r.json();
    });
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
      throw new Error('unsupported visual asset manifest');
    }
    this.records.clear();
    for (const record of manifest.assets) {
      if (!record?.id || this.records.has(record.id)) throw new Error(`duplicate/invalid asset id: ${record?.id}`);
      if (!localRuntimeUri(record.uri)) throw new Error(`non-local runtime URI for ${record.id}`);
      this.records.set(record.id, record);
    }
    this.manifest = manifest;
    return manifest;
  }

  getRecord(id) {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown asset id: ${id}`);
    return record;
  }

  async _load(id) {
    await this.loadManifest();
    if (!this.cache.has(id)) {
      const record = this.getRecord(id);
      const url = new URL(record.uri, this.manifestUrl).href;
      const pending = this.loader.loadAsync(url).then((gltf) => ({ record, gltf }));
      this.cache.set(id, pending);
      try { await pending; }
      catch (error) {
        this.cache.delete(id);
        const wrapped = new Error(`asset load failed [${id}] at ${url}: ${error?.message || error}`);
        wrapped.cause = error;
        throw wrapped;
      }
    }
    return this.cache.get(id);
  }

  async acquire(id) {
    const { record, gltf } = await this._load(id);
    this.refs.set(id, (this.refs.get(id) || 0) + 1);
    const root = cloneSkeleton(gltf.scene);
    this.applyPresentation(root, record.presentation || {});
    return { id, record, root, animations: gltf.animations || [], released: false };
  }

  applyPresentation(root, presentation) {
    if (presentation.rotateY) root.rotation.y += presentation.rotateY;
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return root;
    const size = box.getSize(new THREE.Vector3());
    const target = presentation.targetHeight || presentation.targetMaxDimension;
    const source = presentation.targetHeight ? size.y : Math.max(size.x, size.y, size.z);
    if (target && source > 1e-6) root.scale.multiplyScalar(target / source);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    if (presentation.ground !== false) root.position.y -= box.min.y;
    const center = box.getCenter(new THREE.Vector3());
    if (presentation.centerXZ !== false) {
      root.position.x -= center.x;
      root.position.z -= center.z;
    }
    root.updateMatrixWorld(true);
    return root;
  }

  release(handle) {
    if (!handle || handle.released) return;
    handle.released = true;
    const n = Math.max(0, (this.refs.get(handle.id) || 1) - 1);
    if (n) this.refs.set(handle.id, n); else this.refs.delete(handle.id);
    handle.root.removeFromParent();
  }

  async preload(ids) { await Promise.all(ids.map((id) => this._load(id))); }

  stats() {
    let references = 0;
    for (const n of this.refs.values()) references += n;
    return { cached: this.cache.size, referencedIds: this.refs.size, references, records: this.records.size };
  }

  async disposeUnused() {
    const pendingDisposals = [];
    for (const [id, pending] of this.cache) {
      if ((this.refs.get(id) || 0) > 0) continue;
      pendingDisposals.push(pending.then(({ gltf }) => {
        const geometries = new Set(), materials = new Set();
        gltf.scene.traverse((o) => {
          if (o.geometry && !geometries.has(o.geometry)) {
            geometries.add(o.geometry); o.geometry.dispose?.();
          }
          if (o.material) {
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) if (!materials.has(m)) { materials.add(m); disposeMaterial(m); }
          }
        });
      }));
      this.cache.delete(id);
    }
    await Promise.allSettled(pendingDisposals);
  }

  async disposeAll() {
    this.refs.clear();
    await this.disposeUnused();
    this.manifest = null;
    this.records.clear();
  }
}
