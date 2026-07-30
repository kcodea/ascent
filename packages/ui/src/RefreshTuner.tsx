import {
  RFB_COLOR_KEYS, RFB_DEFAULTS, RFB_RANGES,
  getRefreshConfig, resetRefreshConfig, setRefreshValue, type RefreshConfig,
} from './refreshConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the REFRESH crystal. Mirrors the Tavern Up tuner dial-for-dial minus the gem/pip seats,
 * which do not exist on a single-piece art: placement, the label pill and cost-coin seats, the hover glow, the
 * sheen sweep, the click shine / dust / blast, and the disabled dim — all live via `--rfb-*` vars. Shipping a
 * look means pasting the JSON into DEFAULTS *and* mirroring it into the styles.css fallbacks.
 *
 * The press spin and shockwave rings were dropped in 2026-07 (owner), so those dials are absent rather than
 * sitting at 0 — worth knowing before wondering where they went.
 *
 * WHY THIS FILE IS SHAPED DIFFERENTLY from the earlier migrations: it has five colour controls spread across
 * four different groups (cost coin, hover glow, click shine, blast). The previous panels split their keys into
 * hand-maintained "before the colour" and "after the colour" arrays, which does not survive that. Here ONE
 * ordered list holds every key and the kind is derived from whether the key is a colour. That is the pattern
 * the remaining panels should follow.
 *
 * Note the original rendered every colour in a block at the very bottom, so "cost coin · colour" sat nowhere
 * near "cost coin · x / y / size". Each colour now sits in its own section.
 */
type ColorKey = (typeof RFB_COLOR_KEYS)[number];
type NumKey = Exclude<keyof RefreshConfig, ColorKey>;

const COLOR_SET = new Set<string>(RFB_COLOR_KEYS);

/** `[label, unit, hint, group]` per key. Units are declared, never typed into the label. */
const SPECS: Record<keyof RefreshConfig, [string, TunerUnit | undefined, string, string]> = {
  x:              ['Horizontal offset', 'px', 'Offset from the stage-pinned base point. Scales with the board.', 'Placement'],
  y:              ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down.', 'Placement'],
  scale:          ['Button size', '×', 'Overall size of the button.', 'Placement'],

  labelY:         ['Vertical position', 'px', 'Where the label pill sits relative to the crystal.', 'Label pill'],
  labelS:         ['Size', '×', 'Size of the label pill.', 'Label pill'],

  costX:          ['Horizontal position', 'px', 'Nudges the cost coin sideways.', 'Cost coin'],
  costY:          ['Vertical position', 'px', 'Nudges the cost coin vertically.', 'Cost coin'],
  costS:          ['Size', '×', 'Size of the cost coin.', 'Cost coin'],
  costColor:      ['Colour', undefined, 'Cost coin colour when the refresh costs Gold.', 'Cost coin'],
  costFreeColor:  ['Colour when free', undefined, 'Cost coin colour when the refresh is free, so free reads differently at a glance.', 'Cost coin'],

  glowBlur:       ['Softness', 'px', 'Blur radius of each glow pass.', 'Hover glow'],
  glowAlpha:      ['Opacity', 'opacity', 'Peak glow opacity. 0 turns the glow off.', 'Hover glow'],
  glowStrength:   ['Intensity', undefined, 'How many times the shadow is stacked. Higher reads as a hotter rim.', 'Hover glow'],
  glowPulse:      ['Breathing speed', 's', 'Seconds per full breathe cycle. 0 holds it steady.', 'Hover glow'],
  glowPulseDepth: ['Breathing depth', 'opacity', 'How far the glow dips each cycle. 0 is none, 1 fades fully out.', 'Hover glow'],
  glowColor:      ['Colour', undefined, 'Colour of the hover glow.', 'Hover glow'],

  glowW:          ['Width fit', '×', 'Halo width relative to the crystal. Small corrections only.', 'Glow fit'],
  glowH:          ['Height fit', '×', 'Halo height relative to the crystal.', 'Glow fit'],

  sheenCycle:     ['Sweep interval', 's', 'Seconds between one sheen sweep across the crystal and the next.', 'Sheen'],
  sheenAlpha:     ['Sweep strength', 'opacity', 'How bright the sheen reads as it passes.', 'Sheen'],

  shineMs:        ['Duration', 'ms', 'How long the shine flare lasts after a click.', 'Click shine'],
  shineAlpha:     ['Opacity', 'opacity', 'Peak brightness of the flare.', 'Click shine'],
  shineSize:      ['Spread', '×', 'How far the flare spreads from the crystal.', 'Click shine'],
  shineBlur:      ['Softness', 'px', 'Blur radius of the flare.', 'Click shine'],
  shineColor:     ['Colour', undefined, 'Colour of the click flare.', 'Click shine'],

  dustCount:      ['Amount', '×', 'How much dust a click kicks up.', 'Click dust'],
  dustSize:       ['Size', '×', 'Size of each dust puff.', 'Click dust'],
  dustLife:       ['Lifetime', '×', 'How long the dust lingers.', 'Click dust'],

  blastCount:     ['Shard count', undefined, 'How many shards a click throws. 0 disables the blast.', 'Click blast'],
  blastSpeed:     ['Speed', 'px/s', 'How fast the shards fly outward.', 'Click blast'],
  blastSpread:    ['Spread variance', undefined, 'How much the shard directions vary. 0 fires them in a uniform ring.', 'Click blast'],
  blastLife:      ['Lifetime', 'ms', 'How long a shard lasts before fading.', 'Click blast'],
  blastSize:      ['Shard size', '×', 'Size of each shard.', 'Click blast'],
  blastColor:     ['Colour', undefined, 'Colour of the shards.', 'Click blast'],

  artDim:         ['Art dim when disabled', 'opacity', 'Crystal opacity while a refresh is unaffordable. 1 never dims.', 'Disabled state'],
};

/**
 * Declaration order IS render order, and only ADJACENT controls sharing a group merge into one heading — so
 * every colour is listed inside its own group's run rather than collected at the end.
 */
const ORDER: (keyof RefreshConfig)[] = [
  'x', 'y', 'scale',
  'labelY', 'labelS',
  'costX', 'costY', 'costS', 'costColor', 'costFreeColor',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth', 'glowColor',
  'glowW', 'glowH',
  'sheenCycle', 'sheenAlpha',
  'shineMs', 'shineAlpha', 'shineSize', 'shineBlur', 'shineColor',
  'dustCount', 'dustSize', 'dustLife',
  'blastCount', 'blastSpeed', 'blastSpread', 'blastLife', 'blastSize', 'blastColor',
  'artDim',
];

const controls: TunerControl<Extract<keyof RefreshConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) {
    return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  }
  const [min, max, step] = RFB_RANGES[key as NumKey];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<RefreshConfig> = {
  id: 'refreshbtn',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Refresh',
  note: 'dev · live · hover/press it',
  read: getRefreshConfig,
  write: (key, value) => setRefreshValue(key, value),
  writeColor: (key, value) => setRefreshValue(key, value),
  reset: resetRefreshConfig,
  defaults: RFB_DEFAULTS,
  controls,
  toggles: [{
    id: 'rfbGlow',
    label: 'Glow always on',
    hint: 'Pins the hover-only glow onto the resting button so its sliders can be dialled — one pointer cannot both hold hover and drag. Preview only; nothing is saved.',
    bodyClass: 'rfb-glow-preview',
    defaultOn: false,
  }],
};

export function RefreshTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
