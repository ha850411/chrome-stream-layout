# Stream Layout

Chrome/Edge 128+ MV3 extension for watching 2, 3, or 4 video sources in one full-window tab.

## Install locally

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this repository folder: `chrome-stream-layout`.
5. Click the Stream Layout extension icon.

After updating the extension files, reload the extension from `chrome://extensions` and refresh any open layout tabs.

On any HTTP/HTTPS page, right-click and choose **Add current page to Stream Layout** → **Pane 1–4**. Each pane shows its saved source title/address, or **Empty**; occupied panes are marked **replace**. Choosing a pane applies the current page immediately and opens or focuses the layout. Choosing a hidden third/fourth pane expands the layout to show it. Other panes and unapplied URL drafts are retained; a replacement starts with fresh playback preferences, while adding the same URL preserves its existing preferences. The menu follows the saved interface language and source changes. Add failures leave saved sources unchanged and show a retry hint in the control panel. This uses Chrome's `contextMenus` permission and captures the page URL when right-clicking a link, image or embedded frame.

## Sources

- YouTube video, live, Shorts, and playlist URLs use YouTube's lighter embedded player. A tab-scoped request rule supplies the extension identity required by the player; if YouTube still rejects an embed, the pane automatically falls back to the full page.
- Twitch live channel URLs use the same local Amazon IVS player and custom controls as Kick. **LIVE** and resuming after Pause fetch a fresh stream, preserving quality and volume; autoplay starts muted unless the URL explicitly sets `autoplay=false` or `muted=false`. Offline, restricted, timed-out and failed sources show a status and can be retried with **LIVE**. Channel lookup uses Twitch's non-public playback interfaces without sign-in credentials, so availability depends on Twitch. Clips, VODs, directories and existing official-player URLs are preserved.
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

Twitch and Kick players automatically recover from transient lookup/playback errors and 20 seconds without playback progress. Each recovery fetches a fresh source and replaces the failed or stalled player page, retaining quality, mute and volume. Retries wait 2, 5 and 10 seconds, then stop with a message and an enabled **LIVE** button. Only 60 seconds of continuous playback progress resets that budget; pressing LIVE starts a new manual attempt. Offline channels, denied source access and unsupported playback stop automatic retries. Playback-time authorization errors first refresh the source, allowing expired URLs to recover; a new lookup that denies access stops recovery. Network outages wait for connectivity without consuming attempts. Manual pause, blocked autoplay and hidden/suspended tabs do not trigger stall recovery; moving a pane retains its recovery state, while replacing or removing it cancels pending work. This is recovery from failures, not a guarantee of uninterrupted Twitch ad transitions or access through platform verification.

Kick and Twitch load a bundled [Amazon IVS Player](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html) only inside their local player pages. Low-latency playback and returning to live after rebuffering are enabled; Auto quality considers available bandwidth and is capped to the pane's dimensions. During resizing, cap updates are coalesced over 250 ms and unchanged dimensions are skipped; a new stream receives the latest cap immediately when ready. Manual quality changes preserve buffered playback and may take a few seconds. LIVE reuses the existing engine; replacing or removing a pane destroys both its player and page, releasing workers. Playback latency and stability still depend on the stream, network and device.

Moving the pointer into a custom player reveals a floating play/pause button at the center with a subtle dark overlay. Rounded solid icons sit on glass controls with soft highlights: a slim 36px bottom bar, circular center button, platform badge and compact settings/error panels. The bar uses a light tint and faint edge to keep attention on the video. A matching glass quality menu marks the selected option, supports arrow keys/Home/End, and closes with Escape, Tab or an outside click; long menus scroll inside the pane. Quality menus and compact settings use opaque gradients instead of live-video blur. While either menu is open, the toolbar and platform badge also use static glass surfaces to reduce rendering work; reduced-transparency and reduced-motion preferences are supported. Both this button and the bottom-left play/pause button pause or resume playback; clicking the video itself leaves playback unchanged. The center button, overlay and control bar hide after 2.2 seconds of inactivity or when the pointer leaves, remaining visible while hovered or used with the keyboard. In panes up to 380px wide, play, mute and LIVE stay on one row, while **More playback settings** opens volume, quality and fullscreen controls. The panel stays open during interaction, scrolls inside short panes, and closes with Escape, returning focus to More. Focus the player and use Space/K to play or pause, M to mute, F for fullscreen, or L to return to live. Native video controls are disabled so IVS can select manual qualities.

