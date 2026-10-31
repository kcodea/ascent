/**
 * THE GAME SESSION — the rules (R-SESSION-CF-01). Pure: no I/O, the clock is passed in. The Durable Object
 * (`session.ts`) is the shell: storage, the alarm, the Supabase writer. Wire: `sessionProtocol.ts`.
 *
 * What a session holds, per game:
 *   - the CLOUD SAVE (signed-in players): the latest save the client sent at a shop start. It is written to Supabase
 *     (`saved_runs`) only when it matters: the player parked the game (Save & Quit, the title) or went quiet (no live
 *     socket for `SESSION_QUIET_MS`, or no save for `SESSION_STALE_SAVE_MS`). During play: nothing. The session keeps the
 *     Supabase row's revision (`base`) and answers it to every save, so the client's lease stays the row's.
 *   - the TABLE: the opponent keys, pinned at the start. The rating settle uses the pinned keys, never the ones the
 *     client sends at the end (a client cannot swap its table for an easier one after the fact).
 *   - the END-OF-GAME WRITES (boards, fight ledger, Career row, telemetry): kept by key (a resend is the same item),
 *     flushed in ONE call when the game has ended and the writes have gone quiet (`SESSION_FINISH_SETTLE_MS`), or with
 *     the rating settle, or `SESSION_UNFINISHED_SETTLE_MS` after the last one when no end was seen.
 *   - the RATING: validated here exactly as `submit-rating` validates it, settled by `settle_rank` inside the flush, and
 *     its answer kept, so a retried rate request gets the same answer (the ledger dedupes it again in SQL).
 */
import { RANK_RULES_VERSION, RANK_SEASON, allSeatsGenerated, isValidPlacement } from '../../../../supabase/functions/_shared/lobbyRating';
import { SESSION_MAX_WRITES, SESSION_WRITE_TABLES, type SessionRateBody } from '../sessionProtocol';

/** No live socket from the player for this long: the held save is written to Supabase. */
export const SESSION_QUIET_MS = 60_000;
/** A held save this old is written even while the socket stays open (a tab left on a screen with no new save). */
export const SESSION_STALE_SAVE_MS = 10 * 60_000;
/** The game ended: the writes are flushed once none has arrived for this long. */
export const SESSION_FINISH_SETTLE_MS = 8_000;
/** No end seen (a Practice game, an end the client never sent): the writes are flushed this long after the last one. */
export const SESSION_UNFINISHED_SETTLE_MS = 45_000;
/** A session with nothing owed forgets itself this long after its last activity. */
export const SESSION_FORGET_MS = 30 * 60_000;
/** A failed flush is retried after 2 s, 4 s ... capped here; after `SESSION_FLUSH_GIVE_UP` tries it is set aside. */
export const SESSION_FLUSH_MAX_DELAY_MS = 10 * 60_000;
export const SESSION_FLUSH_GIVE_UP = 40;

const MAX_SEAT_KEYS = 7;
const MAX_SEAT_KEY_LENGTH = 96;

export interface HeldSave {
  runKey: string;
  deviceId: string;
  /** The Supabase row's revision as the session knows it (what the next write of the row expects). */
  base: number;
  /** A save the session holds that Supabase does not have yet. */
  dirty: boolean;
  savedAt: number;
  /** The player asked for it to be written now (Save & Quit). */
  parked: boolean;
}

export interface HeldWrite {
  key: string;
  kind: string;
  table: string;
  conflict?: string;
  at: number;
  rows: number;
}

export interface SessionMeta {
  gameId: string;
  owner: string | null;
  createdAt: number;
  activeAt: number;
  mode: 'ranked' | 'casual' | 'practice' | null;
  /** The opponents' fight-ledger keys, pinned at the start (null: never pinned). */
  seatKeys: string[] | null;
  save: HeldSave | null;
  /** The Supabase row moved on under another device: the next save is told so. */
  moved: { run_key: string; revision: number; device_id: string; updated_at: string } | null;
  /** Writes not yet flushed (their rows are kept beside the meta, one storage key each). */
  writes: HeldWrite[];
  /** Write keys already flushed (a resend after the flush is answered without storing it again). */
  flushedKeys: string[];
  /** The run ended: the save row goes at the next flush. */
  clear: { runKey: string; expected: number } | null;
  /** The settled rating's request and answer (the answer is what `submit-rating` would have said). */
  rating: { runId: string; answer: unknown } | null;
  /** The game ended (a rate, a clear, or the live end with a placement). */
  finishedAt: number | null;
  /** The last write / save / clear that is waiting for a flush. */
  lastWriteAt: number | null;
  flush: { attempt: number; retryAt: number | null; lastAt: number | null; lastError: string | null; gaveUp: boolean };
}

