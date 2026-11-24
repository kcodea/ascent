/**
 * THE LUCKY STAR (R-GOODLUCK-STAR-01, GoodLuckIntro.tsx): a comet of the location's own magic that leaves the player's hero in one
 * long arc, crosses the board and sets "Good Luck" alight letter by letter, then turns under the words and draws a line of light
 * there. At the end the words come apart into dust, and the dust streams into the End Turn crystal, where the shop clock starts.
 *
 * One WebGL 2 canvas: a silk of ribbons, the dust (placed by its vertex shader; the letters' own from a drawing of them) and the
 * flares. The page does nothing a frame but set the time. Made while the lobby reveal plays; with no canvas (a phone, reduced
 * motion) the words do it all by themselves.
 */
import { canRun } from '../locationReveal/rippleSupport';
import type { LocationDef, Rgb } from '../locationReveal/locations';
import { beginProgram, compiled, finishProgram, type Prog } from '../locationReveal/placeGl';

export interface Pt { x: number; y: number }
/** Seconds from the comet's take-off. */
export interface LuckTimes { write: number; burst: number; gather: number; dive: number; land: number }
export interface LuckScene {
  from: Pt;
  to: Pt;
  /** The letters' middles, in screen px. */
  letters: readonly Pt[];
  /** Where it ends: the middle of the line of light under the words. */
  burst: Pt;
  times: LuckTimes;
  /** Points on the letters (x, y pairs), which the dust falls to and leaves from; and how much the words have grown by the end. */
  glyphs: Float32Array;
  grown: number;
}

const N_A = 96;
const N_B = 24;
const TAIL = 620;
const EMBERS = 110;
const LAND = 110;
const RIB = 72;
/** How long the last light of the landing takes to go. */
export const LUCK_AFTER_S = 0.75;

const bez = (p: readonly [Pt, Pt, Pt, Pt], u: number): Pt => {
  const v = 1 - u;
  const k = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u] as const;
  return { x: k[0] * p[0].x + k[1] * p[1].x + k[2] * p[2].x + k[3] * p[3].x, y: k[0] * p[0].y + k[1] * p[1].y + k[2] * p[2].y + k[3] * p[3].y };
};
/** Where the crossing of the words starts and ends. */
export function luckSpan(s: LuckScene): { start: Pt; end: Pt } {
  const a = s.letters[0]!;
  const z = s.letters[s.letters.length - 1]!;
  const step = s.letters.length > 1 ? (z.x - a.x) / (s.letters.length - 1) : 90;
  return { start: { x: a.x - step, y: a.y }, end: { x: z.x + step, y: z.y } };
}
/** When the last letter is alight (the turn under the words is the rest). */
export const writeEnd = (t: LuckTimes): number => t.write + (t.burst - t.write) * 0.6;
/** When the comet is at `x`, on its way across the words. */
export const passAt = (s: LuckScene, x: number): number => {
  const { start, end } = luckSpan(s);
  return s.times.write + (writeEnd(s.times) - s.times.write) * ((x - start.x) / (end.x - start.x));
};

/** Where the comet is `t` seconds after take-off: one arc off the hero, across the words, and round under them. */
export function luckPath(s: LuckScene, t: number, h: number): Pt {
  const { start, end } = luckSpan(s);
  const { write, burst } = s.times;
  const tw = writeEnd(s.times);
  const v = (end.x - start.x) / (tw - write); // px a second along the words
  if (t < write) {
    const u = Math.max(0, t / write);
    return bez([s.from, { x: s.from.x - h * 0.03, y: s.from.y - h * 0.62 }, { x: start.x - (v * write) / 3, y: start.y - h * 0.1 }, start], u * u * (1.5 - 0.5 * u));
  }
  if (t < tw) {
    const u = (t - write) / (tw - write);
    return { x: start.x + (end.x - start.x) * u, y: start.y + (end.y - start.y) * u - Math.sin(u * Math.PI) * h * 0.016 };
  }
  const u = Math.min(1, (t - tw) / (burst - tw));
  return bez([end, { x: end.x + (v * (burst - tw)) / 3, y: end.y }, { x: end.x + h * 0.14, y: s.burst.y }, s.burst], u * (2 - u) * 0.6 + u * 0.4);
}
/** The comet's dive, ahead of the dust: off the end of the words and down into the crystal. */
export function divePath(s: LuckScene, u: number, h: number): Pt {
  const { end } = luckSpan(s);
  return bez([end, { x: end.x + h * 0.06, y: end.y - h * 0.2 }, { x: s.to.x - h * 0.04, y: s.to.y - h * 0.3 }, s.to], u * u * (1.6 - 0.6 * u));
}

