import {
  BFD_DEFAULTS, BFD_RANGES,
  getBuffDrawerConfig, resetBuffDrawerConfig, setBuffDrawerValue, type BuffDrawerConfig,
} from './buffDrawerConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the run-buffs pop-out — the panel that expands UPWARD out of the hero portrait when it is
 * clicked (owner rework 2026-08-14; it used to be a side drawer behind a tab, and this tuner used to carry the
 * now-deleted tab knobs). Applies live via `--bfd-*` vars; shipping a look means pasting the JSON into DEFAULTS
 * *and* mirroring it into the styles.css fallbacks.
 *
 * Type sizes live here too, because the panel sits over board art and legibility depends on what is behind it.
 */
const SPECS: Record<keyof BuffDrawerConfig, [string, TunerUnit | undefined, string, string]> = {
  bodyX:   ['Horizontal offset', 'px', 'How far right of the portrait’s left edge the panel sits.', 'Panel'],
  bodyY:   ['Vertical offset', 'px', 'Vertical nudge. Negative lifts it further off the portrait.', 'Panel'],
  bodyS:   ['Size', '×', 'Overall panel size.', 'Panel'],
  minW:    ['Minimum width', 'px', 'Floor on the panel width, so short values cannot collapse it narrow.', 'Panel'],

  textS:   ['Row text', 'px', 'Size of the buff row text.', 'Type'],
  titleS:  ['Title text', 'px', 'Size of the "BUFFS" title.', 'Type'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof BuffDrawerConfig)[] = [
  'bodyX', 'bodyY', 'bodyS', 'minW',
  'textS', 'titleS',
];

const controls: TunerControl<Extract<keyof BuffDrawerConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = BFD_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<BuffDrawerConfig> = {
  id: 'buffdrawer',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Buffs Panel',
  note: 'dev · live · drag',
  read: getBuffDrawerConfig,
  write: setBuffDrawerValue,
  reset: resetBuffDrawerConfig,
  defaults: BFD_DEFAULTS,
  controls,
};

export function BuffDrawerTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
