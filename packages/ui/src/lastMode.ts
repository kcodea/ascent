/**
 * LAST MODE PLAYED (UI refinement WS-2, 2026-10-16) — the mode picker marks the tile you last launched with a
 * "Last played" tag, so a returning player's usual door is easy to find. Tiles never move: the layout is fixed so
 * muscle memory holds, and Play (the ranked lobby) is always the large tile.
 *
 * A per-device convenience only (localStorage, wrapped: a private window or blocked storage just shows no tag).
 */
export type ModeKey = 'play' | 'practice' | 'gauntlet' | 'versus' | 'learn';
const KEY = 'ascent.lastMode';
const MODES: readonly ModeKey[] = ['play', 'practice', 'gauntlet', 'versus', 'learn'];

export function readLastMode(): ModeKey | null {
  try {
    const v = localStorage.getItem(KEY);
    return (MODES as readonly string[]).includes(v ?? '') ? (v as ModeKey) : null;
  } catch { return null; }
}

export function rememberMode(mode: ModeKey): void {
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked: no tag next time, nothing else changes */ }
}
