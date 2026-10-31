/**
 * RANKED DUOS: the server's table seating (the `versus-resolve` Edge Function's `seat_ranked_duos` action), a pure handler
 * over an injected store so Node tests drive exactly what Deno runs (the `duosFinalize.ts` pattern).
 *
 * 1. Read the match. Only a Ranked Duos match whose two live heroes are locked is seated; a match already seated answers
 *    with what it has (a second caller is a client catching up: the first wins under the commit's row lock).
 * 2. The band is the live TEAM's own medal (owner 2026-10-26: the rating belongs to the pair).
 * 3. Sample server side (no client ever downloads the pool for a Duos game): recorded duo runs, and solo runs under the
 *    band's hard overall cap. `selectRankedDuosTable` picks the three teams.
 * 4. Commit through `versus_ranked_duos_seat` with every served member's WHOLE recording copied in (pinned).
 *
 * Bundle-safe: pure siblings only.
 */
import { strengthBandForDivision } from '../lobby/strengthBands';
import { playableHeroes } from '../heroes';
import { selectRankedDuosTable, type DuoRunCandidate, type RankedDuosServedTeam, type SoloRunCandidate } from './rankedDuosSeating';

/** Solo runs asked for per seating: enough for six seats after the band and hero filters, small for egress. */
export const RANKED_DUOS_SOLO_SAMPLE = 60;
/** Duo runs asked for per seating. */
export const RANKED_DUOS_DUO_SAMPLE = 40;

export interface RankedDuosSeatMatchRow {
  id: string;
  phase: string;
  seed: number | string;
  set_id: string;
  options?: { mode?: string } | null;
  ranked_team: string | null;
  seated_at: string | null;
}

export interface RankedDuosSoloRow {
  run_key: string;
  author: string | null;
  user_id: string | null;
  strength: number | null;
  strength_early: number | null;
  strength_late: number | null;
  /** Every board of the run (`BoardSnapshot[]`), whole (R-LOBBY-08). */
  boards: unknown[] | null;
}

export interface RankedDuosDuoRow {
  id: string;
  /** `[{ userId, name, heroId, runKey }, { ... }]`, seat order (p1 then p2). */
  members: { userId: string | null; name: string; heroId: string; runKey: string }[];
  strength: number | null;
  strength_early: number | null;
  strength_late: number | null;
  /** `[{ round, sides: { p1, p2 }, first }]`, ascending. */
  rounds: { round: number; sides: Record<string, unknown>; first?: string | null }[];
}

