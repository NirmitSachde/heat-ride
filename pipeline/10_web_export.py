"""Step 10: write the files the web app reads (docs/DATA_CONTRACT.md).

Inputs: data/interim/export_frames.parquet, segments.parquet, story_stats.json (from 06_export.py),
        pipeline/story_copy.json (headline and chosen frames, written by hand after looking at the data),
        data/interim/heroes.json (frames whose blurred color photo is published, from 08_heroes.py).
"""
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "data/interim"
PUB = ROOT / "web/public"
DATA, FR = PUB / "data", PUB / "frames"
AREAS = ["Middelbeers", "Oirschot", "Delft", "Arnhem"]
HEAT = ["#1B1F3B", "#6A2C70", "#E1534A", "#F9C74F", "#FFF6D5"]
PLANT = (0x6E, 0xE7, 0xB7)


def ramp_lut(stops):
    rgb = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in stops], dtype=np.float32)
    x = np.linspace(0, 1, 256)
    xs = np.linspace(0, 1, len(stops))
    return np.stack([np.interp(x, xs, rgb[:, c]) for c in range(3)], axis=1).astype(np.uint8)


LUT = ramp_lut(HEAT)


def colorize_thermal(path: Path, lo: float, hi: float) -> Image.Image:
    t = np.asarray(Image.open(path).convert("L"), dtype=np.float32) * 40 / 255
    idx = np.clip((t - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(LUT[idx])


def nir_view(path: Path, size) -> Image.Image:
    """Near-infrared view: NIR channel as a dim grey, living plants (NDVI > 0.3) glow mint."""
    a = np.asarray(Image.open(path).convert("RGB").resize(size, Image.LANCZOS), dtype=np.float32)
    red, nir = a[..., 0], a[..., 2]
    ndvi = (nir - red) / (nir + red + 1e-6)
    base = np.clip(nir / max(np.percentile(nir, 99), 1), 0, 1)[..., None] * 0.55
    k = np.clip((ndvi - 0.15) / 0.35, 0, 1)[..., None] * ((red + nir) > 24)[..., None]
    out = base * 255 * (1 - k) + np.array(PLANT) * (0.35 + 0.65 * base / 0.55) * k
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main() -> None:
    d = pd.read_parquet(INT / "export_frames.parquet").sort_values(["area_i", "t"])
    seg = gpd.read_parquet(INT / "segments.parquet")
    story = json.loads((INT / "story_stats.json").read_text())
    copy = json.loads((ROOT / "pipeline/story_copy.json").read_text())
    heroes = set(json.loads((INT / "heroes.json").read_text())) if (INT / "heroes.json").exists() else set()
    for sub in ("t", "n", "r", "hook"):
        (FR / sub).mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)

    # one fixed colour stretch for every thermal image, so colours are comparable across photos
    lo, hi = copy.get("thermal_domain", [14.0, 34.0])

    # frames.json (columnar)
    def col(s, nd):
        return [None if pd.isna(v) else round(float(v), nd) for v in s]
    frames = dict(
        areas=AREAS, n=len(d), id=d.frame.tolist(), a=d.area_i.astype(int).tolist(),
        lon=col(d.Longitude, 5), lat=col(d.Latitude, 5), t=d.t.astype(int).tolist(),
        w=col(d.w, 2), st=col(d.surface_temp, 1), g=col(d.green_share, 2), h=col(d.plant_health, 2),
        hero=[int(f in heroes) for f in d.frame],
    )
    (DATA / "frames.json").write_text(json.dumps(frames, separators=(",", ":")))

    # rides.json: one path per continuous stretch of riding
    rides = []
    for (area, seg_id), g in d.groupby(["AreaName", "seg"], sort=False):
        if len(g) < 2:
            continue
        rides.append(dict(area=area, day=g.day.iloc[0],
                          path=[[round(x, 5), round(y, 5)] for x, y in zip(g.Longitude, g.Latitude)],
                          timestamps=g.t.astype(int).tolist(), w=col(g.w, 2)))
    (DATA / "rides.json").write_text(json.dumps(rides, separators=(",", ":")))

    # segments.geojson
    seg = seg.drop(columns=["frames"]).copy()
    for c in ("warmth", "green", "health"):
        seg[c] = seg[c].round(2)
    seg["priority"] = seg["priority"].astype("float").astype("Int64")
    seg.to_file(DATA / "segments.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

    # thermal thumbnails for every frame
    for f in d.frame:
        out = FR / "t" / f"{f}.webp"
        if not out.exists():
            colorize_thermal(INT / "thermal" / f"{f}.jpg", lo, hi).save(out, quality=82, method=6)

    # near-infrared views for hero frames (+ the frames named in the copy)
    named = set(copy.get("chapter_frames", {}).values()) | {copy["hook_frame"]}
    for f in heroes | named:
        nir_view(INT / "rgn" / f"{f}.jpg", (320, 240)).save(FR / "n" / f"{f}.webp", quality=80, method=6)

    # big versions for the hook frame
    hf = copy["hook_frame"]
    colorize_thermal(INT / "thermal" / f"{hf}.jpg", lo, hi).resize((1280, 960), Image.BICUBIC) \
        .save(FR / "hook" / f"{hf}_t.webp", quality=85)
    nir_view(INT / "rgn" / f"{hf}.jpg", (400, 300)).resize((1280, 960), Image.BICUBIC) \
        .save(FR / "hook" / f"{hf}_n.webp", quality=85)
    big_rgb = INT / "rgb_big" / f"{hf}.jpg"
    if big_rgb.exists():
        Image.open(big_rgb).save(FR / "hook" / f"{hf}_r.webp", quality=85)

    story.update({k: v for k, v in copy.items()})
    story["thermal_domain"] = [lo, hi]
    story["heat_ramp"] = HEAT
    (DATA / "story.json").write_text(json.dumps(story, indent=1))
    print(f"frames {len(d)}, rides {len(rides)}, segments {len(seg)}, heroes {len(heroes)}")


if __name__ == "__main__":
    main()
