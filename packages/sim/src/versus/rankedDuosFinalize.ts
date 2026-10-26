/**
 * RANKED DUOS: the server's round finalization (`versus-resolve`'s `finalize_ranked_duos`), a pure handler over an
 * injected store so Node tests drive exactly what Deno runs (the `duosFinalize.ts` pattern).
 *
 * 1. Read the round's input in ONE call (`versus_ranked_duos_round_input`): the match, every team's pools, the live
 *    pair's FINAL sides, each recorded member's board for THIS round from the pinned copy (the SQL applies the
 *    round-exact serving rule: its own round, a hole = empty in the previous round's state, before its start = empty
 *    tier 1, past its end = its final board), each fallen team's boards from the round it fell (ghost material), and
 *    the meetings so far. Only the boards this round needs cross the wire (egress).
 * 2. Build the sides (a snapshot through `seatCombatSide`, THE builder every lobby seat fights with; a duo member's
 *    recorded side as it fought), the pools (stored, else 30 Health + both heroes' Armor; the live pair's raised by its
 *    fresh reports, `versusVitalsBefore`), the fight order (live / paired team: the seeded 50/50 of R-DUOS-ORDER-01; a
 *    recorded duo run: its recorded order).
 * 3. `resolveRankedDuosRound`, then commit through `versus_ranked_duos_commit_round` (idempotent under the match lock;
 *    it places teams, settles the live team's rating and ends the match when the live team is placed).
 *
 * Bundle-safe: pure siblings + `boardSide` (core + content).
 */
import { makeRng } from '@game/core';
import { seatCombatSide } from '../boardSide';
import type { BoardSnapshot } from '../snapshot';
import type { PreparedCombatSide } from '../state';
import { canonicalDigest } from './canonical';
import { versusDuosOrderSeed } from './duos';
import { resolveRankedDuosRound, type RankedDuosEncounter, type RankedDuosRoundResult } from './rankedDuosRound';
import { RANKED_DUOS_LIVE_TEAM } from './rankedDuos';
import { reportedVitals, versusDuosStartingVitals, versusFreshSide, versusVitalsBefore, type VersusVitals } from './vitals';

export interface RankedDuosMemberBoard {
  member: 0 | 1;
  kind: 'duo' | 'solo' | 'generated';
  /** `snapshot` = a solo run's `BoardSnapshot` for the round; `side` = a duo member's recorded prepared side; `none` =
   *  nothing to field (before its start, or a generated member with no recording). */
  form: 'snapshot' | 'side' | 'none';
  board: unknown;
}

export interface RankedDuosTeamRow {
  team: string;
  kind: 'live' | 'duo' | 'pair' | 'generated';
  health: number | null;
  armor: number | null;
  eliminatedRound: number | null;
  heroes: (string | null)[];
  /** A recorded duo run's first member for the round served, else null. */
  recordedFirst: 0 | 1 | null;
  /** The round these boards are for (the current round; a fallen team: the round it fell). */
  at: number;
  members: RankedDuosMemberBoard[];
}

export interface RankedDuosRoundRaw {
  match: { id: string; phase: string; round: number; seed: number | string; content_revision: string; options?: { mode?: string } | null; seated: boolean };
  teams: RankedDuosTeamRow[];
  live: Record<'p1' | 'p2', { side: unknown; source: string | null } | null>;
  history: RankedDuosEncounter[];
}

