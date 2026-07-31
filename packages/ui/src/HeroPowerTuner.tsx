import {
  HPB_COLOR_KEYS, HPB_DEFAULTS, HPB_NUM_KEYS, HPB_RANGES,
  getHeroPowerBtnConfig, resetHeroPowerBtnConfig, setHeroPowerBtnValue, type HeroPowerBtnConfig,
} from './heroPowerBtnConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HERO POWER diamond — the middle-left mirror of the End Turn diamond. Position, scale,
 * the art inside the face window, and the face-hugging glow. Values persist to localStorage and apply live via
 * `--hpb-*` vars; shipping a look means pasting the JSON into DEFAULTS *and* mirroring position/scale/glow into
 * the styles.css `var(--hpb-*, …)` fallbacks.
 *
 * "Glow always on" is a declared PREVIEW SWITCH, not a config value — the glow only appears on hover or when
 * the power is ready, so its sliders are unusable without pinning it. It used to be a hand-rolled checkbox in
 * the same row markup as the real sliders, indistinguishable from them while writing nothing and persisting
 * nothing. The schema now separates the two, and the panel removes the pinned class when it closes.
 */
type NumKey = (typeof HPB_NUM_KEYS)[number];

const NUM: Record<NumKey, [string, TunerUnit | undefined, string, string]> = {
  x:              ['Horizontal offset', 'px', 'Offset from the stage-pinned base point on the board’s middle-left. Scales with the board.', 'Placement'],
  y:              ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down.', 'Placement'],
  scale:          ['Button size', '×', 'Overall size of the button.', 'Placement'],

  artX:           ['Horizontal nudge', 'px', 'Slides the power art inside the face window. The diamond clip stays put.', 'Power art'],
  artY:           ['Vertical nudge', 'px', 'Slides the power art vertically inside the face window.', 'Power art'],
  artScale:       ['Zoom', '×', 'Zooms the art inside the face window. The diamond clip stays put.', 'Power art'],
  artDim:         ['Opacity when unusable', 'opacity', 'Art opacity while the power is spent or unaffordable, so it fades against the dark face rather than the board. 1 never dims.', 'Power art'],
  refreshFlash:   ['Refresh flash', 'ms', 'The one-shot face bloom when the power comes back up. 0 disables it.', 'Power art'],

  glowBlur:       ['Softness', 'px', 'Blur radius of each glow pass.', 'Face glow'],
  glowAlpha:      ['Opacity', 'opacity', 'Peak glow opacity. 0 turns the glow off entirely.', 'Face glow'],
  glowStrength:   ['Intensity', undefined, 'How many times the shadow is stacked. Higher reads as a hotter rim.', 'Face glow'],
  glowPulse:      ['Breathing speed', 's', 'Seconds per full breathe cycle. 0 holds the glow steady.', 'Face glow'],
  glowPulseDepth: ['Breathing depth', 'opacity', 'How far the glow dips each cycle. 0 is none, 1 fades fully out.', 'Face glow'],
  glowX:          ['Horizontal alignment', 'px', 'Nudges the halo sideways so it sits square on the face.', 'Glow fit'],
  glowY:          ['Vertical alignment', 'px', 'Nudges the halo vertically.', 'Glow fit'],
  glowW:          ['Width fit', '×', 'Halo width relative to the face. Small corrections only — use softness and intensity for overall size.', 'Glow fit'],
  glowH:          ['Height fit', '×', 'Halo height relative to the face.', 'Glow fit'],
};

/**
 * Declaration order IS render order, and only ADJACENT controls sharing a group land under one heading. So the
 * glow colour has to sit with the other Face glow controls rather than being appended after Glow fit — doing
 * that produced a second "Face glow" heading further down the panel.
 */
const BEFORE_COLOUR: NumKey[] = [
  'x', 'y', 'scale',
  'artX', 'artY', 'artScale', 'artDim', 'refreshFlash',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth',
];
const AFTER_COLOUR: NumKey[] = ['glowX', 'glowY', 'glowW', 'glowH'];

const num = (key: NumKey): TunerControl<Extract<keyof HeroPowerBtnConfig, string>> => {
  const [label, unit, hint, group] = NUM[key];
  const [min, max, step] = HPB_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
};

const controls: TunerControl<Extract<keyof HeroPowerBtnConfig, string>>[] = [
  ...BEFORE_COLOUR.map(num),
  ...HPB_COLOR_KEYS.map((key) => ({
    key: key as Extract<keyof HeroPowerBtnConfig, string>,
    label: 'Colour', hint: 'Colour of the face glow.', min: 0, max: 0, step: 0,
    group: 'Face glow', kind: 'color' as const,
  })),
  ...AFTER_COLOUR.map(num),
];

export const SPEC: TunerSpec<HeroPowerBtnConfig> = {
  id: 'heropowerbtn',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Power Button',
  note: 'dev · live · recruit phase',
  read: getHeroPowerBtnConfig,
  write: (key, value) => setHeroPowerBtnValue(key, value),
  writeColor: (key, value) => setHeroPowerBtnValue(key, value),
  reset: resetHeroPowerBtnConfig,
  defaults: HPB_DEFAULTS,
  controls,
  toggles: [{
    id: 'hpbGlow',
    label: 'Glow always on',
    hint: 'Pins the hover/ready glow so its sliders can be tuned in any power state. Preview only — nothing is saved.',
    bodyClass: 'hpb-glow-preview',
  }],
};

export function HeroPowerTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
