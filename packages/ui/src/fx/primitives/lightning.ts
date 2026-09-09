import { Buffer, BufferUsage, Mesh, MeshGeometry, Shader, type Renderer } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { makeRng } from '../rng';
import { acquireShader, linkShader, prewarmShaders, releaseShader } from '../shaderPool';
import {
  buildStrike,
  makeLightningBuffers,
  writeLightningMesh,
  LIGHTNING_MAX_VERTS,
  LIGHTNING_MAX_INDICES,
  type Bolt,
  type LightningMeshBuffers,
  type LightningShape,
} from '../lightningGeometry';

/**
 * The `lightning` primitive: a branching electric bolt that TRAVELS to its target over `travelMs`, DWELLS
 * connected for `dwellMs`, then RELEASES (fades) over `releaseMs`, re-striking its jagged shape `flicker`
 * times a second the whole time. Geometry is the deterministic bolt from `lightningGeometry.ts` (midpoint
 * displacement + smoothing + branches) laid into one triangle-list mesh; the shader draws a white→violet
 * gradient core with a soft glow, and the travel growth is a single `uReach` uniform (no per-frame rebuild —
 * geometry changes only on a re-strike). The full filter lab wraps the container, so bloom/godray/etc. apply —
 * bloom in particular is where the real luminous magic comes from, the canvas workshop reference could only
 * fake it. Defaults are the look Mike locked in Lightning Lab.
 */

const LIGHTNING_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in float aBorn;
out vec2 vUV;
out float vBorn;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vBorn = aBorn;
}`;

const LIGHTNING_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vBorn;
out vec4 finalColor;

uniform float uReach;      // travel clip: a fragment born after the leading edge is not drawn yet
uniform float uAlpha;      // lifecycle brightness (life * flicker envelope)
uniform float uCoreFrac;   // bright-core fraction of the half-width
uniform float uGlow;       // glow-halo strength
uniform float uGain;       // overall intensity
uniform vec3  uCore;       // core colour  (head of the gradient)
uniform vec3  uTip;        // tip colour   (tail of the gradient)
uniform vec3  uGlowCol;    // halo colour

void main() {
  if (vBorn > uReach) discard;                       // not reached yet during travel
  float across = abs(vUV.y * 2.0 - 1.0);             // 0 at the spine, 1 at the edge
  float core = 1.0 - smoothstep(uCoreFrac, min(1.0, uCoreFrac * 2.5 + 0.02), across);
  float halo = pow(1.0 - across, 2.0) * uGlow;       // broad soft falloff across the width
  vec3 grad = mix(uCore, uTip, clamp(vUV.x, 0.0, 1.0));

  float lum = uGain * uAlpha;
  float coreA = core * lum;
  float haloA = halo * lum;
  float a = coreA + haloA;
  if (a <= 0.002) discard;
  // Premultiplied output (house convention, see ribbon). mesh.blendMode = 'add' gives the additive glow.
  vec3 rgb = grad * coreA + uGlowCol * haloA;
  finalColor = vec4(rgb, min(a, 1.0));
}`;

