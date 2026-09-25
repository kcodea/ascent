import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, SETS } from '@game/content';
import type { QuestReward } from '@game/core';
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
  dragon: /\bDragons?\b/i, beast: /\bBeasts?\b/i, demon: /\bDemons?\b|\bImps?\b|\bFodder\b/i, mech: /\bMechs?\b|\bAttachments?\b/i, undead: /\bUndead\b/i,
  // The Starform is the Celestials' token (set 3, 2026-09-12) and Star Crash is their own spell, so a Starform or Star Crash rune
  // counts as naming Celestials — the Imp rule; the three Revelers ARE Spirit content (Set 3 batch 2, 2026-09-16), so a Reveler rune names Spirits.
  // Rubies are the Kobolds' currency, Dwarven Ales the Dwarves', Attachments the Mechs' (owner tag pass 2026-09-18).
  dwarf: /\bDwarv(?:es|en)?\b|\bDwarf\b|\bAles?\b/i, kobold: /\bKobolds?\b|\bRub(?:y|ies)\b/i, spirit: /\bSpirits?\b|\bRevelers?\b/i, celestial: /\bCelestials?\b|\bStarforms?\b|\bStar Crash(?:es)?\b/i,
};
/** Owner ruling 2026-09-10: a rune that only GRANTS a tribe body (Kegheart, High King) is gated like one that reads
 *  the board — so this allowlist is empty on purpose. Adding an id here needs an owner call. */
const BODY_GRANT_ONLY = new Set<string>([]);
/** OWNER-RULED tags whose text names the tribe by its KEYWORD rather than by name. Rune of the Deathtouched Apple
 *  ("When a minion Rises, give it Rise") is Undead (owner 2026-09-23, Balance 9/23: "make deathtouched apple an
 *  undead rune, so it is not in set 2") — Rise is the Undead keyword, the way Imps are Demon content. Rune of
 *  Hoardcalling ("get a Hoardflame or Dragonflame") is Dragon (owner 2026-09-24: "hoardcalling should have a dragon
 *  tag") — its rewards are Dragon spells, which the name-matcher does not read as naming Dragons. Rune of Choices
 *  and Rune of Sold Choices are Kobold (owner rune batch 2026-09-25 lists both under Kobold: Choose One is the
 *  Kobold keyword, like Rise for the Undead). Rune of Storming Veins (Veinstorm is the Kobold spell) and Rune of
 *  Aggressive Golems (the Gemheart Golem is the Kobold token) are Kobold by the same list. Adding an id here needs an owner call. */
const OWNER_TRIBE_RULINGS: Readonly<Record<string, Tribe>> = { rune_deathtouched_apple: 'undead', rune_hoardcalling: 'dragon', rune_choices: 'kobold', rune_sold_choices: 'kobold', rune_storming_veins: 'kobold', rune_aggressive_golems: 'kobold' };

/** The tribes of the bodies a reward GRANTS (Rune of Lazarus → Lazarus is Undead) — the 2026-09-10 ruling's
 *  "only grants a tribe body" case, resolved through the card index rather than a hand list. */
