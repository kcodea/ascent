import { SPEC } from './rankedGate/gateEnterConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for THE GATE'S WORD: the painted "ENTER" under the armed crystal of the ranked gate. Its place on
 * the door, its size, an added glow (amount, blur, colour), and the colour of the word itself (hue, saturation,
 * brightness, and a tint toward one colour), rendered through the shared `TunerPanel` from `gateEnterConfig`'s spec.
 * "▶ show gate" shuts the gate over the current screen and leaves it armed so the word can be seen while it is
 * tuned; the panel sits above the shut gate (rankedGate.css).
 */
export function GateEnterTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
