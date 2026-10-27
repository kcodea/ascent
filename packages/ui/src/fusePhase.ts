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

export type FuseExit = 'flashFade' | 'release';
export function fuseExitKind(secondsLeftAtUnlight: number): FuseExit {
  return secondsLeftAtUnlight > 0 ? 'flashFade' : 'release';
}
