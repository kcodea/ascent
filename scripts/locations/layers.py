"""Parallax layers, third method (2026-11-24). Three things the earlier cuts got wrong, and what replaces them:
 - EDGES: each traced outline is only a guide. A thin band around it is solved as a matte (closed-form matting), and the
   piece's own colour is carried out under its soft edge, so no rim of background travels with it.
 - BEHIND: what a piece hides continues as the mirror of what is beside it (real texture), easing into a smooth fill.
 - FEET: where a piece stands on something it is faded in, and the ground under it has the piece's own depth, so nothing slides.
python scripts/locations/layers.py [o|u] [proof-dir]   (from the repo root; see docs/locations.md)"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import sparse
from scipy.sparse.linalg import cg
from scipy.ndimage import binary_dilation, binary_erosion, distance_transform_edt, gaussian_filter, gaussian_filter1d, uniform_filter

Image.MAX_IMAGE_PIXELS = None
OUT_H = 1440
OUT_W = round(OUT_H * 6336 / 2688)
W, H = OUT_W, OUT_H
S = W / 1980
PUB = 'apps/web/public/locations/'
ART = os.environ.get('LOCATION_ART', r'C:/Game Assets/Ascent Art/Locations/')
PREV = (sys.argv[2] if len(sys.argv) > 2 else os.environ.get('TEMP', '.')) + '/'
DEP = [0, .30, .52, 1.0]


def view(x0, y0, x1, y1, w, h):
    """points read off a zoomed crop, in that crop's pixels"""
    return lambda pts: [(x0 + px / w * (x1 - x0), y0 + py / h * (y1 - y0)) for px, py in pts]


def raster(polys, blur=0):
    im = Image.new('L', (W * 2, H * 2), 0)
    d = ImageDraw.Draw(im)
    for q in polys:
        d.polygon([(x * W * 2, y * H * 2) for x, y in q], fill=255)
    im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im, float) / 255
    return gaussian_filter(a, blur) if blur else a


def up(a):
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize((OUT_W, OUT_H), Image.BICUBIC))
    return np.stack([up(a[..., i]) for i in range(a.shape[2])], -1)


def matte(img, known, value, lam=120.0, eps=2e-6):
    """closed-form matting (Levin), solved only where `known` is False"""
    h, w = known.shape
    unk = ~known
    win = binary_dilation(unk, np.ones((3, 3)))
    win[0], win[-1], win[:, 0], win[:, -1] = False, False, False, False
    cy, cx = np.nonzero(win)
    off = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    idx = np.stack([(cy + dy) * w + cx + dx for dy, dx in off], 1)
    I = img.reshape(-1, 3)[idx]
    mu = I.mean(1, keepdims=True)
    D = I - mu
    cov = np.einsum('nki,nkj->nij', D, D) / 9 + eps / 9 * np.eye(3)
    inv = np.linalg.inv(cov)
    G = np.einsum('nki,nij,nlj->nkl', D, inv, D)
    L = (np.eye(9)[None] - (1 + G) / 9)
    rows = np.repeat(idx, 9, 1).ravel()
    cols = np.tile(idx, (1, 9)).ravel()
    N = h * w
    Lm = sparse.coo_matrix((L.ravel(), (rows, cols)), shape=(N, N)).tocsr()
    u = np.flatnonzero(unk.ravel())
    k = np.flatnonzero((binary_dilation(win, np.ones((3, 3))) & known).ravel())
    Luu = Lm[u][:, u] + 1e-6 * sparse.eye(len(u))
    b = -Lm[u][:, k] @ value.ravel()[k] + 1e-6 * value.ravel()[u]
    dinv = sparse.diags(1 / np.maximum(Luu.diagonal(), 1e-8))
    x, _ = cg(Luu, b, x0=value.ravel()[u], M=dinv, maxiter=700, rtol=1e-5)
    out = value.copy().ravel()
    out[u] = np.clip(x, 0, 1)
    return out.reshape(h, w)


def pushpull(img, w):
    pyr = [(img * w[..., None], w.astype(float))]
    while min(pyr[-1][1].shape) > 4:
        c, q = pyr[-1]
        h, k = c.shape[0] // 2 * 2, c.shape[1] // 2 * 2
        f = lambda x: (x[0:h:2, 0:k:2] + x[1:h:2, 0:k:2] + x[0:h:2, 1:k:2] + x[1:h:2, 1:k:2]) / 4
        pyr.append((f(c), f(q)))
    c, q = pyr[-1]
    acc = c / np.maximum(q, 1e-5)[..., None]
    for c, q in reversed(pyr[:-1]):
        u = np.stack([np.asarray(Image.fromarray(acc[..., i].astype(np.float32)).resize((c.shape[1], c.shape[0]), Image.BICUBIC)) for i in range(3)], -1)
        q = np.clip(q, 0, 1)[..., None]
        acc = c + u * (1 - q)
    return np.clip(acc, 0, 1)


