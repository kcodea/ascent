import {
  ETB_COLOR_KEYS, ETB_DEFAULTS, ETB_RANGES,
  getEndTurnConfig, resetEndTurnConfig, setEndTurnValue, type EndTurnConfig,
} from './endTurnConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the standalone END TURN diamond — placement, the diamond-silhouette glow, the sheen, the
 * edge-lightning arcs, and the strike burst when it is hit. Position / scale / glow apply live through
 * `--etb-*` vars; the lightning values are read per-frame by the canvas loop. Shipping a look means pasting the
 * JSON into DEFAULTS *and* mirroring position / scale / glow into the styles.css fallbacks.
 *
 * THIS PANEL HAD THREE CHECKBOXES THAT WERE NOT THE SAME KIND OF THING, all wearing identical row markup:
 *   - "preview pressed" and "glow always on" are PREVIEW switches — panel-local, saving nothing, existing only
 *     so a transient state can be held still while its sliders are dragged.
 *   - "pressed art · cracked gem" is a REAL CONFIG VALUE. `pressedVariant` is stored as 2 or 3, picking which
 *     pressed art is used, and the panel rendered it as `checked ? 3 : 2` inline.
 * The schema now separates them: the first two are declared `toggles`, the third is a control of `kind:
 * 'toggle'` that declares both of its values, so the 2/3 mapping lives in the spec rather than in JSX.
 */
type ColorKey = (typeof ETB_COLOR_KEYS)[number];
type NumKey = Exclude<keyof EndTurnConfig, ColorKey>;

const COLOR_SET = new Set<string>(ETB_COLOR_KEYS);

/** `[label, unit, hint, group]` per key. Units are declared, never typed into the label. */
const SPECS: Record<keyof EndTurnConfig, [string, TunerUnit | undefined, string, string]> = {
  x:                ['Horizontal offset', 'px', 'Offset from the stage-pinned base point. Scales with the board.', 'Placement'],
  y:                ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down.', 'Placement'],
  scale:            ['Button size', '×', 'Overall size of the diamond.', 'Placement'],

  gemX:             ['Gem nudge X', 'px', 'Slide the gem overlay horizontally onto the baked gem.', 'Gem overlay'],
  gemY:             ['Gem nudge Y', 'px', 'Slide the gem overlay vertically onto the baked gem.', 'Gem overlay'],
  gemS:             ['Gem fit', '×', 'Size the gem overlay to sit exactly on the baked gem.', 'Gem overlay'],
  gemHoverBright:   ['Hover brightness', '×', 'How much the gem brightens while hovered.', 'Gem overlay'],

  glowBlur:         ['Softness', 'px', 'Blur radius of each glow pass.', 'Glow'],
  glowAlpha:        ['Opacity', 'opacity', 'Peak glow opacity. 0 turns the glow off.', 'Glow'],
  glowStrength:     ['Intensity', undefined, 'How many times the shadow is stacked. Higher reads as a hotter rim.', 'Glow'],
  glowPulse:        ['Breathing speed', 's', 'Seconds per full breathe cycle. 0 holds it steady.', 'Glow'],
  glowPulseDepth:   ['Breathing depth', 'opacity', 'How far the glow dips each cycle. 0 is none, 1 fades fully out.', 'Glow'],
  glowColor:        ['Colour', undefined, 'Colour of the glow.', 'Glow'],

  glowX:            ['Horizontal alignment', 'px', 'Nudges the halo so it sits square on the diamond.', 'Glow fit'],
  glowY:            ['Vertical alignment', 'px', 'Nudges the halo vertically.', 'Glow fit'],
  glowW:            ['Width fit', '×', 'Halo width relative to the diamond. Small corrections only.', 'Glow fit'],
  glowH:            ['Height fit', '×', 'Halo height relative to the diamond.', 'Glow fit'],

  sheenCycle:       ['Sweep interval', 's', 'Seconds between one sheen sweep across the gem and the next.', 'Sheen'],
  sheenAlpha:       ['Sweep strength', 'opacity', 'How bright the sheen reads as it passes.', 'Sheen'],

  boltRate:         ['Arcs per second', undefined, 'How often lightning spawns along the edges. 0 disables lightning.', 'Edge lightning'],
  boltScale:        ['Arc length', '×', 'Arc length as a fraction of one diamond edge.', 'Edge lightning'],
  boltMag:          ['Jitter', 'px', 'How violently an arc deviates from the edge it follows.', 'Edge lightning'],
  boltWidth:        ['Stroke width', 'px', 'Thickness of each arc.', 'Edge lightning'],
  boltLife:         ['Arc lifetime', 'ms', 'How long one arc lasts before fading.', 'Edge lightning'],
  boltAlpha:        ['Opacity', 'opacity', 'Arc opacity.', 'Edge lightning'],
  boltColor:        ['Colour', undefined, 'Colour of the lightning arcs.', 'Edge lightning'],

  strikeBolts:      ['Arc burst', undefined, 'How many arcs burst out the instant the button is hit.', 'Strike'],
  strikeFlash:      ['Gem flash', 'ms', 'Duration of the white-hot gem flash. 0 disables it.', 'Strike'],
  strikeDustCount:  ['Dust amount', '×', 'Size of the dirt and smoke billow, relative to the combat impact dust. 0 disables it.', 'Strike'],
  strikeDustSize:   ['Dust size', '×', 'Size of each puff.', 'Strike'],
  strikeDustLife:   ['Dust lifetime', '×', 'How long the billow hangs.', 'Strike'],
  strikeRings:      ['Ripple rings', undefined, 'How many ripple rings the strike throws. 0 disables them.', 'Strike'],
  strikeRingRadius: ['Ripple size', '×', 'How far a ripple expands.', 'Strike'],
  strikeRingLife:   ['Ripple lifetime', '×', 'How long a ripple takes to expand and fade.', 'Strike'],

  pressedVariant:   ['Cracked gem art', undefined, 'Which pressed art the button uses once the turn is ended — the cracked gem, or the plainer dulled one.', 'Pressed art'],
};

