// The one master clock. A single requestAnimationFrame loop, capped at 30 fps, drives
// every animation in the app (ribbon, ride, camera, slider, tweens, autoplay scroll).
// It sleeps when nothing is subscribed, so an idle page costs nothing.

const FRAME_MS = 1000 / 30;
const subs = new Set();
let raf = 0;
let last = 0;

export const reducedMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DURATION = 600;

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function loop(now) {
  raf = 0;
  if (!subs.size) return;
  raf = requestAnimationFrame(loop);
  const elapsed = now - last;
  if (elapsed < FRAME_MS - 2) return; // 30 fps cap
  last = now;
  const dt = elapsed > 200 ? FRAME_MS : elapsed;
  for (const fn of subs) {
    if (fn(now, dt) === false) subs.delete(fn);
  }
}

function wake() {
  if (!raf) {
    last = performance.now() - FRAME_MS;
    raf = requestAnimationFrame(loop);
  }
}

/** Subscribe a tick function (now, dt). Return false from it to unsubscribe. */
export function onTick(fn) {
  subs.add(fn);
  wake();
  return () => subs.delete(fn);
}

/**
 * Tween a number from `from` to `to` (600 ms, ease in-out by default).
 * Returns a cancel function. Under reduced motion it jumps straight to the end.
 */
export function tween({ from = 0, to = 1, duration = DURATION, ease = easeInOut, onUpdate, onDone }) {
  if (reducedMotion || duration <= 0) {
    onUpdate && onUpdate(to, 1);
    onDone && onDone();
    return () => {};
  }
  let start = -1;
  let cancelled = false;
  const fn = (now) => {
    if (cancelled) return false;
    if (start < 0) start = now;
    const p = Math.min(1, (now - start) / duration);
    const e = ease(p);
    onUpdate && onUpdate(from + (to - from) * e, e);
    if (p >= 1) {
      onDone && onDone();
      return false;
    }
    return true;
  };
  onTick(fn);
  return () => {
    cancelled = true;
  };
}
