/**
 * Dump the live card set to `docs/cards.csv` — the canonical, easy-to-parse card reference. Reads the
 * source of truth (`CARD_INDEX`) so it's always accurate; re-run after card changes with `npm run dump-cards`.
 * Grouped by tribe (minions), then spells, then tokens; sorted by tier within each group.
 */
import { writeFileSync } from 'node:fs';
import type { CardDef, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

const KW: Record<string, string> = {
  T: 'Taunt', DS: 'Divine Shield', V: 'Venomous', W: 'Windfury', R: 'Reborn', C: 'Cleave',
  M: 'Magnetic', EG: 'Engraved', CN: 'Consume', FD: 'Fodder', RL: 'Rally', SC: 'Start of Combat', ST: 'Stealth',
};
const cell = (v: string | number | undefined): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const kws = (ks: string[]): string => ks.map((k) => KW[k] ?? k).join(' | ');
const row = (c: CardDef): string =>
  [
    cell(c.id),
    cell(c.tribe2 ? `${c.name} (${c.tribe}/${c.tribe2})` : c.name),
    cell(c.tier),
    cell(c.spell ? '' : c.attack),
    cell(c.spell ? '' : c.health),
    cell(c.cost ?? ''),
    cell(kws(c.keywords)),
    cell(c.text),
    cell(c.goldenText ?? ''),
  ].join(',');

const cards = Object.values(CARD_INDEX);
const minions = cards.filter((c) => !c.spell && !c.token);
const spells = cards.filter((c) => c.spell);
const tokens = cards.filter((c) => c.token && !c.spell);
const byTier = (a: CardDef, b: CardDef): number => a.tier - b.tier || a.name.localeCompare(b.name);

const TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon', 'neutral'];
const lines: string[] = [
  '# ASCENT — card reference. Auto-generated from @game/content by `npm run dump-cards`; do not hand-edit.',
  '# atk/hp are blank for spells (they use cost). Dual-type minions show both tribes. golden_text = the tripled text.',
  'id,name,tier,atk,hp,cost,keywords,text,golden_text',
];
for (const t of TRIBES) {
  const group = minions.filter((c) => c.tribe === t).sort(byTier);
  if (group.length === 0) continue;
  lines.push('', `# === ${t.toUpperCase()} (${group.length}) ===`);
  for (const c of group) lines.push(row(c));
}
lines.push('', `# === SPELLS (${spells.length}) — cost, not stats ===`);
for (const c of spells.sort(byTier)) lines.push(row(c));
lines.push('', `# === TOKENS (${tokens.length}) — not rollable ===`);
for (const c of tokens.sort(byTier)) lines.push(row(c));

writeFileSync('docs/cards.csv', lines.join('\n') + '\n');
console.log(`Wrote docs/cards.csv — ${minions.length} minions, ${spells.length} spells, ${tokens.length} tokens.`);
