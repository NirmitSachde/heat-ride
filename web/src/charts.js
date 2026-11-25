// D3 charts. Dots go on a canvas (thousands of them, drawn once per resize, batched by
// color); axes, the median line and the hover ring go in SVG on top. Hover uses a quadtree.

import { select, scaleLinear, axisBottom, axisLeft, quadtree, line, curveMonotoneX } from "d3";
import { idx, CSS, cssOf } from "./heat.js";
import { frameUrl } from "./data.js";

const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtRel = (v) => (Math.abs(v) < 0.05 ? "about average" : `${Math.abs(v).toFixed(1)}°C ${v > 0 ? "warmer" : "cooler"}`);
const MIN_BIN = 25; // fewest dots a slice needs before the median line goes through it

/** Shared, computed once: valid frames, color buckets, domains, binned medians. */
export function prepare(frames) {
  const valid = [];
  for (let i = 0; i < frames.n; i++) if (frames.w[i] === frames.w[i] && frames.g[i] === frames.g[i]) valid.push(i);
  const v = Uint32Array.from(valid);
  const ws = Float32Array.from(v, (i) => frames.w[i]).sort();
  const q = (p) => ws[Math.min(ws.length - 1, Math.max(0, Math.round((ws.length - 1) * p)))];
  let gmax = 0;
  for (const i of v) if (frames.g[i] > gmax) gmax = frames.g[i];
  const yDomain = [Math.floor(q(0.004)), Math.ceil(q(0.996))];
  const xDomain = [0, Math.min(1, Math.ceil(gmax * 10) / 10 || 1)];
  // draw order: bucketed by color so the canvas fillStyle changes at most 256 times
  const byColor = Uint32Array.from(v).sort((a, b) => idx(frames.w[a]) - idx(frames.w[b]));
  const perArea = frames.areas.map((_, ai) => v.filter((i) => frames.a[i] === ai));
  return { valid: v, byColor, yDomain, xDomain, perArea };
}

/**
 * Median warmth per slice of green share: equal-width slices, and only well-filled slices. The line is cut to the longest run of consecutive well-filled slices,
 * so it stops where the data gets thin instead of jumping on a handful of dots.
 */
export function medians(frames, indices, xDomain, width = 0.05) {
  const bins = Math.max(1, Math.round((xDomain[1] - xDomain[0]) / width));
  const buckets = Array.from({ length: bins }, () => []);
  for (const i of indices) {
    const b = Math.min(bins - 1, Math.floor((frames.g[i] - xDomain[0]) / width));
    if (b >= 0) buckets[b].push(i);
  }
  const med = (arr) => { arr.sort((x, y) => x - y); const m = arr.length >> 1; return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2; };
  // a slice needs at least MIN_BIN dots and at least 70% of the dots it would hold if green were
  // spread evenly; thinner slices (the sparse green end) are left out and the line stops there
  const minBin = Math.max(MIN_BIN, Math.round(indices.length * width * 0.7));
  let best = [], run = [];
  for (const ids of buckets) {
    if (ids.length >= minBin) {
      run.push([med(Float32Array.from(ids, (i) => frames.g[i])), med(Float32Array.from(ids, (i) => frames.w[i]))]);
      if (run.length > best.length) best = run;
    } else {
      run = [];
    }
  }
  return best;
}

function canvasFor(root) {
  const c = document.createElement("canvas");
  c.className = "chart-canvas";
  c.setAttribute("aria-hidden", "true");
  root.appendChild(c);
  return c;
}

