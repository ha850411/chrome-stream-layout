"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function rig() {
  let now = 0, nextTimer = 1;
  const timers = new Map();
  const documentListeners = new Map();
  const stageListeners = new Map();
  const toolsListeners = new Map();

  const classes = new Set();
  const tools = {
    hidden: false,
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls)
    },
    addEventListener: (type, fn) => {
      if (!toolsListeners.has(type)) toolsListeners.set(type, []);
      toolsListeners.get(type).push(fn);
    },
    hovered: false,
    focused: false,
    matches: (sel) => {
      if (sel === ":hover") return tools.hovered;
      if (sel === ":focus-visible") return tools.focused;
      return false;
    },
    contains: (el) => el === tools
  };

  const stage = {
    addEventListener: (type, fn) => {
      if (!stageListeners.has(type)) stageListeners.set(type, []);
      stageListeners.get(type).push(fn);
    }
  };

  const document = {
    querySelector: (selector) => {
      if (selector === "#viewTools") return tools;
      if (selector === "#languagePicker" || selector === "#languageButton" || selector === "#languageMenu") return { addEventListener() {} };
      if (selector === "#dismissSourceMenuButton" || selector === "#openControlsButton" || selector === "#viewFullscreenButton") return { addEventListener() {} };
      return null;
    },
    activeElement: null,
    addEventListener: (type, fn) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    }
  };

  const window = {
    setTimeout: (fn, delay) => {
      const id = nextTimer++;
      timers.set(id, { fn, time: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: () => {}
  };

  const context = vm.createContext({
    document,
    window,
    stage,
    slotControls: { addEventListener: () => {} },
    state: { language: "en" },
    t: (s) => s,
    normalizeLanguage: (l) => l,
    openControls: () => {},
    toggleFullscreen: () => {}
  });

  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/dashboard-ui.js"), "utf8"), context);

  const tick = (duration) => {
    const end = now + duration;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.time;
      timers.delete(id);
      timer.fn();
    }
    now = end;
  };

  return {
    tools,
    context,
    tick,
    isVisible: () => tools.classList.contains("is-visible"),
    triggerDoc: (type, event = {}) => documentListeners.get(type)?.forEach((fn) => fn(event)),
    triggerStage: (type, event = {}) => stageListeners.get(type)?.forEach((fn) => fn(event)),
    triggerTools: (type, event = {}) => toolsListeners.get(type)?.forEach((fn) => fn(event))
  };
}

test("viewTools waits for activity and uses the same 1000ms idle delay for every pane", () => {
  const r = rig();
  r.context.bindViewingControls();

  assert.equal(r.isVisible(), false, "startup alone does not reveal viewing controls");

  r.triggerDoc("pointermove");
  assert.equal(r.isVisible(), true, "reveals on pointer movement");

  r.tick(500);
  assert.equal(r.isVisible(), true, "still visible at 500ms");

  r.tick(500);
  assert.equal(r.isVisible(), false, "auto-hides at the player's idle deadline");
});

test("continuous pointer movement extends viewing controls visibility", () => {
  const r = rig();
  r.context.bindViewingControls();

  r.triggerDoc("pointermove");
  assert.equal(r.isVisible(), true);

  r.tick(600);
  assert.equal(r.isVisible(), true);
  r.triggerDoc("pointermove");

  r.tick(600);
  assert.equal(r.isVisible(), true, "movement refreshes deadline");

  r.tick(400);
  assert.equal(r.isVisible(), false, "hides after 1000ms of inactivity");
});

test("pointerleave on viewing tools dismisses quickly within 300ms", () => {
  const r = rig();
  r.context.bindViewingControls();

  r.triggerTools("pointerenter");
  assert.equal(r.isVisible(), true);

  r.triggerTools("pointerleave");
  r.tick(200);
  assert.equal(r.isVisible(), true, "brief grace period before closing");

  r.tick(100);
  assert.equal(r.isVisible(), false, "dismissed at 300ms after pointer leaves");
});

test("stage pointerdown reveals viewing tools like the player controls", () => {
  const r = rig();
  r.context.bindViewingControls();

  r.triggerStage("pointerdown");
  assert.equal(r.isVisible(), true, "pointer interaction reveals controls");
  r.tick(1000);
  assert.equal(r.isVisible(), false);
});

test("hover or focus-visible preserves viewing tools visibility after idle deadline", () => {
  const r = rig();
  r.context.bindViewingControls();

  r.triggerDoc("pointermove");
  r.tools.hovered = true;
  r.tick(2500);
  assert.equal(r.isVisible(), true, "hover prevents hiding");

  r.tools.hovered = false;
  r.tools.focused = true;
  r.context.document.activeElement = r.tools;
  r.context.showViewTools();
  r.tick(2500);
  assert.equal(r.isVisible(), true, "focus prevents hiding");

  r.tools.focused = false;
  r.context.document.activeElement = null;
  r.context.hideViewTools(0);
  assert.equal(r.isVisible(), false);
});

test("the active player's visibility owns the toolbar until its controls hide", () => {
  const r = rig();
  r.context.bindViewingControls();
  r.triggerDoc("pointermove");
  const frame = { isConnected: true };
  r.context.syncViewToolsWithPlayer(frame, true, true);
  r.tick(5000);
  assert.equal(r.isVisible(), true, "player hover, keyboard focus and menus can outlast the idle timer");
  r.context.syncViewToolsWithPlayer(frame, false);
  assert.equal(r.isVisible(), false, "both controls hide in the same update");
});

test("inactive players cannot reveal or hide another pane's viewing controls", () => {
  const r = rig();
  r.context.bindViewingControls();
  const first = { isConnected: true };
  const second = { isConnected: true };
  r.context.syncViewToolsWithPlayer(first, true);
  assert.equal(r.isVisible(), false, "background playback state changes do not reveal controls");
  r.context.syncViewToolsWithPlayer(first, true, true);
  r.context.syncViewToolsWithPlayer(second, true, true);
  r.context.syncViewToolsWithPlayer(first, false);
  assert.equal(r.isVisible(), true, "leaving the previous pane does not hide the active pane's controls");
  second.isConnected = false;
  r.context.syncViewToolsWithPlayer(second, false);
  assert.equal(r.isVisible(), false, "removing the active player releases visibility");
  r.context.syncViewToolsWithPlayer(second, true, true);
  assert.equal(r.isVisible(), false, "detached player callbacks are ignored");
});

test("activity in another pane restores the shared short timeout and ignores the previous player", () => {
  const r = rig();
  r.context.bindViewingControls();
  const frame = { isConnected: true };
  r.context.syncViewToolsWithPlayer(frame, true, true);
  r.triggerDoc("pointermove");
  r.context.syncViewToolsWithPlayer(frame, false);
  assert.equal(r.isVisible(), true, "a previous player's blur does not dismiss the new pane's controls");
  r.tick(1000);
  assert.equal(r.isVisible(), false, "other panes use the same short timeout");
});
