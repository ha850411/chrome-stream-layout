"use strict";

const DASHBOARD_PAGE = "dashboard.html";
const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";
const FRAME_HEADER_TAB_RULE_ID = 9001;
const YOUTUBE_EMBED_TAB_RULE_ID = 9002;
const FRAME_HEADER_ACTION = {
  type: "modifyHeaders",
  responseHeaders: [
    { header: "x-frame-options", operation: "remove" },
    { header: "frame-options", operation: "remove" },
    { header: "content-security-policy", operation: "remove" },
    { header: "content-security-policy-report-only", operation: "remove" }
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
  if (message?.type !== "ensure-frame-header-rules") {
    return false;
  }

  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || !isDashboardUrl(sender.url)) {
    sendResponse({ ok: false, error: "Only the dashboard can configure frame rules." });
    return false;
  }

  scheduleFrameHeaderRules()
    .then(() => sendResponse({ ok: true }))
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

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PAGE);
  const existingTab = await findDashboardTab();

  await chrome.storage.local.set({ [OPEN_CONTROLS_KEY]: Date.now() });

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

function scheduleFrameHeaderRules() {
  // Serialize reads and writes so a slower update cannot restore stale tab IDs.
  ruleUpdateQueue = ruleUpdateQueue.catch(() => {}).then(async () => {
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
  const ruleIds = [FRAME_HEADER_TAB_RULE_ID, YOUTUBE_EMBED_TAB_RULE_ID];
  const existingRules = (await chrome.declarativeNetRequest.getSessionRules())
    .filter((rule) => ruleIds.includes(rule.id));
  // Retain old and discovered IDs until a successful update, including failures.
  dashboardTabIds = new Set([...tabIds, ...existingRules.flatMap((rule) => rule.condition.tabIds || [])]);
  const addRules = tabIds.length ? [createTabFrameHeaderRule(tabIds), createYouTubeEmbedRule(tabIds)] : [];

  if (existingRules.length === addRules.length && existingRules.every((rule) =>
    JSON.stringify(rule.condition.tabIds) === JSON.stringify(tabIds))) {
    dashboardTabIds = new Set(tabIds);
    return;
  }

  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds, addRules });
  dashboardTabIds = new Set(tabIds);
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

function createTabFrameHeaderRule(tabIds) {
  return {
    id: FRAME_HEADER_TAB_RULE_ID,
    priority: 10,
    action: FRAME_HEADER_ACTION,
    condition: {
      regexFilter: "^https?://",
      resourceTypes: ["sub_frame"],
      tabIds
    }
  };
}
