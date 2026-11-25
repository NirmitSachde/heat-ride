// The three-way slider: normal color | near-infrared | thermal.
// Three stacked images; the upper two are cut with CSS clip-path inset() driven by two
// custom properties (--a, --b). Two native range inputs give keyboard and touch control.
// Moving a handle only writes custom properties: no layout, no reflow.

import { tween } from "./clock.js";

const LABELS = ["Normal", "Near-infrared", "Thermal"];
const STEPS = 1000;
let uid = 0;

export function createSlider(root, { handles = true, compact = false } = {}) {
  const id = `tri${++uid}`;
  root.classList.add("tri");
  if (compact) root.classList.add("tri-compact");
  root.innerHTML = `
    <div class="tri-frame">
      <img class="tri-img tri-r" alt="" decoding="async" draggable="false">
      <img class="tri-img tri-n" alt="" decoding="async" draggable="false">
      <img class="tri-img tri-t" alt="" decoding="async" draggable="false">
      <div class="tri-edge tri-edge-a" aria-hidden="true"></div>
      <div class="tri-edge tri-edge-b" aria-hidden="true"></div>
      <div class="tri-labels" aria-hidden="true">
        <span class="tri-l tri-l0">${LABELS[0]}</span>
        <span class="tri-l tri-l1">${LABELS[1]}</span>
        <span class="tri-l tri-l2">${LABELS[2]}</span>
      </div>
    </div>
    <div class="tri-ctl">
      <label class="sr-only" for="${id}a">Edge between normal and near-infrared view</label>
      <input id="${id}a" class="tri-in tri-in-a" type="range" min="0" max="${STEPS}" step="1" value="0">
      <label class="sr-only" for="${id}b">Edge between near-infrared and thermal view</label>
      <input id="${id}b" class="tri-in tri-in-b" type="range" min="0" max="${STEPS}" step="1" value="0">
    </div>
    <p class="tri-note" hidden></p>`;

  const frame = root.querySelector(".tri-frame");
  const imgs = { r: root.querySelector(".tri-r"), n: root.querySelector(".tri-n"), t: root.querySelector(".tri-t") };
  const inA = root.querySelector(".tri-in-a");
  const inB = root.querySelector(".tri-in-b");
  const labels = root.querySelectorAll(".tri-l");
  const note = root.querySelector(".tri-note");
  const style = root.style;

  let a = 0, b = 0;
  let cancel = null;
  let full = true;

  function apply() {
    style.setProperty("--a", a.toFixed(4));
    style.setProperty("--b", b.toFixed(4));
    // label centred in its region, hidden when the region is too thin
    style.setProperty("--m0", (a / 2).toFixed(4));
    style.setProperty("--m1", ((a + b) / 2).toFixed(4));
    style.setProperty("--m2", ((b + 1) / 2).toFixed(4));
    labels[0].classList.toggle("off", a < 0.12);
    labels[1].classList.toggle("off", b - a < 0.16);
    labels[2].classList.toggle("off", 1 - b < 0.12);
    inA.value = Math.round(a * STEPS);
    inB.value = Math.round(b * STEPS);
    inA.setAttribute("aria-valuetext", `${Math.round(a * 100)}% normal`);
    inB.setAttribute("aria-valuetext", `${Math.round((1 - b) * 100)}% thermal`);
    // when both handles sit on the right, the left one must be on top to be grabbable
    root.classList.toggle("a-top", a > 0.5);
  }

  function set(na, nb, animate = false) {
    if (!full) { na = 0; nb = 0; } // thermal only: nothing to reveal
    na = Math.max(0, Math.min(1, na));
    nb = Math.max(na, Math.min(1, nb));
    if (cancel) { cancel(); cancel = null; }
    if (!animate) { a = na; b = nb; apply(); return; }
    const a0 = a, b0 = b;
    cancel = tween({
      onUpdate: (_, e) => { a = a0 + (na - a0) * e; b = b0 + (nb - b0) * e; apply(); },
      onDone: () => { cancel = null; },
    });
  }

  inA.addEventListener("input", () => {
    if (cancel) { cancel(); cancel = null; }
    a = Math.min(+inA.value / STEPS, b);
    apply();
  });
  inB.addEventListener("input", () => {
    if (cancel) { cancel(); cancel = null; }
    b = Math.max(+inB.value / STEPS, a);
    apply();
  });

  // Each source may be a list of candidates: on a load error the next one is tried.
  // If the normal or near-infrared photo cannot be loaded at all, the slider falls back to thermal only.
  let token = 0;
  let wantHandles = handles;
  function degrade() {
    if (!full) return;
    full = false;
    root.classList.add("thermal-only");
    note.textContent = "Only the thermal photo is shared for this spot.";
    note.hidden = false;
    set(0, 0);
    showHandles(wantHandles);
  }
  function load(k, cands, my) {
    const img = imgs[k];
    let i = 0;
    img.onerror = () => {
      if (my !== token) return;
      i++;
      if (i < cands.length) { img.src = cands[i]; return; }
      img.hidden = true;
      img.removeAttribute("src");
      if (k !== "t") degrade();
    };
    img.onload = null;
    if (img.getAttribute("src") !== cands[0]) img.src = cands[0];
    img.hidden = false;
  }
  function setFrame({ r, n, t, alt, eager = false }) {
    const my = ++token;
    const list = (x) => (x == null ? [] : Array.isArray(x) ? x.filter(Boolean) : [x]);
    const src = { r: list(r), n: list(n), t: list(t) };
    full = src.r.length > 0 && src.n.length > 0;
    const loading = eager ? "eager" : "lazy";
    for (const k of ["r", "n", "t"]) {
      const img = imgs[k];
      img.loading = loading;
      if (src[k].length && (k === "t" || full)) load(k, src[k], my);
      else { img.onerror = null; img.removeAttribute("src"); img.hidden = true; }
    }
    imgs.t.alt = alt ? `Thermal photo: ${alt}` : "Thermal photo";
    imgs.n.alt = full && alt ? `Near-infrared photo: ${alt}` : "";
    imgs.r.alt = full && alt ? `Normal photo: ${alt}` : "";
    root.classList.toggle("thermal-only", !full);
    note.hidden = full;
    if (!full) {
      note.textContent = "Only the thermal photo is shared for this spot.";
      set(0, 0);
    }
    showHandles(wantHandles);
  }

  function showHandles(on) {
    wantHandles = on;
    root.classList.toggle("no-handles", !on || !full);
    inA.tabIndex = on && full ? 0 : -1;
    inB.tabIndex = on && full ? 0 : -1;
  }

  showHandles(handles);
  apply();
  return { set, setFrame, showHandles, get full() { return full; }, el: frame };
}
