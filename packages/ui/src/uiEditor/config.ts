/**
 * DEV-only "UI Edit Mode" flag. Two components observe it — the DevMenu toggle and the EditorOverlay — so it
 * carries a small listener set on top of the boardConfig-style guarded-localStorage persistence.
 */
const KEY = 'ascent.uiEdit';

export function parseMode(raw: string | null): boolean {
  return raw === '1';
}

function load(): boolean {
  try {
    return parseMode(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

let current = load();
const listeners = new Set<(on: boolean) => void>();

export function isUiEditMode(): boolean {
  return current;
}

export function setUiEditMode(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode / no storage — in-memory state still updates */
  }
  for (const fn of listeners) fn(on);
}

export function subscribeUiEditMode(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
