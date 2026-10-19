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
import { createContext, useContext, useSyncExternalStore } from 'react';
import { cardPlateOf, type RunCosmeticSnapshot } from '@game/progression';
import type { BoxBlend } from '../cardTextConfig';
import plateTuning from './plate-tuning.json';

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
  /** `--plate-frame-y`: a plate's frame nudge DOWN (x the card width, + = down). Moves the frame (or a single image),
   *  its glow and its interior together (the Card Plate Editor, owner 2026-10-18). */
  frameY?: number;
  /** `--plate-interior-sx`: a layered plate's interior WIDTH stretch, so it tucks under a frame whose opening is wider
   *  than the interior (owner 2026-10-15: gaps between the interior and the frame). 1 = the darkening's box. */
  interiorSx?: number;
  /** `--plate-interior-sy` / `--plate-interior-y`: its HEIGHT stretch and vertical nudge (x the card width, + = down), so
   *  it tucks under the frame's top and bottom too (owner 2026-10-15: "magma's interior needs to nudge down"). */
  interiorSy?: number;
  interiorY?: number;
  /** `--plate-interior-x`: the interior's own nudge RIGHT of the frame (x the card width), on top of `frameX`. */
  interiorX?: number;
  /**
   * `--plate-art-s`: draws the plate's ART bigger than the plate box, about its centre (owner 2026-10-17: "phoenix plate
   * needs to be 30% larger", "astral relic is so tiny"). For art drawn smaller than the card, used WHOLE ("let them be
   * uncropped"), so it can spill past the box instead of being cropped. Scales the single image, or a layered plate's
   * frame and its glow; the interior follows (see `scaledInterior`). Absent = 1.
   */
  artScale?: number;
  /**
   * A FROSTED-GLASS interior (owner 2026-10-19, Simple Glass: "clear and blurs all imagery behind it", "slightly
   * darkened too to help readability"). The interior image is then only a SHAPE: the card draws none of its pixels,
   * masks a live `backdrop-filter` blur plus a dark tint to it (styles.css `.plate-frosted`). Its colours show only in
   * the Collection picture, which cannot blur what is behind it.
   */
  frosted?: boolean;
  /** The plate WHOLE, for the Collection (tile + detail panel): the plate itself, or for a layered plate a pre-built
   *  composite of the interior seated in the frame (`<id>.webp`, built at the in-game proportions). */
  thumb: string;
}

const PLATE_DIR = `${import.meta.env.BASE_URL}frames/plates/`;

/** The shared interiors a layered plate can sit on (`frames/plates/interiors/<name>.webp`). Brown is the default. */
export const PLATE_INTERIORS = ['brown', 'dark', 'magma', 'water', 'simpleblack', 'darkbrown', 'grey', 'mystic', 'roundmagic', 'silvermagic', 'wartorn', 'frosted'] as const;
export type PlateInterior = (typeof PLATE_INTERIORS)[number];
export const DEFAULT_PLATE_INTERIOR: PlateInterior = 'brown';

/** Each interior image's height / width: it is drawn 1.08 card widths wide, so this sets its height. */
const INTERIOR_ASPECT: Readonly<Record<PlateInterior, number>> = {
  brown: 1.7985, dark: 1.8032, magma: 1.8032, water: 1.8031, simpleblack: 1.7254, darkbrown: 1.7985, grey: 1.8032,
  mystic: 1.6554, roundmagic: 1.7184, silvermagic: 1.7261, wartorn: 1.6276, frosted: 1.7254,
};

/**
 * A layered plate's interior under a frame drawn `s` times bigger (`artScale`). The frame scales about its own centre
 * (styles.css `.plate-frame`), so the interior, which `interiorSx` / `-Sy` / `-Y` seat on the UNSCALED frame (measured
 * by `plates:build --fit`), grows by `s` too and its centre moves `s` times as far from the frame's centre. In card
 * widths: the frame box is 1.5 x 1.555 tall, the interior's box starts 5.4463% down it, and is 1.08 x aspect tall; its
 * centre offset `k` from the frame's centre gives the new nudge `s * y + k * (1 - s)`.
 */
function scaledInterior(s: number, interior: PlateInterior, sx: number, sy: number, x: number, y: number) {
  const frameH = 1.5 * 1.555;
  const k = frameH / 2 - frameH * 0.054463 - (1.08 * INTERIOR_ASPECT[interior]) / 2;
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { interiorSx: r(sx * s), interiorSy: r(sy * s), interiorX: r(s * x), interiorY: r(s * y + k * (1 - s)) };
}

