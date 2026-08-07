/**
 * The watcher-pulse channel decision — Pixi ring-bloom when the owner's def is committed and the overlay can
 * play it, else the CSS `.framepulsering` fallback (which ships until `watcher-pulse.json` lands). Kept pure so
 * the branch is unit-tested without a renderer; the call site (`useCombatReplay.ts`) supplies the two booleans.
 */
export const WATCHER_PULSE_DEF_ID = 'watcher-pulse';

export function useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean {
  return defAvailable && canPlay;
}
