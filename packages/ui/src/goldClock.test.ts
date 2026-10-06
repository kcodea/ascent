import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSet } from '@game/content';
import {
  OPPONENT_POOL, createLobbyRun, deserialize, initialProfile, playableHeroes, registerOpponents, serialize,
  type BoardSnapshot, type PlayerProfile, type RunState,
} from '@game/sim';
import {
  BRONZE_CLOCK_GOLD, BRONZE_CLOCK_LATE_SECONDS, BRONZE_CLOCK_LATE_WAVE, BRONZE_CLOCK_SECONDS, GAUNTLET_GOLD_CLOCK,
  GOLD_CLOCK_WAITING, goldClockOf, goldClockReading, goldClockState, goldTurnClock, isBronzeClockRun, pinMedalAtStart,
  type GoldClockRun,
} from './goldClock';
import { turnClockReset } from './turnClock';

/**
 * THE BRONZE RANKED SHOP CLOCK (R-TIMER-BRONZE-01, owner 2026-10-06): "the system we implemented for the gold spend
 * timer in gauntlet. i want to make that the experience for all players who are bronze ranked. once you become silver,
 * it should transfer over to the standard timer experience" + "lets do 20 gold." + "can we up it to a 90 second timer
 * on turns 9+?". A rated lobby started in Bronze: no clock until 20 Gold is spent in the turn, then 60 seconds (90 from
 * turn 9). Everything else keeps its clock; the Gauntlet's 30 / 60 is unchanged.
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

/** A profile at a ladder division (0 = Bronze I, 3 = Silver I). */
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

describe('the shared gold-clock predicate', () => {
  const rated = { lobby: undefined, wave: 1 } as const;
  const bronze: GoldClockRun = { ...rated, mode: 'lobby', medalAtStart: 'Bronze' };

  it('a Bronze rated lobby: 20 Gold, then 60 seconds on turns 1-8', () => {
    expect(BRONZE_CLOCK_GOLD).toBe(20);
    expect(goldClockOf(bronze)).toEqual({ gold: 20, seconds: 60 });
    expect(goldClockOf({ ...bronze, wave: 8 })).toEqual({ gold: 20, seconds: BRONZE_CLOCK_SECONDS });
  });

  it('…and 90 seconds from turn 9 (owner 2026-10-06: "can we up it to a 90 second timer on turns 9+?")', () => {
    expect(BRONZE_CLOCK_LATE_WAVE).toBe(9);
    expect(goldClockOf({ ...bronze, wave: 9 })).toEqual({ gold: 20, seconds: BRONZE_CLOCK_LATE_SECONDS });
    expect(BRONZE_CLOCK_LATE_SECONDS).toBe(90);
    expect(goldClockOf({ ...bronze, wave: 15 })?.seconds).toBe(90);
  });

  it('Silver and above get the standard clock', () => {
    for (const medal of ['Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'] as const) {
      expect(goldClockOf({ ...bronze, medalAtStart: medal }), medal).toBeNull();
    }
  });

  it('an unpinned lobby (unrated, or saved before the pin) gets the standard clock', () => {
    expect(goldClockOf({ ...rated, mode: 'lobby' })).toBeNull();
  });

  it('an UNRATED (all-generated) lobby gets the standard clock even with a Bronze pin', () => {
    const unrated = createLobbyRun(309102059, HERO, {}, 'lobby'); // no pool: every seat generated
    expect(unrated.lobby!.unrated).toBe('all-generated');
    expect(isBronzeClockRun({ ...unrated, medalAtStart: 'Bronze' })).toBe(false);
    expect(goldClockOf({ ...unrated, medalAtStart: 'Bronze' })).toBeNull();
  });

  it('Practice, the tutorial, a sandbox and the other modes keep their clocks', () => {
    expect(goldClockOf({ ...bronze, mode: 'practice' })).toBeNull();
    expect(goldClockOf({ ...bronze, mode: 'tutorial' })).toBeNull();
    expect(goldClockOf({ ...bronze, mode: 'ascent' })).toBeNull();
    expect(goldClockOf({ ...bronze, sandbox: true })).toBeNull();
  });

  it('the Gauntlet is unchanged: 30 Gold, then 60 seconds on every round', () => {
    expect(goldClockOf({ ...rated, mode: 'gauntlet' })).toEqual({ gold: 30, seconds: 60 });
    expect(goldClockOf({ ...rated, mode: 'gauntlet', wave: 9 })).toEqual(GAUNTLET_GOLD_CLOCK);
  });
});

