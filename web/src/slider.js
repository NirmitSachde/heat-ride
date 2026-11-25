// The three-way slider: normal color | near-infrared | thermal.
// Three stacked images; the upper two are cut with CSS clip-path inset() driven by two
// custom properties (--a, --b). Moving a handle only writes custom properties: no layout.
//
// Input:
// - two handles with role="slider": Tab focuses them, arrows move them, Home/End jump,
//   PageUp/PageDown take big steps;
// - pointer: a drag anywhere on the picture moves the nearest handle (touch keeps vertical
//   page scrolling through touch-action: pan-y);
// - the handles keep a minimum gap, so the middle view never disappears under a user's drag.

import { tween } from "./clock.js";

const LABELS = ["Normal", "Near-infrared", "Thermal"];
const SAY = [
  "Normal: the street as your eyes see it.",
  "Near-infrared: healthy plants glow green.",
  "Thermal: bright is warm, dark is cool.",
];
const GAP = 0.08; // smallest share of the width the middle view keeps during a drag
const KEY_STEP = 0.05;
const PAGE_STEP = 0.2;
const HINT_KEY = "heat-ride:slider-used";
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

let hintDone = false;
try { hintDone = localStorage.getItem(HINT_KEY) === "1"; } catch { /* storage blocked: show the hint */ }

