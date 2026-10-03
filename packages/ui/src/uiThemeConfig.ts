import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * THE UI THEME (owner ask 2026-10-02: "can you make the tooltips match our hud pill designs now, and then add 6
 * different color themes in the tuner for me to try out to see what looks best. this should control all of them at
 * once").
 *
 * ONE set of colour tokens, the `--ui-*` custom properties declared on `:root` in `uiTheme.css`, paints BOTH the
 * shared tooltip panel (`tooltips.css`, through its `--atip-*` aliases) and every Gem plate HUD pill
 * (`healthPills.css`: Health, names, Tier / Freeze, the turn timer, the combat controls). A theme is a full set of
 * those token values; switching one rewrites the tokens on `:root`, so every surface repaints at once with no React
 * re-render (CSS variables only).
 *
 * 30 themes since 2026-10-03 (owner asks: "add 12 new color themes for the ui in the ui tuner", then "add 12 more
 * themes ... separate them by color scheme"), listed in the tuner in `<optgroup>` sections (`UI_THEME_GROUPS`).
 *
 * DEV only: the pick persists in localStorage (`ascent.uiTheme`) and is applied at load by the 🎨 UI Theme tuner's
 * module. Production never loads this module and plays the BAKED `:root` block in uiTheme.css, which MUST equal the
 * `DEFAULT_THEME` entry below (`tooltipStyle.test.ts` checks the pair).
 *
 * TO BAKE A PICK: set `DEFAULT_THEME` to it, then paste the tuner's "Copy values" block over the `:root` token block
 * in uiTheme.css. Colour only: no token here is a size, so a theme can never move or resize anything.
 *
 * Replaces the 2026-08 "UI Theme" glass-surface tuner (#938, ten presets over the old `--gl-*` vars); its storage key
 * `ascent.uitheme` is cleared at load.
 */

/** Every themed colour. Keys map 1:1 to `--ui-<kebab>` custom properties (see `UI_THEME_VARS`). */
export interface UiThemeTokens {
  /** The plate: a three-stop vertical gradient (top, middle at 55%, bottom). */
  plateTop: string; plateMid: string; plateBot: string;
  /** The filigree edge: a four-stop metallic gradient (highlight, main, shadow, return glint). */
  edgeHi: string; edgeMain: string; edgeDeep: string; edgeLo: string;
  /** The faint inner ring just inside the edge. */
  ring: string;
  /** Text on the plate: body, secondary, titles, highlighted keywords and numbers. */
  text: string; muted: string; title: string; hl: string;
  /** Small chip / tag pills inside a tooltip ("once per turn"). */
  chipBg: string; chipEdge: string; chipText: string;
  /** The divider under a tooltip title. */
  divider: string;
  /** Icon tint on the plate (the Skip / Summary icons, the turn clock's hands stay gold-on-plate). */
  icon: string;
  /** Semantic: the Health heart and the steel Armor chip. */
  heart: string; armorTop: string; armorMid: string; armorBot: string; armorEdge: string; armorInk: string; armorIcon: string;
  /** Semantic: a GHOST opponent (an eliminated seat's board served as the round's foe), the lobby rail's teal
   *  next-foe marker (owner ask 2026-10-02). */
  ghost: string;
  /** The gold turn clock (Gem timer icon): its rim + centre pin, and its dial face. */
  clockRim: string; clockFace: string;
  /** Semantic: low turn time (the timer's digits, and the clock's rim, outline and hands). */
  warn: string; warnRim: string; warnEdge: string; warnHand: string;
  /** A button's hover plate and edge. */
  hoverTop: string; hoverMid: string; hoverBot: string;
  hoverEdgeHi: string; hoverEdgeMain: string; hoverEdgeDeep: string; hoverEdgeLo: string;
  /** The Skip button's press lip, and the dark outline of the filigree studs. */
  lip: string; studEdge: string;
}

export const UI_THEME_KEYS = [
  'plateTop', 'plateMid', 'plateBot', 'edgeHi', 'edgeMain', 'edgeDeep', 'edgeLo', 'ring',
  'text', 'muted', 'title', 'hl', 'chipBg', 'chipEdge', 'chipText', 'divider', 'icon',
  'heart', 'ghost', 'armorTop', 'armorMid', 'armorBot', 'armorEdge', 'armorInk', 'armorIcon',
  'clockRim', 'clockFace', 'warn', 'warnRim', 'warnEdge', 'warnHand',
  'hoverTop', 'hoverMid', 'hoverBot', 'hoverEdgeHi', 'hoverEdgeMain', 'hoverEdgeDeep', 'hoverEdgeLo',
  'lip', 'studEdge',
] as const satisfies readonly (keyof UiThemeTokens)[];

/** `plateTop` -> `--ui-plate-top`. */
export const uiVar = (k: keyof UiThemeTokens): string => `--ui-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
export const UI_THEME_VARS: Record<keyof UiThemeTokens, string> =
  Object.fromEntries(UI_THEME_KEYS.map((k) => [k, uiVar(k)])) as Record<keyof UiThemeTokens, string>;

/** The steel Armor chip reads the same in every theme (it is a semantic colour); Frost tints it a touch icier. */
const WARN = { warnRim: '#ff6b81', warnEdge: '#7a1f2e', warnHand: '#ffd0d8' };
const STEEL = { armorTop: '#eef2f6', armorMid: '#b3bdca', armorBot: '#7d8999', armorEdge: '#262d39', armorInk: '#18202c', armorIcon: '#3b4758' };

export const UI_THEMES = {
  /** The Gem plate the HUD pills shipped with: deep amethyst, warm gold filigree. */
  gem: {
    plateTop: '#382950', plateMid: '#21173a', plateBot: '#170f29',
    edgeHi: '#ffe9b0', edgeMain: '#c8953f', edgeDeep: '#7a571f', edgeLo: '#e8c27a', ring: 'rgba(255, 217, 138, 0.2)',
    text: '#fff1d6', muted: '#c6b8d8', title: '#ffd98a', hl: '#ffb561',
    chipBg: '#140d24', chipEdge: '#6b5330', chipText: '#f4ecdb', divider: 'rgba(255, 217, 138, 0.2)', icon: '#ffd98a',
    heart: '#ff2f58', ghost: '#4fdccb', ...STEEL, clockRim: '#e3b04f', clockFace: '#1d1430', warn: '#ff9db0', ...WARN,
    hoverTop: '#4a3768', hoverMid: '#2d2050', hoverBot: '#1f1638',
    hoverEdgeHi: '#fff6d6', hoverEdgeMain: '#ffd27a', hoverEdgeDeep: '#b98a3a', hoverEdgeLo: '#ffe3a0',
    lip: '#6a4b19', studEdge: '#4a3410',
  },
  /** Deep navy with a silver-gold edge. */
  sapphire: {
    plateTop: '#24396a', plateMid: '#15244d', plateBot: '#0c1636',
    edgeHi: '#fdf4d6', edgeMain: '#cbb97f', edgeDeep: '#6c6342', edgeLo: '#e6dcb2', ring: 'rgba(230, 220, 178, 0.2)',
    text: '#eef3ff', muted: '#adbbd8', title: '#f3dc9a', hl: '#ffcc6a',
    chipBg: '#0a1230', chipEdge: '#55628a', chipText: '#eef1fa', divider: 'rgba(230, 220, 178, 0.2)', icon: '#f0dc9e',
    heart: '#ff3d63', ghost: '#4fdccb', ...STEEL, clockRim: '#dccb8e', clockFace: '#101c40', warn: '#ffa3b4', ...WARN,
    hoverTop: '#2f4980', hoverMid: '#1c2f62', hoverBot: '#121f45',
    hoverEdgeHi: '#fffaf0', hoverEdgeMain: '#e6d59e', hoverEdgeDeep: '#8a7d52', hoverEdgeLo: '#f6ecc8',
    lip: '#4a4128', studEdge: '#3a3420',
  },
  /** Black glass with a copper edge and ember-orange highlights. */
  ember: {
    plateTop: '#2c2623', plateMid: '#171413', plateBot: '#0c0a09',
    edgeHi: '#ffd6b0', edgeMain: '#cf7a3e', edgeDeep: '#6c3416', edgeLo: '#eea06a', ring: 'rgba(255, 168, 110, 0.18)',
    text: '#f8ece1', muted: '#bba898', title: '#ffb46e', hl: '#ff9147',
    chipBg: '#0b0807', chipEdge: '#6e3c22', chipText: '#f6e6d6', divider: 'rgba(255, 168, 110, 0.18)', icon: '#ffa25c',
    heart: '#ff3b47', ghost: '#4fdccb', ...STEEL, clockRim: '#e08a4a', clockFace: '#141110', warn: '#ff9a9a', ...WARN,
    hoverTop: '#3b332e', hoverMid: '#211c19', hoverBot: '#131110',
    hoverEdgeHi: '#ffe6cc', hoverEdgeMain: '#ef9654', hoverEdgeDeep: '#8a4622', hoverEdgeLo: '#ffbd86',
    lip: '#5a2a10', studEdge: '#3e1c0a',
  },
  /** Deep violet with a rose-gold edge, after the Ancient / violet art. */
  amethyst: {
    plateTop: '#4c2b6a', plateMid: '#2d184a', plateBot: '#1c0d31',
    edgeHi: '#ffe2d8', edgeMain: '#d6967f', edgeDeep: '#7b4a3e', edgeLo: '#efbaa6', ring: 'rgba(240, 186, 166, 0.2)',
    text: '#fbeffa', muted: '#cfb6da', title: '#ffc8b6', hl: '#ffa3c4',
    chipBg: '#180a2a', chipEdge: '#7a4a64', chipText: '#f8e8f2', divider: 'rgba(240, 186, 166, 0.2)', icon: '#f6baa6',
    heart: '#ff3570', ghost: '#4fdccb', ...STEEL, clockRim: '#e8a892', clockFace: '#24113d', warn: '#ffa3bd', ...WARN,
    hoverTop: '#5e3982', hoverMid: '#3b2160', hoverBot: '#271240',
    hoverEdgeHi: '#fff1ec', hoverEdgeMain: '#ebb09a', hoverEdgeDeep: '#985e4e', hoverEdgeLo: '#ffd2c2',
    lip: '#5e3428', studEdge: '#4a2418',
  },
  /** Dark forest teal with a pale gold edge. */
  verdant: {
    plateTop: '#21463f', plateMid: '#13302b', plateBot: '#0a201c',
    edgeHi: '#fbf4d2', edgeMain: '#c8bb7c', edgeDeep: '#696036', edgeLo: '#e5dca6', ring: 'rgba(229, 220, 166, 0.2)',
    text: '#effaf3', muted: '#abc8bc', title: '#efe2a2', hl: '#c4ec86',
    chipBg: '#071a16', chipEdge: '#4b6a54', chipText: '#eaf5ee', divider: 'rgba(229, 220, 166, 0.2)', icon: '#e6d892',
    heart: '#ff4560', ghost: '#62d8f2', ...STEEL, clockRim: '#dccf8c', clockFace: '#0e2723', warn: '#ffa6b2', ...WARN,
    hoverTop: '#2a5850', hoverMid: '#193d36', hoverBot: '#0f2a25',
    hoverEdgeHi: '#fffbe8', hoverEdgeMain: '#e2d392', hoverEdgeDeep: '#847a48', hoverEdgeLo: '#f3eabe',
    lip: '#4a4422', studEdge: '#383216',
  },
  /** Cool slate with an icy silver edge. */
  frost: {
    plateTop: '#3a4757', plateMid: '#232c39', plateBot: '#161c26',
    edgeHi: '#ffffff', edgeMain: '#b7c7d8', edgeDeep: '#5d6c7e', edgeLo: '#dce8f4', ring: 'rgba(200, 225, 255, 0.22)',
    text: '#f2f7fc', muted: '#aab8c8', title: '#d4ecff', hl: '#8fd8ff',
    chipBg: '#10151d', chipEdge: '#57667b', chipText: '#eef4fa', divider: 'rgba(200, 225, 255, 0.2)', icon: '#cfe6ff',
    heart: '#ff4d6d', ghost: '#4fdccb', ...STEEL, armorTop: '#f2f8fd', armorMid: '#bcc9d8', armorBot: '#8293a8', clockRim: '#c9d8e8', clockFace: '#1b222d', warn: '#ffa3b4', ...WARN,
    hoverTop: '#47566a', hoverMid: '#2c3747', hoverBot: '#1c2431',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d3e1f0', hoverEdgeDeep: '#7a8a9c', hoverEdgeLo: '#eef5fb',
    lip: '#3b4656', studEdge: '#2a3442',
  },
  /** Deep wine with a royal gold edge. */
  crimson: {
    plateTop: '#4f1a2a', plateMid: '#33101c', plateBot: '#220a12',
    edgeHi: '#fff0c2', edgeMain: '#d4a24a', edgeDeep: '#7d5a1c', edgeLo: '#efcd85', ring: 'rgba(239, 205, 133, 0.2)',
    text: '#fff2e6', muted: '#d8b4bd', title: '#ffe0a0', hl: '#ffb347',
    chipBg: '#1a070e', chipEdge: '#74404a', chipText: '#f7e7e9', divider: 'rgba(239, 205, 133, 0.2)', icon: '#ffd47a',
    heart: '#ff4a6e', ghost: '#4fdccb', ...STEEL, clockRim: '#e2b356', clockFace: '#2a0d17', warn: '#ffa8b8', ...WARN,
    hoverTop: '#642337', hoverMid: '#421628', hoverBot: '#2d0e1a',
    hoverEdgeHi: '#fff8e0', hoverEdgeMain: '#f0c46e', hoverEdgeDeep: '#a37a35', hoverEdgeLo: '#ffe2a6',
    lip: '#5e3f12', studEdge: '#43290a',
  },
  /** Teal-black ink with an antique gold edge and aqua highlights. The ghost goes lavender so it never reads as an
   *  aqua keyword. */
  teal: {
    plateTop: '#12313a', plateMid: '#0a2029', plateBot: '#05141b',
    edgeHi: '#fff3cf', edgeMain: '#c9a75a', edgeDeep: '#6b5426', edgeLo: '#e6cd8c', ring: 'rgba(230, 205, 140, 0.2)',
    text: '#eefaff', muted: '#9fc0cc', title: '#f2d895', hl: '#5fe3dc',
    chipBg: '#030f15', chipEdge: '#3f6470', chipText: '#e8f6f8', divider: 'rgba(230, 205, 140, 0.2)', icon: '#ecd08a',
    heart: '#ff4664', ghost: '#b8a2ff', ...STEEL, clockRim: '#dcc07a', clockFace: '#081a22', warn: '#ffa3b4', ...WARN,
    hoverTop: '#1a4250', hoverMid: '#102c38', hoverBot: '#081c25',
    hoverEdgeHi: '#fffaea', hoverEdgeMain: '#e8c977', hoverEdgeDeep: '#8d7238', hoverEdgeLo: '#f6e3ae',
    lip: '#4b3a18', studEdge: '#372a10',
  },
  /** Dusky mauve with a pink rose-gold edge and peach highlights. */
  rose: {
    plateTop: '#563849', plateMid: '#3a2432', plateBot: '#281722',
    edgeHi: '#ffe8e4', edgeMain: '#dc9a96', edgeDeep: '#7f4a4c', edgeLo: '#f4c4be', ring: 'rgba(244, 196, 190, 0.2)',
    text: '#fff2f4', muted: '#d6bcc8', title: '#ffd9e0', hl: '#ffb48f',
    chipBg: '#1e0f18', chipEdge: '#7d5260', chipText: '#f9e9ee', divider: 'rgba(244, 196, 190, 0.2)', icon: '#f8c6c0',
    heart: '#ff3d6e', ghost: '#4fdccb', ...STEEL, clockRim: '#eab0aa', clockFace: '#2f1b28', warn: '#ffadc0', ...WARN,
    hoverTop: '#6a4659', hoverMid: '#4a2f40', hoverBot: '#33202c',
    hoverEdgeHi: '#fff5f3', hoverEdgeMain: '#f0b4ae', hoverEdgeDeep: '#a06466', hoverEdgeLo: '#ffd8d2',
    lip: '#5e3536', studEdge: '#452426',
  },
  /** Warm forged bronze with a bright amber edge. */
  sunforge: {
    plateTop: '#4a3420', plateMid: '#2f2013', plateBot: '#1f150b',
    edgeHi: '#fff1c4', edgeMain: '#d9963a', edgeDeep: '#7d4f15', edgeLo: '#f5c56c', ring: 'rgba(245, 197, 108, 0.2)',
    text: '#fff4e2', muted: '#d4bc9c', title: '#ffcf5c', hl: '#ffa43a',
    chipBg: '#170f07', chipEdge: '#7a5528', chipText: '#f7ead6', divider: 'rgba(245, 197, 108, 0.2)', icon: '#ffc85a',
    heart: '#ff3b4f', ghost: '#4fdccb', ...STEEL, clockRim: '#eaa94a', clockFace: '#261a0e', warn: '#ffa3a8', ...WARN,
    hoverTop: '#5c432a', hoverMid: '#3b2a19', hoverBot: '#281c0f',
    hoverEdgeHi: '#fff8e0', hoverEdgeMain: '#f5b85a', hoverEdgeDeep: '#a26a24', hoverEdgeLo: '#ffdc94',
    lip: '#5c3a0f', studEdge: '#3f2808',
  },
  /** Near-black navy with an electric cyan edge. The ghost goes violet so it never reads as a cyan keyword. */
  abyssal: {
    plateTop: '#0d1830', plateMid: '#070f20', plateBot: '#03070f',
    edgeHi: '#e6fbff', edgeMain: '#3fb8d9', edgeDeep: '#165066', edgeLo: '#8fe4f5', ring: 'rgba(110, 220, 255, 0.22)',
    text: '#eaf8ff', muted: '#92aec4', title: '#9ff0ff', hl: '#3fe0ff',
    chipBg: '#02050c', chipEdge: '#1f5068', chipText: '#e4f6ff', divider: 'rgba(110, 220, 255, 0.2)', icon: '#7fe6ff',
    heart: '#ff3d6a', ghost: '#b69cff', ...STEEL, clockRim: '#5cc8e6', clockFace: '#06101e', warn: '#ff9fb6', ...WARN,
    hoverTop: '#152647', hoverMid: '#0c1831', hoverBot: '#050d1c',
    hoverEdgeHi: '#f4feff', hoverEdgeMain: '#6fd4ef', hoverEdgeDeep: '#23708c', hoverEdgeLo: '#b8eefa',
    lip: '#0f3a4a', studEdge: '#0a2632',
  },
  /** Muted sandstone with a pale sand edge and terracotta highlights. (A light parchment theme was considered and
   *  dropped: the shared pill and tooltip rules carry fixed dark text shadows and white hover text, so dark ink on a
   *  light plate could not read cleanly everywhere without changing those rules, and this ask is colours only.) */
  sandstone: {
    plateTop: '#4a4034', plateMid: '#302921', plateBot: '#211c16',
    edgeHi: '#fbeed2', edgeMain: '#c4a578', edgeDeep: '#6e5a3c', edgeLo: '#e3cda4', ring: 'rgba(227, 205, 164, 0.2)',
    text: '#fbf3e6', muted: '#c9baa4', title: '#f0dcb4', hl: '#f0a878',
    chipBg: '#17130e', chipEdge: '#6b5a44', chipText: '#f3eadb', divider: 'rgba(227, 205, 164, 0.2)', icon: '#e8d2a6',
    heart: '#ff4a5c', ghost: '#4fdccb', ...STEEL, clockRim: '#d8bb8c', clockFace: '#28221b', warn: '#ffa8ae', ...WARN,
    hoverTop: '#5a4e40', hoverMid: '#3b3329', hoverBot: '#29231c',
    hoverEdgeHi: '#fffaf0', hoverEdgeMain: '#dcc093', hoverEdgeDeep: '#8c7552', hoverEdgeLo: '#f0e0c0',
    lip: '#4d3f28', studEdge: '#362c1c',
  },
  /** Emerald jade with a rich gold edge and vermilion lacquer highlights. The ghost goes sky blue (as in Verdant) so
   *  it stands off the green plate. */
  jade: {
    plateTop: '#174832', plateMid: '#0e3524', plateBot: '#072416',
    edgeHi: '#fff0b8', edgeMain: '#d6a83c', edgeDeep: '#7a5814', edgeLo: '#f2cf74', ring: 'rgba(242, 207, 116, 0.2)',
    text: '#f0fbf2', muted: '#a9cdb5', title: '#ffe08a', hl: '#ffa47c',
    chipBg: '#05180f', chipEdge: '#6d5a2a', chipText: '#ecf7ee', divider: 'rgba(242, 207, 116, 0.2)', icon: '#f5d06a',
    heart: '#ff4258', ghost: '#74d4ff', ...STEEL, clockRim: '#e3bb5a', clockFace: '#0a2a1b', warn: '#ffadb8', ...WARN,
    hoverTop: '#205a40', hoverMid: '#14432e', hoverBot: '#0b2e1d',
    hoverEdgeHi: '#fff8dc', hoverEdgeMain: '#f0c45c', hoverEdgeDeep: '#9c7426', hoverEdgeLo: '#ffe3a0',
    lip: '#5a4210', studEdge: '#3e2d08',
  },
  /** Storm-cloud blue-grey with a gunmetal steel edge and lightning-yellow highlights. */
  storm: {
    plateTop: '#2b3646', plateMid: '#1b2330', plateBot: '#11161f',
    edgeHi: '#e8edf2', edgeMain: '#8a97a8', edgeDeep: '#3c4553', edgeLo: '#b8c3d0', ring: 'rgba(184, 195, 208, 0.2)',
    text: '#edf1f6', muted: '#a3afbf', title: '#e3ebf5', hl: '#ffd95a',
    chipBg: '#0c1017', chipEdge: '#4c5767', chipText: '#e9eef4', divider: 'rgba(184, 195, 208, 0.2)', icon: '#c9d4e2',
    heart: '#ff4d63', ghost: '#4fdccb', ...STEEL, clockRim: '#aab6c4', clockFace: '#161c26', warn: '#ffa3b4', ...WARN,
    hoverTop: '#374457', hoverMid: '#232d3c', hoverBot: '#161d28',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#b4c0ce', hoverEdgeDeep: '#5d6878', hoverEdgeLo: '#dfe6ee',
    lip: '#303946', studEdge: '#212831',
  },
  /** Black-red with a molten orange edge. */
  infernal: {
    plateTop: '#3f0d0f', plateMid: '#280708', plateBot: '#180304',
    edgeHi: '#fff0b0', edgeMain: '#e8661c', edgeDeep: '#7a1e08', edgeLo: '#ffa648', ring: 'rgba(255, 140, 60, 0.22)',
    text: '#fff0e4', muted: '#d6a99e', title: '#ffc04a', hl: '#ff8a3a',
    chipBg: '#120203', chipEdge: '#7a2a14', chipText: '#fbe6da', divider: 'rgba(255, 140, 60, 0.2)', icon: '#ffa040',
    heart: '#ff2e4a', ghost: '#4fdccb', ...STEEL, clockRim: '#f08a2e', clockFace: '#200506', warn: '#ffa3a3', ...WARN,
    hoverTop: '#561418', hoverMid: '#370a0c', hoverBot: '#220506',
    hoverEdgeHi: '#fff6d0', hoverEdgeMain: '#ff9640', hoverEdgeDeep: '#a33410', hoverEdgeLo: '#ffc070',
    lip: '#6a1e06', studEdge: '#4a1204',
  },
  /** Deep indigo with a starlight silver edge and soft violet highlights. */
  celestial: {
    plateTop: '#2a2860', plateMid: '#1a1844', plateBot: '#0f0e2e',
    edgeHi: '#ffffff', edgeMain: '#b9bde6', edgeDeep: '#5a5c8e', edgeLo: '#dcdcfa', ring: 'rgba(210, 210, 255, 0.22)',
    text: '#f4f3ff', muted: '#b4b2dc', title: '#e6e2ff', hl: '#c7a6ff',
    chipBg: '#0b0a24', chipEdge: '#4f4e88', chipText: '#efeeff', divider: 'rgba(210, 210, 255, 0.2)', icon: '#dcd8ff',
    heart: '#ff4775', ghost: '#4fdccb', ...STEEL, clockRim: '#c8cbf0', clockFace: '#151338', warn: '#ffa6c0', ...WARN,
    hoverTop: '#35337a', hoverMid: '#222055', hoverBot: '#15133a',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d4d6f6', hoverEdgeDeep: '#7476aa', hoverEdgeLo: '#eeeeff',
    lip: '#3a3a6a', studEdge: '#26264c',
  },
  /** Olive moss with a burnished copper edge. */
  moss: {
    plateTop: '#3b3f22', plateMid: '#262915', plateBot: '#181a0c',
    edgeHi: '#ffd9c0', edgeMain: '#c97a4a', edgeDeep: '#6b3a1c', edgeLo: '#eba57a', ring: 'rgba(235, 165, 122, 0.2)',
    text: '#f6f6e6', muted: '#bfc2a0', title: '#f8cba8', hl: '#ffa36b',
    chipBg: '#12140a', chipEdge: '#6a5232', chipText: '#f1f1df', divider: 'rgba(235, 165, 122, 0.2)', icon: '#f0b48a',
    heart: '#ff4558', ghost: '#4fdccb', ...STEEL, clockRim: '#d98c58', clockFace: '#1f2111', warn: '#ffa8b0', ...WARN,
    hoverTop: '#4a4f2c', hoverMid: '#31351c', hoverBot: '#1f2210',
    hoverEdgeHi: '#ffe8d8', hoverEdgeMain: '#e2925c', hoverEdgeDeep: '#8a4c26', hoverEdgeLo: '#f8bf98',
    lip: '#5a2c12', studEdge: '#3e1e0a',
  },
  /** Polar-night teal with a mint edge and aurora-violet highlights. The ghost goes ice blue so it never reads as
   *  the mint edge. */
  aurora: {
    plateTop: '#163f3c', plateMid: '#0c2a28', plateBot: '#061a19',
    edgeHi: '#eafff6', edgeMain: '#7fd8b8', edgeDeep: '#2a6656', edgeLo: '#b4f0da', ring: 'rgba(150, 240, 210, 0.2)',
    text: '#effffa', muted: '#9fc6c0', title: '#a8f5d6', hl: '#d2a6ff',
    chipBg: '#031212', chipEdge: '#3a6e66', chipText: '#e6faf4', divider: 'rgba(150, 240, 210, 0.2)', icon: '#a0f0d0',
    heart: '#ff4d74', ghost: '#7cc6ff', ...STEEL, clockRim: '#8ee0c2', clockFace: '#0a2326', warn: '#ffa8c0', ...WARN,
    hoverTop: '#1b4d4a', hoverMid: '#113533', hoverBot: '#0a2222',
    hoverEdgeHi: '#f6fffb', hoverEdgeMain: '#a2ead0', hoverEdgeDeep: '#3f8a76', hoverEdgeLo: '#cff8e8',
    lip: '#1c4a3e', studEdge: '#12332a',
  },
  /** Blood-dark maroon with a crimson-steel edge and a pale moonlight title. */
  bloodmoon: {
    plateTop: '#3d1020', plateMid: '#280914', plateBot: '#18040b',
    edgeHi: '#ffd6d6', edgeMain: '#c8323c', edgeDeep: '#5e0f16', edgeLo: '#ee7a80', ring: 'rgba(238, 122, 128, 0.2)',
    text: '#fbeef0', muted: '#d2a7b0', title: '#f2e8ec', hl: '#ff7a7a',
    chipBg: '#100208', chipEdge: '#6e2230', chipText: '#f8e6ea', divider: 'rgba(238, 122, 128, 0.2)', icon: '#ff9a9a',
    heart: '#ff3550', ghost: '#4fdccb', ...STEEL, clockRim: '#e05a62', clockFace: '#1f0610', warn: '#ffb0c0', ...WARN,
    hoverTop: '#521628', hoverMid: '#360c1b', hoverBot: '#21060f',
    hoverEdgeHi: '#ffe6e6', hoverEdgeMain: '#e24a54', hoverEdgeDeep: '#7e1820', hoverEdgeLo: '#ff9aa0',
    lip: '#5a0c14', studEdge: '#3e070d',
  },
  /** Rust-dark iron with a bright copper edge and white-hot yellow highlights. */
  furnace: {
    plateTop: '#3e2318', plateMid: '#28160e', plateBot: '#190d07',
    edgeHi: '#ffe0c8', edgeMain: '#d97a42', edgeDeep: '#6e3214', edgeLo: '#f4a878', ring: 'rgba(244, 168, 120, 0.2)',
    text: '#fff3e8', muted: '#d0b19e', title: '#ffcfa8', hl: '#ffd84a',
    chipBg: '#120804', chipEdge: '#74401e', chipText: '#f8e8dc', divider: 'rgba(244, 168, 120, 0.2)', icon: '#ffb88a',
    heart: '#ff3b4f', ghost: '#4fdccb', ...STEEL, clockRim: '#e88a50', clockFace: '#22120a', warn: '#ffa8b0', ...WARN,
    hoverTop: '#4f2e20', hoverMid: '#341d12', hoverBot: '#22120a',
    hoverEdgeHi: '#fff0e2', hoverEdgeMain: '#ee9258', hoverEdgeDeep: '#8e4420', hoverEdgeLo: '#ffc49c',
    lip: '#5e2a0e', studEdge: '#421c08',
  },
  /** Dark beeswax brown with a bright honey-gold edge and honey-yellow highlights. */
  honeycomb: {
    plateTop: '#33240c', plateMid: '#221706', plateBot: '#150e03',
    edgeHi: '#fff6c0', edgeMain: '#e8b520', edgeDeep: '#7a5806', edgeLo: '#ffd75a', ring: 'rgba(255, 215, 90, 0.22)',
    text: '#fff8e4', muted: '#d6c49a', title: '#fff0b0', hl: '#ffcc2e',
    chipBg: '#0f0902', chipEdge: '#7a5a14', chipText: '#f8efd6', divider: 'rgba(255, 215, 90, 0.2)', icon: '#ffd75a',
    heart: '#ff3d52', ghost: '#4fdccb', ...STEEL, clockRim: '#f0c030', clockFace: '#1c1305', warn: '#ffa8b0', ...WARN,
    hoverTop: '#443010', hoverMid: '#2e2009', hoverBot: '#1d1405',
    hoverEdgeHi: '#fffbe0', hoverEdgeMain: '#f8cc40', hoverEdgeDeep: '#9c7410', hoverEdgeLo: '#ffe486',
    lip: '#5c4206', studEdge: '#3e2c04',
  },
  /** Sun-baked terracotta with a sun-gold edge and a bright sun-yellow title. */
  desert: {
    plateTop: '#53301f', plateMid: '#381f13', plateBot: '#24130b',
    edgeHi: '#fff4cc', edgeMain: '#e0b050', edgeDeep: '#80561c', edgeLo: '#f6d488', ring: 'rgba(246, 212, 136, 0.2)',
    text: '#fff5ea', muted: '#dcbca6', title: '#ffe27a', hl: '#ffb27a',
    chipBg: '#1a0d06', chipEdge: '#7e4e30', chipText: '#faeadc', divider: 'rgba(246, 212, 136, 0.2)', icon: '#ffd870',
    heart: '#ff3d55', ghost: '#4fdccb', ...STEEL, clockRim: '#ebbd5c', clockFace: '#2a160c', warn: '#ffb3bd', ...WARN,
    hoverTop: '#653c28', hoverMid: '#45271a', hoverBot: '#2d180e',
    hoverEdgeHi: '#fffbe8', hoverEdgeMain: '#f0c468', hoverEdgeDeep: '#a07028', hoverEdgeLo: '#ffe4a6',
    lip: '#5e3c10', studEdge: '#42290a',
  },
  /** Deep forest with a leaf-green metal edge and fresh green highlights. */
  emerald: {
    plateTop: '#173a20', plateMid: '#0e2715', plateBot: '#07180c',
    edgeHi: '#e8ffd8', edgeMain: '#5cbf5a', edgeDeep: '#215a24', edgeLo: '#9ee68e', ring: 'rgba(158, 230, 142, 0.2)',
    text: '#f0fbec', muted: '#a8c8a4', title: '#d8f5b0', hl: '#9cf06a',
    chipBg: '#04120a', chipEdge: '#3e6a3c', chipText: '#eaf6e6', divider: 'rgba(158, 230, 142, 0.2)', icon: '#b8ec90',
    heart: '#ff4560', ghost: '#4fdccb', ...STEEL, clockRim: '#78cf6e', clockFace: '#0b2212', warn: '#ffa8b8', ...WARN,
    hoverTop: '#1f4a2a', hoverMid: '#14331c', hoverBot: '#0a2010',
    hoverEdgeHi: '#f4ffec', hoverEdgeMain: '#7ad874', hoverEdgeDeep: '#2f7a32', hoverEdgeLo: '#bdf2b0',
    lip: '#1c4a1e', studEdge: '#123214',
  },
  /** Near-black with an acid lime edge and radioactive lime highlights. */
  toxic: {
    plateTop: '#232a12', plateMid: '#161b0a', plateBot: '#0c0f04',
    edgeHi: '#f6ffd0', edgeMain: '#a8d020', edgeDeep: '#4a5e08', edgeLo: '#d2f060', ring: 'rgba(210, 240, 96, 0.22)',
    text: '#f6fbe8', muted: '#b4c094', title: '#eaffa0', hl: '#d4ff3a',
    chipBg: '#080a02', chipEdge: '#56661c', chipText: '#eef4dc', divider: 'rgba(210, 240, 96, 0.2)', icon: '#d4f060',
    heart: '#ff3f6a', ghost: '#4fdccb', ...STEEL, clockRim: '#b8dc30', clockFace: '#12160a', warn: '#ffa8c0', ...WARN,
    hoverTop: '#2f3818', hoverMid: '#1f260e', hoverBot: '#121606',
    hoverEdgeHi: '#fbffe6', hoverEdgeMain: '#bce040', hoverEdgeDeep: '#647c10', hoverEdgeLo: '#e2f888',
    lip: '#3e4c08', studEdge: '#2a3404',
  },
  /** Deep sea blue with a pale sea-glass edge and sunlit-water highlights. The ghost goes lavender so it never reads
   *  as the sea-blue keywords. */
  ocean: {
    plateTop: '#103a5a', plateMid: '#0a2740', plateBot: '#05182a',
    edgeHi: '#eef8ff', edgeMain: '#8fb8d8', edgeDeep: '#355a78', edgeLo: '#c4e0f2', ring: 'rgba(196, 224, 242, 0.2)',
    text: '#eef8ff', muted: '#a2c0d6', title: '#d6efff', hl: '#7fd0ff',
    chipBg: '#04121e', chipEdge: '#3c6280', chipText: '#e6f2fa', divider: 'rgba(196, 224, 242, 0.2)', icon: '#bfe2fa',
    heart: '#ff4a6a', ghost: '#bba6ff', ...STEEL, clockRim: '#a6cce6', clockFace: '#0a2234', warn: '#ffb0c2', ...WARN,
    hoverTop: '#164a70', hoverMid: '#0f3352', hoverBot: '#082036',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#acd0ea', hoverEdgeDeep: '#4c7696', hoverEdgeLo: '#dcefff',
    lip: '#284660', studEdge: '#1a3044',
  },
  /** Saturated cobalt with a bright silver edge and warm gold highlights. */
  cobalt: {
    plateTop: '#1f2f80', plateMid: '#141e5a', plateBot: '#0b1238',
    edgeHi: '#ffffff', edgeMain: '#c4ccec', edgeDeep: '#56609a', edgeLo: '#e2e8fc', ring: 'rgba(226, 232, 252, 0.22)',
    text: '#f2f5ff', muted: '#b4bfe8', title: '#dfe7ff', hl: '#ffcf5a',
    chipBg: '#080d2c', chipEdge: '#4a5694', chipText: '#eef1ff', divider: 'rgba(226, 232, 252, 0.2)', icon: '#d8e0ff',
    heart: '#ff4a6e', ghost: '#4fdccb', ...STEEL, clockRim: '#ccd4f2', clockFace: '#101848', warn: '#ffb6c6', ...WARN,
    hoverTop: '#283a96', hoverMid: '#1a266c', hoverBot: '#0f1844',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#dae0f8', hoverEdgeDeep: '#7078b6', hoverEdgeLo: '#f0f3ff',
    lip: '#323c78', studEdge: '#222a58',
  },
  /** Magenta-plum with a pale orchid edge and orchid-pink highlights. */
  orchid: {
    plateTop: '#4c1d50', plateMid: '#331236', plateBot: '#210a24',
    edgeHi: '#fff0ff', edgeMain: '#d49ad8', edgeDeep: '#6e3a72', edgeLo: '#f0c6f2', ring: 'rgba(240, 198, 242, 0.2)',
    text: '#fff0fd', muted: '#d8b2da', title: '#fad6fa', hl: '#ff9ad8',
    chipBg: '#18061a', chipEdge: '#784080', chipText: '#fae8fa', divider: 'rgba(240, 198, 242, 0.2)', icon: '#f4c0f2',
    heart: '#ff3d66', ghost: '#4fdccb', ...STEEL, clockRim: '#e0aee2', clockFace: '#2a0e2e', warn: '#ffb4c0', ...WARN,
    hoverTop: '#5e2864', hoverMid: '#411946', hoverBot: '#2a0e2e',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#e6b4e8', hoverEdgeDeep: '#8a5090', hoverEdgeLo: '#fadafa',
    lip: '#5a2a5e', studEdge: '#3e1a42',
  },
  /** Space-dark plum with a hot-pink edge and nebula pink highlights. */
  nebula: {
    plateTop: '#2c1740', plateMid: '#1d0e2c', plateBot: '#11071c',
    edgeHi: '#ffe0f0', edgeMain: '#ff5fa8', edgeDeep: '#7a1a50', edgeLo: '#ff9cca', ring: 'rgba(255, 156, 202, 0.22)',
    text: '#fdf0ff', muted: '#c6aedc', title: '#ffc4e2', hl: '#ff7ab8',
    chipBg: '#0b0414', chipEdge: '#6e2a5c', chipText: '#f8e8fa', divider: 'rgba(255, 156, 202, 0.2)', icon: '#ffa6d2',
    heart: '#ff3a4e', ghost: '#4fdccb', ...STEEL, clockRim: '#ff7cba', clockFace: '#180a26', warn: '#ffb0b8', ...WARN,
    hoverTop: '#3a1f54', hoverMid: '#271339', hoverBot: '#170a25',
    hoverEdgeHi: '#fff0f8', hoverEdgeMain: '#ff7cba', hoverEdgeDeep: '#9a2a66', hoverEdgeLo: '#ffb8da',
    lip: '#5e1440', studEdge: '#420c2c',
  },
  /** Plain charcoal with a graphite-white edge and one warm keyword colour. */
  charcoal: {
    plateTop: '#303030', plateMid: '#1e1e1e', plateBot: '#121212',
    edgeHi: '#ffffff', edgeMain: '#a8a8a8', edgeDeep: '#484848', edgeLo: '#d4d4d4', ring: 'rgba(212, 212, 212, 0.18)',
    text: '#f2f2f2', muted: '#b0b0b0', title: '#ffffff', hl: '#ffcf80',
    chipBg: '#0a0a0a', chipEdge: '#555555', chipText: '#eeeeee', divider: 'rgba(212, 212, 212, 0.18)', icon: '#dddddd',
    heart: '#ff4058', ghost: '#4fdccb', ...STEEL, clockRim: '#bcbcbc', clockFace: '#1a1a1a', warn: '#ffa8b4', ...WARN,
    hoverTop: '#3c3c3c', hoverMid: '#282828', hoverBot: '#191919',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#c4c4c4', hoverEdgeDeep: '#666666', hoverEdgeLo: '#e6e6e6',
    lip: '#3a3a3a', studEdge: '#262626',
  },
  /** Warm pewter grey with a soft brushed edge and brass highlights. */
  pewter: {
    plateTop: '#46474a', plateMid: '#303134', plateBot: '#202124',
    edgeHi: '#f4f2ec', edgeMain: '#a8a49a', edgeDeep: '#56544e', edgeLo: '#d2cec4', ring: 'rgba(210, 206, 196, 0.2)',
    text: '#f6f4ee', muted: '#c2c0b8', title: '#f0ead8', hl: '#ecc870',
    chipBg: '#141518', chipEdge: '#5e5c56', chipText: '#efede6', divider: 'rgba(210, 206, 196, 0.2)', icon: '#e2dccb',
    heart: '#ff4a5c', ghost: '#4fdccb', ...STEEL, clockRim: '#c2bdaf', clockFace: '#26272a', warn: '#ffb0ba', ...WARN,
    hoverTop: '#545559', hoverMid: '#3a3b3f', hoverBot: '#28292c',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#c0bcb0', hoverEdgeDeep: '#706d66', hoverEdgeLo: '#e4e0d6',
    lip: '#45433e', studEdge: '#2e2d2a',
  },
} as const satisfies Record<string, UiThemeTokens>;

export type UiThemeId = keyof typeof UI_THEMES;
/** The tuner dropdown, grouped by colour scheme into `<optgroup>` sections (owner ask on #1926: "separate them by
 *  color scheme i.e. blue: x,y,z"). Each group leads with its original-six theme. Every theme sits in exactly one
 *  group (tooltipStyle.test.ts checks). */
export const UI_THEME_GROUPS: readonly { label: string; options: readonly UiThemeId[] }[] = [
  { label: 'Gold', options: ['gem', 'sunforge', 'honeycomb', 'desert', 'sandstone'] },
  { label: 'Red & Fire', options: ['ember', 'crimson', 'infernal', 'bloodmoon', 'furnace'] },
  { label: 'Pink & Violet', options: ['amethyst', 'rose', 'celestial', 'orchid', 'nebula'] },
  { label: 'Blue', options: ['sapphire', 'teal', 'abyssal', 'ocean', 'cobalt'] },
  { label: 'Green', options: ['verdant', 'jade', 'moss', 'aurora', 'emerald', 'toxic'] },
  { label: 'Neutral & Silver', options: ['frost', 'storm', 'charcoal', 'pewter'] },
];
/** Every theme, in dropdown order. */
export const UI_THEME_IDS: UiThemeId[] = UI_THEME_GROUPS.flatMap((g) => g.options);
export const UI_THEME_LABELS: Record<UiThemeId, string> = {
  gem: 'Gem Gold (default)',
  sunforge: 'Sunforge',
  honeycomb: 'Honeycomb',
  desert: 'Desert Sun',
  sandstone: 'Sandstone',
  ember: 'Obsidian Ember',
  crimson: 'Crimson Royale',
  infernal: 'Infernal',
  bloodmoon: 'Bloodmoon',
  furnace: 'Copper Furnace',
  amethyst: 'Amethyst',
  rose: 'Rose Quartz',
  celestial: 'Celestial',
  orchid: 'Orchid',
  nebula: 'Nebula Pink',
  sapphire: 'Royal Sapphire',
  teal: 'Midnight Teal',
  abyssal: 'Abyssal',
  ocean: 'Ocean Deep',
  cobalt: 'Cobalt Night',
  verdant: 'Verdant',
  jade: 'Jade Dynasty',
  moss: 'Moss & Copper',
  aurora: 'Arctic Aurora',
  emerald: 'Emerald Grove',
  toxic: 'Toxic Lime',
  frost: 'Frost Silver',
  storm: 'Storm Slate',
  charcoal: 'Charcoal Mono',
  pewter: 'Pewter',
};

/** The theme production plays: uiTheme.css's `:root` block must equal it. Gem Gold until the owner picks. */
export const DEFAULT_THEME: UiThemeId = 'gem';

export interface UiThemeConfig { theme: UiThemeId }
const DEFAULTS: UiThemeConfig = { theme: DEFAULT_THEME };
export { DEFAULTS as UI_THEME_DEFAULTS };

const KEY = 'ascent.uiTheme';
const OLD_KEY = 'ascent.uitheme'; // the retired glass-surface tuner (#938)
const isTheme = (v: unknown): v is UiThemeId => typeof v === 'string' && v in UI_THEMES;

let cfg: UiThemeConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    localStorage.removeItem(OLD_KEY);
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const theme = saved && typeof saved === 'object' ? (saved as Partial<UiThemeConfig>).theme : undefined;
    return { theme: isTheme(theme) ? theme : DEFAULT_THEME };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getUiThemeConfig(): UiThemeConfig { return cfg; }

/** Push the picked theme's tokens onto `:root`. The default theme writes nothing (the stylesheet already declares
 *  it), so a reset leaves `:root` exactly as uiTheme.css has it. */
export function applyUiTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const t: UiThemeTokens = UI_THEMES[cfg.theme];
  for (const k of UI_THEME_KEYS) {
    if (cfg.theme === DEFAULT_THEME) root.removeProperty(UI_THEME_VARS[k]);
    else root.setProperty(UI_THEME_VARS[k], t[k]);
  }
}

export function setUiTheme(value: string): void {
  if (!isTheme(value)) return;
  cfg = { theme: value };
  applyUiTheme();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetUiTheme(): void {
  cfg = { ...DEFAULTS };
  applyUiTheme();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The bake-ready CSS for a theme: the token lines to paste over uiTheme.css's `:root` block. */
export function uiThemeCss(id: UiThemeId): string {
  const t: UiThemeTokens = UI_THEMES[id];
  return [`/* ${UI_THEME_LABELS[id]} (DEFAULT_THEME = '${id}') */`, ':root {', ...UI_THEME_KEYS.map((k) => `  ${UI_THEME_VARS[k]}: ${t[k]};`), '}'].join('\n');
}

const controls: TunerControl<Extract<keyof UiThemeConfig, string>>[] = [
  {
    key: 'theme', label: 'Theme', kind: 'select', options: UI_THEME_IDS, optionLabels: UI_THEME_LABELS,
    optionGroups: UI_THEME_GROUPS,
    hint: 'Recolours every tooltip and every HUD pill (Health, names, Tier, Freeze, timer, Skip, Summary, End Combat) at once. Live.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<UiThemeConfig> = {
  id: 'uitheme',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'UI Theme',
  note: `dev · live · ${UI_THEME_IDS.length} themes`,
  read: getUiThemeConfig,
  write: () => { /* no numeric controls */ },
  writeColor: (_key, value) => setUiTheme(value),
  reset: resetUiTheme,
  defaults: DEFAULTS,
  controls,
  copy: () => uiThemeCss(cfg.theme),
  copyLabel: 'Copy values',
};

// Apply at load (dev: the persisted pick; prod never imports this module and plays uiTheme.css).
applyUiTheme();
