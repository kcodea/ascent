/**
 * DOC BOT 2.0 WP D — the contract-verification GATE lane (blueprint §9.1/§10.1/§18-D).
 *
 * Runs the DETERMINISTIC SAMPLE of the derived contract sweep (rotation by content-id hash — never wall
 * clock; the full 901-contract sweep lives behind `npm run docbot:contracts` and the nightly), and gates:
 *
 *  · determinism — two identical sweeps produce byte-identical observations/mismatches/metamorphic results;
 *  · accounting honesty (§4.3) — every contract is planned, and every applicable-but-unexecuted case
 *    carries a typed skip reason; nothing is silently complete;
 *  · the §18-D exit gate — every APPROVED contract has an executable direct suite that ran (approved
 *    contracts are never sampled out); the approved-but-unenforced rule queue is pinned shrink-only; and
 *    the two KNOWN approved-rule violations (R-AVWIN-02/10) surface as CRITICAL release-blocker findings;
 *  · authority honesty (§6.1) — a draft-contract mismatch is corroboration-grade ('questionable-
 *    interaction'), an approved-contract mismatch is verified-bug-grade;
 *  · sabotage (§4.5) — a doctored contract amount, a doctored gilded delta, and a doctored metamorphic
 *    reorder measurement are each DETECTED.
 */
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { allRules, unenforcedApproved } from '@game/rules';
import { stableStringify } from '../qaScenario';
import { playScan } from './playScan';
import { CASE_TEMPLATES, planCases, type SkipReason } from './isolatedCases';
import { checkMetamorphic, runVariantDiff } from './variantDiff';
import { inSample, releaseBlockerFindings, runContractSweep, sampleRotation } from './contractOracle';

/** The PR-gate sample: ~1/3 of the driver-executable contracts per rotation (the full sweep is the
 *  docbot:contracts / nightly lane). Approved contracts always execute regardless of rotation. */
const GATE_SAMPLE_MOD = 3;

const CONTRACTS = allContracts();
const scan = playScan(); // shared across sweeps — one differential run, injected (deterministic either way)
const sweep = runContractSweep({ contracts: CONTRACTS, sampleMod: GATE_SAMPLE_MOD, corroboration: { playScanResult: scan } });

const TYPED_SKIPS: ReadonlySet<string> = new Set<SkipReason | string>([
  'no-driver-for-shape', 'covered-by-slice-oracle', 'covered-by-cited-lane', 'hero-power-behaviour-unextracted',
  'board-cap-would-clip', 'gilded-not-declared', 'contract-states-no-targets', 'no-limit-declared',
  'runtime-unobserved', 'sampled-out-this-rotation',
  // the 2026-08-28 gilding-kind skips (R-GILD-01/-02)
  'gild-not-applicable', 'gild-stated-by-golden-text', 'gild-shape-not-countable', 'gild-shape-unresolved',
]);

