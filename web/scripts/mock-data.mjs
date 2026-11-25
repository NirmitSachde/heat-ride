#!/usr/bin/env node
// Street Skin · MOCK data generator.
// Writes web/public/data/*.json, segments.geojson and web/public/frames/** in the exact
// shape of docs/DATA_CONTRACT.md, so the front end can be built before the real export lands.
// Everything here is synthetic. story.json carries "mock": true and the app shows a badge.
// The real pipeline (pipeline/05_export.py) overwrites these files.
//
// Usage:
//   node scripts/mock-data.mjs                     (default, finding = "cooler")
//   node scripts/mock-data.mjs --variant not_clearly
//   node scripts/mock-data.mjs --no-images          (json only, keeps existing images)
//   node scripts/mock-data.mjs --force              (overwrite even if real data is present)

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(here, "../public");
const DATA = path.join(PUB, "data");
const FRAMES = path.join(PUB, "frames");

const args = new Set(process.argv.slice(2));
const VARIANT = process.argv.includes("--variant")
  ? process.argv[process.argv.indexOf("--variant") + 1]
  : "cooler";
const WITH_IMAGES = !args.has("--no-images");

// ---------- safety: never clobber real pipeline output ----------
const storyPath = path.join(DATA, "story.json");
if (existsSync(storyPath) && !args.has("--force")) {
  try {
    const cur = JSON.parse(await readFile(storyPath, "utf8"));
    if (!cur.mock) {
      console.error("Real data found in public/data (story.json has no mock flag). Refusing. Use --force.");
      process.exit(1);
    }
  } catch { /* unreadable, overwrite */ }
}

// ---------- seeded random ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20250926);
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// ---------- places (contract order: smallest to largest) ----------
const AREAS = ["Middelbeers", "Oirschot", "Delft", "Arnhem"];
const PLACE = {
  Middelbeers: { label: "village", c: [5.2505, 51.4655], R: 1100, n: 520, base: 3.2, gmean: 0.42, days: ["2025-10-08"], air: [15.4], grid: 0.35 },
  Oirschot: { label: "town", c: [5.3110, 51.5050], R: 1500, n: 880, base: 3.9, gmean: 0.36, days: ["2025-10-07"], air: [16.1], grid: -0.2 },
  Delft: { label: "small city", c: [4.3600, 52.0110], R: 1900, n: 1300, base: 4.7, gmean: 0.27, days: ["2025-10-02", "2025-10-03"], air: [15.2, 14.6], grid: 0.12 },
  Arnhem: { label: "big city", c: [5.9050, 51.9840], R: 2300, n: 2300, base: 5.4, gmean: 0.25, days: ["2025-09-26", "2025-09-27"], air: [17.6, 16.8], grid: 0.62 },
};
const GREEN_EFFECT = VARIANT === "not_clearly" ? -1.0 : -7.5;
const STREETS = ["Steenstraat", "Rijnkade", "Jansbinnensingel", "Oude Delft", "Markt", "Kerkstraat", "Molenstraat", "Spoorlaan",
  "Nieuwstraat", "Dorpsstraat", "Koestraat", "Utrechtseweg", "Velperweg", "Phoenixstraat", "Voorstraat", "Oostsingel",
  "Beekstraat", "Hoogstraat", "Broerenstraat", "Sonsbeeksingel", "Westsingel", "Lindenlaan", "Eikenlaan", "Schoolstraat"];

const M_PER_DEG_LAT = 111320;

// Smooth "green" field per place, in metres from centre.
function greenField(p, x, y, seed) {
  const s = seed;
  const v = p.gmean
    + 0.22 * Math.sin(x / 420 + s) * Math.cos(y / 510 - s * 0.7)
    + 0.12 * Math.sin((x + y) / 190 + s * 1.3)
    + 0.08 * Math.cos((x - y) / 95 - s);
  return clamp(v, 0.02, 0.9);
}

// ---------- rides as street wiggles ----------
const cols = { id: [], a: [], lon: [], lat: [], t: [], w: [], st: [], g: [], h: [], hero: [] };
const rides = [];
let heroCounter = 0;

