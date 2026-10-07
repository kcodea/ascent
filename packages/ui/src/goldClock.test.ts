import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSet, CARD_INDEX } from '@game/content';
import {
  OPPONENT_POOL, createLobbyRun, createRun, deserialize, initialProfile, playableHeroes, reduce, registerOpponents, serialize,
  type BoardCard, type BoardSnapshot, type PlayerProfile, type RunState,
} from '@game/sim';
import {
  FUSE_GOLD, GAUNTLET_GOLD_CLOCK, GOLD_CLOCK_WAITING, goldClockOf, goldClockReading, goldClockState, goldTurnClock,
  pinMedalAtStart, practiceClockMult, type GoldClockRun,
} from './goldClock';
import { CHARGE_SECONDS, standardTurnSeconds, turnClockReset } from './turnClock';

/**
 * THE GOLD FUSE IN EVERY LOBBY (R-TIMER-FUSE-01, owner 2026-10-07): "every rank will have the gold fuse implemented.
 * it will kick off the timer when 10 gold is spent. this is for all ranks, so we can remove the silver note when
 * promoted. i want to clarify that the round timer should follow the existing round by round time increase, not the
 * 60/90 secnd timer that is part of the current gold fuse timer for bronze." Follow-ups: early rounds "Yes, early
 * rounds untimed"; scope "All lobbies, Gauntlet unchanged".
 */
const SET = activeSet().id;
const HERO = playableHeroes()[0]!.id;
const board = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10,
  minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: SET,
} as unknown as BoardSnapshot);
const realRuns = (n: number): BoardSnapshot[] =>
  playableHeroes().slice(1, 1 + n).flatMap((h, i) => Array.from({ length: 6 }, (_, w) => board(`Real${i}`, h.id, 6100 + i, w + 1)));

/** A profile at a ladder division (0 = Bronze I, 3 = Silver I, 6 = Gold I, …). */
const at = (divisionIndex: number): PlayerProfile => {
  const p = initialProfile();
  return { ...p, rank: { ...p.rank, position: { divisionIndex, points: 40 } } };
};
/** A rated (mixed recorded + generated) lobby run. */
const ratedLobby = (): RunState => {
  registerOpponents(realRuns(3));
  return createLobbyRun(309102059, HERO, {}, 'lobby');
};

afterEach(() => { OPPONENT_POOL.length = 0; });

/** The schedule exactly as Recruit inlined it before the extraction (2026-07-16 .. 2026-10-07). */
const OLD_SCHEDULE = (wave: number, mult: number): number =>
  Math.max(20 + 1, (Math.min(80, 18 + (wave - 1) * 4 + (wave >= 6 ? 6 : 0)) + (wave >= 12 ? 12 : 0)) * mult);

describe('the standard round-by-round schedule (one function, shared by the plain clock and the fuse)', () => {
  it('matches the old inline formula for waves 1-20 at every Practice multiplier 1-4', () => {
    for (let wave = 1; wave <= 20; wave++) {
      for (const mult of [1, 2, 3, 4]) expect(standardTurnSeconds(wave, mult), `w${wave} x${mult}`).toBe(OLD_SCHEDULE(wave, mult));
    }
  });

  it('reads 21, 22, 26, 30, 34, 44, 48, 52, 56, 60, 64, 80, 84, 88, 92 for rounds 1-15, then holds at 92', () => {
    expect(Array.from({ length: 15 }, (_, i) => standardTurnSeconds(i + 1))).toEqual([21, 22, 26, 30, 34, 44, 48, 52, 56, 60, 64, 80, 84, 88, 92]);
    expect(standardTurnSeconds(20)).toBe(92);
    expect(standardTurnSeconds(1), 'never starts inside the charge window').toBe(CHARGE_SECONDS + 1);
  });

  it('Recruit computes its plain clock through it, and no copy of the formula is left inline', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
    expect(src).toContain('standardTurnSeconds(run.wave, practiceClockMult(run, practiceTimer))');
    expect(src).not.toMatch(/Math\.min\(80,/);
    expect(src).not.toMatch(/const TURN_SECONDS/);
  });
});

