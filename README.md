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
- Twitch live channel URLs use [Twitch's stand-alone player](https://dev.twitch.tv/docs/embed/video-and-clips/) instead of loading the full channel page, navigation, recommendations, and chat. The player uses the current dashboard's host as its `parent`, including for unpacked extensions, together with the existing dashboard-scoped frame rules. It requests muted autoplay; if Twitch waits for interaction, click Play and unmute in the player. Explicit `autoplay=false` or `muted=false` URL parameters are respected. If the embed reports a media error or no video is detected within 20 seconds, the pane reloads the embedded player once, then reports an error or unconfirmed playback if necessary. It never falls back to a full channel page. A paused video waiting for Play does not trigger the timeout retry. Clips, VODs, directories, and existing player URLs are left unchanged.
- Kick live channel URLs play through a local Amazon IVS engine with custom controls for play/pause, volume, **LIVE**, **Auto / quality**, and fullscreen. **LIVE** fetches the current source and reconnects at the live broadcast, preserving quality and volume without reloading other panes. Resuming after Pause also returns to live playback; this is not a DVR player. Quality choices come from the current stream (for example, 1080p60 or 720p60) and are remembered per source; an unavailable saved quality falls back to Auto. Explicit `autoplay=false` and `muted=false` preferences are respected. Clip links (including channel URLs with `?clip=`), VODs, categories, and existing official player URLs are preserved.
- SOOP live URLs at `play.sooplive.com/<channel>` or `/<channel>/<broadcast>` use SOOP's native `/embed` player, keeping a supplied broadcast number. Legacy `play.sooplive.co.kr` and `play.afreecatv.com` links use the current `.com` player. Channel homepages, VODs, chat links, and existing embeds are preserved. Kick and SOOP live panes have no added sidebar or chat panel.
- Huya desktop and mobile room URLs (numeric room IDs or alphanumeric room aliases) use Huya's stand-alone live player at `liveshare.huya.com/iframe/`. This keeps the video and playback controls inside the pane without loading the full room layout. Huya category, video, and existing player URLs are left unchanged. Playback still depends on the room being available and may require clicking the player's play button.
- Inside the layout, Huya's center and control-bar "Enter room" prompts are hidden. Its danmu and quality menus open inside the pane instead of being cut off at the right edge; the danmu menu scales to fit small panes. Playback controls and the video aspect ratio are preserved. These adjustments apply only to Huya's official player directly embedded by this extension, leaving ordinary Huya tabs unchanged.
- Other webpage URLs are loaded directly as full-pane iframes without broad platform-specific rewriting.
- Webpage iframes are not sandboxed, so source pages keep their normal in-page controls, chat panels, and popup behavior.
- YouTube embed error detection, YouTube full-page fallbacks, and YesLive pages get host-scoped frame helpers only when embedded inside this extension. Bilibili live room URLs use Bilibili's official live player because the room page itself blocks iframe embedding before an in-frame helper can run.
- Direct media URLs such as `.mp4`, `.webm`, `.m3u8`, and `.mpd` are loaded directly into the iframe. Chrome may not play every streaming format natively.
- Any other `http` or `https` URL is loaded as a full-pane iframe.

Sources load independently. Kick and Bilibili lookups time out after eight seconds and can be retried without reloading other panes. An offline Kick channel retains its in-player LIVE button for retry.

Kick loads a bundled [Amazon IVS Player](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html) only inside its own local player page. Low-latency playback and returning to live after rebuffering are enabled; Auto quality considers available bandwidth and is capped to the pane's dimensions. Manual quality changes preserve buffered playback and may take a few seconds. LIVE reuses the existing engine; replacing or removing a pane destroys both its player and page, releasing workers. Playback latency and stability still depend on the stream, network and device.

The custom control bar hides after 2.2 seconds of inactivity or when the pointer leaves, remaining available during keyboard interaction. Focus the player and use Space/K to play or pause, M to mute, F for fullscreen, or L to return to live. Native video controls are disabled so IVS can select manual qualities.

Bilibili live source cards use the room's current broadcast title instead of the embedded player's generic page title. Room titles load in the background without delaying playback and refresh when the source is reloaded. If the title lookup fails or takes over eight seconds, the card keeps its previous title or shows the room number.

The extension has `<all_urls>` host access and removes common iframe-blocking response headers only for sub-frame requests inside its dashboard tabs, so more sites can be placed into the layout without changing unrelated tabs. Rules cover all open layout tabs and are removed when a tab closes or navigates away. Some sources can still fail because of DRM, login state, Cloudflare challenges, server-side bot checks, unsupported codecs, or page logic that intentionally refuses embedded playback.

## Controls

- Click the extension icon to open or focus the layout tab and show the source and layout dialog. If the tab is already open, the extension reuses it instead of opening another copy.
- Click the extension icon to open or reopen the app dialog; reload-all and layout-fullscreen actions are available in the dialog header. Kick's LIVE and playback controls are inside its player.
- Each source card shows its loading or playback status using text, an icon, and color. Non-Kick sources have Retry/Reload actions in their cards. Kick's LIVE action is exclusively inside the player. These actions repeat that source's lookup and playback setup; Reload all does this for every visible pane.
- Playback status comes from visible HTML video elements in the source page. "Page loaded · playback unconfirmed" means the page opened but the extension has not confirmed video playback; this can occur with nested or custom players.
- Players that insert or replace their video after the page has loaded also update the status, including a paused video waiting for Play.
- Choose 2, 3, or 4 panes using the layout previews. Sources outside the selected layout are collapsed under Unused sources; their URLs are retained and can still be edited by expanding the section.
- URL edits are drafts until Apply is pressed. The dialog shows how many sources have pending changes; Discard changes restores their applied URLs. Switching language or layout, reloading players, or closing and reopening the dialog keeps drafts without applying them. Drafts are kept only in the current page and are lost if it is refreshed or closed.
- Source titles, pane numbers, and position icons identify each card. Drag its grip handle onto another card to swap their positions, or focus the handle and press Alt + Up/Down. Pending edits move with their source, and swaps between active panes preserve their players.
- Clear all immediately removes all four sources and provides Undo in the same dialog. Undo restores both applied sources and pending edits; changing a source or reordering cards ends that undo opportunity. Undo is kept only in the current page, and restored sources load again.
- Choose Traditional Chinese or English from the compact selector in the dialog header. The preference is saved with the layout state.
- The dark blue-gray interface uses mint accents, readable source/status text, and a fixed action area. Layout buttons place their icon beside the label, and compact source headers combine the position, title, and platform badge on one row to reduce panel height. Empty panes show their layout position; Kick’s player toolbar hides when idle.
- Use the fullscreen button in the app dialog to put the whole layout into browser fullscreen while preserving the current 2, 3, or 4 pane arrangement.
- Drag the separators between panes to resize the layout. Their invisible hit area extends beyond the thin visible divider to make them easier to grab.
- Keyboard users can focus a separator and press its arrow keys to resize it (Shift for larger steps), or Home/End for the minimum/maximum size. Tab stays within the open source dialog; Escape closes it and restores focus.
- Kick's compact toolbar appears along the player's bottom edge on pointer activity or keyboard focus. It hides after 2.2 seconds of inactivity or when the pointer leaves; interacting with the toolbar keeps it visible. Other platforms retain their own player controls.

## Development checks

Run the offline regression tests with Node.js 18 or newer:

```sh
node --test tests/*.test.cjs
```

The optional browser checks in `tests/browser.cjs` load the real extension with local HTTP fixtures, including a canvas video stream. They cover independent loading, stale requests, pane swaps, retry isolation, playback status, timeout handling, keyboard controls, and multi-tab rules. They also run `tests/ui-checks.cjs` to check draft isolation and persistence, collapsed sources, clear/undo, pointer and keyboard ordering, status presentation, responsive controls down to 320px, and separator hit areas. `tests/twitch-checks.cjs` checks Twitch channel routing, recovery from blocked or blank embeds, and playback status when a video is inserted late, replaced, or removed. `tests/bilibili-checks.cjs` checks background room titles, generic player title suppression, pane reordering, stale responses after retry, and metadata failure isolation. `tests/kick-soop-checks.cjs` checks Kick's toolbar auto-hide and keyboard access, LIVE, quality/volume preservation, fullscreen, fresh URLs, stale-response protection, offline recovery, and player page disposal, together with SOOP's official player. `tests/kick-player.test.cjs` covers IVS instance reuse, quality changes, no-autoplay, viewport caps and cleanup. `tests/huya-checks.cjs` checks hidden room prompts, preserved playback and controls, menu bounds in narrow/short panes, and unchanged standalone Huya tabs. With Playwright available on Node's module path, run:

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
