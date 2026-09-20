"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup() {
  let time = 0, id = 0;
  const timers = new Map(), retries = [], reports = [];
  const health = { alive: true, visible: true, online: true, active: true, buffering: false };
  let moving = true, framesMoving = true;
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/live-recovery.js"), "utf8"), context);
  const recovery = context.createLiveRecovery({
    now: () => time,
    setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    read: () => ({ ...health, time: moving ? time / 1000 : 0, frames: framesMoving ? time / 10 : 1 }),
    report: (status, terminal) => reports.push({ status, terminal }),
    retry: () => { retries.push(time); recovery.begin({ automatic: true }); recovery.loaded(); }
  });
  function advance(duration) {
    const target = time + duration;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = target;
  }
  recovery.begin(); recovery.loaded();
  return { recovery, timers, retries, reports, health, advance,
    freeze() { moving = false; framesMoving = false; },
    freezeFrames() { framesMoving = false; },
    suspend(duration) {
      time += duration;
      const pending = [...timers.values()]; timers.clear(); pending.forEach(({ fn }) => fn());
    }
  };
}

test("Transient errors use bounded backoff; duplicate SDK events cannot create parallel retries", () => {
  const r = setup();
  for (const delay of [2000, 5000, 10000]) {
    r.recovery.fail({ kind: "network" }); r.recovery.fail({ kind: "ended" });
    assert.equal(r.timers.size, 1);
    const count = r.retries.length;
    r.advance(delay - 1); assert.equal(r.retries.length, count);
    r.advance(1); assert.equal(r.retries.length, count + 1);
  }
  r.recovery.fail(); r.advance(120000);
  assert.deepEqual(r.retries, [2000, 7000, 17000]);
  assert.deepEqual(r.reports.at(-1), { status: "sourceRecoveryFailed", terminal: true });
  assert.equal(r.timers.size, 0);
});

test("Playback authorization failure refreshes the source, but a resolver denial stops retries", () => {
  const r = setup();
  r.recovery.fail({ kind: "authorization", code: 403 }); r.advance(2000);
  assert.equal(r.retries.length, 1);
  r.recovery.fail({ code: "sourceRestricted" }); r.advance(120000);
  assert.equal(r.retries.length, 1);
  assert.equal(r.reports.at(-1).status, "sourceRestricted");
});

for (const error of [{ code: "sourceOffline" }, { code: "sourceRestricted" }, { retryable: false }]) {
  test(`Definitive failure ${JSON.stringify(error)} leaves manual retry available without timers`, () => {
    const r = setup(); r.recovery.fail(error); r.advance(120000);
    assert.equal(r.retries.length, 0); assert.equal(r.timers.size, 0);
    r.recovery.begin(); r.recovery.loaded(); r.recovery.fail(); r.advance(2000);
    assert.equal(r.retries.length, 1);
  });
}

test("Twenty seconds without progress, including frozen frames with advancing time, triggers recovery", () => {
  for (const freeze of ["freeze", "freezeFrames"]) {
    const r = setup(); r[freeze](); r.advance(19999);
    assert.equal(r.reports.length, 0);
    r.advance(1); assert.equal(r.reports.at(-1).status, "sourceReconnecting");
    r.advance(2000); assert.equal(r.retries.length, 1);
  }
});

test("Paused playback, disabled autoplay and blocked autoplay never trigger the watchdog", () => {
  const r = setup(); r.freeze(); r.health.active = false; r.advance(120000);
  assert.equal(r.retries.length, 0); assert.equal(r.timers.size, 0);
  r.recovery.begin({ autoplay: false }); r.recovery.loaded(); r.advance(120000);
  assert.equal(r.timers.size, 0);
  r.recovery.begin(); r.recovery.loaded(); r.recovery.pause(); r.advance(120000);
  assert.equal(r.retries.length, 0);
});

test("Brief playback cannot reset retry budget; one minute of continuous progress can", () => {
  const r = setup();
  for (const delay of [2000, 5000, 10000]) {
    r.recovery.fail(); r.advance(delay); r.advance(10000);
  }
  r.recovery.fail(); assert.equal(r.reports.at(-1).status, "sourceRecoveryFailed");
  r.recovery.begin(); r.recovery.loaded(); r.recovery.fail(); r.advance(2000);
  r.advance(64000); r.recovery.fail();
  const count = r.retries.length;
  r.advance(2000); assert.equal(r.retries.length, count + 1);
});

test("Offline time consumes no retries and reconnection resumes after the network returns", () => {
  const r = setup(); r.health.online = false; r.recovery.fail(); r.advance(120000);
  assert.equal(r.retries.length, 0);
  assert.equal(r.reports.at(-1).status, "sourceWaitingNetwork");
  r.health.online = true; r.advance(2000); assert.equal(r.retries.length, 1);
  r.recovery.fail(); r.advance(4999); assert.equal(r.retries.length, 1);
  r.advance(1); assert.equal(r.retries.length, 2);
});

test("Network loss without an SDK error also refreshes the source when back online", () => {
  const r = setup(); r.health.online = false; r.advance(8000);
  r.health.online = true; r.advance(4000);
  assert.equal(r.retries.length, 1);
});

test("Hidden or suspended tabs get a fresh observation period, without false stalls", () => {
  const r = setup(); r.freeze(); r.health.visible = false; r.advance(120000);
  assert.equal(r.retries.length, 0);
  r.health.visible = true; r.advance(18000); assert.equal(r.retries.length, 0);
  r.suspend(120000); assert.equal(r.retries.length, 0);
  r.advance(20000); assert.equal(r.reports.at(-1).status, "sourceReconnecting");
});

test("Manual refresh, pause and disposal cancel pending recovery, including detached timer callbacks", () => {
  for (const action of ["begin", "pause", "destroy"]) {
    const r = setup(); r.recovery.fail();
    const late = [...r.timers.values()][0].fn;
    r.recovery[action](); late(); r.advance(120000);
    assert.equal(r.retries.length, 0); assert.equal(r.timers.size, 0);
  }
  const r = setup(); r.recovery.fail(); r.health.alive = false; r.advance(2000);
  assert.equal(r.retries.length, 0); assert.equal(r.timers.size, 0);
});

test("Server throttling respects Retry-After instead of retrying at the normal short delay", () => {
  const r = setup(); r.recovery.fail({ retryAfterMs: 45000 });
  r.advance(44999); assert.equal(r.retries.length, 0);
  r.advance(1); assert.equal(r.retries.length, 1);
});
