/**
 * LIVING ART (concept, owner 2026-11-25: "it should just appear more like the image is alive. give some movement to the art behind him/maybe like
 * the flame around his whistle"). ONE picture a skin, drawn once a step by one small WebGL canvas and copied into every card that wears it, so a
 * board of them costs one draw. Nothing follows the pointer. The painting's own pieces (ground / pack / hero / leaves) are drawn piece over piece,
 * the light moving and nothing solid (owner, same day: "stop the winking, and stop the wobbling"): holographic foil behind the hero, mist, the green
 * light running through stones, grass and runes, a flame on the whistle with its sparks, and fireflies.
 *
 * `herodata`: R its green light, G how much the wind takes its fur, B where the flame burns. `scenedata`: R green light, G flowing light, B trees.
 */
export const LIVING_PIECES = ['ground', 'pack', 'hero', 'leaves', 'herodata', 'scenedata'] as const;
export type LivingSet = Readonly<Record<string, string>>;

const SIZE = 560;
/** A step of the picture, ms: ambient movement, not input. */
const STEP = 1000 / 60 - 1.5;

const VS = `#version 300 es
out vec2 v;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); v = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D ground, pack, hero, leaves, hd, sd;
uniform float T;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 17.; a *= .5; } return s; }
float bump(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
// a thing that happens for w seconds now and then: 0..1..0
float now(float period, float at, float w) { float t = mod(T - at, period); return t < w ? sin(3.14159 * t / w) : 0.; }
vec4 over(vec4 a, vec4 b) { return vec4(b.rgb * b.a + a.rgb * (1. - b.a), 1.); }
vec2 rot(vec2 p, vec2 c, float a) { vec2 d = p - c; float s = sin(a), k = cos(a); return c + vec2(d.x * k - d.y * s, d.x * s + d.y * k); }

vec3 hue(float x) { return .5 + .5 * cos(6.28318 * (x + vec3(0., .33, .67))); }
vec3 foil(vec3 c, vec2 uv, float amt) {
  float lean = .5 * sin(T * .42) + .22 * sin(T * .27 + 1.3);                      // the light leaning slowly over it
  float d = dot(uv, vec2(.80, .60));
  float wave = fbm(uv * 3.2 + vec2(T * .05, -T * .04));
  float x = d * 2.1 + wave * .55 + lean * .55;
  vec3 col = hue(x);
  float bars = pow(.5 + .5 * sin(d * 24. + lean * 7. + wave * 3.), 2.2);
  float sweep = exp(-pow((fract(d * .62 - T * .065) - .5) * 5.2, 2.));              // one brighter band, going by
  float grain = .90 + .10 * sin((uv.x * .55 - uv.y) * 520.);                        // the etched lines of the foil
  float l = dot(c, vec3(.3, .59, .11));
  float k = amt * (.16 + .34 * bars + .42 * sweep) * grain * (.55 + .75 * l);
  vec3 lit = 1. - (1. - c) * (1. - col * k);                                          // screened on, so the painting stays itself
  lit = mix(vec3(dot(lit, vec3(.3, .59, .11))), lit, 1.12);
  // glints: little four-point stars in the foil
  vec2 gr = uv * 13.; vec2 id = floor(gr); float s = h2(id + 3.); vec2 f = fract(gr) - .5 - (vec2(h2(id + 7.), h2(id + 11.)) - .5) * .5;
  float on = step(.62, s) * pow(.5 + .5 * sin(T * (.7 + s) + s * 40. + lean * 5.), 14.) ;
  float star = smoothstep(.34, 0., abs(f.x)) * smoothstep(.028, 0., abs(f.y)) + smoothstep(.34, 0., abs(f.y)) * smoothstep(.028, 0., abs(f.x)) + smoothstep(.11, 0., length(f));
  return lit + (hue(x + s) * .55 + .45) * star * on * amt * .95;
}

void main() {
  // the whole picture a touch larger than its window, so nothing at an edge is ever seen to end
  vec2 uv = (v - .5) * .985 + .5;
  const vec2 orbit = vec2(0.);

  // ── GROUND: sky, stones, trees, the light in the grass ──
  vec2 g = (uv - .5) * .975 + .5 + orbit * .75;
  vec4 m = texture(sd, g);
  float fl = fbm(vec2(g.x * 9. - T * .22, g.y * 13. + T * .75));
  g += m.g * (vec2(fl - .5, fbm(vec2(g.x * 11. + 5., g.y * 9. + T * .9)) - .5)) * .026;
  vec3 c = texture(ground, g).rgb;
  m = texture(sd, g);
  // light running through the painted green: along the stones upwards, along the grass in waves
  float run = pow(.5 + .5 * sin((g.y * 26. - fbm(g * 7.) * 5.) + T * 2.3), 5.);
  c += vec3(.22, 1., .42) * m.r * (.10 + .75 * run) + vec3(.1, .8, .35) * m.g * (.05 + .3 * run);
  // the moon
  float moon = length((g - vec2(.682, .098)) * vec2(1., 1.)) ;
  c += vec3(.35, .5, .75) * exp(-moon * 11.) * (.16 + .12 * sin(T * .8));
  // stars
  vec2 sc = g * 34.; float st = h2(floor(sc)); vec2 sp = fract(sc) - .5 - (vec2(h1(st * 91.), h1(st * 57.)) - .5) * .6;
  c += vec3(.85, .93, 1.) * step(.84, st) * smoothstep(.13, .0, length(sp)) * smoothstep(.36, .08, g.y) * (.25 + .75 * pow(.5 + .5 * sin(T * (1. + st * 2.) + st * 60.), 3.)) * smoothstep(.16, .3, moon + .1);
  // ── THE FOIL behind everything: soft rainbow bars sliding across, a fine etched grain in them, and glints that catch as a bar goes over ──
  c = foil(c, uv, 1.);
  // mist drifting behind the pack
  float mist = fbm(vec2(uv.x * 3.2 - T * .085, uv.y * 5.5 + T * .03)) ;
  c = mix(c, vec3(.36, .62, .68), smoothstep(.42, .85, mist) * smoothstep(.25, .62, uv.y) * .42);

  // ── THE PACK: each breathes in its own time ──
  vec2 q = uv;
  vec4 p = texture(pack, q);
  vec4 pm = texture(sd, q);
  float beat = .5 + .5 * sin(T * 1.9 + q.x * 8.);
  p.rgb += vec3(.2, 1., .5) * pm.r * (.08 + .75 * beat * beat) * step(.3, p.a);
  c = mix(c, foil(p.rgb, uv, .24), p.a);
  // the boar's breath
  float br = mod(T + 1., 4.6) / 4.6; vec2 bp = uv - vec2(.055 - br * .03, .805 + br * .012);
  c += vec3(.62, .78, .80) * smoothstep(.02 + br * .06, .0, length(bp * vec2(1., 1.5))) * smoothstep(0., .07, br) * smoothstep(.55, .1, br) * .5 * (.55 + .9 * fbm(uv * 22. + vec2(T, 0.)));
  // mist in front of the pack, behind the hero
  float mist2 = fbm(vec2(uv.x * 4.1 + T * .10, uv.y * 6. - T * .04 + 9.));
  c = mix(c, vec3(.28, .66, .58), smoothstep(.45, .9, mist2) * smoothstep(.55, .95, uv.y) * .5);

  // ── THE HERO, a little in front ──
  vec2 k = uv;
  vec4 hs = texture(hero, k);
  // its shadow on what is behind
  float sh = 0.; for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; sh += texture(hero, k + vec2(cos(a), sin(a)) * .021 - vec2(.008, .006)).a; }
  c *= 1. - .34 * (sh / 6.) * (1. - hs.a);
  vec4 hm = texture(hd, k);
  float chase = pow(.5 + .5 * sin(k.y * 42. - T * 5.2 + fbm(k * 13.) * 5.), 4.);
  vec3 hc = hs.rgb;
  hc += vec3(.35, 1., .30) * hm.r * (.04 + .62 * chase) * (1. - .6 * smoothstep(.5, .9, hm.b));
  // the rim of moonlight and of the flame on its fur
  float flick = .75 + .25 * sin(T * 9.) * sin(T * 13.7 + 1.) + .2 * (fbm(vec2(T * 2.4, 3.)) - .5);
  hc += vec3(.16, .75, .22) * bump(uv, vec2(.345, .60), vec2(.13, .17)) * .34 * flick;
  c = mix(c, hc, hs.a);

  // ── THE FLAME ──
  vec2 fuv = uv;
  vec2 lick = vec2(fbm(vec2(fuv.x * 12., fuv.y * 8. + T * 1.9)) - .5, 0.) * .085 * smoothstep(.66, .42, fuv.y);
  float fd = texture(hd, fuv + lick).b;
  float tongue = fbm(vec2(fuv.x * 22. + sin(T) * .3, fuv.y * 13. + T * 2.7)) * .62 + fbm(vec2(fuv.x * 43., fuv.y * 24. + T * 4.4)) * .38;
  float fire = smoothstep(.34, .80, fd * 1.12 + (tongue - .54) * 1.5);
  float hot = smoothstep(.86, 1.3, fd * 1.1 + (tongue - .5) * 1.1);
  vec3 fc = mix(vec3(.02, .55, .10), vec3(.35, 1., .28), fire); fc = mix(fc, vec3(.92, 1., .72), hot);
  float body = texture(hd, fuv).b;                       // on the whistle itself it stays a glow: the gold must be seen
  float onW = smoothstep(.66, .92, body);
  c = mix(c, fc, fire * mix(.62, .0, onW)) ; c += fc * fire * mix(.30, .10, onW) * flick;
  c += vec3(.10, .55, .16) * bump(uv, vec2(.335, .57), vec2(.10, .15)) * .30 * flick;
  // sparks off it
  for (int i = 0; i < 9; i++) {
    float s = float(i), l = fract(T * (.22 + .1 * h1(s)) + h1(s * 3.1)), id = floor(T * (.22 + .1 * h1(s)) + h1(s * 3.1));
    vec2 sp2 = vec2(.335 + (h1(id * 7. + s) - .5) * .10 + sin(l * 7. + s) * .028, .66 - l * .46);
    float r = .0055 * (1. - l * .6);
    c += vec3(.6, 1., .45) * smoothstep(r * 2.4, 0., length(uv - sp2)) * smoothstep(0., .08, l) * (1. - l) * 1.2;
  }
  // fireflies, some behind (dimmer, small), some near
  for (int i = 0; i < 12; i++) {
    float s = float(i) + 20., z = h1(s * 1.7);
    vec2 fp = vec2(h1(s) + .055 * sin(T * (.35 + .3 * z) + s * 2.), h1(s * 5.3) * .8 + .12 + .06 * sin(T * (.27 + .25 * h1(s * 2.)) + s)) - orbit * (z - .4) * 2.;
    float near_ = step(.55, z), r = mix(.006, .0115, z);
    float tw = pow(.5 + .5 * sin(T * (1.1 + z) + s * 4.), 2.);
    float d = length(uv - fp);
    vec3 col = i % 3 == 0 ? vec3(1., .88, .5) : i % 3 == 1 ? vec3(.55, 1., .55) : vec3(.55, .82, 1.);
    c += col * (smoothstep(r, 0., d) * 1.1 + smoothstep(r * 4.5, 0., d) * .22) * tw * mix(1. - hs.a, 1., near_);
  }
  // ── THE NEAR LEAVES ──
  vec2 lq = (uv - .5) * .98 + .5 - orbit * 2.4;
  vec4 lf = texture(leaves, lq);
  c = mix(c, lf.rgb, lf.a);
  o = vec4(c, 1.);
}`;

