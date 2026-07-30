import {
  HEROPANEL_DEFAULTS, HPN_RANGES,
  getHeroPanelConfig, resetHeroPanelConfig, setHeroPanelValue, type HeroPanelConfig,
} from './heroPanelConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HERO PANEL — the bottom-left tray. Every part gets its own offset and size, because
 * they are laid out against each other rather than on a grid: the portrait square, the two name pills and the
 * Resolve box each need nudging independently once any one of them changes.
 *
 * LANGUAGE. The two square-size dials read "square · width (0=snug)" — a default encoded in the label. 0 means
 * "size to the art"; that now lives in the hint where there is room to say it properly.
 */
const SPECS: Record<keyof HeroPanelConfig, [string, TunerUnit | undefined, string, string]> = {
  panelX:          ['Horizontal offset', 'px', 'Offset from the panel’s bottom-left anchor. Scales with the board.', 'Whole panel'],
  panelY:          ['Vertical offset', 'px', 'Offset from that anchor. Positive moves down.', 'Whole panel'],
  panelScale:      ['Size', '×', 'Overall panel size, scaling about the bottom-left anchor.', 'Whole panel'],

  panelW:          ['Width', 'px', 'Portrait square width. 0 means size snugly to the art, which is the default.', 'Portrait square'],
  panelH:          ['Height', 'px', 'Portrait square height. 0 means size snugly to the art.', 'Portrait square'],

  portraitX:       ['Horizontal nudge', 'px', 'Slides the hero portrait inside its square.', 'Portrait'],
  portraitY:       ['Vertical nudge', 'px', 'Slides the portrait vertically.', 'Portrait'],
  portraitScale:   ['Size', '×', 'Portrait size. The hero-name pill rides this too, since it lives on the frame.', 'Portrait'],

  playerNameX:     ['Horizontal nudge', 'px', 'Slides the player-name pill sideways.', 'Player name'],
  playerNameY:     ['Vertical nudge', 'px', 'Slides the player-name pill vertically.', 'Player name'],
  playerNameScale: ['Size', '×', 'Player-name pill size.', 'Player name'],

  heroNameX:       ['Horizontal nudge', 'px', 'Slides the hero-name pill sideways.', 'Hero name'],
  heroNameY:       ['Vertical nudge', 'px', 'Slides the hero-name pill vertically.', 'Hero name'],
  heroNameScale:   ['Size', '×', 'Hero-name pill size.', 'Hero name'],

  resolveX:        ['Horizontal nudge', 'px', 'Slides the Resolve box sideways.', 'Resolve box'],
  resolveY:        ['Vertical nudge', 'px', 'Slides the Resolve box vertically.', 'Resolve box'],
  resolveScale:    ['Size', '×', 'Resolve box size.', 'Resolve box'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof HeroPanelConfig)[] = [
  'panelX', 'panelY', 'panelScale',
  'panelW', 'panelH',
  'portraitX', 'portraitY', 'portraitScale',
  'playerNameX', 'playerNameY', 'playerNameScale',
  'heroNameX', 'heroNameY', 'heroNameScale',
  'resolveX', 'resolveY', 'resolveScale',
];

const controls: TunerControl<Extract<keyof HeroPanelConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = HPN_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<HeroPanelConfig> = {
  id: 'heropanel',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Panel',
  note: 'dev · live · drag',
  read: getHeroPanelConfig,
  write: setHeroPanelValue,
  reset: resetHeroPanelConfig,
  defaults: HEROPANEL_DEFAULTS,
  controls,
};

export function HeroPanelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
