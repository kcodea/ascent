import { describe, expect, it } from 'vitest';
import {
  CURVE_BANDS, XP_RULES, comebackAfterLosses, isProgressionFacts, levelOfXp, levelProgress, matchXp, parseProgressionProfile,
  parseProgressionResult, practiceRunId, titleName, titlesForLevel, titlesUnlockedBetween, tutorialRunId, xpAtLevelStart, xpForSettlement,
  xpToAdvanceFrom, type CombatOutcome, type ProgressionRunFactsV1,
} from './rules';

/**
 * ACCOUNT PROGRESSION rules (owner decisions 2026-09-27): the curve at every band boundary, multi-level
 * crossings, Ranked XP for placements 1 to 8, Practice at 60% (and the flat 60 with no placement), the tutorial
 * 250, the comeback streak, and the one MVP title.
 */

describe('XP curve', () => {
  it('needs 250 per level for 1 to 11, 400 for 11 to 26, 500 after', () => {
    for (let l = 1; l <= 10; l++) expect(xpToAdvanceFrom(l), `level ${l}`).toBe(250);
    for (let l = 11; l <= 25; l++) expect(xpToAdvanceFrom(l), `level ${l}`).toBe(400);
    for (const l of [26, 27, 50, 100, 250]) expect(xpToAdvanceFrom(l), `level ${l}`).toBe(500);
  });

  it('level starts: L2 at 250, L10 at 2250, L11 at 2500, L25 at 8100, L26 at 8500, L27 at 9000', () => {
    expect(xpAtLevelStart(1)).toBe(0);
    expect(xpAtLevelStart(2)).toBe(250);
    expect(xpAtLevelStart(10)).toBe(2250);
    expect(xpAtLevelStart(11)).toBe(2500);
    expect(xpAtLevelStart(25)).toBe(8100);
    expect(xpAtLevelStart(26)).toBe(8500);
    expect(xpAtLevelStart(27)).toBe(9000);
    expect(xpAtLevelStart(100)).toBe(8500 + 74 * 500);
  });

  it('the 10/11 and 25/26 boundaries sit exactly on the level start', () => {
    expect(levelOfXp(2499)).toBe(10);
    expect(levelOfXp(2500)).toBe(11);
    expect(levelOfXp(2501)).toBe(11);
    expect(levelOfXp(8499)).toBe(25);
    expect(levelOfXp(8500)).toBe(26);
    expect(levelOfXp(8999)).toBe(26);
    expect(levelOfXp(9000)).toBe(27);
    expect(levelOfXp(249)).toBe(1);
    expect(levelOfXp(250)).toBe(2);
  });

  it('levelOfXp inverts xpAtLevelStart for every level 1..150 (the closed form agrees with the step function)', () => {
    for (let l = 1; l <= 150; l++) {
      const start = xpAtLevelStart(l);
      expect(levelOfXp(start), `start of ${l}`).toBe(l);
      expect(xpAtLevelStart(l + 1) - start, `span of ${l}`).toBe(xpToAdvanceFrom(l));
      if (start > 0) expect(levelOfXp(start - 1), `just below ${l}`).toBe(l - 1);
    }
  });

  it('never goes below Level 1 for junk input', () => {
    expect(levelOfXp(-50)).toBe(1);
    expect(levelOfXp(Number.NaN)).toBe(1);
    expect(levelProgress(-1)).toMatchObject({ level: 1, xpIntoLevel: 0, xpForNextLevel: 250, fraction: 0 });
  });

  it('levelProgress gives the bar numbers', () => {
    expect(levelProgress(0)).toEqual({ level: 1, lifetimeXp: 0, levelStartXp: 0, xpIntoLevel: 0, xpForNextLevel: 250, xpToNext: 250, fraction: 0 });
    expect(levelProgress(225)).toMatchObject({ level: 1, xpIntoLevel: 225, xpToNext: 25, fraction: 0.9 });
    expect(levelProgress(2700)).toMatchObject({ level: 11, levelStartXp: 2500, xpIntoLevel: 200, xpForNextLevel: 400, xpToNext: 200, fraction: 0.5 });
    expect(levelProgress(8750)).toMatchObject({ level: 26, xpIntoLevel: 250, xpForNextLevel: 500, fraction: 0.5 });
  });

  it('a single award can cross zero, one or several levels', () => {
    expect(levelOfXp(100 + 100)).toBe(1); // no crossing
    expect(levelOfXp(200 + 100)).toBe(2); // one
    expect(levelOfXp(0 + 1000)).toBe(5); // several
    expect(levelOfXp(2400 + 700)).toBe(12); // across the 10/11 band change
    expect(levelOfXp(8300 + 1500)).toBe(28); // across the 25/26 band change
  });

  it('the bands are contiguous and open-ended at the top', () => {
    for (let i = 1; i < CURVE_BANDS.length; i++) expect(CURVE_BANDS[i]!.fromLevel).toBe((CURVE_BANDS[i - 1]!.toLevel ?? 0) + 1);
    expect(CURVE_BANDS[CURVE_BANDS.length - 1]!.toLevel).toBeNull();
  });
});

