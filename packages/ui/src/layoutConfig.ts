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
  { key: 'cardScale', cssVar: '--card-scale', label: 'Card size', group: 'Global', min: 0.5, max: 1.6, step: 0.01, def: 0.75, fmt: 'mul' },
  { key: 'uiScale', cssVar: '--ui-scale', label: 'UI chrome', group: 'Global', min: 0.5, max: 1.6, step: 0.01, def: 0.96, fmt: 'mul' },
  // Fine-scale the board backdrop art (its height on `.boardbg`) so the painted frame lines up with the (fixed
  // 16:9) UI when you swap in new board art — 1 = art scaled to the stage height.
  { key: 'boardZoom', cssVar: '--board-zoom', label: 'Board zoom', group: 'Global', min: 0.6, max: 1.8, step: 0.01, def: 1.25, fmt: 'mul' },
  // Board grow (owner 2026-10-28): the board ART alone grows (with its shadow); cards and both hero portraits keep their
  // size and seat. The hero cluster anchors to `--_artw`, which this deliberately does not touch.
  { key: 'boardGrow', cssVar: '--board-grow', label: 'Board art size', group: 'Global', min: 0.8, max: 1.4, step: 0.01, def: 1.05, fmt: 'mul' },
  // Gold, Refresh, Freeze, End Turn and the Tavern-up stone grow in place by this, on top of their own Scale sliders.
  { key: 'pieceGrow', cssVar: '--piece-grow', label: 'Edge buttons size', group: 'Global', min: 0.8, max: 1.4, step: 0.01, def: 1.05, fmt: 'mul' },
  // Shift the board backdrop art (its position on `.boardbg`). The art is WIDER than the 16:9 stage, so ~17% of
  // it spills past each side; a 16:9 fullscreen crops that spill while a wider browser window shows it. These
  // nudge the art so a feature sitting in the spill (e.g. the hero-portrait paw) can be pulled into the stage.
  { key: 'boardX', cssVar: '--board-x', label: 'Board X offset', group: 'Global', min: -800, max: 800, step: 1, def: 0, fmt: 'px' },
  { key: 'boardY', cssVar: '--board-y', label: 'Board Y offset', group: 'Global', min: -800, max: 800, step: 1, def: 5, fmt: 'px' },
  // Backdrop behind the cutout board (owner 2026-10-28): tile size, then a black wash and a colour wash over it. The
  // texture and the wash colour are the string knobs in LAYOUT_STR_VARS below.
  { key: 'btexSize', cssVar: '--btex-size', label: 'Tile size', group: 'Backdrop', min: 150, max: 2400, step: 10, def: 430, fmt: 'px' },
  { key: 'btexDark', cssVar: '--btex-dark', label: 'Darkness', group: 'Backdrop', min: 0, max: 1, step: 0.01, def: 0.24, fmt: 'mul' },
  { key: 'btexBlur', cssVar: '--btex-blur', label: 'Blur', group: 'Backdrop', min: 0, max: 30, step: 0.5, def: 0, fmt: 'px' },
  { key: 'btexTint', cssVar: '--btex-tint', label: 'Tint amount', group: 'Backdrop', min: 0, max: 1, step: 0.01, def: 0.16, fmt: 'mul' },
  { key: 'bshadowA', cssVar: '--bshadow-a', label: 'Board shadow strength', group: 'Backdrop', min: 0, max: 1, step: 0.01, def: 0.72, fmt: 'mul' },
  { key: 'bshadowX', cssVar: '--bshadow-x', label: 'Board shadow X', group: 'Backdrop', min: -80, max: 80, step: 1, def: 6, fmt: 'px' },
  { key: 'bshadowY', cssVar: '--bshadow-y', label: 'Board shadow Y', group: 'Backdrop', min: -80, max: 80, step: 1, def: 8, fmt: 'px' },
  // The hero group (portrait + rune slots + name pill + Health + hero power) as one, and the hero power on its own
  // inside it (on top of its board-grow shift). Owner 2026-10-28.
  { key: 'herogrpX', cssVar: '--herogrp-x', label: 'Group X', group: 'Hero group', min: -200, max: 200, step: 1, def: -35, fmt: 'px' },
  { key: 'herogrpY', cssVar: '--herogrp-y', label: 'Group Y', group: 'Hero group', min: -200, max: 200, step: 1, def: 0, fmt: 'px' },
  { key: 'hpowX', cssVar: '--hpow-x', label: 'Hero power X', group: 'Hero group', min: -200, max: 200, step: 1, def: 40, fmt: 'px' },
  { key: 'hpowY', cssVar: '--hpow-y', label: 'Hero power Y', group: 'Hero group', min: -200, max: 200, step: 1, def: 2, fmt: 'px' },
  // The foe's rune set in combat (slots + runes + glass), inside the foe cluster (scaled ~2.4x, so small numbers).
  { key: 'orunesX', cssVar: '--orunes-x', label: 'Foe runes X', group: 'Hero group', min: -60, max: 60, step: 1, def: -5, fmt: 'px' },
  { key: 'orunesY', cssVar: '--orunes-y', label: 'Foe runes Y', group: 'Hero group', min: -60, max: 60, step: 1, def: -5, fmt: 'px' },
  // Drop shadows under both heroes' portraits and their rune slots (owner 2026-10-28).
  { key: 'pshA', cssVar: '--psh-a', label: 'Portrait strength', group: 'Portrait shadows', min: 0, max: 1, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'pshBlur', cssVar: '--psh-blur', label: 'Portrait blur', group: 'Portrait shadows', min: 0, max: 60, step: 1, def: 15, fmt: 'px' },
  { key: 'pshX', cssVar: '--psh-x', label: 'Portrait X', group: 'Portrait shadows', min: -40, max: 40, step: 1, def: 0, fmt: 'px' },
  { key: 'pshY', cssVar: '--psh-y', label: 'Portrait Y', group: 'Portrait shadows', min: -40, max: 40, step: 1, def: 6, fmt: 'px' },
  { key: 'rshA', cssVar: '--rsh-a', label: 'Rune slot strength', group: 'Portrait shadows', min: 0, max: 1, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'rshBlur', cssVar: '--rsh-blur', label: 'Rune slot blur', group: 'Portrait shadows', min: 0, max: 40, step: 1, def: 10, fmt: 'px' },
  { key: 'rshX', cssVar: '--rsh-x', label: 'Rune slot X', group: 'Portrait shadows', min: -30, max: 30, step: 1, def: 0, fmt: 'px' },
  { key: 'rshY', cssVar: '--rsh-y', label: 'Rune slot Y', group: 'Portrait shadows', min: -30, max: 30, step: 1, def: 3, fmt: 'px' },

  { key: 'shopS', cssVar: '--z-shop-s', label: 'Card size', group: 'Shop row', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'shopGap', cssVar: '--z-shop-gap', label: 'Card gap', group: 'Shop row', min: 0, max: 80, step: 1, def: 18, fmt: 'px' },
  // Offsets the shop CARDS only (the tavern zone) — not the shop buttons (a separate `.shopbar`). The enemy
  // warband renders in this same tavern zone during combat, so these also place the opponent's board.
  { key: 'shopX', cssVar: '--z-shop-x', label: 'X offset', group: 'Shop row', min: -400, max: 400, step: 1, def: 8, fmt: 'px' },
  { key: 'shopY', cssVar: '--z-shop-y', label: 'Y offset', group: 'Shop row', min: -400, max: 400, step: 1, def: 52, fmt: 'px' },

  // The shop CONTROLS tray (round plaque + Upgrade/Reroll/Freeze/End Turn + info strip), scaled via its local --u.
  { key: 'shopUiS', cssVar: '--z-shopui-s', label: 'Scale', group: 'Shop controls', min: 0.5, max: 1.6, step: 0.01, def: 1.6, fmt: 'mul' },
  { key: 'shopUiX', cssVar: '--z-shopui-x', label: 'X offset', group: 'Shop controls', min: -400, max: 400, step: 1, def: 5, fmt: 'px' },
  { key: 'shopUiY', cssVar: '--z-shopui-y', label: 'Y offset', group: 'Shop controls', min: -400, max: 400, step: 1, def: -6, fmt: 'px' },

  { key: 'wbS', cssVar: '--z-wb-s', label: 'Card size', group: 'Warband', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'wbGap', cssVar: '--z-wb-gap', label: 'Card gap', group: 'Warband', min: 0, max: 80, step: 1, def: 18, fmt: 'px' },
  { key: 'wbX', cssVar: '--z-wb-x', label: 'X offset', group: 'Warband', min: -400, max: 400, step: 1, def: 9, fmt: 'px' },
  { key: 'wbY', cssVar: '--z-wb-y', label: 'Y offset', group: 'Warband', min: -400, max: 400, step: 1, def: -130, fmt: 'px' },

  { key: 'handS', cssVar: '--z-hand-s', label: 'Card size', group: 'Hand', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  // Hand cards fan + overlap via a NEGATIVE margin that's a fraction of the (compact) card width, so it stays
  // proportional to card size — hence 'mul' (of --ccw), not px: -0.44 = the shipped overlap, 0 = edges touch,
  // >0 = a real gap between fanned cards.
  { key: 'handGap', cssVar: '--z-hand-gap', label: 'Card overlap', group: 'Hand', min: -0.7, max: 0.1, step: 0.01, def: -0.11, fmt: 'mul' },
  { key: 'handX', cssVar: '--z-hand-x', label: 'X offset', group: 'Hand', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'handY', cssVar: '--z-hand-y', label: 'Y offset', group: 'Hand', min: -400, max: 400, step: 1, def: -107, fmt: 'px' },
  // How large a hand card grows when moused over (the hover pop). 1 = no growth.
  { key: 'handHoverS', cssVar: '--z-hand-hover-s', label: 'Hover size', group: 'Hand', min: 1, max: 1.9, step: 0.01, def: 1.47, fmt: 'mul' },

  // The hover/inspect card PREVIEW (the enlarged card + buff breakdown that floats up when you mouse a card).
  // Multiplies the device base (`--inspect-zoom`: 1 desktop, 1.3 mobile), so this is a size dial on top of it.
  { key: 'inspectS', cssVar: '--z-inspect-s', label: 'Hover preview size', group: 'Card hover', min: 0.5, max: 2.5, step: 0.02, def: 1.52, fmt: 'mul' },

  { key: 'hudS', cssVar: '--z-hud-s', label: 'Scale', group: 'HUD bar', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'hudX', cssVar: '--z-hud-x', label: 'X offset', group: 'HUD bar', min: -400, max: 400, step: 1, def: 0, fmt: 'px' },
  { key: 'hudY', cssVar: '--z-hud-y', label: 'Y offset', group: 'HUD bar', min: -400, max: 400, step: 1, def: -21, fmt: 'px' },

  // (Hero power rows retired 2026-07-16 — the diamond housing's position/scale/glow moved to the dedicated
  //  💠 Hero Power Button tuner / heroPowerBtnConfig.ts, mirroring the End Turn diamond's setup.)

  // Active-quest / rune nodes (the badge row above the hero panel). X/Y px nudges × --scale; separation = the gap.
  { key: 'qbS', cssVar: '--qb-s', label: 'Scale', group: 'Quest nodes', min: 0.5, max: 2, step: 0.01, def: 1.09, fmt: 'mul' },
  { key: 'qbX', cssVar: '--qb-x', label: 'X offset', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 75, fmt: 'px' },
  { key: 'qbY', cssVar: '--qb-y', label: 'Y offset', group: 'Quest nodes', min: -1400, max: 400, step: 1, def: -415, fmt: 'px' },
  { key: 'qbGap', cssVar: '--qb-gap', label: 'Separation', group: 'Quest nodes', min: 0, max: 30, step: 0.5, def: 11, fmt: 'mul' },
  // Per-node placement — the first three badges (quest/rune 1·2·3 in display order) each take an individual
  // X/Y nudge off their row slot, so all three can be positioned freely instead of only as a row. 0 = the row.
  { key: 'qb1X', cssVar: '--qb1-x', label: 'Node 1 · X', group: 'Quest nodes', min: -800, max: 800, step: 1, def: -5, fmt: 'px' },
  { key: 'qb1Y', cssVar: '--qb1-y', label: 'Node 1 · Y', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 53, fmt: 'px' },
  { key: 'qb2X', cssVar: '--qb2-x', label: 'Node 2 · X', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 13, fmt: 'px' },
  { key: 'qb2Y', cssVar: '--qb2-y', label: 'Node 2 · Y', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 5, fmt: 'px' },
  { key: 'qb3X', cssVar: '--qb3-x', label: 'Node 3 · X', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 36, fmt: 'px' },
  { key: 'qb3Y', cssVar: '--qb3-y', label: 'Node 3 · Y', group: 'Quest nodes', min: -800, max: 800, step: 1, def: 20, fmt: 'px' },
  // The empty-slot ring behind each node (styles.css `.quest-slot`), as a multiple of the node's size.
  { key: 'qslotS', cssVar: '--qslot-s', label: 'Slot frame size', group: 'Quest nodes', min: 1, max: 2.5, step: 0.01, def: 1.65, fmt: 'mul' },

  // Gold pill (bottom-right circle). X/Y are INSETS from the board's right / bottom edge (bigger = further in);
  // Scale sizes the whole circle. Match the styles.css `.goldpill` fallbacks.
  { key: 'goldS', cssVar: '--gold-s', label: 'Scale', group: 'Gold pill', min: 0.5, max: 2.5, step: 0.01, def: 1.69, fmt: 'mul' },
  { key: 'goldX', cssVar: '--gold-x', label: 'Inset from right', group: 'Gold pill', min: -200, max: 800, step: 1, def: 407, fmt: 'px' },
  { key: 'goldY', cssVar: '--gold-y', label: 'Inset from bottom', group: 'Gold pill', min: -200, max: 800, step: 1, def: 421, fmt: 'px' },

  // Tavern-tier text pill (on the Tavern Up stone). X/Y nudge it off the stone's bottom-centre; Scale sizes it.
  { key: 'tierS', cssVar: '--tierpill-s', label: 'Scale', group: 'Tavern tier', min: 0.4, max: 2.5, step: 0.01, def: 1.21, fmt: 'mul' },
  { key: 'tierX', cssVar: '--tierpill-x', label: 'X offset', group: 'Tavern tier', min: -400, max: 400, step: 1, def: 87, fmt: 'px' },
  { key: 'tierY', cssVar: '--tierpill-y', label: 'Y offset', group: 'Tavern tier', min: -400, max: 400, step: 1, def: -141, fmt: 'px' },

  // The end-of-turn CRYSTAL FUSE (the Charge Glyph's look since 2026-10-26). STATIC px scaled by --scale, anchored
  // to the measured board midline (--charge-y); Length extends the fuse (more crystal, tips unchanged) and Thickness sets its height, X/Y nudge it so its right tip
  // meets the End Turn gem. Defaults are the CSS fallbacks in styles.css `.chargeglyph` — keep the two in sync so
  // production (no tuner) matches a Reset. (Physics/look: Dev Menu → Crystal Fuse.)
  { key: 'glyphW', cssVar: '--charge-w', label: 'Length', group: 'Crystal Fuse', min: 200, max: 2400, step: 4, def: 1460, fmt: 'px' },
  { key: 'glyphH', cssVar: '--charge-h', label: 'Thickness', group: 'Crystal Fuse', min: 40, max: 260, step: 1, def: 90, fmt: 'px' },
  { key: 'glyphX', cssVar: '--charge-x', label: 'X offset', group: 'Crystal Fuse', min: -600, max: 600, step: 1, def: -14, fmt: 'px' },
  { key: 'glyphY', cssVar: '--charge-yoff', label: 'Y offset', group: 'Crystal Fuse', min: -400, max: 400, step: 1, def: -77, fmt: 'px' },

  // The drag-to-BUY / drag-to-SELL drop regions. Unlike the other groups these aren't pure CSS — the boundary is
  // computed in JS at drag start (sell = above the warband top; buy = below the board midline) and drives BOTH the
  // gradient overlay AND the actual drop hit-test. These px offsets nudge that boundary (read via getLayout() in
  // Recruit): +Sell edge lowers the sell line (bigger sell region); −Buy edge raises the buy line (bigger buy
  // region). Default 0 = no-op, so production (tuner unmounted, getLayout → defaults) is unchanged.
  { key: 'sellZoneY', cssVar: '--z-sellzone-y', label: 'Sell edge', group: 'Buy/Sell zones', min: -400, max: 400, step: 1, def: -136, fmt: 'px' },
  { key: 'buyZoneY', cssVar: '--z-buyzone-y', label: 'Buy edge', group: 'Buy/Sell zones', min: -400, max: 400, step: 1, def: 79, fmt: 'px' },
];

