"use strict";

// One controller per pane, surviving player-page replacements. Never retain
// signed URLs or raw SDK error messages here.
function createLiveRecovery({ read, retry, report, now = () => performance.now(),
  setTimer = (fn, delay) => window.setTimeout(fn, delay), clearTimer = (id) => window.clearTimeout(id) }) {
  const delays = [2000, 5000, 10000];
  const pollMs = 2000;
  const stallMs = 20000;
  const stableMs = 60000;
  let timer;
  let disposed = false;
  let enabled = false;
  let phase = "idle";
  let attempts = 0;
  let previous;
  let lastTick = 0;
  let lastProgress = 0;
  let stableSince;
  let wasOffline = false;

  const cancel = () => { clearTimer(timer); timer = undefined; };
  const schedule = (fn, delay) => { cancel(); timer = setTimer(fn, delay); };
  const resetObservation = () => {
    previous = undefined;
    lastTick = lastProgress = now();
    stableSince = undefined;
  };
  function fail(error = {}) {
    if (disposed || phase === "waiting" || phase === "stopped") return;
    cancel();
    stableSince = undefined;
    const status = ["sourceOffline", "sourceRestricted", "sourceTimeout", "sourceFailed"].includes(error.code)
      ? error.code : "sourceMediaError";
    if (!enabled || error.retryable === false || ["sourceOffline", "sourceRestricted"].includes(status)) {
      phase = "stopped";
      report(status, true);
      return;
    }
    if (attempts >= delays.length) {
      phase = "stopped";
      report("sourceRecoveryFailed", true);
      return;
    }
    phase = "waiting";
    report(read().online === false ? "sourceWaitingNetwork" : "sourceReconnecting", false);
    // A server's Retry-After can lengthen, never shorten, our backoff.
    const delay = Math.max(delays[attempts], Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0);
    schedule(reconnect, delay);
  }
  function reconnect() {
    if (disposed || phase !== "waiting") return;
    const sample = read();
    if (!sample.alive) return destroy();
    if (sample.online === false) {
      report("sourceWaitingNetwork", false);
      schedule(reconnect, pollMs);
      return;
    }
    attempts++;
    phase = "resolving";
    // The host owns cancellation and converts lookup failures back into fail().
    retry();
  }
  function poll() {
    if (disposed || !enabled || phase !== "monitoring") return;
    const sample = read();
    if (!sample.alive) return destroy();
    if (sample.active === false) return pause();
    const time = now();
    if (sample.online === false) {
      wasOffline = true;
      resetObservation();
      report("sourceWaitingNetwork", false);
    } else if (wasOffline) {
      wasOffline = false;
      return fail({ kind: "network" });
    } else if (sample.visible === false || time - lastTick > 10000) {
      // Hidden tabs and suspended laptops can stop rendering or delay timers.
      // Give playback a full grace period when observation resumes.
      resetObservation();
    } else {
      const moved = previous && sample.time > previous.time + 0.01 &&
        (sample.frames == null || previous.frames == null || sample.frames > previous.frames);
      if (moved) {
        lastProgress = time;
        if (!sample.buffering) {
          stableSince ??= time;
          if (time - stableSince >= stableMs) attempts = 0;
        } else stableSince = undefined;
      } else {
        stableSince = undefined;
        if (time - lastProgress >= stallMs) return fail({ kind: "stall" });
      }
      previous = sample;
      lastTick = time;
    }
    schedule(poll, pollMs);
  }
  function pause() {
    enabled = false;
    phase = "paused";
    cancel();
    resetObservation();
  }
  function destroy() {
    disposed = true;
    cancel();
    previous = undefined;
  }
  return {
    get waiting() { return phase === "waiting" || phase === "stopped"; },
    begin({ automatic = false, autoplay = true } = {}) {
      if (disposed) return;
      cancel();
      if (!automatic) attempts = 0;
      enabled = autoplay;
      phase = "resolving";
      wasOffline = false;
      resetObservation();
    },
    loaded() {
      if (disposed || phase !== "resolving") return;
      phase = "monitoring";
      resetObservation();
      if (enabled) schedule(poll, pollMs);
    },
    fail, pause, destroy
  };
}
