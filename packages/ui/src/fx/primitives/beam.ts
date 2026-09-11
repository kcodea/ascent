import { Mesh, MeshGeometry, Shader, type Renderer } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { acquireShader, linkShader, prewarmShaders, releaseShader } from '../shaderPool';
import { makeBeamBuffers, writeBeamMesh, type BeamMeshBuffers, type BeamShape } from '../beamGeometry';

/**
 * The `beam` primitive: a clean, sustained beam of energy that reaches from a source to a target over
 * `travelMs`, holds for `dwellMs`, then fades over `releaseMs`. The ordered sibling to `lightning`. Geometry
 * is the straight strip from `beamGeometry.ts` (optionally bowed by an animated `waver`); the shader draws a
 * core→tip gradient core with a soft glow and a scrolling flow band, and the travel growth is a single
 * `uReach` uniform gating on `vUV.x` (the along-fraction — no separate "born" attribute needed). The full
 * filter lab wraps the container, so bloom/blur/etc. apply. Defaults are prismatic/neutral so every card tints
 * the beam from the workbench.
 */

const BEAM_VERT = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const BEAM_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform float uReach;      // travel clip: along-fraction (vUV.x) beyond this is not drawn yet
uniform float uAlpha;      // lifecycle brightness (life * flicker envelope)
uniform float uCoreFrac;   // bright-core fraction of the half-width
uniform float uGlow;       // glow-halo strength
uniform float uGain;       // overall intensity
uniform float uEndSoft;    // soft fade length at each end, in along-fraction
uniform float uFlowAmt;    // scrolling flow band strength (0 = off)
uniform float uFlowSpeed;  // flow scroll speed
uniform float uFlowFreq;   // flow bands along the beam
uniform float uFlowDir;    // +1 toward target, -1 toward source
uniform float uTime;       // seconds — drives the flow scroll
uniform vec3  uCore;       // core colour at the source end
uniform vec3  uTip;        // core colour at the target end
uniform vec3  uGlowCol;    // halo colour

const float TAU = 6.28318530718;

