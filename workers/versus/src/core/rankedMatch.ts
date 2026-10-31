/**
 * VERSUS ON CLOUDFLARE — RANKED DUOS (owner 2026-10-26, design docs/design/2026-10-26-ranked-duos.md): the live pair
 * (team a = seats p1, p2) against three RECORDED teams (b, c, d) served from Supabase recordings, the lobby's rules,
 * a team rating settled by the placement. A port of `2026-10-29-ranked-duos.sql` and its follow-ups (client, live fixes,
 * both-ready, reliability), built on the Group engine:
 *
 *   - no pause: an absent live player goes on auto at once (and comes off it on return); both left = placed;
 *   - the round closes when both live players ended their turn (or are auto / left), else 30 s after 0:00
 *     (`versus_ranked_duos__close_at`, R-RANKED-DUOS-GATE-01);
 *   - the table is seated from Supabase samples (`handleRankedDuosSeat`, the Edge Function's own handler) the moment both
 *     heroes are known; the SHELL fetches the samples (`RankedService`) and hands the table in (`seatTable`);
 *   - every round is resolved by `handleRankedDuosFinalize` (the Edge Function's own handler) over an in-memory input
 *     (`versus_ranked_duos_round_input`, incl. the recordings' board for the round: `memberBoard`);
 *   - the live team's placement settles the team rating (`settle_duos_rank`) and records the duo run (`duo_runs` +
 *     `duo_run_rounds`) through ONE writer job (`ranked_finish`), exactly once (both are idempotent in SQL).
 */
import {
  engineContentRevision,
  handleRankedDuosFinalize,
  handleRankedDuosSeat,
  type RankedDuosFinalizeStore,
  type RankedDuosSeatStore,
} from '@game/sim/versus/server';
import { buildDuosHistory, duosBoardOfSide, duosBoardOfSnapshot, type DuosHistoryRecord } from '@game/sim/versus/duosHistory';
import { GroupEngine, GSEATS, type GOutReason, type GroupHost, type GroupState, type GSeat, type GSeatRow } from './groupMatch';

const SHOP_GRACE_MS = 250;
const OVERTIME_MS = 30_000;
const ABANDON_MS = 10 * 60_000;
const SEAT_RETRY_MS = 5_000;
export const RANKED_SERVED = ['b', 'c', 'd'] as const;

/** One recorded team member served at the table (`versus_ranked_duos_served`). */
export interface ServedMember {
  team: string;
  member: 0 | 1;
  kind: 'duo' | 'solo' | 'generated';
  source_key: string;
  owner_id: string | null;
  name: string;
  hero: string;
  recording: Record<string, unknown>;
}

export interface RankedTeam {
  team: string;
  health: number | null;
  armor: number | null;
  eliminated_round: number | null;
  out_reason: GOutReason | 'abandoned' | null;
  placement: number | null;
  served_kind: 'duo' | 'pair' | 'generated' | null;
  duo_run_id: string | null;
  recorded_order: Record<string, 0 | 1> | null;
  /** A recorded duo run's team name (when that pair named itself). */
  name: string | null;
}

/** One fight of a round (`versus_ranked_duos_fights`); only the live team's own fight carries its result. */
export interface RankedFightRow {
  round: number;
  fight: number;
  a_team: string;
  b_team: string;
  ghost: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  loser: string | null;
  damage: number;
  first: Record<string, 0 | 1> | null;
  live_result: unknown;
}

/** A committed round (`versus_group_rounds` for Ranked Duos: vitals by TEAM, the live team's first, its fights). */
export interface RankedRound {
  match_id: string;
  kind: 'ranked';
  round: number;
  digest: string;
  vitals: Record<string, { health: number; armor: number }>;
  eliminated: string[];
  first: { a: string } | null;
  fights: RankedFightRow[];
}

/** Ranked state beside the group match (stored in `meta` except the recordings: `rserved`). */
export interface RankedExtra {
  ranked_team: string | null;
  team_name: string | null;
  division: number;
  seated_at: number | null;
  unrated: string | null;
  /** Asked the shell for the team / the table and not answered yet (runtime-ish, kept to avoid double asks). */
  team_asked: boolean;
  seat_retry_at: number | null;
  teams: RankedTeam[];
  rounds: Record<number, RankedRound>;
}

