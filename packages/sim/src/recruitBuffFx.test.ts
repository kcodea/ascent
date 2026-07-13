import { describe, it, expect } from 'vitest';
import { createRun } from './state';

describe('recruitBuffFx run-state fields', () => {
  it('initialise empty on a fresh run', () => {
    const s = createRun(12345);
    expect(s.recruitBuffFx).toEqual([]);
    expect(s.recruitFxSeq).toBe(0);
  });
});
