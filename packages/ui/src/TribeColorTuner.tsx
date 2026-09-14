import type { Tribe } from '@game/core';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';
import {
  TRIBE_COLOR_DEFAULTS, getTribeColorConfig, resetTribeColorConfig, setTribeColor, type TribeColorConfig,
} from './tribeColorConfig';

/**
 * DEV-only tuner for the TRIBE HUES — the `--t-<tribe>` token behind every card's accent: the tribe name on the
 * plate gem, the bold values in the rules text, the medallion glyph, the dual-type split. Changes apply LIVE to
 * every card on screen. Celestial and Spirit lead the list (owner ask 2026-09-14 — they had no colour at all);
 * the eight established tribes follow so the whole palette can be judged together.
 *
 * SHIPPING a colour means pasting it into BOTH `DEFAULTS` in `tribeColorConfig.ts` and the `--t-<tribe>` token
 * at the top of styles.css — the tuner writes localStorage, which the other dev and the packaged exe never see.
 */
const ROWS: [Tribe, string, string, string][] = [
  ['celestial', 'Celestial', 'Set 3 — the Starform tribe. No colour shipped yet: pick one here.', 'Set 3'],
  ['spirit', 'Spirit', 'Set 3 — the hand-summon tribe. No colour shipped yet: pick one here.', 'Set 3'],
  ['beast', 'Beast', 'Shipped green.', 'Established'],
  ['dragon', 'Dragon', 'Shipped white.', 'Established'],
  ['mech', 'Mech', 'Shipped blue.', 'Established'],
  ['undead', 'Undead', 'Shipped teal.', 'Established'],
  ['demon', 'Demon', 'Shipped purple.', 'Established'],
  ['kobold', 'Kobold', 'Shipped ember orange.', 'Established'],
  ['dwarf', 'Dwarf', 'Shipped forge yellow.', 'Established'],
  ['neutral', 'Neutral', 'Shipped greige.', 'Established'],
];

const controls: TunerControl<Tribe>[] = ROWS.map(([key, label, hint, group]) => ({ key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 }));

export const SPEC: TunerSpec<TribeColorConfig> = {
  id: 'tribecolors',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Tribe Colours',
  note: 'dev · live · every card',
  read: getTribeColorConfig as unknown as TunerSpec<TribeColorConfig>['read'],
  write: () => { /* no numeric controls */ },
  writeColor: (key, value) => setTribeColor(key as Tribe, value),
  reset: resetTribeColorConfig,
  defaults: TRIBE_COLOR_DEFAULTS as unknown as TunerSpec<TribeColorConfig>['defaults'],
  controls,
};

export function TribeColorTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