describe('goldClockOf: every mode and medal', () => {
  const lobby: GoldClockRun = { mode: 'lobby', wave: 1 };

  it('a rated lobby at EVERY medal: 10 Gold, then that round\'s standard seconds', () => {
    for (const [division, medal] of [[0, 'Bronze'], [3, 'Silver'], [6, 'Gold'], [9, 'Platinum'], [12, 'Diamond'], [15, 'Ascendant']] as const) {
      const run = pinMedalAtStart(ratedLobby(), at(division));
      expect(run.medalAtStart, `division ${division}`).toBe(medal);
      expect(goldClockOf({ ...run, wave: 8 }, 3), medal).toEqual({ gold: 10, seconds: 52 });
      OPPONENT_POOL.length = 0;
    }
  });

  it('an UNRATED (all-generated) lobby and an unpinned lobby get the same fuse', () => {
    const unrated = createLobbyRun(309102059, HERO, {}, 'lobby'); // no pool: every seat generated
    expect(unrated.lobby!.unrated).toBe('all-generated');
    expect(goldClockOf(unrated, 1)).toEqual({ gold: FUSE_GOLD, seconds: 21 });
    expect(goldClockOf({ ...lobby, wave: 12 }, 1)).toEqual({ gold: 10, seconds: 80 });
  });

  it('the Practice multiplier is ignored outside Practice', () => {
    expect(goldClockOf({ ...lobby, wave: 8 }, 4)).toEqual({ gold: 10, seconds: 52 });
    expect(goldClockOf({ ...lobby, wave: 8 }, 0), 'the ∞ choice never reaches a lobby').toEqual({ gold: 10, seconds: 52 });
    expect(practiceClockMult({ mode: 'lobby' }, 3)).toBe(1);
  });

  it('Practice: the fuse, times the 1-4x choice (2x doubles it)', () => {
    const practice: GoldClockRun = { mode: 'practice', wave: 8 };
    expect(goldClockOf(practice, 1)).toEqual({ gold: 10, seconds: 52 });
    expect(goldClockOf(practice, 2)).toEqual({ gold: 10, seconds: 104 });
    expect(goldClockOf(practice, 3)?.seconds).toBe(156);
    expect(goldClockOf(practice, 4)?.seconds).toBe(208);
  });

  it('Practice on ∞: no timer at all', () => {
    expect(goldClockOf({ mode: 'practice', wave: 8 }, 0)).toBeNull();
    expect(goldClockOf({ mode: 'practice', wave: 1 }, 0)).toBeNull();
  });

  it('the Gauntlet is unchanged: 30 Gold, then 60 seconds on every round', () => {
    for (const wave of [1, 8, 9, 12]) expect(goldClockOf({ mode: 'gauntlet', wave }, 1)).toEqual(GAUNTLET_GOLD_CLOCK);
    expect(GAUNTLET_GOLD_CLOCK).toEqual({ gold: 30, seconds: 60 });
  });

  it('the tutorial, the sandbox and the legacy modes keep their own clocks', () => {
    expect(goldClockOf({ mode: 'tutorial', wave: 3 }, 1)).toBeNull();
    expect(goldClockOf({ mode: 'lobby', wave: 3, sandbox: true }, 1)).toBeNull();
    expect(goldClockOf({ mode: 'practice', wave: 3, sandbox: true }, 3)).toBeNull();
    expect(goldClockOf({ mode: 'gauntlet', wave: 3, sandbox: true }, 1)).toBeNull();
    expect(goldClockOf({ mode: 'ascent', wave: 3 }, 1)).toBeNull();
    expect(goldClockOf({ mode: 'rift', wave: 3 }, 1)).toBeNull();
    expect(goldClockOf({ wave: 3 }, 1), 'absent mode = ascent').toBeNull();
  });
});

