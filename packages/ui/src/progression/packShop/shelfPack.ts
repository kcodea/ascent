/**
 * ONE PACK ON THE SHOP'S SHELF, as a display object (spec section 14, answer 2): the WHOLE pack art (`packArt.ts`) on a
 * PerspectiveMesh that tilts toward the pointer with the opener's tilt maths (`packTilt.ts`), and the art-masked gloss
 * band (`packFx.ts` `makeMaskedGloss`) over it, so it catches the light like the opener's sealed pack. A shelf pack never
 * tears, so it has no strip, sleeve or body grid of its own.
 *
 * A look with no art paints the opener's placeholder (the strip over the body, `packTextures.ts`) into the one canvas.
 * Art arrives asynchronously: the placeholder shows first and the canvas is repainted in place once the image loads (as
 * `packViews.ts` does), so the texture, the mesh and the gloss's mask never change object.
 *
 * Coordinates: the view is centred on the pack and drawn in the pack's BASE units (`PACK_GEOM`), scaled to the pose's
 * height. `pose` allocates nothing and rewrites the mesh only when the tilt, its depth or the gloss band moved.
 */
import { CanvasSource, Container, PerspectiveMesh, Texture } from 'pixi.js';
import type { PackLook } from '@game/progression';
import { getDragFeel } from '../../dragFeel';
import { packArtFor } from '../packOpening/packArt';
import { makeMaskedGloss, type GlossFx } from '../packOpening/packFx';
import { getPackFeel } from '../packOpening/packFxConfig';
import { PACK_GEOM, TEX_RES, paintBody, paintStrip } from '../packOpening/packTextures';
import { glossBandInto, newGlossBand, newTiltPose, setTiltPose, tiltInto, tiltTargetInto } from '../packOpening/packTilt';
import type { PackPose } from './shopLayout';

const { W, H, BODY_H } = PACK_GEOM;
/** The whole pack's height (strip + body), base units. */
const HT = H + BODY_H;
/** The placeholder's printed card count (a pack holds five cards). */
const PLACEHOLDER_CARDS = 5;
/** A hovered pack at full lift: this much taller, and raised this share of its height. */
export const LIFT_GROW = 0.08;
export const LIFT_RISE = 0.06;

/** `p` lifted by `lift` (0..1): grown and raised. Writes `out` (may be `p`) and returns it. */
export function liftPoseInto(out: PackPose, p: PackPose, lift: number): PackPose {
  const l = Math.max(0, Math.min(1, lift));
  out.x = p.x;
  out.y = p.y - LIFT_RISE * p.h * l;
  out.h = p.h * (1 + LIFT_GROW * l);
  out.rot = p.rot;
  out.alpha = p.alpha;
  return out;
}

/** Images shared by every shelf pack (a shelf repeats the same wrapper), loaded once per src. */
const images = new Map<string, HTMLImageElement>();
const ready = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth > 0;

