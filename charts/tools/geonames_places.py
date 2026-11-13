# The Plotter map's place names, as on Garmin: GeoNames (CC BY 4.0, https://download.geonames.org/export/dump/)
# for West Africa's countries (MR SN GM GW GN SL LR CI GH TG BJ NG CM ML BF: <cc>.zip -> <cc>.txt): towns
# by size, and near the coast (40 km) villages, rivers, creeks, lagoons, bays, anchorages, points,
# capes, islands, rocks, reefs and lighthouses, each with the zoom it shows from; one file per 1°
# square in public/names/ ([zoom, rank, kind, lat, lng, name]) and index.json. Needs numpy, scipy
# and GEBCO's West Africa grid (westafrica.nc, see gebco_contours.py) for the distance from the coast.
import glob, json, math, os, shutil, numpy as np
from scipy.io import netcdf_file
from scipy.ndimage import distance_transform_edt
# How far inland (km) each place is, from GEBCO's grid (0 at sea).
f = netcdf_file('westafrica.nc', 'r', mmap=False)
lats = f.variables['latitude'].data.astype(float); lngs = f.variables['longitude'].data.astype(float)
z = f.variables['elevation'].data
inland_km = distance_transform_edt(z > 0) * abs(lats[1] - lats[0]) * 111.2
def inland(lat, lng):
    j = int(round((lat - lats[0]) / (lats[1] - lats[0]))); i = int(round((lng - lngs[0]) / (lngs[1] - lngs[0])))
    if j < 0 or i < 0 or j >= len(lats) or i >= len(lngs): return 1e9
    return float(inland_km[j, i])
COAST = 40  # km: villages, rivers and coastal features only this near the sea
WATER = {'STM', 'STMM', 'LGN', 'BAY', 'BAYS', 'CRKT', 'INLT', 'ESTY', 'COVE', 'ANCH', 'HBR', 'CHN', 'LK', 'LKS', 'SWMP', 'MGV', 'SD', 'GULF', 'RF', 'SHOL', 'BNK', 'BAR'}
POINTS = {'PT', 'CAPE', 'PEN', 'ISL', 'ISLS', 'ISLET', 'RK', 'RKS', 'BCH', 'BCHS', 'SPIT', 'DUNE', 'HDLD'}
MARKS = {'LTHSE', 'PRT', 'PIER', 'WHRF', 'MAR'}
out = {}
n = 0
for path in glob.glob('*.txt'):
    for line in open(path, encoding='utf-8'):
        g = line.rstrip('\n').split('\t')
        name, lat, lng, fc, code = g[1], float(g[4]), float(g[5]), g[6], g[7]
        pop = int(g[14] or 0)
        if not (-1 <= lat <= 22 and -20 <= lng <= 10): continue
        d = inland(lat, lng)
        kind = zmin = None
        if fc == 'P':
            kind = 'town'
            if code == 'PPLC': zmin, rank = 5, 0
            elif pop >= 100000: zmin, rank = 6, 1
            elif code == 'PPLA' or pop >= 20000: zmin, rank = 8, 2
            elif pop >= 5000: zmin, rank = 10, 3
            elif d <= 3: zmin, rank = 12, 4  # small places only right on the coast, close in
            else: continue
        elif fc == 'H' and code in WATER and d <= 8:
            # Near the sea only (river mouths, lagoons, bays, reefs), not every creek upstream.
            kind = 'water'; zmin, rank = (11 if code in ('STM', 'STMM', 'LK', 'LKS', 'SWMP', 'MGV') else 9), 3
        elif fc == 'T' and code in POINTS and d <= 5:
            kind = 'hazard' if code in ('RK', 'RKS') else 'point'; zmin, rank = 10 if code in ('BCH', 'BCHS', 'DUNE') else 9, 3
        elif fc == 'S' and code in MARKS and d <= COAST:
            kind = 'mark'; zmin, rank = 10, 3
        else:
            continue
        key = f"{math.floor(lat)}_{math.floor(lng)}"
        out.setdefault(key, []).append([zmin, rank, kind, round(lat, 4), round(lng, 4), name, pop])
        n += 1
shutil.rmtree('out', ignore_errors=True); os.makedirs('out')
for key, xs in out.items():
    xs.sort(key=lambda x: (x[0], x[1], -x[6]))
    json.dump([x[:6] for x in xs], open(f'out/{key}.json', 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
json.dump(sorted(out), open('out/index.json', 'w'))
from collections import Counter
print('names', n, 'cells', len(out))