Bilibili live source cards use the room's current broadcast title instead of the embedded player's generic page title. Room titles load in the background without delaying playback and refresh when the source is reloaded. If the title lookup fails or takes over eight seconds, the card keeps its previous title or shows the room number.

The extension requests HTTP/HTTPS host access because users can embed arbitrary web URLs and resolve stream APIs. It uses `declarativeNetRequestWithHostAccess` without the redundant `declarativeNetRequest` permission. Compatibility rules are limited to the exact origins (including scheme and port) of active webpage sources in each dashboard tab. Official embeds and local players do not add an origin to that list. YouTube's full-page fallback adds its origin before navigating. Compatibility is applied automatically to webpage sources, including sources previously saved with it disabled. Sources on the same origin share its rule while any active pane needs it. The rules remove iframe restrictions on those origins only; CSP is removed only when its header contains `frame-ancestors`, and report-only CSP remains intact. The [DNR header operations](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-HeaderOperation) cannot remove only one CSP directive, so a matching enforced CSP header is removed in full. Other origins, main-frame requests and ordinary tabs retain their response headers. Rules and their session configuration are reconciled after a worker restart and cleaned up when sources are removed or tabs close/navigate away. Some sources can still fail because of DRM, login state, Cloudflare challenges, server-side bot checks, unsupported codecs, or page logic that intentionally refuses embedded playback.

## Controls

- Click the extension icon to open or focus the layout tab and show the source and layout dialog. If the tab is already open, the extension reuses it instead of opening another copy.
- The viewing toolbar at the top-right opens **Sources and layout** and toggles layout fullscreen, including while already in fullscreen. It hides after inactivity; move to its small edge handle or focus it with the keyboard to reveal it. Closing the dialog returns focus to the opener when it is still available.
- Empty panes have an **Add source** button that opens the matching URL editor. Failed sources offer **Retry**, **Edit source** and, for valid web URLs, **Open original** directly in the pane. Editing a failed local player exits that player's fullscreen first. Retrying only reloads the selected source.
- Each source card shows its loading or playback status using text, an icon, and color: offline channels are neutral, connecting/buffering states are amber, playback is green, and failures are red. Webpage sources have Retry/Reload actions in their cards; Kick and Twitch retain their in-player LIVE action and add explicit error actions. Reload all is in the dialog header.
- Playback status comes from visible HTML video elements in the source page. "Page loaded · playback unconfirmed" means the page opened but the extension has not confirmed video playback; this can occur with nested or custom players.
- Players that insert or replace their video after the page has loaded also update the status, including a paused video waiting for Play. Initial discovery coalesces mutations and stops after 30 seconds; an established video only watches its ancestor chain for removal. A ten-second fallback scan catches late paused players and visibility changes. All relay observers and timers stop while the document is hidden and resume with current state.
- Choose 2, 3, or 4 panes using the layout previews. Sources outside the selected layout are collapsed under Unused sources; their URLs are retained and can still be edited by expanding the section.
- Each source card shows its title, platform, status and URL input. The platform badge shares the status/action row instead of adding a line below the title. Type or paste a URL directly; changes remain drafts until you press Apply. Long titles can use two lines.
- URL edits are drafts until Apply is pressed. The dialog shows how many sources have pending changes; Discard changes restores their applied URLs. Switching language or layout, reloading players, or closing and reopening the dialog keeps drafts without applying them. Drafts are kept only in the current page and are lost if it is refreshed or closed.
- Source titles, pane numbers, and position icons identify each card. Hovering or focusing a card briefly highlights the matching pane and its number. Drag its grip handle onto another card to swap their positions, or focus the handle and press Alt + Up/Down. Pending edits move with their source, and swaps between active panes preserve their players.
- Clear all immediately removes all four sources and provides Undo in the same dialog. Undo restores both applied sources and pending edits; changing a source or reordering cards ends that undo opportunity. Undo is kept only in the current page, and restored sources load again.
- Layout tabs share applied settings and synchronize changes. The background worker serializes field-level updates, merging independent edits; conflicting edits to the same setting load the saved version and preserve source edits as local drafts. Untouched players keep running. A failed read or write opens a persistent notice with Retry; success is shown only after storage confirms the write. Keep the page open until a failed save is retried.
- Twitch/Kick quality, volume and mute choices are stored with each configured source, follow pane reordering, and survive refresh. New sources start muted unless their URL says otherwise; saved audio preferences take precedence on subsequent loads. Other websites keep their own player preferences.
- Choose Traditional Chinese or English from the compact language menu in the dialog header. It shares the player's quality-menu styling and selected checkmark, supports arrow keys/Home/End, and closes with Escape, Tab or an outside click. The preference is saved with the layout state.
- The source/layout panel uses a dark glass-style surface, translucent cards, lavender accents and a fixed action area. Opaque gradients and highlights give the panel and action area depth without blurring the live videos; the full-screen overlay only dims them. Small floating tools retain their blur, and reduced-transparency and high-contrast preferences keep the controls readable. Fit and fullscreen are secondary actions, while Apply/Done remains the primary button. Empty panes show their layout position; Kick and Twitch player toolbars hide when idle.
- Use **Layout fullscreen** beside **Fit to window** to put the whole layout into browser fullscreen while preserving the current 2, 3, or 4 pane arrangement.
- Click **Fit to window** below the layout previews to fill the current browser content area while keeping the tabs and address bar visible. Two panes share the width equally; four panes form an equal 2×2 grid. For three panes, the two equal-height panes on the right are sized for 16:9 video, and the main pane takes the remaining width (about 58% left / 42% right in a 1920×910 content area). The split stays within the usual 18–82% resize limits. The dialog closes without entering fullscreen, reloading players, or applying pending source edits. Only the current layout's proportions are saved; other layouts retain their sizes. Click again after resizing the browser to fit the proportions to its new dimensions, or drag the separators to adjust them manually.
- Drag the separators between panes to resize the layout. Their invisible hit area extends beyond the thin visible divider to make them easier to grab. Hovering, focusing or dragging shows the current percentages and a double-click-to-reset hint.
- Keyboard users can focus a separator and press its arrow keys to resize it (Shift for larger steps), or Home/End for the minimum/maximum size. Tab stays within the open source dialog; Escape closes it and restores focus.
- Kick and Twitch show a green **Kick** or purple **Twitch** badge at the player's top-left corner. The badge, center play/pause button and bottom toolbar appear together on pointer activity or keyboard focus, and hide together after 2.2 seconds of inactivity or when the pointer leaves; interacting with the controls keeps them visible. The player surface has no pane-number hover tooltip. Other platforms retain their own player controls.

