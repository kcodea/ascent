import { describe, expect, it } from 'vitest';
import { planRuneInspect, type Box, type RuneInspectInput } from './runeInspectLayout';

// R-RUNE-INSPECT-01 (owner 2026-11-13: "just line them up so they are in line together"): the Staff of Guel preview lapped
// over Guel's Apprentice and hung lower than it; Living Geode's two cards sat on one spot. Sizes below are the real ones in
// the Compendium (layout px, before the Inspect scale): a 162px rune card, and a named card whose plate paints ~35px past its
// layout box on each side, ~37px above it and ~150px below (the "Shop Spell" label). Sizes are never changed, only places.

const rune: Box = { l: 0, t: 0, r: 162, b: 317 };
const runePaint: Box = { l: 0, t: -37, r: 162, b: 317 };
// A plated card laid out by flex right after the rune, painting well past its box (the overlap the owner saw).
const card = (x: number): Box => ({ l: x - 35, t: 90, r: x + 35 + 138, b: 90 + 37 + 175 + 150 });
const centre = { x: 300, y: 150 };
const input = (cards: Box[]): RuneInspectInput => ({ body: rune, rune: runePaint, cards, tops: cards.map((c) => c.t), centre, gap: 16 });
const moved = (u: Box, o: { x: number; y: number }): Box => ({ l: u.l + o.x, t: u.t + o.y, r: u.r + o.x, b: u.b + o.y });
const sizeOf = (b: Box): [number, number] => [b.r - b.l, b.b - b.t];

describe('R-RUNE-INSPECT-01: the rune inspect lines the rune and its named cards up in one centred row', () => {
  it('a named card sits beside the rune with a clear gap, never over it, its plate top level with the rune card top', () => {
    const c = card(170);
    const p = planRuneInspect(input([c]));
    const at = moved(c, p.off[0]);
    expect(at.l).toBeGreaterThanOrEqual(runePaint.r + 16);
    expect(at.t).toBe(rune.t);
    expect(sizeOf(at)).toEqual(sizeOf(c)); // moved, never resized
  });

  it('two named cards sit in the same row, never over the rune or each other', () => {
    const a = card(170);
    const b = card(170); // flex can leave two plated cards on one spot (Living Geode, before the fix)
    const p = planRuneInspect(input([a, b]));
    const A = moved(a, p.off[0]);
    const B = moved(b, p.off[1]);
    expect(A.l).toBeGreaterThanOrEqual(runePaint.r + 16);
    expect(B.l).toBeGreaterThanOrEqual(A.r + 16);
    expect(A.t).toBe(rune.t);
    expect(B.t).toBe(rune.t);
  });

  it('the row is centred as a group on the backdrop', () => {
    const p = planRuneInspect(input([card(170), card(170)]));
    expect((p.box.l + p.box.r) / 2 + p.shift.x).toBeCloseTo(centre.x, 6);
    expect((p.box.t + p.box.b) / 2 + p.shift.y).toBeCloseTo(centre.y, 6);
  });

  it('a rune that names no card is the rune alone, centred', () => {
    const p = planRuneInspect(input([]));
    expect(p.off).toEqual([]);
    expect(p.box).toEqual(runePaint);
    expect((runePaint.l + runePaint.r) / 2 + p.shift.x).toBeCloseTo(centre.x, 6);
  });
});
