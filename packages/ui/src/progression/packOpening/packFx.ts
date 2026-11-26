/**
 * PACK OPENING: THE PRESENTATION SHADERS (owner 2026-11-24: "its everything, the animations, the card back visuals, the
 * tear effects, the unsheathe effects, the entire presentation, EVERYTHING needs to be brought up").
 *
 * Small procedural shaders (GLSL ES 3.0, WebGL only, no textures of their own; `null` on any other renderer and
 * the scene simply goes without them):
 *
 *  - THE STAGE: the theatre itself, drawn behind everything. A dark void lit by one spotlight that falls on the pack,
 *    dust drifting through the beam, slow motes, a pool of the pack's own colour behind it, a vignette, and a wash of
 *    a big pull's colour from where its face lands. It replaces the dimmed menu showing through a scrim.
 *  - THE SPILL: light from inside the pack. Shafts and rising dust in the pack's colour pour out of the opening as the
 *    strip comes off, and from the sleeve's mouth as the cards slide out.
 *  - THE BACK SHEEN: the pile's top card back is alive: a band of light that follows the pointer across it, glints
 *    that twinkle on its lattice, and a soft flare on its star. Never tinted by the card's rarity (a back tells nothing).
 *
 * Per frame only uniforms change. No allocation per frame.
 */
import { Mesh, MeshGeometry, Shader, UniformGroup, type Texture } from 'pixi.js';

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

