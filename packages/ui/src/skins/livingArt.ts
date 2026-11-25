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

const FS = `precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D ground, pack, hero, leaves, hd, sd;
uniform float T;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 17.; a *= .5; } return s; }
float bump(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }

// ── THE STORM LOOK: every green light is blue, and it is lightning ──
#ifdef STORM
vec3 G(vec3 c) { return vec3(c.r * .55 + c.b * .12, c.g * .62, max(c.g, c.b)); }
vec3 paint(vec3 c, float strict) {
  float e = smoothstep(.02, .16, c.g - max(c.r * .9, c.b * .94)) * (1. - smoothstep(mix(.56, .84, strict), mix(.86, 1.02, strict), c.r / max(c.g, .02)));
  return mix(c, vec3(c.r * .42 + c.g * .12, c.g * .66, c.g * 1.08), e);
}
float jag(float x, float s) { float i = floor(x), f = x - i; return mix(h2(vec2(i, s)), h2(vec2(i + 1., s)), f) - .5; }
float bolt(vec2 p, vec2 a, vec2 b, float s, float amp, float w) {
  vec2 d = b - a; float L = length(d); d /= L; vec2 n = vec2(-d.y, d.x);
  float along = dot(p - a, d), t = clamp(along / L, 0., 1.);
  float off = (jag(t * 6., s) + jag(t * 14., s + 5.) * .5 + jag(t * 33., s + 9.) * .22) * amp * smoothstep(0., .1, t) * (1. - smoothstep(.9, 1., t));
  float q = length(vec2(dot(p - a, n) - off, max(0., abs(along - L * .5) - L * .5)));
  float thin = w * mix(1., .45, t);
  return (1. - smoothstep(thin * .25, thin, q)) + exp(-q / (thin * 4.5)) * .55 + exp(-q / (thin * 18.)) * .20;
}
// a strike: how bright it is now, and which one
float struck(float period, float ph, out float id) { float x = T / period + ph; id = floor(x); float t = fract(x) * period; return smoothstep(0., .07, t) * (exp(-t * 4.2) * .8 + .22 * exp(-abs(t - .34) * 9.)) * step(t, 1.4); }
#else
vec3 G(vec3 c) { return c; }
vec3 paint(vec3 c, float strict) { return c; }
#endif
vec3 hue(float x) { return .5 + .5 * cos(6.28318 * (x + vec3(0., .33, .67))); }
vec3 foil(vec3 c, vec2 uv, float amt) {
  float lean = .5 * sin(T * .42) + .22 * sin(T * .27 + 1.3);                      // the light leaning slowly over it
  float d = dot(uv, vec2(.80, .60));
  float wave = fbm(uv * 3.2 + vec2(T * .05, -T * .04));
  float x = d * 2.1 + wave * .55 + lean * .55;
  vec3 col = hue(x);
#ifdef STORM
  col = vec3(.34, .46, .94) + vec3(.34, .30, .10) * cos(6.28318 * (x + vec3(0., .42, .2)));     // the cold half of the rainbow
#endif
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
  vec3 c = paint(texture(ground, g).rgb, 0.);
  m = texture(sd, g);
  float flash = 0.;
  // light running through the painted green: along the stones upwards, along the grass in waves
  float run = pow(.5 + .5 * sin((g.y * 26. - fbm(g * 7.) * 5.) + T * 2.3), 5.);
  c += G(vec3(.22, 1., .42)) * m.r * (.10 + .75 * run) + G(vec3(.1, .8, .35)) * m.g * (.05 + .3 * run);
  // the moon
  float moon = length((g - vec2(.682, .098)) * vec2(1., 1.)) ;
  c += vec3(.35, .5, .75) * exp(-moon * 11.) * (.16 + .12 * sin(T * .8));
  // stars
  vec2 sc = g * 34.; float st = h2(floor(sc)); vec2 sp = fract(sc) - .5 - (vec2(h1(st * 91.), h1(st * 57.)) - .5) * .6;
  c += vec3(.85, .93, 1.) * step(.84, st) * smoothstep(.13, .0, length(sp)) * smoothstep(.36, .08, g.y) * (.25 + .75 * pow(.5 + .5 * sin(T * (1. + st * 2.) + st * 60.), 3.)) * smoothstep(.16, .3, moon + .1);
  // ── THE FOIL behind everything: soft rainbow bars sliding across, a fine etched grain in them, and glints that catch as a bar goes over ──
  c = foil(c, uv, 1.);
#ifdef STORM
  // clouds rolling over, lit from inside by each strike; the strikes hit the stones and the hills behind
  float cl = fbm(vec2(uv.x * 2.6 + T * .05, uv.y * 4.6 - T * .015));
  float sky = 1. - smoothstep(.02, .52, uv.y);
  c = mix(c, vec3(.035, .05, .13) + c * .22, (.34 + .58 * smoothstep(.34, .72, cl)) * sky);
  float lit = 0.;
  for (int i = 0; i < 3; i++) {
    float id, f = struck(i == 0 ? 5.3 : i == 1 ? 8.9 : 14.3, i == 0 ? .1 : i == 1 ? .55 : .3, id);
    if (f > .004) {
      float r = h2(vec2(id, float(i) * 7. + 2.)), s = id * 3.7 + float(i) * 11.;
      vec2 to = r < .22 ? vec2(.185, .125) : r < .44 ? vec2(.797, .105) : r < .60 ? vec2(.725, .36) : r < .74 ? vec2(.245, .33) : r < .87 ? vec2(.94, .34) : vec2(.065, .34);
      vec2 from = vec2(to.x + (h2(vec2(id, 4.)) - .5) * .34, -.04);
      vec2 mid = mix(from, to, .42 + .2 * h2(vec2(id, 8.)));
      vec2 side = vec2(to.x + (h2(vec2(id, 12.)) < .5 ? -1. : 1.) * (.10 + .10 * h2(vec2(id, 13.))), mix(mid.y, to.y, .9) + .05);
      float bl = bolt(uv, from, to, s, .085, .0058) + bolt(uv, mid, side, s + 40., .05, .0034) * .6;
      lit += bl * f;
      flash += f;
      c += vec3(.5, .7, 1.) * m.r * f * step(r, .44) * step(0., (to.x - .5) * (g.x - .5)) * .9;       // the stone it struck flares
    }
  }
  flash = min(flash, 1.) * .5;
  c += vec3(.36, .46, .95) * flash * (.20 + .9 * smoothstep(.3, .8, cl)) * sky;
  c += (vec3(.36, .56, 1.) * lit + vec3(.7, .8, .9) * smoothstep(.6, 1.3, lit)) * .85;
#endif
  // mist drifting behind the pack
  float mist = fbm(vec2(uv.x * 3.2 - T * .085, uv.y * 5.5 + T * .03)) ;
  c = mix(c, G(vec3(.36, .62, .68)) * (1. + flash * .35), smoothstep(.42, .85, mist) * smoothstep(.25, .62, uv.y) * .42);

  // ── THE PACK: each breathes in its own time ──
  vec2 q = uv;
  vec4 p = texture(pack, q);
  vec4 pm = texture(sd, q);
  float beat = .5 + .5 * sin(T * 1.9 + q.x * 8.);
  p.rgb = paint(p.rgb, 0.);
  p.rgb += G(vec3(.2, 1., .5)) * pm.r * (.08 + .75 * beat * beat) * step(.3, p.a);
  c = mix(c, foil(p.rgb, uv, .24) * (1. + flash * vec3(.10, .16, .34)), p.a);
  // the boar's breath
  float br = mod(T + 1., 4.6) / 4.6; vec2 bp = uv - vec2(.055 - br * .03, .805 + br * .012);
  c += vec3(.62, .78, .80) * smoothstep(.02 + br * .06, .0, length(bp * vec2(1., 1.5))) * smoothstep(0., .07, br) * smoothstep(.55, .1, br) * .5 * (.55 + .9 * fbm(uv * 22. + vec2(T, 0.)));
  // mist in front of the pack, behind the hero
  float mist2 = fbm(vec2(uv.x * 4.1 + T * .10, uv.y * 6. - T * .04 + 9.));
  c = mix(c, G(vec3(.28, .66, .58)), smoothstep(.45, .9, mist2) * smoothstep(.55, .95, uv.y) * .5);

  // ── THE HERO, a little in front ──
  vec2 k = uv;
  vec4 hs = texture(hero, k);
  // its shadow on what is behind
  float sh = 0.; for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; sh += texture(hero, k + vec2(cos(a), sin(a)) * .021 - vec2(.008, .006)).a; }
  c *= 1. - .34 * (sh / 6.) * (1. - hs.a);
  vec4 hm = texture(hd, k);
  float chase = pow(.5 + .5 * sin(k.y * 42. - T * 5.2 + fbm(k * 13.) * 5.), 4.);
  vec3 hc = paint(hs.rgb, 1. - smoothstep(.80, .87, k.y));
  hc += G(vec3(.35, 1., .30)) * hm.r * (.04 + .62 * chase) * (1. - .6 * smoothstep(.5, .9, hm.b));
  // the rim of moonlight and of the flame on its fur
  float flick = .75 + .25 * sin(T * 9.) * sin(T * 13.7 + 1.) + .2 * (fbm(vec2(T * 2.4, 3.)) - .5);
  hc += G(vec3(.16, .75, .22)) * bump(uv, vec2(.345, .60), vec2(.13, .17)) * .30 * flick;
  hc += vec3(.42, .56, 1.) * pow(hm.g, 1.6) * (1. - smoothstep(.62, .74, k.x) * smoothstep(.66, .74, k.y)) * flash * .55 + hc * vec3(.6, .8, 1.3) * flash * .10;
#ifdef STORM
  vec2 e1 = (k - vec2(.5045, .1655)), e2 = (k - vec2(.5795, .1830));
  float i1 = exp(-dot(e1 / vec2(.0120, .0105), e1 / vec2(.0120, .0105))), i2 = exp(-dot(e2 / vec2(.0072, .0088), e2 / vec2(.0072, .0088)));
  float gold = smoothstep(.06, .28, hc.r - hc.b);                                          // the iris only: the pupil and the glint stay
  float eyeP = .82 + .18 * sin(T * 1.7);
  hc = mix(hc, vec3(.16, .52, 1.) * (.45 + 1.1 * hc.g) * 1.15, min(1., (i1 + i2) * 1.6) * gold);
  hc += vec3(.16, .46, 1.) * (exp(-length(e1 / vec2(1.25, 1.)) / .0125) * .75 + exp(-length(e2) / .0085) * .6) * eyeP;
  hc += vec3(.55, .80, 1.) * (smoothstep(.0048, .0, length(e1 - vec2(.0025, .0015))) + smoothstep(.0032, .0, length(e2))) * .35 * eyeP;
#endif
  c = mix(c, hc, hs.a);

  // ── THE FLAME ──
  vec2 fuv = uv;
  vec2 lick = vec2(fbm(vec2(fuv.x * 12., fuv.y * 8. + T * 1.9)) - .5, 0.) * .085 * smoothstep(.66, .42, fuv.y);
  float fd = texture(hd, fuv + lick).b;
  float tongue = fbm(vec2(fuv.x * 22. + sin(T) * .3, fuv.y * 13. + T * 2.7)) * .62 + fbm(vec2(fuv.x * 43., fuv.y * 24. + T * 4.4)) * .38;
  float fire = smoothstep(.34, .80, fd * 1.12 + (tongue - .54) * 1.5);
  float hot = smoothstep(.86, 1.3, fd * 1.1 + (tongue - .5) * 1.1);
  vec3 fc = G(mix(vec3(.02, .55, .10), vec3(.35, 1., .28), fire)); fc = mix(fc, G(vec3(.92, 1., .72)) + vec3(.25, .22, .1), hot);
#ifdef STORM
  fire *= .46 * mix(1., .45, smoothstep(.5, .85, texture(hd, fuv).b)); hot *= .25;
#endif
  float body = texture(hd, fuv).b;                       // on the whistle itself it stays a glow: the gold must be seen
  float onW = smoothstep(.66, .92, body);
  c = mix(c, fc, fire * mix(.62, .0, onW)) ; c += fc * fire * mix(.30, .10, onW) * flick;
  c += G(vec3(.10, .55, .16)) * bump(uv, vec2(.335, .57), vec2(.10, .15)) * .24 * flick;
#ifdef STORM
  // the current: filaments crawling over the whistle and up the flame, and arcs jumping from it to whatever is near
  vec2 cr = uv * 15. + vec2(0., T * .5);
  float r1 = 1. - abs(2. * fbm(cr + fbm(cr * 1.4 + T * .4) * 1.3) - 1.), r2 = 1. - abs(2. * fbm(cr * 1.9 - vec2(T * .6, T * .2)) - 1.);
  float fil = (pow(r1, 13.) + .8 * pow(r2, 15.)) * smoothstep(.16, .6, texture(hd, uv).b + texture(hd, uv + vec2(.03, 0.)).b * .4 + texture(hd, uv - vec2(.03, 0.)).b * .4);
  float strobe = .8 + .2 * sin(T * 3.1) * sin(T * 4.7 + 1.);
  fil *= mix(1., .22, smoothstep(.45, .85, body));
  c += (vec3(.14, .42, 1.) + vec3(.5, .42, .2) * smoothstep(.45, 1., fil)) * fil * .8 * strobe;
  float arcs = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), tk = T * (2.1 + fi * .37) + fi * 3.3, id = floor(tk), e = fract(tk);
    if (h2(vec2(id, fi)) < .38) continue;
    float ra = h2(vec2(id, fi + 20.)), rb = h2(vec2(id, fi + 31.));
    vec2 a = mix(vec2(.305, .665), vec2(.395, .575), ra);
    float w = h2(vec2(id * .37, fi + 44.));
    vec2 b = w < .16 ? vec2(.40, .40) : w < .30 ? vec2(.285, .46) : w < .46 ? vec2(.49, .47) : w < .62 ? vec2(.52, .61) : w < .76 ? vec2(.215, .56) : w < .90 ? vec2(.44, .78) : vec2(.28, .80);
    arcs += bolt(uv, a, b + (vec2(rb, ra) - .5) * .045, id * 1.7 + fi * 9. + floor(e * 3.), .055, .0032) * smoothstep(0., .12, e) * (1. - smoothstep(.35, .95, e)) * .8;
  }
  float near2 = smoothstep(.30, .85, body);                 // where they all leave from: the whistle itself must be seen
  arcs *= mix(1., .16, near2);
  c += vec3(.24, .52, 1.) * min(arcs, 1.5) * .85 + vec3(.8, .8, .65) * smoothstep(.65, 1.4, arcs);
#endif
  // sparks off it
  for (int i = 0; i < 9; i++) {
    float s = float(i), l = fract(T * (.22 + .1 * h1(s)) + h1(s * 3.1)), id = floor(T * (.22 + .1 * h1(s)) + h1(s * 3.1));
    vec2 sp2 = vec2(.335 + (h1(id * 7. + s) - .5) * .10 + sin(l * 7. + s) * .028, .66 - l * .46);
    float r = .0055 * (1. - l * .6);
    c += G(vec3(.6, 1., .45)) * smoothstep(r * 2.4, 0., length(uv - sp2)) * smoothstep(0., .08, l) * (1. - l) * 1.2;
  }
#ifdef STORM
  vec2 ew = uv - vec2(.5045, .1655); float back = clamp(-ew.x / .085, 0., 1.);
  float wisp = exp(-pow((ew.y + back * back * .030 - (fbm(vec2(ew.x * 30. + T * .9, T * .5)) - .5) * .022 * back) / (.0045 + .004 * back), 2.)) * step(ew.x, 0.) * smoothstep(0., .12, back) * (1. - back) * (.5 + .5 * fbm(vec2(ew.x * 46. + T * 1.6, 2.)));
  c += vec3(.22, .55, 1.) * wisp * .75;
#endif
  // fireflies, some behind (dimmer, small), some near
  for (int i = 0; i < 12; i++) {
    float s = float(i) + 20., z = h1(s * 1.7);
    vec2 fp = vec2(h1(s) + .055 * sin(T * (.35 + .3 * z) + s * 2.), h1(s * 5.3) * .8 + .12 + .06 * sin(T * (.27 + .25 * h1(s * 2.)) + s)) - orbit * (z - .4) * 2.;
    float near_ = step(.55, z), r = mix(.006, .0115, z);
    float tw = pow(.5 + .5 * sin(T * (1.1 + z) + s * 4.), 2.);
    float d = length(uv - fp);
    vec3 col = i % 3 == 0 ? vec3(1., .88, .5) : i % 3 == 1 ? vec3(.55, 1., .55) : vec3(.55, .82, 1.);
#ifdef STORM
    col = i % 3 == 0 ? vec3(.8, .75, 1.) : i % 3 == 1 ? vec3(.45, .75, 1.) : vec3(.7, .9, 1.);
#endif
    c += col * (smoothstep(r, 0., d) * 1.1 + smoothstep(r * 4.5, 0., d) * .22) * tw * mix(1. - hs.a, 1., near_);
  }
  // ── THE NEAR LEAVES ──
  vec2 lq = (uv - .5) * .98 + .5 - orbit * 2.4;
  vec4 lf = texture(leaves, lq);
  c = mix(c, lf.rgb * (1. + flash * vec3(.3, .4, .8)), lf.a);
  o = vec4(c, 1.);
}`;


