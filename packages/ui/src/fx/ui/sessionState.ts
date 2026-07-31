import type { FxAnchorId, FxLayer, FxSlot } from '../def';
// TYPE-ONLY (erased at build time): this module stays free of `defStore`'s storage/fetch machinery, it just
// borrows the stored-layer shape so "what a save writes" has exactly one definition.
import type { StoredFxLayer } from '../defStore';
import type { EditorLayer } from './layerModel';

/**
 * The workbench's PURE marshalling layer: everything that turns untrusted outside data (a `localStorage`
 * autosave blob, a committed/pasted def's layers) into editor state, and editor state back into the
 * `FxLayer[]` a def is saved as.
 *
 * Same discipline (and the same reason) as `layerModel.ts`: no React, no Pixi, no registry, no storage —
 * every function here is a total function over plain data, so the "a session naming a primitive that no
 * longer exists must degrade, not break" and "saving never mutates live editor state" contracts are
 * unit-testable headlessly. The registry is injected as an `isKnown` predicate rather than imported.
 *
 * It is ALSO the home of the undo/redo stack (`HistoryState` + `pushHistory`/`undo`/`redo`/`shouldCoalesce`),
 * for the same reason: the interesting part of undo is arithmetic over snapshots — cap the stack, drop the
 * oldest, collapse a slider drag into one entry — and that arithmetic is worth testing without mounting a
 * React tree or a renderer. The stack is generic in its snapshot type, so this module never has to know what
 * the workbench considers "my effect".
 *
 * Nothing here throws: a malformed input degrades (a bad field falls back to its default, an unusable layer
 * is dropped, an unusable session returns `null`).
 */

/** The autosaved composition — exactly the three pieces of workbench state that make up "the effect". */
export interface WorkbenchSession {
  layers: EditorLayer[];
  selected: number;
  durationMs: number;
  /** The seed the composition replays from while `seedLocked` — see the workbench's seed control. Restored
   *  together with the lock so reopening the workbench shows the exact roll you left, not a fresh one.
   *  `null` = the snapshot recorded no seed (it predates the control, or storage was mangled); the caller
   *  substitutes a fresh `randomSeed()`, which is why this module never rolls one itself and stays pure. */
  seed: number | null;
  seedLocked: boolean;
  /** Which canvas the composition plays on — see `FxSlot`. Restored on the same "explicit value or the
   *  default" terms as `seedLocked`: a snapshot from before the toggle existed comes back `'over'`, which is
   *  where every composition has always played. */
  slot: FxSlot;
}

/** Duration clamp bounds, injected so this module never has to know the workbench's slider constants. */
export interface DurationBounds {
  min: number;
  max: number;
  fallback: number;
}

/** The namespace a locally-imported shape carries (`shapeLibrary.ts`'s `CUSTOM_SHAPE_PREFIX`). Duplicated
 *  as a plain literal rather than imported so this module stays free of `shapeLibrary` — and therefore of
 *  pixi.js — keeping it importable in the headless test environment. */
export const CUSTOM_SHAPE_REF_PREFIX = 'custom:';
/** The namespace a COMMITTED (git-tracked) piece of art carries once `saveDef` has uploaded it. */
export const ART_SHAPE_REF_PREFIX = 'art:';

const ANCHORS: readonly FxAnchorId[] = ['source', 'target', 'travel', 'cursor', 'slot', 'camera'];

const coerceAnchor = (v: unknown): FxAnchorId =>
  typeof v === 'string' && (ANCHORS as readonly string[]).includes(v) ? (v as FxAnchorId) : 'travel';

/** `at` is ms from effect start: any finite non-negative number, else 0. */
const coerceAt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** `life` is ms, or null = "runs to the def's full duration" (which is what a missing/invalid value means). */
const coerceLife = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** Params are copied, never aliased — a def loaded out of the `import.meta.glob` registry is a SHARED module
 *  object, and the editor must never be able to write through to it. */
