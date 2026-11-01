/**
 * VERSUS — the mode's fixed numbers (owner rulings 2026-10-13). Dependency-free: the Edge Function bundle, the
 * SQL migration and the client all read the same values (the SQL copies are named next to each constant, and
 * `versusConstants.test.ts` pins them against the migration text).
 */
import type { VersusMode } from './options';

/** (Hearts are gone since 2026-10-26: each player plays on their hero's Health and Armor, the lobby's damage and cap.
 *  R-VERSUS-HEALTH-01, `vitals.ts`. Old matches keep their `*_hearts` columns for the record.) */
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
 * MORE TIME IN VERSUS (owner 2026-10-30, R-VERSUS-TURN-TIME-01): "let's do a 15% increase in versus/group and a 30%
 * increase for duos". Each mode's shop clock is the lobby's standard schedule times this percent (Duos: 130 INSTEAD of
 * 115, not on top). Whole percents so the scaling is exact integer math (a float 1.15 would round 30 s to 34, not 35).
 */
export const VERSUS_TURN_PERCENT: Readonly<Record<VersusMode, number>> = { duel: 115, group: 115, duos: 130, ranked_duos: 130 };

/**
 * LONGER TURNS 6 AND 9 IN LIVE MODES (owner 2026-11-01, R-VERSUS-TURN-TIME-02): "Add 25 seconds to turn 6 and 9 in
 * all live modes, aka all but ranked solos". Flat seconds added AFTER the mode's percent, in every Versus mode (1v1,
 * Group, Duos, Ranked Duos). The ranked solo lobby, Practice and the solo modes never read this.
 */
export const LIVE_SHOP_BONUS_SECONDS: Readonly<Record<number, number>> = { 6: 25, 9: 25 };

/**
 * A Versus round's shop length in whole seconds: the ONE source the Worker's deadlines (`roomCore` 1v1,
 * `groupMatch` group / Duos / Ranked Duos) and the client's pre-deadline face read. The base is the lobby schedule
 * (`standardTurnSeconds` in packages/ui/src/turnClock.ts, pinned equal by `versusTurnSeconds.test.ts`): +4 s a round
 * from 18 s, +6 s from round 6, capped at 80 s, +12 s from round 12, floored at 21 s. Then the mode's percent,
 * rounded half up to whole seconds, then the live bonus (`LIVE_SHOP_BONUS_SECONDS`: +25 s on rounds 6 and 9).
 * An unknown mode reads as the 1v1.
 */
export function versusTurnSeconds(round: number, mode: unknown): number {
  const base = Math.max(21, Math.min(80, 18 + (round - 1) * 4 + (round >= 6 ? 6 : 0)) + (round >= 12 ? 12 : 0));
  const pct = typeof mode === 'string' && Object.prototype.hasOwnProperty.call(VERSUS_TURN_PERCENT, mode)
    ? VERSUS_TURN_PERCENT[mode as VersusMode] : VERSUS_TURN_PERCENT.duel;
  const bonus = Object.prototype.hasOwnProperty.call(LIVE_SHOP_BONUS_SECONDS, round) ? LIVE_SHOP_BONUS_SECONDS[round]! : 0;
  return Math.floor((base * pct + 50) / 100) + bonus;
}

/**
 * The wire protocol version. Bump it when a payload shape changes so an older client or an older deployed
 * resolver refuses the other side instead of mis-reading it (the function answers 409 `protocol_mismatch`).
 */
export const VERSUS_PROTOCOL = 2; // 2 (2026-10-26): Health + Armor (sides report `vitals`, results carry `versusVitals`)

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
