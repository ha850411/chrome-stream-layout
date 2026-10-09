"use strict";

// Runs inside browser.cjs's extension and HTTP fixtures.
const assert = require("node:assert/strict");

module.exports = async function checkLayoutMaximize(page) {
  const urls = ["one", "two", "three", "four"].map((name) => `https://fixture.example/maximize-${name}`);
  const customSizes = { layout2: { col: 28 }, layout3: { col: 75, row: 32 }, layout4: { col: 38, row: 68 } };
  const fittedSizes = { layout2: { col: 50 }, layout3: { col: 58, row: 50 }, layout4: { col: 50, row: 50 } };
  const draft = "https://fixture.example/unapplied-maximize";
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);

  await page.evaluate(() => {
    window.originalRequestFullscreen = document.body.requestFullscreen;
    window.maximizeFullscreenRequests = 0;
    document.body.requestFullscreen = async () => {
      window.maximizeFullscreenRequests += 1;
      throw new Error("Maximizing must work without fullscreen permission");
    };
  });

  for (const layout of [2, 3, 4]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(async ({ layout, customSizes, urls, draft }) => {
      state.layout = layout;
      state.language = layout === 3 ? "zh-TW" : "en";
      state.sizes = structuredClone(customSizes);
      state.slots = urls.map((url) => ({ url, title: "" }));
      draftUrls = [draft, ...urls.slice(1)];
      applyLanguage();
      await renderStage();
      openControls();
      window.maximizeFrames = Array.from({ length: layout }, (_, index) => stage.querySelector(`[data-tile="${index}"] iframe`));
    }, { layout, customSizes, urls, draft });
    await page.waitForFunction(() => Array.from(stage.querySelectorAll("[data-tile]")).every((tile) => tile.dataset.status === "sourcePageLoaded"));
    const frames = page.frames().filter((frame) => urls.includes(frame.url()));
    for (const frame of frames) await frame.evaluate(() => { window.maximizePlaybackMarker = "kept"; });
    assert.equal(await page.locator("#maximizeLayoutButton").textContent().then((text) => text.trim()), layout === 3 ? "適配視窗" : "Fit to window");
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 640, height: 360 }, { width: 320, height: 568 }, { width: 900, height: 280 }, { width: 1920, height: 910 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => openControls());
      await page.locator("#maximizeLayoutButton").click();
      await page.waitForFunction(() => controlOverlay.hidden);
      assert.equal(await page.evaluate(() => document.fullscreenElement), null, "maximizing stays in the normal browser window");
      assert.equal(await page.evaluate(() => maximizeFullscreenRequests), 0, "maximizing never requests fullscreen");
      assert.equal(await page.locator("body").evaluate((element) => element.classList.contains("is-browser-fullscreen")), false);
      assert.equal(await page.locator(".app-shell").evaluate((element) => element.inert), false);
      const bounds = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        stage: stage.getBoundingClientRect().toJSON(),
        tiles: Array.from({ length: state.layout }, (_, index) => stage.querySelector(`[data-tile="${index}"]`).getBoundingClientRect().toJSON()),
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight
      }));
      const { width, height, tiles } = bounds;
      assert.equal(tiles.length, layout);
      near(bounds.stage.x, 0, "stage starts at left");
      near(bounds.stage.y, 0, "stage starts at top");
      near(bounds.stage.width, width, "stage fills viewport width");
      near(bounds.stage.height, height, "stage fills viewport height");
      assert.ok(bounds.scrollWidth <= width && bounds.scrollHeight <= height, "maximized content has no scroll overflow");
      for (const tile of tiles) {
        assert.ok(tile.x >= 0 && tile.y >= 0 && tile.right <= width + 1 && tile.bottom <= height + 1, "every pane stays inside the screen");
      }
      const leftWidth = layout === 3 ? tiles[0].width : (width - 5) / 2;
      const rightWidth = width - 5 - leftWidth;
      if (layout === 3) {
        const leftFraction = leftWidth / (width - 5);
        assert.ok(leftFraction >= 0.179 && leftFraction <= 0.821, "three-pane split respects resize limits");
        if (width >= 640) assert.ok(Math.abs(tiles[1].width / tiles[1].height - 16 / 9) < 0.01, "right panes fit 16:9 videos to the available height");
        if (width === 1920) near(leftWidth, (width - 5) * 0.58, "reference screenshot uses about 58% for the left pane");
      }
      near(tiles[0].width, leftWidth, "left pane width");
      near(tiles[1].width, rightWidth, "right pane width");
      near(tiles[1].x, leftWidth + 5, "right column position");
      near(tiles[0].height, layout === 4 ? (height - 5) / 2 : height, "first pane height");
      if (layout === 2) near(tiles[1].height, height, "both panes use full height");
      else {
        near(tiles[1].height, (height - 5) / 2, "top-right pane height");
        near(tiles[2].y, (height + 5) / 2, "bottom row position");
        near(tiles[2].height, tiles[1].height, "bottom pane height");
        near(tiles[2].x, layout === 3 ? tiles[1].x : 0, "third pane position");
        near(tiles[2].width, layout === 3 ? rightWidth : leftWidth, "third pane width");
        if (layout === 4) {
          near(tiles[3].width, tiles[0].width, "four equal widths");
          near(tiles[3].height, tiles[0].height, "four equal heights");
          near(tiles[3].x, tiles[1].x, "fourth pane column");
          near(tiles[3].y, tiles[2].y, "fourth pane row");
        }
      }
    }

    const expectedSizes = { ...customSizes, [`layout${layout}`]: fittedSizes[`layout${layout}`] };
    await page.waitForFunction(async ({ layout, col }) => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]?.sizes[`layout${layout}`].col === col,
      { layout, col: fittedSizes[`layout${layout}`].col });
    const saved = await page.evaluate(async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
    assert.deepEqual(saved.sizes, expectedSizes, "only current layout proportions are reset and saved");
    assert.deepEqual(saved.slots.map((slot) => slot.url), urls, "maximizing does not apply source drafts");
    assert.equal(await page.evaluate(() => maximizeFrames.every((frame, index) => frame === stage.querySelector(`[data-tile="${index}"] iframe`))), true);
    for (const frame of frames) assert.equal(await frame.evaluate(() => window.maximizePlaybackMarker), "kept", "player documents survive maximization");

    await page.evaluate(() => openControls());
    assert.equal(await page.locator('[data-url-input="0"]').inputValue(), draft);
    console.log(`PASS: ${layout}-pane maximization fills the normal browser window through desktop, narrow and short sizes without fullscreen; drafts and playback survive`);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(({ customSizes }) => {
    state.sizes = structuredClone(customSizes);
    applyStageSizing();
    document.body.requestFullscreen = window.originalRequestFullscreen;
  }, { customSizes });

  // The original fullscreen action still preserves manually resized proportions.
  await page.locator("#fullscreenButton").click();
  await page.waitForFunction(() => document.fullscreenElement === document.body);
  assert.deepEqual(await page.evaluate(() => state.sizes), customSizes);
  await page.locator("#fullscreenButton").click();
  await page.waitForFunction(() => !document.fullscreenElement && !document.body.classList.contains("is-browser-fullscreen"));
  await page.keyboard.press("Escape");
  console.log("PASS: original fullscreen action remains independent and preserves custom proportions");
};
