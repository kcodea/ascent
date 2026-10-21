// @vitest-environment jsdom
/**
 * VERSUS ROOM: DRAG A CARD TO A SEAT (owner 2026-10-17, R-VERSUS-DRAG-SEAT-01: "for spectator in versus etc, the player
 * should drag their card to a slot to take it, and drag their card from a slot up to 'sell it' to go to the spectate.
 * optionally, have a join button and spectate button, but make it smooth and lower the spectator hand so it looks more
 * like the in game location").
 *
 * Pinned: my own card dropped on an open seat calls take-seat; an occupied seat refuses it (deny + spring back, no
 * call); a seated card dragged up into the sell band calls take-seat('spectator'); only my own card drags; the move is
 * optimistic and rolls back when the server refuses; there are no Join / Spectate buttons (R-VERSUS-ROOM-POLISH-03); the hand sits lower.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => query() }) };
});

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { VersusRoom } = await import('./VersusRoom');
const { takeSeat, useVersus } = await import('./versusStore');
const { VersusError, versusRemote } = await import('./versusRemote');
const { canDragSeatCard, roomWithSeatMove, seatDropOf, seatZoneAt, sellLineOf } = await import('./seatDrag');
const { useSeatDragStore } = await import('./useSeatDrag');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const roomOf = (members: ReturnType<typeof member>[], status: Room['status'] = 'open'): Room =>
  ({ id: 'r', name: 'Room', host_user_id: 'host', status, members, current_match_id: null } as unknown as Room);

// THE GEOMETRY jsdom does not lay out: the two seats side by side up top, the hand along the bottom (screen px).
const BOXES: Record<string, { left: number; top: number; width: number; height: number }> = {
  p1: { left: 100, top: 40, width: 200, height: 300 },
  p2: { left: 600, top: 40, width: 200, height: 300 },
  bench: { left: 250, top: 500, width: 400, height: 200 },
  card: { left: 420, top: 560, width: 60, height: 90 },
};
const rect = (b: { left: number; top: number; width: number; height: number }): DOMRect =>
  ({ ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => b } as DOMRect);
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    if (el.matches('.vspcard[data-seat]')) return rect(BOXES[el.dataset.seat!]!);
    if (el.matches('.vsbench')) return rect(BOXES.bench!);
    if (el.closest('.vsbcard')) return rect(BOXES.card!);
    if (el.closest('.vspcard[data-seat]')) return rect(BOXES[(el.closest('.vspcard') as HTMLElement).dataset.seat!]!);
    return realRect.call(this);
  };
  setIdentity({ userId: 'me' } as never);
  vi.spyOn(sfx, 'deny').mockImplementation(() => undefined);
  vi.spyOn(sfx, 'play').mockImplementation(() => undefined);
  vi.spyOn(sfx, 'sell').mockImplementation(() => undefined);
  vi.spyOn(sfx, 'cardTouch').mockImplementation(() => undefined);
  vi.spyOn(sfx, 'pulse').mockImplementation(() => undefined);
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  vi.restoreAllMocks();
  useSeatDragStore.setState({ drag: null });
  useVersus.setState({ room: null, seatMove: null, error: null, screen: 'browser' } as never);
  setIdentity(null);
});

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });
};
/** Press at (x0, y0) on `el`, move in steps to (x1, y1), release there. */
const drag = (el: Element, x0: number, y0: number, x1: number, y1: number): void => {
  pointer('pointerdown', el, x0, y0);
  for (let i = 1; i <= 4; i++) pointer('pointermove', window, x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4);
  pointer('pointerup', window, x1, y1);
};
const roles = (): Record<string, Role> => Object.fromEntries((useVersus.getState().room?.members ?? []).map((m) => [m.userId, m.role]));
const shownRole = (): Role | undefined => roomWithSeatMove(useVersus.getState().room, useVersus.getState().seatMove, 'me')?.members.find((m) => m.userId === 'me')?.role;

function enter(members: ReturnType<typeof member>[]) {
  useVersus.setState({ screen: 'room', match: null, error: null, seatMove: null, room: roomOf(members) } as never);
  return mount(<VersusRoom />);
}

