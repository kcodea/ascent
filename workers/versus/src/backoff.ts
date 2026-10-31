/**
 * The persistence retry schedule, on its own so engine-free code (the friends hub's game sessions, `session.ts`) can use
 * it without pulling `persist.ts`, which imports the room engine.
 */

/** Retry schedule: 1 s, 2 s, 4 s ... capped at 60 s. */
export const persistBackoffMs = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
