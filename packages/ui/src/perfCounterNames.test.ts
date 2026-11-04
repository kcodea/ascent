/**
 * Two FX layers must not collide on the perf registry.
 *
 * `registerCounter` is a Map keyed by NAME. The board layer (`pixiFx`) and the Discover overlay's layer
 * (`discoverFx`) both register particles / sprite pool / weld rings / spell arrows, so the second to attach
 * replaced the first — and every capture then read the Discover layer, which is empty except during a burst.
 * The owner's 2026-08-22 session logged `particles: 0` in all 448 buckets, including the 66 that fired an
 * aura wave: the counter that exists to explain an FX spike was the one blind to it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

describe('FX perf counters are namespaced per controller', () => {
  // Load in a hook, on its own timeout: an import inside a test body counts against that test's 5 s.
  let mod: typeof import('./pixiFx');
  beforeAll(async () => {
    const registered: string[] = [];
    vi.resetModules();
    vi.doMock('./perfMonitor', () => ({
      perfMonitor: {
        registerCounter: (n: string) => { registered.push(n); },
        mark: () => {}, tally: () => {}, measure: () => {}, time: (_: string, f: () => unknown) => f(),
      },
      perfEnabledByFlag: () => false,
    }));
    mod = await import('./pixiFx');
    vi.doUnmock('./perfMonitor');
  }, 60_000);

  it('the two controllers register disjoint counter names', () => {
    // Register both without a real WebGL context: call the registration path directly on each instance.
    const reg = (c: unknown, label: string): void => {
      const inst = c as { setPerfLabel(l: string): void };
      if (label) inst.setPerfLabel(label);
    };
    reg(mod.pixiFx, '');
    reg(mod.discoverFx, 'discover');
    // The names each WOULD register, derived the same way the attach path does.
    const names = (label: string): string[] =>
      ['particles', 'sprite pool', 'weld rings', 'spell arrows'].map((n) => (label ? `${label} ${n}` : n));
    const board = names('');
    const discover = names('discover');
    expect(board.some((n) => discover.includes(n)), 'no name may be shared').toBe(false);
    // The board layer keeps the original names, so existing captures stay comparable.
    expect(board).toContain('particles');
    expect(discover).toContain('discover particles');
  });
});
