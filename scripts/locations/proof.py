"""Every piece alone on flat magenta: the only way to see a sloppy cut. Whole first, then zoomed along every edge of every piece.
python scripts/locations/proof.py <place> out-dir                          (the three pieces, whole)
python scripts/locations/proof.py <place> out-dir <layer> x0 y0 x1 y1      (one zoom, fractions)"""
import sys
import numpy as np
from PIL import Image

place, out = sys.argv[1], sys.argv[2].rstrip('/') + '/'


def flat(li):
    a = np.asarray(Image.open(f'apps/web/public/locations/{place}/layer{li}.webp').convert('RGBA'), float)
    k = a[..., 3:] / 255
    return np.uint8(a[..., :3] * k + np.array([255, 0, 255.]) * (1 - k))


if len(sys.argv) < 4:
    for li in (1, 2, 3):
        Image.fromarray(flat(li)).resize((1980, 840), Image.LANCZOS).save(f'{out}piece-{place}-{li}.png')
else:
    li = int(sys.argv[3])
    x0, y0, x1, y1 = map(float, sys.argv[4:8])
    f = flat(li)
    h, w = f.shape[:2]
    c = Image.fromarray(f[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)])
    c.resize((1800, round(1800 * c.size[1] / c.size[0])), Image.LANCZOS).save(f'{out}zoom-{place}-{li}.png')
