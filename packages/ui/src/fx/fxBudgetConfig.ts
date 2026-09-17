/**
 * The FX BUDGETS — hard ceilings on how much authored-def work may be live at once. Enforced by
 * `fxBudget.ts` at SPAWN time (see there for the trim policy); this module only holds the numbers.
 *
 * ── why budgets exist (owner's 2002 s perf recording, 2026-09-16) ────────────────────────────────────
 * `fx:tick` reached 20.2 ms in a single frame (4.8× the 4.17 ms budget at 240 Hz) with `fx:particles` at
 * 5,778, `fx:filters` at 80 and `fx:layers` at 40. `strike-impact` and `rune-select-implosion` were the
 * top per-def self-time labels in dropped frames. Nothing bounded the population: every clash stacked
 * another `strike-impact` burst on top of the last, and at combat speed the previous burst's shards were
 * still alive when the next one fired. Live particles averaged 3.8× higher in janky seconds.
 *
 * ── what the defaults are sized against ──────────────────────────────────────────────────────────────
 * These are NOT tuning: they sit well ABOVE anything a normal moment reaches, so under ordinary play they
 * never bite and nothing looks different. Measured from the committed defs (sum of each burst layer's
 * `count`, emitter/smoke `rate × life`):
 *
 *   • one melee clash  ≈ 278 particles (`strike-impact` 226 + `damage-burst` 30 + `impact-dust` 22),
 *     ≈ 412 with a `self-buff-burst` (134) on top;
 *   • the heaviest single def is `blast-pump` at ≈ 1,331; `death-dissolve` is 397;
 *   • the largest LEGITIMATE simultaneous moment is a 7-wide fan of one def (a full board dying or being
 *     buffed at once): 7 × `death-dissolve` ≈ 2,779, 7 × `tendril-trail` ≈ 1,456. Both boards together
 *     can fan at most 14 plays of one def in the same frame;
 *   • the heaviest filter stack on one def is 6 (`lightning-bolt-blue`, `spell-target`,
 *     `tendril-trail-kobold`); a 7-wide fan of one is 42.
 *
 * So: `maxParticles` 4,000 clears a full-board death wave plus a clash on top with room to spare, and sits
 * under the 5,778 pile-up the recording caught. `maxPerDef` 24 clears a 14-wide same-frame fan and a second
 * fan stacked on it before the FIRST fan's oldest play is trimmed. `maxFilters` 48 clears a 7-wide fan of
 * the heaviest filter stack. When a cap does bite, it is the OLDEST play (same def first) that goes — a
 * burst that is mostly faded anyway — never the one being spawned, so a single burst always looks as
 * authored and only the pile-up behind it is trimmed.
 *
 * Same pattern as the other FX configs (`buffFxConfig.ts`, `auraFxConfig.ts`): DEV-only localStorage
 * persistence, read at fire time so an edit applies to the NEXT play; production always ships the
 * DEFAULTS. There is no tuner panel for this yet — in DEV, `window.__fx.budget` (see `playDef.ts`) exposes
 * `get` / `set` / `reset` for a live check against the perf HUD's `fx:culled` counter.
 */
export interface FxBudgetConfig {
  /** Global ceiling on live def particles (the pool's `liveParticleCount`) + the incoming play's expected
   *  count. Over it, the oldest trimmable play is released until the incoming one fits (or nothing is left
   *  to trim — the incoming play ALWAYS spawns). */
  maxParticles: number;
  /** Ceiling on concurrent plays of ONE def id. Over it, that def's oldest trimmable play is released. */
  maxPerDef: number;
  /** Global ceiling on filters applied across every live `FilterStack` (each is a render-to-texture pass)
   *  + the incoming play's expected filters. Over it, the oldest trimmable play that HAS filters goes. */
  maxFilters: number;
}

const DEFAULTS: FxBudgetConfig = {
  maxParticles: 4000,
  maxPerDef: 24,
  maxFilters: 48,
};

/** Slider bounds for a DEV tuner — [min, max, step] per key. */
export const FXBUDGET_RANGES: Record<keyof FxBudgetConfig, [number, number, number]> = {
  maxParticles: [500, 20_000, 100],
  maxPerDef: [1, 64, 1],
  maxFilters: [4, 200, 1],
};

/** The shipped values, exported so a tuner can mark which controls have moved away from them. */
export { DEFAULTS as FXBUDGET_DEFAULTS };

const KEY = 'ascent.fxbudget';

/** Accept only a finite, positive number for each key — a hand-edited localStorage value must never turn a
 *  cap into `NaN` (which would compare false against everything and disable the budget silently). */
function sanitize(partial: Partial<Record<keyof FxBudgetConfig, unknown>>): Partial<FxBudgetConfig> {
  const out: Partial<FxBudgetConfig> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof FxBudgetConfig)[]) {
    const v = partial[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: FxBudgetConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...sanitize(saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getFxBudgetConfig(): FxBudgetConfig {
  return cfg;
}
export function setFxBudgetValue(key: keyof FxBudgetConfig, value: number): void {
  const clean = sanitize({ [key]: value });
  if (clean[key] === undefined) return;
  cfg = { ...cfg, [key]: clean[key] };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetFxBudgetConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
