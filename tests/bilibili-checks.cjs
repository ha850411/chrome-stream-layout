"use strict";

const assert = require("node:assert/strict");

module.exports = async function checkBilibiliTitles(page) {
  const pending = new Map();
  const pattern = "https://api.live.bilibili.com/room/v1/Room/*";
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/room_init")) {
      const roomId = { 6: 600006, 35: 350035 }[url.searchParams.get("id")];
      await route.fulfill({ json: { code: 0, data: { room_id: roomId } } });
    } else {
      pending.set(url.searchParams.get("room_id"), route);
    }
  });
  const takeRequest = async (roomId) => {
    for (let i = 0; i < 150 && !pending.has(roomId); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(pending.has(roomId), `expected title lookup for ${roomId}`);
    const request = pending.get(roomId);
    pending.delete(roomId);
    return request;
  };
  const answer = (request, roomId, title) => request.fulfill({ json: { code: 0, data: { room_id: roomId, title } } });
  const waitForTitle = (index, title) => page.waitForFunction(
    ({ index, title }) => state.slots[index].title === title &&
      document.querySelector(`[data-slot-title="${index}"]`).textContent === title,
    { index, title }, { timeout: 3000 }
  );
  try {
    await page.evaluate(async () => {
      window.originalBilibiliRefresh = refreshBilibiliFrameTitle;
      window.bilibiliTitleJobs = new WeakMap();
      refreshBilibiliFrameTitle = (iframe) => {
        const job = originalBilibiliRefresh(iframe);
        bilibiliTitleJobs.set(iframe, job);
        return job;
      };
      state.layout = 2;
      state.slots = [
        { url: "https://live.bilibili.com/6", title: "Bilibili Live Activity Player" },
        { url: "https://live.bilibili.com/35", title: "" }, { url: "" }, { url: "" }
      ];
      renderControls();
      await renderStage();
    });
    const room6 = await takeRequest("600006");
    const room35 = await takeRequest("350035");
    await page.waitForFunction(() => [0, 1].every((index) =>
      document.querySelector(`[data-tile="${index}"]`).dataset.status === "sourcePageLoaded"));
    await waitForTitle(0, "Bilibili · 6");
    await waitForTitle(1, "Bilibili · 35");
    assert.equal(await page.locator("#stage iframe").count(), 2);
    console.log("PASS: pending Bilibili titles do not delay player loading or retain generic titles");

    await answer(room35, 350035, "SL群星联赛秋季赛");
    await waitForTitle(1, "SL群星联赛秋季赛");
    await page.evaluate(() => swapSourceSlots(0, 1));
    await answer(room6, 600006, "【直播】WE vs JDG");
    await waitForTitle(1, "【直播】WE vs JDG");
    await waitForTitle(0, "SL群星联赛秋季赛");
    await page.evaluate(() => openControls());
    for (const frame of page.frames().filter((item) => item.url().includes("live-activity-player"))) {
      await frame.evaluate((origin) => top.postMessage({
        type: "chrome-stream-layout:frame-title", title: "Bilibili Live Activity Player"
      }, origin), page.url().split("/").slice(0, 3).join("/"));
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await waitForTitle(1, "【直播】WE vs JDG");
    await waitForTitle(0, "SL群星联赛秋季赛");
    console.log("PASS: Bilibili room titles follow reordered panes and survive player title reports");

    await page.evaluate(async () => {
      await retryTiles([1]);
      window.oldBilibiliFrame = document.querySelector('[data-tile="1"] iframe');
    });
    const stale = await takeRequest("600006");
    await page.evaluate(() => retryTiles([1]));
    const fresh = await takeRequest("600006");
    await answer(fresh, 600006, "Updated match title");
    await waitForTitle(1, "Updated match title");
    await answer(stale, 600006, "Stale match title");
    await page.evaluate(() => bilibiliTitleJobs.get(oldBilibiliFrame));
    await waitForTitle(1, "Updated match title");
    console.log("PASS: reloading refreshes Bilibili titles and ignores an older response for the same URL");

    await page.evaluate(() => retryTiles([1]));
    await (await takeRequest("600006")).fulfill({ status: 503, body: "Temporarily unavailable" });
    await page.evaluate(() => bilibiliTitleJobs.get(document.querySelector('[data-tile="1"] iframe')));
    await waitForTitle(1, "Updated match title");
    await page.waitForFunction(() => document.querySelector('[data-tile="1"]').dataset.status === "sourcePageLoaded");
    console.log("PASS: failed metadata retains a known title without failing the player");
  } finally {
    await page.unroute(pattern);
    await page.evaluate(() => { refreshBilibiliFrameTitle = originalBilibiliRefresh; closeControls(); });
  }
};