/** What the shell fetches from Supabase for a Ranked Duos room (the limited `versus_cf_ranked` RPC). */
export interface RankedService {
  ensureTeam(a: string, b: string): Promise<{ teamId: string | null; name: string | null; division: number }>;
  soloSample(args: { p_limit: number; p_set: string; p_seed: string; p_strength_cap: number | null }): Promise<unknown[]>;
  duoSample(args: { p_limit: number; p_set: string; p_seed: string }): Promise<{ rows: unknown[]; names: Record<string, string> }>;
}

/** `versus_ranked_duos__member_board`: a recording's board for `round` (the round's own, else the last one with no minions). */
export function memberBoard(rec: Record<string, unknown> | null | undefined, round: number): { form: 'snapshot' | 'side' | 'none'; board: unknown } {
  const kind = rec?.kind;
  const list = (kind === 'solo' ? rec?.boards : kind === 'duo' ? rec?.rounds : null) as Record<string, unknown>[] | null;
  const key = kind === 'solo' ? 'wave' : 'round';
  if (!Array.isArray(list) || !list.length) return { form: 'none', board: null };
  const at = (e: Record<string, unknown>): number => Number(e[key]);
  const lo = Math.min(...list.map(at));
  const hi = Math.max(...list.map(at));
  if (!Number.isFinite(hi) || round < lo) return { form: 'none', board: null };
  const exact = list.find((e) => at(e) === Math.min(round, hi));
  if ((round <= hi && exact) || round > hi) {
    if (kind === 'solo') return { form: 'snapshot', board: exact ?? null };
    const side = exact?.side;
    return side == null ? { form: 'none', board: null } : { form: 'side', board: side };
  }
  const prev = [...list].filter((e) => at(e) < round).sort((x, y) => at(y) - at(x))[0];
  if (kind === 'solo') {
    const rest = { ...((prev ?? {}) as Record<string, unknown>) };
    delete rest.id; // the SQL's `v_prev - 'id'`
    return { form: 'snapshot', board: { ...rest, minions: [], power: 0, tribes: [] } };
  }
  const side = prev?.side as Record<string, unknown> | null | undefined;
  if (side == null) return { form: 'none', board: null };
  return { form: 'side', board: { ...side, board: [] } };
}

export interface RankedHost extends GroupHost {
  /** Ask the shell for the pair's team identity (and its division and name). */
  needTeam(): void;
  /** Ask the shell to seat the table. */
  needSeat(): void;
  /** The round resolver (tests and the chaos harness inject a slow / failing one; default `handleRankedDuosFinalize`). */
  rankedResolver?: typeof handleRankedDuosFinalize;
}

export class RankedEngine extends GroupEngine {
  constructor(g: GroupState, private readonly rh: RankedHost) {
    super(g, rh);
  }

  get r(): RankedExtra { return this.g.ranked!; }
  private rteam(id: string): RankedTeam { return this.r.teams.find((t) => t.team === id)!; }
  private livingRanked(): number { return this.r.teams.filter((t) => t.eliminated_round == null).length; }
  private liveSeats(): GSeatRow[] { return this.m.seats.filter((s) => s.seat === 'p1' || s.seat === 'p2'); }

  // ── the close rule (R-RANKED-DUOS-GATE-01, both-ready) ──────────────────────────────────────────────────────────

  /** `versus_ranked_duos__close_at`. */
  closeAt(): number | null {
    const m = this.m;
    const live = this.stillIn();
    if (live.length && live.every((s) => s.locked || s.auto || s.left_at != null)) {
      const times = live.map((s) => (s.locked ? s.locked_at : null) ?? (s.auto ? s.auto_since : null) ?? s.left_at ?? s.locked_at ?? null)
        .filter((x): x is number => x != null);
      return times.length ? Math.max(...times) : this.rh.now();
    }
    if (m.shop_deadline == null) return null;
    return m.shop_deadline + OVERTIME_MS;
  }

  protected override submitDeadline(): number | null {
    const c = this.closeAt();
    return c == null ? null : c + SHOP_GRACE_MS;
  }

  protected override onLocked(seat: GSeat): void {
    const c = this.closeAt();
    const now = this.rh.now();
    this.row(seat).locked_at = Math.min(now, c ?? now);
  }

  /** `versus_ranked_duos__maybe_close` (replaces the group's "everyone locked"). */
  protected override maybeResolve(): void {
    const m = this.m;
    if (m.phase !== 'shop') return;
    const c = this.closeAt();
    if (c == null || this.rh.now() < c) return;
    for (const s of this.stillIn()) if (!s.locked) this.finalizeSeat(s.seat, s.auto || s.left_at != null);
    m.phase = 'resolving';
    this.touch();
    this.rh.event('close');
    this.pending = true;
  }

