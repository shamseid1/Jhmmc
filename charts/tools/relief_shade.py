# The Plotter map's relief shading: light and shadow from GEBCO's seabed, so every bump, hole
# and edge shows between the depth lines. One small picture per 1° square (240 px, the grid's own
# 15"), grey with see-through: white where the bottom faces the light, black where it faces away.
import json, os, shutil, numpy as np, sys
from scipy.io import netcdf_file
from scipy.ndimage import gaussian_filter
from matplotlib.colors import LightSource
from PIL import Image
f = netcdf_file(sys.argv[1] if len(sys.argv) > 1 else 'westafrica.nc', 'r', mmap=False)
lats = f.variables['latitude'].data.astype(float); lngs = f.variables['longitude'].data.astype(float)
z = f.variables['elevation'].data.astype(float)
if lats[0] > lats[-1]: lats = lats[::-1]; z = z[::-1]
depth = np.where(z < 0, -z, 0.0); land = z >= 0
# Shaded on the square root of the depth: the shelf's few metres show as clearly as the slope's
# hundreds, and the slope doesn't go black.
t = gaussian_filter(np.sqrt(depth), 1.0)
ls = LightSource(azdeg=315, altdeg=45)
step = abs(lats[1] - lats[0]) * 111200
sh = ls.hillshade(-t, vert_exag=40, dx=step, dy=step)  # 0 dark .. 1 light, 0.5-ish flat
flat = np.median(sh[~land])
cells = json.load(open('../../public/contours/index.json'))  # the squares with depth lines
shutil.rmtree('shade', ignore_errors=True); os.makedirs('shade')  # then copy shade/* to public/shade/
n = 0
per = int(round(1 / abs(lats[1] - lats[0])))  # 240 rows a degree
for key in [c for c in cells if c != 'index']:
    la, lo = map(int, key.split('_'))
    j0 = int(round((la - lats[0]) * per)); i0 = int(round((lo - lngs[0]) * per))
    if j0 < 0 or i0 < 0 or j0 + per > len(lats) or i0 + per > len(lngs): continue
    s = sh[j0:j0 + per, i0:i0 + per] - flat; L = land[j0:j0 + per, i0:i0 + per]
    a = np.clip(np.abs(s) * 4.0, 0, 1) * 0.7  # how strong
    lum = np.where(s > 0, 255, 0).astype(np.uint8)
    alpha = np.where(L, 0, a * 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([lum, alpha])[::-1], 'LA')  # north at the top
    img.save(f'shade/{key}.png', optimize=True); n += 1
json.dump(sorted(k[:-4] for k in os.listdir('shade')), open('shade/index.json', 'w'))
print('squares', n)
