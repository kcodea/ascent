/**
 * THE POWER CHORD SCENE: everything Power Chord draws in Pixi, as a plain scene graph with no renderer, so it runs (and
 * is tested) headless. `heroChord.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (an Epic is one strong idea): the STAFF is the stage and SOUND is the subject, and all of it is LIGHT. The
 * staff is five glowing strings between the two heroes, laid over one soft dark band so they read as energy on a bright
 * board; nothing on it is ever a static line. Each string is drawn in from the striker's end and twangs as it pulls
 * taut; a note riding a line drags a shiver along behind it; a chord landing makes every line thrum; and the bass wave
 * pushes a hard ripple down all five as its front crosses them. All of that is ONE sideways offset per point (sag +
 * vibration + shiver + ripple), written in place into the strips' vertices each frame: about 140 points in all.
 *
 * LAYERS (the shared `FxPool`'s four, plus the staff slotted in above `under`):
 *   under (normal: the wave's shade) | staff (the strips) | glow (additive: halos, rings, the wave) |
 *   body (normal: the notes) | core (additive: flashes, sparks, the notes' own light)
 *
 * THE SPEAKER is the striking portrait itself (the first pass drew a stack of cabinets; the second pass cut it: no
 * drawn prop). Rings of light settle round the portrait when it powers up, flare and punch outward on every pump of the
 * count-in, pull in for the inhale, and are flung out on the drop. The BASS WAVE is a TRAIN of thick fronts: pooled
 * crescents scaled out from the portrait along the line to the struck hero (see `heroChordTextures.ts` for the anchor
 * trick), each with a coloured twin a little behind it, dragging streaks of air; later fronts follow as fire-and-forget
 * crescents. It carries no filter and reads no pixels: the "bend" is the staff ripple and the swept notes here, and the
 * struck portrait's skew in the runner.
 *
 * Contract: sprites are POOLED (`FxPool`, capped by `MAX_CHORD_SPRITES`) and the strips are made once per attack
 * (`MAX_CHORD_MESHES`); textures are the caller's (pre-warmed on the GPU during the damage formation); positions are the
 * overlay's px; `setCamera` mirrors the DOM camera when the runner asks it to; `update` returns whether anything still
 * draws; `destroy()` leaves nothing behind. Everything random is seeded (a replay scatters the same notes).
 */
import { Container, MeshSimple, Texture, type Sprite } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, easeOutCubic, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { STAFF_LINES, type SpeakerGeo } from './heroChordConfig';
import { BEAM_H, BEAM_HEAD, NOTE_H, NOTE_HEAD, WAVE_ANCHOR_X, WAVE_R } from './heroChordTextures';

export interface HeroChordTextures extends HeroArcanaTextures {
  /** A staff line's glow (a soft bell across V); also the dark band under the whole staff. */
  lineGlow: Texture;
  /** The string itself (a white-hot middle with a soft shoulder; drawn additive). */
  lineCore: Texture;
  /** An eighth note and a beamed pair: white, ink outline, glossy head. */
  note: Texture;
  pair: Texture;
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
  /** How far the speaker's rings swell on a pump (a fraction of their size). */
  pumpScale: number;
  /** The bass wave: how many bands, and their size. */
  waveBands: number;
  waveSize: number;
}

/** Hard cap on sprites alive at once (a Big impact peaks around 190). */
export const MAX_CHORD_SPRITES = 420;
/** The strips of one staff: the dark band under it, then a glow and a string per line. */
export const MAX_CHORD_MESHES = STAFF_LINES * 2 + 1;
/** The speaker's standing rings, as multiples of the portrait's radius. */
export const SPEAKER_RINGS = [1.14, 1.42, 1.74] as const;
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
  /** The soft dark band under the whole staff (so the strings read as light on a bright board). */
  back: Strip | null;
  /** Ms into going slack (-1 = taut). */
  slack: number;
}

interface Rider { s: Sprite; halo: Sprite | null; lit: Sprite | null; line: number; age: number; flyMs: number; lag: number; size: number; tint: number; trail: number }

