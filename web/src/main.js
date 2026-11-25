import "@fontsource/fraunces/latin-400.css";
import "@fontsource/fraunces/latin-600.css";
import "@fontsource/fraunces/latin-400-italic.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./style.css";

import { loadAll, frameUrl, hookUrl } from "./data.js";
import { buildContext, buildSteps, initScroll, renderHow, placeWords } from "./story.js";
import { createSlider } from "./slider.js";
import { playRibbon } from "./sketch.js";
import { onTick, reducedMotion } from "./clock.js";
import { cssGradient, getDomain, cssOf } from "./heat.js";

const params = new URLSearchParams(location.search);
const AUTOPLAY = params.get("autoplay") === "1";
const AUTOPLAY_SECS = Math.max(10, +(params.get("secs") || 60));

const $ = (s, r = document) => r.querySelector(s);
const stage = $("#stage");
// "compact" = phones and portrait tablets: panels stack and step text moves into the dock
const phoneMQ = matchMedia("(max-width: 900px)");
let phone = phoneMQ.matches;
phoneMQ.addEventListener("change", (e) => { phone = e.matches; });
const isPhone = () => phone;

if (AUTOPLAY) document.documentElement.classList.add("autoplay");
document.documentElement.classList.add("intro"); // story text stays hidden until the ribbon has gone
if (reducedMotion) document.documentElement.classList.add("reduced-motion");

