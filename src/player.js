"use strict";

const video = document.querySelector("#video");
const message = document.querySelector("#message");
const params = new URLSearchParams(location.search);
const src = params.get("src");

if (!src) {
  showMessage("No media source was provided.");
} else {
  try {
    const parsed = new URL(src);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      showMessage("Only http and https media sources are supported.");
    } else {
      video.src = parsed.href;
      video.addEventListener("error", () => {
        showMessage("This media URL could not be played directly by Chrome.");
      });
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => {
          showMessage("Press play to start this media source.");
        });
      });
    }
  } catch {
    showMessage("The media source URL is invalid.");
  }
}

function showMessage(text) {
  video.hidden = true;
  message.hidden = false;
  message.textContent = text;
}
