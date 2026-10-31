// @vitest-environment jsdom
/**
 * A LIVE GAME AT A GLANCE (owner 2026-10-29: "give live games the same granularity that friends show"; R-LIVE-STATUS-01).
 *  - the row's status is the Friends shape, read with the friends' own formatters: a lobby game's sent status (the step
 *    and whom it fights, place, Health + Armor, tier), else what the row itself says (Versus, Ranked Duos, older rows);
 *  - the player's listing (up the game's Cloudflare socket) carries that status;
 *  - the Live Games page draws it with `FriendGame` (no title= tooltips).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createLobbyRun, type RunState } from '@game/sim';
import type { LiveGameRow } from './liveRemote';
import { fakeLiveObject } from './liveFakeObject';
import { stepText, gameStatusChips, type FriendGameStatus } from '../friends/gameStatus';

vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const listed: { rows: LiveGameRow[] } = { rows: [] };
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('./liveRemote', async (orig) => {
  const real = await orig<typeof import('./liveRemote')>();
  return { ...real, liveRemote: { ...real.liveRemote, list: async () => listed.rows } };
});

const { liveGameStatusOf } = await import('./liveTargets');
const cfMod = await import('./liveCf');
const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('./livePublisher');
const { LiveGames } = await import('./LiveGames');

const row = (id: string, p: Partial<LiveGameRow> = {}): LiveGameRow => ({
  game_id: id, display_name: 'Ann', hero_id: 'warden', cosmetics: null, division_index: 9, rank_points: 50, rating: 1600,
  round: 6, phase: 'combat', placement: null, spectators: 2, started_at: '', ...p,
});
const sent = (p: Partial<FriendGameStatus> = {}): FriendGameStatus => ({
  v: 1, mode: 'practice', hero: 'warden', round: 6, phase: 'combat', health: 21, armor: 4, tier: 4, place: { rank: 2, left: 5 }, vs: null,
  step: 'fight', foe: 'Cat', ...p,
});

describe('the row at a glance (R-LIVE-STATUS-01)', () => {
  it('a lobby game reads its sent status with the friends formatters: step, foe, place, vitals, tier', () => {
    const s = liveGameStatusOf(row('run-1', { mode: 'practice', status: sent() }));
    expect(stepText(s)).toBe('Round 6 · Fighting Cat');
    expect(gameStatusChips(s)).toEqual(['2nd of 5 left', '21 Health + 4 Armor', 'Tier 4']);
  });

  it('a status from another round or phase keeps only its vitals and tier (never a stale foe)', () => {
    const s = liveGameStatusOf(row('run-1', { round: 7, phase: 'shop', status: sent() }));
    expect(stepText(s)).toBe('Round 7 · Shopping');
    expect(s.foe).toBeUndefined();
    expect(gameStatusChips(s)).toEqual(['2nd of 5 left', '21 Health + 4 Armor', 'Tier 4']);
  });

  it('a row with no status (Versus, Ranked Duos, an older client): what the row says, in the same words', () => {
    const v = liveGameStatusOf(row('versus:r1', { mode: 'duel', phase: 'combat', round: 3, players: 'Ann vs Bob' }));
    expect(stepText(v)).toBe('Round 3 · Fighting');
    expect(v.vs).toBe('Ann vs Bob');
    expect(v.mode).toBe('versus_1v1');
    expect(gameStatusChips(v)).toEqual([]);
    expect(stepText(liveGameStatusOf(row('run-2', { phase: 'shop', round: 2 })))).toBe('Round 2 · Shopping');
    expect(stepText(liveGameStatusOf(row('run-2', { phase: 'hero' })))).toBe('Picking a hero');
    expect(stepText(liveGameStatusOf(row('run-2', { phase: 'end', placement: 3 })))).toBe('Finished 3rd');
    expect(stepText(liveGameStatusOf(row('run-2', { phase: 'end', placement: 1 })))).toBe('Won the game');
    expect(liveGameStatusOf(row('duos:r1', { status: 'junk' })).mode).toBe('ranked_duos'); // junk is ignored
  });
});

describe('the listing carries it', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
  });
  afterEach(() => { vi.useRealTimers(); identity.setIdentity(null); cfMod.setCfLiveSocketForTests(null); pubMod.setLivePublishUrlForTests(null); });

  it('the listing up the game socket carries my lobby game status (the friends builder), riding the beats that go anyway', async () => {
    const obj = fakeLiveObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const off = pubMod.installLivePublisher();
    const base = createLobbyRun(77, 'warden');
    const run = { ...base, mode: 'practice', lobby: { ...base.lobby!, unrated: undefined } } as RunState;
    useGame.setState({ run, replaying: false, showTitle: false, playerName: 'Ann' });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(obj.ops('listing')).toHaveLength(1);
    const st = (obj.ops('listing')[0]!.args as { status: FriendGameStatus }).status;
    expect(st).toMatchObject({ v: 1, mode: 'practice', round: run.wave, phase: 'shop', health: run.resolve, tier: run.tier });
    expect(st.place).toEqual({ rank: expect.any(Number), left: run.lobby!.seats.filter((s) => s.alive).length });
    off();
  });
});

describe('the Live Games page (R-LIVE-STATUS-01)', () => {
  it('draws each row with the friends game line: mode, step, place, vitals, tier, the teammate; no title= tooltips', async () => {
    listed.rows = [
      row('run-1', { mode: 'practice', status: sent() }),
      row('duos:r1', { mode: 'ranked_duos', display_name: 'Ann & Bob', phase: 'shop', round: 4, status: sent({ mode: 'ranked_duos', round: 4, phase: 'shop', step: undefined, foe: undefined, mate: 'Bob' }) }),
      row('versus:r2', { mode: 'duel', players: 'Cat vs Dan', round: 3 }),
    ];
    useGame.setState({ showLiveGames: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(LiveGames)); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    const rows = [...host.querySelectorAll('.lv-row')];
    expect(rows).toHaveLength(3);
    const text = (i: number): string => rows[i]!.querySelector('.lv-game')!.textContent ?? '';
    expect(rows[0]!.querySelector('.lv-mode')!.textContent).toBe('Practice');
    expect(text(0)).toContain('Round 6 · Fighting Cat');
    expect(text(0)).toContain('2nd of 5');
    expect(text(0)).toContain('Tier 4');
    expect(rows[0]!.querySelector('.fr-vitals')!.getAttribute('aria-label')).toBe('21 Health and 4 Armor');
    expect(rows[0]!.querySelector('.fr-gamehero')).toBeNull(); // the row's own portrait, not a second small one
    expect(text(1)).toContain('Round 4 · Shopping');
    expect(text(1)).toContain('Teammate: Bob');
    expect(rows[2]!.querySelector('.lv-mode')!.textContent).toBe('Versus 1v1');
    expect(text(2)).toContain('Round 3 · Fighting');
    expect(host.querySelector('[title]')).toBeNull();
    act(() => root.unmount());
    host.remove();
    useGame.setState({ showLiveGames: false });
  });
});
