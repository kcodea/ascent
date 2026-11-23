/**
 * PACK OPENING: the tear strip's mesh (spec §6, §11), ported from the prototype's `buildCurve` / `solveK` /
 * `computeStrip` (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html).
 *
 * The peeled foil hangs as a cubic curve from the tear front (leaving the pack at the peel-off angle) to the held corner.
 * The strip is a 60 x 8 grid with PER-TRIANGLE (unshared) vertices, so a triangle can be "hidden" by collapsing it:
 * each frame every triangle is projected, and its projected winding decides whether it shows the printed FRONT or the
 * lining BACK (the other mesh gets it collapsed to a point). A shade mesh (multiply) and a spec mesh (add) SHARE one
 * geometry whose u = the surface angle, so the light rolls over the bend. Plus the torn lip along the pack and the
 * contact shadow's numbers.
 *
 * Everything is in the pack's base units (`PACK_GEOM`). No allocation per frame: every buffer is created once and
 * updated in place.
 */
import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { Vec3 } from './peelModel';
import { PACK_GEOM } from './packTextures';

const { W, H } = PACK_GEOM;
/** Grid columns / rows. */
const NX = 60, NY = 8;
const GW = NX + 1, G = GW * (NY + 1);
/** Curve samples. */
const M = 40;

/** A reusable 2D point (projection output). */
export interface Pt { x: number; y: number }

/** Screen (pack plane) <- 3D, perspective `D` about the strip's centre. Writes `out`. */
export function projInto(out: Pt, x: number, y: number, z: number, D: number): Pt {
  const f = D / Math.max(40, D - z);
  out.x = W / 2 + (x - W / 2) * f;
  out.y = H / 2 + (y - H / 2) * f;
  return out;
}

/** 3D at depth `z` <- screen (pack plane). Writes `out`. */
export function unprojInto(out: Pt, X: number, Y: number, z: number, D: number): Pt {
  const f = D / Math.max(40, D - z);
  out.x = W / 2 + (X - W / 2) / f;
  out.y = H / 2 + (Y - H / 2) / f;
  return out;
}

/** The contact shadow under the lifted foil (alpha 0 = none). */
export interface ShadowPose { x: number; y: number; w: number; h: number; alpha: number }

/** The strip's textures: the printed front, the lining, the shade and spec lookups. */
export interface StripTextures { front: Texture; back: Texture; shade: Texture; spec: Texture }

export class StripMesh {
  /** The flap: the four meshes. The scene flies this off at the rip. */
  readonly view = new Container();
  readonly shadow: ShadowPose = { x: 0, y: 0, w: 0, h: 0, alpha: 0 };

  private readonly tris: Uint32Array;
  private readonly frontG: MeshGeometry;
  private readonly backG: MeshGeometry;
  private readonly shadeG: MeshGeometry;
  private readonly specM: Mesh;
  private readonly gx = new Float32Array(G);
  private readonly gy = new Float32Array(G);
  private readonly gz = new Float32Array(G);
  private readonly gth = new Float32Array(G);
  private readonly cX = new Float32Array(M + 1);
  private readonly cY = new Float32Array(M + 1);
  private readonly cZ = new Float32Array(M + 1);
  private readonly cL = new Float32Array(M + 1);
  private readonly p: Pt = { x: 0, y: 0 };

