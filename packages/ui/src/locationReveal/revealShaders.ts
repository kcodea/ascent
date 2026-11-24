/**
 * THE LOCATION REVEAL's shaders (GLSL ES 3.00), from the owner-approved prototype (2026-11-24). `COMMON` is prepended to every one.
 * Scene units: one stage height is 1, the stage is 16:9, the origin is its centre, y points down.
 */

export const common = String.raw`precision highp float;
#define TAU 6.2831853
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p){ return vec2(h21(p), h21(p + 37.7)); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
float fb(vec2 p){ float a = .5, r = 0.; for (int i = 0; i < 4; i++) { r += a * n2(p); p = p * 2.03 + 7.1; a *= .5; } return r; }
float smoother(float u){ u = clamp(u, 0., 1.); return u * u * u * (u * (u * 6. - 15.) + 10.); }
const float A = 99. / 42., FOC = 1.2;   // the paintings are 21:9 and the stage is one whole painting
uniform vec2 GEM;   // where the gate holds its crystal
uniform float VA;    // how wide the window shows the stage (stage heights)
uniform vec2 VP, OFS; /* where it lands on the stage; how far the painting is slid to fit a wide window */  uniform float MGK; uniform vec3 DEEP, SECOND, COOL, WARMC;
vec3 mg(vec3 c){ if (MGK < .5) return c; float M = max(c.r, max(c.g, c.b)) + 1e-5, m = min(c.r, min(c.g, c.b)); vec3 t = mix(COOL, WARMC, smoothstep(-.15, .15, (c.r - c.b) / M)); return M * mix(vec3(1.), t, min((M - m) / M * 1.25, 1.)); }
// the wave: leaves the point of impact fast and eases toward the edges. waveAt = when it reaches a distance.
const float WR = 2.90, WK = 1.45;
vec3 comet(float t, float t0, float L){ float u = clamp((t - t0) / (L - t0), 0., 1.), e = u - .07 * sin(TAU * u) / 3.14159, v = 1. - e; vec2 vp = (VP - .5) * vec2(A, 1.); vec2 p = v * v * v * GEM + 3. * v * v * e * vec2(-.46, .24) + 3. * v * e * e * (vp * .55 + vec2(-.05, -.34)) + e * e * e * vp; return vec3(p, -.02 + pow(max(sin(3.14159 * u), 0.), .9)); }
// a place in the current: q is 0 at the comet and 1 as it passes you; th0 is the side it belongs to
vec2 arm(float th0, float q, float tight){ float st = TAU / 6., k = floor(th0 / st + .5) * st; float th = k + (th0 - k) * tight + .62 * (1. - q) * (1. - q) - .30; return vec2(cos(th) * .703 * VA, sin(th) * .88); }
vec3 current(float q, float th0, float tight, float wide, float s, float t0, float L){ vec3 head = comet(s, t0, L), was = comet(s - q * .42, t0, L); float rad = mix(.012, .50 + .62 * wide, pow(q, 1.2)); return vec3(mix(head.xy, was.xy, .9) * (1. - .7 * q * q) + arm(th0, q, tight) * rad, mix(head.z, -1.04, pow(q, .9))); }
float waveAt(float r){ return -log(max(1. - r / WR, .02)) / WK; }`;

export const vsFull = String.raw`in vec2 a; void main(){ gl_Position = vec4(a, 0.9999, 1.); }`;

export const fsGround = String.raw`out vec4 o;
uniform vec2 R, foc; uniform float s, d, beam, back, dim; uniform sampler2D FL; uniform vec3 heart;
vec3 facets(vec2 p, float lod, out float edge){
  vec2 g = floor(p), f = fract(p); float d1 = 9., d2 = 9.; vec2 id = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 k = vec2(x, y), c = k + h22(g + k) - f; float q = abs(c.x) * .75 + abs(c.y) + dot(c, c) * .35; if (q < d1) { d2 = d1; d1 = q; id = g + k; } else if (q < d2) d2 = q; }
  edge = smoothstep(.10, .0, d2 - d1); vec2 bend = (h22(id + 5.) - .5);
  return textureLod(FL, clamp(VP - OFS + bend * .75 + vec2(0., -.06), .02, .98), lod).rgb * (.45 + .8 * h21(id + 11.));
}
void main(){
  vec2 uv = gl_FragCoord.xy / R; uv.y = 1. - uv.y; vec2 p = (uv - foc) * vec2(A, 1.); float r = length(p) + 1e-4;
  vec3 c = mix(DEEP * .25, DEEP, smoothstep(1.2, .1, r)); float e;
  for (int i = 0; i < 3; i++) { float fi = float(i), z = fract(fi / 3. + d * .30), sc = mix(5., .8, z), w = sin(z * 3.14159); vec3 k = facets(p * sc + vec2(fi * 17.3, fi * 9.1), 5. - z * 1.8, e); k = pow(k, vec3(1.5)) * mix(vec3(1.1), mg(vec3(.46, .88, 1.2)), .75); c += k * w * .15 * smoothstep(.05, .5, r) + mg(vec3(.30, .78, 1.)) * e * w * .03 * smoothstep(.1, .6, r); }
  // curtains of magic that roll past as you go
  for (int i = 0; i < 3; i++) { float fi = float(i), z = fract(fi / 3. + .17 + d * .24), sc = mix(3.4, .55, z), w = sin(z * 3.14159); vec2 q = p * sc + vec2(fi * 7.7, fi * 3.1); float f = fb(q * 1.15 + vec2(fb(q * .7 + fi) * 1.8, d * .08)); float fil = exp(-abs(f - .48) * 26.), veil = smoothstep(.42, .70, f); vec3 hue = mix(mix(mg(vec3(.10, .62, 1.)), SECOND, n2(q * .6 + 3.)), mg(vec3(.52, .22, 1.)), smoothstep(.45, .75, n2(q * .5 + 11.))); c += hue * (fil * .13 + veil * .12) * w * smoothstep(.04, .45, r); }
  float ray = n2(vec2(atan(p.y, p.x) * 5.1, 3. + s * .25)) * .6 + n2(vec2(atan(p.y, p.x) * 13., 9. - s * .4)) * .4;
  c += mg(vec3(1., .78, .46)) * exp(-r * 7.) * (.18 + .9 * beam) + mg(vec3(.16, .52, 1.)) * exp(-r * 2.4) * (.10 + .46 * beam) + mix(mg(vec3(1., .82, .55)), mg(vec3(.35, .75, 1.)), smoothstep(.1, .6, r)) * pow(ray, 4.) * exp(-r * 1.7) * (.15 + 1.2 * beam);
  // when the pieces are in place the light behind them swells, so the gaps burn
  c = mix(c, c * .5 + mg(vec3(.40, .78, 1.)) * (.42 + .45 * exp(-r * 2.6)) + mg(vec3(1., .70, .34)) * exp(-r * 4.2) * .7, back);
  vec2 hp = p; c += mg(vec3(.4, .75, 1.)) * heart.z * .12 * exp(-dot(hp, hp) * 5.);
  o = vec4(max(c * dim, 0.), 1.);
}`;

