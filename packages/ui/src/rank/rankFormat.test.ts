import { describe, expect, it } from 'vitest';
import { RANK_FIXTURES, fixtureById } from './fixtures';
import { announcement, barFraction, deltaText, demotionGateText, gateText, outcomeText, placementText, pointsText, rankLabel, signedRp, standingGateText } from './rankFormat';
import { planRankSequence, sequenceDurationMs } from './rankSequence';
import { compareRankDesc, DIVISION_COUNT, isMedalGate, isPromotionReady, medalOf, rankPositionOf, rankScalar, standingDemotionReady } from './types';

/**
 * The ONE formatting helper + the sequence planner, pinned per fixture (blueprint §3 rows + the owner's
 * 2026-09-20 decisions). If any surface ever prints a different label for an index, this is where it fails.
 */
describe('rank index → label (the shared mapping)', () => {
  it('walks Bronze I … Ascendant III, I → II → III within each medal', () => {
    const labels = Array.from({ length: DIVISION_COUNT }, (_, i) => rankLabel(i));
    expect(labels.slice(0, 4)).toEqual(['Bronze I', 'Bronze II', 'Bronze III', 'Silver I']);
    expect(labels[7]).toBe('Gold II');
    expect(labels[17]).toBe('Ascendant III');
    expect(medalOf(9)).toBe('Platinum');
    expect(medalOf(14)).toBe('Diamond');
  });
  it('clamps out-of-range indices instead of printing undefined', () => {
    expect(rankLabel(-3)).toBe('Bronze I');
    expect(rankLabel(99)).toBe('Ascendant III');
  });
  it('medal gates are every division I; the promotion-ready position is 100 below Ascendant III', () => {
    expect(isMedalGate(8)).toBe(true);  // Gold III → Platinum I needs 1st
    expect(isMedalGate(7)).toBe(false);
    expect(isPromotionReady({ divisionIndex: 7, points: 100 })).toBe(true);
    expect(isPromotionReady({ divisionIndex: 17, points: 100 })).toBe(false);
    expect(gateText({ divisionIndex: 7, points: 100 })).toBe('Promotion game ready. Finish top 4 to advance.');
    expect(gateText({ divisionIndex: 8, points: 100 })).toBe('Promotion game ready. Finish 1st to advance.');
  });
  it('orders by division then points (the scalar alone ties adjacent divisions)', () => {
    const a = { divisionIndex: 7, points: 100 };
    const b = { divisionIndex: 8, points: 0 };
    expect(rankScalar(a)).toBe(rankScalar(b));
    expect(compareRankDesc(a, b)).toBeGreaterThan(0); // b (Gold III) sorts first
    expect(compareRankDesc(b, a)).toBeLessThan(0);
  });
  it('duck-types a position off a RankedProfile or a bare position, never off garbage', () => {
    expect(rankPositionOf({ position: { divisionIndex: 5, points: 40 }, highest: { divisionIndex: 5, points: 40 } })).toEqual({ divisionIndex: 5, points: 40 });
    expect(rankPositionOf({ divisionIndex: 5, points: 40 })).toEqual({ divisionIndex: 5, points: 40 });
    expect(rankPositionOf(1234)).toBeNull();
    expect(rankPositionOf({ divisionIndex: 'x' })).toBeNull();
    expect(rankPositionOf(null)).toBeNull();
  });
});

