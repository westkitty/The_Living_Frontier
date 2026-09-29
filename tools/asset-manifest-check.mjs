import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(root, 'asset-policy.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, policy.manifest), 'utf8'));
const licenses = JSON.parse(fs.readFileSync(path.join(root, 'docs/resources/visual-licenses.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'docs/resources/visual-provenance.json'), 'utf8'));
const licenseIds = new Set(licenses.records.map((x) => x.id));
const provenanceIds = new Set(provenance.records.map((x) => x.id));
const ids = new Set();
let total = 0;

function digest(file) {
  const b = fs.readFileSync(file);
  return 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
}
function inspect(file) {
  const b = fs.readFileSync(file);
  if (b.toString('utf8', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) throw new Error(`invalid GLB: ${file}`);
  let o = 12, json;
  while (o + 8 <= b.length) {
    const n = b.readUInt32LE(o), type = b.readUInt32LE(o + 4); o += 8;
    if (o + n > b.length) throw new Error(`bad GLB chunk: ${file}`);
    if (type === 0x4E4F534A) json = JSON.parse(b.toString('utf8', o, o + n).trim());
    o += n;
  }
  if (!json) throw new Error(`missing GLB JSON: ${file}`);
  return json;
}

for (const a of manifest.assets) {
  if (!a.id || ids.has(a.id)) throw new Error(`duplicate/invalid asset id ${a.id}`);
  ids.add(a.id);
  if (/^(?:[a-z]+:)?\/\//i.test(a.uri) || a.uri.startsWith('data:')) throw new Error(`remote/data URI forbidden: ${a.id}`);
  const file = path.resolve(root, 'docs/resources', a.uri);
  if (!file.startsWith(path.resolve(root, policy.runtimeRoot))) throw new Error(`runtime path escapes root: ${a.id}`);
  if (!fs.existsSync(file)) throw new Error(`missing runtime file: ${a.id}`);
  const bytes = fs.statSync(file).size; total += bytes;
  if (bytes !== a.bytes) throw new Error(`byte count mismatch: ${a.id}`);
  if (digest(file) !== a.runtimeHash) throw new Error(`runtime hash mismatch: ${a.id}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(a.sourceHash || '')) throw new Error(`source hash invalid: ${a.id}`);
  if (!licenseIds.has(a.licenseRecordId)) throw new Error(`license record missing: ${a.id}`);
  if (!provenanceIds.has(a.provenanceRecordId)) throw new Error(`provenance record missing: ${a.id}`);
  const json = inspect(file);
  const external = [
    ...(json.buffers || []).map((x) => x.uri).filter(Boolean),
    ...(json.images || []).map((x) => x.uri).filter(Boolean),
  ].filter((u) => !u.startsWith('data:'));
  if (external.length) throw new Error(`external URI in runtime GLB: ${a.id}`);
  if ((a.id === 'player.phase1' || a.id === 'creature.deer.phase1') && !(json.skins?.length && json.animations?.length)) {
    throw new Error(`animated representative lacks skin/animation: ${a.id}`);
  }
  if ((a.id === 'player.phase1' || a.id === 'creature.deer.phase1') &&
      (!Array.isArray(a.stats?.animationNames) || a.stats.animationNames.length !== a.stats.animations)) {
    throw new Error(`animated representative lacks verified clip-name metadata: ${a.id}`);
  }
  if (a.collisionStrategy !== 'none-phase1-probe') throw new Error(`Phase 1 collision policy is not explicit: ${a.id}`);
  if (a.lodGroup !== null) throw new Error(`Phase 1 fixture unexpectedly declares LOD authority: ${a.id}`);
}
for (const id of policy.phase1RequiredIds) if (!ids.has(id)) throw new Error(`required Phase 1 id missing: ${id}`);
if (total > policy.budgets.phase1TotalRuntimeBytes) throw new Error(`Phase 1 runtime bundle ${total} exceeds budget`);
for (const rec of licenses.records) {
  if (!policy.acceptedLicenses.includes(rec.license)) throw new Error(`unaccepted license ${rec.id}`);
  for (const key of ['commercialUse','modificationAllowed','browserDistributionAllowed']) {
    if (policy.requirements[key] && rec[key] !== true) throw new Error(`${rec.id} fails ${key}`);
  }
}
console.log(`ASSET MANIFEST PASS — ${ids.size} assets, ${total} bytes, all local/hash-linked/licensed.`);
