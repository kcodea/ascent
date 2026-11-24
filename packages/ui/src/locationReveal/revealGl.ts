/**
 * THE LOCATION REVEAL's picture: one WebGL 2 canvas that draws any moment of it from the time alone (`draw(s)`), so a
 * dropped frame is only ever skipped, never drifted. Ported from the owner-approved prototype (2026-11-24).
 *
 * READY BEFORE IT IS NEEDED: `prepareReveal` runs while the gate is shut (the doors have met, the crystal is forming),
 * one small step per frame: shaders, buffers, then one picture per frame, decoded off the main thread. Every stage is
 * drawn once there too, so nothing compiles under the player's press. Everything is freed when the reveal ends.
 */
import type { Tribe } from '@game/core';
import { publicArt } from '../phoneArt';
import { TRIBE_COLOR_DEFAULTS } from '../tribeColorConfig';
import { RANKED_GATE_ART } from '../rankedGate/rankedGateTiming';
import { locationArt, type LocationDef } from './locations';
import * as SH from './revealShaders';
import {
  A, clamp, distAt, GEM_SIZE, GEM_Y, heartAt, inCubic, inOut, kick, L, mix, NAME, outCubic, outroAt, POST, POSTER_H, POSTER_W, posterPose, seg, simEnd,
  smoother, START, T0, vel, WASH, washAt, washR, waveAt, waveR,
} from './revealTimeline';

/** The canvas's pixel rows, most to fewest: the window's own, up to the paintings' (1440). A machine that cannot draw a
 *  heavy frame in `REVEAL_STEP_MS` steps down until it can. */
export const REVEAL_ROWS = [1440, 1260, 1080, 900] as const;
export const REVEAL_STEP_MS = 9;
const ART_ROWS = 1440;
/** A machine that takes longer than this for one heavy frame gets the light version instead (ms). */
export const REVEAL_SLOW_MS = 26;

