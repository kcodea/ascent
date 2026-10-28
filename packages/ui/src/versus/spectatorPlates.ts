/**
 * THE GROUP SPECTATOR'S PLATES READ THE SCREEN (R-VERSUS-LIVE-ARMOR-01; owner 2026-10-27: "people seemed to die when
 * they still had hp on my screen"). The fight picker's plates used the live seat rows, which move the moment a round
 * COMMITS: every player's new Health, and the knockouts, showed while the fight that caused them was still playing on
 * screen. They now read the watched player's own rail (the screen's lobby: the round shown so far, the pools going into
 * the next), exactly as the 1v1 plates already did, and the watched player's own Health box (their run). A seat the
 * screen has no row for falls back to its stored pools. Pure.
 */
import type { LobbySeatState, RunState, VersusGroupSeat, VersusVitals } from '@game/sim';
import type { VersusGroupMatchRaw } from './versusRemote';
import { duosLobbySeatId } from './versusGroupView';

export interface PlateVitals extends VersusVitals {
  /** Out of the match, as the screen shows it. */
  out: boolean;
}

/**
 * One plate's Health, Armor and knockout. `run` is the watched player's run on screen (null before it arrives); `start`
 * the seat's starting pools (its stored ones are `row.health` / `row.armor`).
 */
export function groupPlateVitals(
  raw: VersusGroupMatchRaw,
  watched: VersusGroupSeat | null,
  key: VersusGroupSeat,
  run: Pick<RunState, 'mode' | 'wave' | 'phase' | 'combatSettled' | 'resolve' | 'armor' | 'lobby'> | null,
  start: VersusVitals,
): PlateVitals {
  const row = raw.seats.find((x) => x.seat === key);
  const stored: PlateVitals = { health: row?.health ?? start.health, armor: row?.armor ?? start.armor, out: row?.eliminatedRound != null };
  if (!row || !watched || !run || run.mode !== 'versus' || !run.lobby) return stored;
  if (key === watched) {
    // The watched player: their own Health box, out once the fight that put them out has settled on their screen.
    const through = run.phase === 'combat' && run.combatSettled ? run.wave : run.wave - 1;
    return { health: Math.max(0, run.resolve), armor: Math.max(0, run.armor), out: row.eliminatedRound != null && row.eliminatedRound <= through };
  }
  const id = duosLobbySeatId(raw, watched, key);
  const seat: LobbySeatState | undefined = id ? run.lobby.seats.find((s) => s.id === id) : undefined;
  if (!seat) return stored;
  return { health: Math.max(0, seat.resolve), armor: Math.max(0, seat.armor ?? 0), out: !seat.alive };
}