for (let ai = 0; ai < AREAS.length; ai++) {
  const name = AREAS[ai];
  const p = PLACE[name];
  const seed = ai * 1.7 + 0.4;
  const mLon = M_PER_DEG_LAT * Math.cos((p.c[1] * Math.PI) / 180);
  let x = (rnd() - 0.5) * 300, y = (rnd() - 0.5) * 300;
  let heading = p.grid + Math.floor(rnd() * 4) * (Math.PI / 2);
  let leg = 60 + rnd() * 220;
  let count = 0;
  const perDay = Math.ceil(p.n / p.days.length);
  for (let di = 0; di < p.days.length; di++) {
    const dayOffset = di * 86400;
    let t = dayOffset + 11 * 3600 + Math.floor(rnd() * 1800); // around midday
    const dayEnd = Math.min(p.n, count + perDay);
    while (count < dayEnd) {
      const rideLen = Math.min(dayEnd - count, 90 + Math.floor(rnd() * 260));
      const ride = { area: name, day: p.days[di], path: [], timestamps: [], w: [] };
      for (let k = 0; k < rideLen; k++) {
        // move one photo step: ~4.5 m/s, a photo every 2-4 s
        const dt = 2 + Math.floor(rnd() * 3);
        const step = 4.5 * dt;
        leg -= step;
        if (leg <= 0) {
          const r = Math.hypot(x, y);
          if (r > p.R) {
            const toC = Math.atan2(-y, -x);
            const snapped = p.grid + Math.round((toC - p.grid) / (Math.PI / 2)) * (Math.PI / 2);
            heading = snapped;
          } else {
            const turn = rnd();
            heading += turn < 0.35 ? Math.PI / 2 : turn < 0.7 ? -Math.PI / 2 : 0;
          }
          leg = 60 + rnd() * 260;
        }
        const wob = Math.sin(t / 37) * 0.06;
        x += Math.cos(heading + wob) * step;
        y += Math.sin(heading + wob) * step;
        t += dt;

        const lon = p.c[0] + x / mLon;
        const lat = p.c[1] + y / M_PER_DEG_LAT;
        const g = clamp(greenField(p, x, y, seed) + gauss() * 0.06, 0, 0.95);
        const air = p.air[di];
        let w = p.base + GREEN_EFFECT * (g - p.gmean) + gauss() * 3.4 + 0.8 * Math.sin(x / 700);
        const unknown = rnd() < 0.012;
        const st = air + w;
        const h = g < 0.07 ? null : clamp(0.56 - 0.012 * (w - p.base) + gauss() * 0.07, 0.15, 0.85);
        const hero = (count % 61 === 17) ? 1 : 0;
        if (hero) heroCounter++;
        const id = `${name}_${String(count + 1).padStart(4, "0")}`;
        cols.id.push(id); cols.a.push(ai); cols.lon.push(r5(lon)); cols.lat.push(r5(lat));
        cols.t.push(t); cols.w.push(unknown ? null : r2(w)); cols.st.push(r1(st)); cols.g.push(r2(g));
        cols.h.push(h === null ? null : r2(h)); cols.hero.push(hero);
        ride.path.push([r5(lon), r5(lat)]); ride.timestamps.push(t); ride.w.push(unknown ? null : r2(w));
        count++;
        if (count >= dayEnd) break;
      }
      if (ride.path.length >= 2) rides.push(ride);
      t += 120 + Math.floor(rnd() * 900); // a pause, more than 60 s: new ride entry
    }
  }
}
const N = cols.id.length;

