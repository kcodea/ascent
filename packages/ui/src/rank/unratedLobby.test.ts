import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeSet } from '@game/content';
import {
  OPPONENT_POOL, allFightKeysGenerated, botFightKey, createLobbyRun, lobbyIsUnrated, lobbyPoolTelemetryOf, playableHeroes, registerOpponents,
  type BoardSnapshot,
} from '@game/sim';
import { allSeatsGenerated } from '../../../../supabase/functions/_shared/lobbyRating';
import { rankedRunIdForFinish } from './ratedRun';

/**
 * OFFLINE = UNRATED (owner 2026-09-28, verbatim: "offline = unrated"). A ranked lobby with no recorded player run
 * at the table (every opponent seat generated) moves no rank: the client never submits it, and the server
 * refuses to settle one whose seven seat keys are all generated, so an old or tampered client cannot either.
 */
const SET = activeSet().id;
const HERO = playableHeroes()[0]!.id;
const board = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10,
  minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: SET,
} as unknown as BoardSnapshot);
const runs = (n: number): BoardSnapshot[] =>
  playableHeroes().slice(1, 1 + n).flatMap((h, i) => Array.from({ length: 6 }, (_, w) => board(`Real${i}`, h.id, 6100 + i, w + 1)));

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('client: an all-generated lobby is unrated from creation', () => {
  it('no pool: every seat generated, stamped unrated, and no rank request is made', () => {
    const run = { ...createLobbyRun(309102059, HERO, {}, 'lobby'), runId: 'r-1' };
    expect(run.lobby!.unrated).toBe('all-generated');
    expect(lobbyIsUnrated(run.lobby!)).toBe(true);
    expect(lobbyPoolTelemetryOf(run.lobby!).unrated).toBe(true);
    expect(rankedRunIdForFinish(run, 3)).toBeNull();
  });

  it('a lobby saved before the stamp is still read as unrated from its seats', () => {
    const run = createLobbyRun(309102059, HERO, {}, 'lobby');
    const legacy = { ...run.lobby!, unrated: undefined };
    expect(lobbyIsUnrated(legacy)).toBe(true);
  });

  it('a MIXED lobby (some real runs, some generated) is still rated', () => {
    registerOpponents(runs(3));
    const run = { ...createLobbyRun(309102059, HERO, {}, 'lobby'), runId: 'r-2' };
    const t = lobbyPoolTelemetryOf(run.lobby!);
    expect(t.seats.recorded).toBe(3);
    expect(t.seats.hybrid).toBe(4);
    expect(run.lobby!.unrated).toBeUndefined();
    expect(lobbyIsUnrated(run.lobby!)).toBe(false);
    expect(rankedRunIdForFinish(run, 3)).toBe('r-2');
  });

  it('practice never submits a rank, whatever its seats', () => {
    registerOpponents(runs(7));
    const run = createLobbyRun(1, HERO, {}, 'practice');
    expect(rankedRunIdForFinish(run, 1)).toBeNull();
  });
});

describe('server: submit-rating refuses to settle an all-generated set of seat keys', () => {
  const allBots = playableHeroes().slice(1, 8).map((h) => botFightKey('hybrid', h.id));
  const mixed = [...allBots.slice(0, 6), 'Rooks|drakko|12345'];

  it('the shared rule: seven bot keys are unrated, one real key makes it rated, no keys is unknown (settles)', () => {
    expect(allSeatsGenerated(allBots)).toBe(true);
    expect(allSeatsGenerated(mixed)).toBe(false);
    expect(allSeatsGenerated([])).toBe(false);
    expect(allSeatsGenerated(null)).toBe(false);
  });

  it('client and server copies agree', () => {
    for (const keys of [allBots, mixed, [], ['bot:bot:x'], ['a|b|1']]) expect(allFightKeysGenerated(keys)).toBe(allSeatsGenerated(keys));
  });

  it('the Edge Function checks it BEFORE settle_rank, and answers with a permanent refusal (no retry loop for old clients)', () => {
    const src = readFileSync(join(__dirname, '../../../../supabase/functions/submit-rating/index.ts'), 'utf8');
    const check = src.indexOf('if (allSeatsGenerated(seatKeys))');
    const settle = src.indexOf("admin.rpc('settle_rank'");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(settle);
    // A 200 with an `error` string: every client maps that to `rejected`, which leaves the durable rank queue.
    expect(src).toContain("return json(200, { status: 'unrated', error: 'unrated_all_generated' })");
  });
});
