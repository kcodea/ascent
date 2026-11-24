/**
 * THE RIPPLE THROUGH HERO SELECT (owner + Mike 2026-11-24: "the ripple ... is the same ripple animations we have with the
 * parallax stuff, rippling out from the select hero button", "it's just there, with the custom portrait frame on";
 * R-LOCATION-05). One canvas, used twice:
 *
 *  - IN, from Select Hero: what the wave has passed IS the finished picture (the living place, the hero in their ring), bent
 *    by the water as it settles; what it has not reached yet is hero select, untouched. When it is over, the ceremony's own
 *    DOM (the same picture) takes over underneath.
 *  - AT START GAME (R-LOCATION-06, owner's pick: "Frame opens") the same picture holds the screen while the run is built, the
 *    camera pushing in on the hero; then they fade to the board behind them and their ring opens past the edges of the screen.
 *
 * One WebGL 2 canvas: the place drawn small into a picture (`Place`, on hero select's own clock), then one pass that bends
 * it, the hero's art and the ring together. Made ready while the player is choosing; with nothing ready (a phone, reduced
 * motion, no location) the ceremony and the launch curtain play as they always have.
 */
import { canRun } from './rippleSupport';
import { audioContext, fxBusTarget, isMuted } from '../sfx';
import { locationSound, type LocationDef } from './locations';
import { beginProgram, buffers, clockNow, compiled, finishProgram, nextFrame, Place, uploadTexture, type Prog } from './placeGl';
import * as SH from './revealShaders';
import { clamp } from './revealTimeline';

/** How long the wave takes to cross the whole screen (s), the reveal's own leaving wave. */
export const RIPPLE_S = 1.05;
/** The wave's reach at `t` seconds, `far` being its furthest corner (stage heights). Past every corner when it is over. */
export const rippleR = (t: number, far: number): number => {
  const x = clamp(t / RIPPLE_S);
  return x <= 0 ? -1 : (far + 0.42) * x * (0.55 + 0.45 * x * (2 - x));
};
/** When (s) its front reaches distance `r`. */
export const rippleReach = (r: number, far: number): number => {
  let lo = 0;
  let hi = RIPPLE_S;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (rippleR(m, far) < r) lo = m; else hi = m; }
  return hi;
};
/** The furthest corner from a point of a `w` x `h` stage, in stage heights. */
export const rippleFar = (x: number, y: number, w: number, h: number): number => Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([a, b]) => Math.hypot(a! - x, b! - y))) / h;
/** The second, softer ring follows this far behind. */
const ECHO_S = 0.16;
/** At Start Game the place falls still this fast: building the run stops every frame for a moment, and a picture that is already
 *  still shows nothing of it (s). */
export const STILL_S = 0.16;
/** The ring's opening (s), and how far into it the board is the player's (the lobby reveal goes on). */
export const OPEN_S = 0.82;
export const OPEN_FREE = 0.9;
/** How long the motes that came through it drift on over the board (s). */
export const DUST_S = 1.7;
/** The opening's curve at `x` (0..1): how many times its size the ring is, and how much of the hero is left in it. `K` is past every corner. */
export function openAt(x: number, K: number): { k: number; hero: number } {
  const dip = x < 0.22 ? 0.085 * Math.sin((Math.PI * x) / 0.22) : 0; // it draws in first
  const u = clamp((x - 0.16) / 0.84);
  const f = clamp((x - 0.08) / 0.4);
  return { k: 1 - dip + (K - 1) * u ** 2.9, hero: 1 - f * f * (3 - 2 * f) };
}
/** The camera from the press: back a touch, then in, and still going in for as long as the run takes. The browser runs it on its
 *  own, straight through the work that stops every frame. */
