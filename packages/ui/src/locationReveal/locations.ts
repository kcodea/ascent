/**
 * THE LOCATIONS (owner 2026-11-24: "instead of Set 2 it would now be The Outskirts"): a location IS a set, and this is
 * what the reveal and hero select show for it. The player-facing NAME lives with the set (`SetDef.location`, content).
 * The art is the owner's, at `apps/web/public/locations/<id>/`: fetched only when a game at that location starts.
 */
import type { Tribe } from '@game/core';
import { SETS, type SetId } from '@game/content';

/** A place a set is played at. */
export type SetLocationId = 'outskirts' | 'underbelly' | 'scrapyard' | 'runebarriers';
/** Every place the reveal can travel to: a set's, or Terys Gate (where every game's journey ends, `TERYS_GATE`). */
export type LocationId = SetLocationId | 'terys';
/** What hangs on a parchment: a tribe, or one a location is promised and no set has yet (owner 2026-11-25: "Add guardians to the rune barriers"). */
export type Poster = Tribe | 'guardian';
export const isTribePoster = (p: Poster): p is Tribe => p !== 'guardian';
/** The colour of one that has no tribe token (CSS: `--t-guardian`, locationReveal.css). */
export const GUARDIAN_COLOR = '#54c4ff';
export type Rgb = readonly [number, number, number];

export interface LocationDef {
  id: LocationId;
  /** The set played here. None: a place no game is played at (Terys Gate). */
  setId?: SetId;
  /** Its name, for a place with no set (a set's location is named on the set). */
  name?: string;
  /** Where the crystal lands, as a fraction of the painting (x right, y down). Everything radiates from it. */
  vp: readonly [number, number];
  /** What a window that crops the 21:9 painting is centred on (x right, y down): 16:9 shows three quarters of its width. */
  focus: readonly [number, number];
  /** The magic's colours: the deep of the travel, its second hue, and (absent = the crystal's own ice blue and gold) the
   *  hue every cool and warm light is turned to. */
  deep: Rgb;
  second: Rgb;
  cool?: Rgb;
  warm?: Rgb;
  /** How many of the drifting motes are warm (0..1). */
  warmth: number;
  /** Every lantern, crystal and fall in the painting: x, y, size, depth, r, g, b. Each wakes as the wave reaches it. */
  lights: readonly (readonly number[])[];
  /** The order the parchments hang in (left to right); a game shows the ones it plays with. */
  posters: readonly Poster[];
  /** RIGID PIECES (the Rune Barriers): the first piece is a plane receding across the picture, its depth linear in x (`depth` at `vp`,
   *  `slope` a painting's width), and the ground behind never bends. Absent = the ground bends by the depth map. */
  row?: { depth: number; slope: number };
  /** What hovers in its sky: x, y, half width, half height (up to four). */
  floats?: readonly (readonly number[])[];
  /** A barrier of light (data.webp's blue): the heart of each, its pulses run out from (up to four). */
  energy?: readonly (readonly number[])[];
  /** The announcer's line as the name appears. */
  line: string;
  /** A journey's arrival swell (Terys Gate), played as its name rises; the gain is measured (-9.3 LUFS against the name sting's -13.6). */
  arrival?: { clip: string; gain: number };
  /** How loud its own clips sit in the mix. `line` brings every announcer line to the same measured loudness (R-LOCATION-12). */
  mix: { ride: number; ambience: number; line: number };
}

const WARM = [1, 0.7, 0.34] as const;
const VIOLET = [0.72, 0.4, 1] as const;
const CYAN = [0.42, 0.88, 1] as const;
const TEAL = [0.5, 1, 0.74] as const;
const AZURE = [0.4, 0.66, 1] as const;
const FORGE = [1, 0.55, 0.18] as const;

