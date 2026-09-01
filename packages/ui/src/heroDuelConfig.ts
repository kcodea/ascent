/**
 * THE HERO DUEL — the post-combat sequence: the damage tallies off the winner's surviving board, lands on that
 * hero as an attack pill, and the hero winds up and lunges at the loser (owner ask 2026-08-25).
 *
 * This config owns the parts of that sequence THIS code authored: where the foe's portrait sits, how the pill
 * is sized and placed, and the beat timings between tally → pill → swing → settle.
 *
 * It deliberately does NOT duplicate the lunge's own internals. The wind-up curve, the strike ease bands, the
 * lead tilt, the defender spin and the impact FX/sounds are Mike's authored work and already have their own
 * tuners (🗡️ Lunge, ⚡ Crit FX, and the impact defs in the FX workbench) — the hero strike runs through those
 * exact channels on purpose, so tuning them there tunes this too. What lives here is the sequence around them.
 *
 * Config is localStorage-persisted in DEV only; PRODUCTION renders DEFAULTS (Layout Lab convention). The
 * placement values reflect to `--hd-*` CSS vars, whose fallbacks in styles.css MUST mirror DEFAULTS.
 */
export interface HeroDuelConfig {
  /** Opponent portrait — scale, and px offsets from its Refresh-button anchor. */
  oppScale: number;
  oppX: number;
  oppY: number;
  /** The foe's NAME plate — sits above the portrait. Scale + px offsets. */
  nameScale: number;
  nameX: number;
  nameY: number;
  /** The foe's HEALTH pill — sits below the portrait. Scale + px offsets. */
  hpScale: number;
  hpX: number;
  hpY: number;
  /** The foe's HERO POWER icon — the display-only circle pinned top-right during combat. Px offsets from
   *  its corner anchor (positive X = rightward, positive Y = down). */
  powerX: number;
  powerY: number;
  powerScale: number;
  powerAlpha: number;
  /** The OPPONENT's attack pill — scale, and px offsets from its portrait's bottom centre. */
  pillScale: number;
  pillX: number;
  pillY: number;
  /** YOUR attack pill — independent of the opponent's, so each can be placed for its own portrait. */
  pillPlayerScale: number;
  pillPlayerX: number;
  pillPlayerY: number;
  /** The RED damage-taken number — scale + position, so it can be sized independently of the portrait. */
  dmgScale: number;
  dmgX: number;
  dmgY: number;
  /** Hero-duel SFX (owner ask 2026-08-25): when each lands (ms, relative to its cue) and how loud (× the mix). */
  sfxTravelDelay: number;
  sfxTravelVol: number;
  sfxAddDelay: number;
  sfxAddVol: number;
  sfxImpactDelay: number;
  sfxImpactVol: number;
  sfxCounterDelay: number;
  sfxCounterVol: number;
  /** The opponent's RUNE badges — scale, position of the row, and the gap between badges. */
  runeScale: number;
  runeX: number;
  runeY: number;
  runeGap: number;
  /** PER-RUNE nudges (design px) on top of the row placement — one pair per slot, top to bottom (owner ask
   *  2026-08-29). Unused slots' knobs are simply inert. */
  rune1X: number; rune1Y: number;
  rune2X: number; rune2Y: number;
  rune3X: number; rune3Y: number;
  /** Persistent RUNE-SLOT background plates (owner ask 2026-08-31) — three art circles that ALWAYS show where
   *  the opponent's runes will socket; the rune art overlays them. Each has its own X/Y (design px, × --scale)
   *  and size, and shares the runes' positioning frame so they stay aligned. Slot 1 = right, 3 = left. */
  slot1X: number; slot1Y: number; slot1S: number;
  slot2X: number; slot2Y: number; slot2S: number;
  slot3X: number; slot3Y: number; slot3S: number;
  /** Gap (ms) between each tallied number leaving its card. */
  tallyStagger: number;
  /** Flight time (ms) of a tallied number to the counter. */
  tallyFly: number;
  /** Beat (ms) the pill holds on the winner before the wind-up begins. */
  pillHold: number;
  /** Swing speed multiplier — feeds the lunge's own speed scaling (1 = the combat speed the fight ran at). */
  strikeSpeed: number;
  /** How hard the blow reads: scales the damage handed to `hitPower`, i.e. the impact's weight/FX intensity. */
  impactPower: number;
  /** Settle (ms) held after the blow lands before the pill retires and the sequence ends. */
  settleMs: number;
}