/**
 * Declaration order IS render order, and only ADJACENT controls sharing a group merge into one heading — so
 * each colour is listed inside its own group's run rather than collected at the end, as the old panel did.
 */
const ORDER: (keyof EndTurnConfig)[] = [
  'x', 'y', 'scale',
  'gemX', 'gemY', 'gemS', 'gemHoverBright',
  'glowBlur', 'glowAlpha', 'glowStrength', 'glowPulse', 'glowPulseDepth', 'glowColor',
  'glowX', 'glowY', 'glowW', 'glowH',
  'sheenCycle', 'sheenAlpha',
  'boltRate', 'boltScale', 'boltMag', 'boltWidth', 'boltLife', 'boltAlpha', 'boltColor',
  'strikeBolts', 'strikeFlash', 'strikeDustCount', 'strikeDustSize', 'strikeDustLife',
  'strikeRings', 'strikeRingRadius', 'strikeRingLife',
  'pressedVariant',
];

const controls: TunerControl<Extract<keyof EndTurnConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) {
    return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  }
  const [min, max, step] = ETB_RANGES[key as NumKey];
  if (key === 'pressedVariant') {
    // Stored as a number (2 or 3), not a boolean — the spec carries the mapping.
    return { key, label, hint, group, kind: 'toggle' as const, min, max, step,
      onValue: 3, offValue: 2, onOffLabels: ['cracked', 'dulled'] as [string, string] };
  }
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<EndTurnConfig> = {
  id: 'endturnbtn',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'End Turn Button',
  note: 'dev · live · recruit phase',
  read: getEndTurnConfig,
  write: (key, value) => setEndTurnValue(key, value),
  writeColor: (key, value) => setEndTurnValue(key, value),
  reset: resetEndTurnConfig,
  defaults: ETB_DEFAULTS,
  controls,
  toggles: [
    {
      id: 'etbPressed',
      label: 'Preview pressed',
      hint: 'Shows the pressed art without ending the turn. Preview only; nothing is saved.',
      bodyClass: 'etb-pressed-preview',
      defaultOn: false,
    },
    {
      id: 'etbGlow',
      label: 'Glow always on',
      hint: 'Pins the hover-only glow so its sliders can be dialled without holding hover. Preview only; nothing is saved.',
      bodyClass: 'etb-glow-preview',
      defaultOn: true,
    },
  ],
};

export function EndTurnTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
