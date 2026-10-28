/**
 * VERSUS ON CLOUDFLARE — the 3-4 player GROUP match (port of `2026-10-24-versus-group.sql` and its follow-ups: knockout
 * to the stands, health, ready signal, live armor, server reliability). Owner rulings R-VERSUS-GROUP-01..08.
 *
 * The room (`roomCore.ts`) owns members, seats, the gate and presence; this engine owns one group match: hero select,
 * the shop clock, End Turn as a ready signal, the round-robin round (pairings incl. Copy boards and ghosts, from
 * `versusGroupPairings`, resolved by the Edge Function's own `handleVersusGroupFinalize` over an in-memory store),
 * Health/Armor with the lobby cap, knockouts (together, sharing a placement; the wipeout guard), missed rounds, pauses
 * with auto-resume, `void` on an unresolvable round, and the end. Row shapes are the SQL's (`versus_group__match_json`,
 * `versus_group_rounds` + `versus_group_fights`), so the existing Group client reads them unchanged.
 *
 * Synchronous except the resolve; `now` and seeds come from the host.
 */
import {
  engineContentRevision,
  handleVersusDuosFinalize,
  handleVersusGroupFinalize,
  normalizeVersusOptions,
  reportedVitals,
  versusArmorFloorMax,
  versusFreshSide,
  VERSUS_COMBAT_VIEW_CAP_SECONDS,
  VERSUS_HERO_SELECT_SECONDS,
  VERSUS_INTRO_CAP_SECONDS,
  VERSUS_LIMITS,
  VERSUS_MISSED_ROUNDS_FORFEIT,
  VERSUS_PAUSE_GRACE_SECONDS,
  type VersusDuosFinalizeStore,
  type VersusGroupFinalizeStore,
} from '@game/sim/versus/server';

/** VERSUS DUOS (2v2 tag-team, owner 2026-10-25, R-DUOS-01): seats 1-2 are team a, 3-4 team b. */
export type GTeamId = 'a' | 'b';
import type { RankedExtra, ServedMember } from './rankedMatch';
export const teamOf = (seat: GSeat): GTeamId => (seat === 'p1' || seat === 'p2' ? 'a' : 'b');
export const mateOf = (seat: GSeat): GSeat => ({ p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } as const)[seat];
export const teamSeats = (team: GTeamId): [GSeat, GSeat] => (team === 'a' ? ['p1', 'p2'] : ['p3', 'p4']);
/** Passes a seat may send per round (`VERSUS_DUOS_PASS_CAP`), and a passed card's size cap. */
export const DUOS_PASS_CAP = 10;
const PASS_CARD_BYTES = 16_384;

/** A team's shared pool and its fate (`versus_group_teams`). */
export interface GTeam {
  team: GTeamId;
  health: number | null;
  armor: number | null;
  eliminated_round: number | null;
  out_reason: GOutReason | null;
  placement: number | null;
}

/** One pass to the teammate (`versus_duos_passes`). */
export interface GPass {
  match_id: string;
  round: number;
  from_seat: GSeat;
  to_seat: GSeat;
  seq: number;
  card: Record<string, unknown>;
  status: 'sent' | 'landed' | 'refused';
  created_at: string;
  answered_at: string | null;
}

export type GSeat = 'p1' | 'p2' | 'p3' | 'p4';
export const GSEATS: readonly GSeat[] = ['p1', 'p2', 'p3', 'p4'];

const SHOP_GRACE_MS = 250;
const COMBAT_LAST_READY_MS = 5_000;
const RESUME_COUNTDOWN_MS = 3_000;
const ABANDON_MS = 10 * 60_000;
const CHECKPOINT_BYTES = 1_048_576;
const SCOUT_BYTES = 8_192;

export type GOutReason = 'hearts' | 'forfeit' | 'left' | 'missed';
export type GEndReason = 'hearts' | 'forfeit' | 'missed' | 'abandoned' | 'void';

export interface GSeatRow {
  seat: GSeat;
  user_id: string;
  name: string;
  health: number | null;
  armor: number | null;
  hero: string | null;
  locked: boolean;
  ready: boolean;
  intro: boolean;
  auto: boolean;
  missed: number;
  eliminated_round: number | null;
  out_reason: GOutReason | null;
  placement: number | null;
  /** VERSUS DUOS: the seat's team, and its free hand slots (the pass refusal, `versus_duos_hand_room`). */
  team?: GTeamId | null;
  hand_room?: number | null;
  /** RANKED DUOS: when the seat ended its turn, went auto, left the party for good. */
  locked_at?: number | null;
  auto_since?: number | null;
  left_at?: number | null;
}

export interface GMatch {
  id: string;
  room_id: string;
  seed: number;
  set_id: string;
  content_revision: string;
  protocol: number;
  options: Record<string, unknown>;
  phase: 'hero_select' | 'shop' | 'resolving' | 'combat' | 'complete';
  revision: number;
  round: number;
  seat_count: number;
  heroes_revealed: boolean;
  hero_deadline: number | null;
  shop_starts_at: number | null;
  shop_deadline: number | null;
  intro_deadline: number | null;
  combat_deadline: number | null;
  paused_seat: GSeat | null;
  paused_at: number | null;
  pause_grace_until: number | null;
  resume_at: number | null;
  winner_seat: GSeat | null;
  end_reason: GEndReason | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  seats: GSeatRow[];
  /** VERSUS DUOS: the two teams' pools (absent on a Group match). */
  teams?: GTeam[];
  /** VERSUS DUOS: always null (the order is the seeded 50/50 every client derives, R-DUOS-ORDER-01). */
  duos_first?: null;
}

export interface GPriv {
  match_id: string;
  seat: GSeat;
  user_id: string;
  hero_seed: number;
  run_seed: number;
  hero_offer: string[] | null;
  hero_index: number | null;
  hero_auto: boolean;
  hero_reroll: { slot: number; from: string; to: string } | null;
}

export interface GSub {
  round: number;
  seat: GSeat;
  user_id: string;
  candidate_seq: number;
  prepared_side: unknown;
  final: boolean;
  source: 'candidate' | 'lock' | 'deadline' | 'auto' | 'empty';
  checkpoint: unknown;
  scout: Record<string, unknown> | null;
}

