/**
 * `npm run beats:audit` — the beat-system coverage report (PR 1 of the beat-system arc).
 *
 * Prints every automatic-effect key the live content produces, its presentation policy, its producers, and a
 * status — the table the owner reviews (flagged rows are the ones to actually weigh). The CI-enforcing half
 * lives in `packages/content/src/presentationPolicies.test.ts`; this is the human-readable view of the same
 * data, plus a summary by policy/status. Pass `--flagged` to print only the rows needing review, `--json`
 * for machine-readable output (the future Beat Lab Defaults mode reads this shape).
 */
import { PRESENTATION_POLICIES } from '@game/core';
import { presentationSurface } from '@game/content';
import { heroSurface } from '@game/sim';

const FLAGGED_ONLY = process.argv.includes('--flagged');
const AS_JSON = process.argv.includes('--json');

const surface = [
  ...presentationSurface(),
  ...heroSurface().map((h) => ({ key: h.key, users: [h.name] })), // heroes live in @game/sim (DoD item 1b)
];
const live = new Set(surface.map((s) => s.key));

interface Row { key: string; policy: string; family: string; status: string; users: string }
const rows: Row[] = [];
for (const s of surface) {
  const e = PRESENTATION_POLICIES[s.key];
  const status = !e ? 'MISSING' : e.flagged ? 'FLAGGED' : e.policy === 'intentionallySilent' ? (e.reason ? 'silent' : 'SILENT-NO-REASON') : 'covered';
  rows.push({
    key: s.key,
    policy: e?.policy ?? '—',
    family: e?.family ?? '—',
    status,
    users: s.users.length > 3 ? `${s.users.slice(0, 3).join(', ')} +${s.users.length - 3}` : s.users.join(', '),
  });
}
for (const k of Object.keys(PRESENTATION_POLICIES)) {
  if (!live.has(k)) rows.push({ key: k, policy: PRESENTATION_POLICIES[k]!.policy, family: PRESENTATION_POLICIES[k]!.family, status: 'GHOST', users: '—' });
}

const shown = FLAGGED_ONLY ? rows.filter((r) => r.status !== 'covered' && r.status !== 'silent') : rows;
if (AS_JSON) {
  console.log(JSON.stringify(shown, null, 2));
} else {
  const w = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`${w('KEY', 58)} ${w('POLICY', 20)} ${w('FAMILY', 16)} ${w('STATUS', 10)} USERS`);
  for (const r of shown) console.log(`${w(r.key, 58)} ${w(r.policy, 20)} ${w(r.family, 16)} ${w(r.status, 10)} ${r.users}`);
  const by = (f: (r: Row) => string): Record<string, number> => rows.reduce<Record<string, number>>((m, r) => { m[f(r)] = (m[f(r)] ?? 0) + 1; return m; }, {});
  console.log(`\n${rows.length} keys — by policy: ${JSON.stringify(by((r) => r.policy))}`);
  console.log(`by status: ${JSON.stringify(by((r) => r.status))}`);
  console.log('\n(the CI tripwire is presentationPolicies.test.ts; this report is the review surface)');
}
