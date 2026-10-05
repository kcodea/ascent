import type { RunState } from '@game/sim';

/**
 * Which warband units the reactive `aleGrantSeq` watcher in `Recruit.tsx` should burst `ale-bubbles` from.
 *
 * Only a SHOP action counts (Tapkeeper on Gold spent, Doubletap Brewer's Shout). The End-of-Turn commit
 * (`faceOmen`) also stamps `aleGranted` for Brunni, but it lands after the phase flips to combat, while the
 * warband is still on screen under the wipe — and the End-of-Turn beat (`cardGranted`) has already played
 * that burst on its beat. Firing again here was the Brunni double-bubble (R-ALEFX-01). Same guard as the
 * spell-power / ruby-power / fodder watchers next to it.
 */
export function aleBubbleSources(run: Pick<RunState, 'phase' | 'aleGranted'>): string[] {
  if (run.phase !== 'recruit' || run.aleGranted.length === 0) return [];
  return Array.from(new Set(run.aleGranted.map((e) => e.sourceUid))); // one burst per generating unit
}
