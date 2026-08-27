/**
 * QA SCENARIO SAVE endpoint — the pure write-plan (`planScenarioSave`), which is the entire validation
 * surface of the dev-only /__qa-scenario/save middleware (mirrors `rulebookPlugin.test.ts`). The filesystem
 * contract under test: the filename derives ONLY from a strictly-slugged scenario id (no client paths, no
 * traversal), an existing fixture is never overwritten without the explicit flag, and oversized payloads
 * are refused.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SCENARIO_BYTES, planScenarioSave } from './qaScenarioPlugin';

const scenario = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'sb-test-w1-123',
  title: 'A test export',
  source: 'scene-builder',
  seed: 123,
  setId: 'set1',
  mode: 'recruit',
  state: '{"seed":123}',
  ...over,
});

describe('planScenarioSave', () => {
  it('accepts a well-formed save and derives the filename from the id', () => {
    const plan = planScenarioSave({ scenario: scenario() }, false);
    expect(plan).toMatchObject({ fileName: 'sb-test-w1-123.json' });
    // The written bytes are the pretty-printed fixture shape with a trailing newline.
    expect((plan as { text: string }).text.endsWith('}\n')).toBe(true);
    expect(JSON.parse((plan as { text: string }).text)).toEqual(scenario());
  });

  it('refuses non-object bodies and non-object scenarios', () => {
    for (const body of [null, 'x', [], { scenario: null }, { scenario: 'x' }, { scenario: [] }]) {
      expect('error' in (planScenarioSave(body, false) as object)).toBe(true);
    }
  });

  it('refuses any id that is not a strict lowercase slug (the traversal guard)', () => {
    for (const id of ['../../evil', 'a/b', 'a\\b', 'UPPER', 'sp ace', '.hidden', '', 'a'.repeat(90), 'ok;rm']) {
      const plan = planScenarioSave({ scenario: scenario({ id }) }, false);
      expect(plan).toHaveProperty('error');
      expect((plan as { error: string }).error).toContain('scenario.id');
    }
  });

  it('refuses wrong schemaVersion, empty title, unknown source, and missing state', () => {
    expect(planScenarioSave({ scenario: scenario({ schemaVersion: 2 }) }, false)).toHaveProperty('error');
    expect(planScenarioSave({ scenario: scenario({ title: '' }) }, false)).toHaveProperty('error');
    expect(planScenarioSave({ scenario: scenario({ source: 'evil' }) }, false)).toHaveProperty('error');
    expect(planScenarioSave({ scenario: scenario({ state: undefined }) }, false)).toHaveProperty('error');
  });

  it('refuses to overwrite an existing fixture unless overwrite: true is explicit', () => {
    const clash = planScenarioSave({ scenario: scenario() }, true);
    expect((clash as { error: string }).error).toContain('already exists');
    expect((clash as { error: string }).error).toContain('overwrite');
    // Explicit consent goes through; a non-boolean flag does not.
    expect(planScenarioSave({ scenario: scenario(), overwrite: true }, true)).toHaveProperty('fileName');
    expect(planScenarioSave({ scenario: scenario(), overwrite: 'yes' }, true)).toHaveProperty('error');
  });

  it('refuses oversized payloads', () => {
    const big = planScenarioSave({ scenario: scenario({ state: 'x'.repeat(MAX_SCENARIO_BYTES) }) }, false);
    expect((big as { error: string }).error).toContain('too large');
  });
});
