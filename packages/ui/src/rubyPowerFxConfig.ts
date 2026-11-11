import { stageHost, toScreen, toStage } from './stage';
import { setGlowText } from './webkitText';
import { playDef } from './fx/playDef';
import { sfx } from './sfx';
/**
 * Tunable parameters for the RUBY POWER FX — the "your Rubies just got stronger" cue (owner ask 2026-07-24):
 * the Ruby-side sibling of the Spell Power FX, with its own independent dials so the two reads can diverge.
 *
 * It fires on the same RULESET the Spell Power FX uses, just keyed on the other stat: one bump per action in
 * which the run's `rubyBonus` GOES UP, by any source and any amount — never per Ruby cast. That covers the shop,
 * End of Turn, and mid-combat Echo/Avenge sources (Veinbreaker), because the sim now emits a `+A/+H Ruby Power`
 * narration the combat replay rides, exactly as spell power does.
 *
 * Why a full copy rather than parameterising the spell-power config: the owner wants to modify this one
 * separately, so it needs its own persisted values, its own tuner and its own defaults. Shared code here would
 * mean every future divergence has to be re-split.
 *
 * `getRubyPowerFxConfig()` is read at FIRE TIME (`pixiFx.rubyPower`), so a tuner edit applies to the NEXT proc
 * rather than needing a reload. Production always renders the shipped defaults.
 *
 * Performance: every particle is transform/alpha-driven inside the existing Pixi layer, and the floating number
 * is a one-shot DOM element that removes itself. Nothing here loops, so nothing repaints per frame once a proc
 * has played out.
 */
export interface RubyPowerFxConfig {
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

