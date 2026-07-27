import type { CombatEvent } from '@game/core';
import type { MomentKind } from './kinds';

/**
 * Per-CARD authored FX, overriding the moment kind's default def.
 *
 * The `fxDef` channel binds a def to a moment KIND, which is right for anything generic ("a Ward was gained")
 * but cannot express "this specific card's effect looks like this" — Bloodbinder's bleed and every other
 * spell cast share the `scCast` kind, so binding there would give all of them the same effect. This table is
 * the narrower key: card id first, then kind.
 *
 * It mirrors how audio already works (per-card SFX by naming convention), so "this card has its own look"
 * sits alongside "this card has its own sound" rather than being a new concept.
 */
export interface CardFxBinding {
  /** The def id to play instead of the kind's default. */
  def: string;
  /**
   * How to choose the target the effect travels TO.
   *
   * `'primary'` (the default) uses the moment's own source/target pair, which is what every kind-level
   * binding does. `'damaged'` fans out: one play per distinct unit damaged inside the moment, all from the
   * same source. That exists because a cast's own event frequently carries NO target — Bloodbinder emits one
   * `sc` ("Bloodbinder bleeds") and then a separate damage event per marked enemy — so a travelling effect
   * bound to it would have nowhere to travel to, and would silently collapse onto the source.
   */
  fanOut?: 'primary' | 'damaged';
}

/** cardId → moment kind → binding. */
export const CARD_FX: Record<string, Partial<Record<MomentKind, CardFxBinding>>> = {
  // Start of Combat marks enemies; every 4 attacks the marks each take Bloodbinder's Attack. The proc emits
  // one targetless `sc` plus a damage event per mark, so the lance flies to each of them.
  bloodbinder: { scCast: { def: 'ember-lance', fanOut: 'damaged' } },
};

/** The binding for a card at a kind, or null. `null` cardId (no unit on screen) never matches. */
export function cardFxFor(cardId: string | null, kind: MomentKind): CardFxBinding | null {
  if (cardId === null) return null;
  return CARD_FX[cardId]?.[kind] ?? null;
}

/**
 * The distinct units damaged within `[start, end)` of the event log — the fan-out targets.
 *
 * Distinct because one moment can carry several damage events against the same unit (a hit plus a
 * follow-up), and firing the same travelling effect twice at one card reads as a stutter rather than as two
 * hits. Order-preserving so the plays go out in the order the engine dealt them.
 */
export function damagedUidsIn(events: readonly CombatEvent[], start: number, end: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const e = events[i];
    if (e?.type !== 'dmg') continue;
    const uid = e.target;
    if (typeof uid !== 'string' || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}
