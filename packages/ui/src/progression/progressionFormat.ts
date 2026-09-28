import type { ProgressionResult } from '@game/progression';

/**
 * Player-facing text for the Account XP surfaces. Plain short phrases, no em dashes (owner writing style
 * 2026-09-21).
 */

export const xpText = (xp: number): string => `+${xp} XP`;

export interface BreakdownLine { key: 'base' | 'topFour' | 'firstPlace' | 'comeback'; label: string; xp: number }

/** The breakdown rows for a settled result, in reading order, zero rows left out. */
export function breakdownLines(r: Pick<ProgressionResult, 'mode' | 'xp' | 'placement'>): BreakdownLine[] {
  const base = r.mode === 'tutorial' ? 'Tutorial complete'
    : r.mode === 'practice' ? (r.placement === null ? 'Practice complete' : 'Practice game complete')
    : 'Game complete';
  const lines: BreakdownLine[] = [{ key: 'base', label: base, xp: r.xp.base }];
  if (r.xp.topFour > 0) lines.push({ key: 'topFour', label: 'Top 4', xp: r.xp.topFour });
  if (r.xp.firstPlace > 0) lines.push({ key: 'firstPlace', label: 'First place', xp: r.xp.firstPlace });
  if (r.xp.comeback > 0) lines.push({ key: 'comeback', label: 'Comeback', xp: r.xp.comeback });
  return lines;
}