/** One entry per `card_plate` art key (`assets.art`). Tuned by eye with the owner in game, 2026-10-14. */
type LookSettings = Pick<CardPlateLook, 'boxA' | 'boxBlend' | 'boxY' | 'frameX' | 'frameY' | 'interiorSx' | 'interiorSy' | 'interiorX' | 'interiorY' | 'artScale' | 'frosted'> & {
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
  // Owner 2026-10-18: "replace all cards' brown interior (except the standard card plate) with the dark brown interior and
  // remove darkening from them": every plate that sat on Brown (Topaz, Blossom, Spirit Carving, Iridescent, Porcelain,
  // Smooth Iridescent, Honey, Goop) is on Dark Brown with no darkening. Dark Brown has Brown's exact outline, so every
  // fit holds. Brown is still the DEFAULT for a new plate unless the owner says otherwise.
  plate_topaz: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.027, interiorY: 0.0009, darken: false },
  // Owner 2026-10-15: the SMOOTH frames on the Dark interior (openings about 2px left of centre, seated like Moonstone).
  plate_smooth_aqua: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.055, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  plate_smooth_blue: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.065, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  plate_smooth_red: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.008, interiorSx: 1.065, interiorSy: 1.026, interiorY: -0.0028, darken: false },
  // BLOSSOM (owner 2026-10-15): the first LAYERED plate (built as "Test Blossom"), Brown Interior under the darkening
  // under the Blossom frame.
  // Owner 2026-10-15: "nudge the plate to the right ... ignore the true centering for now".
  // Owner 2026-10-15: "blossoms interior needs to nudge down too" (fit measured like the others).
  plate_blossom: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.005, interiorSx: 1.011, interiorSy: 1.011, interiorY: 0.0103, darken: false }, // owner-tuned: 0.04 too far, then 0.02, 0.015, 0.01, each a little too far
  // Owner 2026-10-16 batch. Every interior here is dark, so no text darkening (like the other dark-interior plates).
  // Dark Arcane: Galaxy's template and opening, on the Dark interior (same seat and fit).
  plate_dark_arcane: GALAXY_SEAT,
  // Simple Glass: the Simple template (pointed bottom), like Simple Black. The glass is see-through on its left
  // edge, so its fit counted alpha > 60 as frame (`--fit-alpha 60`); the opening is centred like Simple Black's.
  // Owner 2026-10-17: "the glass frame needs the simpleblack interior" (was Grey); refit on that interior's shape.
  // Owner 2026-10-19: FROSTED, "clear and blurs all imagery behind it" and "slightly darkened". The `frosted` interior is
  // Simple Black's exact outline (same size), so its fit holds.
  plate_simple_glass: { ...AQUARIUM_ROCKS, layered: true, interior: 'frosted', frosted: true, frameX: 0.004, interiorSx: 1.171, interiorSy: 1.159, interiorY: 0.0919, darken: false },
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
  // Owner 2026-10-17 batch on the default Brown interior, keeping the standard darkening (like Topaz and Blossom). Each
  // frameX seats the opening where the owner tuned Blossom's, measured from the frame BODY (runs of 12+ opaque px), so the
  // wisps and vines that cross Spirit Carving's, Mystic Obsidian's and Porcelain's openings do not skew it. Spirit
  // Carving's opening sits 5px left of centre, hence its larger nudge and stretch.
  plate_spirit_carving: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.014, interiorSx: 1.076, interiorSy: 1.021, interiorY: -0.0047, darken: false },
  plate_iridescent: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.051, interiorSy: 1.031, interiorY: 0, darken: false },
  // Owner 2026-10-17 (second round): Mystic Obsidian moves onto the new Mystic interior (matched by name); dark, so no
  // darkening. That interior is shorter for its width than Brown, so the fit stretches it taller and lowers it.
  plate_mystic_obsidian: { ...AQUARIUM_ROCKS, layered: true, interior: 'mystic', frameX: 0.004, interiorSx: 1.021, interiorSy: 1.154, interiorY: 0.0994, darken: false },
  plate_porcelain: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.005, interiorSx: 1.065, interiorSy: 1.033, interiorY: 0.0075, darken: false },
  plate_smooth_iridescent: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.005, interiorSx: 1.04, interiorSy: 1.038, interiorY: 0.0159, darken: false },
  // Owner 2026-10-17, second round: interiors matched by name (Battletorn on Wartorn, Round Magic on Brown Round Magic,
  // Silver Magic, shipped as Verdant Magic, on Silver Magic); the owner picked Mystic for Ethereal. None keeps the
  // darkening (Round Magic lost it too: owner 2026-10-17, "remove the darkening from round magic").
  // WHOLE ART (owner 2026-10-17: "please undo the adjustments to the larger cards. let them be uncropped, we can work
  // through adjusting them as we need"): Battletorn, Ethereal, Emerald, Gilt Etched, Astral Relic, Blood Omen, Honey, Goop
  // and Phoenix Plate were drawn on bigger canvases. Each frame is now the WHOLE image uniformly scaled to fit the plate
  // (nothing cropped or stretched), so a frame drawn wider or taller than the card (Astral Relic, Emerald, Goop) sits
  // with a margin; the interior fits are measured on those (`--fit` may now NARROW an interior, Sx < 1).
  // ...then drawn BIGGER again (owner 2026-10-17: "phoenix plate needs to be 30% larger", "astral relic is so tiny",
  // "ethereal also needs to increase in size", "battletorn is also too small", "goop is too small"): `artScale` grows
  // the art past the plate box, still uncropped. Phoenix Plate takes the owner's 1.3; the others the size at which
  // their opening matches a standard plate's again (interiorSx about 1.05). The interior numbers stay the fit on the
  // UNSCALED frame; `scaledInterior` derives the rest.
  plate_battletorn: { ...AQUARIUM_ROCKS, layered: true, interior: 'wartorn', frameX: 0.004, interiorSx: 0.952, interiorSy: 0.973, interiorY: 0.09, darken: false, artScale: 1.1 },
  plate_ethereal: { ...AQUARIUM_ROCKS, layered: true, interior: 'mystic', frameX: 0.005, interiorSx: 0.941, interiorSy: 1.024, interiorY: 0.0862, darken: false, artScale: 1.12 },
  plate_round_magic: { ...AQUARIUM_ROCKS, layered: true, interior: 'roundmagic', frameX: 0.005, interiorSx: 1.018, interiorSy: 1.066, interiorY: 0.0609, darken: false }, // owner 2026-10-17: "remove the darkening from round magic"
  plate_verdant_magic: { ...AQUARIUM_ROCKS, layered: true, interior: 'silvermagic', frameX: 0.006, interiorSx: 1.059, interiorSy: 1.089, interiorY: 0.0806, darken: false },
  // Phoenix Plate: a shield with wings and its own painted middle, so a SINGLE-IMAGE plate (owner 2026-10-17: "Try it as
  // one image"), the whole art scaled to fit the plate. Its middle is already dark: no darkening.
  plate_phoenix_plate: { ...AQUARIUM_ROCKS, darken: false, artScale: 1.3 },
  // Owner 2026-10-17: "add dark back to each": Emerald and Gilt Etched on the Dark interior, no darkening.
  plate_emerald: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.006, interiorSx: 1.029, interiorSy: 1.016, interiorY: -0.0169, darken: false },
  plate_gilt_etched: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.006, interiorSx: 1.028, interiorSy: 0.975, interiorY: -0.0319, darken: false },
  // Owner 2026-10-17 batch: Astral Relic on Dark, Blood Omen on Wartorn, Honey on Brown (keeps the darkening, like the
  // other Brown plates). Blood Omen's opening starts low, so its fit pulls the interior's top DOWN under the frame (it
  // poked out above the top edge otherwise).
  plate_astral_relic: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.004, interiorSx: 0.881, interiorSy: 0.841, interiorY: -0.0394, darken: false, artScale: 1.19 },
  plate_blood_omen: { ...AQUARIUM_ROCKS, layered: true, interior: 'wartorn', frameX: 0.005, interiorSx: 1.035, interiorSy: 1.079, interiorY: 0.1013, darken: false },
  plate_honey: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.007, interiorSx: 1.051, interiorSy: 1.011, interiorY: 0.0028, darken: false },
  // Goop (owner 2026-10-17): no interior named, so the default Brown, keeping the darkening.
  plate_goop: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 0.975, interiorSy: 0.977, interiorY: -0.0637, artScale: 1.08, darken: false },
  // Owner 2026-10-19 batch on the Dark interior ("add them with the dark interior"), no darkening. Drawn a little taller
  // and narrower than the template, so each is the whole art fitted to the plate, then drawn bigger (`artScale`) until
  // its opening matches a standard plate's, like Battletorn.
  plate_celestial: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.008, interiorSy: 1.003, interiorY: -0.0066, darken: false, artScale: 1.042 },
  plate_runic: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.007, interiorSx: 0.98, interiorSy: 1.001, interiorY: -0.0103, darken: false, artScale: 1.086 },
  plate_verdant: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.007, interiorSx: 0.987, interiorSy: 0.996, interiorY: -0.0066, darken: false, artScale: 1.075 },
  plate_volcanic: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.007, interiorSx: 1.022, interiorSy: 0.999, interiorY: -0.0094, darken: false, artScale: 1.032 },
  // Owner 2026-10-19, the next drop: warm frames on Dark Brown, cool frames on Dark ("black": the owner picked the Dark
  // interior), and the last four (Nano, Soulwitch, Spades, The Howl) on Dark too. No darkening. Whole art fitted to the
  // plate, then `artScale` until the opening matches a standard plate's, like the batch above.
  plate_armored_knight: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.004, interiorSx: 1.008, interiorSy: 1.006, interiorY: -0.0037, darken: false, artScale: 1.05 },
  plate_bordered_land: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 0.969, interiorSy: 0.995, interiorY: 0.0075, darken: false, artScale: 1.098 },
  plate_carved_aetherstone: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.018, interiorSy: 1.016, interiorY: 0.0019, darken: false, artScale: 1.034 },
  plate_elegant: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.005, interiorSx: 1.015, interiorSy: 1.001, interiorY: -0.0066, darken: false, artScale: 1.047 },
  plate_frozen_aurora: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.004, interiorSx: 0.976, interiorSy: 0.964, interiorY: 0.0263, darken: false, artScale: 1.081 },
  plate_hivemind: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.004, interiorSy: 0.973, interiorY: -0.0159, darken: false, artScale: 1.06 },
  plate_ironwood: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.009, interiorSx: 0.997, interiorSy: 1.014, interiorY: 0.0038, darken: false, artScale: 1.063 },
  plate_solar: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 0.98, interiorSy: 0.937, interiorY: 0.0169, darken: false, artScale: 1.081 },
  plate_static: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.004, interiorSx: 0.99, interiorSy: 0.963, interiorY: -0.0122, darken: false, artScale: 1.065 },
  plate_twisted_ether: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.004, interiorSy: 0.966, interiorY: -0.0206, darken: false, artScale: 1.05 },
  plate_white_magic: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.006, interiorSx: 1.033, interiorSy: 1.018, interiorY: -0.0056, darken: false, artScale: 1.017 },
  plate_nano: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 0.973, interiorSy: 0.978, interiorY: -0.0159, darken: false, artScale: 1.093 },
  plate_soulwitch: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.005, interiorSx: 1.033, interiorSy: 0.995, interiorY: -0.0225, darken: false, artScale: 1.018 },
  plate_spades: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.004, interiorSx: 1, interiorSy: 0.995, interiorY: -0.0056, darken: false, artScale: 1.057 },
  plate_the_howl: { ...AQUARIUM_ROCKS, layered: true, interior: 'dark', frameX: 0.006, interiorSx: 0.95, interiorSy: 0.965, interiorY: -0.0291, darken: false, artScale: 1.113 },
  // Owner 2026-10-19: "add it with dark brown interior".
  plate_vintage_oak: { ...AQUARIUM_ROCKS, layered: true, interior: 'darkbrown', frameX: 0.007, interiorSx: 1.007, interiorSy: 0.995, interiorY: 0.015, darken: false, artScale: 1.052 },
};

