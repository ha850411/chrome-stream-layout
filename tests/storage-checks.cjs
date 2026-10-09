"use strict";
const assert = require("node:assert/strict");

module.exports = async function checkStorage(context, page, base) {
  const a = "https://fixture.example/shared-a", b = "https://fixture.example/shared-b";
  const saved = () => page.evaluate(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  const settle = (p) => p.evaluate(async () => { await saveInFlight; await syncSharedState(); });
  await page.reload();
  await page.waitForFunction(() => storageReady && document.querySelectorAll("[data-tile]").length > 0);
  await page.evaluate(async ({ a, b }) => {
    state = normalizeState({ language: "en", layout: 4, slots: [{ url: a }, { url: b }] });
    draftUrls = null; await persistState(""); await renderStage(); openControls();
  }, { a, b });
  const other = await context.newPage();
  try {
    await other.goto(`${base}/dashboard.html`);
    await other.waitForFunction((url) => state.slots[0].url === url && document.querySelectorAll("[data-tile]").length === 4, a);
    // Tiles exist before asynchronous source loading installs their iframes.
    // Capture the actual player before checking that later changes preserve it.
    await other.waitForFunction((url) => document.querySelector('[data-tile="0"] iframe')?.dataset.sourceUrl === url, a);
    await other.evaluate(() => { openControls(0); window.unchangedFrame = document.querySelector('[data-tile="0"] iframe'); });
    await other.locator('[data-url-input="0"]').fill("https://fixture.example/local-draft");
    await page.evaluate(async () => { state.slots[1].url = "https://fixture.example/from-a"; await persistState(""); await renderStage(); });
    await other.waitForFunction(() => state.slots[1].url === "https://fixture.example/from-a");
    assert.equal(await other.locator('[data-url-input="0"]').inputValue(), "https://fixture.example/local-draft");
    assert.equal(await other.evaluate(() => unchangedFrame.isConnected), true);
    await other.locator('[data-layout="2"]').click();
    await page.waitForFunction(() => state.layout === 2);
    assert.equal((await saved()).slots[1].url, "https://fixture.example/from-a");
    assert.equal(await other.locator('[data-url-input="0"]').inputValue(), "https://fixture.example/local-draft");
    console.log("PASS: tabs synchronize independent changes while retaining local drafts and unchanged players");

    await page.evaluate(() => {
      window.realGet = chrome.storage.local.get;
      window.holdRead = true;
      chrome.storage.local.get = async (keys) => {
        const snapshot = await realGet.call(chrome.storage.local, keys);
        if (Array.isArray(keys) && keys.includes(STORAGE_KEY) && holdRead) {
          holdRead = false;
          return new Promise((resolve) => { window.releaseRead = () => resolve(snapshot); });
        }
        return snapshot;
      };
      window.pendingRead = syncSharedState();
    });
    try {
      await page.waitForFunction(() => typeof window.releaseRead === "function", null, { timeout: 5000 });
    } catch (error) {
      console.error("Read synchronization state", await page.evaluate(() => ({ storageReady, storageIssue,
        saving: Boolean(saveInFlight), pending: Boolean(pendingBase), changes: stateChanges(intentState, state) })));
      throw error;
    }
    await other.locator('[data-layout="4"]').click();
    await page.waitForFunction(() => state.layout === 4);
    await page.evaluate(async () => { releaseRead(); await pendingRead; chrome.storage.local.get = realGet; });
    assert.equal(await page.evaluate(() => state.layout), 4);
    console.log("PASS: delayed storage reads cannot roll back a newer synchronized setting");

    await page.evaluate(async () => {
      window.realSendMessage = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (message) => message.type === "save-settings" ? Promise.reject(new Error("simulated write failure")) : realSendMessage(message);
      state.slots[0].url = "https://fixture.example/retry-save";
      window.failedSave = await persistState("Should not report success");
    });
    assert.equal(await page.evaluate(() => failedSave), false);
    assert.equal((await saved()).slots[0].url, a);
    assert.equal(await page.locator("#storageNotice").isVisible(), true);
    assert.match(await page.locator("#saveStatus").textContent(), /not saved/);
    await other.locator('[data-layout="3"]').click();
    await settle(other);
    await page.evaluate(() => { chrome.runtime.sendMessage = realSendMessage; });
    await page.locator("#retrySaveButton").click();
    await page.waitForFunction(() => !document.querySelector("#storageNotice").hidden === false && !saveInFlight);
    assert.equal((await saved()).slots[0].url, "https://fixture.example/retry-save");
    assert.equal((await saved()).layout, 3);
    await other.waitForFunction(() => state.slots[0].url === "https://fixture.example/retry-save");
    assert.equal(await other.locator('[data-url-input="0"]').inputValue(), "https://fixture.example/local-draft");
    console.log("PASS: failed saves stay visible, retry preserves newer changes from another tab");

    // Delay a real write so the page accumulates multiple edits while awaiting it.
    await page.evaluate(() => {
      window.holdWrite = true;
      chrome.runtime.sendMessage = (message) => message.type === "save-settings" && holdWrite
        ? new Promise((resolve) => { window.releaseWrite = () => { holdWrite = false; resolve(realSendMessage(message)); }; }) : realSendMessage(message);
      state.layout = 2; window.pendingSave = persistState("");
      state.sizes.layout2.col = 61; void persistState("");
      state.sizes.layout2.col = 67; void persistState("");
    });
    await page.evaluate(async () => { releaseWrite(); await pendingSave; chrome.runtime.sendMessage = realSendMessage; });
    assert.equal((await saved()).sizes.layout2.col, 67);
    assert.equal((await saved()).layout, 2);

    await settle(other);
    await page.evaluate(() => {
      window.holdWrite = true;
      chrome.runtime.sendMessage = (message) => message.type === "save-settings" && holdWrite
        ? new Promise((resolve) => { window.releaseWrite = () => { holdWrite = false; resolve(realSendMessage(message)); }; }) : realSendMessage(message);
      state.slots[0].url = "https://fixture.example/conflicting-draft";
      window.pendingSave = persistState("");
    });
    await other.evaluate(async () => { draftUrls = null; state.slots[0].url = "https://fixture.example/winning-change"; await persistState(""); });
    await page.evaluate(async () => { releaseWrite(); await pendingSave; chrome.runtime.sendMessage = realSendMessage; });
    assert.equal((await saved()).slots[0].url, "https://fixture.example/winning-change");
    assert.equal(await page.evaluate(() => state.slots[0].url), "https://fixture.example/winning-change");
    assert.equal(await page.evaluate(() => draftUrls[0]), "https://fixture.example/conflicting-draft");
    assert.match(await page.locator("#storageMessage").textContent(), /same setting/);
    console.log("PASS: queued edits preserve the latest size; conflicting source writes recover without overwriting saved data");

    await page.locator("#retrySaveButton").click();
    await page.locator("#discardButton").click();

    const unreadable = await context.newPage();
    const readErrors = [];
    unreadable.on("pageerror", (error) => readErrors.push(error.message));
    await unreadable.addInitScript(() => {
      if (!location.pathname.endsWith("/dashboard.html")) return;
      window.realStorageGet = chrome.storage.local.get;
      chrome.storage.local.get = () => Promise.reject(new Error("simulated read failure"));
    });
    try {
      await unreadable.goto(`${base}/dashboard.html`);
      await unreadable.locator("#storageNotice").waitFor();
      assert.equal(await unreadable.evaluate(() => storageReady), false);
      await unreadable.locator('[data-url-input="0"]').fill("https://fixture.example/read-failure-draft");
      await unreadable.locator("#applyButton").click();
      assert.equal((await saved()).slots[0].url, "https://fixture.example/winning-change");
      await unreadable.evaluate(() => { chrome.storage.local.get = realStorageGet; });
      await unreadable.locator("#retrySaveButton").click();
      await unreadable.waitForFunction(() => storageReady && !storageIssue);
      assert.equal(await unreadable.evaluate(() => state.slots[0].url), "https://fixture.example/winning-change");
      assert.equal(await unreadable.evaluate(() => draftUrls[0]), "https://fixture.example/read-failure-draft");
      assert.equal(await unreadable.evaluate(() => getPendingSourceCount()), 1, "unread defaults must not become removal drafts");
      assert.deepEqual(readErrors, []);
    } finally { await unreadable.close(); }
    console.log("PASS: initial storage failures cannot overwrite saved sources; retry restores settings and only real drafts");
  } finally {
    await other.close();
    await page.evaluate(() => {
      if (window.realSendMessage) chrome.runtime.sendMessage = realSendMessage;
      if (window.realGet) chrome.storage.local.get = realGet;
    });
  }

  const kickPattern = "https://kick.com/api/v2/channels/**";
  await context.route(kickPattern, (route) => route.fulfill({ json: { livestream: { session_title: "Saved audio fixture" }, playback_url: "https://fixture.example/preferences.m3u8" } }));
  try {
    await page.evaluate(async () => {
      state = normalizeState({ language: "en", layout: 2, slots: [{ url: "https://kick.com/preference-fixture" }] });
      draftUrls = null; await persistState(""); await renderStage(); closeControls();
    });
    await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePlaying");
    let player = page.frameLocator('[data-tile="0"] iframe');
    await player.locator("#player").hover();
    await player.locator("#volume").fill("0.35");
    await player.locator("#mute").click();
    await player.locator("#quality").click();
    await player.getByRole("menuitemradio", { name: "1080p60", exact: true }).click();
    await page.waitForFunction(async () => {
      const value = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      return value.slots[0].volume === .35 && value.slots[0].muted === true && value.slots[0].quality === "1080p60" && !saveInFlight;
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-tile="0"]')?.dataset.status === "sourcePlaying");
    player = page.frameLocator('[data-tile="0"] iframe');
    assert.deepEqual(await player.locator("#video").evaluate((v) => [v.volume, v.muted]), [.35, true]);
    assert.equal(await player.locator("#quality").getAttribute("value"), "1080p60");
    console.log("PASS: actual player controls persist volume, mute and quality across a dashboard reload");
    const listener = await context.newPage();
    try {
      await listener.goto(`${base}/dashboard.html`);
      await listener.waitForFunction(() => document.querySelector('[data-tile="0"]')?.dataset.status === "sourcePlaying");
      const listeningPlayer = listener.frameLocator('[data-tile="0"] iframe');
      await page.bringToFront();
      await player.locator("#player").hover();
      await player.locator("#volume").fill("0.55");
      await player.locator("#quality").click();
      await player.getByRole("menuitemradio", { name: "360p30", exact: true }).click();
      await listeningPlayer.locator("#video").evaluate(async (video) => {
        for (let i = 0; i < 100 && (video.volume !== .55 || video.muted); i++) await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.deepEqual(await listeningPlayer.locator("#video").evaluate((video) => [video.volume, video.muted]), [.55, false]);
      await listener.waitForFunction(() => state.slots[0].quality === "360p30");
      assert.equal(await listeningPlayer.locator("#quality").getAttribute("value"), "360p30");
      assert.equal(await listeningPlayer.locator("body").evaluate(() => ivsFixture.instances.length), 1);
    } finally { await listener.close(); }
    console.log("PASS: volume, mute and quality synchronize into an existing player without rebuilding it");
  } finally {
    await page.evaluate(async () => { state = normalizeState({ language: "en" }); await persistState(""); await renderStage(); });
    await context.unroute(kickPattern);
  }
};
