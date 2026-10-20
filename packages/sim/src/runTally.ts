import { CARD_INDEX } from '@game/content';
import type { RunState } from './state';

/**
 * RUN-WIDE "X or Y played this game" tallies (Vaultkeeper, owner 2026-10-20: "lets change its mechanic to 4 dragons or
 * dwarves played improves it. i want this mechanic to be active even when the card is not on board or in hand or in
 * shop"). The count lives on the RUN (`RunState.tribeUnionPlays`), never on a copy, so it ticks while no reader is
 * owned and a copy bought late arrives already improved. Printed with the existing "this game" tail ("Improves every
 * 4 Dragons or Dwarves played this game."), the same one Tome uses; no keyword (owner 2026-10-20).
 */

/** The factory whose `tribes` union is counted run-wide. */
export const RUN_TALLY_FACTORY = 'tribePlayedGainSelfImproving';

/** The map key for a `tribes` union: sorted, `+`-joined (`dragon+dwarf`), so the order a card lists them never matters. */
export function tribeUnionKey(tribes: readonly string[]): string {
  return [...tribes].map(String).sort().join('+');
}

/** How many minions of ANY of `tribes` have been played this game. */
export function tribeUnionPlaysOf(counts: RunState['tribeUnionPlays'], tribes: readonly string[]): number {
  return counts?.[tribeUnionKey(tribes)] ?? 0;
}

let unions: readonly (readonly string[])[] | null = null;
/** Every `tribes` union some card counts run-wide (computed once, from the global index: every set, so the count runs
 *  whatever set a reader later comes from). */
export function runTallyUnions(): readonly (readonly string[])[] {
  if (unions) return unions;
  const seen = new Map<string, readonly string[]>();
  for (const def of Object.values(CARD_INDEX)) {
    for (const e of def.effects) {
      const t = e.do === RUN_TALLY_FACTORY ? (e.params as { tribes?: unknown } | undefined)?.tribes : undefined;
      if (Array.isArray(t) && t.length) seen.set(tribeUnionKey(t.map(String)), t.map(String));
    }
  }
  return (unions = [...seen.values()]);
}

/** The run-wide tally a card reads, or undefined when the card has none. The ONE place the UI resolves it, so every
 *  surface (shop, Discover, hand, board, combat, end screen) prints the same number. */
export function runTallyFor(cardId: string, counts: RunState['tribeUnionPlays']): number | undefined {
  const eff = CARD_INDEX[cardId]?.effects.find((e) => e.do === RUN_TALLY_FACTORY);
  const t = (eff?.params as { tribes?: unknown } | undefined)?.tribes;
  return Array.isArray(t) ? tribeUnionPlaysOf(counts, t.map(String)) : undefined;
}
