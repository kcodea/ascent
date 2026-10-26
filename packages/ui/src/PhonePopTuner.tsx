import { SPEC } from './phonePopConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the PHONE HAND POP (R-PHONE-POP-01, owner 2026-10-26: "the hand pop still goes a bit too vertical"): how
 * tall a pressed hand card grows and where its foot sits. Read on the next press. Production always plays the defaults.
 */
export function PhonePopTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