const HEAD = `precision highp float;
uniform vec2 S; uniform float t, px; uniform vec2 A[${N_A}]; uniform vec2 B[${N_B}]; uniform vec2 BC, TO, X; uniform float T[5]; uniform vec3 COOL, WARM, SECOND;
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
vec2 pathA(float s){ float f = clamp(s / T[1], 0., 1.) * ${N_A - 1}.; int i = int(min(f, ${N_A - 2}.)); return mix(A[i], A[i + 1], f - float(i)); }
vec2 pathB(float s){ float f = clamp((s - T[2]) / (T[4] - T[2]), 0., 1.) * ${N_B - 1}.; int i = int(min(f, ${N_B - 2}.)); return mix(B[i], B[i + 1], f - float(i)); }
vec4 place(vec2 p){ vec2 u = p / S; return vec4(u.x * 2. - 1., 1. - u.y * 2., 0., 1.); }
`;
// THE SILK: three strands braided round the path, a strip each, thin at both ends
const VR = `${HEAD}
out float al; out float ac; out float along;
void main(){ float seg = float(gl_VertexID / 2) / ${RIB - 1}., side = float(gl_VertexID & 1) * 2. - 1.; float st = float(gl_InstanceID); bool d = st > 2.5; st = mod(st, 3.);
  float len = d ? .20 : .34, head = d ? min(t, T[4]) : min(t, T[1]); float b = head - seg * len; float lo = d ? T[2] : 0.; float age = t - b; b = max(b, lo);
  vec2 p = d ? pathB(b) : pathA(b), q = d ? pathB(b + .006) : pathA(b + .006), r = d ? pathB(b - .006) : pathA(b - .006); vec2 tan_ = q - r; tan_ = length(tan_) > .01 ? normalize(tan_) : vec2(1., 0.); vec2 n = vec2(-tan_.y, tan_.x);
  float sway = sin(b * 15. + st * 2.1) * (.004 + .020 * seg) * S.y * step(.5, st); p += n * sway;
  float w = (st < .5 ? .0060 : .0032) * S.y * pow(1. - seg, .8) * smoothstep(0., .05, seg + .012); gl_Position = place(p + n * side * w * 2.6);
  float live = d ? step(T[2], t) * smoothstep(T[4] + .22, T[4], t) : smoothstep(T[1] + .34, T[1], t) * step(0., t); al = live * pow(1. - seg, 1.5) * step(lo + .0005, b) * (st < .5 ? 1. : .62); ac = side; along = seg; }`;
