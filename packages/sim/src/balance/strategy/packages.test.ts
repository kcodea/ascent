import { describe, expect, it } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { packageCensus, renderPackageCensus, runeAffinity, runeIsRecurring, STRATEGY_PACKAGES, unknownManifestHeroes } from './packages';
import { packageFits, pickLineForRun, rankPackages, viableLineCount, VIABLE_FIT } from './lines';

/**
 * B4 — the package roster is DERIVED from the content: this pins the set-2 census so a content change that empties
 * or thins a package is visible in a test diff, not discovered when a pilot silently has nothing to build.
 */
const SET2_TRIBES = ['kobold', 'dragon', 'beast', 'demon', 'dwarf'] as const;

describe('strategy packages — set-2 census', () => {
  const rows = packageCensus('set2');

  it('covers the required lines and labels the unsupported ones honestly', () => {
    const ids = STRATEGY_PACKAGES.map((p) => p.id);
    for (const required of ['ruby', 'ale', 'demonConsume', 'beastSummon', 'dragon', 'mechAttach', 'echo', 'spellEngine', 'tempo', 'economy']) {
      expect(ids, `package ${required} missing`).toContain(required);
    }
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // Set 2 fields no Mechs: the Mech package is declared and reported UNSUPPORTED, never quietly empty.
    expect(byId.mechAttach!.status).toBe('unsupported');
    expect(byId.mechAttach!.tribeSupported).toBe(false);
    // Every other package is buildable from set 2's pool.
    for (const r of rows) {
      if (r.id === 'mechAttach') continue;
      expect(r.status, `${r.id} is ${r.status}`).not.toBe('unsupported');
      expect(r.members, `${r.id} has too few members`).toBeGreaterThanOrEqual(6);
      expect(r.payoffs, `${r.id} has no payoff card`).toBeGreaterThan(0);
      expect(r.keyCards.length).toBeGreaterThan(0);
    }
  });

  it('pins the set-2 member counts (a content change that moves a package shows up here)', () => {
    const census = Object.fromEntries(rows.map((r) => [r.id, `${r.members}/${r.engines}/${r.payoffs}/${r.affineRunes}`]));
    expect(census).toEqual({
      ruby: '30/12/14/11',
      ale: '31/5/4/31', // 32 → 31 on 2026-09-18: rune tag pass
      demonConsume: '33/13/7/18', // 32 → 33 on 2026-09-18: Dissipate (a sell spell — the consume text match)
      beastSummon: '30/7/5/13', // 14 → 13 on 2026-09-16: Rune of Rebirth grants the Rebirth keyword now (no longer an Echo-summon text match)
      dragon: '33/16/10/15',
      spellEngine: '107/16/13/23', // 22 → 23 on 2026-09-17: Rune of Gambling (recurring Gamble, every set); 106 → 107 on 2026-09-18: Dissipate
      echo: '39/14/9/6', // 7 → 6 on 2026-09-16: same Rune of Rebirth rework
      mechAttach: '2/0/0/0',
      rally: '26/8/11/6', // Boulderdash gained Flurry (owner 2026-09-18)
      tempo: '38/6/20/35', // 37/5 → 38/6 on 2026-09-23: the balance 9/23 stat pass moved a body into the tempo package
      economy: '20/1/16/25', // 26 → 25 on 2026-09-18: rune tag pass
    });
  });

  it('names the engine pieces where they should be', () => {
    const key = (id: string): string[] => rows.find((r) => r.id === id)!.keyCards.map((k) => k.cardId);
    expect(key('ruby')).toContain('k_kobabyboldies');
    expect(key('ale')).toContain('dw_edward');
    expect(key('demonConsume')).toContain('dm_glutton');
    expect(key('beastSummon')).toContain('b2_oona');
    expect(key('dragon')).toContain('karwind');
    expect(key('spellEngine')).toContain('stewardofspells');
    expect(key('echo')).toContain('sylus');
  });

  it('the hero intent manifest names only real heroes', () => {
    expect(unknownManifestHeroes()).toEqual([]);
  });

  it('rune affinity follows the synergy tags and the tribe gate; recurrence is read off the reward', () => {
    const ruby = STRATEGY_PACKAGES.find((p) => p.id === 'ruby')!;
    expect(runeAffinity(ruby, RUNE_INDEX['rune_resonance']!)).toBe(1);
    expect(runeAffinity(ruby, RUNE_INDEX['rune_window_shopping']!)).toBe(0);
    expect(runeIsRecurring(RUNE_INDEX['rune_resonance']!)).toBe(true); // "Get 2 Rubies every turn"
    expect(runeIsRecurring(RUNE_INDEX['rune_small_fortune']!)).toBe(false); // "Get 7 Gold immediately"
    expect(runeIsRecurring(RUNE_INDEX['rune_vault']!)).toBe(false); // one threshold, once
  });

  it('renders a census', () => {
    const md = renderPackageCensus('set2');
    expect(md).toContain('| ruby |');
    expect(md).toContain('unsupported');
  });
});

describe('line selection', () => {
  it('fit = tribe availability × hero affinity × pool depth; Mech is never viable in set 2', () => {
    const fits = packageFits('fibbsy', SET2_TRIBES, 'set2');
    const by = Object.fromEntries(fits.map((f) => [f.id, f]));
    expect(by.mechAttach!.fit).toBe(0);
    expect(by.ruby!.heroAffinity).toBeGreaterThan(1);
    expect(by.ruby!.fit).toBeGreaterThan(by.ale!.fit);
    // Echo keeps a floor without Undead (neutral core) but ranks below every tribe-supported line.
    expect(by.echo!.tribeAvailability).toBeLessThan(1);
    expect(by.echo!.fit).toBeGreaterThanOrEqual(VIABLE_FIT);
  });

  it('exploration 0 is the best fit; k rotates through the viable lines and wraps; deterministic in the seed', () => {
    const n = viableLineCount('drakko', SET2_TRIBES, 'set2');
    expect(n).toBeGreaterThanOrEqual(9);
    const ranked = rankPackages('drakko', SET2_TRIBES, 'set2', 5);
    expect(pickLineForRun('drakko', SET2_TRIBES, 5, 0).primary).toBe(ranked[0]!.id);
    expect(pickLineForRun('drakko', SET2_TRIBES, 5, 0).primary).toBe('dragon'); // Drakko's Shout quest
    const seen = new Set<string>();
    for (let k = 0; k < n; k++) seen.add(pickLineForRun('drakko', SET2_TRIBES, 5, k).primary);
    expect(seen.size).toBe(n);
    expect(pickLineForRun('drakko', SET2_TRIBES, 5, n)).toEqual(pickLineForRun('drakko', SET2_TRIBES, 5, 0));
    for (let k = 0; k < n; k++) {
      const line = pickLineForRun('drakko', SET2_TRIBES, 5, k);
      expect(line.fitRank).toBe(k);
      expect(line.primary).not.toBe('mechAttach');
      expect(line.secondary).not.toBe(line.primary);
    }
    expect(pickLineForRun('tiff', SET2_TRIBES, 9, 2)).toEqual(pickLineForRun('tiff', SET2_TRIBES, 9, 2));
  });

  it('a tribe-gated line is unavailable on a run without the tribe', () => {
    const fits = packageFits('fibbsy', ['dragon', 'beast', 'demon', 'dwarf'], 'set2');
    expect(fits.find((f) => f.id === 'ruby')!.fit).toBe(0);
    for (let k = 0; k < 12; k++) expect(pickLineForRun('fibbsy', ['dragon', 'beast', 'demon', 'dwarf'], 1, k).primary).not.toBe('ruby');
  });
});
