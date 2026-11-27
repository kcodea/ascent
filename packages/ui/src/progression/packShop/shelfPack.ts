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
import { bindRelief, flatRelief } from '../packOpening/packRelief';
import { getPackFeel } from '../packOpening/packFxConfig';
import { PACK_GEOM, TEX_RES, paintBody, paintStrip } from '../packOpening/packTextures';
import { glossBandInto, newGlossBand, newTiltPose, setTiltPose, tiltInto, tiltTargetInto } from '../packOpening/packTilt';
import type { PackPose } from './shopLayout';

const { W, H, BODY_H } = PACK_GEOM;
/** The whole pack's height (strip + body), base units. */
const HT = H + BODY_H;
/** The placeholder's printed card count (a pack holds five cards). */
const PLACEHOLDER_CARDS = 5;
/** The contact shadow texture's dark slab, as a share of the texture (`paintContactShadow`), and how much larger than the pack it is drawn. */
export const SHADOW_SLAB = 76 / 128;
/** The contact shadow against the pack's own outline: a little narrower (none at the sides), no taller (it is offset forward). */
const SHADOW_GROW = { x: 0.96, y: 1 } as const;
/**
 * A PACK WITH A BODY (owner 2026-11-26: "it looks like a 2d image laying flat. how can we make it look a bit more like a
 * physical card pack with a bit of depth and height?"). `BODY_THICK`: how thick the pack is (a share of its height): its
 * underside is drawn that far below it, darkened by `BODY_SIDE_TINT`, so the near edge shows as the pack's side when it
 * lies back, and hides under it when it stands up. `PUFF` is the shading painted onto the sleeve (alphas).
 */
const BODY_THICK = 0.009; // owner 2026-11-27: "make this line a bit thinner", then "a bit thinner still" (0.022, then 0.014)
const BODY_SIDE_TINT = 0x4a4a4a;
// owner 2026-11-27 ("theres an odd shadow on the face of the pack ... it comes to a hard line"): the near shade is
// lighter and carries on down through the bottom seal, and the bottom crease is faint (`creaseNear`), so nothing stops dead.
const PUFF = { light: 0.16, front: 0.12, side: 0.26, crease: 0.3, creaseNear: 0.08 } as const;

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

/**
 * THE PUFFED SLEEVE: shading painted over a pack's art, only where the art is (`source-atop`), so a flat picture reads as
 * a filled foil sleeve. The light is behind the packs (the lanterns on the back wall): a soft light across the far side
 * of the body, a shade toward the near edge, both sides falling away, and a crease where the body meets each sealed end.
 * Painted once per look, never per frame.
 */
function paintPuff(g: CanvasRenderingContext2D, w: number, h: number): void {
  const top = (H / HT) * h, bot = h - (H / HT) * h * 0.9; // where the body meets the top strip and the bottom seal
  g.save();
  g.globalCompositeOperation = 'source-atop';
  // far side lit, near side shaded
  const v = g.createLinearGradient(0, top, 0, bot);
  v.addColorStop(0, 'rgba(255, 255, 255, 0)');
  v.addColorStop(0.16, `rgba(255, 255, 255, ${PUFF.light})`);
  v.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  v.addColorStop(0.62, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, `rgba(0, 0, 0, ${PUFF.front})`);
  g.fillStyle = v;
  g.fillRect(0, top, w, bot - top);
  // the near shade carries on down the bottom seal, easing off toward the pack's end
  const n = g.createLinearGradient(0, bot, 0, h);
  n.addColorStop(0, `rgba(0, 0, 0, ${PUFF.front})`);
  n.addColorStop(1, `rgba(0, 0, 0, ${PUFF.front * 0.5})`);
  g.fillStyle = n;
  g.fillRect(0, bot, w, h - bot);
  // the sides fall away
  const s = g.createLinearGradient(0, 0, w, 0);
  s.addColorStop(0, `rgba(0, 0, 0, ${PUFF.side})`);
  s.addColorStop(0.14, 'rgba(0, 0, 0, 0)');
  s.addColorStop(0.86, 'rgba(0, 0, 0, 0)');
  s.addColorStop(1, `rgba(0, 0, 0, ${PUFF.side})`);
  g.fillStyle = s;
  g.fillRect(0, top, w, bot - top);
  // a crease under the top seal and above the bottom one (the body swells between them)
  const band = h * 0.022;
  for (const [y0, y1, a] of [[top, top + band, PUFF.crease], [bot, bot - band, PUFF.creaseNear]] as const) {
    const c = g.createLinearGradient(0, y0, 0, y1);
    c.addColorStop(0, `rgba(0, 0, 0, ${a})`);
    c.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = c;
    g.fillRect(0, Math.min(y0, y1), w, band);
  }
  g.restore();
}