/** One fight, exactly the `versus_group_fights` row. */
export interface GFightRow {
  round: number;
  fight: number;
  a_seat: GSeat;
  b_seat: GSeat;
  b_copy: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  heart_lost_by: GSeat | null;
  damage: number;
  a_result: unknown;
  b_result: unknown;
  a_scout: Record<string, unknown>;
  b_scout: Record<string, unknown>;
}

/** One committed round, the client's `VersusGroupRoundRaw` (`versus_group_rounds` + its fights). */
export interface GRound {
  match_id: string;
  round: number;
  digest: string;
  vitals: Partial<Record<GSeat, { health: number; armor: number }>>;
  eliminated: GSeat[];
  fights: GFightRow[];
}

export interface GroupState {
  match: GMatch;
  priv: Partial<Record<GSeat, GPriv>>;
  subs: Partial<Record<GSeat, GSub>>;
  lastLocked: Partial<Record<GSeat, unknown>>;
  lastCheckpoint: Partial<Record<GSeat, { round: number; final: true; candidate_seq: number; checkpoint: unknown }>>;
  rounds: Record<number, GRound>;
  /** VERSUS DUOS: every pass, by round (stored as `gpass:<round>`). */
  passes?: Record<number, GPass[]>;
  /** RANKED DUOS: the ranked state (`meta`), the served recordings (`rserved`), the live seats' final boards per round
   *  (`rhist:<round>`, for the duo run recording). */
  ranked?: RankedExtra;
  served?: ServedMember[];
  history?: { round: number; seat: GSeat; user_id: string; prepared_side: unknown; source: string }[];
}

/** What the engine needs from the room. */
export interface GroupHost {
  now(): number;
  random31(): number;
  uuid(): string;
  /** No open socket past the grace. */
  userGone(userId: string): boolean;
  /** How long `userId` has had no open socket (0 while connected). */
  goneFor(userId: string): number;
  touchMatch(): void;
  touchPriv(seat: GSeat): void;
  dirty(key: string): void;
  event(kind: string, detail?: Record<string, unknown>): void;
  persist(kind: 'group_match' | 'group_round', row: Record<string, unknown>): void;
  roundCommitted(n: number): void;
  /** VERSUS DUOS: a pass row changed (pushed to that team's two seats only). */
  passChanged?(row: GPass): void;
  duosResolver?: typeof handleVersusDuosFinalize;
  /** A knocked-out player moves to the room's stands (R-VERSUS-GROUP-06). */
  toStands(userId: string): void;
  /** The match ended: the room is Open again. */
  matchEnded(): void;
  fail(code: string): never;
  resolver?: typeof handleVersusGroupFinalize;
  onResolve?(round: number, ms: number): void;
  perfNow?(): number;
}

const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());
const jsonBytes = (v: unknown): number => (v == null ? 0 : new TextEncoder().encode(JSON.stringify(v)).length);

function seededPick(seed: number, label: string, n: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${label}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

function turnSeconds(round: number): number {
  return Math.max(21, Math.min(80, 18 + (round - 1) * 4 + (round >= 6 ? 6 : 0)) + (round >= 12 ? 12 : 0));
}

/** A new group match for the seated members (in seat order). */
export function newGroupState(host: GroupHost, room: { id: string; set_id: string; content_revision: string; protocol: number; options: Record<string, unknown> },
  seated: { seat: GSeat; userId: string; name: string }[]): GroupState {
  const now = host.now();
  const id = host.uuid();
  const seats = [...seated].sort((a, b) => GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat));
  const match: GMatch = {
    id, room_id: room.id, seed: host.random31(), set_id: room.set_id, content_revision: room.content_revision, protocol: room.protocol,
    options: normalizeVersusOptions(room.options) as unknown as Record<string, unknown>, phase: 'hero_select', revision: 1, round: 0,
    seat_count: seats.length, heroes_revealed: false, hero_deadline: now + VERSUS_HERO_SELECT_SECONDS * 1000, shop_starts_at: null,
    shop_deadline: null, intro_deadline: null, combat_deadline: null, paused_seat: null, paused_at: null, pause_grace_until: null,
    resume_at: null, winner_seat: null, end_reason: null, created_at: now, updated_at: now, completed_at: null,
    seats: seats.map((s) => ({
      seat: s.seat, user_id: s.userId, name: s.name, health: null, armor: null, hero: null, locked: false, ready: false, intro: false,
      auto: false, missed: 0, eliminated_round: null, out_reason: null, placement: null,
    })),
  };
  if (match.options.mode === 'duos') {
    for (const s of match.seats) { s.team = teamOf(s.seat); s.hand_room = null; }
    match.teams = (['a', 'b'] as const).map((team) => ({ team, health: null, armor: null, eliminated_round: null, out_reason: null, placement: null }));
    match.duos_first = null;
  }
  const priv: GroupState['priv'] = {};
  for (const s of seats) {
    priv[s.seat] = { match_id: id, seat: s.seat, user_id: s.userId, hero_seed: host.random31(), run_seed: host.random31(), hero_offer: null, hero_index: null, hero_auto: false, hero_reroll: null };
  }
  return { match, priv, subs: {}, lastLocked: {}, lastCheckpoint: {}, rounds: {} };
}

export class GroupEngine {
  protected pending = false;
  constructor(public g: GroupState, private readonly h: GroupHost) {}

  /** The last moment a side may still land this round (Ranked Duos: its close + grace). Null = no clock yet. */
  protected submitDeadline(): number | null {
    return this.m.shop_deadline == null ? null : this.m.shop_deadline + SHOP_GRACE_MS;
  }

  /** A seat just ended its turn (Ranked Duos stamps when). */
  protected onLocked(_seat: GSeat): void {}

