#!/usr/bin/env node
// Records the ?autoplay=1 story at 1920x1080 (headless, never takes focus) using Chrome's
// screencast frames, then assembles video/raw.mp4 with the system ffmpeg using real frame timings.
// Usage: node scripts/record-video.mjs [baseUrl] [seconds]
// Needs a running `vite preview --port 4317`. Then video/make-video.sh adds the voice and cuts to 60 s.
import { chromium } from "playwright-core";
import { existsSync, readdirSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../video");
const BASE = process.argv[2] || "http://localhost:4317/heat-ride/";
const SECS = Number(process.argv[3] || 56);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"]) {
      const p = path.join(root, d, sub, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("No Playwright headless shell found. Set CHROME_PATH.");
}

mkdirSync(OUT, { recursive: true });
const tmp = path.join(OUT, "rec-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const size = { width: 1920, height: 1080 };
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  const i = frames.length;
  writeFileSync(path.join(tmp, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64"));
  frames.push(f.metadata.timestamp);
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await page.goto(`${BASE}?autoplay=1&secs=${SECS}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await page.waitForFunction(() => document.documentElement.dataset.autoplayDone === "1", null, { timeout: (SECS + 60) * 1000 });
await page.waitForTimeout(2500); // hold the last frame briefly
await cdp.send("Page.stopScreencast");
await ctx.close();
await browser.close();

// concat list with each frame's real duration
let list = "";
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? frames[i + 1] - frames[i] : 0.5;
  list += `file 'f${String(i).padStart(5, "0")}.jpg'\nduration ${Math.max(dur, 0.001).toFixed(4)}\n`;
}
list += `file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
writeFileSync(path.join(tmp, "list.txt"), list);
const out = path.join(OUT, "raw.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
  "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30",
  "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out]);
const span = frames.length ? frames[frames.length - 1] - frames[0] : 0;
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ out, frames: frames.length, seconds: Number(span.toFixed(1)), fps: Number((frames.length / span).toFixed(1)) }));
