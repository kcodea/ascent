/**
 * EVERY GAME IS A LIVE GAME (owner 2026-10-28: "all games should show as live games, and pressing watch from friends list
 * should take the spectator into that game"; R-LIVE-ALL-GAMES-01) and THE FRIEND'S GAME AT A GLANCE (R-FRIENDS-STATUS-01).
 *  - every Live Games row kind says what it is and its Watch goes to the right place: a lobby game (ranked / casual /
 *    Practice) to the watch screen, a Versus match (1v1, Group, Duos) to its room's stands in Versus, a Ranked Duos team
 *    to its party's stands in Duos, each on its own host (`cf:` = the Worker);
 *  - the listing read survives a server without the new columns (one retry, old columns from then on);
 *  - the friend status: its typed shape, the parser (junk dropped), the place among those left, the Versus line, the text.
 */
import { describe, expect, it } from 'vitest';
import { liveModeLabel, liveNameOf, liveWatchTargetOf } from './liveTargets';
import { makeLiveRemote } from './liveRemote';
import { watchAreaOf } from '../friends/friendsGo';
import { decodeRoomRef } from '../versus/versusHost';
import {
  gameStatusChips, gameStatusKey, lobbyGameStatus, lobbyPlace, parseGameStatus, roundPhaseText, versusGameStatus, versusLine,
  type FriendGameStatus,
} from '../friends/gameStatus';


describe('Live Games rows of every kind (R-LIVE-ALL-GAMES-01)', () => {
  const row = (game_id: string, mode: string | null, players: string | null = null) => ({ game_id, mode: mode as never, players, display_name: 'Ann' });

  it('labels: Versus 1v1 / Group / Duos, Ranked Duos, Casual, Practice; a ranked lobby game shows its hero (null)', () => {
    expect(liveModeLabel(row('versus:r1', 'duel'))).toBe('Versus 1v1');
    expect(liveModeLabel(row('versus:cf:r1', 'group'))).toBe('Versus Group');
    expect(liveModeLabel(row('versus:r1', 'duos'))).toBe('Versus Duos');
    expect(liveModeLabel(row('duos:r1', null))).toBe('Ranked Duos'); // a Supabase team row (mode not written by its heartbeat)
    expect(liveModeLabel(row('duos:cf:r1', 'ranked_duos'))).toBe('Ranked Duos');
    expect(liveModeLabel(row('run-1', 'casual'))).toBe('Casual');
    expect(liveModeLabel(row('run-1', 'practice'))).toBe('Practice');
    expect(liveModeLabel(row('run-1', null))).toBeNull();
    expect(liveModeLabel(row('versus:r1', null))).toBe('Versus'); // an older row without a mode
  });

  it('the name line is the players of a Versus match, else the player or team', () => {
    expect(liveNameOf(row('versus:r1', 'duos', 'Ann & Bob vs Cat & Dan'))).toBe('Ann & Bob vs Cat & Dan');
    expect(liveNameOf(row('run-1', null))).toBe('Ann');
  });

  it('Watch goes to the game itself, on its own host and in its own area', () => {
    expect(liveWatchTargetOf('run-7')).toEqual({ kind: 'lobby', gameId: 'run-7' });
    for (const [id, ref, area] of [
      ['versus:r1', 'r1', 'versus'], ['versus:cf:r1', 'cf:r1', 'versus'], ['duos:r1', 'r1', 'duos'], ['duos:cf:r1', 'cf:r1', 'duos'],
    ] as const) {
      expect(liveWatchTargetOf(id), id).toEqual({ kind: 'room', ref, area });
    }
    expect(decodeRoomRef('cf:r1')).toEqual({ roomId: 'r1', host: 'cf' });
    // Friends Watch: the same areas from the presence mode.
    expect(watchAreaOf('ranked_duos')).toBe('duos');
    for (const m of ['versus_1v1', 'versus_group', 'versus_duos', null]) expect(watchAreaOf(m)).toBe('versus');
  });

  it('a server without the new columns: the read retries once with the old ones and keeps them', async () => {
    const asked: string[] = [];
    const q = (cols: string) => {
      asked.push(cols);
      const res = cols.includes('players') ? { data: null, error: { code: '42703', message: 'column lobby_live_games.mode does not exist' } } : { data: [{ game_id: 'run-1' }], error: null };
      const chain: Record<string, unknown> = {};
      for (const k of ['order', 'range', 'eq', 'neq']) chain[k] = () => chain;
      chain.maybeSingle = () => Promise.resolve(res);
      chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
      return chain;
    };
    const client = { from: () => ({ select: q }) } as never;
    const remote = makeLiveRemote(() => client);
    expect(await remote.list(0)).toEqual([{ game_id: 'run-1' }]);
    expect(await remote.list(0)).toEqual([{ game_id: 'run-1' }]);
    // Each newer column set is tried once (live_host, then mode / players), never again.
    expect(asked.filter((c) => c.includes('players'))).toHaveLength(2);
  });

  it('a server with mode / players but not yet live_host (R-LIVE-CF-01) keeps mode / players', async () => {
    const asked: string[] = [];
    const q = (cols: string) => {
      asked.push(cols);
      const res = cols.includes('live_host') ? { data: null, error: { code: '42703', message: 'column lobby_live_games.live_host does not exist' } } : { data: [{ game_id: 'run-1', mode: 'practice' }], error: null };
      const chain: Record<string, unknown> = {};
      for (const k of ['order', 'range', 'eq', 'neq']) chain[k] = () => chain;
      chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
      return chain;
    };
    const remote = makeLiveRemote(() => ({ from: () => ({ select: q }) }) as never);
    expect(await remote.list(0)).toEqual([{ game_id: 'run-1', mode: 'practice' }]);
    expect(await remote.list(0)).toEqual([{ game_id: 'run-1', mode: 'practice' }]);
    expect(asked.filter((c) => c.includes('live_host'))).toHaveLength(1);
    expect(asked.at(-1)).toContain('players');
  });
});

