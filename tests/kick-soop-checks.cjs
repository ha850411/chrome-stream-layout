"use strict";

const assert = require("node:assert/strict");

module.exports = async function checkKickSoop(page) {
  await page.evaluate(async () => {
    state.layout = 2;
    state.slots = [{ url: "https://kick.com/starladder" }, { url: "https://play.sooplive.co.kr/afstar1/123456" }, { url: "" }, { url: "" }];
    renderControls();
    await renderStage();
  });
  const sources = [
    "https://player.kick.com/starladder?autoplay=true&muted=true",
    "https://play.sooplive.com/afstar1/123456/embed"
  ];
  for (let index = 0; index < sources.length; index++) {
    assert.equal(await page.locator(`iframe[data-tile-frame="${index}"]`).getAttribute("src"), sources[index]);
    await page.waitForFunction((index) => document.querySelector(`[data-tile="${index}"]`).dataset.status === "sourcePageLoaded", index);
    const frame = page.frames().find((candidate) => candidate.url() === sources[index]);
    await frame.evaluate(async () => {
      const video = document.createElement("video");
      video.muted = true;
      video.controls = true;
      video.style.cssText = "width:320px;height:180px";
      document.body.replaceChildren(video);
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 180;
      video.srcObject = canvas.captureStream(10);
      const paint = () => canvas.getContext("2d").fillRect(0, 0, 320, 180);
      paint(); window.setInterval(paint, 100);
      await video.play();
    });
    await page.waitForFunction((index) => document.querySelector(`[data-tile="${index}"]`).dataset.status === "sourcePlaying", index);
  }
  await page.frames().find((frame) => frame.url() === sources[0]).evaluate(() => document.querySelector("video").pause());
  await page.waitForFunction(() => document.querySelector('[data-tile="0"]').dataset.status === "sourcePaused");
  assert.equal(await page.locator('[data-tile="1"]').getAttribute("data-status"), "sourcePlaying");
  console.log("PASS: Kick and SOOP use official player URLs and independently report playback/pause");
};