  override alarms(): (number | null)[] {
    const m = this.m;
    if (!this.running()) return [];
    const out: (number | null)[] = [this.r.seat_retry_at];
    if (m.phase === 'hero_select') out.push(m.hero_deadline);
    else if (m.phase === 'shop') out.push(m.shop_deadline == null ? m.intro_deadline : this.closeAt());
    else if (m.phase === 'combat') out.push(m.combat_deadline);
    // The abandon backstop: every live player silent for 10 minutes.
    return out;
  }

  // ── hero select: a clock pick never lands on the teammate's hero (GroupEngine's unique pick, R-VERSUS-UNIQUE-HEROES-01) ──

  protected override maybeStart(): void {
    if (this.m.phase !== 'hero_select') return;
    super.maybeStart();
    if (this.m.phase !== 'hero_select' && this.r.seated_at == null) this.askSeat();
  }

  private askSeat(): void {
    this.r.seat_retry_at = this.rh.now() + SEAT_RETRY_MS;
    this.rh.needSeat();
  }

  // ── the table (`seat_ranked_duos`, the shell feeds the samples) ─────────────────────────────────────────────────

  /** Run the Edge Function's seating handler with the shell's Supabase samples, and seat what it chose. */
  async seat(service: RankedService): Promise<void> {
    if (this.r.seated_at != null || !this.running()) return;
    const m = this.m;
    let names: Record<string, string> = {};
    const store: RankedDuosSeatStore = {
      match: async () => ({ id: m.id, phase: m.phase, seed: m.seed, set_id: m.set_id, options: m.options as never, ranked_team: this.r.ranked_team, seated_at: null }),
      liveHeroes: async () => this.liveSeats().sort((a, b) => a.seat.localeCompare(b.seat)).map((s) => s.hero),
      teamDivision: async () => this.r.division,
      soloSample: async (args) => (await service.soloSample(args)) as never,
      duoSample: async (args) => { const x = await service.duoSample(args); names = x.names; return x.rows as never; },
      commit: async ({ p_table }) => { this.seatTable(p_table as Record<string, unknown>, names); return { seated: true }; },
      log: (msg, detail) => console.warn(msg, detail),
    };
    const res = await handleRankedDuosSeat(m.seats[0]!.user_id, { matchId: m.id }, store);
    if (res.status !== 200) throw new Error(`seat ${res.status} ${JSON.stringify(res.body)}`);
  }

  /** `versus_ranked_duos_seat`: store the three recorded teams (whole recordings) and mark the match seated. */
  seatTable(table: Record<string, unknown>, names: Record<string, string>): void {
    if (this.r.seated_at != null) return;
    const teams = table.teams as { team: string; kind: RankedTeam['served_kind']; duoRunId: string | null; recordedOrder: Record<string, 0 | 1> | null; members: { member: 0 | 1; kind: ServedMember['kind']; key: string; ownerId: string | null; name: string; heroId: string; recording: Record<string, unknown> }[] }[];
    if (!Array.isArray(teams) || teams.length !== 3) this.rh.fail('bad_table');
    const served: ServedMember[] = [];
    for (const t of teams) {
      for (const x of t.members) {
        served.push({ team: t.team, member: x.member, kind: x.kind, source_key: x.key, owner_id: /^[0-9a-f-]{36}$/.test(x.ownerId ?? '') ? x.ownerId : null, name: (x.name || 'Player').slice(0, 40), hero: x.heroId, recording: x.recording });
      }
      const rt = this.rteam(t.team);
      rt.served_kind = t.kind;
      rt.duo_run_id = t.duoRunId ?? null;
      rt.recorded_order = t.recordedOrder && typeof t.recordedOrder === 'object' ? t.recordedOrder : null;
      rt.name = (t.duoRunId && names[t.duoRunId]) || null;
    }
    this.g.served = served;
    this.rh.dirty('rserved');
    this.r.seated_at = this.rh.now();
    this.r.seat_retry_at = null;
    if (table.unrated === true) this.r.unrated = 'generated';
    this.touch();
    // A round that was already waiting on the table resolves now.
    if (this.m.phase === 'resolving') this.pending = true;
  }

