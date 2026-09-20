"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://stream.example/live.m3u8\n';
const token = (sequence = 1, extra = {}) => ({ data: { streamPlaybackAccessToken: {
  value: JSON.stringify({ sequence, expires: Math.floor(Date.now() / 1000) + 1200, authorization: { forbidden: false }, ...extra }),
  signature: `signature/${sequence}+=&`
} } });
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const master = (body = playlist, status = 200) => ({ ok: status === 200, status, text: async () => body });
function load(fetch, overrides = {}) {
  const context = vm.createContext({ URL, AbortController, fetch, SOURCE_RESOLVE_TIMEOUT_MS: 8000,
    window: { setTimeout, clearTimeout }, ...overrides });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/twitch-source.js"), "utf8"), context);
  return context;
}

test("Each Twitch refresh requests a fresh anonymous token and correctly encodes the signed URL", async () => {
  const calls = [];
  let sequence = 0;
  const r = load(async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    if (url.hostname === "gql.twitch.tv") {
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.operationName, "PlaybackAccessToken");
      assert.deepEqual(body.variables, { isLive: true, login: "roger9527", isVod: false, vodID: "", playerType: "embed", platform: "site" });
      assert.equal(options.headers.Authorization, undefined);
      return json(token(++sequence));
    }
    assert.equal(url.origin + url.pathname, "https://usher.ttvnw.net/api/v2/channel/hls/roger9527.m3u8");
    assert.equal(url.searchParams.get("sig"), `signature/${sequence}+=&`);
    assert.equal(JSON.parse(url.searchParams.get("token")).sequence, sequence);
    assert.equal(url.searchParams.get("supported_codecs"), "h264");
    return master();
  });
  const a = await r.fetchTwitchLiveStream("roger9527");
  const b = await r.fetchTwitchLiveStream("roger9527");
  assert.notEqual(a.url, b.url);
  assert.equal(b.title, "Twitch · roger9527");
  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.signal, calls[1].options.signal);
  assert.notEqual(calls[0].options.signal, calls[2].options.signal);
});

for (const [name, response, code] of [
  ["missing channel", json({ data: { streamPlaybackAccessToken: null } }), "sourceOffline"],
  ["token authorization denied", json(token(1, { authorization: { forbidden: true } })), "sourceRestricted"],
  ["HTTP 401", json({}, 401), "sourceRestricted"],
  ["HTTP 403", json({}, 403), "sourceRestricted"],
  ["API error", json({}, 500), undefined],
  ["GraphQL errors with partial data", json({ ...token(), errors: [{ message: "unavailable" }] }), undefined],
  ["GraphQL integrity challenge", json({ errors: [{ message: "failed integrity check" }] }), "sourceRestricted"],
  ["GraphQL authorization code", json({ errors: [{ message: "denied", extensions: { code: "FORBIDDEN" } }] }), "sourceRestricted"],
  ["missing data", json({}), undefined],
  ["missing signature", json({ data: { streamPlaybackAccessToken: { value: "{}" } } }), undefined],
  ["empty signature", json({ data: { streamPlaybackAccessToken: { value: "{}", signature: "" } } }), undefined],
  ["invalid token JSON", json({ data: { streamPlaybackAccessToken: { value: "not json", signature: "sig" } } }), undefined],
  ["null token data", json({ data: { streamPlaybackAccessToken: { value: "null", signature: "sig" } } }), undefined],
  ["expired token", json(token(1, { expires: 1 })), undefined]
]) {
  test(`Twitch rejects ${name} before requesting a playlist`, async () => {
    let calls = 0;
    const r = load(async () => { calls++; return response; });
    await assert.rejects(r.fetchTwitchLiveStream("roger9527"), (error) => error.code === code);
    assert.equal(calls, 1);
  });
}

test("Throttled Twitch lookups carry a bounded server retry delay", async () => {
  const response = { ...json({}, 429), headers: { get: () => "45" } };
  const r = load(async () => response);
  await assert.rejects(r.fetchTwitchLiveStream("roger9527"), (error) => error.retryAfterMs === 45000);
  response.headers.get = () => "999999";
  await assert.rejects(r.fetchTwitchLiveStream("roger9527"), (error) => error.retryAfterMs === 300000);
});

for (const [name, response, code] of [
  ["offline", master("", 404), "sourceOffline"],
  ["restricted", master("", 403), "sourceRestricted"],
  ["unauthorized", master("", 401), "sourceRestricted"],
  ["server failure", master("", 503), undefined],
  ["HTML error page", master("<html>Error</html>"), undefined],
  ["empty HLS playlist", master("#EXTM3U\n"), undefined]
]) {
  test(`Twitch classifies a ${name} playlist without caching the failure`, async () => {
    let calls = 0;
    const r = load(async () => ++calls % 2 ? json(token(calls)) : calls === 2 ? response : master());
    await assert.rejects(r.fetchTwitchLiveStream("roger9527"), (error) => error.code === code);
    assert.ok((await r.fetchTwitchLiveStream("roger9527")).url);
    assert.equal(calls, 4);
  });
}

for (const phase of ["token", "playlist", "playlist body"]) {
  test(`Twitch times out while reading the ${phase}, and a new lookup can recover`, async () => {
    let block = true;
    const r = load(async (url, { signal }) => {
      const wait = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      if (block && phase === "token") return wait();
      if (url.includes("gql.twitch.tv")) return json(token());
      if (block && phase === "playlist") return wait();
      if (block && phase === "playlist body") return { ok: true, status: 200, text: wait };
      return master();
    }, { SOURCE_RESOLVE_TIMEOUT_MS: 5 });
    await assert.rejects(r.fetchTwitchLiveStream("roger9527"), (error) => error.code === "sourceTimeout");
    block = false;
    assert.ok((await r.fetchTwitchLiveStream("roger9527")).url);
  });
}

test("Cancelling one Twitch pane aborts its request without cancelling another pane", async () => {
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  const r = load(async (url, options) => {
    if (options.body && JSON.parse(options.body).variables.login === "cancel_me") {
      started();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled"))));
    }
    return url.includes("gql.twitch.tv") ? json(token()) : master();
  });
  const controller = new AbortController();
  const cancelled = r.fetchTwitchLiveStream("cancel_me", controller.signal);
  await pending;
  const other = r.fetchTwitchLiveStream("other_channel");
  controller.abort();
  await assert.rejects(cancelled, (error) => error.name === "AbortError" && !error.code);
  assert.equal((await other).title, "Twitch · other_channel");
});

test("Already-cancelled requests and invalid channel names perform no network request", async () => {
  const r = load(() => assert.fail("must not fetch"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(r.fetchTwitchLiveStream("roger9527", controller.signal), (error) => error.name === "AbortError");
  for (const channel of ["", "../other", "foo?sig=bar", "foo/bar", "foo\n"]) {
    await assert.rejects(r.fetchTwitchLiveStream(channel));
  }
  assert.equal(r.getTwitchLiveChannel(null), "");
});
