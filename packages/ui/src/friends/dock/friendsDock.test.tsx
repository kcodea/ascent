// @vitest-environment jsdom
/**
 * THE FRIENDS DOCK (R-FRIENDS-DOCK-01 / -02) and THE FRIEND MENU (R-FRIENDS-MENU-01 / -02), with the network faked:
 *  - ONE dock on every screen (title, menu pages, hero select, a game), for an account and (a compact Sign in state) a
 *    guest; its badge is the beat's online count (no extra call); it keeps its state across screen changes;
 *  - open lists every friend (online, then in a game, then offline), reading the list while open and never while closed;
 *  - a friend opens their direct message panel (an empty conversation; with no friends hub in this build, the composer
 *    says messages are not available right now: R-DM-05);
 *  - a press outside closes BOTH panels in one motion and never reaches the game; Escape too, without the Esc menu;
 *  - the menu's entries per state, and each action: Spectate, Invite to lobby / Duos (an existing room, or a NEW one
 *    made first, on either host; mid-game disabled), Invite to spectate (my live game / Versus room, either host), and
 *    accepting a spectate invite drops the friend into watching.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
vi.mock('../../stage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stage')>()),
  stageViewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
  rectToStage: (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }),
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
import { DockSlot, useDockSlots } from './dockSlot';
import { DOCK_CLOSE_MS, resetDockForTests, useFriendsDock } from './dockStore';

const ME = '00000000-0000-0000-0000-000000000001';
const card = (id: string, author: string) => ({ userId: id, author, discriminator: '1234', avatar: null, favoriteHero: null, frame: null, skin: null });
const friend = (id: string, author: string, extra: Partial<Friend> = {}): Friend => ({ ...card(id, author), status: 'offline', lastSeen: null, ...extra });
const emptyList = (): FriendsList => ({ friends: [], incoming: [], outgoing: [], blocked: [], invites: [], sent: [], serverNow: new Date().toISOString() });

let lists = 0;
let harmed: string[] = [];
let invites: Array<{ to: string; kind: InviteKind; target: string; proof: string | null | undefined }> = [];
let list: FriendsList = emptyList();
function fakeRemote(): FriendsRemote {
  return {
    beat: async () => ({ friends: 3, online: 2, incoming: 0, invites: [], serverNow: new Date().toISOString() }),
    leave: () => true,
    list: async () => { lists++; return list; },
    invite: async (to: string, kind: InviteKind, target: string, proof?: string | null) => { invites.push({ to, kind, target, proof }); return { id: 'i1', kind, target, expiresAt: new Date(Date.now() + 120_000).toISOString() }; },
    remove: async (id: string) => { harmed.push(`remove:${id}`); },
    block: async (id: string) => { harmed.push(`block:${id}`); },
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
  lists = 0; invites = []; harmed = [];
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
  // An earlier test's catcher press armed swallowNextClick (eats the next click within 700 ms): spend it.
  act(() => { document.body.click(); });
});
afterEach(() => { ui?.unmount(); ui = null; resetDockForTests(); resetFriendsForTests(); setIdentity(null); });

describe('the dock (R-FRIENDS-DOCK-01)', () => {
  it('shows on EVERY screen: the title, a menu page, hero select, a game; a guest gets the compact Sign in state', async () => {
    ui = mount(<FriendsDock />);
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toBe('Friends, 2 online'); // the title
    expect(q('.fdock-count')?.textContent).toBe('2');
    expect(q('.fdock-btn.ingame')).toBeNull();
    act(() => { useGame.setState({ showTitle: true, showCareer: true }); });
    expect(q('.fdock-btn')).not.toBeNull(); // a ladder page
    act(() => { useGame.setState({ showCareer: false, showTitle: false, heroChoices: [] as never }); });
    expect(q('.fdock-btn')).not.toBeNull(); // hero select
    act(() => inRun());
    expect(q('.fdock-btn.ingame')).not.toBeNull(); // a game: tucked under the hero's Health plate
    act(() => { useGame.setState({ account: { userId: ME, email: null, anonymous: true, discriminator: null } }); });
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toBe('Friends'); // a guest: no counts
    click(q('.fdock-btn'));
    await flush();
    expect(q('.fdock-guest')?.textContent).toContain('Sign in to add friends.');
    expect(lists).toBe(0);
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('keeps its state across screen changes: open and the open message survive title -> menu page -> game -> title', async () => {
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    expect(q('.fdock-dm')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    act(() => { useGame.setState({ showCareer: true }); });
    act(() => inRun());
    expect(useFriendsDock.getState()).toMatchObject({ phase: 'open', dmWith: 'u-amy' });
    expect(q('.fdock-dm')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    act(() => { useGame.setState({ showTitle: true, showCareer: false }); });
    expect(q('.fdock-dm')).not.toBeNull();
    expect(lists).toBe(1); // the same instance throughout: one read, not one per screen
  });

  it('closed renders only the button and reads nothing; open lists every friend; click again collapses', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    await flush();
    expect(q('.fdock-stack')).toBeNull();
    expect(lists).toBe(0);
    click(q('.fdock-btn'));
    await flush();
    expect(lists).toBe(1);
    const names = [...document.body.querySelectorAll('.fdock-list .fr-name')].map((n) => n.textContent);
    expect(names).toEqual(['Amy#1234', 'Gus#1234', 'Oli#1234']); // online, then in a game, then offline
    expect(q('.fdock-sub')?.textContent).toBe('2 online');
    click(q('.fdock-btn'));
    expect(useFriendsDock.getState().phase).toBe('closing');
    expect(q('.fdock-stack.closing')).not.toBeNull();
    await waitClose();
    expect(q('.fdock-stack')).toBeNull();
  });

  it('a friend opens their direct message panel: header, empty conversation, composer (unavailable with no hub); another friend swaps it', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    expect(q('.fdock-dm')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    const input = q('.fdock-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Messages are not available right now.');
    expect(q('.fdock-convo')?.textContent).toBe('No messages yet. Say hi to Amy#1234.');
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
  // Remove friend + Block always close the list (asserted in R-FRIENDS-MENU-03 below), so these cases read the rest.
  const ids = (f: Friend, ctx: FriendMenuContext) => friendMenuEntries(f, ctx).filter((e) => !e.confirm).map((e) => (e.disabled ? `${e.id}(${e.disabled})` : e.id));
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
    expect(items.map((b) => b.querySelector('.frmenu-label')?.textContent)).toEqual(['Invite to lobby', 'Invite to Duos', 'Invite to spectate', 'Remove friend', 'Block']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    expect(items[0]!.textContent).toContain(FINISH_FIRST);
    expect(useFriendsDock.getState().dmWith).toBeNull(); // right-click is not a click: no DM
    press(q('.frmenu-catch'));
    expect(q('.frmenu')).toBeNull();
    expect(useFriendsDock.getState().phase).toBe('closing');
  });
});

describe('the friend menu from the dock on the main menu', () => {
  it('right-click on a row opens the same menu; Escape closes it without opening the Esc menu', async () => {
    ui = mount(<><FriendsDock /><FriendMenu /></>);
    click(q('.fdock-btn'));
    await flush();
    const row = q('.fdock-rowmain[aria-label="Message Gus#1234"]')!;
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    expect([...document.body.querySelectorAll('.frmenu-label')].map((n) => n.textContent)).toEqual(['Spectate', 'Remove friend', 'Block']);
    const amy = q('.fdock-rowmain[aria-label="Message Amy#1234"]')!;
    act(() => { amy.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    expect([...document.body.querySelectorAll('.frmenu-label')].map((n) => n.textContent)).toEqual(['Invite to lobby', 'Invite to Duos', 'Remove friend', 'Block']);
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
    expect(useFriendMenu.getState().entries.map((e) => e.id)).toEqual(['invite_lobby', 'invite_duos', 'remove', 'block']);
  });
});

describe('Remove friend and Block live in the menu, never on the row (R-FRIENDS-MENU-03)', () => {
  const free: FriendMenuContext = { versus: true, inGame: false, playing: false, room: null, spectate: null };

  it('every friend menu ends with Remove friend then Block, whatever their status or mine', () => {
    for (const f of [friend('u', 'Oli'), friend('u', 'Amy', { status: 'online' }), friend('u', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'r' })]) {
      for (const ctx of [free, { ...free, inGame: true, playing: true }, { ...free, versus: false }]) {
        const e = friendMenuEntries(f, ctx);
        expect(e.slice(-2).map((x) => [x.id, x.label, !!x.disabled])).toEqual([['remove', 'Remove friend', false], ['block', 'Block', false]]);
      }
    }
  });

  it('the dock rows show no Remove or Block button; the menu sets them apart and each asks once more before it acts', async () => {
    // An earlier test's catcher press armed swallowNextClick (eats the next click within 700 ms): spend it here.
    act(() => { document.body.click(); });
    ui = mount(<><FriendsDock /><FriendMenu /></>);
    click(q('.fdock-btn'));
    await flush();
    const rows = [...document.body.querySelectorAll('.fdock-list .fdock-row')];
    expect(rows.length).toBe(3);
    for (const r of rows) expect([...r.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Remove');
    for (const r of rows) expect([...r.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Block');
    const oli = rows.find((r) => r.textContent?.includes('Oli#1234'))!.querySelector('.fdock-rowmain')!;
    act(() => { oli.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    // An offline friend: only the two, behind the divider.
    expect([...document.body.querySelectorAll('.frmenu > *')].map((n) => n.className.split(' ')[0])).toEqual(['atip-title', 'frmenu-sep', 'frmenu-item', 'frmenu-item']);
    const item = (label: string) => [...document.body.querySelectorAll('.frmenu-item')].find((b) => b.textContent?.startsWith(label)) as HTMLElement;
    click(item('Remove friend'));
    expect(harmed).toEqual([]); // first press only arms it
    expect(q('.frmenu')).not.toBeNull();
    expect(item('Remove? Press again').classList.contains('frmenu-armed')).toBe(true);
    click(item('Remove? Press again'));
    await flush();
    expect(harmed).toEqual(['remove:u-off']);
    expect(q('.frmenu')).toBeNull();
    // Block, the same two presses; closing the menu in between disarms it.
    act(() => { oli.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    click(item('Block'));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    act(() => { oli.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); });
    expect(item('Block')).toBeTruthy();
    click(item('Block'));
    click(item('Block? Press again'));
    await flush();
    expect(harmed).toEqual(['remove:u-off', 'block:u-off']);
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('in the dock: Block from the menu keeps the dock open (it is not a trip somewhere)', async () => {
    inRun();
    ui = mount(<><FriendsDock /><FriendMenu /></>);
    click(q('.fdock-btn'));
    await flush();
    const row = q('.fdock-rowmain[aria-label="Message Amy#1234"]')!;
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 })); });
    const item = (label: string) => [...document.body.querySelectorAll('.frmenu-item')].find((b) => b.textContent?.startsWith(label)) as HTMLElement;
    click(item('Block'));
    click(item('Block? Press again'));
    await flush();
    expect(harmed).toEqual(['block:u-amy']);
    expect(useFriendsDock.getState().phase).toBe('open');
  });
});

describe('placement: bottom left, clear of each screen\'s corner furniture (R-FRIENDS-DOCK-02)', () => {
  // jsdom has no layout: the headless screenshot pass (devlog 2026-10-29-friends-dock-global) measured these; this pins
  // the contract so a later edit cannot quietly move the dock back over the Health plate or the Settings plaque.
  const css = readFileSync(join(__dirname, 'friendsDock.css'), 'utf8');
  it('the button, the panels and the toast anchor LEFT, never right', () => {
    expect(css).toMatch(/\.fdock-btn \{ position: fixed; left: calc\(var\(--edge-l\) \+ var\(--fdock-x\)\); bottom: calc\(var\(--edge-b\) \+ var\(--fdock-y\)\);/);
    expect(css).toMatch(/\.fdock-stack \{[^}]*left: calc\(var\(--edge-l\) \+ var\(--fdock-x\)\)/);
    expect(css).not.toMatch(/\.fdock-(btn|stack) \{[^}]*right:/);
  });
  it('in a game it tucks in smaller and lower, counts beside it (never above, where the Health plate is)', () => {
    expect(css).toContain('.fdock-btn.ingame, .fdock-stack.ingame, .dm-toast.ingame { --fdock-cb: calc(32 * var(--u)); --fdock-x: 10px; --fdock-y: 5px; }');
    expect(css).toMatch(/\.fdock-btn\.ingame \.fdock-chips \{ inset: auto; left: calc\(100% \+ 5px\)/);
  });
  it('on a menu the button lives in the layout own slot (in flow), and nothing pushes the footer or the side menu', () => {
    expect(css).toContain('.fdock-btn.inslot { position: relative; left: auto; bottom: auto;');
    expect(css).not.toMatch(/data-fdock|\.titlefoot|\.msb \{/);
  });
  it('layers above the menu pages (470) and under the friend menu (490) and the Settings veil (500)', () => {
    const z = (sel: string): number => {
      const at = css.indexOf(`${sel} {`);
      const rule = css.slice(at, css.indexOf('}', at));
      return Number(/z-index: (\d+)/.exec(rule)?.[1]);
    };
    for (const sel of ['.fdock-btn', '.fdock-catch', '.fdock-stack']) { expect(z(sel)).toBeGreaterThan(470); expect(z(sel)).toBeLessThan(490); }
  });
});

describe('a menu own corner space (R-FRIENDS-DOCK-03: "looks like friends moved over the menus and stuff")', () => {
  // The owner's report came from a near-square window (1191x1147). The real-browser sweep (devlog) measured every
  // screen at these sizes; here the anchor maths is pinned at each: the panel opens RIGHT of the menu column (never
  // over its buttons), its bottom on the slot's, and it is never wider or taller than the room left (never clipped).
  const SIZES: Array<[number, number]> = [[1191, 1147], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1920, 1200], [2560, 1080], [1024, 1366], [800, 600], [844, 390], [667, 375]];
  const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => null }) as DOMRect;
  afterEach(() => { useDockSlots.setState({ slots: [] }); });

  it('the button is portalled INTO the slot (in flow), the last mounted slot wins, and with none it keeps the fixed corner', async () => {
    ui = mount(<><div className="msb"><DockSlot className="msb-dock" side=".msb" /></div><FriendsDock /></>);
    expect(q('.msb-dock > .fdock-btn.inslot')).not.toBeNull();
    act(() => { useDockSlots.setState({ slots: [] }); });
    expect(q('.fdock-btn.inslot')).toBeNull();
    expect(q('.fdock-btn')).not.toBeNull(); // the fixed corner (a game, hero select)
  });

  for (const [w, h] of SIZES) {
    it(`${w}x${h}: the panel opens beside the side menu, inside the window`, async () => {
      Object.assign(window, { innerWidth: w, innerHeight: h });
      ui = mount(<><aside className="msb"><DockSlot className="msb-dock" side=".msb" /></aside><FriendsDock /></>);
      const rail = q('.msb')!; const slot = q('.msb-dock')!;
      const railW = Math.round(Math.min(260, w * 0.28));
      rail.getBoundingClientRect = () => rect(0, 0, railW, h);
      slot.getBoundingClientRect = () => rect(16, h - 64, 40, 40);
      click(q('.fdock-btn'));
      await flush();
      const st = q('.fdock-stack.beside')!;
      const left = parseFloat(st.style.left); const bottom = parseFloat(st.style.bottom);
      expect(left).toBeGreaterThan(railW); // never over the side menu's plaques
      expect(bottom).toBe(24); // its bottom on the slot's bottom
      expect(parseFloat(st.style.maxWidth)).toBeLessThanOrEqual(w - left);
      expect(parseFloat(st.style.getPropertyValue('--fdock-maxh'))).toBeLessThanOrEqual(h - bottom);
    });
  }
});