export const LOCATIONS: Readonly<Record<SetLocationId, LocationDef & { setId: SetId }>> = {
  outskirts: {
    id: 'outskirts',
    setId: 'set2',
    vp: [0.54, 0.34],
    focus: [0.49, 0.45],
    deep: [0.008, 0.04, 0.115],
    second: [0.1, 0.95, 0.85],
    warmth: 0.1,
    posters: ['dragon', 'beast', 'kobold', 'dwarf', 'demon'],
    line: 'Welcome to the Outskirts.',
    mix: { ride: 0.85, ambience: 1.9, line: 1 },
    lights: [
      [0.325, 0.51, 1.7, 0.13, ...WARM], [0.685, 0.475, 1.2, 0.13, ...WARM], [0.636, 0.62, 0.7, 0.13, ...WARM], [0.667, 0.54, 1.2, 0.13, 1, 0.32, 0.52],
      [0.529, 0.19, 0.8, 0, ...VIOLET], [0.634, 0.165, 1.1, 0, ...CYAN], [0.66, 0.035, 1.2, 0, ...CYAN], [0.523, 0.27, 0.5, 0, ...CYAN], [0.668, 0.21, 0.5, 0, ...CYAN],
      [0.606, 0.22, 0.4, 0, ...CYAN], [0.871, 0.31, 0.6, 0, ...CYAN],
    ],
  },
  underbelly: {
    id: 'underbelly',
    setId: 'set3',
    vp: [0.605, 0.3],
    focus: [0.56, 0.45],
    deep: [0.05, 0.018, 0.1],
    second: [0.1, 0.95, 0.62],
    cool: [0.6, 0.38, 1],
    warm: [1, 0.56, 0.22],
    warmth: 0.6,
    posters: ['undead', 'kobold', 'dragon', 'dwarf', 'spirit'],
    line: 'The Underbelly awaits.',
    mix: { ride: 0.72, ambience: 0.75, line: 0.88 },
    lights: [
      [0.48, 0.14, 1.5, 0.13, ...WARM], [0.354, 0.385, 1.6, 0.13, ...WARM], [0.365, 0.5, 1.9, 0.13, ...WARM], [0.065, 0.31, 0.9, 0.04, ...WARM], [0.13, 0.605, 1.1, 0.13, ...WARM],
      [0.197, 0.36, 0.7, 0.13, ...WARM], [0.229, 0.345, 0.7, 0.13, ...WARM], [0.175, 0.64, 0.7, 0.06, ...WARM], [0.481, 0.325, 0.7, 0, ...WARM], [0.526, 0.37, 0.8, 0, ...WARM],
      [0.451, 0.57, 0.8, 0.075, ...WARM], [0.475, 0.585, 0.8, 0.075, ...WARM], [0.54, 0.58, 0.6, 0.02, ...WARM], [0.666, 0.625, 0.6, 0.075, ...WARM],
      [0.69, 0.585, 0.7, 0.075, ...WARM], [0.69, 0.675, 0.8, 0.075, ...WARM], [0.678, 0.785, 0.9, 0.11, ...WARM], [0.648, 0.175, 0.6, 0, ...WARM], [0.757, 0.235, 0.6, 0.075, ...WARM],
      [0.735, 0.235, 0.6, 0.02, ...WARM], [0.765, 0.38, 0.7, 0.075, ...WARM], [0.75, 0.375, 0.6, 0.075, ...WARM], [0.81, 0.38, 0.5, 0.03, ...WARM], [0.88, 0.31, 0.8, 0.02, ...WARM],
      [0.945, 0.06, 0.6, 0.03, ...WARM], [0.955, 0.33, 0.8, 0.03, ...WARM], [0.98, 0.325, 0.6, 0.03, ...WARM], [0.95, 0.43, 0.8, 0.03, ...WARM], [0.978, 0.63, 1.1, 0.05, ...WARM],
      [0.835, 0.64, 0.5, 0.03, ...WARM], [0.075, 0.08, 1.2, 0, ...VIOLET], [0.53, 0.065, 1.3, 0, ...VIOLET], [0.475, 0.45, 1, 0.075, ...VIOLET], [0.682, 0.24, 0.9, 0.075, ...VIOLET],
      [0.76, 0.06, 1.1, 0, ...VIOLET], [0.24, 0.55, 1.5, 0.13, ...VIOLET], [0.1, 0.36, 0.7, 0.03, ...VIOLET], [0.79, 0.64, 0.7, 0.03, ...VIOLET], [0.03, 0.38, 1.3, 0.05, ...CYAN],
      [0.245, 0.74, 1.1, 0.13, ...CYAN], [0.605, 0.06, 1.5, 0, ...CYAN], [0.6, 0.28, 1.1, 0, ...CYAN], [0.86, 0.25, 1.1, 0, ...CYAN], [0.865, 0.64, 1.2, 0.03, ...CYAN],
      [0.648, 0.57, 1.3, 0.075, ...TEAL], [0.525, 0.6, 0.9, 0.075, ...TEAL], [0.448, 0.87, 0.9, 0.13, ...TEAL],
    ],
  },
  scrapyard: {
    id: 'scrapyard',
    setId: 'set1',
    vp: [0.5, 0.37],
    focus: [0.5, 0.45],
    deep: [0.075, 0.03, 0.022],
    second: [0.72, 0.36, 1],
    cool: [1, 0.6, 0.26],
    warm: [0.74, 0.44, 1],
    warmth: 0.75,
    posters: ['mech', 'beast', 'dragon', 'demon', 'undead'],
    line: 'Ahh... the Scrapyards.',
    mix: { ride: 0.85, ambience: 1.7, line: 1.4 },
    lights: [
      [0.78, 0.607, 2.6, 0.075, ...FORGE], [0.803, 0.56, 1.6, 0.075, ...FORGE], [0.818, 0.508, 1, 0.075, ...WARM], [0.6126, 0.595, 0.8, 0.075, ...WARM], [0.872, 0.155, 0.9, 0.075, ...FORGE], [0.81, 0.443, 0.6, 0.075, ...FORGE],
      [0.386, 0.49, 1.1, 0.05, ...WARM], [0.33, 0.521, 0.7, 0.05, ...WARM], [0.601, 0.28, 0.7, 0.028, ...WARM], [0.632, 0.277, 0.6, 0.028, ...WARM], [0.609, 0.917, 0.6, 0.15, ...WARM],
      [0.23, 0.775, 1.8, 0.25, ...VIOLET], [0.379, 0.93, 0.9, 0.15, ...VIOLET], [0.38, 0.571, 0.9, 0.05, ...VIOLET], [0.486, 0.649, 0.7, 0.03, ...VIOLET], [0.461, 0.569, 0.5, 0.03, ...VIOLET], [0.559, 0.464, 0.6, 0.03, ...VIOLET],
      [0.701, 0.697, 1, 0.075, ...VIOLET], [0.563, 0.718, 0.5, 0.06, ...VIOLET], [0.646, 0.84, 0.9, 0.11, ...VIOLET], [0.6556, 0.21, 0.8, 0.01, ...CYAN], [0.423, 0.41, 0.6, 0, ...CYAN], [0.939, 0.2, 1, 0, ...CYAN],
    ],
  },
  runebarriers: {
    id: 'runebarriers',
    setId: 'set4',
    vp: [0.478, 0.36],
    focus: [0.51, 0.45],
    deep: [0.02, 0.03, 0.13],
    second: [0.62, 0.4, 1],
    cool: [0.45, 0.64, 1],
    warm: [0.78, 0.5, 1],
    warmth: 0.3,
    posters: ['celestial', 'guardian', 'beast'],
    row: { depth: 0.085, slope: -0.2 },
    floats: [[0.205, 0.1, 0.06, 0.16], [0.593, 0.125, 0.07, 0.15], [0.858, 0.16, 0.04, 0.07], [0.897, 0.215, 0.032, 0.07]],
    energy: [[0.4785, 0.433], [0.6445, 0.5], [0.717, 0.56], [0.768, 0.6]],
    line: 'The great Rune Barriers.',
    mix: { ride: 0.5, ambience: 1.4, line: 0.84 },
    lights: [
      [0.479, 0.43, 3.4, 0.085, ...AZURE], [0.48, 0.33, 2, 0.085, ...CYAN], [0.457, 0.55, 1.6, 0.089, ...AZURE], [0.5, 0.57, 1.4, 0.081, ...CYAN], [0.5025, 0.054, 1.5, 0.08, ...VIOLET], [0.392, 0.232, 1.2, 0.102, ...CYAN], [0.417, 0.41, 0.8, 0.097, ...CYAN],
      [0.366, 0.187, 0.4, 0.107, ...VIOLET], [0.375, 0.312, 0.4, 0.106, ...CYAN], [0.645, 0.5, 1.8, 0.052, ...AZURE], [0.6556, 0.271, 0.9, 0.049, ...VIOLET], [0.602, 0.405, 0.8, 0.06, ...CYAN], [0.62, 0.53, 0.6, 0.057, ...CYAN],
      [0.717, 0.56, 1.2, 0.037, ...AZURE], [0.726, 0.417, 0.5, 0.035, ...VIOLET], [0.697, 0.52, 0.5, 0.041, ...CYAN], [0.768, 0.59, 0.8, 0.027, ...AZURE], [0.8, 0.595, 0.6, 0.021, ...AZURE],
      [0.292, 0.345, 1.1, 0.13, ...VIOLET], [0.439, 0.514, 1.1, 0.13, ...VIOLET], [0.101, 0.685, 1.7, 0.13, ...VIOLET], [0.174, 0.863, 1.1, 0.13, ...VIOLET], [0.576, 0.649, 0.9, 0.13, ...VIOLET], [0.5, 0.667, 0.6, 0.13, ...VIOLET],
      [0.77, 0.917, 1.2, 0.25, ...VIOLET], [0.323, 0.857, 0.8, 0.25, ...VIOLET], [0.785, 0.75, 0.5, 0.024, ...CYAN], [0.817, 0.744, 0.45, 0.017, ...CYAN], [0.769, 0.22, 0.7, 0, ...CYAN], [0.768, 0.36, 0.7, 0, ...CYAN], [0.944, 0.42, 1.2, 0, ...CYAN], [0.967, 0.18, 0.7, 0, ...CYAN],
    ],
  },
};

