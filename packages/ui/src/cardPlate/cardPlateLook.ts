/**
 * CARD PLATES (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own darkening
 * settings, and leave the standard plates untouched"). The PRESENTATION half of the `card_plate` cosmetic: which plate
 * image a skinned card wears and how its rules-text darkening (`.descbox`) sits on that plate. The catalog entry lives in
 * @game/progression (cosmetics.ts); this file only maps its art key to pixels.
 *
 * The rules (owner 2026-10-14):
 *  - "replace all plates": a skinned card wears the plate whatever its tribe (the tribe name still prints on the bottom gem).
 *  - "we ALWAYS will have the gilded cards be the existing original card plate hued gold. nothing should ever changed for
 *    gilded cards": a GILDED card never wears a plate skin or its darkening. `Card.tsx` enforces that.
 *  - "Others see it too": the plate rides the run's cosmetic snapshot, and every `MinionSkins` scope (yours, and a foe's
 *    through "Show opponent cosmetics") provides its owner's plate to the cards inside it.
 *
 * A plate is the same 800x1244 body silhouette as the standard plates (`frames/cardplate*.webp`), so every plate
 * geometry var applies unchanged. Its darkening is the plate's own backbox art plus three numbers, written as inline
 * CSS vars on the card so they beat the shared `:root` values of the Card Text tuner for THIS card only.
 */
import { createContext, useContext } from 'react';
import { cardPlateOf, type RunCosmeticSnapshot } from '@game/progression';
import type { BoxBlend } from '../cardTextConfig';

export interface CardPlateLook {
  /** The catalog item id (`plate_*`). */
  id: string;
  /** The plate image (same body silhouette as the standard plates). */
  plate: string;
  /** The rules-text darkening shape seated on this plate (`.descbox`); null = this plate has NO darkening. */
  backbox: string | null;
  /** `--ctx-box-a`: the darkening's opacity. */
  boxA: number;
  /** `--ctx-box-blend`: how the darkening blends with the plate under it. */
  boxBlend: BoxBlend;
  /** `--ctx-box-y`: the darkening's vertical offset from the text panel top (x the card width). */
  boxY: number;
  /**
   * A LAYERED plate (owner 2026-10-15: "layer two layers to create a card frame ... i want the darkening png to sit
   * behind the frame, so there can be effects that can encroach over into the brown area without getting darkened").
   * Paint order, bottom to top: `interior` (the plate body, drawn in the darkening's own box), the darkening, then
   * `frame` (the full plate silhouette, above the darkening, below the name and rules text). When set, `plate` is the
   * interior. Absent = a single-image plate.
   *
   * THE DEFAULT FOR EVERY NEW PLATE (owner 2026-10-15: "going forward i think its better to do it this way, with the
   * layers, and we can create different bottom layers. if i dont specify, just default to the brown one"): a new plate
   * is LAYERED, its interior one of the shared `frames/plates/interiors/<name>.webp`, Brown unless the owner names
   * another.
   */
  frame?: string;
  /** `--plate-frame-x`: a layered plate's frame nudge, x the card width (+ = right). Moves the frame and its glow. */
  frameX?: number;
  /** `--plate-interior-sx`: a layered plate's interior WIDTH stretch, so it tucks under a frame whose opening is wider
   *  than the interior (owner 2026-10-15: gaps between the interior and the frame). 1 = the darkening's box. */
  interiorSx?: number;
  /** `--plate-interior-sy` / `--plate-interior-y`: its HEIGHT stretch and vertical nudge (x the card width, + = down), so
   *  it tucks under the frame's top and bottom too (owner 2026-10-15: "magma's interior needs to nudge down"). */
  interiorSy?: number;
  interiorY?: number;
  /** The plate WHOLE, for the Collection (tile + detail panel): the plate itself, or for a layered plate a pre-built
   *  composite of the interior seated in the frame (`<id>.webp`, built at the in-game proportions). */
  thumb: string;
}

const PLATE_DIR = `${import.meta.env.BASE_URL}frames/plates/`;

/** The shared interiors a layered plate can sit on (`frames/plates/interiors/<name>.webp`). Brown is the default. */
export const PLATE_INTERIORS = ['brown', 'dark', 'magma', 'water', 'simpleblack', 'darkbrown', 'grey'] as const;
export type PlateInterior = (typeof PLATE_INTERIORS)[number];
export const DEFAULT_PLATE_INTERIOR: PlateInterior = 'brown';

