import { Shader, Texture, TextureStyle, type Renderer } from 'pixi.js';
import { POSTERIZE_PAL_GLSL } from './shaderChunks';
import { tupleFloats } from './palettes';

/**
 * The custom `ParticleContainer` shader that gives `burst`/`emitter` the ribbon's posterized cel-band art
 * style, instead of soft additive-tinted dots. Ported from Pixi's own default particle shader — see
 * `node_modules/pixi.js/lib/scene/particle-container/shared/shader/{ParticleShader,particles.vert,
 * particles.frag}.mjs` — with the vertex logic kept IDENTICAL (same attributes, same uniforms, same math,
 * just re-expressed in GLSL ES 3.0 `in`/`out` syntax — see the note below on why) and the fragment replaced
 * with a shape → posterize-into-palette pipeline.
 *
 * ## The plumbing this depends on (verified by reading Pixi's particle pipe source, not assumed):
 *
 * `GlParticleContainerAdaptor.execute()` (gl/GlParticleContainerAdaptor.mjs) does, every single frame,
 * BEFORE this shader is bound:
 * ```
 * shader.resources.uTexture = container.texture._source;   // the container's shared shape texture
 * shader.resources.uniforms = particleContainerPipe.localUniforms;  // uTranslationMatrix/uColor/uRound/uResolution
 * ```
 * So a custom shader's `uTexture` and `uniforms` resource keys are OVERWRITTEN unconditionally every frame
 * — whatever we construct them with below is just a placeholder that satisfies `Shader.from`'s reflection
 * pass (see the next paragraph) and is never actually drawn with. Our own uniforms (`uPal`, `uBands`) MUST
 * live under a DIFFERENT resource key (`fxUniforms` here) or they'd be clobbered by that same assignment.
 *
 * Confirmed this is safe by reading `Shader.mjs`'s constructor + `GenerateShaderSyncCode.mjs`: for a
 * GL-only (no `gpuProgram`) `Shader.from({ resources })`, every top-level key in `resources` becomes its
 * own independent bind group; a `UniformGroup` resource is synced by iterating ITS OWN uniform names
 * against the compiled program's reflected uniform locations — the outer resource key name is never
 * consulted for a plain uniform group (only for texture resources, where the key must equal the sampler's
 * GLSL name, e.g. `uTexture`). So `fxUniforms: { uBands, uPal }` alongside `uniforms: {...}` works exactly
 * like `ribbon.ts`'s single `ribbonUniforms` group does — this is just two independent groups instead of
 * one. `uSampler` is set once and never touched again by the adaptor; for WebGL it isn't actually consulted
 * by the uniform-sync codegen either (no `TextureSource`/`UniformGroup` match for a bare `TextureStyle`
 * resource — texture filtering comes from the texture's own baked GL sampler state), so a placeholder is
 * fine there.
 *
 * ## Why the vertex shader is re-expressed in GLSL ES 3.0 rather than pasted byte-for-byte
 *
 * Pixi's default particle vertex shader is plain WebGL1-style GLSL (`attribute`/`varying`, no `#version`
 * pragma). Our fragment shader needs GLSL ES 3.0 (`posterizePal`'s dynamic `pal[i]` array indexing by a
 * non-constant index is restricted in ES 1.00 fragment shaders; `ribbon.ts`'s own fragment is `#version 300
 * es` for the same reason). A WebGL2 program must link a vertex+fragment pair of the SAME GLSL version, so
 * the vertex shader is ported to `in`/`out` here — identical attribute names, uniform names, and math,
 * confirmed line-for-line against `particles.vert.mjs`, just not a literal string copy.
 */

const PARTICLE_VERT = /* glsl */ `#version 300 es
in vec2 aVertex;
in vec2 aUV;
in vec4 aColor;
in vec2 aPosition;
in float aRotation;

uniform mat3 uTranslationMatrix;
uniform float uRound;
uniform vec2 uResolution;
uniform vec4 uColor;

out vec2 vUV;
out vec4 vColor;

vec2 roundPixels(vec2 position, vec2 targetSize) {
  return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

void main(void) {
  float cosRotation = cos(aRotation);
  float sinRotation = sin(aRotation);
  float x = aVertex.x * cosRotation - aVertex.y * sinRotation;
  float y = aVertex.x * sinRotation + aVertex.y * cosRotation;

  vec2 v = vec2(x, y) + aPosition;

  gl_Position = vec4((uTranslationMatrix * vec3(v, 1.0)).xy, 0.0, 1.0);

  if (uRound == 1.0) {
    gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
  }

  vUV = aUV;
  // Premultiplied per-particle colour (aColor.rgb is straight tint; aColor.a is the particle's own alpha —
  // see particleData.mjs's 'color' property, format unorm8x4) times the container's group tint/alpha
  // (uColor). Identical to Pixi's default vertex shader — we deliberately don't change this: the fragment
  // below un-premultiplies vColor.rgb/vColor.a to recover the tint's luminance as a bias signal, so the
  // premultiply step has to stay exactly where upstream Pixi puts it.
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor;
}
`;

