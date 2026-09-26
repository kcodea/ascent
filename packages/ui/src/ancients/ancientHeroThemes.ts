/**
 * PER-HERO AWAKENING THEMES (owner 2026-09-26: "customize every hero's ancient trigger animation slightly … have their
 * color associated … use the same transition style as the recruit -> combat -> recruit circle setup with the hero
 * power art in the center of it"; then "make a default one for now and also make 1 hero based on for indy just as a
 * test, who's should be goldish").
 *
 * The awakening's curtain blooms as a circle out of the hero power in the hero's colours, with the power's art as a
 * medallion in its middle. A theme is FIVE colours; a hero without an entry wears `default` (the look the owner baked
 * on 2026-09-26, so nothing regresses). Adding a hero = one entry here (+ its id in `THEMED_HEROES`); the tuner and
 * the config pick it up from this table.
 *
 * Pure data + a pure resolver, DOM-free, so it can be unit-tested.
 */
export interface AncientHeroTheme {
  /** The curtain gradient's centre. */
  curtainInner: string;
  /** The curtain gradient's edge. */
  curtainOuter: string;
  /** The energy ring riding the curtain's seam (and the medallion's rim). */
  seamColor: string;
  /** The title's glow. */
  titleGlow: string;
  /** The dark tint behind the cards once they are revealed. */
  backdropTint: string;
}
export const THEME_FIELDS = ['curtainInner', 'curtainOuter', 'seamColor', 'titleGlow', 'backdropTint'] as const;
export type ThemeField = (typeof THEME_FIELDS)[number];

/** Heroes with their own theme (every id here has an entry in `ANCIENT_HERO_THEMES`). */
export const THEMED_HEROES = ['indy'] as const;
export type ThemedHero = (typeof THEMED_HEROES)[number];

export const ANCIENT_HERO_THEMES: { default: AncientHeroTheme } & Record<ThemedHero, AncientHeroTheme> = {
  // The owner-baked teal (2026-09-26): what every hero without an entry wears.
  default: { curtainInner: '#247067', curtainOuter: '#0a0618', seamColor: '#fff1bd', titleGlow: '#9effd5', backdropTint: '#060d0f' },
  // Indy (Masterwork, the gild): warm gold at the centre falling to a deep bronze / umber edge, a gold title glow.
  indy: { curtainInner: '#c08a2c', curtainOuter: '#150a03', seamColor: '#fff0c4', titleGlow: '#ffc85a', backdropTint: '#100a04' },
};

/** The config key a themed hero's field is tuned under, e.g. `indyThemeCurtainInner`. The default theme lives under
 *  the plain field names (`curtainInner` …), which is where the owner's tuned values already sit. */
export type HeroThemeKey = `${ThemedHero}Theme${Capitalize<ThemeField>}`;
export function heroThemeKey(hero: ThemedHero, field: ThemeField): HeroThemeKey {
  return `${hero}Theme${field.charAt(0).toUpperCase()}${field.slice(1)}` as HeroThemeKey;
}

/** The baked theme colours as flat config defaults (the themed heroes only; the default's are the plain fields). */
export const HERO_THEME_DEFAULTS = Object.fromEntries(
  THEMED_HEROES.flatMap((h) => THEME_FIELDS.map((f) => [heroThemeKey(h, f), ANCIENT_HERO_THEMES[h][f]])),
) as Record<HeroThemeKey, string>;

export function isThemedHero(heroId: string | undefined): heroId is ThemedHero {
  return !!heroId && (THEMED_HEROES as readonly string[]).includes(heroId);
}

/** The theme a hero's awakening wears, read from the (tunable) config: its own entry, else the default. */
export function resolveAncientHeroTheme(heroId: string | undefined, cfg: Record<string, unknown>): AncientHeroTheme {
  const pick = (key: string, fallback: string): string => (typeof cfg[key] === 'string' ? (cfg[key] as string) : fallback);
  const out = {} as AncientHeroTheme;
  if (isThemedHero(heroId)) {
    for (const f of THEME_FIELDS) out[f] = pick(heroThemeKey(heroId, f), ANCIENT_HERO_THEMES[heroId][f]);
  } else {
    for (const f of THEME_FIELDS) out[f] = pick(f, ANCIENT_HERO_THEMES.default[f]);
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
