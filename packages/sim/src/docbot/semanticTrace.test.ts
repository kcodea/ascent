/**
 * DOC BOT 2.0 WP C — TRACE DETERMINISM + HONEST COVERAGE + SABOTAGE (§4.5).
 *
 * · Same capsule/scenario traced twice → byte-identical semantic trace (the WP C exit gate's determinism
 *   clause), for a COMBAT scenario and a SHOP (recruit) scenario alike.
 * · The per-family coverage table (`COMBAT_TRACE_COVERAGE`) makes honest claims: every 'always' field is
 *   present on every real event of that family, every 'never' field on none — checked against a real fight's
 *   adapter output, so the table can't drift into aspiration.
 * · SABOTAGE: a doctored trace (dropped event; rewritten step-root "parent") must trip the divergence
 *   locator at exactly the doctored position — proving the comparison can fail, and fail precisely.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMBAT_TRACE_COVERAGE, type CombatSemanticEvent } from '@game/core';
import { parseQaScenario, runQaScenario } from '../qaScenario';
import { firstTraceDivergence, semanticTraceOf, serializeTrace, type SemanticTrace } from '../semanticTrace';

const loadScenario = (id: string) => {
  const text = readFileSync(new URL(`./scenarios/${id}.json`, import.meta.url), 'utf8');
  const { scenario, errors } = parseQaScenario(text);
  expect(errors, `fixture ${id} must validate`).toEqual([]);
  return scenario!;
};

const traceOf = (id: string): SemanticTrace => {
  const scenario = loadScenario(id);
  const result = runQaScenario(scenario);
  expect(result.validationErrors).toEqual([]);
  return semanticTraceOf(result, { actionId: scenario.id });
};

describe('WP C semantic trace — determinism', () => {
  it('a COMBAT scenario traced twice is byte-identical', () => {
    const a = traceOf('combat-generic-wave1');
    const b = traceOf('combat-generic-wave1');
    expect(a.combat.length, 'the fight produced no combat trace').toBeGreaterThan(0);
    expect(serializeTrace(a)).toBe(serializeTrace(b));
    expect(firstTraceDivergence(a, b)).toBeNull();
  });

  it('a SHOP (recruit) scenario traced twice is byte-identical', () => {
    const a = traceOf('recruit-cleric-buff');
    const b = traceOf('recruit-cleric-buff');
    expect(a.recruit.length, 'the action produced no recruit trace').toBeGreaterThan(0);
    expect(serializeTrace(a)).toBe(serializeTrace(b));
    expect(firstTraceDivergence(a, b)).toBeNull();
  });

  it('event ids follow the deterministic combat:<actionId>:<seq> convention', () => {
    const t = traceOf('combat-generic-wave1');
    t.combat.forEach((e, i) => {
      expect(e.eventId).toBe(`combat:combat-generic-wave1:${i}`);
      expect(e.seq).toBe(i);
      expect(e.phase).toBe('combat');
    });
  });
});

describe('WP C semantic trace — honest per-family coverage', () => {
  it("the coverage table's 'always'/'never' claims hold on real adapter output", () => {
    const t = traceOf('combat-generic-wave1');
    const byType = new Map<string, CombatSemanticEvent[]>();
    for (const e of t.combat) {
      const xs = byType.get(e.eventType) ?? [];
      xs.push(e);
      byType.set(e.eventType, xs);
    }
    expect(byType.size, 'the fight exercised no event families').toBeGreaterThan(2);
    for (const [type, events] of byType) {
      const cov = COMBAT_TRACE_COVERAGE[type as keyof typeof COMBAT_TRACE_COVERAGE];
      expect(cov, `family '${type}' missing from COMBAT_TRACE_COVERAGE`).toBeTruthy();
      for (const [field, claim] of [['source', cov.source], ['target', cov.target], ['amount', cov.amount]] as const) {
        for (const e of events) {
          const present = e[field] !== undefined;
          if (claim === 'always') expect(present, `${type}: coverage claims ${field} 'always' but event ${e.eventId} lacks it`).toBe(true);
          if (claim === 'never') expect(present, `${type}: coverage claims ${field} 'never' but event ${e.eventId} carries it — update the table honestly`).toBe(false);
        }
      }
    }
  });

  it('the adapter never carries the user-facing narration string', () => {
    const t = traceOf('combat-generic-wave1');
    for (const e of t.combat) {
      expect(JSON.stringify(e).includes('"text"'), `event ${e.eventId} leaked a narration string into the trace`).toBe(false);
    }
  });
});

describe('WP C semantic trace — sabotage (§4.5)', () => {
  it('a DROPPED event trips the divergence locator at the dropped position', () => {
    const a = traceOf('combat-generic-wave1');
    const doctored: SemanticTrace = { recruit: a.recruit, combat: [...a.combat.slice(0, 3), ...a.combat.slice(4)] };
    const d = firstTraceDivergence(a, doctored);
    expect(d, 'a dropped event went undetected').toBeTruthy();
    expect(d!.lane).toBe('combat');
    expect(d!.index).toBe(3);
  });

  it('a REWRITTEN step-root (wrong parent grouping) trips the locator at the doctored event', () => {
    const a = traceOf('combat-generic-wave1');
    const i = a.combat.findIndex((e) => e.cause?.stepRootEventId !== undefined);
    expect(i, 'no step-grouped event to doctor — fixture too small').toBeGreaterThanOrEqual(0);
    const doctored: SemanticTrace = {
      recruit: a.recruit,
      combat: a.combat.map((e, j) => (j === i ? { ...e, cause: { ...e.cause, stepRootEventId: 'combat:doctored:0' } } : e)),
    };
    const d = firstTraceDivergence(a, doctored);
    expect(d).toBeTruthy();
    expect(d!.lane).toBe('combat');
    expect(d!.index).toBe(i);
  });
});
