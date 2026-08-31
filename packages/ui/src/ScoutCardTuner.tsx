import { SPEC } from './scoutCardConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './scoutCardConfig';

/**
 * DEV-only tuner for the LOBBY SCOUT CARD — the hover/pinned opponent report. Card box, text sizes, the fight-log
 * portrait, the rune sockets, and the card's colours, all live through `--sc-*` vars on `:root`.
 */
export function ScoutCardTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
