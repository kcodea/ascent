/**
 * EQUIPMENT HOUSING LOOK (owner ask 2026-10-03: "rebuild the equipment housing from scratch. make it more
 * modern/sleek/cozy and fit our aesthetic. note that it needs to be able to fit all names etc for the equipment").
 *
 * One switch picks how the Equipment slot is housed. The look is a `data-eq-look` attribute on `<html>`;
 * `equipSlot.css` paints each look off it, from the shared `--ui-*` theme tokens, so the 🎨 UI Theme tuner
 * recolours the housing with the HUD pills and the tooltips. Classic is the old riveted bitmap frame
 * (`frames/equipment-frame.webp`), kept so the owner can compare before / after live.
 *
 * Same architecture as `healthPillConfig`: DEV-only localStorage, production always plays the baked DEFAULTS.
 * Nothing here moves the slot's seat: the button keeps its 128u box and the name plate keeps its old height, so
 * the slot's centre (its anchor) and every neighbour stay exactly where they were.
 */
import './equipSlot.css';
import { useSyncExternalStore } from 'react';
import type { TunerControl, TunerSpec } from './tunerSchema';

export const EQ_LOOKS = ['classic', 'socket', 'halo', 'tablet'] as const;
export type EqLook = (typeof EQ_LOOKS)[number];

const LOOK_LABELS: Record<EqLook, string> = {
  classic: 'Classic (the bronze frame)',
  socket: 'A. Gem socket (shipped)',
  halo: 'B. Halo',
  tablet: 'C. Tablet',
};

export interface EquipLookConfig {
  look: EqLook;
}

/** The baked look production renders. */
const DEFAULTS: EquipLookConfig = { look: 'socket' };
export { DEFAULTS as EQUIP_LOOK_DEFAULTS };

const KEY = 'ascent.equipLook';

const isLook = (v: unknown): v is EqLook => typeof v === 'string' && (EQ_LOOKS as readonly string[]).includes(v);

let cfg: EquipLookConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const look = saved && typeof saved === 'object' ? (saved as Partial<EquipLookConfig>).look : undefined;
    return { look: isLook(look) ? look : DEFAULTS.look };
  } catch {
    return { ...DEFAULTS };
  }
})();

const listeners = new Set<() => void>();

export function getEquipLookConfig(): EquipLookConfig {
  return cfg;
}

/** Stamp the look on `<html>` so every rule in equipSlot.css can key off it. */
export function applyEquipLook(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-eq-look', cfg.look);
}

export function setEquipLook(value: string): void {
  if (!isLook(value)) return;
  cfg = { look: value };
  applyEquipLook();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  listeners.forEach((l) => { l(); });
}

export function resetEquipLookConfig(): void {
  cfg = { ...DEFAULTS };
  applyEquipLook();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => { l(); });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The live look, for the slot's markup (Classic draws the bitmap frame; the CSS looks do not need it). */
export function useEquipLook(): EqLook {
  return useSyncExternalStore(subscribe, () => cfg.look, () => cfg.look);
}

/**
 * THE NAME PLATE FIT. In the new looks the plate has a FIXED width (it is part of the housing, not a pill that
 * grows with its text), so a long name auto-shrinks to fit, never below `NAME_FIT_MIN` of the plate's base size.
 * The longest names today (Calibration Wrench, Deathfibrillator, Magnifying Glass) need about 0.9; the floor
 * leaves room for longer ones. `equipNameFit.test.ts` holds every Equipment name to it.
 */
export const NAME_FIT_MIN = 0.78;

/** The shrink factor for a name `natural` px wide in a plate with `avail` px of room (2% kept as breathing room). */
export function nameFitScale(natural: number, avail: number, min = NAME_FIT_MIN): number {
  if (!(natural > 0) || !(avail > 0)) return 1;
  const room = avail * 0.98;
  if (natural <= room) return 1;
  return Math.max(min, Math.floor((room / natural) * 1000) / 1000);
}

const controls: TunerControl<Extract<keyof EquipLookConfig, string>>[] = [
  {
    key: 'look', label: 'Housing', kind: 'select', options: EQ_LOOKS, optionLabels: LOOK_LABELS,
    hint: 'How the Equipment slot is housed: the frame around the art, the name plate, the cost coin and the charge badge. Classic is the old bronze frame. Every new look follows the UI Theme. Live.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<EquipLookConfig> = {
  id: 'equiplook',                 // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Equipment housing',
  note: 'dev · live',
  read: getEquipLookConfig,
  write: () => { /* no numeric controls */ },
  writeColor: (_key, value) => setEquipLook(value),
  reset: resetEquipLookConfig,
  defaults: DEFAULTS,
  controls,
};

// Stamp at load (dev: the persisted pick; prod: DEFAULTS).
applyEquipLook();