/** A small note waiting on the staff (Big): the bass wave sweeps it away as its front arrives. */
interface Rest { s: Sprite; halo: Sprite | null; line: number; f: number; age: number; tint: number; size: number }

/** The speaker: the striking portrait, wearing rings of light. */
interface Speaker {
  g: SpeakerGeo; age: number;
  rings: Sprite[]; glow: Sprite | null;
  /** Ms since the last pump (-1 = none yet) and how hard it was. */
  pumpAge: number; pumpAmp: number;
  /** The inhale: ms into it (-1 = not inhaling) and how long it lasts. */
  inAge: number; inMs: number;
  /** Ms into leaving (-1 = staying). */
  out: number;
}

interface Band { light: Sprite | null; twin: Sprite | null; shade: Sprite | null; lag: number }
interface Wave { ox: number; oy: number; ang: number; ux: number; uy: number; dist: number; r0: number; age: number; travelMs: number; bands: Band[]; sigma: number; acc: number }

export class HeroChordScene extends FxPool {
  private readonly staffLayer = new Container();
  private staff: Staff | null = null;
  private strips: Strip[] = [];
  private riders: Rider[] = [];
  private rests: Rest[] = [];
  private speaker: Speaker | null = null;
  private wave: Wave | null = null;
  private flashFx: { s: Sprite; age: number; a0: number; w: number; h: number } | null = null;
  private lean = 0;
  // The point `lineAt` last computed (no allocation on the hot path).
  private px = 0;
  private py = 0;

  constructor(private readonly tex: HeroChordTextures, private readonly colors: ChordColors, private readonly look: ChordLook, scale = 1, seed = 1) {
    super('heroChord', [tex.glow, tex.spark, tex.streak, tex.ring, tex.star, tex.lineGlow, tex.lineCore, tex.note, tex.pair, tex.wave], scale, seed, MAX_CHORD_SPRITES);
    this.staffLayer.label = 'heroChord-staff';
    this.root.addChildAt(this.staffLayer, 1);
  }

  get liveMeshes(): number { return this.strips.length; }
  get staffUp(): boolean { return this.staff !== null; }
  get liveRiders(): number { return this.riders.length; }
  get liveRests(): number { return this.rests.length; }
  get speakerUp(): boolean { return this.speaker !== null; }
  /** How hard the speaker is kicking right now (0 at rest; the runner's tests read it). */
  get speakerKick(): number { const k = this.speaker; return k && k.pumpAge >= 0 ? k.pumpAmp * Math.max(0, spring(k.pumpAge, 6, 70)) : 0; }
  get waveUp(): boolean { return this.wave !== null; }
  /** How far the wave's leading front has rolled (px from the speaker's centre; 0 = no wave). */
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
    // The dark band first (normal), then every glow, then every string (both additive): three runs.
    const back = strip(this.tex.lineGlow, 0x0b0f2e, 'normal');
    const glows = Array.from({ length: STAFF_LINES }, () => strip(this.tex.lineGlow, this.colors.side, 'add'));
    for (let i = 0; i < STAFF_LINES; i++) {
      lines.push({ glow: glows[i]!, core: strip(this.tex.lineCore, whiten(this.colors.staff, 0.3), 'add'), delay: i * this.look.staggerMs, vibAge: -1, vibAmp: 0, vibMode: 1, taut: false });
    }
    this.lean = noteLean(Math.atan2(dy, dx));
    this.staff = { ax: from.x, ay: from.y, dx, dy, len, nx: across.x, ny: across.y, gap, sagPx: this.look.sag * len, age: Math.max(0, late), lines, back, slack: -1 };
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

