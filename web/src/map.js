// MapLibre (CARTO dark matter) with a deck.gl overlay. Layers are rebuilt at most once per
// master-clock tick, and only when something changed. Every accessor is defined at module
// level so deck.gl never sees a new function between renders.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { onTick, tween } from "./clock.js";
import { countUntil } from "./data.js";

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const PHONE_DOT_LIMIT = 2000;

// ---- module-level accessors and constants ----
const getRidePath = (d) => d.path;
const getRideTimes = (d) => d.ts;
const getRideColors = (d) => d.colors;
const getSegPath = (f) => f._path;
const getSegColor = (f) => f._rgb;
const getHlPos = (d) => d.p;
const getCursor = ({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab");
const HL_LINE = [255, 246, 213, 255];
const GLOW = [255, 246, 213, 70];

export function createMap(container, model, { isPhone, onPick }) {
  const { frames, rides, segments } = model;
  const areaIndex = (name) => frames.areas.indexOf(name);
  const start = frames.ranges[areaIndex("Arnhem")]?.bounds || frames.ranges.find((r) => r.bounds)?.bounds;

  const map = new maplibregl.Map({
    container,
    style: STYLE,
    bounds: start,
    fitBoundsOptions: { padding: 40 },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: 0,
    maxPitch: 0,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
  // phones: start the compact attribution folded (the (i) button opens it), so it never covers the story
  if (isPhone()) map.once("load", () => container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  for (const h of ["dragPan", "scrollZoom", "boxZoom", "doubleClickZoom", "touchZoomRotate", "keyboard", "touchPitch"]) map[h].disable();

  // ---- layer state ----
  const s = {
    dotsKey: null, dots: null, dotsOpacity: 1, pickable: false, radius: 2.6,
    progressiveArea: -1, progressiveK: -1,
    tripsArea: -1, time: 0, target: 0,
    segments: false, segOpacity: 1,
    hl: null,
  };

  const dotCache = new Map();
  function dotsFor(key) {
    if (dotCache.has(key)) return dotCache.get(key);
    let d;
    if (key === "all") {
      d = { length: frames.n, offset: 0, attributes: { getPosition: { value: frames.pos, size: 2 }, getFillColor: { value: frames.colors, size: 4, normalized: true } } };
    } else if (key.startsWith("lite:")) {
      // phones: an even subsample of one place, at most PHONE_DOT_LIMIT dots
      const r = frames.ranges[areaIndex(key.slice(5))];
      const total = r.end - r.start;
      const stride = Math.max(1, Math.ceil(total / PHONE_DOT_LIMIT));
      const m = Math.ceil(total / stride);
      const idx = new Uint32Array(m);
      const pos = new Float32Array(m * 2);
      const col = new Uint8Array(m * 4);
      for (let j = 0, i = r.start; j < m; j++, i += stride) {
        idx[j] = i;
        pos[2 * j] = frames.pos[2 * i]; pos[2 * j + 1] = frames.pos[2 * i + 1];
        col.set(frames.colors.subarray(4 * i, 4 * i + 4), 4 * j);
      }
      d = { length: m, idx, attributes: { getPosition: { value: pos, size: 2 }, getFillColor: { value: col, size: 4, normalized: true } } };
    } else {
      const r = frames.ranges[areaIndex(key)];
      d = {
        length: r.end - r.start, offset: r.start,
        attributes: {
          getPosition: { value: frames.pos.subarray(2 * r.start, 2 * r.end), size: 2 },
          getFillColor: { value: frames.colors.subarray(4 * r.start, 4 * r.end), size: 4, normalized: true },
        },
      };
    }
    dotCache.set(key, d);
    return d;
  }
  const frameOf = (data, i) => (data.idx ? data.idx[i] : data.offset + i);

  function progressiveData(ai, k) {
    const r = frames.ranges[ai];
    return {
      length: k, offset: r.start,
      attributes: {
        getPosition: { value: frames.pos.subarray(2 * r.start, 2 * (r.start + k)), size: 2 },
        getFillColor: { value: frames.colors.subarray(4 * r.start, 4 * (r.start + k)), size: 4, normalized: true },
      },
    };
  }

  const onDotClick = (info) => {
    if (info && info.index >= 0 && s.dots) onPick && onPick(frameOf(s.dots, info.index));
    return true;
  };

  function build() {
    const layers = [];
    if (s.segments) {
      layers.push(new PathLayer({
        id: "seg-glow", data: segments.priority, getPath: getSegPath, getColor: GLOW,
        widthUnits: "pixels", getWidth: 16, capRounded: true, jointRounded: true, opacity: s.segOpacity,
      }));
      layers.push(new PathLayer({
        id: "seg", data: segments.priority, getPath: getSegPath, getColor: getSegColor,
        widthUnits: "pixels", getWidth: 6, capRounded: true, jointRounded: true, opacity: s.segOpacity,
      }));
    }
    if (s.tripsArea >= 0) {
      layers.push(new TripsLayer({
        id: "trips", data: rides[s.tripsArea], getPath: getRidePath, getTimestamps: getRideTimes,
        getColor: getRideColors, widthUnits: "pixels", getWidth: 2.5, capRounded: true, jointRounded: true,
        fadeTrail: false, trailLength: 1e9, currentTime: s.time, opacity: 0.55,
      }));
    }
    if (s.dots && s.dots.length > 0) {
      layers.push(new ScatterplotLayer({
        id: "dots", data: s.dots, radiusUnits: "pixels", getRadius: s.radius, stroked: false,
        opacity: s.dotsOpacity, pickable: s.pickable, autoHighlight: s.pickable,
        highlightColor: HL_LINE, onClick: onDotClick,
      }));
    }
    if (s.hl) {
      layers.push(new ScatterplotLayer({
        id: "hl", data: [s.hl], getPosition: getHlPos, radiusUnits: "pixels", getRadius: 9,
        stroked: true, filled: false, getLineColor: HL_LINE, lineWidthUnits: "pixels", getLineWidth: 2.5,
      }));
    }
    return layers;
  }

  const overlay = new MapboxOverlay({ interleaved: true, layers: [], getCursor });
  map.addControl(overlay);

  let dirty = false;
  const flush = () => {
    dirty = false;
    overlay.setProps({ layers: build() });
    return false;
  };
  function invalidate() {
    if (!dirty) {
      dirty = true;
      onTick(flush);
    }
  }

  // ---- ride clock: eases toward the scroll target on the master clock ----
  let rideTicking = false;
  const rideTick = (now, dt) => {
    const diff = s.target - s.time;
    if (Math.abs(diff) < 0.5) {
      s.time = s.target;
      rideTicking = false;
    } else {
      s.time += diff * Math.min(1, dt / 240);
    }
    syncProgressive();
    invalidate();
    return rideTicking;
  };
  function syncProgressive() {
    if (s.progressiveArea < 0) return;
    const k = countUntil(frames, s.progressiveArea, s.time);
    if (k !== s.progressiveK) {
      s.progressiveK = k;
      s.dots = progressiveData(s.progressiveArea, k);
    }
  }
  function setRideProgress(p, instant = false) {
    if (s.tripsArea < 0) return;
    const dur = frames.ranges[s.tripsArea].duration;
    s.target = Math.max(0, Math.min(1, p)) * dur;
    if (instant) {
      s.time = s.target;
      syncProgressive();
      invalidate();
      return;
    }
    if (!rideTicking) {
      rideTicking = true;
      onTick(rideTick);
    }
  }

  // ---- camera: tweened on the master clock (600 ms ease in-out) ----
  let cancelCam = null;
  let camKey = "";
  function padding(layout) {
    const w = window.innerWidth, h = window.innerHeight;
    const phone = isPhone();
    const p = { top: 48, bottom: 48, left: 48, right: 48 };
    if (phone) {
      if (layout === "split") { p.bottom = h * 0.56 + 16; p.top = 56; }
      else if (layout === "list") { p.bottom = h * 0.42 + 16; p.top = 56; }
      else if (layout === "explore") { p.top = 96; p.bottom = 40; }
      else p.bottom = h * 0.3;
    } else {
      p.left = Math.min(500, w * 0.36);
      if (layout === "split") { p.left = 48; p.right = w * 0.46 + 24; }
      else if (layout === "list") p.right = Math.min(420, w * 0.32) + 24;
      else if (layout === "explore") p.top = 96;
    }
    return p;
  }
  function boundsOfPriority() {
    // the stretches can sit in several places: frame the place of the top-ranked one
    const top = segments.priority[0];
    if (!top) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of segments.priority) {
      if (f.properties.area !== top.properties.area) continue;
      for (const [x, y] of f._path) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const pad = 0.004;
    return [[minX - pad, minY - pad], [maxX + pad, maxY + pad]];
  }
  function cameraFor(cam, layout) {
    let b = null;
    if (cam.bounds) b = cam.bounds;
    else if (cam.priority) b = boundsOfPriority();
    else if (cam.area) b = frames.ranges[areaIndex(cam.area)]?.bounds;
    if (!b) return null;
    const c = map.cameraForBounds(b, { padding: padding(layout), maxZoom: cam.maxZoom || 16 });
    if (!c) return null;
    return { center: maplibregl.LngLat.convert(c.center), zoom: c.zoom };
  }
  function moveCamera(cam, layout, instant = false, force = false) {
    if (!cam) return;
    const key = JSON.stringify(cam) + layout + window.innerWidth + "x" + window.innerHeight;
    if (key === camKey && !force) return;
    camKey = key;
    const to = cameraFor(cam, layout);
    if (!to) return;
    if (cancelCam) cancelCam();
    if (instant) { map.jumpTo(to); return; }
    const c0 = map.getCenter(), z0 = map.getZoom();
    const dKm = Math.hypot((to.center.lng - c0.lng) * 69, (to.center.lat - c0.lat) * 111);
    const dip = Math.min(6, Math.max(0, Math.log2(dKm / 3 + 1)));
    cancelCam = tween({
      onUpdate: (_, e) => {
        map.jumpTo({
          center: [c0.lng + (to.center.lng - c0.lng) * e, c0.lat + (to.center.lat - c0.lat) * e],
          zoom: z0 + (to.zoom - z0) * e - dip * Math.sin(Math.PI * e),
        });
      },
      onDone: () => { cancelCam = null; },
    });
  }

  // ---- priority rank markers ----
  let markers = null;
  function showRanks(on, onRank) {
    if (on && !markers) {
      markers = segments.priority.map((f) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "rank-marker";
        el.textContent = f.properties.priority;
        el.setAttribute("aria-label", `Stretch ${f.properties.priority}: a tree here would help most`);
        el.addEventListener("click", () => onRank && onRank(f));
        return new maplibregl.Marker({ element: el }).setLngLat(f._mid);
      });
    }
    if (!markers) return;
    for (const m of markers) on ? m.addTo(map) : m.remove();
  }

  function fadeDots() {
    s.dotsOpacity = 0;
    tween({ onUpdate: (v) => { s.dotsOpacity = v; invalidate(); } });
  }

  let nav = null;
  function setInteractive(on) {
    const hs = ["dragPan", "scrollZoom", "doubleClickZoom", "touchZoomRotate", "keyboard"];
    for (const h of hs) on ? map[h].enable() : map[h].disable();
    if (on) map.touchZoomRotate.disableRotation();
    if (map.cooperativeGestures) on ? map.cooperativeGestures.enable() : map.cooperativeGestures.disable();
    if (on && !nav) { nav = new maplibregl.NavigationControl({ showCompass: false }); map.addControl(nav, "bottom-right"); }
    if (!on && nav) { map.removeControl(nav); nav = null; }
    s.pickable = on;
    invalidate();
  }

  /** Apply a chapter + step config (see chapters.js). */
  function apply(ch, step, { instant = false, exploreArea = "Arnhem" } = {}) {
    const L = ch.layers || {};
    // dots
    let key = null;
    if (L.dots === "explore") key = isPhone() ? `lite:${exploreArea}` : "all";
    else key = L.dots || null;
    const progressiveArea = L.progressive && L.dots ? areaIndex(L.dots) : -1;
    if (progressiveArea !== s.progressiveArea) { s.progressiveArea = progressiveArea; s.progressiveK = -1; }
    if (progressiveArea >= 0) {
      s.dotsKey = "progressive";
    } else if (key !== s.dotsKey) {
      s.dotsKey = key;
      s.dots = key ? dotsFor(key) : null;
      if (key && !instant) fadeDots();
    }
    // trips
    const ta = L.trips ? areaIndex(L.trips) : -1;
    if (ta !== s.tripsArea) { s.tripsArea = ta; s.time = 0; s.target = 0; }
    if (ch.time === "full" && ta >= 0) setRideProgress(1, true);
    syncProgressive();
    // segments
    s.segments = L.segments === "priority";
    s.radius = ch.id === "explore" ? 3.2 : ch.id === "question" ? 2.4 : 2.8;
    if (!ch.interactive) s.pickable = false;
    invalidate();
    moveCamera(ch.camera, ch.layout, instant);
  }

  function setHighlight(i) {
    s.hl = i == null || i < 0 ? null : { p: [frames.pos[2 * i], frames.pos[2 * i + 1]], i };
    invalidate();
  }

  function focusFrame(i, layout) {
    const ai = frames.a[i];
    moveCamera({ area: frames.areas[ai] }, layout);
  }

  function flyToSegment(f, layout) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of f._path) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const pad = 0.004;
    moveCamera({ bounds: [[minX - pad, minY - pad], [maxX + pad, maxY + pad]], maxZoom: 16 }, layout);
  }

  function refit(ch) {
    if (ch && ch.camera) moveCamera(ch.camera, ch.layout, true, true);
  }

  const debugState = () => ({ time: s.time, target: s.target, trips: s.tripsArea, k: s.progressiveK, dots: s.dots && s.dots.length, center: map.getCenter(), zoom: map.getZoom(), dur: s.tripsArea >= 0 ? frames.ranges[s.tripsArea].duration : 0 });
  return { map, debugState, apply, setRideProgress, setHighlight, focusFrame, flyToSegment, showRanks, setInteractive, refit, moveCamera };
}
