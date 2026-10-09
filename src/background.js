"use strict";

importScripts("state-model.js", "state-service.js", "context-menu.js");
const saveSettings = createStateService(chrome.storage.local);

const DASHBOARD_PAGE = "dashboard.html";
const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";
const LEGACY_FRAME_HEADER_RULE_ID = 9001;
const FRAME_RULE_START = 10000;
const FRAME_RULE_END = 20000;
const FRAME_ORIGINS_KEY = "chrome-stream-layout-frame-origins-v1";
let frameOrigins = null;
const YOUTUBE_EMBED_TAB_RULE_ID = 9002;
const FRAME_HEADER_ACTION = {
  type: "modifyHeaders",
  responseHeaders: [
    { header: "x-frame-options", operation: "remove" },
    { header: "frame-options", operation: "remove" }
  ]
};
const YOUTUBE_EMBED_ACTION = {
  type: "modifyHeaders",
  requestHeaders: [
    {
      header: "referer",
      operation: "set",
      value: chrome.runtime.getURL(DASHBOARD_PAGE)
    }
  ]
};
let ruleUpdateQueue = Promise.resolve();
let dashboardTabIds = new Set();
let tabRevision = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["ensure-frame-header-rules", "save-settings"].includes(message?.type)) {
    return false;
  }

  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || !isDashboardUrl(sender.url)) {
    sendResponse({ ok: false, error: "Only the dashboard can update settings or frame rules." });
    return false;
  }

  (message.type === "ensure-frame-header-rules"
    ? scheduleFrameHeaderRules(message.origins === undefined ? null : { tabId: sender.tab.id, origins: message.origins }).then(() => ({ ok: true })) : saveSettings(message))
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") return;
  tabRevision++;
  if (dashboardTabIds.has(tabId) || isDashboardUrl(tab.pendingUrl || tab.url)) {
    refreshFrameHeaderRules();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabRevision++;
  if (dashboardTabIds.has(tabId)) refreshFrameHeaderRules();
});
chrome.tabs.onReplaced.addListener(() => {
  tabRevision++;
  refreshFrameHeaderRules();
});

// Reconcile persisted session rules whenever the service worker starts.
refreshFrameHeaderRules();
initializeSourceContextMenu();

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PAGE);
  const existingTab = await findDashboardTab();

  await chrome.storage.local.set({ [OPEN_CONTROLS_KEY]: Date.now() }).catch(() => {
    console.warn("Could not persist the open-controls request.");
  });

  if (existingTab?.id) {
    await focusTab(existingTab);
    return;
  }

  await chrome.tabs.create({
    url: `${dashboardUrl}?controls=1`
  });
});

function isDashboardUrl(value) {
  try {
    const url = new URL(value);
    const target = new URL(chrome.runtime.getURL(DASHBOARD_PAGE));
    return url.protocol === target.protocol && url.host === target.host && url.pathname === target.pathname;
  } catch {
    return false;
  }
}

async function findDashboardTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => isDashboardUrl(tab.pendingUrl || tab.url));
}

async function focusTab(tab) {
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.update(tab.id, { active: true });
}

function scheduleFrameHeaderRules(config = null) {
  // Serialize reads and writes so a slower update cannot restore stale tab IDs.
  ruleUpdateQueue = ruleUpdateQueue.catch(() => {}).then(async () => {
    if (!frameOrigins) frameOrigins = (await chrome.storage.session.get(FRAME_ORIGINS_KEY))[FRAME_ORIGINS_KEY] || {};
    if (config) {
      if (!Array.isArray(config.origins) || config.origins.length > 4) throw new Error("Invalid frame origins");
      const origins = [...new Set(config.origins.map((value) => {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || value.length > 400) throw new Error("Invalid frame origin");
        return url.origin;
      }))].sort();
      frameOrigins = { ...frameOrigins, [config.tabId]: origins };
      await chrome.storage.session.set({ [FRAME_ORIGINS_KEY]: frameOrigins });
    }
    let revision;
    do {
      revision = tabRevision;
      await installFrameHeaderRules();
      // A tab can close/navigate before the asynchronous initial query has
      // discovered its ID. Reconcile again even if it wasn't tracked yet.
    } while (revision !== tabRevision);
  });
  return ruleUpdateQueue;
}

function refreshFrameHeaderRules() {
  void scheduleFrameHeaderRules().catch((error) => {
    console.warn("Could not install frame header rules.", error);
  });
}

async function installFrameHeaderRules() {
  const tabs = await chrome.tabs.query({});
  const tabIds = tabs
    .filter((tab) => Number.isInteger(tab.id) && tab.id >= 0 && isDashboardUrl(tab.pendingUrl || tab.url))
    .map((tab) => tab.id).sort((a, b) => a - b);
  const owned = (id) => id === LEGACY_FRAME_HEADER_RULE_ID || id === YOUTUBE_EMBED_TAB_RULE_ID || (id >= FRAME_RULE_START && id < FRAME_RULE_END);
  const existingRules = (await chrome.declarativeNetRequest.getSessionRules()).filter((rule) => owned(rule.id));
  dashboardTabIds = new Set([...tabIds, ...existingRules.flatMap((rule) => rule.condition.tabIds || [])]);
  const addRules = tabIds.length ? [createYouTubeEmbedRule(tabIds)] : [];
  for (const tabId of tabIds) {
    const origins = frameOrigins[tabId];
    if (origins?.length) {
      const rule = createTabFrameHeaderRule(FRAME_RULE_START + addRules.length, tabId, origins);
      addRules.push(rule, {
        ...rule,
        id: rule.id + 1,
        action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }] },
        condition: { ...rule.condition, responseHeaders: [{ header: "content-security-policy", values: ["*frame-ancestors*"] }] }
      });
    }
  }
  // Compare the complete rules: identical tab IDs can still contain an old
  // blanket action/condition after an extension update.
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  if (JSON.stringify(canonical(existingRules.sort((a, b) => a.id - b.id))) !== JSON.stringify(canonical(addRules.sort((a, b) => a.id - b.id)))) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existingRules.map((rule) => rule.id), addRules });
  }
  dashboardTabIds = new Set(tabIds);
  const activeOrigins = Object.fromEntries(Object.entries(frameOrigins).filter(([id]) => dashboardTabIds.has(Number(id))));
  if (Object.keys(activeOrigins).length !== Object.keys(frameOrigins).length) {
    frameOrigins = activeOrigins;
    await chrome.storage.session.set({ [FRAME_ORIGINS_KEY]: frameOrigins });
  }
}

function createYouTubeEmbedRule(tabIds) {
  return {
    id: YOUTUBE_EMBED_TAB_RULE_ID,
    priority: 20,
    action: YOUTUBE_EMBED_ACTION,
    condition: {
      requestDomains: ["youtube.com", "youtube-nocookie.com"],
      resourceTypes: ["sub_frame"],
      tabIds
    }
  };
}

function createTabFrameHeaderRule(id, tabId, origins) {
  return {
    id,
    priority: 10,
    action: FRAME_HEADER_ACTION,
    condition: {
      regexFilter: `^(${origins.map((origin) => origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})/`,
      resourceTypes: ["sub_frame"],
      tabIds: [tabId]
    }
  };
}
