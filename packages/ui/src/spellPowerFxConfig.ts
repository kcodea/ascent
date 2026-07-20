/**
 * Tunable parameters for the SPELL POWER FX — the "a spell just resolved, and here's the power behind it"
 * cue (owner ask 2026-07-21): a fan of pink/purple/gold ARROWS rises from the caster, a BLAST of motes pops
 * at the origin, and the run's CURRENT spell power floats up as a number once the arrows land.
 *
 * Fires in BOTH phases off one signal: the shop stamps `spellPowerFxSeq` from the reducer's spell-cast delta,
 * and the combat replay fires the same primitive on a `cast` event. Same trio pattern as `gustFxConfig.ts`:
 * one mutable, localStorage-persisted config dialed via the DEV "✨ Spell Power" tuner
 * (`SpellPowerFxTuner.tsx`); `getSpellPowerFxConfig()` is read at FIRE TIME (`pixiFx.spellPower`), so an edit
 * applies to the NEXT cast rather than needing a reload.
 *
 * Performance: every particle is transform/alpha-driven inside the existing Pixi layer, and the floating
 * number is a one-shot DOM element that removes itself. Nothing here loops, so nothing repaints per frame
 * once a cast has played out.
 */
export interface SpellPowerFxConfig {
  // ---- the rising arrows ----
  arrowCount: number;   // arrows per cast, fanned across the spread
  arrowRise: number;    // px — how far an arrow travels upward
  arrowSpread: number;  // px — horizontal fan width the arrows launch across
  arrowLen: number;     // px — an arrow's shaft length
  arrowWidth: number;   // px — shaft stroke width
  arrowHead: number;    // px — arrowhead size
  arrowMs: number;      // ms — a single arrow's rise
  arrowStagger: number; // ms — delay between successive arrows
  arrowDrift: number;   // px — sideways wander over the rise (alternating, for an organic fan)
  arrowFadeAt: number;  // 0..1 — fraction of the rise after which an arrow starts fading

  // ---- the origin blast ----
  blastCount: number;   // motes popped at the caster (0 = off)
  blastSpeed: number;   // px/s — initial mote speed
  blastSize: number;    // px — mote size
  blastLife: number;    // ms — mote lifetime
  blastGravity: number; // px/s² — downward pull on the motes (0 = float free)
  blastSpread: number;  // degrees — arc the shrapnel is thrown across (360 = full ring, 90 = a cone)
  blastAngle: number;   // degrees — which way that cone points (0 = up, 90 = right)
  blastDrag: number;    // 0..1 per frame — how fast the motes slow (0 = coast, 1 = stop dead)
  blastJitter: number;  // 0..1 — random speed variance per mote (0 = every mote identical)
  blastRise: number;    // px/s — extra upward kick at spawn, on top of the cone direction
  blastSpin: number;    // deg/s — mote rotation (visible on non-round sprites; keeps a burst from feeling static)
  blastStagger: number; // ms — delay between motes (0 = all at once; >0 = a sputtering spray)
  blastShrink: number;  // 0..1 — end scale as a fraction of start (0 = shrink to nothing, 1 = hold size)

  // ---- the floating spell-power number ----
  numShow: number;      // 1 = show the number, 0 = arrows + blast only
  numSize: number;      // px — font size
  numRise: number;      // px — how far the number floats up
  numDelay: number;     // ms — wait after the cast before it appears (lets the arrows land first)
  numHoldMs: number;    // ms — full-opacity hold
  numFadeMs: number;    // ms — fade-out

  // ---- palette (the owner's pink/purple/gold) ----
  colorA: string;       // arrow core — pink
  colorB: string;       // arrow alt — purple
  colorC: string;       // accent / blast — gold
  colorText: string;    // the floating number's fill
  colorOutline: string; // the floating number's outline / glow ring
  glowAlpha: number;    // 0..1 — soft underlay around each arrow stroke
  glowWidth: number;    // px — that underlay's extra width
}

// Shipping defaults — a readable fan that reads at a glance without burying the board. Deliberately modest:
// a spell can fire several times a turn, so this is a punctuation mark, not a cutscene.
const DEFAULTS: SpellPowerFxConfig = {
  arrowCount: 7,
  arrowRise: 120,
  arrowSpread: 74,
  arrowLen: 26,
  arrowWidth: 3,
  arrowHead: 9,
  arrowMs: 520,
  arrowStagger: 34,
  arrowDrift: 14,
  arrowFadeAt: 0.62,

  blastCount: 16,
  blastSpeed: 190,
  blastSize: 4,
  blastLife: 520,
  blastGravity: 220,
  blastSpread: 360,
  blastAngle: 0,
  blastDrag: 0.06,
  blastJitter: 0.5,
  blastRise: 48,
  blastSpin: 0,
  blastStagger: 0,
  blastShrink: 0.12,

  numShow: 1,
  numSize: 30,
  numRise: 46,
  numDelay: 260,
  numHoldMs: 420,
  numFadeMs: 380,

  colorA: '#ff5fc8',
  colorB: '#a45cff',
  colorC: '#ffcf5a',
  colorText: '#ffffff',
  colorOutline: '#7a2bd0',
  glowAlpha: 0.5,
  glowWidth: 5,
};