/**
 * GOLDEN (Derenor, owner 2026-11-25: "his background is animated and has like a soft golden glow to it"): the painting whole, and behind its hero the
 * light alive: shafts and haze, the fall and the pool running, the painted gold breathing, leaves coming down, dust and soft discs of light.
 * `herodata`: R the hero, G the rim inside his outline, B the glow outside it. `scenedata`: R water, G painted gold, B leaves overhead. `leaves`: one leaf.
 */
const FS_GOLD = `precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D ground, pack, hero, leaves, hd, sd;
uniform float T;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 17.; a *= .5; } return s; }
vec3 screen(vec3 a, vec3 b) { return 1. - (1. - a) * (1. - clamp(b, 0., 1.)); }
// one leaf: where it is at this moment of its fall, turning over as it comes
vec4 leaf(vec2 uv, float s, float size, float speed) {
  float l = fract(T * speed + h1(s * 1.7)), id = floor(T * speed + h1(s * 1.7));
  float u = h2(vec2(id, s)), x = (u < .5 ? mix(.13, .40, u * 2.) : mix(.60, .93, u * 2. - 1.)) + l * -.06 + .045 * sin(l * 11. + s * 3.);      // to either side of him
  vec2 c = vec2(x, -.08 + l * 1.16 + .012 * sin(l * 22. + s));
  vec2 d = uv - c;
  float a = s * 2. + l * 7. + 1.1 * sin(l * 11. + s * 3.), k = cos(a), q = sin(a);
  d = vec2(d.x * k + d.y * q, -d.x * q + d.y * k) / size;
  d.x /= .28 + .72 * abs(cos(l * 13. + s * 5.));                                   // turning over
  d.y /= .81;
  if (abs(d.x) > .5 || abs(d.y) > .5) return vec4(0.);
  vec4 t = texture(leaves, d + .5);
  t.rgb *= .82 + .4 * abs(cos(l * 13. + s * 5.));
  t.a *= smoothstep(0., .06, l) * (1. - smoothstep(.93, 1., l));
  return t;
}
void main() {
  vec2 uv = (v - .5) * .985 + .5;
  vec3 c = texture(ground, uv).rgb;
  vec3 hm = texture(hd, uv).rgb, sm = texture(sd, uv).rgb;
  float hero_ = hm.r, bg = 1. - hero_;
  vec3 pic = c;
  float lum = dot(c, vec3(.3, .59, .11));
  float slow = .5 + .5 * sin(T * .55), slow2 = .5 + .5 * sin(T * .37 + 2.);

  // ── the water ──
  float sl = uv.x + (uv.y - .6) * .22;
  float run = fbm(vec2(sl * 62., uv.y * 7.5 - T * 1.25)) * .6 + fbm(vec2(sl * 120., uv.y * 13. - T * 2.0)) * .4;
  float poolM = smoothstep(.775, .79, uv.y);
  float rip = fbm(vec2(uv.x * 16. + T * .22, uv.y * 70. - T * .5));
  c += sm.r * mix((run - .42) * vec3(.95, 1.02, 1.04), (rip - .46) * vec3(1.05, .95, .70) * 1.5, poolM);
  c += sm.r * vec3(1., .86, .52) * smoothstep(.70, .9, mix(run, rip, poolM)) * .55;

  // ── the air warms ──
  float low = dot(c, vec3(.3, .59, .11));
  vec3 amber = mix(vec3(low) * vec3(1.05, .64, .26), c * vec3(1.04, .80, .50), .62);
  c = mix(c, amber, .58 * (1. - .75 * sm.r));                              // the water keeps its own colour
  c = c * c * (1.5 - .5 * c) * .62 + c * .30;                              // deeper darks: the painting stays a painting
  c += sm.r * vec3(.05, .07, .08);      // a deep amber, so the light has something to glow on
  // shafts of light out of the canopy, upper right
  vec2 rp = uv - vec2(.80, -.10); float ang = atan(rp.x, rp.y), rd = length(rp);
  float shaft = smoothstep(.40, .78, fbm(vec2(ang * 7.5 + T * .045, T * .06))) * .75 + smoothstep(.46, .8, fbm(vec2(ang * 15. - T * .06, 4. + T * .05))) * .45;
  shaft *= exp(-rd * 1.05) * smoothstep(1.15, .25, abs(ang + .38));
  c = screen(c, vec3(1., .70, .26) * shaft * (.80 + .20 * slow));
  // a great soft glow behind him, breathing
  vec2 gp = (uv - vec2(.55, .40)) * vec2(1., 1.05);
  float big = exp(-dot(gp, gp) * 4.6);
  float drift = fbm(uv * 3.1 + vec2(T * .06, -T * .09));
  c = screen(c, vec3(1., .56, .13) * big * (.24 + .08 * slow) * (.45 + 1.1 * drift));
  // and close to his outline, light coming off him in slow wisps
  vec2 w2 = uv - vec2(.52, .45); float r2 = length(w2); w2 /= max(r2, .001);          // round a circle, so there is no seam
  float wisp = fbm(vec2(w2.x * 3.4 + w2.y * 1.7, w2.y * 3.4) + vec2(3., r2 * 11. - T * .42));
  c = screen(c, vec3(1., .66, .20) * hm.b * hm.b * (.80 + .24 * slow2) * (.45 + 1.1 * smoothstep(.3, .72, wisp)));
  // beams standing off him, turning slowly: the glow seen moving
  vec2 bd = vec2(w2.x * cos(T * .10) - w2.y * sin(T * .10), w2.x * sin(T * .10) + w2.y * cos(T * .10));
  float beam = smoothstep(.50, .70, fbm(bd * 4.6 + vec2(0., T * .06))) + .6 * smoothstep(.5, .76, fbm(bd * 9.5 - vec2(T * .08, 4.)));
  c = screen(c, vec3(1., .70, .24) * beam * smoothstep(.10, .26, r2) * exp(-max(0., r2 - .24) * 2.6) * (.62 + .16 * slow));
  // and now and then a soft band of gold going across behind him
  float bnd = fract(T * .135) * 2.1 - .55, across = (uv.x * .86 + uv.y * .50);
  c = screen(c, vec3(1., .76, .34) * exp(-pow((across - bnd) * 7.5, 2.)) * .42);
  // golden haze low down, drifting
  float hz = fbm(vec2(uv.x * 2.6 - T * .05, uv.y * 5. + T * .02));
  c = screen(c, vec3(.95, .60, .20) * smoothstep(.40, .82, hz) * smoothstep(.42, .88, uv.y) * .13);
  // the painted gold: the rune on the arch, the light on moss and bark
  float beat = .5 + .5 * sin(T * 1.05 + uv.x * 5.);
  c += vec3(1., .70, .24) * sm.g * (.06 + .30 * beat * (.6 + .6 * fbm(uv * 9. + T * .15)));
  vec2 ru = uv - vec2(.873, .343);
  float rb = .55 + .45 * sin(T * 1.2);
  c = screen(c, vec3(1., .70, .26) * exp(-dot(ru, ru) * 95.) * (.28 + .30 * rb));
  c += vec3(1., .86, .5) * sm.g * exp(-dot(ru, ru) * 190.) * rb * .75;
  // the leaves overhead catch it
  float gl = fbm(uv * 13. + vec2(T * .16, -T * .07));
  c += vec3(1., .50, .20) * sm.b * smoothstep(.46, .78, gl) * .55;

  // ── soft discs of light, far off, drifting up ──
  for (int i = 0; i < 9; i++) {
    float s = float(i) + 3., sp = .018 + .014 * h1(s * 3.), l = fract(T * sp + h1(s * 5.)), id = floor(T * sp + h1(s * 5.));
    vec2 bp = vec2(h2(vec2(id, s)) + .03 * sin(T * .3 + s), 1.02 - l * 1.0);
    float r = mix(.014, .044, h1(s * 7. + 1.)), d = length(uv - bp);
    float disc = smoothstep(r, r * .78, d) * (.55 + .45 * smoothstep(r * .4, r, d));
    c = screen(c, vec3(1., .74, .32) * disc * .40 * sin(3.14159 * l) * (.6 + .4 * sin(T * .8 + s * 2.)));
  }
  // leaves coming down behind him
  for (int i = 0; i < 11; i++) {
    float s = float(i) + 1., z = h1(s * 4.1);
    vec4 lf = leaf(uv, s, mix(.052, .088, z), mix(.062, .100, z));
    c = mix(c, lf.rgb * vec3(1.14, .80, .66), lf.a * .96);
  }

  // ── HIM: exactly as painted, with the light on his edge ──
  vec3 him = pic;
  him = screen(him, vec3(1., .70, .30) * hm.g * (.34 + .16 * slow2) * (.5 + .9 * wisp));
  him = screen(him, vec3(1., .78, .42) * shaft * .10);
  c = mix(c, him, hero_);

  // ── near: dust in the light ──
  for (int i = 0; i < 34; i++) {
    float s = float(i) + 40., z = h1(s * 1.9);
    vec2 fp = vec2(fract(h1(s) + T * .006 * (z - .4)) + .03 * sin(T * (.3 + .3 * z) + s), fract(h1(s * 5.3) - T * (.020 + .032 * z)));
    float r = mix(.0030, .0082, z * z), d = length(uv - fp), tw = pow(.5 + .5 * sin(T * (.8 + z) + s * 4.), 2.);
    c += vec3(1., .82, .46) * (smoothstep(r, 0., d) + smoothstep(r * 5., 0., d) * .30) * tw * mix(bg, 1., step(.72, z)) * smoothstep(0., .08, fp.y) * 1.05;
  }
  o = vec4(c, 1.);
}`;

