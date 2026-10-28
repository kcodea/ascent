// @vitest-environment jsdom
/**
 * FRIENDS in the client (owner 2026-10-26; R-FRIENDS-01..05), with the network faked:
 *  - presence: what I am doing (menu, a ranked game with its Live Games watch target, Practice, a Versus match) is what
 *    the beat reports;
 *  - the beat (egress, R-FRIENDS-05): one call after boot, then every 60 s visible / 120 s hidden, at once on a status
 *    change (never faster than every 5 s), never for a guest, stopped for good by an undeployed server; the invite
 *    wake-up is subscribed only for an account with friends and a visible tab;
 *  - the Friends page: guests get the Save account prompt; requests with a count; friends online first; Watch only on
 *    a watchable game; Invite only while I am in an open Versus room and the friend is online; no title= anywhere;
 *  - the side menu's Friends plaque: requests waiting, else friends online;
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
  BEAT_HIDDEN_MS, BEAT_VISIBLE_MS, inviteFriend, presenceNow, registerInviteHandler, resetFriendsForTests, setFriendsRemoteForTests,
  setInviteProofSourceForTests, startFriendsPresence, useFriends,
} from './friendsStore';
import { FriendsError, type BeatAnswer, type Friend, type FriendInvite, type FriendsList, type FriendsRemote, type PresenceReport } from './friendsRemote';
import { FriendsPage, statusText } from './FriendsPage';
import { InviteNotice } from './InviteNotice';
import { MenuSidebar } from '../MenuSidebar';

const ME = '00000000-0000-0000-0000-000000000001';
const card = (id: string, author: string) => ({ userId: id, author, discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null });
const friend = (id: string, author: string, extra: Partial<Friend> = {}): Friend => ({ ...card(id, author), status: 'offline', lastSeen: null, ...extra });

interface Fake { beats: PresenceReport[]; subs: number; closes: number; list: FriendsList; beatAnswer: BeatAnswer; fail: string | null; responded: Array<[string, boolean]> }
let fake: Fake;
function fakeRemote(): FriendsRemote {
  const r = {
    beat: async (p: PresenceReport) => { fake.beats.push(p); if (fake.fail) throw new FriendsError(fake.fail); return fake.beatAnswer; },
    list: async () => fake.list,
    respondInvite: async (id: string, accept: boolean) => { fake.responded.push([id, accept]); return { status: accept ? 'accepted' : 'declined', kind: 'versus_room', target: 'room-1', from: 'x' }; },
    subscribeInvites: () => { fake.subs++; return { channel: null, close: () => { fake.closes++; } }; },
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
  fake = { beats: [], subs: 0, closes: 0, list: emptyList(), beatAnswer: { friends: 0, online: 0, incoming: 0, invites: [], serverNow: new Date().toISOString() }, fail: null, responded: [] };
  setFriendsRemoteForTests(fakeRemote());
  Object.assign(net, { remote: true, live: true });
  setHidden(false);
  account(false);
  useVersus.setState({ room: null, match: null });
  useGame.setState({ showTitle: true, practiceSetupOpen: false, replaying: false, heroChoices: null, titleView: 'menu', showFriends: false });
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); resetFriendsForTests(); setIdentity(null); });

describe('presence: what the beat reports', () => {
  it('a menu is Online with no mode', () => {
    expect(presenceNow()).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null });
  });

  it('a ranked game is In a game: Ranked, watchable through Live Games; Practice is not watchable', () => {
    const run = useGame.getState().run;
    useGame.setState({ showTitle: false, run: { ...run, mode: 'lobby', phase: 'recruit', runId: 'run-7', lobby: { ...(run.lobby ?? {}), unrated: undefined } as never } });
    expect(presenceNow()).toEqual({ status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'run-7' });
    useGame.setState({ run: { ...run, mode: 'practice', phase: 'combat' } });
    expect(presenceNow()).toEqual({ status: 'in_game', mode: 'practice', watchKind: null, watchId: null });
  });

  it('a Versus match I play is In a game with the room as the watch target; the room between matches is Online', () => {
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    const room = { id: 'room-1', status: 'in_game', options: { mode: 'duos' }, members: [{ userId: ME, role: 'p1', displayName: 'Me', profile: {}, lastSeenAt: '' }] } as unknown as VersusRoom;
    useVersus.setState({ room, match: { phase: 'shop' } as never });
    expect(presenceNow()).toEqual({ status: 'in_game', mode: 'versus_duos', watchKind: 'versus', watchId: 'room-1' });
    useVersus.setState({ room: { ...room, status: 'open' }, match: null });
    expect(presenceNow()).toEqual({ status: 'online', mode: 'versus_room', watchKind: null, watchId: null });
  });

  it('a CLOUDFLARE Versus match is In a game with a cf: watch target, in every mode (R-VERSUS-CF-LIVE-01)', () => {
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    const want = { duel: 'versus_1v1', group: 'versus_group', duos: 'versus_duos', ranked_duos: 'ranked_duos' } as const;
    for (const [mode, presence] of Object.entries(want)) {
      const room = { id: 'room-cf', host: 'cf', status: 'in_game', options: { mode }, members: [{ userId: ME, role: 'p1', displayName: 'Me', profile: {}, lastSeenAt: '' }] } as unknown as VersusRoom;
      useVersus.setState({ room, match: { phase: 'shop' } as never });
      expect(presenceNow(), mode).toEqual({ status: 'in_game', mode: presence, watchKind: 'versus', watchId: 'cf:room-cf' });
    }
  });

  it('status words', () => {
    expect(statusText({ status: 'online', mode: null, lastSeen: null })).toBe('Online');
    expect(statusText({ status: 'in_game', mode: 'versus_group', lastSeen: null })).toBe('In a game: Versus Group');
    expect(statusText({ status: 'offline', mode: null, lastSeen: new Date(Date.now() - 5 * 60_000).toISOString() })).toBe('Last seen 5 minutes ago');
  });
});

describe('the beat (egress)', () => {
  it('beats once after boot, then every 60 s visible and 120 s hidden', async () => {
    vi.useFakeTimers();
    fake.beatAnswer = { ...fake.beatAnswer, friends: 2 };
    const stop = startFriendsPresence();
    expect(fake.beats).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.beats).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(BEAT_VISIBLE_MS - 1000); });
    expect(fake.beats).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fake.beats).toHaveLength(2);
    act(() => setHidden(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(BEAT_VISIBLE_MS); });
    // The visible-pace beat already queued lands once, then the hidden pace takes over.
    const n = fake.beats.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(BEAT_HIDDEN_MS - 1000); });
    expect(fake.beats.length).toBe(n);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fake.beats.length).toBe(n + 1);
    stop();
  });

  it('a status change beats at once (after a short settle), never faster than every 5 s', async () => {
    vi.useFakeTimers();
    fake.beatAnswer = { ...fake.beatAnswer, friends: 1 };
    const stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.beats).toHaveLength(1);
    const run = useGame.getState().run;
    act(() => { useGame.setState({ showTitle: false, run: { ...run, mode: 'practice', phase: 'recruit' } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fake.beats).toHaveLength(1); // the 5 s floor
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(fake.beats).toHaveLength(2);
    expect(fake.beats[1]).toMatchObject({ status: 'in_game', mode: 'practice' });
    stop();
  });

  it('never beats for a guest or without a backend; an undeployed server stops it for good', async () => {
    vi.useFakeTimers();
    account(true);
    let stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * BEAT_VISIBLE_MS); });
    expect(fake.beats).toHaveLength(0);
    stop();
    account(false);
    fake.fail = 'not_deployed';
    stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * BEAT_VISIBLE_MS); });
    expect(fake.beats).toHaveLength(1);
    expect(useFriends.getState().deployed).toBe(false);
    stop();
  });

  it('the invite wake-up is on only for an account with friends and a visible tab', async () => {
    vi.useFakeTimers();
    const stop = startFriendsPresence();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fake.subs).toBe(0); // no friends yet
    fake.beatAnswer = { ...fake.beatAnswer, friends: 1 };
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(fake.subs).toBe(1);
    act(() => setHidden(true));
    expect(fake.closes).toBe(1);
    act(() => setHidden(false));
    expect(fake.subs).toBe(2);
    stop();
  });
});

describe('the Friends page', () => {
  it('a guest gets the Save account prompt and no list read', () => {
    account(true);
    useGame.setState({ showFriends: true });
    const listSpy = vi.fn();
    setFriendsRemoteForTests({ ...fakeRemote(), list: async () => { listSpy(); return emptyList(); } } as FriendsRemote);
    ui = mount(<FriendsPage />);
    expect(ui.container.textContent).toContain('Save your account to add friends.');
    expect(listSpy).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('lists requests with a count and friends online first; Watch only on a watchable game; Invite only in an open room', async () => {
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
    useGame.setState({ showFriends: true });
    ui = mount(<FriendsPage />);
    await flush();
    const text = ui.container.textContent!;
    expect(text).toContain('Requests 2');
    expect(text).toContain('Wants to be friends');
    const names = [...ui.container.querySelectorAll('.fr-section[aria-label="Friends"] .fr-name')].map((n) => n.textContent);
    expect(names).toEqual(['Amy#1234', 'Gus#1234', 'Pam#1234', 'Zed#1234']);
    expect(text).toContain('Last seen 2 hours ago');
    const watch = [...ui.container.querySelectorAll('button')].filter((b) => b.textContent?.includes('Watch'));
    expect(watch.map((b) => b.getAttribute('aria-label'))).toEqual(['Watch Gus#1234']);
    expect([...ui.container.querySelectorAll('button')].some((b) => b.textContent === 'Invite')).toBe(false);
    act(() => { useVersus.setState({ room: { id: 'room-1', status: 'open', options: null, members: [] } as unknown as VersusRoom }); });
    const invites = [...ui.container.querySelectorAll('button')].filter((b) => b.textContent === 'Invite');
    expect(invites.map((b) => b.getAttribute('aria-label'))).toEqual(['Invite Amy#1234 to your Versus room']);
    expect(ui.container.textContent).toContain('You are Me#1111');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });
});

describe('the side menu Friends plaque', () => {
  it('shows requests waiting, else friends online', () => {
    ui = mount(<MenuSidebar current="friends" />);
    const plaque = (): HTMLElement => [...ui!.container.querySelectorAll<HTMLElement>('.sbbtn')].find((b) => b.textContent?.includes('Friends'))!;
    expect(plaque().getAttribute('aria-current')).toBe('page');
    act(() => { useFriends.setState({ inbox: { friends: 3, online: 2, incoming: 0, invites: [], serverNow: '' } }); });
    expect(plaque().querySelector('.fr-onchip')?.textContent).toBe('2 online');
    act(() => { useFriends.setState({ inbox: { friends: 3, online: 2, incoming: 1, invites: [], serverNow: '' } }); });
    expect(plaque().querySelector('.fr-reqpill')?.textContent).toBe('1');
    expect(plaque().querySelector('.fr-onchip')).toBeNull();
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
