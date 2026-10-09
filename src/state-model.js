"use strict";

const STORAGE_KEY = "chrome-stream-layout-state-v1";
const PREVIOUS_STORAGE_KEY = "live-mosaic-state-v2";
const LEGACY_STORAGE_KEY = "live-mosaic-state-v1";
const SLOT_COUNT = 4;
const SUPPORTED_LANGUAGES = ["zh-TW", "en"];
const DEFAULT_STATE = {
  language: "en",
  layout: 4,
  sizes: {
    layout2: { col: 50 },
    layout3: { col: 66, row: 50 },
    layout4: { col: 50, row: 50 }
  },
  slots: Array.from({ length: SLOT_COUNT }, () => ({ url: "", title: "" }))
};

function normalizePageTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function normalizeState(input) {
  const language = normalizeLanguage(input?.language);
  const layout = [2, 3, 4].includes(Number(input?.layout)) ? Number(input.layout) : DEFAULT_STATE.layout;
  const sourceSlots = Array.isArray(input?.slots) ? input.slots : DEFAULT_STATE.slots;
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    url: String(sourceSlots[index]?.url || ""),
    title: normalizePageTitle(sourceSlots[index]?.title),
    quality: /^(auto|[1-9]\d{1,4}p(?:[1-9]\d{0,2})?)$/.test(sourceSlots[index]?.quality)
      ? sourceSlots[index].quality : "auto",
    volume: Number.isFinite(sourceSlots[index]?.volume) ? clamp(sourceSlots[index].volume, 0, 1) : 1,
    muted: typeof sourceSlots[index]?.muted === "boolean" ? sourceSlots[index].muted : null
  }));

  return {
    language,
    layout,
    slots,
    sizes: normalizeSizes(input?.sizes)
  };
}

function normalizeLanguage(language) {
  if (SUPPORTED_LANGUAGES.includes(language)) {
    return language;
  }

  return globalThis.navigator?.language?.toLowerCase().startsWith("zh") ? "zh-TW" : DEFAULT_STATE.language;
}

function normalizeSizes(input) {
  const sizes = structuredClone(DEFAULT_STATE.sizes);

  for (const layoutKey of Object.keys(sizes)) {
    for (const axis of Object.keys(sizes[layoutKey])) {
      const value = Number(input?.[layoutKey]?.[axis]);
      if (Number.isFinite(value)) {
        sizes[layoutKey][axis] = clamp(value, 18, 82);
      }
    }
  }

  return sizes;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

// A source replacement is atomic. Playback preferences are guarded by URL so
// a delayed event from an old source cannot alter its replacement.
function stateChanges(before, after) {
  before = normalizeState(before);
  after = normalizeState(after);
  const changes = [];
  const add = (path, from, to, url) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ path, before: from, after: to, ...(url === undefined ? {} : { url }) });
  };
  for (const key of ["language", "layout"]) add(key, before[key], after[key]);
  for (const key of Object.keys(before.sizes)) {
    for (const axis of Object.keys(before.sizes[key])) add(`sizes.${key}.${axis}`, before.sizes[key][axis], after.sizes[key][axis]);
  }
  after.slots.forEach((slot, i) => {
    if (before.slots[i].url !== slot.url) add(`slots.${i}`, before.slots[i], slot);
    else for (const key of ["quality", "volume", "muted"]) {
      add(`slots.${i}.${key}`, before.slots[i][key], slot[key], slot.url);
    }
  });
  return changes;
}

function mergeStateChanges(input, changes, checkConflicts = true) {
  const next = normalizeState(input);
  if (!Array.isArray(changes) || changes.length > 40) throw new Error("Invalid settings changes");
  for (const change of changes) {
    if (!/^(language|layout|sizes\.layout2\.col|sizes\.layout[34]\.(col|row)|slots\.[0-3](\.(quality|volume|muted))?)$/.test(change.path)) {
      throw new Error("Invalid settings field");
    }
    const parts = change.path.split(".");
    const key = parts.pop();
    const target = parts.reduce((value, part) => value[part], next);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sameSource = (a, b) => ["url", "quality", "volume", "muted"].every((field) => a?.[field] === b?.[field]);
    const sourceChange = /^slots\.[0-3]$/.test(change.path);
    const matches = sourceChange ? sameSource(target[key], change.before) : same(target[key], change.before);
    const alreadyApplied = sourceChange ? sameSource(target[key], change.after) : same(target[key], change.after);
    const sourceMatches = change.url === undefined || next.slots[Number(parts[1])]?.url === change.url;
    if (checkConflicts && (!sourceMatches || (!matches && !alreadyApplied))) return { ok: false, conflict: true, state: normalizeState(input) };
    if (alreadyApplied) continue;
    target[key] = structuredClone(change.after);
  }
  return { ok: true, state: normalizeState(next) };
}