  setTeam(info: { teamId: string | null; name: string | null; division: number }): void {
    this.r.ranked_team = info.teamId;
    this.r.team_name = info.name;
    this.r.division = info.division;
    this.touch();
  }

  // ── the round (`finalize_ranked_duos`) ──────────────────────────────────────────────────────────────────────────

  override async settle(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      const m = this.m;
      if (m.phase !== 'resolving') continue;
      if (this.r.seated_at == null) { this.askSeat(); continue; } // resolves once the table is seated
      const store: RankedDuosFinalizeStore = {
        input: async () => this.roundInput(),
        commit: async (args) => this.commitRanked(args),
        log: (msg, detail) => console.warn(msg, detail),
      };
      let res: { status: number; body: Record<string, unknown> };
      try {
        res = await (this.rh.rankedResolver ?? handleRankedDuosFinalize)(m.seats[0]!.user_id, { matchId: m.id, round: m.round }, engineContentRevision(), store);
      } catch (e) {
        res = { status: 500, body: { error: String(e) } };
      }
      if (res.status === 200 && m.phase !== 'resolving') this.rh.event('resolve_ok');
      else {
        this.rh.event('resolve_err', { status: res.status, body: res.body });
        if (m.phase === 'resolving') { this.rh.event('void'); this.r.unrated = 'void'; this.placeTeam(this.livingRanked(), 'abandoned', 'void'); }
      }
    }
  }

  /** `versus_ranked_duos_round_input`. */
  private roundInput(): Parameters<RankedDuosFinalizeStore['commit']>[0] extends never ? never : Awaited<ReturnType<RankedDuosFinalizeStore['input']>> {
    const m = this.m;
    const round = m.round;
    const teams = [...this.r.teams].sort((a, b) => a.team.localeCompare(b.team)).map((t) => {
      const at = t.eliminated_round != null && t.eliminated_round < round ? t.eliminated_round : round;
      const order = t.recorded_order;
      let recordedFirst: 0 | 1 | null = null;
      if (order) {
        const exact = order[String(at)];
        const keys = Object.keys(order).map(Number).sort((a, b) => b - a);
        recordedFirst = exact ?? (keys.length ? order[String(keys[0])]! : null);
      }
      const served = (this.g.served ?? []).filter((x) => x.team === t.team).sort((a, b) => a.member - b.member);
      return {
        team: t.team,
        kind: t.team === 'a' ? 'live' as const : (t.served_kind ?? 'generated'),
        health: t.health, armor: t.armor, eliminatedRound: t.eliminated_round, at,
        heroes: t.team === 'a' ? this.liveSeats().sort((a, b) => a.seat.localeCompare(b.seat)).map((s) => s.hero) : served.map((x) => x.hero),
        recordedFirst,
        members: t.team === 'a' ? [] : served.map((x) => ({ member: x.member, kind: x.kind, ...memberBoard(x.recording, at) })),
      };
    });
    const liveSide = (seat: GSeat) => {
      const sub = this.g.subs[seat];
      return sub && sub.round === round && sub.final ? { side: sub.prepared_side, source: sub.source } : null;
    };
    const history = Object.values(this.r.rounds).filter((r) => r.round < round).sort((a, b) => a.round - b.round)
      .flatMap((r) => r.fights.map((f) => ({ round: f.round, a: f.a_team, b: f.b_team, ...(f.ghost ? { bye: f.a_team } : {}) })));
    return {
      match: { id: m.id, phase: m.phase, round, seed: m.seed, content_revision: m.content_revision, options: m.options as never, seated: this.r.seated_at != null },
      teams: teams as never,
      live: { p1: liveSide('p1'), p2: liveSide('p2') },
      history: history as never,
    } as never;
  }

  /** `versus_ranked_duos_commit_round`. */
  private commitRanked(args: Parameters<RankedDuosFinalizeStore['commit']>[0]): unknown {
    const m = this.m;
    if (this.r.rounds[args.p_round]) return { alreadyCommitted: true };
    if (m.phase !== 'resolving' || m.round !== args.p_round) this.rh.fail('not_resolving');
    const res = args.p_result as { fights: { fight: number; a: string; b: string; ghost: boolean; chair: 'a' | 'b'; outcome: 'a' | 'b' | 'draw'; loser: string | null; damage: number; first: Record<string, 0 | 1>; liveResult?: unknown }[]; vitals: Record<string, { health: number; armor: number }>; placed: { team: string; placement: number }[]; liveFirst: 0 | 1 | null };
    const fights: RankedFightRow[] = res.fights.map((f) => ({
      round: args.p_round, fight: f.fight, a_team: f.a, b_team: f.b, ghost: !!f.ghost, chair: f.chair, outcome: f.outcome, loser: f.loser ?? null,
      damage: f.damage, first: f.first ?? null, live_result: f.a === 'a' || f.b === 'a' ? f.liveResult ?? null : null,
    }));
    for (const t of this.r.teams) {
      if (t.eliminated_round != null) continue;
      const v = res.vitals[t.team];
      if (v) { t.health = v.health; t.armor = v.armor; }
    }
    const live = this.rteam('a');
    for (const s of this.liveSeats()) { s.health = live.health; s.armor = live.armor; }
    let livePlace: number | null = null;
    const dead: string[] = [];
    for (const p of res.placed) {
      if (p.team === 'a') livePlace = p.placement;
      else {
        const t = this.rteam(p.team);
        if (t.placement == null) {
          t.placement = p.placement;
          if (p.placement !== 1) { t.eliminated_round = args.p_round; t.out_reason = 'hearts'; }
        }
      }
      if (p.placement > 1) dead.push(p.team);
    }
    const row: RankedRound = {
      match_id: m.id, kind: 'ranked', round: args.p_round, digest: args.p_digest, vitals: res.vitals, eliminated: dead,
      first: res.liveFirst === 0 || res.liveFirst === 1 ? { a: `p${res.liveFirst + 1}` } : null, fights,
    };
    this.r.rounds[row.round] = row;
    this.rh.dirty(`rround:${row.round}`);
    this.rh.roundCommitted(row.round);
    for (const s of m.seats) s.ready = false;
    m.phase = 'combat';
    m.combat_deadline = this.rh.now() + 90_000;
    this.touch();
    if (livePlace == null && !this.r.teams.some((t) => t.team !== 'a' && t.eliminated_round == null)) livePlace = 1;
    if (livePlace != null) this.placeTeam(livePlace, 'hearts');
    return { alreadyCommitted: false };
  }

  // ── leaving, absence, the end ───────────────────────────────────────────────────────────────────────────────────

  /** Ranked: a live player who leaves (or concedes) is out of the PARTY: on auto for good; both gone = placed. */
  override eliminate(seat: GSeat, reason: GOutReason): void {
    const m = this.m;
    if (m.phase === 'complete') return;
    const s = this.row(seat);
    if (s.left_at != null) return;
    const now = this.rh.now();
    s.left_at = now; s.auto = true; s.auto_since = s.auto_since ?? now;
    this.touch();
    if (this.liveSeats().every((x) => x.left_at != null)) {
      this.placeTeam(this.livingRanked(), reason === 'missed' ? 'missed' : 'left');
      return;
    }
    this.maybeResolve();
  }

  override returned(userId: string, by: string): void {
    const s = this.m.seats.find((x) => x.user_id === userId);
    if (!s || !this.running() || s.left_at != null || s.eliminated_round != null) return;
    if (s.auto) { s.auto = false; s.auto_since = null; this.rh.event('auto_off', { seat: s.seat, by }); this.touch(); }
  }

  /** `versus_ranked_duos__place_team` for the live team: placement, rating settle + duo run (the finish job), the end. */
  private placeTeam(placement: number, reason: string, endReason?: string): void {
    const m = this.m;
    if (m.phase === 'complete') return;
    const live = this.rteam('a');
    const why = (['hearts', 'forfeit', 'left', 'missed'].includes(reason) ? reason : 'left') as GOutReason;
    if (live.placement == null) {
      live.placement = placement;
      if (placement !== 1) { live.eliminated_round = live.eliminated_round ?? m.round; live.out_reason = live.out_reason ?? why; }
    }
    for (const s of this.liveSeats()) {
      s.placement = placement;
      if (placement !== 1) { s.eliminated_round = s.eliminated_round ?? m.round; s.out_reason = s.out_reason ?? why; s.auto = false; }
    }
    const unrated = this.r.unrated ?? (this.r.seated_at == null ? 'not_seated' : null);
    this.r.unrated = unrated;
    const now = this.rh.now();
    m.phase = 'complete';
    m.winner_seat = placement === 1 ? 'p1' : null;
    m.end_reason = (endReason ?? (['hearts', 'forfeit', 'missed', 'abandoned'].includes(reason) ? reason : reason === 'left' ? 'abandoned' : 'hearts')) as never;
    m.paused_seat = null; m.paused_at = null; m.pause_grace_until = null; m.resume_at = null;
    m.completed_at = now;
    this.touch();
    this.rh.matchEnded();
    this.rh.persist('ranked_finish' as never, this.finishRow(placement));
  }

  /** The writer's `ranked_finish` job: every row the Supabase build would hold, the settle and the duo run, at once. */
  private finishRow(placement: number): Record<string, unknown> {
    const m = this.m;
    const j = this.json();
    delete j.serverNow;
    const subs = Object.values(this.r.rounds).length ? this.liveSubmissions() : [];
    return fitFinishRow({
      match: { ...j, room_id: null, ranked_team: this.r.ranked_team, unrated: this.r.unrated, seated_at: this.r.seated_at == null ? null : new Date(this.r.seated_at).toISOString() },
      seats: m.seats.map(wireSeat), teams: this.r.teams, served: this.g.served ?? [],
      rounds: Object.values(this.r.rounds).sort((a, b) => a.round - b.round), submissions: subs, placement,
      // DUOS MATCH HISTORY (R-DUOS-HISTORY-01): built from memory BEFORE the fit, so a trimmed recording never empties it.
      history: this.rankedHistory(),
    });
  }

  /** RANKED DUOS: the finished game's history record. The live pair's last fought boards; each recorded member's board
   *  from its recording at the round its team went out (or the end round), the same board the table fielded. */
  rankedHistory(): DuosHistoryRecord {
    const m = this.m;
    const end = Math.max(m.round, 1);
    const liveBoard = (seat: GSeat): ReturnType<typeof duosBoardOfSide> => {
      const sub = this.g.subs[seat];
      if (sub && sub.final && sub.prepared_side != null) return duosBoardOfSide(sub.prepared_side, sub.round, sub.scout?.runes);
      const h = (this.g.history ?? []).filter((x) => x.seat === seat).sort((a, b) => b.round - a.round)[0];
      return h ? duosBoardOfSide(h.prepared_side, h.round) : null;
    };
    const servedBoard = (v: ServedMember, at: number): ReturnType<typeof duosBoardOfSide> => {
      const b = memberBoard(v.recording, at);
      return b.form === 'snapshot' ? duosBoardOfSnapshot(b.board, at) : b.form === 'side' ? duosBoardOfSide(b.board, at) : null;
    };
    return buildDuosHistory({
      mode: 'ranked_duos', endRound: m.round, startedAt: toIso(m.created_at), endedAt: toIso(m.completed_at),
      teams: this.r.teams.map((t) => {
        const at = t.eliminated_round != null && t.eliminated_round < end ? t.eliminated_round : end;
        const live = t.team === 'a';
        return {
          team: t.team, kind: live ? 'live' as const : (t.served_kind ?? 'generated'), name: live ? this.r.team_name : t.name,
          placement: t.placement, outRound: t.eliminated_round,
          members: live
            ? this.liveSeats().sort((a, b) => a.seat.localeCompare(b.seat)).map((s) => ({ seat: s.seat, userId: s.user_id, name: s.name, heroId: s.hero, board: liveBoard(s.seat) }))
            : (this.g.served ?? []).filter((x) => x.team === t.team).sort((a, b) => a.member - b.member)
              .map((x) => ({ seat: `${x.team}${x.member}`, name: x.name, heroId: x.hero, board: servedBoard(x, at) })),
        };
      }),
    });
  }

  /** Every live seat's FINAL board per round (kept for the duo run recording; `versus_group_submissions` final rows). */
  private liveSubmissions(): { round: number; seat: GSeat; user_id: string; prepared_side: unknown; source: string }[] {
    return (this.g.history ?? []).filter((x) => x.seat === 'p1' || x.seat === 'p2');
  }

  /** Kept per round as the subs fold away (the duo run needs every round's final boards). */
  protected override foldSub(seat: GSeat, sub: { round: number; final: boolean; prepared_side: unknown; source: string; user_id: string }): void {
    if (!sub.final || (seat !== 'p1' && seat !== 'p2')) return;
    (this.g.history ??= []).push({ round: sub.round, seat, user_id: sub.user_id, prepared_side: sub.prepared_side, source: sub.source });
    this.rh.dirty(`rhist:${sub.round}`);
  }

  /** Ranked reconcile: no pause; absent players go on auto at once; deadlines; the 10 minute abandon. */
  override reconcile(): void {
    const m = this.m;
    if (!this.running()) return;
    const now = this.rh.now();
    for (const s of this.stillIn()) {
      if (!s.auto && s.left_at == null && this.rh.userGone(s.user_id)) {
        s.auto = true; s.auto_since = now;
        this.rh.event('auto_on', { seat: s.seat });
        this.touch();
      }
    }
    const silent = this.liveSeats().filter((s) => s.left_at == null);
    if (silent.length && silent.every((s) => this.rh.goneFor(s.user_id) >= ABANDON_MS)) {
      this.placeTeam(this.livingRanked(), 'abandoned');
      return;
    }
    if (this.r.seated_at == null && this.r.seat_retry_at != null && now >= this.r.seat_retry_at && m.heroes_revealed) this.askSeat();
    if (m.phase === 'hero_select' && now >= (m.hero_deadline ?? 0)) this.maybeStart();
    else if (m.phase === 'shop' && m.shop_deadline == null) {
      if (now >= (m.intro_deadline ?? 0)) this.startClock(); else this.maybeClock();
    } else if (m.phase === 'shop') this.maybeResolve();
    else if (m.phase === 'combat' && now >= (m.combat_deadline ?? Infinity)) this.openShop(m.round + 1);
  }

  /** `versus_ranked_duos__json`. */
  override json(): Record<string, unknown> {
    const base = super.json();
    const m = this.m;
    const ended: Record<string, string | null> = {};
    const left: Record<string, string | null> = {};
    for (const s of m.seats) {
      ended[s.seat] = toIso((s.locked ? s.locked_at : null) ?? (s.auto ? s.auto_since : null) ?? null);
      if (s.left_at != null) left[s.seat] = toIso(s.left_at);
    }
    return {
      ...base,
      closeAt: m.phase === 'shop' ? toIso(this.closeAt()) : null,
      seated: this.r.seated_at != null,
      seated_at: toIso(this.r.seated_at),
      unrated: this.r.unrated,
      ranked_team: this.r.ranked_team,
      endedAt: ended,
      leftAt: left,
      teams: this.r.teams.map((t) => ({ team: t.team, kind: t.served_kind ?? 'live', placement: t.placement, eliminatedRound: t.eliminated_round })),
      teamName: this.r.team_name,
    };
  }

  /** `versus_ranked_duos_table`: the recorded teams, their names, heroes and this round's boards. */
  table(): Record<string, unknown> {
    const m = this.m;
    const round = Math.max(m.round, 1);
    const atOf = (t: RankedTeam): number => (t.eliminated_round != null && t.eliminated_round < round ? t.eliminated_round : round);
    const served = (this.g.served ?? []).map((v) => {
      const t = this.rteam(v.team);
      const b = memberBoard(v.recording, atOf(t));
      const board = b.form === 'snapshot' ? { minions: (b.board as { minions?: unknown }).minions, tier: (b.board as { tier?: unknown }).tier }
        : b.form === 'side' ? { minions: (b.board as { board?: unknown }).board, tier: (b.board as { state?: { tier?: unknown } }).state?.tier } : null;
      return { team: v.team, member: v.member, name: v.name, hero: v.hero, kind: v.kind, board };
    }).sort((a, b) => a.team.localeCompare(b.team) || a.member - b.member);
    const orders: Record<string, 0 | 1> = {};
    const teamNames: Record<string, string> = {};
    for (const t of this.r.teams) {
      if (t.recorded_order) {
        const o = t.recorded_order;
        const keys = Object.keys(o).map(Number).sort((a, b) => b - a);
        const v = o[String(atOf(t))] ?? (keys.length ? o[String(keys[0])] : undefined);
        if (v === 0 || v === 1) orders[t.team] = v;
      }
      if (t.name) teamNames[t.team] = t.name;
    }
    return { round: m.round, teamName: this.r.team_name, served, orders, teamNames };
  }

  teamsJson(): Record<string, unknown>[] {
    return this.r.teams.map((t) => ({ team: t.team, health: t.health, armor: t.armor, eliminated_round: t.eliminated_round, placement: t.placement, served_kind: t.served_kind }));
  }

  rankedRoundsFrom(from: number): RankedRound[] {
    return Object.values(this.r.rounds).filter((r) => r.round >= from).sort((a, b) => a.round - b.round);
  }
}

