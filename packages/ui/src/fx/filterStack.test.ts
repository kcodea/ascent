import { describe, it, expect } from 'vitest';
import { filterLabSpecs, type FxFilterSpec } from './filterStack';

/** A minimal dummy filter — `filterLabSpecs` only reads the registry entry's declarative shape (id, label,
 *  knobs); it never calls `make()`, so this never needs a real pixi Filter or a WebGL context. */
const DUMMY_REGISTRY: readonly FxFilterSpec[] = [
  {
    id: 'dummy',
    label: 'Dummy Filter',
    make: () => ({}) as ReturnType<FxFilterSpec['make']>,
    amountProp: 'amount',
    amount: [0, 1, 0.5],
    knobs: [
      { name: 'tint', label: 'Tint', prop: 'tint', kind: 'color', defaultColor: 0xabcdef },
    ],
  },
];

describe('filterLabSpecs', () => {
  it('generates a color param spec for a registry color knob, with a numeric default and non-empty help', () => {
    const specs = filterLabSpecs(DUMMY_REGISTRY);
    const colorSpec = specs['dummy_tint'];

    expect(colorSpec).toBeDefined();
    expect(colorSpec.kind).toBe('color');
    expect(typeof colorSpec.default).toBe('number');
    expect(colorSpec.default).toBe(0xabcdef);
    expect(typeof colorSpec.help).toBe('string');
    expect((colorSpec.help ?? '').length).toBeGreaterThan(0);
  });

  it('falls back to white when a color knob omits defaultColor', () => {
    const registry: readonly FxFilterSpec[] = [
      {
        id: 'dummy2',
        label: 'Dummy Filter 2',
        make: () => ({}) as ReturnType<FxFilterSpec['make']>,
        amountProp: 'amount',
        amount: [0, 1, 0.5],
        knobs: [{ name: 'tint', label: 'Tint', prop: 'tint', kind: 'color' }],
      },
    ];
    const specs = filterLabSpecs(registry);
    const colorSpec = specs['dummy2_tint'];

    expect(colorSpec.kind).toBe('color');
    expect(colorSpec.default).toBe(0xffffff);
  });
});

/**
 * `FilterStack.frame` is called once per frame from EVERY live particle/mesh primitive. Before 2026-09-01 it
 * allocated two arrays and ~31 key strings per call even with nothing enabled — ~330k allocations/s on a
 * busy board at 240 Hz, for defs of which not one enables a lab filter. These pin the fast path.
 */
describe('FilterStack — the nothing-enabled fast path', () => {
  const container = { filters: [] as unknown[] } as unknown as import('pixi.js').Container;
  const made: string[] = [];
  const registry: FxFilterSpec[] = [
    { id: 'probe', label: 'Probe', amountProp: 'amount', amount: [0, 1, 0.5], make: () => { made.push('probe'); return { amount: 0 } as never; } } as FxFilterSpec,
  ];

  it('builds no filter and never touches container.filters when nothing is enabled', async () => {
    const { FilterStack } = await import('./filterStack');
    const before = container.filters;
    const fs = new FilterStack(container, registry);
    for (let i = 0; i < 5; i++) fs.frame({ blur: 0, probeOn: false }, i / 5, 1 / 240);
    expect(made, 'a filter was constructed for a frame that enabled nothing').toEqual([]);
    expect(container.filters, 'container.filters must not be rewritten on the idle path').toBe(before);
  });

  it('still builds and applies a filter the frame it is enabled, and clears it once when disabled', async () => {
    const { FilterStack } = await import('./filterStack');
    const c = { filters: [] as unknown[] } as unknown as import('pixi.js').Container;
    const fs = new FilterStack(c, registry);
    fs.frame({ blur: 0, probeOn: true, probeAmt: 0.25 }, 0.5, 1 / 240);
    expect(made).toEqual(['probe']);
    expect((c.filters as unknown[]).length).toBe(1);
    const applied = c.filters;
    fs.frame({ blur: 0, probeOn: true, probeAmt: 0.25 }, 0.6, 1 / 240);
    expect(c.filters, 'a retune must not rewrite the filters array').toBe(applied);
    fs.frame({ blur: 0, probeOn: false }, 0.7, 1 / 240);
    expect((c.filters as unknown[]).length, 'disabling clears the set').toBe(0);
    const cleared = c.filters;
    fs.frame({ blur: 0, probeOn: false }, 0.8, 1 / 240);
    expect(c.filters, 'and a second idle frame does not rewrite it again').toBe(cleared);
  });
});
