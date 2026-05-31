"use strict";

const DASHBOARD_PAGE = "dashboard.html";
const OPEN_CONTROLS_KEY = "chrome-stream-layout-open-controls-request-v1";

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
