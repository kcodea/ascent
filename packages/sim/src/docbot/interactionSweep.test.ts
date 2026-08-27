/**
 * DOC BOT 2.0 WP F — the PAIRWISE-COVERAGE GATE lane (blueprint §10.3/§10.5/§15.5/§18-F).
 *
 * The gate runs a deterministic CANDIDATE-CAPPED sample of the interaction sweep (the full sweep — every
 * candidate, plus the §10.4 triples — lives behind `npm run docbot:interactions` and the nightly; today the
 * full pairwise sweep costs well under a second, but the gate keeps the sample contract so the lane's cost
 * stays flat as candidate rosters grow). Gates:
 *
 *  · determinism (§4.4/§17.4) — two sweeps are byte-identical;
 *  · the §18-F exit gate — every §10.3 priority pair family is COVERED or VISIBLY BLOCKED (a family with
 *    neither a covered row nor a blocked-with-reason row is a silent gap and fails);
 *  · verdict honesty — zero 'failed' rows (a failed pair diff is a real regression to triage, not a number
 *    to tolerate), and the coverage table is internally consistent (verifyInteractionTable);
 *  · §10.5 — covered runs record COMBINATION keys that parse back to >= 2 semantic parts;
 *  · historical generalization — the retro-catalog map is complete over reinject.py's ACTUAL id list
 *    (parsed here, so the map can never lag the catalog), every cited lane file exists on disk, and every
 *    multi-system entry names a live interaction family;
 *  · sabotage (§4.5) — a doctored pair verdict is DETECTED by the table-integrity check.
 *
 * The two hand-pinned matrices (interactionMatrix / interactionFamilyMatrix) remain the coverage FLOOR —
 * this lane extends them and retires nothing (current-state-map §5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { stableStringify } from '../qaScenario';
import { combinationParts } from './coverageKeys';
import {
  PAIR_FAMILIES, runInteractionSweep, verifyInteractionTable, type InteractionRun,
} from './interactionSweep';
import { RETRO_INTERACTION_MAP, retroMapErrors } from './retroInteractionMap';

/** The PR-gate sample: 3 candidates per family, deterministic (sorted contentId order), no triples. */
const GATE_CAP = 3;

const CONTRACTS = allContracts();
const SWEEP = runInteractionSweep({ contracts: CONTRACTS, candidateCap: GATE_CAP });

// Repo root, resolved from this file (vitest cwd is not guaranteed): packages/sim/src/docbot → root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('interaction sweep (§10.3) — the deterministic gate sample', () => {
  it('is deterministic: two sweeps are byte-identical (§4.4)', () => {
    const again = runInteractionSweep({ contracts: CONTRACTS, candidateCap: GATE_CAP });
    expect(stableStringify(again)).toBe(stableStringify(SWEEP));
  });

  it('EXIT GATE (§18-F): every §10.3 priority pair family is covered or VISIBLY blocked', () => {
    for (const family of PAIR_FAMILIES) {
      const totals = SWEEP.familyTotals[family];
      expect(totals, `family '${family}' produced no row at all — a silent gap`).toBeDefined();
      const visible = totals!.covered + totals!.blocked;
      expect(visible, `family '${family}' is neither covered nor visibly blocked (covered ${totals!.covered}, blocked ${totals!.blocked}, inapplicable ${totals!.inapplicable})`).toBeGreaterThan(0);
    }
  });

  it('zero failed pair diffs — a failure here is a regression to triage, never a tolerated count', () => {
    const failed = SWEEP.runs.filter((r) => r.verdict === 'failed');
    expect(failed.map((r) => `${r.family} [${r.members.join('+')}]: ${r.evidence}`)).toEqual([]);
  });

  it('the coverage table is internally consistent (§15.5 verdicts, evidence, measurements)', () => {
    expect(verifyInteractionTable(SWEEP.runs)).toEqual([]);
  });

  it('real engine work happened: the load-bearing families have executed covered rows', () => {
    // These five families have generic real-engine drivers today; each must produce covered rows in the
    // gate sample (a driver silently dying would otherwise read as "all blocked" and still pass the gate).
    for (const family of ['trigger-x-multiplier', 'death-x-echo', 'echo-x-rise', 'copy-x-counter', 'spell-x-improvement'] as const) {
      expect(SWEEP.familyTotals[family]!.covered, `driver for '${family}' executed nothing`).toBeGreaterThan(0);
    }
  });

  it('§10.5: covered runs record combination keys, and every key parses to >= 2 semantic parts', () => {
    expect(SWEEP.comboKeys.length).toBeGreaterThanOrEqual(8);
    for (const k of SWEEP.comboKeys) {
      const parts = combinationParts(k);
      expect(parts, `'${k}' is not a combo key`).not.toBeNull();
      expect(parts!.length, `'${k}' names fewer than 2 parts`).toBeGreaterThanOrEqual(2);
      expect([...parts!].sort().join('+'), `'${k}' parts are not in sorted identity order`).toBe(parts!.join('+'));
    }
    // The §10.5 exemplar tuples this program ships with:
    expect(SWEEP.comboKeys).toContain('combo:echo+rise');
    expect(SWEEP.comboKeys).toContain('combo:multiplier:deathrattle+trigger:onDeath');
    expect(SWEEP.comboKeys).toContain('combo:copy:exact+counter:per-instance+gild');
  });

  it('the hand-pinned floor is intact: both matrices this sweep must subsume before any retirement exist', () => {
    expect(existsSync(join(REPO_ROOT, 'packages/sim/src/docbot/interactionMatrix.test.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts'))).toBe(true);
  });
});