const FR = `precision highp float; in float al; in float ac; in float along; uniform vec3 COOL, WARM, SECOND; out vec4 o;
void main(){ float g = exp(-ac * ac * 7.) , c = exp(-ac * ac * 60.); vec3 k = mix(COOL, SECOND, smoothstep(.25, 1., along)); k = mix(mix(WARM, vec3(1.), .4), k, smoothstep(0., .22, along)); o = vec4((k * g * .75 + c * (1. - along) * .9) * al, (g * .30 + c * .45 * (1. - along)) * al); }`;
// THE DUST
const VD = `${HEAD}
layout(location = 0) in vec2 gp; uniform int mode; uniform float grown;
out vec3 tint; out float al; flat out float kind;
vec2 bz(vec2 a, vec2 b, vec2 c, vec2 d, float u){ float v = 1. - u; return v * v * v * a + 3. * v * v * u * b + 3. * v * u * u * c + u * u * u * d; }
void main(){ float id = float(gl_VertexID), q = S.y / 1080., age, life, size; vec2 p; al = 0.; kind = 0.; float r1 = h11(id + .7), r2 = h11(id + 3.1), r3 = h11(id + 5.5), r4 = h11(id + 9.3); tint = r2 < .35 ? COOL : r2 < .9 ? WARM : SECOND;
  if (mode == 0) { // falls off the comet as it passes, and settles on its letter
    float tb = T[0] + (gp.x - X.x) / (X.y - X.x) * ((T[1] - T[0]) * .6) + (r1 - .35) * .09; age = t - tb; float u = clamp(age / (.22 + .2 * r3), 0., 1.), e = 1. - pow(1. - u, 3.); vec2 from = pathA(tb) + vec2(-20. - 70. * r2, (r3 - .5) * 90.) * q;
    p = mix(from, gp, e) + vec2(0., sin(u * 3.14159) * (r4 - .5) * 34.) * q; size = 1.6 + 3.4 * pow(r4, 3.); al = step(0., age) * smoothstep(0., .04, age) * smoothstep(.62 + .3 * r2, .25, age); }
  else if (mode == 1) { // comes off it, and streams into the crystal
    vec2 g = vec2((gp.x - (X.x + X.y) * .5) * grown + (X.x + X.y) * .5, gp.y); float nx = clamp((gp.x - X.x) / (X.y - X.x), 0., 1.); float tb = T[2] + (1. - nx) * .20 + r1 * .10, te = T[4] - .05 + r2 * .12; age = t - tb; float u = clamp(age / (te - tb), 0., 1.), e = u * u * (2.2 - 1.2 * u);
    vec2 up = g + vec2((r3 - .2) * 130., -60. - 190. * r4) * q, near = TO + vec2(-90. - 160. * r3, -120. - 190. * r2) * q; p = bz(g, up, near, TO, e) + vec2(sin(age * 9. + id), cos(age * 8. + id * 1.3)) * 5. * q * (1. - u);
    size = (1.7 + 3.8 * pow(r4, 3.)) * mix(1., .75, u); al = step(0., age) * smoothstep(0., .06, age) * smoothstep(1., .90, u); if (t < tb) al = 0.; }
  else { float E1 = ${TAIL}., E2 = E1 + ${EMBERS}.;
    if (id < E1) { float b = id / E1 * T[1]; age = t - b; life = .30 + .75 * r4 * r4; float v = (5. + 30. * r3) * q, th = r1 * 6.283; p = pathA(b) + vec2(cos(th), sin(th)) * v * (1. - exp(-age * 3.)) + vec2(sin(age * 3. + id) * 4., age * age * 46.) * q; size = 1.5 + 4. * pow(r2, 4.); kind = step(.94, r3); if (kind > .5) size = 9. + 6. * r2; al = step(0., age) * smoothstep(0., .04, age) * smoothstep(life, life * .2, age) * (.6 + .4 * sin(t * (7. + 7. * r1) + id)); }
    else if (id < E2) { age = t - T[1] - r1 * .25; life = .7 + .7 * r4; float w = (X.y - X.x) * .5; p = vec2((X.x + X.y) * .5 + (r2 * 2. - 1.) * w, BC.y - 8. * q) + vec2(sin(age * 2. + id) * 10., -(26. + 90. * r3) * age) * q; size = 1.5 + 3.6 * pow(r4, 2.); kind = step(.9, r3); if (kind > .5) size = 9. + 5. * r2; tint = mix(WARM, vec3(1.), .25); al = step(0., age) * smoothstep(0., .12, age) * smoothstep(life, life * .3, age) * (.55 + .45 * sin(t * 8. + id)); }
    else { age = t - T[4] + .02; life = .28 + .4 * r4; float th = r1 * 6.283, r = (24. + 120. * r3) * q; p = TO + vec2(cos(th), sin(th)) * r * (1. - exp(-max(age, 0.) * 5.)) + vec2(0., age * age * 90.) * q; size = 1.6 + 4. * pow(r2, 3.); al = step(0., age) * smoothstep(life, life * .25, age); } }
  gl_Position = al <= .003 ? vec4(9.) : place(p); gl_PointSize = max(px * size * q * 2.6, 1.5); }`;
