/**
 * Tunable parameters for the AURA WASH FX — the "a run-wide tribe aura just grew" cue: when an aura
 * channel rises (the Undead Lantern aura, the Imp aura, Scrap Herald's Attachment aura, the Beast
 * buy-aura — see `RunState.auraFx`), a soft TRIBE-COLORED bloom sweeps bottom→top through every affected
 * card (board + tavern) at once: a card-filling glow, a rising band, sparkle motes drifting up, and a
 * landing ring as the sweep tops out. Reads as "a field touched everyone" — distinct from the tendril
 * (a source hit a target) and the gust (the shop row got rushed).
 *
 * Same pattern as `gustFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "🌀 Aura Wash" tuner (`AuraFxTuner.tsx`); `getAuraFxConfig()` is read at fire time, so edits apply to
 * the NEXT wash. Colors are NOT here — they come from the tribe's `BUFF_PRESETS` palette at fire time,
 * so the wash always matches the tribe's tendril look.
 */
export interface AuraFxConfig {
  riseMs: number;      // ms — the band's bottom→top sweep per card
  holdMs: number;      // ms — full-brightness pause once the sweep lands
  fadeMs: number;      // ms — whole-wash fade-out
  staggerMs: number;   // ms — per-card start delay left→right (0 = all together)
  fillAlpha: number;   // 0..1 — the soft card-filling glow at peak (0 = off)
  padPx: number;       // px — how far the fill extends beyond the card bounds
  sweepAlpha: number;  // 0..1 — the rising band's brightness (0 = off)
  sweepFrac: number;   // 0..1 — the band's height as a fraction of the card
  moteCount: number;   // rising sparkle motes per card (0 = off)
  moteSize: number;    // px — sparkle size
  moteLife: number;    // ms — sparkle lifetime
  moteRise: number;    // px/s — upward drift of the sparkles
  ringSize: number;    // px radius — the landing ring popped at card-centre when the sweep tops out (0 = off)
  ringMs: number;      // ms — the ring's expand+fade
  ringAlpha: number;   // 0..1 — ring peak opacity
  liftPx: number;      // px — how high each card LIFTS as its wash lands (0 = off)
  liftMs: number;      // ms — the lift → settle
}

const DEFAULTS: AuraFxConfig = {
  riseMs: 420,
  holdMs: 90,
  fadeMs: 380,
  staggerMs: 55,
  fillAlpha: 0.2,
  padPx: 6,
  sweepAlpha: 0.45,
  sweepFrac: 0.32,
  moteCount: 9,
  moteSize: 10,
  moteLife: 640,
  moteRise: 120,
  ringSize: 70,
  ringMs: 260,
  ringAlpha: 0.3,
  liftPx: 5,
  liftMs: 420,
};

export const AURAFX_KEYS = [
  'riseMs', 'holdMs', 'fadeMs', 'staggerMs',
  'fillAlpha', 'padPx', 'sweepAlpha', 'sweepFrac',
  'moteCount', 'moteSize', 'moteLife', 'moteRise',
  'ringSize', 'ringMs', 'ringAlpha',
  'liftPx', 'liftMs',
] as const satisfies readonly (keyof AuraFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const AURAFX_RANGES: Partial<Record<keyof AuraFxConfig, [number, number, number]>> = {
  riseMs: [120, 1200, 10], holdMs: [0, 800, 10], fadeMs: [80, 1200, 10], staggerMs: [0, 200, 5],
  fillAlpha: [0, 0.6, 0.02], padPx: [0, 24, 1], sweepAlpha: [0, 1, 0.05], sweepFrac: [0.1, 1, 0.02],
  moteCount: [0, 24, 1], moteSize: [2, 20, 1], moteLife: [100, 1500, 10], moteRise: [0, 250, 5],
  ringSize: [0, 200, 5], ringMs: [0, 800, 10], ringAlpha: [0, 1, 0.05],
  liftPx: [0, 16, 0.5], liftMs: [100, 1000, 10],
};

const KEY = 'ascent.aurafx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: AuraFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AuraFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getAuraFxConfig(): AuraFxConfig {
  return cfg;
}
export function setAuraFxValue(key: keyof AuraFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetAuraFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * LIFT & SETTLE: as each card's wash LANDS (its staggered sweep tops out), the card lifts a few px and
 * springs back — the physical "the aura kissed it" read. One-shot, transform-only (Web Animations API
 * with `composite: 'add'`, stacking on any CSS transform the card carries) — never a looping paint
 * animation. Mirrors `applyGustLift`.
 */
export function applyAuraLift(els: Element[]): void {
  const c = cfg;
  if (c.liftPx <= 0 || c.liftMs <= 0) return;
  els.forEach((el, i) => {
    try {
      el.animate([
        { transform: 'translateY(0)' },
        { transform: `translateY(${-c.liftPx}px)`, offset: 0.35 },
        { transform: `translateY(${c.liftPx * 0.2}px)`, offset: 0.7 },
        { transform: 'translateY(0)' },
      ], { duration: c.liftMs, delay: c.riseMs + i * c.staggerMs, easing: 'ease-in-out', composite: 'add' });
    } catch { /* WAAPI composite unsupported: skip the lift rather than clobber the card transform */ }
  });
}
