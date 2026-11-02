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

/** One member of the team a Duos fight was against (the scout card's fight log draws both). */
export interface DuosFightFoe { id: string; heroId: string; label: string }

/** One past TEAM fight from a seat's point of view: the scout card's fight-log row in a team mode. */
export interface DuosTeamResult {
  round: number;
  /** The opposing team's members, in seat order. */
  foes: DuosFightFoe[];
  /** Both foes' names, "Soren + Midas". */
  foeLabel: string;
  /** The first foe (kept so a row reads like a solo row: `foeId` picks the portrait's skin). */
  foeId: string;
  foeHeroId: string;
  outcome: 'win' | 'lose' | 'draw';
  dealt: number;
  taken: number;
}

/**
 * THE TEAM FIGHT LOG (owner 2026-11-01: "the combat history should show the team that they fought, not an individual
 * hero"; R-DUOS-RAIL-TEAM-02). In Versus Duos and Ranked Duos a round is ONE tag-team fight per pair of teams, recorded
 * as an encounter between the two boards that went first. Read from either teammate's seat, it is THEIR TEAM's fight
 * (a teammate who did not go first fought it too), against the other TEAM, with the team's shared damage. The last `n`
 * the seat's team fought, newest first; one row a round. Pure.
 */
export function duosTeamResults(
  lobby: { seats: readonly { id: string; heroId: string; label: string }[]; encounters: readonly { round: number; a: string; b: string; fought: boolean; outcome: 'win' | 'lose' | 'draw'; damageToA: number; damageToB: number }[] },
  seatId: string,
  n = 3,
): DuosTeamResult[] {
  const mine = duosRailTeamOf(seatId);
  const out: DuosTeamResult[] = [];
  const seen = new Set<number>();
  for (let i = lobby.encounters.length - 1; i >= 0 && out.length < n; i--) {
    const e = lobby.encounters[i]!;
    if (!e.fought || seen.has(e.round)) continue;
    const ta = duosRailTeamOf(e.a), tb = duosRailTeamOf(e.b);
    if (ta !== mine && tb !== mine) continue;
    const isA = ta === mine;
    const foeTeam = isA ? tb : ta;
    const foes = lobby.seats.filter((s) => duosRailTeamOf(s.id) === foeTeam)
      .sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)))
      .map((s) => ({ id: s.id, heroId: s.heroId, label: s.label }));
    const fallback = isA ? e.b : e.a;
    seen.add(e.round);
    out.push({
      round: e.round,
      foes,
      foeLabel: foes.length ? foes.map((f) => f.label).join(' + ') : fallback,
      foeId: foes[0]?.id ?? fallback,
      foeHeroId: foes[0]?.heroId ?? '',
      // `outcome` is written from A's side, so B reads it inverted.
      outcome: isA ? e.outcome : (e.outcome === 'win' ? 'lose' : e.outcome === 'lose' ? 'win' : 'draw'),
      dealt: isA ? e.damageToB : e.damageToA,
      taken: isA ? e.damageToA : e.damageToB,
    });
  }
  return out;
}

/** The team placement column (R-DUOS-RAIL-TEAM-02): each team's place, by its order in the (team-grouped) rail. */
export function duosTeamPlaces<R extends { id: string }>(rows: readonly R[]): Map<number, number> {
  return new Map(duosRailTeams(rows).map((t, i) => [t.team, i + 1]));
}
