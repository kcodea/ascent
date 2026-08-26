import { DEFAULT_STAGE, normalizeStages, type SavedStages, type StageState } from './stageModel';

/**
 * Durable Stage Setter layouts, client side: one saved `StageState` per FX def (so reopening a def restores
 * its own actors/anchors) plus a global "last used" stage a brand-new def starts from.
 *
 * Same discipline as `defStore.ts`'s session-autosave helpers: nothing here throws. `localStorage` may be
 * absent (a headless test env — this repo's Vitest runs in the default `node` environment, with no DOM/
 * storage globals at all) or hostile (some privacy modes throw on merely touching the property), so every
 * access is guarded. A MODULE-LEVEL IN-MEMORY CACHE is the actual source of truth for every read/write in
 * this module; `localStorage`, when present, is a best-effort MIRROR of it — written on every save and
 * consulted on `loadStages()` so a value written by an earlier page load is picked up. When storage is
 * absent, the cache alone carries state for the life of the module, so the two paths behave identically:
 * save-then-read returns what was saved either way. `normalizeStages` is the one place untrusted JSON (a
 * stale/foreign blob) gets coerced back into a valid `SavedStages`; this module never re-validates fields
 * itself.
 */

/** localStorage key for saved stages. Versioned so a schema change is a key bump, mirroring `defStore.ts`. */
export const STAGES_KEY = 'ascent.fx.stages.v1';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Some privacy modes throw on merely *touching* the property.
    return null;
  }
}

/** The in-memory cache — the module's source of truth. `undefined` until the first hydration. */
let cache: SavedStages | undefined;

/** What's currently in `localStorage`, normalized — or `null` when storage is absent, empty, or its
 *  contents can't even be parsed as JSON. Never throws. */
function readFromStorage(): SavedStages | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STAGES_KEY);
    if (raw === null || raw === '') return null;
    return normalizeStages(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Best-effort persist of `cache` to storage. A quota error (or no storage at all) silently no-ops — the
 *  in-memory cache remains authoritative for the rest of this session either way. */
function persist(): void {
  if (cache === undefined) return;
  try {
    storage()?.setItem(STAGES_KEY, JSON.stringify(cache));
  } catch {
    /* ignore — best-effort, same contract as defStore.ts's saveSession */
  }
}

/**
 * The saved stages: per-def layouts plus the last-used one.
 *
 * Prefers whatever storage currently holds (so a value written by an earlier page load, or by another tab,
 * is picked up); when storage has nothing usable, falls back to the existing in-memory cache rather than
 * resetting it — that fallback is what keeps a storage-less environment behaviourally identical to a
 * storage-backed one (a `saveStageFor` followed by `loadStages` round-trips either way). Only when NEITHER
 * storage nor the cache has anything yet does this return the `{ byDef:{}, last: DEFAULT_STAGE }` empty
 * state.
 */
export function loadStages(): SavedStages {
  const fromStorage = readFromStorage();
  if (fromStorage !== null) {
    cache = fromStorage;
    return cache;
  }
  if (cache === undefined) cache = { byDef: {}, last: DEFAULT_STAGE };
  return cache;
}

/** Save `stage` as the layout for `defId` (when non-empty) and as the new "last used" stage. Persists to
 *  storage on a best-effort basis; the in-memory cache is always updated regardless. */
export function saveStageFor(defId: string | null, stage: StageState): void {
  const current = cache ?? loadStages();
  const byDef = defId !== null && defId !== '' ? { ...current.byDef, [defId]: stage } : current.byDef;
  cache = { byDef, last: stage };
  persist();
}

/** The stage to use for `defId`: its own saved layout, else the last-used one, else the default. */
export function stageFor(defId: string | null): StageState {
  const current = cache ?? loadStages();
  const byDefEntry = defId !== null ? current.byDef[defId] : undefined;
  return byDefEntry ?? current.last ?? DEFAULT_STAGE;
}