const coerceParams = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/** How long an authoring-only layer name may be. A label, not a description — the layer row is 288px wide,
 *  and anything past this is ellipsised on screen anyway, so it is trimmed at the model instead of stored. */
export const LAYER_NAME_MAX = 48;

/** An authoring-only layer label, or `undefined` when there isn't a usable one. Whitespace-only is the SAME
 *  as absent (that's what clearing the rename box means: "go back to the primitive id"), so it collapses to
 *  an omission rather than an empty string — keeping "unnamed" a single representable state. */
export function coerceLayerName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, LAYER_NAME_MAX);
}

/** The travel window: a positive number of ms, or null = "use the layer's life". Anything else (absent,
 *  zero, negative, NaN, a string) is null — a zero-length arc would park the head at the target from the
 *  very first frame, which is worse than the default in every case. */
function coerceTravel(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Coerce one untrusted layer-ish value into an `EditorLayer`. Returns null when it has no usable primitive
 *  id — the one field nothing can be invented for. */
export function toEditorLayer(raw: unknown): EditorLayer | null {
  if (raw === null || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.primitive !== 'string' || l.primitive === '') return null;
  const name = coerceLayerName(l.name);
  return {
    primitive: l.primitive,
    // Same omit-unless-set discipline as `muted` below: an unnamed layer carries NO `name` key, so it
    // serialises exactly as it did before naming existed and falls back to the primitive id on screen.
    ...(name === undefined ? {} : { name }),
    anchor: coerceAnchor(l.anchor),
    at: coerceAt(l.at),
    life: coerceLife(l.life),
    // Omitted unless genuinely set, on the same terms as `muted`/`name` below: absent means "the arc takes
    // the layer's whole life", the behaviour every composition had before `travelMs` existed.
    ...(coerceTravel(l.travelMs) === null ? {} : { travelMs: coerceTravel(l.travelMs) }),
    // Kept only when literally `true`, and OMITTED otherwise (never `muted: false`) so an untouched
    // composition is byte-for-byte what it was before mute existed — the default is an exact no-op.
    ...(l.muted === true ? { muted: true as const } : {}),
    // Solo rides along with mute, on the same terms and for the same reason (see `effectiveMuted`).
    ...(l.solo === true ? { solo: true as const } : {}),
    params: coerceParams(l.params),
  };
}

/** A def's `FxLayer[]` → the editor's `EditorLayer[]`. `life` omitted ⇒ null ("full duration"); params are
 *  shallow-copied so the editor never writes into the loaded def. */
export function editorLayersFromDef(layers: readonly FxLayer[]): EditorLayer[] {
  const out: EditorLayer[] = [];
  for (const l of layers) {
    const editor = toEditorLayer(l);
    if (editor !== null) out.push(editor);
  }
  return out;
}

/** Clamp a duration into the workbench's slider band, falling back for a non-number. */
export function clampDuration(v: unknown, bounds: DurationBounds): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, v));
}

/**
 * Parse whatever `loadSession()` handed back into a usable session, or null if there is nothing to restore.
 *
 * Deliberately registry-BLIND: at mount the primitives may not have self-registered yet (they arrive via a
 * dynamic import, so the registry is empty for a beat), so dropping "unknown" primitives here would throw
 * away a perfectly good session on a cold boot. The registry-aware pass is `pruneUnknownPrimitives`, run once
 * the registry is live.
 */
export function normalizeSession(raw: unknown, bounds: DurationBounds): WorkbenchSession | null {
  if (raw === null || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.layers)) return null;
  const layers: EditorLayer[] = [];
  for (const l of s.layers) {
    const editor = toEditorLayer(l);
    if (editor !== null) layers.push(editor);
  }
  if (layers.length === 0) return null;
  const rawSelected = typeof s.selected === 'number' && Number.isFinite(s.selected) ? Math.floor(s.selected) : 0;
  return {
    layers,
    selected: Math.min(layers.length - 1, Math.max(0, rawSelected)),
    durationMs: clampDuration(s.durationMs, bounds),
    seed: typeof s.seed === 'number' && Number.isFinite(s.seed) ? s.seed : null,
    // Locked only on an explicit `true`: a snapshot that predates the seed control (or a mangled one) must
    // restore UNLOCKED, i.e. today's fresh-roll-per-spawn behaviour.
    seedLocked: s.seedLocked === true,
    // Same discipline: only the literal 'under' selects the under-card canvas, so an older snapshot (or a
    // mangled one) restores to the default slot rather than to a surprise.
    slot: s.slot === 'under' ? 'under' : 'over',
  };
}

