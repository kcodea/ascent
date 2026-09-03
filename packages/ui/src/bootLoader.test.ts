import { describe, it, expect } from 'vitest';
import { STAGE_WEIGHTS, bootProgress, runBootLoader, type StageRunner } from './bootLoader';

describe('bootProgress', () => {
  it('weights sum to 1', () => {
    const sum = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('is the weighted mean of the stage fractions, missing stages counting as 0', () => {
    expect(bootProgress({})).toBe(0);
    expect(bootProgress({ images: 1, fonts: 1, audio: 1, fx: 1 })).toBe(1);
    expect(bootProgress({ images: 1 })).toBeCloseTo(STAGE_WEIGHTS.images, 6);
    expect(bootProgress({ images: 0.5, audio: 0.5 })).toBeCloseTo(0.5 * (STAGE_WEIGHTS.images + STAGE_WEIGHTS.audio), 6);
  });

  it('clamps out-of-range fractions', () => {
    expect(bootProgress({ images: 4, fonts: -2, audio: 1, fx: 1 })).toBeCloseTo(STAGE_WEIGHTS.images + STAGE_WEIGHTS.audio + STAGE_WEIGHTS.fx, 6);
  });
});

describe('runBootLoader', () => {
  const instant: StageRunner = async (p) => { p(1, 1); };
  const stepped = (n: number): StageRunner => async (p) => { for (let i = 1; i <= n; i++) { await Promise.resolve(); p(i, n); } };

  it('runs every stage immediately (no gesture needed) and reports full progress', async () => {
    const started = new Set<string>();
    const seen: number[] = [];
    const mk = (name: string): StageRunner => async (p) => { started.add(name); p(1, 1); };
    const report = await runBootLoader({
      onProgress: (p) => seen.push(p),
      runners: { images: mk('images'), fonts: mk('fonts'), fx: mk('fx'), audio: mk('audio') },
    });
    expect([...started].sort()).toEqual(['audio', 'fonts', 'fx', 'images']);
    expect(seen[seen.length - 1]).toBe(1);
    expect(report.stages.audio.ok).toBe(true);
  });

  it('reports monotonic progress ending at 1, and a failed stage as ok:false without blocking', async () => {
    const seen: number[] = [];
    const report = await runBootLoader({
      onProgress: (p) => seen.push(p),
      runners: { images: stepped(4), fonts: stepped(2), audio: instant, fx: async () => { throw new Error('no webgl'); } },
    });
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
    expect(report.stages.fx.ok).toBe(false);
    expect(report.stages.images.ok).toBe(true);
    expect(report.ms).toBeGreaterThanOrEqual(0);
  });
});
