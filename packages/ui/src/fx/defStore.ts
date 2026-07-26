import type { FxAnchorId, FxLayer } from './def';
import { coerceParams } from './params';
import { getPrimitive } from './registry';

/**
 * Durable FX defs, client side. This is the ONE seam between the workbench and the two places a def can
 * live: a committed file under `fx/defs/` (written by the dev-only Vite middleware — see
 * `apps/web/fxDefsPlugin.ts`) and a `localStorage` session snapshot.
 *
 * The two are deliberately different mechanisms because they solve different failures:
 *   • SAVE is deliberate and produces a git-tracked artifact — that is what makes a def shareable and, later,
 *     referenceable by id from the game.
 *   • SESSION autosave is a crash mat for the reload/HMR/panel-close data loss. You do NOT want a tracked
 *     file rewritten on every slider drag.
 *
 * Everything here is TOTAL: nothing throws. A def arriving from disk, a clipboard paste, or another
 * developer's machine is untrusted input, so it is validated and COERCED on the way in (`coerceDef`) —
 * every layer's params go through its primitive's own `coerceParams`, so a foreign or out-of-range value
 * degrades to that param's default instead of breaking the workbench. `parseDef` returns `null` only when
 * the input cannot be understood as a def at all.
 *
 * Nothing touches `fetch`, `localStorage`, or any other browser global at module scope — every access is
 * inside a function and guarded — so this module stays importable in the headless (node) test environment,
 * matching `shapeLibrary.ts`'s discipline.
 */

/** Schema version of a def file. Bumped when `FxLayer` grows a field that needs a migration. */
export const FX_DEF_VERSION = 1;

/** The id/slug grammar shared by def filenames and committed art filenames. Kept in lockstep with the copy
 *  in `apps/web/fxDefsPlugin.ts` — that one is the security boundary (it runs on the server), this one is
 *  the fast client-side check so a bad name is rejected before a round trip. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** localStorage key for the session snapshot. Versioned so a schema change is a key bump (old snapshots
 *  simply stop restoring) rather than a migration. */
const SESSION_KEY = 'ascent.fx.session.v1';

/**
 * A stored layer: the runtime `FxLayer` plus the workbench's authoring-only flags.
 *
 * `muted` lives HERE rather than on `FxLayer` because the runtime player takes mute as a live instruction
 * (`FxPlayer.setLayerMuted`), not as def data — but round-tripping the author's working state is far more
 * useful than silently dropping (or silently un-muting) a layer they had isolated, so it survives a save.
 */
/** Cap on a persisted layer name — matches the editor cap so a round-trip can never lengthen one. */
export const LAYER_NAME_MAX = 48;

export type StoredFxLayer = FxLayer & { muted?: boolean; solo?: boolean; name?: string };

/** A def as it is stored on disk. */
export interface StoredFxDef {
  version: 1;
  id: string;
  duration: number;
  /**
   * The seed the composition's randomness replays from, when the author LOCKED one (see the workbench's
   * seed control). OPTIONAL by design, and the reason `FX_DEF_VERSION` is not bumped: every def written
   * before seeding existed stays valid and simply means "roll fresh every time", which is exactly what an
   * unlocked composition means today. A def that carries one reproduces its exact look on any machine.
   */
  seed?: number;
  layers: StoredFxLayer[];
}

export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

const ANCHOR_IDS: readonly FxAnchorId[] = ['source', 'target', 'travel', 'cursor', 'slot', 'camera'];

/** The anchor an unreadable/absent anchor falls back to. `target` is where all but a couple of primitives
 *  play, so a coerced layer still lands somewhere sensible rather than at the origin. */
const FALLBACK_ANCHOR: FxAnchorId = 'target';

/** The id a def with no usable id of its own gets. */
const FALLBACK_ID = 'untitled';

