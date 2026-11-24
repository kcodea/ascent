/** The quick Compendium's tabs and filters (QuickBook.tsx). Pure. */
import type { CardDef, Tribe } from '@game/core';

export type QuickTab = Tribe | 'spells' | 'runes';

/** Its tabs, top to bottom: this game's tribes as the location hangs them (`sheet`: it has a parchment), any tribe it has no
 *  parchment for, then Neutral, Spells and Runes. */
export function quickTabs(tribes: readonly Tribe[], posters: readonly Tribe[] | null): { id: QuickTab; sheet: boolean }[] {
  const hung = (posters ?? []).filter((t) => tribes.includes(t));
  const rest = tribes.filter((t) => !hung.includes(t) && t !== 'neutral');
  return [
    ...hung.map((id) => ({ id: id as QuickTab, sheet: true })),
    ...rest.map((id) => ({ id: id as QuickTab, sheet: false })),
    { id: 'neutral', sheet: false }, { id: 'spells', sheet: false }, { id: 'runes', sheet: false },
  ];
}

/** Is this minion on that tribe's page? (Either of a dual minion's tribes.) */
export const matchesTab = (c: Pick<CardDef, 'tribe' | 'tribe2'>, tab: QuickTab): boolean => c.tribe === tab || c.tribe2 === tab;

interface RuneLike { sets?: readonly string[]; duos?: boolean; tribes?: readonly Tribe[] }
/** Can this game's Runeforge offer it at all? */
export const runeFits = (r: RuneLike, g: { setId: string; duos: boolean; tribes: readonly Tribe[] }): boolean =>
  (!r.sets || r.sets.includes(g.setId)) && (g.duos || !r.duos) && (!r.tribes?.length || r.tribes.some((t) => g.tribes.includes(t)));
/** The rune page's tribe filter: none = every rune; Neutral = the ones with no tribe. */
export const runeOnPage = (r: RuneLike, tribe: Tribe | null): boolean => tribe === null || (tribe === 'neutral' ? !r.tribes?.length : !!r.tribes?.includes(tribe));
