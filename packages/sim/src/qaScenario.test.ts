/**
 * QA SCENARIO CONTRACT TESTS (docbot handoff §15 "Scenario contract" + §3.5 sabotage discipline).
 *
 * The contract under test: scenario files are JSON-stable, execution is byte-deterministic, unknown
 * content/schema versions fail LOUD with actionable messages, and a doctored expectation fails for the
 * right reason (the sabotage check — an oracle that can't fail is not an oracle).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseQaScenario, runQaScenario, stableStringify, validateQaScenario,
  type QaExpectation, type QaScenarioV1,
} from './qaScenario';

const load = (id: string): QaScenarioV1 => {
  const text = readFileSync(new URL(`./docbot/scenarios/${id}.json`, import.meta.url), 'utf8');
  const { scenario, errors } = parseQaScenario(text);
  expect(errors).toEqual([]);
  return scenario!;
};

const RECRUIT = 'recruit-cleric-buff';
const COMBAT = 'combat-generic-wave1';

describe('QaScenarioV1 contract', () => {
  it('checked-in fixtures validate and pass their own expectations', () => {
    for (const id of [RECRUIT, COMBAT]) {
      const result = runQaScenario(load(id));
      expect(result.validationErrors).toEqual([]);
      expect(result.ok, result.summary).toBe(true);
    }
  });

  it('JSON round-trip is stable (parse → stringify → parse is identity)', () => {
    for (const id of [RECRUIT, COMBAT]) {
      const scenario = load(id);
      const roundTripped = JSON.parse(JSON.stringify(scenario)) as QaScenarioV1;
      expect(stableStringify(roundTripped)).toBe(stableStringify(scenario));
      expect(validateQaScenario(roundTripped)).toEqual([]);
    }
  });

  it('running the same scenario twice produces a byte-equivalent normalized result', () => {
    for (const id of [RECRUIT, COMBAT]) {
      const scenario = load(id);
      const a = runQaScenario(scenario);
      const b = runQaScenario(scenario);
      expect(stableStringify(b)).toBe(stableStringify(a));
    }
  });

  it('unknown content ids fail validation with the offending id named', () => {
    const scenario = load(RECRUIT);

    const badRefs = { ...scenario, contentIds: ['definitely_not_a_card_2099'] };
    expect(validateQaScenario(badRefs).join('\n')).toContain('definitely_not_a_card_2099');

    // A state whose board references a removed card fails BEFORE execution, naming the id and the zone.
    const state = JSON.parse(scenario.state) as { board: Array<{ cardId: string }> };
    state.board[0]!.cardId = 'removed_card_xyz';
    const staleState = { ...scenario, state: JSON.stringify(state) };
    const errors = validateQaScenario(staleState).join('\n');
    expect(errors).toContain('removed_card_xyz');
    expect(errors).toContain('board');

    // An opponent snapshot referencing a removed card fails the same way.
    const combat = load(COMBAT);
    const opp = JSON.parse(JSON.stringify(combat.combat)) as NonNullable<QaScenarioV1['combat']>;
    (opp.opponent.minions[0] as { cardId: string }).cardId = 'ghost_minion_404';
    expect(validateQaScenario({ ...combat, combat: opp }).join('\n')).toContain('ghost_minion_404');
  });

  it('schema-migration guard: any version other than 1 fails loud, validating nothing else', () => {
    const scenario = load(RECRUIT);
    for (const v of [0, 2, '1', undefined]) {
      const errors = validateQaScenario({ ...scenario, schemaVersion: v });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('unsupported schemaVersion');
      expect(errors[0]).toContain('migrate');
    }
  });

  it('unknown expectation kinds and unknown invariants fail validation', () => {
    const scenario = load(RECRUIT);
    const bogusKind = { ...scenario, expectations: [{ kind: 'eval-js', code: 'x' } as unknown as QaExpectation] };
    expect(validateQaScenario(bogusKind).join('\n')).toContain('eval-js');
    const bogusInv = { ...scenario, expectations: [{ kind: 'invariant', id: 'nope' } as QaExpectation] };
    expect(validateQaScenario(bogusInv).join('\n')).toContain("unknown invariant 'nope'");
  });

  it("mode 'combat' requires an opponent and resolves only through faceOmen", () => {
    const combat = load(COMBAT);
    expect(validateQaScenario({ ...combat, combat: undefined }).join('\n')).toContain('combat.opponent');
    expect(validateQaScenario({ ...combat, action: { type: 'roll' } }).join('\n')).toContain('faceOmen');
  });

  it('SABOTAGE: a doctored card-delta fails for the right reason (§3.5)', () => {
    const scenario = load(RECRUIT);
    const doctored: QaScenarioV1 = {
      ...scenario,
      expectations: [{ kind: 'card-delta', selector: { cardId: 'emissary', zone: 'board', index: 0 }, attack: 4, health: 3 }],
    };
    const result = runQaScenario(doctored);
    expect(result.ok).toBe(false);
    const failed = result.expectationResults[0]!;
    expect(failed.pass).toBe(false);
    expect(failed.detail).toContain('expected +4/+3');
    expect(failed.detail).toContain('observed +3/+3'); // the engine's real answer, not a generic mismatch
  });

  it('SABOTAGE: a doctored combat event-count fails naming expected vs observed', () => {
    const scenario = load(COMBAT);
    const doctored: QaScenarioV1 = {
      ...scenario,
      expectations: [{ kind: 'event-count', event: 'death', count: 99 }],
    };
    const result = runQaScenario(doctored);
    expect(result.ok).toBe(false);
    expect(result.expectationResults[0]!.detail).toContain('expected 99');
  });

  it('no-op passes for a refused action and fails when the action acted', () => {
    const scenario = load(RECRUIT);
    // A play of a uid that isn't in hand is refused by the reducer (returns the same state) → no-op holds.
    const refused: QaScenarioV1 = {
      ...scenario,
      action: { type: 'play', uid: 'no-such-uid' },
      expectations: [{ kind: 'no-op' }],
    };
    expect(runQaScenario(refused).ok).toBe(true);
    // The real play changes the board → the same expectation fails.
    const acted: QaScenarioV1 = { ...scenario, expectations: [{ kind: 'no-op' }] };
    expect(runQaScenario(acted).ok).toBe(false);
  });

  it('needs-ruling surfaces the question without failing the scenario (§3.4)', () => {
    const scenario = load(RECRUIT);
    const withQuestion: QaScenarioV1 = {
      ...scenario,
      expectations: [
        ...(scenario.expectations ?? []),
        { kind: 'needs-ruling', question: 'Should the Cleric buff Dragons in HAND too?' },
      ],
    };
    const result = runQaScenario(withQuestion);
    expect(result.ok).toBe(true);
    expect(result.needsRuling).toEqual(['Should the Cleric buff Dragons in HAND too?']);
    expect(result.summary).toContain('needs ruling');
  });
});
