/**
 * THE POOLS GOING INTO THE ROUND (R-VERSUS-LIVE-ARMOR-01; owner 2026-10-27: "i casted mend to get armor but it didn't
 * show to the other players").
 *
 * The server's stored Health and Armor of every seat (Duos: each seat carries its team's) are, from the moment round r's
 * shop opens until round r commits, exactly the pools round r will be fought from: the pools after round r - 1, plus
 * any shop Armor a seat has reported since (Mend lands on them at once, `2026-11-03-versus-live-armor.sql`). This keeps
 * the last such snapshot per match, so the rails can show a seat on them while the viewer is still at round r - 1 (the
 * shop, and the fight until they leave it), and never on round r's results before they have watched the fight. Pure
 * module state; nothing here talks to the network.
 */
import type { VersusEnteringVitals } from '@game/sim';

type Pools = { health?: number | null; armor?: number | null } | null | undefined;

let held: { matchId: string; e: VersusEnteringVitals<string> } | null = null;

/**
 * Note a match row's stored pools when they are a round's going-in pools: phase `shop` or `resolving` (round `round` not
 * committed yet). Any other phase keeps the last snapshot (after the commit the row already carries the round's damage).
 * A seat without stored pools (before round 1 commits) is left out: the view falls back to its hero's start.
 */
export function noteVersusEntering(matchId: string, phase: string, round: number, pools: Record<string, Pools>): void {
  if ((phase !== 'shop' && phase !== 'resolving') || !(round >= 1)) return;
  const vitals: Record<string, { health: number; armor: number }> = {};
  for (const [seat, p] of Object.entries(pools)) {
    if (p && p.health != null && p.armor != null) vitals[seat] = { health: Number(p.health), armor: Number(p.armor) };
  }
  held = { matchId, e: { round, vitals } };
}

/** The going-in pools last noted for this match (null when none). */
export function versusEnteringFor<S extends string>(matchId: string | null | undefined): VersusEnteringVitals<S> | null {
  return held && matchId && held.matchId === matchId ? (held.e as VersusEnteringVitals<S>) : null;
}

/**
 * VERSUS DUOS: the Armor my run should take from my team's stored pool going into this round (my teammate's shop Mend),
 * or null for nothing. Only in this round's shop, only on the same Health (the pools agree up to that raise), only up.
 */
export function duosTeamArmorRaise(
  entering: VersusEnteringVitals<string> | null | undefined,
  me: string,
  run: { mode?: string; phase: string; wave: number; resolve: number; armor: number },
): number | null {
  if (!entering || entering.round !== run.wave || run.mode !== 'versus' || run.phase !== 'recruit') return null;
  const pool = entering.vitals[me];
  return pool && pool.health === run.resolve && pool.armor > run.armor ? pool.armor : null;
}

/** Tests only. */
export function resetVersusEntering(): void {
  held = null;
}
