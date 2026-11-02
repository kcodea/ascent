import { playerOpponent, type RunState } from '@game/sim';
import { seatCosmetics } from '../skins/skins';

/**
 * The `hero_attack` cosmetic id the STRIKING hero wore, as recorded (owner 2026-09-28: Blast is a cosmetic, and the
 * player you hit sees it). Yours: the run's own recorded snapshot (a replay reads the recorded one). The foe's: its
 * seat's recorded snapshot (else the served board's), and only while "Show opponent cosmetics" is on, the same
 * switch that hides their skins. Read once at the start of the post-combat sequence, before the settle moves the
 * pairing on. Null = nothing equipped (Classic).
 *
 * VERSUS DUOS (R-DUOS-FX-01): the blow belongs to the player whose board ended the fight. `liveSeatId` is the lobby
 * seat whose board is live on the striking side when that is not the default (`useDuosCombat`: my teammate on my side,
 * the foe team's second player on theirs). It strikes with ITS recorded attack, through the same "Show opponent
 * cosmetics" switch the teammate's portrait uses, so both teammates' screens play the same attack.
 */
export function attackerCosmeticOf(run: Pick<RunState, 'cosmetics' | 'lobby'>, side: 'player' | 'opp', showOpponent: boolean, liveSeatId?: string | null): string | null {
  if (liveSeatId && run.lobby) {
    const seat = run.lobby.seats.find((x) => x.id === liveSeatId);
    if (seat) return showOpponent ? seatCosmetics(seat)?.heroAttack ?? null : null;
  }
  if (side === 'player') return run.cosmetics?.heroAttack ?? null;
  if (!showOpponent || !run.lobby) return null;
  const foe = playerOpponent(run.lobby);
  return seatCosmetics(foe?.seat, foe?.board)?.heroAttack ?? null;
}
