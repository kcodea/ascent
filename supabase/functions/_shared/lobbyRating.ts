/**
 * SERVER-SIDE lobby rating — the authoritative half of ACCOUNTS C3.
 *
 * This is the ONE computation the `submit-rating` Edge Function is allowed to do to a player's rating, and it
 * must match the client's `resolveLobbyRating` (packages/sim/src/playerRating.ts) EXACTLY — the client shows an
 * optimistic number at the end screen, and the server must land on the same one or the two disagree. Parity is
 * pinned at CI time by `packages/ui/src/lobbyRatingParity.test.ts`, which reads THIS file's delta table and
 * asserts it equals the sim's `LOBBY_PLACEMENT_DELTAS`.
 *
 * The server needs ONLY the rating: the Line and high-water marks are a local display concept the client
 * re-derives from the adopted rating, so there is nothing else to compute or store here.
 *
 * Deno module (no npm) — kept dependency-free so it bundles cleanly into the function and can be imported from
 * the repo's Node test without a runtime bridge.
 */

/** Rating change by LOBBY placement (1st → 8th). MUST equal `LOBBY_PLACEMENT_DELTAS` in the sim package. */
export const LOBBY_PLACEMENT_DELTAS: readonly number[] = [100, 71, 42, 13, -12, -36, -62, -92];

/** The authoritative post-run rating: the stored rating plus the placement delta, floored at 0. Identical by
 *  construction to `resolveLobbyRating(profile, placement).ratingAfter`. */
export function lobbyRatingAfter(ratingBefore: number, placement: number): number {
  const idx = Math.min(Math.max(1, Math.round(placement)), LOBBY_PLACEMENT_DELTAS.length) - 1;
  return Math.max(0, ratingBefore + LOBBY_PLACEMENT_DELTAS[idx]!);
}
