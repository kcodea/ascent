import type { MatchDetails, MatchSeat } from '@game/sim';

/**
 * MATCH DETAILS (owner ask 2026-09-28): the words the scoreboard prints. Pure, so the tests pin them. Every string
 * a player reads here follows the house writing rule: short plain sentences, no em dash.
 */

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th. */
export function ordinalOf(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Nobody else standing and you on 1st: a real win (not Practice's curtain with the table still full). */
export function youWon(d: Pick<MatchDetails, 'eliminated' | 'placement' | 'seats'>): boolean {
  return !d.eliminated && d.placement === 1 && d.seats.every((s) => s.self || s.placement !== undefined);
}

/** The placement badge: the ordinal, or "Top N" for a seat still standing when you were knocked out. */
export function placeLabel(seat: Pick<MatchSeat, 'placement' | 'self'>, d: Pick<MatchDetails, 'eliminated' | 'placement'>): string {
  if (seat.placement !== undefined) return ordinalOf(seat.placement);
  if (d.eliminated && d.placement > 1) return `Top ${d.placement - 1}`;
  return '';
}

/** How the seat stood at the recorded moment: "Winner", "Out in round 7" or "Still in". */
export function statusText(seat: MatchSeat, d: MatchDetails): string {
  if (seat.self) {
    if (d.eliminated) return `Out in round ${seat.eliminatedRound ?? d.endRound}`;
    return youWon(d) ? 'Winner' : 'Still in';
  }
  if (seat.placement === 1) return 'Winner';
  if (seat.eliminatedRound !== undefined) return `Out in round ${seat.eliminatedRound}`;
  return 'Still in';
}

/** Which moment the shown board is from, in words ("Their board when you were knocked out, round 11"). */
export function boardCaption(seat: MatchSeat, d: MatchDetails): string {
  const round = seat.board?.round || d.endRound;
  if (seat.self) {
    if (d.eliminated) return `Your board when you were knocked out, round ${round}`;
    return youWon(d) ? `Your board when you won, round ${round}` : `Your board when the game ended, round ${round}`;
  }
  const out = seat.eliminatedRound;
  if (out !== undefined && d.eliminated && out === d.endRound) return `Their board when you were both knocked out, round ${round}`;
  if (out !== undefined) return `Their board when they were knocked out, round ${round}`;
  if (d.eliminated) return `Their board when you were knocked out, round ${round}`;
  return youWon(d) ? `Their board when you won, round ${round}` : `Their board when the game ended, round ${round}`;
}

/** The line under the scoreboard's title: "You placed 6th. Round 11." */
export function summaryText(d: MatchDetails): string {
  if (d.placement <= 0) return `Round ${d.endRound}.`;
  return youWon(d) ? `You won in round ${d.endRound}.` : `You placed ${ordinalOf(d.placement)}. Round ${d.endRound}.`;
}

/** The label a RUN's strength (R-LOBBY-09) is shown under, wherever the player sees it: Career, Recent Games and
 *  Match details (owner 2026-09-30: "game strength for the display"). Per-round numbers stay BOARD percentiles. */
export const GAME_STRENGTH_LABEL = 'Game strength';
/** Its hover bubble (the game's `.gtip` data-tip, never a native tooltip). The round-weighted number again since
 *  2026-10-06 (R-LOBBY-12; the final board's from 2026-10-03 to 2026-10-06). */
export const GAME_STRENGTH_TIP = "How strong your board was across the whole game, compared with everyone else's. Later rounds count more.";

/** RELEVANT STRENGTH (R-RESULTS-STRENGTH-WINDOW-01, owner 2026-11-20: "lets call it Relevant Strength and Run Strength"):
 *  how strong a seat was across the rounds YOU played it. The headline number, shown first and larger. */
export const RELEVANT_STRENGTH_LABEL = 'Relevant Strength';
export const RELEVANT_STRENGTH_TIP = "How strong this board was across the rounds you played against it, compared with everyone else's. Later rounds count more.";
/** RUN STRENGTH: the whole-run number (the old "Game strength"), shown second and smaller. */
export const RUN_STRENGTH_LABEL = 'Run Strength';
export const RUN_STRENGTH_TIP = "How strong this player's whole run was, compared with every other run.";

/** The two numbers a seat shows. Relevant only when the record is a NEW one (`strengthWindow`) AND the seat has a
 *  `windowStrength` (a new record's unscored seat shows none, never Run Strength in its place); Run is the seat's
 *  whole-run `strength`. Either is null when absent. */
export function seatStrengthParts(
  seat: Pick<MatchSeat, 'strength' | 'windowStrength'>,
  record: Pick<MatchDetails, 'strengthWindow'>,
): { relevant: number | null; run: number | null } {
  return {
    relevant: record.strengthWindow && typeof seat.windowStrength === 'number' ? seat.windowStrength : null,
    run: typeof seat.strength === 'number' ? seat.strength : null,
  };
}

/** "Relevant Strength 90 · Run Strength 40" (either part dropped when null), or null when neither exists. */
export function strengthLabel(seat: Pick<MatchSeat, 'strength' | 'windowStrength'>, record: Pick<MatchDetails, 'strengthWindow'>, sep = ' · '): string | null {
  const { relevant, run } = seatStrengthParts(seat, record);
  const bits = [relevant !== null ? `${RELEVANT_STRENGTH_LABEL} ${relevant}` : '', run !== null ? `${RUN_STRENGTH_LABEL} ${run}` : ''].filter(Boolean);
  return bits.length ? bits.join(sep) : null;
}

/** The game page's header facts: the record's own seat's Relevant Strength, then the run's Run Strength. */
export function headerStrengthFacts(
  record: MatchDetails | null | undefined,
  runStrength: number | null | undefined,
): { label: string; value: number; tip: string }[] {
  const self = record?.seats.find((s) => s.self);
  const relevant = record && self ? seatStrengthParts(self, record).relevant : null;
  return [
    ...(relevant !== null ? [{ label: RELEVANT_STRENGTH_LABEL, value: relevant, tip: RELEVANT_STRENGTH_TIP }] : []),
    ...(runStrength != null ? [{ label: RUN_STRENGTH_LABEL, value: runStrength, tip: RUN_STRENGTH_TIP }] : []),
  ];
}

/** Shown where a stored match has no details (recorded before this feature, or never uploaded). */
export const NO_DETAILS_TEXT = 'Details weren’t recorded for this match.';

/** The seat the scoreboard opens on: whoever knocked you out, else the highest-placed OTHER seat (your own board
 *  is already on the screen beside it), else the top row. */
export function defaultSeatId(d: MatchDetails): string {
  if (d.knockedOutBy && d.seats.some((s) => s.id === d.knockedOutBy)) return d.knockedOutBy;
  return (d.seats.find((s) => !s.self) ?? d.seats[0])?.id ?? '';
}
