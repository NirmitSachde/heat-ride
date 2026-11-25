"""Step 1: index photo triplets (RGB, RGN, Thermal) from the Zenodo metadata."""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
m = pd.read_csv(ROOT / "data/raw/image_metadata.csv", parse_dates=["CaptureTime"])
parts = m.ImageID.str.rsplit("_", n=1)
m["frame"], m["band"] = parts.str[0], parts.str[1]
t = (m.pivot_table(index=["frame", "AreaName"], columns="band", values="ImageID", aggfunc="first")
       .reset_index())
geo = m.drop_duplicates("frame")[["frame", "Latitude", "Longitude", "CaptureTime"]]
t = t.merge(geo, on="frame")
n_all = len(t)
t = t.dropna(subset=["Latitude", "Longitude", "RGB", "RGN", "Thermal"])
t = t.sort_values(["AreaName", "CaptureTime"]).reset_index(drop=True)
(ROOT / "data/interim").mkdir(parents=True, exist_ok=True)
t.to_parquet(ROOT / "data/interim/frames.parquet", index=False)
print(f"{n_all} triplets, {len(t)} with GPS")
print(t.groupby("AreaName").size())
