"""Solar position (NOAA approximation, about 0.5 degree accuracy) and bike heading helpers."""
import numpy as np
import pandas as pd


def solar_position(times_utc: pd.Series, lat: np.ndarray, lon: np.ndarray):
    """Return (azimuth_deg clockwise from north, elevation_deg)."""
    t = pd.DatetimeIndex(times_utc)
    doy = t.dayofyear.values
    hour = t.hour.values + t.minute.values / 60 + t.second.values / 3600
    g = 2 * np.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g)
                    - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
            + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = np.radians(tst / 4 - 180)
    la = np.radians(lat)
    cos_zen = np.sin(la) * np.sin(decl) + np.cos(la) * np.cos(decl) * np.cos(ha)
    zen = np.arccos(np.clip(cos_zen, -1, 1))
    az = np.degrees(np.arctan2(np.sin(ha), np.cos(ha) * np.sin(la) - np.tan(decl) * np.cos(la))) + 180
    return az % 360, 90 - np.degrees(zen)


def headings(lat: np.ndarray, lon: np.ndarray, seg: np.ndarray) -> np.ndarray:
    """Direction of travel (deg from north) from neighbouring photos in the same ride stretch."""
    n = len(lat)
    out = np.full(n, np.nan)
    y = np.radians(lat)
    for i in range(n):
        j0, j1 = i, i
        if i > 0 and seg[i - 1] == seg[i]:
            j0 = i - 1
        if i < n - 1 and seg[i + 1] == seg[i]:
            j1 = i + 1
        if j0 == j1:
            continue
        dx = np.radians(lon[j1] - lon[j0]) * np.cos((y[j0] + y[j1]) / 2)
        dy = y[j1] - y[j0]
        if np.hypot(dx, dy) * 6.371e6 < 3:  # standing still: heading unknown
            continue
        out[i] = np.degrees(np.arctan2(dx, dy)) % 360
    return out
