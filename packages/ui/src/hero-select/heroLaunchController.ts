/**
 * HERO SELECT CEREMONY — the launch hand-off (hero-select-ceremony-blueprint.md §7).
 *
 * `pickHero()` synchronously creates the run and clears `heroChoices`, which unmounts HeroSelect mid-frame.
 * The final cover→pickHero→reveal transition therefore cannot live inside HeroSelect — it is owned by
 * HeroLaunchCurtain, mounted in Game. This module is the tiny seam between them: the curtain registers a
 * launch function on mount; the ceremony calls `requestLaunch()` on Start Game and never has to know the
 * curtain exists (or survive its own unmount).
 *
 * Module-level registry on purpose (like the FX registries): it is presentation plumbing, not game state —
 * no Zustand, no React context, nothing to persist.
 */

export interface HeroLaunchRequest {
  heroId: string;
  /** CSS color (var() allowed) for the curtain's center glow — a dark cover with a hero-accent heart, §7. */
  accent: string;
}

export type HeroLaunchFn = (req: HeroLaunchRequest) => Promise<void>;

let controller: HeroLaunchFn | null = null;
/** The in-flight launch, if any. A second Start Game press (or any stray caller) joins it instead of
 *  starting another cover/pickHero cycle — the machine already makes double-launch illegal (§5), this is
 *  the belt-and-braces at the module seam. */
let inFlight: Promise<void> | null = null;

/** The curtain registers itself on mount and unregisters (pass null) on unmount. */
export function registerLaunchController(fn: HeroLaunchFn | null): void {
  controller = fn;
}

/**
 * Run the full launch: curtain cover → pickHero → reveal. Resolves when the reveal completes (callers may
 * ignore the promise — the ceremony unmounts under the cover). Never rejects: a controller failure is
 * logged and swallowed (§19 — nothing in the ceremony may block run creation UX with a thrown error).
 *
 * With no curtain registered (broken build / tests) this is a safe no-op that resolves immediately — the
 * ceremony's reducer is already in `launching`, so the worst case is "nothing happened", never a crash.
 */
export function requestLaunch(req: HeroLaunchRequest): Promise<void> {
  if (inFlight) return inFlight;
  if (!controller) {
    if (typeof console !== 'undefined') console.warn('[heroLaunch] no curtain registered — launch ignored');
    return Promise.resolve();
  }
  inFlight = controller(req)
    .catch((err) => { console.warn('[heroLaunch] launch failed', err); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Test-only escape hatch: clear the module state between specs. */
export function resetLaunchControllerForTests(): void {
  controller = null;
  inFlight = null;
}
