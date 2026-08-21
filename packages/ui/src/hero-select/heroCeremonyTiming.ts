/**
 * HERO SELECT CEREMONY — the one timing object (hero-select-ceremony-blueprint.md §4).
 *
 * Every delay and duration in the ceremony reads from here; no magic ms constants distributed across
 * components. All values are measured FROM THE INITIAL HERO CLICK unless the name says otherwise
 * (`launchCoverMs` / `launchRevealMs` run from the Start Game press).
 *
 * The dev tuner overlays these live in dev builds; production always plays the defaults.
 */
export interface HeroCeremonyTiming {
  /** The selected card's press-into-the-surface acknowledgment. */
  pressMs: number;
  /** Header / Oath / Back begin fading. */
  headerExitDelayMs: number;
  /** Unselected cards begin leaving. */
  optionExitDelayMs: number;
  /** One unselected card's exit duration. */
  optionExitMs: number;
  /** Per-card stagger between unselected exits (capped — see `exitStagger`). */
  optionStaggerMs: number;
  /** The selected clone starts travelling to center. */
  focusDelayMs: number;
  /** Travel duration (to the overshoot). */
  focusMs: number;
  /** Overshoot → final settle duration. */
  settleMs: number;
  /** The arrival burst fires (Pixi layer; no-op without it). */
  arrivalAtMs: number;
  /** `sfx.heroSelect(heroId)` plays — the tagline moment. */
  voiceAtMs: number;
  /** Card chrome starts dissolving; portrait starts materializing. */
  transformAtMs: number;
  /** Dissolve/materialize duration. */
  transformMs: number;
  /** Hero name begins appearing. */
  identityAtMs: number;
  /** Start Game begins appearing. */
  readyAtMs: number;
  /** Start Game entrance duration — it is interactive only after this completes. */
  readyMs: number;
  /** Launch curtain fade-to-opaque (from the Start Game press). `pickHero()` runs only after this. */
  launchCoverMs: number;
  /** Curtain reveal over the mounted Recruit screen. */
  launchRevealMs: number;
}

/** Owner-tuned defaults (second pass 2026-08-21, dialed live in the 🎭 tuner over the blueprint's §4
 *  values): a weightier travel than the blueprint (540+200 vs 560+140) with the arrival burst on the settle
 *  (880) instead of the approach. Still ~1.9s from click to an interactive Start Game. */
export const HERO_CEREMONY_TIMING: HeroCeremonyTiming = {
  pressMs: 90,
  headerExitDelayMs: 80,
  optionExitDelayMs: 100,
  optionExitMs: 330,
  optionStaggerMs: 35,
  focusDelayMs: 120,
  focusMs: 540,
  settleMs: 200,
  arrivalAtMs: 880,
  voiceAtMs: 700,
  transformAtMs: 950,
  transformMs: 700,
  identityAtMs: 1450,
  readyAtMs: 1650,
  readyMs: 250,
  launchCoverMs: 280,
  launchRevealMs: 360,
};

/** The dev tuner's live override (dev builds only). Null → defaults. Module-level like the FX registries:
 *  wall-clock presentation config, not React state — the tuner sets it, the next ceremony reads it. */
let liveTiming: HeroCeremonyTiming | null = null;

export function ceremonyTiming(): HeroCeremonyTiming {
  return liveTiming ?? HERO_CEREMONY_TIMING;
}

/** Dev tuner hook. Pass null to clear back to defaults. Ignored (no-op) outside dev builds by the caller. */
export function setCeremonyTiming(t: HeroCeremonyTiming | null): void {
  liveTiming = t;
}
