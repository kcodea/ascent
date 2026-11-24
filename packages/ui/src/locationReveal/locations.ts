/**
 * THE LOCATIONS (owner 2026-11-24: "instead of Set 2 it would now be The Outskirts"): a location IS a set, and this is
 * what the reveal and hero select show for it. The player-facing NAME lives with the set (`SetDef.location`, content).
 * The art is the owner's, at `apps/web/public/locations/<id>/`: fetched only when a game at that location starts.
 */
import type { Tribe } from '@game/core';
import { SETS, type SetId } from '@game/content';

export type LocationId = 'outskirts' | 'underbelly';
export type Rgb = readonly [number, number, number];

export interface LocationDef {
  id: LocationId;
  setId: SetId;
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
  posters: readonly Tribe[];
  /** The announcer's line as the name appears. */
  line: string;
}

const WARM = [1, 0.7, 0.34] as const;
const VIOLET = [0.72, 0.4, 1] as const;
const CYAN = [0.42, 0.88, 1] as const;
const TEAL = [0.5, 1, 0.74] as const;

export const LOCATIONS: Readonly<Record<LocationId, LocationDef>> = {
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
    lights: [
      [0.325, 0.51, 1.7, 0.15, ...WARM], [0.685, 0.475, 1.2, 0.15, ...WARM], [0.636, 0.62, 0.7, 0.15, ...WARM], [0.667, 0.54, 1.2, 0.15, 1, 0.32, 0.52],
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
    lights: [
      [0.48, 0.14, 1.5, 0.15, ...WARM], [0.354, 0.385, 1.6, 0.15, ...WARM], [0.365, 0.5, 1.9, 0.15, ...WARM], [0.065, 0.31, 0.9, 0.04, ...WARM], [0.13, 0.605, 1.1, 0.15, ...WARM],
      [0.197, 0.36, 0.7, 0.15, ...WARM], [0.229, 0.345, 0.7, 0.15, ...WARM], [0.175, 0.64, 0.7, 0.06, ...WARM], [0.481, 0.325, 0.7, 0, ...WARM], [0.526, 0.37, 0.8, 0, ...WARM],
      [0.451, 0.57, 0.8, 0.075, ...WARM], [0.475, 0.585, 0.8, 0.075, ...WARM], [0.54, 0.58, 0.6, 0.02, ...WARM], [0.592, 0.61, 0.5, 0.02, ...WARM], [0.666, 0.625, 0.6, 0.02, ...WARM],
      [0.69, 0.585, 0.7, 0.075, ...WARM], [0.69, 0.675, 0.8, 0.075, ...WARM], [0.678, 0.785, 0.9, 0.11, ...WARM], [0.648, 0.175, 0.6, 0, ...WARM], [0.757, 0.235, 0.6, 0.075, ...WARM],
      [0.735, 0.235, 0.6, 0.02, ...WARM], [0.765, 0.38, 0.7, 0.075, ...WARM], [0.75, 0.375, 0.6, 0.075, ...WARM], [0.81, 0.38, 0.5, 0.03, ...WARM], [0.88, 0.31, 0.8, 0.02, ...WARM],
      [0.945, 0.06, 0.6, 0.03, ...WARM], [0.955, 0.33, 0.8, 0.03, ...WARM], [0.98, 0.325, 0.6, 0.03, ...WARM], [0.95, 0.43, 0.8, 0.03, ...WARM], [0.978, 0.63, 1.1, 0.05, ...WARM],
      [0.835, 0.64, 0.5, 0.03, ...WARM], [0.075, 0.08, 1.2, 0, ...VIOLET], [0.53, 0.065, 1.3, 0, ...VIOLET], [0.475, 0.45, 1, 0.075, ...VIOLET], [0.682, 0.24, 0.9, 0.075, ...VIOLET],
      [0.76, 0.06, 1.1, 0, ...VIOLET], [0.24, 0.55, 1.5, 0.15, ...VIOLET], [0.1, 0.36, 0.7, 0.03, ...VIOLET], [0.79, 0.64, 0.7, 0.03, ...VIOLET], [0.03, 0.38, 1.3, 0.05, ...CYAN],
      [0.245, 0.74, 1.1, 0.15, ...CYAN], [0.605, 0.06, 1.5, 0, ...CYAN], [0.6, 0.28, 1.1, 0, ...CYAN], [0.86, 0.25, 1.1, 0, ...CYAN], [0.865, 0.64, 1.2, 0.03, ...CYAN],
      [0.648, 0.57, 1.3, 0.075, ...TEAL], [0.525, 0.6, 0.9, 0.075, ...TEAL], [0.448, 0.87, 0.9, 0.15, ...TEAL],
    ],
  },
};

/** The location a set is played at, or null for a set that has none yet (the gate then opens as before). */
export function locationOfSet(setId: SetId): LocationDef | null {
  return Object.values(LOCATIONS).find((l) => l.setId === setId) ?? null;
}

/** Its name, as players read it. */
export const locationName = (l: LocationDef): string => SETS[l.setId].location ?? SETS[l.setId].name;

/** A file of the location's own art (BASE_URL-relative: itch serves the game from a sub-path). */
export const locationArt = (id: LocationId, file: string): string => `${import.meta.env.BASE_URL}locations/${id}/${file}.webp`;
export const locationSound = (file: string): string => `${import.meta.env.BASE_URL}locations/sfx/${file}.mp3`;

/** What the parchments are called. */
export const POSTER_NAME: Readonly<Partial<Record<Tribe, string>>> = {
  dragon: 'Dragons', beast: 'Beasts', kobold: 'Kobolds', dwarf: 'Dwarves', demon: 'Demons', undead: 'Undead', spirit: 'Spirits',
};

/** The parchments a game shows: the location's, in its order, for the tribes this game plays with. */
export function postersFor(l: LocationDef, tribes: readonly Tribe[]): Tribe[] {
  return l.posters.filter((t) => tribes.includes(t));
}
