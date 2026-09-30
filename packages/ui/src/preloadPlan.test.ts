import { beforeEach, describe, expect, it, vi } from 'vitest';
import { poolFor, SETS, type SetId } from '@game/content';
import { createRun, poolOf } from '@game/sim';

/**
 * The preload PLAN (art pop-in fix 2026-09-29): which art goes in which lane. Pins the three things the fix rests
 * on — the chrome lane is ordered title → shop → hand and skips tribes no live set uses; a pool's art is queued
 * tier-first; and the run plan reads the run's PINNED pool (`poolOf(run)`), never another set's.
 */
const calls = vi.hoisted(() => [] as { lane: string; urls: string[] }[]);
vi.mock('./artPreload', () => ({
  requestArtList: (urls: Iterable<string | undefined>, lane: string) => {
    calls.push({ lane, urls: [...urls].filter((u): u is string => !!u) });
  },
}));

import { __resetPreloadPlan, poolArtOrder, preloadRunArt, splitPublicArt } from './preloadPlan';
import { artFor } from './art';

beforeEach(() => { calls.length = 0; __resetPreloadPlan(); });

describe('splitPublicArt', () => {
  const list = [
    'augustfullboard.webp', 'board.jpg', 'cursors/gauntlet_open.svg', 'frames/cardplate-beast.webp',
    'frames/cardplate-mech.webp', 'frames/milestone-atk-1.webp', 'frames/milestone-atk-3.webp', 'frames/oval-beast-gilded.webp',
    'frames/oval-beast.webp', 'frames/oval-mech.webp', 'frames/taunt-beast.webp', 'frames/taunt-shield.png',
    'frames/tier-stars-1.webp', 'frames/title-logo.png', 'fx/burst-blue.png', 'homescreen.webp', 'medallions/echo.webp',
  ];
  /** Drop the BASE_URL prefix ('/' under test, './' in the build). */
  const strip = (xs: string[]): string[] => xs.map((u) => u.replace(/^\.?\//, ''));

  it('orders the chrome lane title → shop → hand, and leaves gilded / milestone / FX art to a later lane', () => {
    const { chrome, rest } = splitPublicArt(list);
    const c = strip(chrome);
    expect(c.indexOf('homescreen.webp')).toBeLessThan(c.indexOf('augustfullboard.webp'));
    expect(c.indexOf('frames/title-logo.png')).toBeLessThan(c.indexOf('frames/oval-beast.webp'));
    expect(c.indexOf('frames/oval-beast.webp')).toBeLessThan(c.indexOf('frames/cardplate-beast.webp'));
    expect(c).toContain('frames/tier-stars-1.webp');
    expect(c.indexOf('medallions/echo.webp')).toBeLessThan(c.indexOf('frames/cardplate-beast.webp'));
    expect(c).toContain('frames/milestone-atk-1.webp');
    for (const later of ['frames/oval-beast-gilded.webp', 'frames/milestone-atk-3.webp', 'fx/burst-blue.png', 'frames/taunt-shield.png', 'board.jpg']) {
      expect(strip(rest), later).toContain(later);
      expect(c).not.toContain(later);
    }
  });

  it('a per-tribe frame for a tribe no live set uses is not chrome', () => {
    const { chrome, rest } = splitPublicArt(list, new Set(['beast', 'neutral']));
    expect(chrome.some((u) => u.endsWith('frames/oval-mech.webp'))).toBe(false);
    expect(chrome.some((u) => u.endsWith('frames/cardplate-mech.webp'))).toBe(false);
    expect(rest.some((u) => u.endsWith('frames/oval-mech.webp'))).toBe(true);
    expect(chrome.some((u) => u.endsWith('frames/oval-beast.webp'))).toBe(true);
  });
});

describe('poolArtOrder', () => {
  it('queues the early tiers first, lowest tier first, each art once', () => {
    const cards = poolFor('set2').all;
    const { early, rest } = poolArtOrder(cards, 2);
    const tierOf = new Map<string, number>();
    for (const c of cards) { const u = artFor(c.id); if (u && !tierOf.has(u)) tierOf.set(u, c.tier); }
    expect(early.length).toBeGreaterThan(20);
    expect(early.every((u) => (tierOf.get(u) ?? 99) <= 2)).toBe(true);
    const tiers = [...early, ...rest].map((u) => tierOf.get(u)!);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers); // tier-ascending overall
    expect(new Set([...early, ...rest]).size).toBe(early.length + rest.length); // no duplicate fetches
  });
});

describe('preloadRunArt', () => {
  it("queues exactly the run's pinned pool — early tiers in `early`, the rest in `set` — and nothing from another set", () => {
    const ids = Object.keys(SETS) as SetId[];
    for (const setId of ids) {
      __resetPreloadPlan();
      calls.length = 0;
      const run = createRun(7, undefined, undefined, undefined, setId);
      preloadRunArt(run);
      const queued = new Set(calls.flatMap((c) => c.urls));
      const expected = new Set(poolOf(run).all.map((c) => artFor(c.id)).filter((u): u is string => !!u));
      expect(queued, setId).toEqual(expected);
      expect(calls.map((c) => c.lane)).toEqual(['early', 'set']);
      const early = new Set(calls[0]!.urls);
      for (const c of poolOf(run).all) {
        const u = artFor(c.id);
        if (u && c.tier <= 2) expect(early.has(u), `${setId} ${c.id}`).toBe(true);
      }
    }
  });

  it('re-plans only when the set, tribes or tier move (a shop roll queues nothing)', () => {
    const run = createRun(7);
    preloadRunArt(run);
    const n = calls.length;
    preloadRunArt({ ...run });
    expect(calls.length).toBe(n);
    preloadRunArt({ ...run, tier: 3 });
    expect(calls.length).toBe(n + 2);
    // One tier past the tavern counts as early.
    const early = new Set(calls[n]!.urls);
    const t4 = poolOf(run).all.find((c) => c.tier === 4 && artFor(c.id));
    expect(t4 && early.has(artFor(t4.id)!)).toBe(true);
  });
});
