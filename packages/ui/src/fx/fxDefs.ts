/// <reference types="vite/client" />
import { coerceDef, isValidSlug, type StoredFxDef } from './defStore';

/**
 * The registry of COMMITTED defs — every `packages/ui/src/fx/defs/*.json`, loaded at build time by
 * `import.meta.glob` (the same mechanism `art.ts`/`sfx.ts` already use for art and audio).
 *
 * DEV-gated for now: nothing in a production build can play a def yet (the primitives themselves are
 * dev-only), and gating at the glob keeps the JSON out of the shipped bundle entirely. Making this a real
 * module NOW means the eventual game-side flip is a one-line change rather than a redesign.
 *
 * Everything is validated on the way in through the SAME `coerceDef` the paste path uses, so a hand-edited
 * or foreign def degrades (unknown primitives dropped, out-of-range params coerced to their defaults)
 * instead of throwing into render. A file that isn't a def at all is skipped with a DEV warning.
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
  if (!import.meta.env.DEV) return {};
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

/** Every committed def, sorted by id. */
export function listDefs(): StoredFxDef[] {
  return [...index().values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getDef(id: string): StoredFxDef | undefined {
  return index().get(id);
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
