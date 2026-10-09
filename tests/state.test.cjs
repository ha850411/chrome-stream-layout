"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function rig(initial, legacy = false) {
  const context = vm.createContext({ URL, structuredClone, navigator: { language: "en" } });
  for (const file of ["state-model", "state-service"]) vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/${file}.js`), "utf8"), context);
  let data = { [legacy ? "live-mosaic-state-v2" : "chrome-stream-layout-state-v1"]: initial };
  let fail = false;
  const storage = {
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(data[key])])),
    set: async (values) => { if (fail) throw new Error("Disk unavailable"); await new Promise((resolve) => setTimeout(resolve, 2)); data = { ...data, ...structuredClone(values) }; }
  };
  return { context, save: context.createStateService(storage), state: () => context.normalizeState(data["chrome-stream-layout-state-v1"]), fail: (value) => { fail = value; } };
}

test("Stale tabs merge independent source, layout and size changes without lost updates", async () => {
  const r = rig();
  const base = r.context.normalizeState();
  const source = structuredClone(base); source.slots[0].url = "https://example.com/new";
  const layout = structuredClone(base); layout.layout = 2;
  const size = structuredClone(base); size.sizes.layout4.row = 63;
  const results = await Promise.all([source, layout, size].map((next) => r.save({ type: "save-settings", changes: r.context.stateChanges(base, next) })));
  assert.ok(results.every((result) => result.ok));
  assert.equal(r.state().slots[0].url, source.slots[0].url);
  assert.equal(r.state().layout, 2);
  assert.equal(r.state().sizes.layout4.row, 63);
});

test("Conflicting changes reject atomically, with the stored state available for recovery", async () => {
  const r = rig();
  const base = r.context.normalizeState();
  const a = structuredClone(base); a.slots[0].url = "https://a.example";
  const b = structuredClone(base); b.slots[0].url = "https://b.example"; b.layout = 2;
  await r.save({ type: "save-settings", changes: r.context.stateChanges(base, a) });
  const conflict = await r.save({ type: "save-settings", changes: r.context.stateChanges(base, b) });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.state.slots[0].url, a.slots[0].url);
  assert.equal(r.state().layout, 4);
});

test("A delayed preference event cannot modify a replaced source", async () => {
  const r = rig({ slots: [{ url: "https://a.example" }] });
  const base = r.state();
  const replacement = structuredClone(base); replacement.slots[0].url = "https://b.example";
  const preferences = structuredClone(base); preferences.slots[0].volume = .25; preferences.slots[0].muted = false;
  await r.save({ type: "save-settings", changes: r.context.stateChanges(base, replacement) });
  assert.equal((await r.save({ type: "save-settings", changes: r.context.stateChanges(base, preferences) })).conflict, true);
  assert.equal(r.state().slots[0].volume, 1);
});

test("Failed writes preserve saved data and subsequent retries succeed", async () => {
  const r = rig({ layout: 3 }, true);
  const base = r.context.normalizeState({ layout: 3 });
  const next = { ...base, layout: 2 };
  const request = { type: "save-settings", changes: r.context.stateChanges(base, next) };
  r.fail(true);
  await assert.rejects(r.save(request), /Disk unavailable/);
  r.fail(false);
  assert.equal((await r.save(request)).ok, true);
  assert.equal(r.state().layout, 2);
});

test("A stale pane swap cannot discard newer audio preferences or partly reorder sources", async () => {
  const r = rig({ slots: [{ url: "https://a.example" }, { url: "https://b.example" }] });
  const base = r.state();
  const audio = structuredClone(base); audio.slots[0].volume = .6;
  const swap = structuredClone(base); [swap.slots[0], swap.slots[1]] = [swap.slots[1], swap.slots[0]];
  await r.save({ type: "save-settings", changes: r.context.stateChanges(base, audio) });
  const result = await r.save({ type: "save-settings", changes: r.context.stateChanges(base, swap) });
  assert.equal(result.conflict, true);
  assert.equal(r.state().slots[0].url, "https://a.example");
  assert.equal(r.state().slots[0].volume, .6);
  assert.equal(r.state().slots[1].url, "https://b.example");
});

test("Malformed settings cannot create unknown fields or pollute prototypes", () => {
  const r = rig();
  for (const path of ["__proto__.polluted", "slots.5", "sizes.layout9.row", "unknown"]) {
    assert.throws(() => r.context.mergeStateChanges({}, [{ path, after: true }]));
  }
  assert.equal({}.polluted, undefined);
  const state = r.context.normalizeState({ layout: -1, slots: [{ volume: 99, muted: "no", quality: "invalid" }] });
  assert.equal(state.layout, 4);
  assert.equal(state.slots[0].volume, 1);
  assert.equal(state.slots[0].muted, null);
  assert.equal(state.slots[0].quality, "auto");
});

test("Cached titles are retained on saves without renaming a replacement source", async () => {
  const r = rig({ slots: [{ url: "https://a.example" }] });
  await r.save({ type: "save-settings", changes: [], titles: [{ url: "https://a.example", title: " Live   title " }] });
  assert.equal(r.state().slots[0].title, "Live title");
  const base = r.state();
  const next = structuredClone(base); next.slots[0] = { url: "https://b.example", title: "New title" };
  await r.save({ type: "save-settings", changes: r.context.stateChanges(base, next), titles: [{ url: "https://a.example", title: "Late stale title" }] });
  assert.equal(r.state().slots[0].title, "New title");
});

test("Context-menu assignment expands hidden panes and preserves other sources and settings", async () => {
  const r = rig({ language: "zh-TW", layout: 2, slots: [{ url: "https://kept.example/", volume: .3, muted: false }], sizes: { layout4: { col: 64 } } });
  const kept = structuredClone(r.state().slots[0]);
  await r.save({ type: "assign-page-source", index: 2, url: "https://new.example/three", title: " Third  stream " });
  assert.equal(r.state().layout, 3);
  assert.equal(r.state().slots[2].title, "Third stream");
  await r.save({ type: "assign-page-source", index: 3, url: "https://new.example/four" });
  assert.equal(r.state().layout, 4);
  assert.deepEqual(structuredClone(r.state().slots[0]), kept);
  assert.equal(r.state().slots[2].url, "https://new.example/three");
  assert.equal(r.state().language, "zh-TW");
  assert.equal(r.state().sizes.layout4.col, 64);
});

test("A replacement resets playback preferences; adding the same URL keeps them", async () => {
  const r = rig({ slots: [{ url: "https://old.example/", title: "Old", volume: .2, muted: false, quality: "1080p60" }] });
  await r.save({ type: "assign-page-source", index: 0, url: "https://old.example/", title: "Updated title" });
  assert.equal(r.state().slots[0].volume, .2);
  assert.equal(r.state().slots[0].quality, "1080p60");
  await r.save({ type: "assign-page-source", index: 0, url: "https://new.example/", title: "New" });
  assert.deepEqual(JSON.parse(JSON.stringify(r.state().slots[0])), { url: "https://new.example/", title: "New", volume: 1, muted: null, quality: "auto" });
});

test("Context-menu writes serialize with dashboard saves without losing independent changes", async () => {
  const r = rig({ layout: 2 });
  const before = r.state();
  const resized = structuredClone(before); resized.sizes.layout4.col = 67;
  const results = await Promise.all([
    r.save({ type: "assign-page-source", index: 3, url: "https://four.example/" }),
    r.save({ type: "save-settings", changes: r.context.stateChanges(before, resized) }),
    r.save({ type: "assign-page-source", index: 1, url: "https://two.example/" })
  ]);
  assert.ok(results.every(result => result.ok));
  assert.equal(r.state().layout, 4);
  assert.equal(r.state().sizes.layout4.col, 67);
  assert.equal(r.state().slots[3].url, "https://four.example/");
  assert.equal(r.state().slots[1].url, "https://two.example/");
});

test("Invalid context-menu assignments and failed saves leave stored sources unchanged", async () => {
  const r = rig({ slots: [{ url: "https://kept.example/" }] });
  const before = structuredClone(r.state());
  for (const patch of [{ index: -1 }, { index: 4 }, { index: "1" }, { url: "javascript:alert(1)" }, { url: "file:///private" }, { url: "not a URL" }]) {
    await assert.rejects(r.save({ type: "assign-page-source", index: 0, url: "https://new.example/", ...patch }));
  }
  r.fail(true);
  await assert.rejects(r.save({ type: "assign-page-source", index: 0, url: "https://new.example/" }));
  assert.deepEqual(structuredClone(r.state()), before);
  r.fail(false);
  assert.equal((await r.save({ type: "assign-page-source", index: 0, url: "https://new.example/" })).ok, true);
});