export class SessionError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export const newSessionMeta = (gameId: string, now: number): SessionMeta => ({
  gameId, owner: null, createdAt: now, activeAt: now, mode: null, seatKeys: null, save: null, moved: null, writes: [],
  flushedKeys: [], clear: null, rating: null, finishedAt: null, lastWriteAt: null,
  flush: { attempt: 0, retryAt: null, lastAt: null, lastError: null, gaveUp: false },
});

export const flushDelayMs = (attempt: number): number => Math.min(SESSION_FLUSH_MAX_DELAY_MS, 2000 * 2 ** Math.max(0, attempt - 1));

/** What one flush carries (the rows are read from storage by the shell). */
export interface FlushPlan {
  writeKeys: string[];
  save: boolean;
  clear: { runKey: string; expected: number } | null;
}

/** What `session_cf_flush` answered, as the core needs it. */
export interface FlushAnswer {
  writes?: { key: string; status: string }[];
  save?: { status: string; revision?: number; current?: SessionMeta['moved'] } | null;
  clear?: { status: string } | null;
  rating?: unknown;
}

export class SessionCore {
  constructor(public meta: SessionMeta) {}

  /** The first account to use the session owns it; nobody else may. */
  claim(userId: string, now: number): void {
    const m = this.meta;
    if (m.owner && m.owner !== userId) throw new SessionError('not_owner', 403);
    m.owner ??= userId;
    m.activeAt = now;
  }

  // ── The save ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** A save arrives. Returns the answer's revision, or throws `conflict` (the row moved under another device). */
  save(userId: string, runKey: string, expected: number, deviceId: string, now: number): number {
    this.claim(userId, now);
    const m = this.meta;
    if (m.clear) throw new SessionError('game_ended', 409);
    if (m.moved && m.moved.run_key === runKey) throw new SessionError('conflict', 409);
    const exp = Math.max(0, Math.floor(Number(expected) || 0));
    const prev = m.save && m.save.runKey === runKey ? m.save : null;
    // The client may know a newer revision than the session (a Continue claimed the row directly): the newer one stands.
    const base = Math.max(prev?.base ?? 0, exp);
    m.save = { runKey, deviceId: String(deviceId).slice(0, 128), base, dirty: true, savedAt: now, parked: false };
    m.activeAt = now;
    return base;
  }

  /** Save & Quit: write the held save now. */
  park(userId: string, now: number): void {
    this.claim(userId, now);
    if (this.meta.save?.dirty) this.meta.save.parked = true;
  }

  // ── The table and the writes ─────────────────────────────────────────────────────────────────────────────────

  /** Pin the table (the first pin stands: a later one cannot replace it). */
  table(userId: string, mode: unknown, seatKeys: unknown, now: number): void {
    this.claim(userId, now);
    const m = this.meta;
    m.mode = mode === 'casual' || mode === 'practice' ? mode : 'ranked';
    if (m.seatKeys) return;
    const keys = cleanSeatKeys(seatKeys);
    if (keys) m.seatKeys = keys;
  }

  /** A run-end write arrives. Returns false when it is already held or flushed (nothing to store). */
  write(userId: string, item: { key?: unknown; kind?: unknown; table?: unknown; rows?: unknown; conflict?: unknown }, now: number): HeldWrite | null {
    this.claim(userId, now);
    const m = this.meta;
    const key = typeof item.key === 'string' ? item.key.slice(0, 300) : '';
    const table = String(item.table ?? '');
    if (!key || !(SESSION_WRITE_TABLES as readonly string[]).includes(table) || !Array.isArray(item.rows) || item.rows.length === 0 || item.rows.length > 200) {
      throw new SessionError('bad_write');
    }
    if (m.flushedKeys.includes(key) || m.writes.some((w) => w.key === key)) return null;
    if (m.writes.length >= SESSION_MAX_WRITES) throw new SessionError('too_many_writes', 413);
    const conflict = typeof item.conflict === 'string' && /^[a-z_,]{1,80}$/.test(item.conflict) ? item.conflict : undefined;
    const w: HeldWrite = { key, kind: String(item.kind ?? table).slice(0, 20), table, ...(conflict ? { conflict } : {}), at: now, rows: item.rows.length };
    m.writes.push(w);
    m.lastWriteAt = now;
    m.activeAt = now;
    return w;
  }

