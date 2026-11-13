// @vitest-environment jsdom
/**
 * CHECKMATE (style `chess`), an EPIC hero attack: chess pieces that move by their own rules on a faint board beside the
 * struck hero. Each of the shared four damage tiers plays its OWN piece (Tier 1 the pawn, Tier 2 the knight, Tier 3 the
 * rook, Tier 4 the queen; a knockout plays the queen). Covered here: the looks; the tuner; the pure plan and its cues per
 * look; the pure board (aligned to the hero line, on screen from every corner, both directions); the pure poses (the pawn
 * walks its file and captures diagonally, the knight jumps an L, the rook braces and charges straight down the hero's
 * own file, the queen slides her diagonal, the king tips over, the word sets); the
 * camera; the runner on the shared clock (the blow lands exactly ONCE, never on a tap; both directions; slow motion;
 * replay; finish / cancel; every exit restores the portraits; the camera is applied ONCE); and the headless scene
 * (pooled, bounded, drains, destroy leaves nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import {
  CHESS_CAPS, HERO_CHESS_DEFAULTS, HERO_CHESS_RANGES, PIECE_TALL, chessBoard, chessBoardAlpha, chessCameraAt, chessCameraFocus,
  chessCues, chessHintAt, chessHintFlashAt, HINT_STEP_MS, KING_ROCKS, ROOK_DRAW, rookTimeAt, rookTravel, chessKingAt, chessLevel, chessPieceAt, chessPlan, chessWordAt, clampHeroChessValue, heroChessConfigJson,
  newPiecePose, sanitizeHeroChessConfig,
  type ChessGeo, type ChessPlan, type HeroChessConfig, type HeroChessNumKey,
} from './heroChessConfig';
import { HeroChessScene, MAX_CHESS_SPRITES, type HeroChessTextures } from './heroChessScene';
import { CHESS_WORD } from './heroChessTextures';
import { chessSeed, playHeroChess, type HeroChessOptions } from './heroChess';
import { fxCanvasRidesCamera } from '../heroAttack/stageCamera';
import { SPEC } from '../HeroChessTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroChessTextures = {
  glow: W, spark: W, streak: W, ring: W, star: W, pawnIvory: W, pawnEbony: W, knightIvory: W, knightEbony: W,
  rookIvory: W, rookEbony: W, queenIvory: W, queenEbony: W, kingIvory: W, kingEbony: W, square: W, shadow: W, word: W, chip: W,
};
const C = HERO_CHESS_DEFAULTS;
const plan = (values: number[], total: number, reduced = false, knockout = false) => chessPlan({ total, distance: 1600, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { ivory: 0xf6ead0, ebony: 0x231c2e, gold: 0xffc83a, side: 0xffd76a };
const VIEW = { w: 1920, h: 1080 };
// The real layout at 1080p: you at the bottom left, the foe at the top right, portraits about 129 px in radius.
const YOU = { x: 105, y: 950 }, FOE = { x: 1773, y: 137 };
const R = 129;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const board = (p: ChessPlan, a = YOU, d = FOE, view: { w: number; h: number } | null = VIEW): ChessGeo => chessBoard(p, a, d, R, R, C, view);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('the four looks, Tier 1 to Tier 4 (each shared damage tier plays its own piece)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20): Tier 1 the pawn, Tier 2 the knight, Tier 3 the rook, Tier 4 the queen', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => chessLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 3, 4]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(chessLevel(tierOf(d)));
    }
    expect([P1, P2, P3, P4].map((p) => p.piece)).toEqual(['pawn', 'knight', 'rook', 'queen']);
  });

  it('no two tiers play the same move: each has its own piece and its own strike', () => {
    const strikes = [P1, P2, P3, P4].map((p) => p.moves[p.moves.length - 1]!.kind);
    expect(strikes).toEqual(['capture', 'jump', 'charge', 'slide']);
    expect(new Set([P1, P2, P3, P4].map((p) => p.piece)).size).toBe(4);
  });

  it('a knockout always plays the queen, whatever the number', () => {
    const ko = plan([2, 1], 3, false, true);
    expect(ko.tier).toBe(4);
    expect(ko.piece).toBe('queen');
    expect(ko.king).toBe(true);
    expect(ko.total).toBe(3);
  });

  it('is registered as a dev-only style with its own clips, and its one word is plain', () => {
    expect(HERO_ATTACK_STYLES).toContain('chess');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('chess');
    for (const clip of ['fx/chess-set', 'fx/chess-slide', 'fx/chess-topple', 'fx/chess-rumble', 'fx/chess-crash']) expect(ATTACK_FX_CLIPS.chess).toContain(clip);
    expect(CHESS_WORD).toBe('CHECKMATE');
    expect(CHESS_WORD).not.toMatch(/oath|climb|—|--/i);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_CHESS_RANGES)) {
      const v = C[k as HeroChessNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorIvory', 'colorEbony', 'colorGold', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroChessValue('pawnHops', 99)).toBe(3);
    expect(clampHeroChessValue('pawnHops', 0)).toBe(1);
    expect(clampHeroChessValue('squareK', -3)).toBe(0.8);
    expect(clampHeroChessValue('slideMs', Number.NaN)).toBe(C.slideMs);
    expect(clampHeroChessValue('slideMs', 'abc')).toBe(C.slideMs);
    expect(clampHeroChessValue('slideMs', '300')).toBe(300);
    expect(clampHeroChessValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroChessValue('colorPlayer', 'gold')).toBe(C.colorPlayer);
    expect(clampHeroChessValue('sfxSlideClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroChessValue('nope' as keyof HeroChessConfig, 1)).toBeUndefined();
    const s = sanitizeHeroChessConfig({ v4Sparks: 400, colorIvory: 'x', bogus: 3 });
    expect(s.v4Sparks).toBe(60);
    expect(s.colorIvory).toBe(C.colorIvory);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroChessConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers chess; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroChessConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.pawnHops).toBe(C.pawnHops);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('chess');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Tier 1 (3)', '▶ Tier 2 (8)', '▶ Tier 3 (14)', '▶ Tier 4 (40)', '▶ Foe Tier 1 (3)', '▶ Foe Tier 3 (14)', '▶ Foe Tier 4 (40)']) expect(labels).toContain(l);
    // Tiers are named Tier 1 to Tier 4 (owner 2026-11-13): no roman numerals, no Small / Big / Huge, in any label or group.
    const words = [...labels, ...SPEC.controls.map((c) => `${c.label} ${c.group ?? ''} ${c.hint ?? ''}`)];
    for (const w of words) expect(w).not.toMatch(/\bTier (I|II|III|IV)\b|\b(Small|Big|Huge)\b/);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });
});

describe('the plan', () => {
  it('THE PAWN: set down, then hop, hop (a tap each), then the diagonal capture, which is the only impact', () => {
    expect(P1.moves.map((m) => m.kind)).toEqual(['hop', 'hop', 'capture']);
    expect(P1.hops).toBe(2);
    expect(P1.taps).toEqual(P1.moves.slice(0, 2).map((m) => m.landAt));
    expect(P1.tapAt).toBe(P1.setAt + C.setMs);
    expect(P1.moves[0]!.at).toBeGreaterThan(P1.tapAt);
    for (let i = 1; i < P1.moves.length; i++) expect(P1.moves[i]!.at).toBeGreaterThanOrEqual(P1.moves[i - 1]!.landAt);
    expect(P1.impactAt).toBe(P1.moves[2]!.landAt);
    expect(P1.strikeAt).toBe(P1.moves[2]!.at);
    expect(P1.king).toBe(false);
    const kinds = chessCues(P1).map((q) => q.kind);
    expect(kinds).toEqual(['charge', 'set', 'tap', 'hop', 'land', 'hop', 'land', 'strike', 'impact', 'dissolve', 'end']);
  });

  it('THE KNIGHT: set down, rears, one jump; the landing is the impact (no taps before it)', () => {
    for (const p of [P2]) {
      expect(p.moves.map((m) => m.kind)).toEqual(['jump']);
      expect(p.taps).toEqual([]);
      expect(p.rearAt).toBeGreaterThan(p.tapAt);
      expect(p.strikeAt).toBe(p.rearAt + C.rearMs);
      expect(p.impactAt).toBe(p.strikeAt + C.jumpMs);
      expect(chessCues(p).map((q) => q.kind)).toEqual(['charge', 'set', 'tap', 'rear', 'strike', 'impact', 'dissolve', 'end']);
    }
  });

  it('THE ROOK: set down, braces, then ONE charge down the file, thumping over each seam faster and faster; the ram is the impact', () => {
    expect(P3.moves.map((m) => m.kind)).toEqual(['charge']);
    expect(P3.taps).toEqual([]);
    expect(P3.ranks).toBe(C.rookRanks);
    expect(P3.rearAt).toBeGreaterThan(P3.tapAt);
    expect(P3.strikeAt).toBe(P3.rearAt + C.rookBraceMs);
    expect(P3.impactAt).toBe(P3.strikeAt + C.rookChargeMs);
    expect(P3.king).toBe(false);
    // A seam between each pair of squares, all inside the charge, each gap shorter than the last (it is speeding up).
    expect(P3.crosses).toHaveLength(P3.ranks - 1);
    for (const x of P3.crosses) { expect(x).toBeGreaterThan(P3.strikeAt); expect(x).toBeLessThan(P3.impactAt); }
    const beats = [P3.strikeAt, ...P3.crosses, P3.impactAt];
    for (let i = 2; i < beats.length; i++) expect(beats[i]! - beats[i - 1]!).toBeLessThan(beats[i - 1]! - beats[i - 2]!);
    expect(rookTravel(rookTimeAt(0.5))).toBeCloseTo(0.5, 6);
    expect(chessCues(P3).map((q) => q.kind)).toEqual(['charge', 'set', 'tap', 'brace', 'strike', 'cross', 'cross', 'impact', 'dissolve', 'end']);
  });

  it('THE QUEEN: set down, the gleam, one slide (the impact); then the king wobbles, tips and lies, and the word sets', () => {
    expect(P4.moves.map((m) => m.kind)).toEqual(['slide']);
    expect(P4.gleamAt).toBeGreaterThan(P4.tapAt);
    expect(P4.strikeAt).toBeGreaterThanOrEqual(P4.gleamAt + C.gleamMs + C.coilMs); // the gleam, then the coil (a held breath)
    expect(P4.impactAt).toBe(P4.strikeAt + C.slideMs);
    expect(P4.king).toBe(true);
    expect(P4.tipAt).toBe(P4.impactAt + C.kingWobbleMs);
    expect(P4.fallAt).toBe(P4.tipAt + C.kingFallMs);
    expect(P4.wordAt).toBeGreaterThan(P4.impactAt);
    expect(P4.wordEndAt).toBe(P4.wordAt + C.wordHoldMs);
    expect(P4.dissolveAt).toBeGreaterThanOrEqual(P4.wordEndAt);
    expect(P4.endAt).toBeGreaterThan(P4.fallAt); // the fight waits for the king to be down
    const kinds = chessCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k !== 'wobble')).toEqual(['charge', 'set', 'tap', 'gleam', 'strike', 'impact', 'word', 'topple', 'dissolve', 'end']);
    // The king rocks on its base between the capture and the tip: a knock per rock, all before it falls.
    const rocks = chessCues(P4).filter((q) => q.kind === 'wobble');
    expect(rocks).toHaveLength(KING_ROCKS);
    for (const r of rocks) { expect(r.at).toBeGreaterThan(P4.impactAt); expect(r.at).toBeLessThan(P4.tipAt); }
    // A slow topple with weight: the wobble and the fall together take over a second.
    expect(P4.fallAt - P4.impactAt).toBeGreaterThanOrEqual(1000);
  });

  it('exactly one impact cue and one end cue per look, in time order', () => {
    for (const p of [P1, P2, P3, P4]) {
      const cues = chessCues(p);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cues[cues.length - 1]!.kind).toBe('end');
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(p.clearAt).toBeGreaterThan(p.dissolveAt);
    }
  });

  it('each tier runs a step longer than the one under it: about 1.6 s the pawn, 1.9 s the knight, 2.2 s the rook; the queen about 3 s', () => {
    const len = (p: ChessPlan): number => p.endAt - p.chargeAt;
    expect(len(P1)).toBeGreaterThan(1100); expect(len(P1)).toBeLessThan(1800);
    expect(len(P2)).toBeGreaterThan(1300); expect(len(P2)).toBeLessThan(2100);
    expect(len(P3)).toBeGreaterThan(len(P2)); expect(len(P3)).toBeLessThan(len(P4));
    expect(len(P4)).toBeGreaterThan(2600); expect(len(P4)).toBeLessThan(3600);
    expect(P1.impactAt - P1.chargeAt).toBeLessThan(1200);
    expect(P4.impactAt - P4.chargeAt).toBeLessThan(1600);
  });

  it('every look escalates: more shake, zoom, sparks, burst and dim', () => {
    for (const k of ['shakePx', 'zoom', 'sparks', 'burst', 'dim'] as const) {
      expect(P2[k], k).toBeGreaterThan(P1[k]);
      expect(P3[k], k).toBeGreaterThan(P2[k]);
      expect(P4[k], k).toBeGreaterThan(P3[k]);
    }
  });

  it('the caps always hold', () => {
    const wild = sanitizeHeroChessConfig({ ...C, pawnHops: 99, rookRanks: 99, v4Shake: 999, v4Zoom: 9, v4Sparks: 999 });
    const p1 = chessPlan({ total: 3, distance: 1600 }, wild), p4 = chessPlan({ total: 40, distance: 1600 }, wild);
    expect(p1.hops).toBeLessThanOrEqual(CHESS_CAPS.hops);
    expect(chessPlan({ total: 14, distance: 1600 }, wild).ranks).toBeLessThanOrEqual(CHESS_CAPS.ranks);
    expect(p4.shakePx).toBeLessThanOrEqual(CHESS_CAPS.shakePx);
    expect(p4.zoom).toBeLessThanOrEqual(CHESS_CAPS.zoom);
    expect(p4.sparks).toBeLessThanOrEqual(CHESS_CAPS.sparks);
  });

  it('reduced motion: no moves, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([6, 6, 6, 6, 6, 5, 5], 40, true);
    expect(p.reduced).toBe(true);
    expect(p.moves).toEqual([]);
    expect(p.king).toBe(false);
    expect([p.shakePx, p.zoom, p.dim, p.sparks]).toEqual([0, 0, 0, 0]);
    expect(chessCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(p.endAt).toBeGreaterThan(p.impactAt);
  });

  it('is deterministic (a replay plays what the live fight did)', () => {
    expect(plan([3, 3, 2], 8)).toEqual(P2);
    expect(chessCues(plan([6, 6, 6, 6, 6, 5, 5], 40))).toEqual(chessCues(P4));
    expect(board(P4)).toEqual(board(P4));
  });
});

describe('the board (pure geometry)', () => {
  it('is turned to the line between the heroes, with squares sized to the struck portrait', () => {
    const g = board(P1);
    const L = dist(YOU, FOE);
    expect(g.u.x).toBeCloseTo((FOE.x - YOU.x) / L, 6);
    expect(g.u.y).toBeCloseTo((FOE.y - YOU.y) / L, 6);
    expect(g.u.x * g.n.x + g.u.y * g.n.y).toBeCloseTo(0, 6);
    expect(g.ang).toBeCloseTo(Math.atan2(g.u.y, g.u.x), 6);
    expect(g.sq).toBeCloseTo(R * C.squareK, 3);
    // Every square sits on the grid; the struck hero's own square is left clear.
    for (const c of g.cells) {
      expect(c.x).toBeCloseTo(FOE.x + g.n.x * c.f * g.sq - g.u.x * c.r * g.sq, 4);
      expect(c.y).toBeCloseTo(FOE.y + g.n.y * c.f * g.sq - g.u.y * c.r * g.sq, 4);
      expect(c.f === 0 && c.r === 0).toBe(false);
    }
    expect(g.cells.length).toBeGreaterThan(8);
    expect(g.cells.some((c) => c.dark) && g.cells.some((c) => !c.dark)).toBe(true);
  });

  it('THE PAWN walks its own file (one across from the hero) and captures DIAGONALLY', () => {
    const g = board(P1);
    // Set down three ranks back on the next file; each hop is exactly one square straight toward the far rank.
    expect(dist(g.start, { x: FOE.x + g.n.x * g.sq - g.u.x * 3 * g.sq, y: FOE.y + g.n.y * g.sq - g.u.y * 3 * g.sq })).toBeLessThan(0.01);
    let from = g.start;
    for (let i = 0; i < P1.hops; i++) {
      const to = g.stops[i]!;
      expect(to.x - from.x).toBeCloseTo(g.u.x * g.sq, 4);
      expect(to.y - from.y).toBeCloseTo(g.u.y * g.sq, 4);
      from = to;
    }
    // The capture: one along AND one across (the diagonal), ending on the portrait.
    const along = g.dir.x * g.u.x + g.dir.y * g.u.y, across = g.dir.x * g.n.x + g.dir.y * g.n.y;
    expect(along).toBeCloseTo(Math.SQRT1_2, 4);
    expect(across).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(dist(g.stops[g.stops.length - 1]!, FOE)).toBeLessThan(R);
    expect(g.cells.filter((c) => c.hint).map((c) => `${c.f},${c.r}`).sort()).toEqual(['1,1', '1,2', '1,3']);
  });

  it('THE KNIGHT stands two along and one across from the hero (an L) and lands ON the portrait', () => {
    const g = board(P2);
    const rel = { x: FOE.x - g.start.x, y: FOE.y - g.start.y };
    expect(rel.x * g.u.x + rel.y * g.u.y).toBeCloseTo(2 * g.sq, 3);
    expect(Math.abs(rel.x * g.n.x + rel.y * g.n.y)).toBeCloseTo(g.sq, 3);
    expect(dist(g.stops[0]!, FOE)).toBeLessThan(R * 0.5);
    expect(g.dir.y).toBeGreaterThan(0.7); // it comes down onto it
    expect(g.jumpLift).toBeGreaterThan(0);
    // Mid-flight it has gone ALONG before it goes ACROSS: at 40% it is still on its own file.
    const pose = newPiecePose();
    const m = P2.moves[0]!;
    chessPieceAt(P2, g, C, m.at + m.ms * 0.38, pose);
    const off = { x: pose.x - g.start.x, y: pose.y - g.start.y };
    expect(off.x * g.u.x + off.y * g.u.y).toBeGreaterThan(g.sq * 0.9);
    expect(Math.abs(off.x * g.n.x + off.y * g.n.y)).toBeLessThan(g.sq * 0.05);
    expect(pose.lift).toBeGreaterThan(g.jumpLift * 0.8);
  });

  it('THE ROOK stands on the struck hero\'s OWN file, a few squares back, and charges straight down it', () => {
    const g = board(P3);
    const rel = { x: FOE.x - g.start.x, y: FOE.y - g.start.y };
    expect(rel.x * g.u.x + rel.y * g.u.y).toBeCloseTo(P3.ranks * g.sq, 3);
    expect(Math.abs(rel.x * g.n.x + rel.y * g.n.y)).toBeLessThan(1e-6);
    expect(g.dir.x).toBeCloseTo(g.u.x, 6); expect(g.dir.y).toBeCloseTo(g.u.y, 6);
    expect(g.cells.filter((c) => c.hint).map((c) => `${c.f},${c.r}`).sort()).toEqual(['0,1', '0,2', '0,3']);
    expect(dist(g.stops[0]!, FOE)).toBeLessThan(R);
    expect(g.king).toBeNull();
    // Every frame of the charge stays on the file (no sideways drift), and the rook's foot hardly leaves the board.
    const pose = newPiecePose();
    const m = P3.moves[0]!;
    for (let t = m.at; t <= m.landAt; t += 6) {
      chessPieceAt(P3, g, C, t, pose);
      const off = { x: pose.x - FOE.x, y: pose.y - FOE.y };
      expect(Math.abs(off.x * g.n.x + off.y * g.n.y)).toBeLessThan(1e-6);
      expect(pose.lift).toBeLessThan(g.sq * 0.1);
    }
  });

  it('THE QUEEN starts on the long diagonal (as many squares as fit on screen) and slides straight down it', () => {
    const g = board(P4);
    expect(g.diag).toBeGreaterThanOrEqual(2);
    expect(g.diag).toBeLessThanOrEqual(C.diagMax);
    const rel = { x: FOE.x - g.start.x, y: FOE.y - g.start.y };
    expect(rel.x * g.u.x + rel.y * g.u.y).toBeCloseTo(g.diag * g.sq, 3);
    expect(Math.abs(rel.x * g.n.x + rel.y * g.n.y)).toBeCloseTo(g.diag * g.sq, 3);
    expect(g.cells.filter((c) => c.hint).every((c) => c.f === c.r)).toBe(true);
    expect(g.cells.filter((c) => c.hint)).toHaveLength(g.diag);
    expect(g.king).not.toBeNull();
    expect(g.word).not.toBeNull();
    // With no view to keep inside she takes the full diagonal.
    expect(board(P4, YOU, FOE, null).diag).toBe(C.diagMax);
  });

  it('stays on screen in BOTH directions and from every corner: the piece, its whole path, the king and the word', () => {
    const corners = [YOU, FOE, { x: 105, y: 137 }, { x: 1773, y: 950 }];
    const pose = newPiecePose();
    for (const p of [P1, P2, P3, P4]) {
      for (const a of corners) {
        for (const d of corners) {
          if (a === d) continue;
          const g = chessBoard(p, a, d, R, R, C, VIEW);
          const tag = `level ${p.level} ${a.x},${a.y} -> ${d.x},${d.y}`;
          const tall = PIECE_TALL[p.piece] * g.k;
          expect(g.start.x, tag).toBeGreaterThanOrEqual(0); expect(g.start.x, tag).toBeLessThanOrEqual(VIEW.w);
          expect(g.start.y - tall, tag).toBeGreaterThanOrEqual(0); expect(g.start.y, tag).toBeLessThanOrEqual(VIEW.h);
          for (let t = p.setAt; t <= p.dissolveAt; t += 8) {
            chessPieceAt(p, g, C, t, pose);
            expect(Number.isFinite(pose.x + pose.y + pose.lift + pose.rot + pose.spin + pose.sx + pose.sy), tag).toBe(true);
            expect(pose.x, tag).toBeGreaterThanOrEqual(-1); expect(pose.x, tag).toBeLessThanOrEqual(VIEW.w + 1);
            expect(pose.y - pose.lift, tag).toBeLessThanOrEqual(VIEW.h + 1); // its foot (in the air, the board under it may be off the edge)
            // The top of the piece stays in view. Slack: under a hero at the very top, with the striker almost straight
            // below (not a layout the game has), the knight's L turns on a square at the screen edge and its head pokes out.
            expect(pose.y - pose.lift - tall, `${tag} t ${t}`).toBeGreaterThanOrEqual(-tall * (p.level === 2 ? 0.4 : 0.3));
          }
          if (p.king) {
            const kt = PIECE_TALL.king * g.kingK;
            expect(g.king!.x, tag).toBeGreaterThanOrEqual(0); expect(g.king!.x, tag).toBeLessThanOrEqual(VIEW.w);
            expect(g.king!.y - kt, tag).toBeGreaterThanOrEqual(0); expect(g.king!.y, tag).toBeLessThanOrEqual(VIEW.h);
            const tip = g.king!.x + g.kingFall * kt;
            expect(tip, `${tag} king lies on screen`).toBeGreaterThanOrEqual(0); expect(tip, tag).toBeLessThanOrEqual(VIEW.w);
            expect(g.word!.x - g.wordW / 2, tag).toBeGreaterThanOrEqual(0); expect(g.word!.x + g.wordW / 2, tag).toBeLessThanOrEqual(VIEW.w);
            expect(g.word!.y, tag).toBeGreaterThan(0); expect(g.word!.y, tag).toBeLessThan(VIEW.h);
          }
        }
      }
    }
  });

  it('shrinks its squares to fit a small sandbox box, so the pawn still has its squares to walk', () => {
    const a = { x: 60, y: 240 }, d = { x: 340, y: 70 };
    const g = chessBoard(P1, a, d, 34, 34, C, { w: 400, h: 300 });
    expect(g.sq).toBeLessThanOrEqual(34 * C.squareK);
    expect(g.sq * (P1.hops + 1)).toBeLessThan(dist(a, d));
    expect(g.cells.length).toBeGreaterThan(3);
  });

  it('the board fades in as a ripple from the ready and out at the dissolve; the hint lights from the tap and goes out at the impact', () => {
    expect(chessBoardAlpha(P4, C, P4.chargeAt - 1, 0)).toBe(0);
    expect(chessBoardAlpha(P4, C, P4.chargeAt + 60, 0)).toBeGreaterThan(chessBoardAlpha(P4, C, P4.chargeAt + 60, 1));
    expect(chessBoardAlpha(P4, C, P4.strikeAt, 1)).toBeCloseTo(1, 3);
    expect(chessBoardAlpha(P4, C, P4.dissolveAt + C.boardFadeMs / 2, 0)).toBeLessThan(0.6);
    expect(chessBoardAlpha(P4, C, P4.clearAt, 0)).toBe(0);
    expect(chessHintAt(P4, P4.tapAt - 1, 0)).toBe(0);
    expect(chessHintAt(P4, P4.strikeAt, 0)).toBeGreaterThan(0.9);
    expect(chessHintAt(P4, P4.impactAt + 400, 0)).toBe(0);
    // The move's squares light ONE AFTER ANOTHER toward the struck hero, each with a flash as it comes on.
    const first = P4.tapAt + 40;
    expect(chessHintAt(P4, first + 60, 0)).toBeGreaterThan(0.3);
    expect(chessHintAt(P4, first + 60, 0.5)).toBe(0);
    expect(chessHintAt(P4, first + 0.5 * HINT_STEP_MS + 130, 0.5)).toBeGreaterThan(0.9);
    expect(chessHintFlashAt(P4, first - 1, 0)).toBe(0);
    expect(chessHintFlashAt(P4, first + 50, 0)).toBeCloseTo(1, 5);
    expect(chessHintFlashAt(P4, first + 50, 0.5)).toBe(0);
    expect(chessHintFlashAt(P4, first + 400, 0)).toBe(0);
    expect(C.hintAlpha).toBeGreaterThan(C.boardAlpha + 0.1); // the lit squares stand well clear of the board
  });
});

describe('the poses (pure)', () => {
  it('the piece is set down from above, stands on each stop in turn, and ends on the contact riding the portrait', () => {
    const pose = newPiecePose();
    for (const p of [P1, P2, P3, P4]) {
      const g = board(p);
      expect(chessPieceAt(p, g, C, p.setAt - 1, pose).alpha).toBe(0);
      chessPieceAt(p, g, C, p.setAt + C.setMs * 0.3, pose);
      expect(pose.lift).toBeGreaterThan(0);
      chessPieceAt(p, g, C, p.tapAt, pose);
      expect(pose.lift).toBe(0);
      expect(dist(pose, g.start)).toBeLessThan(0.01);
      expect(pose.ride).toBe(false);
      p.moves.forEach((m, i) => {
        if (i === p.moves.length - 1) return;
        chessPieceAt(p, g, C, m.landAt, pose);
        expect(dist(pose, g.stops[i]!), `level ${p.level} stop ${i}`).toBeLessThan(0.01);
      });
      chessPieceAt(p, g, C, p.impactAt, pose);
      expect(dist(pose, g.stops[g.stops.length - 1]!)).toBeLessThan(0.01);
      expect(pose.ride).toBe(true);
      expect(pose.alpha).toBe(1);
      expect(chessPieceAt(p, g, C, p.clearAt, pose).alpha).toBe(0);
    }
  });

  it('a hop leaves the board and comes back to it; the knight turns right over in the air; the queen never leaves the board', () => {
    const pose = newPiecePose();
    const g1 = board(P1), hop = P1.moves[0]!;
    expect(chessPieceAt(P1, g1, C, hop.at + hop.ms / 2, pose).lift).toBeCloseTo(C.hopLift * g1.sq, 3);
    const g2 = board(P2), jump = P2.moves[0]!;
    chessPieceAt(P2, g2, C, jump.at + jump.ms / 2, pose);
    expect(Math.abs(pose.spin)).toBeCloseTo(Math.PI * C.jumpSpins, 3);
    expect(pose.lift).toBeCloseTo(g2.jumpLift, 3);
    // It spins once on its square before it goes (its width passes through zero).
    let minSx = 1;
    for (let t = P2.rearAt; t < P2.strikeAt; t += 4) minSx = Math.min(minSx, chessPieceAt(P2, g2, C, t, pose).sx);
    expect(minSx).toBeLessThan(-0.8);
    const g4 = board(P4), slide = P4.moves[0]!;
    for (let t = slide.at; t <= slide.landAt; t += 10) expect(chessPieceAt(P4, g4, C, t, pose).lift).toBe(0);
  });

  it('THE ROOK braces (drawn back down its file, leaning back), leaves from that point without a snap, and leans into the charge', () => {
    const g = board(P3);
    const pose = newPiecePose();
    chessPieceAt(P3, g, C, P3.strikeAt - 1, pose);
    const drawn = (pose.x - g.start.x) * g.dir.x + (pose.y - g.start.y) * g.dir.y;
    expect(drawn).toBeCloseTo(-ROOK_DRAW * g.sq, 0);
    expect(Math.sign(pose.rot)).toBe(-g.face); // leaning back
    const before = { x: pose.x, y: pose.y, rot: pose.rot };
    chessPieceAt(P3, g, C, P3.strikeAt + 1, pose);
    expect(dist(pose, before)).toBeLessThan(g.sq * 0.03);
    expect(Math.abs(pose.rot - before.rot)).toBeLessThan(0.08);
    chessPieceAt(P3, g, C, P3.strikeAt + C.rookChargeMs * 0.6, pose);
    expect(Math.sign(pose.rot)).toBe(g.face); // leaning in
    // On the ram it bucks back off the blow.
    chessPieceAt(P3, g, C, P3.impactAt + 40, pose);
    expect(Math.sign(pose.rot)).toBe(-g.face);
    expect(pose.ride).toBe(true);
  });

  it('THE KING stands until the impact, wobbles, tips over onto its side and stays down', () => {
    const g = board(P4);
    const pose = newPiecePose();
    expect(chessKingAt(P4, g, P4.impactAt - 1, pose).rot).toBe(0);
    expect(pose.alpha).toBeGreaterThan(0.99);
    let wobble = 0;
    for (let t = P4.impactAt; t < P4.tipAt; t += 8) wobble = Math.max(wobble, Math.abs(chessKingAt(P4, g, t, pose).rot));
    expect(wobble).toBeGreaterThan(0.08);
    expect(wobble).toBeLessThan(0.5);
    expect(Math.abs(chessKingAt(P4, g, (P4.tipAt + P4.fallAt) / 2, pose).rot)).toBeLessThan(Math.PI / 4); // slow, then fast
    expect(P4.dissolveAt).toBeGreaterThanOrEqual(P4.fallAt + 300);
    expect(Math.abs(chessKingAt(P4, g, P4.fallAt + 290, pose).rot)).toBeGreaterThan(1.5);
    expect(Math.abs(pose.rot)).toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.sign(pose.rot)).toBe(g.kingFall);
    expect(chessKingAt(P4, g, P4.clearAt, pose).alpha).toBe(0);
    // The other looks have no king.
    expect(chessKingAt(P2, board(P2), P2.impactAt, pose).alpha).toBe(0);
  });

  it('CHECKMATE sets with a small overshoot after the impact, holds, and fades', () => {
    const w = { scale: 1, alpha: 0 };
    expect(chessWordAt(P4, P4.wordAt - 1, w).alpha).toBe(0);
    expect(chessWordAt(P4, P4.wordAt + 20, w).scale).toBeGreaterThan(1.1);
    chessWordAt(P4, P4.wordAt + 300, w);
    expect(w.scale).toBeCloseTo(1, 2);
    expect(w.alpha).toBe(1);
    expect(chessWordAt(P4, P4.wordEndAt + 400, w).alpha).toBe(0);
    expect(chessWordAt(P1, P1.impactAt + 200, w).alpha).toBe(0);
  });
});

describe('the camera', () => {
  it('pushes in through the ready, punches in on the impact and shakes ALONG the piece; rests by the end', () => {
    const dir = board(P4).dir;
    expect(chessCameraAt(P4, C, P4.chargeAt - 1, dir)).toEqual({ zoom: 1, x: 0, y: 0 });
    const ready = chessCameraAt(P4, C, P4.strikeAt, dir);
    expect(ready.zoom).toBeCloseTo(1 + P4.zoom, 4);
    const hit = chessCameraAt(P4, C, P4.impactAt, dir);
    expect(hit.zoom).toBeCloseTo(1 + P4.zoom + P4.punch, 4);
    expect(Math.hypot(hit.x, hit.y)).toBeGreaterThan(P4.shakePx * 0.9);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(0);
    expect(hit.zoom - 1).toBeLessThanOrEqual(CHESS_CAPS.zoom + 0.1);
    const end = chessCameraAt(P1, C, P1.endAt + 600, board(P1).dir);
    expect(end.zoom).toBeCloseTo(1, 2);
    expect(Math.hypot(end.x, end.y)).toBeLessThan(0.5);
    expect(chessCameraAt(plan([40], 40, true), C, 500)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('anchors on the striker as the ready starts and on the struck hero from the set-down on', () => {
    expect(chessCameraFocus(P2, P2.chargeAt, YOU, FOE)).toEqual(YOU);
    expect(chessCameraFocus(P2, P2.tapAt, YOU, FOE)).toEqual(FOE);
    const mid = chessCameraFocus(P2, (P2.chargeAt + P2.tapAt) / 2, YOU, FOE);
    expect(mid.x).toBeGreaterThan(YOU.x); expect(mid.x).toBeLessThan(FOE.x);
  });
});

function manualFrames(): { frames: HeroChessOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroChessOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // The portraits arrive with styles of their own: every exit must put exactly these back.
  attackerEl.style.transform = 'scale(1.02)'; attackerEl.style.opacity = '0.9'; attackerEl.style.filter = 'brightness(1.1)'; attackerEl.className = 'portrait mine';
  defenderEl.style.transform = 'translate(1px, 2px)'; defenderEl.style.opacity = '0.8'; defenderEl.style.filter = 'saturate(0.5)'; defenderEl.className = 'portrait theirs';
  document.body.append(host, camera);
  const h = playHeroChess({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  const restored = (tag: string): void => {
    expect(attackerEl.style.transform, tag).toBe('scale(1.02)');
    expect(defenderEl.style.transform, tag).toBe('translate(1px, 2px)');
    expect([attackerEl.style.opacity, attackerEl.style.filter, attackerEl.className], tag).toEqual(['0.9', 'brightness(1.1)', 'portrait mine']);
    expect([defenderEl.style.opacity, defenderEl.style.filter, defenderEl.className], tag).toEqual(['0.8', 'saturate(0.5)', 'portrait theirs']);
    expect(camera.style.transform, tag).toBe('');
    expect(host.querySelector('.hblast'), tag).toBeNull();
  };
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl, restored };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE PAWN lands the blow EXACTLY ONCE, on the capture: never on a hop; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, defenderEl, restored } = run({ total: 3, formation: formationOf([3], 3) });
    expect(h.plan.piece).toBe('pawn');
    expect(h.wood).toBe('ivory');
    expect(host.querySelector('.hblast.hchess')).not.toBeNull();
    f.tick(h.plan.taps[1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.pieceShown).toBe(true);
    expect(defenderEl.style.transform).toBe('translate(1px, 2px)'); // a hop never touches the struck hero
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('scale(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-3');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    restored('the normal end');
    f.tick(3000, 16);
    expect(h.scene!.pieceShown).toBe(false);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('THE KNIGHT is in the air between take-off and landing, and lands the blow once, on the landing', () => {
    const { h, f, onImpact } = run({ total: 8, formation: formationOf([8], 8) });
    expect(h.plan.piece).toBe('knight');
    const m = h.plan.moves[0]!;
    f.tick(m.at + m.ms / 2, 4);
    expect(onImpact).not.toHaveBeenCalled();
    const air = h.scene!.piecePos;
    f.tick(m.ms / 2 + 12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.piecePos.y).toBeGreaterThan(air.y); // it came down
    expect(dist(h.scene!.piecePos, FOE)).toBeLessThan(R * 1.5);
    h.cancel();
  });

  it('THE ROOK lands the blow once, on the ram (never on a seam), and is driven straight into the portrait', () => {
    const { h, f, onImpact, onDone, restored } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.piece).toBe('rook');
    f.tick(h.plan.crosses[h.plan.crosses.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.pieceShown).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() + 12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(dist(h.scene!.piecePos, FOE)).toBeLessThan(R * 1.5);
    f.tick(h.plan.endAt - h.elapsed() + 16, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    restored('the rook end');
    f.tick(2500, 16);
    expect(f.hooked()).toBe(0);
  });

  it('THE QUEEN: the board, the king and the word; the king is down and CHECKMATE is up after the one impact', () => {
    const { h, f, onImpact, onDone, restored, root } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.piece).toBe('queen');
    expect(h.scene!.squareCount).toBe(h.geo.cells.length);
    f.tick(h.plan.strikeAt, 4);
    expect(h.scene!.kingShown).toBe(true);
    expect(h.scene!.kingTilt).toBe(0);
    expect(h.scene!.wordShown).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.fallAt - h.elapsed() + 200, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.kingTilt).toBeGreaterThan(1.3);
    expect(h.scene!.wordShown).toBe(true);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_CHESS_SPRITES);
    f.tick(h.plan.endAt - h.elapsed() + 16, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    restored('the queen end');
    f.tick(2000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('a knockout blow of 3 plays the queen', () => {
    const { h } = run({ total: 3, knockout: true, formation: formationOf([3], 3) });
    expect(h.plan.piece).toBe('queen');
    h.cancel();
  });

  it('works in both directions at every look: the blow lands once on whichever hero is struck, in the striker\'s wood, inside the cap', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const side of ['player', 'opp'] as const) {
        const a = side === 'player' ? YOU : FOE, d = side === 'player' ? FOE : YOU;
        const { h, f, onImpact, onDone, restored } = run({ total, side, attacker: a, defender: d, formation: formationOf([total], total) });
        expect(h.wood).toBe(side === 'player' ? 'ivory' : 'ebony');
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 40; t += 8) { f.tick(8, 8); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${total} ${side}`).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_CHESS_SPRITES);
        expect(dist(h.geo.stops[h.geo.stops.length - 1]!, d)).toBeLessThan(R);
        restored(`${total} ${side}`);
        f.tick(2500, 16);
        expect(f.hooked()).toBe(0);
      }
    }
  });

  it('THE CAMERA IS APPLIED ONCE: with the FX canvas inside the camera element the Pixi root never mirrors it; outside, it does', () => {
    const inCam = document.createElement('div');
    inCam.appendChild(document.createElement('canvas'));
    expect(fxCanvasRidesCamera(inCam, inCam.querySelector('canvas'))).toBe(true);
    const a = run({ total: 8, formation: formationOf([8], 8), camera: inCam });
    a.f.tick(a.h.plan.impactAt + 20, 4);
    expect(inCam.style.transform).toContain('scale(');
    expect(a.h.scene!.root.scale.x).toBe(1);
    expect(a.h.scene!.root.position.x).toBe(0);
    a.h.cancel();
    const b = run({ total: 8, formation: formationOf([8], 8) });
    expect(fxCanvasRidesCamera(b.camera, b.camera.querySelector('canvas'))).toBe(false);
    b.f.tick(b.h.plan.impactAt + 20, 4);
    expect(b.h.scene!.root.scale.x).toBeGreaterThan(1);
    b.h.cancel();
  });

  it('the piece RIDES the struck portrait\'s knockback once it has taken it', () => {
    const { h, f } = run({ total: 8, formation: formationOf([8], 8) });
    f.tick(h.plan.impactAt - 30, 4);
    f.tick(60, 4);
    const moved = h.scene!.piecePos;
    f.tick(900, 4);
    // At rest the knockback has died away; while it rang, the piece was displaced with it.
    expect(dist(moved, h.scene!.piecePos)).toBeGreaterThan(0.5);
    h.cancel();
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ total: 3, speed: 0.5, formation: formationOf([3], 3) });
    f.tick(h.plan.impactAt * 2 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(80, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same: the same seed, the same board, the same frames', () => {
    const one = run({ total: 40, formation: formationOf([40], 40), rollSeed: 77 });
    const two = run({ total: 40, formation: formationOf([40], 40), rollSeed: 77 });
    expect(one.h.geo).toEqual(two.h.geo);
    for (let t = 0; t < one.h.plan.fallAt; t += 16) {
      one.f.tick(16); two.f.tick(16);
      expect(one.h.scene!.piecePos).toEqual(two.h.scene!.piecePos);
    }
    expect(one.h.scene!.liveSprites).toBe(two.h.scene!.liveSprites);
    expect(chessSeed(40, 1800, 'player', 77)).toBe(chessSeed(40, 1800, 'player', 77));
    expect(chessSeed(40, 1800, 'player', 77)).not.toBe(chessSeed(40, 1800, 'player', 78));
    expect(chessSeed(40, 1800, 'player')).not.toBe(chessSeed(40, 1800, 'opp'));
    one.h.cancel(); two.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it; both restore everything', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    a.f.tick(a.h.plan.tapAt + 30, 4);
    expect(a.attackerEl.style.transform).not.toBe('scale(1.02)'); // the striker is mid-nod
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.h.done).toBe(true);
    a.restored('finish');
    expect(a.root.children).toHaveLength(0);
    expect(a.f.hooked()).toBe(0);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);

    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.impactAt + 40, 4);
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expect(b.defenderEl.style.transform).not.toBe('translate(1px, 2px)');
    b.h.cancel();
    b.restored('cancel after impact');
    expect(b.root.children).toHaveLength(0);

    const c = run({ total: 8, formation: formationOf([8], 8) });
    c.f.tick(c.h.plan.strikeAt + 40, 4);
    c.h.cancel();
    expect(c.onImpact).not.toHaveBeenCalled();
    expect(c.onDone).not.toHaveBeenCalled();
    c.restored('cancel before impact');
    expect(c.root.children).toHaveLength(0);
    expect(c.f.hooked()).toBe(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, attackerEl, defenderEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('scale(1.02)');
    expect(defenderEl.style.transform).toBe('translate(1px, 2px)');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow and restores the portraits if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const attackerEl = document.createElement('div'), defenderEl = document.createElement('div');
      attackerEl.style.transform = 'scale(1.02)';
      const h = playHeroChess({
        formation: formationOf([25], 25), total: 25, attacker: YOU, defender: FOE, attackerEl, defenderEl,
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
      expect(attackerEl.style.transform).toBe('scale(1.02)');
      expect(defenderEl.style.transform).toBe('');
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole queen stays in the cap and drains by itself after the end; every drawn number is finite; destroy leaves nothing', () => {
    const g = board(P4);
    const scene = new HeroChessScene(TEX, COLORS, P4, g, C, 'ivory', 1, 7);
    let peak = 0;
    let alive = true;
    const finite = (): void => {
      const walk = (c: Container): void => {
        for (const ch of c.children) {
          expect(Number.isFinite(ch.position.x + ch.position.y + ch.scale.x + ch.scale.y + ch.rotation + ch.alpha)).toBe(true);
          walk(ch as Container);
        }
      };
      walk(scene.root);
    };
    for (let t = 0; t < P4.clearAt + 800; t += 16) {
      // Driven by the runner until the end; after it the scene keeps its own time.
      if (t <= P4.endAt) scene.drive(t);
      if (Math.abs(t - P4.tapAt) < 8) scene.tap(g.start.x, g.start.y, 1.3);
      if (Math.abs(t - P4.impactAt) < 8) scene.impact(FOE.x, FOE.y, R, g.dir, { level: 4, burst: P4.burst, sparks: P4.sparks, flashAlpha: 0.85 });
      if (Math.abs(t - P4.impactAt) < 8) scene.screenFlash(0.38, 1920, 1080);
      if (Math.abs(t - P4.wordAt) < 8 && g.word) scene.wordSlam(g.word.x, g.word.y, g.wordW);
      if (Math.abs(t - P4.fallAt) < 8 && g.king) scene.kingDown(g.king.x, g.king.y, g.kingFall);
      alive = scene.update(16);
      peak = Math.max(peak, scene.liveSprites);
      if (t % 160 === 0) finite();
    }
    expect(peak).toBeGreaterThan(g.cells.length);
    expect(peak).toBeLessThanOrEqual(MAX_CHESS_SPRITES);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.time).toBeGreaterThan(P4.endAt);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
    scene.destroy(); // twice is safe
  });

  it('a whole rook (the seams and its ram) stays in the cap and drains by itself', () => {
    const g = board(P3);
    const scene = new HeroChessScene(TEX, COLORS, P3, g, C, 'ebony', 1, 5);
    let peak = 0, alive = true;
    const pose = newPiecePose();
    for (let t = 0; t < P3.clearAt + 1200; t += 16) {
      if (t <= P3.endAt) scene.drive(t);
      for (let i = 0; i < P3.crosses.length; i++) if (Math.abs(t - P3.crosses[i]!) < 8) { chessPieceAt(P3, g, C, t, pose); scene.seam(pose.x, pose.y, i); }
      if (Math.abs(t - P3.impactAt) < 8) scene.impact(FOE.x, FOE.y, R, g.dir, { level: 3, burst: P3.burst, sparks: P3.sparks, flashAlpha: 0.85 });
      alive = scene.update(16);
      peak = Math.max(peak, scene.liveSprites);
    }
    expect(peak).toBeGreaterThan(g.cells.length + 20);
    expect(peak).toBeLessThanOrEqual(MAX_CHESS_SPRITES);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
  });

  it('clear() drops everything at once; the pool is reused, not regrown', () => {
    const g = board(P2);
    const scene = new HeroChessScene(TEX, COLORS, P2, g, C, 'ebony', 1, 3);
    scene.drive(P2.impactAt);
    scene.impact(FOE.x, FOE.y, R, g.dir, { level: 2, burst: 1.2, sparks: 14, flashAlpha: 0.85 });
    scene.update(16);
    const pooled = scene.pooledSprites;
    expect(scene.liveSprites).toBeGreaterThan(10);
    scene.clear();
    expect(scene.liveSprites).toBe(0);
    expect(scene.pieceShown).toBe(false);
    scene.impact(FOE.x, FOE.y, R, g.dir, { level: 2, burst: 1.2, sparks: 14, flashAlpha: 0.85 });
    expect(scene.pooledSprites).toBe(pooled);
    expect(scene.update(16)).toBe(true);
    scene.destroy();
  });
});
