import { OPPONENT_POOL, type BoardSnapshot, type RunState } from '@game/sim';
import { supabaseClient } from '../remoteBoards';

/**
 * GOD MODE opponent (owner 2026-10-08): "What round should your opponent board be on?" → a random REAL player board
 * from that round, from the run's set and the current game version. Order: Supabase RPC `god_board_sample`
 * (≈4 s timeout) → the boot-downloaded pool → null ("No boards found"). Never an empty board.
 */
export const GOD_ROUNDS: readonly number[] = Array.from({ length: 15 }, (_, i) => i + 1);

export interface GodBoardDeps {
  rpc: ((wave: number, setId: string, patchPrefix: string, signal: AbortSignal) => Promise<BoardSnapshot | null>) | null;
  pool: () => readonly BoardSnapshot[];
  rand: () => number;
  timeoutMs: number;
  patchPrefix: string;
}

/** A board God Mode may serve: the chosen round, the run's set (pre-set boards are Set 1), a real player's (never a
 *  synthetic bot board), and never empty. Applied to the remote answer too, so a bad RPC row can't slip through —
 *  and it never throws on a malformed payload (non-object, missing / non-array `minions`): that just falls back. */
const usable = (b: BoardSnapshot | null | undefined, wave: number, setId: string): b is BoardSnapshot =>
  !!b && typeof b === 'object' && b.wave === wave && (b.setId ?? 'set1') === setId && b.origin !== 'synthetic'
  && Array.isArray(b.minions) && b.minions.length > 0;

async function remote(wave: number, setId: string, deps: GodBoardDeps): Promise<BoardSnapshot | null> {
  if (!deps.rpc) return null;
  const ctl = new AbortController();
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<null>((resolve) => { handle = setTimeout(() => { ctl.abort(); resolve(null); }, deps.timeoutMs); });
  try {
    return await Promise.race([deps.rpc(wave, setId, deps.patchPrefix, ctl.signal), timer]);
  } catch {
    return null;
  } finally {
    clearTimeout(handle);
  }
}

export async function findGodBoard(wave: number, setId: string, deps: GodBoardDeps): Promise<BoardSnapshot | null> {
  const got = await remote(wave, setId, deps);
  if (usable(got, wave, setId)) return got;
  const local = deps.pool().filter((b) => usable(b, wave, setId));
  return local.length ? local[Math.floor(deps.rand() * local.length)]! : null;
}

export function liveGodBoardDeps(): GodBoardDeps {
  const c = supabaseClient();
  return {
    rpc: c
      ? async (wave, setId, patchPrefix, signal) => {
          const res = await c.rpc('god_board_sample', { p_wave: wave, p_set: setId, p_patch_prefix: patchPrefix }).abortSignal(signal);
          return res.error ? null : ((res.data ?? null) as BoardSnapshot | null);
        }
      : null,
    pool: () => OPPONENT_POOL,
    rand: Math.random,
    timeoutMs: 4000,
    patchPrefix: `${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}+`,
  };
}

/** Pin `board` as this round's foe through the sandbox foe path (reducer `rigPinned`: sandbox + sandboxFoeWave). */
export function pinGodFoe(run: RunState, board: BoardSnapshot): RunState {
  return { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: board }, sandboxFoeWave: run.wave };
}