## Development checks

Use the pinned Node.js version in `.nvmrc` (22.22.0) and the committed npm lockfile:

```sh
nvm use
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

The GitHub Actions workflow runs unit and fixture browser checks on Ubuntu 24.04 with the same Node and Playwright versions, and uploads UI review screenshots. Real-network checks and long performance runs are separate commands. Node.js 18.19+ remains supported for local checks.

The browser checks in `tests/browser.cjs` load the real extension with local HTTP fixtures, including a canvas video stream. They cover independent loading, stale requests, pane swaps, retry isolation, playback status, timeout handling, keyboard controls, and multi-tab rules. The IVS SDK is replaced by a canvas fixture in a disposable extension copy so rebuilt player frames behave deterministically; production SDK assets are untouched. They also run `tests/ui-checks.cjs` to check draft isolation and persistence, collapsed sources, clear/undo, pointer and keyboard ordering, status presentation, responsive controls down to 320px, and separator hit areas. `tests/twitch-checks.cjs` checks mixed Twitch/Kick panes, fresh sources, playback preferences, pane swaps, stale replies, offline/restricted/API/timeout/media recovery, cleanup, and existing official-player URLs. `tests/twitch-source.test.cjs` covers signed URL encoding, invalid responses, timeouts and independent cancellation. `tests/bilibili-checks.cjs` checks background room titles, generic player title suppression, pane reordering, stale responses after retry, and metadata failure isolation. `tests/kick-soop-checks.cjs` checks Kick's center play/pause button, non-toggling video clicks, glass quality-menu selection/keyboard access/short-pane scrolling, control auto-hide, LIVE, quality/volume preservation, fullscreen, fresh URLs, stale-response protection, offline recovery, and player page disposal, together with SOOP's official player. `tests/live-player.test.cjs` covers IVS instance reuse, quality changes, no-autoplay, viewport caps and cleanup. `tests/huya-checks.cjs` checks hidden room prompts, preserved playback and controls, menu bounds in narrow/short panes, and unchanged standalone Huya tabs. With Playwright available on Node's module path, run:

```sh
node tests/browser.cjs
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chrome for Testing executable. Browser system libraries must be installed separately if the environment does not already provide them.

