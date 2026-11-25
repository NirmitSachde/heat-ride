// Copy templates and the scroll steps. Every number on screen comes from story.json
// (or from the data files) through {placeholders}; nothing numeric is typed into the copy.
// Copy can differ by story.headline_variant: "cooler" or "not_clearly".

import scrollama from "scrollama";
import { CHAPTERS } from "./chapters.js";

const MINUS = "−";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const FMT = {
  deg: (v) => `${v < 0 ? MINUS : ""}${Math.abs(+v).toFixed(1)}°C`,
  pct: (v) => `${Math.round(+v * 100)}%`,
  int: (v) => Math.round(+v).toLocaleString("en-US"),
  n2: (v) => `${v < 0 ? MINUS : ""}${Math.abs(+v).toFixed(2)}`,
  word: (v) => WORDS[v] || String(v),
  Word: (v) => { const s = WORDS[v] || String(v); return s[0].toUpperCase() + s.slice(1); },
  pp: (v) => `${Math.round(Math.abs(+v) * 100)} percentage points`,
  abs: (v) => `${Math.abs(+v).toFixed(1)}°C`,
  abs2: (v) => Math.abs(+v).toFixed(2),
  // relative warmth in words: "0.3°C warmer" / "0.3°C cooler" / "about average"
  rel: (v) => (Math.abs(+v) < 0.05 ? "about average" : `${Math.abs(+v).toFixed(1)}°C ${+v > 0 ? "warmer" : "cooler"}`),
};

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

function lookup(ctx, path) {
  let o = ctx;
  for (const k of path.split(".")) {
    if (o == null) return undefined;
    o = o[k];
  }
  return o;
}

/** Fill "{a.b|fmt}" placeholders (values are HTML-escaped). Missing values render as "n/a". */
export function fill(tpl, ctx) {
  return tpl.replace(/\{([\w.]+)(?:\|(\w+))?\}/g, (_, path, f) => {
    const v = lookup(ctx, path);
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "n/a";
    return esc(f && FMT[f] ? FMT[f](v) : String(v));
  });
}

export function linkWords(r, p) {
  const ar = Math.abs(r);
  if (ar < 0.1 || (p != null && p >= 0.05)) return "No clear pattern. Green and warmth barely moved together here.";
  const strength = ar < 0.3 ? "a weak link" : ar < 0.5 ? "a clear link" : "a strong link";
  return r < 0 ? `Greener spots ran cooler: ${strength}.` : `Greener spots ran warmer here: ${strength}.`;
}
export const scoreWords = (r) => `Link score ${FMT.n2(r)} on a scale from ${MINUS}1 to 1 (0 means no link).`;
const joinWords = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "0.23°C cooler" / "0.77°C warmer" for a change in warmth. */
const coolerWarmer = (v) => `${Math.abs(+v).toFixed(2)}°C ${+v < 0 ? "cooler" : "warmer"}`;

/** One plain sentence per place from its model (falls back to the rank link if there is no model). */
export function placeWords(a) {
  const m = a && a.model;
  if (!m || m.per10_green == null) return { sentence: linkWords(a.spearman, a.p), score: scoreWords(a.spearman) };
  const v = m.per10_green;
  const ci = m.per10_green_ci || [];
  let range = "";
  if (ci.length === 2) {
    range = ci[0] < 0 && ci[1] > 0
      ? `Likely range: from ${coolerWarmer(ci[0])} to ${coolerWarmer(ci[1])}, so no clear difference.`
      : `Likely range: ${Math.abs(ci[0] < 0 ? ci[1] : ci[0]).toFixed(2)} to ${Math.abs(ci[0] < 0 ? ci[0] : ci[1]).toFixed(2)}°C ${ci[0] < 0 ? "cooler" : "warmer"}.`;
  }
  if (m.green_effect_clear) {
    return { sentence: `For every 10 more percent of the view that is green, streets ran about ${coolerWarmer(v)}.`, score: range };
  }
  return { sentence: "No clear difference once we account for which way the bike faced the sun.", score: range };
}
const isClear = (a) => a && Math.abs(a.spearman) >= 0.1 && (a.p == null || a.p < 0.05);

