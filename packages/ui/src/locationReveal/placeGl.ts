/**
 * THE LIVING PLACE: a location's blurred painting with its mist, sway, water, flicker, motes and lean, drawn into whatever
 * framebuffer is bound. Hero select's ground (atmosphereGl.ts) is one; the hero pick's ripple (heroRipple.ts) draws the same
 * place, on the same clock, into a picture it can bend.
 */
import { fourOf, locationArt, type LocationDef } from './locations';
import { showOf, slideFor } from './revealGl';
import * as SH from './revealShaders';
import { A } from './revealTimeline';

/** The lean, in stage heights for a thing at depth 1 (the nearest are at 0.25, so about 8 px on a 1080p window). */
export const LEAN = { x: 0.03, y: 0.016, push: 0.016 } as const;
/** Where the camera is at `t` seconds: slow loops that never repeat together, so it breathes and never swings. */
export function leanAt(t: number): { x: number; y: number; push: number } {
  return {
    x: LEAN.x * (0.7 * Math.sin(t * 0.23) + 0.3 * Math.sin(t * 0.41 + 1.3)),
    y: LEAN.y * (0.7 * Math.sin(t * 0.19 + 2.1) + 0.3 * Math.sin(t * 0.37)),
    push: LEAN.push * (0.5 - 0.5 * Math.cos(t * 0.15)),
  };
}

