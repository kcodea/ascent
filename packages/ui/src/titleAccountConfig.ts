/**
 * DEV tuner config for the TITLE-SCREEN ACCOUNT CORNER (owner ask 2026-09-21): the player's portrait LARGE in
 * the game's gold portrait ring, top-right of the main menu; their NAME as a plate eclipsing the ring's bottom
 * edge (the in-game hero-name pill); and their current RANK in a badge beneath the name. Three pieces, each
 * with its own size/scale + x/y offset, so the owner can seat them by eye.
 *
 * Same source-of-truth discipline as the other title tuners (`titleConfig`, `titleVeilConfig`): DEFAULTS here,
 * mirrored as the `var(--ta-*, <default>)` fallbacks on the `.titleaccount` rules in styles.css (the pre-JS /
 * no-JS paint). `applyTitleAccountVars` writes the values INLINE on `:root` (dev: the persisted tune; prod:
 * DEFAULTS), which overrides the fallbacks so a tune shows live. **Keep the two in sync when baking a tune.**
 *
 * The name plate and rank badge carry their own centring transform (`translate(-50%, …)`), so — like the 🧍
 * Hero Panel tuner — their nudge + scale are COMPOSED into one transform string per element rather than one
 * var per number; the CSS reads the whole string with a fallback that restates the default composition.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface TitleAccountConfig {
  /** Rendered width of the portrait ring, px (the `--ring` every ring-relative measure scales off). */
  ring: number;
  /** Offset of the whole corner (ring + name + badge move together), px from its CSS seat. */
  ringX: number;
  ringY: number;
  /** Name plate — scale (×) and px offset from its seat on the ring's bottom edge. */
  nameScale: number;
  nameX: number;
  nameY: number;
  /** Rank badge — scale (×) and px offset from its seat below the ring. */
  rankScale: number;
  rankX: number;
  rankY: number;
}

// Owner's baked tune (2026-09-21): a 264px ring, the name plate at 1.38× still nudged 12px up onto the ring's
// bottom edge, the rank badge at 1.57× seated 42px below.
const DEFAULTS: TitleAccountConfig = {
  ring: 264,
  ringX: 0,
  ringY: 0,
  nameScale: 1.38,
  nameX: 0,
  nameY: -12,
  rankScale: 1.57,
  rankX: 0,
  rankY: 42,
};

/** `[min, max, step]` per knob. */
const TA_RANGES: Record<keyof TitleAccountConfig, [number, number, number]> = {
  ring: [80, 360, 1],
  ringX: [-300, 300, 1],
  ringY: [-200, 300, 1],
  nameScale: [0.4, 2.5, 0.01],
  nameX: [-200, 200, 1],
  nameY: [-200, 200, 1],
  rankScale: [0.4, 2.5, 0.01],
  rankX: [-200, 200, 1],
  rankY: [-200, 200, 1],
};

/** The shipped values, exported so the tuner can mark which controls you've moved. */
export { DEFAULTS as TITLE_ACCOUNT_DEFAULTS };

const KEY = 'ascent.titleaccount';

// Dev-only persistence: production always renders the shipped DEFAULTS (which the styles.css fallbacks mirror).
let cfg: TitleAccountConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TitleAccountConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getTitleAccountConfig(): TitleAccountConfig {
  return cfg;
}

/** Reflect the knobs onto `:root` as `--ta-*` (the two placed pieces as composed transform strings). */
export function applyTitleAccountVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--ta-ring', `${cfg.ring}px`);
  root.setProperty('--ta-ring-t', `translate(${cfg.ringX}px, ${cfg.ringY}px)`);
  // Name plate: seated at the ring's bottom edge (`left: 50%; bottom: 0`), dropped 52% of its own height so it
  // straddles the edge — the in-game `.heroname` composition — then the nudge + scale stack onto that base.
  root.setProperty('--ta-name-t', `translate(-50%, 52%) translate(${cfg.nameX}px, ${cfg.nameY}px) scale(${cfg.nameScale})`);
  // Rank badge: seated centred under the ring (`left: 50%; top: 100%`), then its own nudge + scale.
  root.setProperty('--ta-rank-t', `translate(-50%, 0) translate(${cfg.rankX}px, ${cfg.rankY}px) scale(${cfg.rankScale})`);
}

export function setTitleAccountValue(key: keyof TitleAccountConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyTitleAccountVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetTitleAccountConfig(): void {
  cfg = { ...DEFAULTS };
  applyTitleAccountVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const r = (key: keyof TitleAccountConfig) => ({ min: TA_RANGES[key][0], max: TA_RANGES[key][1], step: TA_RANGES[key][2] });
const G_RING = 'Portrait ring';
const G_NAME = 'Name plate';
const G_RANK = 'Rank badge';
const controls: TunerControl<Extract<keyof TitleAccountConfig, string>>[] = [
  { key: 'ring', label: 'Ring size', unit: 'px', hint: 'Rendered width of the gold portrait ring. The avatar disc, the name seat and the badge seat all scale off it.', group: G_RING, ...r('ring') },
  { key: 'ringX', label: 'Corner X', unit: 'px', hint: 'Slide the whole corner (ring + name + badge) left/right from its top-right seat. Negative = further from the right edge.', group: G_RING, ...r('ringX') },
  { key: 'ringY', label: 'Corner Y', unit: 'px', hint: 'Slide the whole corner up/down from its top-right seat.', group: G_RING, ...r('ringY') },
  { key: 'nameScale', label: 'Plate size', unit: '×', hint: 'Scale of the name plate about its own centre. 1 = the shipped pill.', group: G_NAME, ...r('nameScale') },
  { key: 'nameX', label: 'Plate X', unit: 'px', hint: 'Nudge the name plate left/right from the ring\'s centre line.', group: G_NAME, ...r('nameX') },
  { key: 'nameY', label: 'Plate Y', unit: 'px', hint: 'Nudge the name plate up/down from the ring\'s bottom edge. Negative lifts it further over the art; positive hangs more of it below.', group: G_NAME, ...r('nameY') },
  { key: 'rankScale', label: 'Badge size', unit: '×', hint: 'Scale of the rank badge (crest + label) about its own centre.', group: G_RANK, ...r('rankScale') },
  { key: 'rankX', label: 'Badge X', unit: 'px', hint: 'Nudge the rank badge left/right from the ring\'s centre line.', group: G_RANK, ...r('rankX') },
  { key: 'rankY', label: 'Badge Y', unit: 'px', hint: 'Nudge the rank badge up/down from the ring\'s bottom edge. Raise it to tuck under the name plate; drop it to give the plate air.', group: G_RANK, ...r('rankY') },
];

export const SPEC: TunerSpec<TitleAccountConfig> = {
  id: 'titleaccount',              // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Title Account',
  note: 'dev · live · main menu only',
  read: getTitleAccountConfig,
  write: (key, value) => setTitleAccountValue(key, value),
  reset: resetTitleAccountConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css fallbacks either way).
applyTitleAccountVars();
