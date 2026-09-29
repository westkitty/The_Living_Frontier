import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('python3', ['-m', 'http.server', '8080', '--bind', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function expectAsset(result, id, label) {
  if (result.visual.status !== 'asset') throw new Error(`${label}: asset failed: ${result.visual.error}`);
  if (result.visual.assetId !== id) throw new Error(`${label}: wrong asset ID ${result.visual.assetId}, expected ${id}`);
  if (result.visual.fallbackVisible || !result.rootParent) throw new Error(`${label}: runtime presentation did not replace fallback below gameplay root`);
  if (result.time1 - result.time0 < 0.01) throw new Error(`${label}: animation mixer did not advance`);
}

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
        rootParent: game.player.visual.root?.parent === game.player.group,
        manager: game.assets.stats(),
      };
    });
    if (player.visual.status !== 'asset' || player.visual.assetId !== 'player.phase2') {
      throw new Error(`${name}: production player asset failed: ${JSON.stringify(player.visual)}`);
    }
    if (player.visual.fallbackVisible || !player.rootParent) throw new Error(`${name}: player presentation ownership is wrong`);

    await page.waitForFunction(() => window.GAME && !window.GAME.ui.blocking);
    await page.locator('#gl').focus();
    await page.keyboard.down('w');
    const movement = await page.evaluate(async () => {
      const game = window.GAME;
      if (!game.input.keys.KeyW) throw new Error('real keyboard event did not reach the Input action state');

      // CI requestAnimationFrame cadence is not a movement oracle. Freeze the
      // scheduled loop after proving the real key event arrived, then advance
      // the existing controller at a fixed step from a measured low-slope spot.
      game.renderer.setAnimationLoop(null);
      const { heightAt } = await import('./src/worldgen.js');
      const settlement = game.state.settlements[0];
      let best = { x: settlement.x, z: settlement.z, score: Infinity };
      for (let r = 10; r <= 30; r += 5) {
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2;
          const x = settlement.x + Math.cos(a) * r;
          const z = settlement.z + Math.sin(a) * r;
          const h0 = heightAt(x, z);
          const score = Math.abs(heightAt(x, z - 1) - h0) + Math.abs(heightAt(x, z - 2) - h0);
          if (score < best.score) best = { x, z, score };
        }
      }
      game.player.pos.set(best.x, heightAt(best.x, best.z), best.z);
      game.player.vel.set(0, 0, 0);
      game.player.group.position.copy(game.player.pos);
      game.player.camYaw = 0;
      game.player.yaw = 0;
      const before = game.player.pos.clone();
      const localBefore = game.player.visual.root.position.clone();
      for (let i = 0; i < 90; i++) game.player.update(1 / 60, game.input, game.camera);
      const after = game.player.pos.clone();
      const localAfter = game.player.visual.root.position.clone();

      const stateChecks = {};
      for (const [state, speed, clipToken] of [
        ['idle', 0, 'Idle'], ['walk', 4.6, 'Walk'], ['run', 9.2, 'Run'], ['jump', 0, 'Jump'], ['attack', 0, 'SwordSlash']
      ]) {
        game.player.visual.update(0.02, state, speed);
        const time0 = game.player.visual.clipPlayer?.action?.time || 0;
        game.player.visual.update(0.28, state, speed);
        const time1 = game.player.visual.clipPlayer?.action?.time || 0;
        stateChecks[state] = { clip: game.player.visual.activeClipName, time0, time1, clipToken };
      }
      return {
        inputReachedController: game.input.keys.KeyW,
        selectedSlopeScore: best.score,
        moved: before.distanceTo(after),
        rootMatchesState: game.player.group.position.distanceTo(game.player.pos),
        presentationLocalDrift: localBefore.distanceTo(localAfter),
        stateChecks,
      };
    });
    await page.keyboard.up('w');
    await page.evaluate(() => { window.GAME.input.keys.KeyW = false; });
    if (movement.moved < 0.1) throw new Error(`${name}: authoritative player movement did not advance`);
    if (movement.rootMatchesState > 0.001) throw new Error(`${name}: player render root diverged from gameplay state`);
    if (movement.presentationLocalDrift > 0.001) throw new Error(`${name}: animation presentation mutated gameplay-local placement`);
    for (const [state, record] of Object.entries(movement.stateChecks)) {
      if (record.clip !== record.clipToken || record.time1 - record.time0 < 0.01) {
        throw new Error(`${name}: player ${state} mapping failed: ${JSON.stringify(record)}`);
      }
    }

    const fallback = await page.evaluate(async () => {
      const THREE = await import('three');
      const { ActorVisual } = await import('./src/assets/actor-visual.js');
      const gameplayRoot = new THREE.Group(), fallbackRoot = new THREE.Group();
      gameplayRoot.add(fallbackRoot);
      fallbackRoot.visible = true;
      const visual = new ActorVisual({
        gameplayRoot, fallbackRoot, assetId: 'missing.phase2',
        assetManager: { acquire: async () => { throw new Error('intentional missing asset'); }, release() {} },
        clipMap: { idle: ['Idle'] }, label: 'failure-proof',
      });
      await visual.ready;
      const snapshot = visual.snapshot();
      visual.dispose();
      return snapshot;
    });
    if (fallback.status !== 'fallback' || !fallback.fallbackVisible || !/intentional missing asset/.test(fallback.error || '')) {
      throw new Error(`${name}: explicit load failure did not preserve procedural fallback`);
    }

    const living = await page.evaluate(async () => {
      const game = window.GAME;
      game.actors.spawnTimer = Infinity;
      game.actors.maxAnimals = 0;
      for (const list of [game.actors.animals, game.actors.npcs, game.actors.soldiers, game.actors.corpses]) {
        for (const actor of [...list]) game.actors.remove(actor, list);
      }

      const results = { wildlife: {}, humans: {}, releases: [] };
      const p = game.player.pos;
      const animalCases = [
        ['deer', 'creature.deer.phase2', 'flee', 'Run'],
        ['wolf', 'creature.wolf.phase2', 'chase', 'Walking'],
        ['boar', 'creature.boar.phase2', 'charge', 'attack'],
        ['rabbit', 'creature.rabbit.phase2', 'flee', 'Running'],
      ];
      for (let i = 0; i < animalCases.length; i++) {
        const [kind, id, state, expectedClip] = animalCases[i];
        const beforeRefs = game.assets.stats().references;
        const actor = game.actors.spawnAnimal(kind, p.x + 4 + i * 2, p.z - 5 - i);
        await actor.visual.ready;
        actor.visual.update(0.02, state, actor.def.speed);
        const time0 = actor.visual.clipPlayer?.action?.time || 0;
        actor.visual.update(0.30, state, actor.def.speed);
        const time1 = actor.visual.clipPlayer?.action?.time || 0;
        results.wildlife[kind] = {
          id, expectedClip, visual: actor.visual.snapshot(),
          rootParent: actor.visual.root?.parent === actor.group,
          expectedOffset: -actor.def.y,
          time0, time1, beforeRefs, afterRefs: game.assets.stats().references,
        };
        const beforeRelease = game.assets.stats().references;
        game.actors.remove(actor, game.actors.animals);
        results.releases.push({ label: kind, before: beforeRelease, after: game.assets.stats().references, detached: actor.group.parent !== game.scene });
      }

      const settlement = game.state.settlements[0];
      const humanCases = [
        ['villagerMale', () => game.actors.spawnNPC(settlement, 0), 'human.villager-male.phase2', 'walk', 'Walk'],
        ['villagerFemale', () => game.actors.spawnNPC(settlement, 1), 'human.villager-female.phase2', 'walk', 'Walk'],
      ];
      for (const [label, make, id, state, expectedClip] of humanCases) {
        const actor = make();
        await actor.visual.ready;
        actor.visual.update(0.02, state, 2.2);
        const time0 = actor.visual.clipPlayer?.action?.time || 0;
        actor.visual.update(0.30, state, 2.2);
        const time1 = actor.visual.clipPlayer?.action?.time || 0;
        results.humans[label] = { id, expectedClip, visual: actor.visual.snapshot(), rootParent: actor.visual.root?.parent === actor.group, time0, time1 };
        const beforeRelease = game.assets.stats().references;
        game.actors.remove(actor, game.actors.npcs);
        results.releases.push({ label, before: beforeRelease, after: game.assets.stats().references, detached: actor.group.parent !== game.scene });
      }

      const soldiers = [];
      for (const faction of [0, 1]) {
        const actor = game.actors.spawnSoldier(faction, p.x - 4 - faction * 2, p.z - 7, { target: [p.x, p.z - 15] });
        await actor.visual.ready;
        actor.visual.update(0.02, 'attack', 0);
        const time0 = actor.visual.clipPlayer?.action?.time || 0;
        actor.visual.update(0.30, 'attack', 0);
        const time1 = actor.visual.clipPlayer?.action?.time || 0;
        let tintMaterial = null;
        actor.visual.root.traverse((object) => {
          if (!object.isMesh || tintMaterial) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          tintMaterial = materials.find((material) => material?.name === 'DarkGreen') || null;
        });
        const expectedTint = game.actors.humanMats[faction].color.getHex();
        soldiers.push({
          actor, faction, expectedTint, tintHex: tintMaterial?.color?.getHex?.() ?? null, tintUuid: tintMaterial?.uuid || null,
          visual: actor.visual.snapshot(), rootParent: actor.visual.root?.parent === actor.group, time0, time1,
        });
      }
      results.humans.soldiers = soldiers.map(({ actor, ...record }) => record);
      for (const { actor, faction } of soldiers) {
        const beforeRelease = game.assets.stats().references;
        game.actors.remove(actor, game.actors.soldiers);
        results.releases.push({ label: `soldier-${faction}`, before: beforeRelease, after: game.assets.stats().references, detached: actor.group.parent !== game.scene });
      }

      const twinA = game.actors.spawnNPC(settlement, 20);
      const twinB = game.actors.spawnNPC(settlement, 22);
      await Promise.all([twinA.visual.ready, twinB.visual.ready]);
      twinA.visual.update(0.02, 'walk', 2.2);
      twinB.visual.update(0.02, 'walk', 2.2);
      const a0 = twinA.visual.clipPlayer?.action?.time || 0;
      const b0 = twinB.visual.clipPlayer?.action?.time || 0;
      twinA.visual.update(0.31, 'walk', 2.2);
      const a1 = twinA.visual.clipPlayer?.action?.time || 0;
      const b1 = twinB.visual.clipPlayer?.action?.time || 0;
      results.humans.independence = {
        sameAssetId: twinA.visual.assetId === twinB.visual.assetId,
        distinctMixers: twinA.visual.clipPlayer?.mixer !== twinB.visual.clipPlayer?.mixer,
        distinctActions: twinA.visual.clipPlayer?.action !== twinB.visual.clipPlayer?.action,
        aAdvance: a1 - a0,
        bDrift: b1 - b0,
      };
      for (const actor of [twinA, twinB]) {
        const beforeRelease = game.assets.stats().references;
        game.actors.remove(actor, game.actors.npcs);
        results.releases.push({ label: 'villager-mixer-isolation', before: beforeRelease, after: game.assets.stats().references, detached: actor.group.parent !== game.scene });
      }

      return results;
    });

    for (const [kind, record] of Object.entries(living.wildlife)) {
      expectAsset(record, record.id, `${name} ${kind}`);
      if (record.visual.activeClipName !== record.expectedClip) throw new Error(`${name}: ${kind} mapped to ${record.visual.activeClipName}, expected ${record.expectedClip}`);
      if (Math.abs(record.visual.appliedLocalOffsetY - record.expectedOffset) > 0.001) throw new Error(`${name}: ${kind} presentation offset escaped gameplay root`);
      if (record.afterRefs < record.beforeRefs + 1) throw new Error(`${name}: ${kind} did not acquire an asset reference`);
    }
    for (const release of living.releases) {
      if (release.after !== release.before - 1 || !release.detached) throw new Error(`${name}: ${release.label} despawn leaked presentation ownership`);
    }
    for (const label of ['villagerMale', 'villagerFemale']) {
      const record = living.humans[label];
      expectAsset(record, record.id, `${name} ${label}`);
      if (record.visual.activeClipName !== record.expectedClip) throw new Error(`${name}: ${label} animation mapping failed`);
    }
    const soldiers = living.humans.soldiers;
    if (soldiers.length !== 2) throw new Error(`${name}: soldier integration proof did not create two factions`);
    for (const soldier of soldiers) {
      expectAsset(soldier, soldier.visual.assetId, `${name} soldier faction ${soldier.faction}`);
      if (soldier.visual.activeClipName !== 'SwordSlash') throw new Error(`${name}: soldier attack did not use verified SwordSlash`);
      if (soldier.visual.ownedMaterialCount < 1 || soldier.tintHex !== soldier.expectedTint) throw new Error(`${name}: soldier faction tint is not instance-owned/accurate`);
    }
    if (!soldiers[0].tintUuid || soldiers[0].tintUuid === soldiers[1].tintUuid) throw new Error(`${name}: soldiers share the same mutable faction-tint material`);
    const independence = living.humans.independence;
    if (!independence.sameAssetId || !independence.distinctMixers || !independence.distinctActions || independence.aAdvance < 0.01 || Math.abs(independence.bDrift) > 0.0001) {
      throw new Error(`${name}: independently animated instances do not own isolated playback state: ${JSON.stringify(independence)}`);
    }

    const death = await page.evaluate(async () => {
      const game = window.GAME;
      const p = game.player.pos;
      game.actors.spawnTimer = Infinity;
      const result = {};

      const rabbit = game.actors.spawnAnimal('rabbit', p.x + 3, p.z - 4);
      await rabbit.visual.ready;
      const beforeKillRefs = game.assets.stats().references;
      const hideBefore = game.state.player.inv.hide;
      game.actors.killAnimal(rabbit, true);
      rabbit.visual.update(0.30, 'dead', 0);
      result.rabbit = {
        inCorpses: game.actors.corpses.includes(rabbit),
        stillInScene: rabbit.group.parent === game.scene,
        alive: rabbit.alive,
        visual: rabbit.visual.snapshot(),
        hideBefore,
        beforeKillRefs,
      };
      game.interactTarget = { type: 'carcass', actor: rabbit };
      game.interact();
      game.interact();
      result.rabbit.hideAfter = game.state.player.inv.hide;
      result.rabbit.afterHarvestRefs = game.assets.stats().references;
      result.rabbit.inCorpsesAfter = game.actors.corpses.includes(rabbit);

      const deer = game.actors.spawnAnimal('deer', p.x + 5, p.z - 5);
      const wolf = game.actors.spawnAnimal('wolf', p.x + 8, p.z - 5);
      await Promise.all([deer.visual.ready, wolf.visual.ready]);
      game.actors.killAnimal(deer, false);
      const predBefore = game.state.regions[wolf.region].pred;
      const refsBeforeFeed = game.assets.stats().references;
      wolf.setPos(deer.pos.x + 1, deer.pos.y, deer.pos.z);
      game.actors.update(0.05, game.player);
      result.feeding = {
        corpseConsumed: !game.actors.corpses.includes(deer),
        predatorBenefit: game.state.regions[wolf.region].pred - predBefore,
        refDelta: game.assets.stats().references - refsBeforeFeed,
      };
      game.actors.remove(wolf, game.actors.animals);

      for (const kind of ['wolf', 'boar']) {
        const actor = game.actors.spawnAnimal(kind, p.x + 4, p.z - 6);
        await actor.visual.ready;
        game.actors.killAnimal(actor, false);
        actor.visual.update(0.05, 'dead', 0);
        result[kind] = {
          activeClipName: actor.visual.activeClipName,
          tilt: actor.visual.root?.rotation.z || 0,
          inCorpses: game.actors.corpses.includes(actor),
        };
        game.actors.remove(actor, game.actors.corpses);
      }
      return result;
    });

    if (!death.rabbit.inCorpses || !death.rabbit.stillInScene || death.rabbit.alive) throw new Error(`${name}: killed rabbit did not become an in-scene carcass presentation`);
    if (!/Dying|Dead/i.test(death.rabbit.visual.activeClipName || '')) throw new Error(`${name}: rabbit death did not use a verified death clip`);
    if (death.rabbit.hideAfter !== death.rabbit.hideBefore + 1 || death.rabbit.inCorpsesAfter) throw new Error(`${name}: carcass harvest semantics regressed`);
    if (death.rabbit.afterHarvestRefs !== death.rabbit.beforeKillRefs - 1) throw new Error(`${name}: harvested carcass did not release asset ownership`);
    if (!death.feeding.corpseConsumed || death.feeding.predatorBenefit <= 0 || death.feeding.refDelta !== -1) throw new Error(`${name}: predator carcass consumption/regional consequence/lifecycle regressed`);
    for (const kind of ['wolf', 'boar']) {
      if (death[kind].activeClipName !== null || Math.abs(death[kind].tilt) < 0.5 || !death[kind].inCorpses) {
        throw new Error(`${name}: ${kind} should use an explicit static dead pose because its source has no death clip`);
      }
    }

    const showcase = await page.evaluate(async () => {
      const game = window.GAME, p = game.player.pos;
      const actors = [
        game.actors.spawnAnimal('deer', p.x + 3, p.z - 5),
        game.actors.spawnAnimal('wolf', p.x - 3, p.z - 6),
        game.actors.spawnNPC(game.state.settlements[0], 2),
        game.actors.spawnSoldier(2, p.x + 6, p.z - 8, { target: [p.x, p.z - 15] }),
      ];
      await Promise.all(actors.map((actor) => actor.visual?.ready));
      for (const actor of actors) {
        if (actor.visual?.status !== 'asset') throw new Error(`showcase actor fallback: ${actor.kind}`);
      }
      window.__LF_PHASE2_SHOWCASE = actors;
      game.renderer.render(game.scene, game.camera);
      return actors.map((actor) => actor.visual.snapshot());
    });

    const canvas = page.locator('#gl');
    const liveShot = await canvas.screenshot({ path: `/tmp/lf-phase2-${name}-live.png` });
    if (liveShot.length < 8000) throw new Error(`${name}: live-game screenshot is suspiciously small/blank (${liveShot.length} bytes)`);

    const diagnostic = await page.evaluate(async () => {
      const game = window.GAME;
      const actors = window.__LF_PHASE2_SHOWCASE || [];
      const { heightAt } = await import('./src/worldgen.js');
      const p = game.player.pos;
      const centerX = p.x, centerZ = p.z;

      // This is a diagnostic presentation frame, not gameplay state. Keep the
      // terrain and lighting, but hide streamed vegetation so a tree cannot
      // invalidate manual actor review by occluding the entire camera.
      for (const chunk of game.veg.chunks.values()) {
        for (const mesh of Object.values(chunk.meshes || {})) if (mesh) mesh.visible = false;
        if (chunk.grassMesh) chunk.grassMesh.visible = false;
      }

      const placements = [
        [centerX - 4.5, centerZ - 5.5],
        [centerX - 1.5, centerZ - 5.5],
        [centerX + 1.5, centerZ - 5.5],
        [centerX + 4.5, centerZ - 5.5],
      ];
      actors.forEach((actor, i) => {
        const [x, z] = placements[i];
        actor.setPos(x, heightAt(x, z) + actor.def.y, z);
        actor.yaw = Math.PI;
        actor.group.rotation.y = Math.PI;
        actor.visual?.update(0.05, 'idle', 0);
      });

      const playerY = heightAt(centerX, centerZ);
      game.player.pos.set(centerX, playerY, centerZ);
      game.player.group.position.copy(game.player.pos);
      game.player.yaw = Math.PI;
      game.player.group.rotation.y = Math.PI;
      game.player.visual?.update(0.05, 'idle', 0);

      const focusY = playerY + 1.1;
      game.camera.position.set(centerX, playerY + 7.2, centerZ + 13.5);
      game.camera.lookAt(centerX, focusY, centerZ - 4.2);
      game.renderer.render(game.scene, game.camera);
      return {
        player: game.player.visual?.snapshot(),
        actors: actors.map((actor) => actor.visual?.snapshot()),
        camera: game.camera.position.toArray(),
      };
    });

    const diagnosticShot = await canvas.screenshot({ path: `/tmp/lf-phase2-${name}-diagnostic.png` });
    if (diagnosticShot.length < 8000) throw new Error(`${name}: diagnostic actor screenshot is suspiciously small/blank (${diagnosticShot.length} bytes)`);

    if (errors.length) throw new Error(`${name}: browser errors: ${errors.join(' | ')}`);
    console.log(`PHASE2 BROWSER PASS ${name}`, JSON.stringify({
      player, movement, fallback, living, death, showcase, diagnostic,
      screenshotBytes: { live: liveShot.length, diagnostic: diagnosticShot.length },
    }));
    await page.close();
  }

  await browser.close();
} finally {
  server.kill('SIGTERM');
}
