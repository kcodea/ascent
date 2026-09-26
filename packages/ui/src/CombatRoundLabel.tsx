import { memo } from 'react';
import type { RunState } from '@game/sim';

/**
 * COMBAT ROUND LABEL (owner ask 2026-09-25): the arena prints `ROUND X` in white at the TOP CENTRE, just above
 * the Skip button, for the whole fight (the replay AND the settled screen after it). Static — no animation of
 * its own beyond the shared one-shot fade-in.
 *
 * The round is the SAME number the Fight Recap headlines (`FightRecap.tsx`: `lobby ? lobby.round : wave`), so
 * the two can never disagree: the lobby round in a lobby run, the wave everywhere else.
 */
export function combatRound(lobby: RunState['lobby'], wave: number): number | null {
  const round = lobby ? lobby.round : wave;
  return Number.isFinite(round) && round > 0 ? round : null;
}

/** The exact text the arena shows — `ROUND X`, or null when the round is unknown (nothing renders). */
export function combatRoundLabel(lobby: RunState['lobby'], wave: number): string | null {
  const round = combatRound(lobby, wave);
  return round === null ? null : `ROUND ${round}`;
}

export const CombatRoundLabel = memo(function CombatRoundLabel({ round }: { round: number | null }) {
  if (round === null) return null;
  return <div className="combatround">ROUND {round}</div>;
});
