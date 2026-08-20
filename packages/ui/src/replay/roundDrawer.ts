/**
 * REPLAY VIEWER metrics drawer — the DATA layer (§7.4 of docs/replay-v2-handoff.md, owner ruling
 * 2026-08-19). The drawer shows exactly THREE numbers per round — Gold spent / Actions / Shop tier at
 * start — every one a line of the `rollupRounds` fold over the recorded frames (it cannot drift from the
 * replay being watched, and it works retroactively on any v2 recording). No charts, no metric dropdown,
 * no extra metrics: three numbers is the shipped set.
 *
 * This module is pure (no React, no store) so the wiring is testable headlessly, the same way the
 * playback core's pure parts are.
 */
import type { RoundStat } from '@game/sim';

/** What the drawer prints for one round. `tierAtStart: null` means the round recorded NO shop frames at
 *  all (e.g. a partial recording's final wave that captured the combat but never a shop opening) — the
 *  tier is then genuinely unknown and renders as an em-dash, while Gold spent / Actions are truthfully 0
 *  (no shop frames ⇒ no recorded shopping). */
export interface DrawerStat {
  wave: number;
  goldSpent: number;
  actions: number;
  tierAtStart: number | null;
}

/** Index the once-per-replay rollup by wave for O(1) row lookups. Waves need NOT start at 1 or be
 *  contiguous (a `partial: true` recording begins wherever capture was turned on). */
export function statsByWave(stats: readonly RoundStat[]): Map<number, RoundStat> {
  const byWave = new Map<number, RoundStat>();
  for (const st of stats) byWave.set(st.wave, st);
  return byWave;
}

/** The three §7.4 numbers for one round, with the missing-wave fallback described on `DrawerStat`. */
export function drawerStatFor(wave: number, byWave: ReadonlyMap<number, RoundStat>): DrawerStat {
  const st = byWave.get(wave);
  if (!st) return { wave, goldSpent: 0, actions: 0, tierAtStart: null };
  return { wave, goldSpent: st.goldSpent, actions: st.actions, tierAtStart: st.tierAtStart };
}
