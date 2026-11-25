"""Step 2: per-photo measurements, streamed from the 34 GB Zenodo zip without downloading it.

Zenodo allows 133 requests a minute, so reading photos one by one is slow. The zip stores
every area/band block contiguously, so this reads the central directory once, then pulls
large byte ranges (many photos per request) and cuts the photos out in memory.

Nothing large is stored. For every photo spot we keep:
  - the original thermal JPG (about 4 KB)
  - a 400x300 copy of the RGN photo (for false-color views later)
  - one line of numbers in data/interim/metrics.jsonl
Resumable: frames already in metrics.jsonl are skipped.

Usage: uv run python pipeline/02_metrics.py [--area Delft] [--limit 50] [--workers 4]
"""
import argparse
import io
import json
import struct
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
URL = "https://zenodo.org/records/19440802/files/image_data.zip?download=1"
OUT = ROOT / "data/interim"
THERMAL_DIR, RGN_DIR = OUT / "thermal", OUT / "rgn"
RESULTS = OUT / "metrics.jsonl"
ZIP_INDEX = OUT / "zip_index.parquet"

SKY_C = 5.0          # thermal pixels below this are open sky
NDVI_GREEN = 0.3     # NDVI above this counts as living plants
MIN_SIGNAL = 24.0    # red + NIR must exceed this, otherwise NDVI is dark-pixel noise
GROUND_FROM = 2 / 3  # bottom third of the thermal frame is the street surface (checked by eye)
CHUNK = 64 * 2**20   # bytes per range request
MAX_GAP = 8 * 2**20  # start a new request rather than download a gap bigger than this

_lock = threading.Lock()


# ---------------------------------------------------------------- remote zip access
def zip_index() -> pd.DataFrame:
    if ZIP_INDEX.exists():
        return pd.read_parquet(ZIP_INDEX)
    from remotezip import RemoteZip
    with RemoteZip(URL) as z:
        rows = [(i.filename, i.header_offset, i.compress_size, i.compress_type)
                for i in z.infolist() if not i.is_dir()]
    d = pd.DataFrame(rows, columns=["name", "off", "size", "ctype"])
    d.to_parquet(ZIP_INDEX, index=False)
    return d


def get_range(start: int, end: int) -> bytes:
    """Inclusive byte range, with backoff on 429 / network errors."""
    for attempt in range(10):
        try:
            r = requests.get(URL, headers={"Range": f"bytes={start}-{end}"}, timeout=300)
            if r.status_code == 429:
                time.sleep(int(r.headers.get("retry-after", 60)))
                continue
            r.raise_for_status()
            if len(r.content) != end - start + 1:
                raise IOError("short read")
            return r.content
        except (requests.RequestException, IOError):
            time.sleep(min(120, 3 * 2 ** attempt))
    raise RuntimeError(f"range {start}-{end} failed")


def member(buf: bytes, base: int, e) -> bytes:
    """Cut one zip member out of a downloaded buffer that starts at file offset `base`."""
    p = e.off - base
    if buf[p:p + 4] != b"PK\x03\x04":
        raise ValueError(f"bad local header for {e.name}")
    n, x = struct.unpack("<HH", buf[p + 26:p + 30])
    data = buf[p + 30 + n + x:p + 30 + n + x + e.size]
    return zlib.decompress(data, -15) if e.ctype == 8 else data


def chunks(entries: pd.DataFrame):
    """Group entries (sorted by offset) into contiguous byte ranges of about CHUNK bytes."""
    group, start, end = [], None, None
    for e in entries.itertuples(index=False):
        e_end = e.off + 30 + 512 + e.size  # 512: generous allowance for name + extra fields
        if group and (e_end - start > CHUNK or e.off - end > MAX_GAP):
            yield start, end, group
            group = []
        if not group:
            start = e.off
        group.append(e)
        end = e_end
    if group:
        yield start, end, group