/**
 * TERYS GATE (owner 2026-11-27: "use this for the returning art", first called the Portal of Kings, then "Rename it to Terys Gate"): where the journey at
 * the end of every game travels to, and where the post-game screen stands (postGame.tsx). No game is played here, so it has no set,
 * no parchments and no announcer line. One rigid piece for now (no background was painted for a cut parallax): its own idea is the
 * light in the portal and its ring of runes, pulsing out from its heart (`energy`).
 */
export const TERYS_GATE: LocationDef = {
  id: 'terys',
  name: 'Terys Gate',
  arrival: { clip: 'arrive-terys', gain: 0.38 },
  vp: [0.595, 0.365],
  focus: [0.57, 0.45],
  deep: [0.02, 0.035, 0.12],
  second: [1, 0.82, 0.45],
  warmth: 0.45,
  posters: [],
  energy: [[0.595, 0.365]],
  line: '',
  // Measured (loudness.mjs): the ride -10.7 LUFS and the ambience -25.4, brought level with the other places' as heard.
  mix: { ride: 0.78, ambience: 1.5, line: 1 },
  lights: [
    [0.595, 0.36, 3.4, 0.1, ...CYAN], [0.615, 0.35, 1.4, 0.1, 1, 0.95, 0.8], [0.586, 0.175, 1.3, 0.1, ...WARM], [0.498, 0.369, 1.1, 0.1, ...WARM], [0.676, 0.35, 1.1, 0.1, ...WARM],
    [0.567, 0.163, 0.6, 0.1, ...CYAN], [0.615, 0.15, 0.6, 0.1, ...CYAN], [0.663, 0.225, 0.6, 0.1, ...CYAN], [0.676, 0.4, 0.6, 0.1, ...CYAN], [0.663, 0.4875, 0.6, 0.1, ...CYAN],
    [0.512, 0.4375, 0.6, 0.1, ...CYAN], [0.512, 0.3125, 0.6, 0.1, ...CYAN], [0.536, 0.2, 0.6, 0.1, ...CYAN], [0.252, 0.164, 1.2, 0.1, 1, 0.93, 0.78], [0.606, 0.83, 1.3, 0.1, ...WARM],
    [0.068, 0.55, 0.8, 0.1, ...AZURE], [0.127, 0.62, 0.8, 0.1, ...AZURE],
    // the rune ring, glyph by glyph: the landing wave lights it round (owner 2026-11-27: "more exciting")
    [0.5949, 0.1575, 0.55, 0.1, ...CYAN], [0.6250, 0.1700, 0.55, 0.1, ...CYAN], [0.6515, 0.2060, 0.55, 0.1, ...CYAN], [0.6711, 0.2612, 0.55, 0.1, ...CYAN], [0.6816, 0.3290, 0.55, 0.1, ...CYAN], [0.6816, 0.4010, 0.55, 0.1, ...CYAN], [0.6711, 0.4688, 0.55, 0.1, ...CYAN], [0.6515, 0.5240, 0.55, 0.1, ...CYAN], [0.5383, 0.5240, 0.55, 0.1, ...CYAN], [0.5187, 0.4688, 0.55, 0.1, ...CYAN], [0.5082, 0.4010, 0.55, 0.1, ...CYAN], [0.5082, 0.3290, 0.55, 0.1, ...CYAN], [0.5187, 0.2613, 0.55, 0.1, ...CYAN], [0.5383, 0.2060, 0.55, 0.1, ...CYAN], [0.5648, 0.1700, 0.55, 0.1, ...CYAN],
  ],
};