export const fsScene = String.raw`out vec4 o;
uniform vec2 R, pan; uniform float s, push, dof, after, drain; uniform sampler2D DT, L0, L1, L2, L3;
uniform float near_; const vec4 DEP = vec4(.0, .075, .150, .250);
vec2 at(vec2 rel, float dep, float k){ return VP - OFS + (rel * .962 - pan * dep) / (1. + dep * k); }
vec2 wind(vec2 q, float amt, float gust, vec2 dir){ float n = texture(DT, q).g * amt; return q + n * (vec2(sin(q.y * 15. + s * 2.6 + q.x * 7.), .45 * cos(q.x * 13. + s * 2.1)) * .0022 * (gust * 1.4 + .22) - dir * .0034 * gust); }
vec4 lay(sampler2D t, vec2 q, float f){ return textureLod(t, q, dof + f); }
vec3 haze(vec3 c, vec2 uv, float dep, float k, float amt){ vec2 q = at(uv - VP, dep, k); float f = fb(q * vec2(3.2, 5.) + vec2(s * .05 + dep * 30., -s * .015)); float low = smoothstep(.25, 1., uv.y); return c + mg(vec3(.62, .80, 1.)) * smoothstep(.42, .85, f) * amt * .6 * (.35 + .65 * low); }
vec3 flow(vec3 c, vec2 q){ float f = texture(DT, q).b; float run = n2(vec2(q.x * 190., q.y * 30. - s * 8.)) * .6 + n2(vec2(q.x * 420., q.y * 52. - s * 13.)) * .4; return c + c * f * (run - .48) * .95 * (1. - smoothstep(0., 1.6, dof) * .7); }
void main(){
  vec2 uv = gl_FragCoord.xy / R; vec2 rel = uv - VP; float rr = length(rel * vec2(A, 1.)), lt = after - waveAt(rr) + (fb(uv * 7.) - .5) * .05;
  float hv = lt > 0. ? exp(-lt * 5.) * sin(min(lt * 9., 3.14159)) : 0., gust = lt > 0. ? exp(-lt * 1.3) : 0.; float k = push + hv * .9; vec2 dir = normalize(rel + 1e-5);
  vec2 q = at(rel, DEP.w * texture(DT, uv - OFS).r, k); q = at(rel, DEP.w * texture(DT, q).r, k); q = at(rel, DEP.w * texture(DT, q).r, k); vec3 c = flow(textureLod(L0, q, dof).rgb, q);
  q = wind(at(rel, DEP.y, k), .8, gust, dir); vec4 t = lay(L1, q, 0.); c = haze(c, uv, .04, k, .16); c = mix(c, flow(t.rgb, q), t.a);
  q = wind(at(rel, DEP.z, k), 1., gust, dir); t = lay(L2, q, near_ * .55); c = haze(c, uv, .11, k, .11); c = mix(c, t.rgb, t.a);
  q = wind(at(rel, DEP.w, k), 1.2, gust, dir); t = lay(L3, q, near_); c = haze(c, uv, .20, k, .07); c = mix(c, t.rgb, t.a);
  c *= 1. - .16 * smoothstep(0., 3., dof);
  float wash = lt > 0. ? smoothstep(0., .15, lt) : 0., rich = lt > 0. ? exp(-lt * 1.9) : 0., g = dot(c, vec3(.30, .59, .11));
  vec3 ink = mix(DEEP * .5, mix(vec3(.80, .86, .95), mg(vec3(.80, .92, 1.)), .6), pow(g, 1.15)) * .80; c = mix(c, ink, drain * (1. - wash) * .92);
  g = dot(c, vec3(.30, .59, .11)); c = max(mix(vec3(g), c, 1. + .10 * rich * wash), 0.); 
  o = vec4(c, 1.);
}`;

export const fsWeld = String.raw`out vec4 o; uniform vec2 R; uniform float s, after; uniform sampler2D SC;
void main(){ vec2 u = gl_FragCoord.xy / R, uv = vec2(u.x, 1. - u.y); float rr = length((uv - VP) * vec2(A, 1.)); float lt = after - waveAt(rr) - (n2(uv * 13.) - .5) * .03; float al = smoothstep(-.02, .16, lt); vec3 c = textureLod(SC, uv, 0.).rgb;
  c += (mg(vec3(.40, .85, 1.)) * .42 + mg(vec3(1., .80, .50)) * .30) * exp(-max(lt, 0.) * 16.) * step(0., lt);      // the fresh weld is still glowing
  o = vec4(c, al); }`;

export const fsEmber = String.raw`out vec4 o; uniform vec2 R, pan; uniform float s, ember, warmth, push;
void main(){ vec2 uv = gl_FragCoord.xy / R; uv.y = 1. - uv.y; vec3 c = vec3(0.); for (int k = 0; k < 4; k++) { float fk = float(k), g = 5. + fk * 4.; float ed = .30 - fk * .07; vec2 uq = VP + (uv - VP - pan * ed) / (1. + ed * push); vec2 q = uq * vec2(A, 1.) * g + vec2(sin(s * .5 + fk) * .4, s * (.5 + fk * .16)); vec2 id = floor(q); float h = h21(id + fk * 31.); if (h < .8) continue; vec2 p = fract(q) - .5 - (h22(id + 3.) - .5) * .7; float tw = .55 + .45 * sin(s * (3. + h * 5.) + h * 40.), sz = mix(.012, .032, h21(id + 17.)), dd = length(p); c += mix(mg(vec3(.50, .85, 1.)), vec3(1., .66, .28), step(1. - .2 * warmth - .02, h)) * (exp(-dd * dd / (sz * sz)) * 1.2 + exp(-dd / (sz * 3.)) * .1) * tw * ember; } o = vec4(c, 1.); }`;