void main() {
  if (vUV.x > uReach) discard;                       // not reached yet during travel
  float across = abs(vUV.y * 2.0 - 1.0);             // 0 at the spine, 1 at the edge
  float core = 1.0 - smoothstep(uCoreFrac, min(1.0, uCoreFrac * 2.5 + 0.02), across);
  float halo = pow(1.0 - across, 2.0) * uGlow;

  // Soft end-caps: fade near u=0 and u=1 so the strip's ends aren't hard rectangles.
  float ends = smoothstep(0.0, uEndSoft, vUV.x) * (1.0 - smoothstep(1.0 - uEndSoft, 1.0, vUV.x));

  // Scrolling flow band along the beam — sells a channelled beam; direction is uFlowDir.
  float flow = 1.0;
  if (uFlowAmt > 0.0) {
    float f = 0.5 + 0.5 * sin((vUV.x * uFlowFreq - uTime * uFlowSpeed * uFlowDir) * TAU);
    flow = mix(1.0, f, uFlowAmt);
  }

  vec3 grad = mix(uCore, uTip, clamp(vUV.x, 0.0, 1.0));
  float lum = uGain * uAlpha * ends;
  float coreA = core * lum * flow;
  float haloA = halo * lum;
  float a = coreA + haloA;
  if (a <= 0.002) discard;
  // Premultiplied output (house convention). mesh.blendMode = 'add' gives the additive glow.
  vec3 rgb = grad * coreA + uGlowCol * haloA;
  finalColor = vec4(rgb, min(a, 1.0));
}`;

const SPECS = {
  travelMs: {
    kind: 'slider', label: 'Travel to target', group: 'Lifecycle', min: 0, max: 1500, step: 20, default: 200, axis: 'time',
    help: 'How long the beam takes to reach from source to target (ms). 0 = full-length at once (a hold).',
  },
  dwellMs: {
    kind: 'slider', label: 'Dwell on target', group: 'Lifecycle', min: 0, max: 2000, step: 20, default: 520, axis: 'time',
    help: 'How long the beam stays connected at full length (ms).',
  },
  releaseMs: {
    kind: 'slider', label: 'Release (fade)', group: 'Lifecycle', min: 0, max: 1000, step: 20, default: 200, axis: 'time',
    help: 'How long the beam fades out at the end (ms).',
  },

  width: {
    kind: 'slider', label: 'Glow width', group: 'Shape', min: 2, max: 80, step: 1, default: 18, axis: 'scale',
    help: 'Overall beam width including its glow envelope, in pixels.',
  },
  coreWidth: {
    kind: 'slider', label: 'Core width', group: 'Shape', min: 0.4, max: 12, step: 0.1, default: 3, axis: 'scale',
    help: 'Width of the bright inner core, in pixels — thin against a wide Glow width reads as a hot filament.',
  },
  segments: {
    kind: 'slider', label: 'Segments', group: 'Shape', min: 2, max: 48, step: 1, default: 24,
    help: 'Length subdivisions — more gives a smoother waver bow.',
  },
  waver: {
    kind: 'slider', label: 'Waver (bow)', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.12,
    help: 'Subtle animated sinusoidal bow, as a fraction of width. 0 = dead straight.',
  },
  waverFreq: {
    kind: 'slider', label: 'Waver cycles', group: 'Shape', min: 0, max: 8, step: 0.1, default: 2.5,
    enabledWhen: { param: 'waver', above: 0 },
    help: 'How many sine cycles the bow has along the beam.',
  },
  waverSpeed: {
    kind: 'slider', label: 'Waver speed', group: 'Shape', min: 0, max: 6, step: 0.1, default: 1.2,
    enabledWhen: { param: 'waver', above: 0 },
    help: 'How fast the bow travels along the beam.',
  },
  endSoftness: {
    kind: 'slider', label: 'End softness', group: 'Shape', min: 0, max: 0.5, step: 0.01, default: 0.12,
    help: 'Soft fade length at each end so the beam does not end in a hard rectangle.',
  },

  flowAmt: {
    kind: 'slider', label: 'Flow strength', group: 'Flow', min: 0, max: 1, step: 0.02, default: 0.35,
    help: 'Strength of the scrolling energy band along the beam. 0 = off (a steady beam).',
  },
  flowSpeed: {
    kind: 'slider', label: 'Flow speed', group: 'Flow', min: 0, max: 6, step: 0.1, default: 1.4,
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'How fast the flow band scrolls.',
  },
  flowFreq: {
    kind: 'slider', label: 'Flow bands', group: 'Flow', min: 1, max: 20, step: 1, default: 6,
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'How many flow bands run along the beam at once.',
  },
  flowDir: {
    kind: 'enum', label: 'Flow direction', group: 'Flow', options: ['target', 'source'] as const, default: 'target',
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'Which way the flow travels: toward the target (cast/heal) or back toward the source (drain).',
  },

  glowStrength: {
    kind: 'slider', label: 'Glow strength', group: 'Glow & colour', min: 0, max: 1, step: 0.02, default: 0.7,
    help: 'Brightness of the soft glow halo around the core.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Glow & colour', min: 0.2, max: 3, step: 0.05, default: 1, axis: 'intensity',
    help: 'Overall intensity of the whole beam.',
  },
  coreColor: { kind: 'color', label: 'Core color', group: 'Glow & colour', default: 0xf2f6ff, help: 'Colour of the bright core at the source end.' },
  tipColor: { kind: 'color', label: 'Tip color', group: 'Glow & colour', default: 0xdce8ff, help: 'Colour the core fades to at the target end.' },
  glowColor: { kind: 'color', label: 'Glow color', group: 'Glow & colour', default: 0x9fb8ff, help: 'Colour of the surrounding glow halo.' },

  flicker: {
    kind: 'slider', label: 'Flicker (breathing)', group: 'Glow & colour', min: 0, max: 20, step: 1, default: 0,
    help: 'Subtle brightness breathing, in Hz. 0 = a steady beam.',
  },

  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Glow & colour', options: FX_BLEND_MODES, default: 'add',
    help: 'How the beam composites. Add gives the luminous look.',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type BeamParams = ParamsOf<typeof SPECS>;

const BEAM_SHADER_KEY = 'fx-beam';
const TAU = Math.PI * 2;

const rgb3 = (hex: number): Float32Array =>
  new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);

/** Bright-core fraction of the half-width, clamped so the core never vanishes or eats the whole envelope. */
const coreFracOf = (p: BeamParams): number => Math.min(0.9, Math.max(0.01, p.coreWidth / Math.max(1, p.width)));
const flowDirOf = (p: BeamParams): number => (p.flowDir === 'source' ? -1 : 1);

function makeBeamShader(): Shader {
  return Shader.from({
    gl: { vertex: BEAM_VERT, fragment: BEAM_FRAG },
    resources: {
      beamUniforms: {
        uReach: { value: 1, type: 'f32' },
        uAlpha: { value: 0, type: 'f32' },
        uCoreFrac: { value: 0.16, type: 'f32' },
        uGlow: { value: 0.7, type: 'f32' },
        uGain: { value: 1, type: 'f32' },
        uEndSoft: { value: 0.12, type: 'f32' },
        uFlowAmt: { value: 0.35, type: 'f32' },
        uFlowSpeed: { value: 1.4, type: 'f32' },
        uFlowFreq: { value: 6, type: 'f32' },
        uFlowDir: { value: 1, type: 'f32' },
        uTime: { value: 0, type: 'f32' },
        uCore: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uTip: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uGlowCol: { value: new Float32Array([0.6, 0.7, 1]), type: 'vec3<f32>' },
      },
    },
  });
}

/** Build + GL-link the beam material at load, so the first beam of a session doesn't pay the compile. */
export function prewarmBeamShaders(renderer: Renderer | null, count = 2): void {
  prewarmShaders(BEAM_SHADER_KEY, count, renderer, makeBeamShader);
}

/** Link the beam program on `renderer` without pooling — for a slot canvas the module pool doesn't serve. */
export function linkBeamShaderOn(renderer: Renderer): Shader {
  const shader = makeBeamShader();
  linkShader(renderer, shader);
  return shader;
}

/** The pool's mandatory acquire reset: write EVERY uniform this shader owns, unconditionally (see ribbon). */
function writeAllUniforms(shader: Shader, p: BeamParams): void {
  const u = (shader.resources.beamUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  u.uReach = p.travelMs > 0 ? 0 : 1; // start un-grown if it travels, full-length if travelMs is 0
  u.uAlpha = 0;
  u.uCoreFrac = coreFracOf(p);
  u.uGlow = p.glowStrength;
  u.uGain = p.gain;
  u.uEndSoft = p.endSoftness;
  u.uFlowAmt = p.flowAmt;
  u.uFlowSpeed = p.flowSpeed;
  u.uFlowFreq = p.flowFreq;
  u.uFlowDir = flowDirOf(p);
  u.uTime = 0;
  u.uCore = rgb3(p.coreColor);
  u.uTip = rgb3(p.tipColor);
  u.uGlowCol = rgb3(p.glowColor);
}

const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

class BeamInstance implements FxInstance<BeamParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly buffers: BeamMeshBuffers;
  private params: BeamParams;
  private readonly oneShot: boolean;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;

  private clockMs = 0;
  private castStartMs = 0;
  private indexCount = 0;
  private done = false;

  // Anchors, in container space. `aim*` come from setAim (both ends staged); `head*` is the per-frame anchored
  // point (the source fallback if setAim never fires — then the beam has no target and draws nothing).
  private aimSet = false;
  private sx = 0; private sy = 0; private tx = 0; private ty = 0;
  private headX = 0; private headY = 0;
  // Last built anchors + a build flag, so a straight beam rebuilds only when its endpoints move.
  private builtOnce = false;
  private bSx = NaN; private bSy = NaN; private bTx = NaN; private bTy = NaN;

  constructor(ctx: FxContext, params: BeamParams) {
    this.params = params;
    this.oneShot = ctx.oneShot ?? false;
    this.buffers = makeBeamBuffers();
    this.geometry = new MeshGeometry({ positions: this.buffers.position, uvs: this.buffers.uv, indices: this.buffers.index });
    this.shader = acquireShader(BEAM_SHADER_KEY, makeBeamShader, (sh) => writeAllUniforms(sh, params));
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    this.mesh.visible = false;
    ctx.container.addChild(this.mesh);
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  private get uniforms(): Record<string, number | Float32Array> {
    return (this.shader.resources.beamUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  }

  setHead(x: number, y: number): void { this.headX = x; this.headY = y; }
  setAim(sx: number, sy: number, tx: number, ty: number): void {
    this.sx = sx; this.sy = sy; this.tx = tx; this.ty = ty; this.aimSet = true;
  }

  private endpoints(): { sx: number; sy: number; tx: number; ty: number } {
    const sx = this.aimSet ? this.sx : this.headX;
    const sy = this.aimSet ? this.sy : this.headY;
    const tx = this.aimSet ? this.tx : sx; // no aim → zero-length → draws nothing
    const ty = this.aimSet ? this.ty : sy;
    return { sx, sy, tx, ty };
  }

  /** Rebuild the strip from the current anchors + params at `phase`, and re-upload the buffers. */
  private regenerate(phase: number): void {
    const { sx, sy, tx, ty } = this.endpoints();
    const shape: BeamShape = { width: this.params.width, segments: this.params.segments, waver: this.params.waver, waverFreq: this.params.waverFreq };
    const { indexCount } = writeBeamMesh(this.buffers, sx, sy, tx, ty, shape, phase);
    this.indexCount = indexCount;
    this.geometry.getBuffer('aPosition').update();
    this.geometry.getBuffer('aUV').update();
    this.geometry.getIndex().update();
    this.bSx = sx; this.bSy = sy; this.bTx = tx; this.bTy = ty; this.builtOnce = true;
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

    // Rebuild the strip when the anchors moved or the beam wavers (a straight beam builds once per move).
    const phase = this.clockMs / 1000 * p.waverSpeed;
    const { sx, sy, tx, ty } = this.endpoints();
    const moved = sx !== this.bSx || sy !== this.bSy || tx !== this.bTx || ty !== this.bTy;
    if (live && (!this.builtOnce || moved || p.waver > 0)) this.regenerate(phase);

    // Optional subtle brightness breathing.
    const flick = p.flicker > 0 ? 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(this.clockMs / 1000 * p.flicker * TAU)) : 1;
    const bright = life * flick;

    const u = this.uniforms;
    u.uReach = reach;
    u.uAlpha = bright;
    u.uTime = this.clockMs / 1000;

    const prog = total > 0 ? Math.min(1, e / total) : 1;
    this.filters.frame(p, prog, dtMs / 1000);
    this.transform.frame(p, prog, dtMs / 1000, sx, sy);

    this.mesh.visible = bright > 0.003 && this.indexCount > 0;
  }

  isComplete(): boolean { return this.done; }

  setParams(next: BeamParams): void {
    this.params = next;
    const u = this.uniforms;
    u.uCoreFrac = coreFracOf(next);
    u.uGlow = next.glowStrength;
    u.uGain = next.gain;
    u.uEndSoft = next.endSoftness;
    u.uFlowAmt = next.flowAmt;
    u.uFlowSpeed = next.flowSpeed;
    u.uFlowFreq = next.flowFreq;
    u.uFlowDir = flowDirOf(next);
    u.uCore = rgb3(next.coreColor);
    u.uTip = rgb3(next.tipColor);
    u.uGlowCol = rgb3(next.glowColor);
    this.mesh.blendMode = next.blendMode;
    // Width/segments/waver may have changed the geometry — force a rebuild on the next update.
    this.builtOnce = false;
  }

  destroy(): void {
    this.filters.destroy();
    this.mesh.destroy();
    this.geometry.destroy(true);
    releaseShader(BEAM_SHADER_KEY, this.shader);
  }
}

export const beamPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'beam',
  params: SPECS,
  spawn: (ctx, params) => new BeamInstance(ctx, params),
};

registerPrimitive(beamPrimitive as FxPrimitive);
