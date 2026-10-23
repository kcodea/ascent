/**
 * REPLAY STREAM (owner 2026-10-22: "is our replay as good as spectating is? spectating seems basically perfect now...
 * would love to keep them both maintained"; R-REPLAY-STREAM-01).
 *
 * Live spectating draws the watched hand from the player's cursor MESSAGES (`ui/versus/spectateTap.ts`): 20 a second,
 * each with up to three points ~16 ms apart on the player's own clock, anchored to the UI element under the pointer
 * (else the 16:9 game box), plus the card in hand and the drop gap the rows open for it, the aim line, the hovered
 * element (the anchor key), and whether a drop committed or sprang back. A replay used to record a thinner copy of the
 * same hand (a 20 Hz window-fraction trail plus a 30 Hz drag path with no timestamps), so it played worse than the
 * live view of the same game.
 *
 * Now the recorder receives the SAME message the live sender builds (one builder, `ui/versus/cursorSource.ts`) and
 * stores it here, so a replay can be played through the spectator pipeline. This module is the storage format: pure,
 * no DOM, no clock.
 *
 * FORMAT. One `StreamSegment` per round (a resumed round may have two; they are kept in clock order). A segment is
 * columnar and delta-coded so a full game stays small:
 *  - `m`: every message as a flat run of integers, PACKED (zigzag varints, base64: `packInts`). Coordinates are stored
 *    as integers at the precision they travel at (3 decimals, so x1000 is exact) and as deltas from the previous point;
 *    times are ms deltas, so nearly every integer is one byte. A string, not a JSON array, because a JSON number array
 *    stored in Postgres jsonb costs several bytes per small integer at rest; the packed form is about half the size of
 *    the plain JSON text and is stored as one string. Decoding returns the message exactly as it was built, minus the
 *    legacy window fractions (`x`, `y`) that only an old spectator reads.
 *  - `k`: the anchor keys (`u:<uid>`, `s:<spec>`), each stored once per segment.
 *  - `s`: the held card / aim, written only when they CHANGE (they are repeated on every live message).
 *  - `e`: the screen events that are not cursor messages: the shop overlays' minimize state and the fight's Skip.
 *  - `em`: the emotes shown on the player's screen (their own and the seats they faced), `[ms since t0, seat, emote
 *    id]` (owner 2026-10-22: "spectators arent seeing when a player emotes"; R-REPLAY-EMOTE-01). Optional: a stream
 *    recorded before it has none, and an older build reading a newer stream ignores the field.
 *
 * Message layout in `m` (one message): `dt, flags, [dgx, dgy], [key, fx, fy], [n, n x trail point]`.
 *  - `dt`: ms since the previous message of the segment (the first: since `t0`), never negative.
 *  - `flags`: `F_HIDE` (a hide message: no position), `F_ANCHOR`, `F_TRAIL`, `F_STATE` (the next `s` entry applies),
 *    `F_DE_C` / `F_DE_X` (a drop committed / sprang back).
 *  - `dgx, dgy`: the newest point in game-box thousandths, minus the previous message's.
 *  - a trail point: `back` (ms before the newest point; stored as `-(back + 1)` when anchored), `dgx, dgy` against the
 *    newest point, then `key, fx, fy` when anchored.
 *  - every anchored `fx, fy` (the newest point's and the trail's, in that order) is a delta from the previous anchored
 *    point's: the hand mostly stays on one element, so these are usually one byte.
 */

/** A point anchored to a UI element: its key and the point as a fraction of the element's box. */
export interface StreamAnchor { k: string; fx: number; fy: number }
/** The drop gap the player's rows open for the held card (`spectateTap.WireDecision`). */
export interface StreamDecision {
  z?: 'tavern' | 'warband' | 'hand' | null;
  gi?: number;
  sg?: number;
  hg?: number;
  ow?: 1;
  cl?: 1;
  mg?: 1;
}
/** The card in the player's hand. */
export interface StreamHeld { uid: string; source: string; cardId: string; g?: StreamDecision }
/** A live aim line: where it starts, whether it is on a target, its effect and the minion it is on. */
export interface StreamAim { x: number; y: number; gx?: number; gy?: number; an?: StreamAnchor | null; on: boolean; def?: string; t?: string }
/** An earlier point of a message: `[ms before ts, gx, gy]` or `[ms before ts, gx, gy, anchor key, fx, fy]`. */
export type StreamTrailPoint = [number, number, number] | [number, number, number, string, number, number];

