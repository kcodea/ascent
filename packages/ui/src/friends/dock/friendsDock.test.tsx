// @vitest-environment jsdom
/**
 * THE IN-GAME FRIENDS DOCK (R-FRIENDS-DOCK-01) and THE FRIEND MENU (R-FRIENDS-MENU-01 / -02), with the network faked:
 *  - the dock shows only in a game screen, for an account; its badge is the beat's online count (no extra call);
 *  - open lists ONLINE friends only (online, then in a game), reading the list while open and never while closed;
 *  - a friend opens their direct message panel (the empty conversation slot, the disabled "coming soon" composer);
 *  - a press outside closes BOTH panels in one motion and never reaches the game; Escape too, without the Esc menu;
 *  - the menu's entries per state, and each action: Spectate, Invite to lobby / Duos (an existing room, or a NEW one
 *    made first, on either host; mid-game disabled), Invite to spectate (my live game / Versus room, either host), and
 *    accepting a spectate invite drops the friend into watching.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ live: true, created: [] as string[], parties: [] as string[], watched: [] as string[], joined: [] as Array<[string, string]> }));
vi.mock('../../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('../../live/livePublisher', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../live/livePublisher')>()), liveEligible: () => net.live }));
vi.mock('../../live/liveWatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../live/liveWatch')>()),
  watchLiveGame: vi.fn(async (id: string) => { net.watched.push(id); return true; }),
}));
vi.mock('../../versus/versusFlag', () => ({ versusEnabled: () => true }));
vi.mock('../../versus/versusStore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../versus/versusStore')>();
  const room = (id: string, mode: string, host?: string) => ({
    id, status: 'open', host, options: { v: 1, mode, modifiers: [] }, members: [{ userId: '00000000-0000-0000-0000-000000000001', role: 'p1', displayName: 'Me' }],
  });
  return {
    ...orig,
    openVersus: vi.fn(() => undefined),
    createRoom: vi.fn(async (name: string) => { net.created.push(name); orig.useVersus.setState({ room: room('new-room', 'duel', (globalThis as { __host?: string }).__host) as never }); }),
    enterDuosParty: vi.fn(async (name: string) => { net.parties.push(name); orig.useVersus.setState({ room: room('new-party', 'ranked_duos', (globalThis as { __host?: string }).__host) as never }); }),
    joinRoom: vi.fn(async (id: string, as: string) => { net.joined.push([id, as]); orig.useVersus.setState({ room: { ...room(id, 'duel'), status: 'in_game' } as never }); }),
  };
});

import { useGame } from '../../store';
import { setIdentity } from '../../identity';
import { useVersus } from '../../versus/versusStore';
import { resetFriendsForTests, setFriendsRemoteForTests, setInviteProofSourceForTests, useFriends } from '../friendsStore';
import type { Friend, FriendInvite, FriendsList, FriendsRemote, InviteKind } from '../friendsRemote';
import { acceptSpectateInvite, FINISH_FIRST, friendMenuEntries, inviteToRoom, inviteToSpectate, runFriendMenu, type FriendMenuContext } from '../friendsGo';
import { FriendMenu, openFriendMenu, useFriendMenu } from '../FriendMenu';
import { FriendsDock } from './FriendsDock';
import { FriendsPage } from '../FriendsPage';
import { DOCK_CLOSE_MS, resetDockForTests, useFriendsDock } from './dockStore';

const ME = '00000000-0000-0000-0000-000000000001';
const card = (id: string, author: string) => ({ userId: id, author, discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null });
const friend = (id: string, author: string, extra: Partial<Friend> = {}): Friend => ({ ...card(id, author), status: 'offline', lastSeen: null, ...extra });
const emptyList = (): FriendsList => ({ friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: new Date().toISOString() });

let lists = 0;
let invites: Array<{ to: string; kind: InviteKind; target: string; proof: string | null | undefined }> = [];
let list: FriendsList = emptyList();
function fakeRemote(): FriendsRemote {
  return {
    beat: async () => ({ friends: 3, online: 2, incoming: 0, invites: [], serverNow: new Date().toISOString() }),
    leave: () => true,
    list: async () => { lists++; return list; },
    invite: async (to: string, kind: InviteKind, target: string, proof?: string | null) => { invites.push({ to, kind, target, proof }); return { id: 'i1', kind, target, expiresAt: new Date(Date.now() + 120_000).toISOString() }; },
    subscribeInvites: () => ({ channel: null, close: () => undefined }),
  } as unknown as FriendsRemote;
}

let ui: Mounted | null = null;
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const inRun = (): void => {
  const run = useGame.getState().run;
  useGame.setState({ showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: { ...run, mode: 'practice', phase: 'recruit', runId: 'run-me' } });
};
const q = (sel: string): HTMLElement | null => document.body.querySelector(sel);
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };
const press = (el: Element | null, x = 5000, y = 5000): void => { act(() => { el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y })); }); };
const waitClose = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, DOCK_CLOSE_MS + 20)); }); };

beforeEach(() => {
  resetFriendsForTests();
  resetDockForTests();
  setFriendsRemoteForTests(fakeRemote());
  setInviteProofSourceForTests(async (room, to, kind) => `proof:${room}:${to}:${kind}`);
  lists = 0; invites = [];
  Object.assign(net, { live: true, created: [], parties: [], watched: [], joined: [] });
  (globalThis as { __host?: string }).__host = undefined;
  list = {
    ...emptyList(),
    friends: [
      friend('u-off', 'Oli'),
      friend('u-amy', 'Amy', { status: 'online' }),
      friend('u-gus', 'Gus', { status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'run-gus' }),
    ],
  };
  useFriends.setState({ inbox: { friends: 3, online: 2, incoming: 0, invites: [], serverNow: new Date().toISOString() } });
  useGame.setState({ account: { userId: ME, email: 'a@b.c', anonymous: false, discriminator: '1111' }, playerName: 'Me', settingsOpen: false });
  useVersus.setState({ room: null, match: null });
  useGame.setState({ showTitle: true, practiceSetupOpen: false, replaying: false, heroChoices: null, titleView: 'menu' });
  useFriendMenu.setState({ friend: null, entries: [] });
});
afterEach(() => { ui?.unmount(); ui = null; resetDockForTests(); resetFriendsForTests(); setIdentity(null); });

describe('the dock (R-FRIENDS-DOCK-01)', () => {
  it('shows only in a game screen, for an account; the badge is the beat\'s online count', () => {
    ui = mount(<FriendsDock />);
    expect(q('.fdock-btn')).toBeNull(); // the title
    act(() => inRun());
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toBe('Friends, 2 online');
    expect(q('.fdock-count')?.textContent).toBe('2');
    act(() => { useGame.setState({ account: { userId: ME, email: null, anonymous: true, discriminator: null } }); });
    expect(q('.fdock-btn')).toBeNull(); // a guest
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('closed renders only the button and reads nothing; open lists ONLINE friends only; click again collapses', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    await flush();
    expect(q('.fdock-stack')).toBeNull();
    expect(lists).toBe(0);
    click(q('.fdock-btn'));
    await flush();
    expect(lists).toBe(1);
    const names = [...document.body.querySelectorAll('.fdock-list .fr-name')].map((n) => n.textContent);
    expect(names).toEqual(['Amy#1234', 'Gus#1234']); // online first, then in a game; Oli (offline) is not listed
    expect(q('.fdock-sub')?.textContent).toBe('2 online');
    click(q('.fdock-btn'));
    expect(useFriendsDock.getState().phase).toBe('closing');
    expect(q('.fdock-stack.closing')).not.toBeNull();
    await waitClose();
    expect(q('.fdock-stack')).toBeNull();
  });

  it('a friend opens their direct message panel: header, empty conversation, disabled composer; another friend swaps it', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    expect(q('.fdock-dm')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    const input = q('.fdock-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Messages are coming soon');
    expect(q('.fdock-convo')?.textContent).toBe('No messages yet.');
    click(q('.fdock-rowmain[aria-label="Message Gus#1234"]'));
    expect(q('.fdock-dm')?.getAttribute('aria-label')).toBe('Messages with Gus#1234');
    expect(q('.fdock-dm')?.textContent).toContain('Watch');
  });

  it('a press outside closes BOTH panels in one motion, and never reaches the game underneath', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    const game = vi.fn();
    window.addEventListener('pointerdown', game);
    press(q('.fdock-catch'));
    window.removeEventListener('pointerdown', game);
    expect(game).not.toHaveBeenCalled();
    // A slow tap lifting after the catcher is gone: its click is eaten too (once).
    const board = document.createElement('button');
    const bought = vi.fn();
    board.addEventListener('click', bought);
    document.body.appendChild(board);
    act(() => { board.click(); });
    act(() => { board.click(); });
    expect(bought).toHaveBeenCalledTimes(1);
    board.remove();
    expect(useFriendsDock.getState().phase).toBe('closing');
    expect(q('.fdock-stack.closing .fdock-dm')).not.toBeNull(); // the DM collapses WITH the list
    await waitClose();
    expect(useFriendsDock.getState()).toMatchObject({ phase: 'closed', dmWith: null });
    expect(q('.fdock-catch')).toBeNull();
  });

  it('Escape closes both, and the same press does not reach the Esc menu', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).not.toHaveBeenCalled();
    expect(useFriendsDock.getState().phase).toBe('closing');
    await waitClose();
    expect(useFriendsDock.getState().dmWith).toBeNull();
  });
});

describe('the friend menu entries (R-FRIENDS-MENU-01)', () => {
  const free: FriendMenuContext = { versus: true, inGame: false, playing: false, room: null, spectate: null };
  const ids = (f: Friend, ctx: FriendMenuContext) => friendMenuEntries(f, ctx).map((e) => (e.disabled ? `${e.id}(${e.disabled})` : e.id));
  const amy = friend('u-amy', 'Amy', { status: 'online' });
  const room = (mode: string, status = 'open', seated = 1) => ({ status, options: { v: 1, mode, modifiers: [] }, members: Array.from({ length: seated }, (_, i) => ({ userId: `u${i}`, role: `p${i + 1}`, displayName: 'x' })) }) as never;

  it('offline: nothing; in a watchable game: Spectate only (they cannot be invited while playing)', () => {
    expect(ids(friend('u', 'Oli'), free)).toEqual([]);
    expect(ids(friend('u', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'run-g' }), free)).toEqual(['spectate']);
    expect(ids(friend('u', 'Gus', { status: 'in_game', watchKind: null, watchId: null }), free)).toEqual([]);
    // Playing my own game: watching would abandon it.
    expect(ids(friend('u', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'run-g' }), { ...free, inGame: true, playing: true })).toEqual([`spectate(${FINISH_FIRST})`]);
  });

  it('online, me free: Invite to lobby + Invite to Duos; with a live game of mine also Invite to spectate', () => {
    expect(ids(amy, free)).toEqual(['invite_lobby', 'invite_duos']);
    expect(ids(amy, { ...free, inGame: true, spectate: 'live:run-me' })).toEqual([`invite_lobby(${FINISH_FIRST})`, `invite_duos(${FINISH_FIRST})`, 'invite_spectate']);
  });

  it('a running room of mine disables room invites; a full party disables Duos; Versus off hides both; a friend in a room gets none', () => {
    expect(ids(amy, { ...free, room: room('duel', 'in_game', 2) })).toEqual([`invite_lobby(${FINISH_FIRST})`, `invite_duos(${FINISH_FIRST})`]);
    expect(ids(amy, { ...free, room: room('ranked_duos', 'open', 2) })).toEqual(['invite_lobby', 'invite_duos(Your party is full)']);
    expect(ids(amy, { ...free, room: room('ranked_duos', 'open', 1) })).toEqual(['invite_lobby', 'invite_duos']);
    expect(ids(amy, { ...free, versus: false })).toEqual([]);
    expect(ids(friend('u', 'Rae', { status: 'online', mode: 'versus_room' }), free)).toEqual([]);
  });

  it('right-click on a dock row opens it there; a disabled entry shows its reason; a press outside closes the menu AND the dock', async () => {
    inRun();
    ui = mount(<><FriendsDock /><FriendMenu /></>);
    click(q('.fdock-btn'));
    await flush();
    const row = q('.fdock-rowmain[aria-label="Message Amy#1234"]')!;
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); });
    const items = [...document.body.querySelectorAll('.frmenu-item')];
    expect(items.map((b) => b.querySelector('.frmenu-label')?.textContent)).toEqual(['Invite to lobby', 'Invite to Duos', 'Invite to spectate']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    expect(items[0]!.textContent).toContain(FINISH_FIRST);
    expect(useFriendsDock.getState().dmWith).toBeNull(); // right-click is not a click: no DM
    press(q('.frmenu-catch'));
    expect(q('.frmenu')).toBeNull();
    expect(useFriendsDock.getState().phase).toBe('closing');
  });
});

describe('the friend menu on the Friends page (the main menu)', () => {
  it('right-click on a row opens the same menu; Escape closes it without opening the Esc menu', async () => {
    useGame.setState({ showFriends: true });
    ui = mount(<><FriendsPage /><FriendMenu /></>);
    await flush();
    const row = [...document.body.querySelectorAll('.fr-row')].find((r) => r.textContent?.includes('Gus#1234'))!;
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    expect([...document.body.querySelectorAll('.frmenu-label')].map((n) => n.textContent)).toEqual(['Spectate']);
    const amy = [...document.body.querySelectorAll('.fr-row')].find((r) => r.textContent?.includes('Amy#1234'))!;
    act(() => { amy.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    expect([...document.body.querySelectorAll('.frmenu-label')].map((n) => n.textContent)).toEqual(['Invite to lobby', 'Invite to Duos']);
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).not.toHaveBeenCalled();
    expect(q('.frmenu')).toBeNull();
    expect(document.body.querySelector('[title]')).toBeNull();
  });
});

describe('the friend menu actions', () => {
  it('Spectate watches through the existing Watch path', async () => {
    await runFriendMenu('spectate', friend('u-gus', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'run-gus' }));
    expect(net.watched).toEqual(['run-gus']);
  });

  it('Invite to lobby, not in a room: makes a NEW room first (the normal create flow), then invites into it', async () => {
    expect(await inviteToRoom('u-amy', 'versus')).toBe(true);
    expect(net.created).toEqual(["Me's room"]);
    expect(invites).toEqual([{ to: 'u-amy', kind: 'versus_room', target: 'new-room', proof: null }]);
  });

  it('…on a Cloudflare room: the invite carries the room\'s proof', async () => {
    (globalThis as { __host?: string }).__host = 'cf';
    expect(await inviteToRoom('u-amy', 'versus')).toBe(true);
    expect(invites).toEqual([{ to: 'u-amy', kind: 'versus_room', target: 'cf:new-room', proof: 'proof:new-room:u-amy:versus_room' }]);
  });

  it('Invite to Duos, not in a party: makes my party (Duo + Play), then invites; already in one: invites to it, no new party', async () => {
    expect(await inviteToRoom('u-amy', 'duos')).toBe(true);
    expect(net.parties).toEqual(["Me's party"]);
    expect(invites.at(-1)).toMatchObject({ kind: 'duos_party', target: 'new-party' });
    expect(await inviteToRoom('u-bob', 'duos')).toBe(true);
    expect(net.parties).toHaveLength(1);
    expect(invites.at(-1)).toMatchObject({ to: 'u-bob', kind: 'duos_party', target: 'new-party' });
  });

  it('already in an open Versus room: invites to it (no new room); mid-game: refused, nothing made, nothing sent', async () => {
    useVersus.setState({ room: { id: 'room-9', status: 'open', options: { v: 1, mode: 'duel', modifiers: [] }, members: [] } as never });
    expect(await inviteToRoom('u-amy', 'versus')).toBe(true);
    expect(net.created).toEqual([]);
    expect(invites.at(-1)).toMatchObject({ kind: 'versus_room', target: 'room-9' });
    inRun();
    invites = [];
    expect(await inviteToRoom('u-amy', 'versus')).toBe(false);
    expect(await inviteToRoom('u-amy', 'duos')).toBe(false);
    expect(invites).toEqual([]);
    expect(useFriends.getState().flash).toBe(`${FINISH_FIRST}.`);
  });

  it('Invite to spectate: my live game (no proof), my Supabase Versus room, my Cloudflare Ranked Duos room (proof, kind spectate)', async () => {
    inRun();
    expect(await inviteToSpectate('u-amy')).toBe(true);
    expect(invites.at(-1)).toEqual({ to: 'u-amy', kind: 'spectate', target: 'live:run-me', proof: null });
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    // A Cloudflare Ranked Duos match of mine: `duos:cf:<room>`, with the room's proof for kind spectate.
    useVersus.setState({
      room: { id: 'room-v', host: 'cf', status: 'in_game', options: { v: 1, mode: 'ranked_duos', modifiers: [] },
        members: [{ userId: ME, role: 'p1', displayName: 'Me' }, { userId: 'u-x', role: 'p2', displayName: 'X' }] } as never,
      match: { id: 'm1', phase: 'shop', round: 2 } as never,
    });
    expect(await inviteToSpectate('u-amy')).toBe(true);
    expect(invites.at(-1)).toEqual({ to: 'u-amy', kind: 'spectate', target: 'duos:cf:room-v', proof: 'proof:room-v:u-amy:spectate' });
    // The same match on Supabase: `duos:<room>`, no proof (Postgres checks it).
    useVersus.setState({ room: { ...useVersus.getState().room!, host: 'supabase' } as never });
    expect(await inviteToSpectate('u-amy')).toBe(true);
    expect(invites.at(-1)).toEqual({ to: 'u-amy', kind: 'spectate', target: 'duos:room-v', proof: null });
    useVersus.setState({ room: null, match: null });
    useGame.setState({ showTitle: true });
    expect(await inviteToSpectate('u-amy')).toBe(false); // no game of mine
  });

  it('accepting a spectate invite drops the friend into watching (live game; Versus room in the stands)', async () => {
    const inv = (target: string): FriendInvite => ({ id: 'x', kind: 'spectate', target, expiresAt: '', from: card('u-amy', 'Amy') });
    await acceptSpectateInvite(inv('live:run-amy'));
    expect(net.watched).toEqual(['run-amy']);
    await acceptSpectateInvite(inv('versus:cf:room-amy'));
    expect(net.joined).toEqual([['room-amy', 'spectator']]);
  });

  it('openFriendMenu reads the entries once, at open', () => {
    openFriendMenu(friend('u-amy', 'Amy', { status: 'online' }), 10, 10);
    expect(useFriendMenu.getState().entries.map((e) => e.id)).toEqual(['invite_lobby', 'invite_duos']);
  });
});
