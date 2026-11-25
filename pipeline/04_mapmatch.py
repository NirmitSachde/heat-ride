"""Step 4: snap every photo spot to its nearest OpenStreetMap street edge (bike network)."""
from pathlib import Path

import geopandas as gpd
import osmnx as ox
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/interim"
ox.settings.use_cache = True
ox.settings.cache_folder = str(OUT / "osm_cache")

frames = pd.read_parquet(OUT / "frames.parquet")
assign, edges_all = [], []
for area, g in frames.groupby("AreaName"):
    pad = 0.003
    bbox = (g.Longitude.min() - pad, g.Latitude.min() - pad, g.Longitude.max() + pad, g.Latitude.max() + pad)
    G = ox.convert.to_undirected(ox.graph_from_bbox(bbox=bbox, network_type="bike", retain_all=True))
    Gp = ox.project_graph(G)
    pts = gpd.GeoSeries(gpd.points_from_xy(g.Longitude, g.Latitude), crs="EPSG:4326").to_crs(Gp.graph["crs"])
    ne, dist = ox.distance.nearest_edges(Gp, X=pts.x.values, Y=pts.y.values, return_dist=True)
    u, v, k = zip(*ne)
    assign.append(pd.DataFrame(dict(frame=g.frame.values, area=area, u=u, v=v, key=k, snap_m=dist)))
    e = ox.graph_to_gdfs(G, nodes=False).reset_index()
    e["name"] = e["name"].apply(lambda s: s[0] if isinstance(s, list) else s)
    e["area"] = area
    edges_all.append(e[["area", "u", "v", "key", "name", "highway", "length", "geometry"]])
    print(area, len(g), "photos", len(e), "edges", f"median snap {pd.Series(dist).median():.1f} m")

pd.concat(assign).to_parquet(OUT / "frame_edges.parquet", index=False)
edges = gpd.GeoDataFrame(pd.concat(edges_all, ignore_index=True), crs="EPSG:4326")
edges["highway"] = edges["highway"].astype(str)
edges.to_parquet(OUT / "edges.parquet", index=False)
