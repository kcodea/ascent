import { FLIP_DEFAULTS, FLIP_RANGES, getFlipConfig, resetFlipConfig, setFlipValue, type FlipConfig } from './flipConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the warband/shop reposition slide — the movement when cards reorder, close a sold gap, or
 * make room for a played unit. Values persist to localStorage and apply to the NEXT reposition, so drag a card
 * or sell one to judge a change.
 *
 * Migrated to the shared `TunerPanel`: this file is now the panel's *description*, not its implementation.
 * Persistence still runs entirely through `flipConfig`'s own accessors, so previously dialled values survive.
 */
const SPEC: TunerSpec<FlipConfig> = {
  id: 'flip',                       // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Reposition Slide',
  note: 'dev · next move · drag',
  read: getFlipConfig,
  write: setFlipValue,
  reset: resetFlipConfig,
  defaults: FLIP_DEFAULTS,
  controls: [
    {
      key: 'dragMs',
      label: 'Slide while dragging',
      hint: 'How long cards take to open a slot as you drag a card across the row.',
      unit: 'ms',
      min: FLIP_RANGES.dragMs[0], max: FLIP_RANGES.dragMs[1], step: FLIP_RANGES.dragMs[2],
    },
    {
      key: 'commitMs',
      label: 'Settle after drop',
      hint: 'The settle once you let go. 0 is instant — on a slow drag the cards have already slid into place.',
      unit: 'ms',
      min: FLIP_RANGES.commitMs[0], max: FLIP_RANGES.commitMs[1], step: FLIP_RANGES.commitMs[2],
    },
  ],
};

export function FlipTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