export const vsQuad = String.raw`in vec2 a; uniform vec4 box; uniform float z; out vec2 uv; void main(){ uv = a; vec2 p = box.xy + (a - .5) * box.zw; float w = (FOC + z) / FOC; gl_Position = vec4(p.x * 2. / A, -p.y * 2., ((z + FOC) / 10. * 2. - 1.) * w, w); }`;

export const fsDoor = String.raw`in vec2 uv; out vec4 o; uniform sampler2D T; uniform float left, lit, dark, ring, ringS;
void main(){ float e = left > .5 ? 1. - uv.x : uv.x; vec2 q = vec2(e * .889, (uv.y - .4612)); float rr = length(q); vec2 dir = normalize(vec2((left > .5 ? -1. : 1.) * q.x, q.y) + 1e-5); float w = exp(-pow((rr - ring) * 11., 2.)) * ringS;
  vec3 c = texture(T, uv - dir * w * .030).rgb * (1. - dark); float rim = exp(-e * 5.); c += c * vec3(.55, .9, 1.25) * lit * (rim * 1.1 + .10) + vec3(.35, .78, 1.1) * (exp(-e * 60.) * 1.3 + exp(-e * 14.) * .22) * lit; c += c * vec3(.6, .95, 1.2) * w * 1.6; o = vec4(c, 1.); }`;

export const fsCry = String.raw`in vec2 uv; out vec4 o; uniform sampler2D T; uniform float crack;
void main(){ vec4 t = texture(T, uv); vec2 p = uv * 5.; vec2 g = floor(p), f = fract(p); float d1 = 9., d2 = 9.; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 k = vec2(x, y), c = k + h22(g + k) - f; float q = dot(c, c); if (q < d1) { d2 = d1; d1 = q; } else if (q < d2) d2 = q; }
  float r = length(uv - vec2(.46, .4)); float line = smoothstep(.10, .0, sqrt(d2) - sqrt(d1)) * smoothstep(crack * 1.1, crack * 1.1 - .25, r) * step(.01, crack);
  vec3 c = t.rgb * (1. + crack * 1.6) + vec3(.8, .97, 1.) * line * 3.4 + vec3(.5, .9, 1.) * pow(crack, 3.) * 1.3; o = vec4(c, t.a); }`;

export const vsShard = String.raw`in vec4 v0; in vec4 ct; in vec4 sd; in vec3 en; // x,y,depth,edge distance ; centre, gather start, distance then ; seeds ; edge normal + is-side
uniform float s, t0, L, d; out vec2 uvH; out float born;
 out vec3 nrm, edg, wp; out float h, asm_, seed, weld, rr_, side, arr, zz;
mat3 rot(vec3 ax, float a){ ax = normalize(ax); float c = cos(a), k = sin(a), q = 1. - c; return mat3(c + ax.x * ax.x * q, ax.x * ax.y * q + ax.z * k, ax.x * ax.z * q - ax.y * k, ax.x * ax.y * q - ax.z * k, c + ax.y * ax.y * q, ax.y * ax.z * q + ax.x * k, ax.x * ax.z * q + ax.y * k, ax.y * ax.z * q - ax.x * k, c + ax.z * ax.z * q); }
void main(){
  vec2 ctr = ct.xy, vpc = (VP - .5) * vec2(A, 1.), rel = ctr - vpc; float tt = max(0., s - t0), dist = length(rel), st = ct.z;
  float boom = 1.05 * (1. - exp(-tt * 3.6));            // bursts, hangs, goes
  vec3 bdir = normalize(vec3(rel * vec2(1., 1.4) / max(dist, .12) * .9 + (sd.xy - .5) * .9, (sd.z - .60) * 1.4));
  vec3 burst = vec3(GEM + ctr * .055, -.03) + bdir * boom * (.30 + .75 * sd.w);
  // the ride: a piece keeps to the side of the picture it belongs to, so it never has to cross the others to get home
  // the current: pieces are born off the comet and ride it back past you
  float th = atan(rel.y, rel.x), q0 = sd.z + sd.y * .37, qm = s < st ? fract(q0 + d * .33) : fract(q0 + ct.w * .33) + (d - ct.w) * .33, qv = clamp(qm, 0., 1.02);
  vec3 str = current(qv, th, .62, sd.y, s, t0, L);
  float zl = str.z; float ride = smoother((tt - .02) / .85);
vec3 fly = mix(burst, str, ride); float vis = mix(1., smoothstep(.0, .12, qv) * smoothstep(1.02, .95, qv), ride); born = ride * exp(-qv * 7.);
  // coming home: one long magnetic swoop, neighbours bending the same way
  float as = smoother(pow(clamp((s - st) / .74, 0., 1.), 1.25)), bow = sin(as * 3.14159);
  float flow = (n2(ctr * 2.1 + 5.) - .5) * 2.; vec2 perp = vec2(-rel.y, rel.x) / max(dist, .2);
  float inh = 0.; float since = s - L - waveAt(dist);
  float wd = since > 0. ? 1. - exp(-since * 17.) * (1. + since * 17.) : 0.;                                             // slammed flat by the wave, with a bounce
  float pre = s > L ? smoothstep(-.07, 0., since) * .6 : 0.;                                               // it feels the wave a moment early
  vec3 off = vec3(rel * mix(.034, .014, smoothstep(st + .5, L + .05, s)), -(.008 + .050 * sd.w) * mix(1.3, .7, smoothstep(st + .5, L + .05, s))) * vec3(vec2(1. + .55 * inh), 1. + .75 * inh + 1.4 * pre);
  vec3 home = vec3(ctr, 0.) + off * vec3(vec2(1. - clamp(wd, 0., 1.)), 1. - wd); home.xy *= (FOC + home.z) / FOC;
  vec3 pos = mix(fly, home, as); pos.xy += perp * bow * .20 * flow; pos.z -= bow * .10 * sd.w;
  float big = smoothstep(.80, .95, sd.w); float grow = mix(.10, mix(.40 + .22 * sd.y, 1.02, big), smoothstep(0., .8, tt)) * vis; grow = mix(grow, 1. - .022 * (1. - clamp(wd, 0., 1.)), as);
  float tum = 1. - smoothstep(.10, .9, tt); vec2 fl = normalize(rel + 1e-4); float lean = (1. - as) * ride * (.55 + .30 * (sd.x - .5));
  mat3 m = rot(sd.xyz - .48, tum * (sd.x - .5) * 7.); m = rot(vec3(-fl.y, fl.x, .0001), -lean) * m; m = rot(vec3(0., 0., 1.), (1. - as) * ((sd.w - .5) * .9 + (sd.x - .5) * .5 * s)) * m;
  float tl = (1. - wd) * as * (.06 + .16 * pre); m = rot(vec3(-rel.y + (sd.x - .5) * .5, rel.x + (sd.y - .5) * .5, .01), tl) * m;
  vec3 loc = vec3((v0.xy - ctr) * grow, v0.z * mix(1.6, 1., as) * min(grow, 1.)); pos += m * loc;
  nrm = en.z > .5 ? m * vec3(en.xy, 0.) : m * vec3(0., 0., v0.z > .001 ? 1. : -1.); edg = m * vec3(en.xy, 0.); side = en.z; h = v0.w; asm_ = as; seed = sd.w; weld = clamp(wd, 0., 1.); arr = s - (st + .66); rr_ = dist; wp = pos;
  vec2 hm = v0.xy / vec2(A, 1.) + .5, hc = ctr / vec2(A, 1.) + .5; vec2 hin = mix(clamp(hc, .16, .84), hc, as); uvH = hin + (hm - hc) * mix(1.5, 1., as) + nrm.xy * .05 * (1. - as); zz = pos.z;
  float w = max((FOC + pos.z) / FOC, .02); gl_Position = vec4(pos.x * 2. / A, -pos.y * 2., ((pos.z + FOC) / 10. * 2. - 1.) * w, w);
}`;

