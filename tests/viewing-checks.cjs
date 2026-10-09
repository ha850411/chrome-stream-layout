"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function checkViewingControls(page) {
  await page.evaluate(async () => {
    state = normalizeState({ language: "en", layout: 4 });
    draftUrls = null;
    document.body.classList.remove("is-layout-maximized");
    applyLanguage(); renderControls(); await renderStage(); closeControls();
  });
  // Hovering anywhere over panes immediately reveals viewing controls
  await page.mouse.move(100, 100);
  await page.waitForFunction(() => document.querySelector("#viewTools").classList.contains("is-visible"));
  await page.locator("#openControlsButton").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#controlOverlay").isVisible(), true);
  assert.equal(await page.locator("#dialogFullscreenButton").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.id), "openControlsButton");
  await page.locator("#viewFullscreenButton").click();
  await page.waitForFunction(() => document.fullscreenElement === document.body);
  await page.mouse.move(100, 100);
  await page.waitForFunction(() => document.querySelector("#viewTools").classList.contains("is-visible"));
  await page.locator("#openControlsButton").click();
  assert.equal(await page.locator("#controlOverlay").isVisible(), true);
  assert.equal(await page.evaluate(() => document.fullscreenElement === document.body), true);
  await page.locator("#dialogFullscreenButton").click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.keyboard.press("Escape");
  console.log("PASS: viewing tools reveal on hover/focus, restore focus, and open settings during fullscreen");

  await page.locator('[data-tile="1"] [data-source-action="edit"]').click();
  await page.waitForFunction(() => document.activeElement.dataset.urlInput === "1");
  await page.locator('[data-url-input="1"]').fill("javascript:alert(1)");
  await page.locator("#applyButton").click();
  await page.locator('[data-tile="1"] .tile-error').waitFor();
  assert.equal(await page.locator('[data-tile="1"] .source-actions a').count(), 0, "unsafe schemes never get an original-site link");
  await page.locator('[data-tile="1"] [data-source-action="edit"]').click();
  await page.waitForFunction(() => document.activeElement.dataset.urlInput === "1");
  await page.locator('[data-url-input="1"]').fill("https://fixture.example/ui-second");
  await page.locator("#applyButton").click();
  await page.waitForFunction(() => document.querySelector('[data-tile="1"]').dataset.status === "sourcePageLoaded");
  await page.locator('[data-tile="0"] [data-source-action="edit"]').click();
  await page.locator('[data-url-input="0"]').fill("https://fixture.example/ui-first");
  await page.locator("#applyButton").click();
  await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePageLoaded");
  await page.evaluate(() => {
    window.keptUiFrame = document.querySelector('[data-tile="1"] iframe');
  });
  // A real media failure keeps relay reports consistent while the popup changes
  // page visibility; directly setting the tile status races with those reports.
  await page.frameLocator('[data-tile="0"] iframe').locator("body").evaluate((body) => {
    const video = document.createElement("video");
    video.style.cssText = "width:320px;height:180px";
    video.src = "data:video/mp4;base64,bm90LWEtbWVkaWEtZmlsZQ==";
    body.append(video);
    video.load();
  });
  await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourceMediaError");
  const original = page.locator('[data-tile="0"] .source-actions a');
  assert.equal(await original.getAttribute("href"), "https://fixture.example/ui-first");
  const [popup] = await Promise.all([page.waitForEvent("popup"), original.click()]);
  await popup.waitForLoadState();
  assert.equal(popup.url(), "https://fixture.example/ui-first");
  assert.equal(await popup.evaluate(() => window.opener), null);
  await popup.close();
  await page.locator('[data-tile="0"] [data-source-action="retry"]').click();
  await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePageLoaded");
  assert.equal(await page.locator('[data-tile="0"] .tile-notice').count(), 0);
  assert.equal(await page.evaluate(() => keptUiFrame.isConnected), true);
  console.log("PASS: empty/error panes edit the selected source; safe original links and isolated retry work in-place");

  await page.locator("#openControlsButton").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-url-input="0"]').isVisible(), true);
  await page.locator('[data-url-input="1"]').hover();
  assert.equal(await page.locator('[data-tile="1"]').evaluate(el => el.classList.contains("is-highlighted")), true);
  await page.mouse.move(100, 100);
  await page.locator('[data-url-input="1"]').focus();
  await page.locator('[data-url-input="0"]').focus();
  assert.equal(await page.locator('[data-tile="0"]').evaluate(el => el.classList.contains("is-highlighted")), true);
  await page.waitForFunction(() => document.activeElement.dataset.urlInput === "0");
  await page.locator('[data-url-input="0"]').fill("https://fixture.example/ui-draft");
  assert.equal(await page.locator('[data-url-input="0"]').isVisible(), true);
  assert.equal(await page.locator("#applyButton").textContent(), "Apply (1)");
  await page.keyboard.press("Escape");
  await page.locator("#openControlsButton").focus(); await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-url-input="0"]').isVisible(), true);
  assert.equal(await page.locator('[data-url-input="0"]').inputValue(), "https://fixture.example/ui-draft");
  assert.equal(await page.locator('[data-tile="0"] iframe').getAttribute("src"), "https://fixture.example/ui-first");
  await page.locator("#discardButton").click();
  assert.equal(await page.evaluate(() => keptUiFrame.isConnected), true);
  await page.evaluate(() => {
    setTileStatus(document.querySelector('[data-tile="0"]'), "sourceOffline");
    setTileStatus(document.querySelector('[data-tile="1"]'), "sourceReconnecting");
  });
  assert.equal(await page.locator('[data-status-container="0"]').getAttribute("data-tone"), "neutral");
  assert.equal(await page.locator('[data-status-container="1"]').getAttribute("data-tone"), "loading");
  console.log("PASS: directly editable URLs preserve drafts and players; pointer/keyboard locate panes; offline is neutral");

  if (process.env.UI_REVIEW_OUTPUT) {
    await fs.mkdir(process.env.UI_REVIEW_OUTPUT, { recursive: true });
    await page.evaluate(async () => {
      state.language = "zh-TW"; applyLanguage(); await renderStage();
      state.slots[0].title = "週末賽事直播：四路畫面與即時賽況";
      state.slots[1].title = "音樂與聊天直播";
      renderControls();
      saveStatus.textContent = "";
    });
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(process.env.UI_REVIEW_OUTPUT, `controls-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.keyboard.press("Escape");
  const splitter = page.locator('[data-splitter="col"]');
  await splitter.focus();
  await page.keyboard.press("ArrowRight");
  const value = Number(await splitter.getAttribute("aria-valuenow"));
  assert.equal(await splitter.locator("[data-split-ratio]").textContent(), `${value}% / ${100 - value}%`);
  assert.equal(await splitter.locator(".splitter-feedback").evaluate(el => getComputedStyle(el).opacity), "1");
  await splitter.dblclick();
  assert.equal(await splitter.getAttribute("aria-valuenow"), "50");
  assert.equal(await page.evaluate(() => keptUiFrame.isConnected), true);
  console.log("PASS: splitters show proportions and reset on double-click without reloading playback");
};
