/**
 * THE DUOS RAIL, ONE SLOT PER TEAM (owner 2026-10-27: "clean up the duo's rail a bit. can you tie the teammates together
 * better by putting them into chunkier rail slots as a team?"; R-DUOS-RAIL-TEAM-01). The rail's rows, already grouped team
 * by team (`groupDuosRailRows`), cut into one slot per team: both members, the team's name when it has one (Ranked Duos),
 * and the team's ONE Health pool (a Duos team plays on a shared pool, so both rows carry the same number; the slot shows
 * it once). Pure: no React, no store.
 */

/** A team of a rail seat id: `s0`+`s1` (you and your teammate), `s2`+`s3`, and in Ranked Duos `s4`+`s5`, `s6`+`s7`. */
export const duosRailTeamOf = (id: string): number => {
  const n = Number(id.slice(1));
  return Number.isFinite(n) ? Math.floor(n / 2) : 99;
};

export interface DuosRailTeam<R> {
  /** The team's index (`duosRailTeamOf`), a stable React key. */
  team: number;
  /** Its rows, in rail order (one or two). */
  rows: R[];
}

/** Rows (grouped team by team) as one entry per team, in the order the teams first appear. */
export function duosRailTeams<R extends { id: string }>(rows: readonly R[]): DuosRailTeam<R>[] {
  const out: DuosRailTeam<R>[] = [];
  for (const r of rows) {
    const t = duosRailTeamOf(r.id);
    const hit = out.find((x) => x.team === t);
    if (hit) hit.rows.push(r);
    else out.push({ team: t, rows: [r] });
  }
  return out;
}

/** The row whose Health the slot shows: the first member still standing, else the first. Both carry the team's pool. */
export function duosTeamHealthRow<R extends { alive: boolean }>(rows: readonly R[]): R | undefined {
  return rows.find((r) => r.alive) ?? rows[0];
}
