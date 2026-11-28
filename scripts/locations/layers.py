"""Parallax layers, third method (2026-11-24). Three things the earlier cuts got wrong, and what replaces them:
 - EDGES: each traced outline is only a guide. A thin band around it is solved as a matte (closed-form matting), and the
   piece's own colour is carried out under its soft edge, so no rim of background travels with it.
 - BEHIND: what a piece hides continues as the mirror of what is beside it (real texture), easing into a smooth fill.
 - FEET: where a piece stands on something it is faded in, and the ground under it has the piece's own depth, so nothing slides.
python scripts/locations/layers.py [o|u|s|r|p] [proof-dir]      (from the repo root; see docs/locations.md)
python scripts/locations/layers.py [o|u|s|r] [proof-dir] maps   (before there is a background: the maps the owner makes it from, into proof-dir)"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import sparse
from scipy.sparse.linalg import cg
from scipy.sparse.csgraph import maximum_flow
from scipy.ndimage import binary_closing, binary_dilation, binary_erosion, distance_transform_edt, gaussian_filter, gaussian_filter1d, label, map_coordinates, uniform_filter

Image.MAX_IMAGE_PIXELS = None
OUT_H = 1440
OUT_W = round(OUT_H * 6336 / 2688)
W, H = OUT_W, OUT_H
S = W / 1980
PUB = 'apps/web/public/locations/'
ART = os.environ.get('LOCATION_ART', r'C:/Game Assets/Ascent Art/Locations/')
MAPS = 'maps' in sys.argv
ARGS = [a for a in sys.argv[1:] if a != 'maps']
PREV = (ARGS[1] if len(ARGS) > 1 else os.environ.get('TEMP', '.')) + '/'
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


def snap(I, fg, bg, reach=34, lam=3.2, rounds=3):
    """WHERE THE EDGE REALLY IS: `fg` and `bg` are certain, everything else is decided by a graph cut on the painting's own
    colours near it (each pixel against the certain ones around it), so an outline only has to be close. Returns the mask."""
    from numba import njit, prange

    @njit(parallel=True, fastmath=True, cache=False)
    def cost(I, lab, ys, xs, reach, out):
        h, w = lab.shape
        for n in prange(len(ys)):
            y, x = ys[n], xs[n]
            s0, s1, n0, n1 = 0., 0., 1e-6, 1e-6
            st = (y * 7919 + x * 104729) & 0x7fffffff
            for k in range(900):
                st = (st * 1103515245 + 12345) & 0x7fffffff
                r = reach * (.12 + .88 * ((st >> 8) & 1023) / 1023.)
                st = (st * 1103515245 + 12345) & 0x7fffffff
                a = ((st >> 8) & 4095) / 4095. * 6.2832
                yy, xx = int(y + r * np.sin(a)), int(x + r * np.cos(a))
                if yy < 0 or xx < 0 or yy >= h or xx >= w:
                    continue
                l = lab[yy, xx]
                if l == 2:
                    continue
                d = (I[yy, xx, 0] - I[y, x, 0]) ** 2 + (I[yy, xx, 1] - I[y, x, 1]) ** 2 + (I[yy, xx, 2] - I[y, x, 2]) ** 2
                q = np.exp(-d / (2 * .055 ** 2)) + .004
                if l == 1:
                    s1 += q
                    n1 += 1
                else:
                    s0 += q
                    n0 += 1
            p1 = s1 / n1 if n1 > 2 else .004
            p0 = s0 / n0 if n0 > 2 else .004
            out[n] = np.log((p1 + 1e-4) / (p0 + 1e-4))

    h_, w_ = fg.shape
    unk = ~fg & ~bg
    ys, xs = np.nonzero(unk)
    if not len(ys):
        return fg.copy()
    idx = np.full((h_, w_), -1, np.int64)
    idx[ys, xs] = np.arange(len(ys))
    lab = np.where(fg, 1, np.where(bg, 0, 2)).astype(np.int8)
    out = np.zeros(len(ys))
    If = I.astype(np.float64)
    mask = fg.copy()
    # the pairs, once
    pairs = []
    for dy, dx, far in ((0, 1, 1.), (1, 0, 1.), (1, 1, 1.414), (1, -1, 1.414)):
        for sy, sx in ((dy, dx), (-dy, -dx)):
            yy, xx = ys + sy, xs + sx
            ok = (yy >= 0) & (xx >= 0) & (yy < h_) & (xx < w_)
            n = np.flatnonzero(ok)
            d = ((If[ys[n], xs[n]] - If[yy[n], xx[n]]) ** 2).sum(1)
            pairs.append((n, yy[n], xx[n], d, far))
    sig = np.median(np.concatenate([q[3] for q in pairs])) * 3 + 1e-4
    for it in range(rounds):
        cost(If, lab, ys, xs, float(reach), out)
        src = np.maximum(out, 0) * 1.
        snk = np.maximum(-out, 0) * 1.
        rows, cols, vals = [], [], []
        N = len(ys)
        for n, yy, xx, d, far in pairs:
            v = lam * (np.exp(-d / sig) + .035) / far
            j = idx[yy, xx]
            m = j >= 0
            rows.append(n[m]); cols.append(j[m]); vals.append(v[m])
            src[n[~m]] += v[~m] * fg[yy[~m], xx[~m]]
            snk[n[~m]] += v[~m] * bg[yy[~m], xx[~m]]
        rows += [np.full(N, N), np.arange(N)]
        cols += [np.arange(N), np.full(N, N + 1)]
        vals += [src, snk]
        G = sparse.coo_matrix((np.round(np.concatenate(vals) * 200).astype(np.int64), (np.concatenate(rows), np.concatenate(cols))), shape=(N + 2, N + 2)).tocsr()
        G.data = np.minimum(G.data, 2 ** 30).astype(np.int32)
        G.eliminate_zeros()
        f = maximum_flow(G, N, N + 1).flow
        res = (G - f).tocsr()
        res.data = np.maximum(res.data, 0)
        res.eliminate_zeros()
        seen = np.zeros(N + 2, bool)
        order = sparse.csgraph.breadth_first_order((res > 0).astype(np.int8), N, return_predecessors=False)
        seen[order] = True
        mask = fg.copy()
        mask[ys, xs] = seen[:N]
        # the next round learns from what is well inside either side
        inn = binary_erosion(mask, iterations=2)
        outn = binary_erosion(~mask, iterations=2)
        lab = np.where(fg | (inn & unk), 1, np.where(bg | (outn & unk), 0, 2)).astype(np.int8)
    return mask


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


def registered(I, B, hole):
    """the owner's background moved onto the painting where the two drifted (a few pixels, smoothly): offsets of the
    tiles they share, eased across the rest"""
    S2 = 1980 / W
    small = lambda a: np.asarray(Image.fromarray(np.uint8(np.clip(a, 0, 1) * 255)).resize((1980, 840), Image.BOX), float) / 255
    g = lambda a: gaussian_filter(small(a) @ np.array([.30, .59, .11]), 1.2)
    ed = lambda a: np.hypot(*np.gradient(g(a)))
    ei, eb = ed(I), ed(B)
    ho = np.asarray(Image.fromarray(np.uint8(hole * 255)).resize((1980, 840), Image.NEAREST)) > 127
    n, win, pts = 128, np.outer(np.hanning(128), np.hanning(128)), []
    for y in range(0, 840 - n, 64):
        for x in range(0, 1980 - n, 64):
            w = ~ho[y:y + n, x:x + n]
            if w.mean() < .85:
                continue
            p, q = ei[y:y + n, x:x + n] * w, eb[y:y + n, x:x + n] * w
            p, q = (p - p.mean()) * win, (q - q.mean()) * win
            F = np.fft.fft2(p) * np.conj(np.fft.fft2(q))
            c = np.fft.ifft2(F / (np.abs(F) ** .6 + 1e-6)).real
            dy, dx = [v if v < n / 2 else v - n for v in np.unravel_index(c.argmax(), c.shape)]
            if c.max() / c.std() > 9 and abs(dx) < 20 and abs(dy) < 20:
                pts.append((x + n / 2, y + n / 2, -dx, -dy))
    P = np.array(pts)
    yy, xx = np.mgrid[0:60, 0:140] * 14 + 7.
    num_, den = np.zeros((60, 140, 2)), np.full((60, 140), 1e-9)
    for x, y, dx, dy in P:
        near = P[np.hypot(P[:, 0] - x, P[:, 1] - y) < 220]
        if np.hypot(dx - np.median(near[:, 2]), dy - np.median(near[:, 3])) > 3:
            continue
        k = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 170 ** 2)) + 1e-7
        num_ += k[..., None] * np.array([dx, dy])
        den += k
    f = num_ / den[..., None]
    up_ = lambda a: np.asarray(Image.fromarray(a.astype(np.float32)).resize((W, H), Image.BICUBIC)) / S2
    fx, fy = up_(f[..., 0]), up_(f[..., 1])
    print('registered: mean', np.abs(f).mean().round(2), 'most', np.abs(f).max().round(1), 'of', len(P), 'tiles', flush=True)
    Y, X = np.mgrid[0:H, 0:W].astype(float)
    return np.stack([map_coordinates(B[..., i], [Y + fy, X + fx], order=1, mode='nearest') for i in range(3)], -1)


def maps(tag, master, specs):
    """what the owner makes the background from: the painting, the same with every piece cut out in magenta, and with the holes
    blurred; and `cut-*`, the outlines over the painting, to check the tracing before anyone paints to it"""
    I = np.asarray(master.resize((W, H), Image.LANCZOS), float) / 255
    lum = I @ np.array([.30, .59, .11])
    vis, total = I * .75, np.zeros((H, W), bool)
    for li, tint in {1: (60, 200, 255), 2: (255, 220, 40), 3: (255, 60, 200)}.items():
        m = np.zeros((H, W), bool)
        for polys, holes, band in specs[li]['groups']:
            s = raster(polys) > .5
            m |= s & ~(raster(holes) > .5) if holes else s
        for zone, fn in specs[li].get('key', []):
            f, b = fn(I, lum)
            m |= (raster([zone]) > .5) & ~b & binary_dilation(f, iterations=2)
        edge, t = m & ~binary_erosion(m, iterations=3), np.array(tint) / 255
        vis = np.where(m[..., None], vis * .72 + t * .28, vis)
        vis = np.where(edge[..., None], t, vis)
        total |= m
    Image.fromarray(np.uint8(np.clip(vis, 0, 1) * 255)).resize((1980, 840), Image.LANCZOS).save(PREV + f'cut-{tag}.png')
    hole = binary_dilation(total, iterations=22)
    hole = binary_closing(hole, iterations=12) | hole
    lab, n = label(~hole)              # tiny islands left inside a piece are noise: cut them too
    if n:
        hole |= (np.bincount(lab.ravel()) < 6000)[lab] & ~hole
    Image.fromarray(np.uint8(I * 255)).save(PREV + f'{tag}-0-full-painting.png')
    w = (~hole).astype(float)
    acc, got = np.zeros_like(I), np.zeros((H, W))
    for s in (14, 40, 100, 240):
        q = gaussian_filter(w, s)
        c = np.stack([gaussian_filter(I[..., i] * w, s) for i in range(3)], -1) / np.maximum(q, 1e-5)[..., None]
        t = np.clip(q / .08, 0, 1) * (1 - got)
        acc += c * t[..., None]
        got += t
    acc /= np.maximum(got, 1e-5)[..., None]
    k = gaussian_filter(hole.astype(float), 2)[..., None]
    Image.fromarray(np.uint8(np.clip(I * (1 - k) + acc * k, 0, 1) * 255)).save(PREV + f'{tag}-1-background-blurry.png')
    Image.fromarray(np.uint8(np.where(hole[..., None], np.array([1., 0, 1]), I) * 255)).save(PREV + f'{tag}-2-background-holes-magenta.png')
    print(tag, 'cut out', round(hole.mean() * 100, 1), '%', flush=True)


def make(tag, folder, file, specs, depth, wind, water, back=None, align=False):
    """The painting itself is the ground; the owner's background shows only where a piece hides it. So nothing can be lost."""
    master = Image.open(ART + file).convert('RGB')
    if MAPS:
        return maps(tag, master, specs)
    I = np.asarray(master.resize((W, H), Image.LANCZOS), float) / 255
    B = np.asarray(Image.open(ART + (back or file.replace('4k.jpg', '4kBG.jpg'))).convert('RGB').resize((W, H), Image.LANCZOS), float) / 255
    lum = I @ np.array([.30, .59, .11])
    if align:
        hole = np.zeros((H, W), bool)
        for li in (1, 2, 3):
            for polys, holes, band in specs[li]['groups']:
                hole |= binary_dilation(raster(polys) > .5, iterations=24)
            for zone, fn in specs[li].get('key', []):
                hole |= raster([zone]) > .5
        B = registered(I, B, hole)
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
            z = (raster([zone]) > .5) & (near < .5) & (~core | bool(specs.get('snap')))
            f, b = fn(I, lum)
            if specs.get('snap'):          # inside an outline only what is plainly background is opened
                op = z & core & (I[..., 2] - I[..., 0] > .04) & (lum > .55)
                lab_, n_ = label(op)
                op &= (np.bincount(lab_.ravel()) > 250)[lab_]
                if sp.get('open'):         # and where a lattice is known to let the light through, anything pale
                    op |= (raster(sp['open']) > .5) & core & (lum > .50) & (I[..., 2] - I[..., 0] > -.02)
                op = binary_dilation(op, iterations=5) & core
                zz = z & (~core | op)
                val = np.where(zz & f & ~(core & ~op), 1., np.where(zz & b, 0., np.where(zz, .5, val)))
                unk = np.where(zz, ~(f | b), unk)
            else:
                val = np.where(z & f, 1., np.where(z & b, 0., np.where(z, .5, val)))
                unk = np.where(z, ~(f | b), unk)
        fade = raster(sp['fade'], sp.get('soft', 8) * S) if sp.get('fade') else np.zeros((H, W))
        for q, b in sp.get('mist', []):
            fade = np.maximum(fade, raster([q], b * S))
        unk &= near < .5
        if specs.get('snap'):
            sure = (val > .5) & ~unk
            none = (val <= .5) & ~unk
            cut = snap(I, sure, none)
            for flip, least in ((False, 90), (True, 60)):      # no specks, no pinholes
                m = ~cut if flip else cut
                lab_, n_ = label(m)
                size = np.bincount(lab_.ravel())
                drop = (size < least)[lab_] & m & unk
                cut = np.where(drop, flip, cut)
            edge = binary_dilation(cut, iterations=2) & ~binary_erosion(cut, iterations=2, border_value=1) & unk
            a = matte(I, ~edge, cut.astype(float))
            a = np.clip((a - .05) / .90, 0, 1)
            a = np.minimum(a, np.clip(gaussian_filter(cut.astype(float), 1.1) * 2.2, 0, 1))   # nothing outside the cut
        else:
            a = matte(I, ~unk, val)
            a = np.clip((a - .07) / .85, 0, 1)
        a = np.where(near > .5, np.maximum(a, solid), a)
        a = a * (1 - np.clip(fade * 1.02, 0, 1))
        mine = gaussian_filter(fade, 9 * S)
        free &= ~((a > .015) & (mine < .10))
        clean = (a > .94) & (near < .03)
        clean = binary_erosion(clean, iterations=1, border_value=1)
        if specs.get('snap'):              # a piece's colour never comes from its own soft edge
            clean = binary_erosion(a > .9, iterations=2, border_value=1) & (near < .03) | ((a > .97) & ~binary_dilation(a < .5, iterations=2) & (near < .03))
        F = mirror(I, clean, sp.get('reach', 34))
        if sp.get('misty'):                # what is behind a nearer piece here is mist: the light around it, with no crease and no stone
            acc, got = np.zeros_like(I), np.zeros((H, W))
            for s in (8, 18, 40, 90, 200):
                w_ = clean * np.clip((lum - .50) / .28, .01, 1) ** 2 * np.clip((I[..., 2] - I[..., 0]) / .10 + .4, .02, 1)
                q = gaussian_filter(w_, s)
                c = np.stack([gaussian_filter(I[..., i] * w_, s) for i in range(3)], -1) / np.maximum(q, 1e-6)[..., None]
                t = np.clip(q / .06, 0, 1) * (1 - got)
                acc += c * t[..., None]
                got += t
            soft_ = acc / np.maximum(got, 1e-4)[..., None]
            lab_, n_ = label(clean)        # what shows through a hole of that piece is no edge to continue
            big = clean & (np.bincount(lab_.ravel()) > 20000)[lab_]
            k_ = np.maximum(np.exp(-(distance_transform_edt(~big) / 22) ** 2), np.exp(-(distance_transform_edt(~clean) / 7) ** 2))[..., None]
            F = np.where(clean[..., None], I, F * k_ + soft_ * (1 - k_))
        if sp.get('back'):                 # what a nearer piece hides of this one is the owner's background
            z = gaussian_filter(binary_dilation(near > .03, iterations=3).astype(float), 5)[..., None]
            q = np.maximum(gaussian_filter(clean.astype(float), 34), 1e-4)
            D = (gaussian_filter(lum * clean, 34) + .02 * q) / (gaussian_filter((B @ np.array([.30, .59, .11])) * clean, 34) + .02 * q)      # in this picture's own light
            F = F * (1 - z) + np.clip(B * np.clip(D, .42, 1.1)[..., None], 0, 1) * z
        ck = gaussian_filter(clean.astype(float), .8)[..., None]
        done.append((li, np.clip(I * ck + F * (1 - ck), 0, 1), a))
        near = np.maximum(near, a)
        print(tag, li, 'matted', int(unk.sum()), 'px', flush=True)
    for q in specs.get('clean', []):   # where the owner's background is the ground, whole (nothing of a piece can be left in it)
        free &= ~(raster([q]) > .5)
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
    tone = specs.get('tone', .22)
    under = np.clip(np.maximum(B + np.clip(E, -min(.16, tone), tone), B * .55), 0, 1)
    if specs.get('fill'):              # where the background grew something of its own right beside a piece: continue the painting instead
        M = mirror(I, fr, specs.get('range', 110))
        if specs.get('haze'):
            # haze: the colours around, spread ever wider, never a crease
            acc, got = np.zeros_like(I), np.zeros((H, W))
            for s in (6, 14, 30, 64, 130, 260):
                w_ = fr * np.clip((lum - .42) / .30, .02, 1) ** 2
                q = gaussian_filter(w_, s)
                c = np.stack([gaussian_filter(I[..., i] * w_, s) for i in range(3)], -1) / np.maximum(q, 1e-6)[..., None]
                t = np.clip(q / .10, 0, 1) * (1 - got)
                acc += c * t[..., None]
                got += t
            soft_ = acc / np.maximum(got, 1e-4)[..., None]
            dd = distance_transform_edt(~fr)
            k_ = np.exp(-(dd / 10) ** 2)[..., None]
            M = M * k_ + soft_ * (1 - k_)
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
        c = warp(bout, depth * (0 if specs.get('planes') else 1), px, py, k)
        for li in (1, 2, 3):
            C, A = out_layers[li]
            c = over(c, C, A, specs['planes'] if specs.get('planes') and li == 1 else DEP[li] * .25, px, py, k)
        Image.fromarray(np.uint8(np.clip(c, 0, 1) * 255)).save(PREV + f'move-{tag}-{nm}.png')
    master.resize((1886, 800), Image.LANCZOS).save(out + 'flat.webp', quality=86)
    master.resize((960, 407), Image.LANCZOS).filter(ImageFilter.GaussianBlur(3.4)).point(lambda v: int(v * .84)).save(out + 'blur.webp', quality=88)
    if specs.get('planes'):            # hero select's lean reads the same planes
        x = np.repeat(np.linspace(0, 1, W)[None, :], H, 0)
        depth = np.zeros((H, W))
        for li in (1, 2, 3):
            A = out_layers[li][1]
            depth = depth * (1 - A) + specs['planes'](x)[li - 1] * 4 * A
        depth = gaussian_filter(depth, 5 * S)
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
    if callable(dep):
        u, v = at(.085, px, py, k)
        for _ in range(4):
            u, v = at(dep(u)[0], px, py, k)
    else:
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


