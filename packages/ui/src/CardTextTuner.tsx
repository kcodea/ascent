import {
  CTX_BLENDS, CTX_DEFAULTS, CTX_RANGES,
  getCardTextConfig, resetCardTextConfig, setCardTextValue, type CardTextConfig,
} from './cardTextConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the card RULES-TEXT box — where the `.drawer` panel sits below the art, how it is inset,
 * its line spacing, and the backbox behind it. NOT the card title. Applies live via `--ctx-*` vars; shipping a
 * look means pasting the JSON into DEFAULTS *and* mirroring it into the styles.css fallbacks.
 *
 * LANGUAGE. `padX` read "box · side inset", which does not tell you the counter-intuitive part: it is padding,
 * so BIGGER makes the text column NARROWER. That now lives in the hint. The blend mode is a `select`, since a
 * slider cannot express a named CSS blend.
 */
const SPECS: Record<keyof CardTextConfig, [string, TunerUnit | undefined, string, string]> = {
  top:        ['Top edge', '×', 'How far below the art the text panel starts, as a multiple of card width. Bigger sits lower.', 'Text box'],
  padX:       ['Side padding', '×', 'Left and right padding, as a multiple of card width. BIGGER padding means a NARROWER text column.', 'Text box'],
  padTop:     ['Top padding', '×', 'Gap above the first line.', 'Text box'],
  padBottom:  ['Bottom padding', '×', 'Gap below the last line.', 'Text box'],
  line:       ['Line spacing', '×', 'Line height of the description text.', 'Text box'],

  boxW:       ['Width', '×', 'Backbox width, as a multiple of card width. Height follows the art ratio. 0 hides it entirely.', 'Backbox'],
  boxX:       ['Horizontal offset', '×', 'Offset from centre. Positive moves right.', 'Backbox'],
  boxY:       ['Vertical offset', '×', 'Offset down the card. Positive moves down.', 'Backbox'],
  boxA:       ['Opacity', 'opacity', 'Backbox opacity. 0 is invisible.', 'Backbox'],
  boxBlend:   ['Blend mode', undefined, 'How the backbox blends with the plate beneath it.', 'Backbox'],
};

/** Declaration order IS render order; the blend select sits inside the Backbox run. */
const ORDER: (keyof CardTextConfig)[] = [
  'top', 'padX', 'padTop', 'padBottom', 'line',
  'boxW', 'boxX', 'boxY', 'boxA', 'boxBlend',
];

const controls: TunerControl<Extract<keyof CardTextConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (key === 'boxBlend') {
    return { key, label, hint, group, kind: 'select' as const, options: CTX_BLENDS, min: 0, max: 0, step: 0 };
  }
  const [min, max, step] = CTX_RANGES[key as Exclude<keyof CardTextConfig, 'boxBlend'>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<CardTextConfig> = {
  id: 'cardtext',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Text',
  note: 'dev · live · cards',
  read: getCardTextConfig,
  write: (key, value) => setCardTextValue(key, value),
  writeColor: (key, value) => setCardTextValue(key, value),   // also carries the blend select's string
  reset: resetCardTextConfig,
  defaults: CTX_DEFAULTS,
  controls,
};

export function CardTextTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
