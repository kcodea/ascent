import { makeRng } from '@game/core';
import { BUYABLE_CARDS } from '@game/content';
import type { RunState } from './state';

/** Shop size by tier (handoff A.2): 3 @ T1, 4 @ T2–3, 5 @ T4–5, 6 @ T6. */
export const tierSlots = (tier: number): number =>
  tier >= 6 ? 6 : tier >= 4 ? 5 : tier >= 2 ? 4 : 3;

/**
 * Refill the shop from the buyable pool (cards at or below the player's tier),
 * weighted toward the current tier (handoff: shop draws from a weighted pool).
 * Advances and persists the run's shop RNG cursor so rerolls are reproducible.
 */
export function rollShop(state: RunState): void {
  const rng = makeRng(state.rngCursor);
  const pool = BUYABLE_CARDS.filter(
    (card) =>
      card.tier <= state.tier && (card.tribe === 'neutral' || state.tribes.includes(card.tribe)),
  );
  const slots = tierSlots(state.tier);
  const offers: RunState['shop'] = [];

  for (let i = 0; i < slots; i++) {
    const weights = pool.map(
      (card) => 1 + (card.tier === state.tier ? 1.2 : 0) + (card.tier >= state.tier - 1 ? 0.4 : 0),
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    let k = 0;
    while (k < pool.length - 1 && r > (weights[k] ?? 0)) {
      r -= weights[k] ?? 0;
      k++;
    }
    offers.push({ uid: `s${state.uidSeq++}`, cardId: (pool[k] ?? pool[0]).id });
  }

  state.shop = offers;
  state.rngCursor = rng.state();
}
