import { describe, expect, it } from 'vitest';
import { Container, type Filter } from 'pixi.js';
import { FilterStack, FILTER_ORDER_KEY, filterLabSpecs, resolveFilterOrder, type FxFilterSpec } from './filterStack';
import { coerceParams, defaultsOf } from './params';

/** A registry of inert fake filters — `frame()` only needs `make()` to return something with `destroy`. */
const fake = (id: string): FxFilterSpec => ({
  id, label: id.toUpperCase(), make: () => ({ id, destroy() {} }) as unknown as Filter, amountProp: '', amount: [0, 1, 0],
});
const REG: readonly FxFilterSpec[] = [fake('outline'), fake('glow'), fake('bloom')];
const idsOf = (c: Container): string[] => ((c.filters ?? []) as unknown as { id: string }[]).map((f) => f.id);

describe('resolveFilterOrder', () => {
  it('empty / missing / unknown-only orders are exactly the registry order', () => {
    expect(resolveFilterOrder([], REG)).toEqual(['outline', 'glow', 'bloom']);
    expect(resolveFilterOrder(undefined, REG)).toEqual(['outline', 'glow', 'bloom']);
    expect(resolveFilterOrder(['nope'], REG)).toEqual(['outline', 'glow', 'bloom']);
  });
  it('stored ids lead in their order; the rest append in registry order; duplicates collapse', () => {
    expect(resolveFilterOrder(['glow'], REG)).toEqual(['glow', 'outline', 'bloom']);
    expect(resolveFilterOrder(['bloom', 'glow', 'bloom'], REG)).toEqual(['bloom', 'glow', 'outline']);
  });
});

describe('filterLabSpecs + the order param', () => {
  it('generates a `filterOrder` order-kind param whose default is the empty (registry) order', () => {
    const specs = filterLabSpecs(REG);
    expect(specs[FILTER_ORDER_KEY]?.kind).toBe('order');
    expect(defaultsOf(specs)[FILTER_ORDER_KEY]).toEqual([]);
  });
  it('coerceParams keeps a saved order (de-duplicated, strings only) and never aliases the input', () => {
    const specs = filterLabSpecs(REG);
    const raw = [FILTER_ORDER_KEY, ['glow', 'glow', 7, '', 'outline']] as const;
    const p = coerceParams(specs, { [raw[0]]: raw[1] }) as Record<string, unknown>;
    expect(p[FILTER_ORDER_KEY]).toEqual(['glow', 'outline']);
    expect(p[FILTER_ORDER_KEY]).not.toBe(raw[1]);
  });
});

describe('FilterStack composes enabled filters in the stored order', () => {
  const on = (over: Record<string, unknown>): Record<string, unknown> => ({ ...defaultsOf(filterLabSpecs(REG)), outlineOn: true, glowOn: true, ...over });

  it('default order = registry order (the behaviour before ordering existed)', () => {
    const c = new Container();
    const s = new FilterStack(c, REG);
    s.frame(on({}), 0, 0.016);
    expect(idsOf(c)).toEqual(['outline', 'glow']);
    s.destroy();
  });
  it('a stored order flips them, and only ENABLED filters appear', () => {
    const c = new Container();
    const s = new FilterStack(c, REG);
    s.frame(on({ [FILTER_ORDER_KEY]: ['glow', 'outline'] }), 0, 0.016);
    expect(idsOf(c)).toEqual(['glow', 'outline']);
    s.frame(on({ [FILTER_ORDER_KEY]: ['bloom', 'glow', 'outline'], bloomOn: true }), 0, 0.016);
    expect(idsOf(c)).toEqual(['bloom', 'glow', 'outline']);
    s.destroy();
  });
  it('changing the order re-composes; the same order is a no-op rewrite', () => {
    const c = new Container();
    const s = new FilterStack(c, REG);
    s.frame(on({ [FILTER_ORDER_KEY]: ['glow', 'outline'] }), 0, 0.016);
    const first = c.filters;
    s.frame(on({ [FILTER_ORDER_KEY]: ['glow', 'outline'] }), 0.5, 0.016);
    expect(c.filters).toBe(first); // untouched array — no rewrite for an unchanged active set
    s.frame(on({ [FILTER_ORDER_KEY]: ['outline', 'glow'] }), 0.5, 0.016);
    expect(idsOf(c)).toEqual(['outline', 'glow']);
    s.destroy();
  });
});
