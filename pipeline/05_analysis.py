"""Step 5: join everything into one table and test the question honestly.

Writes data/interim/final.parquet and data/interim/analysis.json.
"""
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from scipy import stats

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/interim"

m = pd.read_json(OUT / "metrics.jsonl", lines=True).drop_duplicates("frame", keep="last")
f = pd.read_parquet(OUT / "frames.parquet")
w = pd.read_parquet(OUT / "weather.parquet")
fe = pd.read_parquet(OUT / "frame_edges.parquet")

# Recompute thermal numbers from the stored originals so every row uses the same code.
# The thermal camera is aimed higher and narrower than the colour cameras: by eye, it mostly sees
# facades, trees, cars and sky, with little pavement. So we measure the warmth of everything
# along the street that is not sky, not the road surface alone.
ROWS = np.arange(120, dtype=np.float32)[:, None] * np.ones((1, 160), dtype=np.float32)


def otsu(x: np.ndarray) -> float:
    hist, edges = np.histogram(x, bins=128)
    p = hist / hist.sum()
    mids = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(p)
    m0 = np.cumsum(p * mids)
    between = (m0[-1] * w0 - m0) ** 2 / (w0 * (1 - w0) + 1e-12)
    return float(mids[np.argmax(between)])


def sky_mask(t: np.ndarray) -> np.ndarray:
    """Sky = the cold class of a two-class split, if it is clearly colder and sits higher in the frame."""
    sky = t < 5
    thr = otsu(t)
    lo, hi = t < thr, t >= thr
    if 0.03 < lo.mean() < 0.85:
        gap = t[hi].mean() - t[lo].mean()
        higher = ROWS[lo].mean() < ROWS[hi].mean()
        if gap > 4 and higher:
            sky |= lo
    return sky


def thermal(frame):
    t = np.asarray(Image.open(OUT / "thermal" / f"{frame}.jpg").convert("L"), dtype=np.float32) * 40 / 255
    sky = sky_mask(t)
    surf = t[~sky]
    ok = surf.size > 0.15 * t.size
    return pd.Series(dict(
        surface_temp=float(np.median(surf)) if ok else np.nan,
        surface_p90=float(np.percentile(surf, 90)) if ok else np.nan,
        sky_share=float(sky.mean()),
        sat_share=float((t >= 39.5).mean()),
        t_range=float(np.percentile(t, 95) - np.percentile(t, 5)),
    ))


th = m.frame.apply(thermal)
m = pd.concat([m.drop(columns=[c for c in th.columns if c in m]), th], axis=1)

d = f.merge(m, on="frame").merge(fe[["frame", "u", "v", "key", "snap_m"]], on="frame", how="left")
d["hour"] = d.CaptureTime.dt.floor("h")
d = d.merge(w, left_on=["AreaName", "hour"], right_on=["AreaName", "time"], how="left").drop(columns="time")
d["day"] = d.CaptureTime.dt.date.astype(str)
d["above_air"] = d.surface_temp - d.temperature_2m
d["dark"] = d.rgn_brightness < 20
d.to_parquet(OUT / "final.parquet", index=False)
print(len(d), "rows;", d.dark.sum(), "dark RGN;", d.surface_temp.isna().sum(), "no surface reading")
