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
