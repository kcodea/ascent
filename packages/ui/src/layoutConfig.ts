/**
 * DEV-only Layout Lab config — live scale + position tuning for the whole board, driven by CSS custom
 * properties on :root (the same trick FontLab uses for fonts). Two GLOBAL multipliers ride the master sizing
 * vars — `--card-scale` on `--ch` (every card, everywhere) and `--ui-scale` on `--u` (all HUD/chrome). The rest
 * are PER-REGION: a card/chrome scale + X/Y position for the shop, warband, hand, and top HUD bar.
 *
 * Combat safety: scaling is done by overriding the *sizing var* (`--ch` / `--u`), NOT a `transform` — the
 * tavern + warband zones host the combat units, whose per-swing GSAP lunges fight a parent transform (see the
 * warband note in styles.css). Positioning likewise uses layout (`top`/`left`) on the combat zones. So nothing
 * here can desync a fight.
 *
 * Every value defaults to a no-op (×1 / 0px), so an untouched tuner changes nothing and the vars fall back to
 * their defaults in production (where the tuner never mounts). Persists to localStorage; applied at boot in dev.
 */
export type LayoutFmt = 'mul' | 'px';
export interface LayoutVarDef {
  /** Stable id — also the localStorage field + React key. */
  key: string;
  /** The `:root` custom property this slider drives. */
  cssVar: string;
  label: string;
  /** Section header in the panel (grouping is by first-seen order). */
  group: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** `mul` → unitless multiplier (e.g. `1.2`); `px` → pixel offset (e.g. `-40px`). */
  fmt: LayoutFmt;
}

