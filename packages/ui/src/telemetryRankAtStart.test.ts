import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSet } from '@game/content';
import {
  OPPONENT_POOL, RUN_STRENGTH_FORMULA, STRENGTH_BANDS_VERSION, createLobbyRun, currentRegime, deserialize, initialProfile,
  parseRankAtStart, playableHeroes, rankAtStartForTelemetry, rankAtStartOf, registerOpponents, serialize,
  type BoardSnapshot, type PlayerProfile, type RunState,
} from '@game/sim';
import { pinMedalAtStart } from './goldClock';

/**
 * RANK AT GAME START IN TELEMETRY (R-TELEMETRY-RANK-01, owner 2026-10-06): yes to "Start recording each player's rank
 * in game telemetry, so we can measure real newcomers' top-4 rate". Each uploaded RATED game records the player's
 * medal, division and rating before the game (pinned on the run beside `medalAtStart`), next to the matchmaking regime
 * stamp, inside `run_telemetry.derived`.
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
const at = (divisionIndex: number, points = 40): PlayerProfile => {
  const p = initialProfile();
  return { ...p, rank: { ...p.rank, position: { divisionIndex, points } } };
};
const ratedLobby = (): RunState => {
  registerOpponents(realRuns(3));
  return createLobbyRun(309102059, HERO, {}, 'lobby');
};

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('the rank a rated game started at is pinned on the run', () => {
  it('pins medal, division, points, rating and season beside medalAtStart', () => {
    const run = pinMedalAtStart(ratedLobby(), at(1, 40));
    expect(run.medalAtStart).toBe('Bronze');
    expect(run.rankAtStart).toEqual({ v: 1, medal: 'Bronze', divisionIndex: 1, division: 'Bronze II', points: 40, rating: 140, seasonId: initialProfile().rank.seasonId });
    expect(pinMedalAtStart(ratedLobby(), at(7, 10)).rankAtStart).toMatchObject({ medal: 'Gold', division: 'Gold II', rating: 710 });
  });

  it('a brand-new account is pinned Bronze I at 0', () => {
    expect(pinMedalAtStart(ratedLobby(), initialProfile()).rankAtStart).toMatchObject({ medal: 'Bronze', divisionIndex: 0, division: 'Bronze I', rating: 0 });
  });

  it('survives Save & Quit / cloud resume (plain JSON on the run)', () => {
    const run = pinMedalAtStart(ratedLobby(), at(2, 75));
    const resumed = deserialize(serialize(run));
    expect(resumed.rankAtStart).toEqual(run.rankAtStart);
    expect(rankAtStartForTelemetry(resumed)).toEqual(run.rankAtStart);
  });

  it('is never pinned (or stamped) on an unrated table, Practice or a sandbox', () => {
    const unrated = pinMedalAtStart(createLobbyRun(309102059, HERO, {}, 'lobby'), at(0));
    expect(unrated.rankAtStart).toBeUndefined();
    expect(rankAtStartForTelemetry(unrated)).toBeUndefined();
    registerOpponents(realRuns(3));
    const practice = pinMedalAtStart(createLobbyRun(1, HERO, {}, 'practice'), at(0));
    expect(practice.rankAtStart).toBeUndefined();
    expect(rankAtStartForTelemetry({ ...practice, rankAtStart: rankAtStartOf(at(0).rank) }), 'even a leaked pin never reaches a practice row').toBeUndefined();
    expect(pinMedalAtStart({ ...ratedLobby(), sandbox: true }, at(0)).rankAtStart).toBeUndefined();
  });

  it('a run resumed from a save that predates the snapshot stamps its pinned medal alone', () => {
    const run = pinMedalAtStart(ratedLobby(), at(1));
    delete run.rankAtStart;
    expect(rankAtStartForTelemetry(run)).toEqual({ v: 1, medal: 'Bronze' });
  });

  it('a stored stamp parses back; an old or malformed one reads as unknown', () => {
    const stamp = rankAtStartOf(at(4, 20).rank);
    expect(parseRankAtStart(JSON.parse(JSON.stringify(stamp)))).toEqual(stamp);
    expect(parseRankAtStart(undefined)).toBeNull();
    expect(parseRankAtStart(null)).toBeNull();
    expect(parseRankAtStart({ medal: 'Tin' })).toBeNull();
    expect(parseRankAtStart({ medal: 'Silver', divisionIndex: 'x' })).toEqual({ v: 1, medal: 'Silver' });
  });
});

describe('the upload stamps it with the regime on every rated row', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'store.ts'), 'utf8');

  it('the regime stamp always carries the band table and the strength formula', () => {
    const r = currentRegime(undefined);
    expect(r.bandsVersion).toBe(STRENGTH_BANDS_VERSION);
    expect(r.strengthFormula).toBe(RUN_STRENGTH_FORMULA);
    expect(r.bandsVersion).toBeTruthy();
    expect(r.strengthFormula).toBeTruthy();
  });

  it('the lobby telemetry upload puts rankAtStart into derived beside regime', () => {
    expect(src).toContain('const rankAtStart = rankAtStartForTelemetry(next);');
    expect(src).toMatch(/const derived = \{[^\n]*regime, \.\.\.\(rankAtStart \? \{ rankAtStart \} : \{\}\) \};/);
    expect(src).toMatch(/const telemetry = \{[^\n]*regime, \.\.\.\(rankAtStart \? \{ rankAtStart \} : \{\}\) \};/);
  });
});
