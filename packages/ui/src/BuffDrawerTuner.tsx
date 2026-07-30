import {
  BFD_DEFAULTS, BFD_RANGES,
  getBuffDrawerConfig, resetBuffDrawerConfig, setBuffDrawerValue, type BuffDrawerConfig,
} from './buffDrawerConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the run-buffs drawer — the panel that extends right out of the hero portrait behind a tab
 * eclipsing its edge. Applies live via `--bfd-*` vars; shipping a look means pasting the JSON into DEFAULTS
 * *and* mirroring it into the styles.css fallbacks.
 *
 * The tab is VERTICAL so it covers as little of the portrait as possible, and its horizontal nudge is the
 * judgement call this tuner exists for — that is why its hint spells out which direction increases the eclipse.
 * Type sizes live here too, because the drawer sits over board art and legibility depends on what is behind it.
 */
const SPECS: Record<keyof BuffDrawerConfig, [string, TunerUnit | undefined, string, string]> = {
  tabX:    ['Horizontal nudge', 'px', 'MORE NEGATIVE pulls the tab further onto the portrait, eclipsing more of it. This is the dial the panel exists for.', 'Tab'],
  tabY:    ['Vertical nudge', 'px', 'Offset from the portrait’s mid-line.', 'Tab'],
  tabS:    ['Size', '×', 'Overall tab size.', 'Tab'],
  tabH:    ['Height', 'px', 'The vertical tab’s long axis.', 'Tab'],
  tabW:    ['Width', 'px', 'Keep this narrow — width is the part that covers the portrait.', 'Tab'],

  bodyX:   ['Horizontal offset', 'px', 'How far right of the tab the drawer panel sits.', 'Drawer'],
  bodyY:   ['Vertical offset', 'px', 'Vertical nudge of the drawer panel.', 'Drawer'],
  bodyS:   ['Size', '×', 'Overall drawer size.', 'Drawer'],
  minW:    ['Minimum width', 'px', 'Floor on the drawer width, so short values cannot collapse it narrow.', 'Drawer'],

  textS:   ['Row text', 'px', 'Size of the buff row text.', 'Type'],
  titleS:  ['Title text', 'px', 'Size of the "BUFFS" title.', 'Type'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof BuffDrawerConfig)[] = [
  'tabX', 'tabY', 'tabS', 'tabH', 'tabW',
  'bodyX', 'bodyY', 'bodyS', 'minW',
  'textS', 'titleS',
];

const controls: TunerControl<Extract<keyof BuffDrawerConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = BFD_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<BuffDrawerConfig> = {
  id: 'buffdrawer',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Buffs Drawer',
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
