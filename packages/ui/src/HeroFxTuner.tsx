import { HFX_DEFAULTS, HFX_NUM_KEYS, HFX_RANGES, getHeroFxConfig, resetHeroFxConfig, setHeroFxValue, type HeroFxConfig } from './heroFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the two hero card treatments — Cia's circling Enchanted rings and Sable's Soulbind ring.
 *
 * Both LOOP, so the dials are limited to shape / colour / period: only `transform` and `opacity` animate, per
 * docs/performance.md. There is deliberately no control that animates a shadow, blur or filter — it would be a
 * slider whose whole job is to make the game drop frames.
 */
const SPECS: Record<(typeof HFX_NUM_KEYS)[number], [string, TunerUnit | undefined, string]> = {
  encInset:  ['Ring inset', 'px', 'How far the ring sits from the card edges. Negative pushes it outwards.'],
  encH:      ['Ring thickness', 'px', 'Stroke width of the circling ring.'],
  encBlur:   ['Link softness', 'px', 'Blur on the links. 0 is crisp, higher smears them into a glow.'],
  encHue:    ['Hue', undefined, 'Colour of the links (deg). Around 2 is red; the hot core runs +40 toward gold.'],
  encDip:    ['Second ring opacity', undefined, 'How strongly the counter-rotating ring reads.'],
  encPeriod: ['Rotation period', 's', 'Seconds per full turn of the first ring. Bigger = slower.'],
  encSkew:   ['Second ring slowdown', '×', 'How much slower the counter-rotating ring turns.'],
  encLinks:  ['Link count', undefined, 'How many links circle the card on each ring.'],
  encArc:    ['Link length', undefined, 'Angular length of each link (deg). Small = dots, large = long arcs.'],
  encShape:  ['Link edge', undefined, 'Shape of a link: 0 is soft and feathered, 1 is a hard-edged block.'],
  sbSize:    ['Ring size', 'px', 'Diameter of the ring under a bound minion.'],
  sbY:       ['Ring drop', 'px', 'How far below the bottom edge of the card the ring sits.'],
  sbRing:    ['Ring thickness', 'px', 'Stroke width of the ring.'],
  sbBlur:    ['Ring halo blur', 'px', 'Blur of the glow around the ring.'],
  sbHue:     ['Ring hue', undefined, 'Colour of the ring (deg). Around 275 is purple.'],
  sbDip:     ['Ring breathe depth', undefined, 'How faint the ring gets at the bottom of its breathe.'],
  sbPeriod:  ['Ring breathe period', 's', 'Seconds per breathe.'],
  sbWeb:       ['Web opacity', undefined, 'How visible the spiderweb fill inside the ring is. 0 turns it off.'],
  sbWebSpokes: ['Web spokes', undefined, 'How many radial threads the web has.'],
  sbWebRings:  ['Web rings', undefined, 'How many concentric threads the web has.'],
  sbBuild:     ['Web build time', 'ms', 'How fast the web spins out from the centre when the bond is forged. One-shot.'],
  sbFlash:     ['Bind flash time', 'ms', 'How long the purple flash on each bound unit lasts. One-shot.'],
  ciaFoilOpacity:   ['Foil opacity', undefined, 'How visible the holographic foil is inside its mask.'],
  ciaHoverBoost:    ['Hover boost', '×', 'How much brighter the whole treatment reads while hovered.'],
  ciaFoilPeriod:    ['Foil drift period', 's', 'Seconds per drift cycle. Slow reads as reflected light.'],
  ciaSweepPeriod:   ['Sweep period', 's', 'Seconds between diagonal light passes.'],
  ciaSweepDuration: ['Sweep duration', 's', 'How long one visible pass lasts. Keep under the period.'],
  ciaSweepAngle:    ['Sweep angle', undefined, 'Direction in degrees. Negative runs bottom-left to top-right.'],
  ciaSweepWidth:    ['Sweep width', undefined, 'Width of the reflective band, in card widths.'],
  ciaHaloOpacity:   ['Halo opacity', undefined, 'How visible the segmented outer contour is.'],
  ciaHaloPeriod:    ['Halo period', 's', 'Seconds per full rotation of the contour.'],
  ciaHaloInset:     ['Halo inset', 'px', 'How far outside the card the contour sits. Negative pushes it out.'],
  ciaGlintCount:    ['Glint count', undefined, 'How many sparks may be lit at once.'],
  ciaGlintSize:     ['Glint size', 'px', 'Size of each spark.'],
  ciaSealSize:      ['Seal size', 'px', 'Size of the enchanted seal near the top of the card.'],
};

const controls: TunerControl<Extract<keyof HeroFxConfig, string>>[] = HFX_NUM_KEYS.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = HFX_RANGES[key];
  const group = key.startsWith('cia') ? 'Cia: Enchanted foil'
    : key.startsWith('enc') ? 'Cia: CSS fallback (no WebGL / reduced motion)'
    : 'Sable: Soulbind ring';
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