export const fsShard = String.raw`in vec2 uvH; in vec3 nrm, edg, wp; in float h, asm_, seed, weld, rr_, side, arr, zz, born; out vec4 o; uniform sampler2D FL, SC; uniform float s, t0, L; uniform vec3 heart; uniform float heartZ;
void main(){
  float g = 1. - asm_, gl2 = max(g, .42 * (1. - weld)); vec3 fn = normalize(nrm); float bev = smoothstep(mix(.011, .022, g), 0., h) * (1. - side);
  vec3 n = normalize(fn + normalize(edg + 1e-5) * bev * .9); float facing = abs(n.z);
  vec2 u = clamp(uvH + n.xy * bev * .018 * gl2, .004, .996), ca = n.xy * .003 * g;
  vec2 fu = u - OFS; vec3 far = vec3(texture(FL, fu + ca).r, texture(FL, fu).g, texture(FL, fu - ca).b); vec3 near = textureLod(SC, u, 0.).rgb; vec3 img = mix(far, near, smoothstep(.75, 1., asm_));
  vec3 lt = normalize(vec3(-.35, -.75, -.55)); float sp = pow(max(dot(n, lt), 0.), 26.) + pow(max(dot(-n, lt), 0.), 26.);
  float fres = pow(1. - facing, 2.2); vec3 ice = mix(vec3(.14, .42, .88), vec3(.58, .95, 1.), seed); ice = mix(ice, mg(ice), smoothstep(.15, .8, s - t0));
  vec3 c = img * mix(1.15, 1., asm_); c = mix(c, c * .62 + ice * .5, g * .10 + fres * .62 * gl2);
  c = mix(c, (ice * (.35 + .55 * facing) + img * .35) * mix(.35, 1., g), side);                                                            // the cut edge of the slab
  c += ice * bev * .34 * mix(gl2, g, .6) + vec3(.92, 1., 1.) * sp * (1.5 * g + .45 * gl2) * (.6 + bev);
  vec3 hd = heart - wp; float hl = heartZ / (1. + dot(hd, hd) * 14.); c += (ice * .35 + img * vec3(1., .86, .62) * .9) * hl * (.35 + .65 * max(dot(n, normalize(hd)), 0.) + bev * .8);
  // the seams: backlit while it waits, white-hot as the wave reaches them, gone behind it
  float wt = s - L - waveAt(rr_); float lit = smoothstep(L - .30, L, s) * step(s, L + 2.); float seam = smoothstep(.0042, .0005, h) * (1. - side); float edgeHot = exp(-pow(wt * (wt > 0. ? 22. : 30.), 2.));
  c += (mg(vec3(.40, .85, 1.)) * 1.1 + mg(vec3(1., .80, .45)) * exp(-rr_ * 3.) * 1.3) * seam * lit * asm_ * (.15 + .42 * smoothstep(L - .20, L, s)) * (1. - weld) + (mg(vec3(.6, .95, 1.)) * seam * 2.6 + img * .55 + mg(vec3(.04, .12, .16))) * edgeHot * step(L, s);
  c += (vec3(.9, .97, 1.) * (.07 + bev * .40) + mg(vec3(1., .85, .55)) * seam * .35) * exp(-pow(arr * 15., 2.)) * (1. - side);   // a little glint as each one settles
  c += ice * (1. - smoothstep(0., .32, s - t0)) * 1.3;
  c = mix(c, mg(vec3(.10, .34, .72)) * .75 + DEEP, smoothstep(.1, 1.1, zz) * .55 * g); c += (mg(vec3(.35, .80, 1.)) * .9 + mg(vec3(1., .82, .5)) * .8) * born * g;
  o = vec4(c, 1.);
}`;

