import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const changed = (a, b, epsilon = 0.01) => Math.abs(a - b) > epsilon;
const near = (a, b, epsilon = 0.03) => Math.abs(a - b) <= epsilon;

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
      for (const id of Object.keys(p.results)) await p.show(id);
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.querySelector('#probe-canvas');
      return {
        results: p.results,
        manager: p.assetManagerStats(),
        renderer: p.rendererInfo(),
        webgl: !!canvas.getContext('webgl2') || !!canvas.getContext('webgl'),
        pngLength: canvas.toDataURL('image/png').length,
      };
    });

    if (result.error) throw new Error(`${name}: ${result.error}`);
    if (!result.webgl) throw new Error(`${name}: WebGL context unavailable`);
    if (result.pngLength < 8000) throw new Error(`${name}: rendered canvas evidence is suspiciously small/blank (${result.pngLength})`);

    const required = ['prop.axe.phase1','vegetation.pine.phase1','structure.hut.phase1','player.phase1','creature.deer.phase1'];
    for (const id of required) if (!result.results[id]?.meshes) throw new Error(`${name}: ${id} did not render a mesh`);
    if (!result.results['vegetation.pine.phase1'].instanced) throw new Error(`${name}: pine was not exercised as InstancedMesh`);
    for (const id of ['player.phase1','creature.deer.phase1']) {
      const r = result.results[id];
      if (!r.skinned || !r.animations) throw new Error(`${name}: ${id} lacks skinned/animated runtime proof`);
    }

    for (const id of ['player.phase1','creature.deer.phase1']) {
      await page.evaluate((assetId) => window.__LF_ASSET_PROBE.show(assetId), id);
      await page.waitForTimeout(60);
      const anim0 = await page.evaluate(() => window.__LF_ASSET_PROBE.animationState());
      await page.waitForTimeout(260);
      const anim1 = await page.evaluate(() => window.__LF_ASSET_PROBE.animationState());
      if (!anim0.clip || !anim0.running || !anim1.running || Math.abs(anim1.time - anim0.time) < 0.01) {
        throw new Error(`${name}: ${id} animation mixer did not demonstrably advance: ${JSON.stringify({ anim0, anim1 })}`);
      }
    }

    const canvas = page.locator('#probe-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${name}: probe canvas has no layout box`);

    const camera0 = await page.evaluate(() => window.__LF_ASSET_PROBE.cameraState());
    await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.60, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const cameraOrbit = await page.evaluate(() => window.__LF_ASSET_PROBE.cameraState());
    if (!changed(camera0.yaw, cameraOrbit.yaw) && !changed(camera0.pitch, cameraOrbit.pitch)) {
      throw new Error(`${name}: orbit drag did not change camera orientation`);
    }

    await canvas.hover();
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(80);
    const cameraZoom = await page.evaluate(() => window.__LF_ASSET_PROBE.cameraState());
    if (!changed(cameraOrbit.distance, cameraZoom.distance)) throw new Error(`${name}: wheel zoom did not change camera distance`);

    await page.click('#probe-reset');
    await page.waitForTimeout(80);
    const cameraReset = await page.evaluate(() => window.__LF_ASSET_PROBE.cameraState());
    if (!(near(cameraReset.yaw, 0.75) && near(cameraReset.pitch, 0.34) && near(cameraReset.distance, 7))) {
      throw new Error(`${name}: reset camera did not restore defaults: ${JSON.stringify(cameraReset)}`);
    }

    const shot = await canvas.screenshot({ path: `/tmp/lf-phase1-${name}.png` });
    if (shot.length < 8000) throw new Error(`${name}: canvas screenshot is suspiciously small/blank (${shot.length} bytes)`);

    const lifecycle = await page.evaluate(async () => {
      const p = window.__LF_ASSET_PROBE;
      const before = p.rendererInfo();
      const disposed = await p.disposeProbe();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = p.rendererInfo();
      return { before, disposed, after };
    });
    if (lifecycle.disposed.assetManager.cached !== 0 || lifecycle.disposed.assetManager.references !== 0) {
      throw new Error(`${name}: asset manager did not release cache/refs: ${JSON.stringify(lifecycle.disposed.assetManager)}`);
    }
    if (lifecycle.after.memory.geometries > lifecycle.before.memory.geometries || lifecycle.after.memory.textures > lifecycle.before.memory.textures) {
      throw new Error(`${name}: renderer resource counters grew after teardown`);
    }

    if (errors.length) throw new Error(`${name} browser errors: ${errors.join(' | ')}`);
    console.log(`BROWSER PASS ${name}`, JSON.stringify({ assets: result.results, lifecycle }));
    await page.close();
  }

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