describe('the fuse in a turn', () => {
  const w8 = goldClockOf({ mode: 'lobby', wave: 8 }, 1)!;
  const w12 = goldClockOf({ mode: 'lobby', wave: 12 }, 1)!;

  it('waits below 10 Gold and runs from exactly 10', () => {
    expect(goldClockState(w8, 0)).toBe('waiting');
    expect(goldClockState(w8, 9)).toBe('waiting');
    expect(goldClockState(w8, 10)).toBe('running');
    expect(goldClockState(w8, 23)).toBe('running');
  });

  it('parked → running at exactly 10 Gold, at that round\'s standard seconds (wave 8 → 52, wave 12 → 80)', () => {
    expect(goldTurnClock({ clock: w8, goldSpent: 9, current: GOLD_CLOCK_WAITING })).toBeNull();
    expect(goldTurnClock({ clock: w8, goldSpent: 10, current: GOLD_CLOCK_WAITING })).toBe(52);
    expect(goldTurnClock({ clock: w12, goldSpent: 10, current: GOLD_CLOCK_WAITING })).toBe(80);
  });

  it('Practice 2x lights the doubled countdown', () => {
    const p2 = goldClockOf({ mode: 'practice', wave: 8 }, 2)!;
    expect(goldTurnClock({ clock: p2, goldSpent: 10, current: GOLD_CLOCK_WAITING })).toBe(104);
  });

  it('early rounds usually stay untimed: Gold income alone cannot reach 10 before round 8', () => {
    // 3 Gold on turn 1, +1 a turn: turns 1-7 have 3..9 Gold, so a turn that only spends its income never lights.
    for (let wave = 1; wave <= 7; wave++) expect(goldClockState(goldClockOf({ mode: 'lobby', wave }, 1)!, wave + 2), `w${wave}`).toBe('waiting');
    expect(goldClockState(goldClockOf({ mode: 'lobby', wave: 8 }, 1)!, 10)).toBe('running');
  });

  it('the fuse is there from round 1 and lights in rounds 1-7 too (owner: "the gold fuse will still show and operate during rounds 1-7")', () => {
    // Wave 1: the same fuse, parked at 0/10 (Recruit's plaque draws the bar whenever a fuse is parked), never the
    // plain always-running clock.
    const w1 = goldClockOf({ mode: 'lobby', wave: 1 }, 1)!;
    expect(w1).toEqual({ gold: 10, seconds: 21 });
    expect(goldClockState(w1, 0)).toBe('waiting');
    expect(goldTurnClock({ clock: w1, goldSpent: 0, current: GOLD_CLOCK_WAITING }), 'parked at 0/10').toBeNull();
    // Wave 3 with 10 Gold spent (selling, a hero power, extra Gold): it lights at round 3's normal 26 seconds.
    const w3 = goldClockOf({ mode: 'lobby', wave: 3 }, 1)!;
    expect(goldTurnClock({ clock: w3, goldSpent: 10, current: GOLD_CLOCK_WAITING })).toBe(26);
    for (let wave = 1; wave <= 7; wave++) expect(goldClockOf({ mode: 'lobby', wave }, 1)?.gold, `w${wave}`).toBe(10);
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
    expect(src).toContain('const goldWaiting = goal > 0 && goldClockWaiting(s);'); // no wave condition on the plaque
    expect(src).toContain('goldGoal={goldClockGold}');
  });

  it('never restarts a running countdown', () => {
    expect(goldTurnClock({ clock: w8, goldSpent: 15, current: 44 })).toBeNull();
    expect(goldTurnClock({ clock: w8, goldSpent: 15, current: 0 }), 'time up stays up').toBeNull();
  });

  it('a mid-turn Practice multiplier change re-opens the turn: parked, then relit at the new length', () => {
    // Recruit's reset keys on goldClockSeconds; a re-opened fuse turn parks, then the start effect relights it.
    const p3 = goldClockOf({ mode: 'practice', wave: 8 }, 3)!;
    const reopened = turnClockReset({ resume: null, resumedWave: null, wave: 8, turnSeconds: GOLD_CLOCK_WAITING })!;
    expect(reopened.set).toBe(GOLD_CLOCK_WAITING);
    expect(goldTurnClock({ clock: p3, goldSpent: 12, current: reopened.set })).toBe(156);
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
    expect(src).toContain('}, [run.wave, turnSeconds, goldClockSeconds, heroSelecting, showTitle]);');
  });

  it('Save & Quit while parked resumes parked; mid-countdown resumes its seconds', () => {
    const waiting = turnClockReset({ resume: GOLD_CLOCK_WAITING, resumedWave: null, wave: 8, turnSeconds: GOLD_CLOCK_WAITING })!;
    expect(waiting.set).toBe(GOLD_CLOCK_WAITING);
    expect(goldTurnClock({ clock: w8, goldSpent: 6, current: waiting.set }), 'still under 10: stays parked').toBeNull();
    expect(goldTurnClock({ clock: w8, goldSpent: 10, current: waiting.set }), 'resumed at 10: starts fresh').toBe(52);
    const running = turnClockReset({ resume: 37, resumedWave: null, wave: 8, turnSeconds: GOLD_CLOCK_WAITING })!;
    expect(goldTurnClock({ clock: w8, goldSpent: 14, current: running.set }), 'the restored seconds stand').toBeNull();
  });
});