// Mirror the styles.css fallbacks. Timings are the shipped feel; placement is the anchor that reads correctly
// against the board frame at the default stage scale.
// Owner-tuned baseline (2026-08-25, re-tuned 2026-08-27: slower heavier strike, quicker settle). Keep
// the styles.css `--hd-*` fallbacks in sync with these (they mirror this table).
const DEFAULTS: HeroDuelConfig = {
  // oppX/oppY are REFERENCE px (× --scale in styles.css) offset from the foe HERO POWER anchor — the portrait
  // rides with the power so both stay pinned to the board at any stage size (owner ask 2026-08-29).
  oppScale: 2.4,
  oppX: 144,
  oppY: 41,
  // name/hp/pill/rune offsets are now REFERENCE px (× --scale in styles.css) so the whole opponent panel stays
  // pinned to the board at any screen size (owner report 2026-08-29: runes read "off" on a friend's screen).
  nameScale: 0.65,
  nameX: 0,
  nameY: 45,
  hpScale: 0.65,
  hpX: 0,
  hpY: -45,
  // REFERENCE px (× --scale in styles.css), so the icon stays pinned to the board at any stage size — was raw
  // px, which skewed off the board on a non-fullscreen stage (owner report 2026-08-29). Owner-tuned on the
  // fixed (scale-relative) build.
  powerX: -386,
  powerY: 191,
  powerScale: 0.87,
  powerAlpha: 1,
  pillScale: 0.72,
  pillX: -117,
  pillY: -31,
  pillPlayerScale: 0.55,
  pillPlayerX: 72,
  pillPlayerY: -12,
  dmgScale: 0.48,
  dmgX: 0,
  dmgY: 0,
  sfxTravelDelay: -320,
  sfxTravelVol: 1,
  sfxAddDelay: 0,
  sfxAddVol: 1.25,
  sfxImpactDelay: -500,
  sfxImpactVol: 1,
  sfxCounterDelay: -1220,
  sfxCounterVol: 1,
  runeScale: 1,
  runeX: -290,
  runeY: -37,
  runeGap: 39,
  rune1X: 450, rune1Y: 87,
  rune2X: 360, rune2Y: -8,
  rune3X: 281, rune3Y: -75,
  // Slot backgrounds sit behind the runes (owner-tuned 2026-08-31), sized up so the plate frames each rune.
  slot1X: 450, slot1Y: 87, slot1S: 1.65,
  slot2X: 360, slot2Y: -8, slot2S: 1.65,
  slot3X: 281, slot3Y: -75, slot3S: 1.65,
  tallyStagger: 130,
  tallyFly: 430,
  pillHold: 260,
  strikeSpeed: 1.15,
  impactPower: 3.45,
  settleMs: 110,
};

export const HERO_DUEL_RANGES: Record<keyof HeroDuelConfig, [number, number, number]> = {
  oppScale: [0.4, 2.2, 0.01],
  oppX: [-500, 500, 1],
  oppY: [-500, 500, 1],
  nameScale: [0.4, 3, 0.01],
  nameX: [-200, 200, 1],
  nameY: [-200, 200, 1],
  hpScale: [0.4, 3, 0.01],
  hpX: [-200, 200, 1],
  hpY: [-200, 200, 1],
  powerX: [-800, 800, 1],
  powerY: [-800, 800, 1],
  powerScale: [0.3, 2.5, 0.01],
  powerAlpha: [0, 1, 0.01],
  pillScale: [0.4, 3, 0.01],
  pillX: [-120, 120, 1],
  pillY: [-120, 120, 1],
  pillPlayerScale: [0.4, 3, 0.01],
  pillPlayerX: [-120, 120, 1],
  pillPlayerY: [-120, 120, 1],
  dmgScale: [0.3, 3, 0.01],
  dmgX: [-200, 200, 1],
  dmgY: [-200, 200, 1],
  sfxTravelDelay: [-1500, 1500, 10],
  sfxTravelVol: [0, 2, 0.05],
  sfxAddDelay: [-1500, 1500, 10],
  sfxAddVol: [0, 2, 0.05],
  sfxImpactDelay: [-1500, 1500, 10],
  sfxImpactVol: [0, 2, 0.05],
  sfxCounterDelay: [-1500, 1500, 10],
  sfxCounterVol: [0, 2, 0.05],
  runeScale: [0.3, 2.5, 0.01],
  runeX: [-300, 300, 1],
  runeY: [-300, 300, 1],
  runeGap: [0, 40, 1],
  rune1X: [-300, 300, 1], rune1Y: [-300, 300, 1],
  rune2X: [-300, 300, 1], rune2Y: [-300, 300, 1],
  rune3X: [-300, 300, 1], rune3Y: [-300, 300, 1],
  slot1X: [-300, 300, 1], slot1Y: [-300, 300, 1], slot1S: [0.3, 3, 0.01],
  slot2X: [-300, 300, 1], slot2Y: [-300, 300, 1], slot2S: [0.3, 3, 0.01],
  slot3X: [-300, 300, 1], slot3Y: [-300, 300, 1], slot3S: [0.3, 3, 0.01],
  tallyStagger: [0, 500, 5],
  tallyFly: [80, 1500, 10],
  pillHold: [0, 1500, 10],
  strikeSpeed: [0.25, 3, 0.05],
  impactPower: [0.2, 4, 0.05],
  settleMs: [0, 2500, 10],
};

