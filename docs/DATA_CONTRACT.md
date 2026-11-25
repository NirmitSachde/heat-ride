# Data contract: pipeline output read by the web app

All files live under `web/public/` and are produced by `pipeline/10_web_export.py`.
Until the real export lands, the web app may use `web/scripts/mock-data.mjs` to write
mock files with exactly this shape (the real export overwrites them).

Area order everywhere (smallest to largest):
Middelbeers (village), Oirschot (town), Delft (small city), Arnhem (big city).

## data/frames.json  (columnar, to keep it small)
```
{
  "areas": ["Middelbeers","Oirschot","Delft","Arnhem"],
  "n": 5192,
  "id":   ["Arnhem_0001", ...],      // frame id, also the image file stem
  "a":    [3, ...],                  // index into areas
  "lon":  [5.90251, ...],            // 5 decimals
  "lat":  [51.98360, ...],
  "t":    [0, ...],                  // seconds since the start of that area's first ride day (int)
  "w":    [1.42, ...],               // relative warmth, C: median warmth of everything the thermal camera saw
                                     // that is not sky (walls, trees, cars, pavement) minus the median of all
                                     // spots ridden in the same place in the same hour. 2 dp.
  "st":   [27.3, ...],               // that surface reading on the camera's own scale, 1 dp (NOT air-comparable)
  "g":    [0.31, ...],               // green share of view (NIR-based), 0..1, 2 dp
  "h":    [0.52, ...],               // plant health (median NDVI of green pixels), 2 dp, null if too few plants
  "hero": [0, ...]                   // 1 if this frame has a full triplet (rgb + nir + thermal) published
}
```

## data/rides.json
```
[ { "area": "Arnhem", "day": "2025-09-26",
    "path": [[lon,lat], ...], "timestamps": [seconds, ...],   // same clock as frames.t
    "w": [warmth per vertex, ...] }, ... ]
```
A ride is split into separate entries wherever two photos are more than 60 s apart.

## data/segments.geojson
FeatureCollection of LineStrings (OSM bike network edges with at least 2 photos).
Properties: `area`, `name` (street name or null), `n` (photos), `warmth` (median warmth above air),
`green` (median green share), `health`, `priority` (rank 1..10 for the 10 stretches where
"a tree here would help most", else null).

## data/story.json
Every number the copy quotes. Keys (values illustrative):
```
{
  "headline_variant": "cooler" | "not_clearly",  // real data: "not_clearly"
  "headline": "one sentence finding",
  "overall": { "spearman": -0.21, "n": 5000,
               "green_coolest20": 0.34, "green_warmest20": 0.18,
               "warmth_median": 5.1, "warmth_p90": 9.8 },
  "areas": { "Arnhem": { "label": "big city", "n": 2306, "spearman": -0.2, "p": 0.001,
                         "warmth_median": 5.0, "air_mean": 17.2, "days": ["2025-09-26","2025-09-27"],
                         "green_median": 0.25, "cool_minus_warm_green": 0.12 }, ... },
  "trees": { "show": true, "health_warm20": 0.48, "health_cool20": 0.55, "spearman": -0.1 },
  "hook_frame": "Arnhem_1229",          // frame for the full-screen hook + chapter 1 slider
  "chapter_frames": { "cool": "...", "warm": "...", "green": "..." },
  "priority_count": 10
}
```

## Images (all webp)
- `frames/t/<id>.webp`  thermal, colorized with the heat ramp, 160x120. Every frame.
- `frames/n/<id>.webp`  near-infrared false color (NDVI: dark for low, #6EE7B7 for high), 320x240. Hero frames only.
- `frames/r/<id>.webp`  normal color photo, 427x240 (16:9), faces and plates blurred. Hero frames only.
- `frames/hook/<id>_{r,n,t}.webp`  large 1280 px versions for the hook frame only.

Heat ramp (one ramp everywhere), stops evenly spaced over warmth-above-air from -2 C to +14 C
for map dots, and over 0..40 C for raw thermal images:
#1B1F3B, #6A2C70, #E1534A, #F9C74F, #FFF6D5.

## Changes after looking at the real data (authoritative)
- The thermal camera reads 13 to 17 C above the air even under full cloud, so absolute values and
  "warmth above air" are NOT used anywhere. `w` is relative warmth (see above). Copy must say
  "warmer / cooler than the other streets ridden that hour", never "X degrees above the air".
- The thermal camera is aimed higher and narrower than the colour cameras: it mostly sees facades,
  trees and cars, little pavement. Say "how warm the street's surfaces were", not "road temperature".
- `g` and `h` are null for photos whose near-infrared exposure was too dark to measure plants
  (about 23% of photos, mostly Arnhem's first day).
- `t` is a compressed ride clock per place: real seconds while riding; any gap over 60 s counts as 5 s.
- story.json adds: `subhead`, `measure_note`, `areas.<A>.model` = {per10_green, per10_green_ci,
  toward_sun, toward_sun_ci, green_effect_clear, n, n_streets} (change in warmth for +10 points of
  green in view, controlling for riding toward the sun and open sky, 95% interval from a
  street-level bootstrap), `areas.<A>.spearman_streets`, `overall.camera_offset_median`,
  `thermal_domain` [lo, hi] used to colour the thermal images, `heat_ramp`, `hook_frame`.
- `trees.show` is false on the real data (no clear plant-health pattern): do not render chapter 5.