def mirror(img, valid, reach=70):
    """continue the picture past `valid`: its mirror image across the nearest edge, easing into a smooth fill"""
    h, w = valid.shape
    d, (iy, ix) = distance_transform_edt(~valid, return_indices=True)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    dy = gaussian_filter(2 * iy - 2 * yy, 5)
    dx = gaussian_filter(2 * ix - 2 * xx, 5)
    py = np.clip(np.where(valid, yy, yy + dy), 0, h - 1).round().astype(int)
    px = np.clip(np.where(valid, xx, xx + dx), 0, w - 1).round().astype(int)
    smooth = pushpull(img, valid.astype(float))
    got = img[py, px]
    ok = valid[py, px].astype(float)
    k = gaussian_filter(ok, 1.5) * ok * np.exp(-(d / reach) ** 2)
    k = np.where(valid, 1, k)[..., None]
    # the mirror's light is matched to the smooth fill's, so no seam shows where it fades
    low = np.stack([gaussian_filter(got[..., i], 12) for i in range(3)], -1)
    tone = np.clip(got - low * .55 + smooth * .55, 0, 1)
    return np.where(valid[..., None], img, tone * k + smooth * (1 - k))


def rows(img, valid, source, reach=70):
    """continue a background sideways: each row mirrors its own neighbours, so horizons and clouds stay level"""
    h, w = valid.shape
    xs = np.tile(np.arange(w), (h, 1))
    xl = np.maximum.accumulate(np.where(source, xs, -1), 1).astype(float)
    xr = np.minimum.accumulate(np.where(source, xs, w * 9)[:, ::-1], 1)[:, ::-1].astype(float)
    hasl, hasr = xl >= 0, xr < w
    sm = lambda a, ok: gaussian_filter1d(np.where(ok, a, 0), 3.5, 0) / np.maximum(gaussian_filter1d(ok.astype(float), 3.5, 0), 1e-3)
    xl, xr = np.where(hasl, sm(xl, hasl), -1e4), np.where(hasr, sm(xr, hasr), 1e5)
    acc, ws = np.zeros_like(img), np.full((h, w), 1e-6)
    for b, ok in ((xl, hasl), (xr, hasr)):
        s = np.round(2 * b - xs)
        inside = (s >= 0) & (s < w) & ok
        si = np.clip(s, 0, w - 1).astype(int)
        yy = np.arange(h)[:, None]
        k = inside * source[yy, si] * np.exp(-(np.abs(xs - b) / reach) ** 2)
        acc += img[yy, si] * k[..., None]
        ws += k
    got = acc / ws[..., None]
    # a smooth fill that also keeps to its row
    smooth = np.zeros_like(img) + img[source].mean(0)
    for sx in (260, 120, 56, 26, 12):
        q = gaussian_filter(source.astype(float), (sx / 7, sx))
        c = np.stack([gaussian_filter(img[..., i] * source, (sx / 7, sx)) for i in range(3)], -1) / np.maximum(q, 1e-4)[..., None]
        t = np.clip(q / .12, 0, 1)[..., None]
        smooth = smooth * (1 - t) + c * t
    k = gaussian_filter(np.clip(ws, 0, 1), 2.0)[..., None]
    out = got * k + smooth * (1 - k)
    return np.where(valid[..., None], img, np.clip(out, 0, 1))


def guided(I, p, r, eps):
    m = lambda x: uniform_filter(x, 2 * r + 1)
    mi, mp = m(I), m(p)
    a = (m(I * p) - mi * mp) / (m(I * I) - mi * mi + eps)
    return np.clip(m(a) * I + m(mp - a * mi), 0, 1)


