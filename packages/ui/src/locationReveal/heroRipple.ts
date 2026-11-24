/**
 * THE RIPPLE THROUGH HERO SELECT (owner + Mike 2026-11-24: "the ripple ... is the same ripple animations we have with the
 * parallax stuff, rippling out from the select hero button", "it's just there, with the custom portrait frame on";
 * R-LOCATION-05). One wave, the reveal's own lens, used twice:
 *
 *  - IN, from Select Hero: what the wave has passed IS the finished picture (the living place, the hero in their ring), bent
 *    by the water as it settles; what it has not reached yet is hero select, untouched. When it is over, the ceremony's own
 *    DOM (the same picture) takes over underneath.
 *  - OUT, from Start Game: the same picture covers the screen, alive, while the run is built under it; then the wave spreads
 *    from the button and the board is behind it.
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
import { clamp, seg } from './revealTimeline';

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
/** Launch: how long the scene draws its breath before the wave may leave (s). */
export const BRACE_S = 0.34;
/** ...and how long it then takes to fall still, before the run is built under it: that work stops every frame for a moment, and
 *  a picture that is already still shows nothing of it (s). */
export const STILL_S = 0.2;
const FADE_MS = 140;
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
out vec4 o; uniform vec2 R, S, C; uniform float rad, str, rad2, str2, mode, t, brace, artA, settle; uniform vec3 G, CC; uniform vec4 BX, RG; uniform sampler2D SC, ART, RING;
vec2 ring(vec2 p, float r, float R0, float S0, out float crest, out float trough){ float x = r - R0; float body = x > 0. ? exp(-pow(x * 11., 2.)) : exp(-pow(x * 6.2, 2.)); float rip = x < 0. ? sin(x * 38.) * exp(x * 6.) * .13 : 0.; crest = exp(-pow(x * 24., 2.)) + .30 * exp(-pow(x * 8., 2.)); trough = x < 0. ? exp(-pow((x + .13) * 10., 2.)) : 0.; return p / r * (body + rip) * S0; }
// the ceremony's own DOM, layer for layer: the ground and its veil, the scrim, the glow, the art in its circle, the ring
vec3 scene(vec2 v){
  vec3 c = texture(SC, vec2(v.x, 1. - v.y)).rgb; float y = v.y;
  float veil = y < .24 ? mix(.58, .24, y / .24) : y < .62 ? .24 : mix(.24, .74, (y - .62) / .38); c = mix(c, vec3(6., 12., 28.) / 255., clamp(veil, 0., 1.));
  c = mix(c, vec3(5., 10., 26.) / 255., .6);
  vec2 px = v * S; c = mix(c, vec3(196., 160., 92.) / 255., .26 * clamp(1. - length(px - G.xy) / G.z / .70, 0., 1.));
  vec2 q = CC.xy + (px - CC.xy) / settle; float d = length(q - CC.xy) - CC.z, fw = S.y / R.y;
  float a = clamp(.5 - d / fw, 0., 1.);
  if (a > 0.) { vec2 w = (q - BX.xy) / BX.zw; float ba = BX.z / BX.w; vec2 k = artA > ba ? vec2(ba / artA, 1.) : vec2(1., artA / ba); vec4 art = texture(ART, .5 + (w - .5) * k); c = c * (1. - art.a * a) + art.rgb * a; }
  vec2 rq = (q - RG.xy) / RG.zw; if (all(greaterThan(rq, vec2(0.))) && all(lessThan(rq, vec2(1.)))) { vec4 g = texture(RING, rq); c = c * (1. - g.a) + g.rgb; }
  float flare = brace * exp(-pow(d / (CC.z * .16), 2.)); c += mix(mg(vec3(.50, .88, 1.)), mg(vec3(1., .84, .55)), .5) * flare * .40;
  return c;
}
void main(){
  vec2 u = gl_FragCoord.xy / R; u.y = 1. - u.y; vec2 asp = vec2(S.x / S.y, 1.); vec2 p = (u - C) * asp; float r = length(p) + 1e-4, c1 = 0., t1 = 0., c2 = 0., t2 = 0.;
  vec2 ds = vec2(0.); if (str > .0004) ds += ring(p, r, rad, str, c1, t1); if (str2 > .0004) ds += ring(p, r, rad2, str2, c2, t2);
  float pull = brace * .020; vec2 v = C + (p * (1. + pull * exp(-r * 1.2)) - ds) / asp, ca = ds * .035 / asp;
  vec3 c = dot(ds, ds) > 1e-7 ? vec3(scene(v - ca).r, scene(v).g, scene(v + ca).b) : scene(v);
  vec3 sea = mix(mg(vec3(.45, .90, 1.)), mg(vec3(1., .86, .60)), .35);
  c += sea * (c1 * str * 8.5 + c2 * str2 * 9.) * (.30 + .95 * c); c *= 1. - clamp(t1 * str * 7. + t2 * str2 * 6., 0., .55);
  float e = r - rad + (n2(p * 11.) - .5) * .05, al = 1.; vec3 over = vec3(0.);
  if (mode > 0.) { // in: the picture is what the wave has passed
    al = 1. - smoothstep(-.05, .11, e); c += sea * .16 * exp(min(e, 0.) * 5.) * smoothstep(0., .03, str);
    over = sea * (exp(-pow((r - rad) * 10., 2.)) * .55 + exp(-pow((r - rad - .10) * 8., 2.)) * .14) * (1. - al);
  } else if (mode < 0.) { // out: the picture is what it has not reached
    al = smoothstep(-.11, .05, e); over = sea * (exp(-pow((r - rad) * 10., 2.)) * .55 + exp(-pow((r - rad + .16) * 7., 2.)) * .16) * (1. - al);
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

type Mode = 'in' | 'hold' | 'out';

export class HeroRipple {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private place: Place;
  private main!: Prog;
  private spray!: Prog;
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
  private braceAt = 0;
  /** When (wall, ms) it was told to fall still, and its clock then. */
  private stillAt: { wall: number; s: number } | null = null;
  private onEnd: (() => void) | null = null;
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
      for (const clip of ['wave', 'title']) {
        void fetch(locationSound(clip)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => ctx.decodeAudioData(b)).then((buf) => { this.sounds.set(clip, buf); }).catch(() => undefined);
      }
    }
  }

  async build(): Promise<void> {
    const { gl } = this;
    const dead = (): boolean => this.dead;
    if (!await this.place.build(dead)) return;
    const raw = [beginProgram(gl, VS, FS, ['a']), beginProgram(gl, VD, FD, [])];
    if (!await compiled(gl, raw, dead)) return;
    this.main = finishProgram(gl, raw[0]!);
    this.spray = finishProgram(gl, raw[1]!);
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
    for (const m of ['hold', 'in', 'out'] as const) { this.mode = m; this.draw(0.4, performance.now()); }
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
  wave(mode: 'in' | 'out', origin: Point = this.origin): Promise<void> {
    this.origin = origin;
    this.mode = mode;
    this.t0 = 0;
    this.sound('wave', { gain: 0.36, rate: mode === 'in' ? 1.08 : 1, lowpass: 5200 });
    this.sound('title', { gain: 0.26, rate: mode === 'in' ? 1.22 : 1.1, delay: 0.3 });
    return new Promise((resolve) => {
      this.onEnd = resolve;
      this.run();
    });
  }

  /** Cover the screen with the living picture and draw a breath (launch). Resolves when it has been drawn. */
  hold(): Promise<void> {
    this.mode = 'hold';
    this.braceAt = performance.now();
    this.canvas.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    this.run();
    return new Promise((r) => { window.setTimeout(r, BRACE_S * 1000); });
  }

  /** Let the place fall still (see STILL_S). Resolves when it has. */
  still(): Promise<void> {
    this.stillAt ??= { wall: performance.now(), s: clockNow() };
    return new Promise((r) => { window.setTimeout(r, STILL_S * 1000); });
  }
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
      this.draw(t, now);
      if (this.mode !== 'hold' && t >= RIPPLE_S + ECHO_S) {
        if (this.mode === 'out') { cancelAnimationFrame(this.raf); this.raf = 0; }
        const end = this.onEnd;
        this.onEnd = null;
        end?.();
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw(t: number, now: number): void {
    const { gl, scene: sc } = this;
    const art = sc && this.pics.get(sc.art);
    const ring = sc && this.pics.get(sc.ring);
    if (!sc || !art || !ring || this.dead) return;
    const { w: sw, h: sh } = sc.stage;
    const { width: W, height: H } = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.place.draw(this.pw, this.ph, 1, this.now());
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    const C: Point = { x: this.origin.x / sw, y: this.origin.y / sh };
    const far = rippleFar(this.origin.x, this.origin.y, sw, sh);
    const moving = this.mode !== 'hold';
    const x = clamp(t / RIPPLE_S);
    const x2 = clamp((t - ECHO_S) / RIPPLE_S);
    const swell = (v: number): number => Math.sin(Math.PI * Math.min(1, v * 1.02)) ** 0.6 || 0;
    const { u, p } = this.main;
    gl.useProgram(p);
    gl.uniform2f(u('R'), W, H);
    gl.uniform2f(u('S'), sw, sh);
    gl.uniform2f(u('C'), C.x, C.y);
    gl.uniform1f(u('mode'), !moving ? 0 : this.mode === 'in' ? 1 : -1);
    gl.uniform1f(u('rad'), moving ? rippleR(t, far) : -1);
    gl.uniform1f(u('str'), moving && x > 0 && x < 1 ? 0.062 * swell(x) : 0);
    gl.uniform1f(u('rad2'), rippleR(t - ECHO_S, far));
    gl.uniform1f(u('str2'), moving && x2 > 0 && x2 < 1 ? 0.026 * swell(x2) : 0);
    const held = (now - this.braceAt) / 1000;
    gl.uniform1f(u('brace'), this.mode === 'in' ? 0 : this.mode === 'hold' ? seg(held, 0.04, BRACE_S) ** 2 * (this.stillAt ? 1 : 0.85 + 0.15 * Math.cos((held - BRACE_S) * 2.2)) : 1 - x);
    gl.uniform1f(u('settle'), this.mode === 'in' ? 1 + 0.05 * (1 - x) ** 3 : 1);
    gl.uniform1f(u('artA'), art.aspect);
    gl.uniform3f(u('G'), sc.glow.x, sc.glow.y, sc.glow.r);
    gl.uniform3f(u('CC'), sc.clip.x, sc.clip.y, sc.clip.r);
    gl.uniform4f(u('BX'), sc.box.left, sc.box.top, sc.box.width, sc.box.height);
    gl.uniform4f(u('RG'), sc.ringBox.left, sc.ringBox.top, sc.ringBox.width, sc.ringBox.height);
    this.magic(this.main);
    [['SC', this.pic], ['ART', art.tex], ['RING', ring.tex]].forEach(([n, tex], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex as WebGLTexture); gl.uniform1i(u(n as string), i); });
    gl.bindVertexArray(this.place.full);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
  private magic(pr: Prog): void {
    const { gl, loc } = this;
    gl.uniform1f(pr.u('MGK'), loc.cool ? 1 : 0);
    if (loc.cool) gl.uniform3f(pr.u('COOL'), ...loc.cool);
    if (loc.warm) gl.uniform3f(pr.u('WARMC'), ...loc.warm);
  }

  private sound(clip: string, o: { gain: number; rate: number; lowpass?: number; delay?: number }): void {
    const ctx = audioContext();
    const buf = this.sounds.get(clip);
    const out = ctx && fxBusTarget(ctx, 'ui');
    if (!ctx || !buf || !out || isMuted()) return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
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
    src.start(ctx.currentTime + (o.delay ?? 0));
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
