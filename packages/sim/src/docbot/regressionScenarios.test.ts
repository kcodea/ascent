/**
 * DOC BOT 2.0 WP G — THE CURATED REGRESSION LANE (blueprint §14: "CI protects the behavior forever").
 *
 * `scenarios/regressions/` is CURATED space (§4.6): every file here was written by `npm run bugs:graduate`
 * from a reproduced, RULED player report, and no generator may ever touch it. This lane is what makes that
 * permanent — it ENUMERATES the directory (rather than naming ids, as the older parity lane does), so a
 * graduated fixture is protected the moment it lands, with no second edit to remember.
 *
 * It runs on the PR gate. That is affordable because each fixture is one action or one fight over a pinned
 * state — the same cost profile as the five hand-authored scenarios the parity lane already runs.
 *
 * The lane asserts three things per fixture, all of them things a graduation guarantees:
 *  1. it validates against THIS checkout (content ids still resolve — a retired card un-pins its regression
 *     loudly instead of silently passing);
 *  2. `source: 'regression'` and a provenance chain back to a report — no hand-dropped file may squat here;
 *  3. it carries at least one CONCRETE expectation and NO `needs-ruling` question, and every expectation
 *     passes. A graduated regression never ships an open question (§14's refusal path made permanent).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseQaScenario, runQaScenario, validateQaScenario } from '../qaScenario';

const DIR = fileURLToPath(new URL('./scenarios/regressions/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

describe('curated regression scenarios (§14 graduation output)', () => {
  it('the directory exists and every file is a parseable QaScenarioV1', () => {
    for (const f of files) {
      const { scenario, errors } = parseQaScenario(readFileSync(DIR + f, 'utf8'));
      expect(errors, `${f}: ${errors.join(' · ')}`).toEqual([]);
      expect(scenario, f).toBeDefined();
    }
  });

  // An empty directory is a legitimate state (nothing has graduated yet) — but it must never look like a
  // passing lane, so the count is asserted visibly rather than silently skipped.
  it(`enumerates ${files.length} curated regression(s)`, () => {
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  for (const f of files) {
    describe(f, () => {
      const { scenario } = parseQaScenario(readFileSync(DIR + f, 'utf8'));

      it('validates against this checkout', () => {
        expect(validateQaScenario(scenario)).toEqual([]);
      });

      it('is curated regression space: source + provenance back to a report', () => {
        expect(scenario!.source).toBe('regression');
        expect(scenario!.provenance?.reportId, 'a graduated regression records the report it came from').toBeTruthy();
        expect(scenario!.provenance?.parentScenarioId, 'and the bug scenario it was graduated from').toBeTruthy();
        // The filename stem IS the id (the runner resolves bare ids that way).
        expect(`${scenario!.id}.json`).toBe(f);
      });

      it('carries concrete expectations and no open question', () => {
        const exps = scenario!.expectations ?? [];
        expect(exps.length, 'a regression with no assertion protects nothing').toBeGreaterThan(0);
        expect(exps.filter((e) => e.kind === 'needs-ruling'), 'a graduated regression never ships an open question').toEqual([]);
      });

      it('still passes — the behaviour it pins is intact', () => {
        const result = runQaScenario(scenario!);
        const failed = result.expectationResults.filter((r) => !r.pass).map((r) => r.detail);
        expect(failed, failed.join(' · ')).toEqual([]);
        expect(result.ok, result.summary).toBe(true);
      });
    });
  }
});