const VS = `${SH.common}
in vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;

const FS = `${SH.common}
out vec4 o; uniform vec2 R, SHOW, pan; uniform float s, push, warmth, live; uniform sampler2D BL, DT;
${SH.water}
${SH.energy}
const float NEAR = .25;
vec2 at(vec2 rel, float dep, float k){ return VP - OFS + (rel * .962 - pan * dep) / (1. + dep * k); }
void main(){
  vec2 p = gl_FragCoord.xy / R; p.y = 1. - p.y; vec2 uv = .5 + (p - .5) * SHOW, rel = uv - VP;
  // softened depth: the ground is blurred, so the lean must never show a hard edge
  float dep = NEAR * textureLod(DT, uv - OFS, 3.).r; vec2 q = at(rel, dep, push); dep = NEAR * textureLod(DT, q, 3.).r; q = at(rel, dep, push);
  float n = textureLod(DT, q, 2.).g, gust = .35 + .65 * smoothstep(.35, .75, n2(vec2(q.x * 2.2 - s * .16, q.y + s * .05)));
  q += n * vec2(sin(q.y * 11. + s * 1.7 + q.x * 6.), .4 * cos(q.x * 10. + s * 1.4)) * .0030 * gust;
  // the water is behind the blur like everything here: its own edges as soft as the picture's, its movement broad
  vec3 wm = textureLod(WT, q, 4.).rgb * .55 + textureLod(WT, q, 5.).rgb * .45; wm.b = textureLod(WT, q, 3.).b; vec3 c = wetSoft(texture(BL, q + ripple(q, wm.g, s) * 1.2).rgb, q, wm, s, .6 * live);
  // a barrier of light, out of focus: its breath and its slow pulses
  if (EN > .5) { float e = textureLod(DT, q, 3.).b * live; if (e > .01) { float p = textureLod(DT, q, 4.).b * pulse(q, s * .7, 1.9); float f = fb(q * vec2(11., 5.) + vec2(s * .05, -s * .09)); c += (c * .5 + vec3(.06, .16, .30)) * (p * .34 + smoothstep(.4, .8, f) * .26) * e; } }
  float low = smoothstep(.2, 1., uv.y);
  for (int i = 0; i < 2; i++) { float fi = float(i); vec2 m = uv - pan * (.06 + fi * .10); float h = n2(m * vec2(3.2, 5.) + vec2(s * (.06 + fi * .03) + fi * 9., -s * .02)) * .6 + n2(m * vec2(7., 10.) + vec2(s * .10, fi * 5.)) * .4; c += mg(vec3(.62, .80, 1.)) * smoothstep(.42, .85, h) * (.13 - fi * .04) * (.35 + .65 * low) * live; }
  // motes, out of focus like everything else here
  vec3 e = vec3(0.);
  for (int k = 0; k < 4; k++) {
    float fk = float(k), g = 4.5 + fk * 3.2, ed = .30 - fk * .07; vec2 uq = VP + (uv - VP - pan * ed) / (1. + ed * push); vec2 w = uq * vec2(A, 1.) * g + vec2(sin(s * .5 + fk) * .4, s * (.34 + fk * .11)); vec2 id = floor(w); float h = h21(id + fk * 31.); if (h < .78) continue;
    vec2 d = fract(w) - .5 - (h22(id + 3.) - .5) * .55; float tw = .55 + .45 * sin(s * (1.6 + h * 3.) + h * 40.), sz = mix(.030, .075, h21(id + 17.)), r = length(d);
    e += mix(mg(vec3(.50, .85, 1.)), vec3(1., .66, .28), step(1. - .2 * warmth - .02, h)) * (smoothstep(sz, sz * .35, r) * .34 + exp(-r / (sz * 1.4)) * .10) * smoothstep(.48, .30, r) * tw;
  }
  c += e * .9 * live;
  o = vec4(c + (h21(gl_FragCoord.xy + fract(s)) - .5) / 220., 1.);
}`;

const VL = `${SH.common}
in vec4 lp; in vec3 lc; uniform vec2 pan, SHOW; uniform float s, push, px, live; out vec3 tint; out float al;
void main(){ vec2 rel = lp.xy + OFS - VP; vec2 p = VP + (rel * (1. + lp.w * push) + pan * lp.w) / .962; p = .5 + (p - .5) / SHOW; gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.); float seed = fract(lp.x * 71.3 + lp.y * 37.1);
  float fl = .80 + .13 * sin(s * (2.6 + 1.6 * seed) + seed * 40.) + .07 * sin(s * (5.8 + 2.4 * seed) + seed * 11.); gl_PointSize = px * lp.z * 124. * (.94 + .06 * fl); tint = lc; al = fl * .24 * live; }`;
const FL = `${SH.common}
in vec3 tint; in float al; out vec4 o; void main(){ float r = length(gl_PointCoord - .5) * 2.; o = vec4(tint * exp(-r * r * 4.5) * smoothstep(1., .7, r) * al, 1.); }`;

export interface Prog { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null }

export const nextFrame = (): Promise<void> => new Promise((r) => {
  let done = false;
  const go = (): void => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 120); // a hidden tab runs no frames
});

/** The ground's clock: the reveal hands over its own, so the mist carries straight on. */
let clock0: number | null = null;
export function syncAtmosphere(s: number): void { clock0 = performance.now() / 1000 - s; }
export function clockNow(): number {
  if (clock0 === null) syncAtmosphere(0);
  return performance.now() / 1000 - clock0!;
}

/** Hand a program's shaders to the driver (collected later by `finishProgram`, once it has compiled them). */
export function beginProgram(gl: WebGL2RenderingContext, vs: string, fs: string, attrs: string[]): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, `#version 300 es\n${src}`);
    gl.compileShader(sh);
    gl.attachShader(p, sh);
  }
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  return p;
}
export function finishProgram(gl: WebGL2RenderingContext, p: WebGLProgram): Prog {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${gl.getProgramInfoLog(p)} ${(gl.getAttachedShaders(p) ?? []).map((x) => gl.getShaderInfoLog(x)).join(' ')}`);
  const m = new Map<string, WebGLUniformLocation | null>();
  return { p, u: (n) => { if (!m.has(n)) m.set(n, gl.getUniformLocation(p, n)); return m.get(n)!; } };
}
/** Wait until the driver has compiled them (a step a frame). False = `dead` meanwhile. */
export async function compiled(gl: WebGL2RenderingContext, programs: WebGLProgram[], dead: () => boolean): Promise<boolean> {
  const ext = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  for (let i = 0; ext && i < 120 && !programs.every((p) => gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR) as boolean); i++) {
    await nextFrame();
    if (dead()) return false;
  }
  await nextFrame();
  return !dead();
}
/** A picture as a texture. `wrap` absent = clamped. */
export function uploadTexture(gl: WebGL2RenderingContext, img: TexImageSource, wrap?: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, w, wrap ?? gl.CLAMP_TO_EDGE);
  return t;
}
export function buffers(gl: WebGL2RenderingContext, bufs: [Float32Array, number][]): WebGLVertexArrayObject {
  const v = gl.createVertexArray()!;
  gl.bindVertexArray(v);
  bufs.forEach(([d, n], i) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0);
  });
  return v;
}

export class Place {
  private main!: Prog;
  private light!: Prog;
  full!: WebGLVertexArrayObject;
  private dots!: WebGLVertexArrayObject;
  private tex: WebGLTexture[] = [];
  private show: readonly [number, number] = [1, 1];
  private ofs: readonly [number, number] = [0, 0];

  private readonly hearts: Float32Array;

  constructor(private gl: WebGL2RenderingContext, readonly loc: LocationDef) { this.hearts = fourOf(loc.energy); }

  /** A step a frame, off the player's way. False = `dead` meanwhile. */
  async build(dead: () => boolean): Promise<boolean> {
    const gl = this.gl;
    const raw = [beginProgram(gl, VS, FS, ['a']), beginProgram(gl, VL, FL, ['lp', 'lc'])];
    if (!await compiled(gl, raw, dead)) return false;
    this.main = finishProgram(gl, raw[0]!);
    this.light = finishProgram(gl, raw[1]!);
    this.full = buffers(gl, [[new Float32Array([-1, -1, 3, -1, -1, 3]), 2]]);
    const L = this.loc.lights;
    this.dots = buffers(gl, [[new Float32Array(L.flatMap((q) => q.slice(0, 4))), 4], [new Float32Array(L.flatMap((q) => q.slice(4))), 3]]);
    for (const f of ['blur', 'data', 'water']) {
      const res = await fetch(locationArt(this.loc.id, f));
      if (!res.ok) throw new Error(`${f} ${res.status}`);
      const img = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      await nextFrame();
      if (dead()) { img.close(); return false; }
      this.tex.push(uploadTexture(gl, img, gl.MIRRORED_REPEAT));
      img.close();
    }
    return true;
  }

  /** The window's size (layout px): which part of the painting it shows. */
  frame(w: number, h: number): void {
    this.show = showOf(w, h);
    this.ofs = slideFor(this.loc, w, h);
  }

  /** Draw it, `W` x `H` pixels. `live` 0..1 brings its movement in from the still picture. */
  draw(W: number, H: number, live: number, s = clockNow()): void {
    const { gl, loc } = this;
    const { x, y, push } = leanAt(s);
    gl.viewport(0, 0, W, H);
    for (const pr of [this.main, this.light]) {
      const u = pr.u;
      gl.useProgram(pr.p);
      gl.uniform2f(u('VP'), loc.vp[0] + this.ofs[0], loc.vp[1] + this.ofs[1]);
      gl.uniform2f(u('OFS'), this.ofs[0], this.ofs[1]);
      gl.uniform2f(u('SHOW'), this.show[0], this.show[1]);
      gl.uniform2f(u('pan'), x / A, y);
      gl.uniform1f(u('s'), s % 3600);
      gl.uniform1f(u('push'), push);
      gl.uniform1f(u('live'), live);
      if (pr === this.main) {
        gl.disable(gl.BLEND);
        gl.uniform2f(u('R'), W, H);
        gl.uniform1f(u('warmth'), loc.warmth);
        gl.uniform1f(u('EN'), loc.energy ? 1 : 0);
        gl.uniform4fv(u('EC[0]'), this.hearts);
        gl.uniform1f(u('MGK'), loc.cool ? 1 : 0);
        if (loc.cool) gl.uniform3f(u('COOL'), ...loc.cool);
        if (loc.warm) gl.uniform3f(u('WARMC'), ...loc.warm);
        ['BL', 'DT', 'WT'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[i]!); gl.uniform1i(u(n), i); });
        gl.bindVertexArray(this.full);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform1f(u('px'), H / this.show[1] / 1080);
        gl.bindVertexArray(this.dots);
        gl.drawArrays(gl.POINTS, 0, loc.lights.length);
      }
    }
  }
}
