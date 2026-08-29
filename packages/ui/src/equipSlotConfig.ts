import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner for the EQUIPMENT SLOT seat (owner ask 2026-08-28: "can we separate the second hero power and
 * equipment slots for me? I want a tuner for the equipment slot and put it up here for me — i'll tune the
 * sizing/space for it").
 *
 * ── Why this is its own seat, not an offset of the second power ───────────────────────────────────────────
 *
 * Equipment first shipped riding the `.heropanel2` seat with a `.beside` nudge, on the assumption that a
 * hero rarely has a second power. Void has TWO, and the pair collided the moment one appeared. A borrowed
 * seat also meant nudging the Second Power tuner silently moved Equipment, which is not something either dial
 * says it does.
 *
 * So Equipment gets `--eqs-*` of its own. The two slots can now be placed independently, and neither tuner
 * can surprise the other.
 *
 * Offsets are reference px at the 1440 stage — the CSS multiplies by `--scale`, so the seat holds its place at
 * every resolution (the ceremony-layout rule every other seat follows).
 */
export interface EquipSlotConfig {
  /** Horizontal offset from the hero panel's seat (reference px; positive = right). */
  x: number;
  /** Vertical offset (reference px; positive = down, so ABOVE the hero is negative). */
  y: number;
  /** Uniform scale on the whole Equipment block. */
  scale: number;
}

/**
 * Seated ABOVE the hero, per the owner's screenshot — clear of both power buttons, which sit to the right and
 * below. A starting placement, not a considered one: the ask was explicitly for a tuner to place it.
 */
const DEFAULTS: EquipSlotConfig = { x: 74, y: -232, scale: 0.9 };

const RANGES: Record<keyof EquipSlotConfig, [number, number, number]> = {
  x: [-400, 500, 1],
  y: [-500, 300, 1],
  scale: [0.4, 1.6, 0.01],
};

export { DEFAULTS as EQUIP_SLOT_DEFAULTS };

const KEY = 'ascent.equipslot';

let cfg: EquipSlotConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<EquipSlotConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getEquipSlotConfig(): EquipSlotConfig {
  return cfg;
}

export function applyEquipSlotVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--eqs-x', String(cfg.x));
  root.setProperty('--eqs-y', String(cfg.y));
  root.setProperty('--eqs-scale', String(cfg.scale));
}

export function setEquipSlotValue(key: keyof EquipSlotConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applyEquipSlotVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetEquipSlotConfig(): void {
  cfg = { ...DEFAULTS };
  applyEquipSlotVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof EquipSlotConfig, string>>[] = [
  { key: 'x', label: 'Offset X', unit: 'px', hint: 'Right of the hero panel seat. Reference px — scales with the stage.', group: 'Equipment slot', min: RANGES.x[0], max: RANGES.x[1], step: RANGES.x[2] },
  { key: 'y', label: 'Offset Y', unit: 'px', hint: 'Down from the seat — NEGATIVE puts it above the hero.', group: 'Equipment slot', min: RANGES.y[0], max: RANGES.y[1], step: RANGES.y[2] },
  { key: 'scale', label: 'Scale', unit: '×', hint: 'Size of the whole Equipment block — button, cost coin, uses and label together.', group: 'Equipment slot', min: RANGES.scale[0], max: RANGES.scale[1], step: RANGES.scale[2] },
];

export const SPEC: TunerSpec<EquipSlotConfig> = {
  id: 'equipslot',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Equipment Slot',
  note: 'dev · live · needs an Equip minion',
  read: getEquipSlotConfig,
  write: (key, value) => setEquipSlotValue(key, value),
  reset: resetEquipSlotConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the seat is live before the first paint (the boardConfig-era pattern).
applyEquipSlotVars();
