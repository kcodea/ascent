// @vitest-environment jsdom
/**
 * FRIENDS in the client (owner 2026-10-26; R-FRIENDS-01..05), with the network faked:
 *  - presence: what I am doing (menu, a ranked game with its Live Games watch target, Practice, a Versus match) is what
 *    goes to the friends hub;
 *  - presence and inbox on the hub (egress, R-FRIENDS-05, R-FRIENDS-HUB-LIVE-01): no periodic call at all; one inbox read
 *    after boot, then only when the hub says it changed (coalesced); a status change is sent once it settles (never
 *    faster than every 5 s); my friend actions and invites nudge the other player; never for a guest; an undeployed
 *    server stops it for good; no Realtime subscription, no Offline beat;
 *  - the Friends panel (the dock, which took over the old Friends page): guests get the Sign in state; friends online
 *    first; Watch only on a watchable game; Invite only while I am in an open Versus room and the friend is online;
 *    Requests with a count; no title= anywhere;
 *  - no Friends page or side menu plaque any more; goTo('friends') opens the dock;
 *  - the invite notice: on a menu only, Accept answers the server then runs the kind's handler, gone once expired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ remote: true, live: true }));
vi.mock('../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../remoteBoards')>()), remoteEnabled: () => net.remote }));
vi.mock('../live/livePublisher', async (importOriginal) => ({ ...(await importOriginal<typeof import('../live/livePublisher')>()), liveEligible: () => net.live }));
vi.mock('@game/sim', async (importOriginal) => ({ ...(await importOriginal<typeof import('@game/sim')>()), lobbyIsUnrated: (l: { unrated?: string }) => l.unrated === 'all-generated' }));
vi.mock('../replay/replayPlayer', () => ({ startReplay: vi.fn() }));
vi.mock('../live/liveCount', () => ({ useLiveCount: () => 0, useWindowFocused: () => true }));

import { useGame } from '../store';
import { setIdentity } from '../identity';
import { useVersus } from '../versus/versusStore';
import type { VersusRoom } from '../versus/versusRemote';
import {
  acceptRequest, CHANGE_SETTLE_MS, INBOX_MIN_GAP_MS, inviteFriend, nudgeInbox, onPresenceSettled, PRESENCE_MIN_GAP_MS, presenceNow, registerInviteHandler,
  resetFriendsForTests, setFriendsRemoteForTests, setHubNotifier, setInviteProofSourceForTests, startFriendsPresence, useFriends,
} from './friendsStore';
import { FriendsError, friendsRemote, type Friend, type FriendInvite, type FriendsList, type FriendsRemote, type PresenceReport } from './friendsRemote';
import { statusText } from './friendBits';
import { FriendsDock } from './dock/FriendsDock';
import { openDock, resetDockForTests, useFriendsDock } from './dock/dockStore';
import { InviteNotice } from './InviteNotice';
import { MenuSidebar } from '../MenuSidebar';

const ME = '00000000-0000-0000-0000-000000000001';
const card = (id: string, author: string) => ({ userId: id, author, discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null });
const friend = (id: string, author: string, extra: Partial<Friend> = {}): Friend => ({ ...card(id, author), status: 'offline', lastSeen: null, ...extra });

interface Fake { lists: number; list: FriendsList; fail: string | null; responded: Array<[string, boolean]> }
let fake: Fake;
function fakeRemote(): FriendsRemote {
  const r = {
    list: async () => { fake.lists++; if (fake.fail) throw new FriendsError(fake.fail); return fake.list; },
    respond: async () => ({}),
    respondInvite: async (id: string, accept: boolean) => { fake.responded.push([id, accept]); return { status: accept ? 'accepted' : 'declined', kind: 'versus_room', target: 'room-1', from: 'x' }; },
  };
  return r as unknown as FriendsRemote;
}
const emptyList = (): FriendsList => ({ friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: new Date().toISOString() });

let ui: Mounted | null = null;
const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};
const account = (anonymous: boolean): void => {
  useGame.setState({ account: { userId: ME, email: anonymous ? null : 'a@b.c', anonymous, discriminator: '1111' }, playerName: 'Me' });
};
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  resetFriendsForTests();
  fake = { lists: 0, list: emptyList(), fail: null, responded: [] };
  setFriendsRemoteForTests(fakeRemote());
  Object.assign(net, { remote: true, live: true });
  setHidden(false);
  account(false);
  useVersus.setState({ room: null, match: null });
  useGame.setState({ showTitle: true, practiceSetupOpen: false, replaying: false, heroChoices: null, titleView: 'menu' });
  resetDockForTests();
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); resetFriendsForTests(); setIdentity(null); });

describe('presence: what the beat reports', () => {
  it('a menu is Online with no mode, and says it is on the main menu (R-FRIENDS-ACTIVITY-01)', () => {
    expect(presenceNow()).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null, activity: { v: 1, act: 'menu' } });
  });

  it('a ranked game is In a game: Ranked, watchable through Live Games; so is Practice now (owner 2026-10-28)', () => {
    const run = useGame.getState().run;
    useGame.setState({ showTitle: false, run: { ...run, mode: 'lobby', phase: 'recruit', runId: 'run-7', lobby: { ...(run.lobby ?? {}), unrated: undefined } as never } });
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'run-7' });
    useGame.setState({ run: { ...run, mode: 'practice', phase: 'combat', runId: 'run-8' } });
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'practice', watchKind: 'live', watchId: 'run-8' });
    net.live = false; // a sandbox / replay: the listing's gate says no, so no Watch
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'practice', watchKind: null, watchId: null });
  });

  it('a lobby game carries its status: hero, round + phase, Health + Armor, tier, place among those left (R-FRIENDS-STATUS-01)', () => {
    const run = useGame.getState().run;
    const seats = [
      { id: 's0', resolve: 20, armor: 5, alive: true }, { id: 's1', resolve: 30, armor: 0, alive: true },
      { id: 's2', resolve: 10, armor: 0, alive: true }, { id: 's3', resolve: 40, armor: 2, alive: false },
    ];
    useGame.setState({ showTitle: false, run: { ...run, mode: 'lobby', phase: 'combat', runId: 'run-7', heroId: 'warden', wave: 6, resolve: 20, armor: 5, tier: 4, lobby: { ...(run.lobby ?? {}), unrated: undefined, seats } as never } });
    expect(presenceNow().game).toEqual({ v: 1, mode: 'ranked', hero: 'warden', round: 6, phase: 'combat', health: 20, armor: 5, tier: 4, place: { rank: 2, left: 3 }, vs: null, step: 'fight', foe: null });
  });

  it('a Versus match I play is In a game with the room as the watch target; the room between matches is Online', () => {
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    const room = { id: 'room-1', status: 'in_game', options: { mode: 'duos' }, members: [{ userId: ME, role: 'p1', displayName: 'Me', profile: {}, lastSeenAt: '' }] } as unknown as VersusRoom;
    useVersus.setState({ room, match: { phase: 'shop', round: 3 } as never });
    // Every room is on the Versus Worker (R-VERSUS-CF-ONLY-01): the watch target names it `cf:`.
    expect(presenceNow()).toMatchObject({ status: 'in_game', mode: 'versus_duos', watchKind: 'versus', watchId: 'cf:room-1', game: { round: 3, phase: 'shop', vs: 'Me vs ' } });
    useVersus.setState({ room: { ...room, status: 'open' }, match: null });
    expect(presenceNow()).toEqual({ status: 'online', mode: 'versus_room', watchKind: null, watchId: null, activity: { v: 1, act: 'versus_room', mode: 'versus_duos', players: 1, max: 4 } });
  });

  it('a CLOUDFLARE Versus match is In a game with a cf: watch target, in every mode (R-VERSUS-CF-LIVE-01)', () => {
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    const want = { duel: 'versus_1v1', group: 'versus_group', duos: 'versus_duos', ranked_duos: 'ranked_duos' } as const;
    for (const [mode, presence] of Object.entries(want)) {
      const room = { id: 'room-cf', status: 'in_game', options: { mode }, members: [{ userId: ME, role: 'p1', displayName: 'Me', profile: {}, lastSeenAt: '' }] } as unknown as VersusRoom;
      useVersus.setState({ room, match: { phase: 'shop' } as never });
      expect(presenceNow(), mode).toMatchObject({ status: 'in_game', mode: presence, watchKind: 'versus', watchId: 'cf:room-cf' });
    }
  });

  it('status words', () => {
    expect(statusText({ status: 'online', mode: null, lastSeen: null })).toBe('Online');
    expect(statusText({ status: 'in_game', mode: 'versus_group', lastSeen: null })).toBe('In a game: Versus Group');
    expect(statusText({ status: 'offline', mode: null, lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() })).toBe('Last seen 5 minutes ago');
  });
});

describe('presence and inbox on the friends hub (egress, R-FRIENDS-HUB-LIVE-01)', () => {
  const sends = (): PresenceReport[] => {
    const got: PresenceReport[] = [];
    onPresenceSettled((p) => got.push(p));
    return got;
  };

  it('no periodic call: one inbox read after boot, then nothing for an hour, visible or hidden', async () => {
    vi.useFakeTimers();
    const sent = sends();
    const stop = startFriendsPresence();
    expect(fake.lists).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.lists).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    act(() => setHidden(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(fake.lists).toBe(1);
    expect(sent).toHaveLength(0); // nothing changed: nothing is sent
    stop();
  });

  it('the hub saying my inbox changed reads it once; a burst is one read now and one after the gap', async () => {
    vi.useFakeTimers();
    const stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.lists).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(INBOX_MIN_GAP_MS); });
    act(() => { nudgeInbox(); nudgeInbox(); nudgeInbox(); });
    await flush();
    expect(fake.lists).toBe(2);
    act(() => { nudgeInbox(); nudgeInbox(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(INBOX_MIN_GAP_MS); });
    expect(fake.lists).toBe(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * INBOX_MIN_GAP_MS); });
    expect(fake.lists).toBe(3);
    // The read fills the inbox (requests and invites) the dock and the invite notice show.
    expect(useFriends.getState().inbox).toMatchObject({ friends: 0, incoming: 0, invites: [] });
    stop();
  });

  it('a status change is sent once it settles, never faster than every 5 s; flipping straight back sends nothing', async () => {
    vi.useFakeTimers();
    const sent = sends();
    const stop = startFriendsPresence();
    const run = useGame.getState().run;
    act(() => { useGame.setState({ showTitle: false, run: { ...run, mode: 'practice', phase: 'recruit' } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(CHANGE_SETTLE_MS); });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: 'in_game', mode: 'practice' });
    act(() => { useGame.setState({ showTitle: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(CHANGE_SETTLE_MS); });
    expect(sent).toHaveLength(1); // the 5 s floor
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_MIN_GAP_MS); });
    expect(sent).toHaveLength(2);
    act(() => { useGame.setState({ showTitle: false }); });
    act(() => { useGame.setState({ showTitle: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * PRESENCE_MIN_GAP_MS); });
    expect(sent).toHaveLength(2);
    stop();
  });

  it('my friend actions and invites nudge the other player through the hub', async () => {
    const F = '00000000-0000-0000-0000-000000000002';
    const nudged: Array<[string, string]> = [];
    setHubNotifier((to, kind) => nudged.push([to, kind]));
    setFriendsRemoteForTests({ ...fakeRemote(), invite: async () => ({ id: 'i', kind: 'versus_room', target: 'room-1', expiresAt: '' }) } as unknown as FriendsRemote);
    setInviteProofSourceForTests(async () => null);
    await acceptRequest(F);
    await inviteFriend(F, 'versus_room', 'room-1');
    expect(nudged).toEqual([[F, 'friends'], [F, 'invite']]);
  });

  it('never for a guest or without a backend; an undeployed server stops it for good', async () => {
    vi.useFakeTimers();
    account(true);
    const sent = sends();
    let stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    act(() => { nudgeInbox(); });
    expect(fake.lists).toBe(0);
    expect(sent).toHaveLength(0);
    stop();
    account(false);
    fake.fail = 'not_deployed';
    stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.lists).toBe(1);
    expect(useFriends.getState().deployed).toBe(false);
    act(() => { nudgeInbox(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * INBOX_MIN_GAP_MS); });
    expect(fake.lists).toBe(1);
    stop();
  });

  it('no Supabase poll, Realtime subscription or Offline beat is left in the client', () => {
    const r = friendsRemote as unknown as Record<string, unknown>;
    expect(r.beat).toBeUndefined();
    expect(r.leave).toBeUndefined();
    expect(r.subscribeInvites).toBeUndefined();
  });
});

describe('the Friends panel in the dock (the old Friends page, R-FRIENDS-DOCK-02)', () => {
  const open = async (): Promise<void> => { act(() => { openDock(); }); await flush(); };
  it('a guest gets the compact Sign in state and no list read', async () => {
    account(true);
    const listSpy = vi.fn();
    setFriendsRemoteForTests({ ...fakeRemote(), list: async () => { listSpy(); return emptyList(); } } as FriendsRemote);
    ui = mount(<FriendsDock />);
    expect(ui.container.querySelector('.fdock-btn')).not.toBeNull();
    await open();
    expect(ui.container.textContent).toContain('Sign in to add friends.');
    expect(listSpy).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('Friends lists everyone online first then offline, Watch only on a watchable game, Invite only in an open room; Requests has the count', async () => {
    fake.list = {
      ...emptyList(),
      friends: [
        friend('u-off', 'Zed', { status: 'offline', lastSeen: new Date(Date.now() - 2 * 3600_000).toISOString() }),
        friend('u-game', 'Gus', { status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'g1' }),
        friend('u-prac', 'Pam', { status: 'in_game', mode: 'practice' }),
        friend('u-on', 'Amy', { status: 'online' }),
      ],
      incoming: [card('u-in', 'Ike')],
      outgoing: [card('u-out', 'Oli')],
    };
    ui = mount(<FriendsDock />);
    await open();
    const names = [...ui.container.querySelectorAll('.fdock-rows[aria-label="Friends"] .fr-name')].map((n) => n.textContent);
    expect(names).toEqual(['Amy#1234', 'Gus#1234', 'Pam#1234', 'Zed#1234']);
    expect(ui.container.textContent).toContain('Last seen 2 hours ago');
    expect(ui.container.textContent).toContain('Me#1111'); // my handle to share
    expect(ui.container.querySelector('.fdock-addinput')).not.toBeNull(); // Add by handle
    const watch = [...ui.container.querySelectorAll('button')].filter((b) => b.textContent?.includes('Watch'));
    expect(watch.map((b) => b.getAttribute('aria-label'))).toEqual(['Watch Gus#1234']);
    expect([...ui.container.querySelectorAll('button')].some((b) => b.textContent === 'Invite')).toBe(false);
    act(() => { useVersus.setState({ room: { id: 'room-1', status: 'open', options: null, members: [] } as unknown as VersusRoom }); });
    const invites = [...ui.container.querySelectorAll('button')].filter((b) => b.textContent === 'Invite');
    expect(invites.map((b) => b.getAttribute('aria-label'))).toEqual(['Invite Amy#1234 to your room']);
    const reqTab = [...ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.startsWith('Requests'))!;
    expect(reqTab.textContent).toBe('Requests1');
    act(() => { reqTab.click(); });
    expect(ui.container.textContent).toContain('Wants to be friends');
    expect(ui.container.textContent).toContain('Request sent');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('a friend in a game shows its status, and EVERY game type gets Watch (Practice included; R-FRIENDS-STATUS-01)', async () => {
    const game = { v: 1 as const, mode: 'practice', hero: 'warden', round: 6, phase: 'shop' as const, health: 20, armor: 5, tier: 4, place: { rank: 3, left: 5 }, vs: null };
    fake.list = {
      ...emptyList(),
      friends: [
        friend('u-prac', 'Pam', { status: 'in_game', mode: 'practice', watchKind: 'live', watchId: 'run-p', game }),
        friend('u-duo', 'Dot', { status: 'in_game', mode: 'ranked_duos', watchKind: 'versus', watchId: 'cf:room-d',
          game: { ...game, mode: 'ranked_duos', phase: 'combat', place: null, vs: 'Dot & Eve' } }),
      ],
    };
    ui = mount(<FriendsDock />);
    await open();
    const text = ui.container.textContent!;
    expect(text).toContain('Round 6 · Shopping');
    expect(text).toContain('3rd of 5');
    expect(text).toContain('Tier 4');
    expect(text).toContain('Round 6 · Fighting');
    const tips = [...ui.container.querySelectorAll('.fr-detail[data-tip]')].map((e) => e.getAttribute('data-tip')!);
    expect(tips.join(' ')).toContain('3rd of 5 left');
    expect(tips.join(' ')).toContain('20 Health + 5 Armor');
    expect(tips.join(' ')).toContain('Dot & Eve');
    expect(ui.container.querySelectorAll('.fr-gamehero .lb-heroframe')).toHaveLength(2);
    const watch = [...ui.container.querySelectorAll('button')].filter((b) => b.textContent?.includes('Watch'));
    expect(watch.map((b) => b.getAttribute('aria-label'))).toEqual(['Watch Dot#1234', 'Watch Pam#1234']);
    expect(text).not.toMatch(/—|--/);
    expect(ui.container.querySelector('[title]')).toBeNull();
  });
});

describe('no Friends page on the menus (R-FRIENDS-DOCK-02)', () => {
  it('the side menu has no Friends plaque; goTo(friends) opens the dock in place and changes no page', () => {
    ui = mount(<MenuSidebar current="career" />);
    expect([...ui.container.querySelectorAll('.sbbtn')].some((b) => b.textContent?.includes('Friends'))).toBe(false);
    useGame.setState({ showCareer: true });
    act(() => { useGame.getState().goTo('friends'); });
    expect(useFriendsDock.getState().phase).toBe('open');
    expect(useFriendsDock.getState().tab).toBe('friends');
    expect(useGame.getState().showCareer).toBe(true);
    expect('showFriends' in useGame.getState()).toBe(false);
  });
});

describe('the invite notice', () => {
  const inv = (secs: number): FriendInvite => ({ id: 'inv-1', kind: 'versus_room', target: 'room-1', expiresAt: new Date(Date.now() + secs * 1000).toISOString(), from: card('u-ann', 'Ann') });

  it('shows on a menu with Accept / Decline; Accept answers the server then joins through the handler', async () => {
    const joined = vi.fn();
    const un = registerInviteHandler('versus_room', joined);
    useFriends.setState({ inbox: { friends: 1, online: 1, incoming: 0, invites: [inv(90)], serverNow: new Date().toISOString() }, skew: 0 });
    ui = mount(<InviteNotice />);
    expect(ui.container.textContent).toContain('Ann#1234 invites you to their Versus room.');
    expect(ui.container.textContent).toMatch(/\d+s left/);
    const accept = [...ui.container.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!;
    await act(async () => { accept.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(fake.responded).toEqual([['inv-1', true]]);
    expect(joined).toHaveBeenCalledTimes(1);
    expect(ui.container.textContent).toBe(''); // answered: gone
    un();
  });

  it('never over a game, never once expired, never for a kind with no handler', () => {
    const un = registerInviteHandler('versus_room', () => undefined);
    useFriends.setState({ inbox: { friends: 1, online: 1, incoming: 0, invites: [inv(90)], serverNow: '' }, skew: 0 });
    useGame.setState({ showTitle: false });
    ui = mount(<InviteNotice />);
    expect(ui.container.textContent).toBe('');
    act(() => { useGame.setState({ showTitle: true }); });
    expect(ui.container.textContent).toContain('invites you');
    act(() => { useFriends.setState({ inbox: { friends: 1, online: 1, incoming: 0, invites: [inv(-1)], serverNow: '' } }); });
    expect(ui.container.textContent).toBe('');
    un();
    act(() => { useFriends.setState({ inbox: { friends: 1, online: 1, incoming: 0, invites: [{ ...inv(90), id: 'inv-2', kind: 'duos_party' }], serverNow: '' } }); });
    expect(ui.container.textContent).toBe('');
  });
});

describe('invites into a Cloudflare room are checked when sent (R-VERSUS-CF-INVITE-01)', () => {
  function inviteRemote(sent: unknown[][], fail?: string): FriendsRemote {
    return { ...fakeRemote(), list: async () => emptyList(), invite: async (...a: unknown[]) => { sent.push(a); if (fail) throw new FriendsError(fail); return { id: 'i', kind: 'versus_room', target: String(a[2]), expiresAt: '' }; } } as unknown as FriendsRemote;
  }
  const F = '00000000-0000-0000-0000-000000000002';

  it('a cf: room asks the room for its proof first and sends it with the invite', async () => {
    const sent: unknown[][] = [];
    const asked: unknown[][] = [];
    setFriendsRemoteForTests(inviteRemote(sent));
    setInviteProofSourceForTests(async (...a) => { asked.push(a); return '123.abc'; });
    expect(await inviteFriend(F, 'versus_room', 'cf:room-9')).toBe(true);
    expect(asked).toEqual([['room-9', F, 'versus_room']]);
    expect(sent).toEqual([[F, 'versus_room', 'cf:room-9', '123.abc']]);
  });

  it('the room says no: nothing is sent, and the flash reads as it does for a Supabase room', async () => {
    const sent: unknown[][] = [];
    setFriendsRemoteForTests(inviteRemote(sent));
    setInviteProofSourceForTests(async () => { throw new FriendsError('room_not_open'); });
    expect(await inviteFriend(F, 'versus_room', 'cf:room-9')).toBe(false);
    expect(sent).toHaveLength(0);
    expect(useFriends.getState().flash).toBe('That room is not open.');
  });

  it('a Supabase room sends no proof (the plain three-argument call)', async () => {
    const sent: unknown[][] = [];
    const asked: unknown[][] = [];
    setFriendsRemoteForTests(inviteRemote(sent));
    setInviteProofSourceForTests(async (...a) => { asked.push(a); return 'x'; });
    expect(await inviteFriend(F, 'versus_room', 'room-1')).toBe(true);
    expect(asked).toHaveLength(0);
    expect(sent).toEqual([[F, 'versus_room', 'room-1', null]]);
  });
});
