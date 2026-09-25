/**
 * SET 3 RUNE CUTS (owner 2026-09-24). Runes cut from Set 3's Runeforge ONLY: each keeps every other set it was in,
 * stays in its RUNES / EPIC_RUNES pool (never archived) and still resolves through RUNE_INDEX, so a run pinned to
 * any set, including an in-flight or replayed Set 3 run that already owns one, keeps working.
 *
 * Two lists: the owner's NAMED cuts (by tribe), and every rune whose `tribes` gate names only tribes Set 3 does not
 * field (Dragon, Beast, Demon/Imp, Mech). The tribal ones were already unreachable in a Set 3 run through the tribe
 * gate; the `sets` scope now says so in the data too.
 */
import { describe, expect, it } from 'vitest';
import { EPIC_RUNES, RUNES, RUNE_INDEX, SETS, type SetId } from '@game/content';
import type { Tribe } from '@game/core';
import { runeforgePool } from './reducer';
import { createRun, type RunState } from './index';

/** The owner's named cuts → the sets each is still offered in afterwards. Grave Orbit and Full Hand were
 *  Set-3-only runes, so the cut left them in no set — and the owner then ARCHIVED both the same day ("remove
 *  them"), so they are pinned in ownerRulings0924.test.ts, not here. */
const NAMED: Record<string, readonly SetId[]> = {
  // Kobolds
  rune_contraband: ['set2'], rune_facetwright: ['set2'], rune_gemcutting: ['set2'], rune_lapidary: ['set2'],
  rune_redirection: ['set2'], rune_ruby_shrapnel: ['set2'], rune_unbroken_vein: ['set2'], rune_shifting_facets: ['set2'],
  // Dwarves ("mykel" is Rune of Mykel, id rune_brisbane)
  rune_last_call: ['set2'], rune_shared_pour: ['set2'], rune_baal: ['set2'], rune_chef: ['set2'],
  rune_brisbane: ['set2'], rune_runic_exchange: ['set2'],
  // Undead
  rune_pillaging: ['set1', 'set2'], rune_rising_graves: ['set1'], rune_soul_taxes: ['set1', 'set2'],
  // Other
  rune_aftershocks: ['set1', 'set2'],
};

/** Runes gated to tribes outside Set 3, which were unscoped (every set) before the cut. */
const TRIBAL = [
  'rune_summoning', 'rune_brood', 'rune_hoardcalling', 'rune_ashen_payroll', 'rune_last_word', 'rune_runic_hoard',
  'rune_burrow', 'rune_glider', 'rune_drake_skull', 'rune_ancient_expenditure', 'rune_clockwork_promotion',
  'rune_night_market', 'rune_muckbroker', 'rune_draconic_curiosity', 'rune_dragons_pantry', 'rune_returning_pack',
  'rune_broodpit', 'rune_stormcalling', 'rune_scales', 'rune_first_claws', 'rune_finality', 'rune_cinder_ledger',
  'rune_wild_hunt', 'rune_food_chain', 'rune_chimerus', 'rune_refreshments', 'rune_dragonscale', 'rune_savagery',
  'rune_foundry', 'rune_ancient_den', 'rune_ancestral_roar', 'rune_delayed_duplication', 'rune_ascension',
  'rune_bottomless_portrait',
];

const CUT = [...Object.keys(NAMED), ...TRIBAL];
const isEpic = (id: string): boolean => EPIC_RUNES.some((r) => r.id === id);

/** Every rune the forge could offer a run of this set: both forges, every tribe the set fields rolled in,
 *  across a few heroes so the hero-conditional Wishbone cannot hide anything. */
function offerable(setId: SetId, tribes: readonly Tribe[] = SETS[setId].tribes): Set<string> {
  const ids = new Set<string>();
  for (const hero of ['warden', 'runesmith']) {
    for (const epic of [false, true]) {
      const s = { ...createRun(7, hero, 'ascent', undefined, setId), tribes: [...tribes], ownedRunes: [], runeforgeEpic: epic || undefined } as RunState;
      for (const id of runeforgePool(s)) ids.add(id);
    }
  }
  return ids;
}