const FD = `precision highp float; in vec3 tint; in float al; flat in float kind; out vec4 o;
void main(){ vec2 p = (gl_PointCoord - .5) * 2.; float r = length(p), g = exp(-r * r * 7.), c = exp(-r * r * 34.); if (kind > .5) { vec2 q = abs(p); float st = (exp(-(q.x * 4. + q.y * 34.)) + exp(-(q.y * 4. + q.x * 34.))) * smoothstep(1., .5, r); g = g * .12 + st * .8; c = max(c * .9, st * .7); } o = vec4((tint * g + c * .9) * al, (g * .26 + c * .42) * al); }`;
// THE FLARES: the comet's head, the line of light under the words, the crystal taking it. Quads.
const VF = `${HEAD}
out vec2 uv; out vec3 tint; out float al; flat out float kind;
void main(){ int q = gl_VertexID / 6, v = gl_VertexID % 6; vec2 c = vec2(v == 1 || v == 2 || v == 4 ? 1. : -1., v == 2 || v == 4 || v == 5 ? 1. : -1.); uv = c; float k = S.y / 1080.; vec2 p, e; tint = COOL; kind = 0.; al = 0.;
  bool a = t < T[1] + .12, d = t > T[2] && t < T[4]; vec2 hp = t < T[2] ? pathA(t) : pathB(t); float grow = t < T[2] ? smoothstep(0., .14, t) * smoothstep(T[1] + .12, T[1] - .05, t) : smoothstep(T[2], T[2] + .16, t); float on = a || d ? grow : 0.;
  if (q == 0) { p = hp; e = vec2(86.) * k; tint = mix(COOL, vec3(1.), .25); al = on * .85; }
  else if (q == 1) { p = hp; e = vec2(210., 7.) * k; kind = 1.; tint = mix(WARM, vec3(1.), .5); al = on * (.8 + .2 * sin(t * 40.)); }
  else if (q == 2) { float s = t - T[1] + .10; float o = smoothstep(0., .34, s); p = BC; e = vec2((X.y - X.x) * (.10 + .62 * (1. - pow(1. - o, 3.))), 9. * k); kind = 1.; tint = mix(WARM, vec3(1.), .35); al = step(0., s) * smoothstep(0., .08, s) * mix(1., .55, smoothstep(.1, .5, s)) * smoothstep(T[2] + .26, T[2] - .04, t); }
  else if (q == 3) { float s = t - T[1] + .06; p = BC; e = vec2((X.y - X.x) * .52, 120. * k); tint = WARM; kind = 3.; al = step(0., s) * smoothstep(0., .1, s) * exp(-s * 3.2) * .8; }
  else if (q == 4) { float s = t - T[4] + .03; p = TO; e = vec2(150.) * k * (.6 + .5 * smoothstep(0., .3, s)); tint = mix(COOL, vec3(1.), .2); al = step(0., s) * smoothstep(0., .05, s) * exp(-s * 6.); }
  else if (q == 5) { float s = t - T[4] + .03; p = TO; e = vec2(330., 8.) * k * vec2(.4 + .6 * smoothstep(0., .2, s), 1.); kind = 1.; tint = mix(COOL, vec3(1.), .4); al = step(0., s) * smoothstep(0., .05, s) * exp(-s * 5.); }
  else { float s = t - T[4] + .02, u = clamp(s / .5, 0., 1.); p = TO; e = vec2(40. + 130. * (1. - pow(1. - u, 3.))) * k; kind = 2.; tint = COOL; al = step(0., s) * (1. - u) * .75; }
  gl_Position = al <= .003 ? vec4(9.) : place(p + c * e); }`;
