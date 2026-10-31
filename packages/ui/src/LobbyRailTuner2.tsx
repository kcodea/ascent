import { LR2_SPEC } from './lobbyRailTuner2Config';
import { TunerPanel } from './TunerPanel';

export { LR2_SPEC as SPEC } from './lobbyRailTuner2Config';

/**
 * DEV-only LOBBY RAIL TUNER 2 (owner 2026-10-30): full live control of the Medallions (C) rail's position, sizes and
 * spacing, one CSS var per control (lobbyRailTuner2Config.ts / lobbyRailMedallions.css).
 */
export function LobbyRailTuner2(): JSX.Element {
  return <TunerPanel spec={LR2_SPEC} />;
}
