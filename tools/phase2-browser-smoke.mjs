import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await sleep(800);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['mobile-viewport', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#boot-status')?.textContent === 'Ready', null, { timeout: 30000 });
    await page.click('#btn-new');
    await page.waitForFunction(() => window.GAME?.player && !document.querySelector('#hud')?.classList.contains('hidden'), null, { timeout: 30000 });
    await page.waitForFunction(() => ['asset', 'fallback'].includes(window.GAME.player.visual?.status), null, { timeout: 30000 });

    const player = await page.evaluate(() => {
      const game = window.GAME;
      return {
        visual: game.player.visual.snapshot(),
        rootName: game.player.visual.root?.name || null,
        childOfGameplayRoot: game.player.visual.root?.parent === game.player.group,
        manager: game.assets.stats(),
      };
    });
    if (player.visual.status !== 'asset') throw new Error(`${name}: player asset failed: ${player.visual.error}`);
    if (player.visual.fallbackVisible || !player.childOfGameplayRoot) throw new Error(`${name}: player visual did not replace fallback as a child presentation`);

    const movement = await page.evaluate(async () => {
      const game = window.GAME;
      const before = game.player.pos.clone();
      const localBefore = game.player.visual.root.position.clone();
      game.input.keys.KeyW = true;
      await new Promise((resolve) => setTimeout(resolve, 420));
      game.input.keys.KeyW = false;
      await new Promise((resolve) => setTimeout(resolve, 80));
      const after = game.player.pos.clone();
      const localAfter = game.player.visual.root.position.clone();
      return {
        moved: before.distanceTo(after),
        rootMatchesState: game.player.group.position.distanceTo(game.player.pos),
        presentationLocalDrift: localBefore.distanceTo(localAfter),
      };
    });
    if (movement.moved < 0.1) throw new Error(`${name}: authoritative player movement did not advance`);
    if (movement.rootMatchesState > 0.001) throw new Error(`${name}: player render root diverged from gameplay state`);
    if (movement.presentationLocalDrift > 0.001) throw new Error(`${name}: animation presentation mutated gameplay-local placement`);

    const deer = await page.evaluate(async () => {
      const game = window.GAME;
      game.actors.maxAnimals = 0;
      for (const actor of [...game.actors.animals]) game.actors.remove(actor, game.actors.animals);
      const beforeRefs = game.assets.stats().references;
      const actor = game.actors.spawnAnimal('deer', game.player.pos.x + 4, game.player.pos.z + 4);
      window.__LF_PHASE2_DEER = actor;
      await actor.visual.ready;
      const afterAcquire = game.assets.stats().references;
      actor.visual.update(0.02, 'flee', actor.def.speed);
      const time0 = actor.visual.clipPlayer?.action?.time || 0;
      actor.visual.update(0.32, 'flee', actor.def.speed);
      const time1 = actor.visual.clipPlayer?.action?.time || 0;
      return {
        visual: actor.visual.snapshot(),
        rootParent: actor.visual.root?.parent === actor.group,
        localY: actor.visual.root?.position.y ?? null,
        expectedLocalY: -actor.def.y,
        beforeRefs,
        afterAcquire,
        time0,
        time1,
      };
    });

    if (deer.visual.status !== 'asset') throw new Error(`${name}: deer asset failed: ${deer.visual.error}`);
    if (deer.visual.fallbackVisible || !deer.rootParent) throw new Error(`${name}: deer did not replace its procedural presentation`);
    if (!/run/i.test(deer.visual.activeClipName || '')) throw new Error(`${name}: deer flee state did not map to verified Run clip: ${deer.visual.activeClipName}`);
    if (deer.time1 - deer.time0 < 0.01) throw new Error(`${name}: deer animation mixer did not advance`);
    if (Math.abs(deer.localY - deer.expectedLocalY) > 0.001) throw new Error(`${name}: deer visual ground offset is not isolated below gameplay root`);
    if (deer.afterAcquire < deer.beforeRefs + 1) throw new Error(`${name}: deer asset reference was not acquired`);

    const canvas = page.locator('#gl');
    const shot = await canvas.screenshot({ path: `/tmp/lf-phase2-${name}.png` });
    if (shot.length < 8000) throw new Error(`${name}: live-game screenshot is suspiciously small/blank (${shot.length} bytes)`);

    const release = await page.evaluate(() => {
      const game = window.GAME;
      const actor = window.__LF_PHASE2_DEER;
      const before = game.assets.stats().references;
      game.actors.remove(actor, game.actors.animals);
      return { before, after: game.assets.stats().references, stillInScene: actor.group.parent === game.scene };
    });
    if (release.after !== release.before - 1 || release.stillInScene) throw new Error(`${name}: deer despawn did not release presentation ownership`);

    if (errors.length) throw new Error(`${name}: browser errors: ${errors.join(' | ')}`);
    console.log(`PHASE2 BROWSER PASS ${name}`, JSON.stringify({ player, movement, deer, release }));
    await page.close();
  }

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
