import {
  CRITFX_COLOR_KEYS, CRITFX_DEFAULTS, CRITFX_RANGES,
  getCritFxConfig, resetCritFxConfig, setCritFxValue, type CritFxConfig,
} from './critFxConfig';
import { pixiFx } from './pixiFx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the CRITICAL STRIKE flourish — an amplified core and shockwave, a bold ring, a spark burst,
 * the "CRIT!" pop, a red flash on the defender, and a board shake. Applies to the NEXT crit; watch a fight with
 * Commander Impala to judge, or use Test.
 *
 * "Crit power" is a master dial that amplifies the whole package, which is why it sits alone at the top.
 *
 * The two SHAKE controls are the odd ones out: they drive a CSS animation on the board rather than anything Pixi
 * draws, so they are grouped separately. Their old labels admitted this with a "(CSS)" suffix — that belongs in a
 * hint, not in the name.
 *
 * This panel mirrors the `crit-preview.html` rig one-for-one; change one, change the other.
 */
const COLOR_SET = new Set<string>(CRITFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof CritFxConfig, [string, TunerUnit | undefined, string, string]> = {
  critPower:      ['Crit power', '×', 'Master amplification for the whole crit package.', 'Overall'],

  flashSize:      ['Flash size', '×', 'Size of the core flash at the point of contact.', 'Core'],
  shockwaveSize:  ['Shockwave size', '×', 'Size of the expanding shockwave.', 'Core'],
  colorCore:      ['Core colour', undefined, 'Colour of the core flash.', 'Core'],
  colorShock:     ['Shockwave colour', undefined, 'Colour of the shockwave.', 'Core'],

  ringSize:       ['Ring size', 'px', 'How far the bold ring expands.', 'Ring'],
  ringWidth:      ['Ring thickness', 'px', 'Thickness of the ring.', 'Ring'],
  ringMs:         ['Ring time', 'ms', 'How long the ring takes to expand and fade.', 'Ring'],
  colorRing:      ['Colour', undefined, 'Colour of the ring.', 'Ring'],

  sparkCount:     ['Count', undefined, 'How many sparks the crit throws. 0 removes them.', 'Sparks'],
  sparkSpeed:     ['Speed', 'px/s', 'How fast the sparks fly out.', 'Sparks'],
  sparkLife:      ['Lifetime', 'ms', 'How long one spark lasts.', 'Sparks'],
  sparkSize:      ['Size', 'px', 'Size of each spark.', 'Sparks'],
  sparkSpread:    ['Spread', '°', 'Arc the sparks cover. 360 throws them all around.', 'Sparks'],
  colorSpark1:    ['Hue slot 1', undefined, 'First of three hues cycled across the sparks.', 'Sparks'],
  colorSpark2:    ['Hue slot 2', undefined, 'Second of three hues cycled across the sparks.', 'Sparks'],
  colorSpark3:    ['Hue slot 3', undefined, 'Third of three hues cycled across the sparks.', 'Sparks'],

  textSize:       ['Size', 'px', 'Size of the "CRIT!" text.', 'CRIT! text'],
  textRise:       ['Rise', 'px', 'How far the text drifts up before fading.', 'CRIT! text'],
  textMs:         ['Time on screen', 'ms', 'How long the text lasts.', 'CRIT! text'],
  textPop:        ['Pop overshoot', '×', 'How far past full size the text punches on entry.', 'CRIT! text'],
  colorText:      ['Fill colour', undefined, 'Fill colour of the text.', 'CRIT! text'],
  colorTextEdge:  ['Edge colour', undefined, 'Outline colour of the text.', 'CRIT! text'],

  cardFlashAlpha: ['Flash opacity', 'opacity', 'How strongly the struck card flashes red.', 'Defender'],
  cardFlashMs:    ['Flash time', 'ms', 'How long that flash lasts.', 'Defender'],

  shakePx:        ['Shake distance', 'px', 'How far the board shakes. Drives a CSS animation rather than anything Pixi draws. 0 removes the shake.', 'Board shake'],
  shakeMs:        ['Shake time', 'ms', 'How long the shake lasts. Also CSS-driven.', 'Board shake'],
};

/** Declaration order IS render order; each colour sits inside its own group's run. */
const ORDER: (keyof CritFxConfig)[] = [
  'critPower',
  'flashSize', 'shockwaveSize', 'colorCore', 'colorShock',
  'ringSize', 'ringWidth', 'ringMs', 'colorRing',
  'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'sparkSpread', 'colorSpark1', 'colorSpark2', 'colorSpark3',
  'textSize', 'textRise', 'textMs', 'textPop', 'colorText', 'colorTextEdge',
  'cardFlashAlpha', 'cardFlashMs',
  'shakePx', 'shakeMs',
];

const controls: TunerControl<Extract<keyof CritFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = CRITFX_RANGES[key as keyof typeof CRITFX_RANGES]!;
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<CritFxConfig> = {
  id: 'critfx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Critical Strike',
  note: 'dev · next crit · drag',
  read: getCritFxConfig,
  write: (key, value) => setCritFxValue(key, value),
  writeColor: (key, value) => setCritFxValue(key, value),
  reset: resetCritFxConfig,
  defaults: CRITFX_DEFAULTS,
  controls,
  actions: [{ label: '⚡ Test', hint: 'Fires the crit flourish once on the board.', run: () => pixiFx.testCrit() }],
};

export function CritFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
