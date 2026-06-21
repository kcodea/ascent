import { makeRng, type CardDef, type Rng, type Tribe } from '@game/core';
import { BUYABLE_CARDS, SPELL_CARDS } from '@game/content';
import { POOL_QUANTITIES } from './config';
import type { RunState } from './state';

/** Fallback copy count for a tier not listed in POOL_QUANTITIES (defensive — every tier 1–7 is set). */
const POOL_FALLBACK = 6;

/** Shop size by tier (handoff A.2): 3 @ T1, 4 @ T2–3, 5 @ T4–5, 6 @ T6. */
export const tierSlots = (tier: number): number =>
  tier >= 6 ? 6 : tier >= 4 ? 5 : tier >= 2 ? 4 : 3;

/**
 * Stock a fresh shared minion pool for a run: every buyable minion of the run's active tribes
 * (+ neutral) gets `POOL_QUANTITIES[tier]` copies. Tokens/spells aren't in `BUYABLE_CARDS`, so they
 * are never pooled (and so are ignored by the return/take helpers). This is what makes copies a
 * contested resource — the shop draws from it and sell/reroll return to it.
 */
export function stockPool(tribes: Tribe[]): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const card of BUYABLE_CARDS) {
    if (card.tribe === 'neutral' || tribes.includes(card.tribe)) {
      pool[card.id] = POOL_QUANTITIES[card.tier] ?? POOL_FALLBACK;
    }
  }
  return pool;
}

/** Buyable cards at/below tier, of an active (or neutral) tribe, that still have copies left. */
const availableOffers = (state: RunState): CardDef[] =>
  BUYABLE_CARDS.filter(
    (card) =>
      card.tier <= state.tier &&
      (card.tribe === 'neutral' || state.tribes.includes(card.tribe)) &&
      (state.pool[card.id] ?? 0) > 0,
  );

/**
 * Draw one offer id from the available pool, weighted toward the current tier (handoff). The caller
 * decrements the pool. Returns null only when the pool is exhausted (no eligible copies left) — the
 * shop then simply offers fewer cards, which is the whole point of a finite pool.
 */
function drawOfferId(rng: Rng, pool: CardDef[], tier: number): string | null {
  if (pool.length === 0) return null;
  const weights = pool.map(
    (card) => 1 + (card.tier === tier ? 1.2 : 0) + (card.tier >= tier - 1 ? 0.4 : 0),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  let k = 0;
  while (k < pool.length - 1 && r > (weights[k] ?? 0)) {
    r -= weights[k] ?? 0;
    k++;
  }
  return (pool[k] ?? pool[0]!).id;
}

/** A spell offer respects the tavern tier — like minions, a spell can only appear once you're at least
 *  its tier. Uniform among the eligible spells. */
const drawSpellId = (rng: Rng, tier: number): string | null => {
  const eligible = SPELL_CARDS.filter((c) => c.tier <= tier);
  return eligible.length > 0 ? eligible[rng.int(eligible.length)]!.id : null;
};

/**
 * Return a minion's copies to the shared pool (sell, or a discarded reroll offer). Tokens / Fodder /
 * spells aren't pooled, so they're silently ignored. `n` is 3 for a golden (it ate three copies).
 */
export function returnToPool(state: RunState, cardId: string, n = 1): void {
  if (state.pool && cardId in state.pool) state.pool[cardId] += n;
}

/** Take one copy out of the pool for a *conjured* minion (Discover / Buddy Buddy), so selling it
 *  later returns correctly. Floors at 0 — a conjure from an exhausted pool can't go negative. */
export function takeFromPool(state: RunState, cardId: string): void {
  if (state.pool && cardId in state.pool && state.pool[cardId]! > 0) state.pool[cardId] -= 1;
}

/**
 * Refill the shop from the shared pool. A full reroll first returns the current (discarded) offers
 * to the pool, then draws fresh — decrementing each drawn copy. Advances + persists the shop RNG
 * cursor so rerolls are reproducible.
 */
export function rollShop(state: RunState): void {
  for (const offer of state.shop) returnToPool(state, offer.cardId);
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  const offers: RunState['shop'] = [];
  for (let i = 0; i < slots; i++) {
    const id = drawOfferId(rng, availableOffers(state), state.tier);
    if (!id) break; // pool exhausted — fewer offers
    state.pool[id] -= 1;
    offers.push({ uid: `s${state.uidSeq++}`, cardId: id });
  }
  state.shop = offers;
  // Always offer one spell on the right (handoff). Spells are unlimited — not part of the pool — but
  // still gated by tavern tier (a T5 spell can't appear at T2).
  const spellId = drawSpellId(rng, state.tier);
  state.spell = spellId ? { uid: `s${state.uidSeq++}`, cardId: spellId } : null;
  state.rngCursor = rng.state();
}

/**
 * Top up a *frozen* tavern that carried over with empty slots (you bought some) or a missing spell.
 * Keeps every frozen offer in place (they stay out of the pool) and only fills the gaps from the
 * pool. Reproducible via the shop RNG cursor.
 */
export function topUpTavern(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  while (state.shop.length < slots) {
    const id = drawOfferId(rng, availableOffers(state), state.tier);
    if (!id) break;
    state.pool[id] -= 1;
    state.shop.push({ uid: `s${state.uidSeq++}`, cardId: id });
  }
  if (!state.spell) {
    const spellId = drawSpellId(rng, state.tier);
    if (spellId) state.spell = { uid: `s${state.uidSeq++}`, cardId: spellId };
  }
  state.rngCursor = rng.state();
}