/** One cursor message as the live sender builds it (everything but the seat). */
export interface StreamCursorBody {
  x: number;
  y: number;
  gx?: number;
  gy?: number;
  an?: StreamAnchor | null;
  drag?: StreamHeld | null;
  aim?: StreamAim | null;
  hide?: true;
  ts?: number;
  tr?: StreamTrailPoint[];
  de?: 'c' | 'x';
}

/** A recorded message: the body minus the legacy window fractions, `ts` on the replay frames' clock. */
export type RecordedCursorBody = Omit<StreamCursorBody, 'x' | 'y' | 'ts'> & { ts: number };

/** A held card / aim change (a key present = it changed to that value; null = it went away). */
export interface StreamStateChange { d?: StreamHeld | null; a?: StreamAim | null }

/** One round's recorded stream. */
export interface StreamSegment {
  /** The round (wave) it was recorded in. */
  w: number;
  /** The frames-clock ms the segment's clock counts from (its first message is at `t0`). */
  t0: number;
  /** The frames-clock ms of its last message or event (the segment's end; `t0` when empty). */
  t1: number;
  /** Message count. */
  n: number;
  /** Anchor keys, indexed by the messages. */
  k: string[];
  /** The messages, flat integers packed by `packInts` (see the module doc). */
  m: string;
  /** Held card / aim changes, one per `F_STATE` message, in order. */
  s?: StreamStateChange[];
  /** Screen events, flat triples: `ms since t0, code, value` (`EV_OVERLAY` with the minimize bits, `EV_SKIP` with 0). */
  e?: number[];
  /** Emotes shown on the player's screen: `[ms since t0, seat, emote id]`, in order (R-REPLAY-EMOTE-01). */
  em?: StreamEmote[];
}

/** One recorded emote: `[ms since the segment's t0, seat id ("s0" = the player), emote id]`. */
export type StreamEmote = [number, string, string];
/** At most this many emotes are kept per segment (the 20 s cooldown allows a handful; served seats add a few). */
export const STREAM_SEG_MAX_EMOTES = 64;

/** A replay's recorded spectator stream (`ReplayV2.stream`). */
export interface ReplayStream {
  v: 1;
  segs: StreamSegment[];
}

export const F_HIDE = 1;
export const F_ANCHOR = 2;
export const F_TRAIL = 4;
export const F_STATE = 8;
export const F_DE_C = 16;
export const F_DE_X = 32;

/** Screen event: the shop overlays' minimize state changed (value: bits, `OV_*`). */
export const EV_OVERLAY = 1;
/** Screen event: the player skipped the fight on screen. */
export const EV_SKIP = 2;
export const OV_DISCOVER = 1;
export const OV_POWER = 2;
export const OV_QUEST = 4;
export const OV_FORGE = 8;

/** A segment past this many messages records only the ones that change something (a held card, an aim, a hide, a
 *  drop): about 150 s of continuous motion in one round, far past any real shop. */
export const STREAM_SEG_MAX_MSGS = 3000;
/** The whole run's cap, past which every segment records only changes. About 25 minutes of continuous motion. */
export const STREAM_RUN_MAX_MSGS = 30000;

const q = (v: number): number => Math.round(v * 1000);
const keyOf = (v: unknown): string => (v ? JSON.stringify(v) : '');

/** The live encoder of one segment: the segment's fields, with the messages as plain integers until it is sealed. */
export interface StreamEncoder {
  seg: Omit<StreamSegment, 'm'>;
  /** The messages' integers (packed into `StreamSegment.m` by `sealStreamSegment`). */
  ints: number[];
  keys: Map<string, number>;
  lastT: number;
  gx: number;
  gy: number;
  /** The previous anchored point's fx / fy (thousandths), the base of the next one's delta. */
  afx: number;
  afy: number;
  dragKey: string;
  aimKey: string;
}

