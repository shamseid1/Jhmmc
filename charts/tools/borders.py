# The Plotter map's country borders: geoBoundaries (gbOpen ADM0, CC BY 4.0, https://www.geoboundaries.org;
# media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/<ISO3>/ADM0/geoBoundaries-<ISO3>-ADM0.geojson
# into <ISO3>.geojson): each shared border traced from both countries, the more detailed kept; then
# every point within 400 m of an OpenStreetMap river put on it (osm_water.py's x/<ISO3>/waterways_lines),
# so a border that is a river (the Mano) runs in it. Into public/land-details.json's borders.
import json, glob
from shapely.geometry import shape, box
from shapely.ops import unary_union, linemerge
AREA = box(-20.0, -1.0, 10.0, 22.0)
C = {}
for f in glob.glob('*.geojson'):
    try: d = json.load(open(f))
    except Exception: continue
    C[f[:3]] = unary_union([shape(x['geometry']).buffer(0) for x in d['features']])
lines = []; pts = 0
codes = sorted(C)
def parts(g): return [g] if g.geom_type == 'LineString' else [x for x in getattr(g, 'geoms', []) if x.geom_type == 'LineString']
for i, a in enumerate(codes):
    for b in codes[i + 1:]:
        A, B = C[a], C[b]
        if not A.buffer(0.01).intersects(B): continue
        # The shared border, traced from each side; the more detailed of the two is kept.
        la = A.boundary.intersection(B.buffer(0.005)); lb = B.boundary.intersection(A.buffer(0.005))
        cand = [x for x in (la, lb) if not x.is_empty]
        if not cand: continue
        best = max(cand, key=lambda g: sum(len(p.coords) for p in parts(g)))
        best = linemerge(best) if best.geom_type == 'MultiLineString' else best
        best = best.intersection(AREA).simplify(0.0002)
        for p in parts(best):
            if len(p.coords) > 1 and p.length > 0.01:
                lines.append([[round(y, 5), round(x, 5)] for x, y in p.coords]); pts += len(p.coords)
        print(a, b, sum(len(p.coords) for p in parts(best)))
d = json.load(open('/home/user/Jhmmc/public/land-details.json'))
d['borders'] = lines
json.dump(d, open('land-details.json', 'w'), separators=(',', ':'))
print('lines', len(lines), 'points', pts)

# ---- then: onto the rivers ----
import json, glob, warnings, shapefile, numpy as np
warnings.filterwarnings('ignore')
from shapely.geometry import shape, LineString, Point
from shapely.strtree import STRtree
# OpenStreetMap's rivers (lines), the 13 coastal countries.
rivers = []
for d in glob.glob('../hot/x/*'):
    r = shapefile.Reader(f'{d}/waterways_lines', encoding='utf-8', encodingErrors='replace'); names = [x[0] for x in r.fields[1:]]
    for sr in r.iterShapeRecords():
        if dict(zip(names, sr.record)).get('waterway') != 'river' or len(sr.shape.points) < 2: continue
        try: rivers.append(LineString(sr.shape.points))
        except Exception: pass
tree = STRtree(rivers)
REACH = 400 / 111200  # a border point within 400 m of a river is put on it
data = json.load(open('land-details.json'))
out = []; moved = 0; total = 0
for line in data['borders']:
    pts = []
    for lat, lng in line:
        p = Point(lng, lat); total += 1
        i = tree.nearest(p)
        r = rivers[i]
        if r.distance(p) <= REACH:
            q = r.interpolate(r.project(p)); pts.append([round(q.y, 5), round(q.x, 5)]); moved += 1
        else:
            pts.append([lat, lng])
    out.append(pts)
data['borders'] = out
json.dump(data, open('land-details.json', 'w'), separators=(',', ':'))
print('points', total, 'snapped onto rivers', moved)