describe('Ranked XP', () => {
  const ranked = (placement: number, comeback = false) => xpForSettlement({ mode: 'ranked', placement, comeback });
  it('placements 1 to 8', () => {
    expect(ranked(1)).toEqual({ base: 100, topFour: 60, firstPlace: 90, comeback: 0, total: 250 });
    for (const p of [2, 3, 4]) expect(ranked(p), `${p}`).toEqual({ base: 100, topFour: 60, firstPlace: 0, comeback: 0, total: 160 });
    for (const p of [5, 6, 7, 8]) expect(ranked(p), `${p}`).toEqual({ base: 100, topFour: 0, firstPlace: 0, comeback: 0, total: 100 });
  });
  it('the comeback adds 25 on any placement (1st with comeback = 275 since the 2026-10-03 +50% bonuses)', () => {
    expect(ranked(1, true).total).toBe(275);
    expect(ranked(8, true)).toEqual({ base: 100, topFour: 0, firstPlace: 0, comeback: 25, total: 125 });
  });
  it('no valid placement, or a non-terminal run, earns nothing', () => {
    expect(xpForSettlement({ mode: 'ranked', placement: null, comeback: true }).total).toBe(0);
    expect(xpForSettlement({ mode: 'ranked', placement: 9, comeback: false }).total).toBe(0);
    expect(xpForSettlement({ mode: 'ranked', placement: 1, comeback: false, terminal: false }).total).toBe(0);
  });
});

describe('Practice XP', () => {
  const practice = (placement: number | null, comeback = false) => xpForSettlement({ mode: 'practice', placement, comeback });
  it('is round(0.60 x the equivalent ranked XP): 60 / 96 / 150 / 165', () => {
    expect(practice(8).total).toBe(60);
    expect(practice(4).total).toBe(96);
    expect(practice(1).total).toBe(150);
    expect(practice(1, true).total).toBe(165);
    expect(practice(6, true).total).toBe(75);
  });
  it('the components sum to the total for every placement and comeback', () => {
    for (let p = 1; p <= 8; p++) {
      for (const c of [false, true]) {
        const x = practice(p, c);
        expect(x.base + x.topFour + x.firstPlace + x.comeback, `${p}/${c}`).toBe(x.total);
        const rankedTotal = xpForSettlement({ mode: 'ranked', placement: p, comeback: c }).total;
        expect(x.total, `${p}/${c}`).toBe(Math.round(rankedTotal * 0.6));
      }
    }
  });
  it('no meaningful placement (Unlimited Health) is a flat 60, no bonuses', () => {
    expect(practice(null)).toEqual({ base: 60, topFour: 0, firstPlace: 0, comeback: 0, total: 60 });
    expect(practice(null, true).total).toBe(60);
  });
  it('an aborted practice earns 0', () => {
    expect(xpForSettlement({ mode: 'practice', placement: 1, comeback: false, terminal: false }).total).toBe(0);
  });
});

describe('Tutorial XP', () => {
  it('is 250 once', () => {
    expect(xpForSettlement({ mode: 'tutorial', placement: null, comeback: false })).toEqual({ base: 250, topFour: 0, firstPlace: 0, comeback: 0, total: 250 });
    expect(tutorialRunId()).toBe('learn-ascent:v1');
    expect(practiceRunId(42)).toBe('practice:42');
  });
});

