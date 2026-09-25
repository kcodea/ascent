/**
 * WHERE AN OFFER CAME FROM: the small subtitle under the Discover / Choose One title banner (owner ask 2026-09-25:
 * "From Prismatic Pick", "From Runic Beetle", "Triple reward").
 *
 * Only what the run state actually RECORDS is named. A Choose One carries its source (`chooseOne.cardId`, or
 * `chooseOne.equipmentId` for an Equipment's prompt), so it always gets a subtitle. An open Discover carries NONE:
 * `RunState.discover` is just the three offered ids, and `DiscoverSpec` has no source field, so the UI cannot tell a
 * Triple Reward from a rune, a hero power or a Battlecry. Per the owner's brief it gets no subtitle rather than a
 * guess (inferring "the last card played" breaks on queued Discovers, start-of-turn runes and hero powers). Naming a
 * Discover's source needs a sim-side stamp on the spec first; `DiscoverDialog`'s `source` prop is ready for it.
 */

/** The subtitle for a named source, or null when there is nothing to name. */
export function offerSubtitle(sourceName: string | null | undefined): string | null {
  const name = sourceName?.trim();
  return name ? `From ${name}` : null;
}

/** The minimal Choose One shape this reads (`RunState['chooseOne']`). */
export interface ChooseOneSource {
  cardId: string;
  equipmentId?: string;
}

/** Name lookups, injected so the mapping is testable without the content package's full index. */
export interface SourceIndexes {
  cards: Readonly<Record<string, { name: string } | undefined>>;
  equipment: Readonly<Record<string, { name: string } | undefined>>;
}

/** The display name of whatever opened this Choose One: the Equipment (Prismatic Pick) when it is an Equipment's
 *  prompt, else the card being played. Null when the id resolves to nothing (never a raw id on screen). */
export function chooseOneSourceName(co: ChooseOneSource | null | undefined, idx: SourceIndexes): string | null {
  if (!co) return null;
  if (co.equipmentId) return idx.equipment[co.equipmentId]?.name ?? null;
  return idx.cards[co.cardId]?.name ?? null;
}
