/**
 * THE CHECKMATE SCENE: everything the Checkmate attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool`),
 * as a plain scene graph with no renderer, so it runs (and is tested) headless. `heroChess.ts` mounts `root` on the
 * above-portrait overlay, tells it the sequence time each frame (`drive`) and feeds `update(dt)`.
 *
 * Design rule (the owner's "clean" bar; an Epic is one strong idea): the PIECE and its MOVE are the subject. The board
 * is a patch of pooled square quads, turned to the line between the heroes, there so the move reads as a chess move;
 * the squares the move crosses light up gold ONE AFTER ANOTHER (an additive tile and a bloom on each, with a flash
 * as it comes on). Everything else (a puff where a piece is set down, the
 * capture flash, sparks, glints) is short seasoning.
 *
 * THE SCENE HOLDS NO ANIMATION STATE. Every pose is a pure function of the sequence time (`chessPieceAt`, `chessKingAt`,
 * `chessWordAt`, `chessBoardAlpha`, `chessHintAt` in `heroChessConfig.ts`); this file only draws them. After the
 * sequence ends the scene keeps its own clock running until the last fade is over (`plan.clearAt`), then lets go of
 * every sprite.
 *
 * LAYERS (the pool's), bottom to top: under (normal: the squares, the shadows) | glow (additive: rings, blooms) | body
 * (normal: the queen's ghosts, the king, the piece, the word) | core (additive: flashes, sparks, the gleam, the streak).
 *
 * Contract: sprites are POOLED per layer and bounded by `MAX_CHESS_SPRITES`; textures are the caller's (pre-warmed on
 * the GPU during the damage formation, so no first-play spike); positions are the overlay's px; `setCamera` mirrors the
 * DOM camera when the runner asks it to; `update` returns whether anything still draws; `destroy()` leaves nothing
 * behind. Scatter is seeded (a replay throws the same sparks).
 */