export const vsSpl = String.raw`in vec3 v, nv; in vec4 sd, se; uniform float s, t0, L, d, v_; out vec3 nrm; out float seed, al;
mat3 rot(vec3 ax, float a){ ax = normalize(ax); float c = cos(a), k = sin(a), q = 1. - c; return mat3(c + ax.x * ax.x * q, ax.x * ax.y * q + ax.z * k, ax.x * ax.z * q - ax.y * k, ax.x * ax.y * q - ax.z * k, c + ax.y * ax.y * q, ax.y * ax.z * q + ax.x * k, ax.x * ax.z * q + ax.y * k, ax.y * ax.z * q - ax.x * k, c + ax.z * ax.z * q); }
void main(){
  float tt = max(0., s - t0); float boom = 1.25 * (1. - exp(-tt * 3.2));
  vec3 dir = normalize(vec3(sd.xy - .5, (sd.z - .55) * .9)); vec3 burst = vec3(GEM, 0.) + dir * boom * (.3 + 1.1 * sd.w) + vec3(0., tt * tt * .08, 0.);
  float th = se.x * TAU, rad = .16 + 1.15 * sqrt(se.y); float z = 4.6 - mod(se.z * 5.7 + d * (1.9 + 1.2 * se.w), 5.7);
  float q = fract(se.z + d * (.34 + .16 * se.w)); vec3 str = current(q, th, .42, se.y, s, t0, L); z = str.z;
  float ride = smoother((tt - .02) / .80); vec3 c = mix(burst, str, ride);
  float gone = smoothstep(L - .45, L - .08, s + .12 * se.x);
  float sz = mix(.004, .018, pow(sd.w, 2.)) * smoothstep(0., .06, tt) * (1. - gone);
  mat3 m = rot(se.xyz - .5, sd.x * 9. + s * (1. + 5. * sd.y)); vec3 p = m * (v * vec3(1., 2.1, 1.)) * sz; p = mix(p, vec3(0., 0., p.y * 9. + p.z * 3.) + p * .6, v_ * ride * .85); vec3 pos = c + p;
  nrm = m * nv; seed = se.w; al = mix(1., smoothstep(0., .10, q) * smoothstep(1., .94, q), ride) * smoothstep(-1.1, -.95, pos.z);
  float w = max((FOC + pos.z) / FOC, .02); gl_Position = vec4(pos.x * 2. / A, -pos.y * 2., ((pos.z + FOC) / 10. * 2. - 1.) * w, w);
}`;

export const fsSpl = String.raw`in vec3 nrm; in float seed, al; uniform float magic; out vec4 o; void main(){ vec3 n = normalize(nrm); vec3 lt = normalize(vec3(-.35, -.75, -.55)); float k = .5 + .5 * dot(n, lt); vec3 ice = mix(vec3(.10, .34, .80), vec3(.55, .95, 1.), k); ice = mix(ice, vec3(.80, .62, 1.), step(.86, seed) * .6); ice = mix(ice, mg(ice), magic); ice += vec3(1.) * pow(max(dot(n, lt), 0.), 14.) * 1.8 + vec3(.5, .9, 1.) * pow(1. - abs(n.z), 3.) * .8; o = vec4(ice, al); }`;

export const vsDeb = String.raw`in vec3 v, nv; in vec4 sd, se; uniform float s, L; out vec3 nrm; out float seed, al;
mat3 rot(vec3 ax, float a){ ax = normalize(ax); float c = cos(a), k = sin(a), q = 1. - c; return mat3(c + ax.x * ax.x * q, ax.x * ax.y * q + ax.z * k, ax.x * ax.z * q - ax.y * k, ax.x * ax.y * q - ax.z * k, c + ax.y * ax.y * q, ax.y * ax.z * q + ax.x * k, ax.x * ax.z * q + ax.y * k, ax.y * ax.z * q - ax.x * k, c + ax.z * ax.z * q); }
void main(){
  float u = max(0., s - L); vec2 vpc = (VP - .5) * vec2(A, 1.); float th = se.x * TAU; vec3 dir = normalize(vec3(cos(th), sin(th) * .8, -mix(.10, .95, se.y)));
  float sp = mix(2.2, 6.5, sd.w), run = sp * (1. - exp(-u * 3.2)) / 3.2; vec3 pos0 = vec3(vpc, -.02) + dir * (run + .02) + vec3(0., u * u * .55, 0.);
  float sz = mix(.003, .013, pow(sd.z, 3.)) * smoothstep(.95, .35, u + se.z * .35) * step(.001, u); mat3 m = rot(se.xyz - .5, sd.x * 9. + u * (6. + 14. * sd.y) * exp(-u)); vec3 p = m * (v * vec3(1., 1.7, 1.)) * sz; p += dir * dot(p, dir) * 9. * exp(-u * 7.); vec3 pos = pos0 + p;
  nrm = m * nv; seed = se.w; al = smoothstep(-1.12, -.85, pos.z) * smoothstep(0., .03, u);
  float w = max((FOC + pos.z) / FOC, .02); gl_Position = vec4(pos.x * 2. / A, -pos.y * 2., ((pos.z + FOC) / 10. * 2. - 1.) * w, w);
}`;

export const vsLight = String.raw`in vec4 lp; in vec3 lc; uniform vec2 pan; uniform float s, after, push, px, dof; out vec3 tint; out float al, pop; void main(){ vec2 rel = lp.xy + OFS - VP; float rr = length(rel * vec2(A, 1.)), u = after - waveAt(rr); float dp = lp.w; vec2 p = VP + (rel * (1. + dp * push) + pan * dp) / .962; gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.); float seed = fract(lp.x * 71.3 + lp.y * 37.1); pop = u > 0. ? (u * 9.) * exp(1. - u * 9.) : 0.; float spring_ = u > 0. ? 1. - exp(-u * 10.) * (1. + u * 10.) : 0.; float fl = .88 + .08 * sin(s * (3.4 + 2. * seed) + seed * 40.) + .04 * sin(s * (7. + 3. * seed)); gl_PointSize = px * lp.z * (92. + 150. * pop) * max(spring_, 0.); tint = lc; al = step(0., u) * spring_ * fl * (.26 + 1.0 * pop) * (1. - .35 * smoothstep(0., 1.6, dof)); }`;

export const fsLight = String.raw`in vec3 tint; in float al, pop; out vec4 o; void main(){ vec2 q = (gl_PointCoord - .5) * 2.; float r = length(q); float st = exp(-abs(q.x) * 26.) * exp(-abs(q.y) * 5.) + exp(-abs(q.y) * 26.) * exp(-abs(q.x) * 5.); o = vec4((tint * exp(-r * r * 5.5) * .55 + mix(tint, vec3(1.), .5) * (exp(-r * r * 60.) * .35 + st * pop * 1.1)) * al * smoothstep(1., .75, r), 1.); }`;

