import {
  HEROBUFFFX_COLOR_KEYS, HEROBUFFFX_DEFAULTS, HEROBUFFFX_RANGES,
  getHeroBuffFxConfig, resetHeroBuffFxConfig, setHeroBuffFxValue, type HeroBuffFxConfig,
} from './heroBuffFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HERO BUFF FLASH — the shard blast and eased ripple over the hero portrait when any run
 * buff grows. Unlike the Pixi FX tuners this drives a pure-CSS one-shot: values reflect to `--hbf-*` vars
 * immediately, which is why ▶ Test can replay the flash on the live portrait.
 */
const COLOR_SET = new Set<string>(HEROBUFFFX_COLOR_KEYS.map(String));

/**
 * Replay the flash on the live portrait by remounting `.herobuff-blast` via a one-off clone — the simplest
 * reliable trigger without threading state into StatusBar.
 */
function fireTest(): void {
  const f = document.querySelector('.statusbar .hero .f');
  if (!f) return;
  f.querySelector('.herobuff-blast')?.remove();
  const el = document.createElement('span');
  el.className = 'herobuff-blast';
  el.setAttribute('aria-hidden', 'true');
  f.insertBefore(el, f.firstChild);
}

const SPECS: Record<keyof HeroBuffFxConfig, [string, TunerUnit | undefined, string, string]> = {
  rippleScale: ['Size', '×', 'How far the ripple expands past the portrait.', 'Ripple'],
  rippleMs:    ['Duration', 'ms', 'How long the ripple takes to expand and fade.', 'Ripple'],
  rippleWidth: ['Ring thickness', 'px', 'Thickness of the ripple ring.', 'Ripple'],

  shardScale:  ['Size', '×', 'How far the shards travel from the portrait centre.', 'Shards'],
  shardMs:     ['Duration', 'ms', 'How long the shard blast lasts.', 'Shards'],
  shardRotate: ['Rotation', '°', 'Rotates the whole spoke arrangement, so repeat flashes do not read identically.', 'Shards'],
  shardSpokes: ['Spoke count', undefined, 'How many shards radiate out.', 'Shards'],
  peakAlpha:   ['Opacity', 'opacity', 'Peak opacity of the shards.', 'Shards'],
  colorCore:   ['Colour', undefined, 'Colour of the flash.', 'Shards'],
};

/** Declaration order IS render order; the colour sits inside the Shards run. */
const ORDER: (keyof HeroBuffFxConfig)[] = [
  'rippleScale', 'rippleMs', 'rippleWidth',
  'shardScale', 'shardMs', 'shardRotate', 'shardSpokes', 'peakAlpha', 'colorCore',
];

const controls: TunerControl<Extract<keyof HeroBuffFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = HEROBUFFFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HeroBuffFxConfig> = {
  id: 'herobufffx',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Buff Flash',
  note: 'dev · live · drag',
  read: getHeroBuffFxConfig,
  write: (key, value) => setHeroBuffFxValue(key, value),
  writeColor: (key, value) => setHeroBuffFxValue(key, value),
  reset: resetHeroBuffFxConfig,
  defaults: HEROBUFFFX_DEFAULTS,
  controls,
  actions: [{ label: '▶ Test', hint: 'Replays the flash on the live hero portrait.', run: () => fireTest() }],
};

export function HeroBuffFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
