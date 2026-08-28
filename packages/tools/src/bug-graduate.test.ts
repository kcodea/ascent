/**
 * DOC BOT 2.0 WP G — GRADUATION SABOTAGE SUITE (blueprint §14 + §4.5).
 *
 * §14's checklist is only worth anything if each refusal can actually fire. Every gate below is proven in
 * both directions: a planted flaky predicate must refuse, an unresolved expectation must refuse, an
 * unapproved rule must refuse — and the happy path must still graduate. The repro is INJECTED
 * (`runRepro`), which is precisely what makes planting a flake possible without touching the engine.
 */
import { describe, expect, it } from 'vitest';
import type { BugReportEnvelope, QaScenarioResult, QaScenarioV1 } from '@game/sim';
import type { QaReproOutcome } from './bug-qa-scenario.lib';
import { derivePinExpectations, planGraduation, regressionScenarioId, semanticSignature } from './bug-graduate.lib';

const REPORT_ID = 'deadbeef-1111-2222-3333-444444444444';

const envelope = (): BugReportEnvelope => ({
  schemaVersion: 1,
  reportId: REPORT_ID,
  createdAt: '2026-08-27T00:00:00.000Z',
  description: 'my minion attacked twice',
  issueType: 'mechanics',
  context: {} as BugReportEnvelope['context'],
  client: {} as BugReportEnvelope['client'],
});

const scenario = (): QaScenarioV1 => ({
  schemaVersion: 1,
  id: 'bug-deadbeef',
  title: 'Bug deadbeef — mechanics (wave 3, hero-x)',
  source: 'bug-report',
  seed: 7,
  setId: 'set1',
  mode: 'recruit',
  state: '{"seed":7}',
  expectations: [{ kind: 'needs-ruling', question: 'Player claim (UNTRUSTED input…)' }],
  metadata: { reportId: REPORT_ID },
});

const result = (over: Partial<QaScenarioResult> = {}): QaScenarioResult => ({
  scenarioId: 'bug-deadbeef',
  ok: true,
  validationErrors: [],
  before: '{"a":1}',
  after: '{"a":2}',
  events: [{ type: 'cardSummoned' }, { type: 'cardSummoned' }, { type: 'statsChanged' }] as unknown as QaScenarioResult['events'],
  expectationResults: [],
  needsRuling: [],
  refs: { contentIds: [], ruleIds: [] },
  repro: 'npm run docbot:scenario -- bug-deadbeef',
  summary: 'ran',
  ...over,
});

const outcome = (over: Partial<QaReproOutcome> = {}): QaReproOutcome => ({
  scenario: scenario(),
  result: result(),
  comparison: { applicable: false, drifted: false, lines: [] },
  classification: 'reproduced',
  lines: [],
  ...over,
});

/** The happy-path options: reproduced, ruled by an approved rule, verdict 'correct'. */
const opts = (over: Partial<Parameters<typeof planGraduation>[0]> = {}): Parameters<typeof planGraduation>[0] => ({
  envelope: envelope(),
  runRepro: () => outcome(),
  ruleIds: ['R-AVWIN-03'],
  contractIds: [],
  isApprovedRule: (id) => id === 'R-AVWIN-03',
  isApprovedContract: () => false,
  hasDecision: () => false,
  verdict: 'correct',
  classId: 'multiplier-fold',
  today: '2026-08-27',
  ...over,
});

describe('graduation — the happy path', () => {
  it('writes a curated regression with concrete derived expectations and full provenance', () => {
    const plan = planGraduation(opts({ pr: '1277', findingFingerprint: 'a1b2c3d4' }));
    expect(plan.refusals).toEqual([]);
    expect(plan.ok).toBe(true);

    const s = plan.scenario!;
    expect(s.id).toBe(regressionScenarioId(REPORT_ID, 'multiplier-fold'));
    expect(s.source).toBe('regression');
    expect(s.provenance).toEqual({ kind: 'bug-report', reportId: REPORT_ID, parentScenarioId: 'bug-deadbeef', findingFingerprint: 'a1b2c3d4' });
    // The untrusted player claim is GONE — replaced by derived, concrete assertions.
    expect(s.expectations!.some((e) => e.kind === 'needs-ruling')).toBe(false);
    expect(s.expectations).toEqual([
      { kind: 'event-count', event: 'cardSummoned', count: 2 },
      { kind: 'event-count', event: 'statsChanged', count: 1 },
    ]);
    expect(s.ruleIds).toEqual(['R-AVWIN-03']);

    expect(plan.record).toMatchObject({
      scenarioId: s.id, classId: 'multiplier-fold', reportId: REPORT_ID,
      ruleIds: ['R-AVWIN-03'], contractIds: [], graduatedAt: '2026-08-27', pr: '1277',
    });
  });

  it('explicit --expect expectations win over the derived pin', () => {
    const plan = planGraduation(opts({ expect: [{ kind: 'state-delta', path: 'embers', equals: 3 }], verdict: undefined }));
    expect(plan.ok).toBe(true);
    expect(plan.scenario!.expectations).toEqual([{ kind: 'state-delta', path: 'embers', equals: 3 }]);
  });

  it('an owner decision alone resolves expected behaviour', () => {
    const plan = planGraduation(opts({ ruleIds: [], ownerDecision: 'R-TURN-01', hasDecision: (id) => id === 'R-TURN-01' }));
    expect(plan.ok).toBe(true);
    expect(plan.record!.ownerDecision).toBe('R-TURN-01');
  });

  it('surfaces a single-pin class\'s outstanding sibling work verbatim, and invents nothing', () => {
    const todo = 'the family generated driver is outstanding';
    const plan = planGraduation(opts({ classId: 'unclassified', siblingTodo: todo }));
    expect(plan.ok).toBe(true);
    expect(plan.siblingTodo).toBe(todo);
  });
});

