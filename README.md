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

- Known live platforms are loaded through their original player pages when possible: YouTube, Twitch, Bilibili, and Huya.
- Direct media URLs such as `.mp4`, `.webm`, `.m3u8`, and `.mpd` open in the built-in player. Chrome may not play every streaming format natively.
- Any other `http` or `https` URL is loaded as a full-pane iframe.

The extension has `<all_urls>` host access and removes common iframe-blocking response headers from sub-frame requests so more sites can be placed into the layout. Some sources can still fail because of DRM, login state, Cloudflare challenges, server-side bot checks, unsupported codecs, or player logic that intentionally refuses embedded playback.

## Controls

- Click the extension icon to open or focus the layout tab and show the source and layout dialog. If the tab is already open, the extension reuses it instead of opening another copy.
- The page itself is full-window. You can also use the floating settings icon in the upper-right corner to open the dialog.
- Choose 2, 3, or 4 panes in the dialog.
- Drag the thin separators between panes to resize the layout.
- Hover a pane and click its corner fullscreen icon to enlarge that stream inside the extension layout. Native iframe fullscreen is not granted, so embedded players should not take over the whole monitor.