export const PUSH: { frames: Keyframe[]; opts: KeyframeAnimationOptions } = {
  frames: [
    { transform: 'scale(1)', easing: 'cubic-bezier(0.3, 0, 0.5, 1)' },
    { transform: 'scale(0.982)', offset: 0.045, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
    { transform: 'scale(1.115)', offset: 0.42, easing: 'linear' },
    { transform: 'scale(1.17)' },
  ],
  opts: { duration: 2400, fill: 'forwards' },
};
/** The rising charge is loudest here (s after the press), about when the frame opens. */
const CHARGE_END_S = 0.95;
const FADE_MS = 90;
const PLACE_ROWS = 720;

interface Box { left: number; top: number; width: number; height: number }
/** The finished picture, in stage px: exactly where the ceremony's DOM has it. */
export interface RippleScene {
  stage: { w: number; h: number };
  art: string;
  ring: string;
  /** The art's box, and the circle it is cut to. */
  box: Box;
  clip: { x: number; y: number; r: number };
  ringBox: Box;
  glow: { x: number; y: number; r: number };
}
export interface Point { x: number; y: number }

const VS = `${SH.common}
in vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;

const FS = `${SH.common}
out vec4 o; uniform vec2 R, S, C; uniform float rad, str, rad2, str2, mode, hero, artA, settle, openK, openH, openX, openT, glA, glS; uniform vec3 G, CC; uniform vec4 BX, RG; uniform sampler2D SC, ART, RING;
vec2 ring(vec2 p, float r, float R0, float S0, out float crest, out float trough){ float x = r - R0; float body = x > 0. ? exp(-pow(x * 11., 2.)) : exp(-pow(x * 6.2, 2.)); float rip = x < 0. ? sin(x * 38.) * exp(x * 6.) * .13 : 0.; crest = exp(-pow(x * 24., 2.)) + .30 * exp(-pow(x * 8., 2.)); trough = x < 0. ? exp(-pow((x + .13) * 10., 2.)) : 0.; return p / r * (body + rip) * S0; }
// the ceremony's own DOM, layer for layer: the ground and its veil, the scrim, the glow, the art in its circle, the ring
vec3 scene(vec2 v){
  vec3 c = texture(SC, vec2(v.x, 1. - v.y)).rgb; float y = v.y;
  float veil = y < .24 ? mix(.58, .24, y / .24) : y < .62 ? .24 : mix(.24, .74, (y - .62) / .38); c = mix(c, vec3(6., 12., 28.) / 255., clamp(veil, 0., 1.));
  c = mix(c, vec3(5., 10., 26.) / 255., .6);
  vec2 px = v * S; c = mix(c, vec3(196., 160., 92.) / 255., .26 * clamp(1. - length(px - G.xy) / G.z / .70, 0., 1.));
  if (hero < .5) return c;
  vec2 q = CC.xy + (px - CC.xy) / settle; float d = length(q - CC.xy) - CC.z, fw = S.y / R.y;
  float a = clamp(.5 - d / fw, 0., 1.);
  if (a > 0.) { vec2 w = (q - BX.xy) / BX.zw; float ba = BX.z / BX.w; vec2 k = artA > ba ? vec2(ba / artA, 1.) : vec2(1., artA / ba); vec4 art = texture(ART, .5 + (w - .5) * k); c = c * (1. - art.a * a) + art.rgb * a; }
  vec2 rq = (q - RG.xy) / RG.zw; if (all(greaterThan(rq, vec2(0.))) && all(lessThan(rq, vec2(1.)))) { vec4 g = texture(RING, rq); vec2 gd = q - CC.xy; g.rgb *= 1. + glS * pow(max(0., cos(atan(gd.y, gd.x) - glA)), 16.); c = c * (1. - g.a) + min(g.rgb, g.a * 1.25); }
  return c;
}
// START GAME: the ring opens; the board is behind the canvas, so what it shows is simply not drawn
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec4 opening(vec2 u){
  vec2 px = u * S, rel = px - CC.xy; float d = length(rel), Rk = CC.z * openK, fw = S.y / R.y, rush = openX * openX; vec2 dir = rel / max(d, 1.);
  vec3 sea = mix(mg(vec3(.45, .90, 1.)), mg(vec3(1., .86, .60)), .55), gold = mg(vec3(1., .84, .52)); float lit = smoothstep(0., .22, openX) * (1. - smoothstep(.74, 1., openX));
  float inside = clamp(.5 - (d - Rk) / (fw * 1.5), 0., 1.); vec4 o4 = vec4(0.);
  if (inside < 1.) { // the place goes past the camera: it turns, stretches into speed, and streaks
    vec3 c = vec3(0.); float z = 1. - .36 * pow(openX, 1.5), b = .02 + .30 * rush, j = h21(gl_FragCoord.xy); mat2 tw = rot(.11 * rush);
    for (int i = 0; i < 9; i++) { float w = z * (1. - b * (float(i) + j) / 9.); vec2 q = CC.xy + tw * rel * w; c += scene(q / S); }
    c /= 9.; c *= 1. + .35 * rush;
    float ln = n2(dir * 21.), st = pow(n2(vec2(ln * 46., log(d / CC.z + .2) * 1.7 - openT * 7.)), 4.) * smoothstep(.42, .85, ln); c += mix(sea, gold, .35) * st * 1.15 * smoothstep(.12, .6, openX) * (1. - smoothstep(.86, 1., openX));
    float spk = pow(n2(dir * 9. + openT * .7), 3.); c += sea * exp(-max(d - Rk, 0.) / (Rk * (.14 + .34 * spk))) * (.65 + 1.1 * spk) * lit;
    o4 = vec4(c, 1.);
  }
  if (inside > 0.) { // the hero turns to light, from the heart outward; behind them is the board, so it is simply not drawn
    float rr = d / Rk, gone = 1. - openH; vec2 sw = rot(gone * 1.5 * (1. - rr)) * rel / openK; vec2 w = (CC.xy + sw - BX.xy) / BX.zw; float ba = BX.z / BX.w; vec2 k = artA > ba ? vec2(ba / artA, 1.) : vec2(1., artA / ba); vec4 art = texture(ART, .5 + (w - .5) * k);
    float f = fb(sw / CC.z * 3.2 + 3.) * .62 + rr * .55, th = gone * 1.30 - .06, a = smoothstep(th - .015, th + .05, f), edge = exp(-pow((f - th - .015) * 17., 2.)) * step(.002, gone) * step(gone, .995), near_ = exp(-max(f - th, 0.) * 9.) * smoothstep(0., .12, gone);
    vec4 into = art * a; into.rgb += (gold * near_ * .55 + sea * .12 * gone) * into.a; into.rgb += mix(gold, vec3(1.), .45) * edge * 1.25; into.a = clamp(into.a + edge * .8, 0., 1.);
    float rim = exp(-max(Rk - d, 0.) / (Rk * .05)) * .95 + exp(-max(Rk - d, 0.) / (Rk * .22)) * .26; into.rgb += sea * rim * lit * .85; into.a = clamp(into.a + rim * lit * .45, 0., 1.);
    o4 = mix(o4, into, inside);
  }
  vec2 q2 = rot(-.34 * rush - .05 * sin(openX * 9.) * (1. - openX)) * rel / openK, rq = (CC.xy + q2 - RG.xy) / RG.zw;
  if (all(greaterThan(rq, vec2(0.))) && all(lessThan(rq, vec2(1.)))) { vec4 g = textureLod(RING, rq, 0.); float an = atan(q2.y, q2.x); g.rgb *= 1. + .45 * lit + 1.5 * lit * (pow(max(0., cos(an - openT * 15.)), 18.) + pow(max(0., cos(an - openT * 15. + 3.14)), 18.)); g.rgb = min(g.rgb, g.a * 1.35); o4 = o4 * (1. - g.a) + g; }
  // it goes past the camera: light along every edge of the screen
  vec2 eg = abs(u - .5) * 2.; o4.rgb += mix(sea, gold, .4) * (pow(eg.x, 7.) + pow(eg.y, 7.)) * exp(-pow((openX - .9) * 8.5, 2.)) * .55;
  return vec4(min(o4.rgb, 1.), o4.a);
}
void main(){
  vec2 u = gl_FragCoord.xy / R; u.y = 1. - u.y; if (mode > 1.5) { o = opening(u); return; } vec2 asp = vec2(S.x / S.y, 1.); vec2 p = (u - C) * asp; float r = length(p) + 1e-4, c1 = 0., t1 = 0., c2 = 0., t2 = 0.;
  vec2 ds = vec2(0.); if (str > .0004) ds += ring(p, r, rad, str, c1, t1); if (str2 > .0004) ds += ring(p, r, rad2, str2, c2, t2);
  vec2 v = C + (p - ds) / asp, ca = ds * .035 / asp;
  vec3 c = dot(ds, ds) > 1e-7 ? vec3(scene(v - ca).r, scene(v).g, scene(v + ca).b) : scene(v);
  vec3 sea = mix(mg(vec3(.45, .90, 1.)), mg(vec3(1., .86, .60)), .35);
  c += sea * (c1 * str * 8.5 + c2 * str2 * 9.) * (.30 + .95 * c); c *= 1. - clamp(t1 * str * 7. + t2 * str2 * 6., 0., .55);
  float e = r - rad + (n2(p * 11.) - .5) * .05, al = 1.; vec3 over = vec3(0.);
  if (mode > 0.) { // in: the picture is what the wave has passed
    al = 1. - smoothstep(-.05, .11, e); c += sea * .16 * exp(min(e, 0.) * 5.) * smoothstep(0., .03, str);
    over = sea * (exp(-pow((r - rad) * 10., 2.)) * .55 + exp(-pow((r - rad - .10) * 8., 2.)) * .14) * (1. - al);
  }
  o = vec4(clamp(c, 0., 1.) * al + over * smoothstep(0., .012, str), al);
}`;

// spray thrown off the front as it passes
const VD = `${SH.common}
uniform vec2 S, C; uniform float t, far, px, dur; out vec3 tint; out float al;
float front(float x){ x = clamp(x, 0., 1.); return (far + .42) * x * (.55 + .45 * x * (2. - x)); }
void main(){ float id = float(gl_VertexID), b = h11(id + .7) * .86 * dur, age = t - b, th = h11(id + 3.1) * TAU, life = .42 + .5 * h11(id + 9.3); float r = front(b / dur) + .13 * (1. - exp(-max(age, 0.) * 4.)) * (.3 + h11(id + 5.5));
  vec2 p = vec2(cos(th), sin(th)) * r + vec2(sin(age * 5. + id) * .012, cos(age * 4. + id * 1.7) * .012 - .03 * age * age); vec2 u = C + p / vec2(S.x / S.y, 1.); gl_Position = vec4(u.x * 2. - 1., 1. - u.y * 2., 0., 1.);
  float live = step(0., age) * smoothstep(0., .05, age) * smoothstep(life, life * .25, age); gl_PointSize = px * (2.2 + 7. * pow(h11(id + 1.9), 5.)) * 2.2; tint = mix(mix(mg(vec3(.50, .90, 1.)), SECOND, step(.75, h11(id + 2.2)) * .7), mg(vec3(1., .80, .48)), step(.6, h11(id + 8.8))); al = live * (.6 + .4 * sin(t * 13. + id)) * .75; }`;
const FD = `${SH.common}
in vec3 tint; in float al; out vec4 o; void main(){ float r = length(gl_PointCoord - .5) * 2.; o = vec4((tint * exp(-r * r * 6.) + exp(-r * r * 26.) * .6) * al, 0.); }`;
const SPRAY = 520;

// START GAME: sparks thrown off the ring as it comes, and the place's motes, that come through with it and drift down on the board
const VO = `${SH.common}
uniform vec2 S; uniform vec3 CC; uniform float t, dur, K, px; out vec3 tint; out float al;
float ringK(float x){ float dip = x < .22 ? .085 * sin(3.14159 * x / .22) : 0.; float u = clamp((x - .16) / .84, 0., 1.); return 1. - dip + (K - 1.) * pow(u, 2.9); }
void main(){ float id = float(gl_VertexID); vec2 p; float size;
  if (id < 340.) { float b = (.10 + .66 * h11(id + .7)) * dur, age = t - b, th = h11(id + 3.1) * TAU + age * .5, life = .30 + .34 * h11(id + 9.3); float r = CC.z * 1.10 * ringK(min(t, dur) / dur) + S.y * (.06 + .34 * h11(id + 5.5)) * age * (1. + 4. * age); p = CC.xy + vec2(cos(th), sin(th)) * r; size = (2.5 + 9. * pow(h11(id + 1.9), 4.)) * (1. + 2.4 * age); al = step(0., age) * smoothstep(0., .04, age) * smoothstep(life, life * .3, age) * .95; }
  else { float b = (.30 + .62 * h11(id + .7)) * dur, age = t - b, life = 1.0 + 1.0 * h11(id + 9.3); vec2 to = vec2(h11(id + 2.2), h11(id + 6.6)) * S, from = CC.xy + (to - CC.xy) * .35; float e = 1. - exp(-max(age, 0.) * 3.2); p = mix(from, to, e) + vec2(sin(age * 2.1 + id) * 16., age * age * 26. + sin(age * 3. + id * 1.7) * 7.) * (S.y / 1080.); size = 3. + 13. * pow(h11(id + 1.9), 3.); al = step(0., age) * smoothstep(0., .18, age) * smoothstep(life, life * .35, age) * (.55 + .45 * sin(t * (5. + 5. * h11(id)) + id)) * .85; }
  vec2 u = p / S; gl_Position = vec4(u.x * 2. - 1., 1. - u.y * 2., 0., 1.); gl_PointSize = px * size * 2.4; tint = mix(mix(mg(vec3(.50, .88, 1.)), SECOND, step(.72, h11(id + 2.7)) * .7), mg(vec3(1., .80, .42)), step(.5, h11(id + 8.8))); }`;
// over the board (which is bright) a mote has to carry some body of its own, not only light
const FDB = `${SH.common}
in vec3 tint; in float al; out vec4 o; void main(){ float r = length(gl_PointCoord - .5) * 2.; float g = exp(-r * r * 5.), c = exp(-r * r * 24.); o = vec4((tint * g + c * .85) * al, (g * .30 + c * .35) * al); }`;
const MOTES = 560;

type Mode = 'in' | 'hold' | 'open';

export class HeroRipple {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private place: Place;
  private main!: Prog;
  private spray!: Prog;
  private motes!: Prog;
  private empty!: WebGLVertexArrayObject;
  private fb: WebGLFramebuffer | null = null;
  private pic: WebGLTexture | null = null;
  private pw = 0;
  private ph = 0;
  private pics = new Map<string, { tex: WebGLTexture; aspect: number } | null>();
  private sounds = new Map<string, AudioBuffer>();
  private scene: RippleScene | null = null;
  private origin: Point = { x: 0, y: 0 };
  private mode: Mode = 'hold';
  private raf = 0;
  private t0 = 0;
  /** When (wall, ms) it was told to fall still, and its clock then. */
  private stillAt: { wall: number; s: number } | null = null;
  private onEnd: (() => void) | null = null;
  private onFree: (() => void) | null = null;
  private warmed = false;
  built = false;
  /** Taken by the launch: hero select's own unmount leaves it alone. */
  claimed = false;
  dead = false;

  constructor(readonly loc: LocationDef) {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: true, depth: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL 2');
    this.gl = gl;
    this.place = new Place(gl, loc);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.destroy(); });
    const ctx = audioContext();
    if (ctx) {
      for (const clip of ['wave', 'title', 'charge', 'gather', 'impact', 'weld']) {
        void fetch(locationSound(clip)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => ctx.decodeAudioData(b)).then((buf) => { this.sounds.set(clip, buf); }).catch(() => undefined);
      }
    }
  }

  async build(): Promise<void> {
    const { gl } = this;
    const dead = (): boolean => this.dead;
    if (!await this.place.build(dead)) return;
    const raw = [beginProgram(gl, VS, FS, ['a']), beginProgram(gl, VD, FD, []), beginProgram(gl, VO, FDB, [])];
    if (!await compiled(gl, raw, dead)) return;
    this.main = finishProgram(gl, raw[0]!);
    this.spray = finishProgram(gl, raw[1]!);
    this.motes = finishProgram(gl, raw[2]!);
    this.empty = buffers(gl, []);
    this.built = true;
  }

  /** The hero's art or their ring, decoded off the main thread and uploaded in its own frame (idempotent). */
  async add(url: string): Promise<void> {
    if (this.dead || this.pics.has(url)) return;
    this.pics.set(url, null);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const img = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
      await nextFrame();
      if (!this.dead) this.pics.set(url, { tex: uploadTexture(this.gl, img), aspect: img.width / Math.max(1, img.height) });
      img.close();
    } catch {
      this.pics.delete(url);
    }
  }
  /** Let go of every picture but these (and what is on screen): browsing every hero must not fill the GPU. */
  keep(urls: readonly string[]): void {
    for (const [url, pic] of this.pics) {
      if (urls.includes(url) || url === this.scene?.art || url === this.scene?.ring) continue;
      if (pic) this.gl.deleteTexture(pic.tex);
      if (pic) this.pics.delete(url);
    }
  }
  /** Draw it once, unseen, so nothing is set up under the player's press. */
  prewarm(art: string, ring: string): void {
    if (this.warmed || this.scene || !this.has(art) || !this.has(ring)) return;
    this.warmed = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const box = { left: 0, top: 0, width: 400, height: 400 };
    this.setScene({ stage: { w, h }, art, ring, box, clip: { x: 200, y: 200, r: 190 }, ringBox: box, glow: { x: 200, y: 200, r: 400 } });
    for (const m of ['hold', 'in', 'open'] as const) { this.mode = m; this.draw(0.4); }
    this.mode = 'hold';
  }
  has(url: string): boolean { return !!this.pics.get(url); }

  /** Put the canvas in `host` and give it the picture. */
  show(host: HTMLElement, scene: RippleScene, origin: Point): void {
    this.canvas.className = 'hsc-ripple';
    this.setScene(scene);
    this.origin = origin;
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
  }
  setScene(scene: RippleScene): void {
    this.scene = scene;
    const { w, h } = scene.stage;
    const H = Math.min(1440, Math.round(window.innerHeight * (window.devicePixelRatio || 1)));
    const W = Math.round((H * w) / h);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.place.frame(w, h);
    const ph = Math.min(PLACE_ROWS, H);
    const pw = Math.round((ph * w) / h);
    if (pw === this.pw && ph === this.ph) return;
    const { gl } = this;
    this.pw = pw;
    this.ph = ph;
    if (this.pic) gl.deleteTexture(this.pic);
    this.pic = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pic);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.fb ??= gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pic, 0);
  }

  /** The wave, from the point given to `show`. Resolves when it is over (or this is destroyed). */
  wave(): Promise<void> {
    this.mode = 'in';
    this.t0 = 0;
    this.sound('wave', { gain: 0.36, rate: 1.08, lowpass: 5200 });
    this.sound('title', { gain: 0.26, rate: 1.22, delay: 0.3 });
    return new Promise((resolve) => {
      this.onEnd = resolve;
      this.run();
    });
  }

  /** Start Game: take the screen with the same picture, and push in on the hero. Resolves when it covers. */
  hold(): Promise<void> {
    this.mode = 'hold';
    this.run();
    this.canvas.style.transformOrigin = this.heart();
    this.sound('charge', { gain: 0.42, rate: 0.95, reverse: true, end: CHARGE_END_S });
    this.sound('gather', { gain: 0.42, rate: 0.85, delay: 0.1 });
    this.canvas.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    this.canvas.animate?.(PUSH.frames, PUSH.opts);
    return new Promise((r) => { window.setTimeout(r, FADE_MS); });
  }
  /** The hero's middle, as a transform origin of a full-screen layer. */
  heart(): string {
    const sc = this.scene;
    return sc ? `${((sc.clip.x / sc.stage.w) * 100).toFixed(2)}% ${((sc.clip.y / sc.stage.h) * 100).toFixed(2)}%` : '50% 50%';
  }
  /** The ring opens onto what is under the canvas. `onFree` when the board is the player's. Resolves when it is past the screen. */
  open(onFree: () => void): Promise<void> {
    this.mode = 'open';
    this.t0 = 0;
    this.onFree = onFree;
    this.sound('impact', { gain: 0.5, rate: 1.12, delay: 0.1 });
    this.sound('weld', { gain: 0.4, rate: 1.1, delay: OPEN_S * 0.55 });
    this.sound('title', { gain: 0.3, rate: 1.16, delay: OPEN_S * 0.8 });
    return new Promise((resolve) => {
      this.onEnd = resolve;
      this.run();
    });
  }

  /** Let the place fall still (see STILL_S). */
  still(): void { this.stillAt ??= { wall: performance.now(), s: clockNow() }; }
  /** Its clock: hero select's own, until it falls still. */
  private now(): number {
    const st = this.stillAt;
    if (!st) return clockNow();
    const x = clamp((performance.now() - st.wall) / 1000 / STILL_S);
    return st.s + STILL_S * (x - x * x / 2);
  }

  /** Fade the canvas off what is under it, and stop. */
  fadeOff(ms = FADE_MS): Promise<void> {
    return new Promise((resolve) => {
      const end = (): void => { this.rest(); resolve(); };
      const a = this.canvas.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
      if (!a) { end(); return; }
      window.setTimeout(() => { end(); a.cancel(); }, ms);
    });
  }

  /** Off the screen, kept ready. */
  rest(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.remove();
    const end = this.onEnd;
    this.onEnd = null;
    end?.();
  }

  private run(): void {
    if (this.raf || this.dead) return;
    const tick = (now: number): void => {
      this.raf = requestAnimationFrame(tick);
      if (!this.t0) this.t0 = now;
      const t = (now - this.t0) / 1000;
      this.draw(t);
      if (this.mode === 'open' && t >= OPEN_S * OPEN_FREE) { const free = this.onFree; this.onFree = null; free?.(); }
      if (this.mode !== 'hold' && t >= (this.mode === 'open' ? OPEN_S + DUST_S : RIPPLE_S + ECHO_S)) {
        if (this.mode === 'open') { this.rest(); return; }
        const end = this.onEnd;
        this.onEnd = null;
        end?.();
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw(t: number): void {
    const { gl, scene: sc } = this;
    const art = sc && this.pics.get(sc.art);
    const ring = sc && this.pics.get(sc.ring);
    if (!sc || !art || !ring || this.dead) return;
    if (this.mode === 'open' && t >= OPEN_S) { this.drawMotes(t, sc, true); return; } // the ring is gone: only what came through it
    const { w: sw, h: sh } = sc.stage;
    const { width: W, height: H } = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.place.draw(this.pw, this.ph, 1, this.now());
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    const C: Point = { x: this.origin.x / sw, y: this.origin.y / sh };
    const far = rippleFar(this.origin.x, this.origin.y, sw, sh);
    const moving = this.mode === 'in';
    const x = clamp(t / RIPPLE_S);
    const x2 = clamp((t - ECHO_S) / RIPPLE_S);
    const swell = (v: number): number => Math.sin(Math.PI * Math.min(1, v * 1.02)) ** 0.6 || 0;
    const { u, p } = this.main;
    gl.useProgram(p);
    gl.uniform2f(u('R'), W, H);
    gl.uniform2f(u('S'), sw, sh);
    gl.uniform2f(u('C'), C.x, C.y);
    gl.uniform1f(u('mode'), moving ? 1 : this.mode === 'open' ? 2 : 0);
    gl.uniform1f(u('hero'), this.mode === 'open' ? 0 : 1);
    if (this.mode === 'open') {
      const xo = clamp(t / OPEN_S);
      const ow = openAt(xo, this.openTo(sc));
      gl.uniform1f(u('openK'), ow.k);
      gl.uniform1f(u('openH'), ow.hero);
      gl.uniform1f(u('openX'), xo);
      gl.uniform1f(u('openT'), t);
    }
    gl.uniform1f(u('rad'), moving ? rippleR(t, far) : -1);
    gl.uniform1f(u('str'), moving && x > 0 && x < 1 ? 0.062 * swell(x) : 0);
    gl.uniform1f(u('rad2'), rippleR(t - ECHO_S, far));
    gl.uniform1f(u('str2'), moving && x2 > 0 && x2 < 1 ? 0.026 * swell(x2) : 0);
    // The pick: the hero springs into their frame as the wave comes through, and a glint runs once round it.
    const sp = Math.max(0, t - 0.2);
    gl.uniform1f(u('settle'), moving ? 1 + 0.1 * Math.exp(-sp * 5.2) * Math.cos(sp * 9.5) : 1);
    gl.uniform1f(u('glA'), t * 8.2 - 2.4);
    gl.uniform1f(u('glS'), moving ? 1.5 * Math.min(1, Math.max(0, (t - 0.3) / 0.12)) * Math.min(1, Math.max(0, (RIPPLE_S + 0.1 - t) / 0.2)) : 0);
    gl.uniform1f(u('artA'), art.aspect);
    gl.uniform3f(u('G'), sc.glow.x, sc.glow.y, sc.glow.r);
    gl.uniform3f(u('CC'), sc.clip.x, sc.clip.y, sc.clip.r);
    gl.uniform4f(u('BX'), sc.box.left, sc.box.top, sc.box.width, sc.box.height);
    gl.uniform4f(u('RG'), sc.ringBox.left, sc.ringBox.top, sc.ringBox.width, sc.ringBox.height);
    this.magic(this.main);
    [['SC', this.pic], ['ART', art.tex], ['RING', ring.tex]].forEach(([n, tex], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex as WebGLTexture); gl.uniform1i(u(n as string), i); });
    gl.bindVertexArray(this.place.full);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.mode === 'open') this.drawMotes(t, sc, false);
    if (!moving) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const d = this.spray;
    gl.useProgram(d.p);
    gl.uniform2f(d.u('S'), sw, sh);
    gl.uniform2f(d.u('C'), C.x, C.y);
    gl.uniform1f(d.u('t'), t);
    gl.uniform1f(d.u('far'), far);
    gl.uniform1f(d.u('dur'), RIPPLE_S);
    gl.uniform1f(d.u('px'), H / 1080);
    gl.uniform3f(d.u('SECOND'), ...this.loc.second);
    this.magic(d);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.POINTS, 0, SPRAY);
  }
  private drawMotes(t: number, sc: RippleScene, alone: boolean): void {
    const { gl } = this;
    const { width: W, height: H } = this.canvas;
    if (alone) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const m = this.motes;
    gl.useProgram(m.p);
    gl.uniform2f(m.u('S'), sc.stage.w, sc.stage.h);
    gl.uniform3f(m.u('CC'), sc.clip.x, sc.clip.y, sc.clip.r);
    gl.uniform1f(m.u('t'), t);
    gl.uniform1f(m.u('dur'), OPEN_S);
    gl.uniform1f(m.u('K'), this.openTo(sc));
    gl.uniform1f(m.u('px'), H / 1080);
    gl.uniform3f(m.u('SECOND'), ...this.loc.second);
    this.magic(m);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.POINTS, 0, MOTES);
  }
  /** How many times its size the ring must be to be past every corner. */
  private openTo(sc: RippleScene): number { return (rippleFar(sc.clip.x, sc.clip.y, sc.stage.w, sc.stage.h) * sc.stage.h * 1.16) / sc.clip.r; }
  private magic(pr: Prog): void {
    const { gl, loc } = this;
    gl.uniform1f(pr.u('MGK'), loc.cool ? 1 : 0);
    if (loc.cool) gl.uniform3f(pr.u('COOL'), ...loc.cool);
    if (loc.warm) gl.uniform3f(pr.u('WARMC'), ...loc.warm);
  }

  /** One cue. Sound never gets in the way of the picture: whatever goes wrong, it is simply silent. */
  private sound(clip: string, o: Parameters<HeroRipple['cue']>[1]): void {
    try { this.cue(clip, o); } catch (e) { console.warn('[heroRipple] sound', e); }
  }
  private cue(clip: string, o: { gain: number; rate: number; lowpass?: number; delay?: number; reverse?: boolean; end?: number }): void {
    const ctx = audioContext();
    const buf = this.sounds.get(clip);
    const out = ctx && fxBusTarget(ctx, 'ui');
    if (!ctx || !buf || !out || isMuted()) return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    let play = buf;
    if (o.reverse) {
      const back = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) back.copyToChannel(Float32Array.from(buf.getChannelData(c)).reverse(), c);
      play = back;
    }
    src.buffer = play;
    src.playbackRate.value = o.rate;
    gain.gain.value = o.gain;
    let tail: AudioNode = gain;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      gain.connect(f);
      tail = f;
    }
    src.connect(gain);
    tail.connect(out);
    // `end`: the moment its last sound should fall (it starts part way in when it is longer than that).
    const len = buf.duration / o.rate;
    const lead = o.end === undefined ? 0 : o.end - len;
    src.start(ctx.currentTime + (o.delay ?? 0) + Math.max(0, lead), Math.max(0, -lead) * o.rate);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.rest();
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
  }
}

let warm: HeroRipple | null = null;
/** The pictures asked for before it was there (the hero on screen, the ring). */
let wanted: string[] = [];

async function fill(r: HeroRipple): Promise<void> {
  for (const u of wanted) await r.add(u);
  await nextFrame();
  if (!r.dead && wanted.length > 1) r.prewarm(wanted[0]!, wanted[1]!);
}

/** Make it ready while the player chooses (idempotent). */
export function warmRipple(loc: LocationDef): void {
  if (!canRun() || (warm && !warm.dead && warm.loc.id === loc.id)) return;
  if (warm && !warm.claimed) warm.destroy();
  try {
    const r = new HeroRipple(loc);
    warm = r;
    void r.build().then(() => fill(r)).catch((err) => { console.warn('[heroRipple] the ceremony plays as before', err); r.destroy(); });
  } catch { warm = null; }
}

/** The hero being looked at, and the player's ring: ready before Select Hero is pressed. */
export function primeRipple(urls: readonly (string | undefined)[]): void {
  wanted = urls.filter((u): u is string => !!u);
  const r = warm;
  r?.keep(wanted);
  if (r?.built) void fill(r);
}

/** The ripple, if it can be played right now with these pictures. */
export function readyRipple(art: string | undefined, ring: string): HeroRipple | null {
  return warm && warm.built && !warm.dead && !!art && warm.has(art) && warm.has(ring) ? warm : null;
}

/** Hero select is gone: let go of it, unless the launch has it. */
export function dropRipple(): void {
  if (warm && !warm.claimed) { warm.destroy(); warm = null; }
}

/** The launch takes it over (hero select unmounts under it). */
export function claimRipple(r: HeroRipple): void { r.claimed = true; }
/** The launch is over. */
export function releaseRipple(r: HeroRipple): void {
  r.destroy();
  if (warm === r) warm = null;
}