function dayList(days) {
  const ds = [...new Set(days || [])].sort().map((d) => new Date(d + "T12:00:00Z"));
  if (!ds.length) return "";
  const parts = ds.map((d) => ({ day: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear() }));
  const sameMonth = parts.every((p) => p.m === parts[0].m && p.y === parts[0].y);
  if (sameMonth) {
    const nums = parts.map((p) => p.day);
    const joined = nums.length > 1 ? `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}` : `${nums[0]}`;
    return `${joined} ${MONTHS[parts[0].m]} ${parts[0].y}`;
  }
  const items = parts.map((p) => `${p.day} ${MONTHS[p.m]}`);
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]} ${parts[parts.length - 1].y}`;
}

function season(days) {
  const ds = days.map((d) => new Date(d + "T12:00:00Z")).sort((a, b) => a - b);
  if (!ds.length) return "2025";
  const m = ds[0].getUTCMonth();
  const name = m >= 8 && m <= 10 ? "autumn" : m >= 5 && m <= 7 ? "summer" : m >= 2 && m <= 4 ? "spring" : "winter";
  return `${name} ${ds[0].getUTCFullYear()}`;
}

/** Everything the templates can reference. */
export function buildContext(story, frames, rideArea = "Arnhem") {
  const areaNames = Object.keys(story.areas || {});
  const allDays = areaNames.flatMap((a) => story.areas[a].days || []);
  const variant = story.headline_variant === "not_clearly" ? "not_clearly" : "cooler";
  const exampleKey = variant === "cooler" ? "cool" : "warm";
  const frameInfo = (id) => {
    const i = frames.index.get(id);
    if (i == null) return null;
    return { i, id, w: frames.w[i], g: frames.g[i], st: frames.st[i], area: frames.areas[frames.a[i]] };
  };
  const cf = story.chapter_frames || {};
  const ride = { name: rideArea, ...(story.areas[rideArea] || {}) };
  ride.daysText = dayList(ride.days);
  ride.dayCount = (ride.days || []).length;
  const hasModel = areaNames.some((a) => story.areas[a].model);
  const clearOf = (a) => (hasModel ? !!(story.areas[a].model && story.areas[a].model.green_effect_clear) : isClear(story.areas[a]));
  const coolerOf = (a) => clearOf(a) && (hasModel ? story.areas[a].model.per10_green < 0 : story.areas[a].spearman < 0);
  const clearCount = areaNames.filter(clearOf).length;
  const coolerCount = areaNames.filter(coolerOf).length;
  const labelOf = (a) => `the ${story.areas[a].label || a}`;
  const clearLabels = joinWords(areaNames.filter(coolerOf).map(labelOf));
  const unclearLabels = joinWords(areaNames.filter((a) => !coolerOf(a)).map(labelOf));
  const t = story.trees || {};
  // places where the tree list ranks streets (story.json.priority_areas), and the others
  const prioNames = Array.isArray(story.priority_areas) && story.priority_areas.length ? story.priority_areas : areaNames;
  const prioLabels = joinWords(prioNames.filter((a) => story.areas[a]).map(labelOf));
  const nonPrioLabels = joinWords(areaNames.filter((a) => !prioNames.includes(a)).map(labelOf));
  // the subhead is composed here from the per-place models, so its wording follows the story's style
  const clearPer10 = areaNames.filter(coolerOf).map((a) => story.areas[a].model?.per10_green).filter((v) => v != null);
  let subhead = story.subhead || null;
  if (hasModel && clearPer10.length) {
    const avg = clearPer10.reduce((x, y) => x + y, 0) / clearPer10.length;
    subhead = `In ${clearLabels}, for every 10 more percent of the view that is green, streets ran about ${Math.abs(avg).toFixed(2)}°C cooler.`
      + (unclearLabels ? ` In ${unclearLabels}, once we account for which way the bike faced the sun, green made no clear difference.` : "")
      + (variant === "not_clearly" ? " It was autumn: shade does most of its work in summer." : "");
  }
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mac = /Mac|iPhone|iPad/i.test((nav.userAgentData && nav.userAgentData.platform) || nav.platform || "");
  const zoomHint = touch
    ? "Use two fingers to move and zoom the map."
    : `Drag to move the map. Hold ${mac ? "Cmd" : "Ctrl"} and scroll to zoom.`;
  return {
    ...story,
    variant,
    exampleKey,
    places: { count: areaNames.length, season: season(allDays), smallest: areaNames[0], largest: areaNames[areaNames.length - 1] },
    ride,
    frames: { n: frames.n },
    frame: { cool: frameInfo(cf.cool), warm: frameInfo(cf.warm), green: frameInfo(cf.green), example: frameInfo(cf[exampleKey]) },
    verdict: { clear: clearCount, cooler: coolerCount, coolerLabels: clearLabels, otherLabels: unclearLabels, otherCount: areaNames.length - coolerCount },
    subhead,
    zoomHint,
    tree: { labels: prioLabels, othersSentence: nonPrioLabels ? ` In ${nonPrioLabels} we found no clear link, so we don't rank streets there.` : "" },
    dark: (() => { let k = 0; for (let i = 0; i < frames.n; i++) if (frames.g[i] !== frames.g[i]) k++; return { n: k, pct: frames.n ? k / frames.n : 0 }; })(),
    treesDiff: t.health_cool20 != null && t.health_warm20 != null ? t.health_cool20 - t.health_warm20 : null,
  };
}