/** How a game ended, for its colours: 1st, 2nd to 4th, 5th to 8th. */
export type ResultBand = 'won' | 'top4' | 'lost';
export const resultBand = (placement: number): ResultBand => (placement <= 1 ? 'won' : placement <= 4 ? 'top4' : 'lost');

/**
 * TERYS GATE IN THE RESULT'S COLOURS (owner 2026-11-27: "The portal effect should be different colors for a bottom 4, top 4 and a
 * victory. (Red/green/gold variations)"): the journey's magic (its deep, its second hue, and every cool and warm light turned to them)
 * in gold for a win, green for the top four, red for the rest. Same painting, same files; one def each, so they are told apart by
 * identity (the warm reveal and the atmosphere compare the def, not its id).
 */
export const TERYS_GATE_BY_RESULT: Readonly<Record<ResultBand, LocationDef>> = {
  won: { ...TERYS_GATE, deep: [0.1, 0.065, 0.012], second: [1, 0.82, 0.32], cool: [1, 0.84, 0.42], warm: [1, 0.7, 0.28], warmth: 0.85 },
  top4: { ...TERYS_GATE, deep: [0.012, 0.075, 0.04], second: [0.45, 1, 0.55], cool: [0.42, 1, 0.62], warm: [0.82, 1, 0.5], warmth: 0.35 },
  lost: { ...TERYS_GATE, deep: [0.1, 0.012, 0.018], second: [1, 0.32, 0.26], cool: [1, 0.36, 0.32], warm: [1, 0.55, 0.3], warmth: 0.6 },
};