/** The Backdrop knobs that a player's Settings pick also sets (backdrop.ts). The Lab writes NONE of them until you
 *  touch one; from then on it writes ALL of them (so picking Stone in the Lab shows Stone, not the Settings choice)
 *  until Reset. The flag is saved, so a reload keeps the Lab's backdrop. */
const BACKDROP_PRESET_KEYS = new Set(['btexSize', 'btexDark', 'btexBlur', 'btexTint', 'btexImg', 'btexTintCol', 'bshadowA', 'bshadowX', 'bshadowY']);
const LAB_BACKDROP_KEY = 'ascent.layoutlab.backdropOn';
let labBackdropOn = ((): boolean => {
  if (!import.meta.env.DEV) return false;
  try { return localStorage.getItem(LAB_BACKDROP_KEY) === '1'; } catch { return false; }
})();
function setLabBackdropOn(on: boolean): void {
  labBackdropOn = on;
  try { if (on) localStorage.setItem(LAB_BACKDROP_KEY, '1'); else localStorage.removeItem(LAB_BACKDROP_KEY); } catch { /* ignore */ }
}

/**
 * BACKDROP TEXTURES (owner 2026-10-28: "ill be adding more"). Each is a seamless tile in apps/web/public. To add one:
 * drop the webp there and add a line here; it appears in the Layout Lab's Backdrop dropdown.
 * `cover: true` marks a SINGLE painted image instead of a tile (owner 2026-10-29): it is scaled to fill the window,
 * centred, never repeated, and the Tile size knob does nothing for it. Paint one 16:9 against the board template, with
 * the detail in the margins the board leaves visible.
 */