// ─── slugs ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A display name → a filename-safe slug. Spaces and underscores become dashes, everything outside
 * `[a-z0-9-]` is dropped, runs of dashes collapse, leading/trailing dashes are trimmed, and the result is
 * capped at 64 characters (then re-trimmed, so the cap can't leave a trailing dash).
 *
 * Returns `''` for a name with nothing usable in it — deliberately NOT a "shape"-style fallback, so the UI
 * can tell the author "that name doesn't work" instead of silently saving over `untitled.json`.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug;
}

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

// ─── validation + coercion ────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce one raw layer, or `null` if it names a primitive this build doesn't have (the only reason to drop
 *  a layer: without its primitive there is no param spec to coerce against and nothing to render). */
function coerceLayer(raw: unknown): StoredFxLayer | null {
  if (!isRecord(raw)) return null;
  const primitiveId = typeof raw.primitive === 'string' ? raw.primitive : '';
  const prim = getPrimitive(primitiveId);
  if (!prim) return null;

  const anchor =
    typeof raw.anchor === 'string' && (ANCHOR_IDS as readonly string[]).includes(raw.anchor)
      ? (raw.anchor as FxAnchorId)
      : FALLBACK_ANCHOR;
  const at = Math.max(0, finite(raw.at) ?? 0);
  const life = finite(raw.life);
  const layer: StoredFxLayer = {
    primitive: primitiveId,
    anchor,
    at,
    params: coerceParams(prim.params, raw.params) as Record<string, unknown>,
  };
  // `life` is optional by design (omitted = live until the def's duration), so it is kept ONLY when it is a
  // usable number — a null/NaN/string `life` becomes an omission, not a zero-length layer.
  if (life !== null && life >= 0) layer.life = life;
  // Same optional-by-design treatment for the travel window: omitted means "the layer's whole life", which
  // is what every def did before `travelMs` existed, so a junk value must become an omission and never a
  // zero-length arc (which would park the head at the target from frame one).
  const travelMs = finite(raw.travelMs);
  if (travelMs !== null && travelMs > 0) layer.travelMs = travelMs;
  // Authoring state, kept ONLY when it is literally `true` — anything else (absent, false, 'yes', 1) means
  // "not muted", which is the default and must serialise as an omission.
  if (raw.muted === true) layer.muted = true;
  // ...and the same for `solo`, plus the author's layer `name`. These round-trip through the localStorage
  // session already; without them here a def FILE silently loses them, so saving and reloading your own
  // composition would drop every layer label and un-solo whatever you were isolating. Kept only when
  // meaningful (`solo` literally `true`, `name` a non-empty string) so an untouched layer still serialises
  // as the bare `{primitive, anchor, at, params}` it always did.
  if (raw.solo === true) layer.solo = true;
  if (typeof raw.name === 'string' && raw.name.trim() !== '') layer.name = raw.name.slice(0, LAYER_NAME_MAX);
  return layer;
}

/**
 * The shared "is this a def?" gate, used by BOTH `parseDef` (clipboard / paste) and the `fxDefs` registry
 * (committed files) so the two can never diverge. Total: returns `null` rather than throwing.
 *
 * `null` means "not a def at all" — not an object, no numeric `duration`, or no `layers` array. Anything
 * softer than that is repaired: an unknown primitive drops its layer, a bad anchor/at/life falls back, and
 * every param is run through its own spec's coercion.
 */
export function coerceDef(raw: unknown): StoredFxDef | null {
  if (!isRecord(raw)) return null;
  const duration = finite(raw.duration);
  if (duration === null) return null;
  if (!Array.isArray(raw.layers)) return null;

  const rawId = typeof raw.id === 'string' ? raw.id : '';
  const id = isValidSlug(rawId) ? rawId : slugify(rawId) || FALLBACK_ID;

  const version = finite(raw.version);
  if (version !== null && version !== FX_DEF_VERSION && import.meta.env.DEV) {
    console.warn(
      `[fx] def '${id}' declares version ${version}; this build only understands ${FX_DEF_VERSION} — ` +
        'loading it as v1 (fields it doesn\'t recognise are dropped).',
    );
  }

  const layers = raw.layers.map(coerceLayer).filter((l): l is StoredFxLayer => l !== null);
  const def: StoredFxDef = { version: FX_DEF_VERSION, id, duration: Math.max(0, duration), layers };
  // A seed is kept ONLY when it is a finite number; `NaN`, `"5"`, `null` and an absent field all mean the
  // same thing — no locked seed, roll fresh — so they are dropped rather than repaired into a wrong seed.
  const seed = finite(raw.seed);
  if (seed !== null) def.seed = seed;
  return def;
}

