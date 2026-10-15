/**
 * VERSUS's door on the mode picker. OFF for players until the Versus migration and the `versus-resolve` finalize
 * deploy are live (2026-10-13): on in dev builds, or anywhere with `localStorage['ascent.versus'] = '1'`. When the
 * mode ships, flip `VERSUS_PUBLIC` and add the patch note in the same PR.
 */
export const VERSUS_PUBLIC = false;

export function versusEnabled(): boolean {
  if (VERSUS_PUBLIC || import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('ascent.versus') === '1';
  } catch {
    return false;
  }
}

/**
 * The Versus TEST tools (the "Add bot" seat button and its toggles): dev builds, or this browser opted in with
 * `localStorage['ascent.versus'] = '1'`. Never from `VERSUS_PUBLIC` alone, so a public build never shows them.
 */
export function versusTestToolsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('ascent.versus') === '1';
  } catch {
    return false;
  }
}
