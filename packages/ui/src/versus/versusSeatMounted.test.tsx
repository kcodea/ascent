// @vitest-environment jsdom
/**
 * ONE CARD ELEMENT PER MEMBER (owner 2026-10-21, R-VERSUS-ROOM-MOUNTED-01). A move between a seat and the hand used to
 * unmount the card in one container and mount a new one in the other, then lay it out: one 15-16 ms frame on every
 * client (the 160 fps bar is 6.25 ms). Now every member's card stays mounted for the life of the room and a move is
 * that card's transform changing. Pinned against the real room and store, with the network and the FX faked:
 *   - the card element (and the Card inside it) is the SAME node across hand -> seat -> hand, my optimistic move, the
 *     server's answer, a rollback, and other members joining or leaving the hand; the layer never reorders on a move;
 *   - the card is placed by `transform` alone, read from the slots (seat box, hand anchors), and a move glides by a
 *     transform-only animation; no layout property is ever written on a card;
 *   - a re-read of the seat numbers that brings nothing new keeps the same objects (so the memoised cards skip).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const backend = vi.hoisted(() => ({ records: [] as unknown[] }));
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef: () => null }));
vi.mock('../plateCoalesce', async (orig) => ({ ...(await orig<typeof import('../plateCoalesce')>()), playPlateCoalesce: () => undefined }));
vi.mock('../plateDissolve', async (orig) => ({ ...(await orig<typeof import('../plateDissolve')>()), playPlateDissolve: () => undefined }));
vi.mock('../remoteBoards', async (orig) => {
  const real = await orig<typeof import('../remoteBoards')>();
  const query = () => { const q = { select: () => q, in: () => q, eq: () => q, or: () => q, limit: () => Promise.resolve({ data: [], error: null }) }; return q; };
  return { ...real, supabaseClient: () => ({ rpc: () => Promise.resolve({ data: backend.records, error: null }), from: () => query() }) };
});

const { mount } = await import('../renderedText.mount');
const { setIdentity } = await import('../identity');
const { sfx } = await import('../sfx');
const { VersusRoom } = await import('./VersusRoom');
const { useVersus } = await import('./versusStore');
const { fetchSeatData, resetSeatCacheForTests } = await import('./versusSeatCard');
const { placeOfMatrix } = await import('./useSeatDrag');
type Room = import('./versusRemote').VersusRoom;
type Role = import('./versusRemote').VersusRole;

const member = (userId: string, role: Role) => ({ userId, role, displayName: userId, profile: {}, lastSeenAt: '' });
const roomOf = (members: ReturnType<typeof member>[]): Room =>
  ({ id: 'r', name: 'Room', host_user_id: 'host', status: 'open', members, current_match_id: null } as unknown as Room);

// THE LAYOUT jsdom does not do, as computed styles (arena-local px): two seat boxes with their open-seat card boxes,
// the hand at the bottom with one anchor per slot (120 px pitch). A seat card is 190 x 260; a hand card x0.45 of it.
const SEAT_BOX = { p1: { left: 400, top: 100 }, p2: { left: 900, top: 100 } };
const HOLD = { left: 100, top: 30, width: 190, height: 260 };
const BENCH = { left: 500, top: 700 };
const realStyle = window.getComputedStyle;
const animations: { el: Element; frames: Keyframe[] }[] = [];
const realAnimate = (Element.prototype as { animate?: unknown }).animate;
const realRect = Element.prototype.getBoundingClientRect;
const style = (v: Record<string, string>): CSSStyleDeclaration =>
  ({ ...v, getPropertyValue: (k: string) => v[k] ?? '' } as unknown as CSSStyleDeclaration);
beforeEach(() => {
  window.getComputedStyle = ((el: Element) => {
    const h = el as HTMLElement;
    if (h.matches('.vspcard[data-seat]')) { const b = SEAT_BOX[h.dataset.seat as 'p1' | 'p2']; return style({ left: `${b.left}px`, top: `${b.top}px` }); }
    if (h.matches('.vspcard > .vspcard-hold')) return style({ left: `${HOLD.left}px`, top: `${HOLD.top}px`, width: `${HOLD.width}px`, height: `${HOLD.height}px`, '--vspcard-k': '1.6' });
    if (h.matches('.vsbench')) return style({ left: `${BENCH.left}px`, top: `${BENCH.top}px`, '--vsb-k': '0.72' });
    if (h.matches('.vsbslot')) return style({ left: `${300 + Number(h.style.getPropertyValue('--off')) * 120}px`, top: '20px', width: '120px' });
    if (h.matches('.vsmcard')) return style({ transform: 'none' });
    return realStyle(el);
  }) as typeof window.getComputedStyle;
  Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 100, height: 140, right: 100, bottom: 140, x: 0, y: 0, toJSON: () => ({}) } as DOMRect; };
  (Element.prototype as { animate?: unknown }).animate = function (this: Element, frames: Keyframe[]) {
    animations.push({ el: this, frames });
    return { playState: 'running', finish() {}, cancel() {} };
  };
  animations.length = 0;
  setIdentity({ userId: 'me' } as never);
  for (const k of ['deny', 'play', 'sell', 'cardTouch', 'pulse', 'gate'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
});
afterEach(() => {
  window.getComputedStyle = realStyle;
  Element.prototype.getBoundingClientRect = realRect;
  (Element.prototype as { animate?: unknown }).animate = realAnimate;
  vi.restoreAllMocks();
  useVersus.setState({ room: null, seatMove: null, error: null, screen: 'browser' } as never);
  setIdentity(null);
  resetSeatCacheForTests();
  backend.records = [];
});

const enter = (members: ReturnType<typeof member>[]) => {
  useVersus.setState({ screen: 'room', match: null, error: null, seatMove: null, room: roomOf(members) } as never);
  return mount(<VersusRoom />);
};
const setRoom = (members: ReturnType<typeof member>[]): void => { act(() => { useVersus.setState({ room: roomOf(members) } as never); }); };
const cardEl = (id: string): HTMLElement => document.querySelector<HTMLElement>(`.vscards > .vsmcard[data-vsm="${id}"]`)!;
const layerOrder = (): string[] => [...document.querySelectorAll<HTMLElement>('.vscards > .vsmcard')].map((e) => e.dataset.vsm!);
const handPlace = (i: number, n: number) => ({ x: BENCH.left + 300 + (i - (n - 1) / 2) * 120 - (HOLD.width * 0.45) / 2, y: BENCH.top + 20, s: 0.72 / 1.6 });
const tf = (p: { x: number; y: number; s: number }): string => `translate(${p.x}px, ${p.y}px) scale(${p.s})`;

describe('one card element per member, placed by transform (R-VERSUS-ROOM-MOUNTED-01)', () => {
  it('a card is the same node, Card and all, across hand -> seat -> hand and the hand closing up around it', () => {
    const ui = enter([member('host', 'spectator'), member('me', 'spectator'), member('you', 'spectator')]);
    try {
      const mine = cardEl('me');
      const myCard = mine.querySelector('.card')!;
      const theirs = cardEl('you');
      const order = layerOrder();
      // The drag ghost is mounted idle (transparent) for the room's life too: a drop never unmounts a Card.
      const ghost = document.querySelector('.vsdragcard')!;
      expect(ghost.classList.contains('vsghost-off')).toBe(true);
      // My optimistic move into p1 (a drop), then the server's answer, then someone else sits, then I go back.
      act(() => { useVersus.setState({ seatMove: { role: 'p1' } } as never); });
      expect(cardEl('me')).toBe(mine);
      expect(mine.classList.contains('vsmcard-p1')).toBe(true);
      setRoom([member('host', 'spectator'), member('me', 'p1'), member('you', 'spectator')]);
      act(() => { useVersus.setState({ seatMove: null } as never); });
      setRoom([member('host', 'p2'), member('me', 'p1'), member('you', 'spectator')]);
      setRoom([member('host', 'p2'), member('me', 'spectator'), member('you', 'spectator')]);
      expect(cardEl('me')).toBe(mine);
      expect(mine.querySelector('.card')).toBe(myCard);
      expect(mine.classList.contains('vsbcard')).toBe(true);
      expect(cardEl('you')).toBe(theirs);
      // Someone joins and leaves the hand: nobody else's card is remounted, and the layer never reorders on a move.
      setRoom([member('host', 'p2'), member('me', 'spectator'), member('new', 'spectator'), member('you', 'spectator')]);
      setRoom([member('host', 'p2'), member('me', 'spectator'), member('you', 'spectator')]);
      expect(cardEl('me')).toBe(mine);
      expect(cardEl('you')).toBe(theirs);
      expect(layerOrder()).toEqual(order);
      expect(document.querySelector('.vsdragcard')).toBe(ghost);
    } finally { ui.unmount(); }
  });

  it('the card sits where its slot is, by transform only, and a move glides it there by a transform-only animation', () => {
    const ui = enter([member('host', 'spectator'), member('me', 'spectator')]);
    try {
      const mine = cardEl('me');
      // In the hand: slot 1 of 2, at the hand's scale.
      expect(mine.style.transform).toBe(tf(handPlace(1, 2)));
      expect(cardEl('host').style.transform).toBe(tf(handPlace(0, 2)));
      // The server seats me in p1: the seat card's box (seat left + 50% - half the card, a plate-lift down), x1.
      setRoom([member('host', 'spectator'), member('me', 'p1')]);
      const seat = { x: SEAT_BOX.p1.left + HOLD.left - HOLD.width / 2, y: SEAT_BOX.p1.top + HOLD.top, s: 1 };
      expect(mine.style.transform).toBe(tf(seat));
      // The hand closed up: the host's card is now the only slot.
      expect(cardEl('host').style.transform).toBe(tf(handPlace(0, 1)));
      // My card glided from its hand slot to the seat; the host's glided along the hand. Transform (+ its lift) only.
      const mineGlide = animations.filter((a) => a.el === mine);
      expect(mineGlide).toHaveLength(1);
      expect(mineGlide[0]!.frames.map((f) => f.transform)).toEqual([tf(handPlace(1, 2)), tf(seat)]);
      for (const a of animations) for (const f of a.frames) expect(Object.keys(f).sort()).toEqual(['transform', 'zIndex']);
      // Nothing that lays out is ever written on a card: the only inline styles are its transform and its stacking.
      for (const el of document.querySelectorAll<HTMLElement>('.vscards > .vsmcard')) {
        for (let i = 0; i < el.style.length; i++) expect(['transform', '--vsz']).toContain(el.style.item(i));
      }
    } finally { ui.unmount(); }
  });

  it('the hand pads keep the fan pitch in the card own units', () => {
    const ui = enter([member('host', 'spectator'), member('me', 'spectator'), member('you', 'spectator')]);
    try {
      expect(cardEl('me').querySelector<HTMLElement>('.vsbpads')!.style.getPropertyValue('--vsb-stepl')).toBe(`${120 / 0.45}px`);
    } finally { ui.unmount(); }
  });

  it('a card caught mid-glide is read back from its computed matrix', () => {
    expect(placeOfMatrix('matrix(0.45, 0, 0, 0.45, 12.5, -40)')).toEqual({ x: 12.5, y: -40, s: 0.45 });
    expect(placeOfMatrix('none')).toBeNull();
  });
});

describe('the room CSS for the mounted cards', () => {
  const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
  const rule = (sel: string): string => {
    const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule ${sel}`);
    return m[2]!;
  };
  it('a room card is placed from its layer origin by a transform; nothing on it lays out per move', () => {
    expect(rule('.vsmcard')).toMatch(/position: absolute; left: 0; top: 0; transform-origin: 0 0;/);
    expect(rule('.vsmcard')).not.toMatch(/transition|animation/);
    // Its stacking order is a registered, non-inherited property (one element restyles when it changes).
    expect(css).toMatch(/@property --vsz \{ syntax: '<integer>'; inherits: false; initial-value: 10; \}/);
    // The seat / hand switch flips nothing inherited on the card's own subtree (that restyles the whole Card): only the
    // pads' visibility (four leaf spans). A seated card's press and cursor come from the open-seat card under it.
    expect(rule('.vsmcard-seat .vsbpads')).toMatch(/^\s*visibility: hidden;\s*$/);
    expect(css).not.toMatch(/\.vsmcard-seat[^{]*\{[^}]*pointer-events/);
    expect(css).not.toMatch(/\.vsbcard \.vspcard-hold[^{]*\{[^}]*pointer-events/);
  });
});

describe('seat numbers keep their objects when nothing changed', () => {
  it('a re-read with the same answer returns the same object per player', async () => {
    backend.records = [{ userId: 'a', wins: 3, losses: 1 }];
    const one = await fetchSeatData(['a', 'b']);
    const two = await fetchSeatData(['b', 'a']);
    expect(two.get('a')).toBe(one.get('a'));
    expect(two.get('b')).toBe(one.get('b'));
    backend.records = [{ userId: 'a', wins: 4, losses: 1 }];
    const three = await fetchSeatData(['a']);
    expect(three.get('a')).not.toBe(one.get('a'));
    expect(three.get('a')?.record).toEqual({ wins: 4, losses: 1 });
  });
});
