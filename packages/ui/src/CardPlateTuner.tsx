import {
  PLATE_DEFAULTS, PLATE_RANGES, getCardPlateConfig, resetCardPlateConfig, setCardPlateValue,
  type CardPlateConfig,
} from './cardPlateConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HAND CARD BACKPLATE — the plate's geometry, the rules-text shrink thresholds, the
 * golden tint, and the tribe-name label. Values persist to localStorage and apply live through `--plate-*`
 * CSS vars.
 *
 * "Copy values" grabs the JSON to paste back as the shipped defaults in `cardPlateConfig.ts` — and those MUST
 * be mirrored into the CSS `var(--plate-*, …)` fallbacks in styles.css. `cardPlateConfig.ts` itself DOES ship
 * in production (`Card.tsx` imports `plateTextBucket`), so `applyCardPlateVars()` sets `:root` from DEFAULTS
 * there too, but the CSS fallbacks remain the real rendering path whenever a var is missing. This panel is
 * dev-only and stripped from production.
 *
 * This was the third migration on purpose: it had been FAKING sections by prefixing every label
 * ("plate · width", "gold · sepia", "tribe name · y"), which is exactly the gap the schema's `group` closes.
 * It also drove a schema addition — three of its controls are not live, and the old panel said so in a single
 * blanket line at the foot that never identified which three. They now carry the caveat individually.
 */

const NOT_LIVE =
  'Not live on cards already on screen. Card is memoized (deliberately, for combat performance), so a visible '
  + 'card only picks up a new threshold the next time it re-renders — draw or discard to see it apply.';

/** `[label, unit, hint, group, note?]` per key. Units are declared, never typed into the label. */
const SPECS: Record<keyof CardPlateConfig, [string, TunerUnit | undefined, string, string, string?]> = {
  scale:         ['Width', '×', 'Plate width as a multiple of the card width. Above 1 pushes the ornate border outside the card.', 'Plate'],
  top:           ['Vertical offset', 'px', 'Distance from the top of the card. Negative lifts the plate up.', 'Plate'],
  radius:        ['Corner radius', 'px', 'Corner radius of the plate box. Cosmetic — the art paints its own corners.', 'Plate'],

  bucketM:       ['Shrink to medium at', undefined, 'Character count at which rules text steps down to the medium font size.', 'Rules text', NOT_LIVE],
  bucketL:       ['Shrink to small at', undefined, 'Character count at which rules text steps down to the small font size.', 'Rules text', NOT_LIVE],
  bucketXl:      ['Shrink to smallest at', undefined, 'Character count at which rules text steps down to the smallest font size.', 'Rules text', NOT_LIVE],

  goldSepia:     ['Sepia', undefined, 'Warmth of the gold base. Higher is warmer and more uniform.', 'Gilded tint'],
  goldSat:       ['Saturation', '×', 'Colour intensity of the gilding. Higher is more vibrant.', 'Gilded tint'],
  goldBright:    ['Brightness', '×', 'Overall lightness of the gilding.', 'Gilded tint'],
  goldContrast:  ['Contrast', '×', 'Separation between the gilding’s lights and darks.', 'Gilded tint'],
  goldHue:       ['Hue shift', '°', 'Positive shifts toward yellow-gold, negative toward orange-red.', 'Gilded tint'],

  tribeNameY:    ['Vertical position', '×', 'How far down the tribe plate the label sits. 1 is the very bottom gem.', 'Tribe name'],
  tribeNameX:    ['Horizontal offset', '×', 'Offset from centre, as a multiple of card width. Positive moves right.', 'Tribe name'],
  tribeNameSize: ['Font size', '×', 'Label size, as a multiple of card width.', 'Tribe name'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof CardPlateConfig)[] = [
  'scale', 'top', 'radius',
  'bucketM', 'bucketL', 'bucketXl',
  'goldSepia', 'goldSat', 'goldBright', 'goldContrast', 'goldHue',
  'tribeNameY', 'tribeNameX', 'tribeNameSize',
];

const controls: TunerControl<Extract<keyof CardPlateConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group, note] = SPECS[key];
  const [min, max, step] = PLATE_RANGES[key];
  return { key, label, unit, hint, group, note, min, max, step };
});

const SPEC: TunerSpec<CardPlateConfig> = {
  id: 'cardplate',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Plate',
  note: 'dev · live · hand cards',
  read: getCardPlateConfig,
  write: setCardPlateValue,
  reset: resetCardPlateConfig,
  defaults: PLATE_DEFAULTS,
  controls,
};

export function CardPlateTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