const SPECS = {
  mode: {
    kind: 'enum', label: 'Mode', group: 'Anchor', options: ['travel', 'radiate'] as const, default: 'travel',
    help: 'Travel: a bolt spans source→target. Radiate: a burst of bolts erupts from the source outward.',
  },
  bolts: {
    kind: 'slider', label: 'Bolts (radiate)', group: 'Anchor', min: 1, max: 16, step: 1, default: 6,
    enabledWhen: { param: 'mode', is: 'radiate' },
    help: 'How many arms erupt in Radiate mode.',
  },
  radius: {
    kind: 'slider', label: 'Reach (radiate)', group: 'Anchor', min: 40, max: 600, step: 10, default: 200, axis: 'scale',
    enabledWhen: { param: 'mode', is: 'radiate' },
    help: 'How far the Radiate arms reach from the source, in pixels.',
  },

  travelMs: {
    kind: 'slider', label: 'Travel to target', group: 'Lifecycle', min: 0, max: 1500, step: 20, default: 300, axis: 'time',
    help: 'How long the bolt takes to grow/reach from source to target (ms). 0 = fully struck at once.',
  },
  dwellMs: {
    kind: 'slider', label: 'Dwell on target', group: 'Lifecycle', min: 0, max: 2000, step: 20, default: 620, axis: 'time',
    help: 'How long the bolt stays connected and crackling on the target (ms).',
  },
  releaseMs: {
    kind: 'slider', label: 'Release (fade)', group: 'Lifecycle', min: 0, max: 1000, step: 20, default: 180, axis: 'time',
    help: 'How long the bolt fades out at the end (ms).',
  },

  chaos: {
    kind: 'slider', label: 'Chaos (jitter)', group: 'Bolt', min: 0, max: 1, step: 0.01, default: 0.2,
    help: 'How far the bolt jitters off a straight line — higher is wilder.',
  },
  smooth: {
    kind: 'slider', label: 'Smooth (arcane)', group: 'Bolt', min: 0, max: 1, step: 0.01, default: 0.47,
    help: 'Rounds the harsh fractal kinks into a flowing arc — up for mystical, down for raw electricity.',
  },
  detail: {
    kind: 'slider', label: 'Detail (subdiv)', group: 'Bolt', min: 2, max: 7, step: 1, default: 5,
    help: 'Subdivision passes: higher is finer, busier jaggedness.',
  },
  taper: {
    kind: 'slider', label: 'Taper to target', group: 'Bolt', min: 0, max: 1, step: 0.01, default: 0.22,
    help: 'How much the bolt thins toward the tip.',
  },

  branchChance: {
    kind: 'slider', label: 'Branch chance', group: 'Branching', min: 0, max: 0.6, step: 0.01, default: 0.1,
    help: 'Chance for the bolt to fork at each point along its length.',
  },
  branchSpread: {
    kind: 'slider', label: 'Branch spread°', group: 'Branching', min: 0, max: 70, step: 1, default: 12,
    enabledWhen: { param: 'branchChance', above: 0 },
    help: 'How wide the forks veer off the main path, in degrees.',
  },
  branchDepth: {
    kind: 'slider', label: 'Branch depth', group: 'Branching', min: 0, max: 5, step: 1, default: 2,
    enabledWhen: { param: 'branchChance', above: 0 },
    help: 'How many generations a fork may itself fork.',
  },

  width: {
    kind: 'slider', label: 'Glow width', group: 'Glow & colour', min: 4, max: 80, step: 1, default: 28, axis: 'scale',
    help: 'Overall bolt width including its glow envelope, in pixels.',
  },
  coreWidth: {
    kind: 'slider', label: 'Core width', group: 'Glow & colour', min: 0.4, max: 12, step: 0.1, default: 1.8, axis: 'scale',
    help: 'Width of the bright inner core, in pixels — thin against a wide Glow width reads as a hot filament.',
  },
  glowStrength: {
    kind: 'slider', label: 'Glow strength', group: 'Glow & colour', min: 0, max: 1, step: 0.02, default: 0.8,
    help: 'Brightness of the soft glow halo around the core.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Glow & colour', min: 0.2, max: 3, step: 0.05, default: 1, axis: 'intensity',
    help: 'Overall intensity of the whole bolt.',
  },
  coreColor: { kind: 'color', label: 'Core color', group: 'Glow & colour', default: 0xeaf3ff, help: 'Colour of the bright core at the source end.' },
  tipColor: { kind: 'color', label: 'Tip color', group: 'Glow & colour', default: 0xc58cff, help: 'Colour the core fades to at the tip — a violet tip reads as arcane.' },
  glowColor: { kind: 'color', label: 'Glow color', group: 'Glow & colour', default: 0x5a63ff, help: 'Colour of the surrounding glow halo.' },

  flicker: {
    kind: 'slider', label: 'Flicker (strikes/s)', group: 'Flicker', min: 0, max: 30, step: 1, default: 9,
    help: 'How many times a second the bolt re-strikes into a fresh jagged shape. 0 holds one shape.',
  },
  decay: {
    kind: 'slider', label: 'Decay (glow tail)', group: 'Flicker', min: 0, max: 1, step: 0.02, default: 0.72,
    help: 'How much the bolt lingers between strikes rather than snapping dark.',
  },

  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Glow & colour', options: FX_BLEND_MODES, default: 'add',
    help: 'How the bolt composites. Add gives the luminous electric look.',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type LightningParams = ParamsOf<typeof SPECS>;

const LIGHTNING_SHADER_KEY = 'fx-lightning';

const rgb3 = (hex: number): Float32Array =>
  new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);

/** Bright-core fraction of the half-width, clamped so the core never vanishes or eats the whole envelope. */
const coreFracOf = (p: LightningParams): number => Math.min(0.9, Math.max(0.01, p.coreWidth / Math.max(1, p.width)));