const HEAD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec4 uColor;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p){ return vec2(h21(p), h21(p + 37.7)); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fb(vec2 p){ float a = .5, r = 0.; for (int i = 0; i < 4; i++) { r += a * n2(p); p = p * 2.03 + 7.1; a *= .5; } return r; }
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
`;

/** THE STAGE. vUV -1..1 over the whole canvas (y down); `uAspect` = width / height. */
export const STAGE_FRAG = `${HEAD}
uniform float uTime;
uniform float uAspect;
uniform float uEnergy;     // 0..1: the pack's own light behind it
uniform float uWash;       // 0..1: a big pull's wash, decaying
uniform vec2 uFocus;       // where the pack (or the pile) is, -1..1
uniform vec2 uWashAt;      // where the big pull's face landed, -1..1
uniform vec3 uTint;        // the pack's colour
uniform vec3 uWashTint;
void main() {
  vec2 p = vec2(vUV.x * uAspect, vUV.y);
  vec2 f = vec2(uFocus.x * uAspect, uFocus.y);
  vec2 q = p - f;
  float r = length(q);
  // the void: deep navy, darker toward the edges
  vec3 col = mix(vec3(.036, .052, .112), vec3(.008, .011, .03), smoothstep(.15, 1.5, length(p * vec2(.8, 1.))));
  // a slow haze, so the void is never a flat colour
  col += mix(vec3(.1, .13, .27), uTint * .3, .3) * fb(p * 1.35 + vec2(uTime * .012, uTime * .006)) * .13 * (1. - smoothstep(.3, 1.7, r));
  // the pack's own light pooled behind it
  col += uTint * exp(-r * r * 2.4) * (.07 + .2 * uEnergy);
  // the spotlight: a cone from above that widens as it falls, with slow shafts and dust drifting through it
  float cx = q.x / (.3 + .46 * (p.y + 1.));
  float cone = exp(-cx * cx * 2.3) * smoothstep(1.25, -.95, p.y);
  float shafts = .62 + .38 * n2(vec2(cx * 5. + 3., uTime * .06));
  float dust = fb(p * vec2(3., 2.2) + vec2(uTime * .028, -uTime * .042));
  col += mix(vec3(.5, .58, .84), uTint, .3) * cone * shafts * (.085 + .15 * dust);
  // a pool of light on the floor under it
  float fl = (p.y - f.y - .6) * 5.;
  col += mix(vec3(.4, .5, .8), uTint, .5) * exp(-fl * fl) * exp(-q.x * q.x * 3.2) * .07;
  // motes: sparse specks that drift up and twinkle, three depths (brighter inside the beam)
  for (int k = 0; k < 3; k++) {
    float fk = float(k), g = 7. + fk * 6.;
    vec2 uq = p * g + vec2(sin(uTime * .08 + fk) * .4 + fk * 13.1, uTime * (.1 + .045 * fk));
    vec2 id = floor(uq), ff = fract(uq) - .5;
    vec2 o = (h22(id + fk * 9.) - .5) * .7;
    float life = h21(id + 4. + fk);
    float tw = .5 + .5 * sin(uTime * (.9 + life * 2.) + life * 30.);
    float d = length(ff - o);
    col += mix(vec3(.78, .86, 1.), uTint, .4) * smoothstep(.07 / (1. + fk * .5), 0., d) * tw * step(.74, life) * (.3 + .5 * cone) * (1. - fk * .22);
  }
  // a big pull washes the stage in its colour from where the face landed
  vec2 wq = p - vec2(uWashAt.x * uAspect, uWashAt.y);
  col += uWashTint * uWash * exp(-dot(wq, wq) * .85) * .42;
  // vignette
  col *= 1. - .6 * smoothstep(.7, 1.75, length(p * vec2(.74, 1.)));
  finalColor = vec4(col, 1.) * uColor.a;
}`;

/** How far the pack's half width sits inside the spill quad (the quad is wider than the pack), and where its gap line is. */
export const SPILL_PACK_HALF = 0.62;
export const SPILL_LINE_V = 0.85;
/** The light's width over the wrapper's: inside its edges at the opening. */
export const SPILL_INSET = 0.93;
/**
 * The least the light reaches above the opening, in pack base units. The scene stretches it to the TOP OF THE SCREEN
 * when that is further, so it fades out slowly over the whole way up and is gone exactly at the edge (owner 2026-11-24:
 * "extend further and have a really long fade out").
 */
export const SPILL_MIN_REACH = 240;

/** THE SPILL. vUV -1..1 on a quad above the pack's opening: the gap line is at v = SPILL_LINE_V, the pack spans x in +-SPILL_PACK_HALF. */
export const SPILL_FRAG = `${HEAD}
uniform float uTime;
uniform float uOpen;       // 0..1: how much of the top is open, from the left
uniform float uLevel;      // 0..1
uniform float uReach;      // how far the light reaches above the opening (pack units)
uniform float uLineY;      // where the opening is (pack units, y down): the dust is anchored to the STAGE, not the wrapper
uniform float uLine;       // how sharply the hot line at the opening falls off (the quad stretches; the line must not)
uniform vec3 uTint;        // the pack's colour
uniform vec3 uHot;
void main() {
  // (the light is a little NARROWER than the wrapper, so its ends never jut past the wrapper's edges: owner 2026-11-24)
  float x = vUV.x / ${(SPILL_PACK_HALF * SPILL_INSET).toFixed(3)};
  float h = (${SPILL_LINE_V.toFixed(2)} - vUV.y) / ${(1 + SPILL_LINE_V).toFixed(2)};   // 0 at the gap, 1 at the quad's top
  float open = uOpen * 2. - 1.;
  float sx = x / (1. + max(h, 0.) * .5);   // the shafts fan out as they rise
  float gap = smoothstep(open, open - .1, sx) * smoothstep(-1., -.88, sx);
  float shaft = n2(vec2(sx * 8., uTime * .45)) * .55 + n2(vec2(sx * 21. + 4., -uTime * .75)) * .45;
  shaft = pow(smoothstep(.28, .9, shaft), 1.5);
  // a long, slow fade: bright at the opening, still faintly there far above it, gone by the quad's top
  float fall = clamp(1. - h, 0., 1.);
  float up = step(0., h) * exp(-h * 2.4) * fall * sqrt(fall);
  vec3 col = uTint * (.35 + 1.5 * shaft) * up * gap;
  // the hot line at the opening itself
  col += uHot * exp(-abs(h) * uLine) * smoothstep(open, open - .07, x) * smoothstep(-1., -.93, x) * .8;
  // dust rising in the light
  // the dust hangs in the air: its height is measured on the stage, so pulling the wrapper down does not drag it
  // along (owner 2026-11-24: "have the sparkles ignore the drag down")
  vec2 uq = vec2(sx * 7., (h * uReach - uLineY) / 24. + uTime * .5);
  vec2 id = floor(uq), ff = fract(uq) - .5;
  float life = h21(id + 2.3);
  float tw = .5 + .5 * sin(uTime * 4. + life * 30.);
  col += uHot * smoothstep(.09, 0., length(ff - (h22(id) - .5) * .6)) * tw * step(.6, life) * up * gap * 1.2;
  float m = max(abs(vUV.x), abs(vUV.y));
  col *= uLevel * smoothstep(1., .82, m) * uColor.a;
  finalColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0., 1.));
}`;

/** THE BACK SHEEN. vUV -1..1 on the card's own quad. */
/** The card back sheen's strength (owner 2026-11-25: "reduce the sheen opacity"; 1 was the first pass). */
export const SHEEN_GAIN = 0.5;

export const SHEEN_FRAG = `${HEAD}
uniform float uTime;
uniform float uLevel;      // 0..1
uniform vec2 uAim;         // where the pointer is on the card, -1..1 (0 when it is not on it)
void main() {
  vec2 c = vUV * vec2(.3333, .5);   // card heights
  // cut to the plate itself (its outer edge sits inside the art box, a hair low), so no light shows past its corners
  float mask = smoothstep(0., -.012, sdRound(c - vec2(0., .0055), vec2(.3333 * .925, .5 * .912), .055));
  if (mask <= 0. || uLevel < .01) { finalColor = vec4(0.); return; }
  // a band of light across the card: it follows the pointer, and drifts on its own when nobody is there
  float s = dot(c, normalize(vec2(.8, .6)));
  float off = uAim.x * .26 + uAim.y * .14 + sin(uTime * .33) * .07;
  float b1 = (s - off) * 8., b2 = (s - off - .11) * 26.;
  float band = exp(-b1 * b1) + .45 * exp(-b2 * b2);
  // glints on the back's lattice: they twinkle everywhere, and light up where the band passes
  vec2 g = mat2(.7071, -.7071, .7071, .7071) * c * 30.;
  vec2 id = floor(g), f = fract(g) - .5;
  float tw = pow(.5 + .5 * sin(uTime * 1.7 + h21(id) * 40.), 6.);
  float glint = smoothstep(.2, 0., length(f)) * tw * step(.68, h21(id + 2.));
  // a soft flare on the star
  float star = exp(-length(c * vec2(1., .8)) * 5.5) * (.55 + .45 * sin(uTime * .85));
  vec3 col = vec3(.72, .84, 1.) * band * .2 + vec3(.9, .95, 1.) * glint * (.12 + 1.3 * band) + vec3(1., .86, .52) * star * .1;
  col *= uLevel * mask * uColor.a * ${SHEEN_GAIN.toFixed(2)};
  finalColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0., 1.));
}`;

/**
 * THE WRAPPER'S HIGHLIGHTS, CUT TO THE ART (owner 2026-11-25: "i can still see the sheen over the edge of the wrapper";
 * "identical to the size and reaction of the wrapper, including when pinched"). The idle sheen and the gloss band ride
 * the wrapper body's own grid, but a plain textured mesh lights the whole body RECTANGLE, the art's see-through margin
 * and crimps included. These two draw the same textures multiplied by the wrapper art's alpha (`uTex`), so the light
 * ends exactly where the printed foil does, however the body is tilted, squeezed or pinched. vUV = the body's own uvs.
 */
export const MASKED_FRAG = `${HEAD}
uniform sampler2D uTex;    // the wrapper art (its alpha is the foil's shape)
uniform sampler2D uTex2;   // the highlight
void main() {
  finalColor = texture(uTex2, vUV) * texture(uTex, vUV).a * uColor.a;
}`;

/** How far a full lean moves the band (pack units; the pack is 300 wide), and how much a facing slope brightens. */
const RELIEF_BEND = 52;
const RELIEF_LIGHT = 1.25;

/** The gloss band, placed from uniforms (no per-frame uv rewrite): `uBand` = centre, half width, slope, cy (pack units). */
export const GLOSS_FRAG = `${HEAD}
uniform sampler2D uTex;    // the wrapper art
uniform sampler2D uTex2;   // the band (sampled along u at v = 0.5)
uniform sampler2D uTex3;   // the wrapper's RELIEF (packRelief.ts): rg = which way the surface leans (.5 = flat), over the WHOLE pack
uniform vec4 uBand;
uniform vec3 uGeom;        // the pack's W, H (the strip's height) and BODY_H
uniform float uRelief;     // how strongly the band answers the relief (0 = a flat pack)
void main() {
  float x = vUV.x * uGeom.x, y = uGeom.y + vUV.y * uGeom.z;
  // THE BAND TRAVELS OVER AN EMBOSSED SURFACE: where the surface leans, the light is found a little further along (the
  // band bends round raised parts), and a slope facing the light (above and a little left) is brighter, one facing away dimmer
  vec2 n = (texture(uTex3, vec2(vUV.x, y / (uGeom.y + uGeom.z))).rg - .5) * 2. * uRelief;
  float xs = x + n.x * ${RELIEF_BEND.toFixed(1)}, ys = y + n.y * ${RELIEF_BEND.toFixed(1)};
  float d = (xs + uBand.z * (ys - uBand.w) - uBand.x) / uBand.y;
  float lit = clamp(1. + dot(n, vec2(-.45, -.9)) * ${RELIEF_LIGHT.toFixed(2)}, .2, 2.4);
  finalColor = texture(uTex2, vec2(.5 + .5 * d, .5)) * step(abs(d), 1.) * lit * texture(uTex, vUV).a * uColor.a;
}`;

type UType = 'f32' | 'vec2<f32>' | 'vec3<f32>' | 'vec4<f32>';
type USpec = Record<string, UType>;
type UValues<S extends USpec> = { -readonly [K in keyof S]: S[K] extends 'f32' ? number : Float32Array };

/** One shader mesh and its live uniforms (written in place). */
export interface Fx<S extends USpec> { mesh: Mesh<MeshGeometry, Shader>; u: UValues<S> }

const unitQuad = (): MeshGeometry => new MeshGeometry({
  positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
  uvs: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

function make<S extends USpec>(
  webgl: boolean, frag: string, spec: S, blend: 'add' | 'normal', geometry?: MeshGeometry, tex?: Texture, tex2?: Texture, tex3?: Texture,
): Fx<S> | null {
  if (!webgl) return null;
  try {
    const def: Record<string, { value: number | Float32Array; type: UType }> = {};
    for (const k of Object.keys(spec)) {
      const t = spec[k]!;
      def[k] = { value: t === 'f32' ? 0 : new Float32Array(t === 'vec2<f32>' ? 2 : t === 'vec3<f32>' ? 3 : 4), type: t };
    }
    const group = new UniformGroup(def);
    const resources: Record<string, unknown> = { fxUniforms: group };
    if (tex) { resources.uTex = tex.source; resources.uTexSampler = tex.source.style; }
    if (tex2) { resources.uTex2 = tex2.source; resources.uTex2Sampler = tex2.source.style; }
    if (tex3) { resources.uTex3 = tex3.source; resources.uTex3Sampler = tex3.source.style; }
    const shader = Shader.from({ gl: { vertex: GL_VERT, fragment: frag }, resources });
    const mesh = new Mesh({ geometry: geometry ?? unitQuad(), shader });
    mesh.blendMode = blend;
    mesh.visible = false;
    return { mesh, u: group.uniforms as unknown as UValues<S> };
  } catch {
    return null;
  }
}

const STAGE_U = {
  uTime: 'f32', uAspect: 'f32', uEnergy: 'f32', uWash: 'f32', uFocus: 'vec2<f32>', uWashAt: 'vec2<f32>', uTint: 'vec3<f32>',
  uWashTint: 'vec3<f32>',
} as const satisfies USpec;
const SPILL_U = { uTime: 'f32', uOpen: 'f32', uLevel: 'f32', uLine: 'f32', uReach: 'f32', uLineY: 'f32', uTint: 'vec3<f32>', uHot: 'vec3<f32>' } as const satisfies USpec;
const SHEEN_U = { uTime: 'f32', uLevel: 'f32', uAim: 'vec2<f32>' } as const satisfies USpec;

export type StageFx = Fx<typeof STAGE_U>;
export type SpillFx = Fx<typeof SPILL_U>;
export type SheenFx = Fx<typeof SHEEN_U>;

export const makeStage = (webgl: boolean): StageFx | null => make(webgl, STAGE_FRAG, STAGE_U, 'normal');
const NO_U = {} as const satisfies USpec;
const GLOSS_U = { uBand: 'vec4<f32>', uGeom: 'vec3<f32>', uRelief: 'f32' } as const satisfies USpec;
export type MaskedFx = Fx<typeof NO_U>;
export type GlossFx = Fx<typeof GLOSS_U>;
/** A copy of the wrapper body's grid (the scene copies the body's positions into it whenever it writes them). */
const bodyGrid = (body: Mesh): MeshGeometry => {
  const bg = body.geometry as MeshGeometry;
  return new MeshGeometry({ positions: Float32Array.from(bg.positions), uvs: Float32Array.from(bg.uvs), indices: Uint32Array.from(bg.indices) });
};
/** The idle sheen, cut to the wrapper art. */
export const makeMaskedSheen = (webgl: boolean, body: Mesh, art: Texture, sheen: Texture): MaskedFx | null =>
  make(webgl, MASKED_FRAG, NO_U, 'add', bodyGrid(body), art, sheen);
/** The gloss band, cut to the wrapper art; `relief` is the wrapper's relief map (packRelief.ts `flatRelief()` for none; `bindRelief` swaps it). */
export const makeMaskedGloss = (webgl: boolean, body: Mesh, art: Texture, band: Texture, relief: Texture): GlossFx | null =>
  make(webgl, GLOSS_FRAG, GLOSS_U, 'add', bodyGrid(body), art, band, relief);
export const makeSpill = (webgl: boolean): SpillFx | null => make(webgl, SPILL_FRAG, SPILL_U, 'add');
export const makeSheen = (webgl: boolean): SheenFx | null => make(webgl, SHEEN_FRAG, SHEEN_U, 'add');

/**
 * THE WRAPPER'S HANDLING, as plain maths (the scene eases it, the sounds hear it: the crinkle is heard, not drawn. A
 * drawn wrinkle overlay was tried and removed, owner 2026-11-24: "remove the wrinkle effect on the wrapper").
 * `grip` is how hard the foil is held at the hand; `wear` is how crumpled the whole wrapper has become, which only
 * grows while it is handled (a wrapper never un-crumples) up to `WEAR_MAX`.
 */
export interface Handling { grip: number; wear: number; px: number; py: number }
export const newHandling = (): Handling => ({ grip: 0, wear: 0, px: 0.5, py: 0.5 });
export const WEAR_MAX = 0.42;
/** Wear gained per unit the hand travels over the foil (body uv) at full grip. */
export const WEAR_PER_TRAVEL = 0.07;

/**
 * One frame (dt in 60 Hz frames): ease the grip and the hand toward their targets and add wear for the distance the
 * held foil was worked. Returns that worked distance (travel x grip, body uv), which the scene feeds the crinkle sound.
 */
export function stepHandling(h: Handling, gripTo: number, x: number, y: number, dt: number): number {
  const d = Math.max(0, dt);
  const k = Math.min(1, 0.22 * d);
  const nx = h.px + (x - h.px) * Math.min(1, 0.35 * d), ny = h.py + (y - h.py) * Math.min(1, 0.35 * d);
  const travel = Math.hypot(nx - h.px, ny - h.py);
  h.px = nx; h.py = ny;
  h.grip += (Math.max(0, Math.min(1, gripTo)) - h.grip) * k;
  if (h.grip < 0.002 && gripTo <= 0) h.grip = 0;
  const worked = travel * h.grip;
  h.wear = Math.min(WEAR_MAX, h.wear + worked * WEAR_PER_TRAVEL);
  return worked;
}
