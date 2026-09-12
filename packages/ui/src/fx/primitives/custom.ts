import { Sprite, type Container } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { sampleCurve, CURVE_PRESETS } from '../curve';
import { FX_BLEND_MODES, type FxBlendMode } from '../blendModes';
import { getImageTexture, IMAGE_NONE } from '../imageLibrary';
import { registerPrimitive } from '../registry';

/**
 * `custom` — an IMPORTED IMAGE (PNG / SVG) as a first-class effect layer. One `Sprite`, drawn with the art's
 * true colours at display resolution, placed at the layer's anchor and driven by everything every other
 * primitive already gets: the transform envelope (scale / spin / drift over life), the whole filter lab, and
 * a blend mode. What it adds of its own is placement (size, pivot, offset, rotation, flip, aim-at-target),
 * an alpha-over-life curve, and an optional flat tint.
 *
 * No particle shader on purpose: `particleMaterial.ts` recolours or cel-quantises a texture's RGB, which is
 * right for a silhouette and wrong for a picture. The image bytes and the `image:` id namespace come from
 * `imageLibrary.ts` (isolated from the particle `shape` import — see its header for why).
 *
 * The sprite is built LAZILY: `getImageTexture` is synchronous and `null` until the decode lands, so the
 * instance constructs with no image and simply appears the first frame the texture is ready. A missing or
 * undecodable image never hangs a fire — `isComplete` is clocked, not texture-gated.
 */

export const CUSTOM_AIM_MODES = ['fixed', 'sourceToTarget'] as const;

const DEG_TO_RAD = Math.PI / 180;
/** Below this squared distance the source→target vector has no direction worth aiming along. */
const AIM_EPSILON_SQ = 1e-6;

