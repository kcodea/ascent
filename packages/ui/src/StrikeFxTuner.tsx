import { STRIKEFX_DEFAULTS, STRIKEFX_RANGES, getStrikeFxConfig, resetStrikeFxConfig, setStrikeFxValue, type StrikeFxConfig } from './strikeFxConfig';
import { SMOKE_DEFAULTS, SMOKE_RANGES, getSmokeConfig, setSmokeValue, type SmokeConfig } from './smokeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the whole combat strike-impact package in one panel: the melee flash / shockwave / heavy
 * ring / sparks from `strikeFxConfig`, PLUS the impact smoke, dust billow and energy pulse — which live in
 * `smokeConfig` alongside the card-drop dust, and are surfaced here so the package tunes together. Values apply
 * to the NEXT strike; watch a fight to judge.
 *
 * TWO CONFIGS, ONE PANEL. The spec's `read` merges both objects and `write` dispatches on the key, so
 * persistence still runs through each config's own accessors. "Copy values" therefore yields the merged JSON,
 * as the hand-rolled panel did.
 *
 * The asymmetry that used to be buried in a doc comment: **Reset clears only the strike keys.** The smoke, dust
 * and pulse values are shared with the Smoke & Dust tuner, so resetting them from here would silently undo work
 * done in that panel and to the card-drop dust. Those controls now say so individually via their caveat marker,
 * rather than the fact living in prose nobody reads mid-tune.
 */

/** The strike-relevant subset of `smokeConfig`. The rest of that config is card-drop dust and is not shown here. */
const SMOKE_KEYS = [
  'smokeCount', 'smokeRise', 'smokeDrift', 'smokeLife', 'smokeGrow', 'smokeAlpha',
  'impDustCount', 'impDustSpeed', 'impDustLife', 'impDustSize',
  'impPulseRadius', 'impPulseDur', 'impPulseRings',
] as const;
type SmokeKey = (typeof SMOKE_KEYS)[number];

/** The panel's value shape: the strike config plus the borrowed smoke keys. */
type StrikePanelConfig = StrikeFxConfig & Pick<SmokeConfig, SmokeKey>;

const SHARED =
  'Shared with the Smoke & Dust tuner and with the card-drop dust. This panel’s Reset does NOT clear it — '
  + 'reset it from Smoke & Dust if you want the shipped value back.';

const STRIKE: Record<keyof StrikeFxConfig, [string, TunerUnit | undefined, string]> = {
  flashSize:     ['Flash size', '×', 'Size of the white impact flash at the point of contact.'],
  shockwaveSize: ['Shockwave size', '×', 'Size of the expanding shockwave ring.'],
  ringScale:     ['Heavy ring size', '×', 'Size of the slower, heavier second ring. 0 removes it.'],
  sparkCount:    ['Spark count', undefined, 'How many sparks the hit throws.'],
  sparkSpeed:    ['Spark speed', '×', 'How fast the sparks fly out.'],
  sparkSpread:   ['Spark spread', '°', 'How wide an arc the sparks cover. 360 throws them in every direction.'],
  sparkSize:     ['Spark size', '×', 'Size of each spark.'],
};

const SMOKE: Record<SmokeKey, [string, TunerUnit | undefined, string, string]> = {
  smokeCount:     ['Puff count', undefined, 'How many smoke puffs the impact throws.', 'Impact smoke'],
  smokeRise:      ['Rise', 'px', 'How far the smoke lifts as it fades. 0 keeps it flat.', 'Impact smoke'],
  smokeDrift:     ['Spread', 'px', 'How far the puffs billow outward from the hit.', 'Impact smoke'],
  smokeLife:      ['Lifetime', 'ms', 'How long one puff lasts before it has fully faded.', 'Impact smoke'],
  smokeGrow:      ['Expansion', '×', 'How much a puff grows over its life.', 'Impact smoke'],
  smokeAlpha:     ['Opacity', 'opacity', 'Peak opacity of the smoke.', 'Impact smoke'],
  impDustCount:   ['Puff count', undefined, 'How many dust puffs erupt from the strike point.', 'Impact dust'],
  impDustSpeed:   ['Billow speed', 'px/s', 'How fast that dust pushes outward.', 'Impact dust'],
  impDustLife:    ['Lifetime', 'ms', 'How long one puff lasts.', 'Impact dust'],
  impDustSize:    ['Puff radius', 'px', 'Size of each puff.', 'Impact dust'],
  impPulseRadius: ['Ring radius', 'px', 'How far the energy ring expands from the strike point.', 'Energy pulse'],
  impPulseDur:    ['Ring lifetime', 'ms', 'How long a ring takes to expand and fade.', 'Energy pulse'],
  impPulseRings:  ['Ring count', undefined, 'How many rings fire. 0 disables the pulse entirely.', 'Energy pulse'],
};

const STRIKE_ORDER = Object.keys(STRIKE) as (keyof StrikeFxConfig)[];

const controls: TunerControl<Extract<keyof StrikePanelConfig, string>>[] = [
  ...STRIKE_ORDER.map((key) => {
    const [label, unit, hint] = STRIKE[key];
    const [min, max, step] = STRIKEFX_RANGES[key];
    return { key, label, unit, hint, group: 'Melee impact', min, max, step };
  }),
  ...SMOKE_KEYS.map((key) => {
    const [label, unit, hint, group] = SMOKE[key];
    const [min, max, step] = SMOKE_RANGES[key];
    return { key, label, unit, hint, group, note: SHARED, min, max, step };
  }),
];

const STRIKE_KEY_SET = new Set<string>(STRIKE_ORDER);

const SPEC: TunerSpec<StrikePanelConfig> = {
  id: 'strikefx',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lunge Impact',
  note: 'dev · next strike · drag',
  read: () => ({ ...getStrikeFxConfig(), ...getSmokeConfig() }) as StrikePanelConfig,
  write: (key, value) => {
    if (STRIKE_KEY_SET.has(key)) setStrikeFxValue(key as keyof StrikeFxConfig, value);
    else setSmokeValue(key as keyof SmokeConfig, value);
  },
  // Strike keys only, deliberately — see the note at the top of this file.
  reset: resetStrikeFxConfig,
  defaults: { ...STRIKEFX_DEFAULTS, ...SMOKE_DEFAULTS } as StrikePanelConfig,
  controls,
};

export function StrikeFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
