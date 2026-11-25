/**
 * THE AETHER STREAM (owner 2026-11-25: duplicates "glow a hot white blue and turn into blue aether that flows into the
 * aether icon"; then "reference the new 'good luck' animation ... for how i want to treat the card dissipation"). The
 * treatment is the Good Luck intro's dust (goodLuck/luckStar.ts): a duplicate card of the summary row is a cloud of fine
 * points of light sampled from the card's own shape. Energy runs along its edges while it glows; then it comes apart
 * from the top down, each mote lifting off and streaming along its own curve into the Aether medallion, where a spray
 * of embers marks the landing. A fifth of the motes are four-pointed sparkles.
 *
 * Every mote is placed by the vertex shader from the time alone: per frame the page writes one uniform a card and counts
 * arrivals from a sorted table. No allocation per frame. WebGL only (GLSL ES 3.0); without it the flow reports at once
 * that everything arrived and the DOM does the rest.
 *
 * Coordinates are the canvas's own px (the stream sits on the stage, over everything else in the scene).
 */
import { Container, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';

/** Motes on a card's edge, inside it, and the embers at the landing. */
export const AETHER_EDGE = 620;
export const AETHER_BODY = 900;
export const AETHER_LAND = 110;
const N = AETHER_EDGE + AETHER_BODY + AETHER_LAND;
/** Cards that can dissolve at once (a pack has five). */
export const AETHER_FLOWS = 5;
/** The flow's clock (seconds from `emit`): when the first motes leave, how long the top-to-bottom sweep takes, the scatter on a mote's leaving, and its flight. */
export const AETHER_LEAVE_S = 0.3;
export const AETHER_SWEEP_S = 0.38;
export const AETHER_SCATTER_S = 0.14;
export const AETHER_FLIGHT_S = 0.62;
export const AETHER_FLIGHT_VAR_S = 0.3;
/** How long the landing's last embers take to go. */
const AFTER_S = 0.9;

/** When the mote at height `v` (-0.5 top .. 0.5 bottom) with randoms r1, r2 leaves its card, and when it lands (seconds). The shader's own formula. */
export const moteLeaves = (v: number, r1: number): number => AETHER_LEAVE_S + (v + 0.5) * AETHER_SWEEP_S + r1 * AETHER_SCATTER_S;
export const moteLands = (v: number, r1: number, r2: number): number => moteLeaves(v, r1) + AETHER_FLIGHT_S + AETHER_FLIGHT_VAR_S * r2;

const VERT = `#version 300 es
precision highp float;
in vec2 aPosition; // the mote's place on the card (-0.5..0.5)
in vec2 aUV;       // x: random + kind (0.. body, 2.. edge, 4.. landing ember); y: random
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uT, uUnit, uRes;
uniform vec4 uCard; // centre, size
uniform vec2 uTo;
out vec3 vTint; out float vAl; flat out float vStar;
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
vec2 bz(vec2 a, vec2 b, vec2 c, vec2 d, float u){ float v = 1. - u; return v * v * v * a + 3. * v * v * u * b + 3. * v * u * u * c + u * u * u * d; }
void main(){
  float kind = floor(aUV.x * .5), r1 = fract(aUV.x), r2 = aUV.y, r3 = h11(r1 * 91.7 + r2 * 3.3), r4 = h11(r2 * 57.3 + r1 * 7.1);
  float q = uUnit, t = uT, id = r1 * 913. + r2 * 371.;
  vec3 COOL = vec3(.5, .88, 1.), DEEP = vec3(.22, .56, 1.), TEAL = vec3(.1, .95, .85);
  vTint = r2 < .5 ? COOL : r2 < .74 ? mix(COOL, vec3(1.), .65) : r2 < .9 ? DEEP : TEAL;
  vStar = 0.; vAl = 0.; float size = 2.; vec2 p = uTo;
  if (kind > 1.5) { // the landing: embers thrown off the medallion as the stream arrives
    float age = t - ${(AETHER_LEAVE_S + AETHER_FLIGHT_S).toFixed(2)} - r1 * ${(AETHER_SWEEP_S + AETHER_SCATTER_S + AETHER_FLIGHT_VAR_S).toFixed(2)};
    float life = .3 + .45 * r4, th = r2 * 6.283, r = (22. + 120. * r3) * q;
    p = uTo + vec2(cos(th), sin(th)) * r * (1. - exp(-max(age, 0.) * 5.)) + vec2(0., age * age * 70.) * q;
    size = 1.6 + 4. * pow(r3, 3.); vStar = step(.86, r4); if (vStar > .5) size = 7. + 5. * r3;
    vAl = step(0., age) * smoothstep(life, life * .25, age);
  } else {
    vec2 g = uCard.xy + aPosition * uCard.zw;
    float tb = ${AETHER_LEAVE_S.toFixed(2)} + (aPosition.y + .5) * ${AETHER_SWEEP_S.toFixed(2)} + r1 * ${AETHER_SCATTER_S.toFixed(2)};
    float te = tb + ${AETHER_FLIGHT_S.toFixed(2)} + ${AETHER_FLIGHT_VAR_S.toFixed(2)} * r2, age = t - tb;
    if (age < 0.) { // still on the card: energy runs along its edges, and light gathers in its body just before it goes
      float ph = t * (1.6 + 2.4 * r1) + r2 * 6.283;
      float run = pow(.5 + .5 * sin(g.x * .021 / q - t * 9. + g.y * .03 / q), 3.);
      p = g + vec2(sin(ph + g.y * .05), cos(ph * 1.2 + g.x * .04)) * (1.4 + 3. * r3) * q;
      if (kind > .5) { size = 1.6 + 2.2 * r4 + 2. * run; vTint = mix(COOL, vec3(1.), .4 + .5 * run); vAl = smoothstep(0., .12, t) * (.25 + .75 * run) * (.55 + .45 * sin(ph * 5.)); }
      else { size = 1.5 + 2.6 * pow(r4, 3.); vAl = smoothstep(-.22, 0., age) * .7 * (.5 + .5 * sin(ph * 6.)); }
    } else { // off the card, up on its own heat, then down its curve into the medallion
      float u = clamp(age / (te - tb), 0., 1.), e = u * u * (2.2 - 1.2 * u);
      vec2 up = g + vec2((r3 - .5) * 170., -50. - 190. * r4) * q, near = uTo + vec2((r3 - .5) * 300., -110. - 190. * r2) * q;
      p = bz(g, up, near, uTo, e) + vec2(sin(age * 9. + id), cos(age * 8. + id * 1.3)) * 5. * q * (1. - u);
      size = (1.7 + 3.8 * pow(r4, 3.)) * mix(1.15, .75, u); vStar = step(.82, r3); if (vStar > .5) size = (6. + 6. * r4) * mix(1., .7, u);
      vAl = smoothstep(0., .06, age) * smoothstep(1., .9, u) * (.7 + .3 * sin(t * (7. + 7. * r1) + id));
    }
  }
  if (vAl <= .003) { gl_Position = vec4(9., 9., 0., 1.); gl_PointSize = 1.; return; }
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(p, 1.)).xy, 0., 1.);
  gl_PointSize = max(uRes * size * q * 2.6, 1.5);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vTint; in float vAl; flat in float vStar;
out vec4 finalColor;
void main(){
  vec2 p = (gl_PointCoord - .5) * 2.; float r = length(p), g = exp(-r * r * 7.), c = exp(-r * r * 34.);
  if (vStar > .5) { vec2 q = abs(p); float st = (exp(-(q.x * 4. + q.y * 34.)) + exp(-(q.y * 4. + q.x * 34.))) * smoothstep(1., .5, r); g = g * .12 + st * .8; c = max(c * .9, st * .7); }
  finalColor = vec4((vTint * g + c * .9) * vAl, (g * .26 + c * .42) * vAl);
}`;

export type AetherProgress = (frac: number, done: boolean) => void;
interface FlowUniforms { uT: number; uUnit: number; uRes: number; uCard: Float32Array; uTo: Float32Array }
interface Flow { mesh: Mesh<MeshGeometry, Shader>; u: FlowUniforms; live: boolean; t: number; arrived: number; cb: AetherProgress | null }

/** A point on a rounded rectangle's edge (-0.5..0.5 both ways) at `s` (0..1 round it), for a card `aspect` wide per tall. */
export function rimPoint(s: number, aspect: number, out: { x: number; y: number }): { x: number; y: number } {
  const w = aspect, h = 1, r = 0.075; // in card heights
  const sx = w - 2 * r, sy = h - 2 * r, arc = (Math.PI / 2) * r;
  const per = 2 * sx + 2 * sy + 4 * arc;
  let d = (((s % 1) + 1) % 1) * per;
  let x: number, y: number;
  const corner = (cx: number, cy: number, a0: number, dd: number): void => { const a = a0 + dd / r; x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r; };
  x = 0; y = 0;
  if (d < sx) { x = -w / 2 + r + d; y = -h / 2; }
  else if ((d -= sx) < arc) corner(w / 2 - r, -h / 2 + r, -Math.PI / 2, d);
  else if ((d -= arc) < sy) { x = w / 2; y = -h / 2 + r + d; }
  else if ((d -= sy) < arc) corner(w / 2 - r, h / 2 - r, 0, d);
  else if ((d -= arc) < sx) { x = w / 2 - r - d; y = h / 2; }
  else if ((d -= sx) < arc) corner(-w / 2 + r, h / 2 - r, Math.PI / 2, d);
  else if ((d -= arc) < sy) { x = -w / 2; y = h / 2 - r - d; }
  else corner(-w / 2 + r, -h / 2 + r, Math.PI, d - sy);
  out.x = x / w; out.y = y / h;
  return out;
}

export class AetherStream {
  readonly root = new Container();
  /** Flows still playing. */
  count = 0;
  private readonly flows: Flow[] = [];
  /** When each card mote lands (seconds from `emit`), ascending: the arrivals are counted from it. */
  private readonly lands: Float32Array;

  /** `webgl` false = nothing is drawn and every flow reports its arrival at once. `res` is the renderer's resolution. */
  constructor(webgl: boolean, res: number) {
    this.lands = new Float32Array(AETHER_EDGE + AETHER_BODY);
    if (!webgl) return;
    try {
      const pos = new Float32Array(N * 2), rnd = new Float32Array(N * 2), idx = new Uint32Array(N);
      const pt = { x: 0, y: 0 };
      // a fixed sequence, so every card comes apart the same way and the table below matches the shader
      let seed = 0x9e3779b9;
      const rand = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1000000) / 1000000; };
      for (let i = 0; i < N; i++) {
        const r1 = rand() * 0.999, r2 = rand();
        let kind = 0;
        if (i < AETHER_EDGE) { kind = 1; rimPoint(i / AETHER_EDGE + rand() * 0.002, 2 / 3, pt); const inset = 1 - rand() * 0.05; pt.x *= inset; pt.y *= inset; }
        else if (i < AETHER_EDGE + AETHER_BODY) { pt.x = (rand() - 0.5) * 0.94; pt.y = (rand() - 0.5) * 0.96; }
        else { kind = 2; pt.x = 0; pt.y = 0; }
        pos[i * 2] = pt.x; pos[i * 2 + 1] = pt.y;
        rnd[i * 2] = kind * 2 + r1; rnd[i * 2 + 1] = r2;
        idx[i] = i;
        if (kind < 2) this.lands[i] = moteLands(pt.y, r1, r2);
      }
      this.lands.sort();
      const geometry = new MeshGeometry({ positions: pos, uvs: rnd, indices: idx, topology: 'point-list' });
      for (let f = 0; f < AETHER_FLOWS; f++) {
        const group = new UniformGroup({
          uT: { value: -1, type: 'f32' },
          uUnit: { value: 1, type: 'f32' },
          uRes: { value: res, type: 'f32' },
          uCard: { value: new Float32Array(4), type: 'vec4<f32>' },
          uTo: { value: new Float32Array(2), type: 'vec2<f32>' },
        });
        const shader = Shader.from({ gl: { vertex: VERT, fragment: FRAG }, resources: { aetherUniforms: group } });
        const mesh = new Mesh({ geometry, shader });
        mesh.blendMode = 'add';
        mesh.visible = false;
        this.root.addChild(mesh);
        this.flows.push({ mesh, u: group.uniforms as unknown as FlowUniforms, live: false, t: 0, arrived: 0, cb: null });
      }
    } catch (e) { console.warn('[packAether]', e); this.flows.length = 0; }
  }

  /**
   * A card at (cx, cy), `w` x `h`, comes apart and flows to (tx, ty). `unit` is the size of one stage px in canvas px
   * (the motes and their paths scale with the theatre). `cb` hears how much of the card has landed (0..1), at most once
   * a frame, and `done` when the last mote is in.
   */
  emit(cx: number, cy: number, w: number, h: number, tx: number, ty: number, unit: number, cb: AetherProgress | null): void {
    const f = this.flows.find((x) => !x.live);
    if (!f) { cb?.(1, true); return; }
    f.live = true; f.t = 0; f.arrived = 0; f.cb = cb;
    f.u.uCard[0] = cx; f.u.uCard[1] = cy; f.u.uCard[2] = w; f.u.uCard[3] = h;
    f.u.uTo[0] = tx; f.u.uTo[1] = ty;
    f.u.uUnit = unit; f.u.uT = 0;
    f.mesh.visible = true;
    this.count++;
  }

  /** One frame (`dt` in 60 Hz frames, already slow-mo scaled). */
  step(dt: number): void {
    if (this.count === 0) return;
    const lands = this.lands, n = lands.length, last = lands[n - 1]!;
    for (const f of this.flows) {
      if (!f.live) continue;
      f.t += dt / 60;
      f.u.uT = f.t;
      let a = f.arrived;
      while (a < n && lands[a]! <= f.t) a++;
      if (a !== f.arrived) {
        f.arrived = a;
        const cb = f.cb;
        if (a >= n) f.cb = null;
        cb?.(a / n, a >= n);
      }
      if (f.t > last + AFTER_S) { f.live = false; f.mesh.visible = false; this.count--; }
    }
  }

  clear(): void {
    for (const f of this.flows) { f.live = false; f.cb = null; f.mesh.visible = false; }
    this.count = 0;
  }
}
