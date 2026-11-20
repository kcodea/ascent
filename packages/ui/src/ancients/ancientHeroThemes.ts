/**
 * PER-HERO AWAKENING THEMES (owner 2026-09-26: "customize every hero's ancient trigger animation slightly … have their
 * color associated"). A theme is FIVE colours: they tint the omen around the hero power, the eruption's flash, dust and
 * motes, and the backdrop behind the select screen. A hero without an entry wears `default`.
 *
 * The field names are from the earlier curtain (a bloom of colour with the hero power's art as a medallion, and one of
 * nine "bloom styles" per hero). The owner deleted the curtain and its styles on 2026-11-19 ("delete the curtain and
 * its dials") once the six panels replaced it; the names stay because saved tuner values are stored under them.
 *
 * Pure data + pure resolvers, DOM-free, so it can be unit-tested.
 */
export interface AncientHeroTheme {
  /** The main colour: the omen's halo and the eruption's flash. */
  curtainInner: string;
  /** The dark companion of the main colour. */
  curtainOuter: string;
  /** The light colour: the omen's glyphs, the eruption's dust and blast. */
  seamColor: string;
  /** The glow colour: the omen's halo and embers. */
  titleGlow: string;
  /** The dark tint behind the cards once they are revealed. */
  backdropTint: string;
}

export const THEME_FIELDS = ['curtainInner', 'curtainOuter', 'seamColor', 'titleGlow', 'backdropTint'] as const;
export type ThemeField = (typeof THEME_FIELDS)[number];

const DEFAULT_THEME: AncientHeroTheme = { curtainInner: '#247067', curtainOuter: '#0a0618', seamColor: '#fff1bd', titleGlow: '#9effd5', backdropTint: '#060d0f' };

/** Every hero's colours. The first four are owner-approved (2026-09-26) and pinned by tests. The rest start from the
 *  owner's colour idea per hero, checked against the portrait art: a mid-tone curtain centre, a near-black edge in the
 *  same hue, a seam that is the glow mixed toward white, a bright title glow and a near-black backdrop tint. */