export class ShelfPack {
  readonly view = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: Texture;
  private readonly mesh: PerspectiveMesh;
  private readonly gloss: GlossFx | null;
  /** The pack's contact shadow (`enableShadow`): the pack's own outline, a little larger, offset down and right. */
  private shadow: PerspectiveMesh | null = null;
  private readonly shadowAt = { dx: 0, dy: 0 };
  /** The pack's glow (`enableGlow`): a soft light round its outline, shown while it is selected. */
  private glow: PerspectiveMesh | null = null;
  /** The pack's underside (`enableBody`): its near edge is the pack's side. */
  private side: PerspectiveMesh | null = null;
  /** The sleeve is painted puffed (`enableBody`). */
  private puffed = false;
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
  private readonly sideCorners = new Float64Array(8);
  /** What the mesh was last written with (rewrite only when one changes). */
  private readonly key = { rx: NaN, ry: NaN, D: NaN };

  /** `webgl`: whether the renderer can take the gloss shader. `bandTex`: the gloss band (`paintGlossBand`), shared. */
  constructor(webgl: boolean, bandTex: Texture) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * TEX_RES);
    this.canvas.height = Math.round(HT * TEX_RES);
    // Mipmaps and anisotropic sampling: a pack lying back on the counter is drawn far smaller (and far more squashed
    // top to bottom) than its 2x canvas, and plain linear sampling skips texels there, which reads as grain and jagged
    // lettering (owner 2026-11-26: "the angled packs lose their visual quality pretty intensely").
    this.tex = new Texture({ source: new CanvasSource({ resource: this.canvas, autoGenerateMipmaps: true, scaleMode: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 }) });
    this.mesh = new PerspectiveMesh({ texture: this.tex, verticesX: 10, verticesY: 10 });
    this.mesh.setCorners(-W / 2, -HT / 2, W / 2, -HT / 2, W / 2, HT / 2, -W / 2, HT / 2);
    this.gloss = webgl ? makeMaskedGloss(webgl, this.mesh, this.tex, bandTex, flatRelief()) : null;
    this.view.addChild(this.mesh);
    if (this.gloss) {
      const g = this.gloss.u.uGeom;
      g[0] = W; g[1] = 0; g[2] = HT; // the band is placed on the whole pack (no strip above the body here)
      this.view.addChild(this.gloss.mesh);
    }
    this.view.visible = false;
  }

  /** The pack's painted texture (shared with the rest of its stack, `StackRest`). */
  get texture(): Texture { return this.tex; }

  /** Show `look`: its art when it has some (the placeholder until the image loads), else the placeholder. */
  setLook(look: PackLook): void {
    if (this.destroyed) return;
    const key = `${look.kind}:${look.id}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    const token = ++this.loadToken;
    if (this.gloss) bindRelief(this.gloss, look, () => token === this.loadToken && !this.destroyed);
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
      // the band's strength rides a uniform, so the relief's light (packRelief.ts) shows whatever the Gloss knob says
      g.u.uBandA = b.alpha;
      g.mesh.alpha = 1;
      g.mesh.visible = b.alpha > 0.002 || g.u.uRelief > 0;
      const ul = g.u.uLight;
      ul[0] = tiltX; ul[1] = tiltY;
      const ub = g.u.uBand;
      ub[0] = b.centre; ub[1] = Math.max(0.001, b.halfWidth); ub[2] = b.slope; ub[3] = b.cy;
    }
  }

  /**
   * Give the pack a contact shadow (a pack lying on the counter). `tex` is `paintContactShadow`'s slab, shared: its dark
   * slab is the middle `SHADOW_SLAB` of the texture. Drawn under the pack inside its own view, so it follows the pack's
   * tilt and also darkens whatever the pack overlaps.
   */
  enableShadow(tex: Texture): void {
    if (this.shadow || this.destroyed) return;
    this.shadow = new PerspectiveMesh({ texture: tex, verticesX: 4, verticesY: 4 });
    this.shadow.alpha = 0;
    this.view.addChildAt(this.shadow, 0);
  }

  /**
   * Give the pack a glow round its outline (`tex`: `paintPackGlow`'s slab, shared, same layout as the shadow's). Drawn
   * under the pack and over its shadow, added to what is behind it.
   */
  enableGlow(tex: Texture): void {
    if (this.glow || this.destroyed) return;
    this.glow = new PerspectiveMesh({ texture: tex, verticesX: 4, verticesY: 4 });
    this.glow.blendMode = 'add';
    this.glow.alpha = 0;
    this.glow.visible = false;
    this.view.addChildAt(this.glow, this.shadow ? 1 : 0);
    this.key.rx = NaN;
  }

  /**
   * Give the pack a body: its underside (the pack's own painting, darkened) drawn a pack-thickness below it, and the
   * puffed-sleeve shading on its painting. Call before `setLook`.
   */
  enableBody(): void {
    if (this.side || this.destroyed) return;
    this.side = new PerspectiveMesh({ texture: this.tex, verticesX: 4, verticesY: 4 });
    this.side.tint = BODY_SIDE_TINT;
    this.view.addChildAt(this.side, this.view.getChildIndex(this.mesh));
    this.puffed = true;
    this.key.rx = NaN;
  }

  /** The glow's strength (0..1) and colour. */
  setGlow(alpha: number, tint: number): void {
    const g = this.glow;
    if (!g) return;
    g.alpha = alpha;
    g.visible = alpha > 0.004;
    g.tint = tint;
  }

  /** The contact shadow's strength (0..1) and its offset, as shares of the pack's height. Call before `pose`. */
  setShadow(alpha: number, dx: number, dy: number): void {
    const sh = this.shadow;
    if (!sh) return;
    sh.alpha = alpha;
    sh.visible = alpha > 0.004;
    const at = this.shadowAt;
    if (at.dx !== dx || at.dy !== dy) { at.dx = dx; at.dy = dy; this.key.rx = NaN; }
  }

  /**
   * Where a spot ON the pack is drawn (canvas px), as last posed: `u` / `v` are shares of the pack's HEIGHT in from its
   * top-left corner. It goes through the pack's tilt, so something tied there (the price tag's grommet) stays on the same
   * spot of the pack as it leans toward the pointer or dives while dragged. Writes `out`.
   */
  pointInto(out: { x: number; y: number }, u: number, v: number): { x: number; y: number } {
    const x = -W / 2 + HT * u, y = -HT / 2 + HT * v;
    if (this.tiltPose.flat) { out.x = x; out.y = y; } else tiltInto(out, x, y, 0, this.tiltPose);
    const vw = this.view, k = vw.scale.x, c = Math.cos(vw.rotation), s = Math.sin(vw.rotation);
    const px = out.x * k, py = out.y * k;
    out.x = vw.position.x + px * c - py * s;
    out.y = vw.position.y + px * s + py * c;
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadToken++;
    const gm = this.gloss?.mesh;
    const geoms = [this.mesh.geometry, gm?.geometry, this.shadow?.geometry, this.glow?.geometry, this.side?.geometry];
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
    const sd = this.side;
    if (sd) {
      // the same four corners one thickness BELOW the pack (away from the camera), through the same tilt
      const s = this.sideCorners, z = -BODY_THICK * HT;
      for (let i = 0; i < 4; i++) {
        const x = i === 1 || i === 2 ? W / 2 : -W / 2, y = i >= 2 ? HT / 2 : -HT / 2;
        if (pose.flat) { p.x = x; p.y = y; } else tiltInto(p, x, y, z, pose);
        s[i * 2] = p.x; s[i * 2 + 1] = p.y;
      }
      sd.setCorners(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, s[6]!, s[7]!);
    }
    const gl = this.glow;
    if (gl) {
      // the pack's own outline: the texture's bright slab is the pack, its soft edge reaches out past it
      const mx = (c[0]! + c[2]! + c[4]! + c[6]!) / 4, my = (c[1]! + c[3]! + c[5]! + c[7]!) / 4, e = 1 / SHADOW_SLAB;
      gl.setCorners(
        mx + (c[0]! - mx) * e, my + (c[1]! - my) * e, mx + (c[2]! - mx) * e, my + (c[3]! - my) * e,
        mx + (c[4]! - mx) * e, my + (c[5]! - my) * e, mx + (c[6]! - mx) * e, my + (c[7]! - my) * e,
      );
    }
    const sh = this.shadow;
    if (sh) {
      // the pack's own outline, grown so the texture's slab is a little larger than the pack, then offset
      const mx = (c[0]! + c[2]! + c[4]! + c[6]!) / 4, my = (c[1]! + c[3]! + c[5]! + c[7]!) / 4;
      const ex = SHADOW_GROW.x / SHADOW_SLAB, ey = SHADOW_GROW.y / SHADOW_SLAB, ox = this.shadowAt.dx * HT, oy = this.shadowAt.dy * HT;
      sh.setCorners(
        mx + (c[0]! - mx) * ex + ox, my + (c[1]! - my) * ey + oy, mx + (c[2]! - mx) * ex + ox, my + (c[3]! - my) * ey + oy,
        mx + (c[4]! - mx) * ex + ox, my + (c[5]! - my) * ey + oy, mx + (c[6]! - mx) * ex + ox, my + (c[7]! - my) * ey + oy,
      );
    }
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
      if (this.puffed) paintPuff(g, this.canvas.width, this.canvas.height);
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
      if (this.puffed) paintPuff(g, this.canvas.width, this.canvas.height);
      this.tex.source.update();
    } catch { /* keep what is painted */ }
  }
}

/**
 * How each pack UNDER a stack's top lies, top-most first: turned in the counter's plane (degrees) and shifted (shares
 * of the pack's height), so a stack looks dropped there, not machined. Mirrored on alternate stacks.
 */
// (owner 2026-11-26: "i dont see the packs stacking. they should stack once per purchase, up to a max of 8": seven
// packs under the top one, each turned and pushed a little further TOWARD THE FRONT of the counter than the one above (owner
// 2026-11-26: "see the stacking on the front of the packs, not the back"), so every pack owned
// shows an edge.)
const STACK_ASKEW = [
  { a: -6, x: -0.03, y: 0.034, tint: 0xe6e6e6 },
  { a: 5, x: 0.036, y: 0.058, tint: 0xdadada },
  { a: -3.5, x: -0.02, y: 0.084, tint: 0xcecece },
  { a: 7, x: 0.046, y: 0.106, tint: 0xc2c2c2 },
  { a: -7.5, x: -0.05, y: 0.128, tint: 0xb6b6b6 },
  { a: 3, x: 0.022, y: 0.15, tint: 0xababab },
  { a: -4.5, x: -0.036, y: 0.172, tint: 0xa0a0a0 },
] as const;
/** The most packs drawn under a stack's top (a taller stack shows these and its count). */
export const STACK_UNDER_MAX = STACK_ASKEW.length;

/**
 * THE REST OF A STACK (owner 2026-11-25: "stack packs of the same type over the same slot, but each one is slightly
 * askew"): up to `STACK_UNDER_MAX` packs lying under a hand pack, drawn with that pack's own texture (no canvas of
 * their own). They stay on the counter while the top pack lifts or is carried away. Rewritten only when the lie, the
 * depth or the stack's seed changes.
 */
export class StackRest {
  readonly view = new Container();
  private readonly meshes: PerspectiveMesh[] = [];
  private readonly tiltPose = newTiltPose();
  private readonly pt = { x: 0, y: 0 };
  private readonly key = { rx: NaN, D: NaN, seed: NaN };
  private tex: Texture | null = null;

  constructor() {
    for (let i = 0; i < STACK_UNDER_MAX; i++) {
      const m = new PerspectiveMesh({ texture: Texture.EMPTY, verticesX: 6, verticesY: 6 });
      m.tint = STACK_ASKEW[i]!.tint;
      m.visible = false;
      this.meshes.push(m);
    }
    for (let i = STACK_UNDER_MAX - 1; i >= 0; i--) this.view.addChild(this.meshes[i]!); // the deepest first
    this.view.visible = false;
  }

  /** The texture the stack's packs wear (their top pack's). */
  setTexture(tex: Texture): void {
    if (tex === this.tex) return;
    this.tex = tex;
    for (const m of this.meshes) m.texture = tex;
  }

  /** Draw `n` packs lying at (x, y) (canvas px), `h` tall before the lie, turned `rot`, laid back `recline` degrees. */
  pose(x: number, y: number, h: number, rot: number, alpha: number, recline: number, n: number, seed: number): void {
    const on = n > 0 && alpha > 0;
    this.view.visible = on;
    if (!on) return;
    const k = h / HT;
    this.view.position.set(x, y);
    this.view.rotation = rot;
    this.view.scale.set(k);
    this.view.alpha = alpha;
    for (let i = 0; i < STACK_UNDER_MAX; i++) this.meshes[i]!.visible = i < n;
    const D = getDragFeel().perspective / Math.max(0.05, k), key = this.key;
    if (key.rx === recline && key.D === D && key.seed === seed) return;
    key.rx = recline; key.D = D; key.seed = seed;
    const pose = setTiltPose(this.tiltPose, recline, 0, 0, 0, D), p = this.pt;
    const flip = seed % 2 === 0 ? 1 : -1;
    for (let i = 0; i < STACK_UNDER_MAX; i++) {
      const s = STACK_ASKEW[i]!, a = (s.a * flip * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const ox = s.x * HT * flip, oy = s.y * HT, c = this.corners;
      for (let j = 0; j < 4; j++) {
        const lx = j === 1 || j === 2 ? W / 2 : -W / 2, ly = j >= 2 ? HT / 2 : -HT / 2;
        // turned and shifted IN the counter's plane, then seen through the lie
        const px = lx * ca - ly * sa + ox, py = lx * sa + ly * ca + oy;
        if (pose.flat) { p.x = px; p.y = py; } else tiltInto(p, px, py, 0, pose);
        c[j * 2] = p.x; c[j * 2 + 1] = p.y;
      }
      this.meshes[i]!.setCorners(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    }
  }

  private readonly corners = new Float64Array(8);

  destroy(): void {
    const geoms = this.meshes.map((m) => m.geometry);
    this.view.destroy({ children: true });
    for (const g of geoms) g.destroy();
  }
}