/**
 * Drop every layer whose primitive is no longer registered. Returns `null` when nothing needs dropping — the
 * caller uses that to skip a state commit entirely (and therefore skip a player rebuild) in the common case.
 * May return an EMPTY array: a session whose every primitive vanished has nothing left, and the caller
 * substitutes a fresh default layer.
 *
 * This is the guard behind "a restored session naming a primitive that no longer exists must degrade rather
 * than break the build effect" — the build effect polls forever while any layer's primitive is unregistered,
 * so something has to remove it.
 */
export function pruneUnknownPrimitives(
  layers: readonly EditorLayer[],
  isKnown: (primitive: string) => boolean,
): EditorLayer[] | null {
  const kept = layers.filter((l) => isKnown(l.primitive));
  return kept.length === layers.length ? null : kept;
}

/**
 * Every distinct `custom:…` shape reference in a composition's params, in first-seen order. These are the
 * locally-imported PNGs that must travel with a def (their bytes live only in the author's localStorage).
 */
export function collectCustomShapeRefs(layers: readonly EditorLayer[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of layers) {
    for (const value of Object.values(l.params)) {
      if (typeof value === 'string' && value.startsWith(CUSTOM_SHAPE_REF_PREFIX) && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

/** `custom:my-shard` → `my-shard`. */
export function artSlugOf(customRef: string): string {
  return customRef.slice(CUSTOM_SHAPE_REF_PREFIX.length);
}

/**
 * What a save WRITES for one layer: the runtime layer, plus the workbench's authoring-only flags.
 *
 * `muted` is already part of `StoredFxLayer` (see `defStore.ts`); `name` and `solo` are additive fields on
 * top of it, declared here rather than there because they are purely an authoring convenience — the runtime
 * player has no concept of either. Written unconditionally-when-set so a session/def round-trips the
 * author's working state; a reader that doesn't know them simply ignores them.
 */
export type StoredEditorLayer = StoredFxLayer & { name?: string; solo?: boolean };

/**
 * Editor layers → the `FxLayer[]` a def is stored as, rewriting any `custom:…` param whose art was
 * successfully uploaded to its committed `art:<slug>` reference.
 *
 * Builds a COMPLETE copy — new layer objects AND new params objects — so the saved def can never alias (and
 * therefore never mutate) the live editor state. `life: null` maps back to `FxLayer.life` omitted.
 */
export function toStoredLayers(
  layers: readonly EditorLayer[],
  artRefs: ReadonlyMap<string, string>,
): StoredEditorLayer[] {
  return layers.map((l) => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(l.params)) {
      params[key] = typeof value === 'string' ? artRefs.get(value) ?? value : value;
    }
    return {
      primitive: l.primitive,
      // The author's label for this layer ("impact flash" beats a third row reading "burst"). Omitted unless
      // set, exactly like `muted`, so an unnamed composition serialises byte-for-byte as it always has.
      ...(l.name === undefined ? {} : { name: l.name }),
      anchor: l.anchor,
      at: l.at,
      ...(l.life === null ? {} : { life: l.life }),
      ...(l.travelMs === null || l.travelMs === undefined ? {} : { travelMs: l.travelMs }),
      // A muted layer is PERSISTED as muted rather than dropped or silently un-muted: the author's working
      // state (which layer they had isolated) is more useful to round-trip than either alternative, and a
      // dropped layer would lose its tuning outright. Omitted unless muted — the default stays an omission.
      ...(l.muted === true ? { muted: true } : {}),
      ...(l.solo === true ? { solo: true } : {}),
      params,
    };
  });
}

// ─── undo / redo ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A past/present/future stack over whatever the caller considers one editable state. Generic on purpose: the
 * workbench's snapshot type (layers + selection + duration + seed) is a UI concern, and keeping it out of
 * here is what lets the whole stack be tested as arithmetic.
 *
 * `past` is oldest-first, so the most recent undoable state is `past[past.length - 1]`. `future` is
 * newest-first, so `future[0]` is what the next redo restores.
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/** How many undo steps are kept. Past this, the OLDEST entry is dropped — an editing session is unbounded,
 *  and every entry pins a whole composition (layers + params) in memory. */
export const HISTORY_LIMIT = 50;

/** How long after an edit a same-kind, same-key edit still counts as the SAME gesture. Long enough to span
 *  the gaps in a slow drag (a range input fires per pixel of travel, but a hesitant hand can stall), short
 *  enough that a deliberate second adjustment reads as its own step. */
export const COALESCE_WINDOW_MS = 400;

/**
 * What kind of edit produced a snapshot. The CONTINUOUS kinds are the ones driven by a control that fires
 * repeatedly across one physical gesture (a range input, a number field being typed into); `structural` is
 * everything discrete — add/remove/reorder/duplicate/primitive-swap/anchor/mute/solo/rename/load — and never
 * collapses into a neighbour.
 */
export type HistoryKind = 'param' | 'timing' | 'duration' | 'seed' | 'structural';

/** The provenance of the most recent history entry — the input to the coalescing decision. `key` narrows
 *  `kind` to the exact control (a param key, a layer index), so dragging `size` and then `angle` is two
 *  entries even though both are `param` edits. */
export interface HistoryMark {
  kind: HistoryKind;
  key: string;
  atMs: number;
}

const CONTINUOUS_KINDS: readonly HistoryKind[] = ['param', 'timing', 'duration', 'seed'];

/** A fresh stack with nothing to undo or redo. */
export function initHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/**
 * Record `next` as the new present, making the outgoing present undoable. Clears `future` — the classic
 * rule: editing after an undo forks, and the abandoned branch is not reachable again.
 *
 * Beyond `limit` entries the OLDEST past state is dropped (you keep the recent steps you actually reach for,
 * not the ones from an hour ago).
 */
export function pushHistory<T>(h: HistoryState<T>, next: T, limit: number = HISTORY_LIMIT): HistoryState<T> {
  if (limit <= 0) return { past: [], present: next, future: [] };
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

/**
 * Swap the present WITHOUT making the outgoing one undoable — the coalescing half of `pushHistory`. This is
 * what keeps a continuous slider drag to a single undo step: the first frame of the gesture pushes (so the
 * pre-drag state is undoable), every frame after it replaces.
 */
export function replaceHistoryPresent<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  return { past: h.past, present: next, future: [] };
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0;
}

/** Step back one entry. A no-op (returns the SAME object) at the bottom of the stack. */
export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}

/** Step forward one entry. A no-op (returns the SAME object) at the top of the stack. */
export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  };
}

/**
 * Is `next` a continuation of the gesture that produced `prev`, rather than a new undo step?
 *
 * Pure, and the whole coalescing policy in one place: same kind, same key, both kinds continuous, and inside
 * the window measured from the PREVIOUS edit (so a long drag keeps extending the same entry, while a pause
 * ends it). A `structural` edit never coalesces in either direction — a primitive swap sitting in the middle
 * of a drag must not be swallowed by it, which is precisely the destructive action undo exists to reverse.
 */
export function shouldCoalesce(
  prev: HistoryMark | null,
  next: HistoryMark,
  windowMs: number = COALESCE_WINDOW_MS,
): boolean {
  if (prev === null) return false;
  if (!CONTINUOUS_KINDS.includes(prev.kind) || !CONTINUOUS_KINDS.includes(next.kind)) return false;
  if (prev.kind !== next.kind || prev.key !== next.key) return false;
  const dt = next.atMs - prev.atMs;
  return dt >= 0 && dt <= windowMs;
}
