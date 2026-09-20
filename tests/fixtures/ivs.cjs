"use strict";
// Browser fixture exercises the real control UI and lifecycle without a live CDN.
module.exports = function installIVSFixture() {
  if (!location.pathname.endsWith('/kick-player.html')) return;
  window.ivsFixture = { instances: [], urls: [] };
  const sdk = {
    isPlayerSupported: true,
    PlayerState: { READY: 'Ready', PLAYING: 'Playing', BUFFERING: 'Buffering', ENDED: 'Ended' },
    PlayerEventType: { ERROR: 'Error', PLAYBACK_BLOCKED: 'Blocked' },
    create() {
      const handlers = new Map();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      let video, stream, timer, auto = true, paused = true, current;
      const emit = (name) => handlers.get(name)?.();
      const paint = () => { canvas.getContext('2d').fillStyle = '#183445'; canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height); };
      const player = {
        destroyed: false,
        fail() { emit('Error'); },
        addEventListener: (name, fn) => handlers.set(name, fn),
        removeEventListener: (name) => handlers.delete(name),
        attachHTMLVideoElement(v) { video = v; },
        setLiveLowLatencyEnabled() {}, setRebufferToLive() {}, setAutoMaxVideoSize() {},
        setAutoplay(value) { auto = value; },
        setMuted(value) { video.muted = value; },
        setVolume(value) { video.volume = value; },
        getQualities() { return [{ height: 360, width: 640, framerate: 30 }, { height: 1080, width: 1920, framerate: 60 }]; },
        setQuality(q) { current = q; canvas.width = q.width; canvas.height = q.height; paint(); },
        setAutoQualityMode() { this.setQuality(this.getQualities()[0]); },
        getQuality() { return current; },
        getLiveLatency() { return 1.5; },
        isPaused() { return paused; },
        load(url) {
          ivsFixture.urls.push(url);
          if (!stream) { paint(); stream = canvas.captureStream(10); video.srcObject = stream; timer = setInterval(paint, 100); }
          queueMicrotask(() => { emit('Ready'); if (auto) this.play(); });
        },
        play() { paused = false; void video.play().then(() => emit('Playing')).catch(() => emit('Blocked')); },
        pause() { paused = true; video.pause(); },
        delete() { this.destroyed = true; clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); video.pause(); video.srcObject = null; handlers.clear(); }
      };
      ivsFixture.instances.push(player);
      return player;
    }
  };
  Object.defineProperty(window, 'IVSPlayer', { get: () => sdk, set: () => {} });
};