// --------------------------------------------------------------- copy
// Each entry: { kicker?, title?, body } where any field may be a string or { cooler, not_clearly }.
export const COPY = {
  "hook.intro": {
    kicker: "Street Skin",
    title: "What a bicycle sees beyond the visible",
    body: "In {places.season}, a bicycle rode through {places.count|word} Dutch places carrying three cameras. One of them saw heat.",
  },
  "hook.headline": {
    kicker: "What we found",
    title: "{headline}",
    body: "{subhead}",
    note: "Every °C in this story is on the thermal camera's own scale and compared with other streets ridden in the same place and hour. It is not an air temperature.",
  },
  "beyond.rgb": { kicker: "Three ways to see one street", body: "This is a normal photo. It shows the street the way your eyes do." },
  "beyond.nir": { body: "This is near-infrared, light our eyes can't see. Healthy leaves reflect lots of it, so plants glow green." },
  "beyond.thermal": { body: "This is thermal. It sees heat: bright is warm, dark is cool. Walls, cars and pavement in the sun glow. Trees and shade stay dark." },
  "beyond.try": { body: "Drag the two handles to compare the three views yourself." },
  "ride.intro": {
    kicker: "The ride",
    title: "{ride.name}, the {ride.label}",
    body: "The line draws itself in the order the bicycle rode it, on {ride.daysText}. That is {ride.n|int} photo spots.",
  },
  "ride.color": {
    body: "Each dot is one photo spot. Yellow means the street's surfaces ran warmer than the other streets ridden in the same hour. Purple means cooler.",
    note: "{measure_note}",
  },
  "question.intro": {
    kicker: "The question",
    title: "Do greener streets run cooler?",
    body: "Each dot is one photo, {overall.n|int} with a clear view of the plants. Left to right: how much of the view is green. Bottom to top: how much warmer or cooler the street's surfaces were than the other streets ridden that hour.",
  },
  "question.answer": {
    title: { cooler: "Yes, mostly.", not_clearly: "Only a little." },
    body: {
      cooler: "The line follows the middle of the dots, and it slopes down: as the view gets greener, the street runs cooler. The greenest fifth of spots ran {overall.warmth_greenest20|rel} than the street average. The least green fifth ran {overall.warmth_leastgreen20|rel}.",
      not_clearly: "The line follows the middle of the dots, and it barely slopes. The greenest fifth of spots ran {overall.warmth_greenest20|rel} than the street average, the least green fifth {overall.warmth_leastgreen20|rel}. A small gap.",
    },
  },
  "question.spread": {
    body: {
      cooler: "For scale: one spot in ten ran more than {overall.warmth_p90|abs} warmer than the average street that hour, and one in ten more than {overall.warmth_p10|abs} cooler. Green explains part of that.",
      not_clearly: "For scale: one spot in ten ran more than {overall.warmth_p90|abs} warmer than the average street that hour, and one in ten more than {overall.warmth_p10|abs} cooler. Green moves the line far less than that. Sun, walls and traffic matter more in autumn.",
    },
  },
  "question.hover": { body: "Your turn: point at any dot, or tap it, to see its photo. It lights up on the map too." },
  "places.intro": {
    kicker: "Four places",
    title: "From a village to a big city",
    body: "The same chart, {places.count|word} times. Smallest place first, biggest last. Does the pattern hold?",
  },
  "places.rank": {
    kicker: "Which place was warmest?",
    title: "We can't say.",
    body: "Each place was ridden on different days, with a camera whose absolute readings drift. So we only compare streets within the same place and hour, never one place with another.",
  },
  "places.verdict": {
    body: {
      cooler: "Greener streets ran clearly cooler in {verdict.cooler|word} of the {places.count|word} places. The pattern is not a big-city quirk.",
      not_clearly: "Green came with clearly cooler streets in {verdict.cooler|word} of the {places.count|word} places: {verdict.coolerLabels}. In {verdict.otherLabels}, once we account for which way the bike faced the sun, green made no clear difference.",
    },
  },
  "trees.body": {
    kicker: "Tired trees",
    title: "Are plants on hot streets less healthy?",
    body: "Near-infrared also shows how healthy plants are. On the warmest fifth of streets plants scored {trees.health_warm20}, against {trees.health_cool20} on the coolest fifth.",
  },
  "sowhat.body": {
    kicker: "So what",
    title: "Where a tree would likely help",
    body: "In {tree.labels}, where greener streets ran measurably cooler, these {priority_count|int} stretches were among the warmest and barest.{tree.othersSentence}",
  },
  "sowhat.list": { body: "Pick a stretch in the list to fly to it. Treat them as places worth a closer look, not a planting plan." },
  "explore.body": {
    kicker: "Explore",
    title: "Your turn",
    body: "Pick a place, then tap any dot to see what the cameras saw. Ringed spots have all three photos. {zoomHint}",
  },
};

