import { TRAIL_DEFAULTS, TRAIL_RANGES, getTrailConfig, resetTrailConfig, setTrailValue, type TrailConfig } from './trailConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the card motion trail — the wisps a card leaves behind as it moves, plus the gold and blue
 * variants a warded card trails. Values persist to localStorage and apply to the next wisps emitted, so drag a
 * card to judge a change.
 *
 * LANGUAGE. The old labels carried their units as free text ("emit spacing px", "wisp life ms", "aura band
 * width px") and said "alpha" three times without ever naming what was being made transparent — `alpha` was the
 * ordinary wisp, `goldAlpha` and `blueAlpha` the two warded variants, and "aura" was doing the disambiguating
 * from a different column. Each control now names its own subject and declares its unit.
 */
const SPECS: Record<keyof TrailConfig, [string, TunerUnit | undefined, string, string]> = {
  emitSpacing: ['Spacing between wisps', 'px', 'How far a card must travel before it drops the next wisp. Lower is a denser trail.', 'Trail'],
  lifeMs:      ['Wisp lifetime', 'ms', 'How long one wisp lasts before it has fully faded.', 'Trail'],
  size:        ['Wisp size', '×', 'Size of each wisp.', 'Trail'],
  alpha:       ['Wisp opacity', 'opacity', 'Opacity of an ordinary wisp.', 'Trail'],
  stretch:     ['Streak stretch', '×', 'How far each wisp smears along the direction of travel. 1 is a round puff.', 'Trail'],
  drift:       ['Sideways drift', 'px', 'How far a wisp wanders sideways as it fades.', 'Trail'],

  goldAlpha:   ['Gold wisp opacity', 'opacity', 'Opacity of the gold wisps a warded card trails.', 'Warded card'],
  blueAlpha:   ['Blue wisp opacity', 'opacity', 'Opacity of the blue wisps a warded card trails.', 'Warded card'],
  sparkChance: ['Spark chance', 'opacity', 'How often a wisp comes out as a bright spark instead. 0 is never, 1 is every time.', 'Warded card'],
  count:       ['Wisps per emit', undefined, 'How many wisps are dropped at once by a warded card.', 'Warded card'],
  width:       ['Band width', 'px', 'How wide the warded trail spreads across the card.', 'Warded card'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof TrailConfig)[] = [
  'emitSpacing', 'lifeMs', 'size', 'alpha', 'stretch', 'drift',
  'goldAlpha', 'blueAlpha', 'sparkChance', 'count', 'width',
];

const controls: TunerControl<Extract<keyof TrailConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = TRAIL_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<TrailConfig> = {
  id: 'trail',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Motion Trail',
  note: 'dev · drag a card · drag',
  read: getTrailConfig,
  write: setTrailValue,
  reset: resetTrailConfig,
  defaults: TRAIL_DEFAULTS,
  controls,
};

export function TrailTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
