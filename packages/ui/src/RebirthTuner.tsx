import { REBIRTH_DEFAULTS, REBIRTH_RANGES, getRebirthConfig, resetRebirthConfig, setRebirthValue, type RebirthConfig } from './rebirthConfig';
import { playRebirthBurstCentre, playRebirthPreview, toggleRebirthPreview } from './rebirthPreview';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV 🔥 REBIRTH tuner: the Rebirth keyword's idle flame crown (flames, glow, embers), its colours, and the
 * phoenix moment on a real rebirth (burst + re-form + whoosh). ▶ Idle card floats a sample Rebirth card beside the
 * panel; ▶ Rebirth plays the full trigger on it (or on the first Rebirth card on screen).
 */
type Key = keyof RebirthConfig;
type ColorKey = 'colorA' | 'colorB' | 'colorCore';
const ROWS: [Key, string, TunerUnit | undefined, string, string, 'color'?][] = [
  ['crownAlpha', 'Flame intensity', 'opacity', 'How strongly the soft flames show on the frame.', 'Idle'],
  ['crownSize', 'Flame height', '×', 'How far the flame tongues lick above the frame.', 'Idle'],
  ['flickerSpeed', 'Flicker cycle', 's', 'Seconds for one full flicker through the flame frames. Lower is livelier.', 'Idle'],
  ['glowAlpha', 'Glow', 'opacity', 'Peak strength of the faint blue ring of light on the frame.', 'Idle'],
  ['glowPulse', 'Glow breathe', 's', 'Seconds per glow breathe.', 'Idle'],
  ['emberCount', 'Embers', undefined, 'Embers rising off the flames. 0 hides them. Applies to cards drawn after the change.', 'Idle'],
  ['emberAlpha', 'Ember opacity', 'opacity', 'Peak brightness of an ember.', 'Idle'],
  ['emberSize', 'Ember size', '%', 'Ember size, as a share of the flame box.', 'Idle'],
  ['colorB', 'Deep flame', undefined, 'The outer flame and the glow edge (cobalt).', 'Colours', 'color'],
  ['colorA', 'Hot flame', undefined, 'The flame body, glow and embers (cyan).', 'Colours', 'color'],
  ['colorCore', 'Core', undefined, 'The white-hot core of each tongue and ember.', 'Colours', 'color'],
  ['burstScale', 'Burst size', '×', 'Size of the flame burst when a minion rebirths.', 'Trigger'],
  ['burstTime', 'Burst duration', '×', 'Stretches how long the flame column burns.', 'Trigger'],
  ['soundGain', 'Whoosh volume', 'opacity', 'Volume of the rebirth flame whoosh. 0 mutes it.', 'Trigger'],
  ['soundOffset', 'Whoosh delay', 'ms', 'Delay of the whoosh after the burst starts.', 'Trigger'],
];
const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]) => {
  if (kind === 'color') return { key, label, hint, group, kind, min: 0, max: 0, step: 0 };
  const [min, max, step] = REBIRTH_RANGES[key as Exclude<Key, ColorKey>];
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
  actions: [
    {
      label: '▶ Idle card',
      hint: 'Shows (or hides) a sample Rebirth card beside this panel, so the idle flames can be judged anywhere.',
      run: (panelEl) => toggleRebirthPreview(panelEl),
    },
    {
      label: '▶ Rebirth',
      hint: 'Plays the full rebirth (flame burst, the card re-forming from the fire, the whoosh) on the sample card, else on the first Rebirth card on screen.',
      run: () => playRebirthPreview(),
    },
    {
      label: '▶ Burst ×7',
      hint: 'Seven bursts at once over the screen centre: the mass-rebirth check.',
      run: () => playRebirthBurstCentre(7),
    },
  ],
};

export function RebirthTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
