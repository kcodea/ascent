// @vitest-environment jsdom
/**
 * THE GRANULAR FRIEND ACTIVITY (owner 2026-10-29, R-FRIENDS-ACTIVITY-01): "Can we get more granular player online text
 * in friends list like in main menu, browsing career, browsing leaderboard, watching a replay, and then better in game
 * granularity too".
 *  - derivation: every screen, overlay, room and game step reads from the stores already on this device;
 *  - the presence send (to the friends hub, R-FRIENDS-HUB-LIVE-01): a change waits for the screen to settle (rapid hops
 *    send once, a flip straight back sends nothing);
 *  - privacy: "Show friends what I'm doing" off sends only Online, or In a game with its mode;
 *  - the row: short plain words, two lines, the rest in the hover; no em dash, no title=.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ watching: false }));
vi.mock('../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('../live/livePublisher', async (importOriginal) => ({ ...(await importOriginal<typeof import('../live/livePublisher')>()), liveEligible: () => true }));
vi.mock('../live/liveWatch', async (importOriginal) => ({ ...(await importOriginal<typeof import('../live/liveWatch')>()), isWatchingLive: () => net.watching }));
vi.mock('../live/liveCount', () => ({ useLiveCount: () => 0, useWindowFocused: () => true }));

import { useGame } from '../store';
import { setIdentity } from '../identity';
import { useVersus } from '../versus/versusStore';
import { useLiveWatch } from '../live/liveWatch';
import type { VersusRoom } from '../versus/versusRemote';
import { CHANGE_SETTLE_MS, notePresenceSent, onPresenceSettled, presenceNow, resetFriendsForTests, setFriendsRemoteForTests, startFriendsPresence, useFriends } from './friendsStore';
import { noteReplayAuthor, setShowActivity, useFriendsPrefs } from './friendsPrefs';
import { activityText, parseActivity, parseGameStatus, stepText, type FriendActivity } from './gameStatus';
import { friendDetail, statusText } from './friendBits';
import { FriendsDock } from './dock/FriendsDock';
import { openDock, resetDockForTests } from './dock/dockStore';
import type { Friend, FriendsList, FriendsRemote, PresenceReport } from './friendsRemote';
import { modeText } from './friendsStore';

const ME = '00000000-0000-0000-0000-000000000001';
const FRIEND = '00000000-0000-0000-0000-000000000002';
let beats: PresenceReport[] = [];
let list: FriendsList;
const emptyList = (): FriendsList => ({ friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: new Date().toISOString() });
const CLOSED = { showCareer: false, showRankings: false, showLeaderboard: false, showRecentGames: false, showLiveGames: false, showCollection: false, showBook: false, showPatchNotes: false, settingsOpen: false };
const act$ = (): string | undefined => presenceNow().activity?.act;
let ui: Mounted | null = null;

beforeEach(() => {
  resetFriendsForTests();
  beats = [];
  list = emptyList();
  setFriendsRemoteForTests({ list: async () => list } as unknown as FriendsRemote);
  // What goes to the friends hub (the hub socket listens here; R-FRIENDS-HUB-LIVE-01).
  onPresenceSettled((p) => beats.push(p));
  net.watching = false;
  setShowActivity(true);
  noteReplayAuthor(null);
  useLiveWatch.setState({ game: null });
  setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
  useGame.setState({ account: { userId: ME, email: 'a@b.c', anonymous: false, discriminator: '1111' }, playerName: 'Me' });
  useVersus.setState({ room: null, match: null, knockout: null, lockedRound: null, area: 'versus' });
  useGame.setState({ ...CLOSED, showTitle: true, practiceSetupOpen: false, replaying: false, heroChoices: null, titleView: 'menu', endTurnAnimating: false });
});
afterEach(() => { ui?.unmount(); ui = null; resetDockForTests(); vi.useRealTimers(); resetFriendsForTests(); setIdentity(null); setShowActivity(true); });

describe('what I am doing, out of a game', () => {
  it('every menu screen has its own line', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'menu'], [{ titleView: 'modes' }, 'modes'], [{ titleView: 'gauntlet' }, 'modes'], [{ titleView: 'learn' }, 'learn'],
      [{ titleView: 'versus' }, 'versus_browser'],
      [{ showCareer: true }, 'career'], [{ showRankings: true }, 'leaderboard'], [{ showLeaderboard: true }, 'hall'],
      [{ showRecentGames: true }, 'recent'], [{ showLiveGames: true }, 'live'], [{ showCollection: true }, 'collection'],
      [{ showBook: true }, 'compendium'], [{ showPatchNotes: true }, 'patch_notes'],
      [{ settingsOpen: true }, 'settings'], [{ showCareer: true, settingsOpen: true }, 'settings'], // an overlay over a page
    ];
    for (const [patch, want] of cases) {
      useGame.setState({ ...CLOSED, titleView: 'menu', ...patch } as never);
      expect(act$(), JSON.stringify(patch)).toBe(want);
      expect(presenceNow().status).toBe('online');
    }
    useVersus.setState({ area: 'duos' });
    useGame.setState({ ...CLOSED, titleView: 'versus' });
    expect(act$()).toBe('duos_browser');
  });

  it('Hero Select names its mode; Practice setup has its own line', () => {
    useGame.setState({ showTitle: false, heroChoices: ['a', 'b', 'c'], pendingMode: 'lobby', pendingGauntletStage: undefined });
    expect(presenceNow().activity).toEqual({ v: 1, act: 'hero_select', mode: 'ranked' });
    useGame.setState({ pendingMode: 'practice' });
    expect(presenceNow().activity).toMatchObject({ act: 'hero_select', mode: 'practice' });
    useGame.setState({ heroChoices: null, practiceSetupOpen: true });
    expect(act$()).toBe('practice_setup');
  });

  it('a replay: my own, a friend\'s by name, a stranger\'s unnamed', () => {
    useGame.setState({ replaying: true, showTitle: false });
    noteReplayAuthor({ name: 'Me', id: ME, own: true });
    expect(presenceNow()).toMatchObject({ status: 'online', mode: 'replay', activity: { act: 'replay', own: true } });
    useFriends.setState({ list: { ...emptyList(), friends: [{ userId: FRIEND, author: 'Ann', discriminator: '2222', avatar: null, favoriteHero: null, frame: null, skin: null, status: 'online', lastSeen: null }] } });
    noteReplayAuthor({ name: 'Ann', id: FRIEND, own: false });
    expect(presenceNow().activity).toEqual({ v: 1, act: 'replay', who: 'Ann' });
    noteReplayAuthor({ name: 'Stranger', id: 'x', own: false });
    expect(presenceNow().activity).toEqual({ v: 1, act: 'replay' });
  });

  it('spectating: a Live game names the player; a Versus room names the players', () => {
    net.watching = true;
    useLiveWatch.setState({ game: { game_id: 'g1', display_name: 'Ann' } as never });
    expect(presenceNow()).toMatchObject({ status: 'online', mode: 'watching', activity: { act: 'spectate', who: 'Ann' } });
    net.watching = false;
    const room = { id: 'r1', status: 'in_game', options: { mode: 'duel' }, members: [
      { userId: 'a', role: 'p1', displayName: 'Ann', profile: {}, lastSeenAt: '' }, { userId: 'b', role: 'p2', displayName: 'Bob', profile: {}, lastSeenAt: '' },
      { userId: ME, role: 'spectator', displayName: 'Me', profile: {}, lastSeenAt: '' }] } as unknown as VersusRoom;
    useVersus.setState({ room, match: { id: 'm1', phase: 'shop', round: 2 } as never });
    expect(presenceNow()).toMatchObject({ status: 'online', mode: 'watching', activity: { act: 'spectate', mode: 'versus_1v1', who: 'Ann vs Bob' } });
  });

  it('a Versus room: mode, players of seats, waiting or starting; a Duo party: with whom', () => {
    const member = (userId: string, role: string, displayName: string) => ({ userId, role, displayName, profile: {}, lastSeenAt: '' }) as VersusRoom['members'][number];
    const room = { id: 'r1', status: 'open', options: { mode: 'group' }, members: [member(ME, 'p1', 'Me'), member('b', 'p2', 'Bob'), member('c', 'p3', 'Cat'), member('d', 'spectator', 'Dan')] } as unknown as VersusRoom;
    useVersus.setState({ room, match: null });
    expect(presenceNow().activity).toEqual({ v: 1, act: 'versus_room', mode: 'versus_group', players: 3, max: 4 });
    useVersus.setState({ room: { ...room, status: 'sealed' } });
    expect(presenceNow().activity).toMatchObject({ starting: true });
    useVersus.setState({ room: { ...room, options: { mode: 'ranked_duos' } as never, members: [member(ME, 'p1', 'Me'), member('b', 'p2', 'Bob')] } });
    expect(presenceNow().activity).toEqual({ v: 1, act: 'duo_party', who: 'Bob', players: 2, max: 2 });
  });
});

describe('what I am doing, in a game', () => {
  const lobbyRun = (patch: Record<string, unknown> = {}) => {
    const run = useGame.getState().run;
    const seats = ['s0', 's1', 's2', 's3'].map((id, i) => ({ id, label: ['Me', 'Ann', 'Bob', 'Cat'][i], heroId: 'warden', kind: 'bot', seed: i, resolve: 20, armor: 0, alive: true }));
    return { ...run, mode: 'lobby', phase: 'recruit', runId: 'run-1', heroId: 'warden', wave: 5, resolve: 20, armor: 3, tier: 3,
      lobby: { ...(run.lobby ?? {}), version: 1, seed: 3, round: 5, seats, encounters: [], finished: false, rules: {}, unrated: undefined, forcedOpponent: { round: 5, seatId: 's3' } }, ...patch } as never;
  };

  it('a lobby round: Shopping, Ending turn (rides along), Fighting <name>, then Won or Finished Nth', () => {
    useGame.setState({ showTitle: false, run: lobbyRun() });
    expect(stepText(presenceNow().game!)).toBe('Round 5 · Shopping');
    useGame.setState({ endTurnAnimating: true });
    expect(stepText(presenceNow().game!)).toBe('Round 5 · Ending turn');
    useGame.setState({ endTurnAnimating: false, run: lobbyRun({ phase: 'combat' }) });
    expect(presenceNow().game).toMatchObject({ step: 'fight', foe: 'Cat' });
    expect(stepText(presenceNow().game!)).toBe('Round 5 · Fighting Cat');
    const over = lobbyRun({ phase: 'gameover' }) as { lobby: { seats: Array<{ id: string; alive: boolean; placement?: number }> } };
    over.lobby.seats[0] = { ...over.lobby.seats[0]!, alive: false, placement: 3 };
    useGame.setState({ run: over as never });
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'casual', watchKind: null, game: { step: 'done', final: 3 } }); // all-bot seats: unrated;
    expect(stepText(presenceNow().game!)).toBe('Finished 3rd');
    useGame.setState({ run: lobbyRun({ phase: 'victory' }) });
    expect(stepText(presenceNow().game!)).toBe('Won the game');
  });

  it('a fight with no named seat reads "a recorded board"; an older sender reads just "Fighting"', () => {
    expect(stepText({ round: 4, phase: 'combat', step: 'fight', foe: null })).toBe('Round 4 · Fighting a recorded board');
    expect(stepText({ round: 4, phase: 'combat' })).toBe('Round 4 · Fighting');
    expect(stepText({ round: 0, phase: 'hero' })).toBe('Picking a hero');
  });

  it('Versus: a locked turn is Ending turn; Duos names the other team and my teammate; a knockout watches the rest', () => {
    const member = (userId: string, role: string, displayName: string) => ({ userId, role, displayName, profile: {}, lastSeenAt: '' }) as VersusRoom['members'][number];
    const room = { id: 'r1', status: 'in_game', options: { mode: 'duos' }, members: [member(ME, 'p1', 'Me'), member('b', 'p2', 'Bob'), member('c', 'p3', 'Cat'), member('d', 'p4', 'Dan')] } as unknown as VersusRoom;
    useVersus.setState({ room, match: { id: 'm1', phase: 'shop', round: 3 } as never, lockedRound: 3 });
    expect(presenceNow().game).toMatchObject({ step: 'ending', mate: 'Bob', vs: 'Me & Bob vs Cat & Dan' });
    useVersus.setState({ match: { id: 'm1', phase: 'combat', round: 3 } as never });
    expect(stepText(presenceNow().game!)).toBe('Round 3 · Fighting Cat & Dan');
    const group = { ...room, options: { mode: 'group' }, members: [member(ME, 'spectator', 'Me'), member('b', 'p2', 'Bob'), member('c', 'p3', 'Cat')] } as unknown as VersusRoom;
    useVersus.setState({ room: group, knockout: { matchId: 'm1', placement: 3, of: 3 } });
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'versus_group', game: { step: 'out', final: 3, health: null } });
    expect(stepText(presenceNow().game!)).toBe('Knocked out, 3rd. Watching the fight');
  });

  it('the status survives the wire, and stays far under the 1 KB cap', () => {
    useGame.setState({ showTitle: false, run: lobbyRun({ phase: 'combat' }) });
    const g = presenceNow().game!;
    expect(parseGameStatus(JSON.parse(JSON.stringify(g)))).toEqual(g);
    const big: FriendActivity = { v: 1, act: 'duo_party', mode: 'x'.repeat(24), who: 'y'.repeat(40), own: true, players: 2, max: 2, starting: true };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThan(250);
    expect(parseActivity(JSON.parse(JSON.stringify(big)))).toEqual(big);
    expect(parseActivity({ act: 'nonsense' })).toBeNull();
    expect(parseActivity({ act: 'career', who: 'z'.repeat(500), players: 9, max: 99 })).toEqual({ v: 1, act: 'career', who: 'z'.repeat(40) });
  });
});

describe('privacy: "Show friends what I am doing"', () => {
  it('on by default and saved on this device', () => {
    expect(useFriendsPrefs.getState().showActivity).toBe(true);
    setShowActivity(false);
    expect(localStorage.getItem('ascent.friendsShowActivity')).toBe('false');
    setShowActivity(true);
    expect(localStorage.getItem('ascent.friendsShowActivity')).toBe('true');
  });

  it('off: only Online, or In a game with its mode (no screen, no game detail, no watch target)', () => {
    setShowActivity(false);
    useGame.setState({ showCareer: true });
    expect(presenceNow()).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null });
    useGame.setState({ replaying: true, showTitle: false });
    expect(presenceNow()).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null });
    const run = useGame.getState().run;
    useGame.setState({ replaying: false, run: { ...run, mode: 'practice', phase: 'combat', runId: 'r' } });
    expect(presenceNow()).toEqual({ status: 'in_game', mode: 'practice', watchKind: null, watchId: null });
  });

  it('turning it off sends the private presence once', async () => {
    vi.useFakeTimers();
    const stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(beats).toHaveLength(0); // the hub's hello carries the first one
    act(() => setShowActivity(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null });
    stop();
  });
});

describe('the settle (egress)', () => {
  it('rapid screen hops send once, for where I land; flipping straight back sends nothing', async () => {
    vi.useFakeTimers();
    const stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(beats).toHaveLength(0);
    for (const page of ['showCareer', 'showRankings', 'showLiveGames', 'showCollection'] as const) {
      act(() => { useGame.setState({ ...CLOSED, [page]: true }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
    expect(beats).toHaveLength(0); // still settling
    await act(async () => { await vi.advanceTimersByTimeAsync(CHANGE_SETTLE_MS); });
    expect(beats).toHaveLength(1);
    expect(beats[0]!.activity?.act).toBe('collection');
    // A quick look at Settings and straight back: nothing is owed.
    act(() => { useGame.setState({ settingsOpen: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => { useGame.setState({ settingsOpen: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(beats).toHaveLength(1);
    // Nothing periodic: the hub keeps the Supabase mirror alive itself.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(beats).toHaveLength(1);
    stop();
  });

  it('a lobby End Turn never sends a presence of its own', async () => {
    vi.useFakeTimers();
    const run = useGame.getState().run;
    useGame.setState({ showTitle: false, run: { ...run, mode: 'practice', phase: 'recruit', wave: 2, lobby: { seats: [{ id: 's0', resolve: 20, armor: 0, alive: true }] } as never } });
    const stop = startFriendsPresence();
    notePresenceSent(presenceNow()); // the hub's hello sent where I am
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(beats).toHaveLength(0);
    act(() => { useGame.setState({ endTurnAnimating: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(beats).toHaveLength(0);
    stop();
  });
});

describe('the Friends row', () => {
  const friend = (extra: Partial<Friend>): Friend => ({ userId: FRIEND, author: 'Ann', discriminator: '2222', avatar: null, favoriteHero: null, frame: null, skin: null, status: 'online', lastSeen: null, ...extra });

  it('words for every activity: short, plain, no em dash', () => {
    const all: FriendActivity[] = [
      { v: 1, act: 'menu' }, { v: 1, act: 'modes' }, { v: 1, act: 'learn' }, { v: 1, act: 'career' }, { v: 1, act: 'leaderboard' },
      { v: 1, act: 'hall' }, { v: 1, act: 'recent' }, { v: 1, act: 'live' }, { v: 1, act: 'collection' }, { v: 1, act: 'compendium' },
      { v: 1, act: 'patch_notes' }, { v: 1, act: 'settings' }, { v: 1, act: 'friends' }, { v: 1, act: 'replay', own: true },
      { v: 1, act: 'replay', who: 'Bob' }, { v: 1, act: 'replay' }, { v: 1, act: 'spectate', who: 'Bob' }, { v: 1, act: 'versus_browser' },
      { v: 1, act: 'duos_browser' }, { v: 1, act: 'versus_room', mode: 'versus_group', players: 3, max: 4 },
      { v: 1, act: 'duo_party', who: 'Bob', players: 2, max: 2, starting: true }, { v: 1, act: 'hero_select', mode: 'ranked' },
      { v: 1, act: 'practice_setup' },
    ];
    const words = all.map((a) => activityText(a, modeText).filter(Boolean).join(' | '));
    expect(words).toEqual([
      'Main menu', 'Choosing a mode', 'Tutorial', 'Browsing Career', 'Browsing the Leaderboard', 'Browsing the Hall of Champions',
      'Browsing Recent Games', 'Browsing Live Games', 'Collection', 'Compendium', 'Patch Notes', 'Settings', 'Friends',
      'Watching their own replay', "Watching Bob's replay", 'Watching a replay', 'Watching Bob', 'Looking for a Versus room',
      'Looking for a Duo party', 'In a Versus Group room | 3 of 4 players · Waiting', 'In a Duo party with Bob | 2 of 2 players · Starting',
      'Hero Select · Ranked', 'Setting up Practice',
    ]);
    for (const w of words) { expect(w).not.toMatch(/—|--/); expect(w).not.toMatch(/oath|climb/i); }
    expect(statusText(friend({ activity: { v: 1, act: 'career' } }))).toBe('Online: Browsing Career');
    expect(friendDetail(friend({ activity: { v: 1, act: 'career' } }))).toBeNull(); // the row says it all
  });

  it('renders the activity in the dock with the detail in the hover, and no title=', async () => {
    list = { ...emptyList(), friends: [
      friend({ activity: { v: 1, act: 'versus_room', mode: 'versus_group', players: 3, max: 4 }, mode: 'versus_room' }),
      friend({ userId: '00000000-0000-0000-0000-000000000003', author: 'Bea', status: 'in_game', mode: 'ranked',
        game: { v: 1, mode: 'ranked', hero: null, round: 7, phase: 'combat', health: 12, armor: 0, tier: 5, place: { rank: 2, left: 4 }, vs: null, step: 'fight', foe: 'Cat' } }),
    ] };
    ui = mount(<FriendsDock />);
    act(() => { openDock(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const text = ui.container.textContent!;
    expect(text).toContain('Online: In a Versus Group room');
    expect(text).toContain('3 of 4 players · Waiting');
    expect(text).toContain('Round 7 · Fighting Cat');
    const tips = [...ui.container.querySelectorAll('.fr-detail[data-tip]')].map((e) => e.getAttribute('data-tip')!).join(' ');
    expect(tips).toContain('Ranked · Round 7 · Fighting Cat');
    expect(tips).toContain('2nd of 4 left');
    expect(tips).toContain('12 Health');
    expect(ui.container.querySelector('[title]')).toBeNull();
    expect(text).not.toMatch(/—|--/);
  });
});
