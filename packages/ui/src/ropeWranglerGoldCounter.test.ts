import { describe, expect, it } from 'vitest';
import { stepProgress } from './cardText';

/** Rope Wrangler's Gold-spent readout (owner ask 2026-10-13: "needs a gold spent counter under him in recruit phase"). */
describe('Rope Wrangler Gold-spent counter', () => {
  it('reads the turn\'s Gold spent toward the next Lasso repeat, N/10 Gold, cyclic', () => {
    expect(stepProgress('ropewrangler', { goldSpentTurn: 0 })).toEqual({ current: 0, total: 10, label: '0/10 Gold' });
    expect(stepProgress('ropewrangler', { goldSpentTurn: 4 })).toEqual({ current: 4, total: 10, label: '4/10 Gold' });
    expect(stepProgress('ropewrangler', { goldSpentTurn: 10 })).toEqual({ current: 10, total: 10, label: '10/10 Gold' });
    expect(stepProgress('ropewrangler', { goldSpentTurn: 13 })).toEqual({ current: 3, total: 10, label: '3/10 Gold' });
  });
  it('shows nothing in combat (no Gold is spent mid-fight; combat passes no goldSpentTurn)', () => {
    expect(stepProgress('ropewrangler', {})).toBeNull();
  });
});
