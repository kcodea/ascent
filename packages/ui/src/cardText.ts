import { CARD_INDEX } from '@game/content';

/**
 * A summon-buff card (Kennelmaster / Bristleback Matron) shows its *current* buff magnitude
 * (the card's base buff + its accrued `summonBonus` from Avenge / triple-combine). The boosted
 * number is wrapped in a `{{…}}` marker so the Card renders it green (a modified value) and
 * leaves it out of the golden `doubleNums` doubling. Returns null when there's nothing to change
 * (no summon buff, or no bonus) so callers fall back to the card's printed text.
 *
 * Shared by the recruit board (`instView`) and combat units (`Unit`) so a Kennelmaster reads the
 * same boosted value in the shop, the warband, and mid-fight (where `summonBonus` can climb).
 */
export function summonBuffText(cardId: string, summonBonus: number): string | null {
  if (summonBonus <= 0) return null;
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'buffOnSummon');
  if (!def || !eff) return null;
  const base = Number((eff.params as { attack?: number })?.attack ?? 1);
  const m = base + summonBonus;
  return def.text.replace(/\*\*\+\d+\/\+\d+\*\*/, `{{+${m}/+${m}}}`);
}
