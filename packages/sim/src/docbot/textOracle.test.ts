/**
 * DOC BOT TRIPWIRE 14 — text as oracle: the PRINTED stat buff is the MEASURED stat buff (tranche 1).
 *
 * Doctrine, lanes, fixtures, the excuse registry and the arming table live in `textOracle.ts`; this file is
 * the gate. It re-derives the subject set from source + content on every run (the factoryPhase pattern):
 * the buff FAMILY comes from scanning the two factory maps for bodies that reach the buff primitives, the
 * SUBJECTS from intersecting that family with the drivable triggers and a parseable printed magnitude — so
 * a new buff card, or a rebalance that edits a param without its text (or its text without the param), is
 * caught the day it lands, with both numbers named.
 *
 * Verify-before-alarm (owner-mandated): a mismatch here is an ALWAYS-RIGHT alarm only after investigation —
 * first rule out an instrument blind spot (unarmed scaler → ORACLE_ARM; unreachable recipient → fix the
 * fixture; genuinely unreconcilable → ORACLE_EXCUSED with the measured outcome in `why`). A verified real
 * bug ships as 'confirmed-bug-pending-fix' so the suite stays green while the fix PR is cut.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '../state';
import {
  BUFF_CALL_RE, ORACLE_ARM, ORACLE_EXCUSED, extractFactoryEntries, liveShopText, oracleSubjects,
  parseFirstStatBuff, reconcile, runSpellLane, runSubject, stripComments,
} from './textOracle';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The buff family, derived from the two factory maps' SOURCE — never hand-listed. */
function buffFamily(): Set<string> {
  const maps: Array<[string, string]> = [
    ['packages/sim/src/recruit.ts', 'const RECRUIT_FACTORIES'],
    ['packages/core/src/effects/factories.ts', 'export const FACTORIES'],
  ];
  const family = new Set<string>();
  for (const [file, anchor] of maps) {
    const entries = extractFactoryEntries(readFileSync(join(ROOT, file), 'utf8'), anchor);
    for (const [id, body] of Object.entries(entries)) {
      if (BUFF_CALL_RE.test(stripComments(body))) family.add(id);
    }
  }
  return family;
}

