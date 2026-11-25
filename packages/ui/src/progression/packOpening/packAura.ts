/**
 * PACK OPENING: THE CARD AURA (owner 2026-11-24: "i really want the effects to look good and not simple shapes, i want
 * the details to be intricate", with the location reveal's shaders as the bar). One fragment shader, drawn on a quad
 * behind a card, replaces flat glow sprites for the three reward beats:
 *
 *  - THE TEASE / CHARGE (`level`, `tier`): flame-like wisps of domain-warped noise that lick outward from the card's own
 *    rounded edge, bright filaments inside them, a hot rim hugging the edge with sparks running along it, fine drifting
 *    rays (Legendary and up) and twinkling motes carried outward. More tiers = further reach and more layers.
 *  - THE BURST (`burstT`, seconds since it fired; negative = none): a shockwave ring with a noise-torn edge and a
 *    second thinner ring inside it, long god rays of layered angular noise, a core flash, embers thrown outward as
 *    streaks, and fine glitter that lights where the wave passes.
 *  - THE AMBIENT hold behind a big pull's face: the same wisps at a lower level.
 *
 * Everything is procedural (no textures to paint or upload). Per frame only uniforms change; no allocation. WebGL only
 * (GLSL ES 3.0; the scene asks for WebGL): `makeAura` returns null on any other renderer, and the scene falls back to
 * the painted glow and burst sprites.
 */
import { Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import type { CrateRarity } from '@game/progression';

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

/** The quad spans this many card heights from its centre to an edge (the shader's `p` is in card heights). */
export const AURA_REACH = 2.1;

const GL_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec4 uColor;      // the mesh pipe's tint x alpha
uniform float uTime;      // seconds
uniform float uLevel;     // 0..1: how strongly the wisps burn
uniform float uTier;      // 0..4: Common..Ancient (reach and layers)
uniform float uBurst;     // seconds since the burst fired; negative = none
uniform float uBurstK;    // the burst's size (0.3 a puff .. 1.25 Ancient)
uniform vec3 uA;          // the rarity's body colour
uniform vec3 uB;          // its second colour (the outer wisps, the inner ring)
uniform vec3 uC;          // its hot core colour
const float TAU = 6.28318530718;
const float REACH = ${AURA_REACH.toFixed(2)};

float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p){ return vec2(h21(p), h21(p + 37.7)); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fb(vec2 p){ float a = .5, r = 0.; for (int i = 0; i < 5; i++) { r += a * n2(p); p = p * 2.03 + 7.1; a *= .5; } return r; }
// angular noise that wraps cleanly round the circle (two samples blended across the seam)
float an(float ang, float f, float y){ float u = ang / TAU + .5; float a = n2(vec2(u * f, y)), b = n2(vec2((u + 1.) * f, y)); return mix(b, a, smoothstep(0., .12, u)); }
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }

// sparks in polar cells: each cell holds one twinkling dot, stretched along the radius by 'streak'
float motes(vec2 p, float r, float ang, float N, float M, float flow, float streak, float seed, float t){
  vec2 pc = vec2((ang / TAU + .5) * N, r * M - flow);
  vec2 id = floor(pc), f = fract(pc) - .5;
  id.x = mod(id.x, N);
  vec2 o = (h22(id + seed) - .5) * .55;
  float life = h21(id + seed + 3.1);
  float tw = .55 + .45 * sin(t * 7. + life * 40.);
  vec2 dv = (f - o) * vec2(r * TAU * M / N, streak);
  return smoothstep(.05, 0., length(dv)) * tw * step(.6, life);
}