const pick = (v, variant) => (v == null ? null : typeof v === "string" ? v : v[variant] ?? v.cooler);

export function renderCopy(key, ctx) {
  const c = COPY[key];
  if (!c) return "";
  const kicker = pick(c.kicker, ctx.variant);
  const title = pick(c.title, ctx.variant);
  const body = pick(c.body, ctx.variant);
  const note = pick(c.note, ctx.variant);
  const noteText = note ? fill(note, ctx) : "";
  const noteHtml = noteText && noteText !== "n/a" ? `<p class="card-note">${noteText}</p>` : "";
  // a part whose only content is a missing value is left out (e.g. an older story.json without subhead)
  const part = (tpl, tag, cls) => {
    if (!tpl) return "";
    const txt = fill(tpl, ctx);
    return txt === "n/a" ? "" : `<${tag} class="${cls}">${txt}</${tag}>`;
  };
  return `${part(kicker, "p", "kicker")}${part(title, "h2", "card-title")}${part(body, "p", "card-body")}${noteHtml}`;
}

/** Build the step DOM from CHAPTERS. Returns the list of active chapters. */
export function buildSteps(container, story, ctx) {
  const active = CHAPTERS.filter((ch) => !ch.when || ch.when(story)).map((ch) => ({
    ...ch,
    steps: ch.steps.filter((st) => !st.when || st.when(story, ctx)),
  }));
  const html = [];
  active.forEach((ch, ci) => {
    ch.steps.forEach((st, si) => {
      const dockable = ["split", "list", "chart", "explore"].includes(ch.layout);
      const cls = ["step", `step-${ch.id}`, dockable ? "dockable" : "", si === 0 ? "first" : "", st.tall ? "tall" : "", ch.id === "hook" && si === 0 ? "hook-first" : ""].filter(Boolean).join(" ");
      const idAttr = ch.id === "explore" ? ' id="explore-anchor"' : "";
      html.push(`<div class="${cls}" data-ch="${ci}" data-st="${si}"${idAttr}><div class="card" data-layout="${ch.layout}">${renderCopy(st.copy, ctx)}</div></div>`);
    });
  });
  container.innerHTML = html.join("");
  return active;
}

export function initScroll({ onStep, onProgress }) {
  const scroller = scrollama();
  scroller
    .setup({ step: ".step", offset: 0.6, progress: true })
    .onStepEnter(({ element, direction }) => onStep(+element.dataset.ch, +element.dataset.st, direction, element))
    .onStepProgress(({ element, progress }) => onProgress(+element.dataset.ch, +element.dataset.st, progress));
  return scroller;
}

