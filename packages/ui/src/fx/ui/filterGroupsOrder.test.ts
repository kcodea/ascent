import { describe, expect, it } from 'vitest';
import { FILTERS } from '../filterRegistry';
import { FILTER_ORDER_KEY, filterLabSpecs } from '../filterStack';
import { filterEntries, moveFilter } from './filterGroups';

const specs = filterLabSpecs(FILTERS);
const a = FILTERS[0].id;
const b = FILTERS[1].id;
const c = FILTERS[2].id;

describe('filterEntries honours filterOrder', () => {
  it('enabled rows read top → bottom in the stored order; the rest follow in registry order', () => {
    const values: Record<string, unknown> = { [`${a}On`]: true, [`${b}On`]: true, [`${c}On`]: true, [FILTER_ORDER_KEY]: [c, a] };
    const ids = filterEntries(specs, values).map((e) => e.id);
    expect(ids.slice(0, 3)).toEqual([c, a, b]);
  });
});

describe('moveFilter', () => {
  const values: Record<string, unknown> = { [`${a}On`]: true, [`${b}On`]: true, [`${c}On`]: true };
  const entries = filterEntries(specs, values);

  it('swaps with an enabled neighbour and returns the full rendered order', () => {
    const moved = moveFilter(entries, b, -1);
    expect(moved.slice(0, 3)).toEqual([b, a, c]);
    expect(moved).toHaveLength(entries.length);
    // and storing that order renders exactly that order back
    expect(filterEntries(specs, { ...values, [FILTER_ORDER_KEY]: moved }).map((e) => e.id).slice(0, 3)).toEqual([b, a, c]);
  });
  it('is a no-op at the ends and across the enabled/disabled boundary', () => {
    expect(moveFilter(entries, a, -1).slice(0, 3)).toEqual([a, b, c]);
    expect(moveFilter(entries, c, 1).slice(0, 3)).toEqual([a, b, c]); // c's next neighbour is disabled
  });
});
