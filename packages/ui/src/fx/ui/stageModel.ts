/**
 * The Stage Setter's PURE state model: the actors on a mock warband/tavern row, the three anchor points
 * (source/target/cursor) an FX layer can bind to, and the immutable ops that edit them.
 *
 * Same discipline as `sessionState.ts` and `layerModel.ts`: no React, no DOM, no Pixi, no storage — every
 * function here is a total function over plain data, so a malformed `localStorage` blob degrades instead of
 * throwing. `normalizeStages` is the defensive boundary, mirroring `normalizeSession`'s style: coerce fields
 * one at a time, drop what can't be salvaged, fall back to `DEFAULT_STAGE` for anything unusable.
 */

/** What an actor is currently playing in the preview — used to bind `source`/`target` anchors to a specific
 *  card without a separate lookup table. `'none'` = just a body on the row, not currently anchoring anything. */
export type StageRole = 'source' | 'target' | 'struck' | 'selfBuffed' | 'buffed' | 'none';

/** Which row an actor sits in — mirrors the two rows a real combat/shop screen can show. */
export type StageZone = 'warband' | 'tavern';

/** One mock card on the stage. `slot` is its index within its own zone's row (order matters for reach-style
 *  effects); `uid` is stable across ops so a caller can keep a React key or a selection pointing at the same
 *  actor as the row is edited. */
export interface StageActor {
  uid: string;
  zone: StageZone;
  slot: number;
  role: StageRole;
  atk: number;
  hp: number;
}

/** A viewport-fraction coordinate (0..1 on each axis), the same convention `bounceSpots` uses. */
export interface StagePoint {
  x: number;
  y: number;
}

/** The whole stage: the three anchor points every FX layer can bind to, plus the actors on the row. */
export interface StageState {
  source: StagePoint;
  target: StagePoint;
  cursor: StagePoint;
  actors: StageActor[];
}

export const DEFAULT_STAGE: StageState = {
  source: { x: 0.32, y: 0.6 },
  target: { x: 0.68, y: 0.6 },
  cursor: { x: 0.5, y: 0.4 },
  actors: [],
};

/** `stage-<n>` — the uid an actor at index `n` is assigned. Exposed so callers/tests can predict an id
 *  without re-deriving the numbering scheme. */
export function stageUid(n: number): string {
  return `stage-${n}`;
}

const STAGE_UID_RE = /^stage-(\d+)$/;

/** The lowest `n` not already used by an existing `stage-<n>` uid, so a remove-then-add never collides with
 *  a uid still on the stage (a plain `actors.length` counter would, once anything has been removed). */
function nextFreeIndex(actors: readonly StageActor[]): number {
  const used = new Set<number>();
  for (const a of actors) {
    const m = STAGE_UID_RE.exec(a.uid);
    if (m) used.add(Number(m[1]));
  }
  let n = 0;
  while (used.has(n)) n++;
  return n;
}

/** Append a fresh actor to the end of `zone`'s row. New actors start role `'none'`, 1/1 — inert until the
 *  caller assigns a role or stats. */
export function addActor(s: StageState, zone: StageZone): StageState {
  const uid = stageUid(nextFreeIndex(s.actors));
  const slot = s.actors.reduce((max, a) => (a.zone === zone ? Math.max(max, a.slot + 1) : max), 0);
  const actor: StageActor = { uid, zone, slot, role: 'none', atk: 1, hp: 1 };
  return { ...s, actors: [...s.actors, actor] };
}

/** Drop the actor with `uid`. A no-op (same array reference) if it isn't present. */
export function removeActor(s: StageState, uid: string): StageState {
  if (!s.actors.some((a) => a.uid === uid)) return s;
  return { ...s, actors: s.actors.filter((a) => a.uid !== uid) };
}

/** Move an actor to a different zone/slot. Slot is clamped to a non-negative integer; this does not
 *  renumber other actors in the row — callers that need contiguous slots re-derive them from order. */
export function moveActor(s: StageState, uid: string, zone: StageZone, slot: number): StageState {
  const clampedSlot = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
  let changed = false;
  const actors = s.actors.map((a) => {
    if (a.uid !== uid) return a;
    if (a.zone === zone && a.slot === clampedSlot) return a;
    changed = true;
    return { ...a, zone, slot: clampedSlot };
  });
  return changed ? { ...s, actors } : s;
}

/** Set an actor's role. Does not enforce role uniqueness (e.g. it's the caller's job to clear a previous
 *  `'source'` before assigning a new one) — this stays a plain field setter. */
export function setActorRole(s: StageState, uid: string, role: StageRole): StageState {
  let changed = false;
  const actors = s.actors.map((a) => {
    if (a.uid !== uid || a.role === role) return a;
    changed = true;
    return { ...a, role };
  });
  return changed ? { ...s, actors } : s;
}