  /** The staff goes slack and fades; the speaker's rings (if any) fade with it. */
  slacken(): void {
    if (this.staff && this.staff.slack < 0) this.staff.slack = 0;
    if (this.speaker && this.speaker.out < 0) this.speaker.out = 0;
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
      // A string is light: it glows steadily and flares while it is swinging.
      const ring = l.vibAge >= 0 ? Math.exp(-l.vibAge / L.vibMs) : 0;
      g.mesh.alpha = on * alpha * (0.62 + 0.38 * ring);
      c.mesh.alpha = on * alpha * (0.85 + 0.15 * ring);
    }
    // The dark band follows the middle line, as wide as the staff, drawn in with the first string.
    const b = st.back;
    if (b) {
      const mid = (STAFF_LINES - 1) / 2;
      const l0 = st.lines[0]!;
      const head = easeOutCubic((st.age - l0.delay) / L.stringMs) * (n - 1);
      for (let j = 0; j < n; j++) {
        const f = Math.min(j, head) / (n - 1);
        this.lineAt(st, mid, f);
        const bw = j > head + 1 ? 0 : (mid + 1.1) * st.gap * staffSpread(f) + gw;
        const k = j * 4;
        b.v[k] = this.px + st.nx * bw; b.v[k + 1] = this.py + st.ny * bw; b.v[k + 2] = this.px - st.nx * bw; b.v[k + 3] = this.py - st.ny * bw;
      }
      b.mesh.alpha = 0.5 * alpha * clamp01(st.age / 120);
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
    // The note's own light: the same note again, additive, so it glows instead of sitting there as ink.
    const lit = this.take('core', this.tex.note, tint);
    if (lit) { lit.anchor.set(NOTE_HEAD.x, NOTE_HEAD.y); lit.alpha = 0; }
    this.riders.push({ s, halo, lit, line: Math.max(0, Math.min(STAFF_LINES - 1, Math.round(line))), age: Math.max(0, o.late ?? 0), flyMs: Math.max(1, o.flyMs), lag: o.lag, size: o.size, tint, trail: 0 });
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
      const halo = this.take('glow', this.tex.glow, this.noteTint(hue));
      if (halo) halo.alpha = 0;
      const f = fromF + (toF - fromF) * ((i + 0.2 + this.rnd() * 0.6) / n);
      const line = Math.floor(this.rnd() * STAFF_LINES) % STAFF_LINES;
      this.rests.push({ s, halo, line, f, age: -i * 45, tint: this.noteTint(hue), size: 0.58 + this.rnd() * 0.16 });
    }
  }

  /** The height (px) a note is drawn at for a size of 1, at stage scale 1. */
  private static readonly NOTE_PX = 132;

  private tickNotes(st: Staff, dt: number): void {
    const S = this.scale;
    const unit = (HeroChordScene.NOTE_PX / NOTE_H) * S;
    for (let i = this.riders.length - 1; i >= 0; i--) {
      const r = this.riders[i]!;
      r.age += dt;
      if (r.age >= r.flyMs) { this.give(r.s); this.give(r.halo); this.give(r.lit); this.riders.splice(i, 1); continue; }
      this.lineAt(st, r.line, this.riderF(r));
      const pop = easeOutBack(r.age / 110, 2.6);
      const sc = unit * r.size * pop;
      r.s.position.set(this.px, this.py);
      r.s.scale.set(sc);
      r.s.rotation = this.lean + Math.sin(r.age * 0.021 + r.line) * 0.1;
      r.s.alpha = clamp01(r.age / 50);
      if (r.halo) {
        r.halo.position.set(this.px, this.py);
        r.halo.scale.set(((HeroChordScene.NOTE_PX * 2.1) / 128) * r.size * S * (1 + 0.1 * Math.sin(r.age * 0.03)));
        r.halo.alpha = 0.8 * clamp01(r.age / 80);
      }
      if (r.lit) {
        r.lit.position.set(this.px, this.py);
        r.lit.scale.set(sc);
        r.lit.rotation = r.s.rotation;
        r.lit.alpha = (0.45 + 0.2 * Math.sin(r.age * 0.04)) * clamp01(r.age / 80);
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
        this.give(r.s); this.give(r.halo);
        this.spawn('core', this.tex.star, whiten(r.tint, 0.5), this.px, this.py, { dur: 220, from: 0.2, to: 0.9, a0: 0.9, mode: 'punch', peakAt: 0.25, rot: this.rnd() * 3 });
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
      if (r.halo) {
        r.halo.position.set(this.px, this.py);
        r.halo.scale.set(((HeroChordScene.NOTE_PX * 1.5) / 128) * r.size * S * (1 + 0.1 * Math.sin(r.age * 0.012 + r.f * 9)));
        r.halo.alpha = 0.55 * clamp01(r.age / 120);
      }
    }
  }

  /**
   * THE impact: a hot flash, a ring and a RING OF SMALL NOTES thrown off the struck portrait (they fly out, slow, tip
   * over and fall). Medium adds a second ring and twinkles; Big a wide shock ring.
   */
  strike(x: number, y: number, radius: number, o: { level: number; notes: number; sparks: number; burst: number; flashAlpha: number; dir?: Pt; view?: { w: number; h: number } }): void {
    const S = this.scale;
    const c = this.colors;
    // Big: the whole view flashes for a moment (the bass hits everything), and the struck portrait is lit hard.
    if (o.level >= 3 && o.view && !this.flashFx) {
      const f = this.take('glow', Texture.WHITE, whiten(c.wave, 0.5));
      if (f) { f.anchor.set(0); f.alpha = 0; this.flashFx = { s: f, age: 0, a0: 0.22 * o.flashAlpha, w: o.view.w, h: o.view.h }; }
    }
    if (o.level >= 3) {
      const dd = (radius * 2) / 128 / S;
      this.spawn('glow', this.tex.glow, c.wave, x, y, { dur: 900, from: dd * 1.4, to: dd * 2.2, a0: 0.7, mode: 'punch', peakAt: 0.08, ease: 'cubic', follow: true });
      this.spawn('glow', this.tex.ring, 0xffffff, x, y, { dur: 420, from: (radius * 2) / 160 / S * 0.6, to: (radius * 2) / 160 / S * 3.4 * o.burst, a0: 0.7, ease: 'cubic' });
    }
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

  // ── the speaker (the striking portrait) ───────────────────────────────────────────────────────────────────

  /** The striking portrait POWERS UP as a speaker: three rings of light settle round it and a warm glow sits on it. */
  speakerOn(g: SpeakerGeo, late = 0): void {
    if (this.destroyed || this.speaker) return;
    const rings: Sprite[] = [];
    for (let i = 0; i < SPEAKER_RINGS.length; i++) {
      const r = this.take('glow', this.tex.ring, i === 0 ? whiten(this.colors.wave, 0.4) : this.colors.wave);
      if (r) { r.position.set(g.x, g.y); r.alpha = 0; rings.push(r); }
    }
    const glow = this.take('glow', this.tex.glow, this.colors.side);
    if (glow) { glow.position.set(g.x, g.y); glow.alpha = 0; }
    this.speaker = { g, age: Math.max(0, late), rings, glow, pumpAge: -1, pumpAmp: 0, inAge: -1, inMs: 1, out: -1 };
    // It switches on: one ring closes IN onto the portrait.
    this.spawn('glow', this.tex.ring, this.colors.wave, g.x, g.y, { dur: 260, from: (g.r * 2 * 2.6) / 160 / this.scale, to: (g.r * 2 * 1.1) / 160 / this.scale, a0: 0.6, mode: 'punch', peakAt: 0.6, ease: 'cubic' });
    this.laySpeaker(this.speaker);
  }

  /**
   * The speaker PUMPS (`amp` about 1 = a count-in pump, harder each time; the drop is about 2): its rings flare and
   * swell, more rings punch out of the portrait, and `notes` small notes pop off its top.
   */
  pump(amp = 1, notes = 0): void {
    const k = this.speaker;
    if (!k) return;
    k.pumpAge = 0; k.pumpAmp = amp; k.inAge = -1;
    const S = this.scale;
    const d = (k.g.r * 2) / 160 / S;
    const n = amp > 1.6 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? this.colors.wave : whiten(this.colors.wave, 0.5), k.g.x, k.g.y, {
        dur: 360 + 90 * i + 120 * amp, from: d * 1.02, to: d * (1.7 + 0.7 * amp + 0.35 * i), a0: Math.min(1, 0.5 + 0.22 * amp), ease: 'cubic', delay: i * 65,
      });
    }
    this.spawn('core', this.tex.glow, 0xffffff, k.g.x, k.g.y, { dur: 200, from: (k.g.r * 2.2) / 128 / S, to: (k.g.r * (2.8 + 0.5 * amp)) / 128 / S, a0: Math.min(0.45, 0.12 + 0.14 * amp), mode: 'punch', peakAt: 0.15 });
    // Notes pop off the top of the portrait.
    const top = k.g.y - k.g.r * 0.85;
    for (let i = 0; i < notes; i++) {
      const s = this.spawn('body', this.tex.note, this.noteTint(i + (amp > 1.6 ? 1 : 0)), k.g.x + (this.rnd() - 0.5) * k.g.r * 1.2, top, {
        dur: 520 + this.rnd() * 160, from: 0.1, to: (HeroChordScene.NOTE_PX * 0.36) / NOTE_H, a0: 1, mode: 'hold',
        vx: (this.rnd() - 0.5) * 300, vy: -(320 + this.rnd() * 180), drag: 0.25, grav: 520, rot: (this.rnd() - 0.5) * 0.5, spin: (this.rnd() - 0.5) * 0.006,
      });
      s?.anchor.set(NOTE_HEAD.x, NOTE_HEAD.y);
    }
  }

  /** THE INHALE: over `ms` the speaker's rings pull in tight onto the portrait and brighten (the breath before the drop). */
  inhale(ms: number): void {
    const k = this.speaker;
    if (!k) return;
    k.inAge = 0; k.inMs = Math.max(1, ms);
    const S = this.scale;
    // Light is drawn IN: two rings close onto the portrait.
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, this.colors.wave, k.g.x, k.g.y, { dur: Math.max(80, ms - i * 40), from: (k.g.r * 2 * (3 + i)) / 160 / S, to: (k.g.r * 2 * 1.05) / 160 / S, a0: 0.55, mode: 'punch', peakAt: 0.7, ease: 'cubic', delay: i * 40 });
    }
  }

  /** Lay the speaker's rings out for this frame (the settle, the pump, the inhale, the fade). */
  private laySpeaker(k: Speaker): boolean {
    const S = this.scale;
    const on = clamp01(k.age / 220);
    const kick = k.pumpAge >= 0 ? k.pumpAmp * Math.max(0, spring(k.pumpAge, 6, 70)) : 0;
    const inU = k.inAge < 0 ? 0 : clamp01(k.inAge / k.inMs);
    const out = k.out < 0 ? 0 : clamp01(k.out / 260);
    const alpha = on * (1 - out);
    for (let i = 0; i < k.rings.length; i++) {
      const r = k.rings[i]!;
      // Each ring breathes on its own, swells on a pump (the outer ones further) and pulls in for the inhale.
      const base = SPEAKER_RINGS[i]! * (1 + 0.02 * Math.sin(k.age * 0.006 + i * 2.1));
      const m = base * (1 + this.look.pumpScale * (i + 1) * kick) * (1 - (0.1 + 0.07 * i) * inU) * (1 + 0.5 * out);
      r.scale.set((k.g.r * 2 * m) / 160);
      r.alpha = alpha * Math.min(1, (0.3 - 0.07 * i) + 0.45 * Math.min(1.2, kick) + 0.35 * inU);
    }
    if (k.glow) {
      k.glow.scale.set((k.g.r * (3 + 0.5 * kick - 0.5 * inU)) / 128);
      k.glow.alpha = alpha * (0.22 + 0.3 * Math.min(1.2, kick) + 0.35 * inU);
    }
    void S;
    return out < 1;
  }

  private tickSpeaker(k: Speaker, dt: number): boolean {
    k.age += dt;
    if (k.pumpAge >= 0) k.pumpAge += dt;
    if (k.inAge >= 0) k.inAge += dt;
    if (k.out >= 0) k.out += dt;
    return this.laySpeaker(k);
  }

  // ── the bass wave ─────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The bass wave rolls out of the speaker at `from` and its front reaches `to` after `travelMs`. `clear` is the
   * speaker's own radius: the fronts only show once they are outside it.
   */
  bass(from: Pt, to: Pt, travelMs: number, late = 0, clear = 0): void {
    if (this.destroyed || this.wave) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bands: Band[] = [];
    const n = Math.max(1, Math.min(4, Math.round(this.look.waveBands)));
    const c = this.colors;
    for (let i = 0; i < n; i++) {
      const shade = this.take('under', this.tex.wave, 0x0a0f2a);
      // A coloured twin a little behind each front thickens the band and gives it an edge of colour.
      const twin = this.take('glow', this.tex.wave, i % 2 ? c.noteC : c.noteB);
      const light = this.take('glow', this.tex.wave, i === 0 ? whiten(c.wave, 0.45) : c.wave);
      for (const s of [shade, twin, light]) { if (s) { s.anchor.set(WAVE_ANCHOR_X, 0.5); s.alpha = 0; s.rotation = Math.atan2(dy, dx); s.position.set(from.x, from.y); } }
      bands.push({ light, twin, shade, lag: i * 70 });
    }
    this.wave = { ox: from.x, oy: from.y, ang: Math.atan2(dy, dx), ux: dx / dist, uy: dy / dist, dist, r0: Math.max(0, clear), age: Math.max(0, late), travelMs: Math.max(1, travelMs), bands, sigma: 90 * this.scale, acc: 0 };
  }

  /**
   * A LATER FRONT of the wave train: one more thick crescent (and its shade) thrown from the speaker along the same
   * line, fire-and-forget. It crosses to the struck hero in `travelMs` and rolls a little past, fading.
   */
  echo(from: Pt, to: Pt, travelMs: number, strength = 1, clear = 0): void {
    if (this.destroyed) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const S = this.scale;
    const ang = Math.atan2(dy, dx);
    const over = 1.22;
    // It appears at the speaker's rim (`clear`) a moment after it leaves the centre, already moving.
    const r0 = Math.min(dist * 0.5, Math.max(0.12 * WAVE_R, clear * 1.05));
    const lead = (r0 / dist) * travelMs;
    const mk = (layer: 'under' | 'glow', tint: number, a0: number, back: number): void => {
      const s = this.spawn(layer, this.tex.wave, tint, from.x, from.y, { dur: travelMs * over - lead, from: (r0 / WAVE_R) / S, to: ((dist * over - back) / WAVE_R) / S, a0, mode: 'hold', ease: 'linear', rot: ang, delay: lead });
      s?.anchor.set(WAVE_ANCHOR_X, 0.5);
    };
    mk('under', 0x0a0f2a, 0.3 * strength, 30 * S);
    mk('glow', this.colors.noteB, 0.5 * strength, 16 * S);
    mk('glow', this.colors.wave, 0.85 * strength, 0);
  }

  /** How far a band's front is from the speaker's centre (constant speed: it reaches the struck hero at `travelMs` and rolls on). */
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
      // Each band fades in as it clears the speaker and out once it is past the struck hero; later bands are fainter.
      const a = on ? clamp01((r - w.r0) / (110 * S)) * (1 - clamp01((u - 1) / 0.32)) * (1 - 0.2 * (b.lag / 70)) : 0;
      const sc = Math.max(0.02, r / WAVE_R);
      // Its size across follows the radius (a real front), its thickness is held nearer constant so it stays a thick band.
      const sx = sc * this.look.waveSize * (0.55 + 0.45 * Math.min(1, (400 * S) / Math.max(1, r)));
      if (b.light) { b.light.scale.set(sx, sc); b.light.alpha = a * 0.85; this.placeBand(b.light, w, r, sx); }
      if (b.twin) { b.twin.scale.set(sx * 1.15, sc); b.twin.alpha = a * 0.6; this.placeBand(b.twin, w, r - 20 * S, sx * 1.15); }
      if (b.shade) { b.shade.scale.set(sx * 1.2, sc); b.shade.alpha = a * 0.42; this.placeBand(b.shade, w, r - 34 * S, sx * 1.2); }
      if (u < 1.34) alive = true;
    }
    // THE AIR IT PUSHES: streaks thrown along the leading front, travelling with it.
    const lead = this.frontOf(w, 0);
    const lu = w.age / w.travelMs;
    if (lead > w.r0 && lu < 1.05) {
      w.acc += dt;
      const speed = (w.dist / w.travelMs) * 1000 / S;
      while (w.acc >= 11) {
        w.acc -= 11;
        const a = w.ang + (this.rnd() - 0.5) * 0.95;
        const rr = lead - this.rnd() * 60 * S;
        this.spawn('core', this.tex.streak, this.rnd() < 0.5 ? 0xffffff : this.colors.wave, w.ox + Math.cos(a) * rr, w.oy + Math.sin(a) * rr, {
          dur: 170 + this.rnd() * 130, from: 0.5 + this.rnd() * 0.4, to: 0.2, a0: 0.8, ease: 'linear', sy: 0.5,
          vx: Math.cos(a) * speed * 0.85, vy: Math.sin(a) * speed * 0.85, drag: 0.5, align: true,
        });
      }
    }
    if (!alive) {
      for (const b of w.bands) { this.give(b.light); this.give(b.twin); this.give(b.shade); }
      this.wave = null;
    }
    return alive;
  }

  /** Put a crescent so its leading rim sits `r` out from the speaker's centre, whatever its x scale (its thickness) is. */
  private placeBand(s: Sprite, w: Wave, r: number, sx: number): void {
    // The sprite's anchor is the circle's centre, so at x scale `sx` its rim sits `WAVE_R * sx` from its position.
    const back = Math.max(0, r) - WAVE_R * sx;
    s.position.set(w.ox + w.ux * back, w.oy + w.uy * back);
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The whole-view flash on Big's impact: up in a frame or two, gone in 300 ms. It undoes the camera so it covers the view. */
  private tickFlash(dt: number): boolean {
    const k = this.flashFx;
    if (!k) return false;
    k.age += dt;
    const u = clamp01(k.age / 300);
    const z = this.root.scale.x || 1;
    k.s.position.set(-this.root.position.x / z, -this.root.position.y / z);
    k.s.scale.set(k.w / z / (k.s.texture.width || 1), k.h / z / (k.s.texture.height || 1));
    k.s.alpha = k.a0 * (u < 0.1 ? u / 0.1 : (1 - (u - 0.1) / 0.9) ** 2);
    if (u >= 1) { this.give(k.s); this.flashFx = null; return false; }
    return true;
  }

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
    if (this.speaker) {
      if (this.tickSpeaker(this.speaker, dt)) alive = true;
      else this.dropSpeaker();
    }
    if (this.tickFlash(dt)) alive = true;
    return alive || this.riders.length > 0 || this.rests.length > 0;
  }

  private dropStaff(): void {
    for (const r of this.riders) { this.give(r.s); this.give(r.halo); this.give(r.lit); }
    for (const r of this.rests) { this.give(r.s); this.give(r.halo); }
    this.riders = []; this.rests = [];
    for (const s of this.strips) { this.staffLayer.removeChild(s.mesh); s.mesh.destroy(); }
    this.strips = [];
    this.staff = null;
  }

  private dropSpeaker(): void {
    const k = this.speaker;
    if (!k) return;
    for (const s of k.rings) this.give(s);
    this.give(k.glow);
    this.speaker = null;
  }

  protected override clearOwn(): void {
    this.dropStaff();
    this.dropSpeaker();
    if (this.wave) { for (const b of this.wave.bands) { this.give(b.light); this.give(b.twin); this.give(b.shade); } this.wave = null; }
    if (this.flashFx) { this.give(this.flashFx.s); this.flashFx = null; }
  }

}

export type { Pt };
