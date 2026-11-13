# The Plotter map's water, as on Garmin: rivers' banks, lagoons, lakes and creeks from OpenStreetMap
# (© OpenStreetMap contributors, ODbL), via the Humanitarian OpenStreetMap Team's country exports on HDX:
#   https://production-raw-data-api.s3.amazonaws.com/ISO3/<ISO3>/waterways/hotosm_<iso3>_waterways_osm_shp.zip
# for MRT SEN GMB GNB GIN SLE LBR CIV GHA TGO BEN NGA CMR, unzipped into x/<ISO3>/. The coast's water
# (40 km in) and big lakes and rivers; per 1° square in three files by zoom (a: to 8, coarse; b: 9-10;
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
        if km2 < 20 and inland(c.y, c.x) > 40: continue
        zmin = 6 if km2 > 50 else 8 if km2 > 5 else 10 if km2 > 0.3 else 12
        for p in ([g] if g.geom_type == 'Polygon' else [x for x in g.geoms if x.geom_type == 'Polygon']):
            s = p.simplify(0.00015 if km2 > 5 else 0.0001, preserve_topology=True)
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
    r = shapefile.Reader(f'{d}/waterways_lines', encoding='utf-8', encodingErrors='replace'); names = [x[0] for x in r.fields[1:]]
    for sr in r.iterShapeRecords():
        rec = dict(zip(names, sr.record)); w = rec.get('waterway')
        if w not in ('river', 'stream', 'canal') or not sr.shape.points: continue
        cs = sr.shape.points; mid = cs[len(cs) // 2]
        near = inland(mid[1], mid[0])
        if near > (40 if w == 'river' else 12): continue
        zmin = 9 if w == 'river' else 11
        try: s = shape(sr.shape.__geo_interface__).simplify(0.00012)
        except Exception: continue
        for l in ([s] if s.geom_type == 'LineString' else [x for x in getattr(s, 'geoms', []) if x.geom_type == 'LineString']):
            co = list(l.coords)
            # In pieces at most ~0.5° across, filed under their first point's square.
            k = 0
            while k < len(co) - 1:
                e = k + 1
                while e < len(co) - 1 and abs(co[e + 1][0] - co[k][0]) < 0.5 and abs(co[e + 1][1] - co[k][1]) < 0.5: e += 1
                put(co[k][1], co[k][0], ['l', zmin, flat(co[k:e + 1])]); k = e
            n[1] += 1; pts += len(co)
# Each square in three files by the zoom its water shows from (a: to 8, b: 9-10, c: 11-12), so a
# phone loads the fine creeks only when zoomed in close (one or two squares on screen).
shutil.rmtree('out', ignore_errors=True); os.makedirs('out')
index = {}
for key, xs in cells.items():
    for tier, (lo, hi) in {'a': (0, 8), 'b': (9, 10), 'c': (11, 99)}.items():
        part = [x for x in xs if lo <= x[1] <= hi]
        if part:
            json.dump(part, open(f'out/{key}.{tier}.json', 'w'), separators=(',', ':'))
            index.setdefault(key, '')
            index[key] += tier
json.dump(index, open('out/index.json', 'w'), separators=(',', ':'))
print('areas', n[0], 'lines', n[1], 'points', pts, 'cells', len(cells))
