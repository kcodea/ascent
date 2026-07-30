import {
  TVB_COLOR_KEYS, TVB_DEFAULTS, TVB_RANGES,
  getTavernUpConfig, resetTavernUpConfig, setTavernUpValue, type TavernUpConfig,
} from './tavernUpConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the TAVERN UP stone button — placement, the gem / tier-pip / cost-coin seats, the hover
 * glow, the sheen sweep, the press effects, and the disabled dim. All live via `--tvb-*` vars. Shipping a look
 * means pasting the JSON into DEFAULTS *and* mirroring it into the styles.css fallbacks.
 *
 * "Glow always on" is a declared preview switch: the glow only exists on hover, and one pointer cannot both
 * hold hover and drag a slider.
 *
 * A BUG FIXED IN PASSING. This panel called `useDraggablePanel('tavernup')` while DevMenu registered it as
 * `tavernupbtn`. The hook injects the ✕ button and closes by that key, so the ✕ called `close('tavernup')`
 * against a set holding `tavernupbtn` — meaning the close button did nothing at all, and the panel could only
 * be dismissed by toggling it off in the menu. Verified against a control panel whose keys agreed. The id below
 * is now the menu's key. One consequence: this panel's remembered SIZE was stored under the old key, so it
 * opens at the default width once and then remembers again.
 */
type NumKey = Exclude<keyof TavernUpConfig, 'glowColor'>;

const NUM: Record<NumKey, [string, TunerUnit | undefined, string, string]> = {
  x:              ['Horizontal offset', 'px', 'Offset from the stage-pinned base point. Scales with the board.', 'Placement'],
  y:              ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down.', 'Placement'],
  scale:          ['Button size', '×', 'Overall size of the button.', 'Placement'],

  gemX:           ['Gem · horizontal', 'px', 'Nudges the gem within the stone face.', 'Face parts'],
  gemY:           ['Gem · vertical', 'px', 'Nudges the gem vertically.', 'Face parts'],
  gemS:           ['Gem · size', '×', 'Size of the gem.', 'Face parts'],
  pipX:           ['Tier pips · horizontal', 'px', 'Nudges the tier pips sideways.', 'Face parts'],
  pipY:           ['Tier pips · vertical', 'px', 'Nudges the tier pips vertically.', 'Face parts'],
  pipS:           ['Tier pips · size', '×', 'Size of the tier pips.', 'Face parts'],
  costX:          ['Cost coin · horizontal', 'px', 'Nudges the cost coin sideways.', 'Face parts'],
  costY:          ['Cost coin · vertical', 'px', 'Nudges the cost coin vertically.', 'Face parts'],
  costS:          ['Cost coin · size', '×', 'Size of the cost coin.', 'Face parts'],

  glowBlur:       ['Softness', 'px', 'Blur radius of each glow pass.', 'Hover glow'],
  glowAlpha:      ['Opacity', 'opacity', 'Peak glow opacity. 0 turns the glow off.', 'Hover glow'],
  glowStrength:   ['Intensity', undefined, 'How many times the shadow is stacked. Higher reads as a hotter rim.', 'Hover glow'],
  glowPulse:      ['Breathing speed', 's', 'Seconds per full breathe cycle. 0 holds it steady.', 'Hover glow'],
  glowPulseDepth: ['Breathing depth', 'opacity', 'How far the glow dips each cycle. 0 is none, 1 fades fully out.', 'Hover glow'],

  glowX:          ['Horizontal alignment', 'px', 'Nudges the halo so it sits square on the face.', 'Glow fit'],
  glowY:          ['Vertical alignment', 'px', 'Nudges the halo vertically.', 'Glow fit'],
  glowW:          ['Width fit', '×', 'Halo width relative to the face. Small corrections only.', 'Glow fit'],
  glowH:          ['Height fit', '×', 'Halo height relative to the face.', 'Glow fit'],

  sheenCycle:     ['Sweep interval', 's', 'Seconds between one sheen sweep across the stone and the next.', 'Sheen'],
  sheenAlpha:     ['Sweep strength', 'opacity', 'How bright the sheen reads as it passes.', 'Sheen'],

  flashMs:        ['Flash', 'ms', 'The one-shot face bloom on press. 0 disables it.', 'Press'],
  dustCount:      ['Dust amount', '×', 'How much dust the press kicks up.', 'Press'],
  dustSize:       ['Dust size', '×', 'Size of each dust puff.', 'Press'],
  dustLife:       ['Dust lifetime', '×', 'How long the dust lingers.', 'Press'],
  rings:          ['Shockwave rings', undefined, 'How many rings the press throws. 0 disables the shockwave.', 'Press'],
  ringRadius:     ['Ring radius', '×', 'How far a ring expands.', 'Press'],
  ringLife:       ['Ring lifetime', '×', 'How long a ring takes to expand and fade.', 'Press'],

  artDim:         ['Gem dim when disabled', 'opacity', 'Gem opacity while the upgrade is unaffordable. 1 never dims.', 'Disabled state'],
};

/**
 * Declaration order IS render order, and only ADJACENT controls sharing a group merge into one heading — so the
 * glow colour sits inside the Hover glow run rather than being appended at the end.
 */
const BEFORE_COLOUR: NumKey[] = [
  'x', 'y', 'scale',
  'gemX', 'gemY', 'gemS', 'pipX', 'pipY', 'pipS', 'costX', 'costY', 'costS',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
];
const AFTER_COLOUR: NumKey[] = [
  'glowX', 'glowY', 'glowW', 'glowH',
  'sheenCycle', 'sheenAlpha',
  'flashMs', 'dustCount', 'dustSize', 'dustLife', 'rings', 'ringRadius', 'ringLife',
  'artDim',
];

const num = (key: NumKey): TunerControl<Extract<keyof TavernUpConfig, string>> => {
  const [label, unit, hint, group] = NUM[key];
  const [min, max, step] = TVB_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
};

const controls: TunerControl<Extract<keyof TavernUpConfig, string>>[] = [
  ...BEFORE_COLOUR.map(num),
  ...TVB_COLOR_KEYS.map((key) => ({
    key: key as Extract<keyof TavernUpConfig, string>,
    label: 'Colour', hint: 'Colour of the hover glow.', min: 0, max: 0, step: 0,
    group: 'Hover glow', kind: 'color' as const,
  })),
  ...AFTER_COLOUR.map(num),
];

export const SPEC: TunerSpec<TavernUpConfig> = {
  id: 'tavernupbtn',                // matches DevMenu's key — see the note above; they must agree
  title: 'Tavern Up',
  note: 'dev · live · hover/press it',
  read: getTavernUpConfig,
  write: (key, value) => setTavernUpValue(key, value),
  writeColor: (key, value) => setTavernUpValue(key, value),
  reset: resetTavernUpConfig,
  defaults: TVB_DEFAULTS,
  controls,
  toggles: [{
    id: 'tvbGlow',
    label: 'Glow always on',
    hint: 'Pins the hover-only glow onto the resting button so its sliders can be dialled — one pointer cannot both hold hover and drag. Preview only; nothing is saved.',
    bodyClass: 'tvb-glow-preview',
    defaultOn: false,
  }],
};

export function TavernUpTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
