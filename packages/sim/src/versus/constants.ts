/**
 * VERSUS — the mode's fixed numbers (owner rulings 2026-10-13). Dependency-free: the Edge Function bundle, the
 * SQL migration and the client all read the same values (the SQL copies are named next to each constant, and
 * `versusConstants.test.ts` pins them against the migration text).
 */

/** Hearts each player starts with. A lost round strikes one; 0 hearts loses the match (owner ruling 1). */
export const VERSUS_HEARTS = 7;
/** Hero Select length in seconds. An unchosen seat gets a deterministic random pick from its three (ruling 2). */
export const VERSUS_HERO_SELECT_SECONDS = 20;
/** Heroes offered to each seat. Offers are hidden and may repeat across seats (ruling 3). */
export const VERSUS_HERO_OFFER_SIZE = 3;
/** Sealed-gate window in seconds: both gate gems must be pressed in time or the room returns to Open (ruling 5). */
export const VERSUS_GATE_SECONDS = 30;
/** Pause grace in seconds after a player disconnects; past it, the opponent may unpause (ruling 6). */
export const VERSUS_PAUSE_GRACE_SECONDS = 30;
/** Consecutive rounds an absent player may miss (their last locked board auto-plays) before forfeiting (ruling 6). */
export const VERSUS_MISSED_ROUNDS_FORFEIT = 3;
/** Spectator capacity per room. Every room is watchable; the host cannot turn it off (ruling 8). */
export const VERSUS_SPECTATOR_CAP = 20;
/** Round 1's clock starts when both players' game start (Hero Select ceremony + Good Luck) has played out; past this
 *  many seconds after the heroes are revealed it starts anyway, so a stuck client cannot stall the match. */
export const VERSUS_INTRO_CAP_SECONDS = 45;
/** Cap on how long the combat-ready barrier waits for a slow or absent player, in seconds (blueprint 1.5). */
export const VERSUS_COMBAT_VIEW_CAP_SECONDS = 90;
/** Seconds without a heartbeat before a seat counts as disconnected (the lease). */
export const VERSUS_LEASE_SECONDS = 12;

/**
 * The wire protocol version. Bump it when a payload shape changes so an older client or an older deployed
 * resolver refuses the other side instead of mis-reading it (the function answers 409 `protocol_mismatch`).
 */
export const VERSUS_PROTOCOL = 1;

/** Byte caps on JSON accepted into rows / the resolver (blueprint 14). Generous: a full prepared side is ~20-60 KB. */
export const VERSUS_LIMITS = {
  preparedSideBytes: 256 * 1024,
  spectatorFrameBytes: 192 * 1024,
  resolveBodyBytes: 600 * 1024,
} as const;

/** Players in a match. */
export type VersusSeat = 'p1' | 'p2';
export const VERSUS_SEATS: readonly VersusSeat[] = ['p1', 'p2'];
export const otherSeat = (s: VersusSeat): VersusSeat => (s === 'p1' ? 'p2' : 'p1');
