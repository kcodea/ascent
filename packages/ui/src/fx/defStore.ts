import { BOW_LIMIT } from './anchors';
import type { FxAnchorId, FxLayer, FxSlot } from './def';
import { coerceParams } from './params';
import { isIdentityCurve, MIN_CURVE_POINTS } from './curve';
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

/** localStorage key for the one-shot commit confirmation. Same versioning convention as `SESSION_KEY`, and
 *  same reason: a stale value simply stops being read rather than needing a migration. */
const COMMIT_NOTE_KEY = 'ascent.fx.commitnote.v1';

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
  /**
   * Authoring-only display name and free-text tags, for the library browser's search and grouping.
   * BOTH OPTIONAL and omitted when unset, on the same terms as `seed` above: every def written before these
   * existed stays byte-identical, and an untagged def is still fully browsable — it just can't be found by a
   * word that isn't derivable from its data (see `fx/ui/catalog.ts`).
   */
  label?: string;
  tags?: string[];
  /**
   * Which canvas the effect draws on — `'under'` (beneath every card) or, when absent, over them.
   * OPTIONAL and omitted-unless-`'under'` on exactly the same terms as `seed`/`label`/`tags` above: that is
   * what makes this a true no-op for every def already on disk, and why `FX_DEF_VERSION` is not bumped.
   */
  slot?: FxSlot;
  /**
   * A curve on the COMPOSITION'S clock — see `FxDef.ease`, which this carries verbatim.
   * OPTIONAL and omitted unless authored, on exactly the same terms as `seed`/`label`/`tags`/`slot` above,
   * which is what keeps every def already on disk byte-identical and `FX_DEF_VERSION` unbumped.
   */
  ease?: [number, number][];
  /**
   * How this effect loops WHEN looped (the caller decides whether to loop; this decides how). OPTIONAL and
   * omitted unless `'seamless'`, on the same terms as `seed`/`slot`/`ease` — a def that never touches it saves
   * the exact JSON it saved before this field existed. Absent = `'playOut'` (today's play-out-then-repeat).
   */
  loopMode?: 'seamless';
  /**
   * Signed loop-join offset in ms: `> 0` a gap between cycles, `< 0` (seamless only) an overlap. OPTIONAL and
   * omitted when `0`, same discipline as above.
   */
  loopJoinMs?: number;
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
  // The travel arc's bow. Unlike every other optional field here, `0` is MEANINGFUL — it is the straight
  // line the field exists to make expressible — so the guard is `!== null`, never a truthiness check, and a
  // junk value falls back to the default arc rather than to a laser nobody asked for. Clamped rather than
  // rejected: a hand-edited 50 is a typo, not an instruction to fling the head off-screen.
  const bow = finite(raw.bow);
  if (bow !== null) layer.bow = Math.max(-BOW_LIMIT, Math.min(BOW_LIMIT, bow));
  // Per-recipient stagger. Positive-only: 0 IS the default (fire with your copy), so a 0 must serialise as
  // an omission rather than as an explicit "no stagger" — otherwise every def written before this field
  // existed would gain a meaningless key on its next save. Negative is rejected the same way: a layer that
  // runs EARLIER on later recipients is a schedule nobody asked for and reads as a bug.
  const stagger = finite(raw.stagger);
  if (stagger !== null && stagger > 0) layer.stagger = stagger;
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
  // Same omit-unless-usable discipline as `seed`. A blank label and a tag list that contains nothing usable
  // both mean "not set" rather than "set to empty" — storing the empty form would make an untouched def stop
  // round-tripping unchanged.
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label !== '') def.label = label;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
    if (tags.length > 0) def.tags = tags;
  }
  // Only the literal strings `'under'` / `'above'` select a non-default canvas. `'over'`, absent, a typo,
  // `true`, a number — all mean the default slot, and all serialise back out as an OMISSION, so a def that
  // never touched this field round-trips byte-identically.
  if (raw.slot === 'under' || raw.slot === 'above') def.slot = raw.slot;
  // The def-level ease, on the same omit-unless-usable terms. A curve needs at least MIN_CURVE_POINTS pairs
  // of finite numbers to have a span to interpolate over; anything else means "no ease" rather than a curve
  // to be repaired, because a half-read curve would silently retime the whole composition. The identity ramp
  // is dropped too — it is what "no ease" MEANS, and keeping it would take the player off its fast path.
  const ease = coerceEase(raw.ease);
  if (ease !== null) def.ease = ease;
  // Only the literal string `'seamless'` opts in; absent/typo'd/anything-else means the default `'playOut'`,
  // which — like `slot`'s `'over'` — is expressed as an omission so an untouched def round-trips unchanged.
  if (raw.loopMode === 'seamless') def.loopMode = 'seamless';
  // Same omit-unless-usable discipline as `seed`, but `0` is the meaningful default here (no offset) rather
  // than a value worth keeping, so it is dropped alongside non-finite/absent input.
  const loopJoinMs = finite(raw.loopJoinMs);
  if (loopJoinMs !== null && loopJoinMs !== 0) def.loopJoinMs = loopJoinMs;
  return def;
}