function drawDots(ctx, frames, order, x, y, r, alpha) {
  // halo pass: the coolest ramp colors are close to the background, so every dot gets a faint light rim
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(232,230,227,0.13)";
  ctx.beginPath();
  const R = r + 0.9;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const px = x(frames.g[i]), py = y(frames.w[i]);
    ctx.moveTo(px + R, py);
    ctx.arc(px, py, R, 0, 6.2832);
  }
  ctx.fill();
  ctx.globalAlpha = alpha;
  let last = -2;
  ctx.beginPath();
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const c = idx(frames.w[i]);
    if (c !== last) {
      if (last !== -2) ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = c < 0 ? "#6E727A" : CSS[c];
      last = c;
    }
    const px = x(frames.g[i]), py = y(frames.w[i]);
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, 6.2832);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- scatter
export function createScatter(root, tip, model, prep, { onHover, isPhone }) {
  const { frames } = model;
  const canvas = canvasFor(root);
  const svg = select(root).append("svg").attr("class", "chart-svg").attr("role", "img")
    .attr("aria-label", "Scatter chart. Each dot is one photo spot. Across: share of the view that is green. Up: how much warmer the street was than the air.");
  const gx = svg.append("g").attr("class", "axis axis-x");
  const gy = svg.append("g").attr("class", "axis axis-y");
  const zero = svg.append("line").attr("class", "zero");
  const xl = svg.append("text").attr("class", "axis-label").attr("text-anchor", "end");
  const yl = svg.append("text").attr("class", "axis-label");
  const med = svg.append("path").attr("class", "median").attr("pathLength", 1);
  const medLabel = svg.append("text").attr("class", "median-label");
  const ring = svg.append("circle").attr("class", "ring").attr("r", 7).style("display", "none");
  const ringFixed = svg.append("circle").attr("class", "ring ring-fixed").attr("r", 8).style("display", "none");

  const medPts = medians(frames, prep.valid, prep.xDomain, 0.05);
  let W = 0, H = 0, x, y, qt = null, hovered = -1, fixed = -1;
  let state = { median: false, interactive: false };
  const m = { top: 28, right: 16, bottom: 44, left: 48 };

  function render() {
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    svg.attr("width", W).attr("height", H);
    x = scaleLinear().domain(prep.xDomain).range([m.left, W - m.right]);
    y = scaleLinear().domain(prep.yDomain).range([H - m.bottom, m.top]).nice();
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const r = isPhone() ? 1.5 : 1.9;
    drawDots(ctx, frames, prep.byColor, x, y, r, 0.62);
    gx.attr("transform", `translate(0,${H - m.bottom})`).call(axisBottom(x).ticks(5).tickFormat(fmtPct).tickSizeOuter(0));
    gy.attr("transform", `translate(${m.left},0)`).call(axisLeft(y).ticks(6).tickFormat((d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}°`).tickSizeOuter(0));
    zero.attr("x1", m.left).attr("x2", W - m.right).attr("y1", y(0)).attr("y2", y(0));
    xl.attr("x", W - m.right).attr("y", H - 8).text("more green in view →");
    yl.attr("x", m.left - 40).attr("y", 14).text("↑ warmer than other streets that hour (°C)");
    med.attr("d", line().curve(curveMonotoneX).x((d) => x(d[0])).y((d) => y(d[1]))(medPts));
    const lastPt = medPts[medPts.length - 1];
    if (lastPt) {
      // label just past the end of the line (it stops where the data thins out)
      // narrow charts: above the start of the line instead, clear of the curve
      const lx = x(lastPt[0]), roomRight = W - m.right - lx > 130;
      const top = Math.min(...medPts.map((d) => y(d[1])));
      medLabel.attr("x", roomRight ? lx + 8 : m.left + 4).attr("y", roomRight ? y(lastPt[1]) + 4 : top - 12)
        .attr("text-anchor", "start").text("middle of the dots");
    }
    qt = quadtree().x((i) => x(frames.g[i])).y((i) => y(frames.w[i])).addAll(Array.from(prep.valid));
    placeRing(ringFixed, fixed);
    placeRing(ring, hovered);
    applyState();
  }
  function placeRing(el, i) {
    if (i < 0 || !x || !(frames.w[i] === frames.w[i])) { el.style("display", "none"); return; }
    el.style("display", null).attr("cx", x(frames.g[i])).attr("cy", y(frames.w[i]));
  }
  function applyState() {
    root.classList.toggle("show-median", !!state.median);
  }

  new ResizeObserver((entries) => {
    const r = entries[0].contentRect;
    if (Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return;
    W = r.width; H = r.height;
    render();
  }).observe(root);

  // ---- hover / tap ----
  let tipW = 0;
  function showTip(i, px, py) {
    if (i < 0) { tip.hidden = true; return; }
    const id = frames.id[i];
    const hero = frames.hero[i] === 1;
    const area = frames.areas[frames.a[i]];
    tip.innerHTML = `
      <div class="tip-imgs${hero ? " hero" : ""}">
        ${hero ? `<img loading="lazy" decoding="async" src="${frameUrl("r", id)}" alt="Normal photo of a street in ${area}">
        <img loading="lazy" decoding="async" src="${frameUrl("n", id)}" alt="Near-infrared photo, plants glow green">` : ""}
        <img loading="lazy" decoding="async" src="${frameUrl("t", id)}" alt="Thermal photo of a street in ${area}">
      </div>
      <p class="tip-text"><span class="sw" style="background:${cssOf(frames.w[i])}"></span><b>${fmtRel(frames.w[i])}</b> than other streets that hour · <b class="plant">${frames.g[i] === frames.g[i] ? fmtPct(frames.g[i]) : "n/a"}</b> green · ${area}</p>`;
    tip.hidden = false;
    tipW = hero ? 300 : 200;
    const left = px + 16 + tipW > W ? Math.max(4, px - 16 - tipW) : px + 16;
    const top = Math.max(4, Math.min(H - 150, py - 60));
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }
  function hover(i, px, py) {
    if (i === hovered) return;
    hovered = i;
    placeRing(ring, i);
    showTip(i, px, py);
    onHover && onHover(i);
  }
  function pick(ev) {
    if (!state.interactive || !qt) return;
    const rect = canvas.getBoundingClientRect(); // one read per pointer event, no writes before it
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const i = qt.find(px, py, 14);
    hover(i == null ? -1 : i, px, py);
  }
  svg.on("pointermove", pick).on("pointerdown", pick).on("pointerleave", (ev) => {
    if (ev.pointerType === "mouse") hover(-1, 0, 0);
  });

  return {
    setState(st) {
      state = { ...state, ...st };
      root.classList.toggle("interactive", !!state.interactive);
      if (!state.interactive) hover(-1, 0, 0);
      applyState();
    },
    setFixed(i) {
      fixed = i == null ? -1 : i;
      placeRing(ringFixed, fixed);
    },
  };
}

// ---------------------------------------------------------------- small multiples
export function createMultiples(root, model, prep, captions, { isPhone }) {
  const { frames } = model;
  const order = ["Middelbeers", "Oirschot", "Delft", "Arnhem"].filter((a) => frames.areas.includes(a));
  const cells = order.map((area) => {
    const ai = frames.areas.indexOf(area);
    const cap = captions[area] || {};
    const cell = document.createElement("figure");
    cell.className = "mult";
    cell.innerHTML = `
      <figcaption>
        <span class="mult-name">${area}</span><span class="mult-kind">${cap.label || ""}</span>
        <p class="mult-words">${cap.sentence || ""}</p>
        <p class="mult-score">${cap.score || ""}</p>
      </figcaption>
      <div class="mult-plot"></div>`;
    root.appendChild(cell);
    const plot = cell.querySelector(".mult-plot");
    const canvas = canvasFor(plot);
    const svg = select(plot).append("svg").attr("class", "chart-svg").attr("aria-hidden", "true");
    const ids = prep.perArea[ai];
    const sorted = Uint32Array.from(ids).sort((a, b) => idx(frames.w[a]) - idx(frames.w[b]));
    const med = medians(frames, ids, prep.xDomain, 0.1);
    return { plot, canvas, svg, sorted, med };
  });

  function render(c, W, H) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.canvas.width = Math.round(W * dpr);
    c.canvas.height = Math.round(H * dpr);
    c.canvas.style.width = W + "px";
    c.canvas.style.height = H + "px";
    const mm = { top: 8, right: 8, bottom: 22, left: 30 };
    const x = scaleLinear().domain(prep.xDomain).range([mm.left, W - mm.right]);
    const y = scaleLinear().domain(prep.yDomain).range([H - mm.bottom, mm.top]).nice();
    const ctx = c.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawDots(ctx, frames, c.sorted, x, y, isPhone() ? 1.1 : 1.4, 0.6);
    c.svg.attr("width", W).attr("height", H).selectAll("*").remove();
    c.svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mm.bottom})`).call(axisBottom(x).ticks(3).tickFormat(fmtPct).tickSizeOuter(0));
    c.svg.append("g").attr("class", "axis").attr("transform", `translate(${mm.left},0)`).call(axisLeft(y).ticks(4).tickFormat((d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}°`).tickSizeOuter(0));
    c.svg.append("line").attr("class", "zero").attr("x1", mm.left).attr("x2", W - mm.right).attr("y1", y(0)).attr("y2", y(0));
    c.svg.append("path").attr("class", "median median-static").attr("d", line().curve(curveMonotoneX).x((d) => x(d[0])).y((d) => y(d[1]))(c.med));
  }

  for (const c of cells) {
    let W = 0, H = 0;
    new ResizeObserver((e) => {
      const r = e[0].contentRect;
      if (Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return;
      W = r.width; H = r.height;
      if (W > 20 && H > 20) render(c, W, H);
    }).observe(c.plot);
  }
}

// ---------------------------------------------------------------- tired trees
export function createTrees(root, trees, words) {
  const rows = [
    { label: "Coolest fifth of streets", v: trees.health_cool20, c: "#6EE7B7" },
    { label: "Warmest fifth of streets", v: trees.health_warm20, c: "#E1534A" },
  ];
  const max = Math.max(0.8, ...rows.map((r) => r.v || 0));
  root.innerHTML = `
    <h3 class="panel-title">Plant health score</h3>
    <p class="panel-sub">${words}</p>
    ${rows.map((r) => `
      <div class="bar-row">
        <span class="bar-label">${r.label}</span>
        <span class="bar-track"><span class="bar" style="--w:${((r.v || 0) / max).toFixed(3)};background:${r.c}"></span></span>
        <span class="bar-val">${r.v == null ? "n/a" : r.v.toFixed(2)}</span>
      </div>`).join("")}
    <p class="panel-foot">Higher is healthier. The score comes from how strongly leaves reflect near-infrared light.</p>`;
}