export const vsSuck = String.raw`in vec4 sd, se; uniform float s, t0, px; out vec3 tint; out float al;
void main(){ float st = t0 - .38 + .20 * sd.x, u = clamp((s - st) / (t0 - .03 - st), 0., 1.), e = u * u * u; float th = sd.y * TAU + e * (2.2 + 1.8 * se.x), r = mix(.16 + .42 * sd.z, .0, e); vec2 p = GEM + vec2(cos(th) * 1.2, sin(th)) * r; gl_Position = vec4(p.x * 2. / A, -p.y * 2., 0., 1.); gl_PointSize = px * (2. + 5. * pow(se.w, 4.)) * (1. - .4 * e); tint = mix(mix(vec3(.30, .72, 1.), vec3(.75, .97, 1.), sd.w), vec3(1., .82, .48), step(.8, se.y)); al = smoothstep(0., .25, u) * step(u, .995) * .8; }`;

export const vsTrail = String.raw`in vec4 sd, se; uniform float px; out vec3 tint; out float al; void main(){ float age = sd.w; vec3 pos = sd.xyz + (vec3(h11(se.x), h11(se.x + 3.1), h11(se.x + 7.7)) - .5) * vec3(.10, .10, .06) * age; float w = max((FOC + pos.z) / FOC, .03); gl_Position = vec4(pos.x * 2. / A, -pos.y * 2., ((pos.z + FOC) / 10. * 2. - 1.) * w, w); gl_PointSize = clamp(px * mix(30., 12., age) * smoothstep(0., .06, age) * (.6 + .8 * h11(se.x + 1.7)) / w, 1., 60.); tint = mix(mix(vec3(1.), mg(vec3(1., .82, .48)), smoothstep(0., .25, age)), mg(vec3(.30, .72, 1.)), smoothstep(.2, .8, age)); al = (1. - age) * (1. - age) * .62 * se.y * (.6 + .4 * sin(se.z * 14. + se.x * 50.)); }`;

export const vsDust = String.raw`in vec4 sd, se; uniform float s, t0, L, d, px; out vec3 tint; out float al;
void main(){
  float tt = max(0., s - t0), rb = floor(sd.x * 7.), fr = fract(sd.x * 7.); float u = fract(se.x + d * (.26 + .10 * sd.y));
  vec3 str = current(u, floor(sd.x * 6.) * TAU / 6. - 3.14159 + (se.y - .5) * .9, .34, se.z * .9, s, t0, L); str.xy += (vec2(h11(se.w * 91.), h11(se.w * 17.)) - .5) * .05 * u;
  vec3 dir = normalize(vec3(sd.zw - .5, se.y - .6)); vec3 burst = vec3(GEM, 0.) + dir * (1. - exp(-tt * 6.)) * (.15 + .85 * se.w); float ride = smoother((tt - .02) / .80);
  vec3 pos = mix(burst, str, ride);
  // the last breath before impact draws the dust in to the point where it will land
  float suck = smoothstep(L - .80 + .20 * se.w, L, s); pos = mix(pos, vec3((VP - .5) * vec2(A, 1.), .02), suck * suck); float gone = smoothstep(L - .12, L, s);
  float w = max((FOC + pos.z) / FOC, .02); gl_Position = vec4(pos.x * 2. / A, -pos.y * 2., ((pos.z + FOC) / 10. * 2. - 1.) * w, w);
  float tw = .6 + .4 * sin(s * 9. + se.w * 60.); gl_PointSize = clamp(px * (2.2 + 5. * pow(se.w, 5.)) / w, 1., 46.) * (1. - .55 * suck);
  tint = mix(mix(vec3(.25, .65, 1.), vec3(.75, .97, 1.), fr), vec3(1., .80, .45), step(.82, sd.y) * .85); tint = mix(tint, mix(mg(tint), SECOND, step(.62, fr) * .55), smoothstep(.1, .7, tt)); al = smoothstep(0., .05, tt) * tw * (1. - gone) * mix(.9, mix(smoothstep(0., .12, u) * smoothstep(1., .86, u), 1., suck * .5), ride) * .62 * (1. - .6 * suck);
}`;

export const vsGust = String.raw`in vec4 sd, se; uniform float s, L, px; out vec3 tint; out float al;
void main(){
  vec2 vpc = (VP - .5) * vec2(A, 1.); float th = sd.x * TAU, r0 = .05 + 1.05 * sqrt(sd.y); float u = s - L - waveAt(r0); float live = step(0., u); u = max(u, 0.);
  vec2 dir = vec2(cos(th), sin(th)); float sp = mix(.35, 1.5, sd.z * sd.z); vec2 p = vpc + dir * (r0 + sp * (1. - exp(-u * 3.4)) / 3.4) + vec2(sin(u * 5. + se.x * 9.), cos(u * 4. + se.y * 9.)) * .02 * u - vec2(0., .05 * u);
  float z = -mix(.0, .7, sd.w) * (1. - exp(-u * 2.)); float w = max((FOC + z) / FOC, .05); gl_Position = vec4(p.x * 2. / A, -p.y * 2., 0., w);
  gl_PointSize = clamp(px * (1.8 + 7. * pow(se.w, 6.)) / w, 1., 40.); float life = .55 + 1.1 * se.z; tint = mix(mix(mg(vec3(.50, .90, 1.)), SECOND, step(.75, se.x) * .7), mg(vec3(1., .80, .48)), step(.55, se.y)); al = live * smoothstep(0., .03, u) * smoothstep(life, life * .25, u) * (.65 + .35 * sin(s * 14. + se.w * 50.)) * .85;
}`;

export const fsDust = String.raw`in vec3 tint; in float al; out vec4 o; void main(){ float r = length(gl_PointCoord - .5) * 2.; float g = exp(-r * r * 5.) ; o = vec4(tint * g * al + vec3(1.) * exp(-r * r * 26.) * al * .7, 1.); }`;

export const vsHeart = String.raw`in vec2 a; uniform vec3 pos; uniform float sz; out vec2 q; void main(){ q = (a - .5) * 2.; vec3 p = pos + vec3(q * sz, 0.); float w = max((FOC + p.z) / FOC, .05); gl_Position = vec4(p.x * 2. / A, -p.y * 2., ((p.z + FOC) / 10. * 2. - 1.) * w, w); }`;