// ---------- stats ----------
function ranks(arr) {
  const idx = arr.map((v, i) => i).sort((i, j) => arr[i] - arr[j]);
  const r = new Float64Array(arr.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(xs, ys) {
  const rx = ranks(xs), ry = ranks(ys);
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += rx[i]; my += ry[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}
function pValue(r, n) {
  const t = Math.abs(r) * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  // normal approximation, fine for n in the hundreds
  const z = t;
  const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
  return Math.max(p, 1e-12);
}
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);

function summarize(indices) {
  const ok = indices.filter((i) => cols.w[i] !== null);
  const ws = ok.map((i) => cols.w[i]);
  const gs = ok.map((i) => cols.g[i]);
  const order = [...ok].sort((i, j) => cols.w[i] - cols.w[j]);
  const k = Math.max(1, Math.floor(order.length * 0.2));
  const cool = order.slice(0, k), warm = order.slice(-k);
  const r = spearman(gs, ws);
  const sortedW = [...ws].sort((a, b) => a - b);
  return {
    ok, r, p: pValue(r, ok.length), cool, warm,
    warmth_median: quantile(sortedW, 0.5), warmth_p90: quantile(sortedW, 0.9),
    green_cool: median(cool.map((i) => cols.g[i])), green_warm: median(warm.map((i) => cols.g[i])),
  };
}

const all = [...Array(N).keys()];
const S = summarize(all);
const areas = {};
for (let ai = 0; ai < AREAS.length; ai++) {
  const name = AREAS[ai];
  const idx = all.filter((i) => cols.a[i] === ai);
  const s = summarize(idx);
  const p = PLACE[name];
  areas[name] = {
    label: p.label, n: s.ok.length, spearman: r2(s.r), p: Number(s.p.toPrecision(2)),
    warmth_median: r1(s.warmth_median), air_mean: r1(p.air.reduce((a, b) => a + b, 0) / p.air.length),
    days: p.days, green_median: r2(median(idx.map((i) => cols.g[i]))),
    cool_minus_warm_green: r2(s.green_cool - s.green_warm),
  };
}
// trees: health on warmest vs coolest fifth
const hOk = S.ok.filter((i) => cols.h[i] !== null);
const hOrder = [...hOk].sort((i, j) => cols.w[i] - cols.w[j]);
const hk = Math.floor(hOrder.length * 0.2);
const healthCool = median(hOrder.slice(0, hk).map((i) => cols.h[i]));
const healthWarm = median(hOrder.slice(-hk).map((i) => cols.h[i]));
const healthR = spearman(hOk.map((i) => cols.h[i]), hOk.map((i) => cols.w[i]));

// key frames among heroes
const heroes = all.filter((i) => cols.hero[i] && cols.w[i] !== null);
const arnhemHeroes = heroes.filter((i) => cols.a[i] === 3);
const hook = arnhemHeroes.reduce((best, i) => (Math.abs(cols.g[i] - 0.4) < Math.abs(cols.g[best] - 0.4) ? i : best), arnhemHeroes[0]);
const coolF = heroes.reduce((b, i) => (cols.w[i] < cols.w[b] ? i : b), heroes[0]);
const warmF = heroes.reduce((b, i) => (cols.w[i] > cols.w[b] ? i : b), heroes[0]);
const greenF = heroes.reduce((b, i) => (cols.g[i] > cols.g[b] ? i : b), heroes[0]);

const cooler = S.r < -0.1 && S.p < 0.05;
const fmt1 = (x) => x.toFixed(1);
const headline = cooler
  ? `Greener streets ran cooler: the coolest fifth of street spots had ${Math.round(S.green_cool * 100)}% green in view, the warmest fifth only ${Math.round(S.green_warm * 100)}%.`
  : `Even on a mild autumn day, street surfaces ran ${fmt1(S.warmth_median)}°C warmer than the air, green or not.`;

// ---------- segments (mock OSM stretches from chunks of rides) ----------
const features = [];
let fi = 0;
const idByKey = new Map();
for (let i = 0; i < N; i++) idByKey.set(cols.a[i] + ":" + cols.t[i], i);
for (const ride of rides) {
  const ai = AREAS.indexOf(ride.area);
  for (let s = 0; s < ride.path.length - 1;) {
    const len = 5 + Math.floor(rnd() * 6);
    const e = Math.min(ride.path.length, s + len);
    if (e - s >= 2) {
      const ids = [];
      for (let k = s; k < e; k++) ids.push(idByKey.get(ai + ":" + ride.timestamps[k]));
      const ws = ids.map((i) => cols.w[i]).filter((v) => v !== null);
      const hs = ids.map((i) => cols.h[i]).filter((v) => v !== null);
      if (ws.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: ride.path.slice(s, e) },
          properties: {
            area: ride.area, name: rnd() < 0.8 ? STREETS[Math.floor(rnd() * STREETS.length)] : null,
            n: ids.length, warmth: r2(median(ws)), green: r2(median(ids.map((i) => cols.g[i]))),
            health: hs.length ? r2(median(hs)) : null, priority: null,
          },
        });
        fi++;
      }
    }
    s = e - 1;
  }
}
{
  const cand = features.filter((f) => f.properties.n >= 4);
  const wr = ranks(cand.map((f) => -f.properties.warmth));
  const gr = ranks(cand.map((f) => f.properties.green));
  const score = cand.map((f, i) => wr[i] + gr[i]);
  const order = cand.map((f, i) => i).sort((i, j) => score[i] - score[j]);
  order.slice(0, 10).forEach((i, rank) => { cand[i].properties.priority = rank + 1; });
}

