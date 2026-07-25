import type { FxAnchorId, FxLayer } from '../def';
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

/** Coerce one untrusted layer-ish value into an `EditorLayer`. Returns null when it has no usable primitive
 *  id — the one field nothing can be invented for. */
export function toEditorLayer(raw: unknown): EditorLayer | null {
  if (raw === null || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.primitive !== 'string' || l.primitive === '') return null;
  return {
    primitive: l.primitive,
    anchor: coerceAnchor(l.anchor),
    at: coerceAt(l.at),
    life: coerceLife(l.life),
    // Kept only when literally `true`, and OMITTED otherwise (never `muted: false`) so an untouched
    // composition is byte-for-byte what it was before mute existed — the default is an exact no-op.
    ...(l.muted === true ? { muted: true as const } : {}),
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
 * DEV-gated dynamic import), so dropping "unknown" primitives here would throw away a perfectly good
 * session on a cold boot. The registry-aware pass is `pruneUnknownPrimitives`, run once the registry is live.
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
 * Editor layers → the `FxLayer[]` a def is stored as, rewriting any `custom:…` param whose art was
 * successfully uploaded to its committed `art:<slug>` reference.
 *
 * Builds a COMPLETE copy — new layer objects AND new params objects — so the saved def can never alias (and
 * therefore never mutate) the live editor state. `life: null` maps back to `FxLayer.life` omitted.
 */
export function toStoredLayers(
  layers: readonly EditorLayer[],
  artRefs: ReadonlyMap<string, string>,
): StoredFxLayer[] {
  return layers.map((l) => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(l.params)) {
      params[key] = typeof value === 'string' ? artRefs.get(value) ?? value : value;
    }
    return {
      primitive: l.primitive,
      anchor: l.anchor,
      at: l.at,
      ...(l.life === null ? {} : { life: l.life }),
      // A muted layer is PERSISTED as muted rather than dropped or silently un-muted: the author's working
      // state (which layer they had isolated) is more useful to round-trip than either alternative, and a
      // dropped layer would lose its tuning outright. Omitted unless muted — the default stays an omission.
      ...(l.muted === true ? { muted: true } : {}),
      params,
    };
  });
}
