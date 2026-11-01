/**
 * THE AMPLIFIED LOOK (owner ask 2026-11-01: "redo the Amplified Equipment effect. Design a new one").
 *
 * One switch picks which looping def rides the Equipment slot while the selected Equipment is Amplified (its
 * next activation triggers TWICE). The owner picked an ENERGY / LIGHTNING direction: crackling arcane electricity
 * licking the slot, a charged, about-to-fire look. Three lightning takes, plus the original owner-authored ring
 * (`amplified-slot`, PR #1633) kept so before / after can be judged live:
 *
 *  - Twin snap   (`amplified-twin-snap`, the default): two arcs snap across the slot into an X (reads "x2"), then
 *    small arcs keep crackling along the frame until the next snap.
 *  - Corona      (`amplified-corona`): a tight crackling electric ring hugging the slot, sparks spitting off it and
 *    small forks licking out from its edges.
 *  - Rim crackle (`amplified-rim-crackle`): short forked arcs jump along the frame's edges at irregular beats.
 *  - Classic     (`amplified-slot`): the original ring of blue motes.
 *
 * Same architecture as `equipLookConfig`: DEV-only localStorage, production always plays the baked DEFAULT. The
 * switch lives in the dev menu's Equipment Slot tuner. Which def each look plays is `useAmplifiedSlotFx`'s, by
 * literal id, so the FX library's direct-call scan can attribute every one of them.
 */
import { useSyncExternalStore } from 'react';
import type { TunerControl, TunerSpec } from './tunerSchema';

export const AMPLIFIED_VARIANTS = ['twin-snap', 'corona', 'rim-crackle', 'classic'] as const;
export type AmplifiedVariant = (typeof AMPLIFIED_VARIANTS)[number];

/** The looping def each look plays on the slot. */
export const AMPLIFIED_LOOP_DEF: Record<AmplifiedVariant, string> = {
  'twin-snap': 'amplified-twin-snap',
  corona: 'amplified-corona',
  'rim-crackle': 'amplified-rim-crackle',
  classic: 'amplified-slot',
};

/** The one-shot played on the slot the moment an Amplified activation fires: two sharp discharges, two triggers. */
export const AMPLIFIED_RELEASE_DEF = 'amplified-release';

const LABELS: Record<AmplifiedVariant, string> = {
  'twin-snap': 'A. Twin snap (default)',
  corona: 'B. Corona',
  'rim-crackle': 'C. Rim crackle',
  classic: 'Classic (the old ring)',
};

export interface AmplifiedFxConfig {
  variant: AmplifiedVariant;
}

/** The baked look production plays. */
const DEFAULTS: AmplifiedFxConfig = { variant: 'twin-snap' };
export { DEFAULTS as AMPLIFIED_FX_DEFAULTS };

const KEY = 'ascent.amplifiedFx';

const isVariant = (v: unknown): v is AmplifiedVariant =>
  typeof v === 'string' && (AMPLIFIED_VARIANTS as readonly string[]).includes(v);

let cfg: AmplifiedFxConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const variant = saved && typeof saved === 'object' ? (saved as Partial<AmplifiedFxConfig>).variant : undefined;
    return { variant: isVariant(variant) ? variant : DEFAULTS.variant };
  } catch {
    return { ...DEFAULTS };
  }
})();

const listeners = new Set<() => void>();

export function getAmplifiedFxConfig(): AmplifiedFxConfig {
  return cfg;
}

export function setAmplifiedVariant(value: string): void {
  if (!isVariant(value) || value === cfg.variant) return;
  cfg = { variant: value };
  if (import.meta.env.DEV) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  }
  listeners.forEach((l) => { l(); });
}

export function resetAmplifiedFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => { l(); });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The live look, for the slot's loop hook (a switch restarts the loop in the new look). */
export function useAmplifiedVariant(): AmplifiedVariant {
  return useSyncExternalStore(subscribe, () => cfg.variant, () => cfg.variant);
}

const controls: TunerControl<Extract<keyof AmplifiedFxConfig, string>>[] = [
  {
    key: 'variant', label: 'Amplified look', kind: 'select', options: AMPLIFIED_VARIANTS, optionLabels: LABELS,
    hint: 'The loop on the Equipment slot while its next use triggers twice. Live: switch with an Amplified Equipment selected to compare. Classic is the old ring.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<AmplifiedFxConfig> = {
  id: 'amplifiedfx',               // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Amplified look',
  note: 'dev · live',
  read: getAmplifiedFxConfig,
  write: () => { /* no numeric controls */ },
  writeColor: (_key, value) => setAmplifiedVariant(value),
  reset: resetAmplifiedFxConfig,
  defaults: DEFAULTS,
  controls,
};
