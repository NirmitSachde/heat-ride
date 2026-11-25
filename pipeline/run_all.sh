#!/bin/sh
# Rebuild everything from scratch. Needs ~1 GB free disk and about 15 minutes on a fast connection.
set -e
cd "$(dirname "$0")/.."
mkdir -p data/raw
curl -sL -o data/raw/image_metadata.csv "https://zenodo.org/api/records/19440802/files/image_metadata.csv/content"
uv run python pipeline/01_index.py
uv run python pipeline/02_metrics.py --workers 6
uv run python pipeline/03_weather.py
uv run python pipeline/04_mapmatch.py
uv run python pipeline/05_analysis.py
uv run python pipeline/06_export.py
uv run python pipeline/08_heroes.py
uv run python pipeline/09_privacy.py
uv run python pipeline/10_web_export.py