export const fsHeart = String.raw`in vec2 q; out vec4 o; uniform float s, k, pin; void main(){ float r = length(q), an = atan(q.y, q.x); float fl = .9 + .1 * sin(s * 37.); float core = exp(-r * r * mix(90., 420., pin)) * 5., halo = exp(-r * 5.5) * .75; float st = pow(max(abs(cos(an * 2.)), 0.), 60.) * exp(-r * mix(4.2, 2.4, pin)) * (.8 + pin); float st2 = pow(abs(cos(an * 2. + .785 + s * .2)), 90.) * exp(-r * 8.) * .5; vec3 c = vec3(1.) * core + mix(mg(vec3(.35, .80, 1.)), mg(vec3(1., .82, .50)), .45 + .25 * sin(s * 5.)) * (halo + st + st2); o = vec4(c * k * fl * smoothstep(1., .7, r), 1.); }`;

export const vsPost = String.raw`in vec2 a; uniform vec2 c, sz; uniform float ang, sc; out vec2 uv, loc; void main(){ uv = a; vec2 q = (a - .5) * sz * 1.5 * sc; loc = (a - .5) * 1.5; float k = cos(ang), n = sin(ang); vec2 p = c + vec2(q.x * k - q.y * n, q.x * n + q.y * k); gl_Position = vec4(p.x * 2. / A, -p.y * 2., 0., 1.); }`;

export const fsPost = String.raw`in vec2 uv, loc; out vec4 o; uniform sampler2D T; uniform float rev, s, seed, sway, curl, fade; uniform vec3 tc; uniform vec2 sz;
float paper(vec2 q){
  vec2 k = abs(q) - vec2(sz.x / sz.y * .5, .5); float d0 = max(k.x, k.y); float n = (fb(q * 8. + seed * 31.) - .5) * .085 + (n2(q * 42. + seed * 7.) - .5) * .020; float bite = smoothstep(.26, .0, length(q - vec2((h11(seed) - .5) * .5, .53))) * .075 * step(.35, h11(seed + 3.)); vec2 cn = vec2(h11(seed + 5.) > .5 ? .40 : -.40, h11(seed + 8.) > .5 ? .53 : -.53); float torn = smoothstep(.24, .0, length(q - cn)) * .11; return d0 + n + bite + torn; }
vec3 pic(vec2 l){ return texture(T, vec2(l.x * .80 + .5, l.y + .5)).rgb; }
void main(){
  // it hangs from its top edge: the lower down, the more it swings and ripples
  float asx = sz.x / sz.y; vec2 q = loc * vec2(asx, 1.); float hg = clamp(q.y + .5, 0., 1.2), ph = q.y * 5.5 - s * 2.1 + seed * 3.1; q.x -= sway * hg * hg + .0065 * hg * sin(ph); q.y += .0100 * hg * hg * sin(q.x * 5. + s * 1.7 + seed * 2.3) + abs(sway) * .16 * hg * hg; float cb = clamp((hg - .70) / .30, 0., 1.); cb *= cb; q.y += curl * cb * 4.2 * (.8 + .35 * sin(q.x * 3. + seed * 2.)); vec2 lc = vec2(q.x / asx, q.y);
  float f = mix(-.50, .54, rev), R = .062 * sqrt(max(1. - rev, 0.)) * smoothstep(1., .93, rev) + 1e-4;   // f: how far it has unrolled; R: what is left on the roll
  float d = paper(q), px = fwidth(d) + 1e-4, mask = smoothstep(px, -px, d + .018) * smoothstep(px, -px, q.y - f);
  vec3 img = pic(lc); float lip = smoothstep(-.045, -.012, d + .018); img = mix(img, img * 1.08 + .05, lip * .7); img *= 1. + .03 * sin(q.x * 5. + seed * 4.) + .085 * hg * cos(ph) + sway * 1.6 * hg * (q.x / asx);
  float up = f - q.y; img *= 1. - .50 * exp(-max(up - R, 0.) * 13.) * (1. - rev); img *= 1. + curl * (30. * cb * smoothstep(.5, 1., cb) - 16. * cb * (1. - cb)); img *= 1. - .10 * sin(clamp(up * 9., 0., 3.14159)) * (1. - rev);        // the fresh paper still bows toward the roll
  // the roll itself: the back of the sheet wound into a tube
  float ty = (q.y - f) / R, in_ = 1. - smoothstep(.96, 1.02, abs(ty)); float wrapE = f + asin(clamp(ty, -1., 1.)) * R; float edge = abs(q.x) - (sz.x / sz.y * .5 - .020) - (fb(vec2(wrapE * 9. + seed * 5., seed * 3.)) - .5) * .075 - (n2(vec2(wrapE * 50., seed * 7.)) - .5) * .012; float rp = fwidth(q.x); float roll = in_ * smoothstep(rp, -rp, edge) * step(.0015, R) * smoothstep(.97, .86, rev);
  float cy = sqrt(max(1. - ty * ty, 0.)), an = asin(clamp(ty, -1., 1.)); vec2 wrap = vec2(lc.x, f + (an + 1.5708) * R * .95); vec3 art = pic(vec2(wrap.x, min(wrap.y, 1.) )); float fib = fb(vec2(q.x * 9. + seed * 9., wrap.y * 26.)); vec3 back = mix(art, vec3(.84, .69, .48) * (.55 + .6 * dot(art, vec3(.33))), .34) * (.88 + .24 * fib); back *= .20 + .80 * cy; back += vec3(.16, .13, .09) * pow(max(dot(normalize(vec2(ty, cy)), normalize(vec2(-.55, .84))), 0.), 9.); back *= 1. - .35 * smoothstep(-.035, .0, edge);
  // soft shadows: the sheet on the world, the roll on the sheet
  float sd2 = max(paper(q - vec2(0., .030)), q.y - .030 - f); float sh = smoothstep(.10, -.10, sd2) * .60; float rs = exp(-pow((q.y - f - R * .9) / (R * 1.6 + .004), 2.)) * smoothstep(.02, -.03, edge) * .55 * step(.0015, R) * smoothstep(.97, .86, rev); float ba = max(sh * (1. - mask), rs * (1. - mask));
  float halo = exp(-max(d, 0.) * 15.) * (1. - mask) * smoothstep(.06, -.10, q.y - f) * smoothstep(.15, .9, rev), pul = .8 + .2 * sin(s * 1.7 + seed * 5.); vec3 bc = tc * halo * .42 * pul * smoothstep(.74, .52, max(abs(loc.x), abs(loc.y)));
  vec3 outc = img * mask + bc * (1. - mask); float outa = mask + ba * (1. - mask);
  outc = mix(outc, back, roll); outa = mix(outa, 1., roll); o = vec4(outc, outa) * fade;
}`;

