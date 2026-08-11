import { createRun, createLobbyRun, reduce, type Replay, type Action, type RunState } from '@game/sim';
import { useGame } from './store';

/**
 * REPLAY DRIVER (Phase 1b) — play a recorded run back through the LIVE game UI.
 *
 * It reconstructs the opening state from the replay header, then re-applies the logged actions via `reduce`
 * DIRECTLY (never the live `dispatch`, which is swallowed while `replaying` — see the store) so no uploads /
 * saves / rating fire and nothing fights the driver. Shop actions are paced by the player's REAL recorded
 * cadence (`timings[i]`) × the speed; combats are paced by the arena's own animation — the driver waits for
 * `combatReplayDone` (bridged from `useCombatReplay`) before leaving a fight.
 *
 * Dev-triggerable today (`window.playReplay(exportReplay())`); the polished play/pause/scrub viewer wraps this.
 */

let token = 0; // bumped to abort any in-flight replay (a new play, or stopReplay)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Rebuild the run's opening state from the replay header, seeding the exact opponents fought so the fights
 *  animate faithfully (a cross-session replay can't re-derive pool-sourced seats). */
function reconstruct(replay: Replay): RunState {
  const run = replay.mode && replay.mode !== 'lobby'
    ? createRun(replay.seed, replay.heroId, replay.mode)
    : createLobbyRun(replay.seed, replay.heroId);
  if (replay.servedBoards) run.servedBoards = { ...replay.servedBoards };
  return run;
}

export async function playReplay(replay: Replay, opts: { speed?: number } = {}): Promise<void> {
  const mine = ++token;
  const speed = Math.max(0.25, opts.speed ?? 1);
  const g = useGame;
  const aborted = (): boolean => token !== mine;

  g.setState({ run: reconstruct(replay), replaying: true, combatReplayDone: false, showTitle: false, inspect: null, heroChoices: null });

  for (let i = 0; i < replay.actions.length && !aborted(); i++) {
    const a: Action = replay.actions[i]!;
    if (g.getState().run.phase === 'combat') {
      // Leaving/settling a fight: hold until its animation has played out, then a short beat so the result reads.
      while (!aborted() && g.getState().run.phase === 'combat' && !g.getState().combatReplayDone) await sleep(30);
      await sleep(500 / speed);
    } else {
      // Shop cadence — the player's real gap before this action, clamped so an idle stretch can't stall playback.
      await sleep(Math.min(replay.timings?.[i] ?? 300, 5000) / speed);
    }
    if (aborted()) break;
    const next = reduce(g.getState().run, a);
    // A new fight resets the arena's done-flag immediately (before the bridge re-fires), so the next combat
    // gate above doesn't see a stale `true` from the previous one.
    g.setState({ run: next, combatReplayDone: a.type === 'faceOmen' ? false : g.getState().combatReplayDone });
  }
  if (!aborted()) g.setState({ replaying: false });
}

/** Stop any in-flight replay and drop out of replay mode. */
export function stopReplay(): void {
  token++;
  useGame.setState({ replaying: false });
}

// DEV console handle: `playReplay(useGame.getState().exportReplay())` to watch a run back, `stopReplay()` to
// bail. Stripped from production. The polished play/pause/scrub viewer (Phase 1c) is the real entry point.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { playReplay: typeof playReplay; stopReplay: typeof stopReplay }).playReplay = playReplay;
  (window as unknown as { playReplay: typeof playReplay; stopReplay: typeof stopReplay }).stopReplay = stopReplay;
}