/** Any place by its id. */
export const locationById = (id: LocationId): LocationDef => (id === 'terys' ? TERYS_GATE : LOCATIONS[id]);

/** The location a set is played at, or null for a set that has none yet (the gate then opens as before). */
export function locationOfSet(setId: SetId): LocationDef | null {
  return Object.values(LOCATIONS).find((l) => l.setId === setId) ?? null;
}

/** Up to four points or boxes as the shaders take them: four vec4s. */
export function fourOf(v: readonly (readonly number[])[] | undefined): Float32Array {
  const o = new Float32Array(16);
  v?.slice(0, 4).forEach((q, i) => o.set(q.slice(0, 4), i * 4));
  // Fewer than four hearts: the last again, so none is ever nearest from the corner.
  for (let i = v?.length ?? 4; i < 4 && v?.[0]?.length === 2; i++) o.set(v[v.length - 1]!, i * 4);
  return o;
}

/** Its name, as players read it. */
export const locationName = (l: LocationDef): string => l.name ?? (l.setId ? SETS[l.setId].location ?? SETS[l.setId].name : '');

/** A file of the location's own art (BASE_URL-relative: itch serves the game from a sub-path). */
export const locationArt = (id: LocationId, file: string): string => `${import.meta.env.BASE_URL}locations/${id}/${file}.webp`;
export const locationSound = (file: string): string => `${import.meta.env.BASE_URL}locations/sfx/${file}.mp3`;

/** What the parchments are called. */
export const POSTER_NAME: Readonly<Partial<Record<Poster, string>>> = {
  dragon: 'Dragons', beast: 'Beasts', kobold: 'Kobolds', dwarf: 'Dwarves', demon: 'Demons', undead: 'Undead', spirit: 'Spirits', mech: 'Mechs', celestial: 'Celestials', guardian: 'Guardians',
};

/** The parchments a game shows: the location's, in its order, for the tribes this game plays with (and any no set has yet). */
export function postersFor(l: LocationDef, tribes: readonly Tribe[]): Poster[] {
  return l.posters.filter((t) => !isTribePoster(t) || tribes.includes(t));
}
