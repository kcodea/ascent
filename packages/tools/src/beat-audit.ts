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
import { heroSurface, probeEmission, allScenarios } from '@game/sim';

const FLAGGED_ONLY = process.argv.includes('--flagged');
const AS_JSON = process.argv.includes('--json');
/** `--silent` lists ONLY the effects that are classified but never announce themselves — the real gap list. */
const SILENT_ONLY = process.argv.includes('--silent');

/**
 * CHOREOGRAPHER PR 13 — EMISSION, measured rather than assumed.
 *
 * The report could always say "this effect is classified". It could never say whether gameplay ANNOUNCES it,
 * which is the difference between a green audit and a screen where nothing happens. The probe runs real
 * scenarios and collects what was actually emitted, so a classified-but-silent effect is now visible instead
 * of counting as covered.
 */
const probe = probeEmission(allScenarios());

const surface = [
  ...presentationSurface(),
  ...heroSurface().map((h) => ({ key: h.key, users: [h.name] })), // heroes live in @game/sim (DoD item 1b)
];
const live = new Set(surface.map((s) => s.key));

interface Row { key: string; policy: string; family: string; status: string; emission: string; users: string }

/**
 * What we can honestly say about emission for one key. `not observed` is deliberately NOT "missing": the probe
 * only reaches what its scenarios reach, so absence is a gap in evidence, not proof the effect is dead.
 */
function emissionOf(key: string): string {
  const seen = probe.observed.get(key);
  if (!seen) return 'not observed';
  return seen.consequences > 0 ? `emits (${seen.consequences})` : 'emits (no result)';
}
const rows: Row[] = [];
for (const s of surface) {
  const e = PRESENTATION_POLICIES[s.key];
  const status = !e ? 'MISSING' : e.flagged ? 'FLAGGED' : e.policy === 'intentionallySilent' ? (e.reason ? 'silent' : 'SILENT-NO-REASON') : 'covered';
  rows.push({
    key: s.key,
    policy: e?.policy ?? '—',
    family: e?.family ?? '—',
    status,
    emission: emissionOf(s.key),
    users: s.users.length > 3 ? `${s.users.slice(0, 3).join(', ')} +${s.users.length - 3}` : s.users.join(', '),
  });
}
for (const k of Object.keys(PRESENTATION_POLICIES)) {
  if (!live.has(k)) rows.push({ key: k, policy: PRESENTATION_POLICIES[k]!.policy, family: PRESENTATION_POLICIES[k]!.family, status: 'GHOST', emission: emissionOf(k), users: '—' });
}

// An effect that is classified `ownBeat` or `foldedCue` and never observed emitting is the exact failure this
// project exists to surface: correct in gameplay, green in the audit, and invisible on screen.
const silentRows = rows.filter((r) => (r.policy === 'ownBeat' || r.policy === 'foldedCue') && r.emission === 'not observed');
const shown = SILENT_ONLY ? silentRows
  : FLAGGED_ONLY ? rows.filter((r) => r.status !== 'covered' && r.status !== 'silent')
  : rows;
if (AS_JSON) {
  console.log(JSON.stringify(shown, null, 2));
} else {
  const w = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`${w('KEY', 54)} ${w('POLICY', 18)} ${w('FAMILY', 14)} ${w('STATUS', 9)} ${w('EMISSION', 16)} USERS`);
  for (const r of shown) console.log(`${w(r.key, 54)} ${w(r.policy, 18)} ${w(r.family, 14)} ${w(r.status, 9)} ${w(r.emission, 16)} ${r.users}`);
  const by = (f: (r: Row) => string): Record<string, number> => rows.reduce<Record<string, number>>((m, r) => { m[f(r)] = (m[f(r)] ?? 0) + 1; return m; }, {});
  console.log(`\n${rows.length} keys — by policy: ${JSON.stringify(by((r) => r.policy))}`);
  console.log(`by status: ${JSON.stringify(by((r) => r.status))}`);
  console.log(`by emission (${probe.scenarios} probe scenarios): ${JSON.stringify(by((r) => r.emission))}`);
  // Grouped by TRIGGER, because a flat count is not a gap list. Read this way the shape is obvious: what is
  // missing is not scattered effects but whole PHASES that emit nothing yet — combat above all.
  const byTrigger = silentRows.reduce<Record<string, number>>((m, r) => {
    const trigger = r.key.split(':').pop() ?? '?';
    m[trigger] = (m[trigger] ?? 0) + 1;
    return m;
  }, {});
  const worst = Object.entries(byTrigger).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('\nNOT OBSERVED, BY TRIGGER (the shape of the remaining work):');
  for (const [trigger, n] of worst) console.log(`  ${trigger.padEnd(22)} ${String(n).padStart(4)}`);
  console.log(`\nCLASSIFIED BUT NEVER OBSERVED EMITTING: ${silentRows.length} of ${rows.length}`);
  console.log('  These resolve correctly and audit green, yet nothing on screen can claim credit for them.');
  console.log('  Run `npm run beats:audit -- --silent` for the list. NOTE: "not observed" means the probe');
  console.log('  did not reach it — a gap in EVIDENCE. Widen `defaultScenarios()` before calling it dead.');
  if (probe.unidentified.length) {
    console.log(`
EMITTED WITHOUT IDENTITY: ${probe.unidentified.length} (un-migrated emitters, no policyKey)`);
    for (const u of probe.unidentified.slice(0, 10)) console.log(`  ${u.phase}  ${u.source}  ${u.trigger}`);
  }
  console.log('\n(the CI tripwire is presentationPolicies.test.ts; this report is the review surface)');
}