describe('the rules of the drag (pure)', () => {
  const geo = { seats: [{ role: 'p1' as const, box: { left: 100, top: 40, right: 300, bottom: 340 } }, { role: 'p2' as const, box: { left: 600, top: 40, right: 800, bottom: 340 } }], sellTop: 130, bench: { left: 250, top: 500, right: 650, bottom: 700 } };

  it('only my own card drags, and only while the room is open', () => {
    const r = roomOf([member('me', 'spectator'), member('you', 'spectator')]);
    expect(canDragSeatCard(r, 'me', 'me')).toBe(true);
    expect(canDragSeatCard(r, 'me', 'you')).toBe(false);
    expect(canDragSeatCard(roomOf(r.members, 'in_game'), 'me', 'me')).toBe(false);
    expect(canDragSeatCard(roomOf(r.members, 'sealed'), 'me', 'me')).toBe(false);
  });

  it('an open seat takes the card, an occupied one refuses it, empty air cancels', () => {
    const r = roomOf([member('me', 'spectator'), member('you', 'p2')]);
    expect(seatDropOf(seatZoneAt('spectator', 200, 200, geo), r, 'me')).toEqual({ kind: 'take', role: 'p1' });
    expect(seatDropOf(seatZoneAt('spectator', 700, 200, geo), r, 'me')).toEqual({ kind: 'reject' });
    expect(seatDropOf(seatZoneAt('spectator', 450, 420, geo), r, 'me')).toEqual({ kind: 'cancel' });
    // A spectator's card in the sell band is nothing (it is already in the stands).
    expect(seatZoneAt('spectator', 450, 20, geo)).toBeNull();
  });

  it('a seated card goes to the stands above the sell line or on the hand; its own seat is not a target', () => {
    const r = roomOf([member('me', 'p1')]);
    expect(seatDropOf(seatZoneAt('p1', 450, 60, geo), r, 'me')).toEqual({ kind: 'take', role: 'spectator' });
    expect(seatDropOf(seatZoneAt('p1', 400, 600, geo), r, 'me')).toEqual({ kind: 'take', role: 'spectator' });
    expect(seatZoneAt('p1', 200, 300, geo)).toBeNull();
    // ...and onto the other OPEN seat it switches seats (the same take-seat RPC).
    expect(seatDropOf(seatZoneAt('p1', 700, 300, geo), r, 'me')).toEqual({ kind: 'take', role: 'p2' });
    // The sell line never starts under the grab point.
    expect(sellLineOf({ left: 0, top: 40, right: 200, bottom: 340 }, 60)).toBeLessThan(60);
  });
});

