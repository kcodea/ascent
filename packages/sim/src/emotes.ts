/**
 * EMOTES (owner spec 2026-10-13): the pure half. A player right-clicks their hero portrait and picks one of their four
 * equipped emotes; a painted speech bubble pops beside the portrait. In the asynchronous lobby the emote is RECORDED on
 * the round's board with its time offset, and replayed at that offset beside the seat's rail portrait whenever the
 * recording is served to someone else.
 *
 * Display only, like `cosmetics`: nothing here is read by combat, matchmaking, the reducer or any RNG, and a board
 * without the field behaves exactly as before. Wall-clock offsets are measured by the UI; this file only shapes,
 * bounds and schedules them.
 *
 * THE TRANSPORT SEAM. `EmoteMessage` is the one shape an emote travels in, whatever carries it: today a local
 * loopback (your own bubble) and the recording (served seats); later a real-time broadcast for Versus. It names the
 * emote, the seat, the phase, the offset into that phase and the round, and nothing else, so a Supabase Realtime
 * channel can send it as-is.
 */
import type { BoardSnapshot } from './snapshot';

/** Which phase an emote was used in. The offset is measured from that phase's start: the start of the shop turn, or
 *  the start of the combat. */
export type EmotePhase = 'shop' | 'combat';

/** An emote in flight, transport-agnostic (owner 2026-10-13: "{emoteId, seat, phase, offsetMs, round}"). */
export interface EmoteMessage {
  emoteId: string;
  /** The lobby seat id that said it ('s0' = the live player). */
  seat: string;
  phase: EmotePhase;
  /** Milliseconds since the phase started (turn start / combat start). */
  offsetMs: number;
  /** The round (the board's wave) it belongs to. */
  round: number;
}

/** One emote as a board records it: compact, because it rides every uploaded board. `at` = ms into the phase. */
export interface RecordedEmote {
  id: string;
  phase: EmotePhase;
  at: number;
}

/** Owner 2026-10-13: "Cooldown: 20 seconds between emotes". No per-turn cap. */
export const EMOTE_COOLDOWN_MS = 20_000;

/** Hard caps, so a hostile or corrupt board stays tiny: a 20 s cooldown allows a handful per round, never more. */
export const MAX_RECORDED_EMOTES = 24;
/** An offset past this is junk (no shop turn or combat lasts 10 minutes). */
export const MAX_EMOTE_OFFSET_MS = 10 * 60_000;
const EMOTE_ID_RE = /^[a-z0-9_]{1,64}$/;

/** How long until the next emote is allowed (0 = now). `lastAt` null = never used. Clock-agnostic (pass the same clock). */
export function emoteCooldownLeft(lastAt: number | null | undefined, now: number, cooldownMs: number = EMOTE_COOLDOWN_MS): number {
  if (lastAt === null || lastAt === undefined || !Number.isFinite(lastAt)) return 0;
  const left = lastAt + cooldownMs - now;
  // A clock that went backwards (a resumed tab, a test) never locks the menu for longer than one cooldown.
  return left <= 0 ? 0 : Math.min(left, cooldownMs);
}

/** Whether an emote may be used now. */
export const emoteReady = (lastAt: number | null | undefined, now: number, cooldownMs: number = EMOTE_COOLDOWN_MS): boolean =>
  emoteCooldownLeft(lastAt, now, cooldownMs) === 0;

/** One recorded emote, validated and rounded, or null. */
function parseOne(v: unknown): RecordedEmote | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !EMOTE_ID_RE.test(o.id)) return null;
  if (o.phase !== 'shop' && o.phase !== 'combat') return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0 || o.at > MAX_EMOTE_OFFSET_MS) return null;
  return { id: o.id, phase: o.phase, at: Math.round(o.at) };
}

