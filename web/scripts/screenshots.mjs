#!/usr/bin/env node
// Dev only: headless screenshots of key chapters at desktop and phone size.
// Usage: node scripts/screenshots.mjs [baseUrl]   (default http://localhost:4317/street-skin/)
// Needs a running `vite preview --port 4317`. Uses an already installed Playwright
// Chromium headless shell (set CHROME_PATH to override); it never downloads browsers.

import { chromium, webkit, firefox } from "playwright-core";
// BROWSER=chromium (default) | webkit | firefox. WebKit/Firefox use Playwright's own builds (npx playwright-core install webkit firefox).
const BROWSER = process.env.BROWSER || "chromium";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../screenshots");
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] || "http://localhost:4317/street-skin/";

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-mac"]) {
      const p = path.join(root, d, sub, "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("No Playwright headless shell found. Set CHROME_PATH.");
}

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { name: "phone", viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "tablet", viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
];
// optional filters: VPS=desktop,phone  ONLY=04,06  (shot name prefixes)
const VPS = process.env.VPS ? process.env.VPS.split(",") : ["desktop", "phone"];
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

const SHOTS = [
  { name: "00-hook", sel: ".step-hook.first" , top: true },
  { name: "01-headline", sel: '.step-hook[data-st="1"]' },
  { name: "02-slider", sel: '.step-beyond[data-st="3"]' },
  { name: "03-ride", sel: '.step-ride[data-st="1"]', wait: 3500 },
  { name: "04-question", sel: '.step-question[data-st="1"]' },
  { name: "05-question-hover", sel: '.step-question[data-st="3"]', hover: true },
  { name: "06-places", sel: '.step-places[data-st="1"]' },
  { name: "07-trees", sel: ".step-trees", optional: true },
  { name: "08-sowhat", sel: '.step-sowhat[data-st="1"]' },
  { name: "09-explore", sel: ".step-explore", wait: 3000 },
  { name: "10-explore-detail", sel: ".step-explore", detail: true },
  { name: "11-how", sel: "#how", how: true },
];

const browser = BROWSER === "webkit" ? await webkit.launch()
  : BROWSER === "firefox" ? await firefox.launch()
  : await chromium.launch({
    executablePath: findChrome(),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
const TAG = BROWSER === "chromium" ? "" : `${BROWSER}-`;
const problems = [];
for (const vp of VIEWPORTS.filter((v) => VPS.includes(v.name))) {
  const { name: _n, ...opts } = vp;
  if (BROWSER === "firefox") delete opts.isMobile; // not supported by Firefox
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`[${vp.name}] console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`[${vp.name}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`[${vp.name}] requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(BASE + "?debug=1", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  if (!ONLY) await page.screenshot({ path: path.join(OUT, `${TAG}${vp.name}-ribbon.png`) });
  await page.waitForFunction(() => !document.getElementById("ribbon"), null, { timeout: 60000 });
  await page.waitForTimeout(400);

  for (const s of SHOTS.filter((x) => !ONLY || ONLY.some((o) => x.name.startsWith(o)))) {
    const ok = await page.evaluate(({ sel, top, how }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const y = top ? 0 : how ? el.offsetTop : el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.25;
      window.scrollTo(0, Math.max(0, y));
      return true;
    }, s);
    if (!ok) { if (!s.optional) problems.push(`[${vp.name}] missing ${s.sel}`); continue; }
    await page.waitForTimeout(s.wait || 1800);
    if (s.hover) {
      const box = await page.locator("#scatter").boundingBox();
      if (box) {
        const x = box.x + box.width * 0.3, y = box.y + box.height * 0.55;
        if (vp.isMobile) await page.touchscreen.tap(x, y); else await page.mouse.move(x, y);
        await page.waitForTimeout(900);
      }
    }
    if (s.detail) {
      await page.evaluate(() => window.__ss && window.__ss.openHero());
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: path.join(OUT, `${TAG}${vp.name}-${s.name}.png`), timeout: 90000 });
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no console errors or warnings");
