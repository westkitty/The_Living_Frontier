import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const validator = require('gltf-validator');
const root = process.cwd();
const manifestPath = path.join(root, 'docs/resources/VISUAL_ASSET_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const reports = [];
let errors = 0;
let warnings = 0;

for (const asset of manifest.assets) {
  const file = path.resolve(path.dirname(manifestPath), asset.uri);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const report = await validator.validateBytes(bytes, {
    uri: asset.uri,
    format: 'glb',
    writeTimestamp: false,
    maxIssues: 0,
  });
  const issueCounts = {
    errors: report.issues?.numErrors || 0,
    warnings: report.issues?.numWarnings || 0,
    infos: report.issues?.numInfos || 0,
    hints: report.issues?.numHints || 0,
  };
  errors += issueCounts.errors;
  warnings += issueCounts.warnings;
  reports.push({
    id: asset.id,
    uri: asset.uri,
    bytes: asset.bytes,
    issueCounts,
    issues: report.issues?.messages || [],
    info: report.info || null,
  });
  console.log(`KHRONOS GLTF ${asset.id}: ${issueCounts.errors} errors, ${issueCounts.warnings} warnings, ${issueCounts.infos} infos, ${issueCounts.hints} hints`);
}

const output = {
  schemaVersion: 1,
  validatorVersion: validator.version(),
  generatedFromManifest: 'docs/resources/VISUAL_ASSET_MANIFEST.json',
  totals: { assets: reports.length, errors, warnings },
  reports,
};
const outPath = path.join(root, 'docs/resources/validation/gltf-validator-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

if (errors) throw new Error(`Khronos glTF validation failed with ${errors} error(s)`);
console.log(`KHRONOS GLTF VALIDATION PASS — ${reports.length} assets, ${errors} errors, ${warnings} warning(s).`);