function withImage(src: string, onLoad: (img: HTMLImageElement) => void): void {
  let img = images.get(src);
  if (!img) {
    if (typeof Image === 'undefined') return;
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  if (ready(img)) { onLoad(img); return; }
  const el = img;
  el.addEventListener('load', () => { onLoad(el); }, { once: true });
}

export class ShelfPack {
  readonly view = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: Texture;
  private readonly mesh: PerspectiveMesh;
  private readonly gloss: GlossFx | null;
  private lookKey = '';
  /** Bumped by every `setLook` and by `destroy`: a load that arrives for an older look touches nothing. */
  private loadToken = 0;
  private destroyed = false;

  // scratch (no per-frame allocation)
  private readonly lifted: PackPose = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
  private readonly angles = { rx: 0, ry: 0 };
  private readonly tiltPose = newTiltPose();
  private readonly band = newGlossBand();
  private readonly pt = { x: 0, y: 0 };
  private readonly corners = new Float64Array(8);
  /** What the mesh was last written with (rewrite only when one changes). */
  private readonly key = { rx: NaN, ry: NaN, D: NaN };

  /** `webgl`: whether the renderer can take the gloss shader. `bandTex`: the gloss band (`paintGlossBand`), shared. */
  constructor(webgl: boolean, bandTex: Texture) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * TEX_RES);
    this.canvas.height = Math.round(HT * TEX_RES);
    this.tex = new Texture({ source: new CanvasSource({ resource: this.canvas }) });
    this.mesh = new PerspectiveMesh({ texture: this.tex, verticesX: 10, verticesY: 10 });
    this.mesh.setCorners(-W / 2, -HT / 2, W / 2, -HT / 2, W / 2, HT / 2, -W / 2, HT / 2);
    this.gloss = makeMaskedGloss(webgl, this.mesh, this.tex, bandTex);
    this.view.addChild(this.mesh);
    if (this.gloss) {
      const g = this.gloss.u.uGeom;
      g[0] = W; g[1] = 0; g[2] = HT; // the band is placed on the whole pack (no strip above the body here)
      this.view.addChild(this.gloss.mesh);
    }
    this.view.visible = false;
  }

  /** Show `look`: its art when it has some (the placeholder until the image loads), else the placeholder. */
  setLook(look: PackLook): void {
    if (this.destroyed) return;
    const key = `${look.kind}:${look.id}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    const token = ++this.loadToken;
    const src = packArtFor(look);
    const cached = src ? images.get(src) : undefined;
    if (cached && ready(cached)) { this.paintArt(cached); return; }
    this.paintPlaceholder(look);
    if (!src) return;
    withImage(src, (img) => { if (token === this.loadToken && !this.destroyed) this.paintArt(img); });
  }

  /**
   * Draw the pack at `p` (canvas px, `shopLayout.ts`), tilted toward the pointer and lifted. `tiltX` / `tiltY` are the
   * eased pointer aim over the pack, each -1..1 (`packTilt.ts` `aimInto`, 0 = at rest): they become the tilt's angles
   * through the live knobs (the drag dive's `tiltMax` x the Pack Lab's `packTilt`) and slide the gloss band. `lift` is
   * 0..1 (`liftPoseInto`). A pose with `alpha` 0 is not drawn. `recline` (degrees) lays the pack back on a surface: its
   * top edge goes away from the viewer, on top of the pointer tilt (a pack lying on the counter).
   */
  pose(p: PackPose, tiltX: number, tiltY: number, lift: number, recline = 0): void {
    if (this.destroyed) return;
    const q = liftPoseInto(this.lifted, p, lift);
    const on = q.alpha > 0;
    this.view.visible = on;
    if (!on) return;
    const k = q.h / HT;
    this.view.alpha = q.alpha;
    this.view.position.set(q.x, q.y);
    this.view.rotation = q.rot;
    this.view.scale.set(k);

    const df = getDragFeel(), feel = getPackFeel();
    const a = tiltTargetInto(this.angles, tiltX, tiltY, df.tiltMax, feel.packTilt, true);
    // the drag dive's CSS perspective (stage px) in pack base units, as the opener's sealed pack has it
    const D = df.perspective / Math.max(0.05, k);
    const key = this.key, rx = a.rx + recline;
    if (key.rx !== rx || key.ry !== a.ry || key.D !== D) {
      this.writeCorners(rx, a.ry, D);
      key.rx = rx; key.ry = a.ry; key.D = D;
    }

    const g = this.gloss;
    if (g) {
      const b = glossBandInto(this.band, feel.gloss, feel.glossSharpness, tiltX, tiltY, a.rx, a.ry, df.tiltMax, W, HT);
      g.mesh.alpha = b.alpha;
      g.mesh.visible = b.alpha > 0.002;
      const ub = g.u.uBand;
      ub[0] = b.centre; ub[1] = Math.max(0.001, b.halfWidth); ub[2] = b.slope; ub[3] = b.cy;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadToken++;
    const gm = this.gloss?.mesh;
    const geoms = [this.mesh.geometry, gm?.geometry];
    const shader = gm?.shader;
    this.view.destroy({ children: true });
    for (const geo of geoms) geo?.destroy();
    shader?.destroy();
    this.tex.destroy(true);
  }

  /** The four corners through the tilt about the pack's centre; the gloss shares the mesh's vertices. */
  private writeCorners(rx: number, ry: number, D: number): void {
    const pose = setTiltPose(this.tiltPose, rx, ry, 0, 0, D);
    const c = this.corners, p = this.pt;
    for (let i = 0; i < 4; i++) {
      const x = i === 1 || i === 2 ? W / 2 : -W / 2, y = i >= 2 ? HT / 2 : -HT / 2;
      if (pose.flat) { p.x = x; p.y = y; } else tiltInto(p, x, y, 0, pose);
      c[i * 2] = p.x; c[i * 2 + 1] = p.y;
    }
    this.mesh.setCorners(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    const og = this.gloss?.mesh.geometry, pos = this.mesh.geometry.positions;
    if (og && og.positions.length === pos.length) { og.positions.set(pos); og.getBuffer('aPosition').update(); }
  }

  private paintPlaceholder(look: PackLook): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    try {
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.drawImage(paintStrip(look), 0, 0, this.canvas.width, H * TEX_RES);
      g.drawImage(paintBody(look, PLACEHOLDER_CARDS), 0, H * TEX_RES, this.canvas.width, BODY_H * TEX_RES);
      this.tex.source.update();
    } catch { /* no 2D canvas: the pack stays blank */ }
  }

  private paintArt(img: HTMLImageElement): void {
    if (this.tex.destroyed) return;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    try {
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      this.tex.source.update();
    } catch { /* keep what is painted */ }
  }
}
