import { SPEC } from './progression/crateFx/crateFxConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the CRATE OPENING (owner ask 2026-09-28: "put a tuner in for it to test it"): every beat per
 * rarity, the particle counts, shake, flash, rings, rays, colours and sound cues. The ▶ buttons open a practice
 * crate in the real theatre with a local fake answer (never the server, nothing spent), plus Replay, a slow
 * server, a failure, Open all, and slow motion. Production always plays the baked defaults.
 */
export function CrateFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
