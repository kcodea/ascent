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
      ruby: '31/14/12/6', // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // runes 9 → 10 on 2026-09-25: Rune of Engraving Gems moved Epic → Basic (owner Set 3 rune list; the census counts Basic runes);  Ruby batch 2026-09-24 (random-Ruby texts move Kobe/Shipment/Gem Sage to engines; Resonance's text rewrite leaves the rune census); Balance 9/23 combined (stat pass + archives + Picnic)
      ale: '32/5/4/29', // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // 31 → 32 on 2026-09-27: Rune of Basic Dwarves now reads 'Dwarf' (was 'Dwarve'), so it tags dwarf; 32 → 31 on 2026-09-18: rune tag pass
      demonConsume: '33/11/7/14', // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // runes 16 → 14: Balance 9/23 combined (rune reworks A rewrote rune texts, #1669); // 14 -> 13 engines: Balance 9/23 minion reworks (Soul Defiler's EoT now casts Staff of Guel) on top of the combined census; // 32 → 33 on 2026-09-18: Dissipate (a sell spell — the consume text match) // Balance 9/23 combined (stat pass + archives + Picnic)
      beastSummon: '28/9/3/12', // merged 2026-10-07: runes +2 for Rune of Actioned Beasts + Rune of the Sunpony (Basic Beast runes; Gator's Bite is Epic) on top of the balance-batch re-pin; // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // Beast buffs combat-only 2026-09-28 (R-AURA-03: 'this combat' texts re-bucket 3 members) // // beast/dragon batch 2026-09-24 (5 new minions, 4 archived) // // 14 → 13 on 2026-09-16: Rune of Rebirth grants the Rebirth keyword now (no longer an Echo-summon text match) // Balance 9/23 combined (stat pass + archives + Picnic)
      dragon: '32/16/9/15', // merged 2026-10-07: runes +1 for Rune of the Echoing Shouts (Dragon batch) on top of −2 archives // // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // beast/dragon batch 2026-09-24 (5 new minions, 4 archived)
      spellEngine: '95/16/13/21', // merged 2026-10-07: −1 member / −1 engine for Orivax losing its spell branch (#1970) // // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // 107/16 → 108/17 on 2026-10-03: Tauntbreaker's Pummel gets a random Shop Spell (a spell-engine member) // beast/dragon batch 2026-09-24 (5 new minions, 4 archived) // // runes 23 → 21: Balance 9/23 combined (rune reworks A: spell runes rewritten, #1669); // 22 → 23 on 2026-09-17: Rune of Gambling (recurring Gamble, every set); 106 → 107 on 2026-09-18: Dissipate // Balance 9/23 combined (stat pass + archives + Picnic)
      echo: '40/14/9/6', // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // beast/dragon batch 2026-09-24 (Wolvie reworked off the next-summon engine) // // 7 → 6 on 2026-09-16: same Rune of Rebirth rework
      mechAttach: '2/0/0/0',
      rally: '27/10/10/6', // beast/dragon batch 2026-09-24 (Raven + Beev) // // Boulderdash gained Flurry (owner 2026-09-18)
      tempo: '38/5/20/32', // merged 2026-10-07: runes +1 for Rune of the Echoing Shouts // // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // members 42 → 40: Beast buffs combat-only 2026-09-28 (R-AURA-03) // // engines 6 → 5: owner rulings 2026-09-24 (Karwind 4/12 → 2/8 leaves the tempo engine set) // members 39 → 42: beast/dragon batch 2026-09-24 // // runes 33 → 32: Ruby batch 2026-09-24 (Rune of Resonance's rewritten text); runes 32 → 33: Balance 9/23 combined (rune reworks A, #1669); // 37/5 → 38/6 on 2026-09-23: the balance 9/23 stat pass moved a body into the tempo package // Balance 9/23 combined (stat pass + archives + Picnic)
      economy: '19/1/15/24', // RE-PINNED 2026-10-07 (owner balance batch: 14 runes + 13 spells archived, Flo Rida / Beardsley / Wolvie / Lou / Roundabout reworks, Jewel + Brood Matron into set 2, Big Brain Billy) // 26 → 25 on 2026-09-18: rune tag pass
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
