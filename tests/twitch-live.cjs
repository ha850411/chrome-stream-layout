"use strict";

// Opt-in real-network checks of the production Twitch route and local player.
// Uses a fresh browser profile; no routing overrides, network mocks or SDK stubs.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const channel = (process.argv[2] || "roger9527").toLowerCase();
  assert.match(channel, /^[a-z0-9_]+$/, "Pass a Twitch channel login, not a URL");
  const output = process.env.TWITCH_LIVE_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), "twitch-ivs-results-"));
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "twitch-ivs-profile-"));
  const extension = path.resolve(__dirname, "..");
  const report = { at: new Date().toISOString(), channel, checks: [], samples: [], errors: [], networkErrors: [], lookups: [], masterResponses: [], ivsEvents: [] };
  const clean = (value) => String(value).replace(/https?:\/\/[^\s"']+/g, "[url]").slice(0, 1000);
  const pass = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
  let context;
  let page;
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
      headless: true, viewport: { width: 1440, height: 900 },
      args: ["--no-sandbox", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    report.browser = context.browser().version();
    await context.exposeFunction("recordLiveIVSEvent", (event) => report.ivsEvents.push(clean(JSON.stringify(event))));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const base = worker.url().split("/").slice(0, 3).join("/");
    page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(clean(error.message)));
    page.on("console", (message) => { if (message.type() === "error") report.errors.push(clean(message.text())); });
    page.on("response", (response) => {
      const host = new URL(response.url()).hostname;
      if (response.status() >= 400) report.networkErrors.push({ host, status: response.status() });
      if (host === "gql.twitch.tv") report.lookups.push({ status: response.status(), at: Date.now() });
      if (host === "usher.ttvnw.net") report.masterResponses.push({ status: response.status(), at: Date.now() });
    });
    await page.goto(`${base}/dashboard.html`);
    await page.waitForFunction(() => document.querySelectorAll("[data-tile]").length === 4);
    await page.evaluate(async (channel) => {
      state.layout = 2;
      state.language = "en";
      state.slots = [{ url: `https://www.twitch.tv/${channel}` }, { url: `https://www.twitch.tv/${channel}` }, { url: "" }, { url: "" }];
      renderControls();
      await renderStage();
      closeControls();
    }, channel);

    const frameAt = async (index) => (await page.locator(`[data-tile="${index}"] iframe`).elementHandle()).contentFrame();
    const playing = (frame) => frame.waitForFunction(() => !video.paused && video.readyState >= 3 && video.videoWidth > 0 && engine?.player.getState() === IVSPlayer.PlayerState.PLAYING, {}, { timeout: 30000 });
    const refreshed = async () => {
      // The old stream can keep playing while the replacement URL is fetched.
      // Wait for the host to finish that lookup and confirm the new playback.
      await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePlaying", {}, { timeout: 30000 });
      const frame = await frameAt(0);
      await playing(frame);
      return frame;
    };
    const watchEngine = (frame) => frame.evaluate(() => {
      window.originalExperimentEngine = engine.player;
      engine.player.addEventListener(IVSPlayer.PlayerEventType.ERROR, (error) => recordLiveIVSEvent({ type: "error", error }));
      engine.player.addEventListener(IVSPlayer.PlayerState.ENDED, () => recordLiveIVSEvent({ type: "ended" }));
    });
    const sample = (frame) => frame.evaluate(() => ({ time: video.currentTime, width: video.videoWidth, height: video.videoHeight,
      paused: video.paused, ready: video.readyState, quality: quality.value, muted: video.muted, volume: video.volume,
      latency: engine?.player.getLiveLatency(), buffer: engine?.player.getBufferDuration(), waiting: window.experimentWaiting || 0,
      decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames }));
    const reveal = (frame) => frame.locator("#video").hover({ position: { x: 20, y: 20 } });
    let first = await frameAt(0);
    const second = await frameAt(1);
    await Promise.all([playing(first), playing(second)]);
    await watchEngine(first);
    assert.ok(first.url().startsWith(`${base}/live-player.html`));
    assert.ok(second.url().startsWith(`${base}/live-player.html`));
    pass("Two local IVS panes play the real Twitch stream without signing in");
    report.qualities = await first.locator("#quality option").evaluateAll((options) => options.map((option) => option.value));
    await first.evaluate(() => { window.experimentWaiting = 0; video.addEventListener("waiting", () => experimentWaiting++); });
    report.samples.push(await sample(first));
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      report.samples.push(await sample(first));
      console.log("SAMPLE:", JSON.stringify(report.samples.at(-1)));
    }
    assert.ok(report.samples.at(-1).time - report.samples[0].time > 25, "Video time must advance during the 30-second observation");
    assert.ok(report.samples.at(-1).decodedFrames > report.samples[0].decodedFrames, "Decoded frames must advance");
    pass("Video time and decoded frames advance for 30 seconds");

    report.qualityChanges = [];
    const options = report.qualities.filter((value) => value !== "auto");
    const low = options.find((value) => value.startsWith("360p")) || options.at(-1);
    const high = options[0];
    assert.ok(low && high && low !== high, "Live stream must offer at least two video qualities");
    for (const value of [low, high, "auto"]) {
      await reveal(first);
      await first.locator("#quality").selectOption(value);
      if (value !== "auto") await first.waitForFunction((height) => video.videoHeight === height, parseInt(value, 10), { timeout: 30000 });
      else assert.equal(await first.evaluate(() => engine.player.isAutoQualityMode()), true);
      // Returning to Auto can reattach the media element. Wait for playback,
      // otherwise the following pause click could hit that transient pause.
      await playing(first);
      const observed = await sample(first);
      report.qualityChanges.push(observed);
      console.log("QUALITY:", JSON.stringify(observed));
    }
    pass("Manual quality changes alter decoded resolution; Auto restores adaptive mode");

    const preferred = options.find((value) => value.startsWith("720p")) || low;
    await reveal(first);
    await first.locator("#quality").selectOption(preferred);
    await first.waitForFunction((height) => video.videoHeight === height, parseInt(preferred, 10), { timeout: 30000 });
    await playing(first);
    await reveal(first);
    await first.locator("#mute").click();
    await first.locator("#volume").fill("0.25");
    await first.evaluate(() => { window.originalExperimentEngine = engine.player; });
    await first.locator("#play").click();
    await first.waitForFunction(() => video.paused);
    const pausedAt = await first.evaluate(() => video.currentTime);
    await page.waitForTimeout(1500);
    assert.ok(Math.abs(await first.evaluate(() => video.currentTime) - pausedAt) < 0.2, "Playback time must remain fixed after clicking Pause");
    await reveal(first);
    await first.locator("#play").click();
    const pausedFrame = first;
    first = await refreshed();
    report.rebuiltOnResume = pausedFrame !== first;
    if (report.rebuiltOnResume) await watchEngine(first);
    report.resumed = await sample(first);
    assert.deepEqual([report.resumed.quality, report.resumed.muted, report.resumed.volume], [preferred, false, 0.25]);
    pass("Pause/resume returns to live and keeps quality, unmuted state and 25% volume");

    report.reconnections = [];
    for (let i = 0; i < 3; i++) {
      const previousLookups = report.lookups.length;
      const previousMasters = report.masterResponses.length;
      await reveal(first);
      await first.locator("#live").click();
      const previousFrame = first;
      first = await refreshed();
      assert.equal(report.lookups.length, previousLookups + 1);
      assert.equal(report.lookups.at(-1).status, 200);
      assert.ok(report.masterResponses.length > previousMasters);
      assert.equal(report.masterResponses.at(-1).status, 200);
      const rebuilt = previousFrame !== first;
      if (rebuilt) {
        assert.equal(previousFrame.isDetached(), true);
        await watchEngine(first);
      } else assert.equal(await first.evaluate(() => engine.player === originalExperimentEngine), true);
      const observed = await sample(first);
      assert.deepEqual([observed.quality, observed.muted, observed.volume], [preferred, false, 0.25]);
      assert.equal(page.workers().length, 2);
      report.reconnections.push({ ...observed, workers: page.workers().length, rebuilt });
    }
    pass("Three LIVE reconnects fetch fresh sources, preserve preferences and keep two workers");
    await reveal(first);
    await first.locator("#fullscreen").click();
    await first.waitForFunction(() => Boolean(document.fullscreenElement));
    await first.evaluate(() => document.exitFullscreen());
    pass("The local player's fullscreen control works");
    await reveal(first);
    await page.screenshot({ path: path.join(output, "two-panes.png") });

    await page.evaluate(async (channel) => {
      state.slots[0] = { url: `https://www.twitch.tv/${channel}?autoplay=false&muted=false` };
      await renderStage();
    }, channel);
    first = await frameAt(0);
    await first.waitForFunction(() => !quality.disabled && video.paused);
    assert.equal(await first.evaluate(() => video.muted), false);
    await page.waitForTimeout(1000);
    assert.equal(await first.evaluate(() => video.paused), true);
    await reveal(first);
    await first.locator("#play").click();
    first = await refreshed();
    pass("autoplay=false and muted=false are respected; clicking Play starts live playback");

    const keptTime = (await sample(second)).time;
    await page.evaluate(async () => { state.slots[0] = { url: "" }; await renderStage(); });
    for (let i = 0; i < 50 && page.workers().length !== 1; i++) await page.waitForTimeout(100);
    report.workersAfterRemovingOne = page.workers().length;
    assert.equal(report.workersAfterRemovingOne, 1);
    assert.equal(second.isDetached(), false);
    await page.waitForTimeout(1500);
    assert.ok((await sample(second)).time > keptTime);
    await page.evaluate(async () => { state.slots = Array.from({ length: 4 }, () => ({ url: "" })); await renderStage(); });
    for (let i = 0; i < 50 && page.workers().length; i++) await page.waitForTimeout(100);
    report.workersAfterClear = page.workers().length;
    assert.equal(report.workersAfterClear, 0);
    pass("Removing panes releases their workers (2 → 1 → 0) and preserves the other stream");
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.networkErrors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = clean(error.message);
    report.failureStack = clean(error.stack);
    console.error("FAIL:", report.failure);
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
    console.log(`Report: ${path.join(output, "report.json")}`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