/** Start a segment for `wave` whose clock begins at frames-clock `t0`. */
export function newStreamEncoder(wave: number, t0: number): StreamEncoder {
  const t = Math.round(t0);
  return { seg: { w: wave, t0: t, t1: t, n: 0, k: [] }, ints: [], keys: new Map(), lastT: t, gx: 0, gy: 0, afx: 0, afy: 0, dragKey: '', aimKey: '' };
}

function keyIndex(enc: StreamEncoder, k: string): number {
  let i = enc.keys.get(k);
  if (i === undefined) { i = enc.seg.k.length; enc.seg.k.push(k); enc.keys.set(k, i); }
  return i;
}

/**
 * Append one message at frames-clock `t`. `full` = the run's cap is reached. Returns false when the message was
 * dropped by a cap (only a message that changes nothing but the position ever is). No allocation beyond the pushed
 * integers, except on the rare held-card / aim change.
 */
export function encodeStreamMessage(enc: StreamEncoder, body: StreamCursorBody, t: number, full = false): boolean {
  const seg = enc.seg;
  const hide = body.hide === true;
  let flags = hide ? F_HIDE : 0;
  let change: StreamStateChange | null = null;
  if (!hide) {
    const dk = keyOf(body.drag);
    const ak = keyOf(body.aim);
    if (dk !== enc.dragKey || ak !== enc.aimKey) {
      change = {};
      if (dk !== enc.dragKey) change.d = body.drag ? structuredClone(body.drag) : null;
      if (ak !== enc.aimKey) change.a = body.aim ? structuredClone(body.aim) : null;
    }
  }
  if (body.de === 'c') flags |= F_DE_C;
  else if (body.de === 'x') flags |= F_DE_X;
  if (!hide && !change && !body.de && (full || seg.n >= STREAM_SEG_MAX_MSGS)) return false;
  const an = body.an ?? null;
  if (an) flags |= F_ANCHOR;
  const tr = !hide && body.tr && body.tr.length ? body.tr : null;
  if (tr) flags |= F_TRAIL;
  if (change) {
    flags |= F_STATE;
    if ('d' in change) enc.dragKey = keyOf(body.drag);
    if ('a' in change) enc.aimKey = keyOf(body.aim);
    (seg.s ??= []).push(change);
  }
  const at = Math.max(enc.lastT, Math.round(t));
  const m = enc.ints;
  m.push(at - enc.lastT, flags);
  enc.lastT = at;
  seg.t1 = Math.max(seg.t1, at);
  let gx = 0;
  let gy = 0;
  if (!hide) {
    gx = q(body.gx ?? 0);
    gy = q(body.gy ?? 0);
    m.push(gx - enc.gx, gy - enc.gy);
    enc.gx = gx;
    enc.gy = gy;
  }
  const anchor = (k: string, fx: number, fy: number): void => {
    const x = q(fx), y = q(fy);
    m.push(keyIndex(enc, k), x - enc.afx, y - enc.afy);
    enc.afx = x;
    enc.afy = y;
  };
  if (an) anchor(an.k, an.fx, an.fy);
  if (tr) {
    m.push(tr.length);
    for (const p of tr) {
      const anchored = p.length === 6;
      m.push(anchored ? -(p[0] + 1) : p[0], q(p[1]) - gx, q(p[2]) - gy);
      if (anchored) anchor(p[3] as string, p[4] as number, p[5] as number);
    }
  }
  seg.n += 1;
  return true;
}

/** Append a screen event at frames-clock `t` (`EV_OVERLAY` with its bits, `EV_SKIP`). */
export function encodeStreamEvent(enc: StreamEncoder, t: number, code: number, value = 0): void {
  const seg = enc.seg;
  const at = Math.max(seg.t0, Math.round(t));
  (seg.e ??= []).push(at - seg.t0, code, value);
  seg.t1 = Math.max(seg.t1, at);
}