# ---------------------------------------------------------------- measurements
def thermal_metrics(raw: bytes) -> dict:
    t = np.asarray(Image.open(io.BytesIO(raw)).convert("L"), dtype=np.float32) * (40 / 255)
    valid = t >= SKY_C
    ground = t[int(t.shape[0] * GROUND_FROM):]
    gvalid = ground >= SKY_C
    ok = gvalid.mean() > 0.5
    return dict(
        street_temp=float(np.median(ground[gvalid])) if ok else None,
        street_p90=float(np.percentile(ground[gvalid], 90)) if ok else None,
        scene_temp=float(np.median(t[valid])) if valid.any() else None,
        top_temp=float(np.median(t[:t.shape[0] // 3])),
        hot_share=float((t[valid] > 30).mean()) if valid.any() else None,
        sky_share=float(1 - valid.mean()),
    )


def rgn_metrics(raw: bytes, frame: str) -> dict:
    im = Image.open(io.BytesIO(raw))
    im.draft("RGB", (1000, 750))  # JPEG DCT downscale: much faster than a full decode
    im = im.convert("RGB")
    im.resize((400, 300), Image.LANCZOS).save(RGN_DIR / f"{frame}.jpg", quality=88)
    a = np.asarray(im.resize((800, 600), Image.BILINEAR), dtype=np.float32)
    red, nir = a[..., 0], a[..., 2]
    signal = (red + nir) > MIN_SIGNAL
    ndvi = (nir - red) / (nir + red + 1e-6)
    green = (ndvi > NDVI_GREEN) & signal
    return dict(
        green_share=float(green.mean()),
        green_lower=float(green[300:].mean()),
        plant_health=float(np.median(ndvi[green])) if green.sum() > 200 else None,
        rgn_brightness=float(a.mean()),
    )


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--area")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    THERMAL_DIR.mkdir(parents=True, exist_ok=True)
    RGN_DIR.mkdir(parents=True, exist_ok=True)
    frames = pd.read_parquet(OUT / "frames.parquet")
    if args.area:
        frames = frames[frames.AreaName == args.area]
    done = set()
    if RESULTS.exists():
        done = {json.loads(line)["frame"] for line in RESULTS.read_text().splitlines() if line}
    todo = frames[~frames.frame.isin(done)]
    if args.limit:
        todo = todo.head(args.limit)
    print(f"{len(done)} done, {len(todo)} to go", flush=True)
    if todo.empty:
        return

    zi = zip_index().set_index("name")
    def entries(band: str) -> pd.DataFrame:
        names = [f"image_data/{r.AreaName}/{band}/{getattr(r, band)}.jpg" for r in todo.itertuples()]
        e = zi.loc[names].reset_index()
        e["frame"] = todo.frame.values
        return e.sort_values("off")

    # Thermal: a few MB per area, so a handful of requests covers everything.
    therm = {}
    for start, end, group in chunks(entries("Thermal")):
        buf = get_range(start, end)
        for e in group:
            raw = member(buf, start, e)
            (THERMAL_DIR / f"{e.frame}.jpg").write_bytes(raw)
            therm[e.frame] = thermal_metrics(raw)
    print(f"thermal done: {len(therm)}", flush=True)

    # RGN: about 24 GB in 64 MB requests, decoded as they arrive.
    def work(job):
        start, end, group = job
        buf = get_range(start, end)
        return [dict(frame=e.frame, **therm[e.frame], **rgn_metrics(member(buf, start, e), e.frame))
                for e in group]

    jobs = list(chunks(entries("RGN")))
    t0, n = time.time(), 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex, RESULTS.open("a") as out:
        futs = [ex.submit(work, j) for j in jobs]
        for fut in as_completed(futs):
            try:
                rows = fut.result()
            except Exception as err:  # noqa: BLE001 (reported; rerun resumes)
                print(f"CHUNK FAIL: {err}", flush=True)
                continue
            with _lock:
                out.write("".join(json.dumps(r) + "\n" for r in rows))
                out.flush()
            n += len(rows)
            rate = n / (time.time() - t0)
            print(f"{n}/{len(todo)}  {rate:.1f}/s  ~{(len(todo) - n) / rate / 60:.0f} min left", flush=True)


if __name__ == "__main__":
    main()