/**
 * Parse a board's `emotes` (from the shared pool, a save, a replay). Tolerant by design: an old board has none
 * (undefined), junk entries are dropped, at most `MAX_RECORDED_EMOTES` survive, and the result is in time order per
 * phase. Ids this client does not know are KEPT (a newer client's emote simply renders nothing here).
 */
export function parseRecordedEmotes(v: unknown): RecordedEmote[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: RecordedEmote[] = [];
  for (const x of v) {
    if (out.length >= MAX_RECORDED_EMOTES) break;
    const e = parseOne(x);
    if (e) out.push(e);
  }
  return out.length ? out.sort((a, b) => (a.phase === b.phase ? a.at - b.at : a.phase === 'shop' ? -1 : 1)) : undefined;
}

/** The record of a message (the board keeps no seat or round: the board IS the seat's round). */
export const recordedOf = (m: Pick<EmoteMessage, 'emoteId' | 'phase' | 'offsetMs'>): RecordedEmote =>
  ({ id: m.emoteId, phase: m.phase, at: Math.max(0, Math.min(MAX_EMOTE_OFFSET_MS, Math.round(m.offsetMs))) });

/**
 * A board with these emotes added (a copy; the input is never mutated). Capped at `MAX_RECORDED_EMOTES`. With nothing
 * to add the SAME board comes back, so a board that never emoted stays byte-identical to one from before emotes.
 */
export function withRecordedEmotes<T extends Pick<BoardSnapshot, 'emotes'>>(board: T, add: readonly RecordedEmote[]): T {
  if (!add.length) return board;
  const merged = parseRecordedEmotes([...(board.emotes ?? []), ...add]);
  return merged ? { ...board, emotes: merged } : board;
}

/**
 * Record one message onto the captured boards: the board of the message's round gets it (the LAST such board, in
 * case a round was captured twice). Returns the same array when no board of that round exists yet (a shop emote
 * before the round's board is captured; the caller holds those and folds them in at capture).
 */
export function recordEmoteOnBoards<T extends Pick<BoardSnapshot, 'emotes' | 'wave'>>(boards: readonly T[], m: EmoteMessage): readonly T[] {
  for (let i = boards.length - 1; i >= 0; i--) {
    if (boards[i]!.wave !== m.round) continue;
    const next = boards.slice();
    next[i] = withRecordedEmotes(boards[i]!, [recordedOf(m)]);
    return next;
  }
  return boards;
}

/**
 * THE REPLAY SCHEDULE for one served board: the emotes of `phase`, in time order, when the board is the seat's board
 * FOR THIS ROUND. A board served past its own end (`repeatFinal`, a recording that ran out) says nothing, so an
 * exhausted seat never repeats its last round's emotes every round.
 */
export function emoteScheduleOf(snapshot: Pick<BoardSnapshot, 'emotes' | 'wave'> | null | undefined, round: number, phase: EmotePhase): RecordedEmote[] {
  if (!snapshot || snapshot.wave !== round) return [];
  return (parseRecordedEmotes(snapshot.emotes) ?? []).filter((e) => e.phase === phase);
}

/** A recorded emote this late (ms past its moment) when scheduled is dropped, never played late (a resumed game). */
export const EMOTE_LATE_MS = 250;

/**
 * THE REPLAY TIMING: how long to wait before each recorded emote plays, given when the live phase started and what
 * time it is now (same clock). An emote plays at the SAME offset into the phase it was recorded at; one whose moment
 * has already passed by more than `EMOTE_LATE_MS` is dropped. Pure.
 */
export function emoteReplayDelays(schedule: readonly RecordedEmote[], phaseStartedAt: number, now: number): { emote: RecordedEmote; waitMs: number }[] {
  const out: { emote: RecordedEmote; waitMs: number }[] = [];
  for (const e of schedule) {
    const wait = phaseStartedAt + e.at - now;
    if (wait < -EMOTE_LATE_MS) continue;
    out.push({ emote: e, waitMs: Math.max(0, wait) });
  }
  return out;
}
