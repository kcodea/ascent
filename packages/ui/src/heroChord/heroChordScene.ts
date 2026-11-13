/**
 * THE POWER CHORD SCENE: everything Power Chord draws in Pixi, as a plain scene graph with no renderer, so it runs (and
 * is tested) headless. `heroChord.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (an Epic is one strong idea): the STAFF is the stage and SOUND is the subject. The staff is five strips
 * between the two heroes; nothing on it is ever a static line. Each string is drawn in from the striker's end and twangs
 * as it pulls taut; a note riding a line drags a shiver along behind it; a chord landing makes every line thrum; and the
 * bass wave pushes a ripple down all five as its front crosses them. All of that is ONE sideways offset per point (sag +
 * vibration + shiver + ripple), written in place into the strips' vertices each frame: about 140 points in all.
 *
 * LAYERS (the shared `FxPool`'s four, plus the staff slotted in above `under`):
 *   under (normal: dust, the wave's shade) | staff (the strips) | glow (additive: halos, rings, the wave) |
 *   body (normal: the notes, the speakers) | core (additive: flashes, sparks)
 *
 * The SPEAKER STACK is seven pooled sprites (two cabinets, the amp head, four cones) laid out from its foot, so it can
 * fall in, squash on landing with each piece hopping a little later than the one under it, and kick on every pump. The
 * BASS WAVE is a few pooled crescents scaled out from the speakers along the line to the struck hero (see
 * `heroChordTextures.ts` for the anchor trick); it carries no filter and reads no pixels: the "bend" is the staff ripple
 * here and the struck portrait's skew in the runner.
 *
 * Contract: sprites are POOLED (`FxPool`, capped by `MAX_CHORD_SPRITES`) and the strips are made once per attack
 * (`MAX_CHORD_MESHES`); textures are the caller's (pre-warmed on the GPU during the damage formation); positions are the
 * overlay's px; `setCamera` mirrors the DOM camera when the runner asks it to; `update` returns whether anything still
 * draws; `destroy()` leaves nothing behind. Everything random is seeded (a replay scatters the same notes).
 */
