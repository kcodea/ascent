/**
 * THE ANNOUNCER'S DECK (owner 2026-11-15: "it feels like i hear a lot of the same lines pretty constantly ... a system
 * that feels more randomized"; "how can we have lines like a shuffled deck?").
 *
 * The no-repeat bag (announcer.ts) only remembers ONE game, so every new game started from a full bag and a moment
 * with a few takes kept landing on the same ones. The deck is the same idea ACROSS games, kept on the device:
 *
 *  · each moment's takes are a deck of cards. Speaking deals one at random from the cards still in the deck;
 *  · a dealt card stays out, game after game, until every card of that moment has been dealt;
 *  · then only the OLDER half of the dealt cards is shuffled back in. The half heard most recently stays out until
 *    those run dry, and so on. So a line can never come back right after it was heard, even across a reshuffle.
 *
 * So a moment with N takes plays all N before any one of them is heard again, and from then on a take always waits
 * out at least N/2 other takes. A moment with a single take is unchanged (one card: it is dealt every time).
 *
 * Pure: the announcer hands in the candidates and a roll, and stores what comes back. Presentation only, per device,
 * never part of a run, a replay or a save.
 */

/** Per moment (the AnnouncerEvent name), the takes dealt since its last reshuffle, oldest first. */
export type AnnouncerDeck = Readonly<Record<string, readonly string[]>>;

export const ANNOUNCER_DECK_KEY = 'ascent.announcerdeck.v1';

export interface DealtTake { take: string; deck: AnnouncerDeck }

/**
 * Deal one take of `event`.
 *  - `candidates`: the takes that may play right now (this game's unheard ones; a keyed moment's own takes). Never empty.
 *  - `all`: every take the event has today, so names of takes since removed drop out of the stored deck.
 *  - `roll`: a uniform roll in [0, 1).
 */
export function dealTake(deck: AnnouncerDeck, event: string, candidates: readonly string[], all: readonly string[], roll: number): DealtTake {
  const dealt = (deck[event] ?? []).filter((t) => all.includes(t));
  const pick = (from: readonly string[]): string => from[Math.min(from.length - 1, Math.max(0, Math.floor(roll * from.length)))]!;
  const inDeck = candidates.filter((t) => !dealt.includes(t));
  if (inDeck.length) {
    const take = pick(inDeck);
    return { take, deck: { ...deck, [event]: [...dealt, take] } };
  }
  // Every candidate has been dealt: shuffle the OLDER half of them back in (another key's takes of a keyed moment
  // are not candidates and stay as they are). The recently heard half stays out.
  const heard = dealt.filter((t) => candidates.includes(t));
  const back = heard.slice(0, heard.length - Math.floor(heard.length / 2));
  const take = pick(back);
  return { take, deck: { ...deck, [event]: [...dealt.filter((t) => !back.includes(t)), take] } };
}

/** A stored deck, read defensively (a corrupt or foreign value is an empty deck). */
export function parseDeck(raw: string | null | undefined): AnnouncerDeck {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(list)) out[k] = list.filter((t): t is string => typeof t === 'string');
    }
    return out;
  } catch {
    return {};
  }
}
