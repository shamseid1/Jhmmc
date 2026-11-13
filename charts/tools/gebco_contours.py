# The fishing chart's depth lines from GEBCO's world seabed map (the GEBCO_2020 grid, every 15
# arc-seconds, about 450 m), made once and kept in public/contours/: one file per 1° square
# ("lat_lng.json"), each line [depth in m, the zoom it shows from, [lat*1e4, lng*1e4, ...]].
# More lines the closer in: 200 m apart far out, down to 5 m in shallow water from zoom 12.
# The grid (all of West Africa, Mauritania to Cameroon) from NOAA's PFEG server, as NetCDF:
#   curl -o westafrica.nc "https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.nc?elevation%5B(-1.0):1:(22.0)%5D%5B(-20.0):1:(10.0)%5D"
# then: python3 gebco_contours.py westafrica.nc  (needs numpy, scipy, matplotlib); copy out/*.json
# to public/contours/ and list them in public/contours/index.json.
import json, os, sys, numpy as np
from scipy.io import netcdf_file
from scipy.ndimage import gaussian_filter
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
f = netcdf_file(sys.argv[1] if len(sys.argv) > 1 else 'region.nc', 'r', mmap=False)
lats = f.variables['latitude'].data.astype(float); lngs = f.variables['longitude'].data.astype(float)
z = f.variables['elevation'].data.astype(float)
if lats[0] > lats[-1]: lats = lats[::-1]; z = z[::-1]
depth = -z; land = depth <= 0
d = gaussian_filter(np.where(land, 0, depth), 0.8); d[land] = -1
# Deep water smoothed more (the flat deep floor is noise at a few metres): blended in from
# 1,500 m to 2,500 m, so the deep lines run clean, as a chart draws them.
dd = gaussian_filter(np.where(land, 0, depth), 4.0)
t = np.clip((depth - 1500) / 1000, 0, 1)
d = np.where(land, -1, d * (1 - t) + dd * t)
def zmin(m):
    if m in (200, 1000, 2000, 3000, 4000, 5000): return 6
    if m == 100 or m % 500 == 0: return 8
    if (m <= 500 and m % 50 == 0) or (m <= 2000 and m % 100 == 0) or m % 200 == 0: return 9
    if (m <= 100 and m % 10 == 0) or (m <= 300 and m % 25 == 0) or (m <= 1000 and m % 50 == 0) or m % 100 == 0: return 10
    if (m <= 200 and m % 10 == 0) or (m <= 500 and m % 25 == 0) or (m <= 2000 and m % 50 == 0): return 11
    return 12
levels = sorted(set(list(range(5, 51, 5)) + list(range(60, 301, 10)) + list(range(325, 1001, 25)) + list(range(1050, 2001, 50)) + list(range(2100, 4001, 100))))  # to 4,000 m: further out is the flat deep floor
def simplify(pts, tol):
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        ab = pts[b] - pts[a]; n = np.hypot(*ab) or 1e-12
        q = pts[a + 1:b] - pts[a]
        dist = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / n
        i = int(np.argmax(dist))
        if dist[i] > tol: k = a + 1 + i; keep[k] = True; stack += [(a, k), (k, b)]
    return pts[keep]
cells = {}
fig, ax = plt.subplots()
total = 0
for lev in levels:
    cs = ax.contour(lngs, lats, d, levels=[lev])
    for seg in cs.allsegs[0]:
        if len(seg) < 4: continue
        s = simplify(np.asarray(seg), 0.0003)
        # Pieces of at most 60 points and half a degree across (so a tile finds every piece
        # that crosses it in the squares around it), each filed under its first point's 1° square.
        starts = [0]
        for k in range(1, len(s)):
            a = s[starts[-1]]
            if k - starts[-1] >= 59 or abs(s[k][0] - a[0]) > 0.5 or abs(s[k][1] - a[1]) > 0.5: starts.append(k - 1 if k - 1 > starts[-1] else k)
        for n, k in enumerate(starts):
            piece = s[k:(starts[n + 1] + 1) if n + 1 < len(starts) else len(s)]
            if len(piece) < 2: continue
            key = f"{int(np.floor(piece[0][1]))}_{int(np.floor(piece[0][0]))}"  # lat_lng
            flat = []
            for x, y in piece: flat += [int(round(y * 1e4)), int(round(x * 1e4))]
            cells.setdefault(key, []).append([lev, zmin(lev), flat])
            total += len(piece)
    for c in cs.collections if hasattr(cs, 'collections') else []: c.remove()
    ax.cla()
os.makedirs('out', exist_ok=True)
for key, lines in cells.items():
    json.dump(lines, open(f'out/{key}.json', 'w'), separators=(',', ':'))
print('levels', len(levels), 'points', total, 'cells', len(cells))
