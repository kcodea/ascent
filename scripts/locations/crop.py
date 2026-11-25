"""A zoomed crop of a painting with a pixel grid on it, to read outline points off (they go into `view(...)` in layers.py).
python scripts/locations/crop.py "<painting under Locations/>" x0 y0 x1 y1 out.png      (fractions of the painting)"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
ART = os.environ.get('LOCATION_ART', r'C:/Game Assets/Ascent Art/Locations/')
W = 1500
name, x0, y0, x1, y1, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
im = Image.open(ART + name).convert('RGB')
w, h = im.size
c = im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
H = round(W * c.size[1] / c.size[0])
c = c.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(c, 'RGBA')
f = ImageFont.load_default(15)
label = lambda xy, t: d.text(xy, t, fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
for x in range(0, W, 100):
    d.line([(x, 0), (x, H)], fill=(255, 255, 255, 70))
    label((x + 2, 1), str(x))
for y in range(0, H, 100):
    d.line([(0, y), (W, y)], fill=(255, 255, 255, 70))
    label((2, y + 1), str(y))
c.save(out)
print(f'view({x0}, {y0}, {x1}, {y1}, {W}, {H})')