const grantedTribes = (r: QuestReward | undefined): Tribe[] => {
  if (!r) return [];
  if (r.kind === 'grant') return [...(r.cards ?? []), ...(r.grantGolden ?? [])].map((id) => CARD_INDEX[id]?.tribe).filter((t): t is Tribe => !!t && t !== 'neutral');
  if (r.kind === 'recurringGrant') return r.cards.map((id) => CARD_INDEX[id]?.tribe).filter((t): t is Tribe => !!t && t !== 'neutral');
  if (r.kind === 'multi') return r.rewards.flatMap(grantedTribes);
  return [];
};
const namesTribe = (rune: { id?: string; text: string; reward?: QuestReward }, tribe: Tribe): boolean =>
  (!!rune.id && OWNER_TRIBE_RULINGS[rune.id] === tribe) || WORD[tribe as Exclude<Tribe, 'neutral'>].test(rune.text) || JSON.stringify(rune).includes(`"tribe":"${tribe}"`) || JSON.stringify(rune).includes(`"randomTribe":"${tribe}"`) || grantedTribes(rune.reward).includes(tribe);

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
  it('Rune of the Deathtouched Apple is Undead-gated: never in a Set 2 run (no Undead there), still in a Set 1 / Set 3 run that rolled Undead', () => {
    // Owner 2026-09-23 (Balance 9/23): "make deathtouched apple an undead rune, so it is not in set 2".
    expect(EPIC_RUNES.find((r) => r.id === 'rune_deathtouched_apple')?.tribes).toEqual(['undead']);
    expect(SETS.set2.tribes).not.toContain('undead'); // the set fields no Undead, so no Set 2 run can roll them
    for (const seed of [1, 2, 3, 77, 9001]) {
      const s2 = { ...createRun(seed, 'runesmith', 'ascent', undefined, 'set2'), runeforgeEpic: true } as RunState;
      expect(s2.tribes).not.toContain('undead');
      expect(runeforgePool(s2)).not.toContain('rune_deathtouched_apple');
    }
    for (const setId of ['set1', 'set3'] as const) {
      const withUndead = { ...createRun(4, 'runesmith', 'ascent', undefined, setId), tribes: ['undead', 'kobold'] as Tribe[], runeforgeEpic: true } as RunState;
      expect(runeforgePool(withUndead), `${setId} with Undead`).toContain('rune_deathtouched_apple');
      const without = { ...withUndead, tribes: ['kobold', 'dwarf'] as Tribe[] } as RunState;
      expect(runeforgePool(without), `${setId} without Undead`).not.toContain('rune_deathtouched_apple');
    }
  });
  it('an untagged rune is unaffected by the roll', () => {
    const ids = runeforgePool(withTribes(['spirit']));
    expect(ids.every((id) => !RUNES.find((r) => r.id === id)?.tribes)).toBe(true);
    expect(ids.length).toBeGreaterThan(5);
  });
});

/** Tiff + Flint are the only tribe-gated heroes, and both were ARCHIVED 2026-09-24 (heroArchive.test.ts), so the
 *  gate is exercised with their archive flag lifted for the test body and restored after. */
const withUnarchived = (ids: string[], fn: () => void): void => {
  const defs = ids.map((id) => HEROES.find((h) => h.id === id)!);
  const saved = defs.map((h) => h.wip);
  defs.forEach((h) => { h.wip = false; });
  try { fn(); } finally { defs.forEach((h, i) => { h.wip = saved[i]; }); }
};

describe('hero tribe gate', () => {
  it('Tiff needs Dragons, Flint needs Dwarves; no tribes = no filter', () => withUnarchived(['tiff', 'flint'], () => {
    const noDragons: Tribe[] = ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'];
    expect(playableHeroes(noDragons).map((h) => h.id)).not.toContain('tiff');
    expect(playableHeroes(noDragons).map((h) => h.id)).toContain('flint');
    expect(practiceHeroes(['beast', 'dragon']).map((h) => h.id)).not.toContain('flint');
    expect(playableHeroes(['dragon']).map((h) => h.id)).toContain('tiff');
    expect(playableHeroes().map((h) => h.id)).toContain('tiff');
    expect(playableHeroes().length).toBe(HEROES.filter((h) => !h.wip && !h.practiceOnly).length);
  }));
  it('adoptable powers (Mimic / Void / Power Shifter) obey the same gate', () => withUnarchived(['tiff'], () => {
    expect(powerDiscoverPool('mimic')).toContain('tiff');
    expect(powerDiscoverPool('mimic', [], ['undead', 'spirit'])).not.toContain('tiff');
    expect(powerDiscoverPool('void', [], ['dragon'])).toContain('tiff');
  }));
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
