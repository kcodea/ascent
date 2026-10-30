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
const net = vi.hoisted(() => ({ live: true, failWatch: false, created: [] as string[], parties: [] as string[], watched: [] as string[], joined: [] as Array<[string, string]>, replaysEnded: 0 }));
vi.mock('../../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('../../live/livePublisher', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../live/livePublisher')>()), liveEligible: () => net.live }));
vi.mock('../../live/liveWatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../live/liveWatch')>()),
  watchLiveGame: vi.fn(async (id: string) => { net.watched.push(id); return !net.failWatch; }),
}));
vi.mock('../../replay/replayPlayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../replay/replayPlayer')>()),
  endReplay: vi.fn(() => { net.replaysEnded++; }),
}));
vi.mock('../../stage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stage')>()),
  stageViewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
  rectToStage: (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }),
}));
vi.mock('../../versus/versusFlag', () => ({ versusEnabled: () => true }));
vi.mock('../../versus/versusStore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../versus/versusStore')>();
  const room = (id: string, mode: string) => ({
    id, status: 'open', options: { v: 1, mode, modifiers: [] }, members: [{ userId: '00000000-0000-0000-0000-000000000001', role: 'p1', displayName: 'Me' }],
  });
  return {
    ...orig,
    openVersus: vi.fn(() => undefined),
    createRoom: vi.fn(async (name: string) => { net.created.push(name); orig.useVersus.setState({ room: room('new-room', 'duel') as never }); }),
    enterDuosParty: vi.fn(async (name: string) => { net.parties.push(name); orig.useVersus.setState({ room: room('new-party', 'ranked_duos') as never }); }),
    joinRoom: vi.fn(async (id: string, as: string) => { net.joined.push([id, as]); orig.useVersus.setState({ room: { ...room(id, 'duel'), status: 'in_game' } as never }); }),
  };
});