/** A stored `ease` as a usable curve, or null for absent/unusable/identity. See `coerceDef`. */
function coerceEase(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < MIN_CURVE_POINTS) return null;
  const pts: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const t = finite(p[0]);
    const v = finite(p[1]);
    if (t === null || v === null) return null;
    pts.push([t, v]);
  }
  // Ascending by t is `sampleCurve`'s precondition, not something it checks — an unsorted curve would read
  // as a silently wrong shape rather than as an error.
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0]) return null;
  return isIdentityCurve(pts) ? null : pts;
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

/**
 * The `label`/`tags` a save under `id` should CARRY FORWARD from `prior` — `{}` when there is nothing to
 * carry, or when `prior` is a different def.
 *
 * The id check is the fork rule, and it lives here rather than at the call sites so there is exactly one
 * place it can be got wrong: metadata is inherited only when you are *overwriting the same def*. Saving the
 * composition under a NEW name is a fork, and a fork that inherited its source's filing would be indexed in
 * the library browser under words its author never wrote, can't see and can't change — the same reasoning
 * (and the same conclusion) as `materialiseVariant` in `Workbench.tsx`, which strips both fields for
 * precisely this reason.
 *
 * Same omit-unless-usable discipline as `coerceDef`: a blank label and an empty tag list mean "not set", so
 * they must not resurrect as empty fields. `tags` is COPIED, never aliased — `prior` is normally the live
 * registry entry, and handing the new def the same array would let a later mutation of one edit the other.
 */
function carriedMeta(id: string, prior: StoredFxDef | undefined): Pick<StoredFxDef, 'label' | 'tags'> {
  if (prior === undefined || prior.id !== id) return {};
  const meta: Pick<StoredFxDef, 'label' | 'tags'> = {};
  if (typeof prior.label === 'string' && prior.label.trim() !== '') meta.label = prior.label;
  if (Array.isArray(prior.tags) && prior.tags.length > 0) meta.tags = [...prior.tags];
  return meta;
}

/**
 * Build a `StoredFxDef` from the workbench's live editor state. `seed` is written only when a finite one is
 * supplied — the workbench passes it ONLY while the seed is LOCKED, so an unlocked composition deliberately
 * saves no seed and therefore keeps meaning "roll fresh every time".
 *
 * ── `prior` is REQUIRED, and that is the point ──
 * `label`/`tags` exist only on disk: the workbench has no editor for them, so the ONLY copy of a def's filing
 * is the file itself. Until 2026-08-01 this function built the def from editor state alone, which meant every
 * Save over an existing def silently deleted them — it cost the owner `strike-impact`'s label and tags, caught
 * by eye in review and restored by hand. Nothing else would have caught it.
 *
 * The fix is to carry them forward from whatever is already committed under this id, and the parameter is
 * REQUIRED rather than optional so the failure cannot come back: a new save path physically cannot compile
 * without deciding what the prior def is. Pass `getDef(id)`; pass `undefined` only where there is genuinely no
 * file behind the id (the in-memory draft). It stays a pure function — it takes the RESOLVED def, never the
 * registry — so it is testable in the headless environment like the rest of this module.
 */
