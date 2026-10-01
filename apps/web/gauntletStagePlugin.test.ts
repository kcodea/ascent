/**
 * GAUNTLET STAGE endpoint — the pure plans (`planStageSave` / `planStageRead`), the entire validation surface of
 * the dev-only /__gauntlet/stage middleware. The filesystem contract under test: the filename derives ONLY from
 * an integer stage number 1–10 matched against the files that already exist (never from a client path), and
 * oversized payloads are refused.
 */
import { describe, expect, it } from 'vitest';
import { MAX_STAGE_BYTES, planStageRead, planStageSave } from './gauntletStagePlugin';

const FILES = ['01-demons.json', '02-kobolds.json', '03-dragons.json', '04-dwarves.json', '05-beasts.json', 'notes.txt'];
const stage = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ number: 1, name: 'Demons', rounds: [], ...over });

describe('planStageSave', () => {
  it('maps the stage number onto its existing file and pretty-prints with a trailing newline', () => {
    const plan = planStageSave({ stage: stage() }, FILES);
    expect(plan).toMatchObject({ fileName: '01-demons.json' });
    const text = (plan as { text: string }).text;
    expect(text).toBe(`${JSON.stringify(stage(), null, 2)}\n`);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('refuses bad stage numbers', () => {
    for (const number of [0, 11, 1.5, '1', null, undefined]) {
      expect(planStageSave({ stage: stage({ number }) }, FILES)).toHaveProperty('error');
    }
  });

  it('refuses a stage number with no file yet', () => {
    const plan = planStageSave({ stage: stage({ number: 7 }) }, FILES);
    expect((plan as { error: string }).error).toContain('stage 7 has no file yet');
  });

  it('refuses non-object bodies, non-object stages and non-array rounds', () => {
    for (const body of [null, 'x', [], {}, { stage: null }, { stage: 'x' }, { stage: [] }, { stage: stage({ rounds: 'no' }) }]) {
      expect(planStageSave(body, FILES)).toHaveProperty('error');
    }
  });

  it('refuses oversized payloads', () => {
    const big = planStageSave({ stage: stage({ name: 'x'.repeat(MAX_STAGE_BYTES) }) }, FILES);
    expect((big as { error: string }).error).toContain('too large');
  });
});

describe('planStageRead', () => {
  it('maps "3" to 03-dragons.json', () => {
    expect(planStageRead('3', FILES)).toEqual({ fileName: '03-dragons.json' });
  });

  it('refuses missing, non-integer and out-of-range numbers', () => {
    for (const n of [null, '', 'abc', '0', '11', '1.5', '../1']) {
      expect(planStageRead(n, FILES)).toHaveProperty('error');
    }
  });

  it('refuses a number with no file', () => {
    expect((planStageRead('7', FILES) as { error: string }).error).toContain('stage 7 has no file yet');
  });
});
