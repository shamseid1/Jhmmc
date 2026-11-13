# The Plotter map's land details: country borders (GSHHG's WDBII set, gshhg-shp-2.3.7.zip:
# WDBII_shp/f/WDBII_border_f_L1) and provinces/counties (Natural Earth 10m admin-1 lines, public domain:
# https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces_lines.zip), for West
# Africa, simplified, into public/land-details.json. Rivers and lakes come from OpenStreetMap alone
# (osm_water.py). Needs pyshp and shapely.
import json, shapefile
from shapely.geometry import shape, box
AREA = box(-20.0, -1.0, 10.0, 22.0)  # West Africa
ll = lambda cs: [[round(y, 4), round(x, 4)] for x, y in cs]
def lines(path, tol):
    out = []; pts = 0
    r = shapefile.Reader(path)
    for sh in r.iterShapes():
        if not hasattr(sh, "bbox"): continue
        b = sh.bbox
        if b[2] < -20 or b[0] > 10 or b[3] < -1 or b[1] > 22: continue
        g = shape(sh.__geo_interface__).intersection(AREA).simplify(tol)
        for l in ([g] if g.geom_type == 'LineString' else [x for x in getattr(g, 'geoms', []) if x.geom_type == 'LineString']):
            if len(l.coords) > 1: out.append(ll(l.coords)); pts += len(l.coords)
    return out, pts
def polys(path, tol):
    out = []; pts = 0
    r = shapefile.Reader(path)
    for sh in r.iterShapes():
        if not hasattr(sh, "bbox"): continue
        b = sh.bbox
        if b[2] < -20 or b[0] > 10 or b[3] < -1 or b[1] > 22: continue
        g = shape(sh.__geo_interface__).buffer(0).intersection(AREA)
        for p in ([g] if g.geom_type == 'Polygon' else [x for x in getattr(g, 'geoms', []) if x.geom_type == 'Polygon']):
            s = p.simplify(tol, preserve_topology=True)
            if s.area < 2e-5: continue  # small ponds left out
            out.append(ll(s.exterior.coords)); pts += len(s.exterior.coords)
    return out, pts
res = {}
res['borders'], a = lines('WDBII_shp/f/WDBII_border_f_L1', 0.002)
res['states'], b = lines('../ne/ne_10m_admin_1_states_provinces_lines', 0.002)  # Natural Earth: provinces, regions, counties
# (Rivers and lakes: OpenStreetMap's alone, charts/tools/osm_water.py, so no water is drawn twice.)
json.dump(res, open('land-details.json', 'w'), separators=(',', ':'))
print('borders', len(res['borders']), a, '| states', len(res['states']), b)
