import { REBIRTH_DEFAULTS, REBIRTH_RANGES, getRebirthConfig, resetRebirthConfig, setRebirthValue, type RebirthConfig } from './rebirthConfig';
import { reformRebirth } from './choreo/channels/aura';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV 🔥 REBIRTH tuner: the Rebirth keyword's idle look (ember rim + rising motes) and its one-shot flame on a real
 * rebirth. ▶ Flame plays the burst on the first card on screen that wears Rebirth (else the screen centre).
 */
type Key = keyof RebirthConfig;
const ROWS: [Key, string, TunerUnit | undefined, string, string, 'color'?][] = [
  ['emberCount', 'Ember motes', undefined, 'Rising embers per card. 0 hides them. Applies to cards drawn after the change.', 'Idle'],
  ['emberAlpha', 'Ember opacity', 'opacity', 'Peak brightness of an ember.', 'Idle'],
  ['emberSize', 'Ember size', undefined, 'Ember size, % of the card width.', 'Idle'],
  ['rimAlpha', 'Rim opacity', 'opacity', 'Peak opacity of the thin ember rim on the oval.', 'Idle'],
  ['rimWidth', 'Rim width', 'px', 'Thickness of the ember rim.', 'Idle'],
  ['rimPulse', 'Rim breathe', 's', 'Seconds per rim breathe (opacity only).', 'Idle'],
  ['colorA', 'Hot colour', undefined, 'Ember cores and the rim’s inner edge.', 'Colours', 'color'],
  ['colorB', 'Deep colour', undefined, 'Ember tails and the rim’s outer glow.', 'Colours', 'color'],
  ['burstScale', 'Flame burst size', '×', 'Size of the flame burst when a minion rebirths.', 'Trigger'],
  ['soundGain', 'Flame sound', 'opacity', 'Volume of the rebirth flame cue. 0 mutes it.', 'Trigger'],
];
const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]) => {
  if (kind === 'color') return { key, label, hint, group, kind, min: 0, max: 0, step: 0 };
  const [min, max, step] = REBIRTH_RANGES[key as Exclude<Key, 'colorA' | 'colorB'>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<RebirthConfig> = {
  id: 'rebirth', // FROZEN
  title: 'Rebirth',
  note: 'dev · live',
  read: getRebirthConfig,
  write: (key, value) => setRebirthValue(key, value),
  writeColor: (key, value) => setRebirthValue(key, value),
  reset: resetRebirthConfig,
  defaults: REBIRTH_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Flame',
    hint: 'Plays the rebirth flame on the first Rebirth card on screen (else the screen centre).',
    run: () => {
      const el = document.querySelector('.card.rebirthcard');
      const r = el?.getBoundingClientRect();
      const rect = r && r.width > 0
        ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
        : { cx: window.innerWidth / 2, cy: window.innerHeight / 2, w: 180, h: 240 };
      reformRebirth(rect, null);
    },
  }],
};

export function RebirthTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
