/**
 * PER-HERO AWAKENING THEMES (owner 2026-09-26: "customize every hero's ancient trigger animation slightly … have their
 * color associated … use the same transition style as the recruit -> combat -> recruit circle setup with the hero
 * power art in the center of it"; then "build all 9 styles on a branch and tell me which heroes have each").
 *
 * The awakening's curtain blooms as a circle out of the hero power in the hero's colours, with the power's art as a
 * medallion in its middle. A theme is FIVE colours plus a SIGNATURE: one of the reusable bloom STYLES (a clean accent
 * round the medallion + the medallion's own entrance, see `ancientHeroBloom.ts`) and a couple of optional knobs. A
 * hero without an entry wears `default` (the look the owner baked on 2026-09-26: the generic entrance, no accent).
 *
 * Owner direction for the styles: "they do not all need to be crazy specific, can be generic if there isnt a fantastic
 * fit. id prefer clean animation than generic bubbly mobile looking iphone effects." So: thin lines, crisp sheens,
 * restrained rings, soft motion. No bounce, no confetti, no bubbles.
 *
 * Pure data + pure resolvers, DOM-free, so it can be unit-tested.
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

/** The nine reusable styles (A to I) and the three one-off accents. */
export const BLOOM_STYLES = [
  'coinStrike', //  A: a crisp diagonal sheen across the medallion, a thin rim flash, a few sharp glints (Indy's)
  'cardFan', //     B: one to three thin card OUTLINES fan out behind the medallion and fade
  'strikeRings', // C: thin shock rings pulse out (the Auctioneer's)
  'spiritRise', //  D: thin rising wisps + a soft Rise halo (Lord of the Risen's)
  'clockDial', //   E: a thin dial ring with tick marks turns one notch and clicks
  'glassShell', //  F: a clear shell forms round the medallion and catches one shine (the Warden's)
  'runeEtch', //    G: a thin ring of rune glyphs draws itself round the medallion
  'echoCopy', //    H: a faint copy of the medallion slides out and merges back
  'swapArcs', //    I: two thin arcs trade places round the medallion
  'collapse', //    one-off (under C): a thin ring collapses inward onto the medallion
  'vines', //       one-off (under G): thin vine lines draw themselves round the rim
  'starGlint', //   one-off (under A): one clean four-point glint
] as const;
export type BloomStyle = (typeof BLOOM_STYLES)[number];
/** The owner-facing letter / name of each style (the one-offs sit under the closest style). */
export const STYLE_FAMILY: Record<BloomStyle, string> = {
  coinStrike: 'A Coin strike', cardFan: 'B Card fan', strikeRings: 'C Strike rings', spiritRise: 'D Spirit rise',
  clockDial: 'E Clock dial', glassShell: 'F Glass shell', runeEtch: 'G Rune etch', echoCopy: 'H Echo copy',
  swapArcs: 'I Swap arcs', collapse: 'C+ Collapse (one-off)', vines: 'G+ Vines (one-off)', starGlint: 'A+ Star glint (one-off)',
};
export function isBloomStyle(s: unknown): s is BloomStyle {
  return typeof s === 'string' && (BLOOM_STYLES as readonly string[]).includes(s);
}

/** The medallion's entrance. `settle` is the clean default (a fade and a soft scale settle); the other four are the
 *  approved bespoke entrances of Indy (`gild`), the Warden (`seal`), the Auctioneer (`thump`) and Risen (`rise`). */
export type MedalEntrance = 'settle' | 'gild' | 'seal' | 'thump' | 'rise';

