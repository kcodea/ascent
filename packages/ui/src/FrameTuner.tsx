import { useEffect } from 'react';
import { createCssTunerStore } from './cssTunerStore';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the AUTHORED CARD FRAMES — the gold oval on minions and the purple square on spells (see
 * styles.css "AUTHORED FRAMES"). Every control is a CSS custom property scoped to the frame's class, applied live
 * through a `<style>` override, so dragging a slider reseats every card on screen at once. "Copy CSS" emits the
 * two paste-ready rules.
 *
 * THE TWO SECTIONS TUNE THE SAME KNOBS ON DIFFERENT ART, which is why the labels repeat. They are genuinely
 * independent: the oval and the square crop their art differently and seat their tier pip at different heights.
 * The old panel distinguished them by a subheading only; the section headings do that job now, and the keys are
 * prefixed so the two cannot cross-write.
 *
 * WHAT THE FRACTIONS ARE FRACTIONS OF was the panel's real legibility problem — "all Y 0.005" says nothing. They
 * are fractions of CARD HEIGHT (or width, for the spell window), so a nudge stays proportional as card scale
 * changes, and each hint now says so.
 *
 * Nothing here persists: a saved frame override that silently beat the shipped look is exactly the trap the
 * teardown-on-close exists to avoid.
 */
type FrameVals = Record<string, number | string>;

interface Knob {
  key: string;
  label: string;
  unit?: TunerUnit;
  hint: string;
  min: number; max: number; step: number;
  def: number;
  /** Whether the emitted CSS value carries a `%` — the var is consumed as a percentage. */
  pct?: boolean;
}

/** Shared by both frames. Defaults MIRROR the shipped values in styles.css — keep in sync when you bake numbers. */
const COMMON = (defs: Record<string, number>): Knob[] => [
  { key: 'sh',      label: 'Frame size',    unit: '×', hint: 'Size of the frame art, as a fraction of card height.', min: 0.5, max: 1.0, step: 0.01, def: defs.sh },
  { key: 'fill',    label: 'Art overfill',  unit: '×', hint: 'How much bigger than its window the card art is drawn, so no edge gap can show. 1 is an exact fit.', min: 1.0, max: 1.5, step: 0.01, def: defs.fill },
  { key: 'dy',      label: 'Whole frame Y', unit: '×', hint: 'Moves frame AND art together, as a fraction of card height. Use this to reseat the assembly; use the next one only to correct the frame against its art.', min: -0.1, max: 0.15, step: 0.005, def: defs.dy },
  { key: 'frameY',  label: 'Frame Y only',  unit: '×', hint: 'Moves the frame art alone, leaving the card art where it is — for correcting a frame that sits low against its own window.', min: -0.05, max: 0.15, step: 0.005, def: defs.frameY },
  { key: 'tier',    label: 'Tier pip seat', unit: '×', hint: 'How far down the frame the tier pip sits, as a fraction of card height.', min: 0.5, max: 1.0, step: 0.01, def: defs.tier },
  { key: 'artY',    label: 'Art framing',   unit: '%', hint: 'Which band of the card art the window shows: 0 crops to the top of the image, 100 to the bottom.', min: 0, max: 100, step: 1, def: defs.artY, pct: true },
  { key: 'artZoom', label: 'Art zoom',      unit: '×', hint: 'How far into the card art the window is zoomed.', min: 0.8, max: 1.8, step: 0.01, def: defs.artZoom },
];

const STD_KNOBS: Knob[] = [
  ...COMMON({ sh: 0.73, fill: 1.28, dy: 0.0, frameY: 0.03, tier: 0.83, artY: 60, artZoom: 1.12 }),
  { key: 'wardsize', label: 'Ward dome size', unit: '×', hint: 'Size of the Ward dome that stacks over this frame, as a fraction of card height.', min: 0.4, max: 1.2, step: 0.01, def: 1.2 },
  { key: 'wardy',    label: 'Ward dome Y',    unit: '%', hint: 'How far down the card that dome is centred.', min: 30, max: 80, step: 1, def: 46, pct: true },
  { key: 'fovl-a',   label: 'Tint strength',  unit: 'opacity', hint: 'Opacity of the colour overlay below. 0 leaves the frame art untinted.', min: 0, max: 1, step: 0.01, def: 0.76 },
];

