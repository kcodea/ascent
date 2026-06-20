/* Tally the card spread by tribe × tier (+ spells), vs the ~20±3-per-tribe target weighted to
 * tiers 3-5. Re-run as the set grows: `npm run audit`. */
import { BUYABLE_CARDS, SPELL_CARDS, TOKENS, ENEMY } from '@game/content';

const TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'neutral'] as const;
const TIERS = [1, 2, 3, 4, 5, 6];

// tribe -> tier -> count (by PRIMARY tribe). Duals (tribe2) tracked separately.
const grid: Record<string, Record<number, number>> = {};
for (const t of TRIBES) grid[t] = Object.fromEntries(TIERS.map((n) => [n, 0]));
const duals: string[] = [];

for (const c of BUYABLE_CARDS) {
  if (!grid[c.tribe]) grid[c.tribe] = Object.fromEntries(TIERS.map((n) => [n, 0]));
  grid[c.tribe]![c.tier] = (grid[c.tribe]![c.tier] ?? 0) + 1;
  if (c.tribe2) duals.push(`${c.name} (${c.tribe}/${c.tribe2})`);
}

const pad = (s: string | number, n: number): string => String(s).padStart(n);
console.log('\nMINIONS — tribe × tier (buyable pool)\n');
console.log('tribe   ' + TIERS.map((t) => pad('T' + t, 4)).join('') + '   tot   3-5');
for (const tribe of TRIBES) {
  const row = grid[tribe]!;
  const tot = TIERS.reduce((s, t) => s + (row[t] ?? 0), 0);
  const mid = (row[3] ?? 0) + (row[4] ?? 0) + (row[5] ?? 0);
  console.log(pad(tribe, 7) + ' ' + TIERS.map((t) => pad(row[t] ?? 0, 4)).join('') + '   ' + pad(tot, 3) + '   ' + pad(mid, 3));
}
const colTot = TIERS.map((t) => TRIBES.reduce((s, tribe) => s + (grid[tribe]![t] ?? 0), 0));
console.log(pad('TOTAL', 7) + ' ' + colTot.map((n) => pad(n, 4)).join('') + '   ' + pad(colTot.reduce((a, b) => a + b, 0), 3));

console.log('\nSPELLS — by tier\n');
const spellByTier = Object.fromEntries(TIERS.map((n) => [n, 0]));
for (const s of SPELL_CARDS) spellByTier[s.tier] = (spellByTier[s.tier] ?? 0) + 1;
console.log('       ' + TIERS.map((t) => pad('T' + t, 4)).join('') + '   tot');
console.log(pad('spells', 7) + ' ' + TIERS.map((t) => pad(spellByTier[t] ?? 0, 4)).join('') + '   ' + pad(SPELL_CARDS.length, 3));

console.log(`\nDuals: ${duals.length ? duals.join(', ') : 'none'}`);
console.log(`Sanity: buyable=${BUYABLE_CARDS.length}, spells=${SPELL_CARDS.length}, tokens=${TOKENS.length}, enemy=${ENEMY.length}`);
console.log('Target: ~17-23 minions per tribe (incl. neutral), weighted toward tiers 3-4-5.\n');
