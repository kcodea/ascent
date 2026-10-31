// @vitest-environment jsdom
/**
 * OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01), verbatim: "in ranked solos, are the player's hero
 * options chosen before the opponents? ... we want full unique heroes, and i want the players in ranked modes to get
 * their options technically after the opponents are chosen, so it forces more variety in hero selection".
 *
 * On the real store: the ranked Play picks the table first and stores it on the entry; the offer (and its re-roll)
 * holds no seated hero; the hero pick sits the player at exactly that table; an entry made before this rule (no table)
 * keeps the old order; a pool still loading at Play is waited for (and a cancelled wait commits nothing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { resetLobbyDrivers } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

/** A pool loader the test drives: `ready` or still `loading` until `finish()`. */
const loaderCtl = vi.hoisted(() => {
  let status: 'ready' | 'loading' = 'ready';
  let release: (() => void) | null = null;
  const loader = {
    state: () => ({ status }),
    subscribe: () => () => {},
    ensure: () => new Promise((resolve) => { release = () => { status = 'ready'; resolve({ status }); }; }),
    matchBand: async () => ({ status }),
    bandStale: () => false,
    foreignRuns: () => new Set<string>(),
  };
  return {
    loader,
    set: (s: 'ready' | 'loading') => { status = s; },
    finish: () => release?.(),
    on: { value: false },
  };
});

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return { ...mod, remoteEnabled: () => true, refreshOpponentPoolAndRecords: vi.fn(), opponentPoolLoader: () => (loaderCtl.on.value ? loaderCtl.loader : null) };
});
vi.mock('./rankSubmission', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./rankSubmission')>();
  return {
    ...mod,
    enqueuePendingRank: vi.fn((req: unknown) => ({ ...(req as object), userId: 'me', at: 'now', attempts: 0 })),
    flushPendingRanks: vi.fn(async () => {}),
    installRankRetryTriggers: vi.fn(),
  };
});

import { heroRerollPoolOf, useGame } from '../store';
import { loadRankedEntry, saveRankedEntry } from './rankedEntry';
import { rankedEntryPoolGate } from '../opponentPool/lobbyPoolGate';

beforeEach(() => {
  localStorage.clear();
  loaderCtl.on.value = false;
  loaderCtl.set('ready');
  useGame.setState({ showTitle: true, titleView: 'modes', heroChoices: null, heroReroll: null, pendingMode: 'lobby', pendingSeed: undefined, rankedEntry: null, savedRun: null, replaying: false, playerName: 'Mike' });
});
afterEach(() => { const r = useGame.getState().run; if (r.lobby) resetLobbyDrivers(r.lobby.seats); });

const tableHeroes = (): Set<string> => new Set(useGame.getState().rankedEntry!.table!.seats.slice(1).map((x) => x.heroId));

describe('ranked: the opponents are chosen before the hero offer', () => {
  it('Play picks the table first; the offer and the re-roll pool hold none of its heroes; the table is persisted with the entry', () => {
    act(() => { void useGame.getState().startLobby(); });
    const s = useGame.getState();
    const entry = s.rankedEntry!;
    expect(entry.table).toBeDefined();
    expect(entry.table!.opponentsFirst).toBe(true);
    expect(entry.table!.seed).toBe(entry.seed);
    expect(entry.table!.seats).toHaveLength(8);
    const held = tableHeroes();
    expect(held.size).toBe(7);
    expect(s.heroChoices).toHaveLength(3);
    for (const h of s.heroChoices!) expect(held.has(h), h).toBe(false);
    for (const h of heroRerollPoolOf(s)) expect(held.has(h), h).toBe(false);
    expect(loadRankedEntry(() => true)!.table!.seats.map((x) => x.heroId)).toEqual(entry.table!.seats.map((x) => x.heroId));
  });

  it('the hero pick sits the player at exactly that table: every seat as dealt, eight unique heroes, flagged', () => {
    act(() => { void useGame.getState().startLobby(); });
    const entry = useGame.getState().rankedEntry!;
    const pick = useGame.getState().heroChoices![2]!;
    act(() => useGame.getState().pickHero(pick));
    const lobby = useGame.getState().run.lobby!;
    expect(useGame.getState().run.runId).toBe(entry.runId);
    expect(lobby.opponentsFirst).toBe(true);
    expect(lobby.seats[0]!.heroId).toBe(pick);
    expect(lobby.seats.slice(1).map((x) => [x.kind, x.runKey ?? '', x.heroId, x.seed])).toEqual(entry.table!.seats.slice(1).map((x) => [x.kind, x.runKey ?? '', x.heroId, x.seed]));
    expect(new Set(lobby.seats.map((x) => x.heroId)).size).toBe(8);
  });

  it('a resumed entry keeps its table and heroes (closing the game is no free re-deal)', () => {
    act(() => { void useGame.getState().startLobby(); });
    const entry = useGame.getState().rankedEntry!;
    act(() => useGame.setState({ heroChoices: null, showTitle: true }));
    act(() => { void useGame.getState().startLobby(); });
    expect(useGame.getState().rankedEntry).toBe(entry);
    expect(useGame.getState().heroChoices).toEqual(entry.heroChoices);
  });

  it('an entry made before this rule (no table) keeps the old order: the table is picked at the hero pick', () => {
    const old = { runId: 'r-old', seed: 4242, heroChoices: ['warden', 'indy', 'keshi'], at: '2026-10-30T00:00:00Z' };
    saveRankedEntry(old);
    useGame.setState({ rankedEntry: loadRankedEntry(() => true) });
    act(() => { void useGame.getState().startLobby(); });
    expect(useGame.getState().heroChoices).toEqual(old.heroChoices);
    act(() => useGame.getState().pickHero('indy'));
    const lobby = useGame.getState().run.lobby!;
    expect(lobby.opponentsFirst).toBeUndefined();
    expect(lobby.seats[0]!.heroId).toBe('indy');
    expect(new Set(lobby.seats.map((x) => x.heroId)).size).toBe(8);
  });

  it('a pool still loading at Play is waited for: no entry until it lands, then the table and the offer', async () => {
    loaderCtl.on.value = true;
    loaderCtl.set('loading');
    let done!: Promise<boolean>;
    act(() => { done = useGame.getState().startLobby(); });
    expect(useGame.getState().rankedEntry).toBeNull();
    expect(useGame.getState().heroChoices).toBeNull();
    expect(rankedEntryPoolGate.phase()).toBe('waiting');
    await act(async () => { loaderCtl.finish(); await done; });
    expect(await done).toBe(true);
    expect(useGame.getState().rankedEntry?.table).toBeDefined();
    expect(useGame.getState().heroChoices).toHaveLength(3);
  });

  it('a cancelled wait commits nothing and owes nothing', async () => {
    loaderCtl.on.value = true;
    loaderCtl.set('loading');
    let done!: Promise<boolean>;
    act(() => { done = useGame.getState().startLobby(); });
    await act(async () => { rankedEntryPoolGate.cancel(); await done; });
    expect(await done).toBe(false);
    expect(useGame.getState().rankedEntry).toBeNull();
    expect(loadRankedEntry(() => true)).toBeNull();
    expect(useGame.getState().heroChoices).toBeNull();
  });
});
