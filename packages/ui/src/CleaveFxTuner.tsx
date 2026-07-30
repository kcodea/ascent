import {
  CLEAVEFX_COLOR_KEYS, CLEAVEFX_DEFAULTS, CLEAVEFX_RANGES,
  getCleaveFxConfig, resetCleaveFxConfig, setCleaveFxValue, type CleaveFxConfig,
} from './cleaveFxConfig';
import { pixiFx } from './pixiFx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the CLEAVE SLASH — the hit-stop and red gash a Cleave attacker plays on connection. At 44
 * controls this is the largest tuner after Execute Aura.
 *
 * TWO OF THESE CONTROLS CANNOT BE JUDGED FROM TEST. `hitStopMs` and `returnDelayMs` live in the LUNGE timeline,
 * not in the effect, so Test — which fires a gash at screen centre — cannot show them. They carry that caveat
 * individually; the old panel buried it in a doc comment nobody reads mid-tune.
 *
 * Test deliberately calls exactly what a real cleave calls, with the same dials, just centred on screen. Keep it
 * that way: a Test that took different arguments is precisely what made this panel lie in the past.
 *
 * The saved config is DEV-gated in `cleaveFxConfig`, so nothing dialled here can leak into a prod build.
 */
const COLOR_SET = new Set<string>(CLEAVEFX_COLOR_KEYS.map(String));

const LUNGE_ONLY =
  'Lives in the LUNGE timeline, not the effect — Test cannot show it. Only a real fight can.';