/** Build one lightning material. Every uniform is a placeholder; `writeAllUniforms` overwrites all on acquire. */
function makeLightningShader(): Shader {
  return Shader.from({
    gl: { vertex: LIGHTNING_VERT, fragment: LIGHTNING_FRAG },
    resources: {
      lightningUniforms: {
        uReach: { value: 1, type: 'f32' },
        uAlpha: { value: 1, type: 'f32' },
        uCoreFrac: { value: 0.1, type: 'f32' },
        uGlow: { value: 0.8, type: 'f32' },
        uGain: { value: 1, type: 'f32' },
        uCore: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uTip: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uGlowCol: { value: new Float32Array([0.5, 0.5, 1]), type: 'vec3<f32>' },
      },
    },
  });
}

/** Build + GL-link the lightning material at load, so the first bolt of a session doesn't pay the compile. */
export function prewarmLightningShaders(renderer: Renderer | null, count = 2): void {
  prewarmShaders(LIGHTNING_SHADER_KEY, count, renderer, makeLightningShader);
}

/** Link the lightning program on `renderer` without pooling — for a slot canvas the module pool doesn't serve. */
export function linkLightningShaderOn(renderer: Renderer): Shader {
  const shader = makeLightningShader();
  linkShader(renderer, shader);
  return shader;
}