/**
 * Fragment: sample the shared shape texture (a soft dot for the emitter's motes, a hard-edged shard for the
 * burst) and treat its alpha as the particle's local intensity falloff (`shape`). Combine that with a
 * per-particle "core bias" recovered from `vColor`'s (un-premultiplied) luminance — burst/emitter bake this
 * bias into each particle's tint as a greyscale value (see `biasTint()` below) instead of pre-resolving a
 * palette colour, so the SAME palette/band uniforms drive every particle in the container and a param edit
 * (palette swap, band count) repaints every live particle instantly without touching per-particle data.
 * `vColor.a` carries the particle's own life-alpha (its fade in/out), applied as a final multiply so a
 * fading particle dims through the same posterized bands rather than just going transparent uniformly.
 */
const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uBands;
uniform vec4 uPal[4];

${POSTERIZE_PAL_GLSL}

void main(void) {
  float lifeAlpha = vColor.a;
  if (lifeAlpha < 0.003) discard;

  float shape = texture(uTexture, vUV).a;
  // Hard cel edge: below this the particle contributes nothing, matching the ribbon's discard-on-shape
  // convention (RIBBON_FRAG's "if (d <= 0.0) discard;") instead of a soft alpha taper to zero.
  if (shape < 0.04) discard;

  // Recover the tint's own (straight, un-premultiplied) luminance as the 0..1 core-bias signal baked in by
  // biasTint() — dividing back out the premultiply from the vertex shader above.
  vec3 straightRgb = vColor.rgb / max(lifeAlpha, 0.0001);
  float bias = clamp(dot(straightRgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

  // Bias reshapes how deep into the palette this particle's shape falloff reaches: a low-bias particle caps
  // out in the rim bands even at full shape strength, a high-bias one can reach the white-hot core stop.
  float intensity = shape * mix(0.32, 1.05, bias);
  vec4 c = posterizePal(intensity, uBands, uPal);

  finalColor = vec4(c.rgb, 1.0) * (c.a * lifeAlpha);
}
`;

/** The resource key holding this shader's own `uBands`/`uPal` uniforms — deliberately NOT named `uniforms`,
 *  which is the key the particle pipe overwrites every frame (see the header comment above). */
const FX_UNIFORMS_KEY = 'fxUniforms';

interface FxUniformsResource {
  uniforms: { uBands: number; uPal: Float32Array };
}

/**
 * Build the posterized-cel particle shader. `renderer` is threaded through for API symmetry with this
 * module's sibling FX factories (e.g. `getShardTexture(ctx.renderer)` in burst.ts) and as the hook point
 * for a future WebGPU/WGSL variant; this shader is GL-only today (no `gpu` program supplied), matching
 * `ribbon.ts`'s own `Shader.from({ gl: {...} })` convention — the FX workbench doesn't target WebGPU.
 *
 * `initialPal` is a 4-stop rim→core tuple (see `palettes.ts`'s `paletteTuple`/`tupleFloats`); `initialBands`
 * is the posterization step count. Both are re-set on every live param edit via `updateParticleMaterial`,
 * so what's passed here only matters for the first frame before any edit.
 */
export function createParticleMaterial(_renderer: Renderer, initialPal: readonly number[], initialBands: number): Shader {
  // Placeholder texture/sampler: `uTexture` is unconditionally replaced with the ParticleContainer's real
  // shared texture before every draw (see header comment), and `uSampler` is never read by the WebGL sync
  // path at all — Texture.WHITE is simply a cheap always-available texture to satisfy Shader.from's
  // resource reflection at construction time.
  const placeholder = Texture.WHITE;
  return Shader.from({
    gl: { vertex: PARTICLE_VERT, fragment: PARTICLE_FRAG },
    resources: {
      uTexture: placeholder.source,
      uSampler: placeholder.source.style ?? new TextureStyle({}),
      // Placeholder shape; the particle pipe overwrites this whole resource object every frame with its own
      // uTranslationMatrix/uColor/uRound/uResolution group (see header comment) — never read past frame 1.
      uniforms: {
        uTranslationMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
        uColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
        uRound: { value: 0, type: 'f32' },
        uResolution: { value: new Float32Array(2), type: 'vec2<f32>' },
      },
      [FX_UNIFORMS_KEY]: {
        uBands: { value: initialBands, type: 'f32' },
        uPal: { value: tupleFloats(initialPal), type: 'vec4<f32>', size: 4 },
      },
    },
  });
}

/** Push a live param edit (palette swap, band-count change) onto an already-built particle material. Cheap
 *  and instant, same role as `ribbon.ts`'s `setParams` → `u.uPal = tupleFloats(next.palette)`. */
export function updateParticleMaterial(shader: Shader, pal: readonly number[], bands: number): void {
  const res = shader.resources[FX_UNIFORMS_KEY] as FxUniformsResource;
  res.uniforms.uBands = bands;
  res.uniforms.uPal = tupleFloats(pal);
}

/**
 * Encode a 0..1 "core bias" as a greyscale tint (`0` = black/rim, `1` = white/core). burst/emitter set this
 * as each particle's `tint` (with `alpha` still carrying life-fade as before); the fragment shader above
 * un-premultiplies `vColor` to recover this same luminance value as the palette-depth bias. Replaces the
 * old `tupleBiased(palette, bias)` call, which pre-resolved an actual palette colour per particle — now the
 * palette lookup happens once, in the shader, from the live `uPal` uniform, so every particle repaints
 * instantly on a palette/band edit instead of needing a respawn.
 */
export function biasTint(bias: number): number {
  const b = bias < 0 ? 0 : bias > 1 ? 1 : bias;
  const g = Math.round(b * 255);
  return (g << 16) | (g << 8) | g;
}
