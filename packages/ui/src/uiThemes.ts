/**
 * THE UI THEME REGISTRY: pure data, the single source of truth for every UI colour theme (split out of
 * uiThemeConfig.ts 2026-10-03 so it carries no DEV, localStorage or tuner code).
 *
 * Production imports nothing from here today (it plays the baked `:root` block in uiTheme.css, which must equal
 * `UI_THEMES[DEFAULT_THEME]`). It is kept import-safe for production on purpose: if themes become a Collection
 * cosmetic (owner idea 2026-10-03, not built), the cosmetic catalog and the runtime that applies an owned theme read
 * THIS module, and the theme ids below become the cosmetic ids.
 *
 * THE IDS ARE FROZEN. They are persisted (the DEV pick in localStorage `ascent.uiTheme`, and any future cosmetic
 * ownership row), so rename a theme by changing its LABEL, never its id.
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
    plateTop: '#5e3550', plateMid: '#40223a', plateBot: '#2a1526',
    edgeHi: '#ffe8e4', edgeMain: '#dc9a96', edgeDeep: '#7f4a4c', edgeLo: '#f4c4be', ring: 'rgba(244, 196, 190, 0.2)',
    text: '#fff2f4', muted: '#d6bcc8', title: '#ffd9e0', hl: '#ffb48f',
    chipBg: '#1e0f18', chipEdge: '#7d5260', chipText: '#f9e9ee', divider: 'rgba(244, 196, 190, 0.2)', icon: '#f8c6c0',
    heart: '#ff3d6e', ghost: '#4fdccb', ...STEEL, clockRim: '#eab0aa', clockFace: '#2f1b28', warn: '#ffadc0', ...WARN,
    hoverTop: '#724364', hoverMid: '#502c48', hoverBot: '#361c30',
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
    plateTop: '#363636', plateMid: '#1c1c1c', plateBot: '#0c0c0c',
    edgeHi: '#ffffff', edgeMain: '#bdbdbd', edgeDeep: '#3a3a3a', edgeLo: '#e2e2e2', ring: 'rgba(212, 212, 212, 0.18)',
    text: '#f2f2f2', muted: '#b0b0b0', title: '#ffffff', hl: '#ffcf80',
    chipBg: '#0a0a0a', chipEdge: '#555555', chipText: '#eeeeee', divider: 'rgba(212, 212, 212, 0.18)', icon: '#dddddd',
    heart: '#ff4058', ghost: '#4fdccb', ...STEEL, clockRim: '#bcbcbc', clockFace: '#1a1a1a', warn: '#ffa8b4', ...WARN,
    hoverTop: '#3c3c3c', hoverMid: '#282828', hoverBot: '#191919',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#c4c4c4', hoverEdgeDeep: '#666666', hoverEdgeLo: '#e6e6e6',
    lip: '#3a3a3a', studEdge: '#262626',
  },
  /** Warm pewter grey with a soft brushed edge and brass highlights. */
  pewter: {
    plateTop: '#4a4b4f', plateMid: '#2f3034', plateBot: '#1c1d20',
    edgeHi: '#fbf8f0', edgeMain: '#b4ae9e', edgeDeep: '#4e4b44', edgeLo: '#dcd6c8', ring: 'rgba(210, 206, 196, 0.2)',
    text: '#f6f4ee', muted: '#c2c0b8', title: '#f0ead8', hl: '#ecc870',
    chipBg: '#141518', chipEdge: '#5e5c56', chipText: '#efede6', divider: 'rgba(210, 206, 196, 0.2)', icon: '#e2dccb',
    heart: '#ff4a5c', ghost: '#4fdccb', ...STEEL, clockRim: '#c2bdaf', clockFace: '#26272a', warn: '#ffb0ba', ...WARN,
    hoverTop: '#545559', hoverMid: '#3a3b3f', hoverBot: '#28292c',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#c0bcb0', hoverEdgeDeep: '#706d66', hoverEdgeLo: '#e4e0d6',
    lip: '#45433e', studEdge: '#2e2d2a',
  },
  /** Near-black with a bright polished-gold edge: the most contrast of the golds. */
  gilded: {
    plateTop: '#1c1a16', plateMid: '#121110', plateBot: '#0a0908',
    edgeHi: '#fff7d0', edgeMain: '#f0c040', edgeDeep: '#8a6410', edgeLo: '#ffe080', ring: 'rgba(255, 224, 128, 0.2)',
    text: '#fffaf0', muted: '#c8bfa8', title: '#ffd75e', hl: '#ffc94a',
    chipBg: '#060505', chipEdge: '#7a6020', chipText: '#f6efdc', divider: 'rgba(255, 224, 128, 0.2)', icon: '#ffd75e',
    heart: '#ff3d50', ghost: '#4fdccb', ...STEEL, clockRim: '#f0c040', clockFace: '#141210', warn: '#ffa8b0', ...WARN,
    hoverTop: '#2a2720', hoverMid: '#1a1815', hoverBot: '#100f0d',
    hoverEdgeHi: '#fffbe6', hoverEdgeMain: '#ffd45c', hoverEdgeDeep: '#a87c1c', hoverEdgeLo: '#ffeaa0',
    lip: '#5e4408', studEdge: '#3e2d04',
  },
  /** Warm taupe with a pale champagne edge. */
  champagne: {
    plateTop: '#463e38', plateMid: '#2e2925', plateBot: '#1f1b18',
    edgeHi: '#fffaf0', edgeMain: '#e2cfa8', edgeDeep: '#7c6c50', edgeLo: '#f2e6cc', ring: 'rgba(242, 230, 204, 0.2)',
    text: '#fffaf2', muted: '#cfc3b4', title: '#f6e4c0', hl: '#f2c48a',
    chipBg: '#16120f', chipEdge: '#6e604c', chipText: '#f5ede2', divider: 'rgba(242, 230, 204, 0.2)', icon: '#ecdcbc',
    heart: '#ff4a62', ghost: '#4fdccb', ...STEEL, clockRim: '#e6d4ae', clockFace: '#26211d', warn: '#ffb0bc', ...WARN,
    hoverTop: '#554b44', hoverMid: '#383230', hoverBot: '#26221e',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#eedcb8', hoverEdgeDeep: '#96845f', hoverEdgeLo: '#fbf0dc',
    lip: '#4e4434', studEdge: '#362f24',
  },
  /** Ash-grey stone with a glowing lava edge. */
  volcanic: {
    plateTop: '#33302f', plateMid: '#201e1d', plateBot: '#131211',
    edgeHi: '#ffd2a8', edgeMain: '#ff5a1f', edgeDeep: '#6e1a04', edgeLo: '#ff9a50', ring: 'rgba(255, 154, 80, 0.2)',
    text: '#f6f0ec', muted: '#b8aea8', title: '#ffb070', hl: '#ff8040',
    chipBg: '#0a0909', chipEdge: '#6a2a12', chipText: '#f2e8e2', divider: 'rgba(255, 154, 80, 0.2)', icon: '#ff9050',
    heart: '#ff2e48', ghost: '#4fdccb', ...STEEL, clockRim: '#ff6a2a', clockFace: '#1a1817', warn: '#ffaab0', ...WARN,
    hoverTop: '#403c3a', hoverMid: '#2a2726', hoverBot: '#1a1817',
    hoverEdgeHi: '#ffe6cc', hoverEdgeMain: '#ff7a3a', hoverEdgeDeep: '#8e2a0a', hoverEdgeLo: '#ffb070',
    lip: '#5a1a06', studEdge: '#3e1204',
  },
  /** Deep garnet red with a cool silver edge. */
  garnet: {
    plateTop: '#4a0f22', plateMid: '#320816', plateBot: '#20040d',
    edgeHi: '#ffffff', edgeMain: '#c8c8d4', edgeDeep: '#5e5e70', edgeLo: '#e6e6f0', ring: 'rgba(230, 230, 240, 0.2)',
    text: '#fff0f3', muted: '#d6a8b6', title: '#f0e8ee', hl: '#ff7a96',
    chipBg: '#14030a', chipEdge: '#6a2a40', chipText: '#f8e6ec', divider: 'rgba(230, 230, 240, 0.2)', icon: '#e6e2ea',
    heart: '#ff3d5a', ghost: '#4fdccb', ...STEEL, clockRim: '#d4d4e0', clockFace: '#28061a', warn: '#ffb6c4', ...WARN,
    hoverTop: '#5c1430', hoverMid: '#3e0c1e', hoverBot: '#280612',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#dcdce6', hoverEdgeDeep: '#7a7a8e', hoverEdgeLo: '#f2f2f8',
    lip: '#3e3e4e', studEdge: '#2a2a36',
  },
  /** Dark cherry-bark brown with a blossom-pink edge. */
  sakura: {
    plateTop: '#3e2430', plateMid: '#2a1720', plateBot: '#1b0e14',
    edgeHi: '#fff0f4', edgeMain: '#f0a8c0', edgeDeep: '#8a4a62', edgeLo: '#ffd0de', ring: 'rgba(255, 208, 222, 0.2)',
    text: '#fff4f7', muted: '#d8b8c4', title: '#ffd0de', hl: '#ff94b4',
    chipBg: '#12080c', chipEdge: '#7a4458', chipText: '#fae8ee', divider: 'rgba(255, 208, 222, 0.2)', icon: '#ffc0d2',
    heart: '#ff3a58', ghost: '#4fdccb', ...STEEL, clockRim: '#f2b0c6', clockFace: '#22121a', warn: '#ffb4b4', ...WARN,
    hoverTop: '#4e2e3c', hoverMid: '#352029', hoverBot: '#22131a',
    hoverEdgeHi: '#fff8fa', hoverEdgeMain: '#f8c0d2', hoverEdgeDeep: '#a8607c', hoverEdgeLo: '#ffe0ea',
    lip: '#5e2c40', studEdge: '#42202c',
  },
  /** Dusk purple with a peach-gold edge, like the last of the sun. */
  twilight: {
    plateTop: '#3a2a5a', plateMid: '#261b40', plateBot: '#17102a',
    edgeHi: '#fff0e0', edgeMain: '#f0b088', edgeDeep: '#7e5040', edgeLo: '#ffd0b0', ring: 'rgba(255, 208, 176, 0.2)',
    text: '#fff4ee', muted: '#c4b4dc', title: '#ffd2b0', hl: '#ffa486',
    chipBg: '#0e0a1c', chipEdge: '#6a4a6a', chipText: '#f6eaf0', divider: 'rgba(255, 208, 176, 0.2)', icon: '#ffc8a4',
    heart: '#ff3f66', ghost: '#4fdccb', ...STEEL, clockRim: '#f2b890', clockFace: '#1e1634', warn: '#ffb0c8', ...WARN,
    hoverTop: '#48366e', hoverMid: '#302452', hoverBot: '#1e1636',
    hoverEdgeHi: '#fff8f0', hoverEdgeMain: '#f8c4a0', hoverEdgeDeep: '#9e6a54', hoverEdgeLo: '#ffe0c8',
    lip: '#5a3a2c', studEdge: '#3e281e',
  },
  /** Azure lapis blue with a warm gold edge. */
  lapis: {
    plateTop: '#183a7a', plateMid: '#10285a', plateBot: '#08183a',
    edgeHi: '#fff4c8', edgeMain: '#e2b84a', edgeDeep: '#7a5a18', edgeLo: '#f6d888', ring: 'rgba(246, 216, 136, 0.2)',
    text: '#f2f6ff', muted: '#a9bce0', title: '#ffe39a', hl: '#ffc94a',
    chipBg: '#061030', chipEdge: '#5a5a3a', chipText: '#eef2ff', divider: 'rgba(246, 216, 136, 0.2)', icon: '#f6d888',
    heart: '#ff4a6a', ghost: '#4fdccb', ...STEEL, clockRim: '#e8c060', clockFace: '#0c1e48', warn: '#ffb6c6', ...WARN,
    hoverTop: '#22488e', hoverMid: '#163468', hoverBot: '#0c2046',
    hoverEdgeHi: '#fffbe6', hoverEdgeMain: '#f0cc6a', hoverEdgeDeep: '#9c7a2c', hoverEdgeLo: '#ffe8a8',
    lip: '#5a4210', studEdge: '#3e2d08',
  },
  /** Glacial blue-grey with an ice-white edge. The ghost goes lavender so it never reads as the ice-blue keywords. */
  glacier: {
    plateTop: '#2a4a5e', plateMid: '#1a3242', plateBot: '#0f202c',
    edgeHi: '#ffffff', edgeMain: '#a8dcf0', edgeDeep: '#4a7a90', edgeLo: '#d8f2fc', ring: 'rgba(216, 242, 252, 0.2)',
    text: '#f0fbff', muted: '#a6c4d2', title: '#c8f0ff', hl: '#8fe0ff',
    chipBg: '#08161f', chipEdge: '#3e6678', chipText: '#e8f6fc', divider: 'rgba(216, 242, 252, 0.2)', icon: '#bce8fa',
    heart: '#ff4d6d', ghost: '#c2a8ff', ...STEEL, clockRim: '#b0e0f2', clockFace: '#142a38', warn: '#ffb0c0', ...WARN,
    hoverTop: '#34586e', hoverMid: '#22404f', hoverBot: '#142836',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#c4ecfa', hoverEdgeDeep: '#6496ae', hoverEdgeLo: '#eafaff',
    lip: '#2e5466', studEdge: '#1e3a48',
  },
  /** Soft sage green with a pale silver-sage edge and wheat highlights. */
  sage: {
    plateTop: '#3a4636', plateMid: '#262f24', plateBot: '#182016',
    edgeHi: '#f6f8ec', edgeMain: '#c4cfae', edgeDeep: '#5e6a4c', edgeLo: '#e0e8cc', ring: 'rgba(224, 232, 204, 0.2)',
    text: '#f6faf0', muted: '#b8c4ae', title: '#e8f0d0', hl: '#f2c890',
    chipBg: '#0e130c', chipEdge: '#56624a', chipText: '#eef3e6', divider: 'rgba(224, 232, 204, 0.2)', icon: '#dfe8c6',
    heart: '#ff4a5e', ghost: '#4fdccb', ...STEEL, clockRim: '#ccd6b4', clockFace: '#1e261c', warn: '#ffb0b8', ...WARN,
    hoverTop: '#46543f', hoverMid: '#2e382b', hoverBot: '#1d261b',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d6e0c0', hoverEdgeDeep: '#78866a', hoverEdgeLo: '#eef4e2',
    lip: '#464e38', studEdge: '#2e3426',
  },
  /** Cool graphite with a brushed steel edge and safety-orange highlights. */
  graphite: {
    plateTop: '#2a2d33', plateMid: '#1b1d22', plateBot: '#101114',
    edgeHi: '#f2f4f8', edgeMain: '#9aa0ac', edgeDeep: '#44484f', edgeLo: '#c8ccd4', ring: 'rgba(200, 204, 212, 0.2)',
    text: '#eef0f4', muted: '#a8acb6', title: '#eef0f4', hl: '#ff9a4a',
    chipBg: '#0a0b0d', chipEdge: '#4c5058', chipText: '#eceef2', divider: 'rgba(200, 204, 212, 0.2)', icon: '#d0d4dc',
    heart: '#ff4a5c', ghost: '#4fdccb', ...STEEL, clockRim: '#b0b6c0', clockFace: '#17191d', warn: '#ffaab4', ...WARN,
    hoverTop: '#353840', hoverMid: '#23262c', hoverBot: '#15171b',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#b4bac4', hoverEdgeDeep: '#5a5f68', hoverEdgeLo: '#e0e4ea',
    lip: '#34373d', studEdge: '#22252a',
  },
  /** Ink-dark navy with a parchment edge, parchment text and red-ink highlights. */
  inkpaper: {
    plateTop: '#232838', plateMid: '#171b28', plateBot: '#0e111a',
    edgeHi: '#fbf2dc', edgeMain: '#d8c4a0', edgeDeep: '#6e604a', edgeLo: '#efe2c6', ring: 'rgba(239, 226, 198, 0.2)',
    text: '#f6eedc', muted: '#bdb4a2', title: '#fff4d8', hl: '#ff8a7a',
    chipBg: '#0a0c14', chipEdge: '#5e5646', chipText: '#f2ead8', divider: 'rgba(239, 226, 198, 0.2)', icon: '#eadcbc',
    heart: '#ff4a5a', ghost: '#4fdccb', ...STEEL, clockRim: '#dccaa6', clockFace: '#141826', warn: '#ffb0b4', ...WARN,
    hoverTop: '#2e3446', hoverMid: '#1f2433', hoverBot: '#131722',
    hoverEdgeHi: '#fffaf0', hoverEdgeMain: '#e6d4b2', hoverEdgeDeep: '#8a7a5e', hoverEdgeLo: '#f8eed8',
    lip: '#4a4232', studEdge: '#322c22',
  },
  /** Dark walnut wood with a pale cream grain edge and leaf-green highlights. */
  walnut: {
    plateTop: '#3a2a1e', plateMid: '#261b13', plateBot: '#18110b',
    edgeHi: '#f6ead4', edgeMain: '#b89068', edgeDeep: '#5e4430', edgeLo: '#dcc0a0', ring: 'rgba(220, 192, 160, 0.2)',
    text: '#fbf3e8', muted: '#c8b6a2', title: '#f2dcb8', hl: '#c6dc8a',
    chipBg: '#100b07', chipEdge: '#5e4634', chipText: '#f4eadc', divider: 'rgba(220, 192, 160, 0.2)', icon: '#e2c8a4',
    heart: '#ff4a58', ghost: '#4fdccb', ...STEEL, clockRim: '#c8a07a', clockFace: '#20170f', warn: '#ffb0b4', ...WARN,
    hoverTop: '#4a3627', hoverMid: '#31241a', hoverBot: '#1f160e',
    hoverEdgeHi: '#fff6e6', hoverEdgeMain: '#cca47e', hoverEdgeDeep: '#7a5a40', hoverEdgeLo: '#ecd4b8',
    lip: '#4a3420', studEdge: '#322314',
  },
  /** Caramel leather with a brass edge, cream stitching and denim-blue highlights. */
  saddle: {
    plateTop: '#5c3e1e', plateMid: '#3e2912', plateBot: '#28190a',
    edgeHi: '#fff2d8', edgeMain: '#d8b070', edgeDeep: '#7a5a2a', edgeLo: '#f0d49c', ring: 'rgba(240, 212, 156, 0.2)',
    text: '#fff6ea', muted: '#dcc4a6', title: '#fff0d6', hl: '#9fd8ff',
    chipBg: '#140c04', chipEdge: '#7a5a2a', chipText: '#f8ecdc', divider: 'rgba(240, 212, 156, 0.2)', icon: '#f0d49c',
    heart: '#ff3d50', ghost: '#4fdccb', ...STEEL, clockRim: '#dcb474', clockFace: '#2e1e0e', warn: '#ffb6bc', ...WARN,
    hoverTop: '#6c4a26', hoverMid: '#4a3218', hoverBot: '#30200e',
    hoverEdgeHi: '#fff8e8', hoverEdgeMain: '#e4c084', hoverEdgeDeep: '#9a7636', hoverEdgeLo: '#f8e2b4',
    lip: '#5a3e14', studEdge: '#3e2a0c',
  },
  /** Terracotta clay with a turquoise edge. The ghost goes lavender so it never reads as the turquoise. */
  turquoise: {
    plateTop: '#5a2e22', plateMid: '#3e1e16', plateBot: '#28120c',
    edgeHi: '#e8fffa', edgeMain: '#5ad0c0', edgeDeep: '#1e6a60', edgeLo: '#a8ece2', ring: 'rgba(168, 236, 226, 0.2)',
    text: '#fff4ee', muted: '#e0bcae', title: '#a8f0e4', hl: '#ffb48a',
    chipBg: '#160a06', chipEdge: '#6a3a2c', chipText: '#faeae4', divider: 'rgba(168, 236, 226, 0.2)', icon: '#8fe6d8',
    heart: '#ff3d55', ghost: '#c6aaff', ...STEEL, clockRim: '#6ad6c6', clockFace: '#2e1610', warn: '#ffb8c0', ...WARN,
    hoverTop: '#6c3a2c', hoverMid: '#4a261c', hoverBot: '#301610',
    hoverEdgeHi: '#f4fffd', hoverEdgeMain: '#7adccc', hoverEdgeDeep: '#2e8478', hoverEdgeLo: '#c4f4ec',
    lip: '#1e5a52', studEdge: '#143e38',
  },
  /** Warm black stone with an ochre edge and lichen-green highlights. */
  basalt: {
    plateTop: '#2e2b27', plateMid: '#1d1b1a', plateBot: '#121110',
    edgeHi: '#fbefc8', edgeMain: '#c89a3a', edgeDeep: '#6a4e14', edgeLo: '#e8c470', ring: 'rgba(232, 196, 112, 0.2)',
    text: '#f4f0e8', muted: '#b6b0a6', title: '#f0d890', hl: '#9fd2a0',
    chipBg: '#0b0a09', chipEdge: '#5e4e2c', chipText: '#efeae0', divider: 'rgba(232, 196, 112, 0.2)', icon: '#e0c470',
    heart: '#ff4a5a', ghost: '#4fdccb', ...STEEL, clockRim: '#c8a048', clockFace: '#191716', warn: '#ffaab2', ...WARN,
    hoverTop: '#3a3732', hoverMid: '#262421', hoverBot: '#171615',
    hoverEdgeHi: '#fff6d8', hoverEdgeMain: '#dcb050', hoverEdgeDeep: '#7a5c1c', hoverEdgeLo: '#f0d488',
    lip: '#4e3c12', studEdge: '#34280c',
  },
  /** Burnt-orange canyon rock with a sunlit sandstone edge and sky-blue highlights. The ghost goes lavender so it never reads as the sky. */
  canyon: {
    plateTop: '#6a2e16', plateMid: '#4a1f0e', plateBot: '#2e1206',
    edgeHi: '#fff0d0', edgeMain: '#e8a050', edgeDeep: '#8a4a14', edgeLo: '#ffc882', ring: 'rgba(255, 200, 130, 0.2)',
    text: '#fff6ee', muted: '#eec4aa', title: '#ffe0b0', hl: '#8fd4ff',
    chipBg: '#1e0c04', chipEdge: '#8a4a26', chipText: '#fceee2', divider: 'rgba(255, 200, 130, 0.2)', icon: '#ffc882',
    heart: '#ff3550', ghost: '#c4a8ff', ...STEEL, clockRim: '#f0aa5a', clockFace: '#3a1808', warn: '#ffc0c8', ...WARN,
    hoverTop: '#7c3a1e', hoverMid: '#582614', hoverBot: '#381608',
    hoverEdgeHi: '#fff8e6', hoverEdgeMain: '#f4b466', hoverEdgeDeep: '#a65e22', hoverEdgeLo: '#ffd8a0',
    lip: '#6a3410', studEdge: '#4a240a',
  },
  /** Warm smoke grey with a polished rose-gold edge. */
  rosegold: {
    plateTop: '#3a2e30', plateMid: '#262021', plateBot: '#181415',
    edgeHi: '#fff0ea', edgeMain: '#e8a898', edgeDeep: '#8a5448', edgeLo: '#f8cfc4', ring: 'rgba(248, 207, 196, 0.2)',
    text: '#fff6f4', muted: '#c8b8b6', title: '#ffd8cc', hl: '#ffa890',
    chipBg: '#0e0b0b', chipEdge: '#6e4c46', chipText: '#f6ecea', divider: 'rgba(248, 207, 196, 0.2)', icon: '#f4c0b2',
    heart: '#ff4560', ghost: '#4fdccb', ...STEEL, clockRim: '#ecb0a0', clockFace: '#1e1819', warn: '#ffb6c4', ...WARN,
    hoverTop: '#4a3c3e', hoverMid: '#302728', hoverBot: '#1e1919',
    hoverEdgeHi: '#fff8f6', hoverEdgeMain: '#f2bcae', hoverEdgeDeep: '#a86a5c', hoverEdgeLo: '#ffe2da',
    lip: '#5e3a32', studEdge: '#422822',
  },
  /** Verdigris-dark green with an old bronze edge. The ghost goes lavender so it never reads as the verdigris keywords. */
  patina: {
    plateTop: '#173a36', plateMid: '#0e2724', plateBot: '#071816',
    edgeHi: '#ffe6c0', edgeMain: '#c88a48', edgeDeep: '#6a4216', edgeLo: '#e8b47a', ring: 'rgba(232, 180, 122, 0.2)',
    text: '#effaf6', muted: '#a2c6bc', title: '#ffd6a4', hl: '#6ae0c0',
    chipBg: '#041210', chipEdge: '#5a4a30', chipText: '#e6f6f0', divider: 'rgba(232, 180, 122, 0.2)', icon: '#f0be88',
    heart: '#ff4d66', ghost: '#c2a8ff', ...STEEL, clockRim: '#d6985a', clockFace: '#0b221f', warn: '#ffb2c2', ...WARN,
    hoverTop: '#1f4a45', hoverMid: '#143430', hoverBot: '#0b201d',
    hoverEdgeHi: '#fff2dc', hoverEdgeMain: '#dca064', hoverEdgeDeep: '#8a5a26', hoverEdgeLo: '#f4cc98',
    lip: '#5a3612', studEdge: '#3e240a',
  },
  /** Dark blue-grey with an anodized blue-violet edge and magenta highlights. */
  titanium: {
    plateTop: '#2e3448', plateMid: '#1e2232', plateBot: '#12151f',
    edgeHi: '#f4f0ff', edgeMain: '#9aa8e8', edgeDeep: '#4a4a8a', edgeLo: '#d0c8f8', ring: 'rgba(208, 200, 248, 0.2)',
    text: '#f2f4ff', muted: '#aab0cc', title: '#dcd6ff', hl: '#f0a8ff',
    chipBg: '#0a0c14', chipEdge: '#4a5080', chipText: '#eef0fc', divider: 'rgba(208, 200, 248, 0.2)', icon: '#c8c8f8',
    heart: '#ff4a6a', ghost: '#4fdccb', ...STEEL, clockRim: '#a8b2ec', clockFace: '#181b28', warn: '#ffb0c0', ...WARN,
    hoverTop: '#3a4258', hoverMid: '#262c40', hoverBot: '#181c28',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#b4c0f2', hoverEdgeDeep: '#5e5ea6', hoverEdgeLo: '#e2dcff',
    lip: '#383868', studEdge: '#26264a',
  },
  /** Dark umber with an aged brass edge and warm rust highlights. */
  brass: {
    plateTop: '#2c2619', plateMid: '#1d1910', plateBot: '#120f08',
    edgeHi: '#fff4c0', edgeMain: '#c8a83e', edgeDeep: '#6a5414', edgeLo: '#e8d080', ring: 'rgba(232, 208, 128, 0.2)',
    text: '#f8f6e6', muted: '#c0bca0', title: '#f2e2a0', hl: '#f0a070',
    chipBg: '#0b0905', chipEdge: '#6a5a28', chipText: '#f2eedc', divider: 'rgba(232, 208, 128, 0.2)', icon: '#e8d080',
    heart: '#ff4a58', ghost: '#4fdccb', ...STEEL, clockRim: '#d4b44a', clockFace: '#1a160e', warn: '#ffb0b6', ...WARN,
    hoverTop: '#3a3322', hoverMid: '#272217', hoverBot: '#18140c',
    hoverEdgeHi: '#fffae0', hoverEdgeMain: '#dcbc52', hoverEdgeDeep: '#8a6e20', hoverEdgeLo: '#f2dc98',
    lip: '#54420e', studEdge: '#3a2e0a',
  },
  /** Blue-black with a mirror chrome edge and signal-red highlights. */
  chrome: {
    plateTop: '#141a26', plateMid: '#0c111a', plateBot: '#06090f',
    edgeHi: '#ffffff', edgeMain: '#c6ceda', edgeDeep: '#4e5868', edgeLo: '#eef2f8', ring: 'rgba(238, 242, 248, 0.2)',
    text: '#f2f6fc', muted: '#a2acbc', title: '#ffffff', hl: '#ff7a7a',
    chipBg: '#04060a', chipEdge: '#4a5262', chipText: '#eef2f8', divider: 'rgba(238, 242, 248, 0.2)', icon: '#dce2ec',
    heart: '#ff3a52', ghost: '#4fdccb', ...STEEL, clockRim: '#c4ccd8', clockFace: '#0e131c', warn: '#ffb6c0', ...WARN,
    hoverTop: '#1e2636', hoverMid: '#141a26', hoverBot: '#0a0f17',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#e2e8f0', hoverEdgeDeep: '#7a8494', hoverEdgeLo: '#f4f7fb',
    lip: '#3a4250', studEdge: '#262c36',
  },
  /** Deep purple with a hot-pink neon edge and cyan highlights. The ghost goes periwinkle so it never reads as the cyan. */
  synthwave: {
    plateTop: '#2a0e40', plateMid: '#1c082c', plateBot: '#10041a',
    edgeHi: '#ffe0ff', edgeMain: '#ff4fd0', edgeDeep: '#7a1068', edgeLo: '#ff9ae6', ring: 'rgba(255, 154, 230, 0.2)',
    text: '#fff0fc', muted: '#c8a8dc', title: '#ffb8f0', hl: '#4ff0ff',
    chipBg: '#0a0212', chipEdge: '#7a2a7a', chipText: '#fae6fa', divider: 'rgba(255, 154, 230, 0.2)', icon: '#ff8ae0',
    heart: '#ff3a5a', ghost: '#a8b0ff', ...STEEL, clockRim: '#ff6ad8', clockFace: '#18062a', warn: '#ffb4b4', ...WARN,
    hoverTop: '#3a1656', hoverMid: '#280c3e', hoverBot: '#180626',
    hoverEdgeHi: '#fff0ff', hoverEdgeMain: '#ff6ad8', hoverEdgeDeep: '#9a1a84', hoverEdgeLo: '#ffb4ee',
    lip: '#5a0a4c', studEdge: '#3e0634',
  },
  /** Black-green terminal with a neon green edge. */
  matrix: {
    plateTop: '#0c1e10', plateMid: '#07140a', plateBot: '#030a05',
    edgeHi: '#e0ffe0', edgeMain: '#2ee860', edgeDeep: '#0a6a22', edgeLo: '#8af0a0', ring: 'rgba(138, 240, 160, 0.2)',
    text: '#eaffee', muted: '#8ec49a', title: '#a6ffbc', hl: '#4aff88',
    chipBg: '#020804', chipEdge: '#1e5a2e', chipText: '#e2fae8', divider: 'rgba(138, 240, 160, 0.2)', icon: '#6af090',
    heart: '#ff4a6a', ghost: '#4fdccb', ...STEEL, clockRim: '#3ee870', clockFace: '#061209', warn: '#ffb0c0', ...WARN,
    hoverTop: '#12301a', hoverMid: '#0b2010', hoverBot: '#051208',
    hoverEdgeHi: '#f0fff0', hoverEdgeMain: '#50f07c', hoverEdgeDeep: '#12862e', hoverEdgeLo: '#a8f6b8',
    lip: '#0a4a1a', studEdge: '#063010',
  },
  /** Black-indigo with a UV-violet neon edge and magenta highlights. */
  ultraviolet: {
    plateTop: '#1e1040', plateMid: '#140a2c', plateBot: '#0b0519',
    edgeHi: '#f0e0ff', edgeMain: '#9a5aff', edgeDeep: '#3e1a8a', edgeLo: '#c8a0ff', ring: 'rgba(200, 160, 255, 0.2)',
    text: '#f6f0ff', muted: '#b4a6dc', title: '#d8c4ff', hl: '#ff6ae0',
    chipBg: '#08041a', chipEdge: '#4a2e8a', chipText: '#f0eaff', divider: 'rgba(200, 160, 255, 0.2)', icon: '#c09aff',
    heart: '#ff3a5e', ghost: '#4fdccb', ...STEEL, clockRim: '#a870ff', clockFace: '#120a28', warn: '#ffb0c4', ...WARN,
    hoverTop: '#2a1856', hoverMid: '#1c103c', hoverBot: '#100824',
    hoverEdgeHi: '#f8f0ff', hoverEdgeMain: '#b080ff', hoverEdgeDeep: '#5428b0', hoverEdgeLo: '#dcc4ff',
    lip: '#2e1470', studEdge: '#1e0c4c',
  },
  /** Cold black with an electric-yellow edge and amber highlights. */
  electric: {
    plateTop: '#1c1e24', plateMid: '#121418', plateBot: '#0a0b0e',
    edgeHi: '#ffffe0', edgeMain: '#ffe020', edgeDeep: '#8a7400', edgeLo: '#fff080', ring: 'rgba(255, 240, 128, 0.2)',
    text: '#fafaf0', muted: '#b8b8aa', title: '#fff04a', hl: '#ffb020',
    chipBg: '#060708', chipEdge: '#6a6010', chipText: '#f4f4e6', divider: 'rgba(255, 240, 128, 0.2)', icon: '#ffe84a',
    heart: '#ff3a50', ghost: '#4fdccb', ...STEEL, clockRim: '#ffe020', clockFace: '#141519', warn: '#ffaab4', ...WARN,
    hoverTop: '#282b33', hoverMid: '#1a1c22', hoverBot: '#101115',
    hoverEdgeHi: '#fffff0', hoverEdgeMain: '#fff04a', hoverEdgeDeep: '#a89000', hoverEdgeLo: '#fff8a8',
    lip: '#5a4c00', studEdge: '#3e3400',
  },
  /** Midnight navy with an electric-blue neon edge and sodium-orange highlights. */
  nightdrive: {
    plateTop: '#0e1a3e', plateMid: '#08112a', plateBot: '#040919',
    edgeHi: '#e0f0ff', edgeMain: '#2a8aff', edgeDeep: '#0a3a8a', edgeLo: '#8ac4ff', ring: 'rgba(138, 196, 255, 0.2)',
    text: '#eef4ff', muted: '#9aaed6', title: '#a8d2ff', hl: '#ffa040',
    chipBg: '#030714', chipEdge: '#1e4a8a', chipText: '#e6eefc', divider: 'rgba(138, 196, 255, 0.2)', icon: '#6ab4ff',
    heart: '#ff3a5c', ghost: '#4fdccb', ...STEEL, clockRim: '#4a9cff', clockFace: '#0a1430', warn: '#ffb0c2', ...WARN,
    hoverTop: '#162654', hoverMid: '#0e1a3a', hoverBot: '#070f22',
    hoverEdgeHi: '#f0f8ff', hoverEdgeMain: '#4aa0ff', hoverEdgeDeep: '#1450aa', hoverEdgeLo: '#a8d4ff',
    lip: '#0a3070', studEdge: '#06204c',
  },
  /** Dusky lavender grey with a pale lilac edge and pastel-pink highlights. */
  lavender: {
    plateTop: '#3a3450', plateMid: '#272338', plateBot: '#191626',
    edgeHi: '#fbf6ff', edgeMain: '#c8b8ec', edgeDeep: '#6a5e90', edgeLo: '#e4daf8', ring: 'rgba(228, 218, 248, 0.2)',
    text: '#faf8ff', muted: '#c0b8d6', title: '#e6dcff', hl: '#ffc8e6',
    chipBg: '#0f0d18', chipEdge: '#5e5680', chipText: '#f2eefc', divider: 'rgba(228, 218, 248, 0.2)', icon: '#dcd0fa',
    heart: '#ff5a7a', ghost: '#4fdccb', ...STEEL, clockRim: '#cfc0f0', clockFace: '#211d30', warn: '#ffbcc8', ...WARN,
    hoverTop: '#463f60', hoverMid: '#302b44', hoverBot: '#1f1b2e',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d8cbf4', hoverEdgeDeep: '#8478aa', hoverEdgeLo: '#f0eafc',
    lip: '#4a426a', studEdge: '#322c4a',
  },
  /** Slate blue with a pastel-peach edge and mint highlights. The ghost goes lavender so it never reads as the mint. */
  sorbet: {
    plateTop: '#2a3448', plateMid: '#1c2433', plateBot: '#121822',
    edgeHi: '#fff4ec', edgeMain: '#f4b898', edgeDeep: '#8a5a48', edgeLo: '#ffd8c4', ring: 'rgba(255, 216, 196, 0.2)',
    text: '#fff8f4', muted: '#c0c4d2', title: '#ffdcc8', hl: '#a8f0cc',
    chipBg: '#0c1018', chipEdge: '#6a5a5a', chipText: '#f8eeea', divider: 'rgba(255, 216, 196, 0.2)', icon: '#ffcab0',
    heart: '#ff4a62', ghost: '#c0aaff', ...STEEL, clockRim: '#f6bea0', clockFace: '#182030', warn: '#ffbcc8', ...WARN,
    hoverTop: '#36425a', hoverMid: '#262f42', hoverBot: '#18202c',
    hoverEdgeHi: '#fffaf6', hoverEdgeMain: '#fac8ae', hoverEdgeDeep: '#a8705c', hoverEdgeLo: '#ffe4d4',
    lip: '#5a3a2e', studEdge: '#3e281e',
  },
  /** Soft violet-grey with a pink-to-lilac edge and baby-blue highlights. */
  cottoncandy: {
    plateTop: '#2e2540', plateMid: '#1f192c', plateBot: '#14101d',
    edgeHi: '#fff0fa', edgeMain: '#f8b4e0', edgeDeep: '#8a5a90', edgeLo: '#d8c8ff', ring: 'rgba(216, 200, 255, 0.2)',
    text: '#fff6fc', muted: '#c8b8d8', title: '#ffc4ea', hl: '#a8d8ff',
    chipBg: '#0e0a16', chipEdge: '#6a4a78', chipText: '#f8eefa', divider: 'rgba(216, 200, 255, 0.2)', icon: '#ffbce4',
    heart: '#ff4a70', ghost: '#4fdccb', ...STEEL, clockRim: '#f8bce2', clockFace: '#1a1526', warn: '#ffbcbc', ...WARN,
    hoverTop: '#3a3052', hoverMid: '#29213a', hoverBot: '#1a1426',
    hoverEdgeHi: '#fffaff', hoverEdgeMain: '#fcc8ea', hoverEdgeDeep: '#a874ae', hoverEdgeLo: '#e8dcff',
    lip: '#5a3a60', studEdge: '#3e2842',
  },
  /** Warm stone grey with a pistachio edge and pastel-pink highlights. */
  pistachio: {
    plateTop: '#3a3832', plateMid: '#272622', plateBot: '#191816',
    edgeHi: '#f8ffec', edgeMain: '#c4dc9a', edgeDeep: '#66784a', edgeLo: '#e2f0c8', ring: 'rgba(226, 240, 200, 0.2)',
    text: '#fbfcf4', muted: '#c2c0b2', title: '#e0f0c0', hl: '#ffbcc4',
    chipBg: '#0f0e0c', chipEdge: '#5c6648', chipText: '#f2f4e8', divider: 'rgba(226, 240, 200, 0.2)', icon: '#d4e8b0',
    heart: '#ff4a5e', ghost: '#4fdccb', ...STEEL, clockRim: '#c8dc9c', clockFace: '#22211d', warn: '#ffb0b8', ...WARN,
    hoverTop: '#46443d', hoverMid: '#302f2a', hoverBot: '#1f1e1b',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d2e6ac', hoverEdgeDeep: '#80946a', hoverEdgeLo: '#eef8dc',
    lip: '#48543a', studEdge: '#303826',
  },
} as const satisfies Record<string, UiThemeTokens>;