const COLOURS = {
  indy: { curtainInner: '#a0620f', curtainOuter: '#0d0501', seamColor: '#fff3cf', titleGlow: '#ffcf66', backdropTint: '#0f0803' },
  warden: { curtainInner: '#4a87bb', curtainOuter: '#050d1c', seamColor: '#eaf8ff', titleGlow: '#9fe0ff', backdropTint: '#050b14' },
  myra: { curtainInner: '#7b2887', curtainOuter: '#12031a', seamColor: '#ffe6a3', titleGlow: '#ffc95c', backdropTint: '#0d0512' },
  risen: { curtainInner: '#5d8f7b', curtainOuter: '#030a08', seamColor: '#eafff5', titleGlow: '#b9ffe2', backdropTint: '#060c0a' },
  soren: { curtainInner: '#7a64a8', curtainOuter: '#0a080f', seamColor: '#f4efff', titleGlow: '#d9c8ff', backdropTint: '#0a080c' },
  rohan: { curtainInner: '#7d8a96', curtainOuter: '#0a0c0d', seamColor: '#f7fbfd', titleGlow: '#e6f0f7', backdropTint: '#0a0a0b' },
  djinn: { curtainInner: '#3f3a9e', curtainOuter: '#070611', seamColor: '#e5e4ff', titleGlow: '#a9a4ff', backdropTint: '#08070d' },
  nadja: { curtainInner: '#2f7f78', curtainOuter: '#061110', seamColor: '#fff2d7', titleGlow: '#ffd27a', backdropTint: '#070d0d' },
  cassen: { curtainInner: '#8a6f45', curtainOuter: '#08070f', seamColor: '#fbf6eb', titleGlow: '#f3e2bb', backdropTint: '#0c0b08' },
  drakko: { curtainInner: '#9e1f2a', curtainOuter: '#130405', seamColor: '#ffdcd2', titleGlow: '#ff8a6a', backdropTint: '#0e0607' },
  chaos: { curtainInner: '#8e1f78', curtainOuter: '#050005', seamColor: '#ffd3f7', titleGlow: '#ff6ee6', backdropTint: '#0e060d' },
  robin: { curtainInner: '#2f6b35', curtainOuter: '#071008', seamColor: '#eaf9dc', titleGlow: '#b8ec8a', backdropTint: '#080d08' },
  darah: { curtainInner: '#b0582a', curtainOuter: '#130904', seamColor: '#ffecd7', titleGlow: '#ffc07a', backdropTint: '#0e0906' },
  gildmaster: { curtainInner: '#a8761e', curtainOuter: '#130e03', seamColor: '#fff4d6', titleGlow: '#ffd978', backdropTint: '#0e0b06' },
  discodan: { curtainInner: '#b0287e', curtainOuter: '#13040d', seamColor: '#ffd7f3', titleGlow: '#ff7bd8', backdropTint: '#0e060b' },
  brackus: { curtainInner: '#56707f', curtainOuter: '#090c0e', seamColor: '#ecf8ff', titleGlow: '#bfe8ff', backdropTint: '#090b0b' },
  baggerben: { curtainInner: '#4f7a2a', curtainOuter: '#0b1106', seamColor: '#f2fbdc', titleGlow: '#d4f08a', backdropTint: '#0a0d07' },
  hermithank: { curtainInner: '#8a6a2a', curtainOuter: '#120e05', seamColor: '#fbf1d8', titleGlow: '#f0cf7c', backdropTint: '#0d0b07' },
  fi: { curtainInner: '#3f86c4', curtainOuter: '#050c12', seamColor: '#e7f6ff', titleGlow: '#aee0ff', backdropTint: '#070a0d' },
  chronoshero: { curtainInner: '#8a5a2a', curtainOuter: '#120b05', seamColor: '#fbead5', titleGlow: '#f2b872', backdropTint: '#0d0a07' },
  runesmith: { curtainInner: '#b3541a', curtainOuter: '#140903', seamColor: '#ffe9ce', titleGlow: '#ffb45c', backdropTint: '#0f0906' },
  runeguard: { curtainInner: '#22448f', curtainOuter: '#040913', seamColor: '#dde9ff', titleGlow: '#8fb4ff', backdropTint: '#06090e' },
  coran: { curtainInner: '#2f7d62', curtainOuter: '#06110d', seamColor: '#e4fbf1', titleGlow: '#a6f2cf', backdropTint: '#070d0b' },
  tiff: { curtainInner: '#9a1f3c', curtainOuter: '#130407', seamColor: '#ffdde7', titleGlow: '#ff8fb0', backdropTint: '#0e0608' },
  jenkins: { curtainInner: '#b0281c', curtainOuter: '#140503', seamColor: '#ffe8d3', titleGlow: '#ffb36b', backdropTint: '#0f0606' },
  repete: { curtainInner: '#1f7a80', curtainOuter: '#041212', seamColor: '#ddfbfa', titleGlow: '#8ff0ee', backdropTint: '#060d0e' },
  gorr: { curtainInner: '#8f4420', curtainOuter: '#130904', seamColor: '#fce3d3', titleGlow: '#f5a26b', backdropTint: '#0e0906' },
  kindness: { curtainInner: '#a8506e', curtainOuter: '#10070a', seamColor: '#ffecf2', titleGlow: '#ffc0d4', backdropTint: '#0c080a' },
  merrin: { curtainInner: '#3450b0', curtainOuter: '#050812', seamColor: '#e2eaff', titleGlow: '#9fb8ff', backdropTint: '#07080e' },
  gambler: { curtainInner: '#1f6b45', curtainOuter: '#05120b', seamColor: '#fcf4dc', titleGlow: '#f4d98a', backdropTint: '#070e0a' },
  xerox: { curtainInner: '#1c8ea6', curtainOuter: '#031114', seamColor: '#e1fbff', titleGlow: '#9af3ff', backdropTint: '#060d0f' },
  frank: { curtainInner: '#b09020', curtainOuter: '#131004', seamColor: '#fffbd7', titleGlow: '#fff07a', backdropTint: '#0e0d06' },
  pete: { curtainInner: '#b89b28', curtainOuter: '#131004', seamColor: '#fffbe3', titleGlow: '#fff3a0', backdropTint: '#0e0d06' },
  flint: { curtainInner: '#5e5a58', curtainOuter: '#0c0b0b', seamColor: '#ffe3ca', titleGlow: '#ffa24f', backdropTint: '#0a0a0a' },
  vale: { curtainInner: '#2a47a8', curtainOuter: '#050812', seamColor: '#fff4dc', titleGlow: '#ffd98a', backdropTint: '#07080e' },
  quillen: { curtainInner: '#1f3a6e', curtainOuter: '#050912', seamColor: '#eaf1ff', titleGlow: '#b8d0ff', backdropTint: '#07090e' },
  hunch: { curtainInner: '#8a74b8', curtainOuter: '#0a080f', seamColor: '#f6f3ff', titleGlow: '#e2d6ff', backdropTint: '#0a080c' },
  emeraldwarden: { curtainInner: '#1f8a5a', curtainOuter: '#04130c', seamColor: '#ddffee', titleGlow: '#8dffc6', backdropTint: '#060e0b' },
  underdweller: { curtainInner: '#1b5a58', curtainOuter: '#051211', seamColor: '#d9f6f1', titleGlow: '#7fe0d0', backdropTint: '#070d0d' },
  albus: { curtainInner: '#9c875a', curtainOuter: '#0f0d08', seamColor: '#fffcf1', titleGlow: '#fff4d0', backdropTint: '#0c0b08' },
  devourer: { curtainInner: '#7e0f18', curtainOuter: '#150204', seamColor: '#ffcdcd', titleGlow: '#ff5a5a', backdropTint: '#0f0506' },
  flash: { curtainInner: '#c0a410', curtainOuter: '#151202', seamColor: '#fffedc', titleGlow: '#fffb8a', backdropTint: '#0f0e05' },
  midas: { curtainInner: '#b07a14', curtainOuter: '#150e02', seamColor: '#fff2cd', titleGlow: '#ffd35a', backdropTint: '#0f0c05' },
  juggler: { curtainInner: '#b8242e', curtainOuter: '#130405', seamColor: '#fff2d3', titleGlow: '#ffd36b', backdropTint: '#0e0607' },
  membrance: { curtainInner: '#6d6280', curtainOuter: '#0b0a0d', seamColor: '#f2f0f7', titleGlow: '#d5cce6', backdropTint: '#0a090b' },
  bram: { curtainInner: '#94702e', curtainOuter: '#120d05', seamColor: '#fcf2dc', titleGlow: '#f5d38a', backdropTint: '#0d0b07' },
  cia: { curtainInner: '#2a7a4e', curtainOuter: '#06110b', seamColor: '#fff3d7', titleGlow: '#ffd87a', backdropTint: '#070d0a' },
  odelle: { curtainInner: '#8e8470', curtainOuter: '#0d0c0a', seamColor: '#fffdf7', titleGlow: '#fff8e6', backdropTint: '#0b0b09' },
  harlan: { curtainInner: '#3a3020', curtainOuter: '#050403', seamColor: '#fff1cd', titleGlow: '#ffcf5a', backdropTint: '#0c0b08' },
  sable: { curtainInner: '#3e3c42', curtainOuter: '#0b0b0c', seamColor: '#f1eff3', titleGlow: '#cfc8d8', backdropTint: '#0a0a0a' },
  keshi: { curtainInner: '#3a8a6a', curtainOuter: '#07100c', seamColor: '#fff3d7', titleGlow: '#ffd87a', backdropTint: '#080d0b' },
  rayse: { curtainInner: '#4c9a32', curtainOuter: '#091106', seamColor: '#f2ffdc', titleGlow: '#d2ff8a', backdropTint: '#090d07' },
  aevor: { curtainInner: '#34507a', curtainOuter: '#070b10', seamColor: '#eaf4ff', titleGlow: '#b8dcff', backdropTint: '#080a0d' },
  gorun: { curtainInner: '#5c6878', curtainOuter: '#0a0b0d', seamColor: '#f6f9fc', titleGlow: '#e2ecf6', backdropTint: '#090a0b' },
  cindara: { curtainInner: '#b8481a', curtainOuter: '#140803', seamColor: '#ffe7cd', titleGlow: '#ffb05a', backdropTint: '#0f0806' },
  fibbsy: { curtainInner: '#a41c44', curtainOuter: '#140308', seamColor: '#ffe0ea', titleGlow: '#ff96b8', backdropTint: '#0f0608' },
  mimic: { curtainInner: '#6a6e74', curtainOuter: '#0b0b0c', seamColor: '#f3f6f8', titleGlow: '#d8e0e8', backdropTint: '#0a0a0a' },
  voidhero: { curtainInner: '#3a1a6a', curtainOuter: '#030006', seamColor: '#eadcff', titleGlow: '#b88cff', backdropTint: '#09060e' },
  aster: { curtainInner: '#3a5e8e', curtainOuter: '#070b10', seamColor: '#fbfcff', titleGlow: '#f2f6ff', backdropTint: '#080a0d' },
} satisfies Record<string, AncientHeroTheme>;