const SPELL_KNOBS: Knob[] = [
  ...COMMON({ sh: 0.78, fill: 1.22, dy: -0.02, frameY: 0.02, tier: 0.67, artY: 48, artZoom: 1.02 }),
  { key: 'artRound', label: 'Window rounding', unit: '%', hint: 'How rounded the square art window’s corners are.', min: 0, max: 40, step: 1, def: 13, pct: true },
  { key: 'artAR',    label: 'Window height',   unit: '×', hint: 'Height of the art window, as a fraction of its width — the oval frame has no equivalent.', min: 0.6, max: 1.4, step: 0.01, def: 1.06 },
  { key: 'artW',     label: 'Window width',    unit: '×', hint: 'Width of the art window, as a fraction of the frame.', min: 0.6, max: 1.2, step: 0.01, def: 0.97 },
  { key: 'fovl-a',   label: 'Tint strength',   unit: 'opacity', hint: 'Opacity of the colour overlay below. 0 leaves the frame art untinted.', min: 0, max: 1, step: 0.01, def: 0.94 },
];

/**
 * The colour overlay (`.cframe-tint`) is masked to the frame PNG, so the blend mode decides what "recolour" even
 * means: multiply darkens and keeps the engraved shadows, overlay recolours while preserving highlights, screen
 * brightens, and color swaps hue and saturation while keeping luminosity — the truest "different metal".
 */
const BLENDS = ['normal', 'multiply', 'overlay', 'screen', 'color'] as const;
const BLEND_HINT = 'How the tint combines with the frame art. multiply darkens and keeps the engraved shadows; overlay recolours while preserving highlights; screen brightens; color swaps hue and saturation but keeps luminosity, which reads most like a different metal.';

const SECTIONS = [
  {
    id: 'std', title: 'Minion frame · gold oval', knobs: STD_KNOBS,
    sel: '.card.compact.stdframe',
    // Repeating the class raises specificity so the override beats the shipped rule whatever the source order.
    selBumped: '.card.compact.stdframe.stdframe',
    tint: '#655449', blend: 'overlay',
  },
  {
    id: 'spell', title: 'Spell frame · purple square', knobs: SPELL_KNOBS,
    sel: '.card.compact.spellframe',
    selBumped: '.card.compact.spellframe.spellframe',
    tint: '#66594d', blend: 'color',
  },
] as const;

const flat = (section: string, key: string): string => `${section}_${key}`;

const DEFAULTS: FrameVals = Object.fromEntries(SECTIONS.flatMap((s) => [
  ...s.knobs.map((k) => [flat(s.id, k.key), k.def] as const),
  [flat(s.id, 'tint'), s.tint] as const,
  [flat(s.id, 'blend'), s.blend] as const,
]));

const declLine = (section: string, knobs: Knob[], v: FrameVals): string =>
  knobs.map((k) => `--${k.key}: ${v[flat(section, k.key)]}${k.pct ? '%' : ''};`).join(' ');

/** `bumped` picks the specificity-raised selectors — used for the live override, not for what you paste back. */
const cssText = (v: FrameVals, bumped: boolean): string =>
  SECTIONS.map((s) =>
    `${bumped ? s.selBumped : s.sel} { ${declLine(s.id, s.knobs, v)} `
    + `--fovl: ${v[flat(s.id, 'tint')]}; --fovl-blend: ${v[flat(s.id, 'blend')]}; }`,
  ).join('\n');

const store = createCssTunerStore<FrameVals>({
  styleId: 'frametuner',
  defaults: DEFAULTS,
  css: (v) => cssText(v, true),
});

const controls: TunerControl<string>[] = SECTIONS.flatMap((s) => [
  ...s.knobs.map((k) => ({
    key: flat(s.id, k.key),
    label: k.label, unit: k.unit, hint: k.hint, group: s.title,
    min: k.min, max: k.max, step: k.step,
  })),
  {
    key: flat(s.id, 'tint'), label: 'Tint colour', group: s.title, kind: 'color' as const,
    hint: 'Colour of the overlay masked onto the frame art. Its strength is the slider above.',
    min: 0, max: 0, step: 0,
  },
  {
    key: flat(s.id, 'blend'), label: 'Tint blend', group: s.title, kind: 'select' as const,
    hint: BLEND_HINT, options: BLENDS, min: 0, max: 0, step: 0,
  },
]);

export const SPEC: TunerSpec<FrameVals> = {
  id: 'frame',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Frames',
  note: 'dev · live · session only',
  read: store.get,
  write: store.set,
  writeColor: store.set,
  reset: store.reset,
  defaults: DEFAULTS,
  controls,
  // Undoubled selectors: the doubling only exists to beat the very rules you are about to replace.
  copy: () => cssText(store.get(), false),
  copyLabel: 'Copy CSS',
};

export function FrameTuner(): JSX.Element {
  // The override lives only as long as the panel, so closing it restores the shipped frames.
  useEffect(store.mount, []);
  return <TunerPanel spec={SPEC} />;
}
