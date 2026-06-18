import { makeRng, type CardDef, type Rng } from '@game/core';
import { BUYABLE_CARDS, SPELL_CARDS } from '@game/content';
import type { RunState } from './state';

/** Shop size by tier (handoff A.2): 3 @ T1, 4 @ T2–3, 5 @ T4–5, 6 @ T6. */
export const tierSlots = (tier: number): number =>
  tier >= 6 ? 6 : tier >= 4 ? 5 : tier >= 2 ? 4 : 3;

/** The buyable pool for a run: cards at or below tier, of an active (or neutral) tribe. */
const shopPool = (state: RunState): CardDef[] =>
  BUYABLE_CARDS.filter(
    (card) => card.tier <= state.tier && (card.tribe === 'neutral' || state.tribes.includes(card.tribe)),
  );

/** Draw one offer id from the pool, weighted toward the current tier (handoff). */
function drawOfferId(rng: Rng, pool: CardDef[], tier: number): string {
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

const drawSpellId = (rng: Rng): string | null =>
  SPELL_CARDS.length > 0 ? SPELL_CARDS[rng.int(SPELL_CARDS.length)]!.id : null;

/**
 * Refill the shop from the buyable pool (cards at or below the player's tier),
 * weighted toward the current tier (handoff: shop draws from a weighted pool).
 * Advances and persists the run's shop RNG cursor so rerolls are reproducible.
 */
export function rollShop(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const pool = shopPool(state);
  const slots = tierSlots(state.tier);
  const offers: RunState['shop'] = [];
  for (let i = 0; i < slots; i++) {
    offers.push({ uid: `s${state.uidSeq++}`, cardId: drawOfferId(rng, pool, state.tier) });
  }
  state.shop = offers;
  // Always offer one spell on the right (handoff), drawn from the spell pool.
  const spellId = drawSpellId(rng);
  state.spell = spellId ? { uid: `s${state.uidSeq++}`, cardId: spellId } : null;
  state.rngCursor = rng.state();
}

/**
 * Top up a *frozen* tavern that was carried over with empty slots (you bought some) or a
 * missing spell — freezing a partial shop shouldn't strand you with fewer options after
 * combat. Keeps every frozen offer in place and only fills the gaps up to the tier's count
 * (+ a spell if absent). Reproducible via the shop RNG cursor.
 */
export function topUpTavern(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const pool = shopPool(state);
  const slots = tierSlots(state.tier);
  while (state.shop.length < slots && pool.length > 0) {
    state.shop.push({ uid: `s${state.uidSeq++}`, cardId: drawOfferId(rng, pool, state.tier) });
  }
  if (!state.spell) {
    const spellId = drawSpellId(rng);
    if (spellId) state.spell = { uid: `s${state.uidSeq++}`, cardId: spellId };
  }
  state.rngCursor = rng.state();
}