/** A style's optional knobs. Every knob is optional; a style with none plays its plain form. */
export interface BloomKnobs {
  /** Keep the approved, hard-coded paint (Indy's gold, the Warden's ward glass, Risen's Rise aqua) instead of the
   *  theme-tinted version every other hero on that style wears. */
  baked?: boolean;
  /** Override the style's medallion entrance (only the approved four do). */
  medal?: MedalEntrance;
  /** A: sheens (1 or 2). B: cards (1 to 3). C: rings (1 to 3). H: echoes (1 to 3). */
  count?: 1 | 2 | 3;
  /** A: `coinRise` a thin coin rising, `coinArcs` three coins arcing over, `gem` one gem glint, `tagSlash` a thin
   *  price-tag slash. C: `anvil` a few straight sparks off the ring, `blade` a thin blade glint across. F: `crown` a
   *  small crown settling on the shell. */
  extra?: 'coinRise' | 'coinArcs' | 'gem' | 'tagSlash' | 'anvil' | 'blade' | 'crown';
  /** Any style but A (which has its own): one crisp sheen crosses the medallion once it lands. */
  sheen?: boolean;
  /** B: the card is tall. */
  tall?: boolean;
  /** C: `shout` (the Auctioneer's three fading pulses), `drum` (even drumbeats), `blast` (one sharp blast). */
  rhythm?: 'shout' | 'drum' | 'blast';
  /** C: the rings are thin and jagged, like lightning. */
  jagged?: boolean;
  /** D: small warm points rise instead of wisps. */
  embers?: boolean;
  /** E: the dial lands on a pip (a single dot flashes). */
  pip?: boolean;
  /** F: mirror silver instead of tinted glass. */
  mirror?: boolean;
  /** G: a second, counter-turning ring. */
  double?: boolean;
  /** G: the glyphs flicker in. */
  flicker?: boolean;
  /** G: a line of script over the top of the rim instead of a full ring. */
  script?: boolean;
  /** H: a motion streak instead of a soft offset. */
  streak?: boolean;
  /** H: a hard, instant offset (a photocopy). */
  crisp?: boolean;
  /** H: quick echoes. */
  quick?: boolean;
  /** I: three points instead of two arcs. */
  three?: boolean;
  /** I: a thin tether between the arcs. */
  tether?: boolean;
}
export interface AncientHeroSignature {
  /** How the tuner names the hero (its display name). */
  label: string;
  style: BloomStyle;
  knobs: BloomKnobs;
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

/** Every hero's signature: its display name, style and knobs (owner mapping 2026-09-26). */
const SIGNATURES: Record<ThemedHero, AncientHeroSignature> = {
  // The approved four (owner 2026-09-26: "auctioneer and lord are great", Indy redone, the Warden reworked). Their
  // look is frozen: baked paint + their own medallion entrance.
  indy: { label: 'Indy', style: 'coinStrike', knobs: { baked: true } },
  warden: { label: 'Warden', style: 'glassShell', knobs: { baked: true, medal: 'seal' } },
  myra: { label: 'Auctioneer', style: 'strikeRings', knobs: { medal: 'thump', rhythm: 'shout', count: 3 } },
  risen: { label: 'Lord of the Risen', style: 'spiritRise', knobs: { baked: true } },
  soren: { label: 'Soren', style: 'spiritRise', knobs: {} },
  rohan: { label: 'Yirin', style: 'glassShell', knobs: { mirror: true } },
  djinn: { label: 'Djinni', style: 'clockDial', knobs: {} },
  nadja: { label: 'Nadja', style: 'coinStrike', knobs: { extra: 'coinRise' } },
  cassen: { label: 'Cassen', style: 'clockDial', knobs: {} },
  drakko: { label: 'Drakko', style: 'strikeRings', knobs: { rhythm: 'drum', count: 3 } },
  chaos: { label: 'Chaos', style: 'runeEtch', knobs: { flicker: true } },
  robin: { label: 'Robin', style: 'coinStrike', knobs: {} },
  darah: { label: 'Darah', style: 'swapArcs', knobs: {} },
  // "the medallion splits into a pair": two gold copies part left and right and merge back, then a sheen.
  gildmaster: { label: 'Gildmaster', style: 'echoCopy', knobs: { count: 2, sheen: true } },
  discodan: { label: 'Disco Dan', style: 'cardFan', knobs: { count: 3 } },
  brackus: { label: 'Brackus', style: 'cardFan', knobs: { count: 1, tall: true } },
  baggerben: { label: 'Rascal', style: 'coinStrike', knobs: {} },
  hermithank: { label: 'Tradesman', style: 'coinStrike', knobs: {} },
  fi: { label: 'Fi', style: 'cardFan', knobs: { count: 2 } },
  chronoshero: { label: 'Chronos', style: 'clockDial', knobs: {} },
  runesmith: { label: 'Runesmith', style: 'runeEtch', knobs: {} },
  runeguard: { label: 'Guardian', style: 'runeEtch', knobs: { double: true } },
  coran: { label: 'Coran', style: 'cardFan', knobs: { count: 2 } },
  tiff: { label: 'Tiff', style: 'cardFan', knobs: { count: 3, sheen: true } },
  jenkins: { label: 'Jensen', style: 'strikeRings', knobs: { rhythm: 'blast', count: 1 } },
  repete: { label: 'Re-Pete', style: 'echoCopy', knobs: { count: 2 } },
  gorr: { label: 'Gorr', style: 'echoCopy', knobs: { count: 3, quick: true } },
  kindness: { label: 'Kindness', style: 'cardFan', knobs: { count: 1 } },
  merrin: { label: 'Merrin', style: 'cardFan', knobs: { count: 3 } },
  gambler: { label: 'Gambler', style: 'clockDial', knobs: { pip: true } },
  xerox: { label: 'Xerox', style: 'echoCopy', knobs: { count: 1, crisp: true } },
  frank: { label: 'Frantic Frank', style: 'coinStrike', knobs: { extra: 'tagSlash' } },
  pete: { label: 'Pete', style: 'clockDial', knobs: {} },
  flint: { label: 'Foreman Flint', style: 'strikeRings', knobs: { rhythm: 'blast', count: 1, extra: 'anvil' } },
  vale: { label: 'Emissary', style: 'swapArcs', knobs: {} },
  quillen: { label: 'Quillen', style: 'runeEtch', knobs: { script: true } },
  hunch: { label: 'Hunch', style: 'echoCopy', knobs: { count: 1 } },
  emeraldwarden: { label: 'Emerald Warden', style: 'glassShell', knobs: {} },
  underdweller: { label: 'Underdweller', style: 'spiritRise', knobs: {} },
  albus: { label: 'Albus', style: 'cardFan', knobs: { count: 3 } },
  devourer: { label: 'Devourer', style: 'collapse', knobs: {} },
  flash: { label: 'Flash', style: 'echoCopy', knobs: { count: 1, streak: true } },
  midas: { label: 'Midas', style: 'coinStrike', knobs: { count: 2 } },
  juggler: { label: 'Juggler', style: 'coinStrike', knobs: { extra: 'coinArcs' } },
  membrance: { label: 'Membrance', style: 'echoCopy', knobs: { count: 1 } },
  bram: { label: 'Braum', style: 'coinStrike', knobs: {} },
  cia: { label: 'Ayse', style: 'cardFan', knobs: { count: 2 } },
  odelle: { label: 'Odelle', style: 'swapArcs', knobs: { three: true } },
  harlan: { label: 'Harlan', style: 'coinStrike', knobs: {} },
  sable: { label: 'Sable', style: 'swapArcs', knobs: { tether: true } },
  keshi: { label: 'Keshi the Protector', style: 'glassShell', knobs: { extra: 'crown' } },
  rayse: { label: 'Rayse', style: 'vines', knobs: {} },
  aevor: { label: 'Aevor', style: 'strikeRings', knobs: { rhythm: 'drum', count: 2, jagged: true } },
  gorun: { label: 'Gorun', style: 'strikeRings', knobs: { rhythm: 'drum', count: 2, extra: 'blade' } },
  cindara: { label: 'Cindara', style: 'spiritRise', knobs: { embers: true } },
  fibbsy: { label: 'Fibbsy', style: 'coinStrike', knobs: { extra: 'gem' } },
  mimic: { label: 'Mimic', style: 'echoCopy', knobs: { count: 2 } },
  voidhero: { label: 'Void', style: 'collapse', knobs: {} },
  aster: { label: 'Aster, the Guide', style: 'starGlint', knobs: {} },
};

export const THEMED_HEROES = Object.keys(COLOURS) as ThemedHero[];
/** Hero ids that deliberately wear the default (none today: every hero has a theme). */
export const DEFAULT_THEMED_HEROES: readonly string[] = [];

export const ANCIENT_HERO_THEMES = {
  // The owner-baked teal (2026-09-26): what any hero without an entry wears.
  default: DEFAULT_THEME,
  ...Object.fromEntries(THEMED_HEROES.map((h) => [h, { ...COLOURS[h], ...SIGNATURES[h] }])),
} as { default: AncientHeroTheme } & Record<ThemedHero, AncientHeroTheme & AncientHeroSignature>;

export function isThemedHero(heroId: string | undefined): heroId is ThemedHero {
  return !!heroId && Object.prototype.hasOwnProperty.call(COLOURS, heroId);
}

/** A hero's awakening signature, or `null` for the default (the generic entrance, no accent). `style` previews another
 *  style on the hero (the tuner's override): the hero keeps its colours, and its own knobs only if the style matches. */
export function resolveAncientHeroSignature(heroId: string | undefined, style?: BloomStyle): AncientHeroSignature | null {
  if (!isThemedHero(heroId)) return style ? { label: 'Default', style, knobs: {} } : null;
  const s = SIGNATURES[heroId];
  if (style && style !== s.style) return { label: s.label, style, knobs: {} };
  return { label: s.label, style: s.style, knobs: { ...s.knobs } };
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