type Val = number | readonly number[];
interface Program { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Mesh { v: WebGLVertexArrayObject; n: number; inst: number }
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

const PROGRAMS = {
  ground: ['vsFull', 'fsGround', ['a']], scene: ['vsFull', 'fsScene', ['a']], weld: ['vsFull', 'fsWeld', ['a']], ember: ['vsFull', 'fsEmber', ['a']],
  bright: ['vsFull', 'fsBright', ['a']], blur: ['vsFull', 'fsBlur', ['a']], out: ['vsFull', 'fsOut', ['a']],
  door: ['vsQuad', 'fsDoor', ['a']], gem: ['vsQuad', 'fsCry', ['a']], heart: ['vsHeart', 'fsHeart', ['a']], poster: ['vsPost', 'fsPost', ['a']],
  shard: ['vsShard', 'fsShard', ['v0', 'ct', 'sd', 'en']], splinter: ['vsSpl', 'fsSpl', ['v', 'nv', 'sd', 'se']], debris: ['vsDeb', 'fsSpl', ['v', 'nv', 'sd', 'se']],
  dust: ['vsDust', 'fsDust', ['sd', 'se']], gust: ['vsGust', 'fsDust', ['sd', 'se']], suck: ['vsSuck', 'fsDust', ['sd', 'se']], trail: ['vsTrail', 'fsDust', ['sd', 'se']],
  light: ['vsLight', 'fsLight', ['lp', 'lc']],
} as const satisfies Record<string, readonly [keyof typeof SH, keyof typeof SH, readonly string[]]>;
type ProgramName = keyof typeof PROGRAMS;

const TRAIL_N = 1600;
/** White makes no light of its own; the Dragons' glow is violet. */
const GLOW: Partial<Record<Tribe, string>> = { dragon: '#b48cff' };
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export class RevealGl {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly loc: LocationDef;
  /** The parchments this game hangs, in order (set by the play; every one of the location's is loaded). */
  tribes: readonly Tribe[];
  private readonly P: Partial<Record<ProgramName, Program>> = {};
  private readonly tex = new Map<string, WebGLTexture>();
  private readonly mesh: Record<string, Mesh> = {};
  private main!: Target;
  private scene!: Target;
  private ms!: WebGLFramebuffer;
  private msBufs: WebGLRenderbuffer[] = [];
  private bloom: [Target, Target][] = [];
  private trailBuf: WebGLBuffer[] = [];
  private readonly trailA = new Float32Array(TRAIL_N * 4);
  private readonly trailB = new Float32Array(TRAIL_N * 4);
  private readonly vcx: number;
  private readonly vcy: number;
  /** The distance from the landing to the stage's furthest corner. */
  readonly far: number;
  private W = 0;
  private H = 0;
  /** Where it lands on the stage, and how far the painting is slid down to frame it in a wide window. */
  readonly vp: readonly [number, number];
  private readonly ofs: readonly [number, number];
  /** A gate height in stage heights, and the part of the stage the window shows (fractions of it). */
  private readonly gate: number;
  private show: readonly [number, number];
  private seed = 11;
  /** The context was lost: nothing more is drawn. */
  lost = false;

  constructor(canvas: HTMLCanvasElement, loc: LocationDef, w: number, h: number) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL 2');
    this.canvas = canvas;
    this.gl = gl;
    this.loc = loc;
    this.tribes = loc.posters;
    this.ofs = slideFor(loc, w, h);
    this.gate = gateHeight(w, h) / stageHeight(w, h);
    this.show = showOf(w, h);
    const vp = this.vp = [loc.vp[0] + this.ofs[0], loc.vp[1] + this.ofs[1]] as const;
    this.vcx = (vp[0] - 0.5) * A;
    this.vcy = vp[1] - 0.5;
    this.far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot((x! - vp[0]) * A, y! - vp[1])));
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }

  private rnd = (): number => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  // ── building, one step at a time ──────────────────────────────────────────────────────────────────────────────────
  /** The build as a list of small steps, in order. Each is run in its own frame by `prepareReveal`. */
  steps(rows: number): (() => void)[] {
    const names = Object.keys(PROGRAMS) as ProgramName[];
    const linked: Partial<Record<ProgramName, WebGLProgram>> = {};
    return [
      // All the shaders are handed to the driver at once (it compiles them in parallel where it can)...
      () => { for (const n of names) linked[n] = this.startProgram(n); },
      () => this.buildMeshes(),
      () => this.buildShards(),
      () => this.setRows(rows),
      // ...and each is collected later, in its own step.
      ...names.map((n) => () => { this.P[n] = this.finishProgram(n, linked[n]!); }),
    ];
  }

  private startProgram(name: ProgramName): WebGLProgram {
    const gl = this.gl;
    const [vs, fs, attrs] = PROGRAMS[name];
    const make = (type: number, id: keyof typeof SH): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, `#version 300 es\n${SH.common}\n${SH[id]}`);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    return p;
  }

  private finishProgram(name: ProgramName, p: WebGLProgram): Program {
    const gl = this.gl;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const logs = (gl.getAttachedShaders(p) ?? []).map((s) => gl.getShaderInfoLog(s)).join(' ');
      throw new Error(`${name}: ${gl.getProgramInfoLog(p)} ${logs}`);
    }
    const u: Program['u'] = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number; i < n; i++) {
      const a = gl.getActiveUniform(p, i)!;
      u[a.name] = gl.getUniformLocation(p, a.name);
    }
    return { p, u };
  }

  private vao(list: readonly (readonly [readonly number[] | Float32Array, number, number?])[], n: number, inst = 0): Mesh {
    const gl = this.gl;
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    list.forEach(([data, size, div], i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, 0, 0);
      if (div) gl.vertexAttribDivisor(i, div);
    });
    gl.bindVertexArray(null);
    return { v, n, inst };
  }

  private buildMeshes(): void {
    const gl = this.gl;
    const m = this.mesh;
    m.full = this.vao([[[-1, -1, 3, -1, -1, 3], 2]], 3);
    m.quad = this.vao([[[0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], 2]], 6);
    // A splinter: a five-sided crystal pointed at both ends.
    const vs: number[] = [];
    const ns: number[] = [];
    const ring = [0, 1, 2, 3, 4].map((i) => { const g = (i / 5) * 6.283; return [Math.cos(g), 0.12 * (i % 2), Math.sin(g)] as const; });
    for (const tip of [[0, 1.35, 0], [0, -0.95, 0]] as const) {
      for (let i = 0; i < 5; i++) {
        const q = [tip, ring[i]!, ring[(i + 1) % 5]!];
        const e = [0, 1, 2].map((k) => q[1]![k]! - q[0]![k]!);
        const f = [0, 1, 2].map((k) => q[2]![k]! - q[0]![k]!);
        let nn = [e[1]! * f[2]! - e[2]! * f[1]!, e[2]! * f[0]! - e[0]! * f[2]!, e[0]! * f[1]! - e[1]! * f[0]!];
        const l = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
        nn = nn.map((x) => x / l);
        const c = [0, 1, 2].map((k) => q[0]![k]! + q[1]![k]! + q[2]![k]!);
        if (nn[0]! * c[0]! + nn[1]! * c[1]! + nn[2]! * c[2]! < 0) nn = nn.map((x) => -x);
        for (const z of q) { vs.push(...z); ns.push(...nn); }
      }
    }
    const random = (n: number): [Float32Array, Float32Array] => {
      const a = new Float32Array(n * 4);
      const b = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) { a[i] = this.rnd(); b[i] = this.rnd(); }
      return [a, b];
    };
    for (const [k, n] of [['splinter', 240], ['debris', 130]] as const) {
      const [a, b] = random(n);
      m[k] = this.vao([[vs, 3], [ns, 3], [a, 4, 1], [b, 4, 1]], vs.length / 3, n);
    }
    for (const [k, n] of [['dust', 3600], ['gust', 2400], ['suck', 420]] as const) {
      const [a, b] = random(n);
      m[k] = this.vao([[a, 4], [b, 4]], n);
    }
    m.light = this.vao([[this.loc.lights.flatMap((q) => q.slice(0, 4)), 4], [this.loc.lights.flatMap((q) => q.slice(4)), 3]], this.loc.lights.length);
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    this.trailBuf = [this.trailA, this.trailB].map((data, i) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 0, 0);
      return b;
    });
    gl.bindVertexArray(null);
    m.trail = { v, n: TRAIL_N, inst: 0 };
  }

  /** The painting broken like struck glass: small pieces around the point of impact, larger toward the edges. */
  private buildShards(): void {
    const { vcx, vcy, rnd } = this;
    const RAD = [0.03, 0.072, 0.125, 0.195, 0.285, 0.395, 0.525, 0.675, 0.85, 1.06, 1.32, 1.72];
    const CNT = [7, 7, 14, 14, 28, 28, 28, 56, 56, 56, 112, 112];
    type Pt = readonly [number, number];
    const rings: Pt[][] = RAD.map((r, i) => {
      const n = CNT[i]!;
      const gap = i ? r - RAD[i - 1]! : r;
      return Array.from({ length: n }, (_, k): Pt => {
        const g = ((k + (rnd() - 0.5) * 0.62) / n) * 6.28318 + 0.21 + Math.sin(k * 2.4 + i) * 0.02;
        const q = r + (rnd() - 0.5) * gap * 0.62;
        return [vcx + Math.cos(g) * q, vcy + Math.sin(g) * q];
      });
    });
    const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const convex = (q: Pt[]): boolean => {
      let s = 0;
      for (let k = 0; k < q.length; k++) {
        const c = cross(q[k]!, q[(k + 1) % q.length]!, q[(k + 2) % q.length]!);
        if (Math.abs(c) < 1e-7) continue;
        if (s && Math.sign(c) !== s) return false;
        s = Math.sign(c);
      }
      return true;
    };
    const polys: Pt[][] = [];
    const hub: Pt = [vcx, vcy];
    rings[0]!.forEach((p, k) => polys.push([hub, p, rings[0]![(k + 1) % CNT[0]!]!]));
    for (let i = 1; i < RAD.length; i++) {
      const n = CNT[i - 1]!;
      const a = rings[i - 1]!;
      const b = rings[i]!;
      for (let k = 0; k < n; k++) {
        const a0 = a[k]!;
        const a1 = a[(k + 1) % n]!;
        if (CNT[i] === n) {
          const b0 = b[k]!;
          const b1 = b[(k + 1) % n]!;
          const q = [a0, b0, b1, a1];
          if (rnd() < 0.3 && convex(q)) polys.push(q);
          else if (rnd() < 0.5) polys.push([a0, b0, b1], [a0, b1, a1]);
          else polys.push([a0, b0, a1], [b0, b1, a1]);
        } else {
          const b0 = b[k * 2]!;
          const bm = b[k * 2 + 1]!;
          const b1 = b[(k * 2 + 2) % CNT[i]!]!;
          polys.push([a0, b0, bm], [a0, bm, a1], [a1, bm, b1]);
        }
      }
    }
    const v0: number[] = [];
    const ct: number[] = [];
    const sds: number[] = [];
    const en: number[] = [];
    const THICK = 0.014;
    for (const poly of polys) {
      if (!poly.some((q) => Math.abs(q[0]) < A / 2 + 0.1 && Math.abs(q[1]) < 0.6)) continue;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const r = [rnd(), rnd(), rnd(), rnd()];
      const d = Math.hypot(cx - vcx, cy - vcy);
      const st = L - 0.67 + 0.5 * waveAt(Math.min(d, 1.3)) + 0.05 * (r[0]! - 0.5); // it comes home as the wave reaches it
      const dg = distAt(st);
      const put = (x: number, y: number, z: number, h: number, ex: number, ey: number, side: number): void => {
        v0.push(x, y, z, h); ct.push(cx, cy, st, dg); sds.push(...r); en.push(ex, ey, side);
      };
      poly.forEach((p, k) => {
        const n = poly[(k + 1) % poly.length]!;
        let ex = n[1] - p[1];
        let ey = -(n[0] - p[0]);
        const l = Math.hypot(ex, ey);
        if (l < 1e-5) return;
        ex /= l; ey /= l;
        let h = (p[0] - cx) * ex + (p[1] - cy) * ey;
        if (h < 0) { ex = -ex; ey = -ey; h = -h; }
        for (const z of [0, THICK]) { put(cx, cy, z, h, ex, ey, 0); put(p[0], p[1], z, 0, ex, ey, 0); put(n[0], n[1], z, 0, ex, ey, 0); }
        for (const [q, z] of [[p, 0], [n, 0], [n, THICK], [p, 0], [n, THICK], [p, THICK]] as const) put(q[0], q[1], z, 0.02, ex, ey, 1);
      });
    }
    this.mesh.shard = this.vao([[v0, 4], [ct, 4], [sds, 4], [en, 3]], v0.length / 4);
  }

  private target(w: number, h: number, half: boolean): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  /** Size the canvas and every buffer (again). */
  setRows(rows: number): void {
    const gl = this.gl;
    if (this.H) {
      for (const t of [this.main, this.scene, ...this.bloom.flat()]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      gl.deleteFramebuffer(this.ms);
      for (const b of this.msBufs) gl.deleteRenderbuffer(b);
    }
    this.H = this.canvas.height = rows;
    this.W = this.canvas.width = Math.round(rows * A);
    const half = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    const { W, H } = this;
    this.main = this.target(W, H, half);
    this.scene = this.target(W, H, false);
    this.bloom = [2, 4, 8].map((k) => [this.target((W / k) | 0, (H / k) | 0, half), this.target((W / k) | 0, (H / k) | 0, half)]);
    this.ms = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms);
    const samples = Math.min(rows > 1080 ? 2 : 4, gl.getParameter(gl.MAX_SAMPLES) as number); // finer rows need fewer samples
    this.msBufs = [];
    for (const [fmt, at] of [[half ? gl.RGBA16F : gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT]] as const) {
      const rb = gl.createRenderbuffer()!;
      this.msBufs.push(rb);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, at, gl.RENDERBUFFER, rb);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('scene buffer incomplete');
  }

  /** Every picture it needs, by name and address. */
  pictures(): { name: string; url: string }[] {
    return [
      { name: 'gate-left', url: publicArt('frames/ranked-gate-left.webp') }, { name: 'gate-right', url: publicArt('frames/ranked-gate-right.webp') }, { name: 'gem', url: publicArt('frames/ranked-gate-crystal.webp') },
      ...['flat', 'data', 'water', 'layer0', 'layer1', 'layer2', 'layer3', ...this.loc.posters.map((t) => `poster-${t}`)].map((n) => ({ name: n, url: locationArt(this.loc.id, n) })),
    ];
  }

  addPicture(name: string, image: TexImageSource): void {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // Beyond its painted edge a layer continues as its mirror, never as a smear.
    const wrap = /^(layer|data)/.test(name) ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    this.tex.set(name, t);
  }

  /** Draw each stage once, unseen (one per call); the last measures a heavy frame. Returns its ms, or null. */
  warmSteps(): (() => number | null)[] {
    const at = [START, T0 + 0.05, T0 + 0.4, T0 + 1, L - 0.4, L - 0.05, L + 0.05, L + 0.25, NAME + 0.1, POST + 0.3];
    return [
      ...at.map((s) => (): null => { this.draw(s); return null; }),
      () => this.measure(),
    ];
  }

  /** How long a heavy frame takes here, start to finished on the card (ms). Leaves the gate's own picture on the canvas. */
  measure(): number {
    const px = new Uint8Array(4);
    const gl = this.gl;
    const read = (): void => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(this.W >> 1, this.H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    this.draw(L + 0.12); read();
    const t = performance.now();
    for (const s of [L + 0.1, L + 0.13, L + 0.16]) this.draw(s);
    read();
    const ms = (performance.now() - t) / 3;
    this.draw(START);
    return ms;
  }

  destroy(): void {
    this.lost = true;
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
    this.canvas.remove();
  }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private use(name: ProgramName, vals: Record<string, Val>, binds: Record<string, WebGLTexture | undefined> = {}): void {
    const gl = this.gl;
    const pr = this.P[name]!;
    const u = pr.u;
    const loc = this.loc;
    gl.useProgram(pr.p);
    let i = 0;
    for (const n in binds) {
      const at = u[n];
      const tx = binds[n];
      if (!at || !tx) continue;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.uniform1i(at, i++);
    }
    if (u.VP) gl.uniform2f(u.VP, this.vp[0], this.vp[1]);
    if (u.OFS) gl.uniform2f(u.OFS, this.ofs[0], this.ofs[1]);
    if (u.GEM) gl.uniform2f(u.GEM, 0, GEM_Y * this.gate);
    if (u.VA) gl.uniform1f(u.VA, Math.max(16 / 9, A * this.show[0]));
    if (u.MGK) gl.uniform1f(u.MGK, loc.cool ? 1 : 0);
    if (u.COOL) gl.uniform3fv(u.COOL, loc.cool ?? [1, 1, 1]);
    if (u.WARMC) gl.uniform3fv(u.WARMC, loc.warm ?? [1, 1, 1]);
    if (u.DEEP) gl.uniform3fv(u.DEEP, loc.deep);
    if (u.SECOND) gl.uniform3fv(u.SECOND, loc.second);
    for (const n in vals) {
      const at = u[n];
      const x = vals[n]!;
      if (!at) continue;
      if (typeof x === 'number') gl.uniform1f(at, x);
      else if (x.length === 2) gl.uniform2fv(at, x);
      else if (x.length === 3) gl.uniform3fv(at, x);
      else gl.uniform4fv(at, x);
    }
  }
  private mode(kind: 'alpha' | 'add' | 'pre'): void {
    const gl = this.gl;
    if (kind === 'alpha') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    else if (kind === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  private tris(m: string): void {
    const gl = this.gl;
    const k = this.mesh[m]!;
    gl.bindVertexArray(k.v);
    if (k.inst) gl.drawArraysInstanced(gl.TRIANGLES, 0, k.n, k.inst);
    else gl.drawArrays(gl.TRIANGLES, 0, k.n);
  }
  private points(m: string): void {
    const k = this.mesh[m]!;
    this.gl.bindVertexArray(k.v);
    this.gl.drawArrays(this.gl.POINTS, 0, k.n);
  }
  private pass(name: ProgramName, dst: Target | null, vals: Record<string, Val>, binds: Record<string, WebGLTexture | undefined>): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    const w = dst ? dst.w : this.W;
    const h = dst ? dst.h : this.H;
    gl.viewport(0, 0, w, h);
    this.clip(w === this.W);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.use(name, { ...vals, R: [w, h] }, binds);
    this.tris('full');
  }

  /** The window's size changed: which part of the stage it shows. */
  resize(w: number, h: number): void { this.show = showOf(w, h); }
  /** Draw only the part of the stage the window shows (with a margin the lens can bend in), in a full-size buffer. */
  private clip(on: boolean): void {
    const { gl, W, H } = this;
    const [x, y] = this.show;
    if (!on || (x > 0.97 && y > 0.97)) { gl.disable(gl.SCISSOR_TEST); return; }
    const w = Math.min(W, Math.ceil(W * (x + 0.06)));
    const h = Math.min(H, Math.ceil(H * (y + 0.06)));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor((W - w) >> 1, (H - h) >> 1, w, h);
  }

  /** The reveal at sim second `s`; `fit`: how small the parchments are drawn (`fitOf`). */
  draw(s: number, fit = 1): void {
    if (this.lost) return;
    const { gl, loc, tex } = this;
    const { W, H } = this;
    const n = this.tribes.length;
    const end = simEnd(n);
    const px = H / 900;
    const after = s - L;
    const landed = after > 0;
    const v = vel(s);
    const tt = s - T0;
    const d = distAt(s);
    const gather = smoother(seg(s, L - 0.7, L));
    const inh = landed ? 0 : gather;
    const posters = seg(s, POST - 0.15, POST + 0.55);
    const whole = after > waveAt(this.far) + 0.2;
    const outro = smoother(seg(s, outroAt(n) + 0.1, washAt(n) + WASH * 0.7)); // it softens and you step in
    const hp = heartAt(s, this.vcx, this.vcy, GEM_Y * this.gate);
    const hk = tt <= 0 || landed ? 0 : (0.55 + 0.45 * seg(tt, 0.1, 0.8) + 0.5 * inh) * seg(tt, 0.02, 0.2);
    // The camera pushes in, slides across and rises as it arrives, then drifts. It never follows the mouse (owner 2026-11-24).
    const push = -0.56 + 0.64 / (1 + Math.exp(-(s - L - 0.06) * 4.4)) + 0.12 * smoother(seg(s, L + 0.2, end + 0.9)) + 0.34 * outro;
    const tr = outCubic(seg(s, L - 0.4, L + 2.6));
    const pan = [mix(-0.46, 0.04, tr) + 0.22 * smoother(seg(s, L + 0.8, end + 0.6)), mix(-0.26, 0.04, tr)];
    const fw = 1.2 / (1.2 + hp[2]);
    const foc: [number, number] = landed ? [this.vp[0], this.vp[1]] : tt < 0 ? [0.5, 0.5 + GEM_Y * this.gate] : [0.5 + (hp[0] * fw) / A, 0.5 + hp[1] * fw];

    // The place itself.
    if (s > L - 1.1) {
      this.pass('scene', this.scene, { s, push, pan, dof: Math.max(0, Math.log2(ART_ROWS / H)) + 0.9 * inOut(posters) + 3 * outro, after: landed ? after : -9, drain: 0, near_: 2 * Math.exp(-Math.max(0, after) * 2.4) },
        { DT: tex.get('data'), WT: tex.get('water'), L0: tex.get('layer0'), L1: tex.get('layer1'), L2: tex.get('layer2'), L3: tex.get('layer3') });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms);
    gl.viewport(0, 0, W, H);
    this.clip(true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    if (!whole) {
      this.use('ground', { R: [W, H], foc, s, d, beam: seg(s, T0 + 0.3, L - 0.3), back: smoother(seg(s, L - 0.55, L)), dim: 1 - 0.18 * gather, heart: [hp[0], hp[1], hk] }, { FL: tex.get('flat') });
      this.tris('full');
    }
    gl.enable(gl.BLEND);
    this.mode('alpha');
    // The doors: thrown open, and you go through them. They start exactly where the gate left them.
    const op = seg(tt, -0.02, 0.98);
    const open = op * op * (3 - 2 * op);
    const thru = smoother(seg(tt, 0.08, 1.1));
    const strain = seg(s, START, T0);
    if (open < 1) {
      const lit = strain * 0.55 + (tt > 0 ? 0.85 * Math.exp(-Math.max(0, tt - 0.05) * 2.6) : 0);
      for (const [name, side] of [['gate-left', -1], ['gate-right', 1]] as const) {
        this.use('door', {
          box: [side * (GATE_A / 4 + open * GATE_A * 0.515) * this.gate, 0, (GATE_A / 2 + 0.002) * this.gate, 1.002 * this.gate], z: -0.62 * thru, left: side < 0 ? 1 : 0, lit,
          dark: 0.38 * strain * (tt < 0 ? 1 : Math.exp(-tt * 14)), ring: tt > 0 ? 1.5 * (1 - Math.exp(-tt * 4.5)) : 0, ringS: tt > 0 ? Math.exp(-tt * 3.2) : 0, s,
        }, { T: tex.get(name) });
        this.tris('quad');
      }
    }
    if (tt < 0) {
      const c = smoother(strain);
      const sq = seg(s, T0 - 0.13, T0);
      const q = GEM_SIZE * this.gate * (1 + 0.05 * c + 0.05 * smoother(c) - 0.05 * sq * sq);
      this.use('gem', { box: [0, GEM_Y * this.gate, q, q], z: 0, crack: c }, { T: tex.get('gem') });
      this.tris('quad');
      this.mode('add');
      this.use('suck', { s, t0: T0, px });
      this.points('suck');
      this.mode('alpha');
    }
    if (tt >= 0 && !whole) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      this.use('shard', { s, t0: T0, L, d, heart: hp, heartZ: hk * mix(1.5, 0.55, seg(s, L - 0.7, L - 0.2)) }, { FL: tex.get('flat'), SC: this.scene.tex });
      this.tris('shard');
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      if (!landed) {
        this.use('splinter', { s, t0: T0, L, d, v_: v, magic: smoother(seg(tt, 0.1, 0.8)) });
        this.tris('splinter');
        this.mode('add');
        this.use('dust', { s, t0: T0, L, d, px });
        this.points('dust');
        if (tt > 0.1) this.drawTrail(s, d, hk * (1 - inh), px);
        gl.disable(gl.DEPTH_TEST);
        this.use('heart', { pos: hp, sz: mix(mix(0.36 + 0.1 * v, 0.28, seg(s, L - 0.7, L - 0.25)), 0.34, inh), k: hk * (0.75 + 0.35 * inh), pin: inh, s });
        this.tris('quad');
      }
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }
    if (landed) {
      gl.disable(gl.DEPTH_TEST);
      this.mode('alpha');
      this.use('weld', { R: [W, H], s, after: whole ? 9 : after }, { SC: this.scene.tex });
      this.tris('full');
      this.mode('add');
      this.use('light', { s, after, push, pan, px, dof: 0.9 * inOut(posters) });
      this.points('light');
      this.use('ember', { R: [W, H], pan, push, s, warmth: loc.warmth, ember: 0.95 * seg(after, 0.1, 0.7) });
      this.tris('full');
      if (after < 2.4) { this.use('gust', { s, L, px }); this.points('gust'); }
      if (after < 1.2) {
        this.mode('alpha');
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        this.use('debris', { s, L, magic: 1 });
        this.tris('debris');
        gl.disable(gl.DEPTH_TEST);
      }
    }
    if (s > POST - 0.3) {
      gl.disable(gl.DEPTH_TEST);
      this.mode('pre');
      for (let i = 0; i < n; i++) {
        const p = posterPose(i, n, s);
        if (p.enter <= 0) continue;
        const t = this.tribes[i]!;
        const f = fit;
        this.use('poster', {
          c: [p.x * f, p.y * f], sz: [POSTER_W * f, POSTER_H * f], ang: p.angle, sc: p.scale, rev: p.open, sway: p.sway, curl: p.curl, s, seed: i + 1.3,
          fade: (1 - p.out) * p.enter, tc: rgb(GLOW[t] ?? TRIBE_COLOR_DEFAULTS[t]),
        }, { T: tex.get(`poster-${t}`) });
        this.tris('quad');
      }
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ms);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.main.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    let src = this.main.tex;
    this.bloom.forEach(([a, b], i) => {
      this.pass('bright', a, { th: i === 0 ? 0.8 : 0 }, { S: src });
      for (let k = 0; k < 2; k++) {
        this.pass('blur', b, { D: [1 + k, 0] }, { S: a.tex });
        this.pass('blur', a, { D: [0, 1 + k] }, { S: b.tex });
      }
      src = a.tex;
    });
    this.lens(s, after, landed, tt, v, gather, strain, hp, hk, foc, outro, n);
  }

  /** The comet's tail: where the heart has been, carried back past you. */
  private drawTrail(s: number, d: number, k: number, px: number): void {
    const { gl, trailA: a, trailB: b } = this;
    for (let i = 0, o = 0; i < TRAIL_N; i++, o += 4) {
      const age = (i + 1) / TRAIL_N;
      const at = s - age * 0.8;
      if (at > T0 + 0.05) {
        const p = heartAt(at, this.vcx, this.vcy, GEM_Y * this.gate);
        a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2] - (d - distAt(at)) * 0.52;
      } else { a[o] = 9; a[o + 1] = 9; a[o + 2] = 9; }
      a[o + 3] = age;
      b[o] = i * 1.37; b[o + 1] = k; b[o + 2] = s;
    }
    gl.bindVertexArray(this.mesh.trail!.v);
    [a, b].forEach((data, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf[i]!); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); });
    this.use('trail', { px });
    this.points('trail');
  }

  /** The lens: the camera's shoves, the waves that bend everything on screen, the light, and the tone. */
  private lens(s: number, after: number, landed: boolean, tt: number, v: number, gather: number, strain: number, hp: readonly number[], hk: number, foc: readonly number[], outro: number, n: number): void {
    const b1 = Math.max(0, tt);
    const u = Math.max(0, after);
    const noise = (f: number, p: number): number => Math.sin(s * f + p) * 0.65 + Math.sin(s * f * 1.73 + p * 2.1) * 0.35;
    const trem = 0.0035 * kick(b1, 14) + 0.017 * kick(u, 13);
    const Z = 1 + 0.03 * smoother(seg(s, START, T0 + 0.5)) * (1 - smoother(seg(s, L, L + 1.2))) + 0.028 * kick(b1, 7) + 0.05 * v + 0.085 * kick(u, 9) + 0.05 * outro + 1.6 * trem;
    // The leaving wave: the same lens, spreading from the same place, and the picture is gone behind it.
    const wash = washR(s, n, this.far);
    const washX = seg(s, washAt(n), washAt(n) + WASH);
    const ring2 = after - 0.17;
    const amt = tt < 0 ? 0.6 * smoother(strain) : 0.12 + 0.48 * (1 - smoother(seg(s, L - 0.9, L + 0.22)));
    const persp = (1.2 + hp[2]!) / 1.2;
    this.pass('out', null, {
      amt, s, foc: [foc[0]!, 1 - foc[1]!], Z: Math.max(Z, 1 + 1.4 * trem), roll: 0, shk: [noise(31, 0) * trem, noise(36, 4) * trem],
      clr: wash, wR: wash > 0 ? wash : waveR(after), wS: wash > 0 ? 0.062 * Math.sin(Math.PI * Math.min(1, washX * 1.02)) ** 0.6 : landed ? 0.112 * Math.exp(-u * 1.8) * smoother(seg(u, 0, 0.07)) * (1 - smoother(seg(u, 0.28, 0.62))) : 0,
      wR2: waveR(ring2), wS2: ring2 > 0 ? 0.056 * Math.exp(-ring2 * 1.8) * smoother(seg(ring2, 0, 0.1)) * (1 - smoother(seg(ring2, 0.28, 0.48))) : 0,
      ex: (1 - 0.14 * (landed ? Math.exp(-u * 7) : gather)) * (1 - 0.22 * outro),
      flash: 0.75 * (tt < 0 ? smoother(seg(s, T0 - 0.1, T0)) : Math.exp(-b1 * 9)) + (landed ? 1.15 * Math.exp(-u * 9) + 0.06 * Math.exp(-u * 4) : 1.15 * inCubic(seg(s, L - 0.16, L))),
      fl: [
        landed ? this.vp[0] : 0.5 + hp[0]! / A / persp,
        1 - (landed ? this.vp[1] : 0.5 + hp[1]! / persp),
        landed ? 1.35 * Math.exp(-u * 6) + 0.16 * Math.exp(-u * 2.6)
          : tt > 0 ? hk * (0.14 - 0.08 * seg(s, L - 0.8, L - 0.3)) + 1.2 * inCubic(seg(s, L - 0.3, L)) + 0.9 * Math.exp(-b1 * 5)
            : 0.9 * smoother(seg(s, T0 - 0.1, T0)),
      ],
      edge: landed ? Math.exp(-(((u - waveAt(this.far * 0.85)) * 9) ** 2)) : 0,
      vig: 0.5 * smoother(seg(s, START, T0)) * (1 - smoother(seg(s, L - 0.2, L + 0.8))),
      zoom: landed ? 0.026 * smoother(v) * Math.exp(-u * 3) + 0.022 * kick(u, 12) : 0.034 * smoother(v) + 0.022 * kick(b1, 9),
    }, { S: this.main.tex, B0: this.bloom[0]![0].tex, B1: this.bloom[1]![0].tex, B2: this.bloom[2]![0].tex });
  }
}

