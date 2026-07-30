/**
 * `npm run art:wire` — copy Set 2 minion art into `packages/ui/src/art/minions/<cardId>.png`.
 *
 * STRICT NAME MATCH ONLY. A source file is wired only when its PascalCase filename matches a card's NAME
 * exactly (after stripping punctuation/spaces). Anything unmatched is REPORTED, never guessed — guessing from an
 * un-attributed file is how art ends up on the wrong card and nobody notices.
 *
 * `<Name>2.png` is wired as the `<cardId>2` variant, matching the existing pup/shaper convention.
 */
import { readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX, poolFor } from '@game/content';

const SRC = 'C:/Game Assets/Ascent Art/Set 2 Minions';
const DEST = 'packages/ui/src/art/minions';
const DIRS = ['Beasts', 'Demons', 'Dragons', 'Dwarves', 'Kobolds', 'Neutral'];
const APPLY = process.argv.includes('--apply');

/** Normalize for comparison: letters+digits only, lowercased. "Broad-Axe Brakka" -> "broadaxebrakka" */
const norm = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

// Every set-2 card (minions AND tokens — tokens have art too), keyed by normalized name.
const byName = new Map<string, string>();
for (const c of poolFor('set2').all) byName.set(norm(c.name), c.id);
for (const c of Object.values(CARD_INDEX)) if (c) byName.set(norm(c.name), c.id); // tokens live outside the pool

const wired: string[] = [];
const unmatched: string[] = [];
for (const dir of DIRS) {
  const full = join(SRC, dir);
  if (!existsSync(full)) { console.log(`missing source dir: ${dir}`); continue; }
  for (const file of readdirSync(full).filter((f) => /\.(png|webp)$/i.test(f))) {
    const stem = file.replace(/\.(png|webp)$/i, '');
    const isVariant = /2$/.test(stem);
    const base = isVariant ? stem.replace(/2$/, '') : stem;
    const id = byName.get(norm(base));
    if (!id) { unmatched.push(`${dir}/${file}`); continue; }
    const target = join(DEST, `${id}${isVariant ? '2' : ''}.png`);
    wired.push(`${dir}/${file}  ->  ${id}${isVariant ? '2' : ''}.png`);
    if (APPLY) copyFileSync(join(full, file), target);
  }
}
console.log(`\nMATCHED ${wired.length}:`);
for (const w of wired) console.log(`  ${w}`);
console.log(`\nUNMATCHED ${unmatched.length} (reported, never guessed):`);
for (const u of unmatched) console.log(`  ${u}`);
// Which set-2 minions still have NO art at all?
const haveArt = new Set(readdirSync(DEST).map((f) => f.replace(/\.(png|webp)$/, '').replace(/2$/, '')));
const missing = poolFor('set2').all.filter((c) => !c.spell && !c.ruby && !haveArt.has(c.id)).map((c) => `${c.name} (${c.id})`);
console.log(`\nSET-2 MINIONS WITH NO ART ${missing.length}:`);
for (const m of missing) console.log(`  ${m}`);
console.log(APPLY ? '\n(applied)' : '\n(dry run — pass --apply to copy)');
