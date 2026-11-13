# The Plotter map's land: GSHHG's coastline (Wessel & Smith, version 2.3.7, LGPL;
# https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip): full resolution (simplified
# to about 45 m) along all of West Africa (Mauritania to Cameroon), 'intermediate' over the rest
# of what the map shows.
# public/land-fine.json: { fill (the chart's coast), wide (the rest): [[ring, ...holes], ...],
# coast: [line, ...] }, points [lat, lng]; fill and wide drawn apart (they overlap a little);
# the coast kept apart so the cut edges between the two are never drawn as a coastline.
# Needs pyshp and shapely: unzip GSHHS_shp/f/GSHHS_f_L1.* GSHHS_shp/i/GSHHS_i_L1.*, then run this.
import json, shapefile
from shapely.geometry import shape, box, Polygon
from shapely.ops import unary_union
CHART = box(-20.0, -1.0, 10.0, 22.0)   # lng/lat: West Africa, Mauritania to Cameroon: full detail (about 45 m)
WIDE = box(-35.0, -12.0, 10.0, 24.0)  # everything the map can be moved to: GSHHG's 'intermediate'
def land(res, area):
    r = shapefile.Reader(f'GSHHS_shp/{res}/GSHHS_{res}_L1')
    out = []
    for sr in r.iterShapeRecords():
        b = sr.shape.bbox
        if b[2] < area.bounds[0] or b[0] > area.bounds[2] or b[3] < area.bounds[1] or b[1] > area.bounds[3]: continue
        g = shape(sr.shape.__geo_interface__).buffer(0)
        if g.intersects(area): out.append(g)
    return unary_union(out)
fine = land('f', CHART); wide = land('i', WIDE)
fills = []; wides = []; coast = []; pts = 0
def polys(g): return [g] if isinstance(g, Polygon) else [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]
def lines(g): return [g] if g.geom_type == 'LineString' else [l for l in getattr(g, 'geoms', []) if l.geom_type == 'LineString']
ll = lambda cs: [[round(y, 5), round(x, 5)] for x, y in cs]
for src, area, tol in [(fine, CHART, 0.0004), (wide, WIDE.difference(CHART), 0.003)]:
    # The coarser land's fill reaches a little under the detailed (no hairline gap where they meet).
    part = src.intersection(WIDE.difference(CHART.buffer(-0.03)) if src is wide else area)
    for p in polys(part):
        s = p.simplify(tol, preserve_topology=True)
        if s.is_empty or s.area < 1e-7: continue
        (wides if src is wide else fills).append([ll(s.exterior.coords)] + [ll(h.coords) for h in s.interiors]); pts += len(s.exterior.coords)
    # The coastline itself: the land's edge inside this area (never the area's own cut edges).
    edge = src.boundary.intersection(area.buffer(-1e-6) if area.geom_type == 'Polygon' else area)
    for l in lines(edge.simplify(tol)):
        if len(l.coords) > 1: coast.append(ll(l.coords)); pts += len(l.coords)
json.dump({'fill': fills, 'wide': wides, 'coast': coast}, open('land-fine.json', 'w'), separators=(',', ':'))
print('fills', len(fills), 'coast lines', len(coast), 'points', pts)
