import { SPEC } from './lobbyReveal/lobbyRevealConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the LOBBY REVEAL (owner ask 2026-10-31): the line-up's look, every beat of the reveal and the flights,
 * whether the Good Luck words follow, and the two sounds. ▶ Replay reveal plays it over the current board. Production
 * always plays the baked defaults.
 */
export function LobbyRevealTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
