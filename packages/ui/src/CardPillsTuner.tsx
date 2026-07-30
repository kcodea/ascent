import {
  CARD_PILLS_COLOR_KEYS, CARD_PILLS_RANGES, PILLS_DEFAULTS,
  getCardPillsConfig, resetCardPillsConfig, setCardPillsColor, setCardPillsValue,
  type CardPillsColorKey, type CardPillsConfig, type CardPillsNumKey,
} from './cardPillsConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the CARD PILLS — the cost coin, the tier stars, the Spell/Ruby type pill and the ×N
 * multicast badge. Each gets its own offset and size so they can be seated INDEPENDENTLY (owner ask); nothing
 * here is shared between them. Applies live through the composed `--cpl-*` vars — no reload, no re-render.
 *
 * WHY SO MANY NEAR-DUPLICATE CONTROLS. The tier stars and the plate behind them need separate seats per FRAME
 * SHAPE, because the shapes put their top edge in different places: the generic oval, the square spell frame, the
 * heater Taunt shield, and the circle. Twelve of these controls are the same three dials repeated across those
 * four shapes, which is why they are grouped by shape rather than by dial — otherwise "x" appears four times in a
 * row with nothing to distinguish it.
 *
 * The ×N badge fill is the SINGLE colour its minted gradient is mixed from — its highlight and shade are derived,
 * not separate dials.
 */
const COLOR_SET = new Set<string>(CARD_PILLS_COLOR_KEYS);

const SPECS: Record<keyof CardPillsConfig, [string, TunerUnit | undefined, string, string]> = {
  costX:      ['Horizontal', 'px', 'Nudges the cost coin sideways.', 'Cost coin'],
  costY:      ['Vertical', 'px', 'Nudges the cost coin vertically.', 'Cost coin'],
  costScale:  ['Size', '×', 'Size of the cost coin.', 'Cost coin'],

  tierX:      ['Horizontal', 'px', 'Nudges the tier stars sideways on the generic oval frame.', 'Stars · oval frame'],
  tierY:      ['Vertical', 'px', 'Nudges them vertically on the oval frame.', 'Stars · oval frame'],
  tierScale:  ['Size', '×', 'Star size on the oval frame.', 'Stars · oval frame'],

  stierX:     ['Horizontal', 'px', 'Nudges the tier stars sideways on the square spell frame.', 'Stars · spell frame'],
  stierY:     ['Vertical', 'px', 'Nudges them vertically on the spell frame.', 'Stars · spell frame'],
  stierScale: ['Size', '×', 'Star size on the spell frame.', 'Stars · spell frame'],

  ttierX:     ['Horizontal', 'px', 'Nudges the tier stars sideways on the heater Taunt shield.', 'Stars · Taunt shield'],
  ttierY:     ['Vertical', 'px', 'Nudges them vertically on the Taunt shield.', 'Stars · Taunt shield'],
  ttierScale: ['Size', '×', 'Star size on the Taunt shield.', 'Stars · Taunt shield'],

  otierX:     ['Horizontal', 'px', 'Nudges the tier stars sideways on the circle frame.', 'Stars · circle frame'],
  otierY:     ['Vertical', 'px', 'Nudges them vertically on the circle frame.', 'Stars · circle frame'],
  otierScale: ['Size', '×', 'Star size on the circle frame.', 'Stars · circle frame'],

  plateAllX:  ['Horizontal', 'px', 'Nudges the star plate on the generic / catch-all frame.', 'Plate · generic'],
  plateAllY:  ['Vertical', 'px', 'Nudges it vertically.', 'Plate · generic'],
  plateAllW:  ['Width', '×', 'Plate width, relative to card width. Height follows the art ratio. 0 hides it.', 'Plate · generic'],

  plateSpX:   ['Horizontal', 'px', 'Nudges the star plate on the spell frame.', 'Plate · spell frame'],
  plateSpY:   ['Vertical', 'px', 'Nudges it vertically.', 'Plate · spell frame'],
  plateSpW:   ['Width', '×', 'Plate width on the spell frame. 0 hides it.', 'Plate · spell frame'],

  plateTaX:   ['Horizontal', 'px', 'Nudges the star plate on the Taunt shield.', 'Plate · Taunt shield'],
  plateTaY:   ['Vertical', 'px', 'Nudges it vertically.', 'Plate · Taunt shield'],
  plateTaW:   ['Width', '×', 'Plate width on the Taunt shield. 0 hides it.', 'Plate · Taunt shield'],

  plateOvX:   ['Horizontal', 'px', 'Nudges the star plate on the circle frame.', 'Plate · circle frame'],
  plateOvY:   ['Vertical', 'px', 'Nudges it vertically.', 'Plate · circle frame'],
  plateOvW:   ['Width', '×', 'Plate width on the circle frame. 0 hides it.', 'Plate · circle frame'],

  glowW:      ['Width', '×', 'Width of the Tier 7 glow, relative to the card.', 'Tier 7 glow'],
  glowH:      ['Height', '×', 'Height of the Tier 7 glow.', 'Tier 7 glow'],
  glowX:      ['Horizontal', 'px', 'Nudges the glow sideways.', 'Tier 7 glow'],
  glowY:      ['Vertical', 'px', 'Nudges the glow vertically.', 'Tier 7 glow'],
  glowA:      ['Opacity', 'opacity', 'Peak glow opacity.', 'Tier 7 glow'],
  glowSpeed:  ['Pulse cycle', 's', 'Seconds per full pulse.', 'Tier 7 glow'],
  glowDip:    ['Pulse depth', 'opacity', 'How far the pulse dips. 0 fades right out; 1 holds steady with no pulse at all.', 'Tier 7 glow'],
  glowColor:  ['Colour', undefined, 'Colour of the Tier 7 glow.', 'Tier 7 glow'],

  spellX:     ['Horizontal', 'px', 'Nudges the Spell / Ruby type pill sideways.', 'Type pill'],
  spellY:     ['Vertical', 'px', 'Nudges it vertically.', 'Type pill'],
  spellScale: ['Size', '×', 'Size of the type pill.', 'Type pill'],

  multX:      ['Horizontal', 'px', 'Nudges the ×N multicast badge sideways.', '×N badge'],
  multY:      ['Vertical', 'px', 'Nudges it vertically.', '×N badge'],
  multScale:  ['Size', '×', 'Size of the badge.', '×N badge'],
  multBadge:  ['Fill colour', undefined, 'The single colour the badge’s minted gradient is mixed from — its highlight and shade are derived from this, not set separately.', '×N badge'],
  multFont:   ['Numeral colour', undefined, 'Colour of the number on the badge.', '×N badge'],
};