const FF = `precision highp float; in vec2 uv; in vec3 tint; in float al; flat in float kind; out vec4 o;
void main(){ float r = length(uv);
  if (kind > 2.5) { float g = exp(-dot(uv, uv) * 3.4) * smoothstep(1., .55, r); o = vec4(tint * g * .55, g * .10) * al; return; }
  if (kind > 1.5) { float b = exp(-pow((r - .88) * 26., 2.)); o = vec4(tint * b, b * .3) * al; return; }
  if (kind > .5) { float g = exp(-uv.y * uv.y * 9.) * pow(max(1. - abs(uv.x), 0.), 2.2), c = exp(-uv.y * uv.y * 70.) * pow(max(1. - abs(uv.x), 0.), 1.3); o = vec4((tint * g * .7 + c) * al, (g * .25 + c * .45) * al); return; }
  float g = exp(-r * r * 9.) * smoothstep(1., .6, r), c = exp(-r * r * 90.); o = vec4((tint * g * .8 + c * 1.1) * al, (g * .3 + c * .6) * al); }`;

export class LuckStar {
  private gl: WebGL2RenderingContext | null;
  private ribbon!: Prog;
  private dust!: Prog;
  private flare: Prog | null = null;
  private empty!: WebGLVertexArrayObject;
  private raf = 0;
  private dead = false;
  /** Off on its one flight (it takes itself away after it). */
  flying = false;
  /** Is it there to be seen this play? */
  get ok(): boolean { return this.flare !== null && !this.dead; }
  private constructor(private loc: LocationDef | null, private canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) { this.gl = gl; }

  static make(loc: LocationDef | null): LuckStar | null {
    if (!canRun()) return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const s = new LuckStar(loc, canvas, gl);
    void s.ready();
    return s;
  }
  private async ready(): Promise<void> {
    const gl = this.gl!;
    try {
      const raw = [beginProgram(gl, VR, FR, []), beginProgram(gl, VD, FD, ['gp']), beginProgram(gl, VF, FF, [])];
      if (!(await compiled(gl, raw, () => this.dead))) return;
      this.ribbon = finishProgram(gl, raw[0]!);
      this.dust = finishProgram(gl, raw[1]!);
      this.flare = finishProgram(gl, raw[2]!);
      this.empty = gl.createVertexArray()!;
      // One unseen draw of each, so the first that is seen finds everything made.
      this.size();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.empty);
      for (const p of [this.ribbon, this.dust, this.flare]) { gl.useProgram(p.p); gl.uniform1f(p.u('t'), -9); gl.drawArrays(p === this.dust ? gl.POINTS : gl.TRIANGLES, 0, 6); }
    } catch (e) { console.warn('[luckStar]', e); this.destroy(); }
  }
  private size(): void {
    const k = Math.min(1, 1440 / innerHeight); // light: a 4K screen does not need four times the pixels
    const w = Math.round(innerWidth * k);
    const h = Math.round(innerHeight * k);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }
  /** Fly. `t0` is the take-off, on `performance.now`'s clock. */
  play(s: LuckScene, t0: number): void {
    const { gl } = this;
    if (!gl || !this.flare || this.dead) return;
    this.flying = true;
    const w = innerWidth;
    const h = innerHeight;
    this.size();
    this.canvas.className = 'gli-star';
    document.body.appendChild(this.canvas);
    const a = new Float32Array(N_A * 2);
    for (let i = 0; i < N_A; i++) { const p = luckPath(s, (s.times.burst * i) / (N_A - 1), h); a[i * 2] = p.x; a[i * 2 + 1] = p.y; }
    const b = new Float32Array(N_B * 2);
    for (let i = 0; i < N_B; i++) { const p = divePath(s, i / (N_B - 1), h); b[i * 2] = p.x; b[i * 2 + 1] = p.y; }
    const { start, end } = luckSpan(s);
    const { write, burst, gather, dive, land } = s.times;
    const times = new Float32Array([write, burst, gather, dive, land]);
    const progs = [this.ribbon, this.dust, this.flare];
    for (const pr of progs) {
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u('S'), w, h);
      gl.uniform1f(pr.u('px'), this.canvas.height / h);
      gl.uniform2fv(pr.u('A[0]'), a);
      gl.uniform2fv(pr.u('B[0]'), b);
      gl.uniform2f(pr.u('BC'), s.burst.x, s.burst.y);
      gl.uniform2f(pr.u('TO'), s.to.x, s.to.y);
      gl.uniform2f(pr.u('X'), start.x, end.x);
      gl.uniform1fv(pr.u('T[0]'), times);
      const col = (n: string, c: Rgb): void => gl.uniform3f(pr.u(n), ...c);
      col('COOL', this.loc?.cool ?? [0.5, 0.88, 1]);
      col('WARM', this.loc?.warm ?? [1, 0.78, 0.4]);
      col('SECOND', this.loc?.second ?? [0.1, 0.95, 0.85]);
    }
    gl.useProgram(this.dust.p);
    gl.uniform1f(this.dust.u('grown'), s.grown);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, s.glyphs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const n = s.glyphs.length / 2;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    const mode = this.dust.u('mode');
    const draw = (): void => {
      if (this.dead) return;
      const t = (performance.now() - t0) / 1000;
      if (t > land + LUCK_AFTER_S) { this.destroy(); return; }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.empty);
      gl.useProgram(this.ribbon.p);
      gl.uniform1f(this.ribbon.u('t'), t);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, RIB * 2, 6);
      gl.useProgram(this.dust.p);
      gl.uniform1f(this.dust.u('t'), t);
      gl.uniform1i(mode, 2);
      gl.drawArrays(gl.POINTS, 0, TAIL + EMBERS + LAND);
      gl.bindVertexArray(vao);
      if (t > write - 0.2 && t < burst + 0.6) { gl.uniform1i(mode, 0); gl.drawArrays(gl.POINTS, 0, n); }
      if (t > gather) { gl.uniform1i(mode, 1); gl.drawArrays(gl.POINTS, 0, n); }
      gl.bindVertexArray(this.empty);
      gl.useProgram(this.flare!.p);
      gl.uniform1f(this.flare!.u('t'), t);
      gl.drawArrays(gl.TRIANGLES, 0, 42);
      this.raf = requestAnimationFrame(draw);
    };
    draw();
  }
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}

