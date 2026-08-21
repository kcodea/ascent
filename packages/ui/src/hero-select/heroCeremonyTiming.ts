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

/** Owner-tuned defaults (third pass 2026-08-21, dialed live in the 🎭 tuner): a quick travel (400+200), the
 *  transform starting DURING the settle (825) and running fast (350ms) so the portrait is fully resolved
 *  well before the 1320ms ring flash. Arrival burst rides the settle at 880. Still ~1.9s to Start Game. */
export const HERO_CEREMONY_TIMING: HeroCeremonyTiming = {
  pressMs: 90,
  headerExitDelayMs: 80,
  optionExitDelayMs: 100,
  optionExitMs: 330,
  optionStaggerMs: 35,
  focusDelayMs: 120,
  focusMs: 400,
  settleMs: 200,
  voiceAtMs: 700,
  transformAtMs: 825,
  transformMs: 350,
  identityAtMs: 1450,
  readyAtMs: 1650,
  readyMs: 250,
  launchCoverMs: 280,
  launchRevealMs: 360,
};

/**
 * The PHASE-ADVANCE schedule, made monotonic BY CONSTRUCTION (fix 2026-08-21). The machine only accepts
 * single forward steps, so five independent sliders could order the advance timers illegally — sliding
 * `voiceAtMs` past `transformAtMs` made the materializing advance fire from `focusing`, the reducer
 * (correctly) rejected the skip, and the ceremony wedged with no transform and no Start Game. Each advance
 * now lands no earlier than the one before it (equal marks fire in registration order, which is phase
 * order), and the VOICELINE ITSELF is decoupled — it is audio, scheduled at the raw `voiceAtMs`, never a
 * phase driver. The `voicing` phase mark is additionally kept inside its slot (≤ the transform) so moving
 * the voice late can delay only the sound, never the visuals.
 */
export function ceremonyAdvanceSchedule(t: HeroCeremonyTiming): {
  dismissAt: number; focusAt: number; voicePhaseAt: number; materializeAt: number; readyAt: number;
} {
  const dismissAt = Math.max(0, t.optionExitDelayMs);
  const focusAt = Math.max(t.focusDelayMs, dismissAt);
  const voicePhaseAt = Math.max(Math.min(t.voiceAtMs, t.transformAtMs), focusAt);
  const materializeAt = Math.max(t.transformAtMs, voicePhaseAt);
  const readyAt = Math.max(t.readyAtMs + t.readyMs, materializeAt);
  return { dismissAt, focusAt, voicePhaseAt, materializeAt, readyAt };
}

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