export interface RankedDuosSeatStore {
  match(id: string): Promise<RankedDuosSeatMatchRow | null>;
  /** The live seats' heroes (p1, p2), null while a pick is still open. */
  liveHeroes(matchId: string): Promise<(string | null)[]>;
  /** The live team's current Duos division index (0 = Bronze I, also for a new team or another season). */
  teamDivision(teamId: string | null): Promise<number>;
  soloSample(args: { p_limit: number; p_set: string; p_seed: string; p_strength_cap: number | null }): Promise<RankedDuosSoloRow[]>;
  duoSample(args: { p_limit: number; p_set: string; p_seed: string }): Promise<RankedDuosDuoRow[]>;
  commit(args: { p_match: string; p_table: unknown }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The `p_table` the SQL commit stores: one entry per served team, each member carrying its whole recording. */
export function rankedDuosTablePayload(
  teams: readonly RankedDuosServedTeam[],
  solo: ReadonlyMap<string, RankedDuosSoloRow>,
  duo: ReadonlyMap<string, RankedDuosDuoRow>,
  unrated: boolean,
): Record<string, unknown> {
  return {
    unrated,
    teams: teams.map((t) => {
      const run = t.duoRunId ? duo.get(t.duoRunId) : undefined;
      return {
        team: t.team, kind: t.kind, duoRunId: t.duoRunId ?? null, order: t.order,
        // A duo run's recorded order: round -> the member (0 / 1) whose board fought first.
        recordedOrder: run ? Object.fromEntries(run.rounds.map((r) => [String(r.round), r.first === 'p2' ? 1 : 0])) : null,
        members: t.members.map((m, i) => ({
          member: i, kind: m.kind, key: m.key, ownerId: m.ownerId, name: m.name, heroId: m.heroId,
          recording: m.kind === 'solo'
            ? { kind: 'solo', boards: solo.get(m.key)?.boards ?? [] }
            : m.kind === 'duo'
              ? { kind: 'duo', rounds: (run?.rounds ?? []).map((r) => ({ round: r.round, side: r.sides[i === 0 ? 'p1' : 'p2'] ?? null })) }
              : { kind: 'generated', heroId: m.heroId, seed: m.seed ?? 0 },
        })),
      };
    }),
  };
}

export async function handleRankedDuosSeat(
  userId: string | null,
  body: Record<string, unknown>,
  store: RankedDuosSeatStore,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const matchId = body.matchId;
  if (typeof matchId !== 'string' || !UUID.test(matchId)) return { status: 400, body: { error: 'bad_match' } };
  const m = await store.match(matchId);
  if (!m) return { status: 404, body: { error: 'no_match' } };
  if ((m.options?.mode ?? '') !== 'ranked_duos') return { status: 409, body: { error: 'not_ranked_duos' } };
  if (m.seated_at) return { status: 200, body: { seated: true, already: true } };
  if (m.phase === 'complete') return { status: 409, body: { error: 'match_over' } };
  // OPPONENTS FIRST (owner 2026-10-31, R-RANKED-OPPONENTS-FIRST-01): the Cloudflare room seats the table BEFORE the
  // party's offers are dealt (`opponentsFirst`), so no live hero is held yet and every hero is open to the table; the
  // offers are then dealt around it. Without the flag, the table waits for both heroes, exactly as before.
  const opponentsFirst = body.opponentsFirst === true;
  const heroes = opponentsFirst ? [] : await store.liveHeroes(matchId);
  if (!opponentsFirst && (heroes.length !== 2 || heroes.some((h) => !h))) return { status: 409, body: { error: 'heroes_not_locked' } };

  const band = strengthBandForDivision(await store.teamDivision(m.ranked_team));
  const seed = Number(m.seed) >>> 0;
  const [soloRows, duoRows] = await Promise.all([
    store.soloSample({ p_limit: RANKED_DUOS_SOLO_SAMPLE, p_set: m.set_id, p_seed: `rd:${matchId}`, p_strength_cap: band?.overallCap ?? null }),
    store.duoSample({ p_limit: RANKED_DUOS_DUO_SAMPLE, p_set: m.set_id, p_seed: `rd:${matchId}` }),
  ]);

  const solo = new Map<string, RankedDuosSoloRow>();
  const soloRuns: SoloRunCandidate[] = [];
  for (const r of soloRows) {
    const boards = Array.isArray(r.boards) ? r.boards : [];
    const first = boards[0] as { heroId?: unknown } | undefined;
    const heroId = typeof first?.heroId === 'string' ? first.heroId : (r.run_key.split('|')[1] ?? '');
    if (!heroId || !boards.length || solo.has(r.run_key)) continue;
    solo.set(r.run_key, r);
    soloRuns.push({
      key: r.run_key, ownerId: r.user_id, author: r.author ?? 'anon', heroId,
      strength: num(r.strength), early: num(r.strength_early), late: num(r.strength_late),
    });
  }
  const duo = new Map<string, RankedDuosDuoRow>();
  const duoRuns: DuoRunCandidate[] = [];
  for (const r of duoRows) {
    if (!Array.isArray(r.members) || r.members.length !== 2 || !Array.isArray(r.rounds) || !r.rounds.length) continue;
    duo.set(r.id, r);
    const [a, b] = r.members as [RankedDuosDuoRow['members'][number], RankedDuosDuoRow['members'][number]];
    duoRuns.push({
      id: r.id,
      members: [
        { runKey: a.runKey, ownerId: a.userId, name: a.name, heroId: a.heroId },
        { runKey: b.runKey, ownerId: b.userId, name: b.name, heroId: b.heroId },
      ],
      strength: num(r.strength), early: num(r.strength_early), late: num(r.strength_late),
    });
  }

  const table = selectRankedDuosTable({
    seed, liveHeroes: heroes as string[], duoRuns, soloRuns, band,
    generatedHeroes: playableHeroes().map((h) => h.id),
  });
  if (table.teams.length !== 3) {
    store.log('ranked duos: could not fill the table', { matchId, teams: table.teams.length });
    return { status: 500, body: { error: 'table_unfilled' } };
  }
  await store.commit({ p_match: matchId, p_table: rankedDuosTablePayload(table.teams, solo, duo, table.unrated) });
  return {
    status: 200,
    body: {
      seated: true, unrated: table.unrated, usedStep: table.usedStep,
      teams: table.teams.map((t) => ({ team: t.team, kind: t.kind, members: t.members.map((x) => x.kind) })),
    },
  };
}
