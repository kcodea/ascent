import {
  EXECUTEFX_COLOR_GROUPS, EXECUTEFX_GROUPS, EXECUTEFX_RANGES,
  getExecuteFxConfig, getExecuteFxDefaults, resetExecuteFxConfig, setExecuteFxValue,
  type ExecuteFxConfig,
} from './executeFxConfig';
import { pixiFx } from './pixiFx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the EXECUTION STRIKE — the one-shot crescent slash when an Execute minion procs and destroys
 * its target.
 *
 * The config is read at FIRE TIME, so there is nothing to reflect and nothing to re-render: change a dial, hit
 * Test, and the next strike uses it. Test fires at screen centre, so the look can be dialled without staging a
 * real Execute kill.
 *
 * Sections come from the config's own `EXECUTEFX_GROUPS` and `EXECUTEFX_COLOR_GROUPS` rather than a copy here, so
 * the two cannot drift.
 *
 * The three crescent colours are a TAIL → MID → TIP ramp along one slash, not three independent things, which is
 * why they are named for their position along the blade.
 */
const SPECS: Record<keyof ExecuteFxConfig, [string, TunerUnit | undefined, string]> = {
  power:        ['Overall size', '×', 'Scales the whole strike.'],

  arcCount:     ['Cut count', undefined, 'How many crescent cuts the strike draws. 0 removes them.'],
  arcSize:      ['Size', 'px', 'Radius of each crescent.'],
  arcGrow:      ['Expansion', '×', 'How much a crescent grows over its life.'],
  arcLife:      ['Lifetime', 'ms', 'How long one crescent lasts.'],
  arcSpeed:     ['Speed', 'px/s', 'How fast a crescent travels outward.'],
  arcDrag:      ['Drag', 'opacity', 'How quickly it loses that speed. 1 stops it almost at once.'],
  arcBack:      ['Launch back', 'px', 'How far behind the contact point a crescent starts.'],
  arcTilt:      ['Tilt', '°', 'Angle relative to the direction of the blow.'],
  arcSpread:    ['Tilt spread', '°', 'Random variation in that angle across the cuts.'],
  arcSpin:      ['Sweep', '°', 'How fast a crescent rotates, in degrees per second.'],
  arcAlpha:     ['Opacity', 'opacity', 'Crescent opacity.'],
  arcSweep:     ['Arc length', '°', 'How much of a full circle each crescent covers.'],
  arcThick:     ['Thickness', 'px', 'Stroke thickness of the crescent.'],

  flashSize:    ['Size', 'px', 'Diameter of the core flash at the contact point. 0 removes it.'],
  flashLife:    ['Lifetime', 'ms', 'How long that flash lasts.'],
  flashAlpha:   ['Opacity', 'opacity', 'Flash opacity.'],

  emberCount:   ['Count', undefined, 'How many embers the strike throws. 0 removes them.'],
  emberSpeed:   ['Speed', 'px/s', 'How fast embers fly out.'],
  emberSize:    ['Size', 'px', 'Size of each ember.'],
  emberLife:    ['Lifetime', 'ms', 'How long one ember lasts.'],
  emberSpread:  ['Spread', '°', 'Arc the embers cover. 360 throws them all around.'],
  emberGravity: ['Gravity', 'px', 'How far embers are pulled back down.'],

  bloodCount:   ['Droplet count', undefined, 'How many blood droplets fly. 0 removes them.'],
  bloodSpeed:   ['Speed', 'px/s', 'How fast droplets fly out.'],
  bloodSize:    ['Size', 'px', 'Size of each droplet.'],
  bloodLife:    ['Lifetime', 'ms', 'How long one droplet lasts.'],
  bloodSpread:  ['Spread', '°', 'Arc the droplets cover.'],
  bloodGravity: ['Gravity', 'px', 'How hard droplets are pulled down — usually harder than embers, so they arc.'],

  tailColor:    ['Crescent tail', undefined, 'Colour at the trailing end of the blade — the ramp starts here.'],
  midColor:     ['Crescent mid', undefined, 'Colour through the middle of the blade.'],
  tipColor:     ['Crescent tip', undefined, 'Colour at the leading tip — the hottest end of the ramp.'],
  flashColor:   ['Core flash', undefined, 'Colour of the contact flash.'],
  emberColor:   ['Embers', undefined, 'Colour of the embers.'],
  bloodColor:   ['Blood', undefined, 'Colour of the droplets.'],
};

const controls: TunerControl<Extract<keyof ExecuteFxConfig, string>>[] = [
  ...EXECUTEFX_GROUPS.flatMap((g) =>
    g.keys.map((key) => {
      const [label, unit, hint] = SPECS[key];
      const [min, max, step] = EXECUTEFX_RANGES[key];
      return { key, label, unit, hint, group: g.title, min, max, step };
    }),
  ),
  ...EXECUTEFX_COLOR_GROUPS.flatMap((g) =>
    g.keys.map((key) => {
      const [label, , hint] = SPECS[key];
      return {
        key: key as Extract<keyof ExecuteFxConfig, string>,
        label, hint, group: g.title, kind: 'color' as const, min: 0, max: 0, step: 0,
      };
    }),
  ),
];

export const SPEC: TunerSpec<ExecuteFxConfig> = {
  id: 'executefx',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Execute Strike',
  note: 'dev · read at fire time',
  read: getExecuteFxConfig,
  write: (key, value) => setExecuteFxValue(key, value),
  writeColor: (key, value) => setExecuteFxValue(key, value),
  reset: resetExecuteFxConfig,
  defaults: getExecuteFxDefaults(),
  controls,
  actions: [{
    label: '▶ Test strike',
    hint: 'Fires the strike at screen centre — no Execute kill needed.',
    run: () => pixiFx.testExecute(),
  }],
};

export function ExecuteFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