describe('time-anchored effects still get their full time when the fuse lights', () => {
  it('the retired "+seconds" fields (bonusTurnSeconds / bonusTurnSecondsNextTurn) never come back from a save', () => {
    // No card grants shop-clock seconds today (Thymepiece's +30 s became a clock-window discount, 2026-09-12); a
    // save that still carries the old fields is healed, so nothing can add to or subtract from a fuse's countdown.
    const raw = JSON.parse(serialize(createLobbyRun(1, HERO, {}, 'lobby'))) as Record<string, unknown>;
    const healed = deserialize(JSON.stringify({ ...raw, bonusTurnSeconds: 30, bonusTurnSecondsNextTurn: 30 })) as RunState & Record<string, unknown>;
    expect(healed.bonusTurnSeconds).toBeUndefined();
    expect(healed.bonusTurnSecondsNextTurn).toBeUndefined();
  });

  it('a Thymepiece window opened while the fuse is parked keeps its full 8 seconds once it lights (wave 8 → 52)', () => {
    const w8 = goldClockOf({ mode: 'lobby', wave: 8 }, 1)!;
    expect(goldClockReading(w8, GOLD_CLOCK_WAITING)).toBe(52);
    expect(goldClockReading(goldClockOf({ mode: 'practice', wave: 8 }, 2), GOLD_CLOCK_WAITING), 'Practice 2x').toBe(104);
    expect(goldClockReading(w8, 31), 'a running fuse reads raw').toBe(31);
    const d = CARD_INDEX['dw3_thymes']!;
    const thymes: BoardCard = { uid: 'th', cardId: 'dw3_thymes', tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
    let s = { ...createRun(11), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, hand: [thymes] } as RunState;
    s = reduce(s, { type: 'play', uid: 'th', toIndex: 0 });
    s = reduce(s, { type: 'activateEquipment', clockSeconds: goldClockReading(w8, GOLD_CLOCK_WAITING) });
    expect(s.cardDiscountWindow!.untilClock).toBe(52 - 8);
  });

  it('every surface passes the Practice choice, so they agree on the seconds', () => {
    const read = (f: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8');
    expect(read('Recruit.tsx')).toContain('const goldClock = goldClockOf(run, practiceTimer);');
    expect(read('store.ts')).toContain('goldClockReading(goldClockOf(prev, get().practiceTimer), turnClock.get())');
    expect(read('StatusBar.tsx')).toContain('goldClockSeconds={goldClockOf(run, practiceTimer)?.seconds ?? null}');
  });
});

describe('the Bronze-only clock is gone; the medal pin stays for telemetry', () => {
  it('a game saved under the Bronze rules (pinned Bronze) resumes under the new fuse', () => {
    const run = pinMedalAtStart(ratedLobby(), at(2));
    expect(run.medalAtStart).toBe('Bronze');
    const resumed = deserialize(serialize({ ...run, wave: 9 }));
    expect(resumed.medalAtStart, 'the pin survives for telemetry').toBe('Bronze');
    expect(goldClockOf(resumed, 1)).toEqual({ gold: 10, seconds: 56 }); // not the retired 20 Gold / 90 s
  });

  it('the Bronze config and its helpers are removed from the clock', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'goldClock.ts'), 'utf8');
    expect(src).not.toMatch(/BRONZE_CLOCK|isBronzeClockRun|bronzeClockSeconds/);
    expect(src.slice(src.indexOf('export function goldClockOf'), src.indexOf('export function goldClockState'))).not.toMatch(/medal/i);
  });

  it('the pin is still stamped only on a rated lobby (R-TELEMETRY-RANK-01)', () => {
    expect(pinMedalAtStart(ratedLobby(), initialProfile()).medalAtStart).toBe('Bronze');
    OPPONENT_POOL.length = 0;
    expect(pinMedalAtStart(createLobbyRun(309102059, HERO, {}, 'lobby'), at(0)).medalAtStart, 'unrated').toBeUndefined();
    expect(pinMedalAtStart(createLobbyRun(1, HERO, {}, 'practice'), at(0)).medalAtStart).toBeUndefined();
  });
});
