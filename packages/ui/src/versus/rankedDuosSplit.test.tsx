// @vitest-environment jsdom
/**
 * R-RANKED-DUOS-SPLIT-01 (owner 2026-10-27: "lobby/versus modes need to stay separate from ranked modes ... the duo
 * ranked lobby should just have an invite player option and then start game and a back button to get back to the play
 * screen"; "make the team naming more obvious in lobby"):
 *  - the party screen carries the team's name big on its header, Invite player, Start game and Back, nothing else of a
 *    Versus room (no Room options, Leave, Friends only, Join a party, Previous match stats);
 *  - Back from an open party leaves it (free, nothing started) and shows the mode screen;
 *  - the Versus browser never lists a party; the Versus options never offer Ranked Duos;
 *  - opening Versus while holding an open party leaves the party; Duo + Play while holding an open Versus room leaves it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: () => null }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});
vi.mock('../friends/friendsStore', async (orig) => ({ ...(await orig<typeof import('../friends/friendsStore')>()), friendsAccount: () => true }));

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { useGame } = await import('../store');
const { VersusRoom } = await import('./VersusRoom');
const { VersusTitle } = await import('./VersusTitle');
const { VersusOptionsPanel } = await import('./versusOptionsUi');
const { enterDuosParty, openVersus, useVersus } = await import('./versusStore');
const { versusRemote } = await import('./versusRemote');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role, displayName = userId) => ({ userId, role, displayName, profile: {}, lastSeenAt: '' });
const RANKED = { v: 1 as const, mode: 'ranked_duos' as const, modifiers: [] };
const DUEL = { v: 1 as const, mode: 'duel' as const, modifiers: [] };
const roomOf = (members: ReturnType<typeof member>[], over: Partial<Room> = {}): Room =>
  ({ id: 'r', name: "Kevin's party", host_user_id: 'kev', status: 'open', members, current_match_id: null, options: RANKED, options_rev: 1, ...over } as unknown as Room);

beforeEach(() => {
  (Element.prototype as { animate?: unknown }).animate = function () { return { finish() {}, cancel() {} }; };
  for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
  vi.spyOn(versusRemote, 'duosTeam').mockResolvedValue(null as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  useVersus.setState({ room: null, rooms: [], seatMove: null, error: null, screen: 'browser', area: 'versus', duosResult: null } as never);
  setIdentity(null);
});

function enter(me: string, room: Room) {
  setIdentity({ userId: me } as never);
  useVersus.setState({ screen: 'room', area: 'duos', match: null, error: null, seatMove: null, room } as never);
  return mount(<VersusRoom />);
}
const press = (el: Element | null | undefined): void => { act(() => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

describe('the Ranked Duos party screen (R-RANKED-DUOS-SPLIT-01)', () => {
  it('only Invite player, Start game and Back; the team name heads the stage', () => {
    const ui = enter('kev', roomOf([member('kev', 'p1', 'Kevin'), member('lem', 'p2', 'Lemon')]));
    try {
      const ctl = [...ui.container.querySelectorAll('.vsroomctl button')].map((b) => b.textContent);
      expect(ctl.filter((t) => !/bot/i.test(t ?? ''))).toEqual(['Invite player']);
      expect(ui.container.querySelector('.vsroomtop button')?.textContent).toBe('Back');
      expect(ui.container.querySelector('.vsstart button')?.textContent).toBe('Start game');
      const text = ui.container.textContent ?? '';
      for (const gone of ['Room options', 'Leave party', 'Friends only', 'Join a party', 'Previous match stats']) expect(text).not.toContain(gone);
      // THE TEAM: big on the header plate, "Name1 & Name2" until named, with Rename for a teammate.
      const head = ui.container.querySelector('.vspartyhead')!;
      expect(head.querySelector('.vsroomwatch')?.textContent).toBe('Your team');
      expect(head.querySelector('.vsteamtitle')?.textContent).toBe('Kevin & Lemon');
      expect(head.querySelector('.vsrename')?.textContent).toBe('Rename team');
      // No spectators: no empty stands label on a party (the bench itself stays: it is part of the card geometry).
      expect(ui.container.querySelector('.vsbench')).not.toBeNull();
      expect(ui.container.querySelector('.vsstands-label')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('alone in the party: the header asks for a teammate; the teammate (not host) waits for the start', () => {
    const solo = enter('kev', roomOf([member('kev', 'p1', 'Kevin')]));
    try {
      expect(solo.container.querySelector('.vsteamtitle')?.textContent).toBe('Invite a teammate');
      expect(solo.container.querySelector('.vsrename')).toBeNull();
    } finally { solo.unmount(); }
    const mate = enter('lem', roomOf([member('kev', 'p1', 'Kevin'), member('lem', 'p2', 'Lemon')]));
    try {
      expect(mate.container.querySelector('.vsstart')?.textContent).toBe('Your teammate starts the game');
    } finally { mate.unmount(); }
  });

  it('Back from an open party leaves it and shows the mode screen (no game started: nothing to lose)', async () => {
    const leave = vi.spyOn(versusRemote, 'leaveRoom').mockResolvedValue({ left: true });
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    useGame.getState().setTitleView('versus');
    const ui = enter('kev', roomOf([member('kev', 'p1', 'Kevin'), member('lem', 'p2', 'Lemon')]));
    try {
      press(ui.container.querySelector('.vsroomtop button'));
      await flush();
      expect(leave).toHaveBeenCalledWith('r');
      expect(useVersus.getState().room).toBeNull();
      expect(useGame.getState().titleView).toBe('modes');
    } finally { ui.unmount(); }
  });

  it('a Versus room keeps its own controls (the split leaves Versus unchanged)', () => {
    const ui = enter('kev', roomOf([member('kev', 'p1')], { options: DUEL, name: 'Room' }));
    try {
      const ctl = [...ui.container.querySelectorAll('.vsroomctl button')].map((b) => b.textContent);
      expect(ctl).toContain('Room options');
      expect(ctl).toContain('Leave room');
      expect(ui.container.querySelector('.vspartyhead')).toBeNull();
    } finally { ui.unmount(); }
  });
});

describe('Versus and Ranked Duos never show in each other\'s menus (R-RANKED-DUOS-SPLIT-01)', () => {
  it('the Versus browser lists Versus rooms only, even when the server sends a party', async () => {
    const summary = (id: string, options: object) => ({ id, name: id, status: 'open', players: 1, maxPlayers: 2, spectators: 0, hostName: 'H', options, createdAt: '' });
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([summary('vs-room', DUEL), summary('a-party', RANKED)] as never);
    const ui = mount(<VersusTitle />);
    try {
      await flush();
      const names = [...ui.container.querySelectorAll('.vsrcard-name')].map((n) => n.textContent);
      expect(names).toEqual(['vs-room']);
      expect(useVersus.getState().rooms.map((r) => r.id)).toEqual(['vs-room']);
    } finally { ui.unmount(); }
  });

  it('the Versus room options never offer Ranked Duos (test tools on, as in dev)', () => {
    const ui = mount(<VersusOptionsPanel options={DUEL} editable onChange={() => undefined} onClose={() => undefined} />);
    try {
      const modes = [...document.querySelectorAll('.vsopt-card .vsopt-name')].map((n) => n.textContent);
      expect(modes).toContain('1v1');
      expect(modes).not.toContain('Ranked Duos');
    } finally { ui.unmount(); }
  });

  it('opening Versus while holding an open party leaves the party first', async () => {
    const leave = vi.spyOn(versusRemote, 'leaveRoom').mockResolvedValue({ left: true });
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    vi.spyOn(versusRemote, 'myRoomId').mockResolvedValue(null);
    setIdentity({ userId: 'kev' } as never);
    useVersus.setState({ room: roomOf([member('kev', 'p1')]), screen: 'room', area: 'duos' } as never);
    act(() => openVersus());
    await flush();
    expect(leave).toHaveBeenCalledWith('r');
    expect(useVersus.getState()).toMatchObject({ room: null, screen: 'browser', area: 'versus' });
  });

  it('Duo + Play while holding an open Versus room leaves it, then opens my party', async () => {
    const leave = vi.spyOn(versusRemote, 'leaveRoom').mockResolvedValue({ left: true });
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    vi.spyOn(versusRemote, 'myRoomId').mockResolvedValue(null);
    vi.spyOn(versusRemote, 'heartbeat' as never).mockResolvedValue(undefined as never);
    const party = roomOf([member('kev', 'p1')], { id: 'p' });
    const create = vi.spyOn(versusRemote, 'createRoom').mockResolvedValue({ ...party, serverNow: new Date().toISOString() } as never);
    setIdentity({ userId: 'kev' } as never);
    useVersus.setState({ room: roomOf([member('kev', 'p1')], { options: DUEL, name: 'Room' }), screen: 'room', area: 'versus' } as never);
    await act(async () => { await enterDuosParty("Kevin's party"); });
    expect(leave).toHaveBeenCalledWith('r');
    expect(create).toHaveBeenCalledWith("Kevin's party", expect.anything(), expect.objectContaining({ mode: 'ranked_duos' }));
    expect(useVersus.getState()).toMatchObject({ screen: 'room', area: 'duos' });
    expect(useVersus.getState().room?.id).toBe('p');
    act(() => { useVersus.setState({ room: null } as never); });
  });
});
