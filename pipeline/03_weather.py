"""Step 3: hourly weather for every ride hour (Open-Meteo historical archive, free, no key)."""
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
frames = pd.read_parquet(ROOT / "data/interim/frames.parquet")
out = []
for area, g in frames.groupby("AreaName"):
    d0, d1 = g.CaptureTime.min().date(), g.CaptureTime.max().date()
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=60, params=dict(
        latitude=round(g.Latitude.mean(), 3), longitude=round(g.Longitude.mean(), 3),
        start_date=str(d0), end_date=str(d1),
        hourly="temperature_2m,shortwave_radiation,cloud_cover,wind_speed_10m",
        timezone="UTC"))
    r.raise_for_status()
    w = pd.DataFrame(r.json()["hourly"])
    w["time"] = pd.to_datetime(w["time"], utc=True)
    w["AreaName"] = area
    out.append(w)
w = pd.concat(out, ignore_index=True)
w.to_parquet(ROOT / "data/interim/weather.parquet", index=False)

frames["hour"] = frames.CaptureTime.dt.floor("h")
j = frames.merge(w, left_on=["AreaName", "hour"], right_on=["AreaName", "time"], how="left")
print("missing weather rows:", j.temperature_2m.isna().sum())
print(j.groupby(["AreaName", j.hour.dt.date]).agg(
    photos=("frame", "size"), air=("temperature_2m", "mean"),
    sun=("shortwave_radiation", "mean"), cloud=("cloud_cover", "mean")).round(1))
