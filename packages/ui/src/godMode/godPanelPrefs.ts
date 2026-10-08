// packages/ui/src/godMode/godPanelPrefs.ts
/** The God Mode panel's remembered state (position in stage px, collapse, filter chips). localStorage, per viewer. */
export interface GodPanelPrefs { x: number; y: number; collapsed: boolean; tiers: number[]; tribes: string[] }
const KEY = 'ascent.godmode.panel';
const DEFAULTS: GodPanelPrefs = { x: 24, y: 140, collapsed: false, tiers: [], tribes: [] };

export function loadGodPanelPrefs(): GodPanelPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GodPanelPrefs> | null;
    if (!p || typeof p !== 'object') return { ...DEFAULTS, tiers: [], tribes: [] };
    return {
      x: Number.isFinite(p.x) ? Number(p.x) : DEFAULTS.x,
      y: Number.isFinite(p.y) ? Number(p.y) : DEFAULTS.y,
      collapsed: p.collapsed === true,
      tiers: Array.isArray(p.tiers) ? p.tiers.filter((t): t is number => Number.isInteger(t) && t >= 1 && t <= 6) : [],
      tribes: Array.isArray(p.tribes) ? p.tribes.filter((t): t is string => typeof t === 'string') : [],
    };
  } catch { return { ...DEFAULTS, tiers: [], tribes: [] }; }
}

export function saveGodPanelPrefs(p: GodPanelPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
