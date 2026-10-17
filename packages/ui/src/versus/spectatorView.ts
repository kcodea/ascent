/**
 * VERSUS — the live spectator projection protocol (blueprint 8; owner ruling 8: every match is watchable, up to 20
 * spectators, and they see BOTH players' complete visible play state live). Pure: no network, no React.
 *
 * WHAT IS SENT. A spectator renders a shop with the same components the player uses, and the recruit render tree
 * reads 200+ RunState fields, so the view is built the way Replay V2 builds its ShopView: everything visible by
 * default, minus `SHOP_VIEW_EXCLUDED_KEYS` (engine-only / unbounded) and minus the Versus SECRETS below (RNG and
 * identity internals a spectator never needs; a test pins that none of them survive). No auth token, lease or
 * persistence payload is ever part of a RunState, so none can leak through it.
 *
 * HOW. Per seat, a monotonically increasing `seq`:
 *   - a KEYFRAME (`kind: 'key'`): the full view. Published at every shop open and every `KEYFRAME_EVERY` deltas,
 *     and persisted (`versus_publish_frame`) so a late joiner or a gap recovers from it.
 *   - a DELTA (`kind: 'delta'`): top-level keys that changed, plus REMOVED keys as an explicit list (an
 *     `undefined` field never survives JSON, so a clear must travel as a removal, the Replay V2 lesson).
 * A receiver that sees `seq !== last + 1` asks for the latest keyframe and resumes after it.
 */
import { SHOP_VIEW_EXCLUDED_KEYS, type RunState, type VersusSeat } from '@game/sim';
import type { SpectatorAct } from './spectateTap';

/** RunState keys never sent to spectators: RNG internals and identity, on top of the replay exclusions. */
export const VERSUS_SPECTATOR_SECRET_KEYS = ['seed', 'rngCursor', 'pool', 'runId', 'servedBoards', 'pendingTavern', 'fodderSchedule', 'discoverQueue'] as const;

export type VersusSpectatorView = Record<string, unknown> & { wave: number; heroId: string };

/** `acts`: the player's actions since the previous message (`spectateTap.ts`), for the spectator to replay. */
/** `m`: the match the message belongs to (a room hosts match after match; the stands drop any other match's). */
/** `fight`: a LIVE RANKED LOBBY game's fight result (computed on the player's client), on the message that enters it and
 *  on every keyframe while it plays; the spectator replays it from the player's side. Never on a Versus message. */
/** `cb`: where the player's fight is (wave, beat), on a keyframe sent while it plays, so a spectator who joins or comes
 *  back mid-fight seeks to it instead of starting the fight over (R-SPECTATE-JOIN-01). Optional: older clients skip it. */
export interface CombatBeat { w: number; b: number }
/** `ov`: which shop overlays the player has minimized (`spectateTap.tapOverlay`, R-SPECTATE-OVERLAY-01). */
/** `od`: the player's own odds for the fight on (`spectateTap.takeOdds`), for the stands' Summary (R-SPECTATE-LOCAL-01). */
export interface SpectatorKeyframe { kind: 'key'; seat: VersusSeat; seq: number; round: number; view: VersusSpectatorView; acts?: SpectatorAct[]; m?: string; fight?: unknown; cb?: CombatBeat; od?: unknown; ov?: unknown }
export interface SpectatorDelta { kind: 'delta'; seat: VersusSeat; seq: number; round: number; changed: Record<string, unknown>; removed: string[]; acts?: SpectatorAct[]; m?: string; fight?: unknown; cb?: CombatBeat; od?: unknown; ov?: unknown }
export type SpectatorMessage = SpectatorKeyframe | SpectatorDelta;

/** A keyframe at least this often, so a receiver that missed one never drifts far. */
export const KEYFRAME_EVERY = 25;

const DROP = new Set<string>([...SHOP_VIEW_EXCLUDED_KEYS, ...VERSUS_SPECTATOR_SECRET_KEYS]);

/** The spectator view of a run: a deep, capture-owned copy of everything visible. */
export function projectSpectatorView(run: RunState): VersusSpectatorView {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(run)) if (!DROP.has(k) && v !== undefined) raw[k] = v;
  return structuredClone(raw) as VersusSpectatorView;
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The publisher's state for one seat. */
export interface SpectatorPublisher {
  seat: VersusSeat;
  seq: number;
  last: VersusSpectatorView | null;
  sinceKey: number;
}

export const newPublisher = (seat: VersusSeat, seq = 0): SpectatorPublisher => ({ seat, seq, last: null, sinceKey: 0 });

/**
 * The next message for `run`, or null when nothing visible changed. `forceKey` (shop open, reconnect) sends a
 * keyframe. Mutates `pub` (seq, last).
 */
export function nextSpectatorMessage(pub: SpectatorPublisher, run: RunState, round: number, forceKey = false, forceDelta = false): SpectatorMessage | null {
  const view = projectSpectatorView(run);
  if (!pub.last || forceKey || pub.sinceKey >= KEYFRAME_EVERY) {
    pub.seq += 1;
    pub.last = view;
    pub.sinceKey = 0;
    return { kind: 'key', seat: pub.seat, seq: pub.seq, round, view };
  }
  const prev = pub.last as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const k of Object.keys(view)) if (!(k in prev) || !same(prev[k], view[k])) changed[k] = view[k];
  for (const k of Object.keys(prev)) if (!(k in view)) removed.push(k);
  // Nothing visible changed: no message, unless action tags must go out (`forceDelta`: an empty delta carries them).
  if (Object.keys(changed).length === 0 && removed.length === 0 && !forceDelta) return null;
  pub.seq += 1;
  pub.sinceKey += 1;
  pub.last = view;
  return { kind: 'delta', seat: pub.seat, seq: pub.seq, round, changed, removed };
}

/** A receiver's state for one seat. */
export interface SpectatorReceiver {
  seq: number;
  view: VersusSpectatorView | null;
}

export const newReceiver = (): SpectatorReceiver => ({ seq: 0, view: null });

/**
 * Apply one message. Returns the next receiver state and whether a KEYFRAME must be fetched (a gap, or a delta
 * with no base). Stale messages (seq at or below the current) are ignored. Never mutates its inputs.
 */
export function applySpectatorMessage(rx: SpectatorReceiver, msg: SpectatorMessage): { rx: SpectatorReceiver; needKeyframe: boolean } {
  if (msg.kind === 'key') {
    if (msg.seq <= rx.seq && rx.view) return { rx, needKeyframe: false };
    return { rx: { seq: msg.seq, view: msg.view }, needKeyframe: false };
  }
  if (msg.seq <= rx.seq) return { rx, needKeyframe: false };
  if (!rx.view || msg.seq !== rx.seq + 1) return { rx, needKeyframe: true };
  const next: Record<string, unknown> = { ...rx.view, ...msg.changed };
  for (const k of msg.removed) delete next[k];
  return { rx: { seq: msg.seq, view: next as VersusSpectatorView }, needKeyframe: false };
}

/** Byte size of a message as it travels (the SQL caps a persisted keyframe at `VERSUS_LIMITS.spectatorFrameBytes`). */
export const messageBytes = (msg: SpectatorMessage): number => new TextEncoder().encode(JSON.stringify(msg)).length;