def wood(I, lum):
    """brown wood, iron and red cloth against a blue sky and pale cliffs"""
    r, b = I[..., 0], I[..., 2]
    return ((r - b > .07) & (lum < .50)) | (r - b > .24) | (lum < .27), ((b - r > .015) & (lum > .40)) | ((lum > .62) & (r - b < .02))


def dim(I, lum):
    """near timber against the same timber gone pale with distance"""
    r, b = I[..., 0], I[..., 2]
    return (lum < .33) | ((r - b > .14) & (lum < .46)), (lum > .56) | ((b - r > .03) & (lum > .46))


def hazy(I, lum):
    """the same, gone grey with distance"""
    return lum < .46, lum > .57


def scrapyard():
    global VP
    VP = [.50, .37]
    sA = view(.17, 0, .47, .58, 1500, 1230)
    sB = view(0, .17, .21, .78, 1500, 1848)
    sC = view(.58, 0, .92, .72, 1500, 1347)
    sD = view(.68, .20, 1, 1, 1500, 1590)
    sE = view(0, .62, .48, 1, 1500, 504)
    s3 = view(.17, 0, .47, .36, 1500, 764)
    crane = s3([(205, -20), (160, 200), (150, 236), (140, 237), (120, 325), (92, 345), (84, 395), (95, 408), (20, 655), (50, 640), (80, 660), (110, 690), (120, 705), (180, 728), (190, 745), (215, 752), (270, 752), (320, 764)]) + sA([(390, 870), (452, 965), (475, 945), (512, 916), (545, 920), (572, 800), (590, 702), (616, 704), (632, 640), (636, 545)]) + s3([
        (640, 545), (700, 505), (800, 450), (838, 432), (858, 400), (856, 345), (822, 300), (870, 300), (908, 290), (968, 246), (975, 285), (1026, 308), (1078, 280), (1090, 294), (1160, 250), (1168, 202), (1228, 176), (1284, 160), (1300, 180), (1330, 236), (1346, 238), (1352, 180), (1395, 138), (1412, 100), (1420, 50), (1412, -20)])
    crane_holes = [s3([(365, -20), (383, -20), (395, 60), (400, 100), (420, 215), (302, 262), (300, 245), (330, 130)]), s3([(281, 373), (420, 322), (422, 395), (402, 443), (350, 525), (288, 600), (225, 690), (194, 733), (190, 690), (212, 600), (230, 515), (246, 440)]), s3([(534, -20), (585, -20), (566, 36), (570, 46), (560, 98), (549, 106), (541, 60)]), s3([(1077, 264), (1092, 244), (1122, 250), (1102, 280), (1079, 290)])]
    ezc = view(.17, 0, .47, .46, 1800, 1169)
    s4 = view(.83, .02, 1, .64, 1500, 2320)
    post = s4([(290, 1920), (400, 1900), (470, 1915), (545, 2042), (600, 2190), (645, 2330), (512, 2330), (470, 2210), (420, 2080), (375, 1990), (300, 1985)])
    linkholes = [ezc([(884, 1062), (912, 1050), (924, 1090), (916, 1138), (892, 1142), (880, 1100)])]
    cranetop = s3([(690, -30), (1225, -30), (1180, 6), (1088, 42), (1030, 36), (970, 64), (800, 118), (735, 140), (690, 112)])
    cranechains = [sA([(700, 10), (760, 8), (850, 50), (912, 66), (912, 104), (840, 100), (810, 122), (720, 84)]), sA([(838, 336), (900, 300), (940, 240), (1010, 262), (1000, 330), (980, 420), (1060, 430), (1110, 400), (1180, 300), (1230, 190), (1300, 160), (1344, 230), (1350, 360), (1330, 420), (1368, 420), (1366, 500), (1330, 520), (1392, 620), (1392, 700),
                                                                                                                      (1310, 742), (1230, 720), (1205, 650), (1220, 580), (1262, 590), (1270, 530), (1240, 510), (1244, 440), (1270, 420), (1264, 290), (1200, 400), (1130, 470), (1040, 520), (960, 510), (910, 480), (870, 540), (800, 610), (690, 655), (660, 640), (620, 600), (650, 570), (760, 560), (780, 480), (840, 470)])]
    hang = [sA([(780, 440), (806, 440), (804, 500), (790, 540), (800, 560), (796, 660), (804, 690), (798, 780), (772, 800), (774, 850), (786, 870), (778, 950), (768, 980), (770, 1040), (740, 1076), (706, 1068), (712, 1020), (722, 980), (722, 900), (740, 850), (742, 780), (744, 690), (768, 660), (776, 560), (766, 500)])]
    stall = sB([(-40, 46), (40, 46), (104, 88), (135, 78), (150, 92), (215, 152), (305, 210), (405, 278), (480, 310), (585, 338), (705, 380), (784, 392), (806, 356), (836, 360), (834, 430), (866, 464), (846, 500), (864, 545), (945, 610), (1065, 690), (1165, 728), (1250, 738), (1262, 680), (1290, 648), (1332, 668), (1322, 760), (1378, 782), (1382, 812),
                (1358, 882), (1302, 850), (1292, 900), (1262, 1050), (1210, 1300), (1170, 1560), (1132, 1700), (1068, 1700), (900, 1720), (700, 1860), (300, 1880), (-40, 1880)])
    rope = sB([(1282, 880), (1304, 1000), (1330, 1150), (1372, 1310), (1424, 1400), (1396, 1418), (1350, 1330), (1308, 1150), (1280, 980)])
    yard = [sC([(185, 985), (330, 900), (440, 828), (578, 798), (590, 768), (622, 768), (640, 788), (700, 758), (760, 590), (752, 570), (784, 540), (800, 572), (900, 560), (1040, 510), (1150, 445), (1148, 395), (1166, 395), (1176, 460), (1230, 486), (1320, 470), (1330, 458), (1352, 470), (1340, 560), (1400, 552), (1470, 610), (1540, 640), (1660, 640), (1870, 480), (1870, 1330), (900, 1330), (700, 1310), (640, 1290), (500, 1300), (320, 1330), (40, 1320), (30, 1250), (55, 1200), (55, 1070), (25, 1050), (150, 985)]),
            sC([(500, 142), (600, 116), (706, 72), (706, 200), (722, 670), (690, 652), (668, 600), (654, 680), (616, 754), (596, 630), (560, 722), (512, 798)]), sC([(400, 500), (500, 480), (860, 480), (1010, 520), (1040, 540), (860, 600), (780, 600), (700, 770), (640, 800), (570, 800), (440, 830), (400, 820)]),
            sC([(358, 440), (395, 400), (500, 395), (500, 480), (400, 500), (360, 470)]), sC([(700, 350), (850, 315), (1050, 425), (1072, 440), (1052, 500), (960, 486), (700, 480)]), sC([(1180, 345), (1250, 320), (1260, 300), (1360, 320), (1445, 370), (1460, 405), (1180, 405)]), sC([(1165, 235), (1250, 138), (1380, 175), (1445, 245), (1370, 240), (1300, 180)])]
    yardzone = [sC([(372, 860), (372, 640), (380, 600), (350, 460), (350, 400), (400, 280), (400, 140), (500, 120), (690, 44), (790, 44), (850, 110), (950, 180), (960, 250), (1160, 160), (1180, 130), (1260, 120), (1360, 60), (1410, 70), (1420, 160), (1470, 250), (1480, 560), (1540, 560), (1540, 660), (1400, 560), (1160, 470), (1000, 530), (800, 600), (640, 800), (420, 840)]),
                sD([(900, 180), (1060, 110), (1180, 0), (1260, 0), (1260, 130), (1320, 80), (1420, 100), (1440, 150), (1330, 300), (1200, 460), (1100, 400)])]
    tent = sD([(1560, -120), (1495, 20), (1450, 125), (1402, 222), (1330, 305), (1205, 462), (1060, 560), (935, 630), (905, 604), (870, 622), (880, 648), (855, 658), (865, 698), (905, 704), (950, 815), (1010, 1005), (1060, 1180), (1100, 1260), (1560, 1300)])
    tent_holes = [sD([(935, 700), (1000, 722), (1056, 795), (1076, 802), (1062, 855), (968, 858)])]
    pileR = sD([(505, 948), (640, 890), (785, 832), (960, 853), (1060, 862), (1110, 800), (1290, 765), (1560, 760), (1560, 1660), (440, 1660), (470, 1540), (505, 1470), (585, 1372), (583, 1250), (570, 1200), (530, 1140), (510, 1080)])
    blockR = sD([(440, 1660), (470, 1540), (505, 1470), (590, 1375), (640, 1345), (745, 1318), (790, 1360), (860, 1400), (950, 1450), (1075, 1482), (1080, 1440), (1112, 1400), (1112, 1300), (1150, 1290), (1200, 1230), (1250, 1190), (1330, 1165), (1360, 1135), (1560, 1140), (1560, 1660)])
    pileL = sE([(-40, 318), (60, 328), (150, 362), (240, 408), (300, 440), (350, 398), (400, 418), (402, 330), (420, 280), (455, 235), (470, 214), (520, 187), (580, 182), (610, 138), (640, 150), (660, 180), (672, 90), (693, 58), (725, 88), (757, 160), (757, 196), (820, 174), (826, 210), (814, 270), (852, 266), (854, 300), (836, 326), (872, 273), (902, 284), (1002, 360), (1062, 420), (1118, 500), (1135, 560), (-40, 560)])
    s1 = view(.60, .28, .72, .56, 1500, 1484)
    pz = view(.54, .40, .70, .64, 700, 446)
    arm = pz([(230, 146), (262, 146), (264, 190), (270, 197), (385, 216), (385, 224), (350, 232), (330, 240), (300, 262), (225, 284), (202, 292), (200, 275), (228, 268), (232, 220), (218, 214), (218, 188), (230, 186)])
    sidezone = s1([(280, 1300), (285, 1230), (320, 890), (425, 890), (425, 590), (360, 580), (358, 490), (420, 485), (420, 440), (495, 440), (500, 500), (640, 470), (745, 440), (755, 345), (830, 345), (880, 250), (835, 250), (840, 0), (910, 0), (880, 1010), (560, 1180)])
    ez1 = view(.655, 0, 1, .5, 1800, 1107)
    openings = [ez1(q) for q in [[(30, 440), (210, 440), (212, 1000), (160, 1000), (150, 960), (90, 1000), (60, 1100), (0, 1100), (0, 900), (40, 560)], [(610, 590), (800, 590), (800, 650), (640, 660)], [(985, 290), (1000, 300), (1080, 190), (1010, 185), (1010, 440), (1090, 440), (1090, 380), (1040, 380)], [(1440, 740), (1740, 640), (1720, 700), (1600, 860), (1480, 800)]]]
    towerzone = sC([(1160, 400), (1470, 400), (1484, 565), (1345, 560), (1335, 480), (1180, 470)])
    scrap = {
        1: dict(reach=55, open=openings, groups=[(yard, None, 7), ([arm], None, 5)], key=[(z, wood) for z in yardzone] + [(sidezone, dim)] + [(towerzone, hazy)]),
        2: dict(reach=55, groups=[([crane], crane_holes, 8), ([stall], None, 8), ([rope], None, 4), (hang, linkholes, 5), ([post], None, 5), ([tent], tent_holes, 7), ([pileR], None, 8)], key=[(z, wood) for z in cranechains + hang + [cranetop]]),
        3: dict(groups=[([blockR, pileL], None, 9)]),
        'clean': [[(.175, -.02), (.46, -.02), (.46, .17), (.45, .36), (.40, .36), (.35, .28), (.335, .30), (.30, .26), (.26, .34), (.17, .30), (.18, .20), (.20, .12)], [(.662, .10), (.69, .04), (.735, .01), (.78, .04), (.80, .10), (.84, .08), (.865, .10), (.880, .035), (.90, .035), (.912, .08), (.935, .16), (.955, .16), (.99, .20), (.97, .34), (.93, .42), (.80, .40), (.69, .42), (.678, .42), (.678, .30), (.662, .26)]],
        'snap': True, 'tone': .015,
    }
    d = ramp(.60, .9) * .86
    d = np.maximum(d, soft([([(0, 0), (.20, .10), (.21, .34), (0, .30)], .07), ([(.42, .34), (.62, .34), (.62, .72), (.42, .72)], .13), ([(.47, .18), (.66, .20), (.66, .50), (.56, .46)], .11), ([(.28, .36), (.43, .36), (.43, .66), (.28, .66)], .22), ([(.56, .07), (.68, .07), (.68, .40), (.56, .40)], .03), ([(.12, .26), (.22, .30), (.22, .46), (.14, .42)], .24)], 22))
    for q, v, b in [([(-.02, .52), (.21, .48), (.21, .84), (-.02, .86)], .52, 18), ([(.17, .33), (.275, .36), (.275, .56), (.17, .56)], .52, 10), ([(.245, .43), (.36, .45), (.36, .62), (.28, .64)], .40, 8), ([(.19, .52), (.30, .52), (.30, .70), (.19, .70)], .46, 8),
                    ([(.235, .58), (.375, .58), (.375, .84), (.235, .84)], .50, 9), ([(.355, .58), (.42, .58), (.42, .72), (.355, .72)], .30, 8), ([(.43, .62), (.485, .62), (.485, .75), (.43, .75)], .24, 9), ([(.34, .70), (.49, .70), (.49, .90), (.34, .90)], .58, 10),
                    ([(.575, .60), (.95, .60), (.95, .74), (.575, .74)], .30, 12), ([(.72, .72), (.80, .72), (.80, .88), (.72, .88)], .56, 8), ([(.775, .64), (.83, .64), (.83, .92), (.775, .92)], .52, 14), ([(.68, .86), (.78, .86), (.78, .98), (.68, .98)], .80, 7)]:
        d = put(d, q, v, b * 2.4)      # wide: the ground must never be seen to bend
    wind = soft([([(0, .20), (.19, .42), (.17, .50), (0, .30)], .7), ([(.28, .38), (.41, .38), (.41, .50), (.30, .50)], .5), ([(.695, .06), (.742, .05), (.742, .42), (.695, .43)], .9), ([(.755, .26), (.885, .24), (.88, .34), (.77, .36)], .55), ([(.62, .46), (.71, .43), (.70, .56), (.64, .56)], .5),
                 ([(.86, .55), (1, .30), (1, .58), (.90, .60)], .7), ([(.805, .13), (.85, .09), (.84, .18), (.81, .18)], .8), ([(.10, .72), (.17, .71), (.15, .82), (.10, .82)], .6), ([(.39, .86), (.46, .84), (.46, .95), (.39, .95)], .6), ([(.42, .70), (.45, .69), (.45, .76), (.41, .76)], .5),
                 ([(.12, .28), (.21, .32), (.20, .42), (.12, .38)], .45), ([(.19, .46), (.26, .48), (.25, .58), (.19, .58)], .4), ([(.22, .88), (.32, .86), (.31, 1), (.22, 1)], .7), ([(.68, .70), (.73, .69), (.73, .76), (.68, .76)], .5)], 9)
    water = soft([([(.651, .14), (.661, .14), (.661, .30), (.651, .30)], 1), ([(.417, .375), (.430, .375), (.430, .50), (.417, .50)], 1), ([(.926, .13), (.953, .13), (.95, .28), (.926, .28)], 1)], 3)
    make('s', 'scrapyard', 'Scrapyard/Scrapyard.jpg', scrap, gaussian_filter(d, 6 * S), wind, water, 'Scrapyard/parallax/ScrapyardBG.jpg', True)


