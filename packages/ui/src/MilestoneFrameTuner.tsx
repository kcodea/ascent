import { SPEC } from './milestoneFrameConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the STAT MILESTONE BADGES (owner ask 2026-09-15) — the per-tier frame art discs, the
 * state tint over them, and the number's size / position / colour. Visible on any card whose Attack or Health
 * has crossed a tier (≥50); buff a unit in the shop, or open the Compendium, to see the frames move.
 */
export function MilestoneFrameTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
