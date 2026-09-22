// @vitest-environment jsdom
/**
 * THE LASSO CASCADE, wired (`useLassoCascade`).
 *
 * `lassoHolds.test.ts` pins the pure helpers. This file pins the part that actually broke: the REACT ordering
 * between a render-phase seed and a changed-dep effect. The hold used to be resolved from that effect's
 * cleanup, and React runs a changed-dep cleanup AFTER the render that bumped the dep has committed — so from
 * the SECOND steal action of a recruit phase onward the cleanup wiped the batch the same render had just
 * seeded. The card left the Shop and reached the hand before a single frame of the rope had drawn, which is
 * the one thing the feature exists to prevent, and no pure test could see it.
 *
 * So: drive TWO steal actions through a real mounted component and assert the second one still holds.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, useRef } from 'react';
import type { RunState } from '@game/sim';
import { mount } from './renderedText.mount';
import { useLassoCascade, type LassoCascadeHandlers, type LassoSteal } from './lassoHolds';

const steal = (offerUid: string, index: number, handUid: string): LassoSteal =>
  ({ offer: { uid: offerUid, cardId: 'stray' }, index, handUid, origin: 'spell' }) as LassoSteal;

/** A stand-in for the recruit screen: it renders exactly what the holds decide — the Shop row and the fan. */
function Harness(props: {
  seq: number;
  events: readonly LassoSteal[];
  phase: RunState['phase'];
  shop: readonly string[];
  hand: readonly string[];
  onLaunch: (ev: LassoSteal, index: number) => void;
}): JSX.Element {
  const handlers = useRef<LassoCascadeHandlers>({ onLaunch: () => {}, onContact: () => {} });
  const cascade = useLassoCascade({
    seq: props.seq, events: props.events, phase: props.phase, shopUids: props.shop, handlers,
  });
  handlers.current = { onLaunch: props.onLaunch, onContact: () => {} };
  const held = cascade.holds;
  // The real screen folds by index; the order does not matter here, only whether the card is on screen at all.
  const shop = [...props.shop, ...held.shop.map((h) => h.steal.offer.uid)];
  const hand = props.hand.filter((u) => !held.hand.has(u));
  return (
    <div>
      <div data-testid="shop">{shop.join(',')}</div>
      <div data-testid="hand">{hand.join(',')}</div>
    </div>
  );
}

const textOf = (c: HTMLElement, id: string): string => c.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

describe('useLassoCascade — the hold survives a SECOND steal in the same recruit phase', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('holds the card on every steal action, not just the first', () => {
    const launches: string[] = [];
    const onLaunch = (ev: LassoSteal): void => { launches.push(ev.offer.uid); };
    const view = (seq: number, events: readonly LassoSteal[], shop: string[], hand: string[]): JSX.Element =>
      <Harness seq={seq} events={events} phase={'recruit' as RunState['phase']} shop={shop} hand={hand} onLaunch={onLaunch} />;

    const m = mount(view(0, [], ['a', 'b', 'c'], []));
    expect(textOf(m.container, 'shop')).toBe('a,b,c');

    // ACTION 1 — `b` is stolen. The reducer already spliced it; the hold puts it back.
    act(() => { m.render(view(1, [steal('b', 1, 'h1')], ['a', 'c'], ['h1'])); });
    expect(textOf(m.container, 'shop'), 'the stolen offer is still on screen').toContain('b');
    expect(textOf(m.container, 'hand'), 'its copy is held out of the fan').toBe('');
    act(() => { vi.advanceTimersByTime(200); });
    expect(textOf(m.container, 'shop')).toBe('a,c');
    expect(textOf(m.container, 'hand')).toBe('h1');

    // ACTION 2 — `c` is stolen. THIS is the regression: it used to be released the instant it was seeded.
    act(() => { m.render(view(2, [steal('c', 1, 'h2')], ['a'], ['h1', 'h2'])); });
    expect(textOf(m.container, 'shop'), 'the SECOND steal holds its card too').toContain('c');
    expect(textOf(m.container, 'hand'), 'and holds its copy out of the fan').toBe('h1');
    act(() => { vi.advanceTimersByTime(200); });
    expect(textOf(m.container, 'shop')).toBe('a');
    expect(textOf(m.container, 'hand')).toBe('h1,h2');

    // ACTION 3, for good measure — nothing about the wiring degrades with repetition.
    act(() => { m.render(view(3, [steal('a', 0, 'h3')], [], ['h1', 'h2', 'h3'])); });
    expect(textOf(m.container, 'shop')).toContain('a');
    expect(textOf(m.container, 'hand')).toBe('h1,h2');

    act(() => { vi.advanceTimersByTime(200); });
    expect(launches, 'one beam per steal, in order').toEqual(['b', 'c', 'a']);
    m.unmount();
  });

  it('a second cascade mid-flight lets the first one go rather than stranding it', () => {
    const view = (seq: number, events: readonly LassoSteal[], shop: string[], hand: string[]): JSX.Element =>
      <Harness seq={seq} events={events} phase={'recruit' as RunState['phase']} shop={shop} hand={hand} onLaunch={() => {}} />;
    const m = mount(view(0, [], ['a', 'b', 'c'], []));
    act(() => { m.render(view(1, [steal('b', 1, 'h1')], ['a', 'c'], ['h1'])); });
    // Interrupt BEFORE contact: the first steal's hold must not survive into the new batch.
    act(() => { vi.advanceTimersByTime(80); m.render(view(2, [steal('c', 1, 'h2')], ['a'], ['h1', 'h2'])); });
    expect(textOf(m.container, 'shop'), 'only the new steal is held').toBe('a,c');
    expect(textOf(m.container, 'hand'), 'the interrupted arrival is let go, never left invisible').toBe('h1');
    act(() => { vi.advanceTimersByTime(200); });
    expect(textOf(m.container, 'hand')).toBe('h1,h2');
    m.unmount();
  });

  it('LEAVING THE SHOP drops every hold with no timer involved', () => {
    const view = (seq: number, events: readonly LassoSteal[], phase: string, shop: string[], hand: string[]): JSX.Element =>
      <Harness seq={seq} events={events} phase={phase as RunState['phase']} shop={shop} hand={hand} onLaunch={() => {}} />;
    const m = mount(view(0, [], 'recruit', ['a', 'b'], []));
    act(() => { m.render(view(1, [steal('b', 1, 'h1')], 'recruit', ['a'], ['h1'])); });
    expect(textOf(m.container, 'hand')).toBe('');
    act(() => { m.render(view(1, [steal('b', 1, 'h1')], 'combat', ['a'], ['h1'])); });
    expect(textOf(m.container, 'shop'), 'nothing is folded back into a row that is gone').toBe('a');
    expect(textOf(m.container, 'hand'), 'and the arrival is visible again').toBe('h1');
    m.unmount();
  });
});
