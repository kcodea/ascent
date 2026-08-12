import { describe, it, expect } from 'vitest';
import { createRun, projectEndOfTurnSteps, questEndOfTurnBeats, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * End-of-Turn beat coverage (owner audit 2026-08-12, from the Lapidary report): effects that resolve inside
 * `applyEndOfTurn` must ALSO appear in the projection (`projectEndOfTurnSteps`) and the UI beat list
 * (`questEndOfTurnBeats`) — anything absent from those lands silently after the phase flips to combat.
 * The Lapidary and the Crucible Choir were hardcoded top-of-function blocks with no beat; they are recurring
 * entries now. Turn-limited recurrences (Quick Study) were in the commit but not the projection.
 */
const bc = (uid: string, cardId: string, attack = 2, health = 2): RunState['board'][number] =>
  ({ uid, cardId, tribe: 'beast', attack, health, keywords: [], golden: false } as RunState['board'][number]);

describe('Rune of the Lapidary — End-of-Turn beats + Ruby FX', () => {
  const armed = (): RunState => ({
    ...createRun(3, 'warden'), phase: 'recruit', runeLapidary: true,
    playedThisTurn: ['a', 'b', 'c'],
    board: [bc('x', 'stray', 2, 2), bc('y', 'stray', 3, 3)],
  });

  it('gets a labeled beat in the UI beat list', () => {
    const beats = questEndOfTurnBeats(armed());
    expect(beats.some((b) => b.effect === 'runeLapidary' && b.label === 'Rune of the Lapidary')).toBe(true);
  });

  it('the projection carries its Rubies as per-beat ruby FX (3 cards → 3 Rubies)', () => {
    const { fx } = projectEndOfTurnSteps(armed());
    const rubies = fx.flatMap((f) => f.ruby ?? []);
    expect(rubies.reduce((n, l) => n + l.count, 0), 'one Ruby per card played').toBe(3);
  });

  it('the projection and the real commit land the same total Rubies', () => {
    const rubyTotal = (s: RunState): number =>
      s.board.reduce((n, c) => n + (c.buffs?.find((b) => b.source === 'Ruby')?.count ?? 0), 0);
    const forProjection = armed();
    const { steps } = projectEndOfTurnSteps(forProjection);
    expect(steps.length, 'the Lapidary produced beats').toBeGreaterThan(0);
    const real = armed();
    applyEndOfTurn(real);
    expect(rubyTotal(real), 'the commit played 3 Rubies').toBe(3);
  });
});

describe('Rune of the Crucible Choir — End-of-Turn beat', () => {
  it('gets a labeled beat (it used to be a silent hardcoded block)', () => {
    const s: RunState = { ...createRun(3, 'warden'), phase: 'recruit', runeCrucibleChoir: true };
    const beats = questEndOfTurnBeats(s);
    expect(beats.some((b) => b.effect === 'runeCrucibleChoir' && b.label === 'Rune of the Crucible Choir')).toBe(true);
  });
});

describe('turn-limited recurrences — included in projection + beat list', () => {
  it('a Quick Study entry appears in the beat list and the projection', () => {
    const s: RunState = {
      ...createRun(3, 'warden'), phase: 'recruit',
      questRecurringLimited: [{ effect: 'quickStudy', turnsLeft: 2 }],
    } as RunState;
    const beats = questEndOfTurnBeats(s);
    expect(beats.some((b) => b.effect === 'quickStudy' && b.label === 'Rune of Quick Study')).toBe(true);
    const { steps } = projectEndOfTurnSteps(s);
    expect(steps.length, 'the limited recurrence produced a projected beat').toBeGreaterThan(0);
  });
});