/** Append an emote shown at frames-clock `t` (R-REPLAY-EMOTE-01). Returns false past the per-segment cap. */
export function encodeStreamEmote(enc: StreamEncoder, t: number, seat: string, emoteId: string): boolean {
  const seg = enc.seg;
  if ((seg.em?.length ?? 0) >= STREAM_SEG_MAX_EMOTES) return false;
  const at = Math.max(seg.t0, Math.round(t));
  (seg.em ??= []).push([at - seg.t0, seat, emoteId]);
  seg.t1 = Math.max(seg.t1, at);
  return true;
}

/** A segment's emotes, decoded: `{ t (frames clock), seat, id }`, in order. Malformed entries are skipped. */
export function decodeStreamEmotes(seg: Pick<StreamSegment, 't0' | 'em'>): { t: number; seat: string; id: string }[] {
  const out: { t: number; seat: string; id: string }[] = [];
  for (const e of seg.em ?? []) {
    if (!Array.isArray(e) || typeof e[0] !== 'number' || typeof e[1] !== 'string' || typeof e[2] !== 'string') continue;
    out.push({ t: seg.t0 + e[0], seat: e[1], id: e[2] });
  }
  return out;
}

/** The overlay minimize bits of a `{ discover, power, quest, forge }` state. */
export function overlayBitsOf(o: { discover: boolean; power: boolean; quest: boolean; forge: boolean }): number {
  return (o.discover ? OV_DISCOVER : 0) | (o.power ? OV_POWER : 0) | (o.quest ? OV_QUEST : 0) | (o.forge ? OV_FORGE : 0);
}

/** The segment as it is stored: a copy of the encoder's fields with the messages packed. The encoder keeps going. */
export function sealStreamSegment(enc: StreamEncoder): StreamSegment {
  const g = enc.seg;
  return { ...g, k: g.k.slice(), m: packInts(enc.ints), ...(g.s ? { s: g.s.slice() } : {}), ...(g.e ? { e: g.e.slice() } : {}), ...(g.em ? { em: g.em.slice() } : {}) };
}

// ── packing: zigzag LEB128 varints, base64 ─────────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((ch, i) => [ch, i]));

/** Integers to a compact string: each zigzag-encoded as a little-endian base-128 varint (|v| < 64 is one byte), the
 *  bytes as base64 (no padding). Exact for any safe integer. Pure, tested. */
export function packInts(ints: readonly number[]): string {
  const bytes: number[] = [];
  for (const v of ints) {
    let z = v >= 0 ? v * 2 : -v * 2 - 1; // zigzag, in float math so it is exact past 2^31
    while (z >= 128) { bytes.push((z % 128) | 128); z = Math.floor(z / 128); }
    bytes.push(z);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '' : B64[(n >> 6) & 63]!) + (c === undefined ? '' : B64[n & 63]!);
  }
  return out;
}

/** The inverse of `packInts`. A malformed string decodes as far as it is well formed. Pure, tested. */
export function unpackInts(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = B64_INDEX[s[i]!] ?? 0, c1 = B64_INDEX[s[i + 1]!] ?? 0, c2 = s[i + 2], c3 = s[i + 3];
    const n = (c0 << 18) | (c1 << 12) | ((c2 === undefined ? 0 : B64_INDEX[c2] ?? 0) << 6) | (c3 === undefined ? 0 : B64_INDEX[c3] ?? 0);
    bytes.push((n >> 16) & 255);
    if (c2 !== undefined) bytes.push((n >> 8) & 255);
    if (c3 !== undefined) bytes.push(n & 255);
  }
  const out: number[] = [];
  let z = 0;
  let mul = 1;
  for (const b of bytes) {
    z += (b & 127) * mul;
    if (b & 128) { mul *= 128; continue; }
    out.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2);
    z = 0;
    mul = 1;
  }
  return out;
}

