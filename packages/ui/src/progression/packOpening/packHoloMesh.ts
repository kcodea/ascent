/**
 * PACK OPENING: the sealed pack's HOLO sheen in Pixi (packHolo.ts has the tiers and colours). One small custom shader,
 * shared by two meshes that ride the pack's own geometry: one on the sleeve body's grid (fed the body's positions each
 * time they are written) and one on the tear strip's front (stripMesh.ts shares its position array), so the holo peels,
 * tilts and stretches with the foil.
 *
 * The shader draws a STATIC gradient (a pearl on the rarity hue, or a full rainbow for Ancient / Secret), computed in
 * the fragment shader rather than sampled from a second texture (a cosine palette: no texture to paint, upload or
 * destroy), multiplied by the wrapper's greyscale shine mask (`packShineFor`, a canvas texture painted when the image
 * loads, black until then) and blended additively. Only uniforms change per frame: the strength (tier x the `holo` knob
 * x the pack aura's fade) and the gradient's sample offset (`holoShiftInto`: the cursor aim, the tilt, the tear, the
 * sleeve). No allocation per frame; the container alpha (the ripped flap's fade, resetSealed's fade) arrives through
 * the mesh pipe's `uColor`.
 *
 * Programs for both renderers: GLSL ES 3.0 (the scene asks for WebGL) and WGSL (same maths) so a WebGPU renderer draws
 * it too.
 */
import { Mesh, MeshGeometry, Shader, UniformGroup, type Texture } from 'pixi.js';
import type { HoloHue } from './packHolo';

const GL_VERT = `#version 300 es
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

const GL_FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uMask;
uniform vec4 uColor;        // the mesh pipe's tint x alpha (the container fades)
uniform float uStrength;    // tier x knob x the aura's fade
uniform float uRainbow;     // 0 = a pearl on uHue, 1 = a full rainbow
uniform vec2 uShift;        // the gradient's sample offset (cursor, tilt, tear, sleeve)
uniform vec3 uHue;          // the rarity hue (0..1 rgb)
const float TAU = 6.28318530718;
void main() {
  float m = texture(uMask, vUV).r;
  vec2 p = vec2(vUV.x, vUV.y * 1.5); // the wrapper is 2:3: keep the bands' angle true
  float ph = dot(p, vec2(0.75, 0.55)) * 1.3 + uShift.x;
  vec3 rb = 0.5 + 0.5 * cos(TAU * (ph + vec3(0.0, 0.33, 0.67)));
  vec3 pearl = mix(vec3(1.0), rb, 0.35) * mix(vec3(1.0), uHue, 0.55);
  vec3 col = mix(pearl, mix(vec3(1.0), rb, 0.8), uRainbow);
  float b = 0.5 + 0.5 * cos(TAU * (dot(p, vec2(0.55, -0.8)) * 0.9 + uShift.y + uShift.x * 0.5));
  float a = m * uStrength * (0.3 + 0.7 * b * b) * uColor.a;
  finalColor = vec4(col * a, a);
}`;

const WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}
struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
struct HoloUniforms {
  uStrength: f32,
  uRainbow: f32,
  uShift: vec2<f32>,
  uHue: vec3<f32>,
}
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var uMask: texture_2d<f32>;
@group(2) @binding(1) var uMaskSampler: sampler;
@group(2) @binding(2) var<uniform> holoUniforms: HoloUniforms;

struct VOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

const TAU: f32 = 6.28318530718;

@vertex
fn mainVert(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VOut {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  var o: VOut;
  o.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  o.uv = aUV;
  return o;
}

@fragment
fn mainFrag(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let h = holoUniforms;
  let m = textureSample(uMask, uMaskSampler, uv).r;
  let p = vec2<f32>(uv.x, uv.y * 1.5);
  let ph = dot(p, vec2<f32>(0.75, 0.55)) * 1.3 + h.uShift.x;
  let rb = vec3<f32>(0.5) + 0.5 * cos(TAU * (vec3<f32>(ph) + vec3<f32>(0.0, 0.33, 0.67)));
  let pearl = mix(vec3<f32>(1.0), rb, 0.35) * mix(vec3<f32>(1.0), h.uHue, 0.55);
  let col = mix(pearl, mix(vec3<f32>(1.0), rb, 0.8), h.uRainbow);
  let b = 0.5 + 0.5 * cos(TAU * (dot(p, vec2<f32>(0.55, -0.8)) * 0.9 + h.uShift.y + h.uShift.x * 0.5));
  let a = m * h.uStrength * (0.3 + 0.7 * b * b) * localUniforms.uColor.a;
  return vec4<f32>(col * a, a);
}
`;

/** A holo mesh (custom shader, no texture). */
export type HoloMesh = Mesh<MeshGeometry, Shader>;

/** The holo's live uniforms (written in place; never reallocated). */
export interface HoloUniformValues { uStrength: number; uRainbow: number; uShift: Float32Array; uHue: Float32Array }

/** The shared holo material for one pack: its shader and its uniforms. */
export interface HoloMaterial { shader: Shader; uniforms: HoloUniformValues }

/** Build the holo material over `mask` (a canvas texture, black until the shine mask loads) for `hue`. */
export function makeHoloMaterial(mask: Texture, hue: HoloHue): HoloMaterial {
  const group = new UniformGroup({
    uStrength: { value: 0, type: 'f32' },
    uRainbow: { value: hue.rainbow, type: 'f32' },
    uShift: { value: new Float32Array(2), type: 'vec2<f32>' },
    uHue: { value: Float32Array.from(hue.rgb), type: 'vec3<f32>' },
  });
  const shader = Shader.from({
    gl: { vertex: GL_VERT, fragment: GL_FRAG },
    gpu: {
      vertex: { entryPoint: 'mainVert', source: WGSL },
      fragment: { entryPoint: 'mainFrag', source: WGSL },
    },
    resources: { uMask: mask.source, uMaskSampler: mask.source.style, holoUniforms: group },
  });
  return { shader, uniforms: group.uniforms as unknown as HoloUniformValues };
}

/**
 * A holo mesh: `positions` are SHARED with the mesh it rides (the same array; the caller updates this mesh's position
 * buffer whenever it writes them), `uvs` are the shine mask's coordinates (0..1 over the whole wrapper).
 */
export function makeHoloMesh(material: HoloMaterial, positions: Float32Array, uvs: Float32Array, indices: Uint32Array): HoloMesh {
  const geometry = new MeshGeometry({ positions, uvs, indices });
  const mesh = new Mesh({ geometry, shader: material.shader });
  mesh.blendMode = 'add';
  mesh.visible = false; // until the mask has loaded (no flash of an unmasked rainbow)
  return mesh;
}
