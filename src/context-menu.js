"use strict";

const SOURCE_MENU_ID = "stream-layout-add-page";
const SOURCE_MENU_CONTEXTS = ["page", "frame", "link", "image", "video", "audio", "selection", "editable"];
const SOURCE_MENU_PATTERNS = ["http://*/*", "https://*/*"];
let sourceMenuQueue = Promise.resolve();
let sourceActionQueue = Promise.resolve();
let sourceMenuSignature = "";

function sourceMenuTitles(input) {
  const state = normalizeState(input);
  const chinese = state.language === "zh-TW";
  // %s has special meaning in Chrome's selection context, even in a page title.
  const short = (value, length) => {
    const text = [...normalizePageTitle(value).replaceAll("%s", "％s")];
    return text.length > length ? text.slice(0, length - 1).join("") + "…" : text.join("");
  };
  const titles = [chinese ? "將目前頁面加入 Stream Layout" : "Add current page to Stream Layout"];
  state.slots.forEach((slot, index) => {
    let source = chinese ? "空白（加入）" : "Empty (add)";
    if (slot.url) {
      let address = slot.url;
      try {
        const url = new URL(slot.url);
        address = `${url.host.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
      } catch { /* Legacy invalid URLs can still be identified and replaced. */ }
      const summary = slot.title ? `${short(slot.title, 32)} · ${short(address, 32)}` : short(address, 58);
      source = `${summary}${chinese ? "（替換）" : " (replace)"}`;
    }
    const hidden = index >= state.layout
      ? (chinese ? ` · 展開為 ${index + 1} 格` : ` · Show ${index + 1} panes`) : "";
    titles.push(`${chinese ? "窗格" : "Pane"} ${index + 1}：${source}${hidden}`);
  });
  return titles;
}

function createSourceMenuItem(properties) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function refreshSourceContextMenu() {
  sourceMenuQueue = sourceMenuQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const titles = sourceMenuTitles(stored[STORAGE_KEY] || stored[PREVIOUS_STORAGE_KEY] || stored[LEGACY_STORAGE_KEY]);
    const signature = JSON.stringify(titles);
    if (signature === sourceMenuSignature) return;
    const items = titles.map((title, index) => ({
      id: index ? `${SOURCE_MENU_ID}-${index - 1}` : SOURCE_MENU_ID,
      ...(index ? { parentId: SOURCE_MENU_ID } : {}),
      title, contexts: SOURCE_MENU_CONTEXTS, documentUrlPatterns: SOURCE_MENU_PATTERNS
    }));
    try {
      // Menus survive worker suspension. Updating existing IDs avoids duplicates
      // and leaves an open menu intact when titles or the language change.
      for (const { id, ...properties } of items) await chrome.contextMenus.update(id, properties);
    } catch {
      await chrome.contextMenus.removeAll();
      for (const item of items) await createSourceMenuItem(item);
    }
    sourceMenuSignature = signature;
  });
  return sourceMenuQueue;
}

async function showSourceMenuResult(index, status) {
  const existing = await findDashboardTab();
  const url = new URL(existing?.pendingUrl || existing?.url || chrome.runtime.getURL(DASHBOARD_PAGE));
  url.hash = new URLSearchParams({ sourceMenu: status, pane: String(index + 1), request: String(Date.now()) });
  if (existing) {
    // A fragment navigation delivers the result without reloading the dashboard
    // or its other live players, and also works while the dashboard is loading.
    await chrome.tabs.update(existing.id, { url: url.href });
    await focusTab(existing);
  } else await chrome.tabs.create({ url: url.href });
}

function handleSourceContextClick(info, tab) {
  const match = new RegExp(`^${SOURCE_MENU_ID}-([0-3])$`).exec(String(info.menuItemId));
  if (!match) return Promise.resolve(false);
  const index = Number(match[1]);
  // pageUrl is the top-level page; linkUrl, srcUrl and frameUrl must not replace it.
  const url = info.pageUrl || tab?.url;
  const title = !tab?.url || tab.url === url ? tab?.title || "" : "";
  const task = sourceActionQueue.catch(() => {}).then(async () => {
    let status = "added";
    try {
      await saveSettings({ type: "assign-page-source", index, url, title });
    } catch {
      status = "failed";
    }
    await refreshSourceContextMenu().catch(() => {});
    await showSourceMenuResult(index, status);
    return status === "added";
  });
  sourceActionQueue = task;
  return task;
}

function initializeSourceContextMenu() {
  const refresh = () => { void refreshSourceContextMenu().catch(() => console.warn("Could not update the page context menu.")); };
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleSourceContextClick(info, tab).catch(() => console.warn("Could not open the source result."));
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && [STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY].some(key => changes[key])) refresh();
  });
  chrome.runtime.onInstalled.addListener(() => { sourceMenuSignature = ""; refresh(); });
  chrome.runtime.onStartup.addListener(refresh);
  refresh();
}
