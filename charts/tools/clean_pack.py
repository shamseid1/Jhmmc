"""The chart's clean tiles: the same contour tiles without their dark see-through shading
(alpha about 100 to 114), lines and depths kept a little bolder and made light (black to
near-white, the blue depths to pale blue) to read on the satellite's dark sea. Tiles with
nothing left are left out (the server sends its empty tile).

Run from the repository root:  python3 charts/tools/clean_pack.py
Needs Pillow. Writes charts/coast-clean.tiles and charts/coast-clean.index.json.
"""
import io
import json
from PIL import Image

SRC = 'charts/'
idx = json.load(open(SRC + 'coast.index.json'))
data = open(SRC + 'coast.tiles', 'rb').read()
out = io.BytesIO()
nidx = {}
for k, (o, l) in idx.items():
    im = Image.open(io.BytesIO(data[o:o + l])).convert('RGBA')
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v <= 114 else min(255, int((v - 108) * 3.2)))
    light = lambda v: int(v + (255 - v) * 0.78)
    im = Image.merge('RGBA', (r.point(light), g.point(light), b.point(light), a))
    if a.getbbox() is None:
        continue
    buf = io.BytesIO()
    im.quantize(colors=48, method=Image.Quantize.FASTOCTREE).save(buf, 'PNG', optimize=True)
    nidx[k] = [out.tell(), buf.tell()]
    out.write(buf.getvalue())
open(SRC + 'coast-clean.tiles', 'wb').write(out.getvalue())
json.dump(nidx, open(SRC + 'coast-clean.index.json', 'w'), separators=(',', ':'))
print(f'{len(nidx)} of {len(idx)} tiles, {out.tell() / 1e6:.1f} MB')
