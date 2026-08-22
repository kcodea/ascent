import { TITLE_COLOR_KEYS, TITLE_DEFAULTS, TITLE_DESC, TITLE_FONTS, TITLE_RANGES, getTitleConfig, resetTitleConfig, setTitleValue, type TitleConfig } from './titleConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the main-menu TITLE LOGO — the peak mark + ASCENT wordmark. Dials placement, the wordmark
 * FONT (a curated quick-pick of Google Fonts, or any family typed into the custom field), separate GLOWS for
 * the text and the mark, and a FLOAT that bobs the whole logo as one (synced) or the mark and text on their own
 * settings (separate). Values persist to localStorage and apply live through `applyTitleVars()`; "Copy values"
 * grabs the JSON to bake into DEFAULTS *and* the styles.css fallbacks (plus the index.html font `<link>`).
 */
type NumKey = Exclude<keyof TitleConfig, 'font' | 'fontCustom' | 'textGlowColor' | 'logoGlowColor'>;
const LABELS: Record<NumKey, [string, TunerUnit | undefined]> = {
  markSize:         ['Mark size', 'px'],
  gap:              ['Text gap', 'px'],
  x:                ['Logo X', 'px'],
  y:                ['Logo Y', 'px'],
  textGlowSize:     ['Glow size', 'px'],
  textGlowStrength: ['Glow strength', undefined],
  logoGlowSize:     ['Glow size', 'px'],
  logoGlowStrength: ['Glow strength', undefined],
  floatSync:        ['Sync bob', undefined],
  floatAmp:         ['Logo bob height', 'px'],
  floatSpeed:       ['Logo bob speed', 's'],
  textFloatAmp:     ['Text bob height', 'px'],
  textFloatSpeed:   ['Text bob speed', 's'],
};
const GROUP: Record<keyof TitleConfig, string> = {
  markSize: 'Placement', gap: 'Placement', x: 'Placement', y: 'Placement',
  font: 'Font', fontCustom: 'Font',
  textGlowSize: 'Text glow', textGlowStrength: 'Text glow', textGlowColor: 'Text glow',
  logoGlowSize: 'Mark glow', logoGlowStrength: 'Mark glow', logoGlowColor: 'Mark glow',
  floatSync: 'Float', floatAmp: 'Float', floatSpeed: 'Float', textFloatAmp: 'Float', textFloatSpeed: 'Float',
};

// Declaration order = render order; adjacent same-group controls merge under one heading.
const ORDER: (keyof TitleConfig)[] = [
  'markSize', 'gap', 'x', 'y',
  'font', 'fontCustom',
  'textGlowSize', 'textGlowStrength', 'textGlowColor',
  'logoGlowSize', 'logoGlowStrength', 'logoGlowColor',
  'floatSync', 'floatAmp', 'floatSpeed', 'textFloatAmp', 'textFloatSpeed',
];

const controls: TunerControl<Extract<keyof TitleConfig, string>>[] = ORDER.map((key) => {
  const group = GROUP[key];
  const hint = TITLE_DESC[key];
  if (key === 'font') {
    return { key, label: 'Quick pick', hint, group, kind: 'select' as const, options: TITLE_FONTS, min: 0, max: 0, step: 0 };
  }
  if (key === 'fontCustom') {
    return { key, label: 'Custom font', hint, group, kind: 'text' as const, placeholder: 'Any Google Font, e.g. Cinzel Decorative', maxLength: 60, min: 0, max: 0, step: 0 };
  }
  if ((TITLE_COLOR_KEYS as readonly string[]).includes(key)) {
    return { key, label: 'Colour', hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  }
  if (key === 'floatSync') {
    const [label] = LABELS.floatSync;
    return { key, label, hint, group, kind: 'toggle' as const, onValue: 1, offValue: 0, onOffLabels: ['synced', 'separate'] as [string, string], min: 0, max: 1, step: 1 };
  }
  const [label, unit] = LABELS[key as NumKey];
  const [min, max, step] = TITLE_RANGES[key as NumKey];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<TitleConfig> = {
  id: 'titlelogo',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Title Logo',
  note: 'dev · live · main menu',
  read: getTitleConfig,
  write: (key, value) => setTitleValue(key, value),
  writeColor: (key, value) => setTitleValue(key, value),
  reset: resetTitleConfig,
  defaults: TITLE_DEFAULTS,
  controls,
};

export function TitleLogoTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