  constructor(tex: StripTextures) {
    const tris: number[] = [];
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = j * GW + i, b = a + 1, d = a + GW, c = d + 1;
        tris.push(a, b, c, a, c, d);
      }
    }
    this.tris = Uint32Array.from(tris);
    const NV = this.tris.length;
    const makeGeom = (): MeshGeometry => {
      const uv = new Float32Array(NV * 2);
      for (let k = 0; k < NV; k++) {
        const g = this.tris[k];
        uv[k * 2] = (g % GW) / NX;
        uv[k * 2 + 1] = Math.floor(g / GW) / NY;
      }
      const idx = new Uint32Array(NV);
      for (let k = 0; k < NV; k++) idx[k] = k;
      return new MeshGeometry({ positions: new Float32Array(NV * 2), uvs: uv, indices: idx });
    };
    this.frontG = makeGeom();
    this.backG = makeGeom();
    this.shadeG = makeGeom();
    const frontM = new Mesh({ geometry: this.frontG, texture: tex.front });
    const backM = new Mesh({ geometry: this.backG, texture: tex.back });
    const shadeM = new Mesh({ geometry: this.shadeG, texture: tex.shade });
    shadeM.blendMode = 'multiply';
    this.specM = new Mesh({ geometry: this.shadeG, texture: tex.spec });
    this.specM.blendMode = 'add';
    this.view.addChild(frontM, backM, shadeM, this.specM);
  }

  /**
   * The hanging foil: a cubic from the tear A (leaving the pack at `angle`) to the hand Hd, bowed by `k`. Fills the
   * curve samples and their running length; returns the total length.
   */
  private buildCurve(ax: number, ay: number, az: number, hx: number, hy: number, hz: number, k: number, angle: number): number {
    const { cX, cY, cZ, cL } = this;
    const p1x = ax - k * Math.cos(angle), p1y = ay, p1z = az + k * Math.sin(angle);
    let dx = ax - hx, dy = ay - hy, dz = az - hz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const p2x = hx + dx * k * 0.5, p2y = hy + dy * k * 0.5, p2z = hz + dz * k * 0.5 + k * 0.45;
    let len = 0;
    for (let m = 0; m <= M; m++) {
      const t = m / M, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      cX[m] = b0 * ax + b1 * p1x + b2 * p2x + b3 * hx;
      cY[m] = b0 * ay + b1 * p1y + b2 * p2y + b3 * hy;
      cZ[m] = b0 * az + b1 * p1z + b2 * p2z + b3 * hz;
      if (m > 0) len += Math.hypot(cX[m] - cX[m - 1], cY[m] - cY[m - 1], cZ[m] - cZ[m - 1]);
      cL[m] = len;
    }
    return len;
  }

  /** How much the foil must bow so its length matches the peeled length L (slack = more bow). */
  private solveK(ax: number, ay: number, az: number, hx: number, hy: number, hz: number, L: number, angle: number): number {
    const chord = Math.hypot(hx - ax, hy - ay, hz - az);
    if (chord >= L * 0.995) return chord * 0.12;
    let lo = 0, hi = L * 1.6;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (this.buildCurve(ax, ay, az, hx, hy, hz, mid, angle) < L) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * Rebuild the strip for tear front `T` and held corner `hand`, in place. `time` (dt units) drives the foil's idle
   * flutter. Also updates `shadow`.
   */
  compute(T: number, hand: Vec3, peelAngle: number, pinchTwist: number, highlight: number, D: number, time: number): void {
    const { gx, gy, gz, gth, cX, cY, cZ, cL, p } = this;
    const curveK = this.solveK(T, 0, 0, hand.x, hand.y, hand.z, T, peelAngle);
    const up = Math.min(1.2, Math.max(0, -hand.y / 80)), phi = -pinchTwist * up * 0.6;
    const ex = Math.sin(phi), ey = Math.cos(phi);
    for (let j = 0; j <= NY; j++) {
      const v = j / NY, y0 = v * H;
      const len = this.buildCurve(T, y0, 0, hand.x + ex * y0, hand.y + ey * y0, hand.z, curveK, peelAngle);
      let m = 0;
      for (let i = NX; i >= 0; i--) { // descending: d grows, so the curve walk only moves forward
        const g = j * GW + i, s = (i / NX) * W, d = T - s;
        let x = s, y = y0, z = 0, th = 0;
        if (d > 0) {
          const target = Math.min(1, d / T) * len;
          while (m < M - 1 && cL[m + 1] < target) m++;
          const seg = Math.max(1e-6, cL[m + 1] - cL[m]), f = Math.min(1, Math.max(0, (target - cL[m]) / seg));
          x = cX[m] + (cX[m + 1] - cX[m]) * f;
          y = cY[m] + (cY[m + 1] - cY[m]) * f;
          z = cZ[m] + (cZ[m + 1] - cZ[m]) * f;
          // surface tilt for the light: tangent along the strip (toward the free end is -s)
          const tx = -(cX[m + 1] - cX[m]), tz = -(cZ[m + 1] - cZ[m]), tl = Math.hypot(tx, tz) || 1;
          th = Math.acos(Math.max(-1, Math.min(1, tx / tl)));
          x += Math.sin(time * 0.11 + v * 2) * 0.5 * (d / W);
        }
        projInto(p, x, y, z, D);
        gx[g] = p.x; gy[g] = p.y; gz[g] = z; gth[g] = th;
      }
    }
    const tris = this.tris;
    const fp = this.frontG.positions, bp = this.backG.positions, sp = this.shadeG.positions, su = this.shadeG.uvs;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const front = (gx[b] - gx[a]) * (gy[c] - gy[a]) - (gy[b] - gy[a]) * (gx[c] - gx[a]) >= 0;
      for (let k = 0; k < 3; k++) {
        const g = tris[t + k], o = (t + k) * 2, X = gx[g], Y = gy[g];
        sp[o] = X; sp[o + 1] = Y;
        su[o] = Math.min(0.999, gth[g] / Math.PI); su[o + 1] = 0.5;
        if (front) { fp[o] = X; fp[o + 1] = Y; bp[o] = gx[a]; bp[o + 1] = gy[a]; }
        else { bp[o] = X; bp[o + 1] = Y; fp[o] = gx[a]; fp[o + 1] = gy[a]; }
      }
    }
    this.frontG.getBuffer('aPosition').update();
    this.backG.getBuffer('aPosition').update();
    this.shadeG.getBuffer('aPosition').update();
    this.shadeG.getBuffer('aUV').update();
    this.specM.alpha = highlight;

    // contact shadow under the lifted foil
    let minX = 1e9, maxX = -1e9, zMax = 0;
    for (let g = 0; g < G; g++) {
      if (gz[g] > 0.5) { minX = Math.min(minX, gx[g]); maxX = Math.max(maxX, gx[g]); zMax = Math.max(zMax, gz[g]); }
    }
    const sh = this.shadow;
    if (zMax > 0) {
      sh.x = (minX + maxX) / 2 + zMax * 0.18;
      sh.y = H + 6 + zMax * 0.12;
      sh.w = (maxX - minX) + zMax * 0.7 + 20;
      sh.h = 26 + zMax * 0.45;
      sh.alpha = Math.min(0.6, zMax / 50);
    } else sh.alpha = 0;
  }

  /** The strip's centroid on the pack plane (the rip's spin pivot). Writes `out`. */
  centroid(out: Pt): Pt {
    let cx = 0, cy = 0;
    for (let g = 0; g < G; g++) { cx += this.gx[g]; cy += this.gy[g]; }
    out.x = cx / G; out.y = cy / G;
    return out;
  }
}