export function toStoredDef(
  id: string,
  duration: number,
  layers: StoredFxLayer[],
  seed: number | undefined,
  slot: FxSlot | undefined,
  prior: StoredFxDef | undefined,
  /** Trailing and optional so every existing call site stays valid — a caller that has no ease says nothing
   *  rather than passing `undefined` through a hole in the middle of the signature. */
  ease?: ReadonlyArray<readonly [number, number]>,
  /** Trailing and optional for the same reason as `ease`. Accepts `'playOut'` (the default) as well as
   *  `'seamless'` so a caller that has resolved the mode down to a concrete value can still pass it through —
   *  `'playOut'` simply produces an omission, same as `undefined` would. */
  loopMode?: 'playOut' | 'seamless',
  loopJoinMs?: number,
): StoredFxDef {
  const meta = carriedMeta(id, prior);
  // Two literals rather than a post-hoc assignment purely for KEY ORDER: `version, id, label, tags, duration,
  // layers` is the order every metadata-carrying def already has on disk, so a re-save of one is a no-op diff
  // instead of a whole-file reshuffle that buries the real change.
  const def: StoredFxDef =
    meta.label === undefined && meta.tags === undefined
      ? { version: FX_DEF_VERSION, id, duration, layers }
      : { version: FX_DEF_VERSION, id, ...meta, duration, layers };
  if (typeof seed === 'number' && Number.isFinite(seed)) def.seed = seed;
  // Written ONLY for a non-default slot, so an author who never touches the toggle keeps saving the exact
  // JSON they saved before this field existed.
  if (slot === 'under' || slot === 'above') def.slot = slot;
  // Same rule as `slot`: the IDENTITY ramp is "no ease", so it is not written. An author who never draws one
  // keeps saving the exact JSON they saved before this field existed — and, more importantly, an author who
  // LOADS an eased def and re-saves it keeps the ease, which is the data-loss `label`/`tags` once had.
  if (ease !== undefined && !isIdentityCurve(ease)) def.ease = ease.map((p) => [p[0], p[1]] as [number, number]);
  // Same omit-unless-non-default rule as `slot`: `'playOut'` (and `undefined`) write nothing, so a def that
  // never touches looping keeps saving the exact JSON it saved before this field existed.
  if (loopMode === 'seamless') def.loopMode = 'seamless';
  if (typeof loopJoinMs === 'number' && Number.isFinite(loopJoinMs) && loopJoinMs !== 0) def.loopJoinMs = loopJoinMs;
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

/**
 * Commit the whole binding table to `packages/ui/src/choreo/bindings.json`.
 *
 * Takes the serialised text (from `bindingsJson()`) rather than an object, mirroring `saveDef`'s `json`
 * field — the endpoint re-serialises whatever it is given, so what lands on disk is stably formatted
 * regardless of the caller.
 *
 * Unlike `saveDef` there is no id to validate: the destination path is fixed by the plugin and never
 * derived from the request, so the traversal question `saveDef`'s slug check answers does not arise here.
 */
export async function saveBindings(json: string): Promise<SaveResult> {
  return post('/__fx/bindings', { json });
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

// ─── the commit confirmation, across the reload it causes ──────────────────────────────────────────────
//
// A commit writes TWO files, and BOTH force a full page reload. `bindings.json` is a static import Vite
// can't hot-reload; the def file lands in the globbed defs directory, where `fxDefsPlugin` answers an `add`
// by invalidating the glob owner and sending `full-reload` outright — and a `change` reloads too, because
// nothing in the import graph sets up an `import.meta.hot.accept` boundary. So the reload is set in motion
// by the FIRST write, not the last, and the workbench unmounts before its "Committed → …" line can be read.
// The documented way to confirm the tool's primary action used to be "check `git status`", which is not an
// acceptable answer for the primary action. So the note is parked in localStorage as early as the commit has
// something true to say, and picked up by the next mount, which clears it as it reads — see
// `loadCommitNote` / `clearCommitNote` and their callers in `Workbench.tsx`.
//
// Same best-effort contract as the session helpers above: a hostile/absent `localStorage` degrades to "no
// note", never to a throw. Losing a confirmation line is a papercut; breaking the commit that produced it
// would be a defect.

/**
 * A parked commit confirmation. `at` is an epoch-ms stamp supplied by the caller, never read from a clock in
 * here — the pure helpers below take `now` as an argument so they stay trivially testable.
 *
 * `level` exists because a commit can succeed *partly*: art that didn't travel, or a def written whose
 * binding then failed. The reload destroys the in-component `commitError` that used to carry that, so the
 * parked note has to be able to say "this went through, but read this" — and be styled as a warning rather
 * than wearing the green success treatment. A success banner over a partial failure is the exact inversion
 * this subsystem exists to prevent.
 */
export interface ParkedCommitNote {
  note: string;
  at: number;
  level: 'ok' | 'warn';
}

/** Past this age a parked note is prefixed rather than presented as if it just happened. */
export const COMMIT_NOTE_FRESH_MS = 10 * 60_000;
/** Past this age it isn't shown at all — it says nothing useful about the session you're now in. */
export const COMMIT_NOTE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Park the commit confirmation so it survives the page reload the commit's own writes force. */
export function saveCommitNote(note: string, at: number, level: 'ok' | 'warn' = 'ok'): void {
  try {
    if (note === '') return; // nothing to say; don't leave an empty banner to be picked up
    storage()?.setItem(COMMIT_NOTE_KEY, JSON.stringify({ note, at, level } satisfies ParkedCommitNote));
  } catch {
    /* ignore — a confirmation line is best-effort */
  }
}

/** The parked commit confirmation, or `null` if there is none / it is unreadable. Never throws. */
export function loadCommitNote(): ParkedCommitNote | null {
  try {
    const raw = storage()?.getItem(COMMIT_NOTE_KEY) ?? null;
    if (raw === null || raw === '') return null;
    const o = JSON.parse(raw) as Partial<ParkedCommitNote>;
    if (typeof o.note !== 'string' || o.note === '') return null;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
    return { note: o.note, at: o.at, level: o.level === 'warn' ? 'warn' : 'ok' };
  } catch {
    return null;
  }
}

/**
 * How a parked note should be presented at time `now`, or `null` if it is too stale to show.
 *
 * PURE, and takes `now` rather than calling `Date.now()`, so the thresholds are testable without faking a
 * clock. The staleness matters because the reload closes the workbench: a note can sit in storage across
 * arbitrarily many unrelated reloads and browser sessions before the tool is next opened, and presenting a
 * three-day-old commit as fresh confirmation of what you just did would be worse than showing nothing.
 */
export function presentCommitNote(
  parked: ParkedCommitNote | null,
  now: number,
): { text: string; level: 'ok' | 'warn' } | null {
  if (parked === null) return null;
  const age = now - parked.at;
  // A negative age means a clock change (or another machine's stamp); treat it as fresh rather than hiding a
  // note that is almost certainly the one the author just produced.
  if (age > COMMIT_NOTE_MAX_AGE_MS) return null;
  const stale = age > COMMIT_NOTE_FRESH_MS;
  return { text: stale ? `Earlier — ${parked.note}` : parked.note, level: parked.level };
}

/** Drop the parked confirmation. Called both after it is shown (so it shows exactly once, and can't
 *  reappear on some later unrelated reload) and at the START of a commit (so a failed commit can never leave
 *  the previous run's success note sitting in storage to be "confirmed" by the next reload). */
export function clearCommitNote(): void {
  try {
    storage()?.removeItem(COMMIT_NOTE_KEY);
  } catch {
    /* ignore — best-effort */
  }
}
