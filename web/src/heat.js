// One heat ramp, used everywhere (map dots, chart dots, legend, ribbon).
// Stops are evenly spaced over relative warmth (vs. streets ridden the same hour), domain from story.json.ramp_domain.

export const RAMP_HEX = ["#1B1F3B", "#6A2C70", "#E1534A", "#F9C74F", "#FFF6D5"];
export const PLANT_HEX = "#6EE7B7";
const RAMP_RGB = RAMP_HEX.map((h) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16)));

let lo = -2;
let hi = 14;
let span = hi - lo;

// 256-entry lookup tables, built once. RGB arrays are shared (never mutated) so
// deck.gl accessors can return them without allocating.
export const LUT = new Uint8Array(256 * 4);
export const RGB = new Array(256);
export const CSS = new Array(256);
for (let i = 0; i < 256; i++) {
  const u = (i / 255) * (RAMP_RGB.length - 1);
  const k = Math.min(RAMP_RGB.length - 2, Math.floor(u));
  const f = u - k;
  const c = [0, 1, 2].map((j) => Math.round(RAMP_RGB[k][j] + (RAMP_RGB[k + 1][j] - RAMP_RGB[k][j]) * f));
  LUT.set([c[0], c[1], c[2], 255], i * 4);
  RGB[i] = c;
  CSS[i] = `rgb(${c[0]},${c[1]},${c[2]})`;
}
export const UNKNOWN_RGB = [110, 114, 122];

export function setDomain(domain) {
  if (Array.isArray(domain) && domain.length === 2 && domain[1] > domain[0]) {
    lo = +domain[0];
    hi = +domain[1];
    span = hi - lo;
  }
}
export const getDomain = () => [lo, hi];

/** Warmth (C above air) to LUT index 0..255. NaN returns -1. */
export function idx(w) {
  if (w !== w) return -1;
  const u = (w - lo) / span;
  return u <= 0 ? 0 : u >= 1 ? 255 : (u * 255 + 0.5) | 0;
}
export function rgbOf(w) {
  const i = idx(w);
  return i < 0 ? UNKNOWN_RGB : RGB[i];
}
export function cssOf(w) {
  const i = idx(w);
  return i < 0 ? "rgb(110,114,122)" : CSS[i];
}

/** Fill an RGBA Uint8Array from a Float32Array of warmth values in one pass. */
export function fillColors(w, out, alpha = 235) {
  for (let i = 0, n = w.length; i < n; i++) {
    const k = idx(w[i]);
    const o = i * 4;
    if (k < 0) {
      out[o] = UNKNOWN_RGB[0]; out[o + 1] = UNKNOWN_RGB[1]; out[o + 2] = UNKNOWN_RGB[2]; out[o + 3] = 120;
    } else {
      const s = k * 4;
      out[o] = LUT[s]; out[o + 1] = LUT[s + 1]; out[o + 2] = LUT[s + 2]; out[o + 3] = alpha;
    }
  }
  return out;
}

export function cssGradient(dir = "to right") {
  return `linear-gradient(${dir}, ${RAMP_HEX.join(", ")})`;
}
