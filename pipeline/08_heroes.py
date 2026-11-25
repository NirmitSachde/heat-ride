"""Step 8: choose the ~300 hero spots whose normal-colour photo is published, and fetch those photos.

Writes data/interim/hero_candidates.json and data/interim/rgb/<frame>.jpg (1280x720, unblurred,
never published). Blurring and the by-eye check happen in 09_privacy.py, which writes heroes.json.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import importlib  # noqa: E402

m2 = importlib.import_module("02_metrics")
ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "data/interim"
RGB = INT / "rgb"
RGB.mkdir(exist_ok=True)

d = pd.read_parquet(INT / "export_frames.parquet")
good = d[d.g_ok & (d.sat_share < 0.02)]
seg = gpd.read_parquet(INT / "segments.parquet")
copy = json.loads((ROOT / "pipeline/story_copy.json").read_text()) if (ROOT / "pipeline/story_copy.json").exists() else {}

pick: list[str] = []
def add(frames):
    for f in frames:
        if f not in pick:
            pick.append(f)

add(copy.get("hook_candidates", []))
for _, r in seg[seg.priority.notna()].iterrows():          # two photos per priority street
    add([f for f in r.frames if f in set(good.frame)][:2])
for a, g in good.groupby("AreaName"):                        # extremes per place
    add(g.nlargest(6, "w").frame); add(g.nsmallest(6, "w").frame); add(g.nlargest(6, "green_share").frame)
# spatial spread for explore mode: one per ~grid cell, until about 300
rng = np.random.default_rng(1)
cells = good.assign(cx=(good.Longitude * 300).round(), cy=(good.Latitude * 450).round())
spread = cells.groupby(["AreaName", "cx", "cy"]).frame.apply(lambda s: s.iloc[rng.integers(len(s))])
add(rng.permutation(spread.values)[: max(0, 300 - len(pick))])
pick = pick[:320]
(INT / "hero_candidates.json").write_text(json.dumps(pick))
print(len(pick), "hero candidates")

# fetch the RGB photos (grouped into range requests)
f = pd.read_parquet(INT / "frames.parquet").set_index("frame")
zi = m2.zip_index().set_index("name")
need = [x for x in pick if not (RGB / f"{x}.jpg").exists()]
names = [f"image_data/{f.loc[x, 'AreaName']}/RGB/{f.loc[x, 'RGB']}.jpg" for x in need]
e = zi.loc[names].reset_index()
e["frame"] = need
e = e.sort_values("off")
m2.MAX_GAP = 4 * 2**20
n = 0
for start, end, group in m2.chunks(e):
    buf = m2.get_range(start, end)
    for row in group:
        im = Image.open(__import__("io").BytesIO(m2.member(buf, start, row)))
        im.draft("RGB", (2304, 1296))
        im.convert("RGB").resize((1280, 720), Image.LANCZOS).save(RGB / f"{row.frame}.jpg", quality=90)
        n += 1
print("fetched", n)
