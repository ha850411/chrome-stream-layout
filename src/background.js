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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ensure-frame-header-rules") {
    return false;
  }

  installFrameHeaderRules(_sender.tab?.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PAGE);
  const existingTab = await findDashboardTab(dashboardUrl);

  await chrome.storage.local.set({ [OPEN_CONTROLS_KEY]: Date.now() });

  if (existingTab?.id) {
    await focusTab(existingTab);
    return;
  }

  await chrome.tabs.create({
    url: `${dashboardUrl}?controls=1`
  });
});

async function findDashboardTab(dashboardUrl) {
  const target = new URL(dashboardUrl);
  const tabs = await chrome.tabs.query({});

  return tabs.find((tab) => {
    const tabUrl = tab.url || tab.pendingUrl;
    if (!tabUrl) return false;

    try {
      const url = new URL(tabUrl);
      return url.origin === target.origin && url.pathname === target.pathname;
    } catch {
      return false;
    }
  });
}

async function focusTab(tab) {
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.update(tab.id, { active: true });
}

async function installFrameHeaderRules(tabId) {
  if (!chrome.declarativeNetRequest?.updateSessionRules || !Number.isInteger(tabId) || tabId < 0) {
    return;
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [FRAME_HEADER_TAB_RULE_ID, YOUTUBE_EMBED_TAB_RULE_ID],
      addRules: [createTabFrameHeaderRule(tabId), createYouTubeEmbedRule(tabId)]
    });
  } catch (error) {
    console.warn("Could not install frame header rules.", error);
  }
}

function createYouTubeEmbedRule(tabId) {
  return {
    id: YOUTUBE_EMBED_TAB_RULE_ID,
    priority: 20,
    action: YOUTUBE_EMBED_ACTION,
    condition: {
      requestDomains: ["youtube.com", "youtube-nocookie.com"],
      resourceTypes: ["sub_frame"],
      tabIds: [tabId]
    }
  };
}

function createTabFrameHeaderRule(tabId) {
  return {
    id: FRAME_HEADER_TAB_RULE_ID,
    priority: 10,
    action: FRAME_HEADER_ACTION,
    condition: {
      regexFilter: "^https?://",
      resourceTypes: ["sub_frame"],
      tabIds: [tabId]
    }
  };
}