describe('contract oracle at scale — the deterministic gate sample', () => {
  it('sweeps the whole registry and is deterministic (§4.4)', () => {
    expect(sweep.contractsTotal).toBe(CONTRACTS.length);
    // 901 → 885 on 2026-08-28: the owner archived the 16 Celestials ("leaving set 3 empty of minions now"),
    // and an archived card is out of the contract sweep. A floor, not an equality — it guards against the
    // sweep silently collapsing, and content is expected to grow past it again.
    expect(sweep.contractsTotal).toBeGreaterThanOrEqual(880); // 13 curated + 872 extracted today
    const again = runContractSweep({ contracts: CONTRACTS, sampleMod: GATE_SAMPLE_MOD, corroboration: { playScanResult: scan } });
    const key = (r: typeof sweep) => stableStringify({
      observations: r.observations, mismatches: r.mismatches,
      metamorphic: r.metamorphic, limitChecks: r.limitChecks, rotation: r.rotation,
    });
    expect(key(again)).toBe(key(sweep));
  });

  it('accounts for every contract: planned cases or typed skips, never silence (§4.3)', () => {
    expect(sweep.plans.length).toBe(CONTRACTS.length);
    for (const p of sweep.plans) {
      expect(p.cases.length + p.skipped.length, `${p.contractId} planned nothing and skipped nothing`).toBeGreaterThan(0);
      for (const s of p.skipped) expect(TYPED_SKIPS.has(s.reason), `${p.contractId}: untyped skip '${s.reason}'`).toBe(true);
    }
    for (const reason of Object.keys(sweep.skippedByReason)) {
      expect(TYPED_SKIPS.has(reason), `untyped skip bucket '${reason}'`).toBe(true);
    }
    // The per-template ledger balances: applicable = executed + skipped, per template.
    for (const t of CASE_TEMPLATES) {
      const row = sweep.templateTotals[t];
      expect(row.applicable, `${t} ledger`).toBe(row.executed + row.skipped);
    }
  });

  it('sampling is deterministic and clock-free', () => {
    const ids = sweep.plans.filter((p) => p.cases.length > 0).map((p) => p.contractId);
    const rot = sampleRotation(ids, GATE_SAMPLE_MOD);
    expect(rot).toBe(sweep.rotation);
    expect(sampleRotation(ids, GATE_SAMPLE_MOD)).toBe(rot);
    expect(sampleRotation(ids, 1)).toBe(0);
    for (const id of ids) expect(inSample(id, 1, 0)).toBe(true); // full sweep samples everything
  });

  it('EXIT GATE: every approved contract has an executable direct suite that ran', () => {
    const approved = CONTRACTS.filter((c) => c.reviewStatus === 'approved');
    expect(approved.length, 'at least one approved contract exists (hero:xerox)').toBeGreaterThanOrEqual(1);
    for (const c of approved) {
      const plan = sweep.plans.find((p) => p.contractId === c.contentId)!;
      expect(plan.cases.length, `approved ${c.contentId} has no executable case`).toBeGreaterThan(0);
      const row = sweep.rows.find((r) => r.contractId === c.contentId)!;
      const direct = row.aspects.find((a) => a.aspect === 'direct-suite')!;
      expect(direct.verdict, `approved ${c.contentId} direct suite did not run: ${direct.detail}`).not.toBe('uncovered');
      expect(row.sampled, `approved ${c.contentId} must never be sampled out`).toBe(true);
    }
  });

  it('EXIT GATE: the approved-but-unenforced rule queue is pinned (shrink-only)', () => {
    // WP D wants the queue at 0 or explicitly pinned. It is PINNED here: these two predate the program
    // (the WP B ratchet), each awaiting its enforcement lane. Fixing one deletes it here — never add.
    expect(unenforcedApproved(allRules()).map((r) => r.id).sort()).toEqual(['R-AURA-01', 'R-PLAY-01']);
  });

  it('EXIT GATE: known approved-rule violations surface as CRITICAL release blockers', () => {
    const blockers = releaseBlockerFindings(allRules());
    expect(blockers.map((f) => f.ruleIds.join(',')).sort()).toEqual(['R-AVWIN-02', 'R-AVWIN-10']);
    for (const f of blockers) {
      expect(f.severity).toBe('critical');
      expect(f.class).toBe('verified-mechanical-bug');
      expect(f.status, 'pinned, not new — the temporalWindow KNOWN_VIOLATIONS pin is the repro').toBe('known');
      expect(f.confidence).toBe('proven');
    }
  });

  it('authority honesty: no verified-bug finding without an approved contract behind it (§6.1)', () => {
    for (const f of sweep.findings) {
      const isApproved = f.contentIds.some((id) => CONTRACTS.find((c) => c.contentId === id)?.reviewStatus === 'approved');
      if (f.class === 'verified-mechanical-bug') {
        expect(isApproved, `${f.id} claims verified-bug grade against a non-approved contract`).toBe(true);
      } else {
        expect(f.class).toBe('questionable-interaction');
      }
    }
    // The gate is red the day the sweep verifies a bug against an approved contract — that is a release
    // blocker to triage, not a number to tolerate.
    expect(sweep.findings.filter((f) => f.class === 'verified-mechanical-bug')).toEqual([]);
  });

  it('metamorphic laws hold across the sample — and any breach surfaces as a finding, never silence', () => {
    const fails = sweep.metamorphic.filter((m) => !m.diff.ok);
    for (const m of fails) {
      expect(sweep.findings.some((f) => f.contentIds.includes(m.contractId) && f.id.length > 0),
        `metamorphic breach on ${m.contractId} emitted no finding`).toBe(true);
    }
    // Today the sampled laws all hold (reorder invariance, rune no-op, gilded delta, multiplier ×2).
    expect(fails).toEqual([]);
  });
});