  // ---- the "symbol +N" layout (the dagger / heart beside each number; stage px from the cue's centre) ----
  groupGap: number;     // px — how far each stat group sits from the centre when BOTH stats rose (a lone stat is centred)
  iconGap: number;      // px — the space between an icon's centre and its number's centre (the pair is centred on its group)
  atkIconScale: number; // × — the Attack icon's size, as a multiple of its authored size
  hpIconScale: number;  // × — the Health icon's size, as a multiple of its authored size
  symbolDy: number;     // px — the symbol's y from its group's centre (negative = up)
  strikeDelay: number;  // ms — how long the whoosh leads the pickaxe strike, the icons and the numbers

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
const DEFAULTS: RubyPowerFxConfig = {
  arrowCount: 1,
  arrowRise: 72,
  arrowSpread: 74,
  arrowLen: 26,
  arrowWidth: 3,
  arrowHead: 9,
  arrowMs: 710,
  arrowStagger: 48,
  arrowDrift: 14,
  arrowFadeAt: 0.62,

  blastCount: 60,
  blastSpeed: 350,
  blastSize: 5,
  blastLife: 1100,
  blastGravity: 140,
  blastSpread: 360,
  blastAngle: 0,
  blastDrag: 0.06,
  blastJitter: 0.44,
  blastRise: 48,
  blastSpin: 120,
  blastStagger: 3,
  blastShrink: 0.12,

  numShow: 1,
  numSize: 40,
  numRise: 70,
  numDelay: 0,
  numHoldMs: 1320,
  numFadeMs: 40,

  groupGap: 44,
  iconGap: 41,
  atkIconScale: 0.6,
  hpIconScale: 0.6,
  symbolDy: 0,
  strikeDelay: 340,

  colorA: '#ff5c5c',
  colorB: '#b171fe',
  colorC: '#ffffff',
  colorText: '#f04242',
  colorOutline: '#121212',
  glowAlpha: 0.68,
  glowWidth: 3.5,
};

export const RUBYPOWERFX_COLOR_KEYS: (keyof RubyPowerFxConfig)[] = ['colorA', 'colorB', 'colorC', 'colorText', 'colorOutline'];

export const RUBYPOWERFX_RANGES: Partial<Record<keyof RubyPowerFxConfig, [number, number, number]>> = {
  arrowCount: [1, 20, 1], arrowRise: [20, 320, 2], arrowSpread: [0, 260, 2], arrowLen: [6, 80, 1],
  arrowWidth: [1, 12, 0.5], arrowHead: [0, 28, 0.5], arrowMs: [120, 1600, 10], arrowStagger: [0, 160, 2],
  arrowDrift: [0, 90, 1], arrowFadeAt: [0, 1, 0.02],
  blastCount: [0, 60, 1], blastSpeed: [0, 600, 5], blastSize: [1, 20, 0.5], blastLife: [80, 1600, 20],
  blastGravity: [0, 900, 10],
  blastSpread: [0, 360, 5], blastAngle: [0, 360, 5], blastDrag: [0, 0.5, 0.01], blastJitter: [0, 1, 0.02],
  blastRise: [0, 400, 5], blastSpin: [0, 720, 10], blastStagger: [0, 120, 1], blastShrink: [0, 1, 0.02],
  numShow: [0, 1, 1], numSize: [10, 80, 1], numRise: [0, 180, 2], numDelay: [0, 1200, 10],
  numHoldMs: [0, 1600, 20], numFadeMs: [40, 1600, 20],
  groupGap: [0, 240, 1], iconGap: [0, 200, 1], atkIconScale: [0.2, 4, 0.05], hpIconScale: [0.2, 4, 0.05], symbolDy: [-120, 120, 1], strikeDelay: [0, 800, 10],
  glowAlpha: [0, 1, 0.02], glowWidth: [0, 24, 0.5],
};

const KEY = 'ascent.rubyPowerFx';

let cfg: RubyPowerFxConfig = load();

function load(): RubyPowerFxConfig {
  // DEV-only persistence, matching every other FX tuner: production always renders DEFAULTS, so a dialed-in
  // localStorage on a dev machine can never leak into what players see.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RubyPowerFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getRubyPowerFxConfig(): RubyPowerFxConfig {
  return cfg;
}
export function getRubyPowerFxDefaults(): RubyPowerFxConfig {
  return { ...DEFAULTS };
}
export function setRubyPowerFxValue(key: keyof RubyPowerFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetRubyPowerFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** One "symbol +N" group per stat that rose (owner 2026-11-10: "i want to see a symbol and +1 signifying how much it
 *  just got buffed"). Stage px, measured from the cue's centre: both stats sit side by side (Attack left, Health
 *  right); a lone stat is centred. The symbol sits left of the group's centre and its number right of it. */
function rubyStatGroups(atk: number, hp: number): { stat: 'atk' | 'hp'; gain: number; dx: number }[] {
  const both = atk > 0 && hp > 0;
  const out: { stat: 'atk' | 'hp'; gain: number; dx: number }[] = [];
  if (atk > 0) out.push({ stat: 'atk', gain: atk, dx: both ? -cfg.groupGap : 0 });
  if (hp > 0) out.push({ stat: 'hp', gain: hp, dx: both ? cfg.groupGap : 0 });
  return out;
}

/** The number's easing, as numbers: `floatOneRubyNumber` hands the same four to WAAPI. */
const RUBY_EASE = [0.22, 0.9, 0.3, 1] as const;
/** y of a CSS cubic-bezier(x1, y1, x2, y2) at progress `p` (0..1): solve x(t) = p by bisection, return y(t). */
function cubicBezierAt(p: number, x1: number, y1: number, x2: number, y2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const at = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, x1, x2) < p) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2, y1, y2);
}
/** How far (stage px) the floating number has risen `ms` after it appeared: the SAME keyframes and easing as
 *  `floatOneRubyNumber`'s animation, so an effect riding this stays glued to the number. */
export function rubyRiseAt(ms: number): number {
  const c = cfg;
  const total = c.numHoldMs + c.numFadeMs;
  if (total <= 0) return 0;
  const e = cubicBezierAt(Math.min(1, Math.max(0, ms / total)), ...RUBY_EASE);
  const popEnd = 0.22, holdEnd = c.numHoldMs / total;
  if (e <= popEnd) return 0;
  if (e <= holdEnd) return holdEnd > popEnd ? ((e - popEnd) / (holdEnd - popEnd)) * c.numRise * 0.7 : c.numRise * 0.7;
  return c.numRise * (0.7 + 0.3 * ((e - holdEnd) / (1 - holdEnd || 1)));
}

/**
 * The authored `ruby-buff` gem effect, played ON THE SOURCE of the buff at the moment the numbers appear
 * (after `numDelay`), so the two read as one hit. It replaced the hand-coded `pixiFx.rubyPower` sparkle
 * (owner 2026-11-10: "replace the sparkle. i created an fx def called ruby_buff that i want to use to float
 * alongside the number that is revealed"). Plays even when the number is switched off in the tuner.
 *
 * Which stat rose is shown by its own symbol beside the number: the dagger (`ruby-buff-attack`) when Ruby
 * Attack rose and the heart (`ruby-buff-health`) when Ruby Health rose, both when both did (owner 2026-11-10:
 * "i want to use these symbols to symoblize ruby health or attack being buffed").
 */