const fmtDeg = (v) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}°C`;
const fmtRel = (v) => (Math.abs(v) < 0.05 ? "about average" : `${Math.abs(v).toFixed(1)}°C ${v > 0 ? "warmer" : "cooler"}`);
const fmtPct = (v) => `${Math.round(v * 100)}%`;

async function main() {
  let model;
  try {
    model = await loadAll();
  } catch (err) {
    console.warn(err);
    $("#steps").innerHTML = `<div class="step"><div class="card"><h2 class="card-title">The data has not landed yet.</h2><p class="card-body">Run <code>npm run mock</code> for mock data, or the pipeline export for the real thing.</p></div></div>`;
    $("#ribbon")?.remove();
    document.documentElement.classList.remove("intro");
    return;
  }
  const { story, frames, segments } = model;
  const ctx = buildContext(story, frames, "Arnhem");

  if (story.mock) {
    const b = $("#mock-badge");
    b.hidden = false;
    b.title = story.mock_note || "Synthetic data";
  }

  // ---- static content ----
  const active = buildSteps($("#steps"), story, ctx);
  $("#how").innerHTML = renderHow(ctx);
  const [lo, hi] = getDomain();
  $(".legend-bar").style.background = cssGradient();
  $(".legend .lo").textContent = lo < 0 ? `${Math.abs(lo)}°C cooler` : fmtDeg(lo);
  $(".legend .hi").textContent = hi > 0 ? `${hi}°C warmer` : fmtDeg(hi);
  const stopAt = Math.max(Math.abs(lo), Math.abs(hi));
  $(".legend-note").innerHTML = `<span class="note-long">Colors stop at ${stopAt}°C either way; the charts run further. Streets are only compared within one place and hour, so places can't be ranked.</span><span class="note-short">Colors stop at ${stopAt}°C either way. Places can't be ranked against each other.</span>`;

  // ---- hero slider (hook + chapter 1) ----
  const hero = createSlider($("#hero-slider"), { handles: false });
  const hookId = story.hook_frame;
  const hookIsHero = hookId && frames.index.has(hookId);
  // large hook files first, then the regular hero files, then (thermal only) the thumbnail
  hero.setFrame({
    r: hookId ? [hookUrl(hookId, "r"), frameUrl("r", hookId)] : null,
    n: hookId ? [hookUrl(hookId, "n"), frameUrl("n", hookId)] : null,
    t: hookId ? [hookUrl(hookId, "t"), frameUrl("t", hookId)] : null,
    alt: hookIsHero ? `a street in ${frames.areas[frames.a[frames.index.get(hookId)]]}` : "a street",
    eager: true,
  });
  hero.set(0, 0);

  // ---- ribbon intro ----
  const labels = Object.fromEntries(Object.entries(story.areas || {}).map(([k, v]) => [k, v.label]));
  const ribbonDone = new Promise((resolve) => {
    playRibbon($("#ribbon"), frames, { labels, autoplay: AUTOPLAY, onDone: resolve });
  });
  ribbonDone.then(() => document.documentElement.classList.remove("intro"));

  // ---- lazy modules: the map (maplibre + deck.gl) and charts (d3) ----
  let mapApi = null;
  let pending = null;
  const mapReady = import("./map.js").then(({ createMap }) => {
    mapApi = createMap($("#map"), model, { isPhone, onPick: openDetail });
    if (pending) { applyStep(pending.ci, pending.si, true); pending = null; }
    return mapApi;
  });

  let chartsMod = null;
  let prep = null;
  let scatter = null;
  let multiplesBuilt = false;
  let treesBuilt = false;
  const chartsReady = import("./charts.js").then((m) => {
    chartsMod = m;
    prep = m.prepare(frames);
    return m;
  });

  function ensureCharts(ch, st) {
    if (!chartsMod) { chartsReady.then(() => ensureCharts(ch, st)); return; }
    if (ch.chart === "scatter") {
      if (!scatter) {
        scatter = chartsMod.createScatter($("#scatter"), $("#scatter-tip"), model, prep, { onHover: onChartHover, isPhone });
      }
      scatter.setState(st.chartState || {});
      scatter.setFixed(highlightOf(st));
    } else if (ch.chart === "multiples" && !multiplesBuilt) {
      multiplesBuilt = true;
      const captions = {};
      for (const [name, a] of Object.entries(story.areas || {})) {
        captions[name] = { label: a.label, ...placeWords(a) };
      }
      chartsMod.createMultiples($("#multiples"), model, prep, captions, { isPhone });
    } else if (ch.chart === "trees" && !treesBuilt) {
      treesBuilt = true;
      const t = story.trees || {};
      const words = t.health_warm20 < t.health_cool20
        ? "Plants on the warmest streets look a little tired."
        : "Plants on the warmest streets looked just as healthy.";
      chartsMod.createTrees($("#trees"), t, words);
    }
  }

  // ---- priority list ----
  const list = $("#priority-list");
  list.innerHTML = segments.priority
    .map((f, k) => {
      const p = f.properties;
      return `<li><button type="button" data-k="${k}">
        <span class="pr-rank">${p.priority}</span>
        <span class="pr-name">${p.name || "Unnamed street"}<small>${p.area} · ${p.n} photo${p.n === 1 ? "" : "s"}</small></span>
        <span class="pr-stats"><b><span class="sw" style="background:${cssOf(p.warmth)}"></span>${fmtRel(p.warmth)}</b><i>${p.green == null ? "green n/a" : `${fmtPct(p.green)} green`}</i></span>
      </button></li>`;
    })
    .join("");
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || !mapApi) return;
    focusSegment(segments.priority[+b.dataset.k]);
  });
  function focusSegment(f) {
    mapApi.flyToSegment(f, "list");
    for (const li of list.querySelectorAll("button")) li.classList.toggle("on", segments.priority[+li.dataset.k] === f);
  }

  // ---- explore switcher ----
  let exploreArea = "Arnhem";
  const sw = $(".switcher");
  sw.innerHTML = ["Middelbeers", "Oirschot", "Delft", "Arnhem"]
    .filter((a) => frames.areas.includes(a))
    .map((a) => `<button type="button" data-area="${a}" aria-pressed="${a === exploreArea}">${a}<small>${labels[a] || ""}</small></button>`)
    .join("");
  sw.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-area]");
    if (!b || !mapApi) return;
    exploreArea = b.dataset.area;
    for (const x of sw.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    const ch = active[current.ci];
    mapApi.apply(ch, ch.steps[current.si], { exploreArea });
    mapApi.moveCamera({ area: exploreArea }, "explore");
    closeDetail();
  });

  // ---- detail panel (explore) ----
  const detail = $("#detail");
  let detailSlider = null;
  function openDetail(i) {
    if (!detailSlider) detailSlider = createSlider($(".detail-slider", detail), { handles: true, compact: true });
    const id = frames.id[i];
    const isHero = frames.hero[i] === 1;
    const area = frames.areas[frames.a[i]];
    detailSlider.setFrame({
      r: isHero ? frameUrl("r", id) : null,
      n: isHero ? frameUrl("n", id) : null,
      t: frameUrl("t", id),
      alt: `a street in ${area}`,
    });
    if (isHero) detailSlider.set(0.34, 0.67);
    detailSlider.showHandles(true);
    const w = frames.w[i], g = frames.g[i], h = frames.h[i];
    $(".detail-stats", detail).innerHTML = `
      <div><dt>Place</dt><dd>${area}</dd></div>
      <div><dt>Compared with other streets that hour</dt><dd><span class="sw" style="background:${cssOf(w)}"></span>${w === w ? fmtRel(w) : "unknown"}</dd></div>
      <div><dt>Green in view</dt><dd class="plant">${g === g ? fmtPct(g) : "too dark to measure"}</dd></div>
      ${h === h ? `<div><dt>Plant health score</dt><dd>${h.toFixed(2)}</dd></div>` : ""}`;
    detail.hidden = false;
    document.documentElement.classList.add("detail-open");
    mapApi && mapApi.setHighlight(i);
    $(".detail-close", detail).focus({ preventScroll: true });
  }
  function closeDetail() {
    if (detail.hidden) return;
    detail.hidden = true;
    document.documentElement.classList.remove("detail-open");
    mapApi && mapApi.setHighlight(null);
  }
  $(".detail-close", detail).addEventListener("click", closeDetail);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

  // ---- chart hover: highlight on the map ----
  let lastHoverArea = -1;
  function onChartHover(i) {
    if (!mapApi) return;
    if (i < 0) { mapApi.setHighlight(highlightOf(active[current.ci].steps[current.si])); return; }
    mapApi.setHighlight(i);
    const ai = frames.a[i];
    if (ai !== lastHoverArea) {
      lastHoverArea = ai;
      mapApi.focusFrame(i, "split");
    }
  }

  function highlightOf(st) {
    if (!st || !st.highlight) return -1;
    const key = st.highlight === "@example" ? ctx.exampleKey : st.highlight;
    const id = (story.chapter_frames || {})[key] || key;
    const i = frames.index.get(id);
    return i == null ? -1 : i;
  }

  // ---- steps ----
  let current = { ci: 0, si: 0 };
  let activeEl = null;
  let interactiveNow = false;
  let ranksNow = false;
  function applyStep(ci, si, instant = false) {
    const ch = active[ci];
    const st = ch.steps[si];
    current = { ci, si };
    stage.dataset.layout = ch.layout;
    stage.dataset.chapter = ch.id;
    stage.classList.toggle("show-legend", !!ch.legend);
    if (st.slider) hero.set(st.slider[0], st.slider[1], !instant);
    hero.showHandles(!!(st.handles ?? ch.sliderHandles) && !AUTOPLAY);
    if (ci > 0 || si > 0) document.documentElement.classList.add("cue-off");
    if (ch.id !== "explore") closeDetail();
    if (ch.chart) ensureCharts(ch, st);

    if (!mapApi) { pending = { ci, si }; return; }
    if (ch.camera?.area === "Arnhem" && ch.id === "question") lastHoverArea = frames.areas.indexOf("Arnhem");
    mapApi.apply(ch, st, { instant, exploreArea });
    const inter = !!ch.interactive && !AUTOPLAY;
    if (inter !== interactiveNow) { interactiveNow = inter; mapApi.setInteractive(inter); }
    const ranks = ch.id === "sowhat";
    if (ranks !== ranksNow) { ranksNow = ranks; mapApi.showRanks(ranks, focusSegment); }
    mapApi.setHighlight(highlightOf(st));
    if (ch.time === "scroll") {
      // baseline on entry (a jump-scroll may skip progress events); progress events refine it
      if (reducedMotion) mapApi.setRideProgress(1, true);
      else mapApi.setRideProgress(Math.min(1, (si + (lastDir === "up" ? 1 : 0)) / (ch.steps.length - 0.35)));
    }
  }

  let lastDir = "down";
  // ---- dock: on compact screens, the text of chapters with panels sits in a fixed slot ----
  const dock = $("#dock");
  let dockFlip = false;
  function syncDock(el) {
    const card = el && el.querySelector(".card");
    const docked = !!card && phone && el.classList.contains("dockable");
    stage.classList.toggle("docked", docked);
    if (!docked) return;
    dock.innerHTML = card.innerHTML;
    dockFlip = !dockFlip;
    dock.classList.toggle("flip", dockFlip); // alternating animation names restart the fade without a reflow
  }

  function onStep(ci, si, dir, el) {
    lastDir = dir;
    if (activeEl) activeEl.classList.remove("active");
    el.classList.add("active");
    activeEl = el;
    applyStep(ci, si);
    syncDock(el);
  }
  phoneMQ.addEventListener("change", () => syncDock(activeEl));
  function onProgress(ci, si, p) {
    const ch = active[ci];
    if (ch.time !== "scroll" || !mapApi || reducedMotion) return;
    mapApi.setRideProgress(Math.min(1, (si + p) / (ch.steps.length - 0.35)));
  }

  if (params.has("debug")) {
    // dev hook for scripts/screenshots.mjs
    window.__ss = {
      map: () => mapApi && mapApi.debugState(),
      openHero: () => {
        const r = frames.ranges[frames.areas.indexOf(exploreArea)];
        for (let i = r.start; i < r.end; i++) if (frames.hero[i]) return openDetail(i);
        return openDetail(r.start + ((r.end - r.start) >> 1)); // no hero yet: thermal-only panel
      },
    };
  }

  // autoplay drives the steps itself from cached geometry (see below), so scrollama stays quiet then
  const noop = () => {};
  const scroller = initScroll({ onStep: AUTOPLAY ? noop : onStep, onProgress: AUTOPLAY ? noop : onProgress });
  applyStep(0, 0, true);

  // resize: refit camera once per tick at most
  let resizeQueued = false;
  window.addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    onTick(() => {
      resizeQueued = false;
      scroller.resize();
      if (mapApi) mapApi.refit(active[current.ci]);
      return false;
    });
  }, { passive: true });

  // ---- autoplay: fixed-pace scroll on the master clock (for the 60 s video) ----
  if (AUTOPLAY) {
    window.scrollTo(0, 0);
    await Promise.all([ribbonDone, mapReady]);
    const t0 = performance.now();
    // all geometry is read once, before scrolling starts; the loop below only writes
    const vh = window.innerHeight;
    const end = $("#how").offsetTop - vh; // ends on the full explore map
    const stepEls = [...document.querySelectorAll(".step")];
    const tops = stepEls.map((el) => el.getBoundingClientRect().top + window.scrollY);
    const heights = stepEls.map((el) => el.offsetHeight);
    const total = AUTOPLAY_SECS * 1000 - 3000;
    // The recording must not depend on IntersectionObserver timing, so the step under the
    // trigger line (60% down, same as scrollama) is derived from the cached geometry.
    let k = 0;
    onTick((now) => {
      const y = Math.min(end, ((now - t0) / total) * end);
      window.scrollTo(0, y);
      const line = y + vh * 0.6;
      while (k + 1 < tops.length && tops[k + 1] <= line) k++;
      const el = stepEls[k];
      const ci = +el.dataset.ch, si = +el.dataset.st;
      if (el !== activeEl && tops[k] <= line) onStep(ci, si, "down", el);
      onProgress(ci, si, Math.min(1, Math.max(0, (line - tops[k]) / heights[k])));
      if (y >= end) {
        document.documentElement.dataset.autoplayDone = "1";
        return false;
      }
      return true;
    });
  }
}

main();
