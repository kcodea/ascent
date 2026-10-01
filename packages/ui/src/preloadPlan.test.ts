import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX, poolFor, RUNE_INDEX, SETS, type SetId } from '@game/content';
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

import { __resetPreloadPlan, poolArtOrder, preloadBootArt, preloadRunArt, splitCardArt, splitPublicArt, splitRuneArt } from './preloadPlan';
import { ART_URL_GROUPS, artFor } from './art';

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

describe('preloadBootArt: the loading gate (owner 2026-09-30: "i think id rather load everything")', () => {
  const liveSets = (Object.keys(SETS) as SetId[]).filter((id) => SETS[id].enabled);
  const offSets = (Object.keys(SETS) as SetId[]).filter((id) => !SETS[id].enabled);
  const artsOf = (setId: SetId): string[] => poolFor(setId).all.map((c) => artFor(c.id)).filter((u): u is string => !!u);

  it('gates on every image a live-set session can show, all in decoded lanes ahead of the audio bank', () => {
    const gate = preloadBootArt();
    const g = new Set(gate);
    expect(gate.length).toBe(g.size); // deduped
    for (const id of liveSets) for (const u of artsOf(id)) expect(g.has(u), `${id} card art ${u}`).toBe(true);
    for (const group of ['hero', 'power', 'skin', 'equipment', 'quest', 'ancient', 'mode', 'rank'] as const) {
      for (const u of Object.values(ART_URL_GROUPS[group])) expect(g.has(u), `${group} ${u}`).toBe(true);
    }
    for (const p of __PUBLIC_ART__) expect(g.has(`${import.meta.env.BASE_URL}${p}`), p).toBe(true);
    // Every gated URL was queued in a lane the pipe drains BEFORE audio: the gate never waits behind the SFX bank.
    const lanesOf = new Map<string, Set<string>>();
    for (const c of calls) for (const u of c.urls) (lanesOf.get(u) ?? lanesOf.set(u, new Set()).get(u)!).add(c.lane);
    for (const u of gate) expect([...lanesOf.get(u)!].some((l) => l === 'chrome' || l === 'early' || l === 'set'), u).toBe(true);
  });

  it('always gates tokens, Rubies and gifts (they live in no pool, every set can make them)', () => {
    const g = new Set(preloadBootArt());
    const inAnyPool = new Set((Object.keys(SETS) as SetId[]).flatMap((id) => poolFor(id).all.map((c) => c.id)));
    let checked = 0;
    for (const id of Object.keys(CARD_INDEX)) {
      const u = artFor(id);
      if (!u || inAnyPool.has(id)) continue;
      expect(g.has(u), id).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("leaves the cards only an unplayable set owns behind the gate, in `idle` (the Collection's set picker)", () => {
    const g = new Set(preloadBootArt());
    const idle = new Set(calls.filter((c) => c.lane === 'idle').flatMap((c) => c.urls));
    const liveArt = new Set(liveSets.flatMap(artsOf));
    let behind = 0;
    for (const id of offSets) {
      for (const u of artsOf(id)) {
        if (liveArt.has(u)) continue; // carried over into a live set: gated
        expect(g.has(u), u).toBe(false);
        expect(idle.has(u), u).toBe(true);
        behind++;
      }
    }
    if (offSets.length) expect(behind).toBeGreaterThan(0);
    for (const u of idle) expect(g.has(u), u).toBe(false);
  });

  it("covers the saved run's set too when it is not a live one", () => {
    const off = offSets[0];
    if (!off) return;
    const g = new Set(preloadBootArt([off]));
    for (const u of artsOf(off)) expect(g.has(u), u).toBe(true);
  });

  it('a rune offered only in unplayable sets waits behind the gate; every other rune file is gated', () => {
    const gated = new Set<SetId>(liveSets);
    const { gated: rg, other } = splitRuneArt(gated);
    expect(rg.length + other.length).toBe(Object.keys(ART_URL_GROUPS.rune).length);
    const url = (id: string): string => ART_URL_GROUPS.rune[id]!;
    for (const [id, def] of Object.entries(RUNE_INDEX)) {
      if (!ART_URL_GROUPS.rune[id]) continue;
      const live = !def.sets || def.sets.some((s) => gated.has(s as SetId));
      expect(live ? rg.includes(url(id)) : other.includes(url(id)), id).toBe(true);
    }
  });

  it('splitCardArt places every bundled card image exactly once', () => {
    const { gated, other } = splitCardArt(new Set<SetId>(liveSets));
    const all = [...Object.values(ART_URL_GROUPS.minion), ...Object.values(ART_URL_GROUPS.spell)];
    expect([...gated, ...other].sort()).toEqual([...all].sort());
  });
});