describe('contract oracle — sabotage (§4.5: every oracle family proves it can fail)', () => {
  const wolvesden = CONTRACTS.find((c) => c.contentId === 'wolvesden')!;
  const xerox = CONTRACTS.find((c) => c.contentId === 'hero:xerox')!;

  it('a doctored contract AMOUNT is detected (draft → disagreement finding)', () => {
    const doctored = structuredClone(wolvesden);
    doctored.effects![0]!.summons!.count.plain = 4; // engine summons 3
    const r = runContractSweep({ contracts: [doctored], corroboration: { playScanResult: scan } });
    const m = r.mismatches.find((x) => x.path === 'effects.0.summons.count.plain');
    expect(m, 'doctored plain count must mismatch').toBeDefined();
    expect(m!.expected).toBe(4);
    expect(m!.observed).toBe(3);
    const f = r.findings.find((x) => x.contentIds.includes('wolvesden'));
    expect(f?.class, 'an extracted-status contract mismatch is corroboration-grade').toBe('questionable-interaction');
    expect(f?.severity).toBe('question');
  });

  it('a doctored GILDED DELTA is detected on both legs (declared count + metamorphic law)', () => {
    const doctored = structuredClone(wolvesden);
    doctored.effects![0]!.summons!.count.gilded = 7; // engine summons 6
    doctored.gildedDelta = { kind: 'multiply', factor: 3, description: 'sabotage' }; // engine doubles
    const r = runContractSweep({ contracts: [doctored], corroboration: { playScanResult: scan } });
    expect(r.mismatches.some((x) => x.path === 'effects.0.summons.count.gilded' && x.observed === 6)).toBe(true);
    const law = r.metamorphic.find((m) => m.law === 'gilded-delta-satisfaction' && m.contractId === 'wolvesden');
    expect(law, 'the gilded-delta law must run').toBeDefined();
    expect(law!.diff.ok, 'factor 3 must fail against the measured ×2').toBe(false);
  });

  it('a doctored APPROVED contract mismatch is verified-bug-grade — and turns the gate red', () => {
    const doctored = structuredClone(xerox);
    doctored.copyPolicy = { mode: 'plain' }; // the engine provably copies exact
    const r = runContractSweep({ contracts: [doctored], corroboration: { playScanResult: scan } });
    const f = r.findings.find((x) => x.contentIds.includes('hero:xerox'));
    expect(f?.class).toBe('verified-mechanical-bug');
    expect(f?.severity).toBe('error');
  });

  it('a doctored metamorphic REORDER measurement is detected without a second engine consult', () => {
    const doctored = checkMetamorphic('irrelevant-reorder-invariance', 'sabotage-subject',
      'doctored: the reordered variant reports one extra summon', () => 3, () => 4);
    expect(doctored.diff.ok).toBe(false);
    expect(runVariantDiff(() => 3, () => 3).ok).toBe(true);
    expect(runVariantDiff(() => 3, () => 6, { kind: 'times', factor: 2 }).ok).toBe(true);
    expect(runVariantDiff(() => 3, () => 5, { kind: 'times', factor: 2 }).ok).toBe(false);
  });

  it('a rogue skip reason cannot hide: planCases only emits the typed vocabulary', () => {
    for (const c of CONTRACTS) {
      for (const s of planCases(c).skipped) expect(TYPED_SKIPS.has(s.reason)).toBe(true);
    }
  });
});
