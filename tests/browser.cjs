"use strict";

// Optional integration checks: run with Playwright on Node's module path.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

(async () => {
  const extensionPath = path.resolve(__dirname, "..");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "stream-layout-test-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
      headless: true,
      viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-sandbox"]
    });
    const heldRequests = new Map();
    const huyaFixture = await fs.readFile(path.join(__dirname, "fixtures/huya.html"), "utf8");
    const waitForHeld = async (id) => {
      for (let i = 0; i < 250 && !heldRequests.has(id); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(heldRequests.has(id), `expected room request ${id}`);
      return heldRequests.get(id);
    };
    await context.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "api.live.bilibili.com") {
        heldRequests.set(url.searchParams.get("id"), route);
        return;
      }
      let player = "Fixture stream";
      if (url.hostname === "www.youtube.com") player = url.pathname.startsWith("/embed/")
        ? '<div class="ytp-error">Embed unavailable</div>'
        : '<div id="movie_player" style="width:640px;height:360px"><video></video></div>';
      if (url.hostname === "yeslivetv.com") player = '<div id="player" style="width:640px;height:360px"><video></video></div>';
      if (url.hostname === "liveshare.huya.com") player = huyaFixture;
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><title>Fixture stream</title><body style="margin:0;background:#151515;color:white">${player}</body>` });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const base = worker.url().split("/").slice(0, 3).join("/");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/dashboard.html?controls=1`);
    await page.waitForFunction(() => document.querySelectorAll("[data-tile]").length === 4 && !document.querySelector("#controlOverlay").hidden);
    assert.equal(await page.locator("#playbackNotice").isVisible(), false);
    await page.evaluate(() => closeControls());

    await page.evaluate(() => {
      state.layout = 2;
      state.slots = [{ url: "https://live.bilibili.com/6", title: "" }, { url: "https://fixture.example/fast", title: "" }, { url: "" }, { url: "" }];
      window.pendingRender = renderStage();
    });
    await page.waitForSelector('[data-tile="1"] iframe', { timeout: 2000 });
    assert.equal(await page.locator('[data-tile="0"] iframe').count(), 0);
    assert.equal(await page.locator('[data-tile="0"]').getAttribute("data-status"), "sourceResolving");
    console.log("PASS: a pending API does not block the other pane");

    await page.evaluate(async () => {
      state.slots[0].url = "https://fixture.example/replacement";
      await renderStage();
    });
    await (await waitForHeld("6")).fulfill({ json: { code: 0, data: { room_id: 600006 } } });
    await page.evaluate(() => pendingRender);
    assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute("src"), "https://fixture.example/replacement");
    console.log("PASS: late responses cannot replace a newly selected source");

    await page.evaluate(() => {
      state.slots[0].url = "https://live.bilibili.com/7";
      window.pendingRender = renderStage();
      [state.slots[0], state.slots[1]] = [state.slots[1], state.slots[0]];
      swapRenderedStageTiles(0, 1);
    });
    await (await waitForHeld("7")).fulfill({ json: { code: 0, data: { room_id: 700007 } } });
    await page.evaluate(() => pendingRender);
    assert.match(await page.locator('[data-tile="1"] iframe').getAttribute("src"), /cid=700007/);
    assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute("src"), "https://fixture.example/fast");
    console.log("PASS: pending sources follow their pane when positions are swapped");

    await page.evaluate(async () => {
      state.slots[1].url = "https://fixture.example/second";
      await renderStage();
      window.untouchedFrame = document.querySelector('[data-tile="1"] iframe');
      window.retriedFrame = document.querySelector('[data-tile="0"] iframe');
      state.slots[1].url = "https://fixture.example/unapplied-edit";
      await retryTiles([0]);
    });
    assert.equal(await page.evaluate(() => untouchedFrame.isConnected && !retriedFrame.isConnected), true);
    assert.equal(await page.locator('[data-tile="1"] iframe').getAttribute("src"), "https://fixture.example/second");
    console.log("PASS: retry only reloads its pane, preserving others and their pending edits");

    // Real media events from a local canvas stream exercise the content script.
    await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePageLoaded");
    const videoFrame = page.frames().find((frame) => frame.url() === "https://fixture.example/fast");
    await videoFrame.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 180;
      const video = document.createElement("video");
      video.style.cssText = "width:320px;height:180px";
      video.muted = true;
      document.body.append(video);
      video.srcObject = canvas.captureStream(10);
      const paint = () => { const c = canvas.getContext("2d"); c.fillStyle = `hsl(${Date.now() % 360} 70% 50%)`; c.fillRect(0, 0, 320, 180); };
      paint(); window.setInterval(paint, 100);
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePlaying");
    await videoFrame.evaluate(() => document.querySelector("video").pause());
    await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePaused");
    console.log("PASS: content-script playback and pause status reaches the source controls");

    await page.evaluate(() => {
      state.slots[1].url = "https://live.bilibili.com/9";
      window.pendingRender = renderStage();
    });
    await page.waitForFunction(() => document.querySelector('[data-tile="1"]').dataset.status === "sourceTimeout", { }, { timeout: 12000 });
    assert.equal(await page.locator('[data-tile="0"] iframe').count(), 1);
    await heldRequests.get("9").abort().catch(() => {});
    console.log("PASS: actual 8-second lookup timeout leaves the other pane intact");

    await page.evaluate(async () => {
      state.slots[1].url = "https://fixture.example/%";
      await renderStage();
      openControls();
    });
    await page.locator("#applyButton").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "languageSelect");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "applyButton");
    assert.equal(await page.locator(".app-shell").evaluate((el) => el.inert), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".app-shell").evaluate((el) => el.inert), false);
    const splitter = page.locator('[data-splitter="col"]');
    await splitter.focus();
    await page.keyboard.press("End");
    assert.equal(await splitter.getAttribute("aria-valuenow"), "82");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    assert.equal(await splitter.getAttribute("aria-valuenow"), "20");
    console.log("PASS: malformed URLs, dialog focus and keyboard pane resizing");

    await page.evaluate(async () => {
      const original = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async () => ({ ok: false });
      await ensureFrameHeaderRules();
      chrome.runtime.sendMessage = original;
      openControls();
    });
    assert.equal(await page.locator("#playbackNotice").isVisible(), true);
    await page.evaluate(() => ensureFrameHeaderRules());
    assert.equal(await page.locator("#playbackNotice").isVisible(), false);
    console.log("PASS: failed rule installation is visible and recoverable");

    await require("./ui-checks.cjs")(page);

    const helperPage = await context.newPage();
    helperPage.on("pageerror", (error) => errors.push(error.message));
    await helperPage.goto(`${base}/dashboard.html`);
    await helperPage.waitForFunction(() => document.querySelectorAll("[data-tile]").length > 0);
    await helperPage.evaluate(async () => {
      state.layout = 2;
      state.slots = [{ url: "https://www.youtube.com/watch?v=abcdefghijk" }, { url: "https://yeslivetv.com/channel" }, { url: "" }, { url: "" }];
      await renderStage();
    });
    const youtubePlayer = helperPage.frameLocator('iframe[data-tile-frame="0"]').locator("#movie_player.chrome-stream-layout-youtube-primary");
    await youtubePlayer.waitFor();
    assert.match(await helperPage.locator('iframe[data-tile-frame="0"]').getAttribute("src"), /\/watch\?/);
    await youtubePlayer.evaluate((element) => {
      const replacement = document.createElement("div");
      replacement.id = "movie_player";
      replacement.style.cssText = "width:640px;height:360px";
      replacement.dataset.replaced = "true";
      element.replaceWith(replacement);
    });
    await youtubePlayer.waitFor();
    assert.equal(await youtubePlayer.getAttribute("data-replaced"), "true");
    await helperPage.frameLocator('iframe[data-tile-frame="1"]').locator(".chrome-stream-layout-yeslive-primary").waitFor();
    await require("./huya-checks.cjs")(context, helperPage);
    await helperPage.close();
    console.log("PASS: YouTube embed fallback, replaced player recovery, and YesLive promotion");

    const second = await context.newPage();
    await second.goto(`${base}/dashboard.html`);
    await second.waitForFunction(() => document.querySelectorAll("[data-tile]").length > 0);
    const getRules = () => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    assert.equal((await getRules())[0].condition.tabIds.length, 2);
    await second.goto("https://fixture.example/away");
    await worker.evaluate(() => scheduleFrameHeaderRules());
    assert.equal((await getRules())[0].condition.tabIds.length, 1);
    await page.close();
    await worker.evaluate(() => scheduleFrameHeaderRules());
    assert.equal((await getRules()).length, 0);
    console.log("PASS: real extension rules cover both dashboards and clean up on navigation/close");
    assert.deepEqual(errors, []);
  } finally {
    if (context) await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
