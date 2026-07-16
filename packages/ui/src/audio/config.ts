/** Audio config — the single source of truth for levels, buses, and the master limiter. Pure (no Web Audio):
 *  sfx.ts reads it to build/tune the graph; the dev desk edits it; helpers here are unit-tested. */

export type BusName = 'ui' | 'combat' | 'voice' | 'hero';
export const BUS_NAMES: BusName[] = ['ui', 'combat', 'voice', 'hero'];

export interface CompConfig { threshold: number; knee: number; ratio: number; attack: number; release: number; }
export interface BusConfig { gain: number; comp: CompConfig | null; }
export interface CategoryConfig { bus: BusName; gain: number; }
export interface AudioConfig {
  masterGain: number;
  master: CompConfig;
  buses: Record<BusName, BusConfig>;
  categories: Record<string, CategoryConfig>;
  clips: Record<string, number>;
}

/** Per-category gains — the owner's by-ear mix, exported from the dev SFX desk and pasted here as the shipped
 *  defaults (2026-07-15). `buff` is a synth-only cue so its gain is inert (see buildCategories) but kept to match
 *  the exported config. */
export const CATEGORY_GAINS: Record<string, number> = {
  buy: 0.5, sell: 0.27, smack: 0.29, crit: 0.44, attack: 0.25, death: 0.54, shield: 0.45, triple: 0.47, cast: 0.5, maxgold: 0.22, cardlanding: 0.33, castspell: 0.68, discover: 0.5, taunt: 0.3,
  reorder: 0.225, deny: 0.5, freeze: 0.31, unfreeze: 0.35, pulse: 0.5, triggerpulse: 0.21, triggerglow: 0.5,
  clickthock: 0.39, cardtouch: 0.27, divineshieldbreak: 0.21, rebornshatter: 0.16, rebornsummon: 0.28,
  skullburst: 0.06, inspect: 0.5, upgrade: 0.37, roll: 0.88, combatStart: 0.64, cardVoice: 0.11,
  cardEffect: 0.18, cardDeath: 0.18, heroSelect: 0.5, heroPower: 0.5, summon: 0.24, buff: 0.46, turncharge: 0.5, turnexplosion: 0.5,
};

/** Which bus each category feeds (seeded default; reassignable live in the desk). */
export const CATEGORY_BUS: Record<string, BusName> = {
  buy: 'ui', sell: 'ui', roll: 'ui', freeze: 'ui', unfreeze: 'ui', discover: 'ui', inspect: 'ui',
  clickthock: 'ui', cardtouch: 'ui', reorder: 'ui', upgrade: 'ui', deny: 'ui', pulse: 'ui',
  cardlanding: 'ui', castspell: 'ui', triple: 'ui', combatStart: 'ui', turncharge: 'ui', turnexplosion: 'ui',
  smack: 'combat', crit: 'combat', attack: 'combat', death: 'combat', cast: 'combat', divineshieldbreak: 'combat', rebornshatter: 'combat', rebornsummon: 'combat',
  skullburst: 'combat', triggerpulse: 'combat', triggerglow: 'combat', buff: 'combat', maxgold: 'combat',
  summon: 'combat', taunt: 'combat', shield: 'combat',
  cardVoice: 'voice', cardEffect: 'voice', cardDeath: 'voice',
  heroSelect: 'hero', heroPower: 'hero',
};

const UNMAPPED: CategoryConfig = { bus: 'ui', gain: 0.6 };

function buildCategories(): Record<string, CategoryConfig> {
  const out: Record<string, CategoryConfig> = {};
  // Union both maps: every category carries a tuned gain; a category in CATEGORY_BUS with no CATEGORY_GAINS
  // entry falls back to unity. NB: for a SYNTH-only cue (e.g. `buff`) the category gain is *inert* — its
  // loudness is the cue's own literal synth vol; the category gain only scales SOURCED clips. So for a synth
  // cue the category is effectively routing-only (which bus its fader controls), and its gain is cosmetic.
  const keys = new Set([...Object.keys(CATEGORY_GAINS), ...Object.keys(CATEGORY_BUS)]);
  for (const key of keys) {
    out[key] = { bus: CATEGORY_BUS[key] ?? 'ui', gain: CATEGORY_GAINS[key] ?? 1 };
  }
  return out;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  masterGain: 0.8,
  master: { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.25 },
  buses: { ui: { gain: 1, comp: null }, combat: { gain: 1, comp: null }, voice: { gain: 1, comp: null }, hero: { gain: 1, comp: null } },
  categories: buildCategories(),
  clips: {},
};

/** Deep-merge a saved (partial) config over the defaults: saved scalars/entries win; missing fields filled. */
export function mergeConfig(base: AudioConfig, saved: Partial<AudioConfig> | null | undefined): AudioConfig {
  const s = saved ?? {};
  return {
    masterGain: s.masterGain ?? base.masterGain,
    master: { ...base.master, ...(s.master ?? {}) },
    buses: {
      ui: { ...base.buses.ui, ...(s.buses?.ui ?? {}) },
      combat: { ...base.buses.combat, ...(s.buses?.combat ?? {}) },
      voice: { ...base.buses.voice, ...(s.buses?.voice ?? {}) },
      hero: { ...base.buses.hero, ...(s.buses?.hero ?? {}) },
    },
    categories: { ...base.categories, ...(s.categories ?? {}) },
    clips: { ...base.clips, ...(s.clips ?? {}) },
  };
}

/** The category's bus (unmapped → ui). */
export function busOf(cfg: AudioConfig, category: string): BusName {
  return (cfg.categories[category] ?? UNMAPPED).bus;
}

/** category gain × optional per-clip override (unmapped category → 0.6). */
export function effectiveGain(cfg: AudioConfig, category: string, clipKey?: string): number {
  const g = (cfg.categories[category] ?? UNMAPPED).gain;
  const o = clipKey != null ? (cfg.clips[clipKey] ?? 1) : 1;
  return g * o;
}
