"use strict";

// One worker owns read/merge/write for every dashboard. A rejected write does
// not poison the queue, and a stale client only submits fields it changed.
function createStateService(storage) {
  let queue = Promise.resolve();
  return (message) => {
    const task = queue.catch(() => {}).then(async () => {
      if (message.type === "assign-page-source") {
        if (!Number.isInteger(message.index) || message.index < 0 || message.index >= SLOT_COUNT) throw new Error("Invalid pane");
        const url = new URL(message.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported page URL");
        const stored = await storage.get([STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
        const state = normalizeState(stored[STORAGE_KEY] || stored[PREVIOUS_STORAGE_KEY] || stored[LEGACY_STORAGE_KEY]);
        const previous = state.slots[message.index];
        // A context-menu choice explicitly replaces this pane using the latest
        // saved state. Other panes and settings never come from a stale menu.
        state.slots[message.index] = previous.url === url.href
          ? { ...previous, title: normalizePageTitle(message.title) || previous.title }
          : { url: url.href, title: normalizePageTitle(message.title) };
        state.layout = Math.max(state.layout, message.index + 1);
        const next = normalizeState(state);
        await storage.set({ [STORAGE_KEY]: next });
        return { ok: true, state: next };
      }
      if (message.type === "save-settings") {
        const stored = await storage.get([STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
        const result = mergeStateChanges(stored[STORAGE_KEY] || stored[PREVIOUS_STORAGE_KEY] || stored[LEGACY_STORAGE_KEY], message.changes);
        if (result.ok) {
          // Titles are cached metadata. A late title may enrich its own source
          // but must neither rename a replacement nor reject an unrelated edit.
          result.state.slots.forEach((slot, i) => {
            const metadata = message.titles?.[i];
            if (slot.url && metadata?.url === slot.url && metadata.title) slot.title = normalizePageTitle(metadata.title);
          });
          await storage.set({ [STORAGE_KEY]: result.state });
        }
        return result;
      }
      throw new Error("Unknown storage operation");
    });
    queue = task;
    return task;
  };
}