export interface RankedDuosFinalizeStore {
  input(matchId: string, round: number): Promise<RankedDuosRoundRaw | null>;
  commit(args: { p_match: string; p_round: number; p_result: unknown; p_digest: string }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A recorded member's side for a fight in `round`. */
export function rankedDuosMemberSide(m: RankedDuosMemberBoard | undefined, round: number): unknown {
  if (!m || m.form === 'none' || !m.board) return null;
  if (m.form === 'side') return m.board;
  const snap = m.board as BoardSnapshot;
  if (!Array.isArray(snap.minions)) return null;
  const built = seatCombatSide({ minions: snap.minions, tier: snap.tier, snapshot: snap }, round);
  return { board: built.minions, state: built.state, config: {} } satisfies PreparedCombatSide;
}

/** Who fights first for `team` in `round`: the recorded order of a duo run, else the seeded 50/50 (R-DUOS-ORDER-01). */
export function rankedDuosFirstOf(team: string, recordedFirst: 0 | 1 | null, matchSeed: number, round: number): 0 | 1 {
  if (recordedFirst === 0 || recordedFirst === 1) return recordedFirst;
  const k = team.charCodeAt(0) - 97;
  return makeRng(versusDuosOrderSeed(matchSeed, round, k)).next() < 0.5 ? 0 : 1;
}

/** The commit payload (the SQL reads it with ->>). */
export function rankedDuosPayload(out: RankedDuosRoundResult): Record<string, unknown> {
  return {
    pairing: out.pairing,
    fights: out.fights.map((f) => ({ ...f })),
    vitals: out.vitals,
    placed: out.placed,
    liveFirst: out.liveFirst,
  };
}

export function rankedDuosRoundDigest(out: RankedDuosRoundResult): string {
  return canonicalDigest({ round: out.round, result: rankedDuosPayload(out) });
}

export async function handleRankedDuosFinalize(
  userId: string | null,
  body: Record<string, unknown>,
  engineContent: string,
  store: RankedDuosFinalizeStore,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const matchId = body.matchId;
  const round = body.round;
  if (typeof matchId !== 'string' || !UUID.test(matchId)) return { status: 400, body: { error: 'bad_match' } };
  if (!Number.isInteger(round) || (round as number) < 1) return { status: 400, body: { error: 'bad_round' } };
  const raw = await store.input(matchId, round as number);
  if (!raw) return { status: 404, body: { error: 'no_match' } };
  const m = raw.match;
  if ((m.options?.mode ?? '') !== 'ranked_duos') return { status: 409, body: { error: 'not_ranked_duos' } };
  if (m.phase !== 'resolving' || m.round !== round) return { status: 200, body: { status: 'not_resolving', phase: m.phase, round: m.round } };
  if (m.content_revision !== engineContent) return { status: 409, body: { error: 'content_mismatch', match: m.content_revision, engine: engineContent } };
  if (!m.seated) return { status: 409, body: { error: 'not_seated' } };

  const seed = Number(m.seed) | 0;
  const r = round as number;
  const aliveIn: Parameters<typeof resolveRankedDuosRound>[0]['alive'][number][] = [];
  const fallen: Parameters<typeof resolveRankedDuosRound>[0]['fallen'][number][] = [];
  for (const t of [...raw.teams].sort((x, y) => x.team.localeCompare(y.team))) {
    const start = versusDuosStartingVitals(t.heroes[0], t.heroes[1]);
    const stored: VersusVitals = t.health != null && t.armor != null ? { health: t.health, armor: t.armor } : start;
    if (t.team === RANKED_DUOS_LIVE_TEAM) {
      if (t.eliminatedRound != null) return { status: 409, body: { error: 'live_team_out' } };
      const p1 = versusFreshSide(raw.live.p1?.side ?? null, raw.live.p1?.source);
      const p2 = versusFreshSide(raw.live.p2?.side ?? null, raw.live.p2?.source);
      aliveIn.push({
        team: t.team, sides: [p1, p2], first: rankedDuosFirstOf(t.team, null, seed, r),
        vitals: versusVitalsBefore(stored, [reportedVitals(p1), reportedVitals(p2)]),
      });
      continue;
    }
    const sides: [unknown, unknown] = [0, 1].map((i) => rankedDuosMemberSide(t.members.find((x) => x.member === i), r)) as [unknown, unknown];
    const first = rankedDuosFirstOf(t.team, t.recordedFirst, seed, t.at);
    if (t.eliminatedRound == null) aliveIn.push({ team: t.team, sides, first, vitals: stored });
    else if (t.eliminatedRound < r) fallen.push({ team: t.team, sides, first, eliminatedRound: t.eliminatedRound });
  }
  const out = resolveRankedDuosRound({ matchSeed: seed, round: r, alive: aliveIn, fallen, history: raw.history, liveTeam: RANKED_DUOS_LIVE_TEAM });
  if (Object.keys(out.refused).length) store.log('ranked duos: refused sides', { matchId, round, refused: out.refused });
  const digest = rankedDuosRoundDigest(out);
  const committed = await store.commit({ p_match: matchId, p_round: r, p_result: rankedDuosPayload(out), p_digest: digest });
  return { status: 200, body: { status: 'committed', round: r, digest, placed: out.placed, committed } };
}
