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

/**
 * A transform card (Spirit Pup) appends its live "N to go" countdown (highlighted green) so the
 * player sees how many spells remain before it transforms. `spellProgress` is the per-instance
 * tally; returns null for non-transform cards so callers fall back to the printed text.
 */
export function transformProgressText(cardId: string, spellProgress: number): string | null {
  const def = CARD_INDEX[cardId];
  const eff = def?.effects.find((e) => e.do === 'spellCastTransform');
  if (!def || !eff) return null;
  const at = Number((eff.params as { at?: number })?.at ?? 10);
  return `${def.text} {{${Math.max(0, at - spellProgress)} to go}}`;
}