const SPECS = {
  image: {
    kind: 'image', label: 'Image', group: 'Image', default: IMAGE_NONE, essential: true,
    help: 'The picture this layer draws. Import a PNG or SVG (it is written to defs/images/ and ships with the def — only commit art meant to ship). Nothing draws until one is picked.',
  },
  size: {
    kind: 'slider', label: 'Size', group: 'Image', min: 8, max: 1200, step: 1, default: 200, essential: true,
    help: 'Longest side of the image in px (at the reference board size — a card-anchored def scales with the card). The other side follows the image\'s own aspect. The Transform envelope\'s Scale / time multiplies this over life.',
  },
  durationMs: {
    kind: 'slider', label: 'Duration', group: 'Image', min: 100, max: 5000, step: 10, default: 800,
    help: 'How long one play lasts, in ms. This is the timeline every "/ time" curve on this layer runs over (Alpha / time, Scale / time, the filter curves). A one-shot fire finishes here; the continuous preview loops it.',
  },
  pivotX: {
    kind: 'slider', label: 'Pivot X', group: 'Placement', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Where the image\'s own origin sits, left→right (0 = left edge, 0.5 = centre, 1 = right edge). Rotation, flip and Size act about this point, and it is what lands on the anchor.',
  },
  pivotY: {
    kind: 'slider', label: 'Pivot Y', group: 'Placement', min: 0, max: 1, step: 0.01, default: 0.5,
    help: 'Where the image\'s own origin sits, top→bottom (0 = top edge, 0.5 = centre, 1 = bottom edge).',
  },
  offsetX: {
    kind: 'slider', label: 'Offset X', group: 'Placement', min: -600, max: 600, step: 1, default: 0,
    help: 'Static nudge from the anchor point, in px (positive = right). For a drift that plays out over life use the Transform envelope\'s Drift instead.',
  },
  offsetY: {
    kind: 'slider', label: 'Offset Y', group: 'Placement', min: -600, max: 600, step: 1, default: 0,
    help: 'Static nudge from the anchor point, in px (negative = up).',
  },
  rotation: {
    kind: 'slider', label: 'Rotation', group: 'Placement', min: -180, max: 180, step: 1, default: 0,
    help: 'Static rotation in degrees, clockwise positive. With Aim = sourceToTarget this is added ON TOP of the aim, so it corrects art that was drawn pointing somewhere other than +x (right).',
  },
  aimMode: {
    kind: 'enum', label: 'Aim', group: 'Placement', options: CUSTOM_AIM_MODES, default: 'fixed',
    help: 'fixed keeps the Rotation you set. sourceToTarget rotates the image to point along the moment itself — from the source anchor toward the target anchor — so an arrow or slash drawn pointing right (+x) points at the victim. Falls back to fixed when the effect was fired without both anchors, or with the two on the same spot.',
  },
  flipX: {
    kind: 'toggle', label: 'Flip X', group: 'Placement', default: false,
    help: 'Mirror the image left↔right about its pivot.',
  },
  flipY: {
    kind: 'toggle', label: 'Flip Y', group: 'Placement', default: false,
    help: 'Mirror the image top↔bottom about its pivot.',
  },
  alpha: {
    kind: 'slider', label: 'Alpha', group: 'Look', min: 0, max: 1, step: 0.01, default: 1,
    help: 'Peak opacity. Rides the Alpha / time graph over the layer\'s Duration.',
  },
  alphaCurve: {
    kind: 'curve', label: 'Alpha / time', group: 'Look', default: [[0, 1], [1, 1]], vMax: 1, presets: CURVE_PRESETS,
    help: 'How Alpha plays over the layer\'s life (0 = fires, 1 = finishes). Flat 1 = solid the whole way; a bump fades it in and out; a falling curve dissolves it.',
  },
  tint: {
    kind: 'toggle', label: 'Tint', group: 'Look', default: false,
    help: 'Multiply the image by a colour. Off draws the art exactly as imported. (For hue shifts, saturation or contrast use the HSL / Adjustment filters below.)',
  },
  tintColor: {
    kind: 'color', label: 'Tint colour', group: 'Look', default: 0xffffff, enabledWhen: { param: 'tint', is: true },
    help: 'The colour multiplied over the image while Tint is on. White = unchanged.',
  },
  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Look', options: FX_BLEND_MODES, default: 'normal',
    help: 'How the image composites over what is behind it. normal draws it as a picture; add / screen make it glow like light; multiply / overlay darken or "stamp" it onto the board.',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type CustomParams = ParamsOf<typeof SPECS>;

class CustomInstance implements FxInstance<CustomParams> {
  private params: CustomParams;
  private readonly container: Container;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;
  private readonly oneShot: boolean;
  private sprite: Sprite | null = null;
  /** The image id the live sprite was built from — a changed param drops it so the next frame rebuilds. */
  private spriteImage = IMAGE_NONE;
  private headX = 0;
  private headY = 0;
  private aimAngle: number | null = null;
  private clockMs = 0;

  constructor(ctx: FxContext, params: CustomParams) {
    this.params = params;
    this.container = ctx.container;
    this.oneShot = ctx.oneShot === true;
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  /** Build the sprite once its texture has decoded; rebuild if the picked image changed. */
  private ensureSprite(): void {
    const id = this.params.image;
    if (this.sprite !== null && this.spriteImage === id) return;
    if (this.sprite !== null) {
      this.sprite.destroy(); // the sprite only — the texture is shared library state
      this.sprite = null;
    }
    this.spriteImage = id;
    if (id === IMAGE_NONE) return;
    const tex = getImageTexture(id);
    if (tex === null) {
      this.spriteImage = IMAGE_NONE; // not ready — try again next frame
      return;
    }
    const s = new Sprite(tex);
    this.container.addChild(s);
    this.sprite = s;
  }

  update(dtMs: number): void {
    this.clockMs += dtMs;
    const p = this.params;
    const dur = Math.max(1, p.durationMs);
    const prog = this.oneShot ? Math.min(1, this.clockMs / dur) : (this.clockMs % dur) / dur;
    const dtSec = dtMs / 1000;

    this.ensureSprite();
    const s = this.sprite;
    if (s !== null) {
      const tex = s.texture;
      const longest = Math.max(1, tex.width, tex.height);
      const k = p.size / longest;
      s.scale.set(k * (p.flipX ? -1 : 1), k * (p.flipY ? -1 : 1));
      s.anchor.set(p.pivotX, p.pivotY);
      // Children draw at ABSOLUTE screen coords (the envelope pivots the container about the head).
      s.position.set(this.headX + p.offsetX, this.headY + p.offsetY);
      const aim = p.aimMode === 'sourceToTarget' && this.aimAngle !== null ? this.aimAngle : 0;
      s.rotation = p.rotation * DEG_TO_RAD + aim;
      s.alpha = Math.max(0, Math.min(1, p.alpha * sampleCurve(p.alphaCurve, prog)));
      s.tint = p.tint ? p.tintColor : 0xffffff;
      s.blendMode = p.blendMode as FxBlendMode;
    }

    this.filters.frame(p, prog, dtSec);
    this.transform.frame(p, prog, dtSec, this.headX, this.headY);
  }

  setParams(next: CustomParams): void {
    this.params = next;
  }

  setHead(x: number, y: number): void {
    this.headX = x;
    this.headY = y;
  }

  setAim(sx: number, sy: number, tx: number, ty: number): void {
    const dx = tx - sx;
    const dy = ty - sy;
    this.aimAngle = dx * dx + dy * dy > AIM_EPSILON_SQ ? Math.atan2(dy, dx) : null;
  }

  isComplete(): boolean {
    return this.oneShot && this.clockMs >= Math.max(1, this.params.durationMs);
  }

  destroy(): void {
    if (this.sprite !== null) {
      this.sprite.destroy();
      this.sprite = null;
    }
    this.filters.destroy();
  }
}

export const customPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'custom',
  params: SPECS,
  spawn: (ctx, params) => new CustomInstance(ctx, params),
};

registerPrimitive(customPrimitive as FxPrimitive);
