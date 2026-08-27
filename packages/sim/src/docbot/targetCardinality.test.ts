/**
 * DOC BOT — the target/cardinality gate (handoff §7.4): the printed TARGET LANGUAGE is the measured
 * RECIPIENT SET. Predicates, observation lanes and the excuse registry live in `targetCardinality.ts`.
 *
 * The worklist is tranche 1's OWN subject set (derived identically — family from the factory maps' source,
 * subjects from drivable triggers × parseable magnitude), so the two oracles always talk about the same
 * cards: tranche 1 pins the amount, this gate pins who got it. Every subject lands in exactly one typed
 * bucket — reconciled, excused, ambiguous-prose (queued, pinned), out-of-lane (combat, pinned) — and both
 * pins are two-sided so coverage can only be traded consciously.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { BUFF_CALL_RE, extractFactoryEntries, oracleSubjects, stripComments } from './textOracle';
import {
  TARGET_EXCUSED, parseTargetSpec, reconcileTargets, runCardinalitySubject, type ObservedGrant,
} from './targetCardinality';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Tranche 1's family derivation, verbatim — the cardinality gate audits the SAME subject surface. */
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

describe('Doc Bot — target/cardinality oracle (stat-buff family)', () => {
  const subjects = oracleSubjects(buffFamily());
  const excusedIds = new Set(Object.keys(TARGET_EXCUSED));

  it('the target grammar parses the unambiguous shapes and refuses the rest (unit pins)', () => {
    expect(parseTargetSpec('Give a friendly minion **+2/+2**.')).toEqual({ kind: 'single', tribe: null });
    expect(parseTargetSpec('Give a friendly **Dragon** **+3/+2**.')).toEqual({ kind: 'single', tribe: 'dragon' });
    expect(parseTargetSpec('Give your minions **+1/+1**.')).toEqual({ kind: 'all', tribe: null, other: false });
    expect(parseTargetSpec('Give your **Beasts** **+1/+3**.')).toEqual({ kind: 'all', tribe: 'beast', other: false });
    expect(parseTargetSpec('Give your other minions **+1/+1**.')).toEqual({ kind: 'all', tribe: null, other: true });
    expect(parseTargetSpec('Give adjacent minions **+2/+2**.')).toEqual({ kind: 'adjacent' });
    expect(parseTargetSpec('Give your left-most minion **+1/+2**.')).toEqual({ kind: 'edge', side: 'left' });
    expect(parseTargetSpec('**Dusk Shout:** this minion gains **+2/+2**.')).toEqual({ kind: 'self' });
    // Ambiguity refuses — no invented expectation (§7.5).
    expect(parseTargetSpec('Buff two random friends.')).toBeNull();
    expect(parseTargetSpec('Your Imps gain **+2/+1** this game.')).toBeNull();
  });

  it('every shop-lane subject with an unambiguous target lands on the printed bodies, exactly', () => {
    const failures: string[] = [];
    const buckets = { reconciled: 0, ambiguous: [] as string[], outOfLane: 0, silentOrRefused: [] as string[] };
    for (const s of subjects) {
      if (excusedIds.has(s.cardId)) continue;
      const r = runCardinalitySubject(s);
      if (r.outcome === 'reconciled') buckets.reconciled++;
      else if (r.outcome === 'ambiguous') buckets.ambiguous.push(s.cardId);
      else if (r.outcome === 'out-of-lane') buckets.outOfLane++;
      else if (r.outcome === 'silent' || r.outcome === 'refused') buckets.silentOrRefused.push(`${s.cardId} (${r.outcome})`);
      else failures.push(`${s.cardId} [${s.on} → ${s.do}, ${s.lane} lane] — ${r.problems.join('; ')} — "${CARD_INDEX[s.cardId]?.text}"`);
    }
    expect(failures, `Wrong-body/wrong-count disagreement(s). INVESTIGATE before excusing (verify-before-alarm):\n  ${failures.join('\n  ')}`).toEqual([]);
    // The typed buckets, two-sided where erosion is possible (live numbers as of 2026-08-27):
    expect(buckets.reconciled, 'shop-lane subjects whose recipient set matches their printed target (11 live)').toBeGreaterThanOrEqual(9);
    expect(buckets.ambiguous.length, `ambiguous-prose queue (typed §7.5 findings, not failures): ${buckets.ambiguous.join(', ')}`).toBeLessThanOrEqual(6);
    expect(buckets.silentOrRefused, 'a subject tranche 1 reconciles must observe here too — a silent/refused row means the two oracles measured different circumstances').toEqual([]);
  });

  it('excuses are real, and the ratchets hold', () => {
    const subjectIds = new Set(subjects.map((s) => s.cardId));
    const stale = Object.keys(TARGET_EXCUSED).filter((id) => !subjectIds.has(id))
      .map((id) => `${id}: excused but no longer a tranche-1 subject — delete the entry`);
    expect(stale, stale.join('\n')).toEqual([]);
    const triage = Object.values(TARGET_EXCUSED).filter((e) => e.kind === 'needs-triage').length;
    expect(triage, 'needs-triage may only shrink; adding one needs an owner ruling').toBeLessThanOrEqual(0);
    const bugs = Object.entries(TARGET_EXCUSED).filter(([, e]) => e.kind === 'confirmed-bug-pending-fix');
    expect(bugs.map(([id]) => id), 'confirmed bugs are temporary passengers (none open as of 2026-08-27)').toEqual([]);
    expect(Object.keys(TARGET_EXCUSED).length, 'the excuse list is a ceiling, not a dumping ground').toBeLessThanOrEqual(6);
  });

  it('SABOTAGE — a doctored recipient list alarms (the §3.5 wrong-body reinjection)', () => {
    const board = [
      { uid: 'a', cardId: 'pup', tribe: 'beast' },
      { uid: 'b', cardId: 'omen', tribe: 'demon' },
      { uid: 'c', cardId: 'stray', tribe: 'dwarf' },
    ];
    const grant = (uids: string[]): ObservedGrant => ({
      source: 'x',
      recipients: uids.map((u) => {
        const i = board.findIndex((c) => c.uid === u);
        return { uid: u, cardId: board[i]!.cardId, tribe: board[i]!.tribe, position: i, isSelf: false, attack: 2, health: 2 };
      }),
      permanent: true,
      phase: 'recruit',
    });
    // "your Beasts" hit the one Beast: clean.
    expect(reconcileTargets({ kind: 'all', tribe: 'beast', other: false }, grant(['a']), board, -1)).toEqual([]);
    // Doctored: the SAME amount landing on a Demon body too — magnitude oracles cannot see this; this one must.
    expect(reconcileTargets({ kind: 'all', tribe: 'beast', other: false }, grant(['a', 'b']), board, -1).length, 'an ineligible extra recipient alarms').toBeGreaterThan(0);
    // Doctored: the eligible Beast dropped from the list — an eligible body missed alarms.
    expect(reconcileTargets({ kind: 'all', tribe: 'beast', other: false }, grant([]), board, -1).length, 'a missed eligible body alarms').toBeGreaterThan(0);
    // "a friendly minion" that hit two bodies alarms on cardinality alone (right amount, too many bodies).
    expect(reconcileTargets({ kind: 'single', tribe: null }, grant(['a', 'b']), board, -1).length, 'ONE printed target, two recipients alarms').toBeGreaterThan(0);
    // Edge language: the right-most body is 'c' — a grant on 'a' alarms.
    expect(reconcileTargets({ kind: 'edge', side: 'right' }, grant(['a']), board, -1).length, 'wrong edge body alarms').toBeGreaterThan(0);
    expect(reconcileTargets({ kind: 'edge', side: 'right' }, grant(['c']), board, -1)).toEqual([]);
  });
});