/** Heroes with their own theme (every hero in the game today). */
export type ThemedHero = keyof typeof COLOURS;

/** Every hero's display name (how the tuner names it). */
const LABELS: Record<ThemedHero, string> = {
  indy: 'Indy',
  warden: 'Warden',
  myra: 'Auctioneer',
  risen: 'Lord of the Risen',
  soren: 'Soren',
  rohan: 'Yirin',
  djinn: 'Djinni',
  nadja: 'Nadja',
  cassen: 'Cassen',
  drakko: 'Drakko',
  chaos: 'Chaos',
  robin: 'Robin',
  darah: 'Darah',
  gildmaster: 'Gildmaster',
  discodan: 'Disco Dan',
  brackus: 'Brackus',
  baggerben: 'Rascal',
  hermithank: 'Tradesman',
  fi: 'Fi',
  chronoshero: 'Chronos',
  runesmith: 'Runesmith',
  runeguard: 'Guardian',
  coran: 'Coran',
  tiff: 'Tiff',
  jenkins: 'Jensen',
  repete: 'Re-Pete',
  gorr: 'Gorr',
  kindness: 'Kindness',
  merrin: 'Merrin',
  gambler: 'Gambler',
  xerox: 'Xerox',
  frank: 'Frantic Frank',
  pete: 'Pete',
  flint: 'Foreman Flint',
  vale: 'Emissary',
  quillen: 'Quillen',
  hunch: 'Hunch',
  emeraldwarden: 'Emerald Warden',
  underdweller: 'Underdweller',
  albus: 'Albus',
  devourer: 'Devourer',
  flash: 'Flash',
  midas: 'Midas',
  juggler: 'Juggler',
  membrance: 'Membrance',
  bram: 'Braum',
  cia: 'Ayse',
  odelle: 'Odelle',
  harlan: 'Harlan',
  sable: 'Sable',
  keshi: 'Keshi the Protector',
  rayse: 'Rayse',
  aevor: 'Aevor',
  gorun: 'Gorun',
  cindara: 'Cindara',
  fibbsy: 'Fibbsy',
  mimic: 'Mimic',
  voidhero: 'Void',
  aster: 'Aster, the Guide',
};