interface Pic { canvas: HTMLCanvasElement; draw: (t: number) => boolean; free: () => void }
function build(set: LivingSet): Pic | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (ty: number, src: string): WebGLShader => { const s = gl.createShader(ty)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  let ready = 0;
  let dead = false;
  const names = ['ground', 'pack', 'hero', 'leaves', 'herodata', 'scenedata'];
  const unis = ['ground', 'pack', 'hero', 'leaves', 'hd', 'sd'];
  names.forEach((n, i) => {
    const im = new Image();
    im.src = set[n] ?? '';
    void im.decode().then(() => createImageBitmap(im, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })).then((bm) => {
      if (dead) { bm.close(); return; }
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
      bm.close();
      ready++;
    }).catch(() => undefined);
  });
  let uT: WebGLUniformLocation | null = null;
  let set_ = false;
  return {
    canvas,
    draw: (t) => {
      if (ready < names.length) return false;
      if (!set_) {
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('[livingArt]', gl.getProgramInfoLog(pr), ...(gl.getAttachedShaders(pr) ?? []).map((s) => gl.getShaderInfoLog(s))); ready = -99; return false; }
        gl.useProgram(pr);
        unis.forEach((n, i) => gl.uniform1i(gl.getUniformLocation(pr, n), i));
        uT = gl.getUniformLocation(pr, 'T');
        gl.bindVertexArray(gl.createVertexArray());
        gl.viewport(0, 0, SIZE, SIZE);
        set_ = true;
      }
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
    free: () => { dead = true; gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

interface Live { pic: Pic | null; outs: Set<HTMLCanvasElement>; seen: Set<HTMLCanvasElement>; raf: number; last: number; late: ReturnType<typeof setTimeout> | null; io: IntersectionObserver | null; t0: number }
const lives = new Map<string, Live>();

/** Show a skin's living picture in `out` until the returned function is called. */
export function showLiving(key: string, set: LivingSet, out: HTMLCanvasElement, onFirst: () => void): () => void {
  let l = lives.get(key);
  if (!l) {
    l = { pic: build(set), outs: new Set(), seen: new Set(), raf: 0, last: 0, late: null, io: null, t0: performance.now() };
    lives.set(key, l);
  }
  const live = l;
  if (live.late) { clearTimeout(live.late); live.late = null; }
  if (!live.pic) return () => undefined;
  out.width = out.height = 420;
  let first = true;
  live.io ??= typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { for (const e of es) (e.isIntersecting ? live.seen.add(e.target as HTMLCanvasElement) : live.seen.delete(e.target as HTMLCanvasElement)); }) : null;
  live.outs.add(out);
  if (live.io) live.io.observe(out); else live.seen.add(out);
  const firsts = FIRST.get(out) ?? [];
  firsts.push(() => { if (first) { first = false; onFirst(); } });
  FIRST.set(out, firsts);
  const tick = (now: number): void => {
    live.raf = requestAnimationFrame(tick);
    if (now - live.last < STEP || !live.seen.size || document.hidden) return;
    live.last = now;
    if (!live.pic!.draw(40 + (now - live.t0) / 1000)) return;
    for (const c of live.seen) {
      if (!live.outs.has(c)) { live.seen.delete(c); continue; }
      const x = CTX.get(c) ?? c.getContext('2d', { alpha: false });
      if (!x) continue;
      CTX.set(c, x);
      x.drawImage(live.pic!.canvas, 0, 0, c.width, c.height);
      const f = FIRST.get(c);
      if (f) { FIRST.delete(c); for (const g of f) g(); }
    }
  };
  if (!live.raf) live.raf = requestAnimationFrame(tick);
  return () => {
    live.outs.delete(out);
    live.seen.delete(out);
    live.io?.unobserve(out);
    if (live.outs.size) return;
    cancelAnimationFrame(live.raf);
    live.raf = 0;
    live.late = setTimeout(() => { if (!live.outs.size) { live.io?.disconnect(); live.pic?.free(); lives.delete(key); } }, 8000);
  };
}
const CTX = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
const FIRST = new WeakMap<HTMLCanvasElement, (() => void)[]>();