interface Pic { canvas: HTMLCanvasElement; draw: (t: number) => boolean; free: () => void }
/** Which way the same pieces are lit. */
export type LivingLook = 'flame' | 'storm' | 'gold';

function build(set: LivingSet, look: LivingLook): Pic | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (ty: number, src: string): WebGLShader => { const s = gl.createShader(ty)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `#version 300 es\n${look === 'storm' ? '#define STORM\n' : ''}${look === 'gold' ? FS_GOLD : FS}`));
  gl.linkProgram(pr);
  let ready = 0;
  let dead = false;
  // only the pieces this skin has (a picture whose hero never parts from its ground needs no pieces of him)
  const names = LIVING_PIECES.filter((n) => set[n]);
  const unis = names.map((n) => (n === 'herodata' ? 'hd' : n === 'scenedata' ? 'sd' : n));
  names.forEach((n, i) => {
    const im = new Image();
    im.src = set[n]!;
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
export function showLiving(key: string, set: LivingSet, look: LivingLook, out: HTMLCanvasElement, onFirst: () => void): () => void {
  let l = lives.get(key);
  if (!l) {
    l = { pic: build(set, look), outs: new Set(), seen: new Set(), raf: 0, last: 0, late: null, io: null, t0: performance.now() };
    lives.set(key, l);
  }
  const live = l;
  if (live.late) { clearTimeout(live.late); live.late = null; }
  if (!live.pic) return () => undefined;
  out.width = out.height = 420;
  let first = true;
  live.io ??= typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { for (const e of es) { const c = e.target as HTMLCanvasElement; if (e.isIntersecting) live.seen.add(c); else live.seen.delete(c); } }) : null;
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
