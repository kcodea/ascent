import { describe, expect, it } from 'vitest';
import { EPIC_RUNES, RUNES } from '@game/content';
import type { Tribe } from '@game/core';
import { runeforgePool } from './reducer';
import { HEROES, playableHeroes, practiceHeroes, powerDiscoverPool } from './heroes';
import { createRun, runTribesForSeed, type RunState } from './state';

/**
 * TRIBE GATE (owner 2026-09-10: "tribe-gated spells are important, as are tribe-gated runes and heroes. (Tiff for
 * Dragons)"). A rune or hero whose text names a tribe on the board is offered only in a run that rolled that tribe.
 * Spells have the same gate in `runSpells` (spellTribeGate.test.ts).
 */

const WORD: Record<Exclude<Tribe, 'neutral'>, RegExp> = {
  // Imps and Fodder ARE Demon content (owner 2026-09-10), so an Imp rune counts as naming Demons.
  dragon: /\bDragons?\b/i, beast: /\bBeasts?\b/i, demon: /\bDemons?\b|\bImps?\b|\bFodder\b/i, mech: /\bMechs?\b/i, undead: /\bUndead\b/i,
  dwarf: /\bDwarv(?:es)?\b|\bDwarf\b/i, kobold: /\bKobolds?\b/i, spirit: /\bSpirits?\b/i, celestial: /\bCelestials?\b/i,
};
/** Owner ruling 2026-09-10: a rune that only GRANTS a tribe body (Kegheart, High King) is gated like one that reads
 *  the board — so this allowlist is empty on purpose. Adding an id here needs an owner call. */
const BODY_GRANT_ONLY = new Set<string>([]);

const namesTribe = (rune: { text: string; reward?: unknown }, tribe: Tribe): boolean =>
  WORD[tribe as Exclude<Tribe, 'neutral'>].test(rune.text) || JSON.stringify(rune).includes(`"tribe":"${tribe}"`) || JSON.stringify(rune).includes(`"randomTribe":"${tribe}"`);

describe('rune tribe tags agree with the printed text', () => {
  it('every tagged tribe is named by the text (or the reward params)', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) for (const t of r.tribes ?? []) expect(namesTribe(r, t), `${r.id} tagged ${t}`).toBe(true);
  });
  it('every rune naming a tribe (or its Imps / Fodder) is tagged', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      if (r.tribes?.length || BODY_GRANT_ONLY.has(r.id)) continue;
      const named = (Object.keys(WORD) as Tribe[]).filter((t) => namesTribe(r, t));
      expect(named, `${r.id} names ${named.join('/')} but has no \`tribes\` tag (or BODY_GRANT_ONLY entry)`).toEqual([]);
    }
  });
});

describe('runeforgePool honours the run tribes', () => {
  const withTribes = (tribes: Tribe[], epic = false): RunState => ({ ...createRun(4, 'runesmith', 'ascent', undefined, 'set2'), tribes, runeforgeEpic: epic || undefined }) as RunState;
  it('a Dragon-less run is never offered a Dragon rune, in either forge', () => {
    for (const epic of [false, true]) {
      const ids = runeforgePool(withTribes(['kobold', 'beast', 'demon', 'dwarf'], epic));
      // the Menageries are any-of (five tribes) and rightly stay offerable; the check is the Dragon-ONLY runes
      const dragonRunes = [...RUNES, ...EPIC_RUNES].filter((r) => r.tribes?.length === 1 && r.tribes[0] === 'dragon').map((r) => r.id);
      expect(dragonRunes.length).toBeGreaterThan(10);
      expect(ids.some((id) => dragonRunes.includes(id))).toBe(false);
      expect(ids.length).toBeGreaterThan(0);
    }
  });
  it('the same run WITH Dragons is offered them', () => {
    expect(runeforgePool(withTribes(['kobold', 'beast', 'demon', 'dwarf', 'dragon']))).toContain('rune_glider');
    expect(runeforgePool(withTribes(['kobold', 'beast', 'demon', 'dwarf', 'dragon'], true))).toContain('rune_scales');
  });
  it('an untagged rune is unaffected by the roll', () => {
    const ids = runeforgePool(withTribes(['spirit']));
    expect(ids.every((id) => !RUNES.find((r) => r.id === id)?.tribes)).toBe(true);
    expect(ids.length).toBeGreaterThan(5);
  });
});

describe('hero tribe gate', () => {
  it('Tiff needs Dragons, Flint needs Dwarves; no tribes = no filter', () => {
    const noDragons: Tribe[] = ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'];
    expect(playableHeroes(noDragons).map((h) => h.id)).not.toContain('tiff');
    expect(playableHeroes(noDragons).map((h) => h.id)).toContain('flint');
    expect(practiceHeroes(['beast', 'dragon']).map((h) => h.id)).not.toContain('flint');
    expect(playableHeroes(['dragon']).map((h) => h.id)).toContain('tiff');
    expect(playableHeroes().map((h) => h.id)).toContain('tiff');
    expect(playableHeroes().length).toBe(HEROES.filter((h) => !h.wip && !h.practiceOnly).length);
  });
  it('adoptable powers (Mimic / Void / Power Shifter) obey the same gate', () => {
    expect(powerDiscoverPool('mimic')).toContain('tiff');
    expect(powerDiscoverPool('mimic', [], ['undead', 'spirit'])).not.toContain('tiff');
    expect(powerDiscoverPool('void', [], ['dragon'])).toContain('tiff');
  });
  it('every tagged hero names the tribe in its power text', () => {
    for (const h of HEROES) for (const t of h.tribes ?? []) expect(WORD[t as Exclude<Tribe, 'neutral'>].test(h.power.text), `${h.id} tagged ${t}`).toBe(true);
  });
});

describe('runTribesForSeed is createRun’s own derivation', () => {
  it('the hero offer filters on exactly the tribes the run will get', () => {
    for (const seed of [1, 2, 3, 77, 9001]) for (const setId of ['set1', 'set2', 'set3'] as const) {
      expect(runTribesForSeed(seed, setId)).toEqual(createRun(seed, undefined, 'ascent', undefined, setId).tribes);
    }
  });
});
