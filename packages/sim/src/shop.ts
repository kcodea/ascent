import { makeRng, type CardDef, type Rng, type Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { poolOf } from './cardPool';
import { CIA_ENCHANT_CHANCE, POOL_QUANTITIES, maxTierFor } from './config';
import { getHero, hasPower } from './heroes';
import type { RunState } from './state';
import { stampVeinstormRubies } from './recruit';

/**
 * Croupier Ayse (Lucky Seat): roll every freshly-served offer for the Enchanted mark.
 *
 * EVERY card rolls `CIA_ENCHANT_CHANCE` on its own (owner change 2026-08-22, from "a 50% chance the shop seats
 * exactly ONE"), and the right-hand SPELL SLOT rolls alongside the minion row — `ciaBuyEnchanted` already
 * fires from every buy path including that slot, so an Enchanted spell counted toward the prize the moment one
 * could exist; it just never could, because only the minion row was rolled.
 *
 * Lives HERE, beside `rollShop`, because there are two fill paths and both must roll: the reducer's
 * `refreshTavern` (turn setup + every paid reroll) and `createRun`, which rolls the opening shop directly and
 * so used to serve a guaranteed-plain first shop (owner change 2026-08-22: the first shop can be lucky too).
 *
 * The mark is purely cosmetic on the card (owner ruling 2026-08-16: "it does nothing to the card") — buying it
 * is the only thing it does. One draw per offer ALWAYS, never short-circuited on an already-marked card, so
 * the stream advances by a fixed count and stays reproducible.
 */
export function rollCiaEnchants(state: RunState): void {
  if (!hasPower(state, 'luckySeat')) return; // a MIMICKED Lucky Seat enchants too — behaviour follows the wielded power
  if (state.shop.length === 0 && !state.spell) return;
  const rng = makeRng(state.rngCursor);
  for (const offer of state.shop) {
    if (rng.next() < CIA_ENCHANT_CHANCE) offer.enchanted = true;
  }
  if (state.spell && rng.next() < CIA_ENCHANT_CHANCE) state.spell.enchanted = true;
  state.rngCursor = rng.state();
}

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
  // TUTORIAL: a scripted shop serves authored offers instead of drawing from the pool, so a lesson always has
  // the cards it needs. Kept (frozen) offers still survive a refresh, exactly like the normal path. Nothing
  // here touches the shared pool. Returns early — the pool-draw below never runs for a scripted roll.
  if (state.mode === 'tutorial' && state.tutorialShopScript) {
    rollTutorialShop(state);
    return;
  }
  // Layaway: kept offers survive the reroll — they stay in place (never returned to the pool) and fill the
  // leftmost slots; the rest are returned and redrawn. No kept offers → identical to before (seeds unchanged).
  const kept = state.shop.filter((o) => o.kept);
  for (const offer of state.shop) if (!offer.kept) returnToPool(state, offer.cardId);
  const rng = makeRng(state.rngCursor);
  const slots = tierSlots(state.tier);
  const offers: RunState['shop'] = [...kept];
  // Rune of the Guiding Candle: while the turn's allowance holds, the draw pool is narrowed to that tier.
  // Read here (the single draw site) rather than by post-filtering offers, so the pool bookkeeping stays honest.
  const candle = state.runeGuidingCandle;
  const lockTier = candle && candle.left > 0 ? candle.tier : undefined;
  // The lock IGNORES the tavern-tier ceiling (owner ruling 2026-08-08: "full shops of T6s regardless of player
  // tier"). `availableOffers` filters to `card.tier <= state.tier`, so below tier 6 the narrowed set was always
  // EMPTY and the code fell through to the unrestricted pool — the rune read as doing nothing at every tier it
  // was actually worth buying at. Drawn straight from the run's pinned pool instead, keeping only the tribe and
  // stock rules (a card you can't stock still can't appear).
  const candlePool = lockTier === undefined ? [] : poolOf(state).buyable.filter(
    (card) =>
      card.tier === lockTier &&
      (card.tribe === 'neutral' || state.tribes.includes(card.tribe)) &&
      (state.pool[card.id] ?? 0) > 0,
  );
  for (let i = kept.length; i < slots; i++) {
    const pool = availableOffers(state);
    // Re-filtered per slot so the stock decrements below are respected; falls back only when the tier is
    // genuinely exhausted, which is the one case where a narrowed shop cannot be filled.
    const narrowed = lockTier === undefined ? pool : candlePool.filter((c) => (state.pool[c.id] ?? 0) > 0);
    const id = drawOfferId(rng, narrowed.length > 0 ? narrowed : pool, state.tier);
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
  // VEINSTORM (owner 2026-08-06): every minion in a refreshed shop carries the banked Ruby grant, stamped as
  // a REAL per-offer Ruby buff at mint. Kept offers (Layaway) already hold theirs and must not be stamped
  // twice, which is what `kept` excludes here.
  const vs = state.veinstormRubies;
  if (vs && (vs.atk > 0 || vs.hp > 0)) {
    const stamped: string[] = [];
    for (const o of offers) if (!kept.includes(o) && stampVeinstormRubies(o, vs.atk, vs.hp)) stamped.push(o.uid);
    // A re-stamp is Veinstorm gemming the fresh shop, so it drives the same span — with `onRefresh: true`, so
    // the UI holds it a beat and it lands with the offers rather than while they are still sliding in.
    if (stamped.length > 0) state.veinstormStamped = { uids: stamped, onRefresh: true, attack: vs.atk, health: vs.hp };
  }
  state.shop = offers;
  // Always offer one spell on the right (handoff). Spells are unlimited — not part of the pool — but
  // still gated by tavern tier (a T5 spell can't appear at T2).
  const spellId = drawSpellId(rng, state.tier, state);
  state.spell = spellId ? { uid: `s${state.uidSeq++}`, cardId: spellId } : null;
  state.rngCursor = rng.state();
}

/**
 * Serve a tutorial's scripted offers for the current wave + roll. Frozen (kept) offers survive and fill the
 * leftmost slots exactly like a normal reroll; the remaining slots are the authored card ids, and the spell
 * slot is the authored spell (or empty). Bumps the per-wave roll cursor so the next refresh serves the next
 * authored roll. The course author owns the offer list, so no pool draw and no frozen-dedup is needed here —
 * an authored refresh simply doesn't re-list a card it froze the turn before.
 */
function rollTutorialShop(state: RunState): void {
  const rolls = state.tutorialShopScript![state.wave - 1] ?? [];
  const rollIdx = state.tutorialShopRoll ?? 0;
  const roll = rolls.length > 0 ? rolls[Math.min(rollIdx, rolls.length - 1)]! : { minions: [] as string[] };
  const kept = state.shop.filter((o) => o.kept);
  state.shop = [
    ...kept,
    ...roll.minions.map((cardId) => ({ uid: `s${state.uidSeq++}`, cardId })),
  ];
  state.spell = roll.spell ? { uid: `s${state.uidSeq++}`, cardId: roll.spell } : null;
  state.tutorialShopRoll = rollIdx + 1;
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
 * becomes a random Tier-2, a Tier-3 → Tier-4, …), drawn from your active tribes + neutral.
 *
 * AT THE TIER CAP the offer is REFRESHED IN PLACE instead — a Tier-6 offer becomes a random Tier-6 (owner
 * 2026-07-24: it used to be left untouched, so the spell silently did nothing to the very offers it mattered
 * most for). `Math.min(tier + 1, cap)` expresses both cases: below the cap it steps up, at the cap it re-rolls
 * its own tier. The cap is `maxTierFor(state.rift)` — Tier 7 only with the Summit rift. No HERO raises it:
 * Brackus's `summitLock` grants a single turn-1 Tier-7 Discover, not a higher shop tier.
 *
 * A cap re-roll may legitimately land on the SAME minion, and that still counts as a refresh (owner ruling) —
 * which is why the outgoing copy is counted as an available candidate below, and why every slot gets a FRESH
 * uid even when the card id is unchanged, so the UI re-renders it as a new offer.
 *
 * Per-offer pool accounting: the replaced copy returns and the new copy is taken. When the pick IS the outgoing
 * card those two cancel out, which is exactly right.
 */
export function elevateShop(state: RunState): void {
  const cap = maxTierFor(state.rift);
  const rng = makeRng(state.rngCursor);
  const next: RunState['shop'] = [];
  for (const offer of state.shop) {
    const def = CARD_INDEX[offer.cardId];
    if (!def) { next.push(offer); continue; }
    const target = Math.min(def.tier + 1, cap);
    // The outgoing copy counts as available: it's still held by this offer, so `state.pool` doesn't list it,
    // but a same-tier re-roll is allowed to pick it again.
    const avail = (id: string): number => (state.pool[id] ?? 0) + (id === offer.cardId ? 1 : 0);
    const pool = poolOf(state).buyable.filter(
      (c) => c.tier === target && (c.tribe === 'neutral' || state.tribes.includes(c.tribe)) && avail(c.id) > 0,
    );
    if (pool.length === 0) { next.push(offer); continue; } // genuinely dry pool → keep the offer
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
