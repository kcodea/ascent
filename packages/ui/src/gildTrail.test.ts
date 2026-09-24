// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  canPlay: true,
  plays: [] as { id: string; index?: number; onDone?: () => void }[],
  retire: (() => undefined) as (() => void) | null,
}));
vi.mock('./fx/playDef', () => ({
  canPlayDefs: () => fx.canPlay,
  playDef: (id: string, _anchors: unknown, opts: { index?: number; onDone?: () => void } = {}) => {
    fx.plays.push({ id, index: opts.index, onDone: opts.onDone });
    return fx.retire;
  },
}));
vi.mock('./fx/fxDefs', () => ({
  // The landing lands at 360ms, 70ms later per copy: the third copy lands at 500ms.
  getDef: () => ({ layers: [{ anchor: 'target', at: 360, stagger: 70 }] }),
}));

import { playGildTrail } from './gildTrail';

function goldCard(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 120, height: 160 } as DOMRect);
  return el;
}
const THREE = [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
const hidden = (el: HTMLElement): boolean => el.style.getPropertyValue('opacity') === '0';

beforeEach(() => {
  vi.useFakeTimers();
  fx.canPlay = true;
  fx.plays = [];
  fx.retire = () => undefined;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('playGildTrail', () => {
  it('plays the one gild-trail def once per copy, each with its own index for the stagger', () => {
    playGildTrail(THREE, goldCard(), 'g1');
    expect(fx.plays.map((p) => [p.id, p.index])).toEqual([['gild-trail', 0], ['gild-trail', 1], ['gild-trail', 2]]);
  });

  it('hides the gilded card until the LAST trail lands, then shows it', () => {
    const el = goldCard();
    playGildTrail(THREE, el, 'g1');
    expect(hidden(el)).toBe(true);
    vi.advanceTimersByTime(499);
    expect(hidden(el)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hidden(el)).toBe(false);
  });

  it('shows the card when a play retires, even if the arrival timer never fires', () => {
    const el = goldCard();
    playGildTrail(THREE, el, 'g1');
    fx.plays[0].onDone?.();
    expect(hidden(el)).toBe(false);
  });

  it('never leaves the card hidden when no trail could play', () => {
    fx.retire = null;
    const el = goldCard();
    playGildTrail(THREE, el, 'g1');
    expect(hidden(el)).toBe(false);
  });

  it('does not touch the card at all when the FX engine is not ready', () => {
    fx.canPlay = false;
    const el = goldCard();
    playGildTrail(THREE, el, 'g1');
    expect(fx.plays).toHaveLength(0);
    expect(hidden(el)).toBe(false);
  });

  it('does nothing with no sources', () => {
    const el = goldCard();
    playGildTrail([], el, 'g1');
    expect(fx.plays).toHaveLength(0);
    expect(hidden(el)).toBe(false);
  });
});
