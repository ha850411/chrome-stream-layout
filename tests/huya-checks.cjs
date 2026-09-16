"use strict";

// Uses the browser runner's Huya HTTP fixture with the real content scripts.
const assert = require("node:assert/strict");

module.exports = async function checkHuyaPrompts(context, page) {
  await page.evaluate(async () => {
    state.slots[0] = { url: "https://www.huya.com/660000" };
    await renderStage();
  });
  const frame = page.frameLocator('iframe[data-tile-frame="0"]');
  await frame.locator("#chrome-stream-layout-huya-style").waitFor({ state: "attached" });
  const prompts = frame.locator("#player-enter-room, #player-enter-room-center");
  assert.equal(await prompts.count(), 2);
  for (const prompt of await prompts.all()) assert.equal(await prompt.isVisible(), false);
  for (const selector of ["video", "#player-fullscreen-btn", "#player-volume-btn", "#player-play-btn", ".player-tip"]) {
    assert.equal(await frame.locator(selector).isVisible(), true, `${selector} is preserved`);
  }
  await frame.locator("#player-play-btn").evaluate((element) => element.addEventListener("click", () => { element.dataset.clicked = "true"; }));
  await frame.locator("#player-play-btn").click();
  assert.equal(await frame.locator("#player-play-btn").getAttribute("data-clicked"), "true");
  await frame.locator("#player-enter-room-center").evaluate((element) => {
    const replacement = element.cloneNode(true);
    replacement.style.display = "block";
    element.replaceWith(replacement);
  });
  assert.equal(await frame.locator("#player-enter-room-center").isVisible(), false);
  await frame.locator("video").evaluate(async (video) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    video.srcObject = canvas.captureStream(10);
    const paint = () => canvas.getContext("2d").fillRect(0, 0, 320, 180);
    paint(); window.setInterval(paint, 100);
    await video.play();
  });
  await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePlaying");
  assert.equal(await frame.locator("video").evaluate((video) => !video.paused && video.readyState >= 2), true);

  const assertWithinFrame = async (selector) => {
    const bounds = await frame.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1,
      `${selector} must fit: ${JSON.stringify(bounds)}`);
  };
  for (const [width, height, col, row] of [[1123, 900, 50, 50], [1440, 900, 18, 18], [1000, 600, 18, 18]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async ({ col, row }) => {
      state.layout = 4;
      state.sizes.layout4 = { col, row };
      await renderStage();
    }, { col, row });
    await frame.locator("#player-danmu-btn").hover();
    await frame.locator(".player-danmu-pane").waitFor({ state: "visible" });
    await assertWithinFrame(".player-danmu-pane");
    await frame.locator("#danmu-setting").click();
    await frame.locator(".player-videotype").hover();
    await frame.locator(".player-videotype-list").waitFor({ state: "visible" });
    await assertWithinFrame(".player-videotype-list");
    await frame.locator(".player-videotype-list").evaluate((element) => element.classList.add("has-bitrate-btn"));
    await assertWithinFrame(".player-videotype-list");
    await frame.locator(".player-videotype-list").evaluate((element) => element.classList.remove("has-bitrate-btn"));
    await assertWithinFrame("video");
  }
  console.log("PASS: Huya danmu and quality menus fit through narrow 180px and short 160px panes");

  // The same official player opened normally must retain its room links.
  const standalone = await context.newPage();
  try {
    await standalone.goto("https://liveshare.huya.com/iframe/660000");
    assert.equal(await standalone.locator("#player-enter-room").isVisible(), true);
    assert.equal(await standalone.locator("#player-enter-room-center").isVisible(), true);
    assert.equal(await standalone.locator("#chrome-stream-layout-huya-style").count(), 0);
  } finally { await standalone.close(); }
  console.log("PASS: Huya room prompts stay hidden after replacement; playback/controls and ordinary Huya tabs are preserved");
};
