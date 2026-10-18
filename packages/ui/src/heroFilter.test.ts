import { describe, expect, it } from 'vitest';
import { HEROES, getHero } from '@game/sim';
import { heroFilterCounts } from './heroFilter';

// Real hero ids, sorted by name, so the tie-break below is checkable without hardcoding names.
const [a, b, c] = [...HEROES].sort((x, y) => x.name.localeCompare(y.name)).map((h) => h.id);

describe('heroFilterCounts (Recent Games hero filter, owner ask 2026-10-18)', () => {
  it('counts every hero in the loaded games, most played first, ties by name; skips rows with no hero', () => {
    const rows = [{ heroId: c }, { heroId: b }, { heroId: c }, { heroId: a }, { heroId: null }, {}];
    expect(heroFilterCounts(rows)).toEqual([{ id: c!, n: 2 }, { id: a!, n: 1 }, { id: b!, n: 1 }]);
    expect(getHero(a).name.localeCompare(getHero(b).name)).toBeLessThan(0);
  });

  it('is empty for no rows', () => {
    expect(heroFilterCounts(null)).toEqual([]);
    expect(heroFilterCounts([])).toEqual([]);
  });
});