export const SPELLPOWERFX_KEYS = [
  'arrowCount', 'arrowRise', 'arrowSpread', 'arrowLen', 'arrowWidth', 'arrowHead', 'arrowMs', 'arrowStagger',
  'arrowDrift', 'arrowFadeAt',
  'blastCount', 'blastSpeed', 'blastSize', 'blastLife', 'blastGravity',
  'blastSpread', 'blastAngle', 'blastDrag', 'blastJitter', 'blastRise', 'blastSpin', 'blastStagger', 'blastShrink',
  'numShow', 'numSize', 'numRise', 'numDelay', 'numHoldMs', 'numFadeMs',
  'glowAlpha', 'glowWidth',
  'colorA', 'colorB', 'colorC', 'colorText', 'colorOutline',
] as const satisfies readonly (keyof SpellPowerFxConfig)[];

export const SPELLPOWERFX_COLOR_KEYS: (keyof SpellPowerFxConfig)[] = ['colorA', 'colorB', 'colorC', 'colorText', 'colorOutline'];

export const SPELLPOWERFX_RANGES: Partial<Record<keyof SpellPowerFxConfig, [number, number, number]>> = {
  arrowCount: [1, 20, 1], arrowRise: [20, 320, 2], arrowSpread: [0, 260, 2], arrowLen: [6, 80, 1],
  arrowWidth: [1, 12, 0.5], arrowHead: [0, 28, 0.5], arrowMs: [120, 1600, 10], arrowStagger: [0, 160, 2],
  arrowDrift: [0, 90, 1], arrowFadeAt: [0, 1, 0.02],
  blastCount: [0, 60, 1], blastSpeed: [0, 600, 5], blastSize: [1, 20, 0.5], blastLife: [80, 1600, 20],
  blastGravity: [0, 900, 10],
  blastSpread: [0, 360, 5], blastAngle: [0, 360, 5], blastDrag: [0, 0.5, 0.01], blastJitter: [0, 1, 0.02],
  blastRise: [0, 400, 5], blastSpin: [0, 720, 10], blastStagger: [0, 120, 1], blastShrink: [0, 1, 0.02],
  numShow: [0, 1, 1], numSize: [10, 80, 1], numRise: [0, 180, 2], numDelay: [0, 1200, 10],
  numHoldMs: [0, 1600, 20], numFadeMs: [40, 1600, 20],
  glowAlpha: [0, 1, 0.02], glowWidth: [0, 24, 0.5],
};

const KEY = 'ascent.spellPowerFx';

let cfg: SpellPowerFxConfig = load();

function load(): SpellPowerFxConfig {
  // DEV-only persistence, matching every other FX tuner: production always renders DEFAULTS, so a dialed-in
  // localStorage on a dev machine can never leak into what players see.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SpellPowerFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSpellPowerFxConfig(): SpellPowerFxConfig {
  return cfg;
}
export function getSpellPowerFxDefaults(): SpellPowerFxConfig {
  return { ...DEFAULTS };
}
export function setSpellPowerFxValue(key: keyof SpellPowerFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetSpellPowerFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * The floating spell-power number. A one-shot DOM element rather than a Pixi one: `pixiFx` never imports
 * `Text` (it would pull a font atlas into the FX bundle for this single use), and the number wants the same
 * crisp UI font as the rest of the HUD. Animated with the Web Animations API — transform + opacity only, so
 * it stays compositor-side — and removes itself on finish, leaving no node behind.
 *
 * Shared by the shop fire and the tuner's ▶ Test, so both read identically.
 */
export function floatSpellPowerNumber(x: number, y: number, atk: number, hp: number): void {
  const c = cfg;
  if (!c.numShow || typeof document === 'undefined') return;
  // Nothing gained → nothing to say. (Guards the case where a caller fires the arrows for a non-gain.)
  if (atk <= 0 && hp <= 0) return;
  // Spell power is a PAIR, and a source can move one stat alone — Cinderwing Matron grants Health only. Print
  // the game's established stat-pair form when both moved, and the single stat when only one did, so the
  // player reads exactly what changed instead of a merged number.
  const label = atk > 0 && hp > 0 ? `+${atk}/+${hp}` : atk > 0 ? `+${atk} Atk` : `+${hp} HP`;
  const el = document.createElement('div');
  el.className = 'spellpower-float';
  el.textContent = label;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.fontSize = `${c.numSize}px`;
  el.style.setProperty('--spf-text', c.colorText);
  el.style.setProperty('--spf-outline', c.colorOutline);
  document.body.appendChild(el);
  const total = c.numHoldMs + c.numFadeMs;
  try {
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.22 },
      { transform: `translate(-50%, calc(-50% - ${c.numRise * 0.7}px)) scale(1)`, opacity: 1, offset: c.numHoldMs / total },
      { transform: `translate(-50%, calc(-50% - ${c.numRise}px)) scale(0.96)`, opacity: 0 },
    ], { duration: total, delay: c.numDelay, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)', fill: 'backwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  } catch {
    // WAAPI unavailable: don't strand a permanent number on the board.
    el.remove();
  }
}
