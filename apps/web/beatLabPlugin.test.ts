import { describe, it, expect } from 'vitest';
import { planBeatDefaultsWrite, MAX_DEFAULTS_BYTES } from './beatLabPlugin';

/** BEAT SYSTEM PR 8b — the pure validator behind the dev-only beat-defaults commit endpoint. */
const FILE = '/repo/packages/ui/src/beatLab/beat-defaults.json';
const ok = (timings: unknown) => planBeatDefaultsWrite({ json: JSON.stringify({ version: 1, timings }) }, FILE);

describe('planBeatDefaultsWrite', () => {
  it('accepts a valid sparse override map and re-serializes it', () => {
    const p = planBeatDefaultsWrite({ json: JSON.stringify({ version: 1, timings: { 'source:rune:rune_lapidary:endOfTurn': { holdMs: 900 } } }) }, FILE);
    expect(p.status).toBe(200);
    expect(p.file).toBe(FILE);
    expect(p.data).toContain('"holdMs": 900');
    expect(p.data!.endsWith('\n')).toBe(true);
  });

  it('accepts every legal key shape', () => {
    for (const key of ['source:minion:b2_oona:onSummon', 'family:avenge', 'trigger:endOfTurn', 'policy:foldedCue', 'global']) {
      expect(ok({ [key]: { windupMs: 10 } }).status, key).toBe(200);
    }
  });

  it('rejects a non-object body / missing json / bad version', () => {
    expect(planBeatDefaultsWrite(42, FILE).status).toBe(400);
    expect(planBeatDefaultsWrite({}, FILE).status).toBe(400);
    expect(planBeatDefaultsWrite({ json: JSON.stringify({ version: 2, timings: {} }) }, FILE).status).toBe(400);
  });

  it('rejects unsafe keys, malformed keys, and unknown fields', () => {
    // Raw JSON string so "__proto__" is a real parsed own-key, not an object-literal prototype set.
    expect(planBeatDefaultsWrite({ json: '{"version":1,"timings":{"__proto__":{"holdMs":1}}}' }, FILE).status).toBe(400);
    expect(ok({ 'source:bogus': { holdMs: 1 } }).status).toBe(400);
    expect(ok({ 'trigger:endOfTurn': { nope: 1 } }).status).toBe(400);
  });

  it('rejects non-finite / negative timing values', () => {
    expect(ok({ 'trigger:endOfTurn': { holdMs: -5 } }).status).toBe(400);
    expect(ok({ 'trigger:endOfTurn': { holdMs: Number.POSITIVE_INFINITY } }).status).toBe(400);
    // NaN/Infinity aren't representable in JSON, so pass a raw string body to exercise the guard.
    expect(planBeatDefaultsWrite({ json: '{"version":1,"timings":{"trigger:endOfTurn":{"holdMs":"x"}}}' }, FILE).status).toBe(400);
  });

  it('rejects oversize payloads', () => {
    const huge = { json: JSON.stringify({ version: 1, timings: {} }) + ' '.repeat(MAX_DEFAULTS_BYTES) };
    expect(planBeatDefaultsWrite(huge, FILE).status).toBe(413);
  });
});