def runebarriers():
    """Four rigid pieces and no stretching: the row of gates is one plane that recedes (its depth is linear in x), the hill
    with its ruins another, the near rocks the third; the sky and the far cliffs never bend. See LocationDef.row."""
    global VP
    VP = [.478, .36]
    rA = view(.21, 0, .62, .74, 1500, 1149)
    rB = view(.22, .33, .51, .82, 1500, 1075)
    rC = view(.66, .48, 1, 1, 1500, 974)
    rD = view(0, .55, .45, 1, 1500, 637)
    r1 = view(.54, .18, .84, .76, 1500, 1230)
    r2 = view(0, .12, .32, .72, 1500, 1192)
    r3 = view(.24, .60, .62, .98, 1500, 636)
    r4 = view(.56, .62, 1, 1, 1500, 549)
    r5 = view(.30, 0, .56, .74, 1500, 1811)
    tower = rA([(38, 655), (60, 520), (98, 440), (105, 380), (132, 270), (160, 196), (150, 184), (128, 155), (145, 105), (170, 100), (175, -40), (326, -40), (332, 55), (372, 90), (372, 186), (398, 170), (412, 160), (424, 205), (436, 222), (455, 150), (470, 108), (490, 108), (500, 92), (560, 68), (590, 84), (614, 122), (604, 100), (630, 50), (690, 10), (735, -40),
               (1120, -40), (1128, 50), (1112, 76), (1152, 110), (1182, 180), (1217, 270), (1232, 342), (1252, 350), (1256, 386), (1242, 402), (1256, 490), (1270, 520), (1290, 514), (1290, 546), (1274, 562), (1286, 630), (1308, 690), (1302, 732), (1270, 742), (1292, 880), (1345, 910), (1372, 985), (1280, 1030), (1160, 1056), (1020, 1070), (700, 1076), (640, 1046), (560, 960), (500, 925), (430, 830), (400, 760), (100, 720)])
    row = r1([(-160, 330), (60, 200), (80, 278), (165, 330), (172, 300), (195, 277), (215, 298), (217, 372), (236, 384), (222, 385), (240, 345), (250, 300), (250, 285), (268, 255), (318, 232), (330, 198), (362, 182), (358, 158), (375, 110), (412, 102), (445, 96), (455, 72), (515, 50), (545, 62), (580, 78), (600, 118), (618, 178), (622, 215),
              (640, 260), (655, 320), (668, 360), (680, 420), (690, 468), (705, 468), (706, 498), (699, 505), (704, 540), (716, 546), (728, 560), (734, 598), (740, 570), (742, 540), (770, 515), (798, 495), (805, 460), (848, 440), (855, 425), (890, 418), (925, 432), (945, 470), (950, 510), (958, 545), (972, 600), (985, 650), (994, 685),
              (1010, 705), (1012, 756), (1030, 715), (1040, 690), (1060, 665), (1068, 625), (1100, 605), (1135, 594), (1160, 615), (1168, 650), (1172, 690), (1185, 730), (1195, 772), (1205, 780), (1218, 785), (1220, 820), (1225, 770), (1250, 735), (1262, 712), (1300, 697), (1328, 705), (1335, 740), (1345, 800), (1360, 850), (1370, 900), (1378, 950), (1384, 1040)]) + r4([
              (905, 60), (940, 122), (962, 140), (985, 190), (985, 260), (960, 330), (900, 430), (200, 430), (-120, 400)]) + [(.36, .80), (.36, .66), (.50, .62)]
    hill = r2([(-40, 20), (0, 42), (55, 85), (100, 150), (150, 175), (165, 145), (180, 130), (240, 122), (262, 150), (300, 190), (318, 250), (328, 310), (326, 360), (335, 425), (370, 440), (385, 500), (420, 505), (425, 480), (450, 440), (455, 370), (470, 350), (485, 340), (490, 312), (520, 303), (560, 320), (590, 345), (600, 375), (645, 385), (700, 395), (710, 420), (738, 455), (725, 490),
               (733, 560), (733, 612), (760, 625), (800, 610), (792, 560), (793, 535), (820, 508), (840, 512), (842, 530), (878, 520), (880, 488), (910, 480), (930, 490), (933, 520), (968, 525), (975, 508), (1015, 515), (1030, 525), (1030, 590), (1012, 610), (1015, 630), (1060, 645), (1135, 665), (1150, 620), (1170, 590), (1250, 545), (1270, 500), (1285, 470), (1310, 465), (1312, 425), (1322, 440), (1345, 455), (1355, 410), (1378, 365), (1392, 420), (1396, 470), (1420, 448), (1434, 444), (1428, 490), (1450, 505), (1448, 525), (1420, 520)]) + rB([
               (492, 200), (506, 290), (546, 350), (556, 452), (612, 470), (646, 510), (655, 600), (664, 600), (700, 578), (780, 588), (790, 574), (870, 548), (958, 520), (960, 508), (1010, 500), (1020, 488), (1045, 470), (1040, 448), (1060, 444), (1056, 384), (1080, 388), (1096, 404), (1110, 370), (1135, 308), (1152, 340), (1162, 400), (1202, 404), (1206, 440), (1222, 468), (1224, 506), (1302, 540), (1376, 580), (1382, 700), (1392, 722), (1396, 840)]) + r3([
               (985, 190), (1012, 165), (1008, 130), (1020, 100), (1030, 75), (1045, 110), (1048, 158), (1060, 158), (1083, 170), (1085, 205), (1110, 208), (1132, 210), (1180, 228), (1235, 238), (1238, 275), (1280, 275), (1285, 318), (1320, 320), (1332, 368), (1370, 362), (1410, 385), (1440, 382), (1490, 400)]) + r4([
               (85, 282), (115, 300), (160, 300), (195, 320), (250, 325), (270, 300), (310, 292), (325, 265), (345, 292), (358, 310), (375, 335), (410, 355), (470, 365), (515, 370), (520, 355), (560, 350), (605, 358), (660, 372), (740, 362), (800, 345), (815, 320), (840, 290), (880, 275), (915, 268), (922, 240), (945, 195), (990, 180), (1040, 185), (1110, 205), (1100, 150), (1100, 115), (1155, 95), (1150, 75), (1175, 62), (1215, 68), (1222, 85), (1270, 78), (1335, 66), (1342, 30)]) + [(.956, .60), (.962, .585), (.965, .555), (.984, .531), (1.04, .50), (1.04, 1.04), (-.04, 1.04)]
    hill_holes = [r2([(518, 606), (522, 560), (530, 500), (550, 462), (585, 458), (615, 475), (635, 505), (640, 540), (632, 600), (622, 676), (590, 655), (548, 636)]), r3([(1140, 300), (1145, 270), (1165, 258), (1185, 275), (1196, 322), (1180, 335)]), r4([(1178, 196), (1190, 168), (1220, 140), (1258, 154), (1286, 180), (1255, 186), (1220, 190)])]
    ruin_holes = [rB([(880, 824), (885, 760), (910, 715), (960, 680), (973, 700), (966, 780), (955, 836)]), rB([(1196, 955), (1194, 690), (1205, 660), (1225, 645), (1250, 665), (1268, 720), (1272, 975), (1250, 985)])]
    archR_holes = [rC([(1424, 478), (1430, 330), (1450, 290), (1500, 250), (1570, 232), (1570, 445), (1480, 462), (1440, 478)])]
    rockL = rD([(-40, 58), (40, 82), (110, 102), (162, 130), (202, 180), (236, 240), (272, 285), (288, 312), (332, 324), (402, 358), (452, 388), (482, 424), (502, 450), (522, 490), (530, 540), (527, 640), (520, 720), (-40, 720)])
    rockM = rD([(480, 720), (500, 650), (560, 608), (650, 558), (740, 523), (870, 503), (950, 513), (1000, 538), (1060, 588), (1100, 638), (1120, 720)])
    plants = rD([(818, 464), (840, 418), (872, 450), (878, 342), (912, 380), (932, 430), (944, 370), (965, 303), (973, 340), (1032, 338), (1037, 400), (1060, 378), (1090, 390), (1122, 370), (1127, 430), (1158, 418), (1152, 468), (1192, 474), (1172, 500), (1200, 520), (1247, 523), (1217, 560), (1222, 590), (1247, 610), (1242, 720), (820, 720), (860, 560)])
    rockR = rC([(60, 1030), (80, 950), (140, 895), (148, 826), (165, 866), (200, 840), (213, 796), (235, 850), (250, 800), (262, 830), (268, 792), (282, 768), (340, 744), (420, 704), (500, 688), (550, 671), (620, 684), (642, 710), (692, 740), (717, 790), (727, 830), (800, 834), (880, 849), (960, 879), (1002, 920), (1034, 980), (1040, 1030)])
    plantsR = rC([(1180, 1030), (1250, 960), (1312, 930), (1290, 900), (1230, 850), (1155, 786), (1200, 783), (1290, 812), (1286, 758), (1332, 736), (1346, 760), (1397, 728), (1402, 760), (1372, 800), (1372, 860), (1400, 800), (1430, 783), (1500, 768), (1560, 756), (1560, 1030)])
    flash = [r5([(860, 350), (920, 332), (985, 338), (1010, 380), (1045, 480), (1075, 460), (1108, 430), (1160, 480), (1215, 570), (1250, 680), (1262, 780), (1255, 815), (1235, 850), (1232, 895), (1262, 930), (1285, 990), (1288, 1030), (1265, 1060), (1268, 1110), (1290, 1140), (1302, 1300), (1305, 1480), (1302, 1640), (1290, 1720), (800, 1720), (780, 1500), (778, 1000), (790, 870), (832, 830), (838, 700), (800, 670), (793, 560), (805, 460), (830, 390)]),
             r1([(482, 312), (500, 330), (520, 385), (545, 372), (570, 420), (590, 480), (602, 550), (612, 610), (600, 650), (618, 690), (622, 730), (620, 780), (632, 820), (636, 900), (642, 1000), (644, 1090), (490, 1090), (470, 980), (462, 900), (445, 800), (437, 640), (462, 620), (460, 570), (435, 560), (437, 470), (445, 400), (460, 345)]),
             r1([(868, 592), (885, 620), (900, 630), (915, 660), (930, 710), (936, 770), (940, 850), (948, 920), (955, 1000), (960, 1070), (880, 1060), (868, 960), (855, 850), (862, 770), (850, 750), (848, 690), (855, 630)]),
             r1([(1112, 722), (1135, 745), (1152, 800), (1160, 860), (1170, 950), (1175, 1040), (1115, 1040), (1105, 960), (1110, 880), (1100, 850), (1100, 780)]), r1([(1297, 802), (1315, 830), (1325, 880), (1330, 950), (1335, 1030), (1290, 1030), (1288, 950), (1285, 870)])]
    e = raster(flash)
    e = np.clip(gaussian_filter(e, 2.6 * S) * 2 - .9, 0, 1)          # its edge is inside the stone: nothing but the barrier moves
    e *= 1 - np.clip((np.linspace(0, 1, H)[:, None] - .60) / .10, 0, 1)
    wind = soft([([(.318, .13), (.362, .20), (.362, .47), (.318, .46)], .8), ([(.572, .37), (.592, .39), (.592, .60), (.572, .58)], .7), ([(0, .34), (.07, .40), (.08, .56), (0, .56)], .5), ([(.23, .55), (.29, .57), (.29, .66), (.23, .66)], .6), ([(.33, .62), (.36, .63), (.36, .70), (.33, .70)], .5), ([(.24, .76), (.38, .76), (.39, 1), (.25, 1)], .75), ([(.63, .79), (.68, .80), (.67, .87), (.63, .87)], .5),
                 ([(.40, .86), (.46, .86), (.46, .94), (.40, .94)], .5), ([(.69, .88), (.73, .90), (.72, 1), (.69, 1)], .4), ([(.91, .86), (1, .84), (1, 1), (.91, 1)], .75), ([(.82, .76), (.96, .72), (.97, .86), (.84, .88)], .4), ([(0, .80), (.12, .82), (.14, 1), (0, 1)], .45)], 9)
    specs = {
        1: dict(groups=[([tower, row], None, 9)], mist=[([(.838, .50), (.93, .50), (.93, 1), (.846, 1), (.842, .80)], 10)], reach=26, misty=True),
        2: dict(groups=[([hill], hill_holes + ruin_holes + archR_holes, 8)], back=True, reach=70),
        3: dict(groups=[([rockM, rockR], None, 8), ([plants, plantsR], None, 8)]),
        'clean': [[(.945, .57), (.965, .55), (.985, .53), (1.02, .515), (1.02, .64), (.945, .63)], [(.237, -.02), (.39, -.02), (.39, .10), (.335, .16), (.31, .14), (.26, .12), (.245, .20), (.237, .20)], [(.50, -.02), (.53, -.02), (.562, .30), (.566, .42), (.555, .42), (.535, .25)]],
        'fill': [[(.552, .17), (.90, .17), (.90, 1), (.50, 1), (.50, .70), (.552, .66)], [(-.02, .10), (.17, .10), (.222, .22), (.262, .22), (.262, .46), (.27, .60), (.27, 1), (-.02, 1)], [(.80, .40), (1.02, .40), (1.02, 1.02), (.80, 1.02)]],
        'snap': True, 'tone': .06, 'planes': lambda x: [.085 - .2 * (x - VP[0]), .130, .250], 'range': 26, 'haze': True,
    }
    make('r', 'runebarriers', 'Rune Barriers/RuneBarriers.jpg', specs, np.zeros((H, W)), wind, e, 'Rune Barriers/parallax/RuneBarriersBG.jpg')



