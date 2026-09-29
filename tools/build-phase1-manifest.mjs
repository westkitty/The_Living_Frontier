import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const sourceHashesPath = process.argv[2];
if (!sourceHashesPath) throw new Error('usage: node tools/build-phase1-manifest.mjs <source-hashes.json>');
const sourceHashes = JSON.parse(fs.readFileSync(sourceHashesPath, 'utf8'));

const specs = [
  {
    id: 'prop.axe.phase1', type: 'model', file: 'props/axe.glb',
    source: 'props', licenseRecordId: 'quaternius-fantasy-props-megakit-cc0',
    provenanceRecordId: 'quaternius-fantasy-props-megakit',
    presentation: { targetMaxDimension: 1.2, ground: true, centerXZ: true },
    maxBytes: 2097152,
  },
  {
    id: 'vegetation.pine.phase1', type: 'model', file: 'vegetation/pine.glb',
    source: 'nature', licenseRecordId: 'quaternius-stylized-nature-megakit-cc0',
    provenanceRecordId: 'quaternius-stylized-nature-megakit',
    presentation: { targetHeight: 10, ground: true, centerXZ: true },
    maxBytes: 2097152,
  },
  {
    id: 'structure.hut.phase1', type: 'model', file: 'structures/hut.glb',
    source: 'village', licenseRecordId: 'quaternius-medieval-village-pack-cc0',
    provenanceRecordId: 'quaternius-medieval-village-pack',
    presentation: { targetHeight: 6, ground: true, centerXZ: true },
    maxBytes: 2097152,
  },
  {
    id: 'player.phase1', type: 'model', file: 'characters/player.glb',
    source: 'human', licenseRecordId: 'quaternius-animated-human-cc0',
    provenanceRecordId: 'quaternius-animated-human',
    presentation: { targetHeight: 1.8, ground: true, centerXZ: true },
    maxBytes: 8388608, requireSkin: true, requireAnimation: true,
  },
  {
    id: 'creature.deer.phase1', type: 'model', file: 'creatures/deer.glb',
    source: 'deer', licenseRecordId: 'cdmir-deer-female-cc0',
    provenanceRecordId: 'cdmir-deer-female',
    presentation: { targetHeight: 1.5, ground: true, centerXZ: true },
    maxBytes: 8388608, requireSkin: true, requireAnimation: true,
  },
];

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

function inspectGlb(buf) {
  if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB');
  if (buf.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('GLB declared length mismatch');
  let offset = 12, json = null;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + len > buf.length) throw new Error('GLB chunk exceeds file');
    if (type === 0x4E4F534A) json = JSON.parse(buf.toString('utf8', offset, offset + len).trim());
    offset += len;
  }
  if (!json || json.asset?.version?.[0] !== '2') throw new Error('missing glTF 2 JSON');
  const externalUris = [];
  for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith('data:')) externalUris.push(b.uri);
  for (const i of json.images || []) if (i.uri && !i.uri.startsWith('data:')) externalUris.push(i.uri);
  const primitives = (json.meshes || []).reduce((n, m) => n + (m.primitives?.length || 0), 0);
  return {
    nodes: json.nodes?.length || 0,
    meshes: json.meshes?.length || 0,
    primitives,
    materials: json.materials?.length || 0,
    textures: json.textures?.length || 0,
    images: json.images?.length || 0,
    skins: json.skins?.length || 0,
    animations: json.animations?.length || 0,
    externalUris,
  };
}

const assets = specs.map((spec) => {
  const abs = path.join(root, 'assets/runtime', spec.file);
  const buf = fs.readFileSync(abs);
  const stats = inspectGlb(buf);
  if (buf.length > spec.maxBytes) throw new Error(`${spec.id} is ${buf.length} bytes, over ${spec.maxBytes}`);
  if (stats.externalUris.length) throw new Error(`${spec.id} has external GLB URIs: ${stats.externalUris.join(', ')}`);
  if (!stats.meshes) throw new Error(`${spec.id} contains no meshes`);
  if (spec.requireSkin && !stats.skins) throw new Error(`${spec.id} contains no skin`);
  if (spec.requireAnimation && !stats.animations) throw new Error(`${spec.id} contains no animation`);
  const sourceHash = sourceHashes[spec.source];
  if (!sourceHash) throw new Error(`missing source hash for ${spec.source}`);
  return {
    id: spec.id,
    type: spec.type,
    uri: `../../assets/runtime/${spec.file}`,
    sourceHash: `sha256:${sourceHash}`,
    runtimeHash: sha256(buf),
    bytes: buf.length,
    dependencies: [],
    preload: false,
    streamGroup: 'phase1-probe',
    memoryBudgetBytes: spec.maxBytes * 4,
    licenseRecordId: spec.licenseRecordId,
    provenanceRecordId: spec.provenanceRecordId,
    disposalPolicy: 'asset-manager-refcount-cache',
    presentation: spec.presentation,
    stats,
  };
});
const manifest = {
  schemaVersion: 1,
  project: 'The Living Frontier',
  generatedAt: new Date().toISOString(),
  assets,
};
fs.mkdirSync(path.join(root, 'docs/resources'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/resources/VISUAL_ASSET_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