/** The look of every plate the client ships, keyed by art key. Frozen, so a context value is stable per plate. */
/**
 * THE CARD PLATE EDITOR's knobs (owner 2026-10-18: "create a tuner that would allow me to select each Card Plate and
 * individually edit the card plates frame and interior size and positioning"). Per plate, never global.
 * `artScale` is the FRAME's size; the interior numbers are its fit on the UNSCALED frame (`scaledInterior` follows).
 */
export const PLATE_TUNING_KEYS = ['artScale', 'frameX', 'frameY', 'interiorSx', 'interiorSy', 'interiorX', 'interiorY'] as const;
export type PlateTuningKey = (typeof PLATE_TUNING_KEYS)[number];
export type PlateTuning = Partial<Record<PlateTuningKey, number>>;

/** What the editor SAVED (`plate-tuning.json`, written by the dev server's /__plates/tuning). It wins over SETTINGS. */
const SAVED_TUNING = (plateTuning as { plates: Record<string, PlateTuning> }).plates;

function buildLook(id: string, { layered, interior, darken, ...s }: LookSettings): CardPlateLook {
  return Object.freeze({
    id, backbox: darken === false ? null : `${PLATE_DIR}${id}-backbox.webp`, ...s,
    ...(layered && s.artScale && s.artScale !== 1
      ? scaledInterior(s.artScale, interior ?? DEFAULT_PLATE_INTERIOR, s.interiorSx ?? 1, s.interiorSy ?? 1, s.interiorX ?? 0, s.interiorY ?? 0)
      : {}),
    thumb: `${PLATE_DIR}${id}.webp`,
    ...(layered
      ? { plate: `${PLATE_DIR}interiors/${interior ?? DEFAULT_PLATE_INTERIOR}.webp`, frame: `${PLATE_DIR}${id}-frame.webp` }
      : { plate: `${PLATE_DIR}${id}.webp` }),
  });
}