/** The gate art's own 16:9. */
const GATE_A = 16 / 9;
/** The gate's height on screen (px): its art's `cover` fit, so the doors and crystal are drawn exactly where the gate's are. */
export function gateHeight(w: number, h: number): number {
  return Math.max(w / 2 / RANKED_GATE_ART.halfW, (h + 8) / RANKED_GATE_ART.h) * RANKED_GATE_ART.h; // + 8: the door's face overhangs its box by 4 a side (rankedGate.css)
}
/** The stage's height on screen (px): the whole 21:9 painting, covering the window. At 21:9 all of it shows. */
export const stageHeight = (w: number, h: number): number => Math.max(w / A, h);
/** The part of the stage a window shows (fractions of its width and height). */
export function showOf(w: number, h: number): readonly [number, number] {
  const H = stageHeight(w, h);
  return [Math.min(1, w / (H * A)), Math.min(1, h / H)];
}
/** How far the painting slides on the stage so a window that crops it frames its focus, never past what is cropped. */
export function slideFor(loc: Pick<LocationDef, 'focus'>, w: number, h: number): readonly [number, number] {
  const [x, y] = showOf(w, h);
  const cx = (1 - x) / 2;
  const cy = (1 - y) / 2;
  return [clamp(0.5 - loc.focus[0], -cx, cx), clamp(0.5 - loc.focus[1], -cy, cy)];
}
/** The gate's layer, in layout px (the game's stage may be scaled, so this is not the window's own size), and how many real
 *  pixels one of them is. */