const toIso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());

/** A seat's out reasons the `versus_group_seats` check allows (a team's own 'abandoned' is a seat that left). */
const SEAT_OUT = new Set(['hearts', 'forfeit', 'left', 'missed']);

/**
 * One seat as the `ranked_finish` writer stores it (R-VERSUS-CF-PERSIST-01, fix/versus-cf-duos-parity): the room keeps
 * its moments as epoch ms, but `versus_group_seats.locked_at` / `auto_since` / `left_at` are timestamptz, so a raw seat
 * made `jsonb_populate_record` throw ("date/time field value out of range") and the WHOLE result never landed (no match
 * row, no rating, no duo run; the client's result screen waited on it and gave up). Times go as ISO; an out reason the
 * seat table does not allow ('abandoned', a team's own) goes as 'left'. Idempotent: an already-wire seat is unchanged.
 */
export function wireSeat(s: Record<string, unknown> | GSeatRow): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(s as Record<string, unknown>) };
  for (const k of ['locked_at', 'auto_since', 'left_at']) if (typeof out[k] === 'number') out[k] = toIso(out[k] as number);
  if (out.out_reason != null && !SEAT_OUT.has(String(out.out_reason))) out.out_reason = 'left';
  return out;
}

/**
 * The most a `ranked_finish` row may weigh as JSON (R-VERSUS-CF-PERSIST-01). Two hard limits sit above it: the writer
 * refuses a row over 2 MB (`versus_cf_persist`'s `bad_row`, measured on jsonb text, which is a little LARGER than the
 * JSON) and a Durable Object storage value is at most 2 MB (the job is stored in the outbox before it is sent). A long
 * Ranked Duos match (every fight's full event log, six whole recordings, every final board) can pass both, and then the
 * result is never stored or written at all. 1.5 MB keeps a margin for the jsonb text form.
 */
