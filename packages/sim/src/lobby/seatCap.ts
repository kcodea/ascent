/**
 * THE PER-PLAYER SEAT CAP (owner 2026-09-29: "let's have a cap of 4 snapshots from a player i guess, so it's not
 * literally like 7 of me always or something"). Selection stays a uniform shuffle over every whole run; a run
 * whose player already holds this many seats is passed over for the next one in the shuffle (R-LOBBY-08).
 *
 * TWO, AND A THIRD ONLY WHEN SHORT (owner 2026-11-16, R-LOBBY-16: "you should also only be able to face 2 of each
 * players snapshots. that includes 2 of yourself", then "have it biased heavily to 2, but go up to 3 if not enough
 * snapshots exist"): a table is seated at `MAX_SEATS_PER_PLAYER` (2) per player; only when it cannot be filled that
 * way does a player get a seat up to `MAX_SEATS_PER_PLAYER_SHORT` (3), inside the same band, before the band widens
 * and before any generated seat. Never a fourth. (It was 4 from 2026-09-29 to 2026-11-16.)
 *
 * Its own module (2026-10-26) so `strengthBands` (and the Versus server bundle that seats Ranked Duos tables with it)
 * does not import `snapshotSeats`, which pulls the whole bundled opponent pool. `snapshotSeats` re-exports it.
 */
export const MAX_SEATS_PER_PLAYER = 2;
/** The most seats one player can hold when two each cannot fill the table. */
export const MAX_SEATS_PER_PLAYER_SHORT = 3;
