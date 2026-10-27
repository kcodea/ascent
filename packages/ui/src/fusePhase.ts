/**
 * The crystal fuse's two clock decisions (owner 2026-10-26), split out of `ChargeGlyph` so they are testable.
 *  - On light: time left → the fuse burns ('charging'); a dead clock (Continue / a covering screen closing after
 *    0:00) → straight to the charged wait ('charged'): no collapse burst, no sound.
 *  - On unlight: before 0:00 (an early End Turn, Versus quiet, a covering surface) the remaining fuse flashes and
 *    fades out very quickly ('flashFade'); at or after 0:00 the gem's End Turn strike releases the stored energy
 *    ('release') — including a press on the very frame the clock hits 0.
 */
export type FuseLightPhase = 'charging' | 'charged';
export function fusePhaseOnLight(secondsLeft: number): FuseLightPhase {
  return secondsLeft > 0 ? 'charging' : 'charged';
}

/** The clock reading (seconds left) at which the fuse APPEARS: `leadS` before its burn window opens (owner
 *  2026-10-27: appear at 0:21, start breaking down at 0:20). The lead is visual only; the burn and the sound still
 *  start at the window, so the fuse sits whole through the lead. */
export function fuseAppearsAt(chargeWindow: number, leadS: number): number {
  return chargeWindow + Math.max(0, leadS);
}

export type FuseExit = 'flashFade' | 'release';
export function fuseExitKind(secondsLeftAtUnlight: number): FuseExit {
  return secondsLeftAtUnlight > 0 ? 'flashFade' : 'release';
}
