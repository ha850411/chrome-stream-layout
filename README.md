# chrome stream layout

Chrome/Edge MV3 extension for watching 2, 3, or 4 video sources in one full-window tab.

## Install locally

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this folder: `chrome_layout`.
5. Click the chrome stream layout extension icon.

After changing `manifest.json`, reload the extension from `chrome://extensions`.

## Sources

- YouTube video, live, Shorts, and playlist URLs use YouTube's lighter embedded player. A tab-scoped request rule supplies the extension identity required by the player; if YouTube still rejects an embed, the pane automatically falls back to the full page.
- Other webpage URLs are loaded directly as full-pane iframes without broad platform-specific rewriting.
- Webpage iframes are not sandboxed, so source pages keep their normal in-page controls, chat panels, and popup behavior.
- YouTube embed error detection, YouTube full-page fallbacks, and YesLive pages get host-scoped frame helpers only when embedded inside this extension. Bilibili live room URLs use Bilibili's official live player because the room page itself blocks iframe embedding before an in-frame helper can run.
- Direct media URLs such as `.mp4`, `.webm`, `.m3u8`, and `.mpd` are loaded directly into the iframe. Chrome may not play every streaming format natively.
- Any other `http` or `https` URL is loaded as a full-pane iframe.

The extension has `<all_urls>` host access and removes common iframe-blocking response headers only for sub-frame requests inside its dashboard tab, so more sites can be placed into the layout without changing unrelated tabs. Some sources can still fail because of DRM, login state, Cloudflare challenges, server-side bot checks, unsupported codecs, or page logic that intentionally refuses embedded playback.

## Controls

- Click the extension icon to open or focus the layout tab and show the source and layout dialog. If the tab is already open, the extension reuses it instead of opening another copy.
- The video layout has no floating extension controls. Click the extension icon to open or reopen the app dialog; reload and layout-fullscreen actions are available in the dialog header.
- Choose 2, 3, or 4 panes in the dialog.
- Choose Traditional Chinese or English for the dashboard interface. The preference is saved with the layout state.
- Use the fullscreen button in the app dialog to put the whole layout into browser fullscreen while preserving the current 2, 3, or 4 pane arrangement.
- Drag the thin separators between panes to resize the layout.
- Per-pane overlays are intentionally omitted so the video area stays clean and unobstructed.
