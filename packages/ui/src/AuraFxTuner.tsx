import {
  AURAFX_DEFAULTS, AURAFX_RANGES, getAuraFxConfig, resetAuraFxConfig, setAuraFxValue, type AuraFxConfig,
} from './auraFxConfig';
import { TunerPanel } from './TunerPanel';
import { testAuraFx, type AuraTestTribe } from './fxTestFire';
import type { TunerAction, TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the AURA WAVE — the run-wide tribe-aura board wash: a centre-to-edge wake, a board glow,
 * and streak-tailed motes riding it. Edits apply to the NEXT wave, so cast a Lantern of Souls, play an Imp
 * Overseer or an Attachment Mechanic to judge — or use a Test button.
 *
 * COLOURS ARE NOT DIALS here, deliberately: the wave reads the firing tribe's `BUFF_PRESETS` palette at fire
 * time so it always matches that tribe's tendril look. That is why the tests are per-tribe.
 *
 * The old panel had a tribe RADIO plus one Test button — pick, then fire. Four buttons do the same job in one
 * click and need no panel-local state to remember which tribe was selected.
 */
const SPECS: Record<keyof AuraFxConfig, [string, TunerUnit | undefined, string, string]> = {
  travelMs:    ['Travel time', 'ms', 'How long the wake takes to travel from centre to the board edge.', 'Timing'],
  fadeMs:      ['Dissipate time', 'ms', 'How long the wash takes to fade once it has arrived.', 'Timing'],

  fillAlpha:   ['Board glow opacity', 'opacity', 'How strongly the whole board tints as the wave passes.', 'Wake'],
  glowAlpha:   ['Wake opacity', 'opacity', 'Opacity of the travelling wake itself.', 'Wake'],
  glowSize:    ['Wake thickness', 'px', 'Thickness of the wake band.', 'Wake'],
  glowSpacing: ['Wake spacing', 'px', 'Gap between the repeated wake bands.', 'Wake'],

  widthScale:  ['Width', '×', 'Wave width relative to the board. Below 1 keeps it inside the frame.', 'Fit to board'],
  heightScale: ['Height', '×', 'Wave height relative to the board.', 'Fit to board'],
  offsetX:     ['Horizontal offset', 'px', 'Nudges the whole wave sideways.', 'Fit to board'],
  offsetY:     ['Vertical offset', 'px', 'Nudges the whole wave vertically.', 'Fit to board'],

  moteCount:   ['Count', undefined, 'How many motes ride the wave. 0 removes them.', 'Motes'],
  moteSize:    ['Size', 'px', 'Mote radius.', 'Motes'],
  moteLife:    ['Lifetime', 'ms', 'How long one mote lasts.', 'Motes'],
  moteRise:    ['Rise', 'px', 'How far a mote lifts as it fades.', 'Motes'],
  moteTail:    ['Tail narrowness', '×', 'How sharply each mote’s streak tapers. Lower is a fatter streak.', 'Motes'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof AuraFxConfig)[] = [
  'travelMs', 'fadeMs',
  'fillAlpha', 'glowAlpha', 'glowSize', 'glowSpacing',
  'widthScale', 'heightScale', 'offsetX', 'offsetY',
  'moteCount', 'moteSize', 'moteLife', 'moteRise', 'moteTail',
];

const controls: TunerControl<Extract<keyof AuraFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = AURAFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const TEST_TRIBES: AuraTestTribe[] = ['undead', 'demon', 'mech', 'beast'];
const actions: TunerAction[] = TEST_TRIBES.map((tribe) => ({
  label: `▶ ${tribe}`,
  hint: `Washes the current board and shop cards in the ${tribe} palette — no aura source needed.`,
  run: () => testAuraFx(tribe),
}));

const SPEC: TunerSpec<AuraFxConfig> = {
  id: 'aurafx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Aura Wave',
  note: 'dev · next wave · drag',
  read: getAuraFxConfig,
  write: setAuraFxValue,
  reset: resetAuraFxConfig,
  defaults: AURAFX_DEFAULTS,
  controls,
  actions,
};

export function AuraFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
