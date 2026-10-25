// @vitest-environment jsdom
/**
 * THE GROUP ROOM AND ROOM OPTIONS on screen (owner 2026-10-24; R-VERSUS-GROUP-05, R-VERSUS-OPTIONS-01): a group room
 * shows four seats and starts with three; the host changes the options from the centered window while the
 * room is Open, everyone else sees them read-only; the options ride the heading and the room browser; a change made by
 * the host shows everyone else the "options changed" notice.
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

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { VersusRoom } = await import('./VersusRoom');
const { VersusTitle } = await import('./VersusTitle');
const { useVersus } = await import('./versusStore');
const { versusRemote } = await import('./versusRemote');
const { SpectatorBar } = await import('./SpectatorBar');
const { useSpectate } = await import('./spectate');
const { projectGroupMatch } = await import('./versusGroupView');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const GROUP = { v: 1 as const, mode: 'group' as const, modifiers: [] };
const roomOf = (members: ReturnType<typeof member>[], over: Partial<Room> = {}): Room =>
  ({ id: 'r', name: 'Room', host_user_id: 'host', status: 'open', members, current_match_id: null, options: GROUP, options_rev: 1, ...over } as unknown as Room);

beforeEach(() => {
  (Element.prototype as { animate?: unknown }).animate = function () { return { finish() {}, cancel() {} }; };
  for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  useVersus.setState({ room: null, seatMove: null, error: null, screen: 'browser', optionsNotice: null } as never);
  setIdentity(null);
});

function enter(me: string, room: Room) {
  setIdentity({ userId: me } as never);
  useVersus.setState({ screen: 'room', match: null, error: null, seatMove: null, room } as never);
  return mount(<VersusRoom />);
}
const press = (el: Element | null | undefined): void => { act(() => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('Versus Group rooms (R-VERSUS-GROUP-05)', () => {
  it('a group room has four seats; Start shows for the host with three seated (not with two)', () => {
    const ui = enter('host', roomOf([member('host', 'p1'), member('b', 'p2')]));
    try {
      expect(ui.container.querySelectorAll('.vspcard[data-seat]')).toHaveLength(4);
      expect(ui.container.querySelector('.vsarena.vsgroup')).not.toBeNull();
      expect(ui.container.querySelector('.vsstart')).toBeNull();
      act(() => { useVersus.setState({ room: roomOf([member('host', 'p1'), member('b', 'p2'), member('c', 'p4')]) } as never); });
      expect(ui.container.querySelector('.vsstart button')?.textContent).toBe('Start game');
    } finally { ui.unmount(); }
  });

  it('a 1v1 room keeps its two seats', () => {
    const ui = enter('host', roomOf([member('host', 'p1')], { options: null }));
    try {
      expect(ui.container.querySelectorAll('.vspcard[data-seat]')).toHaveLength(2);
      expect(ui.container.querySelector('.vsroommode')?.textContent).toBe('1v1');
    } finally { ui.unmount(); }
  });
});

describe('Room options (R-VERSUS-OPTIONS-01)', () => {
  it('the host changes them from the panel while the room is Open; the server call carries the whole object', async () => {
    const set = vi.spyOn(versusRemote, 'setOptions').mockResolvedValue(roomOf([member('host', 'p1')], { options: { ...GROUP, modifiers: ['summit'] }, options_rev: 2 }));
    const ui = enter('host', roomOf([member('host', 'p1')]));
    try {
      expect(ui.container.querySelector('.vsroommode')?.textContent).toBe('3-4 players');
      press(ui.container.querySelector('.vsroommode'));
      // The window is portalled to the stage (R-VERSUS-OPTIONS-02), so it is looked up on the document.
      const panel = document.querySelector('.vsoptions')!;
      expect(panel).not.toBeNull();
      const summit = [...panel.querySelectorAll('.vsopt-card')].find((b) => b.querySelector('.vsopt-name')?.textContent === 'Summit')!;
      expect((summit as HTMLButtonElement).disabled).toBe(false);
      press(summit);
      await act(async () => { await Promise.resolve(); });
      expect(set).toHaveBeenCalledWith('r', { v: 1, mode: 'group', modifiers: ['summit'] });
      expect(ui.container.querySelector('.vsroommode')?.textContent).toBe('3-4 players · Summit');
    } finally { ui.unmount(); }
  });

  it('everyone else sees them read-only, and is told when the host changes them', () => {
    const set = vi.spyOn(versusRemote, 'setOptions');
    const ui = enter('b', roomOf([member('host', 'p1'), member('b', 'spectator')]));
    try {
      press(ui.container.querySelector('.vsroommode'));
      const buttons = [...document.querySelectorAll('.vsoptions .vsopt-card')] as HTMLButtonElement[];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => b.disabled)).toBe(true);
      press(buttons.find((b) => b.querySelector('.vsopt-name')?.textContent === '1v1'));
      expect(set).not.toHaveBeenCalled();
      act(() => { useVersus.setState({ room: roomOf([member('host', 'p1'), member('b', 'spectator')], { options: { v: 1, mode: 'duel', modifiers: ['freedom'] }, options_rev: 2 }) } as never); });
      expect(ui.container.querySelector('.vsoptions-notice')?.textContent).toBe('Room options changed: 1v1 · Freedom');
    } finally { ui.unmount(); }
  });

  it('the room browser shows each room\x27s mode and its seats', async () => {
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([
      { id: 'a', name: 'Pack', status: 'open', setId: 'set3', contentRevision: 'x', protocol: 1, createdAt: '', currentMatchId: null, hostName: 'H', hostProfile: null, players: 3, spectators: 0, maxPlayers: 4, options: GROUP },
    ]);
    const ui = mount(<VersusTitle />);
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const card = ui.container.querySelector('.vsrcard')!;
      expect(card.querySelector('.vsrcard-mode')?.textContent).toBe('3-4 players');
      expect(card.querySelectorAll('.vsrseat')).toHaveLength(4);
      expect(card.querySelectorAll('.vsrseat.on')).toHaveLength(3);
    } finally { ui.unmount(); }
  });
});

describe('Knocked out into the stands (R-VERSUS-GROUP-06)', () => {
  it('the watch screen shows my placement as I arrive, and the fight picker lists the players still in', () => {
    setIdentity({ userId: 'u2' } as never);
    const seat = (s: 'p1' | 'p2' | 'p3', over: Record<string, unknown> = {}) => ({ seat: s, userId: `u${s.slice(1)}`, name: s.toUpperCase(), hearts: 7, hero: 'warden', locked: false, ready: false, intro: true, auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, ...over });
    const raw = {
      id: 'm', room_id: 'r', seed: 1, set_id: 'set3', content_revision: 'x', protocol: 1, options: GROUP, phase: 'shop', revision: 5, round: 4, seat_count: 3,
      heroes_revealed: true, hero_deadline: null, shop_starts_at: null, shop_deadline: null, intro_deadline: null, combat_deadline: null, paused_seat: null,
      paused_at: null, pause_grace_until: null, resume_at: null, winner_seat: null, end_reason: null, completed_at: null,
      seats: [seat('p1'), seat('p2', { eliminatedRound: 3, outReason: 'hearts', hearts: 0, placement: 3 }), seat('p3')],
    };
    useVersus.setState({ match: projectGroupMatch(raw as never, null), room: roomOf([member('u2', 'spectator')]), knockout: { matchId: 'm', placement: 3, of: 3 } } as never);
    useSpectate.setState({ active: true, seat: 'p1' });
    const ui = mount(<SpectatorBar />);
    try {
      expect(ui.container.querySelector('.lvend .endplace-num')?.textContent).toBe('3RD');
      const plates = [...ui.container.querySelectorAll('.vswatchpanel .vsspec-seat')];
      expect(plates).toHaveLength(3);
      expect(plates.filter((p) => p.classList.contains('out'))).toHaveLength(1);
      expect(ui.container.querySelector('.vsspec-vs')?.textContent).toBe('vs P3');
      press(ui.container.querySelector('.lvend button'));
      expect(ui.container.querySelector('.lvend')).toBeNull();
    } finally { ui.unmount(); useSpectate.setState({ active: false }); useVersus.setState({ match: null, knockout: null } as never); }
  });
});