import { Container, MeshSimple, type Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, easeOutCubic, mixColor, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { STAFF_LINES, type StackGeo } from './heroChordConfig';
import { BEAM_H, BEAM_HEAD, CAB_CONE_R, CAB_CONES, CAB_H, CAB_W, CONE_D, NOTE_H, NOTE_HEAD, WAVE_ANCHOR_X, WAVE_R } from './heroChordTextures';

export interface HeroChordTextures extends HeroArcanaTextures {
  /** A staff line's glow (a soft bell across V). */
  lineGlow: Texture;
  /** The string itself (an ink edge either side of a solid middle). */
  lineCore: Texture;
  /** An eighth note and a beamed pair: white, ink outline, glossy head. */
  note: Texture;
  pair: Texture;
  /** The speaker stack: a cabinet (two recesses), the amp head, and one cone. */
  cab: Texture;
  amp: Texture;
  cone: Texture;
  /** The bass wave's crescent. */
  wave: Texture;
}

export interface ChordColors { staff: number; noteA: number; noteB: number; noteC: number; wave: number; side: number }

export interface ChordLook {
  /** The string's width, px at stage scale 1, and its glow as a multiple of that. */
  width: number;
  glow: number;
  /** The sag at the middle of the staff, as a fraction of its length. */
  sag: number;
  /** One string's draw-in, and the delay between one string and the next. */
  stringMs: number;
  staggerMs: number;
  /** How far a string swings when it is plucked taut / when a chord lands (px at stage scale 1). */
  pluckPx: number;
  thrumPx: number;
  /** A string's vibration: how fast it swings and how long it takes to die away. */
  vibHz: number;
  vibMs: number;
  /** How long the staff takes to go slack and fade. */
  slackMs: number;
  /** How far the bass wave pushes the staff as its front crosses (px at stage scale 1). */
  bendPx: number;
  /** How far a cone kicks out on a pump (a fraction of its size). */
  pumpScale: number;
  /** The bass wave: how many bands, and their size. */
  waveBands: number;
  waveSize: number;
}

/** Hard cap on sprites alive at once (a Big impact peaks around 110). */
export const MAX_CHORD_SPRITES = 320;
/** The strips of one staff: a glow and a string per line. */
export const MAX_CHORD_MESHES = STAFF_LINES * 2;
/** Points along a staff line (56 vertices a strip, under Pixi's 100-vertex batch limit). */
export const STAFF_POINTS = 28;

/** How far apart the lines stand at `f` along the staff (0..1): pinched to a point at both ends, parallel between. */
export function staffSpread(f: number): number {
  const e = clamp01(Math.min(f, 1 - f) / 0.075);
  return e * e * (3 - 2 * e);
}

/** A rider's progress along the staff at `u` of its ride (0..1): it pulls away gently and is still speeding up as it lands. */
export function rideEase(u: number): number {
  const x = clamp01(u);
  return 0.4 * x + 0.6 * x * x;
}

/** The angle a note leans at so it sits naturally on a staff running at `ang`: the staff's own slope, never upside down, capped. */
export function noteLean(ang: number): number {
  let a = ang;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return Math.max(-0.7, Math.min(0.7, a));
}

interface Strip { mesh: MeshSimple; v: Float32Array }

interface Line {
  glow: Strip | null; core: Strip | null;
  /** Ms before this string starts drawing in. */
  delay: number;
  /** Its current vibration: ms since it was struck (-1 = still), the swing in px, and how many humps it has. */
  vibAge: number; vibAmp: number; vibMode: number;
  taut: boolean;
}

interface Staff {
  ax: number; ay: number; dx: number; dy: number; len: number;
  nx: number; ny: number; gap: number; sagPx: number;
  age: number; lines: Line[];
  /** Ms into going slack (-1 = taut). */
  slack: number;
}

interface Rider { s: Sprite; halo: Sprite | null; line: number; age: number; flyMs: number; lag: number; size: number; tint: number; trail: number }

/** A small note waiting on the staff (Big): the bass wave sweeps it away as its front arrives. */
interface Rest { s: Sprite; line: number; f: number; age: number; tint: number; size: number }

interface Stack {
  g: StackGeo; sc: number; age: number; dropMs: number; fall: number;
  cabs: Sprite[]; amp: Sprite | null; cones: Sprite[];
  landed: boolean;
  /** Ms since the last pump (-1 = none yet) and how hard it was. */
  pumpAge: number; pumpAmp: number;
  /** Ms into leaving (-1 = staying). */
  out: number;
}

interface Band { light: Sprite | null; shade: Sprite | null; lag: number }
interface Wave { ox: number; oy: number; ang: number; ux: number; uy: number; dist: number; age: number; travelMs: number; bands: Band[]; sigma: number }

export class HeroChordScene extends FxPool {
  private readonly staffLayer = new Container();
  private staff: Staff | null = null;
  private strips: Strip[] = [];
  private riders: Rider[] = [];
  private rests: Rest[] = [];
  private stack: Stack | null = null;
  private wave: Wave | null = null;
  private lean = 0;
  // The point `lineAt` last computed (no allocation on the hot path).
  private px = 0;
  private py = 0;

  constructor(private readonly tex: HeroChordTextures, private readonly colors: ChordColors, private readonly look: ChordLook, scale = 1, seed = 1) {
    super('heroChord', [tex.glow, tex.spark, tex.streak, tex.ring, tex.star, tex.lineGlow, tex.lineCore, tex.note, tex.pair, tex.cab, tex.amp, tex.cone, tex.wave], scale, seed, MAX_CHORD_SPRITES);
    this.staffLayer.label = 'heroChord-staff';
    this.root.addChildAt(this.staffLayer, 1);
  }

  get liveMeshes(): number { return this.strips.length; }
  get staffUp(): boolean { return this.staff !== null; }
  get liveRiders(): number { return this.riders.length; }
  get liveRests(): number { return this.rests.length; }
  get stackUp(): boolean { return this.stack !== null; }
  get stackLanded(): boolean { return !!this.stack?.landed; }
  get waveUp(): boolean { return this.wave !== null; }
  /** How far the wave's leading front has rolled (px from the speakers; 0 = no wave). */
  get waveFront(): number { const w = this.wave; return w ? this.frontOf(w, 0) : 0; }

  private noteTint(i: number): number { const c = this.colors; return i % 3 === 0 ? c.noteA : i % 3 === 1 ? c.noteB : c.noteC; }

  // ── the staff ─────────────────────────────────────────────────────────────────────────────────────────────

  /** String the staff from `from` to `to`: five lines `gap` apart across it, drawn in one after another. */
  string(from: Pt, to: Pt, across: Pt, gap: number, late = 0): void {
    if (this.destroyed || this.staff) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = STAFF_POINTS;
    const uv = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) { const u = j / (n - 1); uv.set([u, 0, u, 1], j * 4); }
    const ix = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
    const strip = (t: Texture, tint: number, blend: 'normal' | 'add'): Strip => {
      const mesh = new MeshSimple({ texture: t, vertices: new Float32Array(n * 4), uvs: uv, indices: ix });
      mesh.blendMode = blend; mesh.tint = tint; mesh.alpha = 0;
      this.staffLayer.addChild(mesh);
      const s = { mesh, v: mesh.vertices as Float32Array };
      this.strips.push(s);
      return s;
    };
    const lines: Line[] = [];
    // Every glow first, then every string: the staff batches in two runs.
    const glows = Array.from({ length: STAFF_LINES }, () => strip(this.tex.lineGlow, this.colors.side, 'add'));
    for (let i = 0; i < STAFF_LINES; i++) {
      lines.push({ glow: glows[i]!, core: strip(this.tex.lineCore, this.colors.staff, 'normal'), delay: i * this.look.staggerMs, vibAge: -1, vibAmp: 0, vibMode: 1, taut: false });
    }
    this.lean = noteLean(Math.atan2(dy, dx));
    this.staff = { ax: from.x, ay: from.y, dx, dy, len, nx: across.x, ny: across.y, gap, sagPx: this.look.sag * len, age: Math.max(0, late), lines, slack: -1 };
  }

  /** Strike one line (it swings `px` and rings down), or every line when `line` is -1 (alternating, so the staff shimmers). */
  pluck(line: number, px: number, mode = 1): void {
    const st = this.staff;
    if (!st) return;
    st.lines.forEach((l, i) => {
      if (line >= 0 && i !== line) return;
      l.vibAge = 0;
      l.vibAmp = px * this.scale * (line < 0 && i % 2 ? -1 : 1);
      l.vibMode = line < 0 ? 1 + (i % 2) : mode;
    });
  }

  /** Every line thrums (a chord landed). */
  thrum(): void { this.pluck(-1, this.look.thrumPx); }

  /** The staff goes slack and fades; the speakers (if any) leave with it. */
  slacken(): void {
    if (this.staff && this.staff.slack < 0) this.staff.slack = 0;
    if (this.stack && this.stack.out < 0) this.stack.out = 0;
  }

  /** The sideways offset of line `i` at `f` along the staff (everything that moves a string, in one number). */
  private offsetAt(st: Staff, i: number, f: number): number {
    const l = st.lines[i]!;
    const slackU = st.slack < 0 ? 0 : clamp01(st.slack / this.look.slackMs);
    const hump = Math.sin(Math.PI * f);
    let o = (i - (STAFF_LINES - 1) / 2) * st.gap * staffSpread(f) + st.sagPx * hump * (1 + 2.2 * slackU);
    if (l.vibAge >= 0) o += l.vibAmp * spring(l.vibAge, this.look.vibHz, this.look.vibMs) * Math.sin(Math.PI * f * l.vibMode);
    // The shiver a riding note drags behind it on its own line.
    for (const r of this.riders) {
      if (r.line !== i) continue;
      const back = (this.riderF(r) - f) * st.len;
      if (back <= 0) continue;
      o += this.look.pluckPx * 0.8 * this.scale * Math.sin(back * 0.085) * Math.exp(-back / (150 * this.scale)) * hump;
    }
    // The bass wave's front crossing: a push ahead of it and a dip behind (one ripple, riding the front).
    const w = this.wave;
    if (w) {
      const x = st.ax + st.dx * f - w.ox, y = st.ay + st.dy * f - w.oy;
      const q = (Math.hypot(x, y) - this.frontOf(w, 0)) / w.sigma;
      if (q > -3 && q < 3) o += this.look.bendPx * this.scale * 2.33 * q * Math.exp(-q * q) * hump * this.waveFade(w);
    }
    return o;
  }

  /** Where line `i` is at `f` along the staff, into `px` / `py`. */
  private lineAt(st: Staff, i: number, f: number): void {
    const o = this.offsetAt(st, i, f);
    this.px = st.ax + st.dx * f + st.nx * o;
    this.py = st.ay + st.dy * f + st.ny * o;
  }

  private writeStaff(st: Staff, dt: number): boolean {
    const n = STAFF_POINTS;
    const L = this.look;
    const S = this.scale;
    if (st.slack >= 0) st.slack += dt;
    const slackU = st.slack < 0 ? 0 : clamp01(st.slack / L.slackMs);
    const alpha = 1 - slackU;
    const hw = L.width * S * 0.5, gw = hw * L.glow;
    for (let i = 0; i < st.lines.length; i++) {
      const l = st.lines[i]!;
      if (l.vibAge >= 0) { l.vibAge += dt; if (l.vibAge > L.vibMs * 6) l.vibAge = -1; }
      const drawn = easeOutCubic((st.age - l.delay) / L.stringMs);
      if (!l.taut && st.age - l.delay >= L.stringMs) {
        // Pulled taut: it twangs.
        l.taut = true; l.vibAge = 0; l.vibAmp = L.pluckPx * S * (i % 2 ? -1 : 1); l.vibMode = 1;
      }
      const head = drawn * (n - 1);
      const g = l.glow, c = l.core;
      if (!g || !c) continue;
      for (let j = 0; j < n; j++) {
        const f = Math.min(j, head) / (n - 1);
        this.lineAt(st, i, f);
        const past = j > head + 1 ? 0 : 1;
        const k = j * 4;
        g.v[k] = this.px + st.nx * gw * past; g.v[k + 1] = this.py + st.ny * gw * past; g.v[k + 2] = this.px - st.nx * gw * past; g.v[k + 3] = this.py - st.ny * gw * past;
        c.v[k] = this.px + st.nx * hw * past; c.v[k + 1] = this.py + st.ny * hw * past; c.v[k + 2] = this.px - st.nx * hw * past; c.v[k + 3] = this.py - st.ny * hw * past;
      }
      const on = st.age >= l.delay ? 1 : 0;
      // A string glows brighter while it is swinging.
      const ring = l.vibAge >= 0 ? Math.exp(-l.vibAge / L.vibMs) : 0;
      g.mesh.alpha = on * alpha * (0.4 + 0.5 * ring);
      c.mesh.alpha = on * alpha * 0.95;
    }
    return slackU < 1;
  }

  // ── the notes ─────────────────────────────────────────────────────────────────────────────────────────────

  private riderF(r: Rider): number { return rideEase(r.age / r.flyMs) * (1 - r.lag); }

  /** A note leaves the striker's end of line `line` and rides it to the struck hero over `flyMs`. */
  ride(line: number, o: { flyMs: number; lag: number; size: number; hue: number; late?: number }): void {
    if (!this.staff) return;
    const tint = this.noteTint(o.hue);
    const halo = this.take('glow', this.tex.glow, tint);
    const s = this.take('body', this.tex.note, whiten(tint, 0.12));
    if (!s) { this.give(halo); return; }
    s.anchor.set(NOTE_HEAD.x, NOTE_HEAD.y);
    s.alpha = 0;
    if (halo) halo.alpha = 0;
    this.riders.push({ s, halo, line: Math.max(0, Math.min(STAFF_LINES - 1, Math.round(line))), age: Math.max(0, o.late ?? 0), flyMs: Math.max(1, o.flyMs), lag: o.lag, size: o.size, tint, trail: 0 });
  }

  /** Small notes pop onto the staff and wait there (Big: one batch per pump). The bass wave sweeps them away. */
  rest(n: number, fromF = 0.16, toF = 0.8): void {
    const st = this.staff;
    if (!st) return;
    for (let i = 0; i < n; i++) {
      const hue = this.rests.length;
      const s = this.take('body', hue % 4 === 3 ? this.tex.pair : this.tex.note, this.noteTint(hue));
      if (!s) return;
      const pair = hue % 4 === 3;
      s.anchor.set(pair ? BEAM_HEAD.x : NOTE_HEAD.x, pair ? BEAM_HEAD.y : NOTE_HEAD.y);
      s.alpha = 0;
      const f = fromF + (toF - fromF) * ((i + 0.2 + this.rnd() * 0.6) / n);
      const line = Math.floor(this.rnd() * STAFF_LINES) % STAFF_LINES;
      this.rests.push({ s, line, f, age: -i * 45, tint: this.noteTint(hue), size: 0.5 + this.rnd() * 0.14 });
    }
  }

  /** The height (px) a note is drawn at for a size of 1, at stage scale 1. */
  private static readonly NOTE_PX = 118;

  private tickNotes(st: Staff, dt: number): void {
    const S = this.scale;
    const unit = (HeroChordScene.NOTE_PX / NOTE_H) * S;
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i]!;
      r.age += dt;
      if (r.age >= r.flyMs) { this.give(r.s); this.give(r.halo); this.riders.splice(i, 1); continue; }
      this.lineAt(st, r.line, this.riderF(r));
      const pop = easeOutBack(r.age / 110, 2.6);
      const sc = unit * r.size * pop;
      r.s.position.set(this.px, this.py);
      r.s.scale.set(sc);
      r.s.rotation = this.lean + Math.sin(r.age * 0.021 + r.line) * 0.1;
      r.s.alpha = clamp01(r.age / 50);
      if (r.halo) {
        r.halo.position.set(this.px, this.py);
        r.halo.scale.set(((HeroChordScene.NOTE_PX * 1.5) / 128) * r.size * S * (1 + 0.08 * Math.sin(r.age * 0.03)));
        r.halo.alpha = 0.5 * clamp01(r.age / 80);
      }
      // A sparkle shed along the line every few frames.
      r.trail += dt;
      if (r.trail >= 28) {
        r.trail = 0;
        this.spawn('core', this.rnd() < 0.5 ? this.tex.star : this.tex.spark, whiten(r.tint, 0.4), this.px + (this.rnd() - 0.5) * 14 * S, this.py + (this.rnd() - 0.5) * 14 * S, {
          dur: 240 + this.rnd() * 120, from: 0.42 * r.size, to: 0.08, a0: 0.9, rot: this.rnd() * 3, spin: 0.004,
        });
      }
    }
    const w = this.wave;
    for (let i = this.rests.length - 1; i >= 0; i--) {
      const r = this.rests[i]!;
      r.age += dt;
      if (r.age < 0) continue;
      this.lineAt(st, r.line, r.f);
      const tall = r.s.texture === this.tex.pair ? BEAM_H : NOTE_H;
      const sc = (HeroChordScene.NOTE_PX / tall) * S * r.size * easeOutBack(r.age / 150, 3);
      // Swept away: the front has reached it.
      if (w && Math.hypot(this.px - w.ox, this.py - w.oy) <= this.frontOf(w, 0) + 30 * S) {
        const tx = r.s.texture, ax = r.s.anchor.x, ay = r.s.anchor.y;
        this.give(r.s);
        const sp = 900 + this.rnd() * 500, side = (this.rnd() - 0.5) * 520;
        const b = this.spawn('body', tx, r.tint, this.px, this.py, {
          dur: 420 + this.rnd() * 160, from: sc / S, to: (sc / S) * 0.7, a0: 1, mode: 'hold', ease: 'linear',
          vx: w.ux * sp - w.uy * side, vy: w.uy * sp + w.ux * side - 120, drag: 0.12, grav: 500, rot: this.lean, spin: (this.rnd() - 0.5) * 0.03,
        });
        b?.anchor.set(ax, ay);
        this.rests.splice(i, 1);
        continue;
      }
      r.s.position.set(this.px, this.py);
      r.s.scale.set(sc);
      r.s.rotation = this.lean + Math.sin(r.age * 0.006 + r.f * 20) * 0.12;
      r.s.alpha = clamp01(r.age / 60);
    }
  }

  /**
   * THE impact: a hot flash, a ring and a RING OF SMALL NOTES thrown off the struck portrait (they fly out, slow, tip
   * over and fall). Medium adds a second ring and twinkles; Big a wide shock ring.
   */
  strike(x: number, y: number, radius: number, o: { level: number; notes: number; sparks: number; burst: number; flashAlpha: number; dir?: Pt }): void {
    const S = this.scale;
    const c = this.colors;
    const d = (radius * 2) / 128 / S;
    const rd = (radius * 2) / 160 / S; // a ring the size of the portrait
    this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 230, from: d * 0.35, to: d * 0.85 * o.burst, a0: o.flashAlpha, follow: true });
    this.spawn('glow', this.tex.glow, c.noteA, x, y, { dur: 380, from: d * 0.5, to: d * 1.15 * o.burst, a0: 0.5, mode: 'punch', peakAt: 0.12, follow: true });
    this.spawn('glow', this.tex.ring, c.noteA, x, y, { dur: 340, from: rd * 0.3, to: rd * 1.15 * o.burst, a0: 0.8, follow: true });
    if (o.level >= 2) this.spawn('glow', this.tex.ring, c.noteB, x, y, { dur: 460, from: rd * 0.4, to: rd * 1.6 * o.burst, a0: 0.55, follow: true });
    if (o.level >= 3) this.spawn('glow', this.tex.ring, c.wave, x, y, { dur: 560, from: rd * 0.5, to: rd * 2.4 * o.burst, a0: 0.6 });
    // The ring of notes: evenly round the face, each one thrown outward.
    const n = Math.max(0, Math.round(o.notes));
    const start = this.rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.22;
      const pair = i % 4 === 3;
      const sp = (560 + this.rnd() * 300) * (0.85 + 0.15 * o.burst);
      const r0 = radius * 0.35;
      const size = ((HeroChordScene.NOTE_PX * (0.46 + this.rnd() * 0.16)) / (pair ? BEAM_H : NOTE_H)) * (0.9 + 0.1 * o.burst);
      // On Big the ring leans downwind (the wave carries it).
      const wx = o.dir ? o.dir.x * 260 : 0, wy = o.dir ? o.dir.y * 260 : 0;
      const s = this.spawn('body', pair ? this.tex.pair : this.tex.note, this.noteTint(i), x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        dur: 620 + this.rnd() * 220, from: size * 0.5, to: size, a0: 1, mode: 'hold', ease: 'quint',
        vx: Math.cos(a) * sp + wx, vy: Math.sin(a) * sp + wy - 90, drag: 0.06, grav: 620, rot: this.lean + (this.rnd() - 0.5) * 0.5, spin: (this.rnd() - 0.5) * 0.008,
      });
      s?.anchor.set(pair ? BEAM_HEAD.x : NOTE_HEAD.x, pair ? BEAM_HEAD.y : NOTE_HEAD.y);
    }
    this.burst('core', this.tex.streak, [0xffffff, c.noteA, c.noteB, c.noteC], x, y, o.sparks, { speed: 720, life: 300, size: 0.34, grav: 260, drag: 0.03, align: true });
    if (o.level >= 2) {
      for (let i = 0; i < 5; i++) {
        const a = this.rnd() * Math.PI * 2, rr = radius * (0.4 + this.rnd() * 0.9);
        this.spawn('core', this.tex.star, 0xffffff, x + Math.cos(a) * rr, y + Math.sin(a) * rr, { dur: 260 + this.rnd() * 200, from: 0.1, to: 0.6, a0: 0.9, mode: 'punch', peakAt: 0.3, rot: this.rnd() * Math.PI, delay: this.rnd() * 120 });
      }
    }
  }

  // ── the speakers ──────────────────────────────────────────────────────────────────────────────────────────

  /** The speaker stack falls in from above the view and lands in `g` after `dropMs`. */
  dropStack(g: StackGeo, dropMs: number, late = 0): void {
    if (this.destroyed || this.stack) return;
    const sc = g.w / CAB_W;
    const cabs: Sprite[] = [];
    for (let i = 0; i < 2; i++) { const s = this.take('body', this.tex.cab, 0xffffff); if (s) { s.anchor.set(0.5, 1); cabs.push(s); } }
    const amp = this.take('body', this.tex.amp, 0xffffff);
    amp?.anchor.set(0.5, 1);
    const cones: Sprite[] = [];
    for (let i = 0; i < cabs.length * CAB_CONES.length; i++) { const s = this.take('body', this.tex.cone, 0xffffff); if (s) cones.push(s); }
    // It starts just above the top of the view, however high its spot is.
    const fall = Math.max(g.h * 0.8, g.y + g.h / 2 + 30 * this.scale);
    this.stack = { g, sc, age: Math.max(0, late), dropMs: Math.max(1, dropMs), fall, cabs, amp, cones, landed: false, pumpAge: -1, pumpAmp: 0, out: -1 };
    this.layStack(this.stack);
  }

  /** The cones kick (`amp` 1 = a count-in pump; the drop kicks harder) and a soft ring leaves each one. */
  pump(amp = 1, notes = 0): void {
    const st = this.stack;
    if (!st) return;
    st.pumpAge = 0; st.pumpAmp = amp;
    for (const cn of st.cones) {
      this.spawn('glow', this.tex.ring, this.colors.wave, cn.x, cn.y, { dur: 300, from: (CAB_CONE_R * 2 * st.sc) / 160 / this.scale, to: (CAB_CONE_R * 2 * (1.7 + 0.5 * amp) * st.sc) / 160 / this.scale, a0: 0.5 * Math.min(1.4, amp), ease: 'cubic' });
    }
    // Notes pop out of the top of the stack.
    const top = st.g.y - st.g.h * 0.5;
    for (let i = 0; i < notes; i++) {
      const s = this.spawn('body', this.tex.note, this.noteTint(i + (amp > 1 ? 1 : 0)), st.g.x + (this.rnd() - 0.5) * st.g.w * 0.7, top + st.g.h * 0.12, {
        dur: 520 + this.rnd() * 160, from: 0.1, to: (HeroChordScene.NOTE_PX * 0.36) / NOTE_H, a0: 1, mode: 'hold',
        vx: (this.rnd() - 0.5) * 260, vy: -(300 + this.rnd() * 160), drag: 0.25, grav: 520, rot: (this.rnd() - 0.5) * 0.5, spin: (this.rnd() - 0.5) * 0.006,
      });
      s?.anchor.set(NOTE_HEAD.x, NOTE_HEAD.y);
    }
  }

  /** Lay the stack's seven sprites out from its foot for this frame (the fall, the landing squash, the hop, the pump). */
  private layStack(st: Stack): boolean {
    const S = this.scale;
    const { g, sc } = st;
    const landing = st.age - st.dropMs;
    const u = clamp01(st.age / st.dropMs);
    const fallY = -st.fall * (1 - u * u);
    // The landing: the whole stack squashes and rings back.
    const sq = landing >= 0 ? 0.13 * spring(landing, 5.5, 85) : -0.05 * u;
    const kick = st.pumpAge >= 0 ? st.pumpAmp * Math.max(0, spring(st.pumpAge, 6, 70)) : 0;
    const out = st.out < 0 ? 0 : clamp01(st.out / 240);
    const outE = out * out;
    const sx = (1 + sq * 0.6 + kick * 0.03) * (1 - 0.1 * outE), sy = (1 - sq + kick * 0.02) * (1 - 0.1 * outE);
    const alpha = 1 - outE;
    const foot = g.y + g.h / 2 + fallY + 40 * S * outE;
    const cabH = (CAB_H - 4) * sc;
    let y = foot;
    for (let i = 0; i < st.cabs.length; i++) {
      const s = st.cabs[i]!;
      // Each piece hops a little later and a little higher than the one under it.
      const hop = landing >= 0 && i > 0 ? this.hop(landing, i) : 0;
      const k = i === 0 ? 1 : 0.94;
      s.position.set(g.x, y - hop);
      s.scale.set(sc * sx * k, sc * sy * k);
      s.alpha = alpha;
      for (let j = 0; j < CAB_CONES.length; j++) {
        const cn = st.cones[i * CAB_CONES.length + j];
        if (!cn) continue;
        const p = CAB_CONES[j]!;
        const csc = ((CAB_CONE_R * 2) / CONE_D) * sc * k;
        cn.position.set(g.x + (p.x - CAB_W / 2) * sc * sx * k, y - hop - (CAB_H - p.y) * sc * sy * k);
        // The cone leaps out of its recess on a pump (the lower pair a touch harder).
        const pk = 1 + this.look.pumpScale * kick * (i === 0 ? 1 : 0.85);
        cn.scale.set(csc * sx * pk, csc * sy * pk);
        cn.alpha = alpha;
        cn.tint = kick > 0.02 ? mixColor(0xffffff, whiten(this.colors.wave, 0.3), Math.min(1, kick)) : 0xffffff;
      }
      y -= cabH * sy * k;
    }
    if (st.amp) {
      const hop = landing >= 0 ? this.hop(landing, 2) : 0;
      st.amp.position.set(g.x, y - hop + 2 * sc);
      st.amp.scale.set(sc * sx * 0.94, sc * sy * 0.94);
      st.amp.alpha = alpha;
    }
    return out < 1;
  }

  /** A stacked piece's hop after the landing: piece `i` leaves later, rises higher and takes longer. */
  private hop(landing: number, i: number): number {
    const t = (landing - 18 * i) / (130 + 45 * i);
    return t > 0 && t < 1 ? Math.sin(Math.PI * t) * (5 + 6 * i) * this.scale : 0;
  }

  private tickStack(st: Stack, dt: number): boolean {
    st.age += dt;
    if (st.pumpAge >= 0) st.pumpAge += dt;
    if (st.out >= 0) st.out += dt;
    if (!st.landed && st.age >= st.dropMs) {
      st.landed = true;
      // Dust kicked out along the floor either side, and a soft ring off the foot.
      const S = this.scale;
      const foot = st.g.y + st.g.h / 2;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          this.spawn('under', this.tex.glow, 0xd9cdb8, st.g.x + side * st.g.w * 0.35, foot - 4 * S, {
            dur: 420 + i * 70, from: 0.18, to: (st.g.w / 128 / S) * (0.5 + 0.18 * i), a0: 0.4, sy: 0.55, ease: 'cubic', vx: side * (150 + 90 * i), vy: -24 - 18 * i, drag: 0.05,
          });
        }
      }
      this.spawn('glow', this.tex.ring, 0xfff2d6, st.g.x, foot, { dur: 300, from: 0.2, to: (st.g.w * 1.9) / 160 / S, a0: 0.45, sy: 0.28, ease: 'cubic' });
    }
    return this.layStack(st);
  }

  // ── the bass wave ─────────────────────────────────────────────────────────────────────────────────────────

  /** The bass wave rolls out of the speakers at `from` and its front reaches `to` after `travelMs`. */
  bass(from: Pt, to: Pt, travelMs: number, late = 0): void {
    if (this.destroyed || this.wave) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bands: Band[] = [];
    const n = Math.max(1, Math.min(4, Math.round(this.look.waveBands)));
    for (let i = 0; i < n; i++) {
      const shade = this.take('under', this.tex.wave, 0x0a0f2a);
      const light = this.take('glow', this.tex.wave, i === 0 ? whiten(this.colors.wave, 0.35) : this.colors.wave);
      for (const s of [shade, light]) { if (s) { s.anchor.set(WAVE_ANCHOR_X, 0.5); s.alpha = 0; s.rotation = Math.atan2(dy, dx); s.position.set(from.x, from.y); } }
      bands.push({ light, shade, lag: i * 78 });
    }
    this.wave = { ox: from.x, oy: from.y, ang: Math.atan2(dy, dx), ux: dx / dist, uy: dy / dist, dist, age: Math.max(0, late), travelMs: Math.max(1, travelMs), bands, sigma: 70 * this.scale };
  }

  /** How far a band's front is from the speakers (constant speed: it reaches the struck hero at `travelMs` and rolls on). */
  private frontOf(w: Wave, lag: number): number { return Math.max(0, (w.age - lag) / w.travelMs) * w.dist; }

  /** The wave's strength: full while it crosses, dying away once the front is past the struck hero. */
  private waveFade(w: Wave): number { return 1 - clamp01((w.age / w.travelMs - 1) / 0.32); }

  private tickWave(w: Wave, dt: number): boolean {
    w.age += dt;
    const S = this.scale;
    let alive = false;
    for (const b of w.bands) {
      const r = this.frontOf(w, b.lag);
      const u = (w.age - b.lag) / w.travelMs;
      const on = u > 0 && u < 1.34;
      // Each band fades in as it clears the speakers and out once it is past the struck hero; later bands are fainter.
      const a = on ? clamp01(r / (120 * S)) * (1 - clamp01((u - 1) / 0.32)) * (1 - 0.22 * (b.lag / 78)) : 0;
      const sc = Math.max(0.02, r / WAVE_R);
      // Its size across follows the radius (a real front), its thickness is held nearer constant so it stays a crisp band.
      const sx = sc * this.look.waveSize * (0.55 + 0.45 * Math.min(1, (400 * S) / Math.max(1, r)));
      if (b.light) { b.light.scale.set(sx, sc); b.light.alpha = a; this.placeBand(b.light, w, r, sx); }
      if (b.shade) { b.shade.scale.set(sx, sc); b.shade.alpha = a * 0.34; this.placeBand(b.shade, w, r - 26 * S, sx); }
      if (u < 1.34) alive = true;
    }
    if (!alive) {
      for (const b of w.bands) { this.give(b.light); this.give(b.shade); }
      this.wave = null;
    }
    return alive;
  }

  /** Put a crescent so its leading rim sits `r` out from the speakers, whatever its x scale (its thickness) is. */
  private placeBand(s: Sprite, w: Wave, r: number, sx: number): void {
    // The sprite's anchor is the circle's centre, so at x scale `sx` its rim sits `WAVE_R * sx` from its position.
    const back = Math.max(0, r) - WAVE_R * sx;
    s.position.set(w.ox + w.ux * back, w.oy + w.uy * back);
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    let alive = false;
    const st = this.staff;
    if (this.wave && this.tickWave(this.wave, dt)) alive = true;
    if (st) {
      st.age += dt;
      this.tickNotes(st, dt);
      if (this.writeStaff(st, dt)) alive = true;
      else this.dropStaff();
    }
    if (this.stack) {
      if (this.tickStack(this.stack, dt)) alive = true;
      else this.dropStack_();
    }
    return alive || this.riders.length > 0 || this.rests.length > 0;
  }

  private dropStaff(): void {
    for (const r of this.riders) { this.give(r.s); this.give(r.halo); }
    for (const r of this.rests) this.give(r.s);
    this.riders = []; this.rests = [];
    for (const s of this.strips) { this.staffLayer.removeChild(s.mesh); s.mesh.destroy(); }
    this.strips = [];
    this.staff = null;
  }

  private dropStack_(): void {
    const st = this.stack;
    if (!st) return;
    for (const s of st.cabs) this.give(s);
    for (const s of st.cones) { s.tint = 0xffffff; this.give(s); }
    this.give(st.amp);
    this.stack = null;
  }

  protected override clearOwn(): void {
    this.dropStaff();
    this.dropStack_();
    if (this.wave) { for (const b of this.wave.bands) { this.give(b.light); this.give(b.shade); } this.wave = null; }
  }

}

export type { Pt };
