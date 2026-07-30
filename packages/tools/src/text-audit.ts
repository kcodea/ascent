/**
 * `npm run text:audit` — diff the owner's authoritative Set 2 text against what the game prints.
 *
 * Built after three Set 2 demons turned out to be MIS-DOCUMENTED rather than mis-implemented (Demon Horse
 * printed an End-of-Turn Consume while being a Rally shop-buff). A card can pass every test and still describe a
 * different card, so the printed text needs its own check.
 *
 * Reports only — it never rewrites content. The owner's sheet can itself be stale (it is maintained by hand,
 * alongside changes made in-session), so a mismatch is a QUESTION, not a defect to auto-fix.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';

const SRC = 'packages/tools/.cache/audit.tsv';
if (!existsSync(SRC)) { console.error(`no reference sheet at ${SRC}`); process.exit(1); }

/** Compare on MEANING, not formatting: strip markdown, punctuation, case and whitespace. */
const norm = (s: string): string =>
  s.replace(/\*\*/g, ' ').replace(/[_`]/g, ' ').replace(/[.,;:()]/g, ' ')
   .replace(/\s+/g, ' ').trim().toLowerCase();

const byName = new Map<string, { id: string; text: string }>();
for (const c of Object.values(CARD_INDEX)) if (c) byName.set(c.name, { id: c.id, text: c.text ?? '' });

const missing: string[] = [];
const differs: { name: string; id: string; sheet: string; game: string }[] = [];
let same = 0;

for (const line of readFileSync(SRC, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const [name, ...rest] = line.split('\t');
  const sheet = rest.join('\t').trim();
  if (!name || !sheet) continue;
  const card = byName.get(name.trim());
  if (!card) { missing.push(name.trim()); continue; }
  if (norm(card.text) === norm(sheet)) { same++; continue; }
  differs.push({ name: name.trim(), id: card.id, sheet, game: card.text });
}

console.log(`\n=== SET 2 TEXT AUDIT ===`);
console.log(`${same} match · ${differs.length} differ · ${missing.length} not found by that name\n`);
if (missing.length) {
  console.log('NOT FOUND (renamed, or not built):');
  for (const m of missing) console.log(`  ${m}`);
}
console.log('\nDIFFERS:');
for (const d of differs) {
  console.log(`\n${d.name}  [${d.id}]`);
  console.log(`  sheet: ${d.sheet}`);
  console.log(`  game : ${d.game.replace(/\*\*/g, '')}`);
}
console.log('');