/** About `count` points on the letters as they stand on screen (x, y pairs). Empty where a picture of them cannot be read. */
export function glyphPoints(els: readonly HTMLElement[], count: number): Float32Array {
  if (els.length === 0) return new Float32Array(0);
  const boxes = els.map((e) => e.getBoundingClientRect());
  const x0 = Math.min(...boxes.map((b) => b.left)) - 8;
  const y0 = Math.min(...boxes.map((b) => b.top));
  const w = Math.ceil((Math.max(...boxes.map((b) => b.right)) + 8 - x0) / 2);
  const h = Math.ceil((Math.max(...boxes.map((b) => b.bottom)) - y0) / 2);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w);
  cv.height = Math.max(1, h);
  let data: Uint8ClampedArray;
  try {
    const c = cv.getContext('2d', { willReadFrequently: true });
    if (!c) return new Float32Array(0);
    const cs = getComputedStyle(els[0]!);
    c.scale(0.5, 0.5);
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    els.forEach((e, i) => {
      const ch = e.textContent?.charAt(0) ?? '';
      const m = c.measureText(ch);
      const b = boxes[i]!;
      c.fillText(ch, b.left - x0, b.top - y0 + (b.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent);
    });
    data = c.getImageData(0, 0, cv.width, cv.height).data;
  } catch { return new Float32Array(0); }
  const on: number[] = [];
  for (let i = 3, p = 0; i < data.length; i += 4, p++) if (data[i]! > 120) on.push(p);
  const n = Math.min(count, on.length);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = on[Math.floor((((i * 0.618034) % 1) * on.length))]!; // spread evenly through them, the same every time
    out[i * 2] = x0 + (p % cv.width) * 2 + ((i * 7) % 3) * 0.6;
    out[i * 2 + 1] = y0 + Math.floor(p / cv.width) * 2 + ((i * 5) % 3) * 0.6;
  }
  return out;
}
