import { describe, expect, it } from 'vitest';
import { isCompletedRow } from './perfCloud';

/**
 * The shared tab shows COMPLETED games only (owner ask 2026-08-30). New abandoned games are no longer
 * uploaded at all — `Game.tsx` publishes on the gameover/victory transition and nowhere else — so this rule
 * exists for the rows the old tab-hide fallback already wrote, which cannot be un-uploaded.
 */
describe('the shared perf tab lists completed games only', () => {
  it('hides a row the tab-hide fallback stamped', () => {
    expect(isCompletedRow('abandoned')).toBe(false);
  });

  it('keeps the notes a finished game writes', () => {
    expect(isCompletedRow('game won')).toBe(true);
    expect(isCompletedRow('game lost')).toBe(true);
  });

  it('keeps a row with no note at all', () => {
    expect(isCompletedRow(null)).toBe(true);
    expect(isCompletedRow(undefined)).toBe(true);
  });

  it('matches EXACTLY, so a hand-written note is never swallowed', () => {
    // The manual Share button takes free text. Someone profiling why a run felt bad after they quit it will
    // write exactly this sort of thing, and it must survive — the auto-note is the literal string, nothing else.
    expect(isCompletedRow('abandoned the run at wave 6 to test the shop')).toBe(true);
    expect(isCompletedRow('Abandoned')).toBe(true);
  });
});
