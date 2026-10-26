/**
 * THE PER-PLAYER SEAT CAP (owner 2026-09-29: "let's have a cap of 4 snapshots from a player i guess, so it's not
 * literally like 7 of me always or something"). Selection stays a uniform shuffle over every whole run; a run
 * whose player already holds this many seats is passed over for the next one in the shuffle (R-LOBBY-08).
 *
 * Its own module (2026-10-26) so `strengthBands` (and the Versus server bundle that seats Ranked Duos tables with it)
 * does not import `snapshotSeats`, which pulls the whole bundled opponent pool. `snapshotSeats` re-exports it.
 */
export const MAX_SEATS_PER_PLAYER = 4;
