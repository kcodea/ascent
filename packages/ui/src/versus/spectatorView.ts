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
import { isHeroReroll, SHOP_VIEW_EXCLUDED_KEYS, type HeroReroll, type RunState, type VersusGroupSeat } from '@game/sim';
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
export interface SpectatorKeyframe { kind: 'key'; seat: VersusGroupSeat; seq: number; round: number; view: VersusSpectatorView; acts?: SpectatorAct[]; m?: string; fight?: unknown; cb?: CombatBeat; od?: unknown; ov?: unknown }
export interface SpectatorDelta { kind: 'delta'; seat: VersusGroupSeat; seq: number; round: number; changed: Record<string, unknown>; removed: string[]; acts?: SpectatorAct[]; m?: string; fight?: unknown; cb?: CombatBeat; od?: unknown; ov?: unknown }
/**
 * HERO SELECT, WATCHED (owner 2026-10-26: "I want spectating to show up when a player goes into hero select. this should
 * work in all modes. hero select should be spectatable."; R-SPECTATE-HEROSELECT-01). Before the run exists a player's
 * screen is Hero Select, so the frame is that screen's state, small and whole (no delta): the offered heroes in their
 * order, the pick (once made), the one re-roll (spent, and whether it is still on offer) and the mode (the screen differs
 * by mode: Versus has its clock and no Health pill). Nothing else: no seed, no pool, no entry id. The clock is the
 * match's own deadline, which every member already reads. Sent on every change and on a key request; the first run
 * message after it is always a keyframe.
 */
export interface HeroSelectFrame {
  offer: string[];
  picked: string | null;
  reroll: HeroReroll | null;
  /** The player still has their re-roll (the buttons show, inert, on a watcher's screen). */
  canReroll: boolean;
  /** `versus` (1v1, Group, Duos) or `lobby` (a ranked game watched from Live Games). */
  mode: 'versus' | 'lobby';
}
export interface SpectatorHeroMessage {
  kind: 'hero'; seat: VersusGroupSeat; seq: number; round: 0; hero: HeroSelectFrame; m?: string;
  /** Never on a Hero Select message (typed so the shared receive path reads them as absent). */
  acts?: undefined; fight?: undefined; cb?: undefined; od?: undefined; ov?: undefined;
}
export type SpectatorMessage = SpectatorKeyframe | SpectatorDelta | SpectatorHeroMessage;

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
  seat: VersusGroupSeat;
  seq: number;
  last: VersusSpectatorView | null;
  sinceKey: number;
  /** The last Hero Select frame sent (its JSON), so an unchanged screen sends nothing. */
  lastHero?: string | null;
}

/**
 * A publisher's first sequence number is the CLOCK, not 0 (R-SPECTATE-RESUME-01, found 2026-10-20). A receiver drops any
 * message at or below the seq it holds, and the server keeps a persisted keyframe only when its seq is higher, so a
 * player who reloads or reconnects mid-game used to restart at 1 and be ignored by every spectator (their screen froze on
 * the last frame before the reload) and by the persisted keyframe. Starting at the wall clock in ms keeps every new
 * session above the last one (a session sends far fewer than one message per millisecond); seq is a bigint in the SQL.
 */
export const newPublisher = (seat: VersusGroupSeat, seq = Date.now()): SpectatorPublisher => ({ seat, seq, last: null, sinceKey: 0 });

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

/** Hero ids travel as short strings; anything else in a frame from the wire is dropped (the screen never trusts it). */
const heroIdOk = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 60;

/**
 * A Hero Select frame, built (the player) or read off the wire (a watcher), or null when it is not one. Pure. The pick
 * must be one of the offered heroes; the offer is 1 to 8 heroes (Versus and a ranked game offer three).
 */
export function heroSelectFrame(v: unknown): HeroSelectFrame | null {
  const f = v as Partial<HeroSelectFrame> | null;
  if (!f || typeof f !== 'object' || !Array.isArray(f.offer) || f.offer.length < 1 || f.offer.length > 8 || !f.offer.every(heroIdOk)) return null;
  if (f.mode !== 'versus' && f.mode !== 'lobby') return null;
  const picked = heroIdOk(f.picked) && f.offer.includes(f.picked) ? f.picked : null;
  const reroll = isHeroReroll(f.reroll) && heroIdOk(f.reroll.from) && heroIdOk(f.reroll.to) ? { slot: f.reroll.slot, from: f.reroll.from, to: f.reroll.to } : null;
  return { offer: [...f.offer], picked, reroll, canReroll: f.canReroll === true && !picked && !reroll, mode: f.mode };
}

/**
 * The next Hero Select message for `frame`, or null when the screen is unchanged (`force`: a watcher asked). It takes
 * the publisher's next seq, and the first run message after it is a keyframe (the run begins). Mutates `pub`.
 */
export function nextHeroSelectMessage(pub: SpectatorPublisher, frame: HeroSelectFrame, force = false): SpectatorHeroMessage | null {
  const key = JSON.stringify(frame);
  if (!force && pub.lastHero === key) return null;
  pub.lastHero = key;
  pub.seq += 1;
  pub.last = null;
  pub.sinceKey = 0;
  return { kind: 'hero', seat: pub.seat, seq: pub.seq, round: 0, hero: frame };
}

/** A receiver's state for one seat. `hero`: the player is on Hero Select (no run view yet). */
export interface SpectatorReceiver {
  seq: number;
  view: VersusSpectatorView | null;
  hero?: HeroSelectFrame | null;
}

export const newReceiver = (): SpectatorReceiver => ({ seq: 0, view: null });

/**
 * Apply one message. Returns the next receiver state and whether a KEYFRAME must be fetched (a gap, or a delta
 * with no base). Stale messages (seq at or below the current) are ignored. Never mutates its inputs.
 */
export function applySpectatorMessage(rx: SpectatorReceiver, msg: SpectatorMessage): { rx: SpectatorReceiver; needKeyframe: boolean } {
  if (msg.kind === 'hero') {
    // Hero Select: a whole frame. The same screen arriving again keeps the object on screen (no re-render).
    const hero = heroSelectFrame(msg.hero);
    if (!hero || (msg.seq <= rx.seq && (rx.view || rx.hero))) return { rx, needKeyframe: false };
    const same = rx.hero && JSON.stringify(rx.hero) === JSON.stringify(hero) ? rx.hero : hero;
    return { rx: { seq: msg.seq, view: null, hero: same }, needKeyframe: false };
  }
  if (msg.kind === 'key') {
    if (msg.seq <= rx.seq && (rx.view || rx.hero)) return { rx, needKeyframe: false };
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
