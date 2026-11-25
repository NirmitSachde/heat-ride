"""Step 6: export everything the web app reads (see docs/DATA_CONTRACT.md).

Key decision, made after looking at the data (see docs/FINDINGS.md):
the thermal camera's absolute readings sit 13 to 17 C above the air temperature even under full
cloud, which a real street surface cannot do. So absolute temperatures and "warmth above air" are
not trustworthy. What is trustworthy is the comparison between streets photographed by the same
camera within the same hour. "Warmth" below is therefore: a spot's street-surface reading minus
the median reading of all spots ridden in that place during that same hour.
"""
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import Image
from scipy import stats



ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "data/interim"
PUB = ROOT / "web/public"
DATA = PUB / "data"
AREAS = ["Middelbeers", "Oirschot", "Delft", "Arnhem"]
LABELS = {"Middelbeers": "village", "Oirschot": "town", "Delft": "small city", "Arnhem": "big city"}
MIN_BRIGHT = 30     # RGN photos darker than this have a shifted color balance: no plant measure
GAP_S = 60          # split a ride where photos are further apart than this
HEAT = ["#1B1F3B", "#6A2C70", "#E1534A", "#F9C74F", "#FFF6D5"]

import sys
sys.path.insert(0, str(Path(__file__).parent))
from sun import headings, solar_position  # noqa: E402

d = pd.read_parquet(INT / "final.parquet")
d = d[d.surface_temp.notna()].copy()
d["area_i"] = d.AreaName.map(AREAS.index)

# ---- relative warmth: compared with the other streets ridden in the same place and hour
grp = d.groupby(["AreaName", "day", "hour"]).surface_temp
size = grp.transform("size")
d["ref"] = np.where(size >= 15, grp.transform("median"),
                    d.groupby(["AreaName", "day"]).surface_temp.transform("median"))
d["w"] = d.surface_temp - d.ref
d["g_ok"] = d.rgn_brightness >= MIN_BRIGHT
d.loc[~d.g_ok, ["green_share", "plant_health"]] = np.nan

# ---- compressed ride clock: real time while riding, gaps longer than GAP_S shrink to 5 s
d = d.sort_values(["AreaName", "CaptureTime"])
dt = d.groupby("AreaName").CaptureTime.diff().dt.total_seconds().fillna(0)
d["new_seg"] = (dt > GAP_S) | (dt == 0) & (d.AreaName != d.AreaName.shift())
d["clock"] = np.where(dt > GAP_S, 5, dt)
d["t"] = d.groupby("AreaName").clock.cumsum().round().astype(int)
d["seg"] = d.new_seg.cumsum()
d = d.reset_index(drop=True)

# ---- which way was the bike riding relative to the sun? (the camera faces forward)
az, el = solar_position(d.CaptureTime, d.Latitude.values, d.Longitude.values)
d["sun_el"] = el
d["heading"] = headings(d.Latitude.values, d.Longitude.values, d.seg.values)
d["toward_sun"] = np.cos(np.radians(d.heading - az))   # +1 riding into the sun, -1 sun behind

# ---- segments (OSM street edges) with at least 2 photos
edges = gpd.read_parquet(INT / "edges.parquet")
agg = (d.groupby(["AreaName", "u", "v", "key"])
         .agg(n=("frame", "size"), warmth=("w", "median"), green=("green_share", "median"),
              health=("plant_health", "median"), n_green=("green_share", "count"),
              frames=("frame", list))
         .reset_index())
agg = agg[agg.n >= 2]
seg = edges.merge(agg, left_on=["area", "u", "v", "key"], right_on=["AreaName", "u", "v", "key"])

# priority: warm AND not green, within each place; at least 3 photos with a plant reading
cand = seg[(seg.n >= 3) & (seg.n_green >= 3)].copy()
cand["score"] = (cand.groupby("area").warmth.rank(pct=True)
                 + 1 - cand.groupby("area").green.rank(pct=True))
cand = cand.sort_values("score", ascending=False)
picked, per_area, names = [], {}, set()
for idx, r in cand.iterrows():  # named streets only, each once, at most 3 per place
    key = (r["area"], r["name"])
    if pd.isna(r["name"]) or key in names:
        continue
    if per_area.get(r["area"], 0) < 3 and len(picked) < 10:
        picked.append(idx)
        names.add(key)
        per_area[r["area"]] = per_area.get(r["area"], 0) + 1
seg["priority"] = None
for rank, idx in enumerate(picked, 1):
    seg.loc[idx, "priority"] = rank

# ---- statistics for the copy
def rho(a, b):
    ok = a.notna() & b.notna()
    r = stats.spearmanr(a[ok], b[ok])
    return round(float(r.statistic), 3), float(r.pvalue), int(ok.sum())

