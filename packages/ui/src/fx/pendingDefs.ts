import type { StoredFxDef } from './defStore';
import { registerSavedDef } from './fxDefs';

/**
 * DEFS WAITING FOR "SAVE ALL EDITS" (owner ask 2026-09-25).
 *
 * Importing a sound onto a card in the FX Library's By-card view makes a tiny Sound def (`sfx-<name>`). Writing
 * that file into the globbed defs directory is what reloaded the page on every import: a NEW file matching an
 * `import.meta.glob` makes Vite force a reload. So the def is registered for this session straight away (it
 * plays at once) and parked here; "Save all edits" writes every parked def and `bindings.json` together, and the
 * page reloads once for the whole batch.
 *
 * Kept in localStorage as well as memory, and re-registered when this module loads, so a reload before the save
 * (the dev server restarting, a Workbench commit) does not strand a binding that points at a def which only ever
 * existed in the old tab. A def is dropped from here only once a save has been sent for it.
 */
const KEY = 'ascent.fx.pendingDefs';

const pending = new Map<string, StoredFxDef>();

function persist(): void {
  try {
    if (pending.size === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify([...pending.values()]));
  } catch { /* the in-memory copy still works */ }
}

(() => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return;
    for (const d of list as StoredFxDef[]) {
      if (d && typeof d.id === 'string' && Array.isArray(d.layers)) { pending.set(d.id, d); registerSavedDef(d); }
    }
  } catch { /* a corrupt blob degrades to nothing pending */ }
})();

/** Park a def to be written by the next "Save all edits". Registers it for this session so it plays now. */
export function addPendingDef(def: StoredFxDef): void {
  pending.set(def.id, def);
  registerSavedDef(def);
  persist();
}

export function pendingDefs(): StoredFxDef[] {
  return [...pending.values()];
}

export function hasPendingDefs(): boolean {
  return pending.size > 0;
}

/** Drop the given defs (they have been sent to disk). */
export function clearPendingDefs(ids: readonly string[]): void {
  for (const id of ids) pending.delete(id);
  persist();
}
