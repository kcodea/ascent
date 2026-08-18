import { SPEC } from './boardEdgeConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the ultrawide board-edge blend — the `#372d60` fill that fades the side margins into the
 * board on a window wider than 16:9. Two knobs (colour + how far the blend reaches into the art), rendered
 * through the shared `TunerPanel` from `boardEdgeConfig`'s spec.
 *
 * Note it only has a visible effect on an ultrawide viewport: at ≤16:9 the board overspills the window and the
 * blend computes fully transparent (see `.boardbg`). Drag the window very wide, or use DevTools device mode at
 * e.g. 3440×1440, to see the colour move.
 */
export function BoardEdgeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