export const HERO_DUEL_DESC: Record<keyof HeroDuelConfig, string> = {
  oppScale: "Size of the opponent's portrait that drops in for the fight.",
  oppX: "Move the opponent's portrait horizontally from its foe-hero-power anchor.",
  oppY: "Move the opponent's portrait vertically from its foe-hero-power anchor.",
  nameScale: "Size of the opponent's name plate.",
  nameX: "Move the name plate horizontally.",
  nameY: "Move the name plate vertically (it sits above the portrait).",
  hpScale: "Size of the opponent's health pill.",
  hpX: 'Move the health pill horizontally.',
  hpY: 'Move the health pill vertically (it sits below the portrait).',
  powerX: "Move the foe's hero-power icon horizontally from its top-right corner anchor.",
  powerY: "Move the foe's hero-power icon vertically from its corner anchor.",
  powerScale: "Size of the foe's hero-power icon.",
  powerAlpha: "Opacity of the foe's hero-power icon (1 = solid).",
  pillScale: "Size of the opponent's attack pill.",
  pillX: "Move the opponent's attack pill horizontally.",
  pillY: "Move the opponent's attack pill vertically.",
  pillPlayerScale: 'Size of YOUR attack pill.',
  pillPlayerX: 'Move your attack pill horizontally.',
  pillPlayerY: 'Move your attack pill vertically.',
  dmgScale: 'Size of the red damage number on a struck hero.',
  dmgX: 'Move the damage number horizontally.',
  dmgY: 'Move the damage number vertically.',
  sfxTravelDelay: 'Nudge the tally-travel sound EARLIER (−) or later (+) than its launch cue.',
  sfxTravelVol: 'Loudness of the tally-travel sound.',
  sfxAddDelay: 'Nudge the pill-add sound EARLIER (−) or later (+) than the tally landing.',
  sfxAddVol: 'Loudness of the pill-add sound.',
  sfxImpactDelay: 'Nudge the tally-impact sound EARLIER (−) or later (+) than the tally landing.',
  sfxImpactVol: 'Loudness of the tally-impact sound.',
  sfxCounterDelay: 'Nudge the tally-counter sound EARLIER (−) or later (+) than the count-up start.',
  sfxCounterVol: 'Loudness of the tally-counter sound (as the numbers climb).',
  runeScale: "Size of the opponent's rune badges (1 = the same size as your runes).",
  runeX: 'Move the rune row horizontally from the portrait.',
  runeY: 'Move the rune row vertically.',
  runeGap: 'Space between the rune badges.',
  rune1X: 'Nudge the FIRST (top) rune badge horizontally.', rune1Y: 'Nudge the first rune badge vertically.',
  rune2X: 'Nudge the SECOND rune badge horizontally.', rune2Y: 'Nudge the second rune badge vertically.',
  rune3X: 'Nudge the THIRD rune badge horizontally.', rune3Y: 'Nudge the third rune badge vertically.',
  slot1X: 'Move the FIRST (right) rune-slot background horizontally.', slot1Y: 'Move the first rune-slot background vertically.', slot1S: 'Size of the first rune-slot background.',
  slot2X: 'Move the SECOND (middle) rune-slot background horizontally.', slot2Y: 'Move the second rune-slot background vertically.', slot2S: 'Size of the second rune-slot background.',
  slot3X: 'Move the THIRD (left) rune-slot background horizontally.', slot3Y: 'Move the third rune-slot background vertically.', slot3S: 'Size of the third rune-slot background.',
  tallyStagger: 'Gap between each damage number leaving its card.',
  tallyFly: 'How long a damage number takes to reach the counter.',
  pillHold: 'Pause after the pill appears, before the hero winds up.',
  strikeSpeed: 'Swing speed. Higher is faster; feeds the lunge’s own speed scaling.',
  impactPower: 'How heavy the blow reads — scales the impact FX intensity and shake.',
  settleMs: 'Hold after the blow lands, before the pill retires and the shop returns.',
};