describe('dragging in the room (R-VERSUS-DRAG-SEAT-01)', () => {
  it('dragging my own hand card onto an open seat calls take-seat, with the landing sound', async () => {
    const call = vi.spyOn(versusRemote, 'takeSeat').mockImplementation(async (_id, role) => roomOf([member('me', role), member('you', 'spectator')]));
    const ui = enter([member('me', 'spectator'), member('you', 'spectator')]);
    try {
      await flush();
      const mine = document.querySelector('.vsbcard.vsdraggable')!;
      expect(mine.querySelector('[data-versus-card="me"]')).not.toBeNull();
      drag(mine, 450, 600, 200, 200);
      expect(call).toHaveBeenCalledWith('r', 'p1');
      expect(sfx.play).toHaveBeenCalled();
      await flush();
      expect(roles().me).toBe('p1');
      expect(useSeatDragStore.getState().drag).toBeNull();
    } finally { ui.unmount(); }
  });

  it('an occupied seat refuses the card: no call, the deny buzz, and it springs back', async () => {
    const call = vi.spyOn(versusRemote, 'takeSeat');
    const ui = enter([member('me', 'spectator'), member('you', 'p2')]);
    try {
      await flush();
      const mine = document.querySelector('.vsbcard.vsdraggable')!;
      pointer('pointerdown', mine, 450, 600);
      pointer('pointermove', window, 600, 400);
      pointer('pointermove', window, 700, 200);
      expect(useSeatDragStore.getState().drag?.userId).toBe('me');
      pointer('pointerup', window, 700, 200);
      expect(call).not.toHaveBeenCalled();
      expect(sfx.deny).toHaveBeenCalled();
      expect(useSeatDragStore.getState().drag?.snap).not.toBeNull(); // the shop's snap back
      expect(document.querySelector('.vsdragcard.snap')).not.toBeNull();
      expect(roles().me).toBe('spectator');
    } finally { ui.unmount(); }
  });

  it('dragging my seat card UP into the sell zone moves me to the stands, with the sell sound', async () => {
    const call = vi.spyOn(versusRemote, 'takeSeat').mockImplementation(async (_id, role) => roomOf([member('me', role)]));
    const ui = enter([member('me', 'p1')]);
    try {
      await flush();
      const seat = document.querySelector('.vspcard-p1.vsdraggable')!;
      pointer('pointerdown', seat, 200, 250);
      pointer('pointermove', window, 205, 150);
      pointer('pointermove', window, 210, 20);
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); // the drag's rAF frame publishes the zone
      // The shop's sell zone is up and lit while the card is in it.
      expect(document.querySelector('.vssellzone.sellzone.on')).not.toBeNull();
      pointer('pointerup', window, 210, 20);
      expect(call).toHaveBeenCalledWith('r', 'spectator');
      expect(sfx.sell).toHaveBeenCalled();
      await flush();
      expect(roles().me).toBe('spectator');
    } finally { ui.unmount(); }
  });

  it("only my own card is draggable: another spectator's card never starts a drag", async () => {
    const call = vi.spyOn(versusRemote, 'takeSeat');
    const ui = enter([member('you', 'spectator'), member('me', 'spectator')]);
    try {
      await flush();
      const cards = [...document.querySelectorAll('.vsbcard')];
      expect(cards).toHaveLength(2);
      const theirs = cards.find((c) => c.querySelector('[data-versus-card="you"]'))!;
      expect(theirs.classList.contains('vsdraggable')).toBe(false);
      drag(theirs, 450, 600, 200, 200);
      expect(useSeatDragStore.getState().drag).toBeNull();
      expect(call).not.toHaveBeenCalled();
      // The other player's seat card does not drag either.
      useVersus.setState({ room: roomOf([member('you', 'p1'), member('me', 'spectator')]) });
      await flush();
      expect(document.querySelector('.vspcard-p1')!.classList.contains('vsdraggable')).toBe(false);
    } finally { ui.unmount(); }
  });

  it('the move is optimistic and rolls back when the server refuses (someone took the seat first)', async () => {
    let refuse!: (e: unknown) => void;
    vi.spyOn(versusRemote, 'takeSeat').mockImplementation(() => new Promise((_, rej) => { refuse = rej; }));
    vi.spyOn(versusRemote, 'room').mockResolvedValue(roomOf([member('me', 'spectator'), member('fast', 'p1')]));
    const ui = enter([member('me', 'spectator')]);
    try {
      await flush();
      drag(document.querySelector('.vsbcard.vsdraggable')!, 450, 600, 200, 200);
      // Optimistic: my card is in the seat the moment I drop it, before the server answers.
      expect(shownRole()).toBe('p1');
      expect(document.querySelector('.vsmcard-p1 [data-versus-card="me"]')).not.toBeNull();
      await act(async () => { refuse(new VersusError('seat_taken')); await new Promise((r) => setTimeout(r, 0)); });
      // Rolled back: back in the hand, the seat empty for me, and the reason shown.
      expect(shownRole()).toBe('spectator');
      expect(document.querySelector('.vsbcard [data-versus-card="me"]')).not.toBeNull();
      expect(useVersus.getState().error).toBe('That seat was just taken.');
      expect(document.querySelector('.vsroomerror')?.textContent).toBe('That seat was just taken.');
    } finally { ui.unmount(); }
  });

  it('a seat is taken and left only by dragging: no Join or Spectate buttons (R-VERSUS-ROOM-POLISH-03)', async () => {
    const ui = enter([member('me', 'spectator'), member('you', 'p1')]);
    try {
      await flush();
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels).not.toContain('Join');
      expect(labels).not.toContain('Spectate');
      // The open seat's own text is the only cue: a spectator is told to drag.
      expect(document.querySelector('.vspcard-p2 .vspcard-empty')?.textContent).toContain('Drag your card here');
    } finally { ui.unmount(); }
  });

  it('one seat move at a time: a second request while the first is in flight is ignored', async () => {
    const call = vi.spyOn(versusRemote, 'takeSeat').mockImplementation(() => new Promise(() => undefined));
    useVersus.setState({ screen: 'room', room: roomOf([member('me', 'spectator')]), seatMove: null } as never);
    void takeSeat('p1');
    expect(await takeSeat('p2')).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('the spectator hand sits where the in-game hand sits', () => {
  it('the fan rests low, its plates running off the bottom like the shop hand', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
    const bench = /\n\.vsbench \{([^}]*)\}/.exec(css)![1]!;
    const top = Number(/top:\s*([\d.]+)%/.exec(bench)![1]);
    const height = Number(/height:\s*([\d.]+)%/.exec(bench)![1]);
    expect(top).toBeGreaterThanOrEqual(75);
    expect(top + height).toBeCloseTo(100, 5);
    // The drag styles are transform / opacity only (no looping paint).
    const drag = css.slice(css.indexOf('/* THE SEAT DRAG'), css.indexOf('.dragcard.vsdragcard'));
    expect(drag).not.toMatch(/animation\s*:|box-shadow|filter/);
  });
});