export const RANKED_FINISH_BUDGET = 1_500_000;

/**
 * Fit a `ranked_finish` row into the budget by dropping ARCHIVE-ONLY data, heaviest first, never what the rating or the
 * duo run needs (the match, seats, teams, placement, every round's vitals / outcome / damage, and the live seats' final
 * boards that `versus_ranked_duos__record_run` records):
 *   1. the served members' whole recordings (a stub keeps the row valid: the table is never read after the match);
 *   2. the live team's fight event logs (`live_result`), oldest round first (the outcome and damage stay).
 * Pure; returns the row unchanged when it already fits.
 */
export function fitFinishRow(row: Record<string, unknown>, budget = RANKED_FINISH_BUDGET): Record<string, unknown> {
  const size = (x: unknown): number => JSON.stringify(x).length;
  if (size(row) <= budget) return row;
  let out: Record<string, unknown> = {
    ...row,
    served: ((row.served ?? []) as Record<string, unknown>[]).map((s) => ({ ...s, recording: { kind: (s.recording as { kind?: unknown } | null)?.kind ?? 'none', trimmed: true } })),
  };
  if (size(out) <= budget) return out;
  const rounds = ((out.rounds ?? []) as { fights?: Record<string, unknown>[] }[]).map((r) => ({ ...r, fights: (r.fights ?? []).map((f) => ({ ...f })) }));
  out = { ...out, rounds };
  let total = size(out);
  for (const r of rounds) {
    for (const f of r.fights) {
      if (total <= budget) return out;
      if (f.live_result == null) continue;
      total -= size(f.live_result) - 4; // "null"
      f.live_result = null;
    }
  }
  return out;
}

/** A queued `ranked_finish` row made wire-safe at write time (a job queued by an older build still lands). */
export function rankedFinishWire(row: Record<string, unknown>): Record<string, unknown> {
  return Array.isArray(row.seats) ? { ...row, seats: (row.seats as Record<string, unknown>[]).map(wireSeat) } : row;
}

/** A new Ranked Duos state: the group match (2 live seats, team a) + the four teams; recorded teams are seated later. */
export function rankedExtra(): RankedExtra {
  return {
    ranked_team: null, team_name: null, division: 0, seated_at: null, unrated: null, team_asked: false, seat_retry_at: null,
    teams: ['a', 'b', 'c', 'd'].map((team) => ({
      team, health: null, armor: null, eliminated_round: null, out_reason: null, placement: null,
      served_kind: null, duo_run_id: null, recorded_order: null, name: null,
    })),
    rounds: {},
  };
}

export { GSEATS };
