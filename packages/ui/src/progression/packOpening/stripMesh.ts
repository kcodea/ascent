/**
 * PACK OPENING: the tear strip's mesh (spec §6, §11), ported from the prototype's `buildCurve` / `solveK` /
 * `computeStrip` (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html).
 *
 * The peeled foil hangs as a cubic curve from the tear front (leaving the pack at the peel-off angle) to the held corner.
 * The strip is a 60 x 8 grid with PER-TRIANGLE (unshared) vertices, so a triangle can be "hidden" by collapsing it:
 * each frame every triangle is projected, and its projected winding decides whether it shows the printed FRONT or the
 * lining BACK (the other mesh gets it collapsed to a point). A shade mesh (multiply) and a spec mesh (add) cover the
 * whole strip with u = the surface angle, so the light rolls over the bend; the spec has its own uvs because the
 * surface gloss (packTilt.ts) bumps its u only. Plus the torn lip along the pack and the
 * contact shadow's numbers.
 *
 * Everything is in the pack's base units (`PACK_GEOM`). No allocation per frame: every buffer is created once and
 * updated in place.
 */
import { Container, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';
import type { Vec3 } from './peelModel';
import { PACK_GEOM } from './packTextures';
import { glossD, glossSpecAlpha, glossStripU, tiltInto, type GlossBand, type TiltPose } from './packTilt';
import { makeHoloMesh, type HoloMaterial, type HoloMesh } from './packHoloMesh';

const { W, H, BODY_H } = PACK_GEOM;
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

/**
 * The pack's surface this frame (optional; without it the strip is exactly the prototype's): the sealed pack's mouse
 * tilt, applied to every vertex after the strip's own projection, and the gloss band, which rides the spec lookup.
 */
export interface StripSurface { tilt: TiltPose; band: GlossBand; gloss: number }

const SPEC_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec2 aArt;
out vec2 vUV;
out vec2 vArt;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV; vArt = aArt;
}`;
const SPEC_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vArt;
out vec4 finalColor;
uniform vec4 uColor;
uniform sampler2D uTex;    // the printed strip (its alpha is the foil's shape)
uniform sampler2D uTex2;   // the highlight lookup
void main() {
  finalColor = texture(uTex2, vUV) * texture(uTex, vArt).a * uColor.a;
}`;

export class StripMesh {
  /** The flap: the four meshes. The scene flies this off at the rip. */
  readonly view = new Container();
  readonly shadow: ShadowPose = { x: 0, y: 0, w: 0, h: 0, alpha: 0 };

  private readonly tris: Uint32Array;
  private readonly frontG: MeshGeometry;
  private readonly backG: MeshGeometry;
  private readonly shadeG: MeshGeometry;
  private readonly specG: MeshGeometry;
  private specM: Mesh | Mesh<MeshGeometry, Shader>;
  private readonly tex: StripTextures;
  /** The holo over the printed front (packHoloMesh.ts), when the pack has one: it shares the front's positions. */
  private holoG: MeshGeometry | null = null;
  private readonly gx = new Float32Array(G);
  private readonly gy = new Float32Array(G);
  private readonly gz = new Float32Array(G);
  private readonly gth = new Float32Array(G);
  private readonly gd = new Float32Array(G);
  private readonly cX = new Float32Array(M + 1);
  private readonly cY = new Float32Array(M + 1);
  private readonly cZ = new Float32Array(M + 1);
  private readonly cL = new Float32Array(M + 1);
  private readonly p: Pt = { x: 0, y: 0 };

  constructor(tex: StripTextures) {
    this.tex = tex;
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
    this.specG = makeGeom();
    const frontM = new Mesh({ geometry: this.frontG, texture: tex.front });
    const backM = new Mesh({ geometry: this.backG, texture: tex.back });
    const shadeM = new Mesh({ geometry: this.shadeG, texture: tex.shade });
    shadeM.blendMode = 'multiply';
    this.specM = new Mesh({ geometry: this.specG, texture: tex.spec });
    this.specM.blendMode = 'add';
    this.view.addChild(frontM, backM, shadeM, this.specM);
  }

  /**
   * Cut the strip's highlight to the strip's ART (owner 2026-11-25: "the sheen doesnt match the curve of the wrapper"):
   * the plain spec mesh lights the strip's whole rectangle, the art's see-through margin and rounded corners included,
   * which showed as a pale block past the wrapper's edge. This swaps it for the same lookup multiplied by the printed
   * strip's alpha (sampled at the strip's own uv, a second attribute), so the light ends where the foil does, however
   * the strip is tilted or peeled. WebGL only (GLSL ES 3.0); on failure the plain mesh stays.
   */
  maskSpecToArt(): void {
    try {
      this.specG.addAttribute('aArt', Float32Array.from(this.frontG.uvs));
      const { front, spec } = this.tex;
      const shader = Shader.from({
        gl: { vertex: SPEC_VERT, fragment: SPEC_FRAG },
        resources: { uTex: front.source, uTexSampler: front.source.style, uTex2: spec.source, uTex2Sampler: spec.source.style },
      });
      const masked = new Mesh({ geometry: this.specG, shader });
      masked.blendMode = 'add';
      masked.alpha = this.specM.alpha;
      const at = this.view.getChildIndex(this.specM);
      this.view.removeChild(this.specM);
      this.specM.destroy();
      this.view.addChildAt(masked, at);
      this.specM = masked;
    } catch (e) { console.warn('[stripMesh] masked spec unavailable:', e); }
  }

