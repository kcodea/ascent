import { previewAnnouncerEvent } from './announcer';
import { announcerTunerControls, SPEC as BASE_SPEC, type AnnouncerTunerConfig } from './announcerConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for THE ANNOUNCER (owner ask 2026-09-24): *"add an announcer tuner to the dev panel that has volume
 * for each event, and a timing adjust that allows me to offset timing of the event earlier or later"*. One section
 * per event: its Volume (percent of the recorded line, on top of the Settings Announcer level) with a ▶ that plays
 * the line at that volume (each press the next variant), and its Timing offset. Copy values → paste into
 * `announcerConfig.ts` DEFAULTS to bake.
 */
export const SPEC: TunerSpec<AnnouncerTunerConfig> = {
  ...BASE_SPEC,
  controls: announcerTunerControls((event) => { previewAnnouncerEvent(event); }),
};

export function AnnouncerTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
