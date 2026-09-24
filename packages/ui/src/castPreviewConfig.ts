import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner + the ONE config accessor for THE CAST PREVIEW (the spell a rune or minion casts, floated above its
 * caster — `castPreview.ts` / `CastPreviewLayer.tsx`). Owner feedback 2026-09-23:
 *
 *   *"this is far too large. can you build a tuner for me to adjust size, positioning, and linger duration? …
 *   it is also massive. make sure to add all of the details to the tuner so i can tune both. add an
 *   alpha/opacity lever as well."*
 *
 * "Both" = the SHOP preview (rune / minion casts in the recruit phase, End of Turn included) and the COMBAT
 * preview (a minion's cast on the replay clock), so every knob exists once per context, prefixed `shop` /
 * `combat`. Nothing in the store or the layer hard-codes a size, an offset or a duration any more: they read
 * `castPreviewLook(context)` / `castPreviewTimings(context)` here. The tuner writes through `setCastPreviewValue`,
 * which notifies subscribers, so a preview already on screen re-places at the new size on the next frame
 * (one re-measure per change, never per frame).
 *
 * Prod ignores localStorage and ships DEFAULTS (the equipSlotConfig-era pattern); "bake" = paste the panel's
 * Copy values into DEFAULTS.
 */
export type CastPreviewContext = 'shop' | 'combat';

/** Where the preview sits relative to its source. An INDEX (a slider with `valueLabels`), so it persists as a
 *  number like every other knob. */
export const CAST_PREVIEW_SIDES = ['above', 'below', 'left', 'right'] as const;
export type CastPreviewSide = (typeof CAST_PREVIEW_SIDES)[number];

export interface CastPreviewConfig {
  shopScale: number;
  shopSide: number;
  shopOffsetX: number;
  shopOffsetY: number;
  shopFadeIn: number;
  shopLinger: number;
  shopFadeOut: number;
  shopAlpha: number;
  combatScale: number;
  combatSide: number;
  combatOffsetX: number;
  combatOffsetY: number;
  combatFadeIn: number;
  combatLinger: number;
  combatFadeOut: number;
  combatAlpha: number;
  /** 1 = a (caster, spell) pair previews once per fight (the owner's Fatecarver/Warflame ruling); 0 = every cast. */
  combatOncePerFight: number;
  // ── THE RUNE CAST FLOURISH (owner 2026-09-24: "can we do anything to add a bit of flair to this? like some sort of
  //    short flash/pixi effect/make it smoother and cleaner with a bit of a 'magic' element to it? nothing crazy.")
  //    Every spell a RUNE casts: the badge pulses + the `rune-cast-flourish` glyph flash on its node, then (for a
  //    spell whose effect plays once) a `rune-cast-mote` travels out to where that effect lands. See
  //    `fx/runeCastFlourish.ts`.
  /** 1 = on, 0 = off (rune casts look exactly as they did before the flourish). */
  runeFlourishOn: number;
  /** How much the badge swells at its peak (0.12 = 12% larger). Transform only. */
  runeFlourishPulse: number;
  /** The badge pulse's whole length, ms. */
  runeFlourishPulseMs: number;
  /** The glyph flash's size on the node (× the authored def). */
  runeFlourishFlashSize: number;
  /** The mote's flight from the rune to the spell's landing point, ms. The spell's own effect waits for it. */
  runeFlourishMoteMs: number;
  /** The mote's size (× the authored def: its head, trail width and arrival sparkle). */
  runeFlourishMoteSize: number;
  /** For a spell whose visual already TRAVELS from the rune (a trail, an Ale's volley): how long after the flash
   *  it leaves, ms, so the rune visibly "releases" it. */
  runeFlourishLeadMs: number;
  /** Gap between two casts by the SAME rune in one moment (Recurrence's "twice"), ms. Under the 120 ms sound gap
   *  by default, so a doubled spell still rings once. */
  runeFlourishRepeatMs: number;
}

/**
 * Shipped values (2026-09-24). The first cut drew the hover reveal's full plated card (scale 1 ≈ 290 × 590 px) —
 * "far too large". 0.42 of that is ~120 px wide, about a board minion's width, sitting just above its source.
 * Combat reads a touch smaller (0.38): the arena's units are smaller than the shop's and the fight is busier.
 * Timings keep the owner's "about 2 seconds" linger in the shop; combat lingers 1.6 s so a preview clears before
 * the next exchange piles up behind it.
 */
const DEFAULTS: CastPreviewConfig = {
  // Owner-tuned 2026-09-24 (baked from the panel's Copy values).
  shopScale: 0.6,
  shopSide: 0,
  shopOffsetX: 0,
  shopOffsetY: -32,
  shopFadeIn: 150,
  shopLinger: 500,
  shopFadeOut: 190,
  shopAlpha: 1,
  combatScale: 0.6,
  combatSide: 3,
  combatOffsetX: -74,
  combatOffsetY: 28,
  combatFadeIn: 150,
  combatLinger: 500,
  combatFadeOut: 190,
  combatAlpha: 1,
  combatOncePerFight: 1,
  // The rune cast flourish (2026-09-24 concept values; the owner tunes these in the panel).
  runeFlourishOn: 1,
  runeFlourishPulse: 0.14,
  runeFlourishPulseMs: 360,
  runeFlourishFlashSize: 1,
  runeFlourishMoteMs: 280,
  runeFlourishMoteSize: 1,
  runeFlourishLeadMs: 110,
  runeFlourishRepeatMs: 110,
};
export { DEFAULTS as CAST_PREVIEW_DEFAULTS };

/** WHICH SOURCES PREVIEW (owner 2026-09-24: "use the values below for the rune triggering one, but let's hide/
 *  disable the combat/minion side for now, because it isn't what i want right now"). Only a spell cast BY A RUNE
 *  previews; a minion's cast (shop, End of Turn or combat) shows nothing. The combat + minion code stays wired so
 *  flipping these back on is one line; the combat knobs are hidden from the tuner while it is off. */
export interface CastPreviewSources { rune: boolean; minion: boolean; combat: boolean }
// Deliberately a plain (mutable) object: tests flip it to prove re-enabling is one line. Never flipped at runtime.
export const CAST_PREVIEW_SOURCES: CastPreviewSources = { rune: true, minion: false, combat: false };

export const CAST_PREVIEW_RANGES: Record<keyof CastPreviewConfig, [number, number, number]> = {
  shopScale: [0.2, 1.5, 0.01],
  shopSide: [0, 3, 1],
  shopOffsetX: [-300, 300, 1],
  shopOffsetY: [-300, 300, 1],
  shopFadeIn: [0, 1000, 10],
  shopLinger: [0, 6000, 50],
  shopFadeOut: [0, 1500, 10],
  shopAlpha: [0, 1, 0.01],
  combatScale: [0.2, 1.5, 0.01],
  combatSide: [0, 3, 1],
  combatOffsetX: [-300, 300, 1],
  combatOffsetY: [-300, 300, 1],
  combatFadeIn: [0, 1000, 10],
  combatLinger: [0, 6000, 50],
  combatFadeOut: [0, 1500, 10],
  combatAlpha: [0, 1, 0.01],
  combatOncePerFight: [0, 1, 1],
  runeFlourishOn: [0, 1, 1],
  runeFlourishPulse: [0, 0.5, 0.01],
  runeFlourishPulseMs: [80, 1200, 10],
  runeFlourishFlashSize: [0.3, 2.5, 0.05],
  runeFlourishMoteMs: [80, 1000, 10],
  runeFlourishMoteSize: [0.3, 2.5, 0.05],
  runeFlourishLeadMs: [0, 600, 10],
  runeFlourishRepeatMs: [0, 600, 10],
};

export const CAST_PREVIEW_KEYS = Object.keys(DEFAULTS) as (keyof CastPreviewConfig)[];

const KEY = 'ascent.castpreview';

function load(): CastPreviewConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      for (const k of CAST_PREVIEW_KEYS) {
        const v = (saved as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let cfg: CastPreviewConfig = load();
const listeners = new Set<() => void>();

export function getCastPreviewConfig(): CastPreviewConfig {
  return cfg;
}

/** Subscribe to knob changes (a `useSyncExternalStore` source: the snapshot is `getCastPreviewConfig`). */
export function subscribeCastPreviewConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function commit(next: CastPreviewConfig): void {
  cfg = next;
  for (const l of listeners) l();
}

export function setCastPreviewValue(key: keyof CastPreviewConfig, value: number | string): void {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  const [min, max] = CAST_PREVIEW_RANGES[key];
  commit({ ...cfg, [key]: Math.max(min, Math.min(max, n)) });
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCastPreviewConfig(): void {
  commit({ ...DEFAULTS });
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Re-read storage — for tests that seed localStorage before "loading". */
export function reloadCastPreviewConfigForTest(): void {
  commit(load());
}

export interface CastPreviewTimings { fadeIn: number; linger: number; fadeOut: number }
export interface CastPreviewLook {
  /** × the hover reveal's plated card (1 = the old full size). */
  scale: number;
  side: CastPreviewSide;
  offsetX: number;
  offsetY: number;
  /** Max opacity the preview reaches (the fade animates 0 → this). */
  alpha: number;
}

export function castPreviewTimings(context: CastPreviewContext, c: CastPreviewConfig = cfg): CastPreviewTimings {
  return context === 'combat'
    ? { fadeIn: c.combatFadeIn, linger: c.combatLinger, fadeOut: c.combatFadeOut }
    : { fadeIn: c.shopFadeIn, linger: c.shopLinger, fadeOut: c.shopFadeOut };
}

export function castPreviewLook(context: CastPreviewContext, c: CastPreviewConfig = cfg): CastPreviewLook {
  const sideIdx = context === 'combat' ? c.combatSide : c.shopSide;
  const side = CAST_PREVIEW_SIDES[Math.max(0, Math.min(3, Math.round(sideIdx)))] ?? 'above';
  return context === 'combat'
    ? { scale: c.combatScale, side, offsetX: c.combatOffsetX, offsetY: c.combatOffsetY, alpha: c.combatAlpha }
    : { scale: c.shopScale, side, offsetX: c.shopOffsetX, offsetY: c.shopOffsetY, alpha: c.shopAlpha };
}

/** The rune cast flourish's knobs, resolved (see `fx/runeCastFlourish.ts`). */
export interface RuneCastFlourishLook {
  on: boolean;
  pulse: number;
  pulseMs: number;
  flashSize: number;
  moteMs: number;
  moteSize: number;
  leadMs: number;
  repeatMs: number;
}

export function runeCastFlourishLook(c: CastPreviewConfig = cfg): RuneCastFlourishLook {
  return {
    on: c.runeFlourishOn >= 0.5,
    pulse: c.runeFlourishPulse,
    pulseMs: c.runeFlourishPulseMs,
    flashSize: c.runeFlourishFlashSize,
    moteMs: c.runeFlourishMoteMs,
    moteSize: c.runeFlourishMoteSize,
    leadMs: c.runeFlourishLeadMs,
    repeatMs: c.runeFlourishRepeatMs,
  };
}

/** The combat once-per-(caster, spell) memory's switch. */
export function castPreviewCombatOncePerFight(c: CastPreviewConfig = cfg): boolean {
  return c.combatOncePerFight >= 0.5;
}

// ── the panel schema ────────────────────────────────────────────────────────────────────────────────────────
// No `hint`s on purpose: the shared panel renders a hint as a native tooltip, and the label + group say it all.
type Row = [label: string, unit: TunerUnit | undefined];
const PER_CONTEXT: [suffix: string, row: Row][] = [
  ['Scale', ['Size', '×']],
  ['Side', ['Side of source', undefined]],
  ['OffsetX', ['Offset X', 'px']],
  ['OffsetY', ['Offset Y', 'px']],
  ['FadeIn', ['Fade in', 'ms']],
  ['Linger', ['Linger', 'ms']],
  ['FadeOut', ['Fade out', 'ms']],
  ['Alpha', ['Max opacity', 'opacity']],
];

function controlsFor(prefix: CastPreviewContext, group: string): TunerControl<Extract<keyof CastPreviewConfig, string>>[] {
  return PER_CONTEXT.map(([suffix, [label, unit]]) => {
    const key = `${prefix}${suffix}` as keyof CastPreviewConfig;
    const [min, max, step] = CAST_PREVIEW_RANGES[key];
    return {
      key, label, group, min, max, step,
      ...(unit ? { unit } : {}),
      ...(suffix === 'Side' ? { valueLabels: CAST_PREVIEW_SIDES } : {}),
    };
  });
}

/** The panel's controls for a given gate: the shop group always (named for what it serves), the combat group
 *  only while combat previews are on. */
export function castPreviewControlsFor(sources: CastPreviewSources): TunerControl<Extract<keyof CastPreviewConfig, string>>[] {
  return [
  ...controlsFor('shop', sources.minion ? 'Shop (runes + minions, End of Turn)' : 'Rune casts'),
  // The combat / minion previews are OFF for now (CAST_PREVIEW_SOURCES); their knobs come back with them.
  ...(sources.combat ? [
    ...controlsFor('combat', 'Combat (minion casts on the replay)'),
    {
      key: 'combatOncePerFight' as const, label: 'Once per fight', group: 'Combat (minion casts on the replay)',
      kind: 'toggle' as const, onValue: 1, offValue: 0, onOffLabels: ['once per caster + spell', 'every cast'] as [string, string],
      min: 0, max: 1, step: 1,
    },
  ] : []),
  ...RUNE_FLOURISH_CONTROLS,
  ];
}

const RUNE_FLOURISH_GROUP = 'Rune cast flourish';
const flourishRow = (key: Extract<keyof CastPreviewConfig, `runeFlourish${string}`>, label: string, unit?: TunerUnit): TunerControl<Extract<keyof CastPreviewConfig, string>> => {
  const [min, max, step] = CAST_PREVIEW_RANGES[key];
  return { key, label, group: RUNE_FLOURISH_GROUP, min, max, step, ...(unit ? { unit } : {}) };
};
/** The flourish's group (owner ask 2026-09-24): on/off, the badge pulse, the flash, the mote, the release lead. */
export const RUNE_FLOURISH_CONTROLS: TunerControl<Extract<keyof CastPreviewConfig, string>>[] = [
  {
    key: 'runeFlourishOn', label: 'Flourish', group: RUNE_FLOURISH_GROUP,
    kind: 'toggle', onValue: 1, offValue: 0, onOffLabels: ['on', 'off'], min: 0, max: 1, step: 1,
  },
  flourishRow('runeFlourishPulse', 'Badge pulse', '×'),
  flourishRow('runeFlourishPulseMs', 'Badge pulse length', 'ms'),
  flourishRow('runeFlourishFlashSize', 'Glyph flash size', '×'),
  flourishRow('runeFlourishMoteMs', 'Mote travel', 'ms'),
  flourishRow('runeFlourishMoteSize', 'Mote size', '×'),
  flourishRow('runeFlourishLeadMs', 'Trail release delay', 'ms'),
  flourishRow('runeFlourishRepeatMs', 'Repeat-cast gap', 'ms'),
];

export const CAST_PREVIEW_CONTROLS = castPreviewControlsFor(CAST_PREVIEW_SOURCES);

export const SPEC: TunerSpec<CastPreviewConfig> = {
  id: 'castpreview',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Cast Preview',
  note: 'dev · live · rune casts',
  read: getCastPreviewConfig,
  write: (key, value) => setCastPreviewValue(key, value),
  reset: resetCastPreviewConfig,
  defaults: DEFAULTS,
  controls: CAST_PREVIEW_CONTROLS,
};
