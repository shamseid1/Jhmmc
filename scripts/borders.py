# Builds public/vendor/borders.json for the maps from Natural Earth 1:50m
# (world-atlas countries-50m.json, TopoJSON): borders between countries and a
# label point per country. Usage: python3 scripts/borders.py countries-50m.json public/vendor/borders.json
import json, sys
src, dst = sys.argv[1], sys.argv[2]
topo = json.load(open(src))
sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
arcs = []
for arc in topo['arcs']:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)
def arc(i):
    return arcs[i] if i >= 0 else list(reversed(arcs[~i]))
def ring(ids):
    pts = []
    for i in ids:
        a = arc(i)
        pts.extend(a if not pts else a[1:])
    return pts
geoms = topo['objects']['countries']['geometries']
users = {}
for g in geoms:
    polys = g.get('arcs') or []
    polys = [polys] if g['type'] == 'Polygon' else polys
    for poly in polys:
        for rng in poly:
            for i in rng:
                users.setdefault(i if i >= 0 else ~i, set()).add(id(g))
r = lambda v: round(v, 3)
# An arc two countries share is a border; coastlines (one country) are left to the satellite.
borders = [[[r(lat), r(lng)] for lng, lat in arcs[i]] for i, u in users.items() if len(u) > 1]
def area(pts):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1])) / 2
def centroid(pts):
    a = cx = cy = 0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    return cx / (3 * a), cy / (3 * a)
labels = []
for g in geoms:
    name = (g.get('properties') or {}).get('name')
    if not name or not g.get('arcs'): continue
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    outer = max((ring(p[0]) for p in polys), key=lambda pts: abs(area(pts)))
    lng, lat = centroid(outer)
    labels.append({'name': name, 'lat': r(lat), 'lng': r(lng), 'size': round(abs(area(outer)), 2)})
json.dump({'source': 'Natural Earth 1:50m (public domain), via world-atlas 2.0.2', 'borders': borders, 'labels': labels},
          open(dst, 'w'), separators=(',', ':'))
print('borders', len(borders), 'labels', len(labels))
