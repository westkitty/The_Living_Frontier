import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(root, 'asset-policy.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, policy.manifest), 'utf8'));
const groups = new Map();

for (const asset of manifest.assets) {
  if (typeof asset.streamGroup !== 'string' || !asset.streamGroup.trim()) {
    throw new Error(`missing stream group: ${asset.id}`);
  }
  if (!Number.isInteger(asset.bytes) || asset.bytes <= 0) {
    throw new Error(`invalid byte budget metadata: ${asset.id}`);
  }
  if (!Number.isInteger(asset.memoryBudgetBytes) || asset.memoryBudgetBytes < asset.bytes) {
    throw new Error(`invalid memory budget metadata: ${asset.id}`);
  }
  if (typeof asset.disposalPolicy !== 'string' || !asset.disposalPolicy.includes('refcount')) {
    throw new Error(`non-refcount disposal policy: ${asset.id}`);
  }
  const current = groups.get(asset.streamGroup) || { count: 0, bytes: 0, memoryBudgetBytes: 0 };
  current.count += 1;
  current.bytes += asset.bytes;
  current.memoryBudgetBytes += asset.memoryBudgetBytes;
  groups.set(asset.streamGroup, current);
}

const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
console.log('ASSET RUNTIME GROUP AUDIT PASS');
for (const [group, totals] of ordered) {
  console.log(`  ${group}: ${totals.count} assets, ${totals.bytes} runtime bytes, ${totals.memoryBudgetBytes} memory budget bytes`);
}
