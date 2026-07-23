import { makeRng, type CardDef, type Rng, type Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { poolOf } from './cardPool';
import { POOL_QUANTITIES, maxTierFor } from './config';
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
export function stockPool(tribes: Tribe[], buyable: readonly CardDef[]): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const card of buyable) {
    if (card.tribe === 'neutral' || tribes.includes(card.tribe)) {
      pool[card.id] = POOL_QUANTITIES[card.tier] ?? POOL_FALLBACK;
    }
  }
  return pool;
}

/** Buyable cards at/below tier, of an active (or neutral) tribe, that still have copies left. */
const availableOffers = (state: RunState): CardDef[] =>
  poolOf(state).buyable.filter(
    (card) =>
      card.tier <= state.tier &&
      (card.tribe === 'neutral' || state.tribes.includes(card.tribe)) &&
      (state.pool[card.id] ?? 0) > 0,
  );

/**
 * Draw one offer id from the available pool, uniformly at random (flat weight = 1 per card).
 * The caller decrements the pool. Returns null only when the pool is exhausted.
 */
function drawOfferId(rng: Rng, pool: CardDef[], _tier: number): string | null {
  if (pool.length === 0) return null;
  return pool[rng.int(pool.length)]!.id;
}

/** A spell offer respects the tavern tier — like minions, a spell can only appear once you're at least
 *  its tier. Uniform among the eligible spells. */
const drawSpellId = (rng: Rng, tier: number, state: RunState): string | null => {
  const eligible = poolOf(state).spells.filter((c) => c.tier <= tier);
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
  // Layaway: kept offers survive the reroll — they stay in place (never returned to the pool) and fill the
  // leftmost slots; the rest are returned and redrawn. No kept offers → identical to before (seeds unchanged).
  const kept = state.shop.filter((o) => o.kept);
  for (const offer of state.shop) if (!offer.kept) returnToPool(state, offer.cardId);
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  const offers: RunState['shop'] = [...kept];
  for (let i = kept.length; i < slots; i++) {
    const id = drawOfferId(rng, availableOffers(state), state.tier);
    if (!id) break; // pool exhausted — fewer offers
    state.pool[id] -= 1;
    offers.push({ uid: `s${state.uidSeq++}`, cardId: id });
  }
  // Moe (counter) / Attachment Issues (permanent `alwaysAttachmentShop`): this shop must contain a Magnetic
  // (Attachment) offer — force one in if none rolled naturally (displacing a random offer, returning its copy to
  // the pool). The Moe counter decrements; Attachment Issues' flag is permanent.
  const moeCounter = (state.guaranteedAttachmentShops ?? 0) > 0;
  if (moeCounter) state.guaranteedAttachmentShops! -= 1;
  if (moeCounter || state.alwaysAttachmentShop) {
    const forcedCost = state.attachmentCost ?? 2; // Moe forces at 2 Gold; Attachment Issues uses its deal price
    if (!offers.some((o) => CARD_INDEX[o.cardId]?.keywords.includes('M'))) {
      const magnetics = availableOffers(state).filter((c) => c.keywords.includes('M'));
      if (magnetics.length > 0) {
        const pick = magnetics[rng.int(magnetics.length)]!;
        if (offers.length > 0) {
          const idx = rng.int(offers.length);
          returnToPool(state, offers[idx]!.cardId);
          offers[idx] = { uid: `s${state.uidSeq++}`, cardId: pick.id, cost: forcedCost };
        } else {
          offers.push({ uid: `s${state.uidSeq++}`, cardId: pick.id, cost: forcedCost });
        }
        state.pool[pick.id] -= 1;
      }
    }
  }
  // Attachment Issues: price EVERY Magnetic offer (naturally rolled too, not just the forced one) at the deal.
  if (state.attachmentCost !== undefined) {
    for (const o of offers) if (o.cost === undefined && CARD_INDEX[o.cardId]?.keywords.includes('M')) o.cost = state.attachmentCost;
  }
  state.shop = offers;
  // Always offer one spell on the right (handoff). Spells are unlimited — not part of the pool — but
  // still gated by tavern tier (a T5 spell can't appear at T2).
  const spellId = drawSpellId(rng, state.tier, state);
  state.spell = spellId ? { uid: `s${state.uidSeq++}`, cardId: spellId } : null;
  state.rngCursor = rng.state();
}