describe('points, placement and delta text', () => {
  it('prints x / 100 below the top and an uncapped MMR counter at Ascendant III', () => {
    expect(pointsText({ divisionIndex: 7, points: 76 })).toBe('76 / 100');
    expect(pointsText({ divisionIndex: 17, points: 130 })).toBe('130 MMR');
    expect(barFraction({ divisionIndex: 17, points: 130 })).toBe(1);
    expect(barFraction({ divisionIndex: 7, points: 25 })).toBe(0.25);
  });
  it('VICTORY for 1st, the upper-case ordinal otherwise', () => {
    expect(placementText(1)).toBe('VICTORY');
    expect(placementText(2)).toBe('2ND');
    expect(placementText(3)).toBe('3RD');
    expect(placementText(8)).toBe('8TH');
  });
  it('signs with a real minus', () => {
    expect(signedRp(16)).toBe('+16 MMR');
    expect(signedRp(-40)).toBe('−40 MMR');
    expect(signedRp(0)).toBe('0 MMR');
  });
  it('prints the award at the gate cap (the bar shows 100 / 100; no cap flavour, owner 2026-09-21)', () => {
    const gate = fixtureById('gate')!.result!;
    expect(deltaText(gate)).toBe('+40 MMR');
    expect(outcomeText(gate)).toBe('Promotion game ready. Finish top 4 to advance.');
    expect(outcomeText(fixtureById('gate-medal')!.result!)).toBe('Promotion game ready. Finish 1st to advance.');
  });
  it('prints the award at the Bronze floor too: no "Bronze floor" flavour (owner 2026-09-21), the 0 / 100 readout says it', () => {
    const floor = fixtureById('floor')!.result!;
    expect(deltaText(floor)).toBe('−40 MMR');
    const zero = fixtureById('floor-zero')!.result!;
    expect(deltaText(zero)).toBe('−28 MMR');
  });
  it('a won promotion prints the base award and NO detail / outcome line — the crest transition + 10 / 100 say it (owner 2026-09-20; landing 10 since 2026-09-21)', () => {
    const promo = fixtureById('promo-won')!.result!;
    expect(promo.after.points, 'the fixture carries the 10-point landing').toBe(10);
    expect(promo.appliedDelta).toBe(10);
    expect(promo.cappedPoints).toBe(0);
    expect(deltaText(promo), 'the award, not the +10 scalar movement').toBe('+16 MMR');
    expect(outcomeText(promo)).toBeNull();
    expect(outcomeText(fixtureById('promo-medal')!.result!)).toBeNull();
  });
  it('a top-4 that earned the lobby-strength bonus prints ONE summed number (owner 2026-09-22: "just say +43 MMR"): "+52 MMR", "+13 MMR"', () => {
    const gain = fixtureById('gain')!.result!;
    expect(deltaText({ ...gain, placement: 1, baseDelta: 52, strengthBonus: 12, lobbyStrength: 91 })).toBe('+52 MMR');
    expect(deltaText({ ...gain, placement: 1, baseDelta: 43, strengthBonus: 3, lobbyStrength: 60 })).toBe('+43 MMR');
    expect(deltaText({ ...gain, placement: 4, baseDelta: 13, strengthBonus: 7, lobbyStrength: 100 })).toBe('+13 MMR');
    expect(deltaText({ ...gain, placement: 1, baseDelta: 40, strengthBonus: 0, lobbyStrength: 30 })).toBe('+40 MMR');
    // A pre-bonus row (no strength settled) prints the plain award.
    expect(deltaText({ ...gain, placement: 2, baseDelta: 28, strengthBonus: 0, lobbyStrength: null })).toBe('+28 MMR');
  });
  it('a failed promotion says so (nothing else would); a lost demotion game prints no line (the crest/label change says it)', () => {
    expect(outcomeText(fixtureById('promo-failed')!.result!)).toBe('Promotion unsuccessful');
    expect(deltaText(fixtureById('promo-failed')!.result!)).toBe('−40 MMR');
    expect(outcomeText(fixtureById('demo-lost-division')!.result!)).toBeNull();
  });
  it('NO instant demotions (owner 2026-09-21): a loss that hits 0 in ANY division prints the demotion-game line; a lost demotion game drops one division', () => {
    const halt = fixtureById('demotion')!.result!;
    expect(halt.demotionUnlocked).toBe(true);
    expect(halt.demoted).toBe(false);
    expect(halt.after, 'Gold II 10, 8th: stopped at Gold II 0, not Gold I 70').toEqual({ divisionIndex: 7, points: 0 });
    expect(deltaText(halt)).toBe('−40 MMR');
    expect(outcomeText(halt)).toBe('Demotion game. Finish top 4 to stay in Gold II.');
    expect(announcement(8, halt, 'confirmed')).toBe('Finished 8th. −40 MMR. Now Gold II, 0 / 100. Demotion game. Finish top 4 to stay in Gold II.');
    const lost = fixtureById('demo-lost-division')!.result!;
    expect(lost.wasDemotionGame && lost.demoted).toBe(true);
    expect(deltaText(lost), 'the award (which is also the applied delta: Gold II 0 → Gold I 60 is −40 on the scalar)').toBe('−40 MMR');
    expect(outcomeText(lost)).toBeNull();
    expect(announcement(8, lost, 'confirmed')).toBe('Finished 8th. −40 MMR. Now Gold I, 60 / 100. Demoted to Gold I.');
    // The line names the division at stake, everywhere — including the top division.
    expect(demotionGateText({ divisionIndex: 1, points: 0 })).toBe('Demotion game. Finish top 4 to stay in Bronze II.');
    expect(demotionGateText({ divisionIndex: 17, points: 0 })).toBe('Demotion game. Finish top 4 to stay in Ascendant III.');
    expect(standingGateText({ divisionIndex: 7, points: 0 }, true)).toBe('Demotion game. Finish top 4 to stay in Gold II.');
    expect(standingGateText({ divisionIndex: 7, points: 0 })).toBeNull();
  });
  it('the MEDAL-boundary demotion game (owner 2026-09-20): a clamped loss at a medal floor prints the demotion-game line; a lost demotion game drops a medal; an escape is a plain fill', () => {
    const gate = fixtureById('demo-gate')!.result!;
    expect(gate.demotionUnlocked).toBe(true); // the RULES' field — nothing here derives it
    expect(deltaText(gate)).toBe('−40 MMR');
    expect(outcomeText(gate)).toBe('Demotion game. Finish top 4 to stay in Gold I.');
    expect(demotionGateText({ divisionIndex: 9, points: 0 })).toBe('Demotion game. Finish top 4 to stay in Platinum I.');
    // A result WITHOUT the flag prints no gate line, whatever its shape.
    expect(outcomeText({ ...gate, demotionUnlocked: false })).toBeNull();
    const lost = fixtureById('demo-lost')!.result!;
    expect(deltaText(lost)).toBe('−40 MMR');
    expect(outcomeText(lost)).toBeNull();
    expect(announcement(8, lost, 'confirmed')).toBe('Finished 8th. −40 MMR. Now Silver III, 60 / 100. Demoted to Silver III.');
    const escaped = fixtureById('demo-escape')!.result!;
    expect(deltaText(escaped)).toBe('+16 MMR');
    expect(outcomeText(escaped)).toBeNull();
    expect(planRankSequence(escaped).map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'outcome']);
    // The standing line the Title plate / Career print: promotion gate from the position, demotion gate from the flag.
    expect(standingGateText({ divisionIndex: 7, points: 100 })).toBe('Promotion game ready. Finish top 4 to advance.');
    expect(standingGateText({ divisionIndex: 6, points: 0 })).toBeNull();
    expect(standingGateText({ divisionIndex: 6, points: 0 }, true)).toBe('Demotion game. Finish top 4 to stay in Gold I.');
    // `standingDemotionReady`: ONLY the stored flag (profile or position level) — never derived from the shape:
    // a 0 at a medal floor without the flag is a won medal promotion's landing, not a demotion game.
    expect(standingDemotionReady({ position: { divisionIndex: 6, points: 0 }, demotionReady: false })).toBe(false);
    expect(standingDemotionReady({ position: { divisionIndex: 6, points: 0 }, demotionReady: true })).toBe(true);
    expect(standingDemotionReady({ position: { divisionIndex: 6, points: 0, demotionReady: true } })).toBe(true);
    expect(standingDemotionReady({ position: { divisionIndex: 6, points: 0 } })).toBe(false); // no flag → no gate
    expect(standingDemotionReady({ position: { divisionIndex: 0, points: 0 } })).toBe(false); // Bronze I has no gate
    expect(standingDemotionReady(null)).toBe(false);
  });
  it('Ascendant III never announces a false promotion, and its counter needs no caption', () => {
    const top = fixtureById('ascendant')!.result!;
    expect(outcomeText(top)).toBeNull();
    expect(deltaText(top)).toBe('+40 MMR');
    expect(planRankSequence(top).some((s) => s.kind === 'transition' || s.kind === 'gate')).toBe(false);
  });
  it("the live-region sentence carries placement, delta, the new rank — and SAYS a promotion/demotion (a reader can't see the crest)", () => {
    expect(announcement(3, fixtureById('gain')!.result, 'confirmed')).toBe('Finished 3rd. +16 MMR. Now Gold II, 76 / 100.');
    expect(announcement(1, fixtureById('promo-medal')!.result, 'confirmed')).toBe('Victory. +40 MMR. Now Platinum I, 10 / 100. Promoted to Platinum I.');
    expect(announcement(8, fixtureById('demo-lost-division')!.result, 'confirmed')).toBe('Finished 8th. −40 MMR. Now Gold I, 60 / 100. Demoted to Gold I.');
    expect(announcement(1, fixtureById('gate')!.result, 'confirmed'), 'an outcome line that ends in a period is not doubled').toBe('Victory. +40 MMR. Now Gold II, 100 / 100. Promotion game ready. Finish top 4 to advance.');
    expect(announcement(2, null, 'pending')).toBe('Finished 2nd. Updating rank.');
    expect(announcement(4, null, 'unrated')).toBe('Finished 4th. Unrated.');
  });
});

