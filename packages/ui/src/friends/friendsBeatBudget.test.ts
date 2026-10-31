// @vitest-environment jsdom
/**
 * THE PRESENCE BUDGET (owner 2026-10-29, R-FRIENDS-ACTIVITY-01; R-FRIENDS-HUB-LIVE-01): a scripted, typical hour-ish
 * session (menus, a sidebar browse with rapid hops, a 15-round ranked game, a replay, idle on the menu) driven through
 * the real stores with the network faked, counting what goes to the friends hub and every Supabase call. The granular
 * activity must stay cheap: it sends only when the coarse activity changes, debounced, never per frame. Since the hub
 * took presence over, Supabase sees ONE call for the whole session (the inbox read at boot): no 60 s beat, no Realtime.
 *
 * Measured with the 60 s Supabase beat (main at a0ab7bcbc): BASELINE_BEATS below (periodic beats included).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('../live/livePublisher', async (importOriginal) => ({ ...(await importOriginal<typeof import('../live/livePublisher')>()), liveEligible: () => true }));

import { useGame } from '../store';
import { useVersus } from '../versus/versusStore';
import { onPresenceSettled, resetFriendsForTests, setFriendsRemoteForTests, startFriendsPresence } from './friendsStore';
import { setShowActivity } from './friendsPrefs';
import type { FriendsRemote, PresenceReport } from './friendsRemote';

const ME = '00000000-0000-0000-0000-000000000001';
let beats: PresenceReport[] = [];
let supabaseCalls = 0;

beforeEach(() => {
  resetFriendsForTests();
  beats = [];
  supabaseCalls = 0;
  // Every Supabase call of the friends client is counted (any method).
  setFriendsRemoteForTests(new Proxy({}, {
    get: (_t, k) => (k === 'list'
      ? async () => { supabaseCalls++; return { friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: '' }; }
      : async () => { supabaseCalls++; return {}; }),
  }) as unknown as FriendsRemote);
  onPresenceSettled((p) => beats.push(p));
  useGame.setState({ account: { userId: ME, email: 'a@b.c', anonymous: false, discriminator: '1111' }, playerName: 'Me' });
  useVersus.setState({ room: null, match: null });
  useGame.setState({ showTitle: true, practiceSetupOpen: false, replaying: false, heroChoices: null, titleView: 'menu', settingsOpen: false });
});
afterEach(() => { vi.useRealTimers(); resetFriendsForTests(); setShowActivity(true); });

/** The beats a typical session sends, and how long it lasted (ms). */
async function typicalSession(): Promise<{ beats: number; ms: number }> {
  vi.useFakeTimers();
  let ms = 0;
  const wait = async (s: number): Promise<void> => { ms += s * 1000; await act(async () => { await vi.advanceTimersByTimeAsync(s * 1000); }); };
  const go = async (patch: Record<string, unknown>, s: number): Promise<void> => { act(() => { useGame.setState(patch as never); }); await wait(s); };
  const closed = { showCareer: false, showRankings: false, showLeaderboard: false, showRecentGames: false, showLiveGames: false, showCollection: false };
  const stop = startFriendsPresence();
  await wait(60);                                                       // the main menu
  await go({ titleView: 'modes' }, 15);                                 // looks at the modes
  await go({ titleView: 'menu' }, 5);
  await go({ ...closed, showCareer: true }, 60);                        // Career
  await go({ ...closed, showRankings: true }, 0.4);                     // rapid sidebar hops
  await go({ ...closed, showLiveGames: true }, 0.4);
  await go({ ...closed, showRankings: true }, 45);                      // settles on the Leaderboard
  await go({ ...closed, showCollection: true }, 30);
  await go({ ...closed, showRecentGames: true }, 40);
  await go({ ...closed, settingsOpen: true }, 20);
  await go({ settingsOpen: false, showPatchNotes: true }, 20);
  await go({ showPatchNotes: false, showBook: true }, 30);
  await go({ showBook: false }, 10);
  // A ranked game: hero select, then 15 rounds of shop / End Turn / fight.
  await go({ titleView: 'modes' }, 10);
  await go({ showTitle: false, pendingMode: 'lobby', heroChoices: ['warden', 'aster', 'fi'] }, 25);
  const base = useGame.getState().run;
  const seats = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'].map((id, i) => ({ id, label: `P${i}`, heroId: 'warden', kind: 'bot', seed: i, resolve: 30, armor: 5, alive: true }));
  const lobby = { version: 1, seed: 7, round: 1, seats, encounters: [], finished: false, rules: {} };
  for (let w = 1; w <= 15; w++) {
    const run = { ...base, mode: 'lobby', phase: 'recruit', wave: w, heroId: 'warden', runId: 'run-1', resolve: 30 - w, armor: 0, tier: Math.min(6, 1 + (w >> 1)), lobby: { ...lobby, round: w } };
    await go({ heroChoices: null, run }, 50);
    await go({ endTurnAnimating: true }, 3);
    await go({ endTurnAnimating: false, run: { ...run, phase: 'combat' } }, 25);
  }
  const last = useGame.getState().run;
  await go({ run: { ...last, phase: 'gameover', lobby: { ...last.lobby!, seats: last.lobby!.seats.map((s) => (s.id === 's0' ? { ...s, alive: false, placement: 3 } : s)) } } }, 20);
  await go({ showTitle: true, titleView: 'menu' }, 30);                 // back to the menu
  await go({ replaying: true, showTitle: false }, 180);                 // watches a replay
  await go({ replaying: false, showTitle: true }, 300);                 // idles on the menu
  stop();
  return { beats: beats.length, ms };
}

/** Measured on main before this change (a0ab7bcbc), same script: 46 beats in 35 min (80 an hour). */
const BASELINE_BEATS = 46;

describe('the presence budget (R-FRIENDS-ACTIVITY-01, R-FRIENDS-HUB-LIVE-01)', () => {
  it('a typical session sends only its changes to the hub, and Supabase sees one call in 35 minutes', async () => {
    const { beats: n, ms } = await typicalSession();
    const perHour = Math.round((n * 3_600_000) / ms);
    console.log(`[presence budget] ${n} sends in ${Math.round(ms / 60_000)} min = ${perHour} per hour (60 s beat baseline ${BASELINE_BEATS}); Supabase calls ${supabaseCalls}`);
    expect(n).toBeLessThanOrEqual(BASELINE_BEATS);
    expect(supabaseCalls).toBe(1);
    // Where it landed: every screen was reported, the hop through Live Games never was.
    const acts = beats.map((b) => b.activity?.act ?? b.game?.step ?? b.game?.phase ?? b.status);
    expect(acts).toEqual(expect.arrayContaining(['career', 'leaderboard', 'collection', 'recent', 'settings', 'patch_notes', 'compendium', 'replay', 'done']));
    expect(acts).not.toContain('live');
  });

  it('with "Show friends what I am doing" off, a session sends no more than the regular pace', async () => {
    setShowActivity(false);
    const { beats: n } = await typicalSession();
    console.log(`[presence budget] private: ${n} sends`);
    expect(n).toBeLessThan(BASELINE_BEATS);
    expect(beats.every((b) => !b.game && !b.activity && !b.watchId)).toBe(true);
  });
});
