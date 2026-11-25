// Opening "heat ribbon" (p5.js, instance mode, loop off). Every photo spot is one short
// vertical stroke in ride order: color = warmth, length = green share. The master clock
// calls redraw(); each redraw paints only the strokes that are new since the last one.
// Under 3 s in total, skippable, then it dissolves into the story.

import { onTick, tween, reducedMotion } from "./clock.js";
import { idx, LUT } from "./heat.js";

const DRAW_MS = 1900;
const HOLD_MS = 250;

export async function playRibbon(el, frames, { labels = {}, autoplay = false, onDone }) {
  let done = false;
  let inst = null;
  const finish = () => {
    if (done) return;
    done = true;
    off();
    el.classList.add("dissolve");
    onDone && onDone();
    tween({
      onDone: () => {
        if (inst) inst.remove();
        el.remove();
      },
    });
  };
  const events = ["click", "keydown", "wheel", "touchstart"];
  const off = () => events.forEach((e) => window.removeEventListener(e, finish, true));

  if (reducedMotion || !frames.n) {
    el.remove();
    onDone && onDone();
    return;
  }
  if (!autoplay) events.forEach((e) => window.addEventListener(e, finish, { capture: true, passive: true }));

  // area labels under the ribbon
  const labelBox = el.querySelector(".ribbon-labels");
  const live = frames.ranges.map((r, ai) => [r, ai]).filter(([r]) => r.end > r.start);
  labelBox.innerHTML = live
    .map(([r, ai], k) => {
      const mid = ((r.start + r.end) / 2 / frames.n) * 100;
      const name = frames.areas[ai];
      const edge = k === 0 ? " first" : k === live.length - 1 ? " last" : "";
      return `<span class="${edge}" data-start="${r.start}" style="left:${mid.toFixed(2)}%"><b>${name}</b>${labels[name] ? `<i>${labels[name]}</i>` : ""}</span>`;
    })
    .join("");

  // each place label appears when the ribbon starts drawing that place's strokes
  const labelEls = [...labelBox.querySelectorAll("span")].map((el) => ({ el, start: +el.dataset.start, on: false }));
  const { default: P5 } = await import("p5");
  if (done) return;

  const host = el.querySelector(".ribbon-canvas");
  const W = host.clientWidth;
  const H = host.clientHeight;
  const n = frames.n;
  const margin = W < 600 ? 16 : 40;
  const span = W - margin * 2;
  const cy = H / 2;
  const maxLen = H * 0.9;
  // precomputed columns
  const xs = new Float32Array(n);
  const half = new Float32Array(n);
  const col = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = margin + (n > 1 ? i / (n - 1) : 0.5) * span;
    const g = frames.g[i] === frames.g[i] ? frames.g[i] : 0.04;
    half[i] = ((0.1 + 0.9 * g) * maxLen) / 2;
    col[i] = idx(frames.w[i]);
  }
  const weight = Math.max(1, (span / n) * 1.6);
  let drawn = 0;
  let target = 0;

  inst = new P5((p) => {
    p.setup = () => {
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      p.createCanvas(W, H);
      p.noLoop();
      p.clear();
      p.strokeCap(p.SQUARE);
      p.strokeWeight(weight);
    };
    p.draw = () => {
      for (; drawn < target; drawn++) {
        const c = col[drawn];
        if (c < 0) p.stroke(110, 114, 122, 160);
        else p.stroke(LUT[c * 4], LUT[c * 4 + 1], LUT[c * 4 + 2], 220);
        p.line(xs[drawn], cy - half[drawn], xs[drawn], cy + half[drawn]);
      }
    };
  }, host);

  el.classList.add("playing");
  let t0 = -1;
  onTick((now) => {
    if (done) return false;
    if (t0 < 0) t0 = now;
    const e = now - t0;
    target = Math.min(n, Math.ceil((e / DRAW_MS) * n));
    inst.redraw();
    for (const l of labelEls) if (!l.on && target > l.start) { l.on = true; l.el.classList.add("on"); }
    if (e >= DRAW_MS + HOLD_MS) {
      finish();
      return false;
    }
    return true;
  });
}
