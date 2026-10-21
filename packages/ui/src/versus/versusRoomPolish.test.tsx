// @vitest-environment jsdom
/**
 * THE VERSUS ROOM POLISH PASS (owner 2026-10-21: "this is a 1.5/10, i need an 8/10 minimum here",
 * R-VERSUS-ROOM-POLISH-01). Pinned against the real room, store and seat FLIP, with the network and the FX faked:
 *   - everyone arrives in the hand: creating a room steps the creator down to the stands, and a join is a spectator
 *     join (a player join only when the stands are full)  (R-VERSUS-ROOM-HAND-01);
 *   - a seat sold back to the hand plays the shop's coins, then the card forms in the hand (R-VERSUS-ROOM-SELL-01);
 *   - a card landing in a seat plays the shop's landing dust and play sound (R-VERSUS-ROOM-PLAY-01);
 *   - a refused move glides back with no FX; a newcomer forms in place, a leaver burns off (R-VERSUS-ROOM-ARRIVE-01);
 *   - the room's CSS contracts: the in-game stat pills at the card's own proportion (R-VERSUS-ROOM-PILLS-01), a
 *     pre-blurred static backdrop (no live blur), and a one-shot transform / opacity entrance (R-VERSUS-ROOM-ENTER-01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const fx = vi.hoisted(() => ({ defs: [] as string[], coalesce: 0, dissolve: 0 }));
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: (id: string) => { fx.defs.push(id); return null; } }));
vi.mock('../plateCoalesce', async (orig) => ({ ...(await orig<typeof import('../plateCoalesce')>()), playPlateCoalesce: () => { fx.coalesce++; } }));
vi.mock('../plateDissolve', async (orig) => ({ ...(await orig<typeof import('../plateDissolve')>()), playPlateDissolve: () => { fx.dissolve++; } }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { VersusRoom } = await import('./VersusRoom');
const { VersusTitle, defaultRoomName } = await import('./VersusTitle');
const { createRoom, joinRoom, useVersus } = await import('./versusStore');
const { VersusError, versusRemote } = await import('./versusRemote');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const roomOf = (members: ReturnType<typeof member>[]): Room =>
  ({ id: 'r', name: 'Room', host_user_id: 'host', status: 'open', members, current_match_id: null } as unknown as Room);

const realRect = Element.prototype.getBoundingClientRect;
const realAnimate = (Element.prototype as { animate?: unknown }).animate;
beforeEach(() => {
  fx.defs = []; fx.coalesce = 0; fx.dissolve = 0;
  // jsdom lays nothing out: every card is a 100x140 box (the seats up top, the hand below), and animate() exists.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const seat = (this as HTMLElement).closest('.vspcard[data-seat]') as HTMLElement | null;
    const b = seat ? { left: seat.dataset.seat === 'p1' ? 100 : 600, top: 40, width: 100, height: 140 } : { left: 400, top: 600, width: 100, height: 140 };
    return { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect;
  };
  (Element.prototype as { animate?: unknown }).animate = function () { return { finish() {}, cancel() {} }; };
  setIdentity({ userId: 'me' } as never);
  for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  (Element.prototype as { animate?: unknown }).animate = realAnimate;
  vi.restoreAllMocks();
  vi.useRealTimers();
  useVersus.setState({ room: null, seatMove: null, error: null, screen: 'browser' } as never);
  setIdentity(null);
});

const setRoom = (members: ReturnType<typeof member>[]): void => { act(() => { useVersus.setState({ room: roomOf(members) } as never); }); };
function enter(members: ReturnType<typeof member>[]) {
  useVersus.setState({ screen: 'room', match: null, error: null, seatMove: null, room: roomOf(members) } as never);
  return mount(<VersusRoom />);
}

describe('everyone arrives in the hand (R-VERSUS-ROOM-HAND-01)', () => {
  it('creating a room steps the creator down to the stands before the room shows', async () => {
    vi.spyOn(versusRemote, 'createRoom').mockResolvedValue({ ...roomOf([member('me', 'p1')]), serverNow: new Date().toISOString() } as never);
    const take = vi.spyOn(versusRemote, 'takeSeat').mockResolvedValue(roomOf([member('me', 'spectator')]));
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    await createRoom('Room');
    expect(take).toHaveBeenCalledWith('r', 'spectator');
    expect(useVersus.getState().room?.members.find((m) => m.userId === 'me')?.role).toBe('spectator');
  });

  it('a join is a spectator join; only full stands fall back to a free seat', async () => {
    const join = vi.spyOn(versusRemote, 'joinRoom').mockResolvedValue({ ...roomOf([member('me', 'spectator')]), serverNow: new Date().toISOString() } as never);
    await joinRoom('r', 'player');
    expect(join.mock.calls.map((c) => c[1])).toEqual(['spectator']);
    join.mockReset();
    join.mockRejectedValueOnce(new VersusError('spectators_full')).mockResolvedValue({ ...roomOf([member('me', 'p2')]), serverNow: new Date().toISOString() } as never);
    await joinRoom('r', 'player');
    expect(join.mock.calls.map((c) => c[1])).toEqual(['spectator', 'player']);
  });
});

describe('the seat moves present like the shop (R-VERSUS-ROOM-SELL-01, -PLAY-01, -ARRIVE-01)', () => {
  it('a seat sold back to the hand: the coins, then the card forms in the hand', () => {
    vi.useFakeTimers();
    const ui = enter([member('host', 'p1'), member('you', 'spectator'), member('me', 'spectator')]);
    try {
      setRoom([member('host', 'spectator'), member('you', 'spectator'), member('me', 'spectator')]);
      expect(fx.defs.filter((d) => d !== 'ground-slam')).toEqual(['coin']);
      expect(sfx.sell).toHaveBeenCalledTimes(1); // someone else's sale is heard here
      expect(fx.coalesce).toBe(0);
      act(() => { vi.advanceTimersByTime(300); });
      expect(fx.coalesce).toBe(1);
    } finally { ui.unmount(); }
  });

  it('a card taking a seat lands with the landing dust and the play sound', () => {
    vi.useFakeTimers();
    const ui = enter([member('host', 'spectator'), member('me', 'spectator')]);
    try {
      setRoom([member('host', 'p2'), member('me', 'spectator')]);
      expect(fx.defs.filter((d) => d !== 'ground-slam')).toEqual([]);
      act(() => { vi.advanceTimersByTime(400); });
      expect(fx.defs.filter((d) => d !== 'ground-slam')).toEqual(['landing-dust']);
      expect(sfx.play).toHaveBeenCalledTimes(1);
      expect(fx.coalesce).toBe(0);
    } finally { ui.unmount(); }
  });

  it('a refused move glides back with no coins, dust or sound', () => {
    vi.useFakeTimers();
    const ui = enter([member('me', 'spectator')]);
    try {
      // My optimistic move into p1, then the server refuses it (the seat move is dropped, the room unchanged).
      act(() => { useVersus.setState({ seatMove: { role: 'p1' } } as never); });
      act(() => { vi.advanceTimersByTime(400); });
      fx.defs = [];
      vi.mocked(sfx.play).mockClear();
      act(() => { useVersus.setState({ seatMove: null } as never); });
      act(() => { vi.advanceTimersByTime(600); });
      expect(fx.defs.filter((d) => d !== 'ground-slam')).toEqual([]); // (the entrance's own slam may land meanwhile)
      expect(fx.coalesce).toBe(0);
      expect(sfx.sell).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
  });

  it('someone new forms in place; someone leaving burns off', () => {
    const ui = enter([member('host', 'p1'), member('me', 'spectator')]);
    try {
      expect(fx.coalesce).toBe(0); // the room's first paint belongs to the entrance
      setRoom([member('host', 'p1'), member('me', 'spectator'), member('new', 'spectator')]);
      expect(fx.coalesce).toBe(1);
      setRoom([member('host', 'p1'), member('me', 'spectator')]);
      expect(fx.dissolve).toBe(1);
    } finally { ui.unmount(); }
  });
});

describe('the room CSS contracts', () => {
  const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
  const rule = (sel: string): string => {
    const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule ${sel}`);
    return m[2]!;
  };

  it('every room card wears the in-game stat pills at its own proportion (R-VERSUS-ROOM-PILLS-01)', () => {
    expect(rule('.vspcard-hold .card .badge')).toMatch(/scale:\s*var\(--vspcard-k\)/);
    // No size-specific override left on any room card's badges (the old x1.45 seat / x1 hand split).
    expect(css).not.toMatch(/--vspcard-badge|\.vspcard-bench \.card \.badge/);
    expect(rule('.vspcard-bench')).toMatch(/--vspcard-k:\s*var\(--vsb-k/);
  });

  it('the backdrop is a pre-blurred static image: no live blur anywhere in the room (R-VERSUS-ROOM-POLISH-01)', () => {
    expect(rule('.vsarena-ext')).not.toMatch(/filter/);
    expect(css).not.toMatch(/backdrop-filter\s*:/);
    expect(readFileSync(join(__dirname, 'VersusRoom.tsx'), 'utf8')).toMatch(/arena-blur\.webp/);
  });

  it('the entrance is one-shot transform / opacity, every keyframe named vsin (R-VERSUS-ROOM-ENTER-01)', () => {
    const enterCss = css.slice(css.indexOf('/* ── ENTERING THE ROOM'), css.indexOf('@media (prefers-reduced-motion: reduce) { .vsenter-veil'));
    const frames = [...enterCss.matchAll(/@keyframes (\w+) \{([^@]*?)\}\s*\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(5);
    for (const [, name, body] of frames) {
      expect(name).toMatch(/^vsin/);
      for (const prop of body!.matchAll(/([a-z-]+):/g)) expect(['transform', 'opacity']).toContain(prop[1]);
    }
    expect(enterCss).not.toMatch(/infinite/);
  });

  it('the hand pops half as high and 10% smaller than the seat card, its grab pad over the popped card', () => {
    expect(rule('.vsbcard:hover .vsbcard-lift')).toMatch(/translateY\(calc\(-1 \* var\(--vsb-ccw\)\)\) scale\(var\(--vsb-zoom\)\)/);
    expect(css).toMatch(/--vsb-zoom: 2;/);
    expect(rule('.vsbcard-hitup')).toMatch(/top: -255%/);
  });
});

describe('the room browser (R-VERSUS-BROWSER-01)', () => {
  const summary = (id: string, status: 'open' | 'in_game', players: number, spectators: number) => ({
    id, name: `Room ${id}`, status, setId: 's', contentRevision: 'c', protocol: 1, createdAt: '', currentMatchId: null,
    hostName: `Host ${id}`, hostProfile: null, players, spectators,
  });

  it('rooms are cards: host, two seat sockets, a status pill, the watchers, Join or Watch; no Refresh; Create prefilled', () => {
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    useVersus.setState({ rooms: [summary('a', 'open', 1, 0), summary('b', 'in_game', 2, 3)], loading: false } as never);
    const ui = mount(<VersusTitle />);
    try {
      const cards = [...document.querySelectorAll('.vsrcard')];
      expect(cards).toHaveLength(2);
      expect(cards[0]!.querySelectorAll('.vsrseat.on')).toHaveLength(1);
      expect(cards[1]!.querySelectorAll('.vsrseat.on')).toHaveLength(2);
      expect(cards[0]!.querySelector('.vsrcard-host')?.textContent).toContain('Host a');
      expect(cards[0]!.querySelector('.vsrstatus')?.textContent).toBe('Open');
      expect(cards[1]!.querySelector('.vsrwatch')?.textContent?.trim()).toBe('3');
      expect(cards[0]!.querySelector('button')?.textContent).toBe('Join');
      expect(cards[1]!.querySelector('button')?.textContent).toBe('Watch');
      expect([...document.querySelectorAll('button')].some((b) => /refresh/i.test(b.textContent ?? ''))).toBe(false);
      expect((document.querySelector('.vsinput') as HTMLInputElement).value).toBe(defaultRoomName(''));
      expect(document.querySelector('[title]')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('no rooms: one quiet line that says how to start one', async () => {
    vi.spyOn(versusRemote, 'listRooms').mockResolvedValue([]);
    useVersus.setState({ rooms: [], loading: false } as never);
    const ui = mount(<VersusTitle />);
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); // the first list read settles
      expect(document.querySelector('.vsempty')?.textContent).toBe('No rooms open. Create one and invite a friend.');
      expect(defaultRoomName('Orangez')).toBe("Orangez's room");
    } finally { ui.unmount(); }
  });
});

describe('the Versus plate goes red while a room is open (R-VERSUS-OPEN-PLATE-01)', () => {
  it('both pill looks paint the tile name plate red under .vs-open, static', () => {
    const styles = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
    const m = /\.modecard\.vs-open \.mcname\.hudpill-name,\s*:root\[data-hp-look="gem"\] \.modecard\.vs-open \.mcname\.hudpill-name \{([^}]*)\}/.exec(styles);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/#c9503f/);
    expect(m![1]).not.toMatch(/animation/);
  });
});

describe('one action area that is empty until two fighters sit; drag-only seats; the host crowned (R-VERSUS-ROOM-POLISH-02/03)', () => {
  it('one fighter: nothing in the action area, no Join, no Spectate; the empty seat says what to do', () => {
    const ui = enter([member('host', 'p1'), member('me', 'spectator')]);
    try {
      expect(document.querySelector('.vsactions')?.children.length).toBe(0);
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels).not.toContain('Join');
      expect(labels).not.toContain('Spectate');
      expect(labels).not.toContain('Start game');
      expect(document.querySelector('.vspcard-p2 .vspcard-empty')?.textContent).toContain('Drag your card here');
      expect(document.querySelector('.vspcard-p1 .vshostmark')).not.toBeNull();
      expect(document.querySelector('.vsseatlabel, .vshosttag')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('two fighters: the host gets Start game, everyone else "Host starts the match", in the same place', () => {
    setIdentity({ userId: 'host' } as never);
    let ui = enter([member('host', 'p1'), member('you', 'p2'), member('me', 'spectator')]);
    try {
      expect([...document.querySelectorAll('.vsactions .vsstart button')].map((b) => b.textContent)).toEqual(['Start game']);
    } finally { ui.unmount(); }
    setIdentity({ userId: 'me' } as never);
    ui = enter([member('host', 'p1'), member('you', 'p2'), member('me', 'spectator')]);
    try {
      expect(document.querySelector('.vsactions .vsstart')?.textContent).toBe('Host starts the match');
      expect(document.querySelector('.vsactions button')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('a seat empties: Start game plays its exit, then is gone', () => {
    vi.useFakeTimers();
    setIdentity({ userId: 'host' } as never);
    const ui = enter([member('host', 'p1'), member('you', 'p2')]);
    try {
      setRoom([member('host', 'p1'), member('you', 'spectator')]);
      expect(document.querySelector('.vsstart.out')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(300); });
      expect(document.querySelector('.vsstart')).toBeNull();
    } finally { ui.unmount(); }
  });

  it('Add bot sits at one fixed place under an empty seat and never moves on hover', () => {
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toMatch(/\.vspcard > \.vsplate\.vsslot-bot \{ position: absolute; left: 50%; top: calc\(100% \+ 10 \* var\(--u\)\); translate: -50% 0;/);
    expect(css).toMatch(/\.vspcard > \.vsplate\.vsslot-bot:is\(:hover, :active\) \{ translate: -50% 0; \}/);
    // No room plate nudges under the cursor.
    expect(css).not.toMatch(/\.vsplate:hover[^{]*\{[^}]*translate: 0 -1px/);
  });
});

describe('the bench (R-VERSUS-ROOM-STANDS-01)', () => {
  it('a static, pointer-free band as wide as the fan, its top faded (no edge line), with the Spectators pill and count', () => {
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const band = /\n\.vsbench::before \{([^}]*)\}/.exec(css)![1]!;
    expect(band).toMatch(/pointer-events: none/);
    expect(band).toMatch(/linear-gradient\(180deg, rgba\(13, 22, 40, 0\) 0/);
    expect(band).toMatch(/var\(--n\)/);
    expect(band).not.toMatch(/border-top|animation/);
    const ui = enter([member('host', 'p1'), member('me', 'spectator'), member('you', 'spectator')]);
    try {
      expect(document.querySelector('.vsbench .vsstands-label')?.textContent).toBe('Spectators2 / 20');
      expect(document.querySelector('.vsbcard-you')).toBeNull(); // owner 2026-10-21: no You pill
    } finally { ui.unmount(); }
  });
});


describe('the open seat fades rather than snaps (owner 2026-10-21)', () => {
  it('the open-seat card stays mounted under a seated card and fades by one transform / opacity transition', () => {
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    expect(css).toMatch(/\.vspcard \.vspcard-empty \{ transition: opacity 0\.25s ease-out, transform 0\.25s ease-out; \}/);
    expect(css).toMatch(/\.vspcard \.vspcard-empty\.gone \{ opacity: 0; transform: scale\(0\.97\); \}/);
    const ui = enter([member('host', 'p1'), member('me', 'spectator')]);
    try {
      expect(document.querySelector('.vspcard-p1 .vspcard-empty.gone')).not.toBeNull();
      expect(document.querySelector('.vspcard-p2 .vspcard-empty:not(.gone)')).not.toBeNull();
    } finally { ui.unmount(); }
  });
});
