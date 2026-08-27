/**
 * DOC BOT 2.0 — the VERTICAL SLICE lane (blueprint §19; docs/docbot2/work-package-plan.md stage VS).
 *
 * Proves the intent-contract ↔ runtime-trace ↔ displayed-text triangle end to end on the §19
 * interaction-heavy content set, through the REAL engine only:
 *
 *  · Contract oracle v0 (§9.1): every hand-authored contract's stated fields checked against engine
 *    observations — trigger phase, thresholds, amounts, target cardinality, copy semantics, gilded deltas.
 *  · The four §1 output classes, each demonstrated ONCE from a real observation (sliceFindings.ts).
 *  · Minimization + graduation (§13/§14 in miniature): the R-AVWIN-10 finding's scenario, minimized and
 *    graduated into scenarios/avenge-dying-source-batch-pin.json with a concrete assertion.
 *  · Triangle auto-corroboration (owner-review-pipeline.md §2), computed — never hand-stamped (§23).
 *  · Sabotage (§4.5): doctored contract amount + doctored copy policy must fail naming the contract,
 *    the field, and both values.
 *  · semanticRevision v0 (§16): stamped on every finding and scenario result this lane produces.
 *
 * VERIFY-BEFORE-ALARM: the oracle passes because every mismatch found while building the slice was
 * investigated and became one of the findings below — never an excuse-to-green.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { semanticRevision, semanticRevisionParts, QA_SCHEMA_REV } from '../../semanticRevision';
import { emitFindingsJson, type DocbotFinding } from '../findings';
import { checkContract, type ContentContract } from './contentContract';
import { SLICE_CONTRACTS, SLICE_CONTRACT_INDEX } from './contracts';
import { probeSlice, type SliceProbeReport } from './contractOracle';
import { buildSliceFindings, SLICE_LANE } from './sliceFindings';
import { corroborate } from './corroboration';

// One probe pass for the whole lane (each probe is a full engine execution; results are pure data).
const SEM_REV = semanticRevision();
const REPORT: SliceProbeReport = probeSlice(SEM_REV);
const FINDINGS: DocbotFinding[] = buildSliceFindings(REPORT, SEM_REV);

const byClass = (cls: DocbotFinding['class']): DocbotFinding[] => FINDINGS.filter((f) => f.class === cls);

describe('vertical slice — semanticRevision v0 (§16)', () => {
  it('composes buildSha.contentRev.rulesRev.schemaRev from the real hashes', () => {
    const parts = semanticRevisionParts();
    expect(SEM_REV).toBe(`dev.${parts.contentRev}.${parts.rulesRev}.${QA_SCHEMA_REV}`);
    expect(parts.contentRev).toMatch(/^[0-9a-f]{8}$/);
    expect(parts.rulesRev).toMatch(/^[0-9a-f]{8}$/);
    // Deterministic within a process (both halves are content-addressed hashes).
    expect(semanticRevision()).toBe(SEM_REV);
    expect(semanticRevision('abc1234')).toBe(SEM_REV.replace(/^dev/, 'abc1234'));
  });

  it('is stamped on every slice finding and on the scenario results the oracle produced', () => {
    for (const f of FINDINGS) expect(f.semanticRevision, f.id).toBe(SEM_REV);
    expect(REPORT.avwin10.scenarioResult.semanticRevision).toBe(SEM_REV);
    expect(REPORT.copyFixtures.plain.semanticRevision).toBe(SEM_REV);
    expect(REPORT.copyFixtures.exact.semanticRevision).toBe(SEM_REV);
  });
});

describe('vertical slice — contract oracle v0 (§9.1)', () => {
  it('every slice contract is probed or explicitly listed unprobed (no silent gaps, §4.3)', () => {
    const probedIds = new Set(REPORT.observations.map((o) => o.contractId));
    for (const c of SLICE_CONTRACTS) {
      expect(probedIds.has(c.contentId), `${c.contentId} has no observation at all`).toBe(true);
    }
    for (const u of REPORT.unprobed) {
      expect(SLICE_CONTRACT_INDEX[u.contractId], `unprobed entry cites unknown contract ${u.contractId}`).toBeDefined();
      expect(u.why.length, `${u.contractId} ${u.path} unprobed without a reason`).toBeGreaterThan(30);
    }
  });

  it('observed behaviour matches every stated contract field — trigger phase, thresholds, amounts, cardinality, copy semantics, gilded deltas', () => {
    for (const c of SLICE_CONTRACTS) {
      const mismatches = checkContract(c, REPORT.observations);
      expect(mismatches, `${c.contentId}: ${mismatches.map((m) => `${m.path} expected ${JSON.stringify(m.expected)} observed ${JSON.stringify(m.observed)} (${m.evidence})`).join(' · ')}`).toEqual([]);
    }
  });

  it('guards the load-bearing fixtures, not just the assertions', () => {
    // The copy fixtures actually executed and passed (they carry their own expectations).
    expect(REPORT.copyFixtures.plain.ok, REPORT.copyFixtures.plain.summary).toBe(true);
    expect(REPORT.copyFixtures.exact.ok, REPORT.copyFixtures.exact.summary).toBe(true);
    // The exact-copy runtime probe measured a REAL carry (gilding + counter), not a vacuous pass.
    expect(REPORT.xerox.copyGolden, 'the Copy Machine copy must carry gilding').toBe(true);
    expect(REPORT.xerox.copySummonBonus, 'the Copy Machine copy must carry the accrued counter').toBe(2);
    // Anubis genuinely died twice with a reborn between (the questionable interaction is real).
    expect(REPORT.anubis.rebornHappened).toBe(true);
    expect(REPORT.anubis.deathsOfAnubis).toBe(2);
  });
});

describe('vertical slice — the four §1 output classes, one real finding each', () => {
  it('emits exactly the four classes', () => {
    expect(FINDINGS).toHaveLength(4);
    expect(byClass('verified-mechanical-bug')).toHaveLength(1);
    expect(byClass('verified-text-defect')).toHaveLength(1);
    expect(byClass('wording-recommendation')).toHaveLength(1);
    expect(byClass('questionable-interaction')).toHaveLength(1);
  });

  it('verified mechanical bug: approved rule, deterministic DOUBLE reproduction, first divergence, minimized scenario (§12.1/§4.4)', () => {
    const f = byClass('verified-mechanical-bug')[0]!;
    expect(f.ruleIds).toEqual(['R-AVWIN-10']);
    expect(f.contentIds).toEqual(['stuntdrake']);
    expect(f.confidence, 'proven requires the §4.4 double repro').toBe('proven');
    expect(REPORT.avwin10.fires).toBe(1);
    expect(REPORT.avwin10.firesSecondRun, 'same capsule, same divergence, twice').toBe(REPORT.avwin10.fires);
    expect(REPORT.avwin10.scenarioDeterministic, 'byte-identical state + combat log across runs').toBe(true);
    expect(f.firstDivergence?.step, 'the first avenge-stamped grant is a real log index').toBe(REPORT.avwin10.firstDivergenceStep);
    expect(REPORT.avwin10.firstDivergenceStep).toBeGreaterThanOrEqual(0);
    expect(f.minimizationStatus).toBe('complete');
    expect(f.scenarioId).toBe('avenge-dying-source-batch-pin');
    expect(f.reproduction).toContain('docbot:scenario');
  });

  it('the minimized scenario is GRADUATED: a curated fixture with a concrete assertion, linked back to the finding (§14)', () => {
    const f = byClass('verified-mechanical-bug')[0]!;
    // The fixture ran through the real runner and its concrete event-count expectation held.
    expect(REPORT.avwin10.scenarioResult.ok, REPORT.avwin10.scenarioResult.summary).toBe(true);
    // The checked-in file links back to the finding by fingerprint (stable identity, not prose).
    const raw = JSON.parse(readFileSync(new URL('../scenarios/avenge-dying-source-batch-pin.json', import.meta.url), 'utf8')) as {
      provenance?: { findingFingerprint?: string; minimizedFrom?: string }; ruleIds?: string[];
      expectations?: Array<{ kind: string; count?: number }>;
    };
    expect(raw.provenance?.findingFingerprint, 'fixture ↔ finding link').toBe(f.fingerprint);
    expect(raw.provenance?.minimizedFrom, 'minimization provenance recorded').toContain('temporalWindow');
    expect(raw.ruleIds).toEqual(['R-AVWIN-10']);
    // A concrete assertion — event-count 1 (the pinned violation), not a needs-ruling placeholder.
    expect(raw.expectations).toEqual([{ kind: 'event-count', event: 'buff', where: { avenge: true }, count: 1 }]);
  });

  it('verified text defect: approved contract + verified runtime vs the printed text (§12.1)', () => {
    const f = byClass('verified-text-defect')[0]!;
    expect(f.contentIds).toEqual(['hero:xerox']);
    expect(f.ruleIds).toEqual(['R-COPY-01', 'R-COPY-02']);
    expect(SLICE_CONTRACT_INDEX['hero:xerox']!.reviewStatus, 'the establishing contract is owner-ruled').toBe('approved');
    expect(f.suggestedText).toContain('exact copy');
  });

  it('wording recommendation: mechanically correct, owner-flagged terminology, cited (§11.4)', () => {
    const f = byClass('wording-recommendation')[0]!;
    expect(f.contentIds).toEqual(['zyff']);
    expect(f.ruleIds).toEqual(['R-MULT-01']);
    expect(f.summary).toContain('q-interact-nonstack-best-of'); // the owner's flag, cited
    expect(f.suggestedText).toContain('twice');
    // Mechanically correct is PROVEN by the oracle, not assumed: zyff's multiplier observation matched.
    expect(checkContract(SLICE_CONTRACT_INDEX['zyff']!, REPORT.observations)).toEqual([]);
  });

  it('questionable interaction: reproducible, unruled, competing interpretations presented (§12.1/§9.7)', () => {
    const f = byClass('questionable-interaction')[0]!;
    expect(f.contentIds).toEqual(['anubis']);
    expect(f.ruleIds, 'no approved rule governs it — that is the point').toEqual([]);
    expect(f.status).toBe('needs-ruling');
    expect(f.competingInterpretations).toHaveLength(2);
    for (const ci of f.competingInterpretations!) expect(ci.evidence.length).toBeGreaterThan(0);
    // The observation itself, pinned shrink-only: one Anubis, two deaths, TWO Lantern casts. An owner
    // ruling turns this into a rule + either a conforming assertion or a violation pin — not silence.
    expect(REPORT.anubis.lanternCasts).toBe(2);
  });

  it('findings serialize byte-stably with the V2 fields riding along; fingerprints ignore them', () => {
    const json = emitFindingsJson(FINDINGS);
    expect(json).toBe(emitFindingsJson([...FINDINGS].reverse()));
    const parsed = JSON.parse(json) as DocbotFinding[];
    expect(parsed).toHaveLength(4);
    const mech = parsed.find((f) => f.class === 'verified-mechanical-bug')!;
    expect(mech.firstDivergence).toBeDefined();
    expect(parsed.find((f) => f.class === 'questionable-interaction')!.competingInterpretations).toHaveLength(2);
    // The V2 fields are non-breaking: identity is unchanged by their presence (fingerprint hashes only
    // the structural six — same finding identity as a legacy V1 emission of the same mismatch).
    expect(mech.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(mech.id).toBe(`${SLICE_LANE}-${mech.fingerprint}`);
  });
});

describe('vertical slice — triangle auto-corroboration (owner-review-pipeline.md §2)', () => {
  it('agreeing extracted contracts corroborate; findings demote; owner-ruled statuses are untouched; nothing auto-approves (§23)', () => {
    const verdicts = corroborate(SLICE_CONTRACTS, REPORT.observations, FINDINGS);
    const status = Object.fromEntries(verdicts.map((v) => [v.contractId, v.status]));
    expect(status).toEqual({
      wolvesden: 'corroborated',
      sylus: 'corroborated',
      zyff: 'corroborated', // a wording recommendation does not block corroboration (§11.4 is clarity, not fidelity)
      deathsayer: 'corroborated',
      stuntdrake: 'needs-review', // the verified mechanical bug demotes it
      kennel: 'corroborated',
      anubis: 'needs-review', // the questionable interaction demotes it
      n2_bellringer: 'corroborated',
      'hero:xerox': 'approved', // owner-ruled input status is never moved by the machine
      dm_butcher: 'corroborated',
      dm_agent: 'corroborated',
      d2_recaller: 'corroborated',
      rune_fury: 'corroborated',
    });
    // NOTHING reached 'approved' by machine verdict — the only approved entry came in approved.
    expect(verdicts.filter((v) => v.status === 'approved').map((v) => v.contractId)).toEqual(['hero:xerox']);
  });
});

describe('vertical slice — sabotage (§4.5: every oracle family proves it can detect a planted defect)', () => {
  it('a doctored contract AMOUNT fails naming the contract, the field, and both values', () => {
    const doctored = structuredClone(SLICE_CONTRACT_INDEX['kennel']!) as ContentContract;
    doctored.triggers![0]!.threshold = 3; // truth (printed + ruled): Avenge (4)
    const mismatches = checkContract(doctored, REPORT.observations);
    expect(mismatches, 'the doctored threshold MUST be detected').toHaveLength(1);
    expect(mismatches[0]!.contractId).toBe('kennel');
    expect(mismatches[0]!.path).toBe('triggers.0.threshold');
    expect(mismatches[0]!.expected).toBe(3); // the doctored claim
    expect(mismatches[0]!.observed).toBe(4); // the engine's truth
    expect(mismatches[0]!.evidence).toContain('side-deaths');
    // The alarm is specific, not permanently red: the honest contract still passes.
    expect(checkContract(SLICE_CONTRACT_INDEX['kennel']!, REPORT.observations)).toEqual([]);
  });

  it('a doctored COPY POLICY fails the copy-semantics check', () => {
    const doctored = structuredClone(SLICE_CONTRACT_INDEX['hero:xerox']!) as ContentContract;
    doctored.copyPolicy!.mode = 'plain'; // truth (owner ruling 2026-08-15): exact
    const mismatches = checkContract(doctored, REPORT.observations);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.path).toBe('copyPolicy.mode');
    expect(mismatches[0]!.expected).toBe('plain');
    expect(mismatches[0]!.observed).toBe('exact');
    expect(checkContract(SLICE_CONTRACT_INDEX['hero:xerox']!, REPORT.observations)).toEqual([]);
  });

  it('a doctored GILDED DELTA fails the differential check', () => {
    const doctored = structuredClone(SLICE_CONTRACT_INDEX['wolvesden']!) as ContentContract;
    doctored.effects![0]!.summons!.count.gilded = 4; // truth: 6
    const mismatches = checkContract(doctored, REPORT.observations);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.path).toBe('effects.0.summons.count.gilded');
    expect(mismatches[0]!.observed).toBe(6);
  });
});
