/**
 * HUD PILL LOOK (owner asks 2026-10-02: "can you fix these pills for me? they are very outdated and ugly"; the owner
 * picked B, Gem plate, then extended it to the name pills, the Tier / Freeze labels, the turn timer, the hero-select
 * screen and the Skip / Summary buttons).
 *
 * One switch picks the paint of every HEALTH pill (`.hudpill-hp`), NAME / LABEL pill (`.hudpill-name`), the turn
 * timer and the combat controls. The look is a `data-hp-look` attribute on `<html>`; `healthPills.css` paints each
 * look off it. Nothing here moves or resizes a pill's box, so the anchors stay where they were.
 *
 * Same architecture as `boardEdgeConfig`: DEV-only localStorage, production always uses the baked DEFAULTS (Gem).
 * Slate and Minimal only restyle the health family; they can be deleted from the CSS once nobody needs to compare.
 */
import './healthPills.css';
import type { TunerControl, TunerSpec } from './tunerSchema';

export const HP_LOOKS = ['classic', 'slate', 'gem', 'minimal'] as const;
export type HpLook = (typeof HP_LOOKS)[number];

const LOOK_LABELS: Record<HpLook, string> = {
  classic: 'Classic (the old pills)',
  slate: 'A. Slate (health pills only)',
  gem: 'B. Gem plate (shipped)',
  minimal: 'C. Minimal (health pills only)',
};

export interface HealthPillConfig {
  look: HpLook;
}

/** The baked look production renders: Gem plate, the owner's pick (2026-10-02: "gem plate looks good"). */
const DEFAULTS: HealthPillConfig = { look: 'gem' };

const KEY = 'ascent.hpPillLook';

const isLook = (v: unknown): v is HpLook => typeof v === 'string' && (HP_LOOKS as readonly string[]).includes(v);

let cfg: HealthPillConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const look = saved && typeof saved === 'object' ? (saved as Partial<HealthPillConfig>).look : undefined;
    return { look: isLook(look) ? look : DEFAULTS.look };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getHealthPillConfig(): HealthPillConfig {
  return cfg;
}

/** Stamp the look on `<html>` so every pill rule in healthPills.css can key off it. */
export function applyHealthPillLook(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-hp-look', cfg.look);
}

export function setHealthPillLook(value: string): void {
  if (!isLook(value)) return;
  cfg = { look: value };
  applyHealthPillLook();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHealthPillConfig(): void {
  cfg = { ...DEFAULTS };
  applyHealthPillLook();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof HealthPillConfig, string>>[] = [
  {
    key: 'look', label: 'Look', kind: 'select', options: HP_LOOKS, optionLabels: LOOK_LABELS,
    hint: 'Paints every Health pill, every name and label pill (Tier, Freeze), the turn timer and the Skip / Summary / End Combat buttons. Classic is the old look; Slate and Minimal only change the Health pills. Live.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<HealthPillConfig> = {
  id: 'hudpills',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'HUD pills',
  note: 'dev · live',
  read: getHealthPillConfig,
  write: () => { /* no numeric controls */ },
  writeColor: (_key, value) => setHealthPillLook(value),
  reset: resetHealthPillConfig,
  defaults: DEFAULTS,
  controls,
};

// Stamp at load (dev: the persisted pick; prod: DEFAULTS).
applyHealthPillLook();