import type { Sprite, Texture } from 'pixi.js';
import { clamp01, mixColor, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import {
  chessBoardAlpha, chessGleamAt, chessHintAt, chessHintFlashAt, chessKingAt, chessPieceAt, chessStreakAt, chessWordAt, newPiecePose,
  PIECE_BASE_HALF, PIECE_BASE_Y, PIECE_H, PIECE_MID, PIECE_TALL,
  type ChessGeo, type ChessPlan, type HeroChessConfig, type PieceKind, type PiecePose,
} from './heroChessConfig';
import { SQUARE_PX, WORD_W, type Wood } from './heroChessTextures';

export interface HeroChessTextures {
  /** The shared basics (the Blast's and Arcana's): a soft glow, a round spark, a streak, a ring, a four-point star. */
  glow: Texture; spark: Texture; streak: Texture; ring: Texture; star: Texture;
  /** The pieces, in both woods (a 128 x 192 box each, standing on the base line). */
  pawnIvory: Texture; pawnEbony: Texture;
  knightIvory: Texture; knightEbony: Texture;
  queenIvory: Texture; queenEbony: Texture;
  kingIvory: Texture; kingEbony: Texture;
  /** A board square (white; tinted). */
  square: Texture;
  /** The soft shadow under a piece. */
  shadow: Texture;
  /** The word CHECKMATE. */
  word: Texture;
}

export interface ChessColors { ivory: number; ebony: number; gold: number; side: number }

/** Hard cap on sprites alive at once (the queen's board is about 50 squares; her impact peaks near 120 sprites). */
export const MAX_CHESS_SPRITES = 260;
/** The queen's afterimages, and how far back in time each is sampled (ms). */
export const QUEEN_GHOSTS = 3;
const GHOST_STEP_MS = 16;

const pieceTex = (t: HeroChessTextures, kind: PieceKind, wood: Wood): Texture => {
  if (kind === 'pawn') return wood === 'ivory' ? t.pawnIvory : t.pawnEbony;
  if (kind === 'knight') return wood === 'ivory' ? t.knightIvory : t.knightEbony;
  if (kind === 'queen') return wood === 'ivory' ? t.queenIvory : t.queenEbony;
  return wood === 'ivory' ? t.kingIvory : t.kingEbony;
};

export class HeroChessScene extends FxPool {
  private t = 0;
  private driven = false;
  private cleared = false;
  private readonly squares: Sprite[] = [];
  /** One additive gold tile and one soft bloom per square of the move (null for the other squares). */
  private readonly hintTiles: (Sprite | null)[] = [];
  private readonly hintBlooms: (Sprite | null)[] = [];
  private piece: Sprite | null = null;
  private pieceShadow: Sprite | null = null;
  private king: Sprite | null = null;
  private kingShadow: Sprite | null = null;
  private word: Sprite | null = null;
  private gleam: Sprite | null = null;
  private streak: Sprite | null = null;
  private ghosts: Sprite[] = [];
  private twinkled = false;
  /** Px per texture px for the striking piece and for the king. */
  private readonly k: number;
  private readonly kingK: number;
  private readonly pose: PiecePose = newPiecePose();
  private readonly tmp: PiecePose = newPiecePose();
  private readonly wordPose = { scale: 1, alpha: 0 };

  constructor(
    private readonly tex: HeroChessTextures, private readonly colors: ChessColors, private readonly plan: ChessPlan,
    private readonly geo: ChessGeo, private readonly cfg: HeroChessConfig, readonly wood: Wood, scale = 1, seed = 1,
  ) {
    super('heroChess', [
      tex.glow, tex.spark, tex.streak, tex.ring, tex.star, tex.square, tex.shadow, tex.word,
      pieceTex(tex, plan.piece, wood), pieceTex(tex, 'king', wood === 'ivory' ? 'ebony' : 'ivory'),
    ], scale, seed, MAX_CHESS_SPRITES);
    this.k = geo.k;
    this.kingK = geo.kingK;
    if (plan.reduced) { this.cleared = true; return; }

    // The board: one quad per square, turned to the line between the heroes, with a hairline gap between tiles.
    const tile = (geo.sq / SQUARE_PX) * 0.965;
    for (const cell of geo.cells) {
      const s = this.take('under', tex.square, cell.dark ? colors.ebony : colors.ivory);
      if (!s) break;
      s.position.set(cell.x, cell.y); s.rotation = geo.ang; s.scale.set(tile); s.alpha = 0;
      this.squares.push(s);
    }
    // The move's squares get an additive gold tile and a bloom on top, so they GLOW (and flash as each lights).
    for (let i = 0; i < this.squares.length; i++) {
      const cell = geo.cells[i]!;
      let ht: Sprite | null = null, hb: Sprite | null = null;
      if (cell.hint) {
        ht = this.take('glow', tex.square, colors.gold);
        hb = this.take('glow', tex.glow, colors.gold);
        if (ht) { ht.position.set(cell.x, cell.y); ht.rotation = geo.ang; ht.scale.set(tile); ht.alpha = 0; }
        if (hb) { hb.position.set(cell.x, cell.y); hb.scale.set((geo.sq * 2.3) / tex.glow.width); hb.alpha = 0; }
      }
      this.hintTiles.push(ht); this.hintBlooms.push(hb);
    }
    // Back to front on the body layer: the ghosts, the king, the piece, the word.
    const pt = pieceTex(tex, plan.piece, wood);
    if (plan.level === 3) {
      for (let j = 0; j < QUEEN_GHOSTS && cfg.ghostAlpha > 0; j++) {
        const gs = this.take('body', pt, 0xffffff);
        if (gs) { this.anchor(gs, plan.piece); gs.alpha = 0; this.ghosts.push(gs); }
      }
    }
    if (plan.king && geo.king) {
      this.kingShadow = this.take('under', tex.shadow, 0xffffff);
      this.king = this.take('body', pieceTex(tex, 'king', wood === 'ivory' ? 'ebony' : 'ivory'), 0xffffff);
      if (this.king) { this.anchor(this.king, 'king'); this.king.alpha = 0; }
      if (this.kingShadow) this.kingShadow.alpha = 0;
    }
    this.pieceShadow = this.take('under', tex.shadow, 0xffffff);
    this.piece = this.take('body', pt, 0xffffff);
    if (this.piece) { this.anchor(this.piece, plan.piece); this.piece.alpha = 0; }
    if (this.pieceShadow) this.pieceShadow.alpha = 0;
    if (plan.level === 3) {
      this.streak = this.take('core', tex.streak, mixColor(colors.side, 0xffffff, 0.35));
      this.gleam = this.take('core', tex.star, 0xffffff);
      if (this.streak) this.streak.alpha = 0;
      if (this.gleam) this.gleam.alpha = 0;
    }
    if (plan.king && geo.word) {
      this.word = this.take('body', tex.word, 0xffffff);
      if (this.word) { this.word.position.set(geo.word.x, geo.word.y); this.word.alpha = 0; }
    }
  }

  /** The sequence time this frame (the runner calls it from its paint, before `update`). */
  drive(t: number): void { this.t = t; this.driven = true; }

  get time(): number { return this.t; }
  get squareCount(): number { return this.squares.length; }
  /** The striking piece is drawn (it has been set down and has not faded). */
  get pieceShown(): boolean { return !!this.piece && this.piece.visible && this.piece.alpha > 0.01; }
  get kingShown(): boolean { return !!this.king && this.king.visible && this.king.alpha > 0.01; }
  get wordShown(): boolean { return !!this.word && this.word.visible && this.word.alpha > 0.01; }
  /** How far the king has tipped (radians; 0 standing, about 1.57 on its side). */
  get kingTilt(): number { return this.king ? Math.abs(this.king.rotation) : 0; }
  /** Where the striking piece's sprite is (its middle), for tests and the capture rig. */
  get piecePos(): Pt { return this.piece ? { x: this.piece.position.x, y: this.piece.position.y } : { x: 0, y: 0 }; }

  /** A piece sprite turns about its own middle; its base is `PIECE_MID` below that. */
  private anchor(s: Sprite, kind: PieceKind): void {
    s.anchor.set(0.5, (PIECE_BASE_Y - PIECE_MID[kind]) / PIECE_H);
  }

  // ── the beats (short seasoning, fired by the runner's cues) ───────────────────────────────────────────────

  /** A piece touches the board: a flat puff ring and a few specks kicked sideways. */
  tap(x: number, y: number, power = 1): void {
    const { tex, colors } = this;
    const w = (this.geo.sq / tex.ring.width / this.scale) * 0.9;
    this.spawn('glow', tex.ring, colors.ivory, x, y, { dur: 240, from: w * 0.25, to: w * power, a0: 0.42 * power, sy: 0.4 });
    this.spawn('core', tex.glow, 0xffffff, x, y, { dur: 130, from: w * 0.2, to: w * 0.5 * power, a0: 0.3 * power, sy: 0.5 });
    this.burst('core', tex.spark, [colors.ivory, colors.gold], x, y, Math.round(4 * power) + 1, { speed: 170 * power, life: 230, size: 0.16, grav: 240, drag: 0.1, lift: 60 });
  }

  /** THE impact: the piece takes the portrait. A flash, rings, sparks thrown along its travel, and a few glints. */
  impact(x: number, y: number, radius: number, dir: Pt, o: { level: number; burst: number; sparks: number; flashAlpha: number }): void {
    const { tex, colors } = this;
    const S = this.scale;
    const d = (radius * 2) / tex.glow.width / S;
    const rw = (radius * 2) / tex.ring.width / S;
    const heading = Math.atan2(dir.y, dir.x);
    this.spawn('core', tex.glow, 0xffffff, x, y, { dur: 220, from: d * 0.25, to: d * 0.7 * o.burst, a0: o.flashAlpha, follow: true });
    this.spawn('glow', tex.glow, colors.gold, x, y, { dur: 340, from: d * 0.4, to: d * 1.0 * o.burst, a0: 0.42, mode: 'punch', peakAt: 0.15, follow: true });
    this.spawn('glow', tex.ring, colors.side, x, y, { dur: 320, from: rw * 0.2, to: rw * 0.7 * o.burst, a0: 0.75, follow: true });
    if (o.level >= 2) this.spawn('glow', tex.ring, colors.gold, x, y, { dur: 440, from: rw * 0.25, to: rw * 1.05 * o.burst, a0: 0.5, follow: true, sy: o.level === 2 ? 0.45 : 1 });
    if (o.level === 3) {
      // The queen's cut: a bright slit along her diagonal, through the portrait.
      const len = (radius * 3.2) / tex.streak.width / S;
      this.spawn('core', tex.streak, 0xffffff, x, y, { dur: 280, from: len * 0.6, to: len * 1.25, a0: 0.95, sy: 0.16, rot: heading, follow: true });
    }
    this.burst('core', tex.streak, [colors.gold, 0xffffff, colors.side], x, y, o.sparks, {
      speed: 620 * o.burst, dir: o.level === 2 ? undefined : heading, spread: 2.4, life: 280, size: 0.34, grav: 320, drag: 0.05, align: true,
    });
    if (o.level >= 2) {
      // WEIGHT: a white-hot core, a glow that takes its time to go, and chips thrown up that fall back under gravity.
      this.spawn('core', tex.glow, 0xffffff, x, y, { dur: 190, from: d * 0.6, to: d * 1.5 * o.burst, a0: Math.min(1, o.flashAlpha * 1.1), mode: 'punch', peakAt: 0.08, follow: true });
      this.spawn('glow', tex.glow, colors.gold, x, y, { dur: o.level === 3 ? 1100 : 600, from: d * 0.9, to: d * 1.5 * o.burst, a0: 0.4, mode: 'hold', ease: 'cubic', follow: true });
      this.burst('core', tex.spark, [colors.gold, colors.ivory, 0xffffff], x, y, Math.round(o.sparks * 0.6), { speed: 520 * o.burst, life: 720, size: 0.3, grav: 1300, drag: 0.25, lift: 240 });
    }
    if (o.level === 3) {
      // The queen's capture: shock rings one after another, and a second cut across the first.
      for (let i = 0; i < 3; i++) this.spawn('glow', tex.ring, i % 2 ? colors.gold : colors.side, x, y, { dur: 480 + 110 * i, from: rw * 0.3, to: rw * (1.4 + 0.6 * i) * o.burst * 0.6, a0: 0.7 - 0.15 * i, ease: 'cubic', delay: 70 * (i + 1), follow: true });
      const len2 = (radius * 2.4) / tex.streak.width / S;
      this.spawn('core', tex.streak, colors.gold, x, y, { dur: 240, from: len2 * 0.5, to: len2 * 1.2, a0: 0.8, sy: 0.12, rot: heading + Math.PI / 2, delay: 40, follow: true });
      this.spawn('core', tex.star, 0xffffff, x, y, { dur: 420, from: 1.2, to: 4.6, a0: 1, mode: 'punch', peakAt: 0.1, rot: 0.3, spin: 0.0015, follow: true });
    }
    const glints = 2 + o.level * 2;
    for (let i = 0; i < glints; i++) {
      const a = this.rnd() * Math.PI * 2, rr = radius * (0.35 + this.rnd() * 0.75);
      this.spawn('core', tex.star, colors.gold, x + Math.cos(a) * rr, y + Math.sin(a) * rr, {
        dur: 260 + this.rnd() * 220, from: 0.1, to: 0.6 + this.rnd() * 0.4, a0: 0.95, mode: 'punch', peakAt: 0.3, rot: this.rnd() * Math.PI, delay: this.rnd() * 90, follow: true,
      });
    }
  }

  /** A whole-view flash (bright at once, gone in `ms`): the soft glow stretched far past the view. */
  screenFlash(alpha: number, w: number, h: number, ms = 150): void {
    if (alpha <= 0 || w <= 0 || h <= 0) return;
    const k = (Math.max(w, h) * 4.8) / this.tex.glow.width / this.scale;
    this.spawn('core', this.tex.glow, 0xffffff, w / 2, h / 2, { dur: ms, from: k, to: k, a0: alpha, ease: 'linear' });
  }

  /** The king HITS THE BOARD on its side: a flat shock ring, a thud of light, dust kicked out both ways. */
  kingDown(x: number, y: number, side: number): void {
    const { tex, colors } = this;
    const sq = this.geo.sq;
    const w = sq / tex.ring.width / this.scale;
    this.spawn('glow', tex.ring, colors.ivory, x, y, { dur: 420, from: w * 0.4, to: w * 2.6, a0: 0.7, sy: 0.38, ease: 'cubic' });
    this.spawn('glow', tex.ring, colors.gold, x, y, { dur: 520, from: w * 0.3, to: w * 1.8, a0: 0.5, sy: 0.38, ease: 'cubic', delay: 70 });
    this.spawn('core', tex.glow, 0xffffff, x, y, { dur: 200, from: w * 0.5, to: w * 1.6, a0: 0.6, sy: 0.5, mode: 'punch', peakAt: 0.12 });
    for (const sx of [-1, 1]) {
      this.burst('core', tex.spark, [colors.ivory, colors.gold], x + sx * sq * 0.2, y, 6, { speed: 300, dir: sx > 0 ? -0.35 : Math.PI + 0.35, spread: 1.1, life: 520, size: 0.22, grav: 700, drag: 0.2 });
    }
    void side;
  }

  /** CHECKMATE slams in: a hot bar of light behind it, a ring off the landing, sparks off both ends. */
  wordSlam(x: number, y: number, width: number): void {
    if (width <= 0) return;
    const { tex, colors } = this;
    const S = this.scale;
    this.spawn('core', tex.glow, 0xffffff, x, y, { dur: 260, from: (width * 0.8) / tex.glow.width / S, to: (width * 1.7) / tex.glow.width / S, a0: 0.7, sy: 0.3, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', tex.glow, colors.gold, x, y, { dur: 1300, from: (width * 1.3) / tex.glow.width / S, to: (width * 1.5) / tex.glow.width / S, a0: 0.4, sy: 0.28, mode: 'hold', ease: 'cubic' });
    this.spawn('glow', tex.ring, colors.gold, x, y, { dur: 460, from: (width * 0.4) / tex.ring.width / S, to: (width * 1.3) / tex.ring.width / S, a0: 0.6, sy: 0.3, ease: 'cubic' });
    for (const sx of [-1, 1]) {
      this.burst('core', tex.spark, [colors.gold, 0xffffff], x + sx * width * 0.46, y, 6, { speed: 420, dir: sx > 0 ? -0.4 : Math.PI + 0.4, spread: 1.5, life: 520, size: 0.28, grav: 900, drag: 0.25 });
    }
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Pose one piece sprite and its shadow from a pose. `face` mirrors it (the knight's profile). */
  private place(s: Sprite, shadow: Sprite | null, kind: PieceKind, p: PiecePose, k: number, face: number, alphaMul: number): void {
    const a = p.alpha * alphaMul;
    if (a <= 0.004) { s.alpha = 0; if (shadow) shadow.alpha = 0; return; }
    const ox = p.ride ? this.fox : 0, oy = p.ride ? this.foy : 0;
    const mid = PIECE_MID[kind] * k * p.sy;
    const sin = Math.sin(p.rot), cos = Math.cos(p.rot);
    // Tipped, it rests on the edge of its base (and, on its side, on its flank), so its foot comes up a little.
    const up = Math.abs(sin) * PIECE_BASE_HALF * k * 0.9;
    const bx = p.x + ox, by = p.y + oy;
    s.position.set(bx + sin * mid, by - p.lift - up - cos * mid);
    s.rotation = p.rot + p.spin;
    s.scale.set(k * p.sx * face, k * p.sy);
    s.alpha = a;
    if (shadow) {
      const high = clamp01(p.lift / Math.max(1, this.geo.sq));
      const w = ((PIECE_BASE_HALF * 2.9 * k) / shadow.texture.width) * (1 - 0.45 * high) * (1 + 0.9 * Math.abs(sin));
      shadow.position.set(bx + sin * mid * 0.6, by + 2 * k);
      shadow.scale.set(w, w * 0.9);
      shadow.alpha = a * 0.6 * (1 - 0.55 * high);
    }
  }

  protected override tick(dt: number): boolean {
    if (!this.driven) this.t += dt;
    this.driven = false;
    if (this.cleared) return false;
    const { plan, geo, cfg, colors } = this;
    const t = this.t;
    if (t >= plan.clearAt) { this.clearOwn(); return false; }
    if (t < plan.chargeAt) return true;

    // The board (only touched while it fades or a hint is lit; it is static in between).
    const cells = geo.cells;
    for (let i = 0; i < this.squares.length; i++) {
      const cell = cells[i]!, s = this.squares[i]!;
      const base = cfg.boardAlpha * cell.weight * (cell.dark ? 1 : 0.6) * chessBoardAlpha(plan, cfg, t, cell.order);
      if (cell.hint) {
        const h = chessHintAt(plan, t, cell.hintOrder);
        s.tint = mixColor(cell.dark ? colors.ebony : colors.ivory, colors.gold, h);
        s.alpha = base + (cfg.hintAlpha - base) * h * (base > 0 ? 1 : 0);
        const fl = chessHintFlashAt(plan, t, cell.hintOrder);
        const ht = this.hintTiles[i], hb = this.hintBlooms[i];
        if (ht) ht.alpha = base > 0 ? cfg.hintAlpha * (0.28 * h + 0.6 * fl) : 0;
        if (hb) hb.alpha = base > 0 ? cfg.hintAlpha * (0.3 * h + 0.55 * fl) : 0;
      } else s.alpha = base;
    }

    // The striking piece, and the queen's afterimages and streak.
    const kind = plan.piece;
    if (this.piece) {
      chessPieceAt(plan, geo, cfg, t, this.pose);
      this.place(this.piece, this.pieceShadow, kind, this.pose, this.k, geo.face, 1);
    }
    const streakK = chessStreakAt(plan, t);
    for (let j = 0; j < this.ghosts.length; j++) {
      const gs = this.ghosts[j]!;
      if (streakK <= 0 || t >= plan.impactAt + 60) { gs.alpha = 0; continue; }
      chessPieceAt(plan, geo, cfg, t - GHOST_STEP_MS * (j + 1), this.tmp);
      this.place(gs, null, kind, this.tmp, this.k, geo.face, cfg.ghostAlpha * (1 - j * 0.28) * streakK);
    }
    if (this.streak) {
      if (streakK <= 0) this.streak.alpha = 0;
      else {
        // From where she stood to where she is, at chest height.
        const h = PIECE_MID.queen * this.k;
        const ox = this.pose.ride ? this.fox : 0, oy = this.pose.ride ? this.foy : 0;
        const x0 = geo.start.x, y0 = geo.start.y - h, x1 = this.pose.x + ox, y1 = this.pose.y + oy - h;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const st = this.streak;
        st.position.set((x0 + x1) / 2, (y0 + y1) / 2);
        st.rotation = Math.atan2(y1 - y0, x1 - x0);
        st.scale.set(len / st.texture.width, (PIECE_TALL.queen * this.k * 0.5) / st.texture.height);
        st.alpha = 0.55 * streakK;
      }
    }
    if (this.gleam) {
      const gu = chessGleamAt(plan, cfg, t);
      if (gu < 0) this.gleam.alpha = 0;
      else {
        const tall = PIECE_TALL.queen * this.k;
        this.gleam.position.set(this.pose.x - PIECE_BASE_HALF * this.k * 0.3 * (1 - gu), this.pose.y - tall * (0.08 + 0.9 * gu));
        this.gleam.scale.set(((tall * (0.35 + 0.5 * Math.sin(Math.PI * gu))) / this.gleam.texture.width));
        this.gleam.alpha = Math.min(1, Math.sin(Math.PI * Math.min(1, gu * 1.05)) * 1.4);
        this.gleam.rotation = gu * 1.6;
        if (gu > 0.9 && !this.twinkled) {
          // The gleam reaches her crown: one bright twinkle there.
          this.twinkled = true;
          const sz = tall / this.tex.star.width / this.scale;
          this.spawn('core', this.tex.star, colors.gold, this.pose.x, this.pose.y - tall * 0.95, { dur: 300, from: sz * 0.2, to: sz * 0.85, a0: 1, mode: 'punch', peakAt: 0.3, spin: 0.004 });
          this.spawn('glow', this.tex.glow, colors.gold, this.pose.x, this.pose.y - tall * 0.9, { dur: 320, from: sz * 0.1, to: sz * 0.3, a0: 0.5, mode: 'punch', peakAt: 0.3 });
        }
      }
    }

    // The king beside the struck hero, and the word.
    if (this.king) {
      chessKingAt(plan, geo, t, this.tmp);
      this.place(this.king, this.kingShadow, 'king', this.tmp, this.kingK, 1, 1);
    }
    if (this.word) {
      chessWordAt(plan, t, this.wordPose);
      this.word.alpha = this.wordPose.alpha;
      if (this.wordPose.alpha > 0) this.word.scale.set((geo.wordW / WORD_W) * this.wordPose.scale);
    }
    return true;
  }

  /** Let go of every persistent sprite (the end of the last fade, or a cancel). */
  protected override clearOwn(): void {
    if (this.cleared) return;
    this.cleared = true;
    for (const s of this.squares) this.give(s);
    for (const s of this.hintTiles) this.give(s);
    for (const s of this.hintBlooms) this.give(s);
    this.hintTiles.length = 0; this.hintBlooms.length = 0;
    for (const s of this.ghosts) this.give(s);
    for (const s of [this.piece, this.pieceShadow, this.king, this.kingShadow, this.word, this.gleam, this.streak]) this.give(s);
    this.squares.length = 0; this.ghosts = [];
    this.piece = this.pieceShadow = this.king = this.kingShadow = this.word = this.gleam = this.streak = null;
  }
}
