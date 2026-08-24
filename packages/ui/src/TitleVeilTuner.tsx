import { SPEC } from './titleVeilConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the TITLE-SCREEN VEIL — the dark navy gradient that hugs the main-menu edges and fades to
 * nothing over the floating-city art, with a bowed (elliptical) boundary. Colour + intensity plus the shape
 * knobs (core position, width/height, and the two gradient stops), rendered through the shared `TunerPanel`
 * from `titleVeilConfig`'s spec. Only visible on the title screen.
 */
export function TitleVeilTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
