/**
 * THE AMPLIFIED LOOK (owner ask 2026-11-01: "redo the Amplified Equipment effect. Design a new one").
 *
 * One switch picks how the Equipment slot says "your next use triggers twice". Owner direction over the drafts:
 * "somewhat gentle and not over the top, just needs to say 'this is amplified' but not a crazy signal", then "need a
 * bit more to it than this" (between a plain halo and the rejected lightning). So the new looks are calm CSS states on
 * the slot (equipSlot.css, compositor-only: opacity / transform), not Pixi effects:
 *
 *  - Charged   (`charged`, the default): a breathing blue halo in the Amplified tally's blue, a thin second ring
 *    breathing out of phase (a quiet "double"), a glint travelling the rim, and soft motes rising off the sides.
 *  - Twin ring (`twin-ring`): the halo, the second ring and the rim glint, plus a twin glint on the blue charge chip
 *    at each breath's peak; no motes.
 *  - Classic   (`classic`): the original owner-authored Pixi ring (`amplified-slot`, PR #1633), kept so before / after
 *    can be judged live.
 *
 * Same architecture as `equipLookConfig`: DEV-only localStorage, production always plays the baked DEFAULT. The
 * switch lives in the dev menu's Equipment Slot tuner.
 */
import { useSyncExternalStore } from 'react';
import type { TunerControl, TunerSpec } from './tunerSchema';

export const AMPLIFIED_VARIANTS = ['charged', 'twin-ring', 'classic'] as const;
export type AmplifiedVariant = (typeof AMPLIFIED_VARIANTS)[number];

/** The one-shot played on the slot the moment an Amplified activation fires: two soft rings, one per trigger. */
export const AMPLIFIED_RELEASE_DEF = 'amplified-release';

const LABELS: Record<AmplifiedVariant, string> = {
  charged: 'A. Charged (default)',
  'twin-ring': 'B. Twin ring + chip glint',
  classic: 'Classic (the old Pixi ring)',
};

export interface AmplifiedFxConfig {
  variant: AmplifiedVariant;
}

/** The baked look production plays. */
const DEFAULTS: AmplifiedFxConfig = { variant: 'charged' };
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

/** The live look, for the slot (StatusBar). */
export function useAmplifiedVariant(): AmplifiedVariant {
  return useSyncExternalStore(subscribe, () => cfg.variant, () => cfg.variant);
}

const controls: TunerControl<Extract<keyof AmplifiedFxConfig, string>>[] = [
  {
    key: 'variant', label: 'Amplified look', kind: 'select', options: AMPLIFIED_VARIANTS, optionLabels: LABELS,
    hint: 'How the Equipment slot shows that its next use triggers twice. Live: switch with an Amplified Equipment selected to compare. Classic is the old Pixi ring.',
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