// ---------- write json ----------
await mkdir(DATA, { recursive: true });
const frames = { areas: AREAS, n: N, ...cols };
const story = {
  mock: true,
  mock_note: "Synthetic data from web/scripts/mock-data.mjs. Not real measurements. Do not publish.",
  generated_at: new Date().toISOString(),
  headline_variant: cooler ? "cooler" : "not_clearly",
  headline,
  overall: {
    spearman: r2(S.r), n: S.ok.length,
    green_coolest20: r2(S.green_cool), green_warmest20: r2(S.green_warm),
    warmth_median: r1(S.warmth_median), warmth_p90: r1(S.warmth_p90),
  },
  areas,
  trees: { show: Math.abs(healthR) > 0.05, health_warm20: r2(healthWarm), health_cool20: r2(healthCool), spearman: r2(healthR) },
  hook_frame: cols.id[hook],
  chapter_frames: { cool: cols.id[coolF], warm: cols.id[warmF], green: cols.id[greenF] },
  priority_count: 10,
  ramp_domain: [-2, 14],
};
await writeFile(path.join(DATA, "frames.json"), JSON.stringify(frames));
await writeFile(path.join(DATA, "rides.json"), JSON.stringify(rides));
await writeFile(path.join(DATA, "segments.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
await writeFile(path.join(DATA, "story.json"), JSON.stringify(story, null, 2));
await writeFile(path.join(DATA, "MOCK_DATA_DO_NOT_COMMIT"), "These files are synthetic (web/scripts/mock-data.mjs). The real pipeline export replaces them.\n");
console.log(`mock json: ${N} frames, ${rides.length} rides, ${features.length} segments, heroes ${heroCounter}, variant ${story.headline_variant}, spearman ${story.overall.spearman}`);

if (!WITH_IMAGES) process.exit(0);

// ---------- images: one synthetic street scene, rendered in three ways ----------
const RAMP = ["#1B1F3B", "#6A2C70", "#E1534A", "#F9C74F", "#FFF6D5"].map((h) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16)));
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const u = (i / 255) * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(u)), f = u - k;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * f);
}
const PLANT = [0x6e, 0xe7, 0xb7], DARK = [0x16, 0x19, 0x1f];

