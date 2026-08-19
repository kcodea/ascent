import {
  HAWKUSFX_DEFAULTS, HAWKUSFX_RANGES,
  getHawkusFxConfig, resetHawkusFxConfig, setHawkusFxValue, type HawkusFxConfig,
} from './hawkusFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for HAWKUS'S UPDRAFT — the wind gust that plays when Hawkus's Rally trigger fires.
 *
 * Read at PLAY time (`playDef` overlays these onto the committed def), so edits apply to the NEXT gust: put a
 * Hawkus and any Rally minion on the board with an Echo minion left-most, and each Rally re-fires it.
 *
 * The two layers are dialled separately because they do different jobs: the STREAKS are the visible gust and
 * the AIR is the soft body it rides in. Gravity is the lever that decides the whole read — negative keeps the
 * gust climbing (wind), high positive arcs it back down (fountain).
 */
const SPECS: Record<keyof HawkusFxConfig, [string, TunerUnit | undefined, string, string]> = {
  gustSpeed:   ['Speed', undefined, 'How fast the streaks launch upward.', 'Gust streaks'],
  gustGravity: ['Gravity', undefined, 'Downward pull on the streaks. Negative keeps them climbing (wind); high positive arcs them back down (fountain).', 'Gust streaks'],
  gustEase:    ['Ease', undefined, 'Drag — how hard the air slows the streaks. 0 = they coast, 1 = they stop almost at once.', 'Gust streaks'],
  gustLife:    ['Life', 'ms', 'How long each streak lives before it fades.', 'Gust streaks'],
  gustSpread:  ['Spread', undefined, 'Cone width. Narrow = a tight column, wide = a fan.', 'Gust streaks'],
  gustCount:   ['Count', undefined, 'How many streaks the gust throws.', 'Gust streaks'],

  airSpeed:    ['Speed', undefined, 'How fast the soft body rises.', 'Rising air'],
  airGravity:  ['Gravity', undefined, 'Negative lifts the air, positive lets it settle.', 'Rising air'],
  airLife:     ['Life', 'ms', 'How long each puff lives.', 'Rising air'],
  airRate:     ['Rate', undefined, 'Puffs emitted per second — the density of the body.', 'Rising air'],
};

/** Declaration order IS render order; controls sharing a group render together under its heading. */
const ORDER: (keyof HawkusFxConfig)[] = [
  'gustSpeed', 'gustGravity', 'gustEase', 'gustLife', 'gustSpread', 'gustCount',
  'airSpeed', 'airGravity', 'airLife', 'airRate',
];

const controls: TunerControl<Extract<keyof HawkusFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = HAWKUSFX_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HawkusFxConfig> = {
  id: 'hawkusfx',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hawkus gust',
  note: 'dev · next trigger · drag',
  read: getHawkusFxConfig,
  write: (key, value) => setHawkusFxValue(key, value),
  reset: resetHawkusFxConfig,
  defaults: HAWKUSFX_DEFAULTS,
  controls,
};

export function HawkusFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
