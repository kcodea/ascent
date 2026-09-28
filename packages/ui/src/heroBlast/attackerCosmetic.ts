import { playerOpponent, type RunState } from '@game/sim';
import { seatCosmetics } from '../skins/skins';

/**
 * The `hero_attack` cosmetic id the STRIKING hero wore, as recorded (owner 2026-09-28: Blast is a cosmetic, and the
 * player you hit sees it). Yours: the run's own recorded snapshot (a replay reads the recorded one). The foe's: its
 * seat's recorded snapshot (else the served board's), and only while "Show opponent cosmetics" is on, the same
 * switch that hides their skins. Read once at the start of the post-combat sequence, before the settle moves the
 * pairing on. Null = nothing equipped (Classic).
 */
export function attackerCosmeticOf(run: Pick<RunState, 'cosmetics' | 'lobby'>, side: 'player' | 'opp', showOpponent: boolean): string | null {
  if (side === 'player') return run.cosmetics?.heroAttack ?? null;
  if (!showOpponent || !run.lobby) return null;
  const foe = playerOpponent(run.lobby);
  return seatCosmetics(foe?.seat, foe?.board)?.heroAttack ?? null;
}
