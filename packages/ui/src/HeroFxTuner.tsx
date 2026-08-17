import { HFX_DEFAULTS, HFX_NUM_KEYS, HFX_RANGES, getHeroFxConfig, resetHeroFxConfig, setHeroFxValue, type HeroFxConfig } from './heroFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the two hero card treatments — Cia's Enchanted glow and Sable's Soulbind ring.
 *
 * Both LOOP, so the dials are limited to shape / colour / period: the shadows stay STATIC and only `opacity`
 * animates, per docs/performance.md. There is deliberately no "animate the shadow" control — it would be a
 * slider whose whole job is to make the game drop frames.
 */
const SPECS: Record<(typeof HFX_NUM_KEYS)[number], [string, TunerUnit | undefined, string]> = {
  encInset:  ['Bar inset', undefined, 'How far the glow bar is inset from each side of the card (%). Lower = wider.'],
  encY:      ['Bar offset Y', 'px', 'Vertical offset from the bottom edge of the card. Positive = further down.'],
  encH:      ['Bar thickness', 'px', 'How thick the glow bar is.'],
  encBlur:   ['Halo blur', 'px', 'Blur of the bloom around the bar. Bigger = softer.'],
  encSpread: ['Halo spread', 'px', 'How far the bloom reaches before it fades out.'],
  encHue:    ['Hue', undefined, 'Colour of the glow (deg). 0 is red.'],
  encDip:    ['Breathe depth', undefined, 'How faint the glow gets at the bottom of its breathe. 1 = no dip.'],
  encPeriod: ['Breathe period', 's', 'Seconds per breathe. Bigger = calmer.'],
  sbSize:    ['Ring size', 'px', 'Diameter of the ring above a bound minion.'],
  sbY:       ['Ring height', 'px', 'How far above the top edge of the card the ring floats.'],
  sbRing:    ['Ring thickness', 'px', 'Stroke width of the ring.'],
  sbBlur:    ['Ring halo blur', 'px', 'Blur of the glow around the ring.'],
  sbHue:     ['Ring hue', undefined, 'Colour of the ring (deg). Around 275 is purple.'],
  sbDip:     ['Ring breathe depth', undefined, 'How faint the ring gets at the bottom of its breathe.'],
  sbPeriod:  ['Ring breathe period', 's', 'Seconds per breathe.'],
};

const controls: TunerControl<Extract<keyof HeroFxConfig, string>>[] = HFX_NUM_KEYS.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = HFX_RANGES[key];
  const group = key.startsWith('enc') ? 'Cia: Enchanted glow' : 'Sable: Soulbind ring';
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HeroFxConfig> = {
  id: 'herofx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Card FX',
  note: 'dev · live · drag',
  read: getHeroFxConfig,
  write: setHeroFxValue,
  reset: resetHeroFxConfig,
  defaults: HFX_DEFAULTS,
  controls,
};

export function HeroFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