export const BACKDROP_TEXTURES: Record<string, { label: string; url: string; cover?: boolean }> = {
  stone: { label: 'Cobblestone', url: '/backdrop-stone.webp' },
  oak: { label: 'Oak planks', url: '/backdrop-oak-planks.webp' },
  sand: { label: 'Sand', url: '/backdrop-mystic-sand.webp' },
  aether: { label: 'Aether Stone', url: '/backdrop-arcane-crystal.webp' },
  moonstone: { label: 'Stone Pavers', url: '/backdrop-moonstone-pavers.webp' },
  runicSlate: { label: 'Runic Slate (image)', url: '/backdrop-runic-slate.webp', cover: true },
  cosmicEnergy: { label: 'Cosmic Energy (image)', url: '/backdrop-cosmic-energy.webp', cover: true },
};

/** How a texture fills the screen: `cover` (one image) or `tile` (repeat). */
export function backdropFit(texture: string | undefined): 'cover' | 'tile' {
  return texture && BACKDROP_TEXTURES[texture]?.cover ? 'cover' : 'tile';
}

/** The Layout Lab's STRING knobs (a dropdown or a colour), kept apart from the numeric ones so every numeric read of
 *  `getLayout()` stays a number. Same rules: dev-only, applied to `:root`, the CSS fallbacks are what ships. */