  /**
   * Lay the holo over the printed front: a mesh SHARING the front's position array (so back-facing triangles collapse
   * with it) whose uvs map the strip onto the shine mask's top band (the art above the tear line). Over the front, under
   * the lining back (a curl's back covers it), the shade and the spec. Returns the mesh (hidden until the scene shows it).
   */
  attachHolo(material: HoloMaterial): HoloMesh {
    const fu = this.frontG.uvs;
    const uv = new Float32Array(fu.length);
    const k = H / (H + BODY_H);
    for (let i = 0; i < fu.length; i += 2) { uv[i] = fu[i]!; uv[i + 1] = fu[i + 1]! * k; }
    const mesh = makeHoloMesh(material, this.frontG.positions, uv, Uint32Array.from(this.frontG.indices));
    this.holoG = mesh.geometry;
    this.view.addChildAt(mesh, 1); // over the front, under the back, the shade and the spec (a curl's back covers it)
    return mesh;
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
  compute(
    T: number, hand: Vec3, peelAngle: number, pinchTwist: number, highlight: number, D: number, time: number,
    surface?: StripSurface,
  ): void {
    const { gx, gy, gz, gth, gd, cX, cY, cZ, cL, p } = this;
    const tilt = surface && !surface.tilt.flat ? surface.tilt : null;
    const band = surface && surface.band.stripAmp > 0 ? surface.band : null;
    const amp = band ? band.stripAmp : 0;
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
        gd[g] = band ? glossD(band, p.x, p.y) : 0; // the gloss band is fixed to the pack plane, before the tilt
        // z is already in the strip projection above; the tilt maps the projected point on the plane (z once, not twice)
        if (tilt) tiltInto(p, p.x, p.y, 0, tilt);
        gx[g] = p.x; gy[g] = p.y; gz[g] = z; gth[g] = th;
      }
    }
    const tris = this.tris;
    const fp = this.frontG.positions, bp = this.backG.positions, sp = this.shadeG.positions, su = this.shadeG.uvs;
    const xp = this.specG.positions, xu = this.specG.uvs;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const front = (gx[b] - gx[a]) * (gy[c] - gy[a]) - (gy[b] - gy[a]) * (gx[c] - gx[a]) >= 0;
      for (let k = 0; k < 3; k++) {
        const g = tris[t + k], o = (t + k) * 2, X = gx[g], Y = gy[g];
        sp[o] = X; sp[o + 1] = Y;
        su[o] = Math.min(0.999, gth[g] / Math.PI); su[o + 1] = 0.5;
        xp[o] = X; xp[o + 1] = Y;
        xu[o] = glossStripU(gth[g], gd[g], amp); xu[o + 1] = 0.5;
        if (front) { fp[o] = X; fp[o + 1] = Y; bp[o] = gx[a]; bp[o + 1] = gy[a]; }
        else { bp[o] = X; bp[o + 1] = Y; fp[o] = gx[a]; fp[o + 1] = gy[a]; }
      }
    }
    this.frontG.getBuffer('aPosition').update();
    this.holoG?.getBuffer('aPosition').update(); // the same array as the front's
    this.backG.getBuffer('aPosition').update();
    this.shadeG.getBuffer('aPosition').update();
    this.shadeG.getBuffer('aUV').update();
    this.specG.getBuffer('aPosition').update();
    this.specG.getBuffer('aUV').update();
    this.specM.alpha = surface ? glossSpecAlpha(highlight, surface.gloss) : highlight;

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
    // ragged: mostly small teeth, now and then a longer fibre pulled up
    for (let k = 0; k < this.n; k++) this.jag[k] = (Math.random() - 0.5) * 6 - (Math.random() < 0.18 ? Math.random() * 7 : 0);
    const pos = new Float32Array(this.n * 4);
    const idx = new Uint32Array((this.n - 1) * 6);
    for (let k = 0; k < this.n - 1; k++) {
      const a = k * 2, o = k * 6;
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = a + 2;
      idx[o + 3] = a + 1; idx[o + 4] = a + 3; idx[o + 5] = a + 2;
    }
    this.geom = new MeshGeometry({ positions: pos, uvs: new Float32Array(this.n * 4), indices: idx });
    this.view = new Mesh({ geometry: this.geom, texture: Texture.WHITE });
    this.view.tint = 0xeef2fa;
    this.view.alpha = 0.95;
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
      pos[o] = x; pos[o + 1] = y - 1.6;
      pos[o + 2] = x; pos[o + 3] = H + 2.2;
    }
    this.geom.getBuffer('aPosition').update();
  }
}