describe('the planned sequence per fixture', () => {
  const kinds = (id: string): string[] => planRankSequence(fixtureById(id)!.result!).map((s) => s.kind);
  it('a plain gain: reveal → establish → one bar travel → hold', () => {
    expect(kinds('gain')).toEqual(['reveal', 'establish', 'bar', 'outcome']);
    const bar = planRankSequence(fixtureById('gain')!.result!).find((s) => s.kind === 'bar')!;
    expect(bar).toMatchObject({ from: 60, to: 76, divisionIndex: 7, uncapped: false });
  });
  it('a gate unlock fills to 100 then lights the endpoint', () => {
    expect(kinds('gate')).toEqual(['reveal', 'establish', 'bar', 'gate', 'outcome']);
  });
  it('a promotion: old full bar → crest transition up → new bar ticks from zero to the 10-point landing', () => {
    const steps = planRankSequence(fixtureById('promo-won')!.result!);
    expect(steps.map((s) => s.kind)).toEqual(['reveal', 'establish', 'transition', 'bar', 'outcome']);
    expect(steps[2]).toMatchObject({ from: 7, to: 8, direction: 'up', medal: false, ms: 900 }); // the rank-up def's length
    expect(steps[3]).toMatchObject({ divisionIndex: 8, from: 0, to: 10 }); // a small tick: the landing cushion (owner 2026-09-21)
    const medalSteps = planRankSequence(fixtureById('promo-medal')!.result!);
    expect(medalSteps[2]).toMatchObject({ kind: 'transition', from: 8, to: 9, medal: true });
    expect(medalSteps[3]).toMatchObject({ divisionIndex: 9, from: 0, to: 10 });
  });
  it('a clamping loss (the demotion game set up): ONE bar drain to 0, no transition, the demotion-game outcome line (owner 2026-09-21: no instant demotion)', () => {
    const steps = planRankSequence(fixtureById('demotion')!.result!);
    expect(steps.map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'outcome']);
    expect(steps[2]).toMatchObject({ divisionIndex: 7, from: 10, to: 0 });
    expect(steps[3]).toMatchObject({ kind: 'outcome', text: 'Demotion game. Finish top 4 to stay in Gold II.' });
    expect(planRankSequence(fixtureById('demo-gate')!.result!).map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'outcome']);
  });
  it('a lost demotion game inside a medal: the bar holds at 0 → crest/tier transitions down ONE division → the landing bar fills to 100 + the award', () => {
    const steps = planRankSequence(fixtureById('demo-lost-division')!.result!);
    expect(steps.map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'transition', 'bar', 'outcome']);
    expect(steps[2]).toMatchObject({ divisionIndex: 7, from: 0, to: 0 });
    expect(steps[3]).toMatchObject({ from: 7, to: 6, direction: 'down', medal: false, ms: 900 }); // the down-rank def's length
    expect(steps[4]).toMatchObject({ divisionIndex: 6, from: 0, to: 60 });
    expect(steps[5]).toMatchObject({ kind: 'outcome', text: null });
  });
  it('a legacy INSTANT demotion result (settled under the 2026-09-20 rules) still plans drain → transition down → retreat from 100', () => {
    const legacy = { ...fixtureById('demo-lost-division')!.result!, before: { divisionIndex: 7, points: 10 }, after: { divisionIndex: 6, points: 70 }, appliedDelta: -40, cappedPoints: 0, wasDemotionGame: false, requiredFinish: null };
    const steps = planRankSequence(legacy);
    expect(steps.map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'transition', 'bar', 'outcome']);
    expect(steps[2]).toMatchObject({ divisionIndex: 7, from: 10, to: 0 });
    expect(steps[4]).toMatchObject({ divisionIndex: 6, from: 100, to: 70 });
  });
  it('a lost demotion game across a medal boundary: the bar holds at 0 → crest transitions down a medal → the landing bar fills to the landing points', () => {
    const steps = planRankSequence(fixtureById('demo-lost')!.result!);
    expect(steps.map((s) => s.kind)).toEqual(['reveal', 'establish', 'bar', 'transition', 'bar', 'outcome']);
    expect(steps[2]).toMatchObject({ divisionIndex: 6, from: 0, to: 0 });
    expect(steps[3]).toMatchObject({ from: 6, to: 5, direction: 'down', medal: true, ms: 900 }); // the same def for a medal drop
    expect(steps[4]).toMatchObject({ divisionIndex: 5, from: 0, to: 60 });
  });
  it('a failed promotion simply retreats from 100 — no transition, no spectacle', () => {
    expect(kinds('promo-failed')).toEqual(['reveal', 'establish', 'bar', 'outcome']);
  });
  it('every confirmed fixture settles in roughly 2.3–3.4 s', () => {
    // The longest is a demotion: 450 + 250 + 700 + the 900 ms down-rank beat + 700 + 400 = 3400.
    for (const f of RANK_FIXTURES) {
      if (!f.result) continue;
      const ms = sequenceDurationMs(planRankSequence(f.result));
      expect(ms, f.id).toBeGreaterThanOrEqual(2200);
      expect(ms, f.id).toBeLessThanOrEqual(3500);
    }
  });
});
