import type { TendrilCfg } from './pixiFx';

/**
 * Tunable parameters for the QUEST TENDRIL FX — "this quest just triggered that unit" (owner ask
 * 2026-07-21): when a quest/rune End-of-Turn reward fires a specific minion (Echoing Roar re-firing your
 * leftmost Shout, Rune of the Reliquary firing an Echo), a GOLD ribbon reaches out of that reward's node in
 * the badge row and strikes the unit it triggered, landing with a flash and a spray of motes.
 *
 * Built entirely on the existing `pixiFx.buffTendril` ribbon — the same primitive the Fodder Infusion uses —
 * so this config is just the per-tendril `TendrilCfg` in a gold palette plus the two dials that matter here
 * (the arc bulge, and the stagger when one End of Turn procs several times). Same trio pattern as
 * `infuseFxConfig.ts`: DEV-persisted, dialed via the "🏆 Quest Tendril" tuner, read at FIRE TIME so an edit
 * applies to the next proc.
 */
export interface QuestTendrilConfig {
  /** 1 = fire on a real proc, 0 = OFF. Kept as a kill switch. (It was briefly defaulted OFF on a bad read:
   *  the ribbon's `Graphics` measures 0x0 because its bounds don't reflect the drawn geometry, which I
   *  mistook for "not rendering" — an owner screenshot then clearly showed the ribbon landing on the unit.) */
  enabled: number;
  curve: number;        // arc bulge — alternates sides per tendril so repeats don't overlap exactly
  staggerMs: number;    // ms between successive tendrils when one End of Turn procs several times
  travelMs: number;     // ms — the ribbon head's travel from node to unit
  retractMs: number;    // ms — tail retract + fade after the strike
  wobbleAmp: number;    // px — organic waver along the ribbon
  wobbleFreq: number;   // waves along its length
  baseWidth: number;    // px — width at the node end
  tipWidth: number;     // px — width at the striking end
  coreAlpha: number;    // 0..1
  glowWidth: number;    // px — soft underlay around the core stroke
  glowAlpha: number;    // 0..1
  flashSize: number;    // px — the flash popped on the unit at landing
  flashMs: number;      // ms — that flash's life
  moteCount: number;    // motes sprayed at the landing
  moteSpeed: number;    // px/s
  moteLife: number;     // ms
  pulseSize: number;    // px — the "sending" pulse at the NODE as the ribbon launches
  pulseAlpha: number;   // 0..1
  pulseMs: number;      // ms
  colorCore: string;
  colorGlow: string;
  colorFlash: string;
  colorMote: string;
}

// Gold, per the ask — warm core, paler glow, a bright landing flash. Fast (340ms) because this fires inside
// the End-of-Turn beat sequence: it must read as punctuation on the proc, not delay it.
const DEFAULTS: QuestTendrilConfig = {
  enabled: 1,
  curve: 46,
  staggerMs: 90,
  travelMs: 340,
  retractMs: 260,
  wobbleAmp: 7,
  wobbleFreq: 1.6,
  baseWidth: 7,
  tipWidth: 2,
  coreAlpha: 0.95,
  glowWidth: 8,
  glowAlpha: 0.5,
  flashSize: 46,
  flashMs: 260,
  moteCount: 12,
  moteSpeed: 150,
  moteLife: 460,
  pulseSize: 30,
  pulseAlpha: 0.7,
  pulseMs: 300,
  colorCore: '#ffd766',
  colorGlow: '#b98524',
  colorFlash: '#fff3c9',
  colorMote: '#ffcf5a',
};

export const QUESTTENDRIL_KEYS = [
  'enabled', 'curve', 'staggerMs', 'travelMs', 'retractMs', 'wobbleAmp', 'wobbleFreq',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha',
  'flashSize', 'flashMs', 'moteCount', 'moteSpeed', 'moteLife',
  'pulseSize', 'pulseAlpha', 'pulseMs',
  'colorCore', 'colorGlow', 'colorFlash', 'colorMote',
] as const satisfies readonly (keyof QuestTendrilConfig)[];

export const QUESTTENDRIL_COLOR_KEYS: (keyof QuestTendrilConfig)[] = ['colorCore', 'colorGlow', 'colorFlash', 'colorMote'];

export const QUESTTENDRIL_RANGES: Partial<Record<keyof QuestTendrilConfig, [number, number, number]>> = {
  enabled: [0, 1, 1], curve: [-200, 200, 2], staggerMs: [0, 400, 5], travelMs: [80, 1400, 10], retractMs: [40, 1200, 10],
  wobbleAmp: [0, 40, 0.5], wobbleFreq: [0, 6, 0.1],
  baseWidth: [1, 24, 0.5], tipWidth: [0, 16, 0.5], coreAlpha: [0, 1, 0.02],
  glowWidth: [0, 30, 0.5], glowAlpha: [0, 1, 0.02],
  flashSize: [0, 140, 2], flashMs: [40, 1000, 10],
  moteCount: [0, 40, 1], moteSpeed: [0, 500, 5], moteLife: [80, 1400, 20],
  pulseSize: [0, 120, 2], pulseAlpha: [0, 1, 0.02], pulseMs: [40, 1000, 10],
};

const KEY = 'ascent.questTendril';

let cfg: QuestTendrilConfig = load();

function load(): QuestTendrilConfig {
  // DEV-only persistence, like every other FX tuner — production always renders DEFAULTS.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<QuestTendrilConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getQuestTendrilConfig(): QuestTendrilConfig {
  return cfg;
}
export function setQuestTendrilValue(key: keyof QuestTendrilConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetQuestTendrilConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The config in the shape `pixiFx.buffTendril` wants. `sign` alternates the arc so repeated procs in one
 *  End of Turn bow to opposite sides instead of stacking on the same path. */
export function tendrilCfgFor(sign: number): TendrilCfg {
  const c = cfg;
  return {
    blend: 'add',
    curve: c.curve * sign,
    wobbleAmp: c.wobbleAmp, wobbleFreq: c.wobbleFreq,
    travelMs: c.travelMs, retractMs: c.retractMs,
    baseWidth: c.baseWidth, tipWidth: c.tipWidth,
    coreAlpha: c.coreAlpha, glowWidth: c.glowWidth, glowAlpha: c.glowAlpha,
    flashSize: c.flashSize, flashMs: c.flashMs,
    moteCount: c.moteCount, moteSpeed: c.moteSpeed, moteLife: c.moteLife,
    pulseSize: c.pulseSize, pulseAlpha: c.pulseAlpha, pulseMs: c.pulseMs,
    colorCore: c.colorCore, colorGlow: c.colorGlow, colorFlash: c.colorFlash, colorMote: c.colorMote,
  };
}