describe('Set 3 rune cuts (owner 2026-09-24)', () => {
  it('every cut rune still exists in its pool and resolves through RUNE_INDEX (never archived)', () => {
    for (const id of CUT) {
      expect(RUNE_INDEX[id], id).toBeDefined();
      expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === id), `${id} is still a live rune def`).toBe(true);
    }
  });

  it('no cut rune is scoped to set 3, and none can be offered at a Set 3 Runeforge, even with every tribe rolled', () => {
    // Every tribe in the game, not just Set 3's: the `sets` scope must hold on its own, not only via the tribe gate.
    const everyTribe: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf', 'spirit', 'celestial'];
    const s3 = offerable('set3', everyTribe);
    for (const id of CUT) {
      expect(RUNE_INDEX[id]!.sets, `${id} is scoped`).toBeDefined();
      expect(RUNE_INDEX[id]!.sets!.includes('set3'), `${id} left set 3`).toBe(false);
      expect(s3.has(id), `${id} offered in a Set 3 run`).toBe(false);
    }
  });

  it('the named cuts are still offered in every other set they belonged to', () => {
    const pools = { set1: offerable('set1'), set2: offerable('set2') };
    for (const [id, sets] of Object.entries(NAMED)) {
      expect([...(RUNE_INDEX[id]!.sets ?? [])].sort(), id).toEqual([...sets].sort());
      // The tribe gate still applies: Pillaging and Soul Taxes keep their set 2 scope, but set 2 fields no Undead.
      const tribes = RUNE_INDEX[id]!.tribes;
      for (const set of sets) {
        if (tribes && !tribes.some((t) => SETS[set].tribes.includes(t))) continue;
        expect(pools[set as 'set1' | 'set2'].has(id), `${id} offered in ${set}`).toBe(true);
      }
    }
  });

  it('the tribal cuts stay offered in set 1 and set 2 when their tribe is rolled', () => {
    const pools = { set1: offerable('set1'), set2: offerable('set2') };
    for (const id of TRIBAL) {
      expect([...RUNE_INDEX[id]!.sets!].sort(), id).toEqual(['set1', 'set2']);
      const tribes = RUNE_INDEX[id]!.tribes!;
      expect(tribes.some((t) => SETS.set3.tribes.includes(t)), `${id} names only non-Set-3 tribes`).toBe(false);
      for (const set of ['set1', 'set2'] as const) {
        if (tribes.some((t) => SETS[set].tribes.includes(t))) expect(pools[set].has(id), `${id} offered in ${set}`).toBe(true);
      }
    }
  });

  it('no rune left in Set 3 is gated only to tribes Set 3 does not field', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      if (r.sets && !r.sets.includes('set3')) continue;
      if (!r.tribes?.length) continue;
      expect(r.tribes.some((t) => SETS.set3.tribes.includes(t)), `${r.id} (${r.tribes.join(', ')}) is still in set 3`).toBe(true);
    }
  });

  it('the Set 3 static pool counts: 83 Basic / 80 Epic since the owner Set 3 rune list (2026-09-25; was 119 / 108)', () => {
    const inS3 = (arr: typeof RUNES) => arr.filter((r) => !r.sets || r.sets.includes('set3'));
    expect(inS3(RUNES)).toHaveLength(83); // 119 → 83 on 2026-09-25 (set3RuneList.test.ts pins the exact ids)
    expect(inS3(EPIC_RUNES)).toHaveLength(80); // 108 → 80 on 2026-09-25
    // 26/28 → 25/27 on 2026-09-24: Full Hand (Basic) and Grave Orbit (Epic) left the cut list for the archive
    expect(CUT.filter((id) => !isEpic(id))).toHaveLength(25);
    expect(CUT.filter(isEpic)).toHaveLength(27);
  });
});
