import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await sleep(800);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const cases = [
    ['desktop', { width: 1280, height: 800 }],
    ['mobile-viewport', { width: 390, height: 844 }],
  ];
  for (const [name, viewport] of cases) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:8080/asset-probe.html?automation=1', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__LF_ASSET_PROBE?.ready || window.__LF_ASSET_PROBE?.error, null, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const p = window.__LF_ASSET_PROBE;
      if (p.error) return { error: p.error, results: p.results };
      const first = JSON.stringify(p.rendererInfo());
      for (const id of Object.keys(p.results)) await p.show(id);
      await new Promise((r) => setTimeout(r, 250));
      const second = JSON.stringify(p.rendererInfo());
      return { results: p.results, first, second, webgl: !!document.querySelector('#probe-canvas').getContext('webgl2') || !!document.querySelector('#probe-canvas').getContext('webgl') };
    });
    if (result.error) throw new Error(`${name}: ${result.error}`);
    if (!result.webgl) throw new Error(`${name}: WebGL context unavailable`);
    const required = ['prop.axe.phase1','vegetation.pine.phase1','structure.hut.phase1','player.phase1','creature.deer.phase1'];
    for (const id of required) if (!result.results[id]?.meshes) throw new Error(`${name}: ${id} did not render a mesh`);
    if (!result.results['vegetation.pine.phase1'].instanced) throw new Error(`${name}: pine was not exercised as InstancedMesh`);
    for (const id of ['player.phase1','creature.deer.phase1']) {
      const r = result.results[id];
      if (!r.skinned || !r.animations) throw new Error(`${name}: ${id} lacks skinned/animated runtime proof`);
    }
    if (errors.length) throw new Error(`${name} browser errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: `/tmp/lf-phase1-${name}.png`, fullPage: true });
    console.log(`BROWSER PASS ${name}`, JSON.stringify(result.results));
    await page.close();
  }
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
