"use strict";
const assert = require("node:assert/strict");

module.exports = async function checkTwitch(page) {
  const gql = "https://gql.twitch.tv/gql";
  const usher = "https://usher.ttvnw.net/**";
  const kick = "https://kick.com/api/v2/channels/**";
  let revision = 0;
  let playlistStatus = 200;
  let tokenErrors = false;
  let holdNext;
  let remoteNavigations = 0;
  const observe = (request) => {
    if (request.isNavigationRequest() && /https:\/\/(www\.)?(twitch\.tv|player\.twitch\.tv)\//.test(request.url())) remoteNavigations++;
  };
  page.on("request", observe);
  const token = (number) => ({ data: { streamPlaybackAccessToken: {
    value: JSON.stringify({ revision: number, authorization: { forbidden: false } }), signature: `fixture-${number}`
  } } });
  await page.route(gql, async (route) => {
    assert.equal(route.request().postDataJSON().operationName, "PlaybackAccessToken");
    const number = ++revision;
    if (holdNext) { const resolve = holdNext; holdNext = null; resolve({ route, number }); }
    else await route.fulfill({ json: tokenErrors ? { errors: [{ message: "unavailable" }] } : token(number) });
  });
  await page.route(usher, (route) => route.fulfill({ status: playlistStatus, contentType: "application/vnd.apple.mpegurl",
    body: playlistStatus === 200 ? "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://fixture.example/twitch.m3u8\n" : "unavailable" }));
  await page.route(kick, (route) => route.fulfill({ json: { livestream: { session_title: "Kick fixture" }, playback_url: "https://fixture.example/kick.m3u8" } }));
  const waitStatus = (status, index = 0) => page.waitForFunction(({ status, index }) => document.querySelector(`[data-tile="${index}"]`).dataset.status === status, { status, index });
  const player = () => page.frameLocator('[data-tile="0"] iframe[data-live-player]');
  const reveal = () => player().locator("#video").hover({ position: { x: 20, y: 20 } });
  const waitSource = (number) => page.waitForFunction((number) => {
    const url = document.querySelector('[data-tile="0"] iframe')?.contentWindow.ivsFixture?.urls.at(-1);
    return url && JSON.parse(new URL(url).searchParams.get("token")).revision === number;
  }, number);
  const live = async () => {
    const number = revision + 1;
    await reveal(); await player().locator("#live").click();
    try { await waitSource(number); await waitStatus("sourcePlaying"); }
    catch (error) {
      console.error("Twitch fixture state", await page.evaluate(() => ({
        status: document.querySelector('[data-tile="0"]').dataset.status,
        sources: document.querySelector('[data-tile="0"] iframe')?.contentWindow.ivsFixture?.urls,
        message: document.querySelector('[data-tile="0"] iframe')?.contentDocument.querySelector('#message')?.textContent
      })), { expected: number, revision });
      throw error;
    }
  };
  try {
    await page.evaluate(async () => {
      state.layout = 2; state.language = "en"; draftUrls = null;
      state.slots = [{ url: "https://www.twitch.tv/roger9527" }, { url: "https://kick.com/starladder" }, { url: "" }, { url: "" }];
      renderControls(); await renderStage(); closeControls();
      window.originalTwitch = document.querySelector('[data-tile="0"] iframe');
      window.originalKick = document.querySelector('[data-tile="1"] iframe');
    });
    await waitStatus("sourcePlaying"); await waitStatus("sourcePlaying", 1);
    assert.match(await page.locator('[data-tile="0"] iframe').getAttribute("src"), /\/live-player\.html$/);
    assert.equal(await page.locator('[data-retry-slot="0"]').isHidden(), true);
    assert.equal(await page.locator('[data-slot-title="0"]').textContent(), "Twitch · roger9527");
    assert.equal(await player().locator("#platform").textContent(), "Twitch");
    assert.equal(await page.frameLocator('[data-tile="1"] iframe').locator("#platform").textContent(), "Kick");
    assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute("title"), null);
    assert.equal(await player().locator("#player").getAttribute("title"), null);
    assert.equal(await player().locator("#player").getAttribute("aria-label"), "Pane 1");
    assert.equal(await page.evaluate(() => typeof IVSPlayer), "undefined");
    assert.deepEqual(await player().locator("#video").evaluate((v) => [v.controls, v.muted]), [false, true]);
    await reveal(); await player().locator("#quality").selectOption("1080p60");
    await player().locator("#mute").click(); await player().locator("#volume").fill("0.35");
    await live();
    assert.equal(await page.evaluate(() => originalTwitch === document.querySelector('[data-tile="0"] iframe') && originalKick.isConnected), true);
    assert.equal(await player().locator("body").evaluate(() => ivsFixture.instances.length), 1);
    assert.deepEqual(await player().locator("#video").evaluate((v) => [v.volume, v.muted]), [0.35, false]);
    assert.equal(await player().locator("#quality").inputValue(), "1080p60");
    await reveal(); await player().locator("#play").click(); await waitStatus("sourcePaused");
    const resumed = revision + 1;
    await player().locator("#play").click(); await waitSource(resumed); await waitStatus("sourcePlaying");
    const storage = await page.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    assert.equal(storage.includes("usher.ttvnw.net"), false);
    assert.equal(storage.includes("fixture-"), false);
    console.log("PASS: Twitch and Kick share local players; LIVE/resume retain preferences without storing signed sources");

    await page.evaluate(() => swapSourceSlots(0, 1));
    const swapped = page.frameLocator('[data-tile="1"] iframe');
    assert.equal(await swapped.locator("#platform").textContent(), "Twitch");
    assert.equal(await swapped.locator("#player").getAttribute("aria-label"), "Pane 2");
    assert.equal(await page.locator('[data-tile="1"] iframe').getAttribute("title"), null);
    await swapped.locator("#video").hover({ position: { x: 20, y: 20 } });
    await swapped.locator("#play").click(); await waitStatus("sourcePaused", 1);
    assert.equal(await page.locator('[data-tile="0"]').getAttribute("data-status"), "sourcePlaying");
    await page.evaluate(() => swapSourceSlots(1, 0));
    const heldPromise = new Promise((resolve) => { holdNext = resolve; });
    await page.evaluate(() => { window.pendingTwitch = retryTiles([0]); });
    const held = await heldPromise;
    await page.evaluate(() => retryTiles([0]));
    await waitSource(held.number + 1);
    await held.route.fulfill({ json: token(held.number) }); await page.evaluate(() => pendingTwitch);
    assert.equal(await player().locator("body").evaluate((_body, number) => ivsFixture.urls.some((url) => JSON.parse(new URL(url).searchParams.get("token")).revision === number), held.number), false);
    console.log("PASS: Twitch status follows pane swaps and late token responses cannot replace newer streams");

    for (const [responseStatus, status] of [[404, "sourceOffline"], [403, "sourceRestricted"]]) {
      playlistStatus = responseStatus;
      await page.evaluate(() => { window.failedTwitch = document.querySelector('[data-tile="0"] iframe'); });
      await reveal(); await player().locator("#live").click(); await waitStatus(status);
      assert.equal(await page.evaluate(() => failedTwitch.isConnected), false);
      assert.equal(await player().locator("body").evaluate(() => ivsFixture.instances.length), 0);
      assert.equal(await player().locator("#live").isEnabled(), true);
      assert.equal(await page.locator('[data-status-container="0"]').getAttribute("data-tone"), "error");
      const stoppedAt = revision;
      await page.waitForTimeout(2200);
      assert.equal(revision, stoppedAt, "offline/restricted sources must not retry automatically");
      playlistStatus = 200; await live();
      assert.deepEqual(await player().locator("#video").evaluate((v) => [v.volume, v.muted]), [0.35, false]);
      assert.equal(await player().locator("#quality").inputValue(), "1080p60");
    }
    tokenErrors = true;
    await reveal(); await player().locator("#live").click(); await waitStatus("sourceReconnecting");
    tokenErrors = false; await live();
    await page.evaluate(() => {
      window.normalTwitchTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => normalTwitchTimeout(callback, delay === SOURCE_RESOLVE_TIMEOUT_MS ? 100 : delay, ...args);
    });
    const timeoutPromise = new Promise((resolve) => { holdNext = resolve; });
    await reveal(); await player().locator("#live").click();
    const timedOut = await timeoutPromise;
    await waitStatus("sourceReconnecting");
    await timedOut.route.abort().catch(() => {});
    await page.evaluate(() => { window.setTimeout = normalTwitchTimeout; });
    await live();
    const renewed = revision + 1;
    await page.evaluate(() => { window.failedPlayer = document.querySelector('[data-tile="0"] iframe'); });
    await player().locator("body").evaluate(() => ivsFixture.instances[0].fail({ type: "ErrorAuthorization", code: 403, source: "MasterPlaylist", message: "secret signed URL" }));
    await waitStatus("sourceReconnecting");
    assert.equal(await player().locator("body").evaluate(() => livePlayer.lastError.kind), "authorization");
    await waitSource(renewed); await waitStatus("sourcePlaying");
    assert.equal(await page.evaluate(() => failedPlayer.isConnected), false);
    assert.deepEqual(await player().locator("#video").evaluate((v) => [v.volume, v.muted]), [0.35, false]);
    assert.equal(await player().locator("#quality").inputValue(), "1080p60");
    assert.equal(remoteNavigations, 0);
    assert.equal(await page.evaluate(() => originalKick.isConnected), true);
    console.log("PASS: definitive failures stop; transient failures allow LIVE; expired playback authorization automatically refreshes and rebuilds only its pane");

    // A short-lived recovery must not reset the retry budget across iframe replacements.
    for (let attempt = 0; attempt < 2; attempt++) {
      const number = revision + 1;
      await player().locator("body").evaluate(() => ivsFixture.instances[0].fail({ type: "ErrorNetwork", code: 500 }));
      await waitStatus("sourceReconnecting"); await waitSource(number); await waitStatus("sourcePlaying");
    }
    await player().locator("body").evaluate(() => ivsFixture.instances[0].fail());
    await waitStatus("sourceRecoveryFailed");
    const exhaustedAt = revision;
    await page.waitForTimeout(2200); assert.equal(revision, exhaustedAt);
    assert.equal(await player().locator("#live").isEnabled(), true);
    await live();
    console.log("PASS: repeated media failures stop after three automatic attempts, and LIVE restarts recovery");

    const unstuck = revision + 1;
    await player().locator("body").evaluate(() => ivsFixture.instances[0].stall());
    await waitStatus("sourceBuffering");
    await waitSource(unstuck); await waitStatus("sourcePlaying");
    assert.deepEqual(await player().locator("#video").evaluate((v) => [v.volume, v.muted]), [0.35, false]);
    assert.equal(await page.evaluate(() => originalKick.isConnected), true);
    console.log("PASS: stalled playback automatically gets a fresh stream and engine while preserving preferences and the other pane");

    await player().locator("body").evaluate(() => ivsFixture.instances[0].fail());
    await waitStatus("sourceReconnecting");
    await page.evaluate(() => swapSourceSlots(0, 1));
    const swappedRetry = revision + 1;
    await waitStatus("sourcePlaying", 1);
    assert.equal(revision, swappedRetry);
    assert.equal(await page.frameLocator('[data-tile="1"] iframe').locator("#platform").textContent(), "Twitch");
    await page.evaluate(() => swapSourceSlots(1, 0));

    await player().locator("body").evaluate(() => ivsFixture.instances[0].fail());
    await waitStatus("sourceReconnecting");

    await page.evaluate(async () => { state.slots[0] = { url: "https://m.twitch.tv/roger9527?autoplay=false&muted=false" }; await renderStage(); });
    await waitStatus("sourcePaused");
    const changedAt = revision;
    await page.waitForTimeout(2200); assert.equal(revision, changedAt, "changing the source cancels the pending recovery");
    assert.equal(await player().locator("#video").evaluate((v) => v.muted), false);
    await live();
    const removedPromise = new Promise((resolve) => { holdNext = resolve; });
    await page.evaluate(() => { window.removedTwitch = document.querySelector('[data-tile="0"] iframe'); window.removedLookup = retryTiles([0]); });
    const removed = await removedPromise;
    await page.evaluate(async () => { state.slots[0] = { url: "" }; await renderStage(); });
    await removed.route.fulfill({ json: token(removed.number) }); await page.evaluate(() => removedLookup);
    assert.equal(await page.locator('[data-tile="0"] iframe').count(), 0);
    assert.equal(await page.evaluate(() => !removedTwitch.isConnected && originalKick.isConnected), true);
    console.log("PASS: Twitch autoplay/mute options are respected and clearing aborts pending lookups and removes the player");
  } finally {
    page.off("request", observe);
    await page.evaluate(() => { if (window.normalTwitchTimeout) window.setTimeout = normalTwitchTimeout; });
    await page.unroute(gql); await page.unroute(usher); await page.unroute(kick);
  }

  // Explicit official-player URLs still use an iframe and the frame relay.
  const embedUrl = "https://player.twitch.tv/?channel=roger9527&parent=example.org";
  await page.evaluate(async (url) => { state.slots[0] = { url }; await renderStage(); }, embedUrl);
  assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute("src"), embedUrl);
  await waitStatus("sourcePageLoaded");
  const frame = page.frames().find((frame) => frame.url() === embedUrl);
  await frame.evaluate(() => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<video style="width:320px;height:180px" muted></video>';
    document.body.append(wrapper);
  });
  await waitStatus("sourcePaused");
  await frame.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const video = document.querySelector("video"); video.srcObject = canvas.captureStream(10);
    const paint = () => canvas.getContext("2d").fillRect(0, 0, 320, 180);
    paint(); window.setInterval(paint, 100); await video.play();
  });
  await waitStatus("sourcePlaying");
  await frame.evaluate(() => {
    const old = document.querySelector("video"); old.srcObject.getTracks().forEach((track) => track.stop());
    const replacement = document.createElement("video"); replacement.style.cssText = old.style.cssText; old.replaceWith(replacement);
  });
  await waitStatus("sourcePaused");
  await frame.evaluate(() => document.querySelector("video").parentElement.remove());
  await waitStatus("sourcePageLoaded");
  console.log("PASS: explicit Twitch player URLs keep their iframe and report late/replaced/removed video states");
};
