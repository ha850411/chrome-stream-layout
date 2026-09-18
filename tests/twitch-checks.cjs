"use strict";

const assert = require("node:assert/strict");

module.exports = async function checkTwitch(page) {
  await page.evaluate(async () => {
    state.layout = 2;
    state.slots = [{ url: "https://www.twitch.tv/roger9527" }, { url: "" }, { url: "" }, { url: "" }];
    await renderStage();
  });
  const src = new URL(await page.locator('iframe[data-tile-frame="0"]').getAttribute("src"));
  assert.equal(src.origin, "https://player.twitch.tv");
  assert.equal(src.searchParams.get("channel"), "roger9527");
  assert.equal(src.searchParams.get("parent"), new URL(page.url()).hostname);
  assert.equal(src.searchParams.get("autoplay"), "true");
  assert.equal(src.searchParams.get("muted"), "true");
  const waitForStatus = (status) => page.waitForFunction(
    (expected) => document.querySelector('[data-tile="0"]').dataset.status === expected,
    status, { timeout: 3000 }
  );
  await waitForStatus("sourcePageLoaded");
  const frame = page.frames().find((candidate) => candidate.url() === src.href);

  // Twitch can add its initial video long after the content script ran, then
  // wait for a user click without ever emitting loadeddata, playing or pause.
  await frame.evaluate(() => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<video style="width:320px;height:180px" muted></video>';
    document.body.append(wrapper);
  });
  await waitForStatus("sourcePaused");
  assert.equal(await page.evaluate(() => frameLoadTimers.has(document.querySelector('[data-tile="0"] iframe'))), false);
  console.log("PASS: late Twitch player insertion reports Paused instead of playback unconfirmed");

  await frame.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const video = document.querySelector("video");
    video.srcObject = canvas.captureStream(10);
    const paint = () => {
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = `hsl(${Date.now() % 360} 70% 50%)`;
      ctx.fillRect(0, 0, 320, 180);
    };
    paint(); window.setInterval(paint, 100);
    await video.play();
  });
  await waitForStatus("sourcePlaying");
  await frame.evaluate(() => {
    const old = document.querySelector("video");
    old.srcObject.getTracks().forEach((track) => track.stop());
    const replacement = document.createElement("video");
    replacement.style.cssText = old.style.cssText;
    old.replaceWith(replacement);
  });
  await waitForStatus("sourcePaused");
  await frame.evaluate(() => document.querySelector("video").parentElement.remove());
  await waitForStatus("sourcePageLoaded");
  console.log("PASS: Twitch playback, player replacement and removal update source status");

  // Chromium fires iframe load even when a request is blocked. Exercise both
  // that case and a successful HTML response that never creates a player.
  await page.evaluate(() => {
    window.twitchTestSetTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => twitchTestSetTimeout(
      callback, delay === FRAME_LOAD_TIMEOUT_MS ? 500 : delay, ...args
    );
  });
  const playerPattern = "https://player.twitch.tv/**";
  try {
    for (const blocked of [true, false]) {
      let playerRequests = 0;
      await page.route(playerPattern, async (route) => {
        playerRequests++;
        if (blocked) await route.abort("blockedbyclient");
        else await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Twitch</title><body></body>" });
      });
      await page.evaluate(() => retryTiles([0]));
      await page.waitForFunction(() => document.querySelector('[data-tile="0"] iframe').src === "https://www.twitch.tv/roger9527",
        {}, { timeout: 4000 });
      await waitForStatus("sourcePageLoaded");
      assert.equal(playerRequests, 1);
      assert.equal(await page.locator('iframe[data-tile-frame="0"]').getAttribute("data-twitch-fallback-src"), null);
      await page.unroute(playerPattern);
    }
    console.log("PASS: blocked and blank Twitch embeds recover through the original room once");
  } finally {
    await page.unroute(playerPattern);
    await page.evaluate(() => { window.setTimeout = twitchTestSetTimeout; });
  }
};