describe('comeback streak', () => {
  const r = (s: string): CombatOutcome[] => [...s].map((c) => (c === 'W' ? 'win' : c === 'L' ? 'loss' : 'draw'));
  it('a win after 4+ consecutive losses', () => {
    expect(comebackAfterLosses(r('LLLLW'))).toBe(true);
    expect(comebackAfterLosses(r('WLLLLLLW'))).toBe(true);
    expect(comebackAfterLosses(r('LLLW'))).toBe(false);
    expect(comebackAfterLosses(r('LLLL'))).toBe(false); // no win after
  });
  it('a draw neither adds to nor clears the streak', () => {
    expect(comebackAfterLosses(r('LLDLLW'))).toBe(true);
    expect(comebackAfterLosses(r('LLDLW'))).toBe(false); // only 3 losses
    expect(comebackAfterLosses(r('DDDDW'))).toBe(false);
  });
  it('a win below the threshold clears the streak', () => {
    expect(comebackAfterLosses(r('LLWLLW'))).toBe(false);
    expect(comebackAfterLosses(r('LLLWLLLLW'))).toBe(true);
  });
  it('is once per run: matchXp adds one 25 however many comebacks happened', () => {
    const facts = { mode: 'ranked' as const, placement: 3, terminal: true, comebackAfterFourLosses: comebackAfterLosses(r('LLLLWLLLLW')) };
    expect(matchXp(facts).comeback).toBe(XP_RULES.comeback);
  });
});

describe('titles', () => {
  it('Alpha Tester unlocks at Level 2 for everyone', () => {
    expect(titleName('alpha_tester')).toBe('Alpha Tester');
    expect(titlesForLevel(1)).toEqual([]);
    expect(titlesForLevel(2)).toEqual(['alpha_tester']);
    expect(titlesForLevel(40)).toEqual(['alpha_tester']);
    expect(titlesUnlockedBetween(1, 2)).toEqual(['alpha_tester']);
    expect(titlesUnlockedBetween(1, 7)).toEqual(['alpha_tester']);
    expect(titlesUnlockedBetween(2, 3)).toEqual([]);
    expect(titlesUnlockedBetween(1, 1)).toEqual([]);
    expect(titleName('mystery')).toBeNull();
  });
});

describe('facts + payload parsing', () => {
  const facts: ProgressionRunFactsV1 = {
    version: 1, runId: 'r1', mode: 'ranked', setId: 'set2', patch: '1.0+abc', heroId: 'indy', placement: 3, waveReached: 14,
    terminal: true, comebackAfterFourLosses: false, combats: { wins: 7, losses: 6, draws: 1 },
  };
  it('accepts a well-formed fact document and refuses junk', () => {
    expect(isProgressionFacts(facts)).toBe(true);
    expect(isProgressionFacts({ ...facts, placement: null })).toBe(true);
    expect(isProgressionFacts({ ...facts, version: 2 })).toBe(false);
    expect(isProgressionFacts({ ...facts, placement: 0 })).toBe(false);
    expect(isProgressionFacts({ ...facts, mode: 'sandbox' })).toBe(false);
    expect(isProgressionFacts({ ...facts, combats: { wins: -1, losses: 0, draws: 0 } })).toBe(false);
    expect(isProgressionFacts(null)).toBe(false);
  });
  it('parses the server payload, and refuses anything that is not one', () => {
    const raw = {
      runId: 'r1', mode: 'ranked', rulesVersion: 1, placement: 1, comeback: true,
      xp: { base: 100, topFour: 40, firstPlace: 60, comeback: 25, total: 225 },
      before: { lifetimeXp: 100, level: 1 }, after: { lifetimeXp: 325, level: 2 },
      unlockedTitles: ['alpha_tester'], revisionAfter: 3, settledAt: '2026-09-27T12:00:00Z',
    };
    expect(parseProgressionResult(raw)).toMatchObject({ runId: 'r1', placement: 1, comeback: true, unlockedTitles: ['alpha_tester'] });
    expect(parseProgressionResult({ ...raw, xp: null })).toBeNull();
    expect(parseProgressionResult({ ...raw, mode: 'lobby' })).toBeNull();
    expect(parseProgressionProfile({ accountXp: '325', accountLevel: 2, revision: 3, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'] }))
      .toEqual({ accountXp: 325, accountLevel: 2, revision: 3, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'] });
    expect(parseProgressionProfile({ accountXp: 1 })).toBeNull();
  });
});
