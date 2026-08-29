import type { RunState } from '@game/sim';

/**
 * Is this a FULL REAL GAME? (owner ruling 2026-08-29: *"the auto perf hud stuff should only capture full real
 * 'play' mode games"*.)
 *
 * Automatic capture is for the thing players actually experience. Everything else records numbers that would
 * mislead a comparison rather than inform it:
 *
 *   · **practice** runs a 3× shop timer and unlimited health, so its phase mix is nothing like a real game;
 *   · **the Scene Builder sandbox** exists to hold pathological boards still — it is *designed* to be
 *     unrepresentative, and its spikes would dominate every ranking;
 *   · **tutorial** is scripted and short;
 *   · **rift** is its own ruleset.
 *
 * A run must also EXIST: idling on the title screen for a minute is not a game, and a row of menu frames
 * would sit in the viewer looking like data.
 *
 * The HUD and the manual **Share** button are deliberately NOT gated by this — deliberately profiling the
 * Scene Builder is a real thing to want. This governs only what uploads on its own.
 */
export function isRealPlayRun(run: RunState | null | undefined): boolean {
  if (!run) return false;
  if (run.sandbox) return false;                 // Scene Builder rides practice mechanics under its own flag
  return (run.mode ?? 'ascent') === 'ascent';    // absent === 'ascent' (see RunState.mode)
}