  /** The run ended: the save row goes (at the next flush), and the game counts as finished. */
  clearSave(userId: string, runKey: string, expected: number, now: number): void {
    this.claim(userId, now);
    const m = this.meta;
    m.clear = { runKey, expected: Math.max(0, Math.floor(Number(expected) || 0)) };
    m.finishedAt ??= now;
    m.lastWriteAt = now;
    if (m.save && m.save.runKey === runKey) m.save.dirty = false; // never written again: the row is going
  }

  /** The live part ended with a placement (the client's game over). */
  finished(now: number): void {
    this.meta.finishedAt ??= now;
    this.meta.activeAt = now;
  }

  // ── The rating ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A rank request, checked exactly as `submit-rating` checks it (bad_run_id / bad_placement 400, an unsupported season
   * or rules version 409, an all-generated table unrated), plus: the run must be THIS session's game, and the table is
   * the one pinned at the start when there is one. Returns the `settle_rank` arguments, or an immediate answer.
   */
  rate(userId: string, raw: SessionRateBody['req'] | undefined, now: number):
    | { kind: 'settle'; args: { p_run_id: string; p_placement: number; p_season: number; p_rules_version: number; p_seed: number | null; p_seat_keys: string[] | null } }
    | { kind: 'answer'; status: number; body: unknown } {
    this.claim(userId, now);
    const m = this.meta;
    const body = (raw ?? {}) as Record<string, unknown>;
    const runId = typeof body.runId === 'string' ? body.runId.trim().slice(0, 128) : '';
    const placement = typeof body.placement === 'number' ? body.placement : Number(body.placement);
    if (!runId) return { kind: 'answer', status: 400, body: { error: 'bad_run_id' } };
    if (runId !== m.gameId) return { kind: 'answer', status: 400, body: { error: 'bad_run_id' } };
    if (!isValidPlacement(placement)) return { kind: 'answer', status: 400, body: { error: 'bad_placement' } };
    if (body.seasonId !== RANK_SEASON) return { kind: 'answer', status: 409, body: { error: 'unsupported_season', expected: RANK_SEASON } };
    if (body.rulesVersion !== RANK_RULES_VERSION) return { kind: 'answer', status: 409, body: { error: 'unsupported_rules', expected: RANK_RULES_VERSION } };
    if (m.rating && m.rating.runId === runId) return { kind: 'answer', status: 200, body: m.rating.answer };
    const seed = typeof body.seed === 'number' && Number.isFinite(body.seed) && Number.isInteger(body.seed) ? body.seed : null;
    const seatKeys = m.seatKeys ?? cleanSeatKeys(body.seatKeys);
    m.finishedAt ??= now;
    if (allSeatsGenerated(seatKeys)) return { kind: 'answer', status: 200, body: { status: 'unrated', error: 'unrated_all_generated' } };
    return { kind: 'settle', args: { p_run_id: runId, p_placement: placement, p_season: RANK_SEASON, p_rules_version: RANK_RULES_VERSION, p_seed: seed, p_seat_keys: seatKeys } };
  }

  // ── The flush ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Is the held save due to be written to Supabase? `quietSince`: when the player's live socket went (null: here). */
  saveDue(now: number, publisherHere: boolean, quietSince: number | null): boolean {
    const s = this.meta.save;
    if (!s || !s.dirty || this.meta.clear || this.meta.moved) return false;
    if (s.parked) return true;
    if (now - s.savedAt >= SESSION_STALE_SAVE_MS) return true;
    if (publisherHere) return false;
    return now - Math.max(s.savedAt, quietSince ?? 0) >= SESSION_QUIET_MS;
  }

  /** Are the writes (and the clear) due? */
  writesDue(now: number): boolean {
    const m = this.meta;
    if (!m.writes.length && !m.clear) return false;
    const settle = m.finishedAt != null ? SESSION_FINISH_SETTLE_MS : SESSION_UNFINISHED_SETTLE_MS;
    return now >= (m.lastWriteAt ?? m.activeAt) + settle;
  }

  /** May a flush run now (not backing off, not given up)? `forced`: a rate request (it is answered by the flush). */
  canFlush(now: number, forced = false): boolean {
    const f = this.meta.flush;
    if (f.gaveUp && !forced) return false;
    return forced || f.retryAt == null || now >= f.retryAt;
  }

  /** What a flush now carries. `withWrites`: the writes and the clear (the end); the save alone otherwise. */
  plan(now: number, publisherHere: boolean, quietSince: number | null, withWrites: boolean): FlushPlan | null {
    const m = this.meta;
    const save = this.saveDue(now, publisherHere, quietSince);
    const writeKeys = withWrites ? m.writes.map((w) => w.key) : [];
    const clear = withWrites ? m.clear : null;
    if (!save && !writeKeys.length && !clear) return null;
    return { writeKeys, save, clear };
  }

  /** A flush answered. */
  flushed(plan: FlushPlan, a: FlushAnswer, now: number): void {
    const m = this.meta;
    const done = new Set(plan.writeKeys);
    m.writes = m.writes.filter((w) => !done.has(w.key));
    m.flushedKeys = [...m.flushedKeys, ...plan.writeKeys].slice(-64);
    if (plan.save && m.save && a.save) {
      if (a.save.status === 'ok' && typeof a.save.revision === 'number') { m.save.base = a.save.revision; m.save.dirty = false; m.save.parked = false; }
      else if (a.save.status === 'conflict') { m.moved = a.save.current ?? { run_key: m.save.runKey, revision: -1, device_id: '', updated_at: new Date(now).toISOString() }; m.save.dirty = false; }
      else { m.save.dirty = false; } // refused (a guest) or absent: nothing more to do with it
    }
    if (plan.clear && m.clear === plan.clear) { m.clear = null; m.save = null; }
    m.flush = { attempt: 0, retryAt: null, lastAt: now, lastError: null, gaveUp: false };
    m.activeAt = now;
  }

  /** A flush failed: back off (the held state stays). */
  failed(error: string, now: number): void {
    const f = this.meta.flush;
    const attempt = f.attempt + 1;
    this.meta.flush = { attempt, retryAt: now + flushDelayMs(attempt), lastAt: f.lastAt, lastError: error.slice(0, 300), gaveUp: attempt >= SESSION_FLUSH_GIVE_UP };
  }

  /** Nothing is owed to Supabase. */
  settled(): boolean {
    const m = this.meta;
    return !m.writes.length && !m.clear && !(m.save?.dirty);
  }

  /** May the object forget itself? */
  forgettable(now: number): boolean {
    return (this.settled() || this.meta.flush.gaveUp) && now - this.meta.activeAt >= SESSION_FORGET_MS;
  }

  /** When the session's own clock next matters, or null. */
  nextAt(now: number, publisherHere: boolean, quietSince: number | null): number | null {
    const m = this.meta;
    const due: number[] = [];
    const retry = m.flush.retryAt;
    if (m.writes.length || m.clear) {
      const settle = (m.lastWriteAt ?? m.activeAt) + (m.finishedAt != null ? SESSION_FINISH_SETTLE_MS : SESSION_UNFINISHED_SETTLE_MS);
      if (!m.flush.gaveUp) due.push(Math.max(settle, retry ?? 0));
    }
    const s = m.save;
    if (s && s.dirty && !m.clear && !m.moved && !m.flush.gaveUp) {
      const at = s.parked ? now : publisherHere ? s.savedAt + SESSION_STALE_SAVE_MS : Math.max(s.savedAt, quietSince ?? 0) + SESSION_QUIET_MS;
      due.push(Math.max(at, retry ?? 0));
    }
    if (this.settled() || m.flush.gaveUp) due.push(m.activeAt + SESSION_FORGET_MS);
    return due.length ? Math.min(...due) : null;
  }
}

/** At most seven opponent keys, each a bounded string (the `submit-rating` filter). Null when absent. */
export function cleanSeatKeys(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_SEAT_KEY_LENGTH).slice(0, MAX_SEAT_KEYS);
}