Optional real-network checks exercise the production Twitch route in two local IVS panes:

```sh
npm run test:live -- roger9527
```

The channel must be live and offer multiple video qualities. The script launches a fresh browser profile and uses the production resolver, host and SDK without routing overrides or network mocks. It checks playback, quality changes, pause/resume, LIVE, volume preservation, fullscreen, autoplay preferences and worker cleanup. It prints the directory containing a JSON report and screenshot; set `TWITCH_LIVE_OUTPUT` to choose the output directory. Reports omit playback tokens and signed URLs. These checks depend on Twitch's live service and run separately from the regression suite.

`tests/live-recovery.test.cjs` uses a simulated clock to check bounded backoff, persistent retry budgets, stalls, frozen decoded frames, pause/autoplay behavior, connectivity, server backoff, background/suspend grace periods and cancellation. The Twitch browser checks additionally exercise fresh authorization, automatic player-page replacement, preference retention, exhausted retries, stalled media, pane swaps and cancellation after source changes. SDK diagnostics retain only categorized error type, code and source in memory; raw messages, playback tokens and signed URLs are not recorded.

For focused custom-player interaction checks, run `BROWSER_CHECKS=player node tests/browser.cjs`.

`tests/context-menu-checks.cjs` covers current-page import, replacement, hidden-pane expansion, existing/new dashboard routing, draft/player preservation, shared-state synchronization, and visible save-failure recovery. The native menu API is checked in the real worker; clicks are passed to its handler because browser menus are outside the page DOM. Run just these checks with `BROWSER_CHECKS=context-menu npm run test:browser`.

`tests/viewing-checks.cjs` runs with the browser checks and covers the viewing toolbar in fullscreen, focused source editing from empty/error panes, safe original-site links, isolated retry, direct URL editing, pane highlights and splitter feedback. Kick checks additionally cover error actions and the compact options panel at narrow and short sizes. Set `UI_REVIEW_OUTPUT` to save representative dashboard screenshots from the fixture run.


The additional `tests/state.test.cjs`, `tests/frame-relay.test.cjs`, `tests/storage-checks.cjs` and `tests/frame-rules-checks.cjs` cover stale clients, concurrent writes, conflict recovery, failed reads/writes, persisted and synchronized audio/quality, bounded DOM discovery, background suspension, and real loopback HTTP responses with iframe/CSP restrictions.

### Performance baseline

```sh
npm run benchmark                         # 30-minute, four-pane synthetic soak
PERF_SECONDS=60 npm run benchmark         # short smoke run
PERF_SECONDS=3600 npm run benchmark       # one-hour run
```

The benchmark serves four local 640×360 canvas streams at a target 30 fps while each page adds/removes about 300 chat messages per second. After a five-second warm-up it records Chrome process CPU, aggregate process RSS on Linux, dashboard JS heap, total/dropped video-frame counters and playback status. RSS can double-count shared pages, and CPU 100% means one logical CPU. Synthetic canvas streams isolate extension behavior; these numbers do not predict the decoder, GPU, network, ads or DRM cost of real live streams. Do not use a short run to rule out leaks.

Reports are written to `test-results/performance/report.json`; set `PERF_OUTPUT` and `PERF_SAMPLE_SECONDS` to change the destination and sampling interval. `PERF_RELAY_FILE` can substitute an older relay script in a disposable extension copy for comparison. No source tokens or signed playback URLs are recorded. For a real-live baseline, use fixed live channels, quality, viewport, device and network, keep the browser foreground, and record CPU, memory, dropped frames and interruptions over the same 30–60 minute interval.

Measured local results and raw reports are recorded in the [technical review](docs/technical-review.zh-TW.md#本機驗證與四窗格基準).

### Code layout

The dashboard uses native scripts without a framework or build step: `state-model.js` handles normalization and field patches, `state-service.js` serializes worker writes, `storage.js` handles dashboard synchronization and failures, `sources.js` handles URL routing and platform lookups, and `i18n.js` contains dashboard translations. `context-menu.js` manages the native page menu and assigns a selected pane through the same worker write queue. `dashboard.js` coordinates the stage, controls and resizing; `dashboard-ui.js` manages viewing tools and inline feedback. Existing saved source/layout data is normalized in place on its next successful save.