// --------------------------------------------------------------- how this was made
export function renderHow(ctx) {
  const areaRows = Object.entries(ctx.areas || {})
    .map(([name, a]) => `<li><b>${name}</b> (${a.label}) · ${fill("{n|int} photo spots · {days}", { n: a.n, days: dayList(a.days) })}</li>`)
    .join("");
  return `
  <div class="how-inner">
    <p class="kicker">How this was made</p>
    <h2>Data, method, limits, credits</h2>

    <h3>Data</h3>
    <p>${fill("The photos come from the Spectrascapes dataset: a bicycle carrying a normal camera, a near-infrared camera and a thermal camera, riding through {places.count|word} Dutch places in {places.season}. This story uses the {frames.n|int} photo spots with a usable GPS position.", ctx)}</p>
    <ul class="how-areas">${areaRows}</ul>
    <p>Air temperature for each hour of each ride day comes from the Open-Meteo historical weather archive. Street stretches come from OpenStreetMap.</p>

    <h3>Method</h3>
    <ul>
      <li><b>Green in view:</b> the share of each near-infrared photo where plants reflect strongly (a vegetation index, NDVI, above 0.3). ${fill("{dark.n|int} photos ({dark.pct|pct}) were too dark to measure plants and are left out of the green charts.", ctx)}</li>
      <li><b>Warmth:</b> ${ctx.measure_note ? fill("{measure_note}", ctx) : "how warm the street's surfaces were, compared with the other streets ridden in the same place during the same hour."}</li>
      <li><b>The line in the charts</b> follows the middle (median) warmth for each slice of green, only where a slice holds enough photos.</li>
      <li><b>The sentence for each place</b> comes from a model fitted separately for each place: warmth explained by green in view, by riding toward the sun and by open sky. It gives the change in warmth for every 10 more percent of the view that is green. The likely range comes from resampling whole streets many times (a 95% bootstrap interval). If that range includes zero, we call it "no clear difference".</li>
      <li><b>Where a tree would likely help:</b> named street stretches with 4 or more photos, at least 1.5°C warmer than their hour, with less green than the place's median and below 25%, only in places where green had a clear cooling effect. They are ranked by warmth and bareness together, within each place.</li>
      <li><b>Code and data:</b> <a href="https://github.com/NirmitSachde/street-skin" rel="noopener">github.com/NirmitSachde/street-skin</a></li>
    </ul>

    <h3>Limits</h3>
    <ul>
      <li>Thermal values are 8-bit photos mapped from 0 to 40°C. Read them as relative surface warmth, not lab-grade temperature.</li>
      <li>${ctx.overall && ctx.overall.camera_offset_median != null ? fill("The thermal camera reads about {overall.camera_offset_median|abs} above the air, even under full cloud. So this story never compares streets with the air, only with each other.", ctx) : "This story compares streets with each other, not with the air."}</li>
      <li>The thermal camera points higher than the other two. It mostly sees walls, trees and cars, and only a little pavement.</li>
      <li>The rides were in autumn, around midday, one or two days per place. Some photos were too dark to measure plants, mostly on the first day in Arnhem.</li>
      <li>Color photos can show people and license plates. Only a small set of hand-checked photos is published, small and blurred where needed.</li>
      <li>Findings are shown per street stretch, never per person or per house.</li>
      <li>Delft has many missing GPS points.</li>
    </ul>

    <h3>Credits</h3>
    <ul class="credits">
      <li>Spectrascapes: Gupta, Timmermans, Biljecki, Uijlenhoet (2026). <a href="https://doi.org/10.5281/zenodo.19440802" rel="noopener">doi.org/10.5281/zenodo.19440802</a>. CC BY 4.0.</li>
      <li>Streets: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a>, ODbL.</li>
      <li>Weather: <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a> historical archive, CC BY 4.0.</li>
      <li>Basemap: © <a href="https://carto.com/attributions" rel="noopener">CARTO</a>.</li>
      <li>Built with MapLibre GL, deck.gl, D3, p5.js and scrollama. Type: Fraunces, Inter, JetBrains Mono.</li>
    </ul>
  </div>`;
}