export type UiThemeId = keyof typeof UI_THEMES;
/** The tuner dropdown, grouped by colour scheme into `<optgroup>` sections (owner ask on #1926: "separate them by
 *  color scheme i.e. blue: x,y,z"). The six original families lead with their original theme; Earth, Metal, Neon
 *  and Pastel Night were added with the 60-theme set. Every theme sits in exactly one group (tooltipStyle.test.ts
 *  checks). */
export const UI_THEME_GROUPS: readonly { label: string; options: readonly UiThemeId[] }[] = [
  { label: 'Gold', options: ['gem', 'sunforge', 'honeycomb', 'gilded', 'champagne'] },
  { label: 'Red & Fire', options: ['ember', 'crimson', 'infernal', 'bloodmoon', 'furnace', 'volcanic', 'garnet'] },
  { label: 'Pink & Violet', options: ['amethyst', 'rose', 'celestial', 'orchid', 'nebula', 'sakura', 'twilight'] },
  { label: 'Blue', options: ['sapphire', 'teal', 'abyssal', 'ocean', 'cobalt', 'lapis', 'glacier'] },
  { label: 'Green', options: ['verdant', 'jade', 'moss', 'aurora', 'emerald', 'toxic', 'sage'] },
  { label: 'Earth', options: ['sandstone', 'desert', 'walnut', 'saddle', 'turquoise', 'basalt', 'canyon'] },
  { label: 'Metal', options: ['pewter', 'rosegold', 'patina', 'titanium', 'brass', 'chrome'] },
  { label: 'Neon', options: ['synthwave', 'matrix', 'ultraviolet', 'electric', 'nightdrive'] },
  { label: 'Pastel Night', options: ['lavender', 'sorbet', 'cottoncandy', 'pistachio'] },
  { label: 'Neutral & Silver', options: ['frost', 'storm', 'charcoal', 'graphite', 'inkpaper'] },
];
/** Every theme, in dropdown order. */
export const UI_THEME_IDS: UiThemeId[] = UI_THEME_GROUPS.flatMap((g) => g.options);
/** The display name of each theme (the optgroup header carries the family). */
export const UI_THEME_LABELS: Record<UiThemeId, string> = {
  gem: 'Gem Gold (default)',
  sunforge: 'Sunforge',
  honeycomb: 'Honeycomb',
  gilded: 'Gilded Night',
  champagne: 'Champagne',
  ember: 'Obsidian Ember',
  crimson: 'Crimson Royale',
  infernal: 'Infernal',
  bloodmoon: 'Bloodmoon',
  furnace: 'Copper Furnace',
  volcanic: 'Volcanic',
  garnet: 'Garnet',
  amethyst: 'Amethyst',
  rose: 'Rose Quartz',
  celestial: 'Celestial',
  orchid: 'Orchid',
  nebula: 'Nebula Pink',
  sakura: 'Sakura',
  twilight: 'Twilight',
  sapphire: 'Royal Sapphire',
  teal: 'Midnight Teal',
  abyssal: 'Abyssal',
  ocean: 'Ocean Deep',
  cobalt: 'Cobalt Night',
  lapis: 'Lapis',
  glacier: 'Glacier',
  verdant: 'Verdant',
  jade: 'Jade Dynasty',
  moss: 'Moss & Copper',
  aurora: 'Arctic Aurora',
  emerald: 'Emerald Grove',
  toxic: 'Toxic Lime',
  sage: 'Sage',
  sandstone: 'Sandstone',
  desert: 'Desert Sun',
  walnut: 'Walnut',
  saddle: 'Saddle Leather',
  turquoise: 'Clay & Turquoise',
  basalt: 'Basalt',
  canyon: 'Canyon',
  pewter: 'Pewter',
  rosegold: 'Rose Gold',
  patina: 'Patina',
  titanium: 'Titanium',
  brass: 'Old Brass',
  chrome: 'Chrome',
  synthwave: 'Synthwave',
  matrix: 'Matrix',
  ultraviolet: 'Ultraviolet',
  electric: 'Electric',
  nightdrive: 'Night Drive',
  lavender: 'Lavender Haze',
  sorbet: 'Sorbet',
  cottoncandy: 'Cotton Candy',
  pistachio: 'Pistachio',
  frost: 'Frost Silver',
  storm: 'Storm Slate',
  charcoal: 'Charcoal Mono',
  graphite: 'Graphite',
  inkpaper: 'Ink & Parchment',
};

/** The theme production plays: uiTheme.css's `:root` block must equal it. Gem Gold until the owner picks. */
export const DEFAULT_THEME: UiThemeId = 'gem';
