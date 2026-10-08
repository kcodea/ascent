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
      tiers: Array.isArray(p.tiers) ? p.tiers.filter((t): t is number => Number.isInteger(t) && t >= 1 && t <= 7) : [],
      tribes: Array.isArray(p.tribes) ? p.tribes.filter((t): t is string => typeof t === 'string') : [],
    };
  } catch { return { ...DEFAULTS, tiers: [], tribes: [] }; }
}

export function saveGodPanelPrefs(p: GodPanelPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** How much of the panel must stay on the stage: enough of the header to grab it again (stage px). */
export const GOD_PANEL_GRIP = { w: 120, h: 40 };

/** A saved / dragged panel position clamped to the stage viewport `vp` (stage px), so the header is always on-stage
 *  and grabbable — whatever size the window was when the spot was saved. Rounded to whole px. */
export function clampGodPanelPos(p: { x: number; y: number }, vp: { w: number; h: number }): { x: number; y: number } {
  const x = Number.isFinite(p.x) ? p.x : 0;
  const y = Number.isFinite(p.y) ? p.y : 0;
  return {
    x: Math.round(Math.min(Math.max(0, x), Math.max(0, vp.w - GOD_PANEL_GRIP.w))),
    y: Math.round(Math.min(Math.max(0, y), Math.max(0, vp.h - GOD_PANEL_GRIP.h))),
  };
}