const savedSettings = (id: string): LookSettings => ({ ...SETTINGS[id], ...SAVED_TUNING[id] });

/** The look of every plate the client ships, keyed by art key. Frozen, so a context value is stable per plate. */
export const CARD_PLATE_LOOKS: Readonly<Record<string, CardPlateLook>> = Object.freeze(Object.fromEntries(
  Object.keys(SETTINGS).map((id) => [id, buildLook(id, savedSettings(id))]),
));

/** The plate this snapshot's owner wears, or null for the standard plates (none equipped, retired, unknown, no art). */
export function cardPlateLookOf(snapshot: RunCosmeticSnapshot | null | undefined): CardPlateLook | null {
  const def = cardPlateOf(snapshot);
  const key = def?.assets.art;
  return key ? CARD_PLATE_LOOKS[key] ?? null : null;
}

/** The nearest `MinionSkins` scope's card plate (null = the standard plates). */
export const CardPlateContext = createContext<CardPlateLook | null>(null);

// ── The editor's LIVE (unsaved) edits ────────────────────────────────────────────────────────────────────────────
// Only the dev Card Plate Editor writes these; in a production build nothing ever does, so every lookup below is a
// miss and `useCardPlateLook` returns the context value untouched.
let liveTuning: Record<string, PlateTuning> = {};
let liveLooks: Record<string, CardPlateLook> = {};
let liveVersion = 0;
const liveListeners = new Set<() => void>();
const subscribeLive = (fn: () => void): (() => void) => { liveListeners.add(fn); return () => { liveListeners.delete(fn); }; };
const readLiveVersion = (): number => liveVersion;
function bumpLive(): void {
  liveVersion += 1;
  for (const fn of liveListeners) fn();
}

