import { SPEC } from './lobbyRailLookConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './lobbyRailLookConfig';

/**
 * DEV-only tuner for the LOBBY RAIL's LOOK — portrait size + rounding, spacing, corner radii, every ink and fill,
 * and the full next-foe marker (ring / glow / accent bar / pulse). Its sibling 🪑 Lobby Rail tuner owns the rail's
 * SIZE and POSITION; this one owns everything painted inside. Applies live through `--lby-*` vars on `:root`.
 */
export function LobbyRailLookTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
