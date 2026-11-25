/**
 * THE AETHER STREAM (owner 2026-11-25: duplicates "glow a hot white blue and turn into blue aether that flows into the
 * aether icon"). A duplicate card on the summary row comes apart into motes of blue-white light: they lift off the card
 * on their own heat, wander, then are drawn down a curved path into the Aether medallion, faster the closer they get,
 * stretched into streaks by their speed. A pooled set of additive sprites: nothing is allocated per frame.
 *
 * Coordinates are the canvas's own px (the stream sits on the stage, over everything else in the scene). Time is in
 * 60 Hz frames, already slow-mo scaled by the scene.
 */
import { Container, Sprite, type Texture } from 'pixi.js';

/** The pool: five duplicates at once is the most a pack can ask for. */
export const AETHER_MOTES = 520;
/** Motes one card comes apart into. */
export const AETHER_PER_CARD = 100;
/** How long a card takes to shed all its motes (frames), and how long a mote drifts before the medallion takes it. */
export const AETHER_SHED_FRAMES = 34;
export const AETHER_DRIFT_FRAMES = 20;
/** A mote that has not arrived by now is taken anyway (frames after it left the card). */
const MAX_FLIGHT = 150;
const TINTS = [0xffffff, 0xcfeeff, 0x8fd4ff, 0x56b2ff, 0x9fe8ff];

export type AetherProgress = (frac: number, done: boolean) => void;
interface Flow { live: boolean; total: number; arrived: number; dirty: boolean; cb: AetherProgress | null }

export class AetherStream {
  readonly root = new Container();
  /** Motes in flight (or waiting to leave their card). */
  count = 0;
  private readonly sprites: Sprite[] = [];
  private readonly x = new Float32Array(AETHER_MOTES);
  private readonly y = new Float32Array(AETHER_MOTES);
  private readonly vx = new Float32Array(AETHER_MOTES);
  private readonly vy = new Float32Array(AETHER_MOTES);
  private readonly tx = new Float32Array(AETHER_MOTES);
  private readonly ty = new Float32Array(AETHER_MOTES);
  /** Frames until it leaves the card (> 0), then its age in flight (<= 0, counted downward). */
  private readonly wait = new Float32Array(AETHER_MOTES);
  private readonly ph = new Float32Array(AETHER_MOTES);
  private readonly size = new Float32Array(AETHER_MOTES);
  private readonly soft = new Uint8Array(AETHER_MOTES);
  private readonly flow = new Int8Array(AETHER_MOTES).fill(-1);
  private readonly flows: Flow[] = [];

  constructor(tex: Texture) {
    for (let k = 0; k < AETHER_MOTES; k++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.sprites.push(s);
      this.root.addChild(s);
    }
    for (let i = 0; i < 8; i++) this.flows.push({ live: false, total: 0, arrived: 0, dirty: false, cb: null });
  }

  /**
   * A card at (cx, cy), `w` x `h`, comes apart and flows to (tx, ty). `unit` is the size of one stage px in canvas px
   * (the motes and their speeds scale with the theatre). `cb` hears how much of the card has been taken (0..1), at most
   * once a frame, and `done` when the last mote is in.
   */
  emit(cx: number, cy: number, w: number, h: number, tx: number, ty: number, unit: number, cb: AetherProgress | null): void {
    let fi = this.flows.findIndex((f) => !f.live);
    if (fi < 0) fi = 0;
    const f = this.flows[fi]!;
    f.live = true; f.total = 0; f.arrived = 0; f.dirty = false; f.cb = cb;
    let n = AETHER_PER_CARD;
    for (let k = 0; k < AETHER_MOTES && n > 0; k++) {
      if (this.flow[k]! >= 0) continue;
      const s = this.sprites[k]!;
      // the card comes apart from its edges inward: most motes leave near the rim, some from the middle
      const edge = Math.random() < 0.6;
      let u = Math.random() - 0.5, v = Math.random() - 0.5;
      if (edge) { if (Math.random() < 0.5) u = Math.sign(u || 1) * (0.42 + Math.random() * 0.08); else v = Math.sign(v || 1) * (0.42 + Math.random() * 0.08); }
      this.x[k] = cx + u * w;
      this.y[k] = cy + v * h;
      // off the card on its own heat: outward and up
      const sp = (0.6 + Math.random() * 2.2) * unit;
      const a = Math.atan2(v * h, u * w) + (Math.random() - 0.5) * 1.2;
      this.vx[k] = Math.cos(a) * sp;
      this.vy[k] = Math.sin(a) * sp - (0.6 + Math.random() * 1.4) * unit;
      this.tx[k] = tx; this.ty[k] = ty;
      // it sheds from the top down, with scatter
      this.wait[k] = 1 + (0.55 * (v + 0.5) + 0.45 * Math.random()) * AETHER_SHED_FRAMES;
      this.ph[k] = Math.random() * 6.283;
      const soft = Math.random() < 0.14;
      this.soft[k] = soft ? 1 : 0;
      this.size[k] = (soft ? 1.6 + Math.random() * 1.8 : 0.22 + Math.random() * 0.62) * unit;
      this.flow[k] = fi;
      s.tint = TINTS[Math.floor(Math.random() * TINTS.length)]!;
      s.visible = false;
      f.total++;
      this.count++;
      n--;
    }
    if (f.total === 0) { f.live = false; cb?.(1, true); }
  }

