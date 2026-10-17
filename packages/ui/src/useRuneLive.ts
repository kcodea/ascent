import { useMemo } from 'react';
import { runeLiveStateInCombat, runeLiveStateOfRun, runeLiveStateOfSnapshot, type BoardSnapshot, type RuneLiveState } from '@game/sim';
import { useGame } from './store';

/**
 * The live state behind a self-improving rune's text (R-RUNE-LIVE-TEXT-01), for the two sides a screen can show.
 *
 * PLAYER: the run's banked value, advanced during a replay by what has been shown so far. `combatPlayerRuneProgress`
 * clears the moment combat SETTLES, and settle is exactly when the fight's growth is written
 * back to the run (`runeWildHuntGrown`, `packcraftLevel`, `beastialSwarmLevel`), so the number never double counts.
 * A spectated seat is the same run in the store, so spectators read it through this hook too.
 */
export function usePlayerRuneLive(): RuneLiveState {
  const run = useGame((s) => s.run);
  const prog = useGame((s) => s.combatPlayerRuneProgress);
  return useMemo(() => {
    if (!run) return {}; // a bare mount (Compendium preview, a test) has no run: the printed text
    return runeLiveStateInCombat(runeLiveStateOfRun(run), prog);
  }, [run, prog]);
}

/** FOE: its captured snapshot, advanced by its own triggers replayed so far (`combatEnemyRuneProgress`). */
export function useEnemyRuneLive(snap: BoardSnapshot | null | undefined): RuneLiveState {
  const prog = useGame((s) => s.combatEnemyRuneProgress);
  return useMemo(() => runeLiveStateInCombat(runeLiveStateOfSnapshot(snap), prog), [snap, prog]);
}
