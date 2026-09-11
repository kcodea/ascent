/**
 * `npm run bugs:catalog -- <report-id> [--slug kebab] [--fix sha,sha] [--dry-run]` (2026-09-11).
 *
 * The routine on-ramp into the forward catch-rate loop: a CLOSED Bug Board report becomes a retro-catalog
 * STUB in packages/sim/src/docbot/retroCatalog.ts (empty patch, `verifiedBy: pending`). The author then
 * fills in the patch from the fix commit, runs `npm run docbot:retro -- --only <id>`, pastes the measured
 * verdict, and adds the retroInteractionMap row this command prints. Reads the LOCAL inbox only
 * (`npm run bugs:pull` first) — no Supabase key is needed, and nothing here talks to the network.
 *
 * Everything decided lives in bugs-catalog.lib.ts (pure, tested); this file is IO + the refusal printer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readReport } from './bug-inbox.lib';
import {
  CATALOG_PATH, catalogIdsInSource, insertCatalogStub, planCatalogStub, stubInputFromRow,
} from './bugs-catalog.lib';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const reportArg = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
if (!reportArg) {
  console.error('usage: npm run bugs:catalog -- <report-id> [--slug kebab-name] [--fix sha,sha] [--dry-run]');
  process.exit(1);
}

const { row } = readReport(reportArg);
const source = readFileSync(CATALOG_PATH, 'utf8');
const plan = planCatalogStub(
  stubInputFromRow(row, {
    slug: flag('slug'),
    fixCommits: flag('fix')?.split(',').map((s) => s.trim()).filter(Boolean),
    today: new Date().toISOString().slice(0, 10),
  }),
  catalogIdsInSource(source),
);

if (!plan.ok) {
  console.error(`REFUSED — ${plan.refusals.length} problem(s):`);
  for (const r of plan.refusals) console.error(`  · ${r}`);
  process.exit(1);
}

console.log(`\ncatalog stub for report ${row.id.slice(0, 8)} → '${plan.id}':\n\n${plan.entry}\n`);
if (has('dry-run')) {
  console.log('(dry run — nothing written)');
} else {
  writeFileSync(CATALOG_PATH, insertCatalogStub(source, plan.entry));
  console.log(`appended to ${CATALOG_PATH}`);
}
console.log(`\nnext:
  1. fill in \`patch\` — the fix commit run backwards, anchored on today's source (find must match once)
  2. npm run docbot:retro -- --only ${plan.id}     → paste the measured verdict into \`verifiedBy\`
  3. add this row to packages/sim/src/docbot/retroInteractionMap.ts (the PR gate refuses an unmapped entry):

${plan.mapRow}
`);
