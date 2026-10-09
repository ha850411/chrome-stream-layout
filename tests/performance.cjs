"use strict";

// Offline four-pane soak. Synthetic canvas media measures extension overhead;
// it does not model codec/GPU/network costs of four real live streams.
const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { createHash } = require("node:crypto");
const duration = Number(process.env.PERF_SECONDS || 1800);
const interval = Number(process.env.PERF_SAMPLE_SECONDS || 10);
if (!Number.isFinite(duration) || duration < 10 || !Number.isFinite(interval) || interval < 1) throw new Error("Invalid benchmark duration");
const output = path.resolve(process.env.PERF_OUTPUT || "test-results/performance");
const fixture = `<!doctype html><title>Performance fixture</title><style>body{margin:0;background:#10171b}video{width:100vw;height:100vh;object-fit:contain}#chat{display:none}</style><video autoplay muted playsinline></video><div id="chat"></div><script>
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
const ctx=canvas.getContext('2d');const video=document.querySelector('video');
video.srcObject=canvas.captureStream(30);video.play();let tick=0;
setInterval(()=>{ctx.fillStyle='hsl('+(tick++%360)+' 60% 40%)';ctx.fillRect(0,0,640,360);},1000/30);
const chat=document.querySelector('#chat');let mutations=0;
setInterval(()=>{for(let i=0;i<10;i++){const node=document.createElement('div');node.innerHTML='<span>Fixture chat</span>';chat.append(node);if(chat.children.length>100)chat.firstChild.remove();mutations++;}},33);
window.perfSnapshot=()=>{const q=video.getVideoPlaybackQuality();return {frames:q.totalVideoFrames,dropped:q.droppedVideoFrames,mutations,playing:!video.paused};};
</script>`;

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "stream-layout-perf-"));
  const extension = await fs.mkdtemp(path.join(os.tmpdir(), "stream-layout-perf-extension-"));
  const server = http.createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(fixture); });
  const report = { kind: "offline-synthetic-four-pane", startedAt: new Date().toISOString(), requestedSeconds: duration, node: process.version,
    platform: `${os.platform()} ${os.release()}`, logicalCPUs: os.cpus().length,
    relay: process.env.PERF_RELAY_FILE ? "baseline override" : "workspace",
    memory: "Sum of Chrome process RSS on Linux (shared pages may be counted more than once); dashboard JS heap is separate.",
    cpu: "Chrome process CPU-seconds delta / wall-seconds; 100% equals one logical CPU, not whole-machine utilization.",
    samples: [], errors: [] };
  let context;
  try {
    for (const entry of ["manifest.json", "dashboard.html", "live-player.html", "src", "assets"]) {
      await fs.cp(path.resolve(__dirname, "..", entry), path.join(extension, entry), { recursive: true });
    }
    if (process.env.PERF_RELAY_FILE) await fs.copyFile(process.env.PERF_RELAY_FILE, path.join(extension, "src/frame-relay.js"));
    report.relaySHA256 = createHash("sha256").update(await fs.readFile(path.join(extension, "src/frame-relay.js"))).digest("hex");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
      headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-sandbox"]
    });
    report.browser = context.browser().version();
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.name));
    await page.goto(worker.url().replace(/src\/background.js$/, "dashboard.html"));
    await page.waitForFunction(() => document.querySelectorAll("[data-tile]").length === 4);
    await page.evaluate(async (port) => {
      closeControls();
      state.slots = Array.from({ length: 4 }, (_, i) => ({ url: `http://127.0.0.1:${port}/pane-${i}` }));
      await renderStage();
    }, port);
    await page.waitForFunction(() => [...document.querySelectorAll("[data-tile]")].every((tile) => tile.dataset.status === "sourcePlaying"));
    const frames = page.frames().filter((frame) => frame.url().startsWith(`http://127.0.0.1:${port}/`));
    if (frames.length !== 4) throw new Error("Expected four media panes");
    const browserCDP = await context.browser().newBrowserCDPSession();
    const pageCDP = await context.newCDPSession(page);
    await pageCDP.send("Performance.enable");
    // A bounded warm-up is excluded from the measured interval.
    await page.waitForTimeout(5000);
    const start = performance.now();
    let previous = null;
    do {
      const { processInfo } = await browserCDP.send("SystemInfo.getProcessInfo");
      const metrics = (await pageCDP.send("Performance.getMetrics")).metrics;
      let rssKB = 0;
      if (os.platform() === "linux") {
        for (const proc of processInfo) {
          const status = await fs.readFile(`/proc/${proc.id}/status`, "utf8").catch(() => "");
          rssKB += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0);
        }
      }
      const now = performance.now();
      const processes = Object.fromEntries(processInfo.map((proc) => [proc.id, proc.cpuTime]));
      const cpuDelta = previous ? processInfo.reduce((total, proc) => total + Math.max(0, proc.cpuTime - (previous.processes[proc.id] ?? proc.cpuTime)), 0) : 0;
      const sample = { seconds: (now - start) / 1000,
        cpuPercent: previous ? cpuDelta / ((now - previous.time) / 1000) * 100 : null,
        chromeRSSMB: os.platform() === "linux" ? rssKB / 1024 : null,
        dashboardHeapMB: metrics.find((metric) => metric.name === "JSHeapUsedSize").value / 1024 / 1024,
        videos: await Promise.all(frames.map((frame) => frame.evaluate(() => window.perfSnapshot()))) };
      report.samples.push(sample);
      previous = { processes, time: now };
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(`PERF ${Math.round(sample.seconds)}s: CPU ${sample.cpuPercent?.toFixed(1) ?? "warmup"}%, Chrome RSS ${sample.chromeRSSMB?.toFixed(1) ?? "unavailable"} MiB, playing ${sample.videos.filter((video) => video.playing).length}/4`);
      if (sample.seconds >= duration) break;
      await page.waitForTimeout(Math.max(0, Math.min(interval * 1000, duration * 1000 - (performance.now() - start))));
    } while (true);
    report.completed = true;
    report.actualSeconds = (performance.now() - start) / 1000;
    const measured = report.samples.filter((sample) => sample.cpuPercent !== null);
    const first = report.samples[0], last = report.samples.at(-1);
    const cpuSeconds = measured.reduce((sum, sample, i) => sum + sample.cpuPercent / 100 * (sample.seconds - report.samples[i].seconds), 0);
    report.summary = { averageCPUPercent: cpuSeconds / last.seconds * 100,
      firstRSSMB: first.chromeRSSMB, lastRSSMB: last.chromeRSSMB,
      droppedFrames: last.videos.reduce((sum, video, i) => sum + video.dropped - first.videos[i].dropped, 0),
      totalFrames: last.videos.reduce((sum, video, i) => sum + video.frames - first.videos[i].frames, 0) };
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    if (report.errors.length || last.videos.some((video) => !video.playing)) throw new Error("Benchmark detected a playback/script failure");
    console.log(`Report: ${path.join(output, "report.json")}`);
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(extension, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
