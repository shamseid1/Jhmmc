# The Plotter map's land: GSHHG's full-resolution coastline (Wessel & Smith, version 2.3.7,
# LGPL; https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip), the chart's coast cut
# out and simplified to about 45 m, as rings of [lat, lng] in public/land-fine.json.
# Needs pyshp and shapely: unzip GSHHS_shp/f/GSHHS_f_L1.* then python3 gshhg_coast.py.
import json, shapefile
from shapely.geometry import shape, box, Polygon, MultiPolygon
area = box(-19.0, 0.5, -5.5, 13.5)  # lng/lat: the chart's area and a margin
r = shapefile.Reader('GSHHS_shp/f/GSHHS_f_L1')
rings = []; pts = 0
for sr in r.iterShapeRecords():
    b = sr.shape.bbox
    if b[2] < -19 or b[0] > -5.5 or b[3] < 0.5 or b[1] > 13.5: continue
    g = shape(sr.shape.__geo_interface__).buffer(0).intersection(area)
    if g.is_empty: continue
    polys = [g] if isinstance(g, Polygon) else [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]
    for p in polys:
        s = p.simplify(0.0004, preserve_topology=True)  # about 45 m
        if s.is_empty or s.area < 1e-7: continue
        ring = [[round(y, 5), round(x, 5)] for x, y in s.exterior.coords]
        rings.append(ring); pts += len(ring)
json.dump(rings, open('land-fine.json', 'w'), separators=(',', ':'))
print('rings', len(rings), 'points', pts)
