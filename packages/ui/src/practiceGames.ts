import { DEFAULT_PRACTICE_CONFIG, normalizeBotDifficulty, runRecord, type BoardSnapshot, type RunState } from '@game/sim';
import type { PracticeGameUpload } from './remoteBoards';

/**
 * PRACTICE GAMES (owner ask 2026-09-24: a Practice tab on Recent Games) — the pure half of the practice-game
 * upload: one finished practice run → the light row `uploadPracticeGame` writes to `practice_games`. Kept out of
 * `store.ts` so it is testable without the store; the store only calls it at the run-end seam.
 *
 * PLACEMENT is the one the practice end screen shows (`LobbyEndScreen`: the seat's stamped placement, else the
 * number of seats still standing), so the Practice tab and the screen the player saw agree. A practice game on
 * unlimited Health that reaches the round-15 curtain is never eliminated, so it reads as the standing count.
 */
export function practiceGameOf(run: RunState, opts: {
  author: string | null;
  patch: string;
  finalBoard: BoardSnapshot | null;
  frames: ReadonlyArray<{ tMs: number }>;
}): PracticeGameUpload {
  const seat = run.lobby?.seats.find((x) => x.id === 's0');
  const placement = run.lobby ? seat?.placement ?? run.lobby.seats.filter((x) => x.alive).length : null;
  const record = runRecord(run);
  const first = opts.frames[0]?.tMs;
  const last = opts.frames[opts.frames.length - 1]?.tMs;
  const cfg = run.practiceConfig ?? DEFAULT_PRACTICE_CONFIG;
  return {
    author: opts.author,
    patch: opts.patch,
    heroId: run.heroId,
    placement: typeof placement === 'number' && placement > 0 ? placement : null,
    wins: record.wins,
    record,
    wave: run.wave,
    finalBoard: opts.finalBoard,
    runes: opts.finalBoard?.runes ?? [],
    durationMs: typeof first === 'number' && typeof last === 'number' && last >= first ? last - first : null,
    config: { opponents: cfg.opponents, botDifficulty: normalizeBotDifficulty(cfg.botDifficulty), health: cfg.health },
  };
}
