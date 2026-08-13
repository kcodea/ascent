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
    // CHOREOGRAPHER PR 10: version 2 is now a VALID authored format (templates + overrides + modes), so the
    // unsupported-version case moves to a version that really is unknown.
    expect(planBeatDefaultsWrite({ json: JSON.stringify({ version: 3, timings: {} }) }, FILE).status).toBe(400);
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

describe('planBeatDefaultsWrite — v2 authored config (CHOREOGRAPHER PR 10)', () => {
  const FILE2 = '/tmp/beat-defaults.json';
  const write = (obj: unknown) => planBeatDefaultsWrite({ json: JSON.stringify(obj) }, FILE2);

  it('accepts templates + overrides + modes', () => {
    const plan = write({
      version: 2,
      templates: { 'family:endOfTurn': { deliveryOffsetMs: 160, completionOffsetMs: 520, recoveryMs: 140 } },
      overrides: { 'source:rune:rune_lapidary:endOfTurn': { completionOffsetMs: 660 } },
      policies: { 'source:hero:repete:secondHand': 'ownBeat' },
    });
    expect(plan.status).toBe(200);
    expect(plan.data).toContain('"version": 2');
  });

  it('accepts a semantic anchor with an offset', () => {
    expect(write({ version: 2, overrides: { global: { anchor: { kind: 'atParentDelivery', offsetMs: 40 } } } }).status).toBe(200);
  });

  it('rejects an unknown anchor kind rather than writing a value nothing can resolve', () => {
    expect(write({ version: 2, overrides: { global: { anchor: { kind: 'whenever' } } } }).status).toBe(400);
  });

  it('rejects an unknown authored field (a typo would silently do nothing forever)', () => {
    expect(write({ version: 2, overrides: { global: { holdMs: 400 } } }).status).toBe(400);
  });

  it('rejects completion before delivery — the one ordering invariant', () => {
    const plan = write({ version: 2, overrides: { global: { deliveryOffsetMs: 500, completionOffsetMs: 100 } } });
    expect(plan.status).toBe(400);
    expect(plan.error).toContain('before delivery');
  });

  it('rejects a negative timing', () => {
    expect(write({ version: 2, overrides: { global: { recoveryMs: -1 } } }).status).toBe(400);
  });

  it('rejects a prototype-pollution key', () => {
    // Written as RAW JSON on purpose: in a JS object literal `__proto__` sets the prototype rather than
    // creating a key, so the literal form silently tests nothing at all.
    const raw = '{"version":2,"overrides":{"__proto__":{"recoveryMs":1}}}';
    expect(planBeatDefaultsWrite({ json: raw }, FILE2).status).toBe(400);
  });

  it('rejects an unknown mode', () => {
    expect(write({ version: 2, policies: { global: 'loud' } }).status).toBe(400);
  });
});
