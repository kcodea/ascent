import { describe, expect, it } from 'vitest';
import { planRuneInspect, type Box, type RuneInspectInput } from './runeInspectLayout';

// R-RUNE-INSPECT-01 (owner report 2026-11-13, "this is in the compendium, inspecting a rune. fix this view please"): the
// Staff of Guel preview lapped over Guel's Apprentice, hung lower than it, and the pair sat off centre. Sizes below are the
// real ones measured in the Compendium at 1920x1080 (layout px, before the fit scale): a 162px rune card, and a named card
// whose plate paints ~66px past its layout box on each side, ~37px above it and ~150px below (the "Shop Spell" label).

const rune: Box = { l: 0, t: 0, r: 162, b: 317 };
const coin: Box = { l: 58, t: -37, r: 104, b: 9 };
const runePaint: Box = { l: 0, t: -37, r: 162, b: 317 };
// A plated card laid out right after the rune by flex, painting well past its box (the overlap the owner saw).
const card = (x: number): Box => ({ l: x - 66, t: 40, r: x + 66 + 210, b: 40 + 37 + 290 + 150 });
const plateTop = (b: Box): number => b.t;
const ov1920: Box = { l: -800, t: -400, r: 1120, b: 680 };

const input = (cards: Box[], ov: Box = ov1920, pick = false): RuneInspectInput => ({
  body: rune, rune: runePaint, cards, tops: cards.map(plateTop), ov, pick, gap: 28, maxK: 1.9,
});
const moved = (u: Box, o: { x: number; y: number }): Box => ({ l: u.l + o.x, t: u.t + o.y, r: u.r + o.x, b: u.b + o.y });
const onScreen = (b: Box, k: number, tx: number, ty: number): Box => ({ l: k * b.l + tx, t: k * b.t + ty, r: k * b.r + tx, b: k * b.b + ty });

describe('R-RUNE-INSPECT-01: the rune inspect lays the rune and its named cards out as one centred group', () => {
  it('a named card sits beside the rune with a clear gap, never over it, its plate top level with the rune card top', () => {
    const c = card(170); // flex put it 8px after the rune: its plate overlapped the rune by ~58px
    const p = planRuneInspect(input([c]));
    expect(p.stacked).toBe(false);
    const at = moved(c, p.off[0]);
    expect(at.l).toBeGreaterThanOrEqual(runePaint.r + 28);
    expect(at.t).toBe(rune.t);
  });

  it('the group is centred on the overlay, fully on screen, at most the card Inspect size', () => {
    const p = planRuneInspect(input([card(170)]));
    const s = onScreen(p.box, p.k, p.tx, p.ty);
    expect((s.l + s.r) / 2).toBeCloseTo((ov1920.l + ov1920.r) / 2, 6);
    expect((s.t + s.b) / 2).toBeCloseTo((ov1920.t + ov1920.b) / 2, 6);
    expect(s.l).toBeGreaterThanOrEqual(ov1920.l);
    expect(s.r).toBeLessThanOrEqual(ov1920.r);
    expect(s.t).toBeGreaterThanOrEqual(ov1920.t);
    expect(s.b).toBeLessThanOrEqual(ov1920.b);
    expect(p.k).toBeLessThanOrEqual(1.9);
  });

  it('two named cards never overlap the rune or each other', () => {
    const a = card(170);
    const b = card(170); // flex can leave two plated cards stacked on one spot (Living Geode, before the fix)
    const p = planRuneInspect(input([a, b]));
    const A = moved(a, p.off[0]);
    const B = moved(b, p.off[1]);
    expect(A.l).toBeGreaterThanOrEqual(runePaint.r + 28);
    expect(B.l).toBeGreaterThanOrEqual(A.r + 28);
    expect(A.t).toBe(rune.t);
    expect(B.t).toBe(rune.t);
  });

  it('a rune that names no card is the rune alone, centred', () => {
    const p = planRuneInspect(input([]));
    const s = onScreen(p.box, p.k, p.tx, p.ty);
    expect(p.off).toEqual([]);
    expect((s.l + s.r) / 2).toBeCloseTo((ov1920.l + ov1920.r) / 2, 6);
    expect((s.t + s.b) / 2).toBeCloseTo((ov1920.t + ov1920.b) / 2, 6);
  });

  it('a tall narrow overlay stacks the cards under the rune, centred, still clear of it', () => {
    const ov: Box = { l: -200, t: -300, r: 200, b: 900 };
    const c = card(170);
    const p = planRuneInspect(input([c], ov));
    expect(p.stacked).toBe(true);
    const at = moved(c, p.off[0]);
    expect(at.t).toBeGreaterThanOrEqual(runePaint.b + 28);
    expect((at.l + at.r) / 2).toBeCloseTo((rune.l + rune.r) / 2, 6);
    const s = onScreen(p.box, p.k, p.tx, p.ty);
    expect(s.t).toBeGreaterThanOrEqual(ov.t);
    expect(s.b).toBeLessThanOrEqual(ov.b);
  });

  it('with the touch Pick pill under it, the group keeps clear of the bottom of the screen', () => {
    const p = planRuneInspect(input([card(170)], ov1920, true));
    const s = onScreen(p.box, p.k, p.tx, p.ty);
    expect(s.b).toBeLessThanOrEqual(ov1920.t + (ov1920.b - ov1920.t) * 0.8);
  });

  it('the coin above the rune counts for the fit but not for the line-up', () => {
    const p = planRuneInspect({ ...input([card(170)]), rune: { ...runePaint, t: coin.t } });
    expect(p.box.t).toBe(coin.t);
  });
});
