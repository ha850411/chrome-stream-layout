"use strict";

// Runs inside browser.cjs's extension and HTTP fixtures.
const assert = require("node:assert/strict");

module.exports = async function checkSourceControls(page) {
  const originalUrls = ["first", "second", "third", "fourth"].map((name) => `https://fixture.example/${name}`);
  const draftUrl = "https://fixture.example/draft";
  const input = (index) => page.locator(`[data-url-input="${index}"]`);
  const frame = (index) => page.locator(`[data-tile="${index}"] iframe`);
  const readSaved = () => page.evaluate(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  const waitForSaved = (predicate, value) => page.waitForFunction(predicate, value);
  await page.evaluate(async (urls) => {
    state.layout = 2;
    state.language = "en";
    state.slots = urls.map((url, index) => ({ url, title: `Stream ${index + 1}` }));
    draftUrls = null;
    clearedSources = null;
    unusedSourcesExpanded = false;
    applyLanguage();
    await renderStage();
    await persistState("");
    openControls();
    window.originalFrames = [0, 1].map((index) => document.querySelector(`[data-tile="${index}"] iframe`));
  }, originalUrls);
  await page.waitForFunction(() => [0, 1].every((index) => document.querySelector(`[data-tile="${index}"]`).dataset.status === "sourcePageLoaded"));
  assert.equal(await page.locator(".unused-sources").getAttribute("open"), null);
  assert.equal(await input(2).isVisible(), false);
  assert.equal(await input(2).inputValue(), originalUrls[2]);
  for (const layout of [2, 3, 4]) assert.equal(await page.locator(`[data-layout="${layout}"] rect`).count(), layout);
  assert.equal(await page.locator(".slot-control[draggable=true]").count(), 0);
  assert.equal(await page.locator(".drag-handle[draggable=true]").count(), 4);
  await page.locator(".unused-sources > summary").click();
  assert.equal(await input(3).isVisible(), true);
  await page.locator(".unused-sources > summary").click();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "clearButton");
  // Collapsed <details> children can retain layout boxes; exclude them from drag targets.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator('[data-drag-slot="0"]').dispatchEvent("dragstart", { dataTransfer: transfer });
  assert.deepEqual(await page.evaluate(() => dragSlotRects.map(({ index }) => index)), [0, 1]);
  await page.locator('[data-drag-slot="0"]').dispatchEvent("dragend");
  await transfer.dispose();
  console.log("PASS: layout previews, collapsed retained sources, handle-only drag and hidden focus targets");

  await input(0).fill(draftUrl);
  assert.equal(await page.locator("#applyButton").textContent(), "Apply (1)");
  assert.equal(await page.locator('[data-status-container="0"]').getAttribute("data-tone"), "pending");
  assert.equal(await page.locator('[data-retry-slot="0"]').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => state.slots.map(({ url }) => url)), originalUrls);
  await page.locator("#languageSelect").selectOption("zh-TW");
  assert.equal(await page.locator("#applyButton").textContent(), "套用（1）");
  await page.locator('[data-layout="3"]').click();
  await frame(2).waitFor();
  assert.equal(await input(0).inputValue(), draftUrl);
  assert.equal(await page.evaluate(() => originalFrames.every((element) => element.isConnected)), true);
  await waitForSaved(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]?.layout === 3);
  const saved = await readSaved();
  assert.equal(saved.language, "zh-TW");
  assert.deepEqual(saved.slots.map(({ url }) => url), originalUrls);
  await page.keyboard.press("Escape");
  await page.evaluate(() => openControls());
  assert.equal(await input(0).inputValue(), draftUrl);
  await page.locator("#languageSelect").selectOption("en");
  await page.locator('[data-layout="2"]').click();
  await page.locator("#reloadAllButton").click();
  await page.waitForFunction(() => originalFrames.every((element) => !element.isConnected));
  assert.equal(await frame(0).getAttribute("src"), originalUrls[0]);
  assert.equal(await input(0).inputValue(), draftUrl);
  await page.evaluate(() => { window.unchangedFrame = document.querySelector('[data-tile="1"] iframe'); });
  await page.locator("#applyButton").click();
  await page.waitForFunction((url) => document.querySelector('[data-tile="0"] iframe')?.src === url, draftUrl);
  assert.equal(await page.locator("#controlOverlay").isVisible(), false);
  assert.equal(await page.evaluate(() => unchangedFrame.isConnected && draftUrls === null), true);
  await waitForSaved(async (url) => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]?.slots[0].url === url, draftUrl);
  console.log("PASS: language, layout, reload and dialog closing retain drafts; only Apply commits source changes");

  await page.evaluate(() => openControls());
  await input(1).fill("https://fixture.example/discard-me");
  await page.locator("#discardButton").click();
  assert.equal(await input(1).inputValue(), originalUrls[1]);
  assert.equal(await page.locator("#draftNotice").isVisible(), false);
  assert.equal(await page.evaluate(() => unchangedFrame.isConnected), true);
  await page.locator('[data-clear-slot="1"]').click();
  assert.equal(await input(1).inputValue(), "");
  assert.equal(await page.locator('[data-playback-status="1"]').textContent(), "Apply to remove this source");
  assert.equal(await page.evaluate(() => unchangedFrame.isConnected), true);
  await page.locator("#discardButton").click();
  await input(1).fill("https://fixture.example/preserved-draft");
  await page.locator("#clearButton").click();
  await page.waitForFunction(() => !document.querySelector("#stage iframe"));
  assert.equal(await page.locator("#undoNotice").isVisible(), true);
  assert.equal(await page.locator("#clearButton").isDisabled(), true);
  await page.locator("#languageSelect").selectOption("zh-TW");
  await page.locator('[data-layout="3"]').click();
  await page.locator("#undoButton").click();
  await frame(2).waitFor();
  assert.equal(await frame(0).getAttribute("src"), draftUrl);
  assert.equal(await frame(1).getAttribute("src"), originalUrls[1]);
  assert.equal(await input(1).inputValue(), "https://fixture.example/preserved-draft");
  assert.deepEqual(await page.evaluate(() => [state.language, state.layout]), ["zh-TW", 3]);
  assert.equal(await page.locator("#undoNotice").isVisible(), false);
  await waitForSaved(async (url) => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]?.slots[0].url === url, draftUrl);
  assert.deepEqual((await readSaved()).slots.map(({ url }) => url), [draftUrl, ...originalUrls.slice(1)]);
  console.log("PASS: discard leaves playback intact; Clear all and Undo restore applied sources and drafts");

  await page.locator("#languageSelect").selectOption("en");
  await page.locator('[data-layout="2"]').click();
  await page.waitForFunction(() => [0, 1].every((index) => document.querySelector(`[data-tile="${index}"]`).dataset.status === "sourcePageLoaded"));
  const liveFrame = page.frames().find((element) => element.url() === draftUrl);
  await liveFrame.evaluate(() => { window.playbackMarker = "kept"; });
  await page.evaluate(() => { window.reorderedFrame = document.querySelector('[data-tile="0"] iframe'); });
  await page.locator('[data-drag-slot="1"]').focus();
  await page.keyboard.press("Alt+ArrowUp");
  assert.equal(await input(0).inputValue(), "https://fixture.example/preserved-draft");
  assert.equal(await frame(0).getAttribute("src"), originalUrls[1]);
  assert.equal(await page.evaluate(() => reorderedFrame === document.querySelector('[data-tile="1"] iframe')), true);
  assert.equal(await liveFrame.evaluate(() => window.playbackMarker), "kept");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dragSlot), "0");
  // Actual pointer drag moves the same draft/source pair back.
  await page.locator('[data-drag-slot="0"]').dragTo(page.locator('[data-slot-target="1"]'));
  assert.equal(await input(1).inputValue(), "https://fixture.example/preserved-draft");
  assert.equal(await frame(0).getAttribute("src"), draftUrl);
  assert.equal(await liveFrame.evaluate(() => window.playbackMarker), "kept");
  await page.locator("#discardButton").click();
  // Keyboard ordering across the unused section reveals its destination.
  await page.locator('[data-drag-slot="1"]').focus();
  await page.keyboard.press("Alt+ArrowDown");
  assert.equal(await page.locator(".unused-sources").getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dragSlot), "2");
  assert.equal(await input(2).inputValue(), originalUrls[1]);
  await page.keyboard.press("Alt+ArrowUp");
  console.log("PASS: pointer and keyboard ordering move drafts with sources and preserve active frame playback");

  await page.evaluate(() => setTileStatus(document.querySelector('[data-tile="0"]'), "sourceMediaError"));
  assert.equal(await page.locator('[data-status-container="0"]').getAttribute("data-tone"), "error");
  assert.equal(await page.locator('[data-status-icon="0"]').textContent(), "!");
  assert.equal(await page.locator('[data-retry-slot="0"]').textContent(), "Retry");
  await page.evaluate(() => setTileStatus(document.querySelector('[data-tile="0"]'), "sourcePlaying"));
  assert.equal(await page.locator('[data-status-container="0"]').getAttribute("data-tone"), "playing");
  assert.equal(await page.locator('[data-retry-slot="0"]').textContent(), "Reload");
  console.log("PASS: status text, icons and colors distinguish failure and playback, with contextual retry");

  // Apply also saves pending changes inside a collapsed unused section.
  await input(3).fill("https://fixture.example/unused-draft");
  await page.locator(".unused-sources > summary").click();
  await page.locator("#applyButton").click();
  await waitForSaved(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]?.slots[3].url === "https://fixture.example/unused-draft");
  assert.equal(await frame(3).count(), 0);
  await page.evaluate(() => openControls());
  console.log("PASS: applying a collapsed source saves its URL without loading an unused pane");

  await page.locator('[data-layout="4"]').click();
  await input(0).fill("https://fixture.example/responsive-draft");
  for (const viewport of [{ width: 1366, height: 768 }, { width: 900, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator(".control-dialog").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
    }), true, `panel fits ${viewport.width}x${viewport.height}`);
    assert.equal(await page.locator("#applyButton").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, `Apply stays visible and clickable at ${viewport.width}x${viewport.height}`);
    await page.locator(".control-dialog").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.equal(await page.locator("#clearButton").isVisible(), true);
    await page.locator(".control-dialog").evaluate((element) => { element.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  for (const axis of ["col", "row"]) {
    const splitter = page.locator(`[data-splitter="${axis}"]`);
    const rect = await splitter.boundingBox();
    assert.equal(axis === "col" ? rect.width : rect.height, 15);
    const start = axis === "col" ? { x: rect.x + 2, y: 80 } : { x: 80, y: rect.y + 2 };
    assert.equal(await page.evaluate(({ x, y, axis }) => document.elementFromPoint(x, y)?.dataset.splitter === axis, { ...start, axis }), true);
    const before = Number(await splitter.getAttribute("aria-valuenow"));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + (axis === "col" ? 40 : 0), start.y + (axis === "row" ? 40 : 0));
    await page.mouse.up();
    assert.ok(Number(await splitter.getAttribute("aria-valuenow")) > before);
  }
  console.log("PASS: responsive controls through 320px, sticky actions and wider draggable separators");
};
