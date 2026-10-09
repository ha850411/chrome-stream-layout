"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");

module.exports = async function checkFrameRules(context, page, worker) {
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url === "/parent") {
      response.end('<!doctype html><title>Ordinary page</title><iframe src="/ancestors"></iframe>');
      return;
    }
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", request.url === "/plain-csp" ? "script-src 'none'" : "frame-ancestors 'none'; script-src 'unsafe-inline'");
    response.setHeader("Content-Security-Policy-Report-Only", "script-src 'none'");
    response.end('<!doctype html><title>Header fixture</title><p id="frame-marker">Frame loaded</p><script>window.fixtureScriptRan=true;</script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const routePattern = `${origin}/**`;
  // Real loopback responses exercise Chrome's DNR pipeline, without routed
  // fulfill responses masking header behavior or any external network service.
  await context.route(routePattern, (route) => route.continue());
  let ordinary;
  try {
    // Load legacy saved sources with compatibility disabled. They should now
    // embed automatically, without a per-source switch or a manual resave.
    const dashboardUrl = page.url();
    await page.evaluate(async () => { await saveInFlight; });
    await page.goto("about:blank");
    await worker.evaluate(async (origin) => {
      await chrome.storage.local.set({ [STORAGE_KEY]: {
        language: "en", layout: 2, slots: [
          { url: `${origin}/plain-csp`, compatibility: false },
          { url: `${origin}/ancestors`, compatibility: false }
        ]
      } });
    }, origin);
    await page.goto(dashboardUrl);
    await page.frameLocator('[data-tile="0"] iframe').locator("#frame-marker").waitFor();
    await page.frameLocator('[data-tile="1"] iframe').locator("#frame-marker").waitFor();
    const frame = (i) => page.frames().find((value) => value.url() === `${origin}/${i ? "ancestors" : "plain-csp"}`);
    assert.equal(await frame(0).evaluate(() => window.fixtureScriptRan), undefined, "CSP without frame-ancestors must stay enforced");
    assert.equal(await frame(1).evaluate(() => window.fixtureScriptRan), true, "automatic compatibility must override the old disabled setting");
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    const headerRules = rules.filter((rule) => rule.action.responseHeaders);
    assert.ok(headerRules.length);
    assert.ok(headerRules.every((rule) => !rule.action.responseHeaders.some((header) => header.header === "content-security-policy-report-only")));
    assert.ok(headerRules.filter((rule) => rule.action.responseHeaders.some((header) => header.header === "content-security-policy")).every((rule) => rule.condition.responseHeaders[0].values.includes("*frame-ancestors*")));

    ordinary = await context.newPage();
    const blocked = ordinary.waitForEvent("console", { predicate: (message) => /frame-ancestors|X-Frame-Options|refused to frame/i.test(message.text()) });
    await ordinary.goto(`${origin}/parent`);
    await blocked;
    assert.equal(await ordinary.frameLocator("iframe").locator("#frame-marker").count(), 0);
    await ordinary.close(); ordinary = null;

    // An origin stays enabled while another active pane still needs it.
    await page.evaluate(async () => {
      state.slots[0] = { url: "", title: "" };
      await persistState(""); await renderStage(); await retryTiles([1]);
    });
    await page.frameLocator('[data-tile="1"] iframe').locator("#frame-marker").waitFor();
    assert.equal(await frame(1).evaluate(() => window.fixtureScriptRan), true);
    assert.ok((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).some((rule) => rule.action.responseHeaders));
    await page.evaluate(async () => {
      state.slots[1] = { url: "", title: "" };
      await persistState(""); await renderStage();
    });
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).filter((rule) => rule.action.responseHeaders).length, 0);
    console.log("PASS: embedding is automatic with legacy settings; real HTTP rules retain unrelated CSP, follow active sources, and leave ordinary tabs protected");
  } finally {
    await ordinary?.close();
    await page.evaluate(async () => { state = normalizeState({ language: "en" }); await persistState(""); await renderStage(); });
    await context.unroute(routePattern);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};