describe('the Bronze clock in a turn', () => {
  const clock = { gold: BRONZE_CLOCK_GOLD, seconds: BRONZE_CLOCK_SECONDS };
  const late = { gold: BRONZE_CLOCK_GOLD, seconds: BRONZE_CLOCK_LATE_SECONDS };

  it('waits below 20 Gold and runs from 20', () => {
    expect(goldClockState(clock, 0)).toBe('waiting');
    expect(goldClockState(clock, 19)).toBe('waiting');
    expect(goldClockState(clock, 20)).toBe('running');
    expect(goldClockState(clock, 33)).toBe('running');
  });

  it('the parked clock moves to the countdown the moment 20 Gold is spent (60 on turn 8, 90 on turn 9)', () => {
    expect(goldTurnClock({ clock, goldSpent: 19, current: GOLD_CLOCK_WAITING })).toBeNull();
    expect(goldTurnClock({ clock, goldSpent: 20, current: GOLD_CLOCK_WAITING })).toBe(60);
    expect(goldTurnClock({ clock: late, goldSpent: 20, current: GOLD_CLOCK_WAITING })).toBe(90);
  });

  it('never restarts a running countdown', () => {
    expect(goldTurnClock({ clock, goldSpent: 31, current: 44 })).toBeNull();
    expect(goldTurnClock({ clock, goldSpent: 31, current: 0 }), 'time up stays up').toBeNull();
  });

  it('a Thymepiece window opened while parked anchors to the countdown it will start from', () => {
    expect(goldClockReading(clock, GOLD_CLOCK_WAITING)).toBe(60);
    expect(goldClockReading(late, GOLD_CLOCK_WAITING)).toBe(90);
    expect(goldClockReading(late, 71)).toBe(71);
    expect(goldClockReading(null, GOLD_CLOCK_WAITING), 'the standard clock reads raw').toBe(GOLD_CLOCK_WAITING);
  });

  it('Save & Quit while waiting resumes waiting; mid-countdown resumes its seconds', () => {
    // The resumed reading is applied by the turn reset, then the start check runs on what it left.
    const waiting = turnClockReset({ resume: GOLD_CLOCK_WAITING, resumedWave: null, wave: 4, turnSeconds: GOLD_CLOCK_WAITING })!;
    expect(waiting.set).toBe(GOLD_CLOCK_WAITING);
    expect(goldTurnClock({ clock, goldSpent: 12, current: waiting.set }), 'still under 20: stays parked').toBeNull();
    expect(goldTurnClock({ clock, goldSpent: 20, current: waiting.set }), 'resumed past 20: starts fresh').toBe(60);
    const running = turnClockReset({ resume: 37, resumedWave: null, wave: 4, turnSeconds: GOLD_CLOCK_WAITING })!;
    expect(goldTurnClock({ clock, goldSpent: 25, current: running.set }), 'the restored seconds stand').toBeNull();
  });
});

describe('"is Bronze" is pinned when the game starts', () => {
  it('a rated lobby started in Bronze is stamped Bronze and gets the gold clock', () => {
    const run = pinMedalAtStart(ratedLobby(), at(2));
    expect(run.lobby!.unrated).toBeUndefined();
    expect(run.medalAtStart).toBe('Bronze');
    expect(goldClockOf(run)).toEqual({ gold: 20, seconds: 60 });
  });

  it('a brand-new account starts at Bronze I, so it counts', () => {
    expect(pinMedalAtStart(ratedLobby(), initialProfile()).medalAtStart).toBe('Bronze');
  });

  it('a rated lobby started in Silver is stamped Silver: standard clock', () => {
    const run = pinMedalAtStart(ratedLobby(), at(3));
    expect(run.medalAtStart).toBe('Silver');
    expect(goldClockOf(run)).toBeNull();
  });

  it('a rank change after the start never changes the clock; the pin survives Save & Quit / cloud resume', () => {
    const run = pinMedalAtStart(ratedLobby(), at(2));
    // Promoted to Silver elsewhere mid-game: the run reads only its pin.
    const resumed = deserialize(serialize(run));
    expect(resumed.medalAtStart).toBe('Bronze');
    expect(goldClockOf(resumed)).toEqual({ gold: 20, seconds: 60 });
  });

  it('never stamps an unrated lobby, Practice, a Gauntlet or a sandbox', () => {
    const unrated = pinMedalAtStart(createLobbyRun(309102059, HERO, {}, 'lobby'), at(0));
    expect(unrated.medalAtStart).toBeUndefined();
    registerOpponents(realRuns(3));
    expect(pinMedalAtStart(createLobbyRun(1, HERO, {}, 'practice'), at(0)).medalAtStart).toBeUndefined();
    expect(pinMedalAtStart({ ...ratedLobby(), sandbox: true }, at(0)).medalAtStart).toBeUndefined();
    expect(pinMedalAtStart({ mode: 'gauntlet', lobby: undefined } as Pick<RunState, 'mode' | 'sandbox' | 'lobby' | 'medalAtStart'>, at(0)).medalAtStart).toBeUndefined();
  });

  it('the store pins it where a rated lobby is minted (pickHero and newRun)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'store.ts'), 'utf8');
    expect(src.match(/pinMedalAtStart\(run, s\.profile\)/g)).toHaveLength(2);
    const mint = src.indexOf('run.runId = mintRunId();');
    expect(src.indexOf('pinMedalAtStart(run, s.profile)', mint) - mint).toBeLessThan(300);
  });
});