def canopy(I, lum):
    """the tree's leaves and branches against the sky: leaf and bark are green, gold or brown (blue under green) or dark; sky is
    blue or white (blue at or over green) and light"""
    leaf = (I[..., 2] < I[..., 1] - .05) | (lum < .30)
    sky = (I[..., 2] >= I[..., 1] - .005) & (lum > .55)
    return leaf, sky


def terys_specs():
    """TERYS GATE's pieces (owner 2026-11-27: "make it function like the locations do with parallax elements"). Rigid pieces, the ground
    never bends (the Rune Barriers' way: big upright marble everywhere):
     1 (far) the gate building: its statues, the portal, the stairs and terraces, the ruined colonnade on its left, the wall and
       arches on its right. The sky shows through its arches.
     2 (middle) the second crowned post and the two urn pedestals at the foot of the stairs.
     3 (near) the tree, its leaves across the top (a colour `key`: a lattice of leaves on sky) and its banner; the stone railing with
       its crowned post and the lilies; the vine pillar with its plinth, the right pillar and the flower beds.
    The sky, the floating castles, the cliffs and falls, the far temple and the courtyard floor are the background."""
    cT = view(0, 0, .34, .62, 1500, 1161)
    cL = view(0, .58, .32, 1, 1500, 835)
    cR = view(.7, .3, 1, 1, 1500, 1485)
    cM = view(.24, .5, .7, .86, 1500, 498)
    cG = view(.27, 0, .82, .52, 1500, 602)
    q2 = view(.45, 0, 1, .55, 1500, 636)
    q4 = view(.45, .45, 1, 1, 1500, 636)
    # ── 1: the gate building ──
    gate = (cM([(40, 498), (40, 205), (65, 168)]) + cT([(1200, 1100), (1196, 640)])
            + cG([(12, 378), (40, 360), (75, 373), (105, 358), (108, 280), (130, 270), (165, 270), (168, 238), (180, 226), (232, 226), (242, 240), (240, 293),
                  (330, 290), (338, 283), (338, 163), (350, 148), (400, 153), (405, 80), (420, 68), (470, 70), (472, 90), (500, 84), (505, 60), (530, 45),
                  (565, 48), (598, 72), (620, 66), (645, 38), (680, 16), (700, -4), (705, -20)])
            + q2([(1009, -20), (1262, -20), (1262, 60), (1268, 140), (1262, 300), (1272, 400), (1278, 460), (1278, 518), (1300, 505), (1520, 500)])
            + cR([(1520, 720), (1100, 715), (800, 720)]) + q4([(950, 332), (770, 352), (650, 346), (0, 346)])
            + cM([(640, 345), (480, 332), (330, 330), (200, 340), (190, 360), (160, 420), (150, 498)]))
    gate_holes = None  # the sky in its arches moves with it: a window cut through the outline clipped real edges
    # ── 2: the middle posts ──
    post = cM([(195, 270), (210, 262), (420, 262), (432, 290), (412, 300), (415, 500), (205, 500), (215, 320)])
    urnL = cM([(485, 40), (530, 10), (580, 5), (630, 40), (615, 75), (580, 90), (575, 140), (620, 155), (625, 322), (560, 332), (505, 322), (505, 160), (540, 140), (540, 95), (500, 80)])
    urnR = q4([(645, 95), (700, 60), (760, 70), (775, 100), (745, 125), (745, 180), (770, 190), (770, 330), (700, 355), (670, 355), (655, 330), (655, 190), (680, 180), (680, 125)])
    # ── 3: the near frame ──
    vine = cT([(195, 560), (242, 560), (238, 885), (204, 885)])  # the vine hanging off the trunk
    trunk = cT([(-20, 300), (320, 300), (290, 380), (260, 470), (240, 560), (200, 640), (160, 700), (110, 760), (60, 820), (-20, 880)])
    banner = cT([(285, 330), (330, 300), (450, 300), (462, 330), (440, 420), (430, 700), (445, 820), (462, 900), (430, 880), (380, 850), (330, 800), (285, 770), (280, 700)])
    leftfoliage = cT([(-20, 860), (40, 870), (80, 920), (100, 1000), (90, 1100), (120, 1180), (-20, 1180)])  # the leaves at the edge, not the cliff
    rail = cL([(-20, 180), (120, 130), (260, 100), (330, 110), (380, 140), (400, 160), (470, 180), (500, 230), (560, 240), (780, 250), (785, 190), (1050, 185), (1205, 220), (1180, 265),
               (1172, 505), (1310, 515), (1325, 640), (1240, 690), (1100, 700), (1000, 700), (900, 690), (800, 700), (720, 760), (720, 860), (-20, 860)])
    rail_holes = [cL([(432, 402), (486, 402), (486, 555), (470, 590), (432, 590)]), cL([(602, 378), (655, 378), (655, 470), (640, 480), (625, 470), (605, 480)]),
                  cL([(762, 378), (790, 378), (790, 460), (775, 470), (762, 460)])]
    right = cR([(470, 1500), (380, 1500), (385, 1228), (470, 1225), (480, 1180), (500, 1095), (530, 1070), (528, 950), (470, 940), (470, 760), (520, 720), (515, 460),
                (495, 400), (492, 345), (560, 322), (610, 300), (600, 250), (690, 140), (730, 180), (800, 240), (860, 290), (880, 370), (860, 460), (840, 560), (820, 690),
                (810, 760), (850, 930), (1000, 960), (1100, 940), (1180, 950), (1240, 960), (1275, 1065), (1520, 1072), (1520, 1500)])
    rightpillar = cR([(1245, 420), (1290, 378), (1400, 348), (1520, 348), (1520, 1075), (1272, 1065), (1254, 700)])
    leaves = [(-.02, -.02), (.36, -.02), (.36, .14), (.30, .14), (.24, .08), (.20, .10), (.165, .19), (.10, .22), (.08, .27), (-.02, .27)]
    return {
        # The gate building is NOT a piece (2026-11-27, second pass): it fills the middle third, and a cutout that size slid across
        # an invented valley read as cardboard. It stays painted in the ground and never moves; only the frame does.
        1: dict(groups=[([post, urnL, urnR], None, 8)]),
        2: dict(groups=[([[(-.5, -.5), (-.49, -.5), (-.49, -.49)]], None, 2)]),  # empty
        3: dict(groups=[([trunk, vine, banner, leftfoliage], None, 8), ([rail], rail_holes, 8), ([right, rightpillar], None, 8)], key=[(leaves, canopy)]),
        'snap': True, 'tone': .08, 'planes': lambda x: [.12, .12, .26],
    }