/** The pool's mandatory acquire reset: write EVERY uniform this shader owns, unconditionally (see ribbon). */
function writeAllUniforms(shader: Shader, p: LightningParams): void {
  const u = (shader.resources.lightningUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  u.uReach = p.travelMs > 0 ? 0 : 1; // start un-grown if it travels, fully struck if travelMs is 0
  u.uAlpha = 0;
  u.uCoreFrac = coreFracOf(p);
  u.uGlow = p.glowStrength;
  u.uGain = p.gain;
  u.uCore = rgb3(p.coreColor);
  u.uTip = rgb3(p.tipColor);
  u.uGlowCol = rgb3(p.glowColor);
}

const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

class LightningInstance implements FxInstance<LightningParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly buffers: LightningMeshBuffers;
  private params: LightningParams;
  private readonly oneShot: boolean;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;

  private clockMs = 0;
  private castStartMs = 0;
  private strikeSeed: number;
  private lastStrikeMs = -1e9;
  private indexCount = 0;
  private done = false;

  // Anchors, in container space. `aim*` come from setAim (both source + target staged); `head*` is the
  // per-frame anchored point (the radiate origin, and the source fallback if setAim never fires).
  private aimSet = false;
  private sx = 0; private sy = 0; private tx = 0; private ty = 0;
  private headX = 0; private headY = 0;

  constructor(ctx: FxContext, params: LightningParams) {
    this.params = params;
    this.oneShot = ctx.oneShot ?? false;
    this.strikeSeed = (ctx.seed === undefined ? Math.floor(Math.random() * 0xffffffff) : Math.floor(makeRng(ctx.seed)() * 0xffffffff)) >>> 0;

    this.buffers = makeLightningBuffers();
    this.geometry = new MeshGeometry({ positions: this.buffers.position, uvs: this.buffers.uv, indices: this.buffers.index });
    // The third, lightning-specific attribute: per-vertex "born" fraction for the travel-reach clip. MeshGeometry
    // only wires aPosition/aUV, so add our own buffer over the same array the writer fills.
    this.geometry.addAttribute('aBorn', {
      buffer: new Buffer({ data: this.buffers.born, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
      format: 'float32', stride: 4, offset: 0,
    });

    this.shader = acquireShader(LIGHTNING_SHADER_KEY, makeLightningShader, (sh) => writeAllUniforms(sh, params));
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    this.mesh.visible = false;
    ctx.container.addChild(this.mesh);
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  private get uniforms(): Record<string, number | Float32Array> {
    return (this.shader.resources.lightningUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  }

  setHead(x: number, y: number): void {
    this.headX = x; this.headY = y;
  }

  setAim(sx: number, sy: number, tx: number, ty: number): void {
    this.sx = sx; this.sy = sy; this.tx = tx; this.ty = ty; this.aimSet = true;
  }

  private currentBolts(seed: number): Bolt[] {
    const p = this.params;
    const shape: LightningShape = {
      chaos: p.chaos, smooth: p.smooth, detail: p.detail, taper: p.taper,
      branchChance: p.branchChance, branchSpread: p.branchSpread, branchDepth: p.branchDepth,
      width: p.width, mode: p.mode, bolts: p.bolts,
    };
    const ox = this.aimSet ? this.sx : this.headX;
    const oy = this.aimSet ? this.sy : this.headY;
    if (p.mode === 'radiate') return buildStrike(shape, ox, oy, ox + p.radius, oy, seed);
    const tx = this.aimSet ? this.tx : ox;
    const ty = this.aimSet ? this.ty : oy;
    return buildStrike(shape, ox, oy, tx, ty, seed);
  }

  /** Rebuild the mesh from the current anchors + params at `seed`, and re-upload every buffer. */
  private regenerate(seed: number): void {
    const bolts = this.currentBolts(seed);
    const { indexCount } = writeLightningMesh(this.buffers, bolts, this.params.taper);
    this.indexCount = indexCount;
    this.geometry.getBuffer('aPosition').update();
    this.geometry.getBuffer('aUV').update();
    this.geometry.getBuffer('aBorn').update();
    this.geometry.getIndex().update();
  }

  update(dtMs: number): void {
    this.clockMs += dtMs;
    const p = this.params;
    const T = p.travelMs, D = p.dwellMs, R = p.releaseMs, gap = this.oneShot ? 0 : 300;
    const total = T + D + R + gap;

    let e = this.clockMs - this.castStartMs;
    if (!this.oneShot && total > 0 && e >= total) { this.castStartMs = this.clockMs; e = 0; }

    let reach: number, life: number, live: boolean;
    if (e < T) { reach = easeOut(e / Math.max(1, T)); life = 1; live = true; }
    else if (e < T + D) { reach = 1; life = 1; live = true; }
    else if (e < T + D + R) { reach = 1; life = 1 - (e - (T + D)) / Math.max(1, R); live = true; }
    else { reach = 1; life = 0; live = false; if (this.oneShot) this.done = true; }

    // Flicker: re-strike the jagged shape at `flicker` Hz while the bolt is live (advancing the seed).
    const interval = p.flicker > 0 ? 1000 / p.flicker : Infinity;
    if (live && (this.lastStrikeMs < 0 || this.clockMs - this.lastStrikeMs >= interval)) {
      this.strikeSeed = (Math.imul(this.strikeSeed, 1664525) + 1013904223) >>> 0;
      this.regenerate(this.strikeSeed);
      this.lastStrikeMs = this.clockMs;
    }

    // Brightness envelope: full at each strike, easing toward a floor, times the lifecycle `life`.
    const age = this.clockMs - this.lastStrikeMs;
    const tail = 40 + p.decay * Math.min(interval, 900);
    const floor = p.flicker > 0 ? 0.2 + p.decay * 0.25 : 1;
    const flick = p.flicker > 0 ? floor + (1 - floor) * Math.exp(-age / tail) : 1;
    const bright = life * flick;

    const u = this.uniforms;
    u.uReach = reach;
    u.uAlpha = bright;

    const prog = total > 0 ? Math.min(1, e / total) : 1;
    this.filters.frame(p, prog, dtMs / 1000);
    this.transform.frame(p, prog, dtMs / 1000, this.aimSet ? this.sx : this.headX, this.aimSet ? this.sy : this.headY);

    this.mesh.visible = bright > 0.003 && this.indexCount > 0;
  }

  isComplete(): boolean {
    return this.done;
  }

  setParams(next: LightningParams): void {
    this.params = next;
    const u = this.uniforms;
    u.uCoreFrac = coreFracOf(next);
    u.uGlow = next.glowStrength;
    u.uGain = next.gain;
    u.uCore = rgb3(next.coreColor);
    u.uTip = rgb3(next.tipColor);
    u.uGlowCol = rgb3(next.glowColor);
    this.mesh.blendMode = next.blendMode;
    // Rebuild the geometry with the edited shape at the SAME seed (no re-roll), so a slider drag updates the
    // bolt immediately even while flicker is 0 and nothing else would re-strike.
    if (this.lastStrikeMs >= 0) this.regenerate(this.strikeSeed);
  }

  destroy(): void {
    this.filters.destroy();
    this.mesh.destroy();
    this.geometry.destroy(true);
    releaseShader(LIGHTNING_SHADER_KEY, this.shader);
  }
}

export const lightningPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'lightning',
  params: SPECS,
  spawn: (ctx, params) => new LightningInstance(ctx, params),
};

registerPrimitive(lightningPrimitive as FxPrimitive);

// A couple of caps re-exported so a smoke test can size a stub without importing the geometry module twice.
export { LIGHTNING_MAX_VERTS, LIGHTNING_MAX_INDICES };
