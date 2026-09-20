# Amazon IVS Player 1.56.1

Local SDK assets, loaded only by `kick-player.html`:

- `ivs/amazon-ivs-player.min.js`: https://player.live-video.net/1.56.1/amazon-ivs-player.min.js
- `ivs/amazon-ivs-wasmworker.min.js` and `.wasm`: `amazon-ivs-player@1.56.1/dist/assets/` from npm.
- `ivs/LICENSE.txt`: https://player.live-video.net/LICENSE.txt (AWS terms and third-party notices).
- `ivs/amazon-ivs-player.min.js.LICENSE.txt`: a copy of the supplied notices at the filename referenced by the main script.

Keep the main SDK, worker and WASM versions identical. These files are unmodified; no remote scripts execute. The extension CSP permits local WebAssembly (`wasm-unsafe-eval`) and same-origin workers. Do not add `unsafe-eval` or blob worker permissions.

Each Kick pane owns a separate extension page. LIVE loads the latest source through the same SDK instance; source changes/removal dispose the page as well as the player, releasing its worker. The former HLS.js assets are no longer used.