export const THEMED_HEROES = Object.keys(COLOURS) as ThemedHero[];
/** Hero ids that deliberately wear the default: Priestess, Magician and Cindy are Duos only (their pairings are dev-only, R-ANCDUOS-01). */
export const DEFAULT_THEMED_HEROES: readonly string[] = ['priestess', 'magician', 'cindy'];

export const ANCIENT_HERO_THEMES = {
  // The owner-baked teal (2026-09-26): what any hero without an entry wears.
  default: DEFAULT_THEME,
  ...Object.fromEntries(THEMED_HEROES.map((h) => [h, { ...COLOURS[h], label: LABELS[h] }])),
} as { default: AncientHeroTheme } & Record<ThemedHero, AncientHeroTheme & { label: string }>;

export function isThemedHero(heroId: string | undefined): heroId is ThemedHero {
  return !!heroId && Object.prototype.hasOwnProperty.call(COLOURS, heroId);
}

/** The config key a themed hero's field is tuned under, e.g. `indyThemeCurtainInner`. The default theme lives under
 *  the plain field names (`curtainInner` …), which is where the owner's tuned values already sit. */
export type HeroThemeKey = `${ThemedHero}Theme${Capitalize<ThemeField>}`;
export function heroThemeKey(hero: ThemedHero, field: ThemeField): HeroThemeKey {
  return `${hero}Theme${field.charAt(0).toUpperCase()}${field.slice(1)}` as HeroThemeKey;
}

/** The baked theme colours as flat config defaults (the themed heroes only; the default's are the plain fields). */
export const HERO_THEME_DEFAULTS = Object.fromEntries(
  THEMED_HEROES.flatMap((h) => THEME_FIELDS.map((f) => [heroThemeKey(h, f), COLOURS[h][f]])),
) as Record<HeroThemeKey, string>;

/** The theme a hero's awakening wears, read from the (tunable) config: its own entry, else the default. */
export function resolveAncientHeroTheme(heroId: string | undefined, cfg: Record<string, unknown>): AncientHeroTheme {
  const pick = (key: string, fallback: string): string => (typeof cfg[key] === 'string' ? (cfg[key] as string) : fallback);
  const out = {} as AncientHeroTheme;
  if (isThemedHero(heroId)) {
    for (const f of THEME_FIELDS) out[f] = pick(heroThemeKey(heroId, f), COLOURS[heroId][f]);
  } else {
    for (const f of THEME_FIELDS) out[f] = pick(f, DEFAULT_THEME[f]);
  }
  return out;
}

const hexNum = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : 0xffffff;
};
/** The stardust palette (wipeFx motes) for a THEMED hero: its seam, title glow, curtain centre and white. `null` for
 *  an unthemed hero, which keeps the gate's baked violet/gold/teal motes (so the default look is unchanged). */
export function heroMotePalette(heroId: string | undefined, theme: AncientHeroTheme): number[] | null {
  if (!isThemedHero(heroId)) return null;
  return [hexNum(theme.seamColor), hexNum(theme.titleGlow), hexNum(theme.curtainInner), 0xffffff, hexNum(theme.titleGlow)];
}
