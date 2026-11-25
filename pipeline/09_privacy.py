"""Privacy pass: blur faces/plates, tone-correct, export web frames + review sheets."""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RGB = ROOT / "data/interim/rgb"
OUT = ROOT / "web/public/frames/r"
BIG = ROOT / "data/interim/rgb_big"
REVIEW = ROOT / "data/interim/privacy_review"
GAMMA = 1.2
HOOK = "Oirschot_0451"

C = cv2.data.haarcascades
FRONT = cv2.CascadeClassifier(C + "haarcascade_frontalface_default.xml")
ALT2 = cv2.CascadeClassifier(C + "haarcascade_frontalface_alt2.xml")
PROFILE = cv2.CascadeClassifier(C + "haarcascade_profileface.xml")
PLATE = cv2.CascadeClassifier(C + "haarcascade_russian_plate_number.xml")
MAX_SIDE = 160


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u else 0


def xyxy(r):
    x, y, w, h = [int(v) for v in r]
    return [x, y, x + w, y + h]


def pad(b, f):
    w, h = b[2] - b[0], b[3] - b[1]
    return [b[0] - int(w * f), b[1] - int(h * f), b[2] + int(w * f), b[3] + int(h * f)]


def detect(img):
    g = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    kw = dict(scaleFactor=1.05, minSize=(16, 16))
    f1 = [xyxy(r) for r in FRONT.detectMultiScale(g, minNeighbors=3, **kw)]
    f2 = [xyxy(r) for r in ALT2.detectMultiScale(g, minNeighbors=3, **kw)]
    boxes = [pad(a, 0.35) for a in f1 if any(iou(a, b) > 0.3 for b in f2)]
    boxes += [pad(xyxy(r), 0.35) for r in PROFILE.detectMultiScale(g, minNeighbors=7, **kw)]
    for r in PLATE.detectMultiScale(g, scaleFactor=1.05, minNeighbors=6, minSize=(30, 9)):
        x, y, w, h = [int(v) for v in r]
        if 2 <= w / h <= 6 and w < 200:
            boxes.append(pad([x, y, x + w, y + h], 0.25))
    return [b for b in boxes if (b[2] - b[0]) <= MAX_SIDE and (b[3] - b[1]) <= MAX_SIDE]


def blur(img, boxes):
    H, W = img.shape[:2]
    for x0, y0, x1, y1 in boxes:
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(W, int(x1)), min(H, int(y1))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        r = img[y0:y1, x0:x1]
        h, w = r.shape[:2]
        sm = cv2.resize(r, (max(1, w // 8), max(1, h // 8)), interpolation=cv2.INTER_AREA)
        px = cv2.resize(sm, (w, h), interpolation=cv2.INTER_NEAREST)
        k = max(9, (min(w, h) // 3) | 1)
        img[y0:y1, x0:x1] = cv2.GaussianBlur(px, (k, k), 0)
    return img


def tone(img):
    f = img.astype(np.float32) / 255.0
    y = 0.114 * f[..., 0] + 0.587 * f[..., 1] + 0.299 * f[..., 2]
    p1 = float(np.percentile(y, 1))
    f = np.clip((f - p1) / max(1e-3, 1.0 - p1), 0, 1)  # black-point stretch, top untouched
    f = np.power(f, GAMMA)
    t = 0.8  # slight highlight roll-off
    m = f > t
    f[m] = t + (f[m] - t) * 0.7
    return (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    cands = json.loads((ROOT / "data/interim/hero_candidates.json").read_text())
    manual = json.loads((ROOT / "pipeline/manual_blur.json").read_text())
    sup_f = ROOT / "pipeline/auto_suppress.json"  # auto boxes (by centre) verified as false positives
    suppress = json.loads(sup_f.read_text()) if sup_f.exists() else {}
    drops = {d["frame"] for d in json.loads((ROOT / "pipeline/hero_drop.json").read_text())}
    OUT.mkdir(parents=True, exist_ok=True)
    BIG.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    for old in REVIEW.glob("sheet_*.jpg"):
        old.unlink()
    cache_f = ROOT / "data/interim/privacy_auto.json"
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    kept, thumbs = [], []
    for fr in cands:
        if fr in drops:
            (OUT / f"{fr}.webp").unlink(missing_ok=True)
            continue
        img = cv2.imread(str(RGB / f"{fr}.jpg"))
        if img is None or img.shape[:2] != (720, 1280):
            img = cv2.resize(img, (1280, 720)) if img is not None else None
        if img is None:
            print("missing", fr)
            continue
        if fr not in cache:
            cache[fr] = [[int(v) for v in b] for b in detect(img)]
        sup = suppress.get(fr, [])
        auto = [b for b in cache[fr] if not any(
            s[0] <= (b[0] + b[2]) / 2 <= s[2] and s[1] <= (b[1] + b[3]) / 2 <= s[3] for s in sup)]
        boxes = auto + manual.get(fr, [])
        img = tone(blur(img, boxes))
        rgb = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        rgb.resize((427, 240), Image.LANCZOS).save(OUT / f"{fr}.webp", quality=80)
        if fr == HOOK:
            rgb.save(BIG / f"{fr}.jpg", quality=90)
        kept.append(fr)
        thumbs.append((fr, rgb.resize((640, 360), Image.LANCZOS)))
    cache_f.write_text(json.dumps(cache))
    (ROOT / "data/interim/heroes.json").write_text(json.dumps(kept, indent=1))
    for i in range(0, len(thumbs), 6):
        sheet = Image.new("RGB", (1280, 1080))
        d = ImageDraw.Draw(sheet)
        for j, (fr, t) in enumerate(thumbs[i:i + 6]):
            x, y = (j % 2) * 640, (j // 2) * 360
            sheet.paste(t, (x, y))
            d.rectangle([x, y, x + 150, y + 14], fill=(0, 0, 0))
            d.text((x + 3, y + 1), fr, fill=(255, 255, 0))
        sheet.save(REVIEW / f"sheet_{i // 6:02d}.jpg", quality=88)
    print(f"kept {len(kept)}, dropped {len(drops & set(cands))}, sheets {(len(thumbs) + 5) // 6}")


if __name__ == "__main__":
    main()
