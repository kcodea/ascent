import { describe, it, expect } from 'vitest';
import { rateFights, gapCalibration, runRecords } from './validate.lib';

describe('validate', () => {
  const pct = (k: string): number | null => ({ s: 90, w: 10, m: 50 } as Record<string, number>)[k] ?? null;
  it('skips generated seats and unknown runs, and counts them', () => {
    const { rated, skipped } = rateFights([
      { round: 5, run_a: 's', run_b: 'w', outcome: 'a' },
      { round: 5, run_a: 'bot:hybrid:nadja', run_b: 'w', outcome: 'a' },
      { round: 5, run_a: 's', run_b: 'gone', outcome: 'b' },
    ], pct);
    expect(rated).toEqual([{ round: 5, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'a' }]);
    expect(skipped).toEqual({ generated: 1, unknown: 1 });
  });
  it('reports how often the stronger board really wins, by percentile gap; a draw is half; equal boards are left out', () => {
    const f = (a: string, b: string, outcome: 'a' | 'b' | 'draw') => ({ round: 5, a, b, pa: pct(a)!, pb: pct(b)!, outcome });
    const rows = gapCalibration([f('s', 'w', 'a'), f('w', 's', 'a'), f('s', 'w', 'draw'), f('m', 'm', 'a'), f('s', 'm', 'a')]);
    expect(rows.find((r) => r.bucket === '80-90')).toEqual({ bucket: '80-90', fights: 3, strongerWinRate: 0.5 });
    expect(rows.find((r) => r.bucket === '40-50')).toEqual({ bucket: '40-50', fights: 1, strongerWinRate: 1 });
    expect(rows.reduce((a, r) => a + r.fights, 0)).toBe(4);
  });
  it('splits a run record into rounds 1-9 and 10-15', () => {
    const rec = runRecords([
      { round: 9, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'a' },
      { round: 10, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'draw' },
      { round: 16, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'a' },
    ]);
    expect(rec.get('s')).toEqual({ early: { fights: 1, points: 1 }, late: { fights: 1, points: 0.5 } });
    expect(rec.get('w')).toEqual({ early: { fights: 1, points: 0 }, late: { fights: 1, points: 0.5 } });
  });
});