describe('graduation — SABOTAGE: non-deterministic reproduction', () => {
  it('REFUSES when a planted flaky predicate makes two runs disagree', () => {
    let n = 0;
    const flaky = (): QaReproOutcome => {
      n += 1;
      // The flake: the second run's combat resolves one event differently. Nothing else changes.
      return outcome({ result: result({ after: n === 1 ? '{"a":2}' : '{"a":3}' }) });
    };
    const plan = planGraduation(opts({ runRepro: flaky }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals[0]).toMatch(/NON-DETERMINISTIC REPRODUCTION/);
    expect(plan.scenario).toBeUndefined();
    expect(n, 'the gate must actually run the repro twice').toBe(2);
  });

  it('and the same flake in the CLASSIFICATION is caught too', () => {
    let n = 0;
    const plan = planGraduation(opts({
      runRepro: () => { n += 1; return outcome({ classification: n === 1 ? 'reproduced' : 'drifted' }); },
    }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals[0]).toMatch(/NON-DETERMINISTIC REPRODUCTION/);
  });

  it('CONTROL: a stable repro passes the same gate', () => {
    expect(planGraduation(opts()).ok).toBe(true);
  });

  it('semanticSignature ignores prose but not substance', () => {
    expect(semanticSignature(outcome({ lines: ['a'] }))).toBe(semanticSignature(outcome({ lines: ['totally different prose'] })));
    expect(semanticSignature(outcome())).not.toBe(semanticSignature(outcome({ result: result({ combatOutcome: 'loss' }) })));
  });
});

describe('graduation — SABOTAGE: unresolved expected behaviour', () => {
  it('REFUSES with "needs ruling first" when no rule, contract, or decision is supplied', () => {
    const plan = planGraduation(opts({ ruleIds: [], contractIds: [] }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/NEEDS RULING FIRST/);
    expect(plan.scenario).toBeUndefined();
  });

  it('REFUSES an EXTRACTED (not approved) contract — a machine verdict is not a ruling', () => {
    const plan = planGraduation(opts({ ruleIds: [], contractIds: ['C-kennel'], isApprovedContract: () => false }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/contract 'C-kennel' is not APPROVED/);
  });

  it('REFUSES a pending rule id', () => {
    const plan = planGraduation(opts({ ruleIds: ['q-123'], isApprovedRule: () => false }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/rule 'q-123' is not APPROVED/);
  });

  it('REFUSES an owner decision id that decisions.json does not carry', () => {
    const plan = planGraduation(opts({ ruleIds: [], ownerDecision: 'R-GHOST', hasDecision: () => false }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/no owner decision recorded for 'R-GHOST'/);
  });
});

describe('graduation — SABOTAGE: no concrete assertion', () => {
  it('REFUSES when neither --expect nor --verdict correct is given (the claim may not survive)', () => {
    const plan = planGraduation(opts({ verdict: undefined }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/NO CONCRETE ASSERTION/);
  });

  it('REFUSES to pin a run that emitted nothing observable', () => {
    const plan = planGraduation(opts({ runRepro: () => outcome({ result: result({ events: [] }) }) }));
    expect(plan.ok).toBe(false);
    expect(plan.refusals.join(' ')).toMatch(/nothing observable to pin/);
  });
});

describe('graduation — SABOTAGE: the reproduction itself', () => {
  for (const classification of ['drifted', 'insufficient-evidence', 'menu-no-evidence'] as const) {
    it(`REFUSES a '${classification}' reproduction`, () => {
      const plan = planGraduation(opts({ runRepro: () => outcome({ classification }) }));
      expect(plan.ok).toBe(false);
      expect(plan.refusals[0]).toMatch(/REPRODUCTION CLASSIFIED/);
    });
  }
});

describe('derivePinExpectations', () => {
  it('pools recruit and combat events, one expectation per type, sorted', () => {
    const exps = derivePinExpectations(result({
      combatLog: [{ type: 'attack' }, { type: 'attack' }, { type: 'death' }] as unknown as QaScenarioResult['combatLog'],
    }));
    expect(exps).toEqual([
      { kind: 'event-count', event: 'attack', count: 2 },
      { kind: 'event-count', event: 'cardSummoned', count: 2 },
      { kind: 'event-count', event: 'death', count: 1 },
      { kind: 'event-count', event: 'statsChanged', count: 1 },
    ]);
  });
});
