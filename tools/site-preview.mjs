// Site preview: renders every landmark (terrain patch + built geometry + glow)
// with a tiny software rasteriser so builders can be checked without WebGL.
// Writes one PNG per site plus a contact sheet.
//   node tools/site-preview.mjs [outDir] [siteId ...]
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { LANDMARKS, heightAt, moistureAt } from '../src/worldgen.js';
import { Builder } from '../src/structures.js';
import { RUIN_BUILDERS } from '../src/ruins.js';
import { WONDER_BUILDERS, buildWonderGlow } from '../src/wonders.js';

const out = resolve(process.argv[2] || '/tmp/lf-sites');
mkdirSync(out, { recursive: true });
const only = process.argv.slice(3);
const W = 640, H = 480;
const builders = { ...RUIN_BUILDERS, ...WONDER_BUILDERS };

function terrainPatch(L, radius, step) {
  const b = new Builder();
  const n = Math.ceil(radius * 2 / step);
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + L.x, z = pos.getZ(i) + L.z;
    const h = heightAt(x, z);
    pos.setY(i, Math.max(h, -0.05));
    const m = moistureAt(x, z);
    colors.push(h < 0.05 ? 0x2f5a63 : h > 100 ? 0x8f8c86 : m > 0.5 ? 0x4c7a3a : 0x7d8f4a);
  }
  geo.computeVertexNormals();
  // one Builder part per colour would be wasteful; colour per-vertex directly
  const g2 = geo.toNonIndexed();
  const col = new Float32Array(g2.attributes.position.count * 3);
  const idx = geo.index.array;
  const c = new THREE.Color();
  for (let i = 0; i < idx.length; i++) { c.set(colors[idx[i]]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  void b;
  return g2;
}

function render(L) {
  const b = new Builder();
  const build = builders[L.kind];
  if (!build) return null;
  const baseY = build(L, b);
  const site = b.build();
  const glow = buildWonderGlow(L, baseY);
  const R = L.kind === 'road' ? L.r + 20 : Math.max(60, L.r * 1.2);
  const terr = terrainPatch(L, R, Math.max(2, R / 60));
  // camera: isometric-ish from the south-east, looking at the site centre
  const centre = new THREE.Vector3(L.x, heightAt(L.x, L.z) + (L.kind === 'chasm' ? -10 : 8), L.z);
  const eye = centre.clone().add(new THREE.Vector3(R * 1.25, R * 0.95, R * 1.25));
  const cam = new THREE.PerspectiveCamera(48, W / H, 1, 5000);
  cam.position.copy(eye); cam.lookAt(centre); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const view = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const light = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  const tris = [];
  const push = (geo, offset, unlit) => {
    const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color, ix = geo.index;
    const count = ix ? ix.count : p.count;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], nn = new THREE.Vector3();
    for (let i = 0; i < count; i += 3) {
      let z = 0, shade = 0, r = 0, g = 0, bb = 0, behind = false;
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const vi = ix ? ix.array[i + k] : i + k;
        v[k].set(p.getX(vi) + offset.x, p.getY(vi) + offset.y, p.getZ(vi) + offset.z);
        const clip = v[k].clone().applyMatrix4(view);
        const wv = v[k].clone().sub(eye);
        if (wv.dot(centre.clone().sub(eye).normalize()) < 2) behind = true;
        pts.push([(clip.x * 0.5 + 0.5) * W, (1 - (clip.y * 0.5 + 0.5)) * H]);
        z += wv.length();
        nn.set(n.getX(vi), n.getY(vi), n.getZ(vi)); shade += Math.max(0, nn.dot(light));
        r += c.getX(vi); g += c.getY(vi); bb += c.getZ(vi);
      }
      if (behind) continue;
      const s = unlit ? 1 : 0.42 + (shade / 3) * 0.65;
      tris.push({ z: z / 3, pts, col: `rgb(${(r / 3 * s * 255) | 0},${(g / 3 * s * 255) | 0},${(bb / 3 * s * 255) | 0})` });
    }
  };
  push(terr, new THREE.Vector3(L.x, 0, L.z), false);
  push(site, new THREE.Vector3(L.x, baseY, L.z), false);
  if (glow) push(glow, new THREE.Vector3(L.x, baseY, L.z), true);
  tris.sort((a, b) => b.z - a.z);
  const cv = createCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = '#9fb6c6'; ctx.fillRect(0, 0, W, H);
  for (const t of tris) {
    ctx.fillStyle = t.col; ctx.strokeStyle = t.col; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(t.pts[0][0], t.pts[0][1]); ctx.lineTo(t.pts[1][0], t.pts[1][1]); ctx.lineTo(t.pts[2][0], t.pts[2][1]); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H - 26, W, 26);
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
  ctx.fillText(`${L.name} · ${L.kind} · ${site.attributes.position.count} verts · baseY ${baseY.toFixed(1)}`, 8, H - 8);
  return cv;
}

const sheets = [];
for (const L of LANDMARKS) {
  if (only.length && !only.includes(L.id)) continue;
  const cv = render(L);
  if (!cv) continue;
  writeFileSync(resolve(out, `${L.id}.png`), cv.toBuffer('image/png'));
  sheets.push(cv);
  console.log('  rendered', L.id);
}
if (sheets.length > 1) {
  const cols = 3, rows = Math.ceil(sheets.length / cols);
  const sheet = createCanvas(W / 2 * cols, H / 2 * rows), ctx = sheet.getContext('2d');
  sheets.forEach((c, i) => ctx.drawImage(c, (i % cols) * W / 2, Math.floor(i / cols) * H / 2, W / 2, H / 2));
  writeFileSync(resolve(out, 'contact-sheet.png'), sheet.toBuffer('image/png'));
}
console.log(` wrote ${sheets.length} previews to ${out}`);