def make(tag, folder, file, specs, depth, wind, water):
    """The painting itself is the ground; the owner's background shows only where a piece hides it. So nothing can be lost."""
    master = Image.open(ART + file).convert('RGB')
    I = np.asarray(master.resize((W, H), Image.LANCZOS), float) / 255
    B = np.asarray(Image.open(ART + file.replace('4k.jpg', '4kBG.jpg')).convert('RGB').resize((W, H), Image.LANCZOS), float) / 255
    lum = I @ np.array([.30, .59, .11])
    near = np.zeros((H, W))
    free = np.ones((H, W), bool)
    done = []
    for li in (3, 2, 1):
        sp = specs[li]
        solid, core, unk = np.zeros((H, W)), np.zeros((H, W), bool), np.zeros((H, W), bool)
        for polys, holes, band in sp['groups']:
            s = raster(polys)
            if holes:
                s = np.clip(s - raster(holes), 0, 1)
            hard = s > .5
            fg = binary_erosion(hard, iterations=band, border_value=1)
            unk |= binary_dilation(hard, iterations=band) & ~fg
            core |= fg
            solid = np.maximum(solid, s)
        unk &= ~core
        val = np.where(core, 1., np.where(unk, solid, 0.))
        for zone, fn in sp.get('key', []):
            z = (raster([zone]) > .5) & (near < .5) & ~core
            f, b = fn(I, lum)
            val = np.where(z & f, 1., np.where(z & b, 0., np.where(z, .5, val)))
            unk = np.where(z, ~(f | b), unk)
        fade = raster(sp['fade'], sp.get('soft', 8) * S) if sp.get('fade') else np.zeros((H, W))
        for q, b in sp.get('mist', []):
            fade = np.maximum(fade, raster([q], b * S))
        unk &= near < .5
        a = matte(I, ~unk, val)
        a = np.clip((a - .07) / .85, 0, 1)
        a = np.where(near > .5, np.maximum(a, solid), a)
        a = a * (1 - np.clip(fade * 1.02, 0, 1))
        mine = gaussian_filter(fade, 9 * S)
        free &= ~((a > .015) & (mine < .10))
        clean = (a > .94) & (near < .03)
        clean = binary_erosion(clean, iterations=1, border_value=1)
        F = mirror(I, clean, 34)
        ck = gaussian_filter(clean.astype(float), .8)[..., None]
        done.append((li, np.clip(I * ck + F * (1 - ck), 0, 1), a))
        near = np.maximum(near, a)
        print(tag, li, 'matted', int(unk.sum()), 'px', flush=True)
    free = binary_erosion(free, iterations=2, border_value=1)
    # the background, with its light brought to the painting's where the two meet
    q = 6
    fr = binary_erosion(free, iterations=6, border_value=1)
    small = lambda x: np.asarray(Image.fromarray(x.astype(np.float32)).resize((W // q, H // q), Image.BOX))
    wq = small(fr.astype(float))
    dq = np.stack([small((I - B)[..., i] * fr) for i in range(3)], -1) / np.maximum(wq, 1e-3)[..., None]
    E = pushpull(dq * .5 + .5, np.clip(wq, 0, 1)) * 2 - 1
    E = np.stack([gaussian_filter(E[..., i], 3) for i in range(3)], -1)
    E = np.stack([np.asarray(Image.fromarray(E[..., i].astype(np.float32)).resize((W, H), Image.BICUBIC)) for i in range(3)], -1)
    E *= np.exp(-(distance_transform_edt(~free) / 190) ** 2)[..., None]
    w0 = gaussian_filter(free.astype(float), 1.6)[..., None]
    under = np.clip(np.maximum(B + np.clip(E, -.16, .22), B * .55), 0, 1)
    if specs.get('fill'):              # where the background grew something of its own right beside a piece: continue the painting instead
        M = mirror(I, fr, 110)
        z = raster(specs['fill'], 14)[..., None]
        under = under * (1 - z) + M * z
    bout = np.clip(I * w0 + under * (1 - w0), 0, 1)
    out = PUB + folder + '/'
    Image.fromarray(np.uint8(bout * 255)).save(out + 'layer0.webp', quality=88, method=6)
    comp = bout.copy()
    out_layers = {}
    for li, C, A in reversed(done):
        out_layers[li] = (C, A)
        comp = comp * (1 - A[..., None]) + C * A[..., None]
        Image.fromarray(np.uint8(np.dstack([C, A]) * 255), 'RGBA').save(out + f'layer{li}.webp', quality=88, alpha_quality=97, method=6, exact=True)
    err = np.abs(comp - I).mean(2)
    print(tag, 'at rest: mean', round(float(err.mean()), 4), 'pixels off by more than .08:', round(float((err > .08).mean() * 100), 2), '%', flush=True)
    vis = I * .35
    vis[..., 0] = np.maximum(vis[..., 0], np.clip(uniform_filter(err, 5) * 6, 0, 1))
    Image.fromarray(np.uint8(vis * 255)).resize((1980, 840)).save(PREV + f'lost-{tag}.png')
    Image.fromarray(np.uint8(bout * 255)).resize((1980, 840)).save(PREV + f'ground-{tag}.png')
    for nm, (px, py, k) in {'a': (-.16, -.08, .08), 'b': (.28, .06, .25)}.items():
        c = warp(bout, depth, px, py, k)
        for li in (1, 2, 3):
            C, A = out_layers[li]
            c = over(c, C, A, DEP[li] * .25, px, py, k)
        Image.fromarray(np.uint8(np.clip(c, 0, 1) * 255)).save(PREV + f'move-{tag}-{nm}.png')
    master.resize((1886, 800), Image.LANCZOS).save(out + 'flat.webp', quality=86)
    master.resize((960, 407), Image.LANCZOS).filter(ImageFilter.GaussianBlur(3.4)).point(lambda v: int(v * .84)).save(out + 'blur.webp', quality=88)
    data = np.dstack([depth, wind, water])
    Image.fromarray(np.uint8(np.clip(data, 0, 1) * 255)).resize((990, 420), Image.LANCZOS).save(out + 'data.webp', lossless=True)


def leafy(I, lum):
    return lum < .33, lum > .54


def cloth(I, lum):
    r = I[..., 0] - I[..., 1]
    return (r > .13) & (lum < .42), (r < .045) | (lum > .60)


VP = [.54, .34]


def sample(tex, x, y):
    f = lambda v: 1 - np.abs(1 - np.abs(v) % 2)
    xi, yi = f(x), f(y)
    return tex[np.clip((yi * (OUT_H - 1)).round().astype(int), 0, OUT_H - 1), np.clip((xi * (OUT_W - 1)).round().astype(int), 0, OUT_W - 1)]


def grid():
    y, x = np.mgrid[0:OUT_H, 0:OUT_W]
    return x / (OUT_W - 1), y / (OUT_H - 1)


def at(dep, px, py, k):
    x, y = grid()
    return VP[0] + ((x - VP[0]) * .962 - px * dep) / (1 + dep * k), VP[1] + ((y - VP[1]) * .962 - py * dep) / (1 + dep * k)


def warp(tex, depth, px, py, k):
    d = up(depth)
    x, y = grid()
    q = sample(d, x, y) * .25
    for _ in range(3):
        u, v = at(q, px, py, k)
        q = sample(d, u, v) * .25
    u, v = at(q, px, py, k)
    return sample(tex, u, v)


def over(c, C, A, dep, px, py, k):
    u, v = at(dep, px, py, k)
    a = sample(A, u, v)[..., None]
    return c * (1 - a) + sample(C, u, v) * a


def ramp(y0, p):
    return np.repeat(np.clip((np.linspace(0, 1, H)[:, None] - y0) / (1 - y0), 0, 1) ** p, W, 1)


def put(d, poly, v, blur):
    m = np.clip(raster([poly], blur * S) * 1.05, 0, 1)
    return d * (1 - m) + v * m


def soft(shapes, blur):
    a = np.zeros((H, W))
    for p, v in shapes:
        a = np.maximum(a, raster([p], blur * S) * v)
    return a


def outskirts():
    c1 = view(.23, .02, .52, .66, 1500, 1405)
    c2 = view(.55, .23, .83, .78, 1500, 1249)
    c3 = view(.27, .42, .43, .82, 1200, 1273)
    c5 = view(0, .62, .33, 1, 1500, 733)
    c6 = view(.60, .42, 1, 1, 1500, 922)
    arch = c1([(127, 285), (160, 235), (245, 186), (300, 180), (335, 158), (360, 150), (400, 112), (455, 92), (500, 84), (560, 78), (600, 92), (640, 116), (700, 98), (745, 96), (772, 112), (778, 130), (880, 186), (890, 204), (888, 256), (903, 290), (968, 289), (976, 302), (973, 392), (986, 420), (1012, 412), (1022, 400), (1078, 395), (1100, 408), (1098, 424), (1150, 458), (1152, 502), (1136, 522), (1130, 580), (1108, 606), (1098, 640), (1130, 636), (1180, 650), (1196, 680), (1230, 692), (1214, 732), (1216, 762), (1165, 802), (1150, 772), (1134, 778), (1136, 862), (1116, 874), (1113, 962), (1116, 1010), (1117, 1140), (1120, 1250), (900, 1262), (740, 1250), (520, 1262), (300, 1262), (100, 1256), (95, 1075), (104, 1005), (112, 950), (130, 925), (125, 800), (130, 640), (125, 560), (130, 400)])
    open_ = c1([(604, 504), (552, 526), (534, 560), (521, 590), (526, 612), (564, 640), (566, 742), (540, 780), (520, 786), (516, 850), (518, 946), (521, 1262), (735, 1262), (736, 1180), (740, 962), (748, 936), (776, 896), (798, 876), (796, 848), (824, 814), (884, 800), (891, 766), (879, 690), (858, 650), (834, 602), (796, 576), (794, 640), (786, 700), (764, 742), (752, 796), (736, 758), (715, 800), (706, 846), (690, 800), (680, 762), (661, 690), (640, 716), (619, 748), (612, 700), (609, 640)])
    small = c1([(893, 930), (864, 930), (846, 965), (838, 1000), (840, 1130), (890, 1104)])
    barrel = c3([(413, 72), (426, 72), (427, 96), (460, 106), (485, 140), (488, 186), (520, 200), (548, 250), (534, 264), (526, 440), (541, 456), (546, 466), (580, 464), (780, 461), (870, 490), (889, 560), (886, 640), (986, 712), (1060, 736), (1080, 790), (1094, 902), (1084, 912), (992, 916), (990, 1140), (870, 1170), (640, 1215), (470, 1290), (250, 1400), (-180, 1400), (-200, 1080), (-150, 960), (-40, 905), (110, 902), (122, 888), (116, 846), (140, 740), (170, 600), (200, 490), (270, 466), (296, 440), (308, 262), (284, 240), (330, 196), (372, 182), (366, 150), (378, 116), (410, 98)])
    stall = c2([(717, 72), (740, 64), (766, 70), (768, 110), (779, 130), (776, 152), (832, 162), (960, 200), (1080, 235), (1180, 260), (1270, 262), (1285, 246), (1345, 238), (1357, 252), (1352, 276), (1316, 286), (1321, 360), (1313, 373), (1308, 302), (1286, 291), (1270, 302), (1236, 362), (1205, 382), (1176, 392), (1150, 376), (1116, 372), (1086, 386), (1083, 476), (1077, 430), (1060, 402), (1020, 422), (1012, 452), (985, 466), (955, 446), (928, 442), (918, 470), (922, 545), (930, 565), (926, 634), (1000, 630), (1086, 640), (1091, 750), (1190, 770), (1192, 800), (1182, 826), (1206, 860), (1212, 970), (1200, 982), (1120, 988), (1086, 996), (1086, 1150), (860, 1165), (720, 1165), (640, 1190), (560, 1180), (330, 1180), (322, 936), (368, 930), (284, 640), (276, 546), (262, 545), (232, 690), (204, 630), (184, 590), (180, 541), (134, 518), (168, 503), (246, 477), (345, 424), (382, 382), (354, 379), (385, 334), (406, 334), (411, 360), (541, 330), (541, 288), (563, 288), (566, 314), (640, 298), (714, 225), (713, 150)])
    stall_holes = [c2([(298, 548), (398, 548), (350, 800), (312, 640)]), c2([(436, 545), (462, 540), (520, 615), (580, 645), (612, 652), (606, 672), (568, 688), (548, 684), (425, 690), (395, 750), (385, 755)])]
    leaves = c1([(-110, -60), (1270, -60), (1240, 20), (1226, 86), (1206, 58), (1160, 60), (1135, 130), (1108, 160), (1105, 216), (1086, 270), (1066, 225), (1040, 178), (1002, 216), (985, 132), (952, 166), (940, 62), (920, 62), (902, 92), (880, 130), (850, 72), (760, 56), (700, 62), (622, 122), (614, 170), (590, 142), (560, 175), (530, 132), (500, 126), (470, 92), (358, 62), (345, 182), (290, 152), (275, 186), (240, 192), (180, 192), (150, 152), (132, 236), (146, 270), (112, 284), (80, 220), (50, 300), (38, 305), (36, 240), (0, 250), (-40, 320), (-70, 270), (-110, 290), (-160, 250), (-230, 300), (-330, 300), (-330, -60)])
    frontL = c5([(-40, 170), (0, 165), (40, 122), (62, 132), (110, 172), (150, 126), (166, 190), (214, 182), (236, 136), (256, 180), (266, 230), (334, 176), (342, 222), (420, 196), (452, 232), (488, 242), (500, 292), (560, 290), (620, 252), (680, 226), (740, 218), (850, 236), (900, 266), (1000, 312), (1050, 372), (1102, 436), (1112, 530), (1170, 535), (1250, 546), (1302, 592), (1330, 682), (1400, 692), (1490, 780), (-40, 780)])
    frontR = c6([(20, 970), (60, 922), (90, 900), (140, 850), (182, 792), (280, 740), (390, 735), (420, 760), (430, 700), (440, 662), (470, 680), (500, 702), (530, 652), (560, 640), (590, 602), (640, 590), (700, 612), (760, 620), (800, 582), (832, 552), (872, 560), (890, 500), (1000, 495), (1120, 520), (1142, 500), (1150, 416), (1160, 396), (1310, 400), (1330, 390), (1345, 396), (1360, 386), (1540, 384), (1540, 970)])
    d = ramp(.47, .95)
    d = np.maximum(d, soft([([(0, .36), (.10, .33), (.22, .42), (.26, .62), (0, .66)], .34), ([(0, .16), (.25, .16), (.25, .42), (0, .42)], .10), ([(.86, .24), (1, .22), (1, .62), (.86, .60)], .18), ([(.57, .46), (.80, .44), (.80, .62), (.57, .62)], .14)], 26))
    d = put(d, [(-.04, -.06), (.27, -.06), (.26, .13), (.14, .20), (.10, .34), (-.04, .36)], .46, 40)
    d = put(d, [(-.02, .40), (.07, .40), (.11, .70), (-.02, .72)], .48, 20)
    d = put(d, [(.24, .575), (.48, .575), (.48, .655), (.24, .655)], .30, 12)
    d = put(d, [(.23, .75), (.41, .74), (.41, .83), (.23, .84)], .52, 18)
    d = put(d, [(.575, .67), (.785, .66), (.785, .775), (.575, .775)], .52, 18)
    for q, v in [([(.455, .42), (.49, .43), (.565, .48), (.57, .575), (.455, .575)], .17), ([(.725, .40), (.812, .42), (.812, .62), (.725, .62)], .22), ([(.572, .55), (.60, .55), (.60, .68), (.572, .68)], .40), ([(.79, .50), (.90, .50), (.90, .61), (.79, .61)], .22), ([(.835, .56), (.885, .56), (.895, .53), (.94, .50), (.94, .67), (.835, .67)], .26), ([(.82, .46), (.90, .46), (.90, .53), (.82, .53)], .06), ([(.30, .38), (.395, .38), (.395, .56), (.30, .56)], .14), ([(.665, .46), (.755, .46), (.755, .65), (.665, .65)], .26), ([(.12, .13), (.25, .16), (.25, .40), (.15, .40)], .13)]:
        d = put(d, q, v, 9)
    d = put(d, [(.94, .46), (1.02, .45), (1.02, .70), (.93, .70)], .55, 16)
    wind = soft([(c1([(605, 190), (795, 260), (795, 640), (707, 850), (605, 700)]), .8), ([(0, 0), (.50, 0), (.45, .14), (.24, .14), (.15, .18), (0, .20)], .85), ([(.575, .46), (.62, .40), (.685, .29), (.80, .33), (.79, .39), (.74, .41), (.63, .42)], .5), ([(0, .72), (.10, .70), (.13, 1), (0, 1)], .7), ([(.70, .80), (.83, .77), (.83, .93), (.70, .95)], .7), ([(.44, .31), (.468, .31), (.468, .38), (.44, .38)], .7), ([(.88, .25), (1, .25), (1, .48), (.88, .46)], .4), ([(.11, .59), (.18, .58), (.18, .66), (.11, .66)], .5)], 9)
    water = soft([([(.519, .22), (.528, .22), (.528, .33), (.519, .33)], 1), ([(.602, .20), (.609, .20), (.609, .26), (.602, .26)], 1), ([(.664, .19), (.672, .19), (.672, .25), (.664, .25)], 1), ([(.556, .31), (.566, .31), (.560, .38), (.551, .38)], .8), ([(.865, .27), (.877, .27), (.877, .35), (.865, .35)], .8), ([(.93, .17), (.945, .17), (.938, .24), (.928, .24)], .7)], 3)
    sky = [(.383, -.02), (.545, -.02), (.545, .03), (.50, .05), (.475, .11), (.455, .18), (.425, .17), (.405, .10), (.383, .06)]
    sky2 = [(.183, .05), (.25, .05), (.252, .19), (.224, .19), (.221, .155), (.183, .145)]
    hem = [[(.57, .45), (.612, .46), (.612, .56), (.585, .56), (.57, .50)], [(.706, .40), (.765, .375), (.765, .46), (.706, .46)], [(.755, .345), (.80, .335), (.80, .42), (.755, .42)], [(.693, .275), (.72, .28), (.80, .325), (.80, .345), (.72, .31), (.693, .30)]]
    specs = {
        1: dict(groups=[([arch], [open_, small], 7)]),
        2: dict(groups=[([barrel], None, 7), ([stall], stall_holes, 6), ([leaves], None, 8)], key=[(sky, leafy), (sky2, leafy)] + [(z, cloth) for z in hem], fade=[[(.10, -.05), (.185, -.05), (.185, .25), (.10, .25)]], soft=8),
        3: dict(groups=[([frontL], None, 12), ([frontR], None, 12)]),
    }
    d = put(d, [(.13, -.06), (.25, -.06), (.25, .14), (.13, .16)], .52, 16)
    make('o', 'outskirts', 'The Outskirts/Outskirts4k.jpg', specs, gaussian_filter(d, 6 * S), wind, water)


def underbelly():
    global VP
    VP = [.605, .30]
    v1 = view(.42, .14, .82, .78, 1500, 1018)
    v2 = view(.15, .02, .54, .62, 1500, 979)
    v3 = view(0, .46, .54, 1, 1500, 636)
    z1 = view(.455, .22, .715, .46, 1600, 626)
    z2 = view(.32, 0, .50, .34, 1600, 1280)
    z3 = view(.395, .38, .565, .76, 1400, 1327)
    bridge = z3([(330, 1010), (322, 760), (318, 600), (300, 470), (262, 400), (290, 342), (345, 312), (420, 292), (470, 284), (500, 262), (520, 215), (556, 178), (600, 196), (650, 188), (655, 160), (672, 152), (690, 205), (745, 212), (790, 190), (860, 204)]) + z1([(240, 570), (330, 535), (430, 500), (540, 465), (600, 445), (700, 410), (770, 388), (850, 368), (960, 335), (1060, 315), (1170, 297), (1290, 275), (1350, 260), (1336, 150), (1300, 152), (1335, 118), (1345, 82), (1368, 100), (1380, 45), (1392, 5), (1414, 45), (1418, 95), (1440, 92), (1600, 24)]) + v1([(1190, 149), (1205, 960), (1030, 960), (850, 960), (700, 950), (640, 940), (600, 938), (470, 905), (380, 905)])
    rails = [z1(p) for p in [
        [(118, 552), (375, 467), (375, 491), (135, 574)], [(226, 496), (258, 494), (262, 560), (228, 575)], [(375, 428), (395, 421), (428, 428), (432, 508), (378, 520)], [(428, 452), (492, 424), (492, 446), (428, 474)], [(428, 452), (446, 446), (492, 472), (492, 488), (470, 480)],
        [(490, 408), (505, 400), (535, 408), (538, 470), (492, 484)], [(534, 420), (642, 380), (642, 396), (534, 440)], [(640, 362), (655, 354), (675, 362), (678, 420), (642, 434)], [(674, 374), (800, 330), (800, 350), (674, 394)], [(735, 356), (752, 350), (768, 388), (752, 394)],
        [(798, 306), (820, 298), (848, 308), (850, 374), (800, 384)], [(846, 322), (1012, 274), (1012, 298), (846, 348)], [(1010, 250), (1034, 243), (1058, 252), (1060, 320), (1012, 330)], [(1056, 262), (1170, 236), (1170, 266), (1056, 292)], [(1168, 205), (1194, 196), (1222, 206), (1222, 296), (1172, 304)],
        [(1218, 232), (1350, 198), (1350, 264), (1250, 284), (1266, 246), (1218, 256)], [(1262, 156), (1336, 150), (1340, 196), (1264, 214)]]]
    hole = v1([(478, 900), (462, 820), (440, 740), (433, 655), (460, 638), (490, 600), (530, 555), (575, 515), (630, 490), (700, 484), (770, 491), (808, 518), (824, 560), (819, 640), (812, 712), (772, 722), (758, 762), (752, 830), (722, 870), (690, 900), (600, 936), (490, 936)])
    house = v2([(228, 120), (240, 96), (262, 86), (290, 128), (340, 150), (380, 180), (440, 208), (520, 220), (600, 216), (680, 196), (760, 176), (830, 140), (866, 112), (874, 116), (862, 182), (830, 236), (776, 300), (770, 324), (830, 326), (900, 350), (1000, 402), (1115, 465), (1110, 492), (1102, 525), (1078, 506), (1040, 502), (988, 502), (986, 540), (1050, 536), (1130, 566), (1186, 573), (1218, 596), (1212, 622), (1176, 634), (1142, 690), (1070, 736), (1050, 722), (1116, 644), (1050, 680), (986, 700), (960, 706), (958, 1000)]) + z3([(74, 450), (72, 640), (80, 640), (80, 720), (103, 720), (110, 790), (108, 830), (97, 892), (137, 900), (137, 780), (133, 725), (148, 690), (150, 650), (180, 632), (255, 655), (250, 735), (370, 785), (370, 732), (400, 725), (460, 740), (458, 808), (560, 842), (640, 866), (800, 918), (862, 934), (862, 904), (885, 893), (924, 904), (924, 948), (1057, 994), (1057, 985), (1100, 978), (1133, 988), (1133, 1066), (1146, 1070), (1146, 1132), (1134, 1136), (1132, 1300)]) + v3([(1466, 336), (1436, 341), (1435, 436), (1410, 436), (1406, 346), (1395, 350), (1366, 312), (1356, 400), (1342, 440), (1324, 390), (1300, 346), (1284, 312), (1256, 380), (1272, 452), (1278, 482), (1300, 500), (1340, 520), (1280, 540), (1200, 524), (1110, 504), (1066, 504), (1062, 524), (1005, 524), (1000, 440), (956, 440), (953, 548), (904, 548), (900, 452), (791, 456), (786, 578), (729, 588), (722, 472), (470, 518), (466, 614), (404, 614), (400, 542), (280, 562), (100, 592), (-40, 612), (-40, 40), (0, 42), (60, 62), (130, 92), (190, 112), (275, 111), (290, 99), (380, 93), (383, 150), (379, 204), (345, 206), (340, 152), (318, 138), (302, 130), (292, 300), (306, 336), (330, 341), (356, 346), (402, 356), (406, 386), (500, 372), (520, 330), (470, 285), (460, 222), (500, 210), (520, 168), (540, 120), (546, 14)]) + v2([(178, 880), (182, 742), (76, 706), (74, 690), (122, 662), (114, 600), (102, 540), (100, 490), (50, 488), (62, 460), (82, 432), (120, 418), (142, 350), (170, 270), (200, 190)])
    gaps = [z3(p) for p in [[(246, 797), (368, 832), (368, 936), (242, 906)], [(462, 884), (518, 930), (456, 952)], [(806, 948), (858, 960), (856, 1014), (808, 1000)], [(654, 934), (692, 946), (692, 968), (648, 946)], [(926, 984), (1055, 1022), (1055, 1064), (995, 1064), (990, 1036), (926, 1030)]]]
    rope = z2([(250, 788), (300, 772), (400, 790), (500, 780), (640, 758), (760, 720), (880, 668), (960, 618), (985, 606), (985, 660), (900, 712), (780, 762), (640, 800), (500, 822), (400, 818), (300, 806)])
    strip = z2([(978, 610), (1080, 560), (1180, 470), (1250, 380), (1330, 262), (1340, 272), (1270, 420), (1190, 520), (1090, 610), (978, 668)])
    diag = z2([(505, 440), (560, 340), (640, 290), (690, 240), (690, 130), (760, 130), (830, 160), (838, 176), (770, 238), (760, 330), (715, 400), (694, 330), (640, 370), (560, 440), (515, 560), (505, 520)])
    links = [z2(p) for p in [[(496, 20), (552, 30), (552, 100), (540, 160), (534, 230), (534, 320), (520, 420), (530, 520), (520, 640), (505, 700), (500, 776), (482, 770), (486, 690), (488, 620), (476, 540), (466, 450), (476, 340), (490, 240), (488, 120)], [(590, 60), (640, 60), (628, 180), (606, 260), (588, 300), (590, 200)], [(1418, 20), (1466, 60), (1456, 150), (1440, 260), (1400, 270), (1404, 150), (1390, 70)], [(1340, 150), (1390, 160), (1376, 260), (1360, 350), (1346, 356), (1338, 250)]]]
    pink = z2([(775, 226), (880, 100), (960, -20), (1500, -20), (1450, 40), (1330, 80), (1100, 116), (1034, 196), (900, 228)])
    chains = [z3(p) for p in [[(78, 262), (110, 300), (170, 322), (245, 316), (245, 332), (170, 338), (100, 320), (76, 290)], [(246, 326), (270, 350), (300, 382), (350, 388), (420, 350), (455, 290), (470, 230), (505, 160), (520, 90), (534, 95), (520, 180), (486, 240), (470, 310), (430, 370), (350, 400), (290, 396), (250, 350)], [(454, 100), (470, 100), (470, 210), (456, 210)]]]
    brace = z3([(70, 434), (180, 372), (250, 308), (320, 218), (380, 128), (425, 56), (472, 60), (440, 142), (380, 238), (300, 312), (250, 348), (72, 454)])
    hole2 = v3([(196, 168), (258, 134), (286, 142), (276, 288), (242, 292), (236, 205)])
    banner = z2([(1030, 170), (1300, 165), (1290, 260), (1252, 420), (1215, 680), (1180, 960), (1160, 1110), (1146, 1208), (1118, 1150), (1090, 1082), (1060, 1050), (1040, 985), (1008, 928), (960, 985), (930, 1050), (926, 1020), (946, 860), (975, 690), (1005, 420)])
    lamp = v2([(1245, -40), (1292, -40), (1286, 70), (1300, 110), (1331, 140), (1335, 165), (1311, 250), (1290, 275), (1270, 298), (1246, 270), (1225, 250), (1212, 165), (1218, 140), (1245, 105), (1254, 60)])
    uc = view(0, 0, .56, 1, 1600, 1212)
    beam = uc([(430, -40), (520, 30), (600, 76), (680, 96), (760, 104), (815, 102), (800, 150), (790, 200), (850, 200), (880, 140), (902, 98), (960, 80), (1040, 46), (1066, 14), (1150, 56), (1250, 72), (1330, 66), (1420, 28), (1450, -40)])
    chain1 = uc([(749, 84), (770, 84), (771, 216), (751, 216)])
    chain2 = uc([(1066, 100), (1086, 100), (1085, 262), (1067, 262)])
    front = [[(.645, 1.03), (.647, .925), (.665, .908), (.69, .905), (.712, .917), (.716, 1.03)],
             [(.845, 1.03), (.85, .94), (.878, .92), (.905, .92), (.91, .88), (.92, .82), (.95, .81), (.955, .76), (.97, .75), (1.03, .74), (1.03, 1.03)]]
    d = ramp(.60, .9)
    d = np.maximum(d, soft([([(0, .30), (.12, .30), (.20, .55), (.18, .80), (0, .85)], .22), ([(.16, .20), (.24, .15), (.26, .70), (.16, .72)], .14), ([(.33, .0), (.45, .0), (.46, .50), (.38, .52)], .10), ([(.80, .20), (1, .16), (1, .74), (.80, .72)], .16), ([(.46, .40), (.62, .34), (.62, .62), (.46, .62)], .10)], 34))
    d = put(d, [(.70, .14), (.79, .14), (.79, .66), (.70, .72)], .30, 24)
    d = put(d, [(.76, .34), (.91, .34), (.91, .76), (.76, .76)], .17, 22)
    d = put(d, [(.535, .44), (.64, .44), (.64, .715), (.535, .715)], .13, 10)
    d = put(d, [(.612, .64), (.745, .64), (.745, .80), (.612, .80)], .30, 10)
    d = put(d, [(-.02, .75), (.40, .78), (.53, .72), (.53, .86), (.48, .94), (-.02, .97)], .52, 16)
    d = put(d, [(.755, .72), (.985, .72), (.985, 1.02), (.755, 1.02)], .52, 20)
    d = put(d, [(.515, .70), (.58, .70), (.58, .785), (.515, .785)], .36, 9)
    d = put(d, [(.515, .855), (.578, .80), (.582, .735), (.74, .735), (.74, 1.02), (.46, 1.02)], .66, 10)
    wind = soft([(banner, .8), ([(.24, .13), (.37, .10), (.44, .31), (.32, .28), (.25, .22)], .65), ([(.40, .37), (.46, .39), (.41, .45)], .65), ([(.45, .63), (.50, .66), (.488, .83), (.465, .76)], .8), ([(.555, .51), (.61, .54), (.58, .55)], .5), ([(0, .48), (.10, .56), (.06, .60), (0, .58)], .6), ([(.89, .62), (1, .46), (1, .60), (.94, .62)], .5), ([(.80, .10), (.93, .10), (.93, .28), (.80, .28)], .3)], 9)
    water = soft([([(.642, .475), (.658, .475), (.652, .71), (.632, .72), (.636, .60)], 1), ([(.520, .57), (.530, .57), (.538, .72), (.527, .72)], 1), ([(.438, .835), (.452, .84), (.462, .90), (.445, .905)], 1), ([(.53, .74), (.85, .70), (.84, .86), (.62, .88), (.52, .96), (.36, 1), (.40, .90)], .4)], 5)
    specs = {
        1: dict(groups=[([bridge], [hole], 6), (rails, None, 3)],
                fade=[[(.731, .0), (.90, .0), (.90, .90), (.731, .90)], [(.50, .72), (.60, .715), (.63, .718), (.80, .718), (.80, .90), (.50, .90)]], soft=6,
                mist=[([(.38, .63), (.50, .65), (.515, .66), (.53, .72), (.53, .90), (.38, .90)], 13), ([(.36, .49), (.428, .49), (.432, .80), (.36, .80)], 8)]),
        2: dict(groups=[([house], [hole2] + gaps, 5), ([banner, lamp], None, 5), ([beam], None, 5), ([diag, rope, strip, brace], None, 4), (links + chains, None, 3)]),
        3: dict(groups=[([f], None, 9) for f in front]),
        'fill': [[(.626, .43), (.672, .43), (.672, .69), (.618, .69)], [(.655, .18), (.700, .18), (.700, .285), (.655, .30)]],
    }
    d = put(d, [(.40, .46), (.452, .46), (.46, .66), (.40, .66)], .30, 12)
    d = put(d, [(.42, .62), (.55, .64), (.555, .74), (.42, .72)], .30, 14)
    make('u', 'underbelly', 'TheUnderbelly/Underbelly4k.jpg', specs, gaussian_filter(d, 6 * S), wind, water)


for k in (sys.argv[1:] or ['o', 'u']):
    outskirts() if k == 'o' else underbelly()
