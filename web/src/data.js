// Loads the pipeline output (docs/DATA_CONTRACT.md) and turns it into columnar typed arrays.
// Frames are re-ordered by place, then time, so every place is one contiguous range and
// its columns can be handed to deck.gl as zero-copy subarray views.

import { fillColors, setDomain, rgbOf } from "./heat.js";

const BASE = import.meta.env.BASE_URL;
export const dataUrl = (p) => `${BASE}data/${p}`;
export const frameUrl = (kind, id) => `${BASE}frames/${kind}/${id}.webp`;
export const hookUrl = (id, kind) => `${BASE}frames/hook/${id}_${kind}.webp`;

const GAP = 60; // seconds: a longer pause starts a new ride (contract rule)
const KEEP_GAP = 4; // seconds a pause is shortened to, so the route draws without dead time

async function getJson(name) {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

export async function loadAll() {
  const [story, raw, rides, segments] = await Promise.all([
    getJson("story.json"),
    getJson("frames.json"),
    getJson("rides.json"),
    getJson("segments.geojson"),
  ]);
  setDomain(story.ramp_domain || [-2, 14]);
  const frames = buildFrames(raw);
  const rideIndex = buildRides(rides, frames);
  const segs = buildSegments(segments);
  return { story, frames, rides: rideIndex, segments: segs };
}

function buildFrames(raw) {
  const n = raw.n ?? raw.id.length;
  const areas = raw.areas;
  // order by place, then time (one pass sort on an index array)
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((i, j) => raw.a[i] - raw.a[j] || raw.t[i] - raw.t[j]);

  const id = new Array(n);
  const a = new Uint8Array(n);
  const pos = new Float32Array(n * 2);
  const t = new Float64Array(n);
  const tc = new Float64Array(n); // ride clock with long pauses squeezed out
  const w = new Float32Array(n);
  const st = new Float32Array(n);
  const g = new Float32Array(n);
  const h = new Float32Array(n);
  const hero = new Uint8Array(n);
  const index = new Map();

  for (let k = 0; k < n; k++) {
    const i = order[k];
    id[k] = raw.id[i];
    a[k] = raw.a[i];
    pos[2 * k] = raw.lon[i];
    pos[2 * k + 1] = raw.lat[i];
    t[k] = raw.t[i];
    w[k] = raw.w[i] == null ? NaN : raw.w[i];
    st[k] = raw.st[i] == null ? NaN : raw.st[i];
    g[k] = raw.g[i] == null ? NaN : raw.g[i];
    h[k] = raw.h[i] == null ? NaN : raw.h[i];
    hero[k] = raw.hero[i] ? 1 : 0;
    index.set(id[k], k);
  }

  // contiguous ranges, bounds, and squeezed time per place (the real t is already squeezed; this is a no-op then)
  const ranges = areas.map(() => ({ start: 0, end: 0, bounds: null, gapT: [], gapCum: [], duration: 0 }));
  for (let ai = 0, k = 0; ai < areas.length; ai++) {
    const r = ranges[ai];
    r.start = k;
    let cum = 0;
    while (k < n && a[k] === ai) {
      if (k > r.start) {
        const d = t[k] - t[k - 1];
        if (d > GAP) {
          cum += d - KEEP_GAP;
          r.gapT.push(t[k]);
          r.gapCum.push(cum);
        }
      }
      tc[k] = t[k] - cum - t[r.start];
      k++;
    }
    r.end = k;
    r.bounds = r.end > r.start ? robustBounds(pos, r.start, r.end) : null;
    r.t0 = r.end > r.start ? t[r.start] : 0;
    r.duration = r.end > r.start ? tc[r.end - 1] : 0;
  }

  const colors = fillColors(w, new Uint8Array(n * 4));
  return { n, areas, id, a, pos, t, tc, w, st, g, h, hero, index, ranges, colors };
}

/** Camera bounds of one place: 1st to 99th percentile, so a stray GPS fix cannot zoom the map out. */
function robustBounds(pos, start, end) {
  const m = end - start;
  const xs = new Float32Array(m), ys = new Float32Array(m);
  for (let i = 0; i < m; i++) { xs[i] = pos[2 * (start + i)]; ys[i] = pos[2 * (start + i) + 1]; }
  xs.sort(); ys.sort();
  const lo = Math.floor((m - 1) * 0.01), hi = Math.ceil((m - 1) * 0.99);
  return [[xs[lo], ys[lo]], [xs[hi], ys[hi]]];
}

/** Squeeze a raw timestamp of place `ai` onto the same clock as frames.tc. */
function squeeze(r, ts) {
  const gt = r.gapT;
  let lo = 0, hi = gt.length - 1, cum = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gt[mid] <= ts) { cum = r.gapCum[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ts - cum - r.t0;
}

function buildRides(rides, frames) {
  const byArea = frames.areas.map(() => []);
  for (const ride of rides) {
    const ai = frames.areas.indexOf(ride.area);
    if (ai < 0 || !ride.path || ride.path.length < 2) continue;
    const r = frames.ranges[ai];
    const m = ride.path.length;
    const ts = new Array(m);
    const colors = new Array(m);
    for (let i = 0; i < m; i++) {
      ts[i] = squeeze(r, ride.timestamps[i]);
      const wv = ride.w ? ride.w[i] : null;
      colors[i] = rgbOf(wv == null ? NaN : wv);
    }
    byArea[ai].push({ path: ride.path, ts, colors, day: ride.day });
  }
  return byArea;
}

function buildSegments(fc) {
  const feats = (fc && fc.features) || [];
  const priority = feats
    .filter((f) => f.properties && f.properties.priority != null)
    .sort((x, y) => x.properties.priority - y.properties.priority);
  for (const f of priority) {
    const c = f.geometry.coordinates;
    f._path = c;
    f._mid = c[(c.length / 2) | 0];
    f._rgb = rgbOf(f.properties.warmth);
  }
  return { all: feats, priority };
}

/** Lower-bound search on the squeezed clock inside [start, end). */
export function countUntil(frames, ai, time) {
  const r = frames.ranges[ai];
  let lo = r.start, hi = r.end;
  const tc = frames.tc;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tc[mid] <= time) lo = mid + 1; else hi = mid;
  }
  return lo - r.start;
}
