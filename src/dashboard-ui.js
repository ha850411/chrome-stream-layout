"use strict";

// Viewing and editing affordances never apply URL drafts or rebuild players.
const VIEW_TOOLS_IDLE_DELAY_MS = 1000;
const VIEW_TOOLS_LEAVE_DELAY_MS = 300;
let viewToolsTimer = 0;
let paneHighlightTimer = 0;
let sourceMenuResult = null;
let sourceMenuRevision = 0;
const languagePicker = document.querySelector("#languagePicker");
const languageButton = document.querySelector("#languageButton");
const languageMenu = document.querySelector("#languageMenu");

function syncLanguageMenu() {
  const selected = state.language === "zh-TW" ? "繁體中文" : "English";
  document.querySelector("#languageValue").textContent = state.language === "zh-TW" ? "繁中" : "EN";
  languageButton.title = `${t("language")}: ${selected}`;
  languageButton.setAttribute("aria-label", languageButton.title);
  for (const option of languageMenu.children) {
    option.setAttribute("aria-checked", String(option.dataset.language === state.language));
  }
}

function setLanguageMenu(open, returnFocus = false) {
  languageButton.setAttribute("aria-expanded", String(open));
  languageMenu.hidden = !open;
  if (open) languageMenu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  else if (returnFocus) languageButton.focus({ preventScroll: true });
}

function bindLanguageMenu() {
  languageButton.addEventListener("click", () => setLanguageMenu(languageMenu.hidden));
  languageButton.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    setLanguageMenu(true);
    (event.key === "ArrowUp" ? languageMenu.lastElementChild : languageMenu.firstElementChild).focus();
  });
  languageMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-language]");
    if (!option) return;
    setLanguageMenu(false, true);
    const language = normalizeLanguage(option.dataset.language);
    if (language === state.language) return;
    state.language = language;
    applyLanguage();
    renderControls();
    void renderStage();
    void persistState(t("languageChanged"));
  });
  languageMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setLanguageMenu(false, true);
      return;
    }
    if (event.key === "Tab") {
      // Let the dialog's focus trap and normal tab order continue from the trigger.
      setLanguageMenu(false, true);
      return;
    }
    const options = [...languageMenu.children];
    const index = options.indexOf(document.activeElement);
    let next;
    if (event.key === "ArrowDown") next = options[(index + 1) % options.length];
    else if (event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
    else if (event.key === "Home") next = options[0];
    else if (event.key === "End") next = options.at(-1);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      next = options.find((option) => option.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
    }
    if (next) { event.preventDefault(); next.focus(); }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!languageMenu.hidden && !languagePicker.contains(event.target)) setLanguageMenu(false);
  });
  languagePicker.addEventListener("focusout", (event) => {
    if (!languagePicker.contains(event.relatedTarget)) setLanguageMenu(false);
  });
}

function showViewTools(delay = VIEW_TOOLS_IDLE_DELAY_MS) {
  const tools = document.querySelector("#viewTools");
  if (!tools || tools.hidden) return;
  window.clearTimeout(viewToolsTimer);
  tools.classList.add("is-visible");
  viewToolsTimer = window.setTimeout(() => {
    const keyboardFocus = tools.contains(document.activeElement) && document.activeElement.matches(":focus-visible");
    if (!tools.matches(":hover") && !keyboardFocus) tools.classList.remove("is-visible");
  }, delay);
}

function hideViewTools(delay = VIEW_TOOLS_LEAVE_DELAY_MS) {
  const tools = document.querySelector("#viewTools");
  if (!tools || tools.hidden) return;
  window.clearTimeout(viewToolsTimer);
  const doHide = () => {
    const keyboardFocus = tools.contains(document.activeElement) && document.activeElement.matches(":focus-visible");
    if (!tools.matches(":hover") && !keyboardFocus) tools.classList.remove("is-visible");
  };
  if (delay <= 0) {
    doHide();
  } else {
    viewToolsTimer = window.setTimeout(doHide, delay);
  }
}

function bindViewingControls() {
  window.addEventListener("hashchange", () => { void consumeSourceMenuResult(); });
  document.querySelector("#dismissSourceMenuButton").addEventListener("click", () => {
    const index = sourceMenuResult?.index;
    clearSourceMenuNotice();
    openControls(index);
  });
  const tools = document.querySelector("#viewTools");
  tools.addEventListener("pointerenter", () => showViewTools());
  tools.addEventListener("pointerleave", () => hideViewTools(VIEW_TOOLS_LEAVE_DELAY_MS));
  tools.addEventListener("focusin", () => showViewTools());
  tools.addEventListener("focusout", () => hideViewTools(200));

  for (const name of ["pointermove", "pointerenter"]) {
    document.addEventListener(name, () => showViewTools(), { passive: true });
    stage.addEventListener(name, () => showViewTools(), { passive: true });
  }
  stage.addEventListener("pointerdown", () => hideViewTools(0), { passive: true });
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