  /** One frame. `unit` as in `emit`. */
  step(dt: number, unit: number): void {
    if (this.count === 0) return;
    const drag = Math.pow(0.93, dt);
    for (let k = 0; k < AETHER_MOTES; k++) {
      const fi = this.flow[k]!;
      if (fi < 0) continue;
      const s = this.sprites[k]!;
      let w = this.wait[k]!;
      if (w > 0) {
        w -= dt;
        this.wait[k] = w > 0 ? w : -0.0001;
        if (w > 0) continue;
        s.visible = true;
        w = -0.0001;
      } else { w -= dt; this.wait[k] = w; }
      const age = -w;
      let x = this.x[k]!, y = this.y[k]!, vx = this.vx[k]!, vy = this.vy[k]!;
      const dx = this.tx[k]! - x, dy = this.ty[k]! - y;
      const dist = Math.hypot(dx, dy);
      // the pull: nothing while it drifts, then stronger and stronger; the medallion takes it once it is close
      const pull = Math.min(1, Math.max(0, (age - AETHER_DRIFT_FRAMES * (0.4 + 0.6 * ((this.ph[k]! / 6.283)))) / 26));
      if (dist < 16 * unit || age > MAX_FLIGHT) {
        s.visible = false;
        this.flow[k] = -1;
        this.count--;
        const f = this.flows[fi]!;
        f.arrived++; f.dirty = true;
        continue;
      }
      const want = (5 + 30 * pull * pull) * unit;
      const steer = 1 - Math.pow(1 - 0.16 * pull, dt);
      // a swirl across the pull, fading as it closes, so the motes arrive on curved paths, never straight lines
      const swirl = Math.sin(age * 0.09 + this.ph[k]!) * (1 - pull) * 0.9 + (this.ph[k]! > 3.14 ? 0.35 : -0.35) * Math.min(1, dist / (220 * unit));
      const nx = dx / dist, ny = dy / dist;
      const wx = (nx - ny * swirl) * want, wy = (ny + nx * swirl) * want;
      vx = vx * (pull > 0 ? 1 : drag) + (wx - vx) * steer;
      vy = (vy - (pull > 0 ? 0 : 0.03 * unit * dt)) * (pull > 0 ? 1 : drag) + (wy - vy) * steer;
      x += (vx + Math.sin(age * 0.13 + this.ph[k]!) * 0.5 * unit * (1 - pull)) * dt;
      y += vy * dt;
      this.x[k] = x; this.y[k] = y; this.vx[k] = vx; this.vy[k] = vy;
      s.x = x; s.y = y;
      const speed = Math.hypot(vx, vy) / unit;
      const size = this.size[k]!;
      const born = Math.min(1, age / 7);
      if (this.soft[k]) {
        s.rotation = 0;
        s.scale.set(size * (0.7 + 0.3 * born));
        s.alpha = 0.2 * born * Math.min(1, dist / (70 * unit));
      } else {
        s.rotation = Math.atan2(vy, vx);
        // stretched by its speed into a streak; it thins as it stretches
        const stretch = 1 + Math.min(3.6, speed * 0.16);
        s.scale.set(size * stretch, size / Math.sqrt(stretch) * (0.8 + 0.2 * born));
        s.alpha = born * (0.62 + 0.38 * Math.sin(age * 0.5 + this.ph[k]!));
      }
    }
    for (const f of this.flows) {
      if (!f.live || !f.dirty) continue;
      f.dirty = false;
      const done = f.arrived >= f.total;
      if (done) f.live = false;
      f.cb?.(f.total > 0 ? f.arrived / f.total : 1, done);
      if (done) f.cb = null;
    }
  }

  clear(): void {
    for (let k = 0; k < AETHER_MOTES; k++) { this.flow[k] = -1; this.sprites[k]!.visible = false; }
    for (const f of this.flows) { f.live = false; f.cb = null; }
    this.count = 0;
  }
}