function stageWindow(): { width: number; height: number; px: number } {
  const g = document.querySelector<HTMLElement>('.rgate');
  const width = (g?.clientWidth || window.innerWidth) + 32;
  const height = (g?.clientHeight || window.innerHeight) + 32;
  const scale = g && g.clientWidth ? g.getBoundingClientRect().width / g.clientWidth : 1;
  return { width, height, px: scale * (window.devicePixelRatio || 1) };
}

/** A reveal being made ready. `ready` never rejects: null = this machine gets the light version. */
export interface PreparedReveal {
  ready: Promise<RevealGl | null>;
  /** Throw it away (the gate opened without it). */
  drop: () => void;
}

/** Build a reveal a step a frame, off the player's way (see the header). */
export function prepareReveal(loc: LocationDef): PreparedReveal {
  let dropped = false;
  let made: RevealGl | null = null;
  const frame = (): Promise<void> => new Promise((r) => {
    let done = false;
    const go = (): void => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => setTimeout(go, 0)); // after the frame has painted
    setTimeout(go, 120); // a hidden tab runs no frames
  });
  const build = async (): Promise<RevealGl | null> => {
    const canvas = document.createElement('canvas');
    const { width: w, height: h, px } = stageWindow();
    // The fewest rows that still cover the window's own pixels.
    const need = Math.min(REVEAL_ROWS[0], stageHeight(w, h) * px * 0.95);
    let step = REVEAL_ROWS.filter((n) => n >= need).length - 1;
    const r = new RevealGl(canvas, loc, w, h);
    made = r;
    const pics = r.pictures().map(async (p) => {
      const res = await fetch(p.url);
      if (!res.ok) throw new Error(`${p.url} ${res.status}`);
      return { name: p.name, image: await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) };
    });
    pics.forEach((p) => p.catch(() => undefined)); // awaited below, in order
    for (const run of r.steps(REVEAL_ROWS[step]!)) { await frame(); if (dropped) return null; run(); }
    for (const p of pics) {
      const { name, image } = await p;
      await frame();
      if (dropped) { image.close(); return null; }
      r.addPicture(name, image);
      image.close();
    }
    let ms: number | null = null;
    for (const run of r.warmSteps()) { await frame(); if (dropped) return null; ms = run() ?? ms; }
    while (ms !== null && ms > REVEAL_STEP_MS && step < REVEAL_ROWS.length - 1) {
      step++;
      await frame();
      if (dropped) return null;
      r.setRows(REVEAL_ROWS[step]!);
      await frame();
      if (dropped) return null;
      ms = r.measure();
    }
    console.info(`[locationReveal] ${REVEAL_ROWS[step]} rows, a heavy frame ${ms?.toFixed(1)} ms`);
    if (ms !== null && ms > REVEAL_SLOW_MS) { console.info(`[locationReveal] light version: a heavy frame took ${clamp(ms, 0, 9999).toFixed(0)} ms`); return null; }
    return r.lost ? null : r;
  };
  const ready = build().catch((err) => { console.warn('[locationReveal] light version:', err instanceof Error ? err.message : err); return null; })
    .then((r) => { if (!r || dropped) { made?.destroy(); return null; } return r; });
  return { ready, drop: () => { dropped = true; made?.destroy(); } };
}
