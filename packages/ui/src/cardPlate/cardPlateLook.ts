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
  /** The rules-text darkening shape seated on this plate (`.descbox`). */
  backbox: string;
  /** `--ctx-box-a`: the darkening's opacity. */
  boxA: number;
  /** `--ctx-box-blend`: how the darkening blends with the plate under it. */
  boxBlend: BoxBlend;
  /** `--ctx-box-y`: the darkening's vertical offset from the text panel top (x the card width). */
  boxY: number;
}

const PLATE_DIR = `${import.meta.env.BASE_URL}frames/plates/`;

/** One entry per `card_plate` art key (`assets.art`). Tuned by eye with the owner in game, 2026-10-14. */
type LookSettings = Pick<CardPlateLook, 'boxA' | 'boxBlend' | 'boxY'>;
// Owner 2026-10-14: the light peach field needed darkening ("the back of the card needs to be darkened"), with their
// own shape ("backplate darkening.png"), then "Go darker ... multiply", "reduce the opacity a bit" (0.55), nudged down
// to 1.25 px below the standard seat at the 138 px enlarged card ("perfect"), then "darken the black darkening plate
// a bit more? like another 15%" (0.55 x 1.15 = 0.63).
const AQUARIUM_ROCKS: LookSettings = { boxA: 0.63, boxBlend: 'multiply', boxY: -1.22595 };
const SETTINGS: Readonly<Record<string, LookSettings>> = {
  plate_aquarium_rocks: AQUARIUM_ROCKS,
  // Owner 2026-10-15 batch (Amethyst, Bamboo, Beach, Magma, Moonstone): same body silhouette, so each starts from
  // Aquarium Rocks' tuned darkening (its own copy of the shape, so any one can be retuned alone).
  plate_amethyst: AQUARIUM_ROCKS,
  plate_bamboo: AQUARIUM_ROCKS,
  plate_beach: AQUARIUM_ROCKS,
  plate_magma: AQUARIUM_ROCKS,
  plate_moonstone: AQUARIUM_ROCKS,
};

/** The look of every plate the client ships, keyed by art key. Frozen, so a context value is stable per plate. */
export const CARD_PLATE_LOOKS: Readonly<Record<string, CardPlateLook>> = Object.freeze(Object.fromEntries(
  Object.entries(SETTINGS).map(([id, s]) => [id, Object.freeze({ id, plate: `${PLATE_DIR}${id}.webp`, backbox: `${PLATE_DIR}${id}-backbox.webp`, ...s })]),
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