describe('Doc Bot — text as oracle (printed stat buffs)', () => {
  const family = buffFamily();
  const subjects = oracleSubjects(family);
  const excusedIds = new Set(Object.keys(ORACLE_EXCUSED));

  it('the instrument sees its surface (family + subjects floors — a collapse means the scanner broke, not that content got clean)', () => {
    // 41 family factories / 36 subjects as of 2026-08-26. Floors sit below the live counts so ordinary
    // content churn doesn't trip them; a big drop means extractFactoryEntries stopped matching the maps'
    // shape or the lane table lost a trigger — fix the instrument, don't lower these casually.
    expect(family.size, 'buff-family factories derived from source').toBeGreaterThanOrEqual(35);
    expect(subjects.length, 'oracle subjects (family × drivable trigger × parseable printed magnitude)').toBeGreaterThanOrEqual(30);
  });

  it('every subject reconciles: the printed +A/+H lands on some recipient EXACTLY (golden: the goldenText pair)', () => {
    const failures: string[] = [];
    for (const s of subjects) {
      if (excusedIds.has(s.cardId)) continue;
      for (const golden of [false, true] as const) {
        if (s.lane === 'spell' && golden) continue; // spells never gild
        const r = runSubject(s, golden);
        if (r.outcome === 'reconciled') continue;
        const printed = golden ? s.printedGolden : s.printed;
        const measured = 'deltas' in r ? ` measured ${JSON.stringify(r.deltas)}` : '';
        failures.push(`${s.cardId}${golden ? ' (golden)' : ''} [${s.on} → ${s.do}, ${s.lane} lane] ${r.outcome}: text prints +${printed.attack}/+${printed.health}${measured} — "${CARD_INDEX[s.cardId]?.text}"`);
      }
    }
    expect(failures, `Printed-vs-measured disagreement(s). INVESTIGATE before excusing (verify-before-alarm): an unarmed scaler goes in ORACLE_ARM, an unreconcilable shape in ORACLE_EXCUSED with the measured outcome, a VERIFIED bug ships as 'confirmed-bug-pending-fix' + a fix PR. Both numbers are named:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('LIVENESS — with spell power armed, the re-read text prints the new value and the cast grants it', () => {
    // The heart of the owner's live-text rule, executed: arm +2/+3 spell power, re-read the SAME helper the
    // UI reads (`spellDisplayText`), and demand the cast grant the re-parsed number. A factory that folds
    // spell power while the text doesn't (or vice versa) fails here with both numbers named.
    const arm = (st: RunState): void => { (st as { spellBonus?: { attack: number; health: number } }).spellBonus = { attack: 2, health: 3 }; };
    let exercised = 0;
    const failures: string[] = [];
    for (const s of subjects) {
      if (s.lane !== 'spell' || excusedIds.has(s.cardId)) continue;
      const def = CARD_INDEX[s.cardId]!;
      const armedPrinted = parseFirstStatBuff(liveShopText(def, 2, 3));
      if (!armedPrinted || (armedPrinted.attack === s.printed.attack && armedPrinted.health === s.printed.health)) continue; // text claims no spell-power liveness — the base lane owns it
      exercised++;
      const r = runSpellLane(def, armedPrinted, arm);
      if (r.outcome !== 'reconciled') {
        failures.push(`${s.cardId}: armed text prints +${armedPrinted.attack}/+${armedPrinted.health}, lane ${r.outcome}${'deltas' in r ? ` measured ${JSON.stringify(r.deltas)}` : ''}`);
      }
    }
    expect(exercised, 'the armed-text lane must exercise a real surface (4 stat spells as of 2026-08-26)').toBeGreaterThanOrEqual(3);
    expect(failures, `Armed spell power: printed and granted disagree:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('excuses are real, and both ratchets hold (excused ≤ 2, needs-triage ≤ 0 as of 2026-08-26)', () => {
    const subjectIds = new Set(subjects.map((s) => s.cardId));
    const stale: string[] = [];
    for (const id of Object.keys(ORACLE_EXCUSED)) {
      if (!subjectIds.has(id)) stale.push(`${id}: excused but no longer a subject (text, effects or family changed) — delete the entry`);
    }
    for (const id of Object.keys(ORACLE_ARM)) {
      if (!subjectIds.has(id)) stale.push(`${id}: armed but no longer a subject — delete the ORACLE_ARM entry`);
    }
    expect(stale, `Stale registry entr(ies):\n  ${stale.join('\n  ')}`).toEqual([]);
    const triage = Object.values(ORACLE_EXCUSED).filter((e) => e.kind === 'needs-triage').length;
    expect(triage, 'needs-triage may only shrink; adding one needs an owner ruling, not a bigger number').toBeLessThanOrEqual(0);
    const bugs = Object.entries(ORACLE_EXCUSED).filter(([, e]) => e.kind === 'confirmed-bug-pending-fix');
    expect(bugs.map(([id]) => id), 'confirmed bugs are temporary passengers — each rides only until its fix PR lands (none open as of 2026-08-26)').toEqual([]);
    expect(Object.keys(ORACLE_EXCUSED).length, 'the excuse list is a ceiling, not a dumping ground — raising it needs the same verify-before-alarm rigor as the entries it covers').toBeLessThanOrEqual(2);
  });

  it('SABOTAGE — a wrong printed number alarms (the instrument cannot be soothed)', () => {
    // Unit level: the reconciler rejects a near-miss.
    expect(reconcile({ attack: 3, health: 2 }, [[2, 2], [0, 1]])).toBe(false);
    expect(reconcile({ attack: 2, health: 2 }, [[2, 2]])).toBe(true);
    // End to end: take a real reconciling subject in each lane class and feed it a printed pair one off —
    // the lane must come back non-reconciled, proving a magnitude bug (or stale text) cannot pass.
    const saboteurs = ['spell', 'shout', 'combat'] as const;
    for (const lane of saboteurs) {
      const s = subjects.find((x) => x.lane === lane && !excusedIds.has(x.cardId));
      expect(s, `a ${lane}-lane subject exists to sabotage`).toBeDefined();
      const wrong = { ...s!, printed: { attack: s!.printed.attack + 1, health: s!.printed.health }, printedGolden: s!.printedGolden };
      const r = runSubject(wrong, false);
      expect(r.outcome, `${s!.cardId} (${lane} lane) must ALARM on a +1-off printed value, got '${r.outcome}'`).not.toBe('reconciled');
    }
  });
});