export interface LayoutStrDef {
  key: string;
  cssVar: string;
  label: string;
  group: string;
  kind: 'select' | 'color';
  def: string;
  options?: readonly string[];
  optionLabels?: Record<string, string>;
  /** The CSS value written for a stored value. */
  css: (v: string) => string;
}
export const LAYOUT_STR_VARS: LayoutStrDef[] = [
  {
    key: 'btexImg', cssVar: '--btex-img', label: 'Texture', group: 'Backdrop', kind: 'select', def: 'oak',
    options: Object.keys(BACKDROP_TEXTURES),
    optionLabels: Object.fromEntries(Object.entries(BACKDROP_TEXTURES).map(([k, v]) => [k, v.label])),
    css: (v) => `url('${(BACKDROP_TEXTURES[v] ?? BACKDROP_TEXTURES.stone).url}')`,
  },
  { key: 'btexTintCol', cssVar: '--btex-tint-col', label: 'Tint colour', group: 'Backdrop', kind: 'color', def: '#472a00', css: (v) => v },
];
export type LayoutStrConfig = Record<string, string>;
const STR_STORAGE_KEY = 'ascent.layoutlab.str';
const HEX = /^#[0-9a-f]{6}$/i;
export function defaultLayoutStrings(): LayoutStrConfig {
  return Object.fromEntries(LAYOUT_STR_VARS.map((v) => [v.key, v.def]));
}
function loadLayoutStrings(): LayoutStrConfig {
  const cfg = defaultLayoutStrings();
  if (!import.meta.env.DEV) return cfg;
  try {
    const stored = JSON.parse(localStorage.getItem(STR_STORAGE_KEY) || '{}') as Partial<LayoutStrConfig>;
    for (const v of LAYOUT_STR_VARS) {
      const s = stored[v.key];
      if (typeof s !== 'string') continue;
      if (v.kind === 'select' ? v.options?.includes(s) : HEX.test(s)) cfg[v.key] = s;
    }
  } catch { /* ignore */ }
  return cfg;
}
function applyLayoutStrings(cfg: LayoutStrConfig): void {
  const root = document.documentElement.style;
  for (const v of LAYOUT_STR_VARS) {
    const s = cfg[v.key] ?? v.def;
    if (BACKDROP_PRESET_KEYS.has(v.key) && !labBackdropOn) { root.removeProperty(v.cssVar); continue; }
    root.setProperty(v.cssVar, v.css(s));
  }
  // A cover texture can't be told apart by a CSS var value, so the Lab's fit rides on an attribute (styles.css
  // .boardbg-tex): set while the Lab drives the backdrop, so a tile picked here beats a cover picked in Settings.
  const html = document.documentElement;
  if (labBackdropOn) html.dataset.btexFit = backdropFit(cfg.btexImg ?? 'oak');
  else delete html.dataset.btexFit;
}
let currentStr: LayoutStrConfig = loadLayoutStrings();
export function getLayoutStrings(): LayoutStrConfig { return currentStr; }
export function setLayoutString(key: string, val: string): void {
  if (BACKDROP_PRESET_KEYS.has(key)) { setLabBackdropOn(true); applyLayout(current); }
  currentStr = { ...currentStr, [key]: val };
  try { localStorage.setItem(STR_STORAGE_KEY, JSON.stringify(currentStr)); } catch { /* ignore */ }
  applyLayoutStrings(currentStr);
}