export function createSlider(root, { handles = true, compact = false } = {}) {
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
      <div class="tri-knob tri-knob-a" role="slider" tabindex="0" aria-orientation="horizontal"
        aria-label="Edge between the normal and near-infrared views" aria-valuemin="0" aria-valuemax="100"></div>
      <div class="tri-knob tri-knob-b" role="slider" tabindex="0" aria-orientation="horizontal"
        aria-label="Edge between the near-infrared and thermal views" aria-valuemin="0" aria-valuemax="100"></div>
      <p class="tri-hint" aria-hidden="true">Drag the handles</p>
      <p class="tri-caption" aria-live="polite"></p>
    </div>
    <p class="tri-note" hidden></p>`;

  const frame = root.querySelector(".tri-frame");
  const imgs = { r: root.querySelector(".tri-r"), n: root.querySelector(".tri-n"), t: root.querySelector(".tri-t") };
  const knobA = root.querySelector(".tri-knob-a");
  const knobB = root.querySelector(".tri-knob-b");
  const labels = root.querySelectorAll(".tri-l");
  const caption = root.querySelector(".tri-caption");
  const note = root.querySelector(".tri-note");
  const style = root.style;

  let a = 0, b = 0;
  let cancel = null;
  let full = true;
  let wantHandles = handles;
  let lastSaid = -1;

  function apply() {
    style.setProperty("--a", a.toFixed(4));
    style.setProperty("--b", b.toFixed(4));
    style.setProperty("--m0", (a / 2).toFixed(4));
    style.setProperty("--m1", ((a + b) / 2).toFixed(4));
    style.setProperty("--m2", ((b + 1) / 2).toFixed(4));
    labels[0].classList.toggle("off", a < 0.12);
    labels[1].classList.toggle("off", b - a < 0.16);
    labels[2].classList.toggle("off", 1 - b < 0.12);
    knobA.setAttribute("aria-valuenow", String(Math.round(a * 100)));
    knobB.setAttribute("aria-valuenow", String(Math.round(b * 100)));
    knobA.setAttribute("aria-valuetext", `${Math.round(a * 100)}% normal photo`);
    knobB.setAttribute("aria-valuetext", `${Math.round((1 - b) * 100)}% thermal photo`);
  }

  function say(region) {
    if (region === lastSaid) return;
    lastSaid = region;
    caption.textContent = SAY[region];
  }

  /** Programmatic position (scroll steps). Extremes allowed; animated over 600 ms. */
  function set(na, nb, animate = false) {
    if (!full) { na = 0; nb = 0; }
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

  function used() {
    if (!hintDone) {
      hintDone = true;
      try { localStorage.setItem(HINT_KEY, "1"); } catch { /* fine */ }
    }
    root.classList.add("hint-off");
  }

  /** User move of one handle, with the minimum gap kept. */
  function moveHandle(which, v) {
    if (cancel) { cancel(); cancel = null; }
    v = Math.max(0, Math.min(1, v));
    if (which === "a") {
      const na = Math.min(v, Math.max(0, b - GAP));
      if (na !== a) say(na > a ? 0 : 1);
      a = na;
    } else {
      const nb = Math.max(v, Math.min(1, a + GAP));
      if (nb !== b) say(nb > b ? 1 : 2);
      b = nb;
    }
    apply();
    used();
  }

  // ---- keyboard ----
  function onKey(which) {
    return (e) => {
      const cur = which === "a" ? a : b;
      let v = null;
      switch (e.key) {
        case "ArrowRight": case "ArrowUp": v = cur + KEY_STEP; break;
        case "ArrowLeft": case "ArrowDown": v = cur - KEY_STEP; break;
        case "PageUp": v = cur + PAGE_STEP; break;
        case "PageDown": v = cur - PAGE_STEP; break;
        case "Home": v = 0; break;
        case "End": v = 1; break;
        default: return;
      }
      e.preventDefault();
      moveHandle(which, v);
    };
  }
  knobA.addEventListener("keydown", onKey("a"));
  knobB.addEventListener("keydown", onKey("b"));

  // ---- pointer: drag anywhere, nearest handle ----
  // Mouse and pen start at once. Touch waits for a mostly sideways move, so a vertical swipe
  // over the picture still scrolls the page and never nudges a handle.
  let dragging = null;
  let pending = null;
  let rect = null;
  function begin(e, u) {
    const da = Math.abs(u - a), db = Math.abs(u - b);
    // nearest handle; on a tie pick the one that can move toward the pointer
    dragging = da < db ? "a" : db < da ? "b" : u < a ? "a" : "b";
    (dragging === "a" ? knobA : knobB).focus({ preventScroll: true });
    try { frame.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    root.classList.add("dragging");
    moveHandle(dragging, u);
  }
  frame.addEventListener("pointerdown", (e) => {
    if (!full || root.classList.contains("no-handles") || e.button > 0) return;
    rect = frame.getBoundingClientRect(); // one read per drag
    const u = (e.clientX - rect.left) / rect.width;
    if (e.pointerType === "touch") pending = { x: e.clientX, y: e.clientY };
    else begin(e, u);
  });
  frame.addEventListener("pointermove", (e) => {
    if (pending) {
      const dx = e.clientX - pending.x, dy = e.clientY - pending.y;
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) { pending = null; begin(e, (e.clientX - rect.left) / rect.width); }
      else if (Math.abs(dy) > 10) pending = null;
      return;
    }
    if (!dragging) return;
    moveHandle(dragging, (e.clientX - rect.left) / rect.width);
  });
  const end = () => { dragging = null; pending = null; root.classList.remove("dragging"); };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);

  // ---- images, with fallbacks ----
  // Each source may be a list of candidates: on a load error the next one is tried.
  // If the normal or near-infrared photo cannot be loaded at all, the slider falls back to thermal only.
  let token = 0;
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
    lastSaid = -1;
    caption.textContent = "";
    showHandles(wantHandles);
  }

  function showHandles(on) {
    wantHandles = on;
    const live = on && full;
    root.classList.toggle("no-handles", !live);
    root.classList.toggle("hint-off", hintDone || !live);
    knobA.tabIndex = live ? 0 : -1;
    knobB.tabIndex = live ? 0 : -1;
    knobA.setAttribute("aria-hidden", String(!live));
    knobB.setAttribute("aria-hidden", String(!live));
    if (live && lastSaid < 0) caption.textContent = COARSE ? "Drag the handles to compare the three views." : "Drag the handles, or use the arrow keys, to compare the three views.";
  }

  showHandles(handles);
  apply();
  return { set, setFrame, showHandles, get full() { return full; }, el: frame };
}