/** Declaration order IS render order, grouped by the part (and by frame shape where a part repeats). */
const ORDER: (keyof CardPillsConfig)[] = [
  'costX', 'costY', 'costScale',
  'tierX', 'tierY', 'tierScale',
  'stierX', 'stierY', 'stierScale',
  'ttierX', 'ttierY', 'ttierScale',
  'otierX', 'otierY', 'otierScale',
  'plateAllX', 'plateAllY', 'plateAllW',
  'plateSpX', 'plateSpY', 'plateSpW',
  'plateTaX', 'plateTaY', 'plateTaW',
  'plateOvX', 'plateOvY', 'plateOvW',
  'glowW', 'glowH', 'glowX', 'glowY', 'glowA', 'glowSpeed', 'glowDip', 'glowColor',
  'spellX', 'spellY', 'spellScale',
  'multX', 'multY', 'multScale', 'multBadge', 'multFont',
];

const controls: TunerControl<Extract<keyof CardPillsConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = CARD_PILLS_RANGES[key as CardPillsNumKey];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<CardPillsConfig> = {
  id: 'cardpills',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Pills',
  note: 'dev · live · cards',
  read: getCardPillsConfig,
  write: (key, value) => setCardPillsValue(key as CardPillsNumKey, value),
  // This config keeps a separate colour setter, because a colour mints a gradient rather than writing a var.
  writeColor: (key, value) => setCardPillsColor(key as CardPillsColorKey, value),
  reset: resetCardPillsConfig,
  defaults: PILLS_DEFAULTS,
  controls,
};

export function CardPillsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
