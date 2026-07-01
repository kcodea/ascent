import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';

/**
 * Post-combat summary (A4): the PERMANENT gains a fight left you with, as readable lines. Pure mapping over
 * the carry-back channels already on `CombatResult` (the run loop applies these in settleCombat) — no engine
 * work, just presentation. Ordered most-impactful first. Returns [] when nothing lasting happened.
 */
const sv = (a: number, h: number): string => `+${a}/+${h}`;
const nameOf = (id: string): string => CARD_INDEX[id]?.name ?? id;
const plural = (n: number, s: string): string => `${n} ${s}${n === 1 ? '' : 's'}`;

export function combatGains(r: CombatResult | null | undefined): string[] {
  if (!r) return [];
  const out: string[] = [];

  if (r.playerSpellPower && (r.playerSpellPower.attack || r.playerSpellPower.health)) {
    out.push(`Your spells gain ${sv(r.playerSpellPower.attack, r.playerSpellPower.health)} — permanent`);
  }
  if (r.playerMaxGoldGain) out.push(`Maximum Gold +${r.playerMaxGoldGain}`);
  if (r.playerUndeadBuyAtkGain) out.push(`Your Undead gain +${r.playerUndeadBuyAtkGain} Attack — permanent`);
  if (r.playerImpBuffGain && (r.playerImpBuffGain.attack || r.playerImpBuffGain.health)) {
    out.push(`Your Imps gain ${sv(r.playerImpBuffGain.attack, r.playerImpBuffGain.health)} — permanent`);
  }
  if (r.playerFodderBuffGain && (r.playerFodderBuffGain.attack || r.playerFodderBuffGain.health)) {
    out.push(`Your Fodder gains ${sv(r.playerFodderBuffGain.attack, r.playerFodderBuffGain.health)} — permanent`);
  }
  // Per-card run-wide enchants (Grave Knit / Eternal Knight).
  for (const b of r.playerCardBuffs ?? []) {
    if (b.attack || b.health) out.push(`${nameOf(b.cardId)} gains ${sv(b.attack, b.health)} — run-wide`);
  }
  // Engraved / kept combat stats — aggregate total across minions.
  const eng = (r.playerPermaBuffs ?? []).reduce(
    (acc, b) => ({ a: acc.a + b.attack, h: acc.h + b.health, n: acc.n + 1 }),
    { a: 0, h: 0, n: 0 },
  );
  if (eng.a || eng.h) out.push(`Kept combat stats ${sv(eng.a, eng.h)} across ${plural(eng.n, 'minion')}`);

  if (r.playerFodderGrants) out.push(`${plural(r.playerFodderGrants, 'Fodder')} added to your next tavern`);
  if (r.playerFreeRolls) out.push(`${plural(r.playerFreeRolls, 'free reroll')} banked`);
  if (r.playerHandGrants?.length) out.push(`Added to your hand: ${r.playerHandGrants.map(nameOf).join(', ')}`);

  return out;
}
