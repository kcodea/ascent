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
  reflect();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetCardToHandFxConfig(): void {
  cfg = { ...DEFAULTS };
  reflect();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Push the motion knobs to the `--c2h-*` CSS vars the `.handgrant` keyframe reads. The MOTION is a CSS
 *  animation (WAAPI proved unreliable in-app — it froze at t=0), so the card motion lives in styles.css and
 *  reads these; only the Pixi shine is fired from JS. Called at boot + on every tuner edit. */
export function reflect(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  const total = cfg.popMs + cfg.settleMs + cfg.holdMs + cfg.slideMs;
  r.setProperty('--c2h-total-ms', `${total}ms`);
  r.setProperty('--c2h-start-scale', String(cfg.startScale));
  r.setProperty('--c2h-pop-scale', String(cfg.popScale));
  r.setProperty('--c2h-rise-vh', `${cfg.riseVh}vh`);
  r.setProperty('--c2h-slide-vh', `${cfg.slideVh}vh`);
  r.setProperty('--c2h-slide-end-scale', String(cfg.slideEndScale));
}

reflect();

/**
 * Fire the Pixi shine sweep + sparkles over a mounted `.handgrant` element — the CARD MOTION is the CSS
 * `tohandfly` animation (see styles.css); this just adds the flair, delayed to land on the pop peak. Shared by
 * the combat + recruit grants.
 */
export function fireCardShine(el: HTMLElement, shine: (cx: number, cy: number, w: number, h: number) => void): void {
  window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.width > 0) shine(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height);
  }, cfg.shineDelayMs);
}
