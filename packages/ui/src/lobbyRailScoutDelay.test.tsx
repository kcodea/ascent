// @vitest-environment jsdom
/**
 * R-RAIL-SCOUT-DELAY-01 (owner 2026-11-02: "we need to make sure the game board elements are always prioritized over the
 * lobby rail. right now its too easy to accidentally hover over the lobby rail and have their info pop up unnecessarily.
 * lets make it so hovering requires 1 second of hovering before the hero card shows up. or you can click it to
 * immediately open it"). A rail seat's scout card opens only after the pointer has stayed on that seat for 1 s; passing
 * over (or sweeping down) the rail opens nothing; a click opens it at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { LobbyPanel, SCOUT_OPEN_DELAY_MS } from './LobbyPanel';
import { useGame } from './store';

let ui: Mounted | null = null;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

const fire = (el: Element, type: string): void => { act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body })); }); };
const wait = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const card = (): Element | null => document.body.querySelector('.lobbyscout');

const mountRail = (): HTMLElement => {
  const run = createLobbyRun(4242, 'warden');
  act(() => { useGame.setState({ run, combatStaged: false }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};

describe('R-RAIL-SCOUT-DELAY-01: the rail scout card waits for a held hover', () => {
  it('the delay is 1 second', () => { expect(SCOUT_OPEN_DELAY_MS).toBe(1000); });

  it('opens only after 1 s on the seat', () => {
    const c = mountRail();
    const foe = c.querySelector('.lobbyseat:not(.you)')!;
    fire(foe, 'mouseover');
    wait(SCOUT_OPEN_DELAY_MS - 1);
    expect(card()).toBeNull();
    wait(1);
    expect(card()).not.toBeNull();
  });

  it('your own seat waits too', () => {
    const c = mountRail();
    fire(c.querySelector('.lobbyseat.you')!, 'mouseover');
    wait(500);
    expect(card()).toBeNull();
    wait(500);
    expect(card()).not.toBeNull();
  });

  it('passing over a seat, or sweeping down the rail, opens nothing', () => {
    const c = mountRail();
    const seats = [...c.querySelectorAll('.lobbyseat:not(.you)')];
    expect(seats.length).toBeGreaterThan(2);
    for (const s of seats) { fire(s, 'mouseover'); wait(600); fire(s, 'mouseout'); }
    wait(2000);
    expect(card()).toBeNull();
  });

  it('once a card is up the rail is warm: the next seat opens at once; leaving the rail closes it at once and cools it', () => {
    const c = mountRail();
    const [a, b, d] = [...c.querySelectorAll('.lobbyseat:not(.you)')];
    fire(a!, 'mouseover');
    wait(SCOUT_OPEN_DELAY_MS);
    expect(card()).not.toBeNull();
    // Seat to seat: no wait.
    act(() => { a!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: b! })); });
    fire(b!, 'mouseover');
    expect(card()).not.toBeNull();
    expect(document.body.querySelectorAll('.lobbyscout')).toHaveLength(1);
    // Off the rail: closed at once (no grace), and the rail is cold again.
    fire(b!, 'mouseout');
    expect(card()).toBeNull();
    fire(d!, 'mouseover');
    expect(card()).toBeNull();
    wait(SCOUT_OPEN_DELAY_MS);
    expect(card()).not.toBeNull();
  });

  it('moving off the card (and off the rail) closes it at once', () => {
    const c = mountRail();
    const foe = c.querySelector('.lobbyseat:not(.you)')!;
    fire(foe, 'mouseover');
    wait(SCOUT_OPEN_DELAY_MS);
    act(() => { foe.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: card() })); });
    fire(card()!, 'mouseover');
    expect(card()).not.toBeNull();
    fire(card()!, 'mouseout');
    expect(card()).toBeNull();
  });

  it('a click opens it at once: an opponent pins, your own seat opens its card', () => {
    const c = mountRail();
    fire(c.querySelector('.lobbyseat:not(.you)')!, 'mouseover');
    fire(c.querySelector('.lobbyseat:not(.you)')!, 'click');
    expect(card()).not.toBeNull();
    fire(c.querySelector('.lobbyseat:not(.you)')!, 'click'); // toggles the pin shut
    fire(c.querySelector('.lobbyseat:not(.you)')!, 'mouseout');
    wait(2000);
    expect(card()).toBeNull();
    const mine = c.querySelector('.lobbyseat.you')!;
    fire(mine, 'mouseover');
    fire(mine, 'click');
    expect(card()).not.toBeNull();
  });
});
