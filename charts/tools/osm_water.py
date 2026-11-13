# The Plotter map's water, as on Garmin: rivers' banks, lagoons, lakes and creeks from OpenStreetMap
# (© OpenStreetMap contributors, ODbL), via the Humanitarian OpenStreetMap Team's country exports on HDX:
#   https://production-raw-data-api.s3.amazonaws.com/ISO3/<ISO3>/waterways/hotosm_<iso3>_waterways_osm_shp.zip
# for MRT SEN GMB GNB GIN SLE LBR CIV GHA TGO BEN NGA CMR, unzipped into x/<ISO3>/. The coast's water
# (40 km in) in full detail, big lakes; per 1° square in three files by zoom (a: to 8; b: 9-10;
# c: 11-12) in public/water/, with index.json. Needs pyshp, shapely, scipy and westafrica.nc (gebco_contours.py).
import json, math, os, shutil, glob, warnings, numpy as np, shapefile
warnings.filterwarnings('ignore')
from shapely.geometry import shape, Polygon
from scipy.io import netcdf_file
from scipy.ndimage import distance_transform_edt
f = netcdf_file('westafrica.nc', 'r', mmap=False)
lats = f.variables['latitude'].data.astype(float); lngs = f.variables['longitude'].data.astype(float)
inland_km = distance_transform_edt(f.variables['elevation'].data > 0) * abs(lats[1] - lats[0]) * 111.2
def inland(lat, lng):
    j = int(round((lat - lats[0]) / (lats[1] - lats[0]))); i = int(round((lng - lngs[0]) / (lngs[1] - lngs[0])))
    return float(inland_km[j, i]) if 0 <= j < len(lats) and 0 <= i < len(lngs) else 1e9
cells = {}; n = [0, 0]; pts = 0
def put(lat, lng, item):
    cells.setdefault(f'{math.floor(lat)}_{math.floor(lng)}', []).append(item)
flat = lambda cs: [v for x, y in cs for v in (int(round(y * 1e5)), int(round(x * 1e5)))]
for d in sorted(glob.glob('x/*')):
    r = shapefile.Reader(f'{d}/waterways_polygons', encoding='utf-8', encodingErrors='replace'); names = [x[0] for x in r.fields[1:]]
    for sr in r.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        if rec.get('waterway') in ('dam', 'dock') or rec.get('water') in ('wastewater', 'basin'): continue
        try: g = shape(sr.shape.__geo_interface__).buffer(0)
        except Exception: continue
        if g.is_empty: continue
        km2 = g.area * 111.2 ** 2
        c = g.representative_point()
        # The coast's water (40 km in) and the big lakes and rivers; inland ponds and streams left out.
        # Rivers (their banks) at any distance, and lakes and lagoons over 1 km²; small ponds inland left out.
        near = inland(c.y, c.x)
        if near > 40 and rec.get('water') != 'river' and km2 < 1: continue
        # Every water area from zoom 9 at the latest, so a river's area is always there with its line.
        zmin = 6 if km2 > 50 else 8 if km2 > 5 else 9
        for p in ([g] if g.geom_type == 'Polygon' else [x for x in g.geoms if x.geom_type == 'Polygon']):
            home = 4 <= c.y <= 9.5 and -14 <= c.x <= -7  # our own coast: Sierra Leone to Cape Palmas
            s = p.simplify((0.00005 if home else 0.0001) if near <= 40 else 0.00015, preserve_topology=True)  # our coast's water to about 5 m
            if s.is_empty or len(s.exterior.coords) < 4: continue
            # Zoomed out (to 8): a coarse copy (about 100 m); from 9, the full detail.
            versions = [(9 if zmin <= 8 else zmin, s)]
            if zmin <= 8:
                co = p.simplify(0.001, preserve_topology=True)
                if not co.is_empty and len(co.exterior.coords) >= 4: versions.append((zmin, co))
            for z0, v in versions:
                rings = [flat(v.exterior.coords)] + [flat(h.coords) for h in v.interiors if len(h.coords) >= 4 and (z0 > 8 or Polygon(h).area > 1e-5)]
                # A big lake or river area spans many squares: kept whole, filed under each square it covers.
                b = v.bounds
                for la in range(math.floor(b[1]), math.floor(b[3]) + 1):
                    for lo in range(math.floor(b[0]), math.floor(b[2]) + 1):
                        cells.setdefault(f'{la}_{lo}', []).append(['a', z0, rings])
            n[0] += 1; pts += len(s.exterior.coords)
    # Rivers mapped only as a line: only around Marshall (the club's fishing rivers: the Farmington,
    # Junk, Du and their branches), drawn in the same blue as the water, so a river is whole where
    # its banks aren't mapped; elsewhere only water with its real banks is drawn.
    MARSHALL = (5.85, 6.75, -10.75, -9.95)  # south, north, west, east
    r = shapefile.Reader(f'{d}/waterways_lines', encoding='utf-8', encodingErrors='replace'); names = [x[0] for x in r.fields[1:]]
    for sr in r.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        if rec.get('waterway') != 'river' or not sr.shape.points: continue
        b = sr.shape.bbox
        if b[2] < MARSHALL[2] or b[0] > MARSHALL[3] or b[3] < MARSHALL[0] or b[1] > MARSHALL[1]: continue
        try: g0 = shape(sr.shape.__geo_interface__).simplify(0.00005)
        except Exception: continue
        for l in ([g0] if g0.geom_type == 'LineString' else [x for x in getattr(g0, 'geoms', []) if x.geom_type == 'LineString']):
            co = list(l.coords)
            k = 0
            while k < len(co) - 1:
                e = k + 1
                while e < len(co) - 1 and abs(co[e + 1][0] - co[k][0]) < 0.5 and abs(co[e + 1][1] - co[k][1]) < 0.5: e += 1
                put(co[k][1], co[k][0], ['l', 9, flat(co[k:e + 1])]); k = e
            pts += len(co)
        n[1] += 1
# Each square in three files by the zoom its water shows from (a: to 8, b: 9-10, c: 11-12), so a
# phone loads the fine creeks only when zoomed in close (one or two squares on screen).
shutil.rmtree('out', ignore_errors=True); os.makedirs('out')
index = {}
for key, xs in cells.items():
    for tier, (lo, hi) in {'a': (0, 8), 'b': (9, 10), 'c': (11, 99)}.items():
        part = [x for x in xs if lo <= x[1] <= hi]
        # Inland rivers have only their light line: it's in the close-in file too.
        if part:
            json.dump(part, open(f'out/{key}.{tier}.json', 'w'), separators=(',', ':'))
            index.setdefault(key, '')
            index[key] += tier
json.dump(index, open('out/index.json', 'w'), separators=(',', ':'))
print('areas', n[0], 'lines', n[1], 'points', pts, 'cells', len(cells))
