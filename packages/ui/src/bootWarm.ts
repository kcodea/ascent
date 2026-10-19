/**
 * THE BOOT WARM-UP (desktop jank pass 2026-10-18, R-PERF-BOOT-WARM-01): the GPU work that used to land on the title's
 * first seconds and in the middle of a game, paid while the boot splash is still up.
 *
 * Measured (perf audit 2026-10-18, prod build, 240 Hz desktop): the title's first 3 s dropped 22-24 frames over
 * 6.25 ms with tasks of 64-236 ms, every one blocked on the GPU. They were the board FX layer's shader links (one
 * per macrotask, `fx/playDef.ts` `schedulePrewarm`) and new WebGL contexts: the Discover overlay's and the screen
 * wipe's (both built on idle at the title), and the ranked gate's (built as the doors start to close, at the ranked
 * entry AND at every game's end). Each new context is a 60-90 ms block (`loaf: resolve-promise import.then`, Pixi's
 * renderer construction right after its lazy renderer chunk resolves).
 *
 * On desktop the splash now waits for all of them (capped, so a broken GPU can never hold it): the game is mounted
 * and warming underneath a full-opacity splash, and the fade starts on a warm page. Phones and iPads (`LITE_ART`)
 * keep their short gate and build these on demand as before (their memory budget is the tighter constraint).
 */
import { LITE_ART } from './phoneArt';
import { whenFxPrewarmed } from './fx/playDef';
import { warmDiscoverFxNow } from './pixiFx';
import { wipeFx } from './wipeFx';
import { gateFx } from './rankedGate/gateFx';

/** The longest the splash waits on the warm-up. Measured warm-ups take 0.4-1.0 s; past this the GPU is the problem. */
export const BOOT_WARM_CAP_MS = 4000;

/** Does this device warm its GPU layers behind the splash? */
export const bootWarmApplies = (): boolean => !LITE_ART;

/** Start every warm-up and resolve when all have finished, or at the cap. Never rejects. */
export function bootWarm(capMs = BOOT_WARM_CAP_MS): Promise<void> {
  if (!bootWarmApplies() || typeof window === 'undefined') return Promise.resolve();
  wipeFx.warm();
  gateFx.warm();
  const all = Promise.all([
    whenFxPrewarmed(),
    warmDiscoverFxNow(),
    wipeFx.ready(),
    gateFx.ready(),
  ].map((p) => p.catch(() => undefined))).then(() => undefined);
  return Promise.race([all, new Promise<void>((r) => window.setTimeout(r, capMs))]);
}
