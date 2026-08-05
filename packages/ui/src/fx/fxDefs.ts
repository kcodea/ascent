/// <reference types="vite/client" />
import { DRAFT_DEF_ID } from '../choreo/bindings';
import { coerceDef, isValidSlug, type StoredFxDef } from './defStore';

/**
 * The registry of COMMITTED defs — every `packages/ui/src/fx/defs/*.json`, loaded at build time by
 * `import.meta.glob` (the same mechanism `art.ts`/`sfx.ts` already use for art and audio).
 *
 * This registry SHIPS. It used to be DEV-gated at the glob, so authored defs never reached players; the owner
 * flipped that (2026-07-29) and the glob now runs in every build.
 *
 * Measured cost of the flip: **+151,602 B raw / +34,206 B gzipped of total JS.** Only +17,829 B raw /
 * +4,868 B gzipped of that is the main chunk (these defs); the other 133,773 B (29,338 B gzipped) is the
 * primitives and their GLSL, in their own chunk fetched lazily on mount rather than blocking first paint. An
 * earlier estimate quoted the main-chunk figure alone and so understated it ~9× — quote both numbers.
 *
 * What stays DEV-only is AUTHORING, not playback: saving a def (`defStore.ts`), the imported-art glob
 * (`shapeLibrary.ts`), the `window.__fx` handle (`playDef.ts`), and the workbench UI under `DevMenu`. See
 * `docs/fx-workbench-guide.md`.
 *
 * Everything is validated on the way in through the SAME `coerceDef` the paste path uses, so a hand-edited
 * or foreign def degrades (unknown primitives dropped, out-of-range params coerced to their defaults)
 * instead of throwing into render. A file that isn't a def at all is skipped with a DEV warning.
 *
 * ORDER MATTERS, now that this ships: `coerceDef` resolves each layer's primitive through the registry and
 * DROPS layers whose primitive is unknown, and `index()` caches its result on the first read. A `getDef()`
 * that landed BEFORE the primitives registered would therefore cache every def stripped to zero layers —
 * permanently, and `playDef` declines a def with no playable layers. In the shipped game this can't happen:
 * the only production caller is `playDef`, which sits behind `canPlayDefs()` and so cannot run until
 * `ensureDefsReady()` has registered them. Anything new that reads the registry must respect that, or call
 * `refreshDefs()` afterwards. Pinned in `prodPlayback.test.ts`.
 *
 * The FILENAME is the authority on a def's id: `crit-impact.json` is `crit-impact`, whatever the JSON's own
 * `id` field says. That keeps `getDef(id)` in exact correspondence with what is on disk after a hand-rename.
 *
 * NB: `import.meta.glob` is a Vite transform, not a runtime function — the call site is replaced at
 * transform time (which is why the options object must be an inline literal). That holds under Vitest too,
 * since Vitest runs source through Vite. The `try` is for any OTHER loader (a plain `tsx`/node import),
 * where the untransformed call would throw; there it degrades to an empty registry.
 */

function readModules(): Record<string, unknown> {
  // No DEV gate: the glob runs in production too, so the committed defs are in the shipped bundle and players
  // see the authored effects. Adding a gate back here silently empties the registry for players — every def
  // binding in the Score goes inert with no error to explain it. Pinned by `prodPlayback.test.ts`.
  try {
    return import.meta.glob('./defs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** `./defs/crit-impact.json` → `crit-impact`. */
function idFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.json$/, '') ?? '';
}

let cache: Map<string, StoredFxDef> | null = null;

/**
 * Defs saved during THIS session, layered over the globbed set.
 *
 * This exists because an eager glob is expanded at TRANSFORM time, so a file written seconds ago is invisible
 * to it — verified in the browser: after saving `probe-demo.json` the library stayed empty and only picked the
 * def up after a full dev-server restart. Vite did NOT invalidate this module on the write (a plain `fs` write
 * from a middleware isn't a graph event), so `refreshDefs()` alone can never close the save → library loop.
 * Registering the def we just wrote keeps the library honest for the rest of the session; on the next reload
 * the globbed copy takes over and this overlay is simply redundant.
 */
const savedThisSession = new Map<string, StoredFxDef>();

function index(): Map<string, StoredFxDef> {
  if (cache) return cache;
  const out = new Map<string, StoredFxDef>();
  for (const [path, mod] of Object.entries(readModules())) {
    const def = coerceDef(mod);
    if (!def) {
      if (import.meta.env.DEV) console.warn(`[fx] '${path}' is not a valid def — skipped.`);
      continue;
    }
    const stem = idFromPath(path);
    if (import.meta.env.DEV && stem !== def.id) {
      console.warn(`[fx] '${path}' declares id '${def.id}' — using the filename '${stem}' instead.`);
    }
    const id = isValidSlug(stem) ? stem : def.id;
    out.set(id, { ...def, id });
  }
  // Session saves win: they are strictly newer than whatever the glob captured at transform time.
  for (const [id, def] of savedThisSession) out.set(id, def);
  cache = out;
  return out;
}

/**
 * Every committed def, sorted by id.
 *
 * The workbench's live DRAFT is excluded. It is registered here so the preview can resolve it (see
 * `DRAFT_DEF_ID` in `choreo/bindings.ts`), but it has NO file behind it — so listing it would put a
 * clickable phantom in the library that loads a def nobody can find on disk, and it lingers in
 * `savedThisSession` long after rail mode closes. `getDef` deliberately still returns it: that is the lookup
 * the preview goes through.
 */
export function listDefs(): StoredFxDef[] {
  return [...index().values()].filter((d) => d.id !== DRAFT_DEF_ID).sort((a, b) => a.id.localeCompare(b.id));
}

export function getDef(id: string): StoredFxDef | undefined {
  return index().get(id);
}

/**
 * Will this def actually DELIVER a stat change — does it have a live `react` layer with "Carries the
 * number" ticked?
 *
 * Ask before withholding. A cue holds the badge's new value so an effect can land it, but whether any
 * effect is left to land it is an AUTHORING decision that changes in the workbench, without the cue
 * knowing: pull the carrying layer off `ruby-gem-apply` and the gem hold is still placed with nothing to
 * release it, so the number just stops updating (owner report — a gem apply that needed a second click).
 *
 * A caller that checks this instead withholds nothing, which hands the change to `Card`'s intrinsic roll —
 * so the badge still rolls, on no authoring at all, rather than freezing. Muted layers don't count, since
 * `playableLayers` is what actually plays; a def that doesn't exist doesn't carry.
 */
export function defCarriesNumber(id: string): boolean {
  const def = getDef(id);
  if (def === undefined) return false;
  return def.layers.some((l) => l.muted !== true && l.primitive === 'react' && l.params?.carries === true);
}

/**
 * Record a def that was just written to disk, so the library reflects it immediately.
 *
 * Required, not an optimisation: see `savedThisSession` above — the eager glob cannot see a file created after
 * this module was transformed, and the write does not invalidate the module, so without this a designer hits
 * Save and their def does not appear until the dev server restarts.
 */
export function registerSavedDef(def: StoredFxDef): void {
  savedThisSession.set(def.id, def);
  cache = null;
}

/**
 * Drop the parsed cache so the next read re-validates. Call it after a save.
 *
 * On its own this only re-reads what the glob already captured — it CANNOT surface a file that didn't exist
 * when this module was transformed (see `savedThisSession`). `registerSavedDef` is what actually closes the
 * save → library loop; this stays for the case where the cache needs invalidating without a new def.
 */
export function refreshDefs(): void {
  cache = null;
}