/** Decode a segment's messages, in order, exactly as they were built (minus `x`/`y`; `ts` on the frames clock). */
export function decodeStreamSegment(seg: StreamSegment): RecordedCursorBody[] {
  const out: RecordedCursorBody[] = [];
  const m = unpackInts(seg.m);
  const k = seg.k;
  const states = seg.s ?? [];
  let si = 0;
  let i = 0;
  let t = seg.t0;
  let gx = 0;
  let gy = 0;
  let afx = 0;
  let afy = 0;
  let drag: StreamHeld | null = null;
  let aim: StreamAim | null = null;
  const d3 = (v: number): number => v / 1000;
  const anchor = (): StreamAnchor => {
    const key = k[m[i++]!]!;
    afx += m[i++]!;
    afy += m[i++]!;
    return { k: key, fx: d3(afx), fy: d3(afy) };
  };
  while (i < m.length) {
    t += m[i++]!;
    const flags = m[i++]!;
    const hide = (flags & F_HIDE) !== 0;
    if (flags & F_STATE) {
      const c = states[si++] ?? {};
      if ('d' in c) drag = c.d ?? null;
      if ('a' in c) aim = c.a ?? null;
    }
    const body: RecordedCursorBody = { ts: t };
    if (!hide) {
      gx += m[i++]!;
      gy += m[i++]!;
      body.gx = d3(gx);
      body.gy = d3(gy);
    }
    if (flags & F_ANCHOR) {
      body.an = anchor();
    }
    if (hide) body.hide = true;
    else {
      body.drag = drag;
      body.aim = aim;
    }
    if (flags & F_TRAIL) {
      const n = m[i++]!;
      const tr: StreamTrailPoint[] = [];
      for (let j = 0; j < n; j++) {
        const b = m[i++]!;
        const px = d3(gx + m[i++]!);
        const py = d3(gy + m[i++]!);
        if (b < 0) { const a = anchor(); tr.push([-b - 1, px, py, a.k, a.fx, a.fy]); }
        else tr.push([b, px, py]);
      }
      body.tr = tr;
    }
    if (flags & F_DE_C) body.de = 'c';
    else if (flags & F_DE_X) body.de = 'x';
    out.push(body);
  }
  return out;
}

/** A segment's screen events, decoded: `{ t (frames clock), code, value }`, in order. */
export function decodeStreamEvents(seg: Pick<StreamSegment, 't0' | 'e'>): { t: number; code: number; value: number }[] {
  const e = seg.e ?? [];
  const out: { t: number; code: number; value: number }[] = [];
  for (let i = 0; i + 2 < e.length; i += 3) out.push({ t: seg.t0 + e[i]!, code: e[i + 1]!, value: e[i + 2]! });
  return out;
}

/** Shift a segment along the frames clock (a resumed run splices the restored rounds in front). Pure. */
export function shiftStreamSegment(seg: StreamSegment, offsetMs: number): StreamSegment {
  return offsetMs ? { ...seg, t0: seg.t0 + offsetMs, t1: seg.t1 + offsetMs } : seg;
}

/** Is this a structurally usable stream (read from storage or a download written by another build)? */
export function isReplayStream(v: unknown): v is ReplayStream {
  const s = v as Partial<ReplayStream> | null;
  if (!s || typeof s !== 'object' || s.v !== 1 || !Array.isArray(s.segs)) return false;
  return s.segs.every(isStreamSegment);
}

export function isStreamSegment(v: unknown): v is StreamSegment {
  const g = v as Partial<StreamSegment> | null;
  return !!g && typeof g === 'object' && typeof g.w === 'number' && typeof g.t0 === 'number' && typeof g.t1 === 'number'
    && Array.isArray(g.k) && typeof g.m === 'string' && (g.s === undefined || Array.isArray(g.s)) && (g.e === undefined || Array.isArray(g.e))
    && (g.em === undefined || Array.isArray(g.em));
}

/** Total recorded messages across a stream's segments. */
export const streamMessageCount = (segs: readonly StreamSegment[]): number => segs.reduce((n, g) => n + g.n, 0);
