import { ANCIENT_IDS, ANCIENT_PAIRINGS, HEROES, isArchivedHero, type AncientId } from '@game/sim';

/**
 * THE SCENE BUILDER'S HERO PICKER DATA (owner ask 2026-10-03: "put archived heroes at the bottom all clumped together
 * ... while in set 3, display a check mark next to heroes that have ancient support so that i know who to work on
 * next"). Pure, so the order and the Ancients coverage are testable without the panel.
 *
 * ANCIENTS COVERAGE is DERIVED from the pairing registry (`ANCIENT_PAIRINGS` in packages/sim/src/ancients.ts: hero id ->
 * Ancient -> pairing), never a hand list: writing a hero's pairings there is what flips their check mark here.
 * A hero with all six Ancients written is `full`; one with some but not all is `partial` (the registry is a
 * `Partial<Record<AncientId, …>>` per hero, so a half-written hero is representable); none is `none`.
 */

export type AncientCoverage = 'full' | 'partial' | 'none';

export interface HeroPick {
  id: string;
  name: string;
  archived: boolean;
  /** Which of the six Ancients have a written pairing for this hero, in `ANCIENT_IDS` order. */
  ancients: readonly AncientId[];
  coverage: AncientCoverage;
  /** Lowercased name + id, matched by the picker's search box. */
  hay: string;
}

export function ancientsWrittenFor(heroId: string): AncientId[] {
  const p = ANCIENT_PAIRINGS[heroId];
  return p ? ANCIENT_IDS.filter((id) => p[id] !== undefined) : [];
}

export function ancientCoverageOf(heroId: string): AncientCoverage {
  const n = ancientsWrittenFor(heroId).length;
  return n === 0 ? 'none' : n >= ANCIENT_IDS.length ? 'full' : 'partial';
}

const byName = (a: HeroPick, b: HeroPick): number => a.name.localeCompare(b.name);

/** EVERY hero (archived included: the Scene Builder is the one place they still show, owner 2026-09-24), current
 *  heroes A to Z first, then the archived ones A to Z as one block at the bottom. */
export const HERO_PICKS: readonly HeroPick[] = (() => {
  const all = HEROES.map((h): HeroPick => {
    const ancients = ancientsWrittenFor(h.id);
    return {
      id: h.id, name: h.name, archived: isArchivedHero(h), ancients,
      coverage: ancientCoverageOf(h.id), hay: `${h.name} ${h.id}`.toLowerCase(),
    };
  });
  return [...all.filter((h) => !h.archived).sort(byName), ...all.filter((h) => h.archived).sort(byName)];
})();

export const HERO_PICK_INDEX: Readonly<Record<string, HeroPick>> = Object.fromEntries(HERO_PICKS.map((h) => [h.id, h]));

/** The picker's two sections for a query (space-separated terms must ALL match, like the Library), each already in
 *  display order. `missingOnly` keeps only heroes whose Ancients are not all written (the "who next" view). */
export function heroPickerSections(query: string, missingOnly = false): { active: HeroPick[]; archived: HeroPick[] } {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const keep = (h: HeroPick): boolean => terms.every((t) => h.hay.includes(t)) && (!missingOnly || h.coverage !== 'full');
  const shown = HERO_PICKS.filter(keep);
  return { active: shown.filter((h) => !h.archived), archived: shown.filter((h) => h.archived) };
}

/** The legend's tallies, over the CURRENT (non-archived) roster. */
export function ancientTally(): { full: number; partial: number; current: number } {
  const cur = HERO_PICKS.filter((h) => !h.archived);
  return {
    full: cur.filter((h) => h.coverage === 'full').length,
    partial: cur.filter((h) => h.coverage === 'partial').length,
    current: cur.length,
  };
}
