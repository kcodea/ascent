/**
 * Tunable parameters for the CARD-TO-HAND FX — the flourish when a card is sent to your hand from ANY source,
 * in combat AND in the shop / End of Turn (Mechanical Jouster, Crypt Scribe, Steward of Spells, Badgington,
 * Money Maker, Buddy Buddy, combat grants like Arcane Weaver, …). Owner ask 2026-07-21: the card quick
 * snap/pops up and SHINES (a Pixi light sweep + sparkles — Pixi reads better than CSS for the flair) while it
 * eases its momentum, then quickly slides down into the hand.
 *
 * Two layers, both dialed here and both read at FIRE TIME (no CSS vars — see `animateCardToHand`): the CARD's
 * motion is a Web-Animations-API keyframe on `.handgrant`, and the SHINE is `pixiFx.cardShine`. The "🃏 Card
 * To Hand" tuner drives both live. Dev-persisted; production renders DEFAULTS.
 */
export interface CardToHandFxConfig {
  // ---- the card's motion ----
  popScale: number;     // × — peak scale of the snap/pop before it settles
  popMs: number;        // ms — the quick snap up to peak scale
  settleMs: number;     // ms — ease back to rest scale (the "momentum" ease)
  holdMs: number;       // ms — beat of stillness at full size before the slide
  slideVh: number;      // vh — how far down it slides toward the hand
  slideMs: number;      // ms — the quick slide down
  slideEndScale: number;// × — scale as it reaches the hand (shrinks in)
  startScale: number;   // × — scale it pops IN from
  riseVh: number;       // vh — small upward pop before settling (0 = straight pop in place)

  // ---- the Pixi shine (a diagonal light sweep across the card) ----
  shineDelayMs: number; // ms after spawn before the sweep fires (lands on the pop peak)
  shineMs: number;      // ms — the sweep's travel across the card
  shineWidth: number;   // px — the light band's width
  shineAlpha: number;   // 0..1 — sweep brightness
  shineAngle: number;   // deg — sweep direction (0 = left→right, 45 = diagonal)

  // ---- the Pixi sparkle burst ----
  sparkCount: number;   // sparkles popped over the card as it shines (0 = off)
  sparkSpeed: number;   // px/s
  sparkSize: number;    // px
  sparkLife: number;    // ms
  sparkSpread: number;  // px — how far from card-centre they spawn

  colorShine: string;   // the light sweep + sparkle colour
}

const DEFAULTS: CardToHandFxConfig = {
  popScale: 1.12,
  popMs: 170,
  settleMs: 220,
  holdMs: 120,
  slideVh: 46,
  slideMs: 300,
  slideEndScale: 0.42,
  startScale: 0.55,
  riseVh: 4,

  shineDelayMs: 150,
  shineMs: 380,
  shineWidth: 46,
  shineAlpha: 0.85,
  shineAngle: 22,

  sparkCount: 14,
  sparkSpeed: 190,
  sparkSize: 4,
  sparkLife: 560,
  sparkSpread: 40,

  colorShine: '#fff2c4',
};

export const C2H_KEYS = [
  'popScale', 'popMs', 'settleMs', 'holdMs', 'slideVh', 'slideMs', 'slideEndScale', 'startScale', 'riseVh',
  'shineDelayMs', 'shineMs', 'shineWidth', 'shineAlpha', 'shineAngle',
  'sparkCount', 'sparkSpeed', 'sparkSize', 'sparkLife', 'sparkSpread',
  'colorShine',
] as const satisfies readonly (keyof CardToHandFxConfig)[];

export const C2H_COLOR_KEYS: (keyof CardToHandFxConfig)[] = ['colorShine'];

export const C2H_RANGES: Partial<Record<keyof CardToHandFxConfig, [number, number, number]>> = {
  popScale: [1, 1.6, 0.01], popMs: [40, 600, 10], settleMs: [40, 800, 10], holdMs: [0, 800, 10],
  slideVh: [10, 80, 1], slideMs: [80, 900, 10], slideEndScale: [0.2, 1, 0.02], startScale: [0.2, 1.2, 0.02],
  riseVh: [0, 20, 0.5],
  shineDelayMs: [0, 800, 10], shineMs: [80, 900, 10], shineWidth: [10, 160, 2], shineAlpha: [0, 1, 0.02],
  shineAngle: [-90, 90, 2],
  sparkCount: [0, 50, 1], sparkSpeed: [0, 500, 5], sparkSize: [1, 16, 0.5], sparkLife: [80, 1400, 20],
  sparkSpread: [0, 140, 2],
};

const KEY = 'ascent.cardToHandFx';

let cfg: CardToHandFxConfig = load();

function load(): CardToHandFxConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<CardToHandFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getCardToHandFxConfig(): CardToHandFxConfig {
  return cfg;
}
export function setCardToHandFxValue(key: keyof CardToHandFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetCardToHandFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Motion + shine are read live from `cfg` at fire time (WAAPI + pixiFx.cardShine), so there's nothing to
// reflect to CSS — the tuner's edits apply to the NEXT grant automatically.

/**
 * Run the full card-to-hand flourish on a mounted `.handgrant` element: the WAAPI motion (snap/pop + rise →
 * ease to rest → hold → quick slide down) plus the Pixi shine sweep + sparkles, fired at the pop peak over the
 * card's live rect. Shared by the combat grant and the recruit grant so both read identically.
 */
export function animateCardToHand(el: HTMLElement, fireShine: (cx: number, cy: number, w: number, h: number) => void): void {
  const c = cfg;
  const total = c.popMs + c.settleMs + c.holdMs + c.slideMs;
  const off = (ms: number): number => ms / total;
  try {
    el.animate([
      { opacity: 0, transform: `translate(-50%, -50%) scale(${c.startScale})`, offset: 0 },
      { opacity: 1, transform: `translate(-50%, calc(-50% - ${c.riseVh}vh)) scale(${c.popScale})`, offset: off(c.popMs) },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: off(c.popMs + c.settleMs) },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: off(c.popMs + c.settleMs + c.holdMs) },
      { opacity: 0, transform: `translate(-50%, calc(-50% + ${c.slideVh}vh)) scale(${c.slideEndScale})`, offset: 1 },
    ], { duration: total, easing: 'cubic-bezier(0.34, 1.3, 0.5, 1)', fill: 'forwards' });
  } catch { /* WAAPI unavailable — the card just stays hidden rather than flashing */ }
  // Fire the shine over the card at the pop peak (delay so it lands on the snap, not the spawn).
  window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) fireShine(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height);
  }, c.shineDelayMs);
}
