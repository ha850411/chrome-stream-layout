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
  const reveal = () => kick().locator('#video').hover({ position: { x: 20, y: 20 } });
  const waitStatus = (expected, index = 0) => page.waitForFunction(({ expected, index }) => document.querySelector(`[data-tile="${index}"]`).dataset.status === expected, { expected, index });
  const waitToolbar = async (visible) => {
    const frame = await (await page.locator('[data-tile="0"] iframe').elementHandle()).contentFrame();
    try {
      await frame.waitForFunction(visible => getComputedStyle(document.querySelector('#controls')).opacity === (visible ? '1' : '0'), visible);
    } catch (error) {
      console.error('Toolbar state', await frame.evaluate(() => ({
        classes: surface.className, opacity: getComputedStyle(toolbar).opacity,
        hover: toolbar.matches(':hover'), focus: document.activeElement?.outerHTML,
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
  // Establish a pointer transition in the new frame before checking leave;
  // the previous platform checks may leave the pointer at the same coordinate.
  await reveal(); await page.mouse.move(1400, 950); await waitToolbar(false);
  await reveal(); await waitToolbar(true); await waitToolbar(false);
  await live().focus(); await waitToolbar(true);
  await body().evaluate(() => document.activeElement.blur()); await waitToolbar(false);
  await reveal(); await waitToolbar(true);
  await page.mouse.move(1400, 950); await waitToolbar(false);
  console.log("PASS: IVS is isolated from the dashboard; custom controls auto-hide and support keyboard focus");

  await reveal();
  await kick().locator('#quality').selectOption('1080p60');
  await kick().locator('#mute').click();
  await kick().locator('#volume').fill('0.4');
  await live().click(); await waitSource(2); await waitStatus('sourcePlaying');
  assert.equal(await page.evaluate(() => originalKickFrame === document.querySelector('[data-tile="0"] iframe') && originalSoop.isConnected), true);
  assert.equal(await body().evaluate(() => ivsFixture.instances.length), 1);
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted, v.controls]), [0.4, false, false]);
  assert.equal(await kick().locator('#quality').inputValue(), '1080p60');
  assert.equal(await page.evaluate(() => state.slots[0].quality), '1080p60');
  await reveal(); await kick().locator('#play').click(); await waitStatus('sourcePaused');
  await kick().locator('#play').click(); await waitSource(3); await waitStatus('sourcePlaying');
  await reveal(); await kick().locator('#fullscreen').click();
  assert.equal(await body().evaluate(() => document.fullscreenElement?.id), 'player');
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
  await page.frameLocator('[data-tile="1"] iframe').locator('#video').click();
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
  assert.equal(await page.evaluate(() => originalKickFrame.isConnected), false);
  assert.equal(await body().evaluate(() => ivsFixture.instances.length), 0);
  await reveal(); await live().click(); await waitSource(7); await waitStatus('sourcePlaying');
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted]), [0.4, false]);
  await reveal(); await kick().locator('#volume').fill('0'); await kick().locator('#mute').click();
  assert.deepEqual(await kick().locator('#video').evaluate(v => [v.volume, v.muted]), [1, false]);
  console.log("PASS: swapped panes report correct status, stale lookups are ignored, and offline sources dispose/recover");

  await page.evaluate(async () => {
    window.keptKick = document.querySelector('[data-tile="0"] iframe'); await renderStage();
    state.language = 'en'; retargetStageTile(document.querySelector('[data-tile="0"]'), 0);
  });
  assert.equal(await page.evaluate(() => keptKick.isConnected), true);
  assert.equal(await kick().locator('#quality').getAttribute('aria-label'), 'Stream quality');
  assert.equal(await kick().locator('#platform').textContent(), 'Kick');
  assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute('title'), null);
  assert.equal(await kick().locator('#player').getAttribute('title'), null);
  const widths = [180, 320, 720];
  for (const width of widths) {
    await page.evaluate(width => { document.querySelector('[data-tile="0"]').style.width = `${width}px`; }, width);
    assert.equal(await body().evaluate(() => [...document.querySelectorAll('button, input, select, #platform')].every(el => {
      const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })), true, `controls must fit at ${width}px`);
  }
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