function sceneFor(i) {
  const r = mulberry32(i * 7919 + 13);
  const g = cols.g[i];
  const trees = [];
  const nTrees = Math.round(g * 9);
  for (let k = 0; k < nTrees; k++) {
    const side = k % 2 ? 1 : -1;
    trees.push({ x: side * (0.25 + r() * 0.45), y: 0.18 + r() * 0.3, r: 0.07 + r() * 0.12 * (0.5 + g) });
  }
  const builds = [];
  const nB = 2 + Math.floor(r() * 3);
  for (let k = 0; k < nB; k++) {
    const side = k % 2 ? 1 : -1;
    builds.push({ x0: side > 0 ? 0.18 + r() * 0.2 : -0.9, x1: side > 0 ? 0.9 : -0.18 - r() * 0.2, top: 0.05 + r() * 0.25 });
  }
  return { trees, builds, horizon: 0.45 + r() * 0.06, st: cols.st[i], air: cols.st[i] - (cols.w[i] ?? 5), sunX: r() > 0.5 ? 1 : -1 };
}
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function material(sc, x, y) {
  for (const t of sc.trees) { const dx = x - t.x, dy = y - t.y; if (dx * dx + dy * dy < t.r * t.r) return 1; } // tree
  if (y < sc.horizon) {
    for (const b of sc.builds) if (x > b.x0 && x < b.x1 && y > b.top) return 2; // building
    return 0; // sky
  }
  const half = 0.08 + (y - sc.horizon) * 1.25; // road trapezoid
  if (Math.abs(x) < half) {
    for (const t of sc.trees) { const dx = (x - t.x) * 0.7, dy = y - (t.y + 0.5); if (dx * dx + dy * dy < t.r * t.r * 1.4) return 5; } // shaded road
    return 3;
  }
  return Math.abs(x) > half + 0.22 && sc.trees.length > 3 ? 6 : 4; // grass or pavement
}
function render(i, W, H, mode) {
  const sc = sceneFor(i);
  const out = Buffer.alloc(W * H * 3);
  let o = 0;
  for (let py = 0; py < H; py++) {
    const y = py / H;
    for (let px = 0; px < W; px++) {
      const x = (px - W / 2) / H;
      const m = material(sc, x, y);
      const n = hash(px, py) - 0.5;
      let r, g, b;
      if (mode === "t") {
        let T;
        switch (m) {
          case 0: T = 4 + y * 6; break;
          case 1: T = sc.air - 1.5 + n * 1.2; break;
          case 2: T = sc.air + 2 + (Math.sign(x) === sc.sunX ? 4 : 0) + n; break;
          case 3: T = sc.st + (y - sc.horizon) * 4 + n * 1.5; break;
          case 5: T = sc.air + 0.8 + n; break;
          case 6: T = sc.air + 0.5 + n; break;
          default: T = sc.st - 2.5 + n;
        }
        const v = clamp(Math.round((T / 40) * 255), 0, 255) * 3;
        r = LUT[v]; g = LUT[v + 1]; b = LUT[v + 2];
      } else if (mode === "n") {
        const nd = m === 1 ? 0.72 + n * 0.2 : m === 6 ? 0.55 + n * 0.2 : m === 0 ? 0 : 0.08 + n * 0.08;
        const f = clamp(nd, 0, 1);
        r = DARK[0] + (PLANT[0] - DARK[0]) * f; g = DARK[1] + (PLANT[1] - DARK[1]) * f; b = DARK[2] + (PLANT[2] - DARK[2]) * f;
      } else {
        const j = n * 18;
        switch (m) {
          case 0: r = 168 - y * 60; g = 184 - y * 50; b = 204 - y * 30; break;
          case 1: r = 58 + j; g = 98 + j; b = 52 + j; break;
          case 2: r = 140 + j; g = 118 + j; b = 104 + j; break;
          case 3: r = 78 + j; g = 80 + j; b = 86 + j; break;
          case 5: r = 52 + j; g = 54 + j; b = 60 + j; break;
          case 6: r = 92 + j; g = 136 + j; b = 72 + j; break;
          default: r = 150 + j; g = 148 + j; b = 140 + j;
        }
      }
      out[o++] = r; out[o++] = g; out[o++] = b;
    }
  }
  return out;
}
async function writeImg(file, i, W, H, mode, quality = 60) {
  const buf = render(i, W, H, mode);
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).webp({ quality, effort: 2 }).toFile(file);
}

await rm(FRAMES, { recursive: true, force: true });
for (const d of ["t", "n", "r", "hook"]) await mkdir(path.join(FRAMES, d), { recursive: true });
await writeFile(path.join(FRAMES, "MOCK_DATA_DO_NOT_COMMIT"), "Synthetic images from web/scripts/mock-data.mjs.\n");

const jobs = [];
for (let i = 0; i < N; i++) {
  jobs.push(() => writeImg(path.join(FRAMES, "t", cols.id[i] + ".webp"), i, 160, 120, "t", 55));
  if (cols.hero[i]) {
    jobs.push(() => writeImg(path.join(FRAMES, "n", cols.id[i] + ".webp"), i, 320, 240, "n"));
    jobs.push(() => writeImg(path.join(FRAMES, "r", cols.id[i] + ".webp"), i, 427, 240, "r"));
  }
}
jobs.push(() => writeImg(path.join(FRAMES, "hook", `${story.hook_frame}_t.webp`), hook, 1280, 960, "t", 72));
jobs.push(() => writeImg(path.join(FRAMES, "hook", `${story.hook_frame}_n.webp`), hook, 1280, 960, "n", 72));
jobs.push(() => writeImg(path.join(FRAMES, "hook", `${story.hook_frame}_r.webp`), hook, 1280, 720, "r", 72));

let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: 8 }, async () => { while (next < jobs.length) await jobs[next++](); }));
console.log(`mock images: ${jobs.length} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
