// @vitest-environment jsdom
/**
 * R-PING-09 (owner 2026-10-31: "i want right click to be inspect (currently its double right click) and a held right
 * click to be ping"). The mouse right-button HOLD (`installRightHold`):
 *  - a QUICK right-click (released before PING_HOLD_MS) reaches the card's own right-click, which inspects, with no fan;
 *  - a HOLD opens the fan at PING_HOLD_MS, and the release's contextmenu (Windows fires it on release) never reaches
 *    the card, so it does not also inspect;
 *  - where the browser fires contextmenu on the PRESS (macOS, Linux) it is held back and replayed once on a quick
 *    release, and dropped on a hold;
 *  - where no ping is possible (the menus, a plain spectator) nothing arms, so a press-time contextmenu passes at once;
 *  - a finger never arms it (touch keeps its own long-press).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me' }));
import { useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { setWatchers } from '../versus/watchers';
import { installRightHold, openCardPingMenu, PING_HOLD_MS, resetPingDoubleForTests, usePingMenu } from './PingLayer';
import { resetPingRuntimeForTests, setPingClockForTests, setPingSession } from './pingRuntime';

/** A right-button pointer event (jsdom has no PointerEvent constructor: a MouseEvent carrying a `pointerType`). */
function ptr(type: 'pointerdown' | 'pointerup', el: Element, pointerType = 'mouse'): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  el.dispatchEvent(ev);
}
const ctx = (el: Element): MouseEvent => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 });
  el.dispatchEvent(ev);
  return ev;
};

let off: () => void = () => undefined;
let card: Element;
const inspect = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  setPingClockForTests(() => 1_000_000);
  resetPingRuntimeForTests();
  resetPingDoubleForTests();
  useSpectate.setState({ active: false, seat: 'p1', teammate: false, hero: null, teammateHero: false });
  setWatchers([]);
  const g = useGame.getState();
  useGame.setState({ showTitle: false, replaying: false, replaySession: null, run: { ...g.run, phase: 'recruit' } });
  setPingSession('test', { send: () => undefined, seat: () => 'p1', mode: () => 'duel', gameKey: 'g1' });
  document.body.innerHTML = `<div data-zone="warband"><div class="card" data-uid="9"><span class="art"></span></div></div>`;
  card = document.querySelector('.card')!;
  inspect.mockReset();
  // The card's own right-click, as Card.tsx wires it: openCardPingMenu answers false for a mouse, so it inspects.
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!openCardPingMenu(e as unknown as { clientX: number; clientY: number; currentTarget: Element }, '9', inspect)) inspect();
  });
  off = installRightHold();
});
afterEach(() => {
  off();
  vi.useRealTimers();
  setPingSession('test', null);
  setPingClockForTests(null);
  usePingMenu.setState({ open: null });
  document.body.innerHTML = '';
});

const art = (): Element => card.querySelector('.art')!;

describe('right-click inspects, a held right-click pings (R-PING-09)', () => {
  it('Windows order: a quick right-click inspects at once on release, no fan', () => {
    ptr('pointerdown', art());
    vi.advanceTimersByTime(120);
    ptr('pointerup', art());
    ctx(art());
    expect(inspect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PING_HOLD_MS);
    expect(usePingMenu.getState().open).toBeNull();
  });

  it('Windows order: a hold opens the fan at PING_HOLD_MS, and the release does not also inspect', () => {
    ptr('pointerdown', art());
    vi.advanceTimersByTime(PING_HOLD_MS - 1);
    expect(usePingMenu.getState().open).toBeNull();
    vi.advanceTimersByTime(1);
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid: '9', zone: 'board' });
    ptr('pointerup', art());
    const ev = ctx(art());
    expect(ev.defaultPrevented).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    // The swallow is spent: the next quick right-click inspects again.
    ptr('pointerdown', art());
    ptr('pointerup', art());
    ctx(art());
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('macOS / Linux order (contextmenu on the press): held back, replayed once on a quick release, dropped on a hold', () => {
    ptr('pointerdown', art());
    const early = ctx(art());
    expect(early.defaultPrevented).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    ptr('pointerup', art());
    expect(inspect).toHaveBeenCalledTimes(1); // replayed on the release
    expect(usePingMenu.getState().open).toBeNull();
    // A hold: the fan, and the held-back right-click is never replayed.
    ptr('pointerdown', art());
    ctx(art());
    vi.advanceTimersByTime(PING_HOLD_MS);
    ptr('pointerup', art());
    expect(usePingMenu.getState().open?.target).toEqual({ t: 'card', uid: '9', zone: 'board' });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('where no ping is possible nothing arms: the right-click passes at once, even on the press', () => {
    useGame.setState({ showTitle: true }); // the menus / Compendium
    ptr('pointerdown', art());
    expect(ctx(art()).defaultPrevented).toBe(true); // by the card's own handler
    expect(inspect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PING_HOLD_MS * 2);
    ptr('pointerup', art());
    expect(usePingMenu.getState().open).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('a finger never arms it (touch keeps its own long-press)', () => {
    ptr('pointerdown', art(), 'touch');
    vi.advanceTimersByTime(PING_HOLD_MS * 2);
    expect(usePingMenu.getState().open).toBeNull();
  });
});
