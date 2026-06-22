/**
 * Persisted board library — the player's own finished-run boards, saved to localStorage and loaded back
 * into the opponent pool at startup, so future runs face boards you actually built (the groundwork for
 * async PvP, which swaps localStorage for a shared backend).
 *
 * Replay-safe by construction: boards are loaded ONCE at startup (a static pool for the session, the way
 * `OPPONENT_POOL` requires) and only *written* when a run ends — never mutated mid-run. Capture is
 * deterministic: a finished run is `{ seed, heroId, actions }`, and `replayRun` re-derives its per-wave
 * boards byte-identically, so we store the replay's snapshots rather than capturing live.
 */
import { replayRun, type BoardSnapshot, type Replay } from '@game/sim';

const KEY = 'ascent.boards';
const CAP = 300; // keep the most recent N captured boards (≈ 15–30 runs); FIFO so the pool stays fresh

/** Load the player's persisted boards. Best-effort: returns [] on any missing/parse/shape problem. */
export function loadStoredBoards(): BoardSnapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Drop anything that isn't a current-schema snapshot (migration = bump BoardSnapshot.v + drop here).
    return (arr as BoardSnapshot[]).filter((s) => s && s.v === 1 && Array.isArray(s.minions));
  } catch {
    return [];
  }
}

/** Capture a finished run's per-wave boards (deterministically, via `replayRun`) and append them to the
 *  stored library, capped to the most recent CAP. Best-effort — board capture never blocks the game. */
export function saveRunBoards(replay: Replay): void {
  try {
    // Only keep boards with minions — an empty board (power 0) is never a useful opponent.
    const fresh = replayRun(replay).snapshots.filter((s) => s.minions.length > 0);
    if (fresh.length === 0) return;
    const all = [...loadStoredBoards(), ...fresh].slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore — capture is best-effort, never fatal */
  }
}