/** One entry per `card_plate` art key (`assets.art`). Tuned by eye with the owner in game, 2026-10-14. */
type LookSettings = Pick<CardPlateLook, 'boxA' | 'boxBlend' | 'boxY' | 'frameX' | 'interiorSx' | 'interiorSy' | 'interiorY'> & {
  /** false = no text darkening on this plate (its interior is already dark enough). */
  darken?: boolean;
  /** A layered plate (interior -> darkening -> frame). */
  layered?: boolean;
  /** Its interior; absent = `DEFAULT_PLATE_INTERIOR` (Brown). */
  interior?: PlateInterior;
};
// Owner 2026-10-14: the light peach field needed darkening ("the back of the card needs to be darkened"), with their
// own shape ("backplate darkening.png"), then "Go darker ... multiply", "reduce the opacity a bit" (0.55), nudged down
// to 1.25 px below the standard seat at the 138 px enlarged card ("perfect"), then "darken the black darkening plate
// a bit more? like another 15%" (0.55 x 1.15 = 0.63).
const AQUARIUM_ROCKS: LookSettings = { boxA: 0.63, boxBlend: 'multiply', boxY: -1.22595 };
/** Galaxy's seat on the Dark interior (standard template, opening 1px left of centre, no darkening); shared by every
 *  frame on that template with the same opening. */
const GALAXY_SEAT: LookSettings = { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.006, interiorSx: 1.054, interiorSy: 1.024, interiorY: -0.0037, darken: false };
const SETTINGS: Readonly<Record<string, LookSettings>> = {
  plate_aquarium_rocks: AQUARIUM_ROCKS,
  // Owner 2026-10-15 batch (Amethyst, Bamboo, Beach, Magma, Moonstone): same body silhouette, so each starts from
  // Aquarium Rocks' tuned darkening (its own copy of the shape, so any one can be retuned alone).
  // Owner 2026-10-15: "lets remove the darkening from amethyst" (its interior is already dark).
  plate_amethyst: { ...AQUARIUM_ROCKS, darken: false },
  plate_bamboo: AQUARIUM_ROCKS,
  // LAYERED since 2026-10-15 (owner: "replace the existing beach, moonstone, and magma frames with this layered
  // approach"; "moonstone and dark interior, magma frame and magma interior, beach frame and water interior"). Each
  // frameX seats the frame's opening where the owner tuned Blossom's (about 3px right of true centre at 946px):
  // Moonstone's opening was 2px left, Magma's centred, Beach's 3.5px left.
  // interiorSx / interiorSy / interiorY: each interior stretched and nudged to tuck 8px under its frame's opening on
  // every side (`npm run plates:build -- --fit`, 2026-10-15: the owner saw gaps at the sides, then at the bottom);
  // darken false: no text darkening (owner 2026-10-15: "remove the darkening png from all three of those cards").
  plate_beach: { ...AQUARIUM_ROCKS, layered: true, interior: 'water', frameX: 0.011, interiorSx: 1.084, interiorSy: 1.027, interiorY: 0.0056, darken: false },
  // Owner 2026-10-15: "lets add the darkening back to the magma card plate skin - lets reduce its opacity in half though".
  plate_magma: { ...AQUARIUM_ROCKS, boxA: 0.315, layered: true, interior: 'magma', frameX: 0.004, interiorSx: 1.059, interiorSy: 1.035, interiorY: 0.0075 },
  plate_moonstone: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.047, interiorSy: 1.009, interiorY: -0.0047, darken: false },
  // Owner 2026-10-15: Mooncloud on the Dark interior. Its art (990x1515, clouds past the standard edge) was fitted onto
  // the plate template at x1.026 with its gold opening centred and bottom-aligned, keeping the whole moon in the box.
  // No darkening, like Moonstone on the same interior; frameX as the owner tuned Blossom.
  plate_mooncloud: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.037, interiorSy: 1.006, interiorY: 0.0056, darken: false },
  // Owner 2026-10-15: Galaxy on the Dark interior. Standard template, opening 1px left of centre, so frameX seats it
  // where the owner tuned Blossom (about 3px right of true centre). No darkening, like the other Dark plates.
  plate_galaxy: GALAXY_SEAT,
  // Owner 2026-10-15 batch on the Dark interior: the same template and opening as Galaxy (measured identical), so the
  // same seat and fit.
  plate_crackling_gemstone: GALAXY_SEAT,
  plate_hand_drawn: GALAXY_SEAT,
  plate_blue_hand_drawn: GALAXY_SEAT,
  plate_green_hand_drawn: GALAXY_SEAT,
  // Owner 2026-10-15: the SIMPLE frames (a thin border with a bigger opening and a pointed bottom) sit on their own
  // Simple Black interior, drawn to that shape; the fit grows it about 1.15x and lowers it into the point. No darkening.
  plate_simple_black: { ...AQUARIUM_ROCKS, layered: true, interior: 'simpleblack', frameX: 0.004, interiorSx: 1.143, interiorSy: 1.156, interiorY: 0.0909, darken: false },
  plate_simple_white: { ...AQUARIUM_ROCKS, layered: true, interior: 'simpleblack', frameX: 0.004, interiorSx: 1.147, interiorSy: 1.149, interiorY: 0.0994, darken: false },
  // Topaz: the standard template on the default Brown interior, keeping the standard darkening (like Blossom).
  plate_topaz: { ...AQUARIUM_ROCKS, layered: true, frameX: 0.006, interiorSx: 1.051, interiorSy: 1.027, interiorY: 0.0009 },
  // Owner 2026-10-15: the SMOOTH frames on the Dark interior (openings about 2px left of centre, seated like Moonstone).
  plate_smooth_aqua: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.055, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  plate_smooth_blue: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.065, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  plate_smooth_red: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.065, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  // BLOSSOM (owner 2026-10-15): the first LAYERED plate (built as "Test Blossom"), Brown Interior under the darkening
  // under the Blossom frame.
  // Owner 2026-10-15: "nudge the plate to the right ... ignore the true centering for now".
  // Owner 2026-10-15: "blossoms interior needs to nudge down too" (fit measured like the others).
  plate_blossom: { ...AQUARIUM_ROCKS, layered: true, frameX: 0.005, interiorSx: 1.011, interiorSy: 1.011, interiorY: 0.0103 }, // owner-tuned: 0.04 too far, then 0.02, 0.015, 0.01, each a little too far
  // Owner 2026-10-16 batch. Every interior here is dark, so no text darkening (like the other dark-interior plates).
  // Dark Arcane: Galaxy's template and opening, on the Dark interior (same seat and fit).
  plate_dark_arcane: GALAXY_SEAT,
  // Simple Glass: the Simple template (pointed bottom) on the new Grey interior. The glass is see-through on its left
  // edge, so its fit counted alpha > 60 as frame (`--fit-alpha 60`); the opening is centred like Simple Black's.
  plate_simple_glass: { ...AQUARIUM_ROCKS, layered: true, interior: 'grey', frameX: 0.004, interiorSx: 1.21, interiorSy: 1.122, interiorY: 0.03, darken: false },
  // Stonevines: the standard template with vines spilling over the edge, on the Grey interior; opening 0.5px left.
  plate_stonevines: { ...AQUARIUM_ROCKS, layered: true, interior: 'grey', frameX: 0.005, interiorSx: 1.047, interiorSy: 1.026, interiorY: -0.0066, darken: false },
  // The four STANDARD colours: the standard plate's shape recoloured, on the new Dark Brown interior; openings 1px left
  // of centre like Galaxy's.
  plate_standard_black: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.027, interiorY: 0.0009, darken: false },
  plate_standard_blue: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.027, interiorY: 0.0009, darken: false },
  plate_standard_pink: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.027, interiorY: 0.0009, darken: false },
  plate_standard_teal: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.03, interiorY: -0.0028, darken: false },
  // Owner 2026-10-16: Chrome on the Grey interior. Standard template, opening centred (seated like Magma), no darkening.
  plate_chrome: { ...AQUARIUM_ROCKS, layered: true, interior: 'grey', frameX: 0.004, interiorSx: 1.055, interiorSy: 1.029, interiorY: -0.0037, darken: false },
};