/** The full set of tunable knobs, in panel order. */
export const LAYOUT_VARS: LayoutVarDef[] = [
  { key: 'cardScale', cssVar: '--card-scale', label: 'Card size', group: 'Global', min: 0.5, max: 1.6, step: 0.01, def: 0.77, fmt: 'mul' },
  { key: 'uiScale', cssVar: '--ui-scale', label: 'UI chrome', group: 'Global', min: 0.5, max: 1.6, step: 0.01, def: 0.96, fmt: 'mul' },
  // Fine-scale the board backdrop art (its height on `.boardbg`) so the painted frame lines up with the (fixed
  // 16:9) UI when you swap in new board art — 1 = art scaled to the stage height.
  { key: 'boardZoom', cssVar: '--board-zoom', label: 'Board zoom', group: 'Global', min: 0.6, max: 1.8, step: 0.01, def: 1, fmt: 'mul' },

  { key: 'shopS', cssVar: '--z-shop-s', label: 'Card size', group: 'Shop row', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'shopGap', cssVar: '--z-shop-gap', label: 'Card gap', group: 'Shop row', min: 0, max: 80, step: 1, def: 22, fmt: 'px' },
  // Offsets the shop CARDS only (the tavern zone) — not the shop buttons (a separate `.shopbar`). The enemy
  // warband renders in this same tavern zone during combat, so these also place the opponent's board.
  { key: 'shopX', cssVar: '--z-shop-x', label: 'X offset', group: 'Shop row', min: -400, max: 400, step: 1, def: 6, fmt: 'px' },
  { key: 'shopY', cssVar: '--z-shop-y', label: 'Y offset', group: 'Shop row', min: -400, max: 400, step: 1, def: 46, fmt: 'px' },

  // The shop CONTROLS tray (round plaque + Upgrade/Reroll/Freeze/End Turn + info strip), scaled via its local --u.
  { key: 'shopUiS', cssVar: '--z-shopui-s', label: 'Scale', group: 'Shop controls', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'shopUiX', cssVar: '--z-shopui-x', label: 'X offset', group: 'Shop controls', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'shopUiY', cssVar: '--z-shopui-y', label: 'Y offset', group: 'Shop controls', min: -400, max: 400, step: 1, def: 18, fmt: 'px' },

  { key: 'wbS', cssVar: '--z-wb-s', label: 'Card size', group: 'Warband', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'wbGap', cssVar: '--z-wb-gap', label: 'Card gap', group: 'Warband', min: 0, max: 80, step: 1, def: 22, fmt: 'px' },
  { key: 'wbX', cssVar: '--z-wb-x', label: 'X offset', group: 'Warband', min: -400, max: 400, step: 1, def: 6, fmt: 'px' },
  { key: 'wbY', cssVar: '--z-wb-y', label: 'Y offset', group: 'Warband', min: -400, max: 400, step: 1, def: -79, fmt: 'px' },

  { key: 'handS', cssVar: '--z-hand-s', label: 'Card size', group: 'Hand', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  // Hand cards fan + overlap via a NEGATIVE margin that's a fraction of the (compact) card width, so it stays
  // proportional to card size — hence 'mul' (of --ccw), not px: -0.44 = the shipped overlap, 0 = edges touch,
  // >0 = a real gap between fanned cards.
  { key: 'handGap', cssVar: '--z-hand-gap', label: 'Card overlap', group: 'Hand', min: -0.7, max: 0.1, step: 0.01, def: -0.15, fmt: 'mul' },
  { key: 'handX', cssVar: '--z-hand-x', label: 'X offset', group: 'Hand', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'handY', cssVar: '--z-hand-y', label: 'Y offset', group: 'Hand', min: -400, max: 400, step: 1, def: -2, fmt: 'px' },

  { key: 'hudS', cssVar: '--z-hud-s', label: 'Scale', group: 'HUD bar', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'hudX', cssVar: '--z-hud-x', label: 'X offset', group: 'HUD bar', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'hudY', cssVar: '--z-hud-y', label: 'Y offset', group: 'HUD bar', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },

  // (Hero power rows retired 2026-07-16 — the diamond housing's position/scale/glow moved to the dedicated
  //  💠 Hero Power Button tuner / heroPowerBtnConfig.ts, mirroring the End Turn diamond's setup.)

  // Active-quest / rune nodes (the badge row above the hero panel). X/Y px nudges × --scale; separation = the gap.
  { key: 'qbS', cssVar: '--qb-s', label: 'Scale', group: 'Quest nodes', min: 0.5, max: 2, step: 0.01, def: 1.32, fmt: 'mul' },
  { key: 'qbX', cssVar: '--qb-x', label: 'X offset', group: 'Quest nodes', min: -800, max: 800, step: 1, def: -12, fmt: 'px' },
  { key: 'qbY', cssVar: '--qb-y', label: 'Y offset', group: 'Quest nodes', min: -1400, max: 400, step: 1, def: -746, fmt: 'px' },
  { key: 'qbGap', cssVar: '--qb-gap', label: 'Separation', group: 'Quest nodes', min: 0, max: 30, step: 0.5, def: 2, fmt: 'mul' },

  // The end-of-turn CHARGE GLYPH (replaces the rope). STATIC px scaled by --scale, anchored to the measured board
  // midline (--charge-y auto-aligns to the art divider at any aspect); Size scales the whole glyph (aspect-locked),
  // X/Y nudge it off the midline. Defaults are the CSS fallbacks in styles.css `.chargeglyph` — keep the two in
  // sync so production (no tuner) matches a Reset. (Look — colours/glow/timing — is tuned in fx/turn-glyph-preview.html.)
  { key: 'glyphW', cssVar: '--charge-w', label: 'Size', group: 'Charge Glyph', min: 200, max: 1600, step: 4, def: 1144, fmt: 'px' },
  { key: 'glyphX', cssVar: '--charge-x', label: 'X offset', group: 'Charge Glyph', min: -600, max: 600, step: 1, def: -5, fmt: 'px' },
  { key: 'glyphY', cssVar: '--charge-yoff', label: 'Y offset', group: 'Charge Glyph', min: -400, max: 400, step: 1, def: -19, fmt: 'px' },

  // The drag-to-BUY / drag-to-SELL drop regions. Unlike the other groups these aren't pure CSS — the boundary is
  // computed in JS at drag start (sell = above the warband top; buy = below the board midline) and drives BOTH the
  // gradient overlay AND the actual drop hit-test. These px offsets nudge that boundary (read via getLayout() in
  // Recruit): +Sell edge lowers the sell line (bigger sell region); −Buy edge raises the buy line (bigger buy
  // region). Default 0 = no-op, so production (tuner unmounted, getLayout → defaults) is unchanged.
  { key: 'sellZoneY', cssVar: '--z-sellzone-y', label: 'Sell edge', group: 'Buy/Sell zones', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'buyZoneY', cssVar: '--z-buyzone-y', label: 'Buy edge', group: 'Buy/Sell zones', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
];

export type LayoutConfig = Record<string, number>;
const STORAGE_KEY = 'ascent.layoutlab';

export function defaultLayout(): LayoutConfig {
  const o: LayoutConfig = {};
  for (const v of LAYOUT_VARS) o[v.key] = v.def;
  return o;
}

export function loadLayout(): LayoutConfig {
  const cfg = defaultLayout();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<LayoutConfig>;
    for (const v of LAYOUT_VARS) {
      const n = stored[v.key];
      if (typeof n === 'number' && Number.isFinite(n)) cfg[v.key] = n;
    }
  } catch { /* ignore */ }
  return cfg;
}

function saveLayout(cfg: LayoutConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

/** Push every value onto `:root` as its CSS custom property. Defaults produce a no-op (×1 / 0px). */
export function applyLayout(cfg: LayoutConfig): void {
  const root = document.documentElement.style;
  for (const v of LAYOUT_VARS) {
    const n = cfg[v.key] ?? v.def;
    root.setProperty(v.cssVar, v.fmt === 'px' ? `${n}px` : String(n));
  }
}

let current: LayoutConfig = loadLayout();
export function getLayout(): LayoutConfig { return current; }
export function setLayoutValue(key: string, val: number): void {
  current = { ...current, [key]: val };
  saveLayout(current);
  applyLayout(current);
}
export function resetLayout(): void {
  current = defaultLayout();
  saveLayout(current);
  applyLayout(current);
}

// Apply the persisted layout at module load — but only in dev (the tuner is dev-only; production keeps the CSS
// fallbacks, i.e. the shipped layout). So a saved tweak is live on every screen before the panel is ever opened.
if (import.meta.env.DEV) applyLayout(current);