/** Parse def JSON (a paste, a file's contents). Never throws; `null` = not a def. */
export function parseDef(json: string): StoredFxDef | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return coerceDef(raw);
}

/** Build a `StoredFxDef` from the workbench's live editor state. `seed` is written only when a finite one is
 *  supplied — the workbench passes it ONLY while the seed is LOCKED, so an unlocked composition deliberately
 *  saves no seed and therefore keeps meaning "roll fresh every time". */
export function toStoredDef(id: string, duration: number, layers: StoredFxLayer[], seed?: number): StoredFxDef {
  const def: StoredFxDef = { version: FX_DEF_VERSION, id, duration, layers };
  if (typeof seed === 'number' && Number.isFinite(seed)) def.seed = seed;
  return def;
}

// ─── writing (dev server only) ────────────────────────────────────────────────────────────────────────

/** The data-URL prefix committed art must carry. Anything else is refused client-side AND server-side. */
export const ART_DATA_URL_PREFIX = 'data:image/png;base64,';

function unavailable(): SaveResult | null {
  // A production bundle has no middleware to talk to, and a node test environment has no `fetch` target.
  // Both fail closed with a readable reason rather than an exception or a mystery network error.
  if (!import.meta.env.DEV) return { ok: false, error: 'Saving defs is only available on the dev server.' };
  if (typeof fetch !== 'function') return { ok: false, error: 'This environment has no fetch.' };
  return null;
}

async function post(endpoint: string, body: unknown): Promise<SaveResult> {
  const blocked = unavailable();
  if (blocked) return blocked;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (isRecord(payload) && payload.ok === true && typeof payload.path === 'string') {
      return { ok: true, path: payload.path };
    }
    const error =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `${endpoint} responded ${res.status}.`;
    return { ok: false, error };
  } catch (e) {
    // Network failure / dev server down / plugin not registered.
    return { ok: false, error: `Could not reach the dev server (${(e as Error).message ?? 'network error'}).` };
  }
}

/** Write `defs/<id>.json`. Resolves with the failure rather than rejecting — Save is an inline-error UI. */
export async function saveDef(def: StoredFxDef): Promise<SaveResult> {
  if (!isValidSlug(def.id)) {
    return { ok: false, error: `'${def.id}' is not a usable name (lowercase letters, digits and dashes).` };
  }
  return post('/__fx/def', { id: def.id, json: JSON.stringify(def, null, 2) });
}

/** Write `defs/art/<slug>.png` from a PNG data URL, so a def's imported art travels with it. */
export async function saveArt(slug: string, dataUrl: string): Promise<SaveResult> {
  if (!isValidSlug(slug)) {
    return { ok: false, error: `'${slug}' is not a usable art name (lowercase letters, digits and dashes).` };
  }
  if (!dataUrl.startsWith(ART_DATA_URL_PREFIX)) {
    return { ok: false, error: 'Committed art must be a PNG data URL.' };
  }
  return post('/__fx/art', { slug, dataUrl });
}

// ─── session autosave ─────────────────────────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Some privacy modes throw on merely *touching* the property.
    return null;
  }
}

/** Best-effort snapshot of the current composition. A quota error (or no storage at all) silently no-ops:
 *  autosave is a safety net, never a thing that can break authoring. */
export function saveSession(state: unknown): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* ignore — autosave is best-effort */
  }
}

/** The last snapshot, or `null` if there is none / it is unreadable. Never throws. */
export function loadSession<T = unknown>(): T | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY) ?? null;
    if (raw === null || raw === '') return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore — best-effort */
  }
}