describe('historical generalization (§18-F: retro catalog → generalized scenarios)', () => {
  const reinjectPy = readFileSync(join(REPO_ROOT, 'packages/tools/retro/reinject.py'), 'utf8');
  const catalogIds = [...reinjectPy.matchAll(/^\s*\('([a-z0-9-]+)',/gim)].map((m) => m[1]!);

  it('parses the live catalog (the map can never lag reinject.py)', () => {
    expect(catalogIds.length).toBeGreaterThanOrEqual(14);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
  });

  it('every catalog entry is mapped; every multi-system entry names an interaction family', () => {
    expect(retroMapErrors(catalogIds)).toEqual([]);
  });

  it('every cited lane file exists on disk (a renamed lane un-cites its bugs LOUDLY)', () => {
    for (const e of RETRO_INTERACTION_MAP) {
      for (const lane of e.lanes) {
        expect(existsSync(join(REPO_ROOT, lane)), `${e.catalogId} cites '${lane}' which does not exist`).toBe(true);
      }
    }
  });

  it('every multi-system family citation points at a family the sweep actually staged', () => {
    for (const e of RETRO_INTERACTION_MAP.filter((x) => x.multiSystem)) {
      for (const f of e.families) {
        const totals = SWEEP.familyTotals[f];
        expect(totals, `${e.catalogId} cites family '${f}' which produced no coverage row`).toBeDefined();
        expect(totals!.covered + totals!.blocked, `${e.catalogId} cites family '${f}' with neither covered nor blocked rows`).toBeGreaterThan(0);
      }
    }
  });
});

describe('interaction sweep — sabotage (§4.5: a doctored verdict is detected)', () => {
  const covered = SWEEP.runs.find((r) => r.verdict === 'covered' && r.measurement)!;

  it('a covered verdict whose measurement breaks its declared relation is detected', () => {
    const doctored: InteractionRun = { ...covered, measurement: { ...covered.measurement!, variant: covered.measurement!.variant + 1 } };
    const errors = verifyInteractionTable([doctored]);
    expect(errors.some((e) => e.includes('breaks the declared'))).toBe(true);
  });

  it('a blocked verdict stripped of its reason is detected', () => {
    const blocked = SWEEP.runs.find((r) => r.verdict === 'blocked')!;
    const rest: InteractionRun = { ...blocked };
    delete (rest as { blockedReason?: string }).blockedReason;
    expect(verifyInteractionTable([rest]).some((e) => e.includes('blocked with no reason'))).toBe(true);
  });

  it('a covered verdict with no combination key is detected (§10.5 identity cannot silently vanish)', () => {
    const doctored: InteractionRun = { ...covered, comboKeys: [] };
    expect(verifyInteractionTable([doctored]).some((e) => e.includes('no §10.5 combination key'))).toBe(true);
  });

  it('the clean table passes the same validator the sabotage fails (one validator, both directions)', () => {
    expect(verifyInteractionTable([covered])).toEqual([]);
  });
});
