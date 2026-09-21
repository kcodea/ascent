import { SPEC } from './titleAccountConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the TITLE-SCREEN ACCOUNT CORNER — the player's portrait in the gold portrait ring
 * (top-right of the main menu), the name plate eclipsing the ring's bottom edge, and the rank badge beneath.
 * Ring size + corner offset, and each plate's scale + x/y nudge, rendered through the shared `TunerPanel` from
 * `titleAccountConfig`'s spec. Only visible on the title screen.
 */
export function TitleAccountTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
