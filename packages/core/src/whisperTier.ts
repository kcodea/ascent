import type { CardDef } from './types';

/**
 * WHISPER TIERS (owner 2026-10-16, R-WHISPER-TIER-01): "whispers should be the tier of the unit they came from, so you
 * should only be able to get whispers from your tier etc from sources like jar of secrets or woozy." Corrected the same
 * day: "if you somehow have a t5 whisper unit on your board and you're t4, the t5 whisper minion still grants its
 * whisper. it's just that from sources like echo/avenge/spell/equipment should abide by player tier."
 *
 *  - A Whisper's tier is the tier of the Whisper MINION that owns it (the card carrying its `grantWhisper` marker).
 *    Derived here from data, never hand-typed: content stamps it onto the Whisper's def when it builds the index. A
 *    Whisper with several owners takes the LOWEST; a Whisper with no owner is Tier 1.
 *  - An owner granting its OWN Whisper is never gated, and neither is Tamby's copy (owner 2026-10-16: "tamby should
 *    always copy a whisper cast on it, even above tier"). EVERY other way of getting a Whisper (a random roll from a spell,
 *    Equipment, rune or hero; a minion's Avenge / Echo / Shout) is gated to Whispers of tier <= the player's
 *    current shop tier, in every phase. Spells and Equipment have no Whisper tier of their own: they are gated SOURCES.
 *
 * Pure and shared, so the Shop (`mintRandomWhispers`) and combat (`grantRandomWhispers`) cannot drift.
 */

/** Is this card a Whisper OWNER (a minion that grants a Whisper of its own)? Archived and Whisper defs never own one. */
function ownedWhisperIds(card: CardDef): string[] {
  if (card.whisper || card.spell) return [];
  return card.effects
    .filter((e) => e.do === 'grantWhisper' && typeof e.params?.cardId === 'string')
    .map((e) => e.params!.cardId as string);
}

/** Every Whisper id → the ids of the minions that own it, in card order. Memoized per card collection object. */
const OWNERS_BY_INDEX = new WeakMap<object, ReadonlyMap<string, readonly string[]>>();
export function whisperOwners(cards: Readonly<Record<string, CardDef>> | readonly CardDef[]): ReadonlyMap<string, readonly string[]> {
  const hit = OWNERS_BY_INDEX.get(cards);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const c of Array.isArray(cards) ? cards : Object.values(cards)) {
    for (const w of ownedWhisperIds(c)) {
      const row = out.get(w) ?? [];
      if (!row.includes(c.id)) row.push(c.id);
      out.set(w, row);
    }
  }
  OWNERS_BY_INDEX.set(cards, out);
  return out;
}

/** Every Whisper id → its tier: the LOWEST tier among its owning minions. A Whisper absent from the map has no owner
 *  and is Tier 1 (`whisperTierFrom`). */
export function whisperOwnerTiers(cards: readonly CardDef[]): Record<string, number> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Record<string, number> = {};
  for (const [w, owners] of whisperOwners(cards)) {
    out[w] = Math.min(...owners.map((o) => byId.get(o)?.tier ?? 1));
  }
  return out;
}

/** The tier a Whisper def carries (stamped by content from its owner). Undefined / non-positive reads as Tier 1. */
export function whisperTierOf(def: CardDef | undefined): number {
  return def?.tier && def.tier > 0 ? def.tier : 1;
}

/** May a GATED source (anything but the Whisper's own minion) hand out this Whisper at this shop tier? */
export function whisperAllowedAtTier(def: CardDef | undefined, tier: number): boolean {
  return !!def?.whisper && whisperTierOf(def) <= Math.max(1, tier);
}

/**
 * The Whispers a gated random roll may produce, in card-index order (deterministic): every Whisper of tier <= `tier`
 * that belongs to the run's pinned set (`inPool(ownerId)` true for at least one owner; an owner-less Whisper is
 * set-agnostic and always rollable). `inPool` undefined = unrestricted (a bare harness).
 */
export function rollableWhisperIds(
  cards: Readonly<Record<string, CardDef>>,
  tier: number,
  inPool?: (cardId: string) => boolean,
): string[] {
  const owners = whisperOwners(cards);
  return Object.values(cards)
    .filter((c) => whisperAllowedAtTier(c, tier))
    .filter((c) => {
      if (!inPool) return true;
      const o = owners.get(c.id);
      return !o || o.length === 0 || o.some(inPool);
    })
    .map((c) => c.id);
}
