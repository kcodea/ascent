import type { BoardSnapshot } from './snapshot';

/**
 * Win-rate matchmaking (owner design 2026-07-18) — weight served opponents by their OBSERVED record from
 * the shared fight ledger (`board_results`), so run-ending boss boards stay in the pool but stop dominating.
 *
 * Built to be ITERATED ON OR TURNED OFF (owner directive): every dial lives in `MATCHMAKING`, and
 * `winrateWeighting: false` restores the exact pre-2026-07-18 uniform pick. The weighting is the LAST
 * stage of the pick pipeline — it never overrides the wave filter, the live-over-forged source cascade,
 * or the no-repeat exclusion (see `pickOpponent`).
 *
 * Perspective: the ledger records outcomes from the SERVED BOARD's side — a "70% board" beats players 70%
 * of the time. The default Oath expects ~9 of 15 wins, so the average opponent should sit near 40% board
 * win-rate: the full-weight core is 0–55%, tapering above.
 */
export const MATCHMAKING = {
  /** Master switch — false = uniform pick within the source tier (the pre-weighting behavior, exactly). */
  winrateWeighting: true,
  /** Bayesian prior: adjusted = (wins + priorWins) / (fights + priorFights) — ten imaginary 50/50 fights,
   *  so a 4–0 board reads 64%, not 100%; real results gradually override the prior. */
  priorWins: 5,
  priorFights: 10,
  /** Band edges over ADJUSTED board win-rate + the owner's weights (2026-07-18): bosses (90%+) stay in the
   *  pool at 0.09 — rare, never quarantined ("any legal board may be served" survives). */
  bands: [
    { max: 0.30, weight: 1.0 },
    { max: 0.55, weight: 1.0 },
    { max: 0.65, weight: 0.75 },
    { max: 0.75, weight: 0.35 },
    { max: 0.90, weight: 0.15 },
    { max: 1.01, weight: 0.09 },
  ] as { max: number; weight: number }[],
  /** Loss-streak softener — ONCE PER STREAK (owner call): with `after`+ straight losses (and the softener
   *  not yet spent this streak), boards above `hardCutoff` get ×`hardMult`; at `deepAfter`+ losses the
   *  forgiving band (`boostLo`–`boostHi`) additionally gets ×`boostMult`. Weight-shifts, never exclusions —
   *  a hot board can still appear. The softener disarms after it influences ONE pick and re-arms only when
   *  a win breaks the streak and a new one forms. */
  streak: { after: 2, hardCutoff: 0.65, hardMult: 0.3, deepAfter: 3, boostLo: 0.30, boostHi: 0.50, boostMult: 2 },
};

/** A board's ledger record — fights it was served into and the fights IT won (board perspective). */
export interface BoardRecord { wins: number; fights: number }

/** Session store: board id → record, registered from the shared ledger at startup and refreshed between
 *  runs (never mid-run, so a run's weights are static — same determinism scope as the pool itself). */
const RECORDS = new Map<string, BoardRecord>();

export function registerBoardRecords(records: Iterable<[string, BoardRecord]>): void {
  for (const [id, rec] of records) RECORDS.set(id, { wins: rec.wins, fights: rec.fights });
}
export function clearBoardRecords(): void {
  RECORDS.clear();
}
export function boardRecord(id: string | undefined): BoardRecord | undefined {
  return id ? RECORDS.get(id) : undefined;
}

/** The Bayesian-adjusted board win-rate. No record (a synthetic board, or one never yet served) = the pure
 *  prior = 0.50 — neutral full weight, so unproven boards get natural exploration traffic. */
export function adjustedWinRate(rec: BoardRecord | undefined): number {
  const wins = (rec?.wins ?? 0) + MATCHMAKING.priorWins;
  const fights = (rec?.fights ?? 0) + MATCHMAKING.priorFights;
  return wins / fights;
}

/** The owner's band weight for an adjusted win-rate. */
export function bandWeight(rate: number): number {
  for (const b of MATCHMAKING.bands) if (rate < b.max) return b.weight;
  return MATCHMAKING.bands[MATCHMAKING.bands.length - 1]!.weight;
}

/** A candidate's final selection weight: band weight × the loss-streak softener (when armed).
 *  `streakLosses` is 0 unless the softener is ACTIVE for this pick (armed and unspent — the caller gates). */
export function selectionWeight(snap: BoardSnapshot, streakLosses = 0): number {
  const rate = adjustedWinRate(boardRecord(snap.id));
  let w = bandWeight(rate);
  const st = MATCHMAKING.streak;
  if (streakLosses >= st.after && rate > st.hardCutoff) w *= st.hardMult;
  if (streakLosses >= st.deepAfter && rate >= st.boostLo && rate < st.boostHi) w *= st.boostMult;
  return w;
}