/** Set an actor's stats (atk/hp), clamped to a non-negative integer each. */
export function setActorStats(s: StageState, uid: string, atk: number, hp: number): StageState {
  const a2 = Math.max(0, Math.floor(Number.isFinite(atk) ? atk : 0));
  const h2 = Math.max(0, Math.floor(Number.isFinite(hp) ? hp : 0));
  let changed = false;
  const actors = s.actors.map((a) => {
    if (a.uid !== uid || (a.atk === a2 && a.hp === h2)) return a;
    changed = true;
    return { ...a, atk: a2, hp: h2 };
  });
  return changed ? { ...s, actors } : s;
}

/** Clamp a fraction into 0..1, falling back to 0 for a non-finite input. */
function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Set one of the three anchor points, clamping both axes into 0..1. */
export function setPoint(s: StageState, which: 'source' | 'target' | 'cursor', p: StagePoint): StageState {
  return { ...s, [which]: { x: clampFraction(p.x), y: clampFraction(p.y) } };
}

/** The first actor carrying `role`, or null if none does — the lookup an FX layer's source/target binding
 *  resolves through. */
export function roleActor(s: StageState, role: StageRole): StageActor | null {
  return s.actors.find((a) => a.role === role) ?? null;
}

/** What gets persisted: one stage per FX def (keyed by def id) plus a global "last used" stage, so reopening
 *  a def restores its own layout while a brand-new def starts from whatever was last touched. */
export interface SavedStages {
  byDef: Record<string, StageState>;
  last: StageState;
}

const ROLES: readonly StageRole[] = ['source', 'target', 'struck', 'selfBuffed', 'buffed', 'none'];
const ZONES: readonly StageZone[] = ['warband', 'tavern'];

function coerceRole(v: unknown): StageRole {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? (v as StageRole) : 'none';
}

function coerceZone(v: unknown): StageZone {
  return typeof v === 'string' && (ZONES as readonly string[]).includes(v) ? (v as StageZone) : 'warband';
}

function coerceNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function coercePoint(v: unknown, fallback: StagePoint): StagePoint {
  if (v === null || typeof v !== 'object') return fallback;
  const p = v as Record<string, unknown>;
  const x = typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : fallback.x;
  const y = typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : fallback.y;
  return { x: clampFraction(x), y: clampFraction(y) };
}

/** Coerce one untrusted actor-ish value into a `StageActor`, or null if it has no usable `uid` — the one
 *  field nothing can be invented for. */
function coerceActor(v: unknown): StageActor | null {
  if (v === null || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.uid !== 'string' || a.uid === '') return null;
  return {
    uid: a.uid,
    zone: coerceZone(a.zone),
    slot: coerceNonNegInt(a.slot),
    role: coerceRole(a.role),
    atk: coerceNonNegInt(a.atk),
    hp: coerceNonNegInt(a.hp),
  };
}

/** Coerce one untrusted stage-ish value into a `StageState`, falling back to `DEFAULT_STAGE` wholesale when
 *  it isn't even an object — a stage is small enough that a partial recovery isn't worth the complexity a
 *  field-by-field fallback would add beyond the points/actors already handled per-field below. */
function coerceStage(v: unknown): StageState {
  if (v === null || typeof v !== 'object') return DEFAULT_STAGE;
  const s = v as Record<string, unknown>;
  const actors: StageActor[] = [];
  if (Array.isArray(s.actors)) {
    for (const a of s.actors) {
      const actor = coerceActor(a);
      if (actor !== null) actors.push(actor);
    }
  }
  return {
    source: coercePoint(s.source, DEFAULT_STAGE.source),
    target: coercePoint(s.target, DEFAULT_STAGE.target),
    cursor: coercePoint(s.cursor, DEFAULT_STAGE.cursor),
    actors,
  };
}

/** Parse whatever storage handed back into a valid `SavedStages`. Total — never throws, always returns
 *  something usable, mirroring `normalizeSession`'s defensive style. */
export function normalizeStages(raw: unknown): SavedStages {
  if (raw === null || typeof raw !== 'object') return { byDef: {}, last: DEFAULT_STAGE };
  const r = raw as Record<string, unknown>;
  const byDef: Record<string, StageState> = {};
  if (r.byDef !== null && typeof r.byDef === 'object' && !Array.isArray(r.byDef)) {
    for (const [key, val] of Object.entries(r.byDef as Record<string, unknown>)) {
      byDef[key] = coerceStage(val);
    }
  }
  return { byDef, last: coerceStage(r.last) };
}