  /** A seat's submission of an earlier round is folded away (Ranked Duos keeps the live boards for the duo run). */
  protected foldSub(_seat: GSeat, _sub: GSub): void {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────────

  get m(): GMatch { return this.g.match; }
  get duos(): boolean { return this.m.options.mode === 'duos'; }
  protected team(id: GTeamId): GTeam { return this.m.teams!.find((x) => x.team === id)!; }
  protected livingTeams(): number { return (this.m.teams ?? []).filter((x) => x.eliminated_round == null).length; }
  seatOf(userId: string): GSeat | null { return this.m.seats.find((s) => s.user_id === userId)?.seat ?? null; }
  row(seat: GSeat): GSeatRow { return this.m.seats.find((s) => s.seat === seat)!; }
  protected stillIn(): GSeatRow[] { return this.m.seats.filter((s) => s.eliminated_round == null); }
  living(): number { return this.stillIn().length; }
  running(): boolean { return this.m.phase !== 'complete'; }
  /** A seat that is still in (a player still in never gets pruned). */
  holdsLiveSeat(userId: string): boolean { const s = this.m.seats.find((x) => x.user_id === userId); return !!s && s.eliminated_round == null && this.running(); }

  json(): Record<string, unknown> {
    const m = this.m;
    const { seats, ...rest } = m;
    delete (rest as { teams?: unknown }).teams; // the SQL row has no teams column (the pools ride the seats)
    return {
      ...rest,
      hero_deadline: iso(m.hero_deadline), shop_starts_at: iso(m.shop_starts_at), shop_deadline: iso(m.shop_deadline),
      intro_deadline: iso(m.intro_deadline), combat_deadline: iso(m.combat_deadline), paused_at: iso(m.paused_at),
      pause_grace_until: iso(m.pause_grace_until), resume_at: iso(m.resume_at), created_at: iso(m.created_at),
      updated_at: iso(m.updated_at), completed_at: iso(m.completed_at), serverNow: iso(this.h.now()),
      seats: seats.map((s) => ({
        seat: s.seat, userId: s.user_id, name: s.name, hearts: null, health: s.health, armor: s.armor, hero: s.hero, locked: s.locked,
        ready: s.ready, intro: s.intro, auto: s.auto, missed: s.missed, eliminatedRound: s.eliminated_round, outReason: s.out_reason, placement: s.placement,
      })),
    };
  }

  privJson(seat: GSeat): Record<string, unknown> | null {
    const p = this.g.priv[seat];
    return p ? { ...p } : null;
  }

  roundsFrom(from: number): GRound[] {
    return Object.values(this.g.rounds).filter((r) => r.round >= from).sort((a, b) => a.round - b.round);
  }

  myCheckpoint(seat: GSeat): unknown {
    const cur = this.g.subs[seat];
    if (cur && cur.final && cur.checkpoint != null) return { round: cur.round, final: true, candidate_seq: cur.candidate_seq, checkpoint: cur.checkpoint };
    return this.g.lastCheckpoint[seat] ?? null;
  }

  /** Every future moment this match must wake for. */
  alarms(): (number | null)[] {
    const m = this.m;
    if (!this.running()) return [];
    if (m.paused_at != null) return [m.resume_at, m.pause_grace_until, m.paused_at + ABANDON_MS];
    if (m.phase === 'hero_select') return [m.hero_deadline];
    if (m.phase === 'shop') return [m.shop_deadline == null ? m.intro_deadline : m.shop_deadline + SHOP_GRACE_MS];
    if (m.phase === 'combat') return [m.combat_deadline];
    return [];
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

  protected touch(): void {
    this.m.revision += 1;
    this.m.updated_at = this.h.now();
    this.h.touchMatch();
  }

  protected requireLive(userId: string): GSeat {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (this.row(seat!).eliminated_round != null) this.h.fail('eliminated');
    return seat!;
  }

  protected matchRow(): Record<string, unknown> {
    const j = this.json();
    delete j.serverNow;
    return { ...j, room_id: null, seats: this.m.seats, ...(this.m.teams ? { teams: this.m.teams } : {}) };
  }

  // ── hero select ─────────────────────────────────────────────────────────────────────────────────────────────────

  registerOffer(userId: string, offer: unknown): void {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (!Array.isArray(offer) || offer.length !== 3 || offer.some((o) => typeof o !== 'string' || o.length === 0 || o.length > 32)) this.h.fail('bad_offer');
    const p = this.g.priv[seat!]!;
    if (p.hero_offer == null) { p.hero_offer = [...(offer as string[])]; this.h.touchPriv(seat!); }
  }

  pickHero(userId: string, index: unknown): void {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (this.m.phase !== 'hero_select') this.h.fail('wrong_phase');
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 2) this.h.fail('bad_index');
    if (this.h.now() >= (this.m.hero_deadline ?? 0)) { this.maybeStart(); this.h.fail('hero_deadline_passed'); }
    const p = this.g.priv[seat!]!;
    if (p.hero_index == null) { p.hero_index = index as number; this.h.touchPriv(seat!); }
    this.maybeStart();
  }

  reroll(userId: string, slot: unknown, candidates: unknown): { offer: string[]; reroll: { slot: number; from: string; to: string } } {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (this.m.phase !== 'hero_select') this.h.fail('wrong_phase');
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 2) this.h.fail('bad_index');
    if (this.h.now() >= (this.m.hero_deadline ?? 0)) this.h.fail('hero_deadline_passed');
    const p = this.g.priv[seat!]!;
    if (!p.hero_offer) this.h.fail('no_offer');
    if (p.hero_index != null) this.h.fail('already_picked');
    if (p.hero_reroll) this.h.fail('reroll_used');
    const c = Array.isArray(candidates) ? (candidates as unknown[]) : [];
    if (c.length < 1 || c.length > 128 || c.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 32)
      || new Set(c).size !== c.length || c.some((x) => p.hero_offer!.includes(x as string))) this.h.fail('bad_candidates');
    const to = c[seededPick(this.m.seed, `hero-reroll:${seat}`, c.length)] as string;
    const from = p.hero_offer![slot as number]!;
    p.hero_offer = p.hero_offer!.map((x, i) => (i === slot ? to : x));
    p.hero_reroll = { slot: slot as number, from, to };
    this.h.touchPriv(seat!);
    return { offer: [...p.hero_offer], reroll: { ...p.hero_reroll } };
  }

  /** `versus_group__maybe_start`: every seat still in picked (or the deadline): reveal, open round 1. */
  protected maybeStart(): void {
    const m = this.m;
    if (m.phase !== 'hero_select') return;
    const waiting = this.stillIn().some((s) => this.g.priv[s.seat]!.hero_index == null);
    if (this.h.now() < (m.hero_deadline ?? 0) && waiting) return;
    for (const s of m.seats) {
      const p = this.g.priv[s.seat]!;
      if (p.hero_index == null) { p.hero_index = seededPick(m.seed, `hero:${s.seat}`, 3); p.hero_auto = true; this.h.touchPriv(s.seat); }
      s.hero = p.hero_offer ? p.hero_offer[p.hero_index] ?? null : null;
    }
    m.heroes_revealed = true;
    this.openShop(1);
  }

  // ── the shop ────────────────────────────────────────────────────────────────────────────────────────────────────

  protected openShop(round: number): void {
    const m = this.m;
    const now = this.h.now();
    const first = round === 1;
    for (const s of m.seats) { s.locked = false; s.ready = false; }
    m.phase = 'shop';
    m.round = round;
    m.shop_starts_at = first ? null : now;
    m.shop_deadline = first ? null : now + turnSeconds(round) * 1000;
    m.intro_deadline = first ? now + VERSUS_INTRO_CAP_SECONDS * 1000 : null;
    m.combat_deadline = null;
    for (const seat of GSEATS) {
      const sub = this.g.subs[seat];
      if (!sub || sub.round >= round) continue;
      this.foldSub(seat, sub);
      if (sub.final && sub.prepared_side != null) { this.g.lastLocked[seat] = sub.prepared_side; this.h.dirty(`glast:${seat}`); }
      if (sub.final && sub.checkpoint != null) {
        this.g.lastCheckpoint[seat] = { round: sub.round, final: true, candidate_seq: sub.candidate_seq, checkpoint: sub.checkpoint };
        this.h.dirty(`gckpt:${seat}`);
      }
      delete this.g.subs[seat];
      this.h.dirty(`gsub:${seat}`);
    }
    this.touch();
  }

  protected startClock(): void {
    const m = this.m;
    if (m.phase !== 'shop' || m.shop_deadline != null) return;
    const now = this.h.now();
    m.shop_starts_at = now;
    m.shop_deadline = now + turnSeconds(m.round) * 1000;
    m.intro_deadline = null;
    this.touch();
  }

  /** `versus_group__maybe_clock`: round 1's clock starts once every seat still in is through its intro (or on auto). */
  protected maybeClock(): void {
    const m = this.m;
    if (m.phase !== 'shop' || m.shop_deadline != null || m.paused_at != null) return;
    if (this.stillIn().some((s) => !(s.intro || s.auto))) return;
    this.startClock();
  }

  introDone(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (this.m.phase !== 'shop' || this.m.shop_deadline != null) return;
    this.row(seat!).intro = true;
    this.touch();
    this.maybeClock();
  }

  submit(userId: string, a: Record<string, unknown>): void {
    const m = this.m;
    const seat = this.requireLive(userId);
    const round = a.round;
    const seq = Number(a.seq);
    const final = a.final === true;
    if (m.phase !== 'shop' || m.round !== round) this.h.fail('stale_round');
    const dl = this.submitDeadline();
    if (m.paused_at == null && dl != null && this.h.now() >= dl) this.h.fail('deadline_passed');
    if (a.side == null || jsonBytes(a.side) > VERSUS_LIMITS.preparedSideBytes) this.h.fail('side_too_large');
    if (a.checkpoint != null && jsonBytes(a.checkpoint) > CHECKPOINT_BYTES) this.h.fail('checkpoint_too_large');
    const scout = a.scout && typeof a.scout === 'object' && !Array.isArray(a.scout) ? (a.scout as Record<string, unknown>) : null;
    if (a.scout != null && (!scout || jsonBytes(scout) > SCOUT_BYTES)) this.h.fail('scout_too_large');
    if (!Number.isInteger(seq)) this.h.fail('bad_seq');
    const cur = this.g.subs[seat]?.round === round ? this.g.subs[seat] : undefined;
    if (cur?.final) {
      if (!final || seq <= cur.candidate_seq) return;
      cur.candidate_seq = seq;
      cur.prepared_side = a.side;
      if (a.checkpoint != null) cur.checkpoint = a.checkpoint;
      if (scout) cur.scout = scout;
      this.h.dirty(`gsub:${seat}`);
      this.raiseArmor(seat, cur);
      return;
    }
    // R-VERSUS-CF-OFFLINE-LOCK-01 (owner 2026-10-28): a NEW lock from the seat the match is paused on is refused. Only a
    // lock the client sent while gone (its own 0:00 ran out offline; it waited in the socket queue) can arrive then, since
    // the screen takes no End Turn while paused; it must not close the round during the pause or its 3-2-1. The player
    // gets the paused shop time back. (A seat already locked before it left stays locked.)
    if (final && m.paused_at != null && m.paused_seat === seat) this.h.fail('paused');
    if (cur && seq <= cur.candidate_seq && !final) return;
    const next: GSub = {
      round: round as number, seat, user_id: userId, candidate_seq: Math.max(seq, cur?.candidate_seq ?? seq), prepared_side: a.side, final,
      source: final ? 'lock' : 'candidate', checkpoint: a.checkpoint ?? cur?.checkpoint ?? null, scout: scout ?? cur?.scout ?? null,
    };
    this.g.subs[seat] = next;
    this.h.dirty(`gsub:${seat}`);
    this.raiseArmor(seat, next);
    if (final) {
      this.row(seat).locked = true;
      this.onLocked(seat);
      this.touch();
      this.maybeResolve();
    }
  }

  /** R-VERSUS-LIVE-ARMOR-01 for one seat (`versus_group__raise_reported_armor`). */
  protected raiseArmor(seat: GSeat, sub: GSub): void {
    if (!['candidate', 'lock', 'deadline'].includes(sub.source)) return;
    if (this.m.phase !== 'shop' && this.m.phase !== 'resolving') return;
    const rep = reportedVitals(sub.prepared_side);
    const floor = versusArmorFloorMax();
    const s = this.row(seat);
    if (this.duos) {
      // A Duos team shares one pool: the raise lands on the team and both seats show it.
      const tm = this.team(teamOf(seat));
      if (!rep || tm.eliminated_round != null || tm.health == null || tm.armor == null || tm.armor >= floor || rep.armor <= tm.armor) return;
      tm.armor = Math.min(rep.armor, floor);
      for (const x of this.m.seats) if (x.team === tm.team) x.armor = tm.armor;
      this.touch();
      return;
    }
    if (!rep || s.eliminated_round != null || s.health == null || s.armor == null || s.armor >= floor || rep.armor <= s.armor) return;
    s.armor = Math.min(rep.armor, floor);
    this.touch();
  }

  unready(userId: string, round: unknown, seq: unknown): void {
    const m = this.m;
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (m.phase !== 'shop' || m.round !== round) this.h.fail('stale_round');
    if (m.shop_deadline == null || m.paused_at != null) this.h.fail('not_running');
    if (this.h.now() >= m.shop_deadline!) this.h.fail('deadline_passed');
    const s = this.row(seat!);
    if (s.eliminated_round != null || s.auto) this.h.fail('eliminated');
    const sub = this.g.subs[seat!];
    if (sub && sub.round === round) {
      sub.final = false;
      sub.source = 'candidate';
      sub.candidate_seq = Math.max(sub.candidate_seq, Number(seq) || 0);
      this.h.dirty(`gsub:${seat}`);
    }
    s.locked = false;
    this.touch();
  }

  /** `versus_group__finalize_seat`. */
  protected finalizeSeat(seat: GSeat, auto: boolean): void {
    const m = this.m;
    const s = this.row(seat);
    const last = this.g.lastLocked[seat] ?? null;
    const cur = this.g.subs[seat]?.round === m.round ? this.g.subs[seat] : undefined;
    if (auto) {
      if (cur) {
        const had = cur.prepared_side != null;
        cur.prepared_side = last ?? cur.prepared_side;
        cur.source = had ? 'deadline' : last == null ? 'empty' : 'auto';
        cur.final = true;
      } else {
        this.g.subs[seat] = { round: m.round, seat, user_id: s.user_id, candidate_seq: 0, prepared_side: last, final: true, source: last == null ? 'empty' : 'auto', checkpoint: null, scout: null };
      }
    } else if (cur && cur.prepared_side != null) {
      cur.final = true;
      cur.source = 'deadline';
    } else {
      this.g.subs[seat] = { round: m.round, seat, user_id: s.user_id, candidate_seq: 0, prepared_side: last, final: true, source: last == null ? 'empty' : 'auto', checkpoint: cur?.checkpoint ?? null, scout: cur?.scout ?? null };
    }
    s.locked = true;
    this.h.dirty(`gsub:${seat}`);
  }

  /** `versus_group__maybe_resolve`: every seat still in locked (or on auto) → resolving; ghosts of this round fight their last board. */
  protected maybeResolve(): void {
    const m = this.m;
    if (m.phase !== 'shop') return;
    if (this.stillIn().some((s) => !(s.locked || s.auto))) return;
    for (const s of m.seats) {
      if (s.locked) continue;
      if (s.eliminated_round == null || s.eliminated_round >= m.round) this.finalizeSeat(s.seat, true);
    }
    m.phase = 'resolving';
    this.touch();
    this.h.event('close');
    this.pending = true;
  }

  /** Resolve a `resolving` round with the Edge Function's own group handler over an in-memory store. */
  async settle(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      const m = this.m;
      if (m.phase !== 'resolving') continue;
      const t0 = this.h.perfNow?.() ?? 0;
      const store: VersusGroupFinalizeStore = {
        match: async () => ({ id: m.id, phase: m.phase, round: m.round, seed: m.seed, content_revision: m.content_revision, options: m.options as never }),
        seats: async () => m.seats.map((s) => ({ seat: s.seat, eliminated_round: s.eliminated_round, hero: s.hero, health: s.health, armor: s.armor })),
        finalSides: async () => {
          const out: Partial<Record<GSeat, unknown>> = {};
          for (const seat of GSEATS) {
            const sub = this.g.subs[seat];
            if (sub && sub.round === m.round && sub.final) out[seat] = versusFreshSide(sub.prepared_side, sub.source);
          }
          return out;
        },
        commit: async (args) => this.commitRound(args),
        log: (msg, detail) => console.warn(msg, detail),
      };
      let res: { status: number; body: Record<string, unknown> };
      try {
        res = this.duos
          ? await (this.h.duosResolver ?? handleVersusDuosFinalize)(m.seats[0]!.user_id, { matchId: m.id, round: m.round }, engineContentRevision(), this.duosStore())
          : await (this.h.resolver ?? handleVersusGroupFinalize)(m.seats[0]!.user_id, { matchId: m.id, round: m.round }, engineContentRevision(), store);
      } catch (e) {
        res = { status: 500, body: { error: String(e) } };
      }
      if (res.status === 200 && m.phase !== 'resolving') this.h.event('resolve_ok');
      else {
        this.h.event('resolve_err', { status: res.status, body: res.body });
        if (m.phase === 'resolving') { this.h.event('void'); this.complete(null, 'void'); }
      }
      this.h.onResolve?.(m.round, (this.h.perfNow?.() ?? 0) - t0);
    }
  }

  /** The Duos resolver's in-memory store (the Edge Function's `finalize_duos` reads). */
  protected duosStore(): VersusDuosFinalizeStore {
    const m = this.m;
    return {
      match: async () => ({ id: m.id, phase: m.phase, round: m.round, seed: m.seed, content_revision: m.content_revision, options: m.options as never }),
      finalSides: async () => {
        const out: Partial<Record<GSeat, unknown>> = {};
        for (const seat of GSEATS) {
          const sub = this.g.subs[seat];
          if (sub && sub.round === m.round && sub.final) out[seat] = versusFreshSide(sub.prepared_side, sub.source);
        }
        return out;
      },
      seats: async () => m.seats.map((s) => ({ seat: s.seat, hero: s.hero })),
      teams: async () => (m.teams ?? []).map((x) => ({ team: x.team, health: x.health, armor: x.armor })),
      commit: async (args) => this.commitDuos(args),
      log: (msg, detail) => console.warn(msg, detail),
    };
  }

  /** `versus_duos_commit_round`: ONE tag-team fight, the losing team's pool charged, a team at 0 out together. */
  protected commitDuos(args: Parameters<VersusDuosFinalizeStore['commit']>[0]): unknown {
    const m = this.m;
    if (this.g.rounds[args.p_round]) return { alreadyCommitted: true };
    if (m.phase !== 'resolving' || m.round !== args.p_round) this.h.fail('not_resolving');
    const now = this.h.now();
    const f = args.p_fight as { a: GSeat; b: GSeat; chair: 'a' | 'b'; outcome: 'a' | 'b' | 'draw'; losingTeam: GTeamId | null; damage: number; aResult: unknown; bResult: unknown };
    const scoutOf = (seat: GSeat): Record<string, unknown> => {
      const sub = this.g.subs[seat];
      const tier = (sub?.prepared_side as { state?: { tier?: unknown } } | null)?.state?.tier;
      return { ...(sub?.scout ?? {}), ...(tier != null ? { tier } : {}) };
    };
    const lose = f.losingTeam;
    const fight: GFightRow = {
      round: args.p_round, fight: 0, a_seat: f.a, b_seat: f.b, b_copy: false, chair: f.chair, outcome: f.outcome,
      heart_lost_by: lose === 'a' ? f.a : lose === 'b' ? f.b : null, damage: lose ? f.damage : 0,
      a_result: f.aResult, b_result: f.bResult, a_scout: scoutOf(f.a), b_scout: scoutOf(f.b),
    };
    for (const tm of m.teams!) {
      if (tm.eliminated_round != null) continue;
      const v = args.p_vitals[tm.team];
      if (v) { tm.health = v.health; tm.armor = v.armor; }
    }
    let dead: GSeat[] = [];
    let reason: GEndReason = 'hearts';
    if (lose) {
      const tm = this.team(lose);
      if (tm.eliminated_round == null && (tm.health ?? 1) <= 0) {
        const place = this.livingTeams();
        tm.eliminated_round = args.p_round; tm.out_reason = 'hearts'; tm.placement = place;
        dead = teamSeats(lose);
      }
    }
    for (const s of m.seats) if (s.eliminated_round == null) s.missed = s.auto ? s.missed + 1 : 0;
    if (dead.length === 0) {
      const missed = [...m.seats].filter((s) => s.eliminated_round == null && s.missed >= VERSUS_MISSED_ROUNDS_FORFEIT)
        .sort((a, b) => GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat))[0];
      if (missed) {
        const tm = this.team(teamOf(missed.seat));
        if (tm.eliminated_round == null) {
          const place = this.livingTeams();
          tm.eliminated_round = args.p_round; tm.out_reason = 'missed'; tm.placement = place;
          dead = teamSeats(tm.team);
          if (!lose) reason = 'missed';
        }
      }
    }
    // Every seat mirrors its team: pools, the knockout (a teammate who did not miss is out as 'forfeit'), placement.
    for (const s of m.seats) {
      const tm = this.team(s.team!);
      s.health = tm.health; s.armor = tm.armor;
      if (s.eliminated_round == null && tm.eliminated_round != null) {
        s.eliminated_round = tm.eliminated_round;
        s.out_reason = tm.out_reason === 'missed' && s.missed < VERSUS_MISSED_ROUNDS_FORFEIT ? 'forfeit' : tm.out_reason;
        s.auto = false;
        this.h.toStands(s.user_id);
      }
      if (tm.placement != null) s.placement = tm.placement;
    }
    const vitalsOut: GRound['vitals'] = {};
    for (const s of m.seats) if (s.health != null && s.armor != null) vitalsOut[s.seat] = { health: s.health, armor: s.armor };
    const row: GRound = { match_id: m.id, round: args.p_round, digest: args.p_digest, vitals: vitalsOut, eliminated: dead, fights: [fight] };
    this.g.rounds[row.round] = row;
    this.h.dirty(`ground:${row.round}`);
    this.h.roundCommitted(row.round);
    this.h.persist('group_round', row as unknown as Record<string, unknown>);
    for (const s of m.seats) s.ready = false;
    m.phase = 'combat';
    m.combat_deadline = now + VERSUS_COMBAT_VIEW_CAP_SECONDS * 1000;
    this.touch();
    if (this.livingTeams() <= 1) {
      const winner = [...m.seats].filter((s) => s.eliminated_round == null).sort((a, b) => GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat))[0];
      this.complete(winner?.seat ?? null, reason);
    } else this.h.persist('group_match', this.matchRow());
    return { alreadyCommitted: false };
  }

  // ── VERSUS DUOS: passing a card to the teammate (R-DUOS-PASS-01) ─────────────────────────────────────────────────

  /** `versus_duos_pass`: exactly once per seq; refused when the teammate's hand is full, they are away, or past the cap. */
  pass(userId: string, round: unknown, seq: unknown, card: unknown): GPass {
    const m = this.m;
    if (!this.duos) this.h.fail('not_duos');
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    const all = this.g.passes ?? (this.g.passes = {});
    const existing = Object.values(all).flat().find((p) => p.from_seat === seat && p.seq === seq);
    if (existing) return existing;
    if (m.phase !== 'shop' || m.round !== round) this.h.fail('not_shop');
    if (m.paused_at == null && m.shop_deadline != null && this.h.now() >= m.shop_deadline + SHOP_GRACE_MS) this.h.fail('deadline_passed');
    if (this.row(seat!).eliminated_round != null) this.h.fail('locked');
    const mate = mateOf(seat!);
    const mr = this.row(mate);
    if (mr.eliminated_round != null) this.h.fail('no_teammate');
    if (mr.auto || (m.paused_at != null && m.paused_seat === mate)) this.h.fail('teammate_away');
    const inFlight = Object.values(all).flat().filter((p) => p.to_seat === mate && p.status === 'sent').length;
    if (mr.hand_room != null && mr.hand_room - inFlight <= 0) this.h.fail('hand_full');
    const c = card as Record<string, unknown> | null;
    if (!Number.isInteger(seq) || (seq as number) < 0 || !c || typeof c !== 'object' || Array.isArray(c) || typeof c.cardId !== 'string'
      || jsonBytes(c) > PASS_CARD_BYTES || c.passFrom !== 'hand') this.h.fail('bad_card');
    const mine = (all[round as number] ?? []).filter((p) => p.from_seat === seat).length;
    if (mine >= DUOS_PASS_CAP) this.h.fail('too_many_passes');
    const row: GPass = {
      match_id: m.id, round: round as number, from_seat: seat!, to_seat: mate, seq: seq as number, card: c!, status: 'sent',
      created_at: new Date(this.h.now()).toISOString(), answered_at: null,
    };
    (all[row.round] ??= []).push(row);
    this.h.dirty(`gpass:${row.round}`);
    this.h.passChanged?.(row);
    return row;
  }

  /** `versus_duos_answer_pass`: the receiver's run landed it, or its full hand refused it. */
  answerPass(userId: string, fromSeat: unknown, seq: unknown, landed: unknown): GPass {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    const row = Object.values(this.g.passes ?? {}).flat().find((p) => p.from_seat === fromSeat && p.seq === seq);
    if (!row) this.h.fail('no_pass');
    if (row!.to_seat !== seat) this.h.fail('not_receiver');
    if (row!.status === 'sent') {
      row!.status = landed === true ? 'landed' : 'refused';
      row!.answered_at = new Date(this.h.now()).toISOString();
      this.h.dirty(`gpass:${row!.round}`);
      this.h.passChanged?.(row!);
    }
    return row!;
  }

  /** `versus_duos_hand_room`: my free hand slots. */
  handRoom(userId: string, room: unknown): void {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (!Number.isInteger(room) || (room as number) < 0 || (room as number) > 30) this.h.fail('bad_room');
    this.row(seat!).hand_room = room as number;
    this.h.dirty('meta');
  }

  /** My team's passes from `fromRound` on (the table's RLS: only the two teammates read them). */
  passesFor(userId: string, fromRound: number): GPass[] {
    const seat = this.seatOf(userId);
    if (!seat) return [];
    const mine = new Set(teamSeats(teamOf(seat)));
    return Object.values(this.g.passes ?? {}).flat()
      .filter((p) => p.round >= fromRound && mine.has(p.from_seat))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.seq - b.seq);
  }

  /** `versus_group_commit_round` (fights with scouts, pools, knockouts sharing a placement, the wipeout guard, missed). */
  protected commitRound(args: Parameters<VersusGroupFinalizeStore['commit']>[0]): unknown {
    const m = this.m;
    if (this.g.rounds[args.p_round]) return { alreadyCommitted: true };
    if (m.phase !== 'resolving' || m.round !== args.p_round) this.h.fail('not_resolving');
    const now = this.h.now();
    const scoutOf = (seat: GSeat): Record<string, unknown> => {
      const sub = this.g.subs[seat];
      const tier = (sub?.prepared_side as { state?: { tier?: unknown } } | null)?.state?.tier;
      return { ...(sub?.scout ?? {}), ...(tier != null ? { tier } : {}) };
    };
    const fights = (args.p_fights as { fight: number; a: GSeat; b: GSeat; copy: boolean; chair: 'a' | 'b'; outcome: 'a' | 'b' | 'draw'; loser: GSeat | null; damage: number; aResult: unknown; bResult: unknown }[])
      .map((f): GFightRow => ({
        round: args.p_round, fight: f.fight, a_seat: f.a, b_seat: f.b, b_copy: f.copy, chair: f.chair, outcome: f.outcome, heart_lost_by: f.loser,
        damage: f.damage, a_result: f.aResult, b_result: f.bResult, a_scout: scoutOf(f.a), b_scout: scoutOf(f.b),
      }));
    const vit = args.p_vitals;
    for (const s of this.stillIn()) {
      const v = vit[s.seat];
      if (v) { s.health = v.health; s.armor = v.armor; }
    }
    // Health 0: out together, sharing a placement; ordered by Health + Armor going in, then seat (the wipeout tiebreak).
    let dead = this.stillIn().filter((s) => (s.health ?? 1) <= 0)
      .sort((a, b) => (vit[b.seat]?.before ?? 0) - (vit[a.seat]?.before ?? 0) || GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat))
      .map((s) => s.seat);
    const living = this.living();
    if (dead.length > 0 && dead.length >= living) dead = dead.slice(1); // never a round with nobody standing
    for (const seat of dead) {
      const s = this.row(seat);
      s.eliminated_round = args.p_round; s.out_reason = 'hearts'; s.auto = false; s.placement = living;
      this.h.toStands(s.user_id);
    }
    let reason: GEndReason = 'hearts';
    for (const s of this.stillIn()) s.missed = s.auto ? s.missed + 1 : 0;
    for (const s of [...this.stillIn()].sort((a, b) => GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat))) {
      if (s.missed < VERSUS_MISSED_ROUNDS_FORFEIT) continue;
      if (this.living() <= 1) break;
      const place = this.living();
      s.eliminated_round = args.p_round; s.out_reason = 'missed'; s.auto = false; s.placement = place;
      this.h.toStands(s.user_id);
      dead.push(s.seat);
      if (this.living() <= 1 && fights.every((f) => f.heart_lost_by == null)) reason = 'missed';
    }
    const vitalsOut: GRound['vitals'] = {};
    for (const s of m.seats) if (s.health != null && s.armor != null) vitalsOut[s.seat] = { health: s.health, armor: s.armor };
    const row: GRound = { match_id: m.id, round: args.p_round, digest: args.p_digest, vitals: vitalsOut, eliminated: dead, fights };
    this.g.rounds[row.round] = row;
    this.h.dirty(`ground:${row.round}`);
    this.h.roundCommitted(row.round);
    this.h.persist('group_round', row as unknown as Record<string, unknown>);
    for (const s of m.seats) s.ready = false;
    m.phase = 'combat';
    m.combat_deadline = now + VERSUS_COMBAT_VIEW_CAP_SECONDS * 1000;
    this.touch();
    if (this.living() <= 1) this.complete(this.stillIn()[0]?.seat ?? null, reason);
    else this.h.persist('group_match', this.matchRow());
    return { alreadyCommitted: false };
  }

  // ── after the fight ─────────────────────────────────────────────────────────────────────────────────────────────

  combatReady(userId: string, round: unknown): void {
    const m = this.m;
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (m.phase !== 'combat' || m.round !== round) return;
    this.row(seat!).ready = true;
    this.touch();
    this.maybeNext();
    if (m.phase === 'combat' && this.stillIn().filter((s) => !(s.ready || s.auto)).length === 1) {
      m.combat_deadline = Math.min(m.combat_deadline ?? Infinity, this.h.now() + COMBAT_LAST_READY_MS);
      this.touch();
    }
  }

  protected maybeNext(): void {
    const m = this.m;
    if (m.phase !== 'combat' || m.paused_at != null) return;
    if (this.stillIn().some((s) => !(s.ready || s.auto))) return;
    this.openShop(m.round + 1);
  }

  // ── leaving, pauses ─────────────────────────────────────────────────────────────────────────────────────────────

  /** `versus_group__eliminate`: a seat goes out NOW (forfeit, left); it still fights this round as a ghost. */
  eliminate(seat: GSeat, reason: GOutReason): void {
    const m = this.m;
    if (m.phase === 'complete') return;
    const s = this.row(seat);
    if (s.eliminated_round != null) return;
    if (this.duos) {
      // The seat's TEAM goes out together, placed by how many teams were still in (2nd of 2).
      const tm = this.team(teamOf(seat));
      if (tm.eliminated_round != null) return;
      const place = this.livingTeams();
      tm.eliminated_round = m.round; tm.out_reason = reason; tm.placement = place;
      for (const x of m.seats) {
        if (x.team !== tm.team || x.eliminated_round != null) continue;
        x.eliminated_round = m.round; x.out_reason = x.seat === seat ? reason : 'forfeit'; x.auto = false; x.placement = place;
        this.h.toStands(x.user_id);
      }
      this.touch();
      if (this.livingTeams() <= 1) {
        const winner = [...m.seats].filter((x) => x.eliminated_round == null).sort((a, b) => GSEATS.indexOf(a.seat) - GSEATS.indexOf(b.seat))[0];
        this.complete(winner?.seat ?? null, reason === 'missed' ? 'missed' : 'forfeit');
        return;
      }
      this.maybeResolve();
      this.maybeNext();
      return;
    }
    const place = this.living(); // counted with this seat still in (the SQL update reads the pre-update rows)
    s.eliminated_round = m.round; s.out_reason = reason; s.auto = false; s.placement = place;
    this.h.toStands(s.user_id);
    this.touch();
    if (this.living() <= 1) {
      this.complete(this.stillIn()[0]?.seat ?? null, reason === 'missed' ? 'missed' : 'forfeit');
      return;
    }
    if (m.paused_seat === seat) this.resume();
    if (m.phase === 'hero_select') this.maybeStart();
    this.maybeClock();
    this.maybeResolve();
    this.maybeNext();
  }

  forfeit(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    this.eliminate(seat!, 'forfeit');
  }

  unpause(userId: string): void {
    const m = this.m;
    const seat = this.requireLive(userId);
    if (m.paused_at == null || m.resume_at != null) return;
    if (m.paused_seat === seat) this.h.fail('cannot_unpause_own_absence');
    if (this.h.now() < (m.pause_grace_until ?? 0)) this.h.fail('grace_running');
    this.row(m.paused_seat!).auto = true;
    this.h.event('auto_on', { seat: m.paused_seat });
    m.resume_at = this.h.now() + RESUME_COUNTDOWN_MS;
    this.touch();
  }

  requestResume(userId: string): void {
    const m = this.m;
    const seat = this.seatOf(userId);
    if (!seat) this.h.fail('not_a_player');
    if (m.paused_at == null || m.resume_at != null) return;
    if (m.paused_seat !== seat) this.h.fail('not_your_pause');
    m.resume_at = this.h.now() + RESUME_COUNTDOWN_MS;
    this.touch();
  }

  /** A player is back (socket or heartbeat): auto ends; their own pause starts its 3-2-1 (R-VERSUS-AUTO-RESUME-01). */
  returned(userId: string, by: string): void {
    const m = this.m;
    if (!this.running()) return;
    const s = m.seats.find((x) => x.user_id === userId);
    if (!s || s.eliminated_round != null) return;
    if (s.auto) { s.auto = false; s.missed = 0; this.h.event('auto_off', { seat: s.seat, by }); this.touch(); }
    if (m.paused_at != null && m.resume_at == null && m.paused_seat === s.seat) {
      m.resume_at = this.h.now() + RESUME_COUNTDOWN_MS;
      this.h.event('resume_request', { seat: s.seat, by });
      this.touch();
    }
  }

  protected resume(): void {
    const m = this.m;
    if (m.paused_at == null) return;
    const d = this.h.now() - m.paused_at;
    const shift = (t: number | null): number | null => (t == null ? null : t + d);
    m.hero_deadline = shift(m.hero_deadline);
    m.shop_starts_at = shift(m.shop_starts_at);
    m.shop_deadline = shift(m.shop_deadline);
    m.combat_deadline = shift(m.combat_deadline);
    m.intro_deadline = shift(m.intro_deadline);
    this.h.event('resume', { seat: m.paused_seat, pausedMs: d });
    m.paused_seat = null; m.paused_at = null; m.pause_grace_until = null; m.resume_at = null;
    this.touch();
    this.maybeClock();
  }

  protected complete(winner: GSeat | null, reason: GEndReason): void {
    const m = this.m;
    if (winner) {
      this.row(winner).placement = 1;
      // Duos: placement is by TEAM: the winner's whole team is 1st.
      if (this.duos) {
        const tm = this.team(teamOf(winner));
        tm.placement = 1;
        for (const x of this.m.seats) if (x.team === tm.team) x.placement = 1;
      }
    }
    m.phase = 'complete'; m.winner_seat = winner; m.end_reason = reason;
    m.paused_seat = null; m.paused_at = null; m.pause_grace_until = null; m.resume_at = null;
    m.completed_at = this.h.now();
    this.touch();
    this.h.matchEnded();
    this.h.persist('group_match', this.matchRow());
  }

  /** `versus_group_reconcile`, on every call and every alarm. */
  reconcile(): void {
    const m = this.m;
    if (!this.running()) return;
    const now = this.h.now();
    const gone = this.stillIn().filter((s) => !s.auto && this.h.userGone(s.user_id)).map((s) => s.seat);
    const allGone = this.stillIn().every((s) => this.h.userGone(s.user_id));
    if (m.paused_at != null) {
      if (m.resume_at != null && now >= m.resume_at) {
        this.resume();
        this.maybeResolve();
        this.maybeNext();
      } else if (allGone && now >= m.paused_at + ABANDON_MS) {
        this.complete(null, 'abandoned');
        return;
      } else return;
    }
    if (gone.length) {
      m.paused_seat = gone[0]!; m.paused_at = now; m.pause_grace_until = now + VERSUS_PAUSE_GRACE_SECONDS * 1000; m.resume_at = null;
      this.h.event('pause', { seat: m.paused_seat, phase: m.phase });
      this.touch();
      return;
    }
    if (m.phase === 'hero_select' && now >= (m.hero_deadline ?? 0)) this.maybeStart();
    else if (m.phase === 'shop' && m.shop_deadline == null) {
      if (now >= (m.intro_deadline ?? 0)) this.startClock(); else this.maybeClock();
    } else if (m.phase === 'shop' && now >= m.shop_deadline! + SHOP_GRACE_MS) {
      for (const s of this.stillIn()) if (!s.locked) this.finalizeSeat(s.seat, s.auto);
      this.maybeResolve();
    } else if (m.phase === 'shop') this.maybeResolve();
    else if (m.phase === 'combat' && now >= (m.combat_deadline ?? Infinity)) this.openShop(m.round + 1);
  }
}
