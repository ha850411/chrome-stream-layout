"use strict";
const assert = require("node:assert/strict");

module.exports = async function checkKickSoop(page) {
  let revision = 0;
  let holdNext = null;
  const payload = (number) => ({ livestream: { session_title: `Kick match ${number}` },
    playback_url: `https://fixture.example/kick-${number}.m3u8?token=${number}` });
  const apiPattern = "https://kick.com/api/v2/channels/**";
  await page.route(apiPattern, async (route) => {
    const number = ++revision;
    if (holdNext) { const resolve = holdNext; holdNext = null; resolve({ route, number }); }
    else await route.fulfill({ json: payload(number) });
  });
  await page.evaluate(async () => {
    state.layout = 2; state.language = "zh-TW"; draftUrls = null;
    state.slots = [{ url: "https://kick.com/starladder" }, { url: "https://play.sooplive.co.kr/afstar1/123456" }, { url: "" }, { url: "" }];
    renderControls(); await renderStage(); closeControls();
    window.originalKickFrame = document.querySelector('[data-tile="0"] iframe');
    window.originalSoop = document.querySelector('[data-tile="1"] iframe');
  });
  const kick = () => page.frameLocator('[data-tile="0"] iframe[data-live-player]');
  const body = () => kick().locator('body');
  const live = () => kick().locator('#live');
  const play = () => kick().locator('#centerPlay');
  const centeredPlay = () => play().evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 1 &&
      Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1 &&
      document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#centerPlay') === button;
  });
  const reveal = () => kick().locator('#player').hover({ position: { x: 20, y: 20 } });
  const leave = () => page.locator('[data-splitter="col"]').hover({ position: { x: 7, y: 80 } });
  const waitStatus = (expected, index = 0) => page.waitForFunction(({ expected, index }) => document.querySelector(`[data-tile="${index}"]`).dataset.status === expected, { expected, index });
  const waitToolbar = async (visible) => {
    const frame = await (await page.locator('[data-tile="0"] iframe').elementHandle()).contentFrame();
    try {
      await frame.waitForFunction(visible => ['#controls', '#centerPlay', '.player-shade'].every(selector =>
        getComputedStyle(document.querySelector(selector)).opacity === (visible ? '1' : '0')), visible, { timeout: 5000 });
    } catch (error) {
      console.error('Toolbar state', await frame.evaluate(() => ({
        classes: surface.className, opacity: getComputedStyle(toolbar).opacity,
        centerHover: centerPlayButton.matches(':hover'), surfaceHover: surface.matches(':hover'),
        centerOpacity: getComputedStyle(centerPlayButton).opacity,
        hover: toolbar.matches(':hover'), focus: document.activeElement?.id || document.activeElement?.tagName,
        idleTimer, idleDeadline, now: performance.now(), paused: video.paused
      })));
      throw error;
    }
  };
  const waitSource = (number) => body().evaluate(async (_body, number) => {
    for (let i = 0; i < 100 && !ivsFixture.urls.at(-1)?.includes(`kick-${number}.m3u8`); i++) await new Promise(r => setTimeout(r, 20));
    if (!ivsFixture.urls.at(-1)?.includes(`kick-${number}.m3u8`)) throw Error('Source not applied');
  }, number);
  await waitStatus("sourcePlaying");
  assert.equal(await live().textContent(), "LIVE");
  assert.equal(await page.locator('[data-retry-slot="0"]').getAttribute("hidden"), "");
  assert.equal(await page.locator('[data-slot-title="0"]').textContent(), "Kick match 1");
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.controls, v.muted]), [false, true]);
  assert.equal(await page.evaluate(() => typeof IVSPlayer), "undefined");
  assert.equal(await body().evaluate(() => ivsFixture.instances[0].playCalls), 1, 'autoplay must start only once');
  const pointerMutations = await body().evaluate(() => {
    hideControls();
    const observer = new MutationObserver(() => {});
    observer.observe(surface, { attributes: true, attributeFilter: ['class'] });
    for (let i = 0; i < 120; i++) surface.dispatchEvent(new PointerEvent('pointermove'));
    const count = observer.takeRecords().length;
    observer.disconnect();
    return count;
  });
  assert.equal(pointerMutations, 1, 'pointer activity should reveal controls once, then only extend the idle deadline');
  const resizeWork = await body().evaluate(async () => {
    const player = ivsFixture.instances[0];
    surface.style.width = '640px';
    await new Promise(resolve => setTimeout(resolve, 350));
    const before = player.sizeUpdates.length;
    const start = performance.now();
    for (let i = 1; i <= 60; i++) {
      surface.style.width = `${640 + i}px`;
      await new Promise(requestAnimationFrame);
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    const updates = player.sizeUpdates.slice(before);
    const result = { updates: updates.length, last: updates.at(-1),
      expected: [surface.clientWidth, surface.clientHeight], elapsed: performance.now() - start };
    surface.style.removeProperty('width');
    return result;
  });
  assert.ok(resizeWork.updates > 0 && resizeWork.updates <= Math.ceil(resizeWork.elapsed / 250) + 1,
    `resize work must be bounded: ${JSON.stringify(resizeWork)}`);
  assert.deepEqual(resizeWork.last, resizeWork.expected, 'Auto must receive the final pane size');
  console.log(`PASS: autoplay starts once; 120 pointer events produce ${pointerMutations} class mutation; 60 resizes produce ${resizeWork.updates} SDK updates`);
  // Establish a pointer transition in the new frame before checking leave;
  // the previous platform checks may leave the pointer at the same coordinate.
  await reveal(); await leave(); await waitToolbar(false);
  await reveal(); await waitToolbar(true);
  assert.equal(await page.locator('#viewTools').evaluate(el => el.classList.contains('is-visible')), true, 'dashboard controls reveal with the player');
  await waitToolbar(false);
  assert.equal(await page.locator('#viewTools').evaluate(el => el.classList.contains('is-visible')), false, 'dashboard controls share the player idle dismissal');
  await live().focus(); await waitToolbar(true);
  await body().evaluate(() => document.activeElement.blur()); await waitToolbar(false);
  await reveal(); await waitToolbar(true);
  await leave(); await waitToolbar(false);
  await reveal(); await play().hover();
  await page.waitForTimeout(2400);
  await waitToolbar(true);
  assert.equal(await page.locator('#viewTools').evaluate(el => el.classList.contains('is-visible')), true, 'hovering the player controls keeps dashboard controls visible too');
  await leave(); await waitToolbar(false);
  await kick().locator('#player').focus(); await page.keyboard.press('Tab');
  assert.equal(await body().evaluate(() => document.activeElement.id), 'centerPlay');
  await waitToolbar(true);
  await body().evaluate(() => document.activeElement.blur()); await waitToolbar(false);
  console.log("PASS: center playback controls reveal on hover, stay usable under the pointer and keyboard focus, and hide with the toolbar");

  await reveal();
  assert.equal(await centeredPlay(), true);
  assert.equal(await kick().locator('#controls #play').isVisible(), true, 'the original bottom-left play button stays available');
  assert.equal(await play().getAttribute('aria-label'), '暫停');
  await kick().locator('#video').click({ position: { x: 80, y: 80 } });
  assert.equal(await kick().locator('#video').evaluate(v => v.paused), false, 'clicking the video must not pause playback');
  await kick().locator('#quality').click();
  assert.equal(await kick().getByRole('menuitemradio', { name: '自動', exact: true }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('End');
  assert.equal(await body().evaluate(() => document.activeElement.value), '160p30');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await kick().locator('#quality').getAttribute('value'), '1080p60');
  assert.equal(await kick().locator('#qualityMenu').isVisible(), false);
  assert.equal(await body().evaluate(() => document.activeElement.id), 'quality');
  await kick().locator('#quality').click();
  await page.keyboard.press('Escape');
  assert.equal(await body().evaluate(() => document.activeElement.id), 'quality');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  assert.equal(await kick().locator('#qualityMenu').isVisible(), false);
  assert.equal(await body().evaluate(() => document.activeElement.id), 'fullscreen');
  await kick().locator('#quality').click();
  await kick().locator('#qualityMenu').hover();
  await page.waitForTimeout(2400);
  assert.equal(await kick().locator('#controls').evaluate(el => getComputedStyle(el).opacity), '1');
  await kick().locator('#video').click({ position: { x: 80, y: 80 } });
  assert.equal(await kick().locator('#qualityMenu').isVisible(), false);
  assert.equal(await kick().locator('#video').evaluate(v => v.paused), false);
  console.log('PASS: glass quality menu supports checked selection, keyboard navigation, Escape, Tab and outside-click dismissal without pausing');
  await kick().locator('#mute').click();
  await kick().locator('#volume').fill('0.4');
  await live().click(); await waitSource(2); await waitStatus('sourcePlaying');
  assert.equal(await page.evaluate(() => originalKickFrame === document.querySelector('[data-tile="0"] iframe') && originalSoop.isConnected), true);
  assert.equal(await body().evaluate(() => ivsFixture.instances.length), 1);
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted, v.controls]), [0.4, false, false]);
  assert.equal(await kick().locator('#quality').getAttribute('value'), '1080p60');
  assert.equal(await page.evaluate(() => state.slots[0].quality), '1080p60');
  await reveal(); await play().click(); await waitStatus('sourcePaused');
  assert.equal(await play().getAttribute('aria-label'), '播放直播');
  assert.equal(await kick().locator('#play').getAttribute('aria-label'), '播放直播');
  assert.equal(await play().locator('.play-symbol').isVisible(), true);
  assert.equal(await play().locator('.pause-symbol').isVisible(), false);
  await kick().locator('#video').click({ position: { x: 80, y: 80 } });
  assert.equal(await kick().locator('#video').evaluate(v => v.paused), true, 'clicking the video must not resume playback');
  if (process.env.UI_REVIEW_OUTPUT) {
    await kick().locator('#player').screenshot({ path: require('node:path').join(process.env.UI_REVIEW_OUTPUT, 'player-center-paused.png'), animations: 'disabled' });
  }
  await kick().locator('#play').click(); await waitSource(3); await waitStatus('sourcePlaying');
  assert.equal(await play().getAttribute('aria-label'), '暫停');
  assert.equal(await play().locator('.pause-symbol').isVisible(), true);
  assert.equal(await play().locator('.play-symbol').isVisible(), false);
  await reveal(); await waitToolbar(true);
  if (process.env.UI_REVIEW_OUTPUT) {
    await kick().locator('#player').screenshot({ path: require('node:path').join(process.env.UI_REVIEW_OUTPUT, 'player-center-playing.png'), animations: 'disabled' });
  }
  await reveal(); await kick().locator('#fullscreen').click();
  assert.equal(await body().evaluate(() => document.fullscreenElement?.id), 'player');
  await reveal(); assert.equal(await centeredPlay(), true);
  await body().evaluate(() => document.exitFullscreen());
  console.log("PASS: LIVE and resume fetch the latest stream, reuse one engine, and preserve quality/volume; fullscreen works");

  const soopUrl = "https://play.sooplive.com/afstar1/123456/embed";
  assert.equal(await page.locator('iframe[data-tile-frame="1"]').getAttribute("src"), soopUrl);
  const soop = page.frames().find((frame) => frame.url() === soopUrl);
  await soop.evaluate(async () => {
    const video = document.createElement("video"); video.muted = true;
    video.style.cssText = "width:320px;height:180px"; document.body.replaceChildren(video);
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    video.srcObject = canvas.captureStream(10);
    const paint = () => canvas.getContext("2d").fillRect(0, 0, 320, 180);
    paint(); window.setInterval(paint, 100); await video.play();
  });
  await waitStatus('sourcePlaying', 1);
  await page.evaluate(() => swapSourceSlots(0, 1));
  const swapped = page.frameLocator('[data-tile="1"] iframe');
  await swapped.locator('#video').click({ position: { x: 80, y: 80 } });
  assert.equal(await swapped.locator('#video').evaluate(v => v.paused), false);
  await swapped.locator('#play').click();
  await waitStatus('sourcePaused', 1);
  assert.equal(await page.locator('[data-tile="0"]').getAttribute('data-status'), 'sourcePlaying');
  assert.equal(await page.evaluate(() => originalKickFrame === document.querySelector('[data-tile="1"] iframe')), true);
  await page.evaluate(() => swapSourceSlots(1, 0));

  const heldPromise = new Promise(resolve => { holdNext = resolve; });
  await page.evaluate(() => { window.pendingKickRefresh = retryTiles([0]); });
  const held = await heldPromise;
  assert.equal(await live().isDisabled(), true);
  await page.evaluate(() => retryTiles([0])); await waitSource(5);
  await held.route.fulfill({ json: payload(held.number) }); await page.evaluate(() => pendingKickRefresh);
  assert.equal(await body().evaluate(() => ivsFixture.urls.at(-1)), payload(5).playback_url);
  assert.equal(await body().evaluate(() => ivsFixture.urls.includes('https://fixture.example/kick-4.m3u8?token=4')), false);
  const offlinePromise = new Promise(resolve => { holdNext = resolve; });
  await reveal(); await live().click(); const offline = await offlinePromise;
  await offline.route.fulfill({ json: { livestream: null } }); await waitStatus('sourceOffline');
  assert.equal(await live().isEnabled(), true);
  assert.equal(await kick().locator('#message').getAttribute('data-tone'), 'neutral');
  assert.equal(await kick().locator('#errorActions').isVisible(), true);
  assert.equal(await play().isVisible(), false, 'offline feedback replaces the center play button');
  assert.equal(await kick().locator('#openSource').getAttribute('href'), 'https://kick.com/starladder');
  await reveal(); await kick().locator('#fullscreen').click();
  assert.equal(await body().evaluate(() => document.fullscreenElement?.id), 'player');
  await kick().locator('#editSource').click();
  await page.waitForFunction(() => !controlOverlay.hidden && document.activeElement.dataset.urlInput === '0');
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  assert.equal(await page.locator('[data-url-input="0"]').inputValue(), 'https://kick.com/starladder');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => originalKickFrame.isConnected), false);
  assert.equal(await body().evaluate(() => ivsFixture.instances.length), 0);
  await kick().locator('#retrySource').click(); await waitSource(7); await waitStatus('sourcePlaying');
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted]), [0.4, false]);
  await reveal(); await kick().locator('#volume').fill('0'); await kick().locator('#mute').click();
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted]), [1, false]);
  console.log("PASS: swapped panes report correct status, stale lookups are ignored, and offline sources dispose/recover");

  await page.evaluate(async () => {
    window.keptKick = document.querySelector('[data-tile="0"] iframe'); await renderStage();
    state.language = 'en'; retargetStageTile(document.querySelector('[data-tile="0"]'), 0);
  });
  assert.equal(await page.evaluate(() => keptKick.isConnected), true);
  assert.match(await kick().locator('#quality').getAttribute('aria-label'), /^Stream quality: /);
  assert.equal(await kick().locator('#platform').textContent(), 'Kick');
  assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute('title'), null);
  assert.equal(await kick().locator('#player').getAttribute('title'), null);
  const widths = [180, 320, 381, 480, 720];
  for (const width of widths) {
    await page.evaluate(width => { document.querySelector('[data-tile="0"]').style.width = `${width}px`; }, width);
    await body().evaluate(async (_body, width) => {
      for (let i = 0; i < 100 && innerWidth !== width; i++) await new Promise(requestAnimationFrame);
    }, width);
    await reveal();
    assert.equal(await centeredPlay(), true, `center play button stays clickable at ${width}px`);
    assert.equal(await body().evaluate(() => [...document.querySelectorAll('button, input, select, #platform')].every(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })), true, `controls must fit at ${width}px`);
    if (width <= 380) {
      await reveal();
      assert.equal(await kick().locator('#quality').isVisible(), false);
      await kick().locator('#more').click();
      assert.equal(await kick().locator('#more').getAttribute('aria-expanded'), 'true');
      assert.equal(await play().isVisible(), false, 'the settings panel hides the center button');
      assert.equal(await kick().locator('#playerOptions').evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }), true);
      await kick().locator('#quality').click();
      assert.equal(await kick().locator('#qualityMenu').evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }), true, `quality menu fits at ${width}px`);
      await page.keyboard.press('Escape');
      assert.equal(await kick().locator('#more').getAttribute('aria-expanded'), 'true', 'Escape closes the quality menu before the settings panel');
      await kick().locator('#quality').click();
      await kick().getByRole('menuitemradio', { name: '360p30', exact: true }).click();
      await kick().locator('#volume').fill('0.25');
      assert.equal(await kick().locator('#video').evaluate(v => v.volume), 0.25);
      assert.equal(await page.evaluate(() => state.slots[0].quality), '360p30');
      await page.keyboard.press('Escape');
      assert.equal(await kick().locator('#more').getAttribute('aria-expanded'), 'false');
      assert.equal(await body().evaluate(() => document.activeElement.id), 'more');
    } else assert.equal(await kick().locator('#more').isVisible(), false);
  }
  await page.evaluate(() => {
    const tile = document.querySelector('[data-tile="0"]');
    tile.style.width = '180px'; tile.style.height = '160px';
  });
  await reveal();
  assert.equal(await centeredPlay(), true, 'center play stays clickable in a short pane');
  if (process.env.UI_REVIEW_OUTPUT) {
    await kick().locator('#player').screenshot({ path: require('node:path').join(process.env.UI_REVIEW_OUTPUT, 'player-center-180.png'), animations: 'disabled' });
  }
  await reveal(); await kick().locator('#more').click();
  assert.equal(await kick().locator('#playerOptions').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && el.scrollHeight > el.clientHeight;
  }), true, 'short panes scroll the options panel inside the video bounds');
  if (process.env.UI_REVIEW_OUTPUT) {
    await kick().locator('#player').screenshot({ path: require('node:path').join(process.env.UI_REVIEW_OUTPUT, 'player-options-180.png'), animations: 'disabled' });
  }
  await kick().locator('#quality').click();
  assert.equal(await kick().locator('#qualityMenu').evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.scrollHeight > el.clientHeight;
  }), true, 'long quality menus scroll inside a short pane');
  await page.keyboard.press('End');
  assert.equal(await body().evaluate(() => document.activeElement.value), '160p30');
  assert.ok(await kick().locator('#qualityMenu').evaluate(el => el.scrollTop) > 0);
  await page.keyboard.press('Enter');
  assert.equal(await kick().locator('#quality').getAttribute('value'), '160p30');
  await kick().locator('#fullscreen').click();
  assert.equal(await body().evaluate(() => document.fullscreenElement?.id), 'player');
  await body().evaluate(() => document.exitFullscreen());
  await page.evaluate(() => { document.querySelector('[data-tile="0"]').style.height = ''; });
  await page.evaluate(() => { document.querySelector('[data-tile="0"]').style.width = ''; });
  await page.evaluate(async () => {
    state.slots[0] = { url: 'https://kick.com/starladder?autoplay=false&muted=false' }; await renderStage();
  });
  await waitStatus('sourcePaused');
  await reveal(); await live().click(); await waitStatus('sourcePlaying');
  assert.equal(await kick().locator('#video').evaluate(v => v.muted), false);
  const failingPromise = new Promise(resolve => { holdNext = resolve; });
  await page.evaluate(() => {
    window.beforeFailure = document.querySelector('[data-tile="0"] iframe');
    window.failureReload = retryTiles([0]);
  });
  const failing = await failingPromise;
  await body().evaluate(() => ivsFixture.instances[0].fail());
  await failing.route.fulfill({ json: payload(failing.number) });
  await page.evaluate(() => failureReload);
  await waitStatus('sourcePaused');
  assert.equal(await page.evaluate(() => beforeFailure.isConnected), false);
  assert.equal(await body().evaluate(() => ivsFixture.instances.length), 1);
  await page.evaluate(async () => { state.slots[0] = { url: '' }; await renderStage(); });
  assert.equal(await page.locator('iframe[data-live-player]').count(), 0);
  await page.unroute(apiPattern);
  console.log("PASS: custom controls fit narrow panes, labels update, LIVE overrides no-autoplay, and clearing removes the player page");
};
