/**
 * `npm run rules:impact -- <paths...>` — the §10.5 PR review signal: which approved rules does this diff
 * touch, which enforcement probes should run, and which approved rules still carry no probe at all?
 *
 * Pass the changed file paths (e.g. `git diff --name-only origin/main | xargs npm run rules:impact --`).
 * Content ids are derived from path basenames when they match a known card/rune id; pass extra ids
 * explicitly with `--content <id>` if a rename hides the match. The impact logic itself is the pure
 * `ruleImpact()` in @game/rules (unit-tested there); this file only collects inputs and prints.
 */
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { ruleImpact } from '@game/rules';

const args = process.argv.slice(2);
const paths: string[] = [];
const contentIds = new Set<string>();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--content') { const id = args[++i]; if (id) contentIds.add(id); continue; }
  paths.push(args[i]!);
}

// Derive content ids from basenames: a changed `.../<id>.ts` whose stem is a known card/rune id touches it.
for (const p of paths) {
  const stem = p.replace(/\\/g, '/').split('/').pop()!.replace(/\.[a-z]+$/i, '');
  if (CARD_INDEX[stem] || RUNE_INDEX[stem]) contentIds.add(stem);
}

const report = ruleImpact({ paths, contentIds: [...contentIds] });

console.log('RULE IMPACT (§10.5)');
console.log(`  changed paths: ${paths.length}${contentIds.size ? ` · derived content ids: ${[...contentIds].join(', ')}` : ''}`);
console.log('');
console.log(`  approved rules touched: ${report.touchedRules.length}`);
for (const t of report.touchedRules) {
  console.log(`    · ${t.id} [${t.effective}] via ${t.via.join('+')} — ${t.title}`);
}
console.log('');
console.log(`  enforcement probes to run: ${report.enforcementRefs.length}`);
for (const ref of report.enforcementRefs) console.log(`    · ${ref}`);
console.log('');
console.log(`  approved-but-unenforced rules (standing debt): ${report.unenforcedApproved.length}`);
for (const u of report.unenforcedApproved) console.log(`    · ${u.id} — ${u.title}`);