export function playRubyBuffFx(x: number, y: number, atk: number, hp: number, source: { x: number; y: number; uid?: string }): void {
  const fire = () => {
    sfx.rubyStrike(); // one random pickaxe strike, on the hit (the whoosh already started, see below)
    // The symbols RIDE the numbers: each play re-reads its point every frame from the same rise curve the number animates on
    // (`rubyRiseAt`, pure arithmetic on elapsed time, no layout read), so all of it floats up as one piece.
    const t0 = performance.now();
    const rider = (dx: number, dy: number) => () => ({ x: x + toScreen(dx), y: y + toScreen(dy - rubyRiseAt(performance.now() - t0)) });
    // The gem plays ON THE SOURCE and stays there (owner 2026-11-10: "remove the gem effect from the spell buff
    // effect. i want it to apply on the source whenever a ruby buff effect occurs"); only the symbols ride the numbers.
    const on = { x: source.x, y: source.y };
    const uids = source.uid ? { source: source.uid, target: source.uid } : undefined;
    playDef('ruby-buff', { source: on, target: on }, { uids });
    for (const g of rubyStatGroups(atk, hp)) {
      const iconDx = g.dx - cfg.iconGap / 2;
      const at = { x: x + toScreen(iconDx), y: y + toScreen(cfg.symbolDy) };
      const follow = rider(iconDx, cfg.symbolDy);
      const isAtk = g.stat === 'atk';
      // Each call on its own line: the uids scanner skips a call that shares a line with a quoted word.
      if (isAtk) {
        playDef('ruby-buff-attack', { source: at, target: at }, { follow, scale: cfg.atkIconScale });
      } else {
        playDef('ruby-buff-health', { source: at, target: at }, { follow, scale: cfg.hpIconScale });
      }
    }
  };
  // The whoosh starts NOW and leads everything else by `strikeDelay` (owner 2026-11-11: "can we have the woosh
  // start earlier?"), so it is already swelling when the strike, the gem, the icons and the numbers hit.
  sfx.rubyWhoosh();
  const wait = cfg.numDelay + cfg.strikeDelay;
  if (wait > 0) window.setTimeout(fire, wait);
  else fire();
}

/**
 * The floating spell-power number. A one-shot DOM element rather than a Pixi one: `pixiFx` never imports
 * `Text` (it would pull a font atlas into the FX bundle for this single use), and the number wants the same
 * crisp UI font as the rest of the HUD. Animated with the Web Animations API — transform + opacity only, so
 * it stays compositor-side — and removes itself on finish, leaving no node behind.
 *
 * Shared by the shop fire and the tuner's ▶ Test, so both read identically.
 */
export function floatRubyPowerNumber(x: number, y: number, atk: number, hp: number): void {
  const c = cfg;
  if (!c.numShow || typeof document === 'undefined') return;
  // Nothing gained → nothing to say. (Guards the case where a caller fires the arrows for a non-gain.)
  if (atk <= 0 && hp <= 0) return;
  // One "+N" per stat that rose, each beside its own symbol (the dagger for Attack, the heart for Health, played
  // by `playRubyBuffFx`), so the symbol says WHICH stat and the number says how much.
  for (const g of rubyStatGroups(atk, hp)) floatOneRubyNumber(toStage(x) + g.dx + c.iconGap / 2, toStage(y), `${g.gain}`);
}

function floatOneRubyNumber(stageX: number, stageY: number, label: string): void {
  const c = cfg;
  const el = document.createElement('div');
  el.className = 'rubypower-float';
  setGlowText(el, label); // (+ its iPhone glow copy, webkitText.ts)
  el.style.left = `${stageX}px`;
  el.style.top = `${stageY}px`;
  el.style.fontSize = `${c.numSize}px`;
  el.style.setProperty('--spf-text', c.colorText);
  el.style.setProperty('--spf-outline', c.colorOutline);
  stageHost().appendChild(el);
  const total = c.numHoldMs + c.numFadeMs;
  try {
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.22 },
      { transform: `translate(-50%, calc(-50% - ${c.numRise * 0.7}px)) scale(1)`, opacity: 1, offset: c.numHoldMs / total },
      { transform: `translate(-50%, calc(-50% - ${c.numRise}px)) scale(0.96)`, opacity: 0 },
    ], { duration: total, delay: c.numDelay + c.strikeDelay, easing: `cubic-bezier(${RUBY_EASE.join(', ')})`, fill: 'backwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  } catch {
    // WAAPI unavailable: don't strand a permanent number on the board.
    el.remove();
  }
}