void main() {
  vec2 p = vUV * REACH;
  float t = uTime;
  float r = length(p) + 1e-4, ang = atan(p.y, p.x);
  vec2 dir = p / r;
  float d = sdRound(p, vec2(.3333, .5), .045);   // the card: < 0 inside
  float od = max(d, 0.);
  vec3 col = vec3(0.);
  // nothing reaches this far without a burst: skip the noise (most of the quad, most of the time)
  if (uBurst < 0. && od > .7) { finalColor = vec4(0.); return; }

  if (uLevel > .002) {
    float tk = clamp(uTier / 4., 0., 1.);
    // the wisps: tongues of warped noise that stream OUT from the card (noise looked up by direction, scrolled along
    // the radius, so it flows outward with no rings), with a finer turbulence folded in
    float flow = r * 1.5 - t * (.42 + .3 * tk);
    vec2 qa = dir * 2.4;
    vec2 wv = vec2(fb(qa * 1.6 + t * .13), fb(qa * 1.6 + 4.3 - t * .11));
    float tongues = fb(qa + flow * vec2(.83, .56) + wv * 1.1);
    float fine = fb(p * 4.6 + vec2(t * .17, -t * .26) + tongues * 1.7);
    float w = tongues * .62 + fine * .38;
    float reach = mix(.04, .085, uLevel) * (1. + .9 * tk);   // card heights: it hugs the card, the burst is what fills the stage
    float body = exp(-od / reach);
    float wisps = smoothstep(.36, .9, w + body * .5) * body;
    col += mix(uA, uB, smoothstep(.15, .85, od / reach * .5 + fine * .5)) * wisps * 1.3;
    // filaments: thin bright ridges threading the wisps, in the rarity's own light
    float ridge = 1. - abs(2. * fb(qa * 1.3 + flow * vec2(.6, .9) + fine * 1.4 + 9.) - 1.);
    col += mix(uA, uC, .65) * pow(ridge, 6.) * body * body * (.6 + .8 * tk);
    // the rim: a hot line on the card's edge, sparks running along it
    float rim = exp(-abs(d) * 46.);
    float run = an(ang, 26., t * 1.9) * an(ang, 9., 4. - t * .8);
    col += uC * rim * (.22 + 2.6 * run * run) + uA * exp(-od * 18.) * .22;
    // fine rays (Legendary and up)
    float rayK = smoothstep(2.4, 3.1, uTier);
    if (rayK > 0.) {
      float ray = an(ang, 9., t * .33) * .55 + an(ang, 23., 9. - t * .55) * .45;
      ray = pow(smoothstep(.42, .9, ray), 2.);
      col += mix(uB, uC, .55) * ray * exp(-od * 4.6) * smoothstep(0., .04, od) * rayK * 1.1;
    }
    // motes carried outward (Rare and up), three depths
    float moteK = smoothstep(.5, 1.4, uTier) * (.5 + .7 * tk);
    if (moteK > 0.) {
      float m = motes(p, r, ang, 26., 5.5, t * .55, 1., 1., t) + motes(p, r, ang, 41., 8., t * .8, 1., 9., t) * .8
        + motes(p, r, ang, 17., 3.5, t * .32, 1., 21., t) * 1.2;
      col += uC * m * exp(-od * 4.2) * smoothstep(0., .03, od) * moteK;
    }
    col *= uLevel;
  }

  if (uBurst >= 0.) {
    float bt = uBurst;
    float e = 1. - exp(-bt * 3.6);
    float R = .34 + 1.12 * e * uBurstK;
    float fade = exp(-bt * 2.1);
    float clear = smoothstep(0., .05, od);
    // the shell: its radius wanders with the angle and its light comes in torn arcs of uneven weight, never a clean circle
    float Rr = R + (an(ang, 4., bt * .9 + 2.) - .5) * .42 * R + (an(ang, 13., 7. - bt * 1.4) - .5) * .14 * R;
    float arcs = (1.9 * pow(an(ang, 6., bt * 1.1 + 5.), 2.) + 1.1 * pow(an(ang, 19., 3. + bt * 2.), 3.)) * (.55 + .9 * fb(dir * 9. + r * 3.));
    float x1 = (r - Rr) * (9. + 16. * an(ang, 9., 11.));
    col += (uC * 1.1 + uA * .6) * exp(-x1 * x1) * arcs * fade * 1.1;
    // plasma trailing inside the front, streaming outward
    float plasma = fb(dir * 3. + (r * 2.2 - bt * 2.6) * vec2(.8, .6) + 3.);
    float wake = smoothstep(Rr, Rr - .09, r) * exp(-(Rr - r) * 3.4);
    col += mix(uA, uB, plasma) * wake * (.04 + 1.5 * plasma * plasma * plasma) * fade * clear;
    // god rays: broad beams and fine needles of layered angular noise, each its own length
    float gr = an(ang, 9., bt * .6) * .5 + an(ang, 21., 2. - bt * 1.1) * .3 + an(ang, 45., bt * 1.7) * .2;
    float beams = pow(smoothstep(.4, .85, gr), 1.6);
    float needles = pow(an(ang, 70., 4. + bt * .8), 9.) * 6.;
    float len = Rr * (1.05 + 1.2 * an(ang, 6., bt * .5 + 1.));
    col += mix(uC, uA, smoothstep(.1, 1.5, r)) * (beams * 1.9 + needles) * smoothstep(len, len * .15, r) * exp(-bt * 1.3) * uBurstK * clear;
    // the core flash
    col += uC * exp(-r * r * 7.5) * exp(-bt * 6.) * 1.7;
    // embers thrown out with the wave, streaked along their flight
    float em = motes(p, r, ang, 31., 4., e * 4.2, .2, 3., t) + motes(p, r, ang, 47., 6., e * 6.5, .16, 13., t) * .8
      + motes(p, r, ang, 19., 2.8, e * 2.6, .24, 27., t) * 1.1;
    col += mix(uC, uB, .25) * em * smoothstep(Rr * 1.2, Rr * .15, r) * exp(-bt * 1.1) * 1.9 * smoothstep(.02, .1, bt) * clear;
    // glitter: fine sparks that light where the front passes, then die
    float x3 = (r - Rr) * 4.5;
    float gl = motes(p, r, ang, 67., 13., 0., 1., 41., t) + motes(p, r, ang, 89., 17., 0., 1., 53., t);
    col += uC * gl * exp(-x3 * x3) * fade * 1.4 * uBurstK * clear;
  }

  // fade to nothing before the quad's edge
  float m = max(abs(vUV.x), abs(vUV.y));
  col *= smoothstep(1., .72, m) * uColor.a;
  float a = clamp(max(col.r, max(col.g, col.b)), 0., 1.);
  finalColor = vec4(col, a);
}`;

/** A rarity's three aura colours (0..1 rgb): body, second, hot core. */
export const AURA_COLORS: Readonly<Record<CrateRarity, readonly [readonly number[], readonly number[], readonly number[]]>> = {
  common: [[0.6, 0.66, 0.78], [0.4, 0.46, 0.6], [0.94, 0.97, 1]],
  rare: [[0.22, 0.52, 1], [0.12, 0.28, 0.92], [0.74, 0.9, 1]],
  epic: [[0.7, 0.32, 1], [0.96, 0.3, 0.82], [1, 0.84, 1]],
  legendary: [[1, 0.64, 0.16], [1, 0.34, 0.06], [1, 0.95, 0.72]],
  ancient: [[0.18, 0.95, 0.86], [1, 0.42, 0.86], [1, 1, 1]],
};

interface AuraUniforms {
  uTime: number; uLevel: number; uTier: number; uBurst: number; uBurstK: number;
  uA: Float32Array; uB: Float32Array; uC: Float32Array;
}

/** One aura: its mesh and the state the scene drives (plain fields, written in place). */
export class Aura {
  /** 0..1: the wisps' strength (the scene eases it). */
  level = 0;
  /** 0..4: Common..Ancient. */
  tier = 0;
  /** Seconds since the burst fired; negative = none. */
  burstT = -1;
  burstK = 1;
  /** How long a burst lives (seconds). */
  static readonly BURST_LIFE = 2.6;

  constructor(readonly mesh: Mesh<MeshGeometry, Shader>, private readonly u: AuraUniforms) {}

  /** Dress the aura in a rarity's colours. */
  setRarity(r: CrateRarity): void {
    const c = AURA_COLORS[r];
    this.u.uA.set(c[0]); this.u.uB.set(c[1]); this.u.uC.set(c[2]);
  }

  /**
   * Centre it on (x, y), for a card `cardH` tall (parent units). `turn` (1 = facing us, toward 0 = edge-on) narrows it
   * with a card turning about its vertical axis, so the aura stays on the card's edges through a flip.
   */
  place(x: number, y: number, cardH: number, turn = 1): void {
    this.mesh.position.set(x, y);
    const k = cardH * AURA_REACH;
    this.mesh.scale.set(k * Math.max(0.05, Math.min(1, turn)), k);
  }

  fireBurst(k: number): void { this.burstT = 0; this.burstK = k; }

  /** Anything to draw? */
  get live(): boolean { return this.level > 0.003 || this.burstT >= 0; }

  off(): void { this.level = 0; this.burstT = -1; this.mesh.visible = false; }

  /** Take another aura's whole look (the tease's aura becomes the turning card's). */
  copyFrom(o: Aura): void {
    this.level = o.level; this.tier = o.tier; this.burstT = o.burstT; this.burstK = o.burstK;
    this.u.uA.set(o.u.uA); this.u.uB.set(o.u.uB); this.u.uC.set(o.u.uC);
    this.mesh.position.copyFrom(o.mesh.position);
    this.mesh.scale.copyFrom(o.mesh.scale);
  }

  /** One frame: advance the burst, write the uniforms (`dtSec` and `timeSec` in seconds, slow-mo scaled). */
  update(dtSec: number, timeSec: number): void {
    if (this.burstT >= 0) { this.burstT += dtSec; if (this.burstT > Aura.BURST_LIFE) this.burstT = -1; }
    const live = this.live;
    this.mesh.visible = live;
    if (!live) return;
    const u = this.u;
    u.uTime = timeSec; u.uLevel = Math.min(1, this.level); u.uTier = this.tier; u.uBurst = this.burstT; u.uBurstK = this.burstK;
  }
}

/** Build an aura (a unit quad, additive). Null when the renderer is not WebGL (the caller keeps its painted fallback). */
export function makeAura(webgl: boolean): Aura | null {
  if (!webgl) return null;
  try {
    const group = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uLevel: { value: 0, type: 'f32' },
      uTier: { value: 0, type: 'f32' },
      uBurst: { value: -1, type: 'f32' },
      uBurstK: { value: 1, type: 'f32' },
      uA: { value: new Float32Array(3), type: 'vec3<f32>' },
      uB: { value: new Float32Array(3), type: 'vec3<f32>' },
      uC: { value: new Float32Array(3), type: 'vec3<f32>' },
    });
    const shader = Shader.from({ gl: { vertex: GL_VERT, fragment: GL_FRAG }, resources: { auraUniforms: group } });
    const geometry = new MeshGeometry({
      positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      uvs: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const mesh = new Mesh({ geometry, shader });
    mesh.blendMode = 'add';
    mesh.visible = false;
    return new Aura(mesh, group.uniforms as unknown as AuraUniforms);
  } catch {
    return null;
  }
}