export type LayoutConfig = Record<string, number>;
const STORAGE_KEY = 'ascent.layoutlab';

export function defaultLayout(): LayoutConfig {
  const o: LayoutConfig = {};
  for (const v of LAYOUT_VARS) o[v.key] = v.def;
  return o;
}

export function loadLayout(): LayoutConfig {
  const cfg = defaultLayout();
  // DEV-ONLY localStorage override: the Layout Lab's saved tweaks must never beat the shipped defaults in a
  // production build. The CSS side was already guarded (applyLayout at boot is dev-gated), but getLayout()'s
  // JS reads (the buy/sell zone edges in Recruit) still saw localStorage in prod (owner report 2026-07-21).
  if (!import.meta.env.DEV) return cfg;
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
    if (BACKDROP_PRESET_KEYS.has(v.key) && !labBackdropOn) { root.removeProperty(v.cssVar); continue; }
    root.setProperty(v.cssVar, v.fmt === 'px' ? `${n}px` : String(n));
  }
}

let current: LayoutConfig = loadLayout();
export function getLayout(): LayoutConfig { return current; }
export function setLayoutValue(key: string, val: number): void {
  if (BACKDROP_PRESET_KEYS.has(key)) { setLabBackdropOn(true); applyLayoutStrings(currentStr); }
  current = { ...current, [key]: val };
  saveLayout(current);
  applyLayout(current);
}
export function resetLayout(): void {
  setLabBackdropOn(false);
  current = defaultLayout();
  saveLayout(current);
  applyLayout(current);
  currentStr = defaultLayoutStrings();
  try { localStorage.setItem(STR_STORAGE_KEY, JSON.stringify(currentStr)); } catch { /* ignore */ }
  applyLayoutStrings(currentStr);
}

// Apply the persisted layout at module load — but only in dev (the tuner is dev-only; production keeps the CSS
// fallbacks, i.e. the shipped layout). So a saved tweak is live on every screen before the panel is ever opened.
if (import.meta.env.DEV) { applyLayout(current); applyLayoutStrings(currentStr); }
