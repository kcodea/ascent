/**
 * The seat recordings of a run, for the game session's table pin (R-SESSION-CF-01). A leaf module: the store (which owns
 * the bundle, `seatRecordingsFor`) registers the provider; `gameSession.ts` reads it. Kept apart so the store never
 * imports the session's lifecycle (an import cycle through the live publisher).
 */
import type { BoardSnapshot, LobbySeatRecordings, RunState } from '@game/sim';

export type SeatBundle = { runs: BoardSnapshot[][]; hybrids: LobbySeatRecordings['hybrids'] };
let provider: (run: RunState) => SeatBundle | undefined = () => undefined;
export function setSessionSeatProvider(fn: (run: RunState) => SeatBundle | undefined): void { provider = fn; }
export const sessionSeatsOf = (run: RunState): SeatBundle | undefined => provider(run);