def edge_rho(s):
    s = s[(s.n_green >= 2)]
    r = stats.spearmanr(s.green, s.warmth)
    return round(float(r.statistic), 3), int(len(s))

g = d[d.g_ok]
q = g.groupby("AreaName").w.transform(lambda s: pd.qcut(s, 5, labels=False))
gq = g.groupby("AreaName").green_share.transform(lambda s: pd.qcut(s.rank(method="first"), 5, labels=False))
story = {"mock": False, "areas": {}, "area_order": AREAS}
for a in AREAS:
    ga, da = g[g.AreaName == a], d[d.AreaName == a]
    r, p, n = rho(ga.green_share, ga.w)
    er, en = edge_rho(seg[seg["area"] == a])
    qa, gqa = q[ga.index], gq[ga.index]
    story["areas"][a] = dict(
        label=LABELS[a], n=int(len(da)), n_green=n, spearman=r, p=p,
        spearman_streets=er, n_streets=en,
        days=sorted(da.day.unique().tolist()),
        air_mean=round(float(da.temperature_2m.mean()), 1),
        cloud_mean=round(float(da.cloud_cover.mean())),
        green_median=round(float(ga.green_share.median()), 3),
        green_coolest20=round(float(ga.green_share[qa == 0].median()), 3),
        green_warmest20=round(float(ga.green_share[qa == 4].median()), 3),
        warmth_greenest20=round(float(ga.w[gqa == 4].median()), 2),
        warmth_leastgreen20=round(float(ga.w[gqa == 0].median()), 2),
        warmth_spread=round(float(da.w.quantile(0.9) - da.w.quantile(0.1)), 2),
    )
r, p, n = rho(g.green_share, g.w)
er, en = edge_rho(seg)
story["overall"] = dict(
    spearman=r, p=p, n=n, spearman_streets=er, n_streets=en, n_frames=int(len(d)),
    green_coolest20=round(float(g.green_share[q == 0].median()), 3),
    green_warmest20=round(float(g.green_share[q == 4].median()), 3),
    warmth_greenest20=round(float(g.w[gq == 4].median()), 2),
    warmth_leastgreen20=round(float(g.w[gq == 0].median()), 2),
    warmth_p10=round(float(d.w.quantile(0.1)), 2), warmth_p90=round(float(d.w.quantile(0.9)), 2),
    camera_offset_median=round(float((d.surface_temp - d.temperature_2m).median()), 1),
)
# ---- the controlled test: warmth ~ green + riding toward the sun + open sky,
# with 95% intervals from a bootstrap that resamples whole streets (photos on one street are not independent)
def fit(x):
    X = np.column_stack([np.ones(len(x)), x.green_share * 10, x.toward_sun, x.sky_share * 10])
    return np.linalg.lstsq(X, x.w.values, rcond=None)[0]

rng = np.random.default_rng(7)
mx = g[g.toward_sun.notna()].copy()
mx["eid"] = mx.AreaName + "_" + mx.u.astype(str) + "_" + mx.v.astype(str)
for a in AREAS:
    x = mx[mx.AreaName == a]
    b = fit(x)
    ids = x.eid.unique()
    rows = {k: v.index.values for k, v in x.groupby("eid")}
    boot = np.array([fit(x.loc[np.concatenate([rows[k] for k in rng.choice(ids, len(ids))])])
                     for _ in range(1000)])
    lo, hi = np.percentile(boot, [2.5, 97.5], axis=0)
    clear = bool(hi[1] < 0 or lo[1] > 0)
    story["areas"][a]["model"] = dict(
        per10_green=round(float(b[1]), 2), per10_green_ci=[round(float(lo[1]), 2), round(float(hi[1]), 2)],
        toward_sun=round(float(b[2]), 2), toward_sun_ci=[round(float(lo[2]), 2), round(float(hi[2]), 2)],
        green_effect_clear=clear, n=int(len(x)), n_streets=int(len(ids)))

hr, hp, hn = rho(g.plant_health, g.w)
story["trees"] = dict(spearman=hr, p=hp, n=hn,
                      health_warm20=round(float(g.plant_health[q == 4].median()), 3),
                      health_cool20=round(float(g.plant_health[q == 0].median()), 3))
story["trees"]["show"] = bool(abs(hr) >= 0.1 and hp < 0.001)
story["ramp_domain"] = [round(float(d.w.quantile(0.03)), 1), round(float(d.w.quantile(0.97)), 1)]
story["priority_count"] = len(picked)

DATA.mkdir(parents=True, exist_ok=True)
(INT / "story_stats.json").write_text(json.dumps(story, indent=2))
d.to_parquet(INT / "export_frames.parquet", index=False)
seg_out = seg[["area", "name", "n", "warmth", "green", "health", "priority", "frames", "geometry"]].copy()
seg_out.to_parquet(INT / "segments.parquet", index=False)
print(json.dumps(story, indent=1))
