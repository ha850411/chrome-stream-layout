"use strict";

// Viewing and editing affordances never apply URL drafts or rebuild players.
let viewToolsTimer = 0;
let paneHighlightTimer = 0;
let sourceMenuResult = null;
let sourceMenuRevision = 0;

function showViewTools() {
  const tools = document.querySelector("#viewTools");
  if (tools.hidden) return;
  window.clearTimeout(viewToolsTimer);
  tools.classList.add("is-visible");
  viewToolsTimer = window.setTimeout(() => {
    const keyboardFocus = tools.contains(document.activeElement) && document.activeElement.matches(":focus-visible");
    if (!tools.matches(":hover") && !keyboardFocus) tools.classList.remove("is-visible");
  }, 2400);
}

function bindViewingControls() {
  window.addEventListener("hashchange", () => { void consumeSourceMenuResult(); });
  document.querySelector("#dismissSourceMenuButton").addEventListener("click", () => {
    const index = sourceMenuResult?.index;
    clearSourceMenuNotice();
    openControls(index);
  });
  const tools = document.querySelector("#viewTools");
  for (const name of ["pointerenter", "pointerleave", "focusin", "focusout"]) {
    tools.addEventListener(name, showViewTools);
  }
  document.querySelector("#openControlsButton").addEventListener("click", () => openControls());
  document.querySelector("#viewFullscreenButton").addEventListener("click", toggleFullscreen);
  stage.addEventListener("click", (event) => {
    const button = event.target.closest("[data-source-action]");
    const tile = button?.closest("[data-tile]");
    if (!tile) return;
    const index = Number(tile.dataset.tile);
    if (button.dataset.sourceAction === "edit") openControls(index);
    else if (button.dataset.sourceAction === "retry") void retryTiles([index]);
  });
  for (const name of ["pointerover", "focusin"]) {
    slotControls.addEventListener(name, (event) => {
      const card = event.target.closest("[data-slot-target]");
      if (card && !card.contains(event.relatedTarget)) highlightSourcePane(Number(card.dataset.slotTarget));
    });
  }
  for (const name of ["pointerout", "focusout"]) {
    slotControls.addEventListener(name, (event) => {
      const card = event.target.closest("[data-slot-target]");
      if (card && !card.contains(event.relatedTarget)) clearPaneHighlight();
    });
  }
  showViewTools();
}

async function consumeSourceMenuResult() {
  const params = new URLSearchParams(location.hash.slice(1));
  const status = params.get("sourceMenu");
  const index = Number(params.get("pane")) - 1;
  if (!["added", "failed"].includes(status) || !Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return;
  const revision = ++sourceMenuRevision;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (saveInFlight) await saveInFlight;
  await syncSharedState();
  if (revision !== sourceMenuRevision) return;
  openControls(index);
  sourceMenuResult = { index, status };
  renderSourceMenuNotice();
}

function renderSourceMenuNotice() {
  const notice = document.querySelector("#sourceMenuNotice");
  notice.hidden = !sourceMenuResult;
  if (!sourceMenuResult) return;
  const { index, status } = sourceMenuResult;
  const hasDraft = draftUrls && draftUrls[index] !== state.slots[index].url;
  notice.dataset.tone = status === "failed" ? "error" : "success";
  document.querySelector("#sourceMenuMessage").textContent = t(status === "failed" ? "sourceMenuFailed" :
    hasDraft ? "sourceMenuAddedWithDraft" : "sourceMenuAdded", { number: index + 1 });
  document.querySelector("#dismissSourceMenuButton").textContent = t("dismiss");
}

function clearSourceMenuNotice() {
  sourceMenuResult = null;
  renderSourceMenuNotice();
}

function clearPaneHighlight() {
  window.clearTimeout(paneHighlightTimer);
  stage.querySelectorAll(".is-highlighted").forEach((tile) => tile.classList.remove("is-highlighted"));
}

function highlightSourcePane(index) {
  clearPaneHighlight();
  const tile = stage.querySelector(`[data-tile="${index}"]`);
  if (!tile) return;
  tile.classList.add("is-highlighted");
  paneHighlightTimer = window.setTimeout(clearPaneHighlight, 1600);
}

function sourceStatusTone(status) {
  if (["sourceOffline", "sourcePageLoaded", "sourcePaused", "noSource", "idle"].includes(status)) return "neutral";
  if (["sourceResolving", "sourceLoading", "sourceBuffering", "sourceReconnecting", "sourceWaitingNetwork", "sourceLoadUnconfirmed"].includes(status)) return "loading";
  if (status === "sourcePlaying") return "playing";
  if (["sourcePending", "sourceRemoving"].includes(status)) return "pending";
  return "error";
}

function createSourceActions(sourceUrl) {
  const actions = document.createElement("div");
  actions.className = "source-actions";
  for (const action of ["retry", "edit"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.sourceAction = action;
    button.textContent = t(action === "retry" ? "retry" : "editSource");
    actions.append(button);
  }
  const url = parseUrl(sourceUrl);
  if (url && ["http:", "https:"].includes(url.protocol)) {
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = t("openOriginal");
    actions.append(link);
  }
  return actions;
}

function syncTileFeedback(tile) {
  const previous = tile.querySelector(".tile-notice");
  if (!tile.querySelector("iframe:not([data-live-player])") ||
      !["sourceMediaError", "sourceLoadUnconfirmed"].includes(tile.dataset.status)) {
    previous?.remove();
    return;
  }
  const notice = previous || document.createElement("div");
  notice.className = "tile-notice";
  notice.dataset.tone = sourceStatusTone(tile.dataset.status);
  const text = document.createElement("p");
  text.textContent = t(tile.dataset.status);
  text.setAttribute("role", "status");
  notice.replaceChildren(text, createSourceActions(tile.dataset.sourceUrl));
  if (!previous) tile.append(notice);
}