describe('a friend’s game at a glance (R-FRIENDS-STATUS-01)', () => {
  const seats = [
    { id: 's0', resolve: 20, armor: 5, alive: true }, { id: 's1', resolve: 30, armor: 0, alive: true },
    { id: 's2', resolve: 25, armor: 0, alive: true }, { id: 's3', resolve: 10, armor: 0, alive: false },
  ];
  const run = { heroId: 'warden', wave: 6, phase: 'recruit', resolve: 20, armor: 5, tier: 4, lobby: { seats } };

  it('the place among those left: ties share it; out of the game is no place', () => {
    expect(lobbyPlace(seats)).toEqual({ rank: 2, left: 3 });
    expect(lobbyPlace(seats.map((s) => (s.id === 's0' ? { ...s, alive: false } : s)))).toBeNull();
  });

  it('a lobby game and a Versus match build one typed shape; Hero Select carries no vitals', () => {
    expect(lobbyGameStatus('practice', run)).toEqual({ v: 1, mode: 'practice', hero: 'warden', round: 6, phase: 'shop', health: 20, armor: 5, tier: 4, place: { rank: 2, left: 3 }, vs: null });
    expect(lobbyGameStatus('ranked', run, true)).toMatchObject({ phase: 'hero', hero: null, health: null, place: null });
    const vs = versusGameStatus('versus_group', run, { round: 3, phase: 'combat' }, [{ role: 'p1', name: 'Ann' }, { role: 'p3', name: 'Cat' }, { role: 'p2', name: 'Bob' }]);
    expect(vs).toMatchObject({ round: 3, phase: 'combat', health: 20, tier: 4, vs: 'Ann vs Bob vs Cat', place: null });
    expect(versusGameStatus('versus_1v1', run, { round: 0, phase: 'hero_select' }, [])).toMatchObject({ phase: 'hero', health: null, vs: null });
  });

  it('the Versus line per mode', () => {
    const s = [{ role: 'p1', name: 'Ann' }, { role: 'p2', name: 'Bob' }, { role: 'p3', name: 'Cat' }, { role: 'p4', name: 'Dan' }];
    expect(versusLine('versus_duos', s)).toBe('Ann & Bob vs Cat & Dan');
    expect(versusLine('ranked_duos', s.slice(0, 2))).toBe('Ann & Bob');
    expect(versusLine('versus_1v1', s.slice(0, 2))).toBe('Ann vs Bob');
  });

  it('the parser keeps the shape and drops junk; the payload stays far under the 1 KB server cap', () => {
    const st = lobbyGameStatus('ranked', run);
    expect(parseGameStatus(JSON.parse(JSON.stringify(st)))).toEqual(st);
    expect(parseGameStatus({ round: 'x', phase: 'shop' })).toBeNull();
    expect(parseGameStatus(null)).toBeNull();
    expect(parseGameStatus({ round: 2, phase: 'shop', place: { rank: 5, left: 2 }, vs: 'x'.repeat(500), extra: 1 })).toMatchObject({ place: null, vs: 'x'.repeat(120) });
    const big: FriendGameStatus = { ...st, vs: 'Abcdefghijklmnopqrstuvwxyzabcd '.repeat(4).slice(0, 120), hero: 'h'.repeat(60) };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThan(600);
  });

  it('the text: short, plain, no em dash', () => {
    const st = lobbyGameStatus('ranked', run);
    expect(roundPhaseText(st)).toBe('Round 6 · Shopping');
    expect(roundPhaseText({ round: 6, phase: 'combat' })).toBe('Round 6 · Fighting');
    expect(roundPhaseText({ round: 0, phase: 'hero' })).toBe('Hero Select');
    expect(gameStatusChips(st)).toEqual(['2nd of 3 left', '20 Health + 5 Armor', 'Tier 4']);
    expect(gameStatusChips({ ...st, place: { rank: 11, left: 12 }, armor: 0 })).toEqual(['11th of 12 left', '20 Health', 'Tier 4']);
    for (const t of [roundPhaseText(st), ...gameStatusChips(st)]) expect(t).not.toMatch(/—|--/);
  });

  it('the beat key changes on what the row shows, so a change sends one beat (never per tick)', () => {
    const a = lobbyGameStatus('ranked', run);
    expect(gameStatusKey(a)).toBe(gameStatusKey(lobbyGameStatus('ranked', { ...run })));
    expect(gameStatusKey(a)).not.toBe(gameStatusKey(lobbyGameStatus('ranked', { ...run, wave: 7 })));
    expect(gameStatusKey(null)).toBe('');
  });
});