export { DEFAULTS as HERO_DUEL_DEFAULTS };

const KEY = 'ascent.heroduel';
let cfg: HeroDuelConfig = (() => {
  if (typeof localStorage === 'undefined' || !import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroDuelConfig>) : {}) };
  } catch { return { ...DEFAULTS }; }
})();

export function getHeroDuelConfig(): HeroDuelConfig { return cfg; }

/** Reflect the PLACEMENT values onto :root as `--hd-*`. Timings are read directly by the sequence, not by CSS. */
export function applyHeroDuelVars(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--hd-opp-s', String(cfg.oppScale));
  r.setProperty('--hd-opp-x', `${cfg.oppX}px`);
  r.setProperty('--hd-opp-y', `${cfg.oppY}px`);
  r.setProperty('--hd-name-s', String(cfg.nameScale));
  r.setProperty('--hd-name-x', `${cfg.nameX}px`);
  r.setProperty('--hd-name-y', `${cfg.nameY}px`);
  r.setProperty('--hd-hp-s', String(cfg.hpScale));
  r.setProperty('--hd-hp-x', `${cfg.hpX}px`);
  r.setProperty('--hd-hp-y', `${cfg.hpY}px`);
  r.setProperty('--hd-power-x', `${cfg.powerX}px`);
  r.setProperty('--hd-power-y', `${cfg.powerY}px`);
  r.setProperty('--hd-power-s', String(cfg.powerScale));
  r.setProperty('--hd-power-alpha', String(cfg.powerAlpha));
  r.setProperty('--hd-pill-opp-s', String(cfg.pillScale));
  r.setProperty('--hd-pill-opp-x', `${cfg.pillX}px`);
  r.setProperty('--hd-pill-opp-y', `${cfg.pillY}px`);
  r.setProperty('--hd-pill-player-s', String(cfg.pillPlayerScale));
  r.setProperty('--hd-pill-player-x', `${cfg.pillPlayerX}px`);
  r.setProperty('--hd-pill-player-y', `${cfg.pillPlayerY}px`);
  r.setProperty('--hd-dmg-s', String(cfg.dmgScale));
  r.setProperty('--hd-dmg-x', `${cfg.dmgX}px`);
  r.setProperty('--hd-dmg-y', `${cfg.dmgY}px`);
  r.setProperty('--hd-rune-s', String(cfg.runeScale));
  r.setProperty('--hd-rune-x', `${cfg.runeX}px`);
  r.setProperty('--hd-rune-y', `${cfg.runeY}px`);
  for (const n of [1, 2, 3] as const) {
    r.setProperty(`--hd-rune${n}-x`, `${cfg[`rune${n}X`]}px`);
    r.setProperty(`--hd-rune${n}-y`, `${cfg[`rune${n}Y`]}px`);
    r.setProperty(`--hd-slot${n}-x`, `${cfg[`slot${n}X`]}px`);
    r.setProperty(`--hd-slot${n}-y`, `${cfg[`slot${n}Y`]}px`);
    r.setProperty(`--hd-slot${n}-s`, String(cfg[`slot${n}S`]));
  }
  r.setProperty('--hd-rune-gap', `${cfg.runeGap}px`);
}

export function setHeroDuelValue(key: keyof HeroDuelConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyHeroDuelVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroDuelConfig(): void {
  cfg = { ...DEFAULTS };
  applyHeroDuelVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

applyHeroDuelVars();