export const fsBright = String.raw`out vec4 o; uniform sampler2D S; uniform vec2 R; uniform float th;
void main(){ vec2 u = gl_FragCoord.xy / R, e = 1. / R; vec3 c = (texture(S, u + e * vec2(.5)).rgb + texture(S, u + e * vec2(-.5)).rgb + texture(S, u + e * vec2(.5, -.5)).rgb + texture(S, u + e * vec2(-.5, .5)).rgb) * .25; float l = max(c.r, max(c.g, c.b)); o = vec4(min(c * smoothstep(th, th + .6, l), 5.), 1.); }`;

export const fsBlur = String.raw`out vec4 o; uniform sampler2D S; uniform vec2 R, D;
void main(){ vec2 u = gl_FragCoord.xy / R; vec3 c = texture(S, u).rgb * .1964; float w[4] = float[4](.1747, .1210, .0657, .0278); for (int i = 0; i < 4; i++) { vec2 k = D * (float(i) + 1.) * 1.35 / R; c += (texture(S, u + k).rgb + texture(S, u - k).rgb) * w[i]; } o = vec4(c, 1.); }`;

export const fsOut = String.raw`out vec4 o; uniform sampler2D S, B0, B1, B2; uniform vec2 R, shk; uniform float amt, s, vig, zoom, Z, roll, wR, wS, wR2, wS2, ex, flash, edge; uniform vec2 foc; uniform vec3 fl; uniform float clr;
vec2 ring(vec2 p, float r, float R0, float S0, out float crest, out float trough){ float x = r - R0; float body = x > 0. ? exp(-pow(x * 11., 2.)) : exp(-pow(x * 6.2, 2.)); float rip = x < 0. ? sin(x * 38.) * exp(x * 6.) * .13 : 0.; crest = exp(-pow(x * 24., 2.)) + .30 * exp(-pow(x * 8., 2.)); trough = x < 0. ? exp(-pow((x + .13) * 10., 2.)) : 0.; return p / r * (body + rip) * S0; }
void main(){ vec2 u0 = gl_FragCoord.xy / R, vp = vec2(VP.x, 1. - VP.y), asp = vec2(A, 1.); vec2 p = (u0 - vp) * asp; float cs = cos(roll), sn = sin(roll); p = mat2(cs, sn, -sn, cs) * p / Z + shk; float r = length(p) + 1e-4, c1, t1, c2, t2;
  vec2 dsp = wS > .0004 ? ring(p, r, wR, wS, c1, t1) : vec2(0.); if (wS <= .0004) { c1 = 0.; t1 = 0.; } vec2 ds2 = wS2 > .0004 ? ring(p, r, wR2, wS2, c2, t2) : vec2(0.); if (wS2 <= .0004) { c2 = 0.; t2 = 0.; } dsp += ds2;
  vec2 u = vp + (p - dsp) / asp, ca = dsp * .035 / asp; vec3 c;
  if (zoom > .002) { vec3 acc = vec3(0.), ws = vec3(0.); float j = h21(gl_FragCoord.xy); for (int i = 0; i < 14; i++) { float t = (float(i) + j) / 14.; vec3 w = vec3(1.); vec2 k = foc + (u - foc) * (1. - zoom * t); acc += vec3(texture(S, k - ca).r, texture(S, k).g, texture(S, k + ca).b) * w; ws += w; } c = acc / ws; }
  else c = vec3(texture(S, u - ca).r, texture(S, u).g, texture(S, u + ca).b);
  vec3 bl = texture(B0, u).rgb * .5 + texture(B1, u).rgb * .6 + texture(B2, u).rgb * .8;
  vec3 hdr = c * ex + bl * amt;
  vec3 sea = mix(mg(vec3(.45, .90, 1.)), mg(vec3(1., .86, .60)), .35); vec2 eg = abs(u0 - .5) * 2.; hdr += sea * edge * (pow(eg.x, 9.) + pow(eg.y, 9.)) * .26; hdr += sea * (c1 * wS * 8.5 + c2 * wS2 * 9.) * (.30 + .95 * c); hdr *= 1. - clamp(t1 * wS * 7. + t2 * wS2 * 6., 0., .55);
  vec2 q = (u0 - fl.xy) * asp; float fr = length(q); hdr += fl.z * (mg(vec3(.50, .85, 1.)) * exp(-abs(q.y) * 120.) * exp(-abs(q.x) * 1.9) * .8 + vec3(1., .88, .62) * exp(-fr * 9.) * .7 + mg(vec3(.5, .85, 1.)) * pow(n2(vec2(atan(q.y, q.x) * 8., 2.)) , 3.) * exp(-fr * 2.) * .9);
  hdr += mix(vec3(1.), mg(vec3(.60, .88, 1.)), .5) * flash * (.04 + 1.9 * exp(-fr * 8.) + 1.7 * pow(n2(vec2(atan(q.y, q.x) * 11., 5.)) * .6 + n2(vec2(atan(q.y, q.x) * 27., 1.)) * .55, 5.) * exp(-fr * 2.1));
  float m = max(hdr.r, max(hdr.g, hdr.b)), k = m > .72 ? (.72 + .28 * (1. - exp(-(m - .72) / .55))) / m : 1.; vec3 tm = mix(hdr * k, min(hdr, 1.), .12 * smoothstep(1., 3., m) + .7 * smoothstep(2.2, 7., m));
  c = mix(min(hdr, 1.), tm, clamp(amt * 1.4 + wS * 20. + flash + fl.z, 0., 1.)); vec2 e = u0 - .5; c *= 1. - vig * smoothstep(.25, .95, dot(e, e) * 2.2); c += (h21(gl_FragCoord.xy + s) - .5) / 170.; float al = 1.; vec3 over = vec3(0.); if (clr > 0.) { float e = r - clr + (n2(p * 11.) - .5) * .05; al = smoothstep(-.11, .05, e); over = sea * (exp(-pow((r - clr) * 10., 2.)) * .55 + exp(-pow((r - clr + .16) * 7., 2.)) * .16) * (1. - al); }
  o = vec4(c * al + over, al); }`;