const SPECS: Record<keyof CleaveFxConfig, [string, TunerUnit | undefined, string, string, string?]> = {
  hitStopMs:     ['Hit-stop', 'ms', 'How long the attacker freezes at the moment of contact.', 'Feel', LUNGE_ONLY],
  returnDelayMs: ['Return delay', 'ms', 'How long the attacker waits before pulling back home.', 'Feel', LUNGE_ONLY],

  offsetX:       ['Horizontal offset', 'px', 'Nudges the whole gash sideways from the contact point.', 'Placement'],
  offsetY:       ['Vertical offset', 'px', 'Nudges the whole gash vertically.', 'Placement'],
  scale:         ['Overall size', '×', 'Scales the entire effect.', 'Placement'],
  spanPx:        ['Span', 'px', 'How wide an arc the rake covers.', 'Placement'],

  slashCount:    ['Claw count', undefined, 'How many parallel slashes the rake draws.', 'Rake'],
  slashSpacing:  ['Spacing', 'px', 'Gap between one slash and the next.', 'Rake'],
  slashWidth:    ['Width', 'px', 'Thickness of each slash.', 'Rake'],
  slashTaper:    ['Taper', 'opacity', 'How much each slash narrows toward its ends. 0 holds one width.', 'Rake'],
  slashTilt:     ['Tilt', '°', 'Angle of the whole rake.', 'Rake'],
  slashJitter:   ['Tilt jitter', '°', 'Random variation in each slash’s angle, so they do not look printed.', 'Rake'],
  slashBow:      ['Sag', 'px', 'How much each slash bows. Negative arcs the other way.', 'Rake'],
  slashStagger:  ['Stagger', 'ms', 'Delay between one slash appearing and the next.', 'Rake'],

  sweepMs:       ['Rake time', 'ms', 'How long the rake takes to draw across.', 'Timing'],
  holdMs:        ['Hold', 'ms', 'How long it holds at full before fading.', 'Timing'],
  fadeMs:        ['Fade', 'ms', 'How long the fade out takes.', 'Timing'],
  retract:       ['Retract vs dissolve', 'opacity', '0 dissolves the gash in place; 1 pulls it back the way it came.', 'Timing'],

  coreAlpha:     ['Core opacity', 'opacity', 'Opacity of the hot core of each slash.', 'Stroke'],
  glowWidth:     ['Glow width', '×', 'Thickness of the glow around each slash, relative to its width.', 'Stroke'],
  glowAlpha:     ['Glow opacity', 'opacity', 'Opacity of that glow.', 'Stroke'],

  clawLen:       ['Length', 'px', 'Length of the claw tip drawn at each slash end. 0 removes the tips.', 'Claw tips'],
  clawWidth:     ['Width', 'px', 'Thickness of each claw tip.', 'Claw tips'],
  clawRoot:      ['Root depth', 'px', 'How far back into the slash the tip is rooted.', 'Claw tips'],
  clawBulge:     ['Bulge position', 'opacity', 'Where along the tip its widest point sits. Low values bulge at the root.', 'Claw tips'],
  clawHook:      ['Hook', 'px', 'How far the tip curves. Negative hooks the other way.', 'Claw tips'],
  clawAlpha:     ['Opacity', 'opacity', 'Claw tip opacity.', 'Claw tips'],
  clawFadeMs:    ['Fade', 'ms', 'How long the tips take to fade, independently of the slashes.', 'Claw tips'],

  dripCount:     ['Drips per claw', undefined, 'How many blood drips fall from each slash. 0 removes them.', 'Blood drips'],
  dripSize:      ['Size', '×', 'Size of each drip.', 'Blood drips'],
  dripStretch:   ['Stretch', '×', 'How far a drip elongates as it falls.', 'Blood drips'],
  dripSpeed:     ['Initial speed', 'px/s', 'How fast a drip leaves the slash.', 'Blood drips'],
  dripGravity:   ['Gravity', 'px', 'How hard drips are pulled down.', 'Blood drips'],
  dripDrift:     ['Sideways drift', 'px', 'How far drips wander sideways as they fall.', 'Blood drips'],
  dripLife:      ['Lifetime', 'ms', 'How long one drip lasts.', 'Blood drips'],
  dripAlpha:     ['Opacity', 'opacity', 'Drip opacity.', 'Blood drips'],

  flashSize:     ['Size', 'px', 'Diameter of the flash at the contact point. 0 removes it.', 'Contact flash'],
  flashAlpha:    ['Opacity', 'opacity', 'Flash opacity.', 'Contact flash'],
  flashMs:       ['Time', 'ms', 'How long the flash lasts.', 'Contact flash'],

  colorCore:     ['Hot core', undefined, 'Colour of the hot centre of each slash.', 'Colours'],
  colorGlow:     ['Slash', undefined, 'Colour of the slash body and its glow.', 'Colours'],
  colorClaw:     ['Claw tip', undefined, 'Colour of the claw tips.', 'Colours'],
  colorDrip:     ['Blood drips', undefined, 'Colour of the drips.', 'Colours'],
  colorFlash:    ['Contact flash', undefined, 'Colour of the contact flash.', 'Colours'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof CleaveFxConfig)[] = [
  'hitStopMs', 'returnDelayMs',
  'offsetX', 'offsetY', 'scale', 'spanPx',
  'slashCount', 'slashSpacing', 'slashWidth', 'slashTaper', 'slashTilt', 'slashJitter', 'slashBow', 'slashStagger',
  'sweepMs', 'holdMs', 'fadeMs', 'retract',
  'coreAlpha', 'glowWidth', 'glowAlpha',
  'clawLen', 'clawWidth', 'clawRoot', 'clawBulge', 'clawHook', 'clawAlpha', 'clawFadeMs',
  'dripCount', 'dripSize', 'dripStretch', 'dripSpeed', 'dripGravity', 'dripDrift', 'dripLife', 'dripAlpha',
  'flashSize', 'flashAlpha', 'flashMs',
  'colorCore', 'colorGlow', 'colorClaw', 'colorDrip', 'colorFlash',
];

const controls: TunerControl<Extract<keyof CleaveFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group, note] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, note, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = CLEAVEFX_RANGES[key as keyof typeof CLEAVEFX_RANGES]!;
  return { key, label, unit, hint, group, note, min, max, step };
});

export const SPEC: TunerSpec<CleaveFxConfig> = {
  id: 'cleavefx',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Cleave Slash',
  note: 'dev · next cleave · drag',
  read: getCleaveFxConfig,
  write: (key, value) => setCleaveFxValue(key, value),
  writeColor: (key, value) => setCleaveFxValue(key, value),
  reset: resetCleaveFxConfig,
  defaults: CLEAVEFX_DEFAULTS,
  controls,
  actions: [{
    label: 'Test',
    hint: 'Fires a gash at screen centre with exactly the arguments a real cleave uses. The two Feel controls cannot be judged from this — they live in the lunge timeline.',
    // EXACTLY what a real cleave fires — same call, same dials, just centred on screen. Keep it that way.
    run: () => pixiFx.cleaveSlash(window.innerWidth / 2, window.innerHeight / 2),
  }],
};

export function CleaveFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