def terys():
    """TERYS GATE (owner 2026-11-27: "use this for the returning art", renamed from the Portal of Kings): where a game's journey ends.
    Rigid pieces over the owner's background (`terys_specs`: the gate building far, the posts and urns middle, the tree, railing and
    pillars near), wind on the tree, banners and flowers only, and its own idea in the portal: the light inside it, and its ring of
    runes, pulse out from its heart (an `energy` mask in data.webp's blue)."""
    file = 'PortalOfKings.jpg'
    master = Image.open(ART + file).convert('RGB')
    if MAPS:
        return maps('p', master, terys_specs())
    wind = soft([([(0, 0), (.20, 0), (.24, .06), (.20, .20), (.12, .30), (.05, .44), (0, .44)], .8),               # the tree
                 ([(.062, .16), (.098, .16), (.098, .46), (.08, .47), (.062, .40)], .75),                             # its banner
                 ([(.81, 0), (.865, 0), (.86, .30), (.835, .39), (.81, .30)], .75),                                   # the great banner, right
                 ([(.31, .35), (.335, .35), (.335, .50), (.31, .50)], .55), ([(.375, .45), (.395, .45), (.395, .55), (.375, .55)], .5),
                 ([(.762, .41), (.785, .41), (.785, .52), (.762, .52)], .5),
                 ([(0, .55), (.10, .58), (.13, .70), (.12, 1), (0, 1)], .7),                                           # the flowers, left (not the stone)
                 ([(.36, .73), (.45, .72), (.46, .82), (.37, .83)], .45),
                 ([(.70, .72), (.785, .70), (.79, 1), (.70, 1)], .55), ([(.875, .74), (.95, .72), (.95, .86), (1, .86), (1, 1), (.875, 1)], .7)], 9)
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.hypot(xx * 1886 / W - 1122, yy * 800 / H - 292)
    disc = np.clip((136 - r) / 22, 0, 1)                                    # its edge is inside the frame: nothing but the light moves
    runes = np.clip(1 - np.abs(r - 166) / 13, 0, 1) * .8
    e = gaussian_filter(np.maximum(disc, runes), 1.5 * S) * (1 - np.clip((yy / H - .53) / .03, 0, 1))
    # The owner's background (2026-11-27, from the maps and the prompt in Locations/background-prompts.md), moved onto the painting.
    make('p', 'terys', file, terys_specs(), np.zeros((H, W)), wind, e, 'Terys Gate/TerysGateBG.jpg', align=True)
    # The whole painting, sharp, for the post-game screen's backdrop (layer0 is the background with the pieces taken out).
    master.resize((W, H), Image.LANCZOS).save(PUB + 'terys/full.webp', quality=88, method=6)


PLACES = {'o': outskirts, 'u': underbelly, 's': scrapyard, 'r': runebarriers, 'p': terys}
for k in (ARGS[:1] or list(PLACES)):
    PLACES[k]()