/** The editor's values for a plate right now: shipped settings, then what was saved, then the live edit. */
export function plateTuningOf(id: string): Required<PlateTuning> {
  const s = { ...savedSettings(id), ...liveTuning[id] };
  return {
    artScale: s.artScale ?? 1, frameX: s.frameX ?? 0, frameY: s.frameY ?? 0,
    interiorSx: s.interiorSx ?? 1, interiorSy: s.interiorSy ?? 1, interiorX: s.interiorX ?? 0, interiorY: s.interiorY ?? 0,
  };
}
/** Whether a plate is layered (frame over an interior) and which interior; a single-image plate has no interior. */
export function plateLayeringOf(id: string): { layered: boolean; interior: PlateInterior } {
  const s = SETTINGS[id];
  return { layered: !!s?.layered, interior: s?.interior ?? DEFAULT_PLATE_INTERIOR };
}
/** Every plate's art key, for the editor's picker. */
export const PLATE_IDS: readonly string[] = Object.freeze(Object.keys(SETTINGS));

/** DEV: set one live value on one plate (the editor's sliders). Every card wearing that plate repaints. */
export function setLivePlateTuning(id: string, key: PlateTuningKey, value: number): void {
  if (!SETTINGS[id]) return;
  liveTuning = { ...liveTuning, [id]: { ...liveTuning[id], [key]: value } };
  liveLooks = { ...liveLooks, [id]: buildLook(id, { ...savedSettings(id), ...liveTuning[id] }) };
  bumpLive();
}
/** DEV: drop every unsaved edit (back to what is saved). */
export function clearLivePlateTuning(): void {
  liveTuning = {};
  liveLooks = {};
  bumpLive();
}
/** The look a card wears for a plate id, with any live edit applied. */
export function livePlateLook(id: string): CardPlateLook | null {
  return liveLooks[id] ?? CARD_PLATE_LOOKS[id] ?? null;
}

/** What `Card` reads: a context read, not a prop, so the memo comparators (Card's and Unit's) are untouched. The
 *  editor's live edit for that plate, when there is one, replaces it (a no-op outside the dev editor). */
export function useCardPlateLook(): CardPlateLook | null {
  const look = useContext(CardPlateContext);
  useSyncExternalStore(subscribeLive, readLiveVersion, readLiveVersion);
  return look ? liveLooks[look.id] ?? look : look;
}
