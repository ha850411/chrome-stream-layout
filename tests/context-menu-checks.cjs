"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function checkContextMenu(context, page, worker, base) {
  const source = await context.newPage();
  let other;
  let created;
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  const captureNotice = async (status) => {
    const originalSize = page.viewportSize();
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(await page.locator("#sourceMenuNotice").evaluate(el => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      }), true, `the ${status} result stays visible at ${width}px`);
      if (process.env.UI_REVIEW_OUTPUT) {
        await fs.mkdir(process.env.UI_REVIEW_OUTPUT, { recursive: true });
        await page.locator(".control-dialog").screenshot({ path: path.join(process.env.UI_REVIEW_OUTPUT, `context-menu-${status}-${width}.png`) });
      }
    }
    await page.setViewportSize(originalSize);
  };
  // Native Chrome menus are outside the DOM. Exercise their registered handler
  // with Chrome's click payload and real storage, tabs, windows and player pages.
  const clickPane = (index) => worker.evaluate(async ({ index, url }) => {
    const [tab] = await chrome.tabs.query({ url });
    return handleSourceContextClick({ menuItemId: `stream-layout-add-page-${index}`, pageUrl: tab.url,
      linkUrl: "https://wrong.example/link", frameUrl: "https://wrong.example/frame", srcUrl: "https://wrong.example/video.mp4" }, tab);
  }, { index, url: source.url() });
  try {
    await page.evaluate(async () => {
      state = normalizeState({ language: "zh-TW", layout: 2, slots: [
        { url: "https://fixture.example/context-first", title: "First stream" },
        { url: "https://fixture.example/context-kept", title: "Kept stream" }
      ] });
      draftUrls = null; await persistState(""); await renderStage(); openControls();
      window.contextOriginalFrames = [...stage.querySelectorAll("iframe")];
      window.contextPageMarker = "original dashboard";
    });
    await page.waitForFunction(() => [...stage.querySelectorAll("[data-tile]")].every(tile => tile.dataset.status === "sourcePageLoaded"));
    await page.locator('[data-url-input="0"]').fill("https://fixture.example/draft-in-replaced-pane");
    await page.locator('[data-url-input="1"]').fill("https://fixture.example/draft-in-kept-pane");
    other = await context.newPage();
    await other.goto(`${base}/dashboard.html`);
    await other.waitForFunction(() => document.querySelector('[data-tile="1"] iframe'));
    await other.evaluate(() => { window.contextKept = document.querySelector('[data-tile="1"] iframe'); });
    await source.goto("https://fixture.example/context-import");
    await source.evaluate(() => { document.title = "右鍵加入的直播"; });
    await worker.evaluate(async () => {
      await refreshSourceContextMenu();
      for (let i = 0; i < 4; i++) await chrome.contextMenus.update(`stream-layout-add-page-${i}`, { enabled: true });
    });
    assert.equal(await clickPane(0), true);
    await page.waitForFunction(() => state.slots[0].url === "https://fixture.example/context-import" && !document.querySelector("#sourceMenuNotice").hidden);
    await other.waitForFunction(() => state.slots[0].url === "https://fixture.example/context-import");
    assert.equal(await page.evaluate(() => contextPageMarker), "original dashboard", "fragment result delivery must not reload the dashboard");
    assert.deepEqual(await page.evaluate(() => contextOriginalFrames.map(frame => frame.isConnected)), [false, true]);
    assert.equal(await other.evaluate(() => contextKept.isConnected), true);
    assert.equal(await page.locator('[data-url-input="0"]').inputValue(), "https://fixture.example/draft-in-replaced-pane");
    assert.equal(await page.locator('[data-url-input="1"]').inputValue(), "https://fixture.example/draft-in-kept-pane");
    assert.match(await page.locator("#sourceMenuMessage").textContent(), /草稿/);
    await captureNotice("added");
    assert.equal(source.url(), "https://fixture.example/context-import");
    assert.equal((await stored()).slots[0].title, "右鍵加入的直播");
    console.log("PASS: context-menu replacement imports the current page, reuses the dashboard, syncs tabs and preserves other players and URL drafts");

    await source.goto("https://fixture.example/context-fourth");
    await source.evaluate(() => { document.title = "第四個直播"; });
    assert.equal(await clickPane(3), true);
    await page.waitForFunction(() => state.layout === 4 && document.querySelector('[data-tile="3"] iframe'));
    await other.waitForFunction(() => state.layout === 4 && state.slots[3].url === "https://fixture.example/context-fourth");
    assert.equal(await page.evaluate(() => contextOriginalFrames[1].isConnected), true);
    assert.equal((await stored()).slots[1].url, "https://fixture.example/context-kept");
    await worker.evaluate(() => refreshSourceContextMenu());
    assert.match(await worker.evaluate(() => JSON.parse(sourceMenuSignature)[4]), /第四個直播.*替換/);
    console.log("PASS: selecting an unused fourth pane expands the layout and updates the current-source menu labels");

    const before = await stored();
    await source.goto("https://fixture.example/context-retry");
    await worker.evaluate(() => {
      globalThis.contextRealSet = chrome.storage.local.set;
      chrome.storage.local.set = async (values) => {
        if (values[STORAGE_KEY]) throw Error("Simulated context-menu save failure");
        return contextRealSet.call(chrome.storage.local, values);
      };
    });
    assert.equal(await clickPane(3), false);
    await page.waitForFunction(() => document.querySelector("#sourceMenuNotice").dataset.tone === "error");
    assert.deepEqual(await stored(), before);
    assert.match(await page.locator("#sourceMenuMessage").textContent(), /未變更/);
    await captureNotice("failed");
    await worker.evaluate(() => { chrome.storage.local.set = contextRealSet; delete globalThis.contextRealSet; });
    assert.equal(await clickPane(3), true);
    await page.waitForFunction(() => state.slots[3].url === "https://fixture.example/context-retry" && document.querySelector("#sourceMenuNotice").dataset.tone === "success");
    await page.locator("#dismissSourceMenuButton").click();
    assert.equal(await page.locator("#sourceMenuNotice").isVisible(), false);
    console.log("PASS: failed context-menu saves leave existing sources intact, show a visible error and recover on retry");

    await other.close(); other = null;
    await page.goto("https://fixture.example/not-a-dashboard");
    const newPage = context.waitForEvent("page");
    assert.equal(await clickPane(1), true);
    created = await newPage;
    await created.waitForLoadState();
    await created.waitForFunction(() => state.slots[1].url === "https://fixture.example/context-retry" && !document.querySelector("#sourceMenuNotice").hidden);
    assert.equal(await created.locator("#controlOverlay").isVisible(), true);
    assert.equal(page.url(), "https://fixture.example/not-a-dashboard");
    assert.equal(source.url(), "https://fixture.example/context-retry");
    console.log("PASS: context-menu add opens a new dashboard when none exists and retains both original web tabs");
  } finally {
    await worker.evaluate(() => { if (globalThis.contextRealSet) { chrome.storage.local.set = contextRealSet; delete globalThis.contextRealSet; } });
    await other?.close();
    await created?.close();
    await source.close();
    await page.goto(`${base}/dashboard.html`);
    await page.waitForFunction(() => storageReady);
    await page.evaluate(async () => { state = normalizeState({ language: "en" }); draftUrls = null; await persistState(""); await renderStage(); closeControls(); });
  }
};
