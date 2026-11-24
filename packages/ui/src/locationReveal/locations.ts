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
  /** The painting's row a wide window is centred on (0 top, 1 bottom): 21:9 shows about three quarters of its height. */
  focusY: number;
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
    vp: [0.58, 0.36],
    focusY: 0.4,
    deep: [0.008, 0.04, 0.115],
    second: [0.1, 0.95, 0.85],
    warmth: 0.1,
    posters: ['dragon', 'beast', 'kobold', 'dwarf', 'demon'],
    line: 'Welcome to the Outskirts.',
    lights: [
      [0.254, 0.525, 1.7, 0.15, ...WARM], [0.793, 0.465, 1.2, 0.15, ...WARM], [0.72, 0.615, 0.7, 0.15, ...WARM], [0.768, 0.52, 1.2, 0.15, 1, 0.32, 0.52],
      [0.541, 0.195, 0.8, 0, ...VIOLET], [0.685, 0.165, 1.1, 0, ...CYAN], [0.727, 0.04, 1.2, 0, ...CYAN], [0.532, 0.27, 0.5, 0, ...CYAN], [0.732, 0.22, 0.5, 0, ...CYAN],
    ],
  },
  underbelly: {
    id: 'underbelly',
    setId: 'set3',
    vp: [0.575, 0.3],
    focusY: 0.42,
    deep: [0.05, 0.018, 0.1],
    second: [0.1, 0.95, 0.62],
    cool: [0.6, 0.38, 1],
    warm: [1, 0.56, 0.22],
    warmth: 0.6,
    posters: ['undead', 'kobold', 'dragon', 'dwarf', 'spirit'],
    line: 'The Underbelly awaits.',
    lights: [
      [0.372, 0.145, 1.5, 0.15, ...WARM], [0.185, 0.41, 1.6, 0.15, ...WARM], [0.2, 0.51, 1.9, 0.15, ...WARM], [0.132, 0.12, 0.7, 0, ...WARM], [0.063, 0.36, 0.7, 0.15, ...WARM],
      [0.03, 0.41, 0.5, 0.15, ...WARM], [0.075, 0.47, 0.5, 0.15, ...WARM], [0.392, 0.34, 0.8, 0, ...WARM], [0.46, 0.385, 0.8, 0, ...WARM], [0.342, 0.575, 0.8, 0.075, ...WARM],
      [0.378, 0.595, 0.8, 0.075, ...WARM], [0.478, 0.585, 0.6, 0.02, ...WARM], [0.53, 0.62, 0.6, 0.02, ...WARM], [0.557, 0.61, 0.6, 0.02, ...WARM], [0.667, 0.635, 0.6, 0.02, ...WARM],
      [0.706, 0.59, 0.7, 0.075, ...WARM], [0.709, 0.685, 0.8, 0.075, ...WARM], [0.798, 0.75, 1.3, 0.15, ...WARM], [0.706, 0.8, 0.9, 0.12, ...WARM], [0.64, 0.21, 0.6, 0, ...WARM],
      [0.691, 0.23, 0.5, 0, ...WARM], [0.622, 0.27, 0.5, 0, ...WARM], [0.878, 0.33, 0.5, 0.03, ...WARM], [0.864, 0.42, 0.5, 0.03, ...WARM], [0.967, 0.175, 0.7, 0.03, ...WARM],
      [0.93, 0.195, 0.5, 0.03, ...WARM], [0.974, 0.3, 0.6, 0.03, ...WARM], [0.91, 0.65, 1, 0.04, ...WARM], [0.99, 0.51, 0.5, 0.03, ...WARM], [0.463, 0.11, 1.3, 0, ...VIOLET],
      [0.38, 0.455, 1.2, 0.075, ...VIOLET], [0.68, 0.265, 1.1, 0.075, ...VIOLET], [0.8, 0.43, 1.1, 0.03, ...VIOLET], [0.822, 0.26, 1, 0.03, ...VIOLET], [0.95, 0.475, 0.9, 0.03, ...VIOLET],
      [0.815, 0.585, 0.9, 0.04, ...VIOLET], [0.95, 0.66, 0.9, 0.04, ...VIOLET], [0.915, 0.08, 1.1, 0, ...VIOLET], [0.025, 0.52, 1.2, 0.15, ...VIOLET], [0.04, 0.05, 1, 0.25, ...VIOLET],
      [0.135, 0.86, 2, 0.25, ...VIOLET], [0.04, 0.86, 2, 0.25, ...VIOLET], [0.57, 0.1, 1.5, 0, ...CYAN], [0.57, 0.3, 1.2, 0, ...CYAN], [0.64, 0.57, 1.3, 0.075, ...TEAL],
      [0.46, 0.62, 0.9, 0.075, ...TEAL], [0.32, 0.86, 0.9, 0.15, ...TEAL],
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
