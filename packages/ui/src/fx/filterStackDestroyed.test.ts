// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BlurFilter, Container } from 'pixi.js';
import { FilterStack } from './filterStack';

/** Owner crash report 2026-09-19: the FX budget retired a play after its container was torn down, and
 *  `FilterStack.destroy` → `container.filters = []` walked Pixi's null effects list. The stack must release its
 *  own bookkeeping and leave a destroyed container alone. */
describe('FilterStack.destroy on a destroyed container', () => {
  it('does not throw and still releases its counters', () => {
    const c = new Container();
    const stack = new FilterStack(c, []);
    c.filters = [new BlurFilter()]; // a live filter, as a ribbon's core blur is — the setter has something to remove
    c.destroy();
    expect(c.destroyed).toBe(true);
    // The browser bundle nulls the effects list on destroy (the headless build keeps an empty array) — mirror the
    // real post-destroy state so the `filters` setter would walk null exactly as in the owner's stack trace.
    (c as unknown as { effects: unknown }).effects = null;
    // The headless Pixi build tolerates the null walk the browser bundle crashes on, so pin the GUARD itself:
    // a destroyed container's `filters` setter is never invoked.
    const desc = Object.getOwnPropertyDescriptor(Container.prototype, 'filters')!;
    const setter = vi.fn(desc.set!);
    Object.defineProperty(c, 'filters', { get: desc.get, set: setter, configurable: true });
    expect(() => stack.destroy()).not.toThrow();
    expect(setter).not.toHaveBeenCalled();
  });
  it('still clears filters on a live container', () => {
    const c = new Container();
    const stack = new FilterStack(c, []);
    stack.destroy();
    expect(c.filters ?? []).toHaveLength(0);
  });
});