/** Jag step along the torn lip (px). */
const LIP_STEP = 5;

/**
 * The torn lip: a thin jagged line along the pack's top where the strip has come away, from x = 0 to the tear front.
 * A strip of quads updated in place (points past the tear collapse onto it); replaces the prototype's per-frame
 * `Graphics` redraw, which allocates.
 */
export class TornLip {
  readonly view: Mesh;
  private readonly geom: MeshGeometry;
  private readonly jag: Float32Array;
  private readonly n: number;
  private lastT = -1;

  constructor() {
    this.n = Math.ceil(W / LIP_STEP) + 1;
    this.jag = new Float32Array(this.n);
    for (let k = 0; k < this.n; k++) this.jag[k] = (Math.random() - 0.5) * 4;
    const pos = new Float32Array(this.n * 4);
    const idx = new Uint32Array((this.n - 1) * 6);
    for (let k = 0; k < this.n - 1; k++) {
      const a = k * 2, o = k * 6;
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = a + 2;
      idx[o + 3] = a + 1; idx[o + 4] = a + 3; idx[o + 5] = a + 2;
    }
    this.geom = new MeshGeometry({ positions: pos, uvs: new Float32Array(this.n * 4), indices: idx });
    this.view = new Mesh({ geometry: this.geom, texture: Texture.WHITE });
    this.view.tint = 0xd9e0ee;
    this.view.alpha = 0.9;
    this.update(0);
  }

  /** Show the lip from 0 to the tear front `T`. */
  update(T: number): void {
    if (T === this.lastT) return;
    this.lastT = T;
    this.view.visible = T > 1;
    const pos = this.geom.positions;
    for (let k = 0; k < this.n; k++) {
      const x = Math.min(k * LIP_STEP, T), y = H + this.jag[k], o = k * 4;
      pos[o] = x; pos[o + 1] = y - 1;
      pos[o + 2] = x; pos[o + 3] = y + 1;
    }
    this.geom.getBuffer('aPosition').update();
  }
}