/** The look of every plate the client ships, keyed by art key. Frozen, so a context value is stable per plate. */
export const CARD_PLATE_LOOKS: Readonly<Record<string, CardPlateLook>> = Object.freeze(Object.fromEntries(
  Object.entries(SETTINGS).map(([id, { layered, interior, darken, ...s }]) => [id, Object.freeze({
    id, backbox: darken === false ? null : `${PLATE_DIR}${id}-backbox.webp`, ...s,
    thumb: `${PLATE_DIR}${id}.webp`,
    ...(layered
      ? { plate: `${PLATE_DIR}interiors/${interior ?? DEFAULT_PLATE_INTERIOR}.webp`, frame: `${PLATE_DIR}${id}-frame.webp` }
      : { plate: `${PLATE_DIR}${id}.webp` }),
  })]),
));

/** The plate this snapshot's owner wears, or null for the standard plates (none equipped, retired, unknown, no art). */
export function cardPlateLookOf(snapshot: RunCosmeticSnapshot | null | undefined): CardPlateLook | null {
  const def = cardPlateOf(snapshot);
  const key = def?.assets.art;
  return key ? CARD_PLATE_LOOKS[key] ?? null : null;
}

/** The nearest `MinionSkins` scope's card plate (null = the standard plates). */
export const CardPlateContext = createContext<CardPlateLook | null>(null);

/** What `Card` reads: a context read, not a prop, so the memo comparators (Card's and Unit's) are untouched. */
export const useCardPlateLook = (): CardPlateLook | null => useContext(CardPlateContext);