import { useGame } from '../../store';
import { setIdentity } from '../../identity';
import { useVersus } from '../../versus/versusStore';
import { resetFriendsForTests, setFriendsRemoteForTests, setInviteProofSourceForTests, useFriends } from '../friendsStore';
import type { Friend, FriendInvite, FriendsList, FriendsRemote, InviteKind } from '../friendsRemote';
import { PAGES_CLOSED } from '../../store';
import { acceptSpectateInvite, FINISH_FIRST, friendMenuEntries, inviteToRoom, inviteToSpectate, runFriendMenu, type FriendMenuContext } from '../friendsGo';
import { FriendMenu, openFriendMenu, useFriendMenu } from '../FriendMenu';
import { dockCorner, FriendsDock } from './FriendsDock';
import { chatTabOrder } from '../dm/ChatWindow';
import { useDm } from '../dm/dmStore';
import {
  CHAT_MAX_H, CHAT_MAX_W, CHAT_MIN_H, CHAT_MIN_W, clampChatGeom, defaultChatGeom, moveChatGeom, resetChatWindowForTests, resizeChatGeom, setChatPinned, useChatWindow, type ChatGeom,
} from '../dm/chatWindowPrefs';
import { DOCK_CLOSE_MS, openDm, resetDockForTests, useFriendsDock } from './dockStore';

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
  Object.assign(net, { live: true, failWatch: false, created: [], parties: [], watched: [], joined: [], replaysEnded: 0 });
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
    expect(q('.fdock-btn')?.className).toBe('fdock-btn gtip'); // slot 3, left of Rules
    act(() => { useGame.setState({ showTitle: true, showCareer: true }); });
    expect(q('.fdock-btn.corner')).not.toBeNull(); // a ladder page covers the corner row: the corner itself
    act(() => { useGame.setState({ showCareer: false, showTitle: false, heroChoices: [] as never }); });
    expect(q('.fdock-btn.corner')).not.toBeNull(); // hero select lies over the row too
    act(() => inRun());
    expect(q('.fdock-btn')?.className).toBe('fdock-btn gtip'); // a game: slot 3 again, the same plaque as the row
    act(() => { useGame.setState({ account: { userId: ME, email: null, anonymous: true, discriminator: null } }); });
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toBe('Friends'); // a guest: no counts
    click(q('.fdock-btn'));
    await flush();
    expect(q('.fdock-guest')?.textContent).toContain('Sign in to add friends.');
    expect(lists).toBe(0);
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('keeps its state across screen changes: the open chat survives title -> menu page -> game -> title', async () => {
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    act(() => { useGame.setState({ showCareer: true }); });
    act(() => inRun());
    expect(useFriendsDock.getState()).toMatchObject({ dmWith: 'u-amy', chatTabs: ['u-amy'] });
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    expect(q('.dmchat-veil.ingame')).not.toBeNull(); // in a game the veil barely dims
    act(() => { useGame.setState({ showTitle: true, showCareer: false }); });
    expect(q('.dmchat-pane')).not.toBeNull();
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

  it('a friend opens the CHAT WINDOW in the middle (R-DM-CHAT-01): the list collapses; header, empty conversation, composer (unavailable with no hub)', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    expect(q('.dmchat[role="dialog"]')).not.toBeNull();
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Amy#1234');
    expect(useFriendsDock.getState().phase).toBe('closing'); // one surface at a time
    const input = q('.fdock-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Messages are not available right now.');
    expect((q('.dm-send') as HTMLButtonElement).disabled).toBe(true);
    expect(q('.fdock-convo')?.textContent).toBe('No messages yet. Say hi to Amy#1234.');
    expect(document.body.querySelector('[title]')).toBeNull();
  });

  it('every conversation is a tab: opening another friend adds one; a tab switches; closing a tab picks its neighbour; the last closes the window', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Amy#1234"]'));
    await waitClose();
    click(q('.fdock-btn'));
    await flush();
    click(q('.fdock-rowmain[aria-label="Message Gus#1234"]'));
    const tabs = (): string[] => [...document.body.querySelectorAll('.dmchat-tab')].map((t) => `${t.querySelector('.dmchat-tabname')?.textContent}${t.classList.contains('on') ? '*' : ''}`);
    expect(tabs()).toEqual(['Amy#1234', 'Gus#1234*']);
    expect(q('.dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Gus#1234');
    expect(q('.dmchat-pane')?.textContent).toContain('Watch'); // the header keeps Watch
    click(q('.dmchat-tabmain[aria-label="Amy#1234"]'));
    expect(tabs()).toEqual(['Amy#1234*', 'Gus#1234']);
    click(q('.dmchat-tabx[aria-label="Close the conversation with Amy#1234"]'));
    expect(tabs()).toEqual(['Gus#1234*']);
    click(q('.dmchat-tabx[aria-label="Close the conversation with Gus#1234"]'));
    expect(q('.dmchat-veil')).toBeNull();
    expect(useFriendsDock.getState()).toMatchObject({ dmWith: null, chatTabs: [] });
  });

  it('the chat closes on its close button, Escape (never the Esc menu) and a press on the veil (never the game); its tabs stay', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    click(q('.dmchat-close'));
    expect(q('.dmchat-veil')).toBeNull();
    act(() => openDm('u-amy'));
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).not.toHaveBeenCalled();
    expect(q('.dmchat-veil')).toBeNull();
    act(() => openDm('u-amy'));
    const game = vi.fn();
    window.addEventListener('pointerdown', game);
    press(q('.dmchat'));
    expect(q('.dmchat-veil')).not.toBeNull(); // a press inside the window keeps it
    press(q('.dmchat-veil'));
    window.removeEventListener('pointerdown', game);
    expect(game).toHaveBeenCalledTimes(1); // only the press inside the window bubbled on
    expect(q('.dmchat-veil')).toBeNull();
    expect(useFriendsDock.getState().chatTabs).toEqual(['u-amy']);
  });

  it('a press outside closes the list in one motion, and never reaches the game underneath', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
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
    expect(q('.fdock-stack.closing .fdock-list')).not.toBeNull();
    await waitClose();
    expect(useFriendsDock.getState()).toMatchObject({ phase: 'closed', dmWith: null });
    expect(q('.fdock-catch')).toBeNull();
  });

  it('Escape closes the list, and the same press does not reach the Esc menu', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    click(q('.fdock-btn'));
    await flush();
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).not.toHaveBeenCalled();
    expect(useFriendsDock.getState().phase).toBe('closing');
    await waitClose();
    expect(useFriendsDock.getState().phase).toBe('closed');
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
    // Every room is on the Versus Worker (R-VERSUS-CF-ONLY-01): `cf:<room>`, with the room's signed proof.
    expect(invites).toEqual([{ to: 'u-amy', kind: 'versus_room', target: 'cf:new-room', proof: 'proof:new-room:u-amy:versus_room' }]);
  });

  it('Invite to Duos, not in a party: makes my party (Duo + Play), then invites; already in one: invites to it, no new party', async () => {
    expect(await inviteToRoom('u-amy', 'duos')).toBe(true);
    expect(net.parties).toEqual(["Me's party"]);
    expect(invites.at(-1)).toMatchObject({ kind: 'duos_party', target: 'cf:new-party' });
    expect(await inviteToRoom('u-bob', 'duos')).toBe(true);
    expect(net.parties).toHaveLength(1);
    expect(invites.at(-1)).toMatchObject({ to: 'u-bob', kind: 'duos_party', target: 'cf:new-party' });
  });

  it('already in an open Versus room: invites to it (no new room); mid-game: refused, nothing made, nothing sent', async () => {
    useVersus.setState({ room: { id: 'room-9', status: 'open', options: { v: 1, mode: 'duel', modifiers: [] }, members: [] } as never });
    expect(await inviteToRoom('u-amy', 'versus')).toBe(true);
    expect(net.created).toEqual([]);
    expect(invites.at(-1)).toMatchObject({ kind: 'versus_room', target: 'cf:room-9' });
    inRun();
    invites = [];
    expect(await inviteToRoom('u-amy', 'versus')).toBe(false);
    expect(await inviteToRoom('u-amy', 'duos')).toBe(false);
    expect(invites).toEqual([]);
    expect(useFriends.getState().flash).toBe(`${FINISH_FIRST}.`);
  });

  it('Invite to spectate: my live game (no proof), my Ranked Duos room (the room proof, kind spectate)', async () => {
    inRun();
    expect(await inviteToSpectate('u-amy')).toBe(true);
    expect(invites.at(-1)).toEqual({ to: 'u-amy', kind: 'spectate', target: 'live:run-me', proof: null });
    setIdentity({ userId: ME, displayName: 'Me', anonymous: false, email: 'a@b.c' });
    // A Ranked Duos match of mine: `duos:cf:<room>`, with the room's proof for kind spectate.
    useVersus.setState({
      room: { id: 'room-v', status: 'in_game', options: { v: 1, mode: 'ranked_duos', modifiers: [] },
        members: [{ userId: ME, role: 'p1', displayName: 'Me' }, { userId: 'u-x', role: 'p2', displayName: 'X' }] } as never,
      match: { id: 'm1', phase: 'shop', round: 2 } as never,
    });
    expect(await inviteToSpectate('u-amy')).toBe(true);
    expect(invites.at(-1)).toEqual({ to: 'u-amy', kind: 'spectate', target: 'duos:cf:room-v', proof: 'proof:room-v:u-amy:spectate' });
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

describe('placement: bottom right, the fourth square of the corner row (R-FRIENDS-DOCK-05)', () => {
  // jsdom has no layout: the headless screenshot pass (devlog 2026-10-29-friends-dock-bottom-right) measured these at
  // 1280x720, 1920x1080, 1191x1147 and a phone; this pins the contract so a later edit cannot quietly move it again.
  const css = readFileSync(join(__dirname, 'friendsDock.css'), 'utf8');
  const styles = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
  it('the button anchors RIGHT and BOTTOM on the corner row\'s own numbers, one slot left of Rules, never left', () => {
    expect(css).toContain('.fdock-btn, .fdock-stack, .dm-toast { --fdock-cb: calc(40 * var(--u)); --fdock-slot: 3; --fdock-pad: 6px;');
    expect(css).toContain('--fdock-r: calc(var(--edge-r) + 16px + var(--fdock-slot) * (var(--fdock-cb) + 10px)); --fdock-b: calc(var(--edge-b) + 16px); }');
    expect(css).toMatch(/\.fdock-btn \{ position: fixed; right: var\(--fdock-r\); bottom: var\(--fdock-b\);/);
    expect(css).not.toMatch(/\.fdock-(btn|stack) \{[^}]*left:/);
    // The row it joins: gear 0, Compendium 1, Rules 2 (each 40u + 10 px, 16 px in), so slot 3 is the next square.
    expect(styles).toContain('.rulesbtn { right: calc(var(--edge-r) + 16px + 2 * (40 * var(--u) + 10px)); }');
    // The dev squares (dev builds only, R-DEV-CORNER-01) queue up after it: slot 4 and 5 on the same numbers.
    expect(styles).toContain('right: calc(var(--edge-r) + 16px + var(--cd-slot) * (var(--cd-cb) + 10px)); bottom: calc(var(--edge-b) + 16px);');
  });
  it('it takes the corner itself where the row is covered: hero select, a side-menu page, the in-game menu', () => {
    const base = { ...PAGES_CLOSED, gameMenuOpen: false, heroChoices: null } as Parameters<typeof dockCorner>[0];
    expect(dockCorner(base)).toBe('');
    expect(dockCorner({ ...base, heroChoices: [] as never })).toBe('corner');
    for (const page of ['showCareer', 'showRankings', 'showLeaderboard', 'showRecentGames', 'showLiveGames', 'showCollection', 'settingsOpen', 'showPatchNotes'] as const) {
      expect(dockCorner({ ...base, [page]: true })).toBe('corner');
    }
    expect(dockCorner({ ...base, gameMenuOpen: true })).toBe('corner');
    expect(css).toContain(':is(.fdock-btn, .fdock-stack, .dm-toast).corner { --fdock-slot: 0; }');
    // A phone in a game: the zoomed row's own design offsets (touchUi.css: gear 1897, book 1823, rules 1749; 66 px).
    expect(css).toContain('--fdock-r: calc(var(--pz-bxr) + 1920px - 1675px); --fdock-b: calc(var(--pz-safe-b, var(--safe-b)) + 15px); }');
  });
  it('the panel grows out of the button: its bottom-right corner on the button\'s, scaling from that corner, never past the window', () => {
    expect(css).toMatch(/\.fdock-stack \{ position: fixed; z-index: 486; right: calc\(var\(--fdock-r\) - var\(--fdock-pad\)\); bottom: calc\(var\(--fdock-b\) - var\(--fdock-pad\)\);/);
    expect(css).toMatch(/\.fdock-stack \{[^}]*transform-origin: 100% 100%;/);
    expect(css).toMatch(/max-width: calc\(var\(--lvw, 100vw\) - var\(--fdock-r\) - 12px\)/);
    // One-shot transform + opacity only, both ways; nothing loops.
    expect(css).toContain('@keyframes fdockin { from { opacity: 0; transform: scale(0.12); } 40% { opacity: 1; } }');
    expect(css).toContain('@keyframes fdockout { 60% { opacity: 1; } to { opacity: 0; transform: scale(0.12); } }');
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.fdock-stack, \.fdock-stack\.closing \{ animation-duration: 0\.01s; \}/);
  });
  it('no per-menu slot remains: the side menu and the title carry no dock home of their own', () => {
    const title = readFileSync(join(__dirname, '..', '..', 'Title.tsx'), 'utf8');
    const sidebar = readFileSync(join(__dirname, '..', '..', 'MenuSidebar.tsx'), 'utf8');
    expect(title).not.toContain('DockSlot');
    expect(sidebar).not.toContain('DockSlot');
    expect(css).not.toMatch(/\.fdock-slot|title-dock|msb-dock|\.beside/);
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

describe('the button expands into the list (R-FRIENDS-DOCK-05: "expand into the list/collapse back down")', () => {
  it('open: one panel whose title bar runs along its foot and ends in the room the button sits in; the button turns into a collapse chevron', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    const btn = q('.fdock-btn')!;
    expect(btn.querySelector('.fdock-chips')).not.toBeNull(); // closed: the counts on its corners
    click(btn);
    await flush();
    const panel = q('.fdock-stack > .fdock-list')!;
    expect(panel.lastElementChild?.classList.contains('fdock-bar')).toBe(true); // the title bar is the panel's foot
    expect([...panel.lastElementChild!.children].map((c) => c.className)).toEqual(['fdock-title', 'fdock-sub', 'fdock-me', 'fdock-btnroom']);
    expect(q('.fdock-btn')?.getAttribute('aria-label')).toBe('Friends, 2 online. Collapse');
    expect(q('.fdock-btn')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('.fdock-btn .fdock-chips')).toBeNull(); // the bar says it
    expect(q('.fdock-btn')?.hasAttribute('data-tip')).toBe(false);
    click(q('.fdock-btn'));
    expect(q('.fdock-stack.closing')).not.toBeNull(); // sinks back into the button
    await waitClose();
    expect(q('.fdock-stack')).toBeNull();
    expect(q('.fdock-btn .fdock-chips')).not.toBeNull();
    expect(document.body.querySelector('[title]')).toBeNull();
  });
});

/**
 * DOCK WATCH ENTERS THE GAME (owner 2026-10-29: "clicking watch from friends list doesnt bring the player into the game,
 * the game happens behind the screen but they are never actually brought in"; R-WATCH-ENTERS-01). The dock's Watch
 * joined the game but only closed the Live Games page, so from Career, Recent Games or any other page the page stayed
 * painted over the watch. Now every Watch runs Live Games' own path (`watchGame`), which closes every page over it.
 */
describe('dock Watch brings me INTO the game from every screen (R-WATCH-ENTERS-01)', () => {
  const SCREENS: Array<[string, Record<string, unknown>]> = [
    ['the title', {}],
    ['Career', { showCareer: true }],
    ['Recent Games', { showRecentGames: true }],
    ['Live Games', { showLiveGames: true }],
    ['Rankings', { showRankings: true }],
    ['the Hall', { showLeaderboard: true }],
    ['Collection', { showCollection: true }],
    ['the Practice setup', { practiceSetupOpen: true }],
    ['Settings', { settingsOpen: true }],
    ['the in-game menu', { gameMenuOpen: true }],
    ['hero select', { showTitle: false, heroChoices: [] }],
  ];
  const overWatch = (): Record<string, unknown> => {
    const g = useGame.getState() as unknown as Record<string, unknown>;
    return Object.fromEntries([...Object.keys(PAGES_CLOSED), 'practiceSetupOpen', 'gameMenuOpen'].map((k) => [k, g[k]]));
  };
  const closed = { ...PAGES_CLOSED, practiceSetupOpen: false, gameMenuOpen: false };

  for (const [name, screen] of SCREENS) {
    for (const kind of ['live', 'versus'] as const) {
      it(`${name}: Watch on a friend in a ${kind === 'live' ? 'lobby / Practice' : 'Versus'} game joins it and closes every page over it`, async () => {
        list = { ...emptyList(), friends: [friend('u-gus', 'Gus', { status: 'in_game', mode: kind === 'live' ? 'practice' : 'versus', watchKind: kind, watchId: kind === 'live' ? 'run-gus' : 'cf:room-gus' })] };
        useGame.setState(screen as never);
        ui = mount(<FriendsDock />);
        click(q('.fdock-btn'));
        await flush();
        click(q('.fdock-rowmain[aria-label="Message Gus#1234"]'));
        click(q('button[aria-label="Watch Gus#1234"]'));
        await flush();
        if (kind === 'live') expect(net.watched).toEqual(['run-gus']);
        else expect(net.joined).toEqual([['room-gus', 'spectator']]);
        expect(overWatch()).toEqual(closed);
      });
    }
  }

  it('a replay being viewed is left first; a failed join leaves the page where it was', async () => {
    useGame.setState({ replaySession: {} as never, showRecentGames: true });
    expect(await runFriendMenu('spectate', friend('u-gus', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'run-gus' }))).toBe(true);
    expect(net.replaysEnded).toBe(1);
    expect(useGame.getState().showRecentGames).toBe(false);
    useGame.setState({ replaySession: null, showCareer: true });
    net.failWatch = true;
    expect(await runFriendMenu('spectate', friend('u-gus', 'Gus', { status: 'in_game', watchKind: 'live', watchId: 'run-gus' }))).toBe(false);
    expect(useGame.getState().showCareer).toBe(true);
  });

  it("Live Games' own Watch and the friend Watch are ONE path (no second implementation)", () => {
    const src = readFileSync(join(__dirname, '../../live/LiveGames.tsx'), 'utf8');
    expect(src).toMatch(/watchGame\(liveWatchTargetOf\(/);
    expect(src).not.toMatch(/watchLiveGame\(|goToVersusRoom\(/);
  });
});

describe('the chat window tabs (R-DM-CHAT-01: "tabs that hold all conversations")', () => {
  const fl = [{ userId: 'u-amy' }, { userId: 'u-gus' }, { userId: 'u-oli' }];
  it('the conversations opened this session, in the order opened, then friends with unread messages; never a removed friend', () => {
    expect(chatTabOrder(['u-gus', 'u-amy'], {}, fl)).toEqual(['u-gus', 'u-amy']);
    expect(chatTabOrder(['u-gus'], { 'u-oli': 2, 'u-gus': 1, 'u-amy': 0 }, fl)).toEqual(['u-gus', 'u-oli']);
    expect(chatTabOrder(['u-gone', 'u-amy'], { 'u-left': 3 }, fl)).toEqual(['u-amy']);
    expect(chatTabOrder(['U-AMY'], { 'u-amy': 1 }, fl)).toEqual(['u-amy']); // one tab per friend, any case
  });

  it('a friend with unread messages gets a tab with the count; closing it reads them', async () => {
    useDm.setState({ unread: { 'u-gus': 2 } });
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    const tabs = [...document.body.querySelectorAll('.dmchat-tabmain')].map((t) => t.getAttribute('aria-label'));
    expect(tabs).toEqual(['Amy#1234', 'Gus#1234, 2 unread']);
    click(q('.dmchat-tabx[aria-label="Close the conversation with Gus#1234"]'));
    expect(useDm.getState().unread['u-gus']).toBeUndefined();
    expect([...document.body.querySelectorAll('.dmchat-tabmain')].map((t) => t.getAttribute('aria-label'))).toEqual(['Amy#1234']);
    useDm.setState({ unread: {} });
  });
});

/**
 * THE CHAT WINDOW MOVES, RESIZES AND PINS (owner 2026-10-29, R-DM-CHAT-02: "let me move the chat panel around, resize
 * it, and pin it so that it stays while i play if i want it up").
 */
describe('the chat window moves, resizes and pins (R-DM-CHAT-02)', () => {
  const KEY = 'ascent.chatWindow.v1';
  const frame = (): HTMLElement => q('.dmchat-at')!;
  const vars = (): ChatGeom => {
    const st = frame().style;
    return { x: parseFloat(st.getPropertyValue('--dmx')), y: parseFloat(st.getPropertyValue('--dmy')), w: parseFloat(st.getPropertyValue('--dmw')), h: parseFloat(st.getPropertyValue('--dmh')) };
  };
  const ptr = (el: Element, type: string, x: number, y: number): void => {
    act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); });
  };
  beforeEach(() => {
    Object.assign(window, { innerWidth: 1600, innerHeight: 900 });
    try { localStorage.removeItem(KEY); } catch { /* */ }
    resetChatWindowForTests();
  });
  afterEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* */ }
    resetChatWindowForTests();
    document.documentElement.removeAttribute('data-touch-ui');
    document.documentElement.removeAttribute('data-touch-small');
  });

  it('the geometry: centred by default, kept inside the screen, min / max sizes, the opposite edge stays put', () => {
    expect(defaultChatGeom(1600, 900)).toEqual({ x: 320, y: 90, w: 960, h: 720 });
    expect(clampChatGeom({ x: 1500, y: -40, w: 960, h: 720 }, 1600, 900)).toEqual({ x: 1600 - 8 - 960, y: 8, w: 960, h: 720 });
    expect(clampChatGeom({ x: 0, y: 0, w: 100, h: 100 }, 1600, 900)).toMatchObject({ w: CHAT_MIN_W, h: CHAT_MIN_H });
    expect(clampChatGeom({ x: 0, y: 0, w: 5000, h: 5000 }, 1600, 900)).toMatchObject({ w: 1584, h: 884 }); // never bigger than the screen
    expect(clampChatGeom({ x: 0, y: 0, w: 5000, h: 5000 }, 3840, 2160)).toMatchObject({ w: CHAT_MAX_W, h: CHAT_MAX_H });
    // A screen that shrank: the window comes back inside it.
    expect(clampChatGeom({ x: 900, y: 500, w: 700, h: 380 }, 1280, 720)).toEqual({ x: 1280 - 8 - 700, y: 720 - 8 - 380, w: 700, h: 380 });
    const g = { x: 400, y: 200, w: 700, h: 500 };
    expect(moveChatGeom(g, 100, -50, 1600, 900)).toEqual({ x: 500, y: 150, w: 700, h: 500 });
    expect(moveChatGeom(g, -900, 900, 1600, 900)).toEqual({ x: 8, y: 900 - 8 - 500, w: 700, h: 500 });
    expect(resizeChatGeom(g, 'se', 120, 80, 1600, 900)).toEqual({ x: 400, y: 200, w: 820, h: 580 });
    expect(resizeChatGeom(g, 'nw', -100, -50, 1600, 900)).toEqual({ x: 300, y: 150, w: 800, h: 550 }); // right / bottom edges stay
    expect(resizeChatGeom(g, 'w', 600, 0, 1600, 900)).toEqual({ x: 400 + 700 - CHAT_MIN_W, y: 200, w: CHAT_MIN_W, h: 500 }); // stops at the min
    expect(resizeChatGeom(g, 'e', 2000, 0, 1600, 900)).toMatchObject({ x: 400, w: 1600 - 8 - 400 }); // stops at the screen
    expect(resizeChatGeom(g, 'n', 0, -900, 1600, 900)).toMatchObject({ y: 8, h: 200 + 500 - 8 });
  });

  it('a drag on the tab strip moves the frame by transform only, commits once on release, and the release is not a click', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    expect(vars()).toEqual({ x: 320, y: 90, w: 960, h: 720 }); // centred
    const strip = q('.dmchat-top')!;
    const tab = q('.dmchat-tabmain')!;
    const commits = vi.fn();
    const stop = useChatWindow.subscribe(commits);
    ptr(tab, 'pointerdown', 500, 120);
    ptr(tab, 'pointermove', 503, 122); // within the slop: still a press
    expect(frame().classList.contains('moving')).toBe(false);
    ptr(tab, 'pointermove', 700, 80);
    expect(frame().classList.contains('moving')).toBe(true);
    expect(frame().style.transform).toBe('translate(520px, 50px)');
    expect(commits).not.toHaveBeenCalled(); // nothing rendered or saved per move
    ptr(strip, 'pointerup', 700, 80);
    stop();
    expect(commits).toHaveBeenCalledTimes(1);
    expect(useChatWindow.getState().geom).toEqual({ x: 520, y: 50, w: 960, h: 720 });
    expect(frame().style.transform).toBe(''); // the CSS vars carry it now
    expect(vars()).toEqual({ x: 520, y: 50, w: 960, h: 720 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ geom: { x: 520, y: 50, w: 960, h: 720 }, pinned: false });
    const swallowed = vi.fn();
    tab.addEventListener('click', swallowed);
    act(() => { (tab as HTMLElement).click(); });
    expect(swallowed).not.toHaveBeenCalled(); // the drag's own release never presses the tab
    tab.removeEventListener('click', swallowed);
    // A press that barely moves is still a press (the tab or button under it works).
    act(() => { document.body.click(); });
    ptr(tab, 'pointerdown', 500, 120);
    ptr(tab, 'pointerup', 502, 121);
    expect(useChatWindow.getState().geom).toEqual({ x: 520, y: 50, w: 960, h: 720 });
    // Typing in the composer never starts a drag.
    ptr(q('.fdock-input')!, 'pointerdown', 600, 700);
    ptr(q('.fdock-input')!, 'pointermove', 800, 500);
    expect(frame().classList.contains('moving')).toBe(false);
    ptr(q('.fdock-input')!, 'pointerup', 800, 500);
  });

  it('a grip resizes through an outline and sets the size once, on release; the screen shrinking puts it back inside', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    expect(document.body.querySelectorAll('.dmchat-rs')).toHaveLength(8); // four edges, four corners
    const grip = q('.dmchat-rs-se')!;
    ptr(grip, 'pointerdown', 1280, 810);
    const ghost = q('.dmchat-ghost')!;
    expect(ghost.classList.contains('on')).toBe(true);
    ptr(grip, 'pointermove', 1100, 700);
    expect(ghost.style.width).toBe('780px');
    expect(ghost.style.height).toBe('610px');
    expect(vars()).toMatchObject({ w: 960, h: 720 }); // the window itself waits for the release
    ptr(grip, 'pointerup', 1100, 700);
    expect(ghost.classList.contains('on')).toBe(false);
    expect(vars()).toEqual({ x: 320, y: 90, w: 780, h: 610 });
    // The window shrinks to 1000 x 600: the window is clamped back inside (and its saved place is left alone).
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
    act(() => { useFriendsDock.setState({ dmWith: null }); });
    act(() => openDm('u-amy'));
    expect(vars()).toEqual({ x: 1000 - 8 - 780, y: 8, w: 780, h: 584 });
    expect(useChatWindow.getState().geom).toEqual({ x: 320, y: 90, w: 780, h: 610 });
  });

  it('PINNED: no veil, Escape and outside presses go to the game, and it rides through screen and phase changes', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-gus'));
    await flush();
    const pin = q('.dmchat-pin')!;
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(pin.getAttribute('aria-label')).toBe('Pin the chat open while you play');
    click(pin);
    expect(q('.dmchat-pin')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('.dmchat-veil')).toBeNull();
    expect(frame().classList.contains('pinned')).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ pinned: true });
    // Escape is the game's again (the Esc menu opens); the window stays.
    const esc = vi.fn();
    window.addEventListener('keydown', esc);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    window.removeEventListener('keydown', esc);
    expect(esc).toHaveBeenCalledTimes(1);
    expect(q('.dmchat-pane')).not.toBeNull();
    // A press on the board reaches the board (nothing catches it) and the window stays.
    const board = document.createElement('button');
    const bought = vi.fn();
    board.addEventListener('pointerdown', bought);
    board.addEventListener('click', bought);
    document.body.appendChild(board);
    press(board);
    act(() => { board.click(); });
    board.remove();
    expect(bought).toHaveBeenCalledTimes(2);
    expect(q('.dmchat-pane')).not.toBeNull();
    // Shop -> combat -> the menus -> a page -> back: still up, still pinned, the same conversation.
    act(() => { useGame.setState((s) => ({ run: { ...s.run, phase: 'combat' } })); });
    act(() => { useGame.setState({ showTitle: true }); });
    act(() => { useGame.setState({ showCareer: true }); });
    act(() => { useGame.setState({ showCareer: false }); });
    act(() => inRun());
    expect(q('.dmchat-at.pinned .dmchat-pane')?.getAttribute('aria-label')).toBe('Messages with Gus#1234');
    // Watch from a pinned window keeps it (it comes along); only the close button closes it.
    act(() => { useGame.setState({ showTitle: true }); }); // off my own game, so Watch is live
    click(q('.dmchat-actions button[aria-label="Watch Gus#1234"]'));
    await flush();
    expect(useFriendsDock.getState().dmWith).toBe('u-gus');
    click(q('.dmchat-close'));
    expect(q('.dmchat-at')).toBeNull();
    // Unpinned again: the overlay of R-DM-CHAT-01 (veil, Escape closes).
    act(() => openDm('u-gus'));
    click(q('.dmchat-pin'));
    expect(q('.dmchat-veil')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(q('.dmchat-at')).toBeNull();
  });

  it('pinned, it sits under the Friends button, its list and the toast (they stay reachable) and over the game and the menu pages', () => {
    const css = readFileSync(join(__dirname, '..', 'dm', 'dm.css'), 'utf8');
    const z = (sel: string): number => Number(new RegExp(`${sel.replace(/\./g, '\\.')} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
    expect(z('.dmchat-at.pinned')).toBeGreaterThan(470);
    expect(z('.dmchat-at.pinned')).toBeLessThan(480); // the Friends button
    expect(z('.dmchat-at')).toBeGreaterThan(z('.dmchat-veil'));
    expect(z('.dmchat-ghost')).toBeGreaterThan(z('.dmchat-at'));
    // Gauntlet cursors only (CLAUDE.md): every cursor rule names a gauntlet / hand image first.
    for (const m of css.matchAll(/cursor: ([^;]+);/g)) expect(m[1]).toMatch(/^url\('\/cursors\//);
    // Moving and resizing never animate layout: the frame moves by transform and nothing loops.
    expect(css).toContain('.dmchat-at { position: fixed; left: 0; top: 0; z-index: 493; width: var(--dmw); height: var(--dmh); transform: translate(var(--dmx), var(--dmy)); }');
    expect(css).not.toMatch(/infinite/);
  });

  it('the resize grips are easy to see (R-DM-CHAT-03): a gold ridged corner grip, every grip lights the rim on hover', () => {
    const css = readFileSync(join(__dirname, '..', 'dm', 'dm.css'), 'utf8');
    const rule = (sel: string): string => new RegExp(`${sel.replace(/[.:>]/g, (c) => `\\${c}`)} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const grip = rule('.dmchat-rs-se::after');
    expect(grip).toMatch(/width: (1[4-9]|2[0-2])px; height: (1[4-9]|2[0-2])px/);
    expect(grip).toMatch(/linear-gradient\(135deg[^)]*#f0d089/);
    expect(rule('.dmchat-at > .dmchat-rs:hover::before')).toContain('opacity: 1');
    expect(rule('.dmchat-at:hover > .dmchat-rs::before')).toMatch(/opacity: 0.[1-5]/);
    expect(rule('.dmchat-at > .dmchat-rs-se:hover::after, .dmchat-at.sizing > .dmchat-rs-se::after')).toContain('opacity: 1');
    // Hover changes opacity only (one-shot, compositor): no paint property transitions on the grips.
    for (const m of css.matchAll(/\.dmchat-rs[^{]*\{([^}]*)\}/g)) if (/transition/.test(m[1])) expect(m[1]).toMatch(/transition: opacity/);
  });

  it('the conversation, the tabs and the friends list scroll with the game bar, not the native one (R-UI-SCROLLBAR-01)', async () => {
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    expect(q('.gscroll.fdock-convo-wrap > .gscroll-view.fdock-convo[role="log"]')).not.toBeNull();
    expect(q('.gscroll-x.dmchat-tabs-wrap > .gscroll-view.dmchat-tabs[role="tablist"]')).not.toBeNull();
    const dm = readFileSync(join(__dirname, '..', 'dm', 'dm.css'), 'utf8');
    expect(dm).not.toMatch(/scrollbar-width: thin/);
    const src = readFileSync(join(__dirname, 'FriendsDock.tsx'), 'utf8');
    expect(src).not.toMatch(/<div className="fdock-rows"/);
    expect(src.match(/<GameScroll className="fdock-rows"/g)).toHaveLength(3);
  });

  it('this device remembers the place and the pin; broken or blocked storage starts from the centred default', async () => {
    localStorage.setItem(KEY, JSON.stringify({ geom: { x: 100, y: 120, w: 600, h: 500 }, pinned: true }));
    resetChatWindowForTests();
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    expect(vars()).toEqual({ x: 100, y: 120, w: 600, h: 500 });
    expect(q('.dmchat-at.pinned')).not.toBeNull();
    localStorage.setItem(KEY, '{not json');
    resetChatWindowForTests();
    expect(useChatWindow.getState()).toEqual({ geom: null, pinned: false });
    localStorage.setItem(KEY, JSON.stringify({ geom: { x: 'a' }, pinned: 'yes' }));
    resetChatWindowForTests();
    expect(useChatWindow.getState()).toEqual({ geom: null, pinned: false });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    resetChatWindowForTests();
    expect(useChatWindow.getState()).toEqual({ geom: null, pinned: false });
    expect(() => setChatPinned(true)).not.toThrow(); // this session only
    expect(useChatWindow.getState().pinned).toBe(true);
    get.mockRestore(); set.mockRestore();
  });

  it('a phone keeps the full-screen window: no grips, no pin, no move, and a saved pin does not apply', async () => {
    document.documentElement.setAttribute('data-touch-ui', '');
    document.documentElement.setAttribute('data-touch-small', '');
    localStorage.setItem(KEY, JSON.stringify({ geom: { x: 100, y: 120, w: 600, h: 500 }, pinned: true }));
    resetChatWindowForTests();
    inRun();
    ui = mount(<FriendsDock />);
    act(() => openDm('u-amy'));
    await flush();
    expect(q('.dmchat-at.phone')).not.toBeNull();
    expect(q('.dmchat-at.pinned')).toBeNull();
    expect(q('.dmchat-veil')).not.toBeNull();
    expect(q('.dmchat-pin')).toBeNull();
    expect(q('.dmchat-rs')).toBeNull();
    expect(q('.dmchat-ghost')).toBeNull();
    ptr(q('.dmchat-top')!, 'pointerdown', 100, 20);
    ptr(q('.dmchat-top')!, 'pointermove', 300, 220);
    expect(frame().classList.contains('moving')).toBe(false);
    expect(document.body.querySelector('[title]')).toBeNull();
  });
});