/**
 * Spell Cart: refresh the tavern FULL of spells — replace the minion offers with up to `tierSlots` DISTINCT
 * random eligible spells (returning the current minion offers to the pool first). The right-hand spell slot is
 * left as-is. The NEXT normal roll (reroll / turn advance) restocks minions, so this is a one-shot.
 */
export function rollSpellShop(state: RunState): void {
  for (const offer of state.shop) returnToPool(state, offer.cardId);
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  const eligible = poolOf(state).spells.filter((c) => c.tier <= state.tier).map((c) => c.id);
  for (let i = eligible.length - 1; i > 0; i--) { // Fisher–Yates shuffle (seeded) → distinct picks
    const j = rng.int(i + 1);
    [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
  }
  state.shop = eligible.slice(0, slots).map((id) => ({ uid: `s${state.uidSeq++}`, cardId: id }));
  state.rngCursor = rng.state();
}

/**
 * Refresh the MINION offers from a CUSTOM pool filter, decrementing the shared pool per draw exactly like a
 * normal reroll (duplicates allowed while copies remain). The right-hand spell slot is left untouched. Powers
 * the shop-rewrite spells — Sigil of Kinship (one tribe), Elevation Ritual (a fixed tier). An empty filtered
 * pool leaves the shop empty (the next normal roll restocks). Seeded + reproducible via the shop RNG cursor.
 */
export function refillShopFiltered(state: RunState, filter: (c: CardDef) => boolean): void {
  for (const offer of state.shop) returnToPool(state, offer.cardId);
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  const pool = poolOf(state).buyable.filter((c) => filter(c) && (state.pool[c.id] ?? 0) > 0);
  const offers: RunState['shop'] = [];
  for (let i = 0; i < slots && pool.length > 0; i++) {
    const idx = rng.int(pool.length);
    const pick = pool[idx]!;
    offers.push({ uid: `s${state.uidSeq++}`, cardId: pick.id });
    state.pool[pick.id] -= 1;
    if ((state.pool[pick.id] ?? 0) <= 0) pool.splice(idx, 1); // exhausted → can't be drawn again this refresh
  }
  state.shop = offers;
  state.rngCursor = rng.state();
}

/**
 * Elevation Ritual: upgrade EACH minion offer to a random minion ONE tier higher than ITSELF (a Tier-1 offer
 * becomes a random Tier-2, a Tier-3 → Tier-4, …), drawn from your active tribes + neutral. Capped at the rift's
 * max tier — a Tier-7 result needs the Summit rift; an offer already at the cap (or with no upgrade available in
 * the pool) is left untouched. Per-offer pool accounting: the replaced copy returns, the new copy is taken.
 */
export function elevateShop(state: RunState): void {
  const cap = maxTierFor(state.rift);
  const rng = makeRng(state.rngCursor);
  const next: RunState['shop'] = [];
  for (const offer of state.shop) {
    const def = CARD_INDEX[offer.cardId];
    const target = (def?.tier ?? 0) + 1;
    const pool = def && target <= cap
      ? poolOf(state).buyable.filter((c) => c.tier === target && (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) && (state.pool[c.id] ?? 0) > 0)
      : [];
    if (pool.length === 0) { next.push(offer); continue; } // can't upgrade (at the cap / dry pool) → keep the offer
    returnToPool(state, offer.cardId);
    const pick = pool[rng.int(pool.length)]!;
    state.pool[pick.id] -= 1;
    next.push({ uid: `s${state.uidSeq++}`, cardId: pick.id });
  }
  state.shop = next;
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
    const spellId = drawSpellId(rng, state.tier, state);
    if (spellId) state.spell = { uid: `s${state.uidSeq++}`, cardId: spellId };
  }
  state.rngCursor = rng.state();
}
