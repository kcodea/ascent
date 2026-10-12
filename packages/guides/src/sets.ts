/**
 * GUIDES: which sets a guide shows in (spec section 5; owner 2026-10-11: "any guides that still have all referenced
 * cards can carry over").
 *
 * A guide belongs in set S when every Core card, every Enabler and every card named in the write-up is in S's
 * pool, and its tribes and "pairs with" tribe are on S's roster. The ART ICON does not count: it may be any card
 * with art, a token included (the Imps guide wears `impscrap`, which is in no set's pool).
 *
 * Client only (the server does not know the card list). Pure: the caller supplies the pools.
 */
export interface SetFacts {
  id: string;
  cardIds: ReadonlySet<string>;
  tribes: readonly string[];
}

export interface GuideCards {
  core: readonly string[];
  enablers: readonly string[];
  mentions?: readonly string[];
  tribes: readonly string[];
  pairsWith?: readonly string[];
}

export function guideSetsFor(g: GuideCards, sets: readonly SetFacts[]): string[] {
  const ids = [...g.core, ...g.enablers, ...(g.mentions ?? [])];
  const tribes = [...g.tribes, ...(g.pairsWith ?? [])];
  return sets.filter((s) => ids.every((id) => s.cardIds.has(id)) && tribes.every((t) => s.tribes.includes(t))).map((s) => s.id);
}
