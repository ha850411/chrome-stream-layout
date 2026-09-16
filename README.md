# Stream Layout

Chrome/Edge MV3 extension for watching 2, 3, or 4 video sources in one full-window tab.

## Install locally

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this repository folder: `chrome-stream-layout`.
5. Click the Stream Layout extension icon.

After updating the extension files, reload the extension from `chrome://extensions` and refresh any open layout tabs.

## Sources

- YouTube video, live, Shorts, and playlist URLs use YouTube's lighter embedded player. A tab-scoped request rule supplies the extension identity required by the player; if YouTube still rejects an embed, the pane automatically falls back to the full page.
- Huya desktop and mobile room URLs (numeric room IDs or alphanumeric room aliases) use Huya's stand-alone live player at `liveshare.huya.com/iframe/`. This keeps the video and playback controls inside the pane without loading the full room layout. Huya category, video, and existing player URLs are left unchanged. Playback still depends on the room being available and may require clicking the player's play button.
- Inside the layout, Huya's center and control-bar "Enter room" prompts are hidden. Its danmu and quality menus open inside the pane instead of being cut off at the right edge; the danmu menu scales to fit small panes. Playback controls and the video aspect ratio are preserved. These adjustments apply only to Huya's official player directly embedded by this extension, leaving ordinary Huya tabs unchanged.
- Other webpage URLs are loaded directly as full-pane iframes without broad platform-specific rewriting.
- Webpage iframes are not sandboxed, so source pages keep their normal in-page controls, chat panels, and popup behavior.
- YouTube embed error detection, YouTube full-page fallbacks, and YesLive pages get host-scoped frame helpers only when embedded inside this extension. Bilibili live room URLs use Bilibili's official live player because the room page itself blocks iframe embedding before an in-frame helper can run.
- Direct media URLs such as `.mp4`, `.webm`, `.m3u8`, and `.mpd` are loaded directly into the iframe. Chrome may not play every streaming format natively.
- Any other `http` or `https` URL is loaded as a full-pane iframe.

Sources load independently. Bilibili room lookups time out after eight seconds and can be retried without reloading other panes.

The extension has `<all_urls>` host access and removes common iframe-blocking response headers only for sub-frame requests inside its dashboard tabs, so more sites can be placed into the layout without changing unrelated tabs. Rules cover all open layout tabs and are removed when a tab closes or navigates away. Some sources can still fail because of DRM, login state, Cloudflare challenges, server-side bot checks, unsupported codecs, or page logic that intentionally refuses embedded playback.

## Controls

- Click the extension icon to open or focus the layout tab and show the source and layout dialog. If the tab is already open, the extension reuses it instead of opening another copy.
- The video layout has no floating extension controls. Click the extension icon to open or reopen the app dialog; reload and layout-fullscreen actions are available in the dialog header.
- Each source card shows its loading or playback status using text, an icon, and color. A failed source gets a highlighted Retry button; other sources show a quieter Reload action. Both reload only that source and repeat its room lookup or embed attempt. Reload all does this for every visible pane.
- Playback status comes from visible HTML video elements in the source page. "Page loaded · playback unconfirmed" means the page opened but the extension has not confirmed video playback; this can occur with nested or custom players.
- Choose 2, 3, or 4 panes using the layout previews. Sources outside the selected layout are collapsed under Unused sources; their URLs are retained and can still be edited by expanding the section.
- URL edits are drafts until Apply is pressed. The dialog shows how many sources have pending changes; Discard changes restores their applied URLs. Switching language or layout, reloading players, or closing and reopening the dialog keeps drafts without applying them. Drafts are kept only in the current page and are lost if it is refreshed or closed.
- Source titles, pane numbers, and position icons identify each card. Drag its grip handle onto another card to swap their positions, or focus the handle and press Alt + Up/Down. Pending edits move with their source, and swaps between active panes preserve their players.
- Clear all immediately removes all four sources and provides Undo in the same dialog. Undo restores both applied sources and pending edits; changing a source or reordering cards ends that undo opportunity. Undo is kept only in the current page, and restored sources load again.
- Choose Traditional Chinese or English from the compact selector in the dialog header. The preference is saved with the layout state.
- The dark blue-gray interface uses mint accents, readable source/status text, and a fixed action area. Layout buttons place their icon beside the label, and compact source headers combine the position, title, and platform badge on one row to reduce panel height. Empty panes show their layout position; no extension controls cover playing video.
- Use the fullscreen button in the app dialog to put the whole layout into browser fullscreen while preserving the current 2, 3, or 4 pane arrangement.
- Drag the separators between panes to resize the layout. Their invisible hit area extends beyond the thin visible divider to make them easier to grab.
- Keyboard users can focus a separator and press its arrow keys to resize it (Shift for larger steps), or Home/End for the minimum/maximum size. Tab stays within the open source dialog; Escape closes it and restores focus.
- Per-pane overlays are intentionally omitted so the video area stays clean and unobstructed.

## Development checks

Run the offline regression tests with Node.js 18 or newer:

```sh
node --test tests/*.test.cjs
```

The optional browser checks in `tests/browser.cjs` load the real extension with local HTTP fixtures, including a canvas video stream. They cover independent loading, stale requests, pane swaps, retry isolation, playback status, timeout handling, keyboard controls, and multi-tab rules. They also run `tests/ui-checks.cjs` to check draft isolation and persistence, collapsed sources, clear/undo, pointer and keyboard ordering, status presentation, responsive controls down to 320px, and separator hit areas. `tests/huya-checks.cjs` checks hidden room prompts, preserved playback and controls, menu bounds in narrow/short panes, and unchanged standalone Huya tabs. With Playwright available on Node's module path, run:

```sh
node tests/browser.cjs
```

For an isolated Linux/macOS test installation:

```sh
npm install --prefix /tmp/stream-layout-tests --no-package-lock --no-audit --no-fund playwright@1.58.2
/tmp/stream-layout-tests/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/stream-layout-tests/node_modules node tests/browser.cjs
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chrome for Testing executable. Browser system libraries must be installed separately if the environment does not already provide them.
